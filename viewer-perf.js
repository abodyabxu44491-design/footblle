/* ═══════════════════════════════════════════════════════════════════
 *  viewer-perf.js — أداء الجمهور على الجوال البطيء
 *  ───────────────────────────────────────────────────────────────────
 *  ما يعالجه:
 *
 *  ① renderAll ثقيلة وتُستدعى بكثرة
 *     11 دالة رسم كاملة (ترتيب · هدافون · شجرة · مباريات · رسم بياني)
 *     تعمل عند كل تحديث من Firestore. والأدمن يحفظ كل 15 ثانية أثناء
 *     البث، فتصير 4 إعادة رسم كاملة/دقيقة لكل مشاهد.
 *     الحل: debounce عبر requestAnimationFrame — تُدمج الاستدعاءات
 *     المتلاحقة في رسمة واحدة عند إطار العرض التالي.
 *
 *  ② الرسم والتبويب مخفي = هدر خالص
 *     الجوال في الجيب يستمر بالرسم واستهلاك البطارية.
 *     الحل: تخطّي الرسم عند الإخفاء + رسمة واحدة عند العودة.
 *
 *  ③ الصور بلا lazy loading
 *     شعارات الفرق تُحمَّل كلها فوراً حتى غير الظاهرة.
 *     الحل: loading="lazy" + decoding="async" تلقائياً.
 *
 *  لا يغيّر أي منطق — فقط توقيت الرسم.
 *  يُحمَّل بعد viewer.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var pending = false;   // رسمة مجدولة؟
  var missed  = false;   // فاتنا رسم بسبب الإخفاء؟
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

  function hook() {
    if (typeof window.renderAll !== 'function') { setTimeout(hook, 80); return; }

    var real = window.renderAll;

    /* ── الرسم المُدمَج ── */
    function flush() {
      pending = false;
      if (document.hidden) { missed = true; return; }
      try { real(); } catch (e) { console.error('[perf] render:', e); }
    }

    window.renderAll = function () {
      if (document.hidden) { missed = true; return; }   // ② لا رسم في الخلفية
      if (pending) return;                              // ① ادمج المتلاحقة
      pending = true;
      raf(flush);
    };

    /* ارسم فوراً عند العودة للواجهة */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && missed) {
        missed = false;
        window.renderAll();
      }
    });

    // احتفظ بمنفذ للرسم الفوري عند الحاجة
    window._renderNow = real;

    console.log('[viewer-perf] الرسم مُدمَج ومتوقّف في الخلفية');
  }
  hook();

  /* ── ③ الصور: lazy + async decode ── */
  function lazify(root) {
    var imgs = (root || document).querySelectorAll('img:not([loading])');
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].setAttribute('loading', 'lazy');
      imgs[i].setAttribute('decoding', 'async');
    }
  }

  if (document.readyState !== 'loading') lazify();
  else document.addEventListener('DOMContentLoaded', function () { lazify(); });

  /* راقب الحقن الديناميكي — بطاقات المباريات تُبنى بـ innerHTML */
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) lazify(added[j]);
      }
    }
  });
  if (document.body) {
    mo.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      mo.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
