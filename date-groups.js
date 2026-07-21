/* ═══════════════════════════════════════════════════════════════════
 *  date-groups.js — فواصل تواريخ المباريات
 *  ───────────────────────────────────────────────────────────────────
 *  يعطي كل مباراة عنوان فاصل بشري:
 *      اليوم · غداً · أمس  →  للأيام القريبة
 *      السبت · الأحد …     →  داخل الأسبوع القادم
 *      12 يوليو 2026       →  أبعد من ذلك
 *
 *  يُستخدم في صفحة الجمهور ولوحة الإدارة معاً — مصدر واحد
 *  حتى لا ينحرف التنسيق بينهما.
 *
 *  يُحمَّل قبل matches-tabs.js و admin-matches-tabs.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  /* منتصف ليل محلي — نتفادى فروق المناطق الزمنية */
  function midnight(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /* 'YYYY-MM-DD' → Date محلي (new Date('2026-07-12') يفسّرها UTC فتنزاح يوماً) */
  function parse(s) {
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      var d = new Date(s);
      return isNaN(d) ? null : d;
    }
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  /* فرق الأيام عن اليوم: 0=اليوم · 1=غداً · -1=أمس */
  function dayDiff(dateStr) {
    var d = parse(dateStr);
    if (!d) return null;
    return Math.round((midnight(d) - midnight(new Date())) / 86400000);
  }

  /* عنوان الفاصل */
  function label(dateStr) {
    var d = parse(dateStr);
    if (!d) return 'بدون تاريخ';
    var n = dayDiff(dateStr);

    if (n === 0)  return 'اليوم';
    if (n === 1)  return 'غداً';
    if (n === -1) return 'أمس';

    // داخل الأسبوع القادم/الماضي → اسم اليوم
    if (n > 1 && n <= 6)   return DAYS[d.getDay()];
    if (n < -1 && n >= -6) return DAYS[d.getDay()] + ' الماضي';

    // أبعد → التاريخ الكامل
    var y = d.getFullYear();
    var now = new Date().getFullYear();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + (y !== now ? ' ' + y : '');
  }

  /* وسم إضافي صغير — يميّز اليوم بصرياً */
  function tone(dateStr) {
    var n = dayDiff(dateStr);
    if (n === null) return '';
    if (n === 0) return 'today';
    if (n < 0)   return 'past';
    return 'future';
  }

  /* مفتاح ترتيب: التواريخ تصاعدياً · بلا تاريخ في الآخر */
  function sortKey(dateStr) {
    var d = parse(dateStr);
    return d ? midnight(d) : 8640000000000000;
  }

  window.DateGroups = {
    label: label, tone: tone, sortKey: sortKey,
    dayDiff: dayDiff, parse: parse, DAYS: DAYS, MONTHS: MONTHS
  };
})();
