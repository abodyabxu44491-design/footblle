/* ═══════════════════════════════════════════════════════════════════
 *  league-logo.js — شعار البطولة واسمها (مصدر واحد)
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة التي يحلها:
 *    1) window.league لم تكن مُصدَّرة من admin.js، فـ cards-system.js
 *       يقرأ getLeague() = {} دائماً → اسم البطولة وشعارها مفقودان من
 *       كل البطاقات. (أُصلح الجذر في admin.js)
 *    2) قسم البطاقات كان فيه حقل «اسم البطولة» ورفع شعار منفصلان —
 *       فيضطر المنظّم لكتابة الاسم ورفع الشعار في كل مرة، وقد يختلفان
 *       عن إعدادات البطولة. حُذفا: الاسم والشعار يُقرآن من الإعدادات.
 *
 *  الشعار يُضغط إلى ≤256px ويُحفظ base64 في مستند البطولة (leagues/{id}.logo)
 *  فيقرأه الجمهور والبطاقات معاً بلا أي إعداد إضافي.
 *
 *  يُحمَّل بعد admin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX = 256;
  var LIMIT = 60000;   // حد آمن لحقل Firestore

  function toast(m, t) { window.showToast && window.showToast(m, t || 'success'); }

  /* ── ضغط الصورة — يمنع تضخّم المستند ── */
  function compress(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX)     { w = Math.round(w * MAX / h); h = MAX; }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        var out = c.toDataURL('image/webp', 0.85);
        if (out.length > LIMIT || out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/png');
        if (out.length > LIMIT) out = c.toDataURL('image/jpeg', 0.8);
        cb(out.length > LIMIT ? null : out);
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function paint(data) {
    var prev = document.getElementById('setLogoPrev');
    var del  = document.getElementById('setLogoDel');
    if (prev) {
      prev.innerHTML = data
        ? '<img src="' + data + '" style="width:100%;height:100%;object-fit:contain"/>'
        : '🏆';
    }
    if (del) del.style.display = data ? 'block' : 'none';
  }

  /* ── رفع الشعار ── */
  window.lgHandleLogo = function (input) {
    var f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('❌ اختر ملف صورة', 'error'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('❌ الصورة أكبر من 5MB', 'error'); return; }

    compress(f, function (data) {
      if (!data) { toast('❌ تعذّر ضغط الصورة — جرّب صورة أصغر', 'error'); return; }
      if (!window._lgSave) { toast('❌ النظام غير جاهز — أعد التحميل', 'error'); return; }
      paint(data);
      window._lgSave(data).then(function () {
        if (window.league) window.league.logo = data;
        toast('✅ تم حفظ شعار البطولة — سيظهر في البطاقات والجمهور');
        if (typeof window.renderCardsPage === 'function') {
          try { window.renderCardsPage(); } catch (e) {}
        }
      }).catch(function (e) {
        toast('❌ فشل الحفظ: ' + e.message, 'error');
      });
    });
    input.value = '';
  };

  /* ── حذف الشعار ── */
  window.lgClearLogo = function () {
    if (!window._lgSave) return;
    paint(null);
    window._lgSave('').then(function () {
      if (window.league) window.league.logo = '';
      toast('🗑 تم حذف الشعار');
      if (typeof window.renderCardsPage === 'function') {
        try { window.renderCardsPage(); } catch (e) {}
      }
    });
  };

  /* ── تعبئة المعاينة عند فتح الإعدادات ── */
  window.lgRefreshPreview = function () {
    paint((window.league && window.league.logo) || null);
  };

  // حاول التعبئة أول ما تجهز بيانات البطولة
  (function wait() {
    if (window.league) { window.lgRefreshPreview(); return; }
    setTimeout(wait, 300);
  })();

  console.log('[league-logo] ✅ جاهز');
})();
