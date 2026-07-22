// ═══════════════════════════════════════════════════════════════════
//  viewport-lock.js — تثبيت الشاشة ومنع التكبير/التصغير بكل الوسائل
//  ───────────────────────────────────────────────────────────────────
//  meta viewport (maximum-scale=1, user-scalable=no) يمنع التكبير على
//  أندرويد وأغلب المتصفحات، لكن آيفون/آيباد (سفاري) يتجاهله عمداً
//  لأسباب accessibility منذ iOS 10. لذا نضيف هنا 3 طبقات حماية إضافية
//  تغطي سفاري بالذات + الكمبيوتر/اللابتوب:
//   1) gesturestart/gesturechange — تكبير القرص بإصبعين (سفاري فقط)
//   2) touchmove بإصبعين — pinch-zoom بأي متصفح لمسي
//   3) دبل تاب السريع — دبل-تاب زوم بسفاري
//   4) Ctrl/⌘ + عجلة الفأرة، وCtrl/⌘ + (+/-/0) — زوم المتصفح بالكمبيوتر
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var style = document.createElement('style');
  style.textContent = 'html,body{touch-action:manipulation;-ms-touch-action:manipulation;}';
  document.head.appendChild(style);

  // 1) سحب-القرص بإصبعين (Safari trackpad/touch gesture events)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
    document.addEventListener(evt, function (e) { e.preventDefault(); }, { passive: false });
  });

  // 2) لمس بإصبعين (pinch) على أي متصفح لمسي
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // 3) دبل-تاب سريع (زوم سفاري التلقائي)
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // 4) زوم الكمبيوتر/اللابتوب: Ctrl/⌘ + عجلة الفأرة
  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false });

  // 5) زوم الكمبيوتر/اللابتوب: Ctrl/⌘ + (+ / - / 0)
  document.addEventListener('keydown', function (e) {
    var key = e.key;
    if ((e.ctrlKey || e.metaKey) && (key === '+' || key === '-' || key === '=' || key === '0')) {
      e.preventDefault();
    }
  }, { passive: false });
})();
