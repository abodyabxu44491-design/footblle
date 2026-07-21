/* ═══════════════════════════════════════════════════════════════════
 *  lock-guard.js — منع الكتابة عند قفل البطولة
 *  ───────────────────────────────────────────────────────────────────
 *  الدفاع الحقيقي في firestore.rules (canManage يفحص status=='active').
 *  هذه طبقة ثانية على الواجهة — تمنع المحاولة أصلاً وتعطي رسالة
 *  مفهومة بدل «permission-denied» غامضة.
 *
 *  لماذا الطبقتان:
 *    القواعد وحدها تحمي البيانات، لكن المنظّم يرى أخطاء غير مفهومة.
 *    الواجهة وحدها لا تحمي شيئاً (تُحذف من DevTools).
 *    معاً: حماية حقيقية + تجربة واضحة.
 *
 *  يُحمَّل بعد admin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* الدوال التي تعدّل البيانات — كلها window.* فنغلّفها من الخارج */
  var GUARDED = {
    addMatch:        'لا يمكن إضافة مباريات',
    addTeam:         'لا يمكن إضافة فرق',
    deleteTeam:      'لا يمكن حذف فرق',
    deleteMatch:     'لا يمكن حذف مباريات',
    saveSettings:    'لا يمكن حفظ الإعدادات',
    lpStartMatch:    'لا يمكن بدء المباريات',
    lpEndMatch:      'لا يمكن إنهاء المباريات',
    lpStartPenalties:'لا يمكن تسجيل ركلات الترجيح',
    lpStartET1:      'لا يمكن بدء الوقت الإضافي',
    adminAddGroup:   'لا يمكن إضافة مجموعات',
    adminDeleteGroup:'لا يمكن حذف مجموعات',
    clearAllMatches: 'لا يمكن حذف المباريات',
    dndGenerateAllGroupMatches: 'لا يمكن توليد المباريات',
    dndGenGroupMatches: 'لا يمكن توليد المباريات',
    publishPendingMatches: 'لا يمكن نشر المباريات'
  };

  function wrap() {
    var n = 0;
    Object.keys(GUARDED).forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function' || orig._guarded) return;
      var msg = GUARDED[fn];
      var g = function () {
        if (window._LEAGUE_LOCKED) {
          if (window.showToast) {
            window.showToast('البطولة مقفلة — ' + msg + '. تواصل مع المسؤول', 'error');
          }
          return;
        }
        return orig.apply(this, arguments);
      };
      g._guarded = true;
      window[fn] = g;
      n++;
    });
    return n;
  }

  /* بعض الملفات (tiebreak-rules) تغلّف نفس الدوال بتأخير، فقد يختفي
     حارسنا تحت غلافها. نعيد المحاولة بضع مرات ثم نتوقف — والعلم
     _guarded يمنع التغليف المزدوج على نفس النسخة.
     ملاحظة: حتى لو التفّ غلاف آخر حولنا، الحارس يظل يعمل (اختُبر). */
  var tries = 0;
  (function attempt() {
    wrap();
    if (++tries < 8) { setTimeout(attempt, 400); return; }
    console.log('[lock-guard] حارس القفل مفعّل');
  })();
})();
