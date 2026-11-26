// ㈜와이드가드 홈페이지 — 상담 접수 + 담당자 2인 문자 알림
//
//   POST /api/inquiry
//   body: { name, tel, type, msg, agree, website? }   (website 는 스팸 방지용 숨김 필드)
//   응답: { ok: true, sms: "sent" | "partial" | "skipped", delivered: n }
//
// 알림 수신: 대표이사 김정환 010-8858-5559, 사내이사 김종연 010-9328-7814
//            (NOTIFY_PHONES 환경변수로 재정의할 수 있습니다)
//
// Vercel 환경변수
//   SMS_PROVIDER     "solapi" 또는 "aligo" (비우면 설정된 키를 보고 자동 선택)
//   SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER
//   ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER
//   NOTIFY_PHONES    "01088585559,01093287814" 형식 (선택)
//
// Node.js 18 이상(Vercel 기본 런타임)에서 동작하며 외부 패키지가 필요 없습니다.
"use strict";

const crypto = require("crypto");

/* ---------------------------------------------------------------- 상수 */

const DEFAULT_PHONES = ["01088585559", "01093287814"];

// 상담 폼의 문의 분야 (6대 사업영역 + 기타/견적문의)
const CATEGORIES = [
  "시설경비",
  "신변보호",
  "혼잡·교통유도경비",
  "이주관리·범죄예방",
  "행정대집행지원",
  "청소대행",
  "기타 / 견적문의",
];

const LIMITS = { name: 30, msg: 2000, tel: 20 };
const RATE = { windowMs: 10 * 60 * 1000, max: 5 };

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send-many/detail";
const ALIGO_URL = "https://apis.aligo.in/send/";

/* ---------------------------------------------------------------- 유틸 */

const env = (key) => String(process.env[key] || "").trim();
const digits = (value) => String(value == null ? "" : value).replace(/\D/g, "");
const text = (value, max) =>
  String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** 전화번호 표시용 (010-1234-5678) */
