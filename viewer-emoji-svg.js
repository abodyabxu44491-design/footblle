/* ═══════════════════════════════════════════════════════════════════
 *  viewer-emoji-svg.js — تحويل تلقائي لكل إيموجي متبقٍّ إلى SVG
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة: النظام الحالي (window.Icon / data-ic) يغطي أماكن كثيرة،
 *  لكن عشرات الأماكن الأخرى (viewer.js وall-fixes.js) لا تزال تكتب
 *  الإيموجي كنص خام مباشرة داخل innerHTML أو textContent.
 *
 *  الحل: بدل تتبّع كل سطر يدوياً (مئات الأماكن، عرضة للأخطاء)،
 *  نفحص عقد النص الفعلية في الصفحة — عند التحميل وعند كل تحديث حي
 *  (Firestore realtime) — ونستبدل أي إيموجي معروف بأيقونة SVG من
 *  نفس نظام window.IconFromEmoji المستخدم أصلاً في المشروع.
 *
 *  لا يلمس <script>/<style>، ولا يعيد معالجة ما حوّله مسبقاً
 *  (بعد الاستبدال لا يبقى إيموجي في عقدة النص فيتوقف الفحص عندها).
 *
 *  يُحمَّل بعد كتلة تعريف الأيقونات (window.Icon) وقبل viewer.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // نطاقات اليونيكود التصويرية (إيموجي حقيقي) — لا تشمل الأسهم البسيطة
  // مثل → ← فهذه علامات ترقيم عادية وليست "إيموجي تعبيري".
  var EMOJI_CHAR =
    '\\u{1F1E6}-\\u{1F1FF}' +   // أعلام
    '\\u{1F300}-\\u{1FAFF}' +   // الرموز التصويرية الرئيسية
    '\\u{2600}-\\u{27BF}' +     // رموز متنوعة + dingbats
    '\\u{2B00}-\\u{2BFF}' +     // أسهم/نجوم ملوّنة
    '\\u{1F000}-\\u{1F0FF}' +   // ورق/دومينو (احتياط)
    '\\u{2300}-\\u{23FF}' +     // رموز تقنية متنوعة (⏰⏱⏸▶⏳ …) — تُعرض كإيموجي ملوّن
    '\\u{2100}-\\u{214F}';      // رموز شبيهة بالحروف (ℹ️ …)

  var EMOJI_BASE  = '[' + EMOJI_CHAR + ']';
  var EMOJI_TEST  = new RegExp('(?:' + EMOJI_BASE + '|\\u{FE0F})', 'u');
  // يلتقط رمزاً مفرداً أو تسلسل ZWJ كامل (مع علامات التنويع الاختيارية) ككتلة واحدة
  var EMOJI_SPLIT = new RegExp(
    '(' + EMOJI_BASE + '\\u{FE0F}?(?:\\u{200D}' + EMOJI_BASE + '\\u{FE0F}?)*' +
    '|[\\u{1F1E6}-\\u{1F1FF}]{2})', 'gu'
  );

  // ألوان دلالية — نحافظ على معنى الإيموجي الملوّن بدل تحويله للون النص الافتراضي
  var COLOR = {
    '🔴':'#D64541','🟥':'#D64541','🥉':'#B5732B',
    '🟢':'#2E9E5B','🟩':'#2E9E5B',
    '🟡':'#C9A02B','🟨':'#C9A02B','🥇':'#D4AF37',
    '🟠':'#C4761E','🟦':'#3B7DBF','🔵':'#3B7DBF',
    '🟣':'#9b59b6','🟪':'#9b59b6',
    '⚪':'#9BA3AD','⚫':'#4a4f57','🟫':'#8d6e63',
    '🥈':'#B9C0C8','🏆':'#C9A02B','⭐':'#C9A02B','🌟':'#C9A02B',
    '✅':'#2E9E5B','❌':'#D64541'
  };

  function svgFor(emoji) {
    if (!window.IconFromEmoji) return null;
    var color = COLOR[emoji] || null;
    return window.IconFromEmoji(emoji, 15, color);
  }

  function convertTextNode(node) {
    var txt = node.nodeValue;
    if (!txt || !EMOJI_TEST.test(txt)) return;
    EMOJI_SPLIT.lastIndex = 0;
    var parts = txt.split(EMOJI_SPLIT);
    if (parts.length < 2) return;

    var frag = document.createDocumentFragment();
    var didConvert = false;
    // String.split مع نمط فيه مجموعة التقاط يُرجع: [نص, إيموجي, نص, إيموجي, ...]
    // الفهارس الفردية هي دائماً الإيموجي الملتقط — لا حاجة لإعادة فحصه.
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      if (i % 2 === 1) {
        var svg = svgFor(part);
        if (svg) {
          var span = document.createElement('span');
          span.className = 'ic-inline';
          span.innerHTML = svg;
          frag.appendChild(span);
          didConvert = true;
          continue;
        }
      }
      frag.appendChild(document.createTextNode(part));
    }
    if (didConvert && node.parentNode) node.parentNode.replaceChild(frag, node);
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { convertTextNode(node); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG' || tag === 'TEXTAREA' || tag === 'INPUT') return;
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      walk(child);
      child = next;
    }
  }

  function boot() {
    walk(document.body);
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'characterData') {
          convertTextNode(m.target);
        } else if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window._emojiSweep = function () { walk(document.body); };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
