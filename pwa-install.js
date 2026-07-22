// ═══════════════════════════════════════════════════════════════════
//  pwa-install.js — نظام تثبيت موحّد لكل واجهات منصة بطولات
//
//  المشكلة التي يحلّها هذا الملف:
//  1) كانت الثلاث واجهات (الجمهور/الإدارة/السوبر أدمن) تستخدم نفس
//     manifest.json بنفس start_url ثابت على صفحة الجمهور → أي تثبيت
//     من أي واجهة كان يفتح واجهة الجمهور دائماً.
//  2) صفحة الجمهور تحتاج ?id=<معرف البطولة> في الرابط وإلا تُظهر
//     "رابط غير صحيح" — والـ manifest الثابت ما كان يحمل هذا المعرف
//     أبداً، فكل تثبيت للجمهور كان يفشل بهذا الخطأ.
//  3) زر التثبيت كان ناقص فعلياً في صفحة السوبر أدمن، وغير موحّد
//     الشكل/السلوك بين الصفحات.
//
//  الحل:
//  - كل صفحة تستخدم manifest خاص فيها (manifest-viewer.json /
//    manifest-admin.json / manifest-superadmin.json) بهوية وأيقونة
//    ولون مختلف، بحيث يتثبّت تطبيق مستقل فعلاً حسب الصفحة.
//  - نولّد نسخة ديناميكية من الـ manifest في كل تحميل صفحة تحمل نفس
//    بارامترات الرابط الحالي (خصوصاً ?id= في صفحة الجمهور) حتى يفتح
//    التطبيق المثبَّت دائماً على نفس البطولة التي ثُبِّت منها.
//  - زر تثبيت ثابت واحد بنفس الشكل في الثلاث واجهات، يعمل صح على:
//    اندرويد/ديسktop كروم-إيدج (beforeinstallprompt) وآيفون/آيباد
//    سفاري (لا يدعم beforeinstallprompt → تعليمات إضافة للشاشة الرئيسية).
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var PAGE_CONFIG = {
    'league-viewer.html': {
      manifest: 'manifest-viewer.json',
      label: 'ثبّت التطبيق',
      color: '#C9A02B',
      colorDark: '#a5841f'
    },
    'league-admin.html': {
      manifest: 'manifest-admin.json',
      label: 'ثبّت لوحة الإدارة',
      color: '#2980B9',
      colorDark: '#1f6291'
    },
    'superadmin.html': {
      manifest: 'manifest-superadmin.json',
      label: 'ثبّت لوحة السوبر أدمن',
      color: '#8E44AD',
      colorDark: '#6c3688'
    }
  };

  var pageName = (location.pathname.split('/').pop() || 'league-viewer.html');
  var cfg = PAGE_CONFIG[pageName];
  if (!cfg) return; // صفحة غير معروفة (مثل index.html) — لا نضيف شيء

  // ── 1) حقن Manifest ديناميكي يحمل بارامترات الصفحة الحالية ──
  function injectManifest() {
    fetch(cfg.manifest, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (m) {
        var cur = new URLSearchParams(location.search);
        var startUrl = new URL(m.start_url, location.href);
        // نحافظ على أي بارامتر مهم موجود بالرابط الحالي (id, tab...)
        cur.forEach(function (val, key) {
          if (key !== 'source') startUrl.searchParams.set(key, val);
        });
        startUrl.searchParams.set('source', 'pwa');
        m.start_url = startUrl.pathname + startUrl.search;

        var blobUrl = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/json' }));
        var link = document.querySelector('link[rel="manifest"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'manifest';
          document.head.appendChild(link);
        }
        link.setAttribute('href', blobUrl);
      })
      .catch(function () { /* الرابط الأصلي بالـ HTML يبقى كخط رجوع */ });
  }
  injectManifest();

  // ── 2) كشف الجهاز والحالة ──
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                      navigator.standalone === true;

  if (isStandalone) return; // التطبيق مثبَّت ومفتوح من الشاشة الرئيسية بالفعل

  // ── 3) الستايل الموحّد (مستقل عن CSS كل صفحة) ──
  var style = document.createElement('style');
  style.textContent =
    '#pwaInstallBtn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));' +
    'z-index:99999;display:none;align-items:center;gap:8px;border:none;border-radius:30px;' +
    'padding:12px 18px;font-family:Tajawal,sans-serif;font-weight:700;font-size:14px;color:#fff;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.4);cursor:pointer;transition:transform .15s ease;' +
    'background:linear-gradient(135deg,' + cfg.color + ',' + cfg.colorDark + ');}' +
    '#pwaInstallBtn:active{transform:scale(.95)}' +
    '#pwaInstallBtn .pwa-ico{font-size:17px;line-height:1}' +
    '#pwaInstallModal{position:fixed;inset:0;z-index:100000;display:none;align-items:flex-end;' +
    'justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)}' +
    '#pwaInstallModal.show{display:flex}' +
    '#pwaInstallModal .pwa-sheet{width:100%;max-width:480px;background:#111;color:#f0f0f0;' +
    'border-radius:20px 20px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom,0px));' +
    'font-family:Tajawal,sans-serif;direction:rtl;box-shadow:0 -10px 40px rgba(0,0,0,.5);' +
    'animation:pwaSheetUp .25s ease}' +
    '@keyframes pwaSheetUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}' +
    '#pwaInstallModal .pwa-close{position:absolute;left:16px;top:14px;background:rgba(255,255,255,.08);' +
    'border:none;color:#ccc;width:30px;height:30px;border-radius:50%;font-size:15px;cursor:pointer}' +
    '#pwaInstallModal .pwa-title{font-weight:900;font-size:17px;margin:4px 30px 16px 0;color:' + cfg.color + '}' +
    '#pwaInstallModal .pwa-step{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);' +
    'border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:14px}' +
    '#pwaInstallModal .pwa-step b{color:' + cfg.color + '}' +
    '#pwaInstallModal .pwa-num{width:22px;height:22px;border-radius:50%;background:' + cfg.color + ';' +
    'color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;flex:none}';
  document.head.appendChild(style);

  // ── 4) الزر ──
  var btn = document.createElement('button');
  btn.id = 'pwaInstallBtn';
  btn.type = 'button';
  btn.innerHTML = '<span class="pwa-ico">📲</span><span>' + cfg.label + '</span>';

  // ── 5) نافذة تعليمات آيفون / المتصفحات غير الداعمة ──
  var modal = document.createElement('div');
  modal.id = 'pwaInstallModal';
  modal.innerHTML =
    '<div class="pwa-sheet">' +
      '<button class="pwa-close" id="pwaModalClose">✕</button>' +
      '<div class="pwa-title">' + cfg.label + '</div>' +
      '<div class="pwa-step"><span class="pwa-num">١</span><span>اضغط زر <b>المشاركة</b> ⬆️ من شريط المتصفح أسفل الشاشة (أو أعلاها بالكمبيوتر)</span></div>' +
      '<div class="pwa-step"><span class="pwa-num">٢</span><span>اختر <b>إضافة إلى الشاشة الرئيسية</b> — Add to Home Screen</span></div>' +
      '<div class="pwa-step"><span class="pwa-num">٣</span><span>اضغط <b>إضافة</b> للتأكيد، وسيظهر التطبيق بأيقونته الخاصة</span></div>' +
    '</div>';

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(modal);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('show'); });
  modal.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'pwaModalClose') modal.classList.remove('show');
  });

  // ── 6) منطق التثبيت ──
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    btn.style.display = 'flex'; // اندرويد/ديسktop: التثبيت المباشر متاح
  });

  window.addEventListener('appinstalled', function () {
    btn.style.display = 'none';
    deferredPrompt = null;
  });

  btn.addEventListener('click', function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        deferredPrompt = null;
        if (choice.outcome === 'accepted') btn.style.display = 'none';
      });
      return;
    }
    // لا يوجد beforeinstallprompt (آيفون/آيباد سفاري، أو متصفح لا يدعمه) → تعليمات يدوية
    modal.classList.add('show');
  });

  // آيفون/آيباد: لا يوجد beforeinstallprompt إطلاقاً، فنُظهر الزر مباشرة
  if (isIOS) {
    btn.style.display = 'flex';
  } else {
    // ديسktop/اندرويد: أظهر الزر بعد مهلة قصيرة حتى لو ما وصل beforeinstallprompt
    // (بعض المتصفحات لا تدعمه، فنعطي المستخدم تعليمات عامة بدل ما يختفي الزر تماماً)
    setTimeout(function () {
      if (btn.style.display !== 'flex') btn.style.display = 'flex';
    }, 3000);
  }
})();
