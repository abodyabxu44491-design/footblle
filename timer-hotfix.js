/* ═══════════════════════════════════════════════════════════════════
 *  timer-hotfix.js — إصلاحات صفحة البث (FIX 2 / 3 / 6)
 *  ───────────────────────────────────────────────────────────────────
 *  يُحمَّل آخر شيء في league-admin.html — بعد admin.js و all-fixes.js
 *  والسكربت الداخلي، حتى لا تُدهس إصلاحاته.
 *
 *  يعالج فقط الدوال المربوطة بـ window (القابلة للاستبدال خارجياً).
 *  FIX 1 و 8 عُولجا داخل admin.js لأنهما استدعاءات محلية مباشرة.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ACTIVE = ['live', 'extratime1', 'extratime2'];

  function ready(fn) {
    if (window._liveMatches && window.TimerCore && window._lpSaveV2) return fn();
    setTimeout(function () { ready(fn); }, 60);
  }

  ready(function () {
    var TC = window.TimerCore;

    /* ══ FIX 9 ══════════════════════════════════════════════════
       معرّف جلسة فريد لكل تبويب أدمن. يُرفق بكل كتابة (في admin.js)
       ويُقارَن في الـ snapshot listener لكشف منظّم ثانٍ على نفس
       المباراة. لا يمنع الكتابة — لكنه ينهي التدمير الصامت. */
    if (!window._LP_SESSION) {
      window._LP_SESSION = 'lp_' + Math.random().toString(36).slice(2, 10) +
                           '_' + Date.now().toString(36);
      console.log('[timer-hotfix] session =', window._LP_SESSION);
    }

    /* نبني نسخة "غير متوقفة" لقراءة الثواني الحقيقية قبل التجميد */
    function liveSecs(st) {
      return TC.phaseSecs({
        matchStatus: st.matchStatus,
        currentHalf: st.currentHalf,
        timerPaused: false,
        phaseSeconds: st.phaseSeconds || 0,
        half1StartedAt: st.half1StartedAt,
        half2StartedAt: st.half2StartedAt,
        et1StartedAt: st.et1StartedAt,
        et2StartedAt: st.et2StartedAt
      });
    }

    /* ══ FIX 2 ══════════════════════════════════════════════════
       _lpAutoEndHalf كانت تضبط timerPaused=true بلا phaseSeconds.
       و TimerCore.phaseSecs تقرأ phaseSeconds فقط عند التوقف:
           if (d.timerPaused) return d.phaseSeconds || 0;
       فترجع undefined → 0 → الساعة تنهار إلى إزاحة الفترة:
       نهاية الشوط الثاني كانت تقفز من 90:00 إلى 45:00. */
    var _origAutoEnd = window._lpAutoEndHalf;
    if (typeof _origAutoEnd === 'function') {
      window._lpAutoEndHalf = function (matchId) {
        var st = window._liveMatches[matchId];
        if (st && !st.timerPaused) {
          st.phaseSeconds = liveSecs(st);      // ثبّت قبل أي تجميد
          st.timerSeconds = st.phaseSeconds;
        }
        var r = _origAutoEnd.apply(this, arguments);
        if (st && st.timerPaused && st.phaseSeconds == null) {
          st.phaseSeconds = st.timerSeconds || 0;   // شبكة أمان
        }
        try { window._lpSaveV2(matchId); } catch (e) {}
        return r;
      };
    }

    /* ══ FIX 3 ══════════════════════════════════════════════════
       admin.js:4186 يحرس بـ  if (!st.timerRunning && !st.timerPaused)
       لكن timerRunning لا تُسنَد في أي مكان في المشروع → undefined
       → الشرط true أثناء الجري → الـ snapshot listener يدهس نتيجة
       الأدمن وأحداثه في منتصف المباراة. نُحييه هنا. */
    setInterval(function () {
      var M = window._liveMatches || {};
      Object.keys(M).forEach(function (id) {
        var st = M[id];
        if (st) {
          st.timerRunning = ACTIVE.indexOf(st.matchStatus) !== -1 && !st.timerPaused;
        }
      });
    }, 400);

    /* ══ FIX 6 ══════════════════════════════════════════════════
       lpConfirmAddTime كانت تقبل 0 (الفحص  if (mins < 0) mins = 1
       يمرّر الصفر). ومع extraSet=true و extra=0 يصير cap=0
       → shouldAutoEnd عند +0:05 → الشوط ينتهي بعد خمس ثوانٍ. */
    var _origAdd = window.lpConfirmAddTime;
    if (typeof _origAdd === 'function') {
      window.lpConfirmAddTime = function (matchId) {
        var inp = document.getElementById('lp-at-mins-' + matchId);
        var v = parseInt((inp && inp.value) || '1', 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 30) v = 30;
        if (inp) inp.value = v;
        return _origAdd.call(this, matchId);
      };
    }

    /* ══ FIX 10 ═════════════════════════════════════════════════
       قفز الثواني: السبب ليس floor ولا تِك الـ500ms — قِسته فلم
       يُظهر أي تخطٍّ. السبب الحقيقي أن المتصفح يخنق setInterval في
       التبويب الخلفي (يصير 1000ms+ أو يتوقف)، فتظهر فجوة عند العودة.
       تسريع التِك يضاعف الرسم بلا فائدة. العلاج: أعِد الرسم فوراً عند
       العودة — الساعة تُحسب من الطابع الزمني فتصحّح نفسها لحظياً. */
    function repaintAll() {
      var M = window._liveMatches || {};
      Object.keys(M).forEach(function (id) {
        try { window._lpUpdateTimerDisplay(id); } catch (e) {}
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) repaintAll();
    });
    window.addEventListener('focus', repaintAll);
    window.addEventListener('pageshow', repaintAll);

    console.log('[timer-hotfix] ✅ FIX 2 (auto-end) · FIX 3 (timerRunning) · FIX 6 (extra=0) · FIX 9 (تعدد الأدمن) · FIX 10 (خنق التبويب)');
  });
})();
