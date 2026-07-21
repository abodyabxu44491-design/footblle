/* ═══════════════════════════════════════════════════════════════════
 *  handover.js — تسليم البطولة للمنظّم
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة التي يحلها:
 *    زر «إرسال واتساب» كان يبني نصاً خاماً:
 *        🏆 اسم\n\n🌐 رابط:\nURL\n\n📧 البريد: x\n🔑 كلمة المرور: 1234
 *    ثلاث مشاكل:
 *      1) شكل رديء — نص مكسور وروابط عارية
 *      2) كلمة المرور نصاً صريحاً في محادثة واتساب تبقى للأبد
 *      3) لا تعليمات — المنظّم يستلم روابط بلا معرفة ماذا يفعل
 *
 *  الحل: صفحة تسليم كاملة تُفتح في تبويب — بطاقة أنيقة فيها كل
 *  التفاصيل والخطوات، قابلة للطباعة/الحفظ PDF، وأزرار نسخ لكل حقل.
 *  وواتساب يرسل رسالة مرتّبة قصيرة + رابط الصفحة.
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

  /* ── بناء صفحة التسليم ── */
  function buildPage(d) {
    var TYPE = { league: 'دوري نقاط', groups: 'مجموعات + خروج مغلوب', knockout: 'خروج مغلوب' };
    var typeTxt = TYPE[d.type] || 'بطولة';

    var row = function (label, value, dir, copyable) {
      if (!value) return '';
      return '<div class="row">' +
        '<div class="row-l">' + esc(label) + '</div>' +
        '<div class="row-v"' + (dir ? ' dir="ltr"' : '') + '>' + esc(value) + '</div>' +
        (copyable ? '<button class="cp" onclick="cp(this,\'' + esc(value).replace(/'/g, "\\'") + '\')">نسخ</button>' : '') +
      '</div>';
    };

    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>تسليم ' + esc(d.name) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet"/>' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:Tajawal,sans-serif;background:#0d0e12;color:#eee;padding:24px 16px;line-height:1.6}' +
    '.wrap{max-width:640px;margin:0 auto}' +
    '.card{background:#14161c;border:1px solid #262a34;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
    '.hd{background:linear-gradient(135deg,rgba(201,160,43,.16),rgba(201,160,43,.03));padding:30px 24px;text-align:center;border-bottom:1px solid #262a34}' +
    '.lg{width:76px;height:76px;margin:0 auto 14px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid #2c313d;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
    '.lg img{width:100%;height:100%;object-fit:contain;padding:8px}' +
    '.lg span{font-size:34px}' +
    'h1{font-size:23px;font-weight:900;color:#C9A02B;margin-bottom:6px}' +
    '.sub{font-size:12px;color:#8b90a0}' +
    '.bd{padding:22px 24px}' +
    '.sec{font-size:11px;font-weight:900;color:#C9A02B;letter-spacing:.6px;margin:22px 0 10px;padding-right:9px;border-right:3px solid #C9A02B}' +
    '.sec:first-child{margin-top:0}' +
    '.row{display:flex;align-items:center;gap:10px;background:#191c23;border:1px solid #262a34;border-radius:11px;padding:11px 13px;margin-bottom:7px}' +
    '.row-l{font-size:11px;color:#8b90a0;min-width:78px;flex-shrink:0}' +
    '.row-v{flex:1;font-size:13px;font-weight:700;word-break:break-all;min-width:0}' +
    '.cp{background:rgba(201,160,43,.12);border:1px solid rgba(201,160,43,.3);color:#C9A02B;border-radius:7px;padding:5px 11px;font-size:10px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif;flex-shrink:0}' +
    '.cp:active{transform:scale(.94)}' +
    '.cp.done{background:rgba(46,204,113,.15);border-color:rgba(46,204,113,.4);color:#2ecc71}' +
    '.btn{display:block;text-align:center;text-decoration:none;border-radius:12px;padding:14px;font-size:14px;font-weight:900;margin-bottom:9px;font-family:Tajawal,sans-serif}' +
    '.b1{background:#C9A02B;color:#12131a}' +
    '.b2{background:rgba(255,255,255,.05);border:1px solid #2c313d;color:#eee}' +
    '.warn{background:rgba(231,76,60,.07);border:1px solid rgba(231,76,60,.25);border-radius:12px;padding:13px 15px;margin-top:16px;font-size:11.5px;color:#ff9b8f;line-height:1.8}' +
    '.steps{counter-reset:s;list-style:none}' +
    '.steps li{counter-increment:s;position:relative;padding:9px 34px 9px 0;font-size:12.5px;color:#c8ccd6;border-bottom:1px solid #1e222a}' +
    '.steps li:last-child{border:0}' +
    '.steps li::before{content:counter(s);position:absolute;right:0;top:9px;width:22px;height:22px;background:rgba(201,160,43,.14);border:1px solid rgba(201,160,43,.3);color:#C9A02B;border-radius:50%;font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center}' +
    '.ft{text-align:center;padding:16px;font-size:10px;color:#5a5f6b;border-top:1px solid #262a34}' +
    '@media print{body{background:#fff;color:#000;padding:0}.card{border:1px solid #ddd;box-shadow:none}' +
    '.hd{background:#f7f7f7}h1{color:#8a6d1d}.row{background:#fafafa;border-color:#e5e5e5}' +
    '.row-v{color:#000}.sec{color:#8a6d1d;border-color:#8a6d1d}.cp,.noprint{display:none!important}' +
    '.steps li{color:#333;border-color:#eee}.warn{background:#fff5f4;color:#8a2018}}' +
    '</style></head><body><div class="wrap"><div class="card">' +

    '<div class="hd">' +
      '<div class="lg">' + (d.logo ? '<img src="' + esc(d.logo) + '" alt=""/>' : '<span>&#127942;</span>') + '</div>' +
      '<h1>' + esc(d.name) + '</h1>' +
      '<div class="sub">' + esc(typeTxt) + ' &middot; موسم ' + esc(d.season || '2025') + '</div>' +
    '</div>' +

    '<div class="bd">' +
      '<div class="sec">بيانات المنظّم</div>' +
      row('الاسم', d.owner) +
      row('الواتساب', d.phone, true) +

      '<div class="sec">الدخول للوحة الإدارة</div>' +
      row('البريد', d.email, true, true) +
      row('كلمة المرور', d.pass, true, true) +

      '<div class="sec">الروابط</div>' +
      row('الجمهور', d.viewerUrl, true, true) +
      row('الإدارة', d.adminUrl, true, true) +

      '<div class="sec noprint">فتح مباشر</div>' +
      '<a class="btn b1 noprint" href="' + esc(d.adminUrl) + '" target="_blank">فتح لوحة الإدارة</a>' +
      '<a class="btn b2 noprint" href="' + esc(d.viewerUrl) + '" target="_blank">معاينة صفحة الجمهور</a>' +

      '<div class="sec">خطوات البداية</div>' +
      '<ol class="steps">' +
        '<li>افتح لوحة الإدارة وسجّل الدخول بالبريد وكلمة المرور أعلاه</li>' +
        '<li>أكمل معالج إعداد البطولة (يظهر تلقائياً أول مرة)</li>' +
        '<li>أضف الفرق المشاركة' + (d.type !== 'league' ? ' ثم وزّعها على المجموعات' : '') + '</li>' +
        '<li>ستتولّد المباريات تلقائياً بالجولات مرتّبة</li>' +
        '<li>شارك رابط الجمهور مع الجميع لمتابعة البث المباشر</li>' +
      '</ol>' +

      '<div class="warn">' +
        '<b>تنبيه أمني:</b> غيّر كلمة المرور بعد أول دخول من الإعدادات. ' +
        'لا تشارك بيانات الدخول مع أحد — من يملكها يتحكم بالبطولة كاملة.' +
      '</div>' +
    '</div>' +

    '<div class="ft">منصة بطولات &middot; ' + new Date().toLocaleDateString('ar') + '</div>' +
    '</div>' +
    '<a class="btn b2 noprint" style="margin-top:14px;cursor:pointer" onclick="window.print()">طباعة / حفظ PDF</a>' +
    '</div>' +
    '<script>function cp(b,t){navigator.clipboard.writeText(t).then(function(){' +
    'var o=b.textContent;b.textContent="تم";b.classList.add("done");' +
    'setTimeout(function(){b.textContent=o;b.classList.remove("done")},1400)})}<\/script>' +
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
      adminUrl:  base + 'league-admin.html?id='  + slug
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
    if (d.email) {
      L.push('');
      L.push('بريد الدخول: ' + d.email);
      L.push('_كلمة المرور تُرسل منفصلة لأمانك_');
    }
    L.push('');
    L.push('للبدء: افتح لوحة الإدارة ← أكمل المعالج ← أضف الفرق.');

    var txt = encodeURIComponent(L.join('\n'));
    var url = d.phone ? 'https://wa.me/' + d.phone.replace(/\D/g, '') + '?text=' + txt
                      : 'https://wa.me/?text=' + txt;
    window.open(url, '_blank');
  };

  /* ── كلمة المرور منفصلة (ممارسة أأمن) ── */
  window.sendPassWA = function (over) {
    var d = collect(over);
    if (!d.pass) { window.showToast && window.showToast('لا توجد كلمة مرور', 'error'); return; }
    var txt = encodeURIComponent('كلمة مرور لوحة إدارة *' + d.name + '*:\n\n' + d.pass +
              '\n\n_غيّرها بعد أول دخول من الإعدادات._');
    var url = d.phone ? 'https://wa.me/' + d.phone.replace(/\D/g, '') + '?text=' + txt
                      : 'https://wa.me/?text=' + txt;
    window.open(url, '_blank');
  };

  console.log('[handover] جاهز');
})();
