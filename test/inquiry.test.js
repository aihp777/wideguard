// POST /api/inquiry 검증·발송 로직 테스트
// 실행: npm test   (또는 node --test test/)
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const handler = require("../api/inquiry.js");

const ENV_KEYS = [
  "SMS_PROVIDER",
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET",
  "SOLAPI_SENDER",
  "ALIGO_API_KEY",
  "ALIGO_USER_ID",
  "ALIGO_SENDER",
  "ALIGO_TESTMODE",
  "NOTIFY_PHONES",
  "ADMIN_PHONES",
];

function setEnv(map) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(map || {})) process.env[key] = value;
}

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      res.headers[k.toLowerCase()] = v;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

function req(body, method) {
  return { method: method || "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body };
}

function okFetch(payload) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(payload || {}) };
  };
  fn.calls = calls;
  return fn;
}

const VALID = {
  name: "홍길동",
  tel: "010-1234-5678",
  type: "시설경비",
  msg: "김포 빌딩 야간 순찰 인력 상담 부탁드립니다. 다음 주부터 필요합니다.",
  agree: true,
};

test.beforeEach(() => {
  setEnv({});
  handler.resetRateLimit();
});

/* ------------------------------------------------------------ 검증 */

test("검증: 필수값이 없으면 오류를 모은다", () => {
  const { errors, value } = handler.validate({});
  assert.ok(errors.length >= 3, errors.join(" / "));
  assert.strictEqual(value.name, "");
});

test("검증: 잘못된 연락처는 거절한다", () => {
  for (const tel of ["02-123-4567", "010-123", "abcd", "010123456789012"]) {
    const { errors } = handler.validate({ ...VALID, tel });
    assert.ok(
      errors.some((e) => e.includes("연락처")),
      `허용되면 안 되는 번호: ${tel}`
    );
  }
});

test("검증: 휴대폰 번호는 하이픈 없이도 통과하고 표시용으로 정리된다", () => {
  const { errors, value } = handler.validate({ ...VALID, tel: "01012345678" });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(value.tel, "010-1234-5678");
});

test("검증: 6대 사업영역 + 기타/견적문의 표기를 모두 받아들인다", () => {
  const types = [
    "시설경비",
    "신변보호",
    "혼잡·교통유도경비",
    "이주관리 · 범죄예방",
    "행정대집행지원",
    "청소대행",
    "기타 / 견적문의",
  ];
  for (const type of types) {
    const { errors, value } = handler.validate({ ...VALID, type });
    assert.deepStrictEqual(errors, [], type);
    assert.ok(value.type, type);
  }
  // 목록에 없는 분야는 거절
  assert.ok(handler.validate({ ...VALID, type: "특수경비" }).errors.length > 0);
});

test("검증: 개인정보 동의가 없으면 거절한다", () => {
  const { errors } = handler.validate({ ...VALID, agree: false });
  assert.ok(errors.some((e) => e.includes("동의")));
});

test("검증: 문의 내용은 5자 이상", () => {
  assert.ok(handler.validate({ ...VALID, msg: "문의" }).errors.some((e) => e.includes("문의 내용")));
  assert.deepStrictEqual(handler.validate({ ...VALID, msg: "상담 부탁드립니다" }).errors, []);
});

/* ------------------------------------------------------------ 솔라피 */

test("솔라피: 두 담당자 번호로 HMAC 인증 발송", async () => {
  setEnv({
    SMS_PROVIDER: "solapi",
    SOLAPI_API_KEY: "TESTKEY",
    SOLAPI_API_SECRET: "TESTSECRET",
    SOLAPI_SENDER: "031-954-2001",
  });
  const fetchMock = okFetch({ messageList: [{ statusCode: "2000" }, { statusCode: "2000" }] });
  global.fetch = fetchMock;

  const res = mockRes();
  await handler(req(VALID), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.sms, "sent");
  assert.strictEqual(res.body.delivered, 2);
  assert.strictEqual(fetchMock.calls.length, 1);

  const { url, init } = fetchMock.calls[0];
  assert.strictEqual(url, "https://api.solapi.com/messages/v4/send-many/detail");
  assert.match(init.headers.Authorization, /^HMAC-SHA256 apiKey=TESTKEY, date=.+, salt=[0-9a-f]{32}, signature=[0-9a-f]{64}$/);

  const sent = JSON.parse(init.body);
  assert.strictEqual(sent.messages.length, 2);
  assert.deepStrictEqual(
    sent.messages.map((m) => m.to).sort(),
    ["01088585559", "01093287814"]
  );
  assert.ok(sent.messages.every((m) => m.from === "0319542001"));
  assert.ok(sent.messages[0].text.includes("홍길동"));
  assert.ok(sent.messages[0].text.includes("시설경비"));
  assert.ok(sent.messages[0].text.includes("010-1234-5678"));
});

