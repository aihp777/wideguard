/* =========================================================
   ㈜와이드가드 WIDE GUARD — app.js
   ========================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- header state ---------- */
  var hdr = document.getElementById("hdr");
  function onScroll() {
    if (!hdr) return;
    hdr.classList.toggle("is-solid", window.scrollY > 24);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile menu ---------- */
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");

  function setMenu(open) {
    if (!burger || !nav) return;
    nav.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    document.body.classList.toggle("nav-open", open);
  }

  if (burger) {
    burger.addEventListener("click", function () {
      setMenu(burger.getAttribute("aria-expanded") !== "true");
    });
  }
  if (nav) {
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setMenu(false);
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 900) setMenu(false);
  });

  /* ---------- reveal on scroll ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
    document.querySelectorAll("[data-count]").forEach(writeFinal);
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var group = el.parentElement ? Array.prototype.slice.call(el.parentElement.children) : [el];
        var i = group.indexOf(el);
        el.style.transitionDelay = (i > 0 ? Math.min(i, 5) * 70 : 0) + "ms";
        el.classList.add("in");
        el.querySelectorAll("[data-count]").forEach(countUp);
        io.unobserve(el);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });

    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- count up ---------- */
  function pad(el, value) {
    var p = el.getAttribute("data-pad");
    var s = String(value);
    if (!p) return s;
    while (s.length < Number(p)) s = "0" + s;
    return s;
  }
  function writeFinal(el) {
    el.textContent = pad(el, Number(el.getAttribute("data-count")));
  }
  function countUp(el) {
    var target = Number(el.getAttribute("data-count"));
    if (!target || isNaN(target)) return;
    var dur = 1100;
    var start = null;
    function step(now) {
      if (start === null) start = now;
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = pad(el, Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
      else writeFinal(el);
    }
    requestAnimationFrame(step);
  }

  /* ---------- 상담 폼: 접수 → 두 담당자 문자 알림 ---------- */
  var form = document.getElementById("inqForm");
  if (form) {
    var err = document.getElementById("formErr");
    var done = document.getElementById("formDone");
    var doneTitle = document.getElementById("formDoneTitle");
    var doneDesc = document.getElementById("formDoneDesc");
    var sendMail = document.getElementById("sendMail");
    var again = document.getElementById("formAgain");
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitLabel = submitBtn ? submitBtn.textContent : "상담 신청";
    var MOBILE = /^01[016789]\d{7,8}$/;

    function showErr(text) {
      if (err) {
        err.textContent = text;
        err.hidden = false;
      }
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

    if (again) {
      again.addEventListener("click", function () {
        form.classList.remove("is-done");
        if (done) done.hidden = true;
        setBusy(false);
        var first = form.querySelector("#f-name");
        if (first) first.focus();
      });
    }

    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      var nameEl = form.querySelector("#f-name");
      var telEl = form.querySelector("#f-tel");
      var typeEl = form.querySelector("#f-type");
      var msgEl = form.querySelector("#f-msg");
      var agreeEl = form.querySelector("#f-agree");
      var trapEl = form.querySelector("#f-web");

      var name = nameEl ? nameEl.value.trim() : "";
      var tel = telEl ? telEl.value.trim() : "";
      var type = typeEl ? typeEl.value : "";
      var msg = msgEl ? msgEl.value.trim() : "";
      var agree = !!(agreeEl && agreeEl.checked);
      var trap = trapEl ? trapEl.value : "";

      if (!name || !tel || !msg || !agree) {
        showErr("이름, 연락처, 문의 내용을 입력하고 동의에 체크해 주세요.");
        if (done) done.hidden = true;
        var firstEmpty = !name ? "#f-name" : !tel ? "#f-tel" : !msg ? "#f-msg" : "#f-agree";
        var target = form.querySelector(firstEmpty);
        if (target) target.focus();
        return;
      }

      var digits = tel.replace(/\D/g, "");
      if (!MOBILE.test(digits)) {
        showErr("연락처를 정확히 입력해 주세요. (예: 010-1234-5678)");
        if (done) done.hidden = true;
        if (telEl) telEl.focus();
        return;
      }

      hideErr();

      /* 메일 발송 대체 수단: 입력 내용 그대로 준비 */
      var subject = "[와이드가드] 상담 신청 - " + type + " / " + name;
      var body =
        "이름: " + name + "\n" +
        "연락처: " + tel + "\n" +
        "문의 분야: " + type + "\n\n" +
        "문의 내용:\n" + msg + "\n";
      if (sendMail) {
        sendMail.href = "mailto:dbeh1@naver.com,rokmc520331@naver.com" +
          "?subject=" + encodeURIComponent(subject) +
          "&body=" + encodeURIComponent(body);
      }

      setBusy(true);

      var res = null;
      var data = null;
      try {
        res = await fetch("/api/inquiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            tel: tel,
            type: type,
            msg: msg,
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
        var smsSent = data.sms === "sent";
        if (smsSent) {
          showDone(
            "상담 요청이 접수되었습니다.",
            "대표이사·사내이사에게 상담 요청 알림이 전달되었습니다. 확인 후 연락드리겠습니다.",
            true
          );
        } else {
          showDone(
            "상담 내용이 준비되었습니다.",
            "아래 '메일로 보내기'를 누르시면 대표이사·사내이사 메일로 바로 발송되며, 급하신 경우 전화(031-945-2001)로 즉시 연결됩니다.",
            true
          );
        }
        form.reset();
        return;
      }

      /* 실패: 서버 안내 문구가 있으면 그대로, 없으면 연결 실패 안내 */
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
  }

  /* ---------- 실적 탭 (주요실적 섹션) ---------- */
  var tablist = document.querySelector(".tabs");
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) {
      return document.getElementById(t.getAttribute("aria-controls"));
    });

    var selectTab = function (idx, moveFocus) {
      tabs.forEach(function (t, i) {
        var on = i === idx;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
      });
      if (moveFocus && tabs[idx]) tabs[idx].focus();
    };

    var startIdx = 0;
    tabs.forEach(function (t, i) {
      if (t.getAttribute("aria-selected") === "true") startIdx = i;
    });

    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { selectTab(i); });
      t.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next !== null) {
          e.preventDefault();
          selectTab(next, true);
        }
      });
    });

    selectTab(startIdx);
  }

  /* ---------- footer year ---------- */
  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
