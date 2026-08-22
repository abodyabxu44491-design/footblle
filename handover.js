/* ═══════════════════════════════════════════════════════════════════
 *  handover.js — تسليم البطولة للمنظّم
 *  ───────────────────────────────────────────────────────────────────
 *  التحديثات في هذه النسخة:
 *    1) تصميم صفحة التسليم بالكامل بأيقونات SVG بدل الإيموجي — بعض
 *       الأجهزة/المتصفحات (خصوصاً متصفح واتساب الداخلي) لا تعرض
 *       إيموجيات معيّنة فتظهر كمربّعات فارغة تُفسَد معها الصفحة.
 *       الآن كل شيء أيقونات مرسومة تعمل على أي جهاز 100%.
 *    2) خانة "كلمة المرور" أصبحت حقيقية: مخفية بنقاط افتراضياً +
 *       زر عين لإظهارها + زر نسخ منفصل — بدل عرضها نصاً صريحاً دائماً.
 *    3) عند «إرسال واتساب» لم يعد الرقم مربوطاً إجبارياً برقم صاحب
 *       الدوري المسجَّل. تظهر نافذة صغيرة أنيقة تتيح: استخدام رقم
 *       صاحب الدوري (باختيارك)، كتابة أي رقم آخر تحدده بنفسك، أو
 *       الإرسال بدون رقم لتختار جهة الاتصال من داخل واتساب مباشرة.
 *
 *  يُحمَّل بعد superadmin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── أيقونات SVG (بدل الإيموجي — عرض موثوق على كل الأجهزة) ── */
  var ICON = {
    trophy: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a1 1 0 0 0-1 1c0 2.5 1.6 4.3 4 4.8M17 5h3a1 1 0 0 1 1 1c0 2.5-1.6 4.3-4 4.8"/></svg>',
    broadcast: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2M7.8 16.2C5.5 13.9 5.5 10.1 7.8 7.8M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4M12 12v.01"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H8a5 5 0 1 1 1.3-9.8 4.5 4.5 0 0 1 8.6 1.9A3.5 3.5 0 0 1 17.5 19z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A11 11 0 0 1 12 19c-7 0-11-7-11-7a20.6 20.6 0 0 1 4.2-5.2M9.9 4.2A9.8 9.8 0 0 1 12 4c7 0 11 7 11 7a20.7 20.7 0 0 1-2.6 3.6M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a1.8 1.8 0 0 0 1.6 2.7h17.2a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    external: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>',
    eyeLine: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    cam: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 0 0 4.75 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.16c-.24.68-1.4 1.31-1.93 1.36-.5.05-1.02.3-3.4-.71-2.87-1.22-4.72-4.1-4.86-4.29-.14-.19-1.16-1.55-1.16-2.95s.73-2.09 1-2.38c.24-.26.54-.33.72-.33.19 0 .37 0 .53.01.17.01.4-.06.62.48.24.58.81 2.01.88 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.28.71 1.18 1.53 1.92 1.05.95 1.94 1.24 2.22 1.38.28.14.44.12.6-.07.16-.19.68-.8.87-1.07.19-.28.37-.23.62-.14.26.09 1.63.77 1.91.91.28.14.47.21.53.33.07.12.07.68-.17 1.36z"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.5 12.5L20 3M17 6l3 3M14 9l2.5 2.5"/></svg>'
  };

  function maskPass(p) {
    var n = Math.max(String(p || '').length, 6);
    return Array(Math.min(n, 14) + 1).join('•');
  }

  /* ── بناء صفحة التسليم ── */
  function buildPage(d) {
    var TYPE = { league: 'دوري نقاط', groups: 'مجموعات + خروج مغلوب', knockout: 'خروج مغلوب' };
    var typeTxt = TYPE[d.type] || 'بطولة';

    var row = function (label, value, opts) {
      opts = opts || {};
      if (!value) return '';
      var id = 'f' + Math.random().toString(36).slice(2, 9);
      var isPass = !!opts.pass;
      var displayVal = isPass ? maskPass(value) : value;
      var btns = '';
      if (isPass) {
        btns += '<button class="ic-btn eye-btn" data-real="' + esc(value).replace(/"/g, '&quot;') + '" data-masked="' + esc(displayVal) + '" onclick="togglePass(this,\'' + id + '\')" aria-label="إظهار كلمة المرور">' + ICON.eye + '</button>';
      }
      if (opts.copyable) {
        btns += '<button class="ic-btn cp" onclick="cp(this,\'' + esc(value).replace(/'/g, "\\'") + '\')" aria-label="نسخ">' + ICON.copy + '</button>';
      }
      /* ✅ إصلاح: عند الطباعة/حفظ PDF كانت الصفحة تلتقط نفس حالة
         الإخفاء المعروضة على الشاشة — فإذا لم يضغط المرسِل زر «العين»
         قبل الطباعة، يخرج الملف بنقاط (••••••) بدل كلمة المرور الحقيقية
         ويصبح عديم الفائدة. الحل: عنصر إضافي مخفي على الشاشة يحمل
         القيمة الحقيقية دوماً، ويُظهره الطباعة فقط عبر media print —
         بغض النظر عن حالة الزر إطلاقاً. */
      var valueHtml = isPass
        ? '<span class="pass-scr">' + esc(displayVal) + '</span><span class="pass-prn">' + esc(value) + '</span>'
        : esc(displayVal);
      return '<div class="row' + (isPass ? ' row-pass' : '') + '">' +
        '<div class="row-l">' + esc(label) + '</div>' +
        '<div class="row-v"' + (opts.dir ? ' dir="ltr"' : '') + ' id="' + id + '">' + valueHtml + '</div>' +
        (btns ? '<div class="row-b">' + btns + '</div>' : '') +
      '</div>';
    };

    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>تسليم ' + esc(d.name) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet"/>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Tajawal,-apple-system,"Segoe UI",Arial,sans-serif;background:#0a0b0e;background-image:radial-gradient(circle at 50% -10%,#231c0c,#0a0b0e 55%);color:#f3f4f6;padding:28px 14px 40px;line-height:1.6;min-height:100vh}' +
    '.wrap{max-width:640px;margin:0 auto}' +
    '.card{background:#14161c;border:1px solid #262a34;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55)}' +
    '.hd{background:linear-gradient(160deg,rgba(201,160,43,.24),rgba(201,160,43,.03) 60%);padding:38px 24px 30px;text-align:center;border-bottom:1px solid #262a34;position:relative;overflow:hidden}' +
    '.hd::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 0%,rgba(201,160,43,.22),transparent 65%);pointer-events:none}' +
    '.hd::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,160,43,.5),transparent)}' +
    '.hd>*{position:relative}' +
    '.badge-top{display:inline-flex;align-items:center;gap:7px;background:rgba(46,204,113,.12);border:1px solid rgba(46,204,113,.35);color:#2ecc71;border-radius:999px;padding:6px 15px 6px 12px;font-size:10.5px;font-weight:900;margin-bottom:18px}' +
    '.badge-top i{width:7px;height:7px;border-radius:50%;background:#2ecc71;box-shadow:0 0 8px #2ecc71;display:inline-block}' +
    '.trust{display:flex;justify-content:center;gap:18px;margin-top:20px;flex-wrap:wrap}' +
    '.trust div{font-size:10.5px;color:#9aa0ae;display:flex;align-items:center;gap:5px;font-weight:500}' +
    '.trust svg{color:#C9A02B;flex-shrink:0}' +
    '.lg{width:92px;height:92px;margin:0 auto 18px;border-radius:24px;background:linear-gradient(160deg,#1c1f28,#101217);border:1px solid #33291090;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 12px 32px rgba(201,160,43,.22), inset 0 1px 0 rgba(255,255,255,.04)}' +
    '.lg img{width:100%;height:100%;object-fit:contain;padding:10px}' +
    '.lg svg{color:#C9A02B}' +
    'h1{font-size:24px;font-weight:900;color:#F0C84A;margin-bottom:7px;letter-spacing:-.2px}' +
    '.sub{font-size:12.5px;color:#8b90a0;font-weight:500}' +
    '.bd{padding:24px 22px 20px}' +
    '.sec{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:900;color:#C9A02B;letter-spacing:.6px;margin:24px 0 11px;padding-right:10px;border-right:3px solid #C9A02B}' +
    '.sec:first-child{margin-top:0}' +
    '.row{display:flex;align-items:center;gap:10px;background:#191c23;border:1px solid #262a34;border-radius:12px;padding:12px 14px;margin-bottom:8px;transition:border-color .2s}' +
    '.row-pass{border-color:#3a3320;background:#1c1a12}' +
    '.row-l{font-size:11px;color:#8b90a0;min-width:74px;flex-shrink:0;font-weight:500}' +
    '.row-v{flex:1;font-size:13.5px;font-weight:700;word-break:break-all;min-width:0;color:#f3f4f6;letter-spacing:.2px}' +
    '.pass-prn{display:none}' +
    '.row-b{display:flex;gap:6px;flex-shrink:0}' +
    '.ic-btn{background:rgba(201,160,43,.12);border:1px solid rgba(201,160,43,.3);color:#C9A02B;border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}' +
    '.ic-btn:active{transform:scale(.92)}' +
    '.ic-btn.done{background:rgba(46,204,113,.16);border-color:rgba(46,204,113,.4);color:#2ecc71}' +
    '.ic-btn.eye-btn.open{background:rgba(240,155,143,.12);border-color:rgba(240,155,143,.3);color:#ff9b8f}' +
    '.btn{display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;text-decoration:none;border-radius:13px;padding:14px;font-size:14px;font-weight:900;margin-bottom:9px;font-family:Tajawal,sans-serif;border:none;cursor:pointer;width:100%}' +
    '.b1{background:linear-gradient(135deg,#F0C84A,#C9A02B);color:#14110a;box-shadow:0 10px 26px rgba(201,160,43,.28)}' +
    '.b2{background:rgba(255,255,255,.05);border:1px solid #2c313d;color:#eee}' +
    '.b3{background:#141000;border:1px solid #6B4E00;color:#C9A02B}' +
    '.warn{display:flex;gap:10px;align-items:flex-start;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.25);border-radius:13px;padding:14px 15px;margin-top:18px;font-size:11.5px;color:#ff9b8f;line-height:1.8}' +
    '.warn svg{flex-shrink:0;margin-top:2px}' +
    '.steps{counter-reset:s;list-style:none}' +
    '.steps li{counter-increment:s;position:relative;padding:10px 36px 10px 0;font-size:12.5px;color:#c8ccd6;border-bottom:1px solid #1e222a}' +
    '.steps li:last-child{border:0}' +
    '.steps li::before{content:counter(s);position:absolute;right:0;top:9px;width:23px;height:23px;background:rgba(201,160,43,.14);border:1px solid rgba(201,160,43,.3);color:#C9A02B;border-radius:50%;font-size:10.5px;font-weight:900;display:flex;align-items:center;justify-content:center}' +
    '.ft{text-align:center;padding:18px;font-size:10.5px;color:#5a5f6b;border-top:1px solid #262a34;line-height:1.8}' +
    '.ft b{color:#8b90a0}' +
    '.pbtn{margin-top:14px}' +
    '@media print{body{background:#fff;color:#000;padding:0}.card{border:1px solid #ddd;box-shadow:none}' +
    '.hd{background:#f7f7f7}h1{color:#8a6d1d}.row{background:#fafafa;border-color:#e5e5e5}.row-pass{background:#fdf9ee}' +
    '.row-v{color:#000}.sec{color:#8a6d1d;border-color:#8a6d1d}.row-b,.noprint{display:none!important}' +
    '.pass-scr{display:none!important}.pass-prn{display:inline!important}' +
    '.steps li{color:#333;border-color:#eee}.warn{background:#fff5f4;color:#8a2018}}' +
    '</style></head><body><div class="wrap"><div class="card">' +

    '<div class="hd">' +
      '<div class="badge-top"><i></i> بطولة مُفعّلة وجاهزة</div>' +
      '<div class="lg">' + (d.logo ? '<img src="' + esc(d.logo) + '" alt=""/>' : ICON.trophy) + '</div>' +
      '<h1>' + esc(d.name) + '</h1>' +
      '<div class="sub">' + esc(typeTxt) + ' &middot; موسم ' + esc(d.season || '2025') + '</div>' +
      '<div class="trust"><div>' + ICON.broadcast + ' بث مباشر</div><div>' + ICON.cloud + ' نسخ احتياطي</div><div>' + ICON.lock + ' آمن ومشفّر</div></div>' +
    '</div>' +

    '<div class="bd">' +
      '<div class="sec">بيانات المنظّم</div>' +
      row('الاسم', d.owner) +
      row('الواتساب', d.phone, { dir: true }) +

      '<div class="sec">الدخول للوحة الإدارة</div>' +
      row('البريد', d.email, { dir: true, copyable: true }) +
      row('كلمة المرور', d.pass, { dir: true, pass: true }) +

      '<div class="sec">الروابط</div>' +
      row('الجمهور', d.viewerUrl, { dir: true, copyable: true }) +
      row('الإدارة', d.adminUrl, { dir: true, copyable: true }) +
      row('استوديو البثّ', d.broadcastUrl, { dir: true, copyable: true }) +

      '<div class="sec noprint">فتح مباشر</div>' +
      '<a class="btn b1 noprint" href="' + esc(d.adminUrl) + '" target="_blank">' + ICON.external + ' فتح لوحة الإدارة</a>' +
      '<a class="btn b2 noprint" href="' + esc(d.viewerUrl) + '" target="_blank">' + ICON.eyeLine + ' معاينة صفحة الجمهور</a>' +
      '<a class="btn b3 noprint" href="' + esc(d.broadcastUrl) + '" target="_blank">' + ICON.cam + ' فتح استوديو البثّ</a>' +

      '<div class="sec">خطوات البداية</div>' +
      '<ol class="steps">' +
        '<li>افتح لوحة الإدارة وسجّل الدخول بالبريد وكلمة المرور أعلاه</li>' +
        '<li>أكمل معالج إعداد البطولة (يظهر تلقائياً أول مرة)</li>' +
        '<li>أضف الفرق المشاركة' + (d.type !== 'league' ? ' ثم وزّعها على المجموعات' : '') + '</li>' +
        '<li>ستتولّد المباريات تلقائياً بالجولات مرتّبة</li>' +
        '<li>شارك رابط الجمهور مع الجميع لمتابعة البث المباشر</li>' +
      '</ol>' +

      '<div class="warn">' + ICON.warn +
        '<div><b>تنبيه أمني:</b> غيّر كلمة المرور بعد أول دخول من الإعدادات. ' +
        'لا تشارك بيانات الدخول مع أحد — من يملكها يتحكم بالبطولة كاملة.</div>' +
      '</div>' +
    '</div>' +

    '<div class="ft">منصة بطولات — نظام إدارة بطولات متكامل<br><b>تطوير وبرمجة عبدالله السكني</b> &middot; ' + new Date().toLocaleDateString('ar') + '</div>' +
    '</div>' +
    '<button class="btn b2 noprint pbtn" onclick="window.print()">' + ICON.external + ' طباعة / حفظ PDF</button>' +
    '</div>' +
    '<script>' +
    'function cp(b,t){navigator.clipboard.writeText(t).then(function(){' +
    'var o=b.innerHTML;b.innerHTML=' + JSON.stringify(ICON.check) + ';b.classList.add("done");' +
    'setTimeout(function(){b.innerHTML=o;b.classList.remove("done")},1400)})}' +
    'function togglePass(b,id){' +
    'var wrap=document.getElementById(id);var el=wrap.querySelector(".pass-scr");' +
    'var real=b.getAttribute("data-real");var masked=b.getAttribute("data-masked");' +
    'var open=b.classList.toggle("open");' +
    'el.textContent=open?real:masked;' +
    'b.innerHTML=open?' + JSON.stringify(ICON.eyeOff) + ':' + JSON.stringify(ICON.eye) + ';' +
    '}' +
    '<\/script>' +
    '</body></html>';
  }

  /* ── جمع البيانات ── */
  function collect(over) {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    var slug = (over && over.id) || g('nl_slug') || 'league';
    var base = window.SITE_URL || (location.origin + location.pathname.replace(/\/[^/]*$/, '/'));
    var d = {
      name:   (over && over.name)  || g('nl_name')  || 'البطولة',
      owner:  (over && over.owner) || g('nl_owner') || '',
      phone:  (over && over.phone) || g('nl_phone') || '',
      email:  (over && over.email) || g('nl_email') || '',
      pass:   (over && over.pass)  || g('nl_pass')  || '',
      season: (over && over.season) || g('nl_season') || '2025',
      type:   (over && over.type)  || window._nlType || 'league',
      logo:   (over && over.logo)  || '',
      viewerUrl: base + 'league-viewer.html?id=' + slug,
      adminUrl:  base + 'league-admin.html?id='  + slug,
      broadcastUrl: base + 'broadcaster.html?league=' + slug
    };
    return d;
  }

  /* ── فتح صفحة التسليم ── */
  window.openHandover = function (over) {
    var d = collect(over);
    var w = window.open('', '_blank');
    if (!w) {
      window.showToast && window.showToast('اسمح بالنوافذ المنبثقة لعرض صفحة التسليم', 'error');
      return;
    }
    w.document.write(buildPage(d));
    w.document.close();
  };

  /* ═══════════════════════════════════════════════════════
   *  نافذة اختيار رقم واتساب — لا يوجد رقم مفروض. للمرسِل
   *  الحرية الكاملة: يستخدم رقم صاحب الدوري، أو يكتب أي رقم
   *  آخر يحدده بنفسه، أو يرسل بلا رقم ليختار جهة الاتصال من
   *  داخل واتساب مباشرة.
   * ═══════════════════════════════════════════════════════ */
  var modalStyled = false;
  function ensureModalStyles() {
    if (modalStyled) return;
    modalStyled = true;
    var css = '.hov-ov{position:fixed;inset:0;background:rgba(5,6,9,.72);backdrop-filter:blur(3px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Tajawal",sans-serif}' +
      '.hov-box{background:#15171e;border:1px solid #2a2e3a;border-radius:18px;max-width:380px;width:100%;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.6);direction:rtl;text-align:right;position:relative}' +
      '.hov-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:900;color:#f0f0f0;margin-bottom:4px}' +
      '.hov-sub{font-size:11.5px;color:#8b90a0;margin-bottom:16px;line-height:1.7}' +
      '.hov-chip{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#1e222b;border:1px solid #2f3440;border-radius:10px;padding:10px 12px;margin-bottom:12px;cursor:pointer}' +
      '.hov-chip:hover{border-color:#C9A02B}' +
      '.hov-chip small{color:#8b90a0;font-size:10px;display:block;margin-bottom:2px}' +
      '.hov-chip span{font-family:monospace;font-size:13px;color:#f0f0f0;direction:ltr;display:block;text-align:left}' +
      '.hov-chip b{font-size:10px;color:#C9A02B;font-weight:900;flex-shrink:0}' +
      '.hov-input{width:100%;background:#1e222b;border:1px solid #2f3440;color:#f0f0f0;border-radius:10px;padding:11px 13px;font-size:13px;font-family:monospace;direction:ltr;text-align:left;outline:none;margin-bottom:6px}' +
      '.hov-input:focus{border-color:#C9A02B}' +
      '.hov-hint{font-size:10px;color:#5a5f6b;margin-bottom:16px}' +
      '.hov-row{display:flex;gap:8px}' +
      '.hov-btn{flex:1;padding:11px;border-radius:10px;font-size:12.5px;font-weight:900;cursor:pointer;border:none;font-family:Tajawal,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px}' +
      '.hov-btn.gold{background:linear-gradient(135deg,#F0C84A,#C9A02B);color:#14110a}' +
      '.hov-btn.ghost{background:rgba(255,255,255,.06);color:#ccc;border:1px solid #2f3440}' +
      '.hov-close{position:absolute;top:14px;left:14px;background:none;border:none;color:#5a5f6b;font-size:18px;cursor:pointer;line-height:1}';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
  }

  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

  /**
   * يعرض نافذة اختيار الرقم ويُرجع Promise:
   *  - نص رقم (أرقام فقط) لإرسال مباشر لرقم محدد
   *  - سلسلة فارغة '' لإرسال بلا رقم (اختيار جهة الاتصال من واتساب)
   *  - null إذا أُلغي
   */
  function askWhatsAppTarget(defaultPhone, title) {
    ensureModalStyles();
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'hov-ov';
      var chipHtml = defaultPhone ? (
        '<div class="hov-chip" id="hovChipUse">' +
          '<div><small>رقم صاحب الدوري المسجّل</small><span>+' + esc(digitsOnly(defaultPhone)) + '</span></div>' +
          '<b>استخدام</b>' +
        '</div>'
      ) : '';
      ov.innerHTML =
        '<div class="hov-box">' +
          '<button class="hov-close" id="hovClose">&times;</button>' +
          '<div class="hov-title">' + ICON.whatsapp + (title || 'إرسال عبر واتساب') + '</div>' +
          '<div class="hov-sub">اختر إلى أي رقم يُرسل — لست مجبراً على رقم صاحب الدوري.</div>' +
          chipHtml +
          '<input class="hov-input" id="hovInput" type="tel" placeholder="اكتب أي رقم بالمفتاح الدولي، مثال 9677xxxxxxx" dir="ltr"/>' +
          '<div class="hov-hint">اتركه فارغاً لاختيار جهة الاتصال من داخل واتساب مباشرة.</div>' +
          '<div class="hov-row">' +
            '<button class="hov-btn ghost" id="hovPick">فتح واتساب بلا رقم</button>' +
            '<button class="hov-btn gold" id="hovSend">إرسال للرقم</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);

      var input = ov.querySelector('#hovInput');
      var done = false;
      function close(val) {
        if (done) return;
        done = true;
        ov.remove();
        resolve(val);
      }
      ov.querySelector('#hovClose').onclick = function () { close(null); };
      ov.addEventListener('click', function (e) { if (e.target === ov) close(null); });
      var chip = ov.querySelector('#hovChipUse');
      if (chip) chip.onclick = function () { input.value = digitsOnly(defaultPhone); input.focus(); };
      ov.querySelector('#hovPick').onclick = function () { close(''); };
      ov.querySelector('#hovSend').onclick = function () {
        var v = digitsOnly(input.value);
        if (!v) { input.style.borderColor = '#e74c3c'; input.focus(); return; }
        close(v);
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') ov.querySelector('#hovSend').click();
      });
      setTimeout(function () { input.focus(); }, 50);
    });
  }

  function openWA(number, text) {
    var url = number ? 'https://wa.me/' + number + '?text=' + encodeURIComponent(text)
                      : 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  }

  /* ── رسالة واتساب مرتّبة (بلا كلمة مرور) ── */
  window.sendHandoverWA = function (over) {
    var d = collect(over);
    var L = [];
    L.push('*' + d.name + '*');
    if (d.season) L.push('موسم ' + d.season);
    L.push('');
    L.push('تم تجهيز بطولتك وهي جاهزة للاستخدام.');
    L.push('');
    L.push('*صفحة الجمهور*');
    L.push(d.viewerUrl);
    L.push('');
    L.push('*لوحة الإدارة*');
    L.push(d.adminUrl);
    L.push('');
    L.push('*استوديو البثّ*');
    L.push(d.broadcastUrl);
    if (d.email) {
      L.push('');
      L.push('بريد الدخول: ' + d.email);
      L.push('_كلمة المرور تُرسل منفصلة لأمانك_');
    }
    L.push('');
    L.push('للبدء: افتح لوحة الإدارة ← أكمل المعالج ← أضف الفرق.');
    var txt = L.join('\n');

    askWhatsAppTarget(d.phone, 'إرسال روابط البطولة').then(function (num) {
      if (num === null) return; // ألغى
      openWA(num, txt);
    });
  };

  /* ── كلمة المرور منفصلة (ممارسة أأمن) ── */
  window.sendPassWA = function (over) {
    var d = collect(over);
    if (!d.pass) { window.showToast && window.showToast('لا توجد كلمة مرور', 'error'); return; }
    var txt = 'كلمة مرور لوحة إدارة *' + d.name + '*:\n\n' + d.pass +
              '\n\n_غيّرها بعد أول دخول من الإعدادات._';

    askWhatsAppTarget(d.phone, 'إرسال كلمة المرور').then(function (num) {
      if (num === null) return;
      openWA(num, txt);
    });
  };

  // console.log('[handover] جاهز');
})();
