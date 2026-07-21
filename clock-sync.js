/* ═══════════════════════════════════════════════════════════════════
 *  clock-sync.js — مزامنة ساعة الخادم (FIX 4)
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة:
 *    كل أختام البدء تُكتب بـ Date.now() من جهاز الأدمن، وتُقرأ بـ
 *    Date.now() من جهاز المشاهد. أي انحراف في ساعة أحد الجهازين
 *    (شائع جداً: دقيقة أو أكثر) يزيح ساعة المشاهد للأبد، ويجعله
 *    يدخل بدل الضائع قبل/بعد الأدمن، ولا يشفى أبداً.
 *
 *  الحل:
 *    نقيس فرق ساعة الخادم عبر رأس HTTP Date (بلا أي كتابة، بلا
 *    صلاحيات، يعمل على صفحة الجمهور المجهول تماماً)، ثم نمرّره
 *    إلى TimerCore.setSkew فتُصحَّح كل الحسابات مركزياً.
 *
 *  الدقة: ±1 ثانية (رأس Date بدقة ثانية) — أكثر من كافٍ هنا،
 *    والبديل السابق كان انحرافاً غير محدود.
 *
 *  يُحمَّل قبل أي شيء يعرض وقتاً. آمن لو فشل: يبقى skew=0.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SAMPLES = 3;

  function probe() {
    var t0 = Date.now();
    // no-store يمنع الكاش من إعطائنا رأس Date قديماً
    return fetch(location.href, { method: 'HEAD', cache: 'no-store' })
      .then(function (res) {
        var t1  = Date.now();
        var hdr = res.headers.get('date');
        if (!hdr) return null;
        var srv = new Date(hdr).getTime();
        if (isNaN(srv)) return null;
        var rtt = t1 - t0;
        // نقدّر لحظة الخادم عند منتصف الرحلة
        return { skew: srv - (t0 + rtt / 2), rtt: rtt };
      })
      .catch(function () { return null; });
  }

  function apply() {
    var runs = [];
    var chain = Promise.resolve();
    for (var i = 0; i < SAMPLES; i++) {
      chain = chain.then(function () {
        return probe().then(function (r) { if (r) runs.push(r); });
      });
    }
    return chain.then(function () {
      if (!runs.length || !window.TimerCore || !window.TimerCore.setSkew) return;
      // اختر العيّنة ذات أقل زمن رحلة — الأدق
      runs.sort(function (a, b) { return a.rtt - b.rtt; });
      var best = runs[0];
      // تجاهل الانحراف التافه (<2s) — رأس Date دقته ثانية
      var skew = Math.abs(best.skew) < 2000 ? 0 : best.skew;
      window.TimerCore.setSkew(skew);
      console.log('[clock-sync] skew =', Math.round(skew) + 'ms',
                  '| rtt =', Math.round(best.rtt) + 'ms');
    });
  }

  function boot() {
    if (!window.TimerCore) { setTimeout(boot, 100); return; }
    apply();
    // أعِد القياس كل 10 دقائق ولّما ترجع الصفحة للواجهة
    setInterval(apply, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) apply();
    });

    /* ── FIX 10 (جانب الجمهور) ──
     * المتصفح يخنق setInterval في التبويب الخلفي، فتظهر فجوة في
     * الساعة عند العودة. عدّادات viewer.js تقرأ الحالة الحيّة كل تِك،
     * فنعيد رسم عناصر الساعة مباشرة من نفس المصدر لحظة الرجوع. */
    function repaint() {
      if (!window._clockRepaint) return;
      try { window._clockRepaint(); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) repaint();
    });
    window.addEventListener('pageshow', repaint);
  }

  boot();
})();
