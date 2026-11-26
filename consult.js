/* =========================================================
   ㈜와이드가드 WIDE GUARD — consult.js
   간편상담 전용 폼 (API 계약·메일 백업은 app.js와 동일)
   ========================================================= */
(function () {
  "use strict";

  var form = document.getElementById("inqForm");
  if (!form) return;

  var err = document.getElementById("formErr");
  var done = document.getElementById("formDone");
  var doneTitle = document.getElementById("formDoneTitle");
  var doneDesc = document.getElementById("formDoneDesc");
  var sendMail = document.getElementById("sendMail");
  var again = document.getElementById("formAgain");
  var submitBtn = form.querySelector('button[type="submit"]');
  var submitLabel = submitBtn ? submitBtn.textContent : "간편상담 신청하기";
  var MOBILE = /^01[016789]\d{7,8}$/;
  var MAIL_TO = "dbeh1@naver.com,rokmc520331@naver.com";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showErr(text) {
    if (!err) return;
    err.textContent = text;
    err.hidden = false;
  }
  function hideErr() {
    if (err) err.hidden = true;
  }
  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? "전송 중…" : submitLabel;
    submitBtn.classList.toggle("is-busy", busy);
  }
  function showDone(title, desc, closeForm) {
    if (doneTitle) doneTitle.textContent = title;
    if (doneDesc) doneDesc.textContent = desc;
    form.classList.toggle("is-done", !!closeForm);
    if (done) {
      done.hidden = false;
      if (closeForm) done.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
    }
  }
  function type() {
    var checked = form.querySelector('input[name="ctype"]:checked');
    return checked ? checked.value : "";
  }

  if (again) {
    again.addEventListener("click", function () {
      form.classList.remove("is-done");
      if (done) done.hidden = true;
      setBusy(false);
      var first = form.querySelector("#f-tel");
      if (first) first.focus();
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var nameEl = form.querySelector("#f-name");
    var telEl = form.querySelector("#f-tel");
    var siteEl = form.querySelector("#f-site");
    var msgEl = form.querySelector("#f-msg");
    var agreeEl = form.querySelector("#f-agree");
    var trapEl = form.querySelector("#f-web");

    var name = nameEl ? nameEl.value.trim() : "";
    var tel = telEl ? telEl.value.trim() : "";
    var site = siteEl ? siteEl.value.trim() : "";
    var body = msgEl ? msgEl.value.trim() : "";
    var category = type();
    var agree = !!(agreeEl && agreeEl.checked);
    var trap = trapEl ? trapEl.value : "";

    if (!category) {
      showErr("업무 분야를 선택해 주세요.");
      if (done) done.hidden = true;
      return;
    }
    if (!tel) {
      showErr("연락처를 입력해 주세요.");
      if (done) done.hidden = true;
      if (telEl) telEl.focus();
      return;
    }
    var digits = tel.replace(/\D/g, "");
    if (!MOBILE.test(digits)) {
      showErr("연락처를 정확히 입력해 주세요. (예: 010-1234-5678)");
      if (done) done.hidden = true;
      if (telEl) telEl.focus();
      return;
    }
    if (!site) {
      showErr("지역이나 현장을 적어 주세요. (예: 김포 풍무동 오피스 빌딩)");
      if (done) done.hidden = true;
      if (siteEl) siteEl.focus();
      return;
    }
    if (!body || body.replace(/\s/g, "").length < 5) {
      showErr("간단한 내용을 5자 이상 적어 주세요.");
      if (done) done.hidden = true;
      if (msgEl) msgEl.focus();
      return;
    }
    if (!agree) {
      showErr("개인정보 수집·이용에 동의해 주세요.");
      if (done) done.hidden = true;
      if (agreeEl) agreeEl.focus();
      return;
    }

    hideErr();

    /* 담당자가 한눈에 보도록 지역/현장을 본문 앞에 붙입니다. */
    var fullMsg = "[지역/현장] " + site + "\n\n" + body;

    var subject = "[와이드가드] 간편상담 - " + category + (name ? " / " + name : "");
    var mailBody =
      "이름: " + (name || "미기재") + "\n" +
      "연락처: " + tel + "\n" +
      "업무 분야: " + category + "\n" +
      "지역/현장: " + site + "\n\n" +
      "문의 내용:\n" + body + "\n\n" +
      "(경로: 인스타·스레드 프로필 → 간편상담 페이지)";
    if (sendMail) {
      sendMail.href = "mailto:" + MAIL_TO +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(mailBody);
    }

    setBusy(true);

    var res = null;
    var data = null;
    try {
      res = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "미기재",
          tel: tel,
          type: category,
          msg: fullMsg,
          agree: true,
          website: trap
        })
      });
      try { data = await res.json(); } catch (_) { data = null; }
    } catch (_) {
      res = null;
      data = null;
    }

    setBusy(false);

    if (res && res.ok && data && data.ok) {
      var smsSent = data.sms === "sent" || data.sms === "partial";
      if (smsSent) {
        showDone(
          "상담 요청이 접수되었습니다.",
          "대표이사·사내이사에게 알림이 전달되었습니다. 확인 후 24시간 안에 연락드리겠습니다. 급하시면 아래 전화로 바로 연결하세요.",
          true
        );
      } else {
        showDone(
          "상담 내용이 준비되었습니다.",
          "아래 '메일로 보내기'를 누르시면 대표이사·사내이사 메일로 바로 발송됩니다. 전화(031-945-2001)로도 즉시 상담받으실 수 있습니다.",
          true
        );
      }
      form.reset();
      return;
    }

    var reason = data && data.message
      ? data.message
      : "자동 접수에 연결하지 못했습니다.";
    showErr(reason);
    showDone(
      "자동 접수에 연결하지 못했습니다.",
      "아래 ‘메일로 보내기’를 누르면 입력하신 내용이 메일로 준비됩니다. 전화(031-945-2001)로도 바로 상담받으실 수 있습니다.",
      false
    );
  });

  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
