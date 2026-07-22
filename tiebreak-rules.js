/* ═══════════════════════════════════════════════════════════════════
 *  tiebreak-rules.js — قواعد الحسم عند التعادل
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة التي يحلها:
 *    `isKnockout` لم تكن تُنسخ إلى حالة البث إطلاقاً، فكان الفحص
 *        st.isKnockout || (st.knockoutRoundId != null)
 *    يعطي false دائماً. النتيجة:
 *      • لا زر ركلات ترجيح في مباريات الإقصاء
 *      • لا وقت إضافي تلقائي عند التعادل
 *      • لا فرق إطلاقاً بين مباريات المجموعات والإقصاء
 *    (أُصلح الجذر في admin.js — هذا الملف يبني القواعد فوقه.)
 *
 *  القواعد المطبَّقة:
 *    مباريات المجموعات/الدوري:
 *      • لا أزرار وقت إضافي / ركلات ترجيح إطلاقاً
 *      • التعادل نتيجة نهائية مشروعة → تنتهي وتُسحب نقطة لكل فريق
 *    مباريات الإقصاء:
 *      • يُمنع الإنهاء عند التعادل منعاً باتاً — لازم فائز
 *      • المسار حسب إعدادات المنظّم:
 *          hasExtraTime=on  → وقت إضافي، ثم ركلات لو استمر التعادل
 *          hasExtraTime=off → ركلات مباشرة
 *          الاثنان off      → تحذير: لا سبيل للحسم (خطأ إعدادات)
 *
 *  يُحمَّل بعد admin.js و league-admin.html.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (window._liveMatches && window.lpEndMatch && window._getCfg) return fn();
    setTimeout(function () { ready(fn); }, 60);
  }

  /* ── هل هذه مباراة إقصاء؟ (المصدر الوحيد للحقيقة) ── */
  function isKO(st) {
    return !!(st && (st.isKnockout || st.knockoutRoundId != null));
  }
  window.lpIsKnockout = isKO;

  /* ── مسار الحسم المتاح حسب الإعدادات ── */
  function tieRoute(matchId) {
    var cfg = window._getCfg(matchId) || {};
    return {
      et:  cfg.hasExtraTime !== false,
      pen: cfg.hasPenalties !== false
    };
  }
  window.lpTieRoute = tieRoute;

  ready(function () {

    /* ══ حارس الإنهاء ══════════════════════════════════════════
       مباراة إقصاء متعادلة لا تنتهي أبداً — لازم فائز ينتقل في الشجرة. */
    var _origEnd = window.lpEndMatch;
    window.lpEndMatch = async function (matchId) {
      var st = window._liveMatches[matchId];
      if (!st) return;

      var drawn = (st.homeScore || 0) === (st.awayScore || 0);
      // ركلات الترجيح تحسم التعادل — نقرأ نتيجتها
      var penDecided = st.matchStatus === 'penalties' &&
                       (st.penHomeScore != null && st.penAwayScore != null) &&
                       st.penHomeScore !== st.penAwayScore;

      if (isKO(st) && drawn && !penDecided) {
        var r = tieRoute(matchId);

        if (!r.et && !r.pen) {
          window.showToast && window.showToast(
            '❌ مباراة إقصاء متعادلة ولا يوجد وقت إضافي ولا ركلات في الإعدادات — فعّل أحدهما', 'error');
          return;
        }

        var next = [];
        if (r.et && ['live', 'halftime'].indexOf(st.matchStatus) !== -1) next.push('الوقت الإضافي');
        if (r.pen) next.push('ركلات الترجيح');

        window.showToast && window.showToast(
          '❌ مباراة إقصاء لا تنتهي بالتعادل — لازم فائز عبر ' + next.join(' أو '), 'error');
        return;
      }

      return _origEnd.apply(this, arguments);
    };

    /* ══ حارس الوقت الإضافي ══════════════════════════════════ */
    ['lpStartET1', 'lpStartET2'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = async function (matchId) {
        var st = window._liveMatches[matchId];
        if (!st) return;
        if (!isKO(st)) {
          window.showToast && window.showToast(
            '❌ الوقت الإضافي لمباريات الإقصاء فقط — مباريات المجموعات تنتهي بالتعادل', 'error');
          return;
        }
        if (!tieRoute(matchId).et) {
          window.showToast && window.showToast(
            '❌ الوقت الإضافي معطّل في إعدادات البطولة', 'error');
          return;
        }
        return orig.apply(this, arguments);
      };
    });

    /* ══ حارس ركلات الترجيح ══════════════════════════════════ */
    var _origPen = window.lpStartPenalties;
    if (typeof _origPen === 'function') {
      window.lpStartPenalties = async function (matchId) {
        var st = window._liveMatches[matchId];
        if (!st) return;
        if (!isKO(st)) {
          window.showToast && window.showToast(
            '❌ ركلات الترجيح لمباريات الإقصاء فقط', 'error');
          return;
        }
        if (!tieRoute(matchId).pen) {
          window.showToast && window.showToast(
            '❌ ركلات الترجيح معطّلة في إعدادات البطولة', 'error');
          return;
        }
        if ((st.homeScore || 0) !== (st.awayScore || 0)) {
          window.showToast && window.showToast(
            '❌ ركلات الترجيح عند التعادل فقط', 'error');
          return;
        }
        return _origPen.apply(this, arguments);
      };
    }

    // console.log('[tiebreak-rules] ✅ قواعد الحسم مفعّلة');
  });
})();
