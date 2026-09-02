/* ════════════════════════════════════════════════════════════════════
 *  ↩︎ زرّ الرجوع في الجوال
 *  ──────────────────────────────────────────────────────────────────
 *  كانت ضغطة الرجوع تُخرج المستخدم من المنصة كاملةً: المنصة صفحة واحدة
 *  (SPA)، والتنقّل بين أقسامها وفتح نوافذها لا يُسجَّل في تاريخ المتصفح.
 *  فمن فتح بطاقة مباراة وضغط رجوع خرج من الموقع بدل أن يعود للقائمة —
 *  وهي أكثر ضغطة يفعلها مستخدم الجوال.
 *
 *  المبدأ: سجلّ داخلي موازٍ لتاريخ المتصفح. كل انتقال أو نافذة يُسجَّل
 *  مدخلاً يحمل **طريقة التراجع عنه**، والرجوع ينفّذ آخر مدخل فقط.
 *
 *  الملف لا يعدّل أي دالّة قائمة: يلتفّ حولها (wrapping) فيبقى سلوكها
 *  الأصلي كما هو، ويضيف التسجيل قبله. فإن تعطّل شيء هنا تبقى المنصة
 *  تعمل كما كانت.
 * ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window._backNavReady) return;
  window._backNavReady = true;

  var entries = [];        // [{ kind, undo }]
  var seq = 0;
  var muted = false;       // أثناء تنفيذ التراجع لا نُسجّل شيئاً
  /* 🔴 الإغلاق بالزرّ كان يستهلك مدخلين: يُسقط مدخله من السجلّ ثم ينادي
     `history.back()`، فيصل `popstate` ويُسقط المدخل الذي تحته أيضاً —
     فيرجع المستخدم قسماً كاملاً بدل إغلاق نافذة. هذا العلم يُبلع أول
     `popstate` ناتج عن استهلاكنا نحن. */
  var skipNext = false;

  function push(kind, undo) {
    if (muted) return;
    try {
      entries.push({ kind: kind, undo: undo, n: ++seq });
      history.pushState({ bn: seq }, '');
    } catch (e) { entries.pop(); }
  }

  window.addEventListener('popstate', function () {
    if (skipNext) { skipNext = false; return; }
    if (!entries.length) return;          // لا شيء لنا — دع المتصفح يخرج
    var e = entries.pop();
    muted = true;
    try { e.undo && e.undo(); } catch (err) { console.warn('[backNav]', err); }
    muted = false;
  });

  /* ── ١) التنقّل بين الأقسام ── */
  function wrapShowPage() {
    var orig = window.showPage;
    if (typeof orig !== 'function' || orig._bn) return false;
    var current = null;
    var g = function (name, sb, mn) {
      if (!muted && current && current !== name) {
        var prev = current;
        // التراجع = العودة للقسم السابق، بلا تسجيل جديد
        entries.push({ kind: 'page', undo: function () { g(prev, null, null); }, n: ++seq });
        try { history.pushState({ bn: seq }, ''); } catch (e) { entries.pop(); }
      }
      current = name;
      return orig.apply(this, arguments);
    };
    g._bn = true;
    window.showPage = g;
    return true;
  }

  /* ── ٢) النوافذ المنبثقة العامة ── */
  function wrapModals() {
    var oOpen = window.openModal, oClose = window.closeModal;
    if (typeof oOpen === 'function' && !oOpen._bn) {
      var go = function (id) {
        var r = oOpen.apply(this, arguments);
        // نُسجّل بعد الفتح: لو رفض الفتح لسبب ما لا نترك مدخلاً معلّقاً
        var el = document.getElementById(id);
        if (el && el.classList.contains('open')) {
          push('modal', function () {
            if (typeof window.closeModal === 'function') window.closeModal(id);
          });
        }
        return r;
      };
      go._bn = true; window.openModal = go;
    }
    if (typeof oClose === 'function' && !oClose._bn) {
      var gc = function (id) {
        /* الإغلاق بالزرّ يجب أن يستهلك مدخل التاريخ أيضاً، وإلا احتاج
           المستخدم ضغطتَي رجوع بعده لأن المدخل ما زال قائماً. */
        if (!muted) {
          var i = entries.length - 1;
          if (i >= 0 && entries[i].kind === 'modal') {
            entries.pop(); skipNext = true;
            try { history.back(); } catch (e) { skipNext = false; }
          }
        }
        return oClose.apply(this, arguments);
      };
      gc._bn = true; window.closeModal = gc;
    }
  }

  /* ── ٣) بطاقة المباراة في صفحة الجمهور ── */
  function wrapMatchDetail() {
    var oOpen = window.openMatchDetail, oClose = window.closeMatchDetail;
    if (typeof oOpen === 'function' && !oOpen._bn) {
      var go = function () {
        var r = oOpen.apply(this, arguments);
        push('detail', function () {
          if (typeof window.closeMatchDetail === 'function') window.closeMatchDetail();
        });
        return r;
      };
      go._bn = true; window.openMatchDetail = go;
    }
    if (typeof oClose === 'function' && !oClose._bn) {
      var gc = function () {
        if (!muted) {
          var i = entries.length - 1;
          if (i >= 0 && entries[i].kind === 'detail') {
            entries.pop(); skipNext = true;
            try { history.back(); } catch (e) { skipNext = false; }
          }
        }
        return oClose.apply(this, arguments);
      };
      gc._bn = true; window.closeMatchDetail = gc;
    }
  }

  /* ── ٤) الأوراق المنبثقة التي تُبنى وتُحذف من DOM ──
     (ورقة تبديل فريقين · لوحة الفحص · ورقة الحالة …) لا تمرّ عبر
     openModal، فنرصد ظهورها بمراقب DOM ونُسجّل لها مدخلاً. */
  var SHEETS = ['kswSheet', 'hcOverlay', 'hcSheet', 'mcv2-info-ov', 'mcv2-qr-ov', 'confirmDlgOv'];
  function watchSheets() {
    if (!window.MutationObserver) return;
    new MutationObserver(function (muts) {
      muts.forEach(function (mu) {
        Array.prototype.forEach.call(mu.addedNodes || [], function (n) {
          if (n.nodeType !== 1 || SHEETS.indexOf(n.id) === -1) return;
          var id = n.id;
          push('sheet', function () { document.getElementById(id)?.remove(); });
        });
      });
    }).observe(document.body, { childList: true });
  }

  /* التطبيق: الدوالّ تُعرَّف في وحدات تُحمَّل بعد هذا الملف، فنحاول مراراً
     قصيرة بدل افتراض جاهزيتها. */
  var tries = 0;
  (function attach() {
    wrapShowPage(); wrapModals(); wrapMatchDetail();
    if (++tries < 25) setTimeout(attach, 400);
  })();

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', watchSheets);
  else watchSheets();
})();