test("솔라피: 일부만 접수되면 partial", async () => {
  setEnv({
    SMS_PROVIDER: "solapi",
    SOLAPI_API_KEY: "TESTKEY",
    SOLAPI_API_SECRET: "TESTSECRET",
    SOLAPI_SENDER: "0319542001",
  });
  global.fetch = okFetch({ messageList: [{ statusCode: "2000" }, { statusCode: "1030" }] });

  const res = mockRes();
  await handler(req(VALID), res);
  assert.strictEqual(res.body.sms, "partial");
  assert.strictEqual(res.body.delivered, 1);
});

/* ------------------------------------------------------------ 알리고 */

test("알리고: 수신번호를 콤마로 묶어 발송", async () => {
  setEnv({
    SMS_PROVIDER: "aligo",
    ALIGO_API_KEY: "ALIGOKEY",
    ALIGO_USER_ID: "wideguard",
    ALIGO_SENDER: "0319542001",
  });
  const fetchMock = okFetch({ result_code: "1", message: "성공적으로 전송되었습니다.", success_cnt: 2 });
  global.fetch = fetchMock;

  const res = mockRes();
  await handler(req(VALID), res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.sms, "sent");

  const { url, init } = fetchMock.calls[0];
  assert.strictEqual(url, "https://apis.aligo.in/send/");
  assert.match(init.headers["Content-Type"], /x-www-form-urlencoded/);
  const form = new URLSearchParams(init.body);
  assert.strictEqual(form.get("key"), "ALIGOKEY");
  assert.strictEqual(form.get("user_id"), "wideguard");
  assert.strictEqual(form.get("sender"), "0319542001");
  assert.strictEqual(form.get("receiver"), "01088585559,01093287814");
  assert.strictEqual(form.get("msg_type"), "LMS");
  assert.ok(form.get("msg").includes("[와이드가드]"));
});

/* ------------------------------------------------------------ 설정·오류 */

test("문자 키가 없으면 접수만 하고 skipped 로 응답한다", async () => {
  global.fetch = async () => {
    throw new Error("발송하면 안 됨");
  };
  const res = mockRes();
  await handler(req(VALID), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.sms, "skipped");
});

test("SMS_PROVIDER=aligo 인데 알리고 키가 없으면 skipped", async () => {
  setEnv({ SMS_PROVIDER: "aligo" });
  global.fetch = async () => {
    throw new Error("발송하면 안 됨");
  };
  const res = mockRes();
  await handler(req(VALID), res);
  assert.strictEqual(res.body.sms, "skipped");
});

test("발송 실패는 502 와 안내 문구로 응답한다", async () => {
  setEnv({
    SMS_PROVIDER: "solapi",
    SOLAPI_API_KEY: "TESTKEY",
    SOLAPI_API_SECRET: "TESTSECRET",
    SOLAPI_SENDER: "0319542001",
  });
  global.fetch = async () => ({ ok: false, status: 400, text: async () => '{"errorCode":"InvalidKey"}' });

  const res = mockRes();
  await handler(req(VALID), res);
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.message.includes("031-954-2001"));
});

test("검증 실패는 400 과 첫 오류 문구", async () => {
  const res = mockRes();
  await handler(req({ name: "홍", tel: "010-1234-5678", type: "", msg: "", agree: false }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.message.length > 0);
});

test("GET 은 405", async () => {
  const res = mockRes();
  await handler(req(null, "GET"), res);
  assert.strictEqual(res.statusCode, 405);
});

test("스팸 숨김 필드가 채워지면 발송하지 않고 조용히 성공 응답", async () => {
  global.fetch = async () => {
    throw new Error("발송하면 안 됨");
  };
  const res = mockRes();
  await handler(req({ ...VALID, website: "http://spam.example" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.sms, "skipped");
});

test("같은 IP 반복 접수는 429 로 제한한다", async () => {
  const res = [];
  for (let i = 0; i < 6; i += 1) {
    const r = mockRes();
    await handler(req({ ...VALID, name: "홍길동" }), r);
    res.push(r);
  }
  assert.strictEqual(res[5].statusCode, 429);
});

test("NOTIFY_PHONES 로 받는 번호를 바꿀 수 있다", async () => {
  setEnv({
    SMS_PROVIDER: "solapi",
    SOLAPI_API_KEY: "TESTKEY",
    SOLAPI_API_SECRET: "TESTSECRET",
    SOLAPI_SENDER: "0319542001",
    NOTIFY_PHONES: "010-0000-1111, 010-2222-3333",
  });
  const fetchMock = okFetch({ messageList: [{ statusCode: "2000" }, { statusCode: "2000" }] });
  global.fetch = fetchMock;

  const res = mockRes();
  await handler(req(VALID), res);
  const sent = JSON.parse(fetchMock.calls[0].init.body);
  assert.deepStrictEqual(
    sent.messages.map((m) => m.to).sort(),
    ["01000001111", "01022223333"]
  );
});