function formatPhone(value) {
  const d = digits(value);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/** 로그용 마스킹 (010-****-5678) */
function maskPhone(value) {
  const d = digits(value);
  if (d.length < 9) return "***";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

/** 문자 본문 바이트 (한글 2바이트 기준, 알리고/SMS 요금 계산과 동일한 방식) */
function smsBytes(value) {
  let bytes = 0;
  for (const ch of String(value)) bytes += ch.charCodeAt(0) > 127 ? 2 : 1;
  return bytes;
}

function readBody(req) {
  const raw = req && req.body;
  if (raw == null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw httpError(400, "요청 형식을 확인해 주세요.");
    }
  }
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch (_) {
      throw httpError(400, "요청 형식을 확인해 주세요.");
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

function clientIp(req) {
  const header = req && req.headers ? req.headers["x-forwarded-for"] : "";
  const first = Array.isArray(header) ? header[0] : String(header || "");
  return first.split(",")[0].trim() || (req && req.socket && req.socket.remoteAddress) || "unknown";
}

/* ---------------------------------------------------------------- 검증 */

function normalizeCategory(value) {
  const clean = (s) => String(s == null ? "" : s).replace(/[\s·\/]/g, "").toLowerCase();
  const key = clean(value);
  if (!key) return "";
  const found = CATEGORIES.find((c) => clean(c) === key);
  return found || "";
}

/**
 * 입력값 검증 — 성공하면 { value, errors: [] }
 * value = { name, tel, type, msg }
 */
function validate(payload) {
  const body = payload || {};
  const errors = [];

  const name = text(body.name, LIMITS.name);
  if (!name) errors.push("성함을 입력해 주세요.");
  else if (name.length < 2) errors.push("성함을 2자 이상 입력해 주세요.");

  const telDigits = digits(body.tel).slice(0, LIMITS.tel);
  if (!telDigits) errors.push("연락처를 입력해 주세요.");
  else if (!/^01[016789]\d{7,8}$/.test(telDigits))
    errors.push("연락처를 정확히 입력해 주세요. (예: 010-1234-5678)");

  const type = normalizeCategory(body.type);
  if (!type) errors.push("문의 분야를 선택해 주세요.");

  const msgSource = body.msg != null ? body.msg : body.message != null ? body.message : "";
  const msg = String(msgSource).replace(/\r\n/g, "\n").trim().slice(0, LIMITS.msg);
  if (!msg) errors.push("문의 내용을 입력해 주세요.");
  else if (msg.replace(/\s/g, "").length < 5) errors.push("문의 내용을 5자 이상 입력해 주세요.");

  const agree = body.agree === true || body.agree === "true" || body.agree === "on" || body.agree === 1;
  if (!agree) errors.push("개인정보 수집·이용에 동의해 주세요.");

  return {
    errors,
    value: { name, tel: formatPhone(telDigits), type, msg },
  };
}

/** 담당자에게 보낼 문자 본문 */
function buildMessage(value) {
  const v = value || {};
  const body = String(v.msg || "").replace(/\s+/g, " ").trim();
  const excerpt = body.length > 120 ? body.slice(0, 118) + "…" : body;
  const lines = [
    "[와이드가드] 홈페이지 상담 신청",
    `· 분야: ${v.type || "-"}`,
    `· 성함: ${v.name || "-"}`,
    `· 연락처: ${v.tel || "-"}`,
    `· 내용: ${excerpt || "-"}`,
  ];
  return lines.join("\n").slice(0, 900);
}

/* ---------------------------------------------------------------- 문자 발송 */

/** 알림 받을 번호 (기본: 대표이사·사내이사) */
function notifyPhones() {
  const configured = env("NOTIFY_PHONES") || env("ADMIN_PHONES");
  const list = (configured ? configured.split(",") : DEFAULT_PHONES)
    .map(digits)
    .filter((n) => /^01[016789]\d{7,8}$/.test(n));
  return list.length ? Array.from(new Set(list)) : DEFAULT_PHONES.slice();
}

/** 사용할 문자 서비스 결정 */
function pickProvider() {
  const wanted = env("SMS_PROVIDER").toLowerCase();
  const hasSolapi = !!(env("SOLAPI_API_KEY") && env("SOLAPI_API_SECRET") && env("SOLAPI_SENDER"));
  const hasAligo = !!(env("ALIGO_API_KEY") && env("ALIGO_USER_ID") && env("ALIGO_SENDER"));

  if (wanted === "solapi") return hasSolapi ? "solapi" : "";
  if (wanted === "aligo") return hasAligo ? "aligo" : "";
  if (hasSolapi) return "solapi";
  if (hasAligo) return "aligo";
  return "";
}

/** 솔라피(Solapi) — HMAC-SHA256 인증, 여러 건 동시 발송 */
async function sendSolapi(phones, body) {
  const apiKey = env("SOLAPI_API_KEY");
  const apiSecret = env("SOLAPI_API_SECRET");
  const sender = digits(env("SOLAPI_SENDER"));
  if (!apiKey || !apiSecret || !sender) throw httpError(500, "솔라피 설정이 없습니다.");

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", apiSecret).update(date + salt).digest("hex");

  const messages = phones.map((to) => ({ to, from: sender, text: body }));
  const res = await fetch(SOLAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({ messages }),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    throw httpError(502, "솔라피 발송 실패: " + (raw || res.status).toString().slice(0, 200));
  }

  const list = (data && data.messageList) || [];
  if (Array.isArray(list) && list.length) {
    return list.filter((m) => String(m && m.statusCode).startsWith("2")).length;
  }
  return phones.length;
}

/** 알리고(Aligo) — key/user_id 인증, 수신번호 콤마 구분 */
async function sendAligo(phones, body) {
  const apiKey = env("ALIGO_API_KEY");
  const userId = env("ALIGO_USER_ID");
  const sender = digits(env("ALIGO_SENDER"));
  if (!apiKey || !userId || !sender) throw httpError(500, "알리고 설정이 없습니다.");

  const isLong = smsBytes(body) > 90;
  const form = new URLSearchParams({
    key: apiKey,
    user_id: userId,
    sender,
    receiver: phones.join(","),
    msg: body,
    msg_type: isLong ? "LMS" : "SMS",
  });
  if (isLong) form.set("title", "와이드가드 상담 알림");
  if (env("ALIGO_TESTMODE").toLowerCase() === "y") form.set("testmode_yn", "Y");

  const res = await fetch(ALIGO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: form.toString(),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = null;
  }
  const code = data && String(data.result_code);
  if (!res.ok || code !== "1") {
    const reason = (data && (data.message || data.msg)) || raw || res.status;
    throw httpError(502, "알리고 발송 실패: " + String(reason).slice(0, 200));
  }
  const count = Number(data && data.success_cnt);
  return Number.isFinite(count) && count > 0 ? Math.min(count, phones.length) : phones.length;
}

async function sendSms(provider, phones, body) {
  if (provider === "aligo") return sendAligo(phones, body);
  return sendSolapi(phones, body);
}

/* ---------------------------------------------------------------- 요청 제한 */

const hits = new Map(); // ip -> [timestamp, ...]

function allowRequest(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  if (list.length >= RATE.max) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

/** 테스트용 초기화 */
function resetRateLimit() {
  hits.clear();
}

/* ---------------------------------------------------------------- 핸들러 */

let seq = 0;
function makeId() {
  seq = (seq + 1) % 100000;
  return (
    "wg-" +
    Date.now().toString(36) +
    "-" +
    seq.toString(36).padStart(3, "0") +
    "-" +
    crypto.randomBytes(2).toString("hex")
  );
}

function send(res, status, payload) {
  if (res && typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(payload);
    return;
  }
  if (res && typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (res && typeof res.end === "function") {
    res.statusCode = status;
    res.end(JSON.stringify(payload));
  }
}

async function handler(req, res) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store");
  }

  if (!req || req.method === "OPTIONS") {
    if (res && typeof res.status === "function") res.status(204).end();
    else if (res && typeof res.end === "function") {
      res.statusCode = 204;
      res.end();
    }
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ok: false, message: "POST 요청만 지원합니다." });
    return;
  }

  let payload;
  try {
    payload = readBody(req);
  } catch (error) {
    send(res, error.status || 400, { ok: false, message: error.message });
    return;
  }

  // 스팸 봇: 숨김 필드가 채워져 있으면 조용히 무시
  if (payload && typeof payload.website === "string" && payload.website.trim()) {
    console.warn("[inquiry] honeypot blocked");
    send(res, 200, { ok: true, sms: "skipped", delivered: 0 });
    return;
  }

  const ip = clientIp(req);
  if (!allowRequest(ip)) {
    send(res, 429, {
      ok: false,
      message: "짧은 시간에 여러 번 접수되었습니다. 잠시 후 다시 시도하시거나 전화(031-945-2001)로 문의해 주세요.",
    });
    return;
  }

  const { value, errors } = validate(payload);
  if (errors.length) {
    send(res, 400, { ok: false, message: errors[0], errors });
    return;
  }

  const id = makeId();
  const phones = notifyPhones();
  const provider = pickProvider();
  const body = buildMessage(value);

  console.log(
    "[inquiry] received",
    JSON.stringify({
      id,
      at: new Date().toISOString(),
      type: value.type,
      name: value.name,
      tel: maskPhone(value.tel),
      provider: provider || "none",
    })
  );

  // 문자 서비스 키가 없으면 접수만 하고 skipped 로 응답 (프론트에서 전화·메일 안내)
  if (!provider) {
    console.warn("[inquiry] SMS_PROVIDER/SOLAPI/ALIGO 환경변수가 없어 문자를 보내지 않았습니다.", id);
    send(res, 200, { ok: true, id, sms: "skipped", delivered: 0 });
    return;
  }

  let delivered = 0;
  try {
    delivered = await sendSms(provider, phones, body);
  } catch (error) {
    console.error("[inquiry] sms failed", id, error.message);
    send(res, 502, {
      ok: false,
      id,
      message:
        "알림 문자 발송에 실패해 상담 요청이 담당자에게 전달되지 않았습니다. 번거롭지만 전화(031-945-2001)나 이메일(dbeh1@naver.com)로 문의해 주세요.",
    });
    return;
  }

  const sms = delivered >= phones.length ? "sent" : delivered > 0 ? "partial" : "failed";
  if (sms === "failed") {
    console.error("[inquiry] sms delivered 0", id, provider);
    send(res, 502, {
      ok: false,
      id,
      message:
        "알림 문자 발송에 실패해 상담 요청이 담당자에게 전달되지 않았습니다. 번거롭지만 전화(031-945-2001)나 이메일(dbeh1@naver.com)로 문의해 주세요.",
    });
    return;
  }

  console.log("[inquiry] sent", JSON.stringify({ id, provider, sms, delivered, recipients: phones.length }));
  send(res, 200, { ok: true, id, sms, delivered });
}

module.exports = handler;
module.exports.handler = handler;
module.exports.validate = validate;
module.exports.buildMessage = buildMessage;
module.exports.notifyPhones = notifyPhones;
module.exports.pickProvider = pickProvider;
module.exports.sendSms = sendSms;
module.exports.resetRateLimit = resetRateLimit;
module.exports.CATEGORIES = CATEGORIES;
module.exports.DEFAULT_PHONES = DEFAULT_PHONES;
