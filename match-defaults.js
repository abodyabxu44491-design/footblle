/* ═══════════════════════════════════════════════════════════════════
 *  match-defaults.js — v336
 *  القيم الافتراضية للمباريات
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة التي يحلّها:
 *
 *    كان في الإعدادات حقل «الملعب» (setVenue) يُحفظ في defaultVenue —
 *    ثم لا يكاد يُستعمل. مولّد الدوري كان يثبّت `time:'16:00'` وملعباً
 *    وهمياً في الكود، ونافذة الإضافة كانت تفضّل «آخر ملعب استُعمل» على
 *    ما اختاره المنظّم. فيكتب المنظّم ملعبه في الإعدادات ولا يراه في
 *    أي مباراة، ويعيد كتابته يدوياً كل مرة — وكل حقول الطاقم (الحكم،
 *    الخطّان، المعلّق، المصوّر، المذيع، الراعي) لم يكن لها افتراضي أصلاً
 *    رغم أنها تتكرّر كما هي في كل مباريات البطولة.
 *
 *  الحلّ: نقطة تعبئة واحدة.
 *
 *    كل مسارات إنشاء المباريات في المنصة — الإضافة اليدوية، مولّد
 *    الدوري، المجموعات، شجرة الإقصاء، الملحق، المباراة الفاصلة —
 *    تمرّ من دالّة واحدة هي `_lightMatch`. فُتح فيها منفذ واحد يستدعي
 *    `window._applyMatchDefaults`، فلا يبقى مسار إنشاء يفلت من
 *    التعبئة، ولا حاجة لتعديل اثني عشر موضعاً كلٌّ على حدة.
 *
 *  والتعبئة **لا تدهس شيئاً**: تملأ الحقل الفارغ فقط. فما كتبه المنظّم
 *  في نافذة الإضافة يبقى كما كتبه، والافتراضي يسدّ ما تركه فارغاً.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GOLD = '#C9A02B', GOLD2 = '#F0C84A';

  function ready(fn, tries) {
    tries = tries || 0;
    if (window.settings && typeof window.showPage === 'function') return fn();
    if (tries > 400) return;
    setTimeout(function () { ready(fn, tries + 1); }, 60);
  }

  /* ─────────────────────────────────────────────────────────────
     ① الحقول — مصدر واحد يبني النموذج والتعبئة والمعاينة معاً
     ───────────────────────────────────────────────────────────── */
  var GROUPS = [
    { t: '⏰ الموعد والمكان', k: 'when', f: [
      { k: 'time',  l: 'وقت البداية', ic: '🕐', type: 'time', ph: '',
        hint: 'يُملأ في كل مباراة جديدة، وتغيّره متى شئت لمباراة بعينها.' },
      { k: 'venue', l: 'الملعب', ic: '🏟️', type: 'text', ph: 'مثال: ملعب الحارة الشمالية' }
    ]},
    { t: '👔 الطاقم', k: 'crew', f: [
      { k: 'referee',      l: 'الحكم',        ic: '🏁', type: 'text', ph: 'اسم الحكم' },
      { k: 'linesman1',    l: 'مساعد ١',      ic: '🚩', type: 'text', ph: 'حكم الخط الأول' },
      { k: 'linesman2',    l: 'مساعد ٢',      ic: '🚩', type: 'text', ph: 'حكم الخط الثاني' },
      { k: 'commentator',  l: 'المعلّق',       ic: '🎙', type: 'text', ph: 'اسم المعلّق' },
      { k: 'photographer', l: 'المصوّر',       ic: '📸', type: 'text', ph: 'اسم المصوّر' },
      { k: 'announcer',    l: 'المذيع',        ic: '🎤', type: 'text', ph: 'اسم المذيع' }
    ]},
    { t: '🏅 الراعي', k: 'sponsor', f: [
      { k: 'sponsor', l: 'راعي المباراة', ic: '🏅', type: 'text', ph: 'اسم الراعي' }
    ]}
  ];
  var FIELDS = [];
  GROUPS.forEach(function (g) { g.f.forEach(function (f) { FIELDS.push(f); }); });
  function fieldKeys() { return FIELDS.map(function (f) { return f.k; }); }

  var DEFAULTS = { autoFill: true };
  fieldKeys().forEach(function (k) { DEFAULTS[k] = ''; });

  function cfg() {
    var s = (window.settings || {});
    var d = s.matchDefaults || {};
    var out = {};
    for (var k in DEFAULTS) out[k] = (d[k] === undefined) ? DEFAULTS[k] : d[k];
    /* توافق مع الحقل القديم: من ملأ «الملعب» في المعلومات الأساسية قبل
       هذا القسم يجد قيمته هنا بلا إعادة كتابة. */
    if (!out.venue && s.defaultVenue) out.venue = s.defaultVenue;
    return out;
  }
  function filled(c) {
    return fieldKeys().filter(function (k) { return String(c[k] || '').trim(); });
  }

  /* ─────────────────────────────────────────────────────────────
     ② التعبئة — المنفذ الذي يستدعيه _lightMatch
     ───────────────────────────────────────────────────────────── */
  window._applyMatchDefaults = function (obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var c = cfg();
    if (!c.autoFill) return obj;
    fieldKeys().forEach(function (k) {
      var v = String(c[k] || '').trim();
      if (!v) return;
      var cur = obj[k];
      /* الفارغ فقط: ما كتبه المنظّم في النافذة أَولى من الافتراضي دائماً */
      if (cur === undefined || cur === null || String(cur).trim() === '') obj[k] = v;
    });
    return obj;
  };

  /* ─────────────────────────────────────────────────────────────
     ③ CSS
     ───────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('md-css')) return;
    var s = document.createElement('style');
    s.id = 'md-css';
    s.textContent = [
      '.md{font-family:Tajawal,sans-serif}',
      '.md-top{display:flex;align-items:center;gap:11px;padding:13px 14px;border-radius:14px;margin-bottom:16px;background:linear-gradient(135deg,rgba(201,160,43,.1),rgba(201,160,43,.02));border:1px solid rgba(201,160,43,.2);cursor:pointer}',
      '.md-top .md-tx{flex:1;min-width:0}',
      '.md-top .md-t{font-size:13px;font-weight:900;color:#e8eaf0}',
      '.md-top .md-d{font-size:10.5px;color:#818794;margin-top:2px;line-height:1.65}',
      '.md-knob{flex:0 0 auto;width:44px;height:25px;border-radius:999px;background:#262a33;position:relative;transition:.18s}',
      '.md-knob::after{content:"";position:absolute;top:3px;inset-inline-end:3px;width:19px;height:19px;border-radius:50%;background:#6a7080;transition:.18s}',
      '.md-top.on .md-knob{background:rgba(201,160,43,.35)}',
      '.md-top.on .md-knob::after{inset-inline-end:22px;background:' + GOLD2 + '}',
      '.md-grp{margin-bottom:14px;border:1px solid #1f232b;border-radius:15px;overflow:hidden;background:#111318}',
      '.md-grp-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;background:rgba(255,255,255,.022);border-bottom:1px solid #1f232b}',
      '.md-grp-h span:first-child{font-size:12.5px;font-weight:900;color:#e6e8ec}',
      '.md-cnt{font-size:10px;font-weight:800;color:' + GOLD + ';background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.2);border-radius:999px;padding:3px 9px}',
      '.md-grp-b{padding:6px 14px 12px}',
      '.md-f{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.045)}',
      '.md-grp-b .md-f:last-child{border-bottom:none}',
      '.md-ic{flex:0 0 auto;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;background:rgba(255,255,255,.04)}',
      '.md-l{flex:0 0 72px;font-size:11.5px;font-weight:800;color:#9aa0aa}',
      '.md-in{flex:1;min-width:0;padding:9px 11px;border-radius:10px;border:1px solid #262a33;background:#0d0f13;color:#e6e8ec;font-size:12.5px;font-family:Tajawal,sans-serif}',
      '.md-in:focus{outline:none;border-color:rgba(201,160,43,.55)}',
      '.md-in.set{border-color:rgba(201,160,43,.3);background:rgba(201,160,43,.035)}',
      '.md-hint{font-size:10px;color:#6a7080;padding:0 0 8px 0;line-height:1.7}',
      '.md-acts{display:flex;gap:9px;margin-top:4px}',
      '.md-b{flex:1;padding:13px;border-radius:12px;font-size:13px;font-weight:900;font-family:Tajawal,sans-serif;cursor:pointer;border:1px solid transparent}',
      '.md-b-save{flex:2;background:linear-gradient(145deg,' + GOLD2 + ',' + GOLD + ');color:#1a1200}',
      '.md-b-apply{background:transparent;border-color:rgba(201,160,43,.32);color:' + GOLD2 + '}',
      '.md-sum{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.06);font-size:11px;color:#818794;line-height:1.9;margin-top:14px}',
      '.md-sum b{color:' + GOLD2 + '}',
      /* نافذة التطبيق على الموجود */
      '.md-ov{position:fixed;inset:0;z-index:100070;background:rgba(0,0,0,.8);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;font-family:Tajawal,sans-serif}',
      '@media(min-width:640px){.md-ov{align-items:center}}',
      '.md-sheet{width:100%;max-width:430px;max-height:92vh;overflow-y:auto;background:#111318;border:1px solid #262a33;border-radius:20px 20px 0 0}',
      '@media(min-width:640px){.md-sheet{border-radius:20px}}',
      '.md-sh-h{padding:16px 18px 13px;border-bottom:1px solid #1f232b;background:linear-gradient(135deg,rgba(201,160,43,.13),transparent)}',
      '.md-sh-h h4{margin:0 0 3px;font-size:15.5px;font-weight:900;color:#e8eaf0}',
      '.md-sh-h p{margin:0;font-size:11px;color:#818794;line-height:1.75}',
      '.md-sh-b{padding:15px 18px 0}',
      '.md-opt{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border-radius:12px;border:1px solid #262a33;background:#0d0f13;margin-bottom:8px;cursor:pointer}',
      '.md-opt.on{border-color:' + GOLD + ';background:rgba(201,160,43,.08)}',
      '.md-dot{flex:0 0 auto;width:17px;height:17px;border-radius:50%;border:2px solid #3a3f4a;margin-top:2px}',
      '.md-opt.on .md-dot{border-color:' + GOLD + ';background:' + GOLD + ';box-shadow:inset 0 0 0 3px #111318}',
      '.md-opt .md-ot{font-size:12.5px;font-weight:800;color:#e6e8ec}',
      '.md-opt .md-od{font-size:10.5px;color:#6a7080;line-height:1.7;margin-top:2px}',
      '.md-sh-f{display:flex;gap:9px;padding:14px 18px 20px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
     ④ الصفحة
     ───────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render() {
    var host = document.getElementById('page-set-matchdef');
    if (!host) return;
    css();
    var c = cfg();
    var n = filled(c).length;

    var body = GROUPS.map(function (g) {
      var set = g.f.filter(function (f) { return String(c[f.k] || '').trim(); }).length;
      return '<div class="md-grp">' +
        '<div class="md-grp-h"><span>' + g.t + '</span>' +
          '<span class="md-cnt">' + set + '/' + g.f.length + '</span></div>' +
        '<div class="md-grp-b">' +
          g.f.map(function (f) {
            var v = String(c[f.k] || '');
            return '<div class="md-f">' +
              '<span class="md-ic">' + f.ic + '</span>' +
              '<span class="md-l">' + f.l + '</span>' +
              '<input class="md-in' + (v ? ' set' : '') + '" id="md-' + f.k + '" type="' + f.type + '" ' +
                'value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '" ' +
                'oninput="mdTouch(this)"/>' +
            '</div>' + (f.hint ? '<div class="md-hint">' + f.hint + '</div>' : '');
          }).join('') +
        '</div></div>';
    }).join('');

    host.innerHTML =
      '<div class="set-back" onclick="showPage(\'settings\',null)"><span>›</span> الإعدادات</div>' +
      '<div class="page-header">' +
        '<div class="page-title">📋 القيم الافتراضية للمباريات</div>' +
        '<div class="page-sub">تُملأ تلقائياً في كل مباراة جديدة</div>' +
      '</div>' +
      '<div class="md">' +
        '<div class="md-top' + (c.autoFill ? ' on' : '') + '" id="md-auto" onclick="mdToggleAuto(this)">' +
          '<div class="md-tx">' +
            '<div class="md-t">تعبئة المباريات الجديدة تلقائياً</div>' +
            '<div class="md-d">الحقول الفارغة فقط — ما تكتبه في نافذة الإضافة يبقى كما هو.</div>' +
          '</div><div class="md-knob"></div>' +
        '</div>' +
        body +
        '<div class="md-acts">' +
          '<button class="md-b md-b-save" onclick="mdSave()">💾 حفظ</button>' +
          '<button class="md-b md-b-apply" onclick="mdOpenApply()">↧ تطبيق على الموجود</button>' +
        '</div>' +
        '<div class="md-sum" id="md-sum">' + summaryHtml(c) + '</div>' +
      '</div>';
  }

  function summaryHtml(c) {
    var f = filled(c);
    if (!f.length) return 'لم تُملأ أي قيمة بعد — كل مباراة جديدة ستُنشأ بحقول فارغة.';
    if (!c.autoFill) return 'التعبئة التلقائية <b>مطفأة</b> — القيم محفوظة لكنها لا تُطبَّق على المباريات الجديدة.';
    return 'كل مباراة جديدة ستُنشأ وفيها <b>' + f.length + '</b> من الحقول معبّأة مسبقاً: ' +
      f.map(function (k) {
        var d = FIELDS.filter(function (x) { return x.k === k; })[0];
        return d ? d.l : k;
      }).join(' · ') + '.';
  }

  window.mdTouch = function (el) {
    el.classList.toggle('set', !!el.value.trim());
    var box = document.getElementById('md-sum');
    if (box) box.innerHTML = summaryHtml(readForm());
  };
  window.mdToggleAuto = function (row) {
    row.classList.toggle('on');
    var box = document.getElementById('md-sum');
    if (box) box.innerHTML = summaryHtml(readForm());
  };

  function readForm() {
    var out = { autoFill: !!(document.getElementById('md-auto') || {}).classList &&
                          document.getElementById('md-auto').classList.contains('on') };
    fieldKeys().forEach(function (k) {
      var el = document.getElementById('md-' + k);
      out[k] = el ? el.value.trim() : '';
    });
    return out;
  }

  async function persist(obj) {
    window.settings = window.settings || {};
    window.settings.matchDefaults = obj;
    /* الملعب يُكتب في الحقل القديم أيضاً، وإلا دهسه حفظ «المعلومات
       الأساسية» لاحقاً لأنه يكتب defaultVenue من حقله هناك. */
    window.settings.defaultVenue = obj.venue || '';
    var sv = document.getElementById('setVenue');
    if (sv) sv.value = obj.venue || '';
    try {
      var lid = window._getLeagueId ? window._getLeagueId() : '';
      if (lid && window._firestoreSetDoc && window._firestoreDoc && window._db) {
        await window._firestoreSetDoc(
          window._firestoreDoc(window._db, 'leagues', lid, 'config', 'settings'),
          { matchDefaults: obj, defaultVenue: obj.venue || '' }, { merge: true });
      }
      return true;
    } catch (e) {
      window.showToast && window.showToast('تعذّر الحفظ', 'error');
      return false;
    }
  }

  window.mdSave = async function () {
    var obj = readForm();
    var ok = await persist(obj);
    if (!ok) return;
    render();
    syncBadge();
    var n = filled(obj).length;
    window.showToast && window.showToast(
      n ? ('✅ حُفظ — ' + n + ' حقلاً سيُملأ في كل مباراة جديدة') : '✅ حُفظ', 'success');
  };

  /* ─────────────────────────────────────────────────────────────
     ⑤ التطبيق على المباريات الموجودة
     ───────────────────────────────────────────────────────────── */
  var APPLY = { scope: 'upcoming', mode: 'empty' };

  window.mdOpenApply = function () {
    css();
    var c = readForm();
    if (!filled(c).length) {
      window.showToast && window.showToast('املأ قيمة واحدة على الأقل أولاً', 'error');
      return;
    }
    var old = document.getElementById('md-apply-ov');
    if (old) old.remove();

    var ov = document.createElement('div');
    ov.id = 'md-apply-ov';
    ov.className = 'md-ov';
    ov.innerHTML =
      '<div class="md-sheet" onclick="event.stopPropagation()">' +
        '<div class="md-sh-h"><h4>↧ تطبيق على المباريات الموجودة</h4>' +
          '<p>القيم الحالية في الصفحة هي التي ستُطبَّق — احفظ أولاً إن غيّرتها.</p></div>' +
        '<div class="md-sh-b">' +
          '<div style="font-size:11px;font-weight:900;color:#818794;margin-bottom:7px">على أي مباريات؟</div>' +
          '<div class="md-opt on" data-g="scope" data-v="upcoming" onclick="mdPick(this)">' +
            '<div class="md-dot"></div><div><div class="md-ot">غير المنتهية فقط</div>' +
            '<div class="md-od">القادمة والمباشرة. المنتهية تُترك كما هي — بياناتها صارت جزءاً من سجلّ البطولة.</div></div></div>' +
          '<div class="md-opt" data-g="scope" data-v="all" onclick="mdPick(this)">' +
            '<div class="md-dot"></div><div><div class="md-ot">كل المباريات</div>' +
            '<div class="md-od">بما فيها المنتهية.</div></div></div>' +

          '<div style="font-size:11px;font-weight:900;color:#818794;margin:15px 0 7px">وماذا عن الحقول المملوءة؟</div>' +
          '<div class="md-opt on" data-g="mode" data-v="empty" onclick="mdPick(this)">' +
            '<div class="md-dot"></div><div><div class="md-ot">الفارغة فقط</div>' +
            '<div class="md-od">لا يُمسّ حقل فيه قيمة. الخيار الآمن.</div></div></div>' +
          '<div class="md-opt" data-g="mode" data-v="all" onclick="mdPick(this)">' +
            '<div class="md-dot"></div><div><div class="md-ot">استبدال الكل</div>' +
            '<div class="md-od">يدهس القيم الموجودة. استعمله إن تغيّر الملعب أو الحكم فعلاً.</div></div></div>' +

          '<div id="md-apply-prev" style="margin-top:14px;padding:11px 13px;border-radius:12px;' +
            'background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.18);font-size:11.5px;' +
            'color:#b9bec7;line-height:1.85"></div>' +
        '</div>' +
        '<div class="md-sh-f">' +
          '<button class="md-b" style="background:transparent;border-color:#262a33;color:#818794" onclick="mdCloseApply()">إلغاء</button>' +
          '<button class="md-b md-b-save" onclick="mdRunApply()">↧ تطبيق</button>' +
        '</div>' +
      '</div>';
    ov.onclick = function () { ov.remove(); };
    document.body.appendChild(ov);
    APPLY = { scope: 'upcoming', mode: 'empty' };
    mdPreview();
  };

  window.mdPick = function (el) {
    var g = el.getAttribute('data-g');
    APPLY[g] = el.getAttribute('data-v');
    var box = document.getElementById('md-apply-ov');
    Array.prototype.forEach.call(box.querySelectorAll('[data-g="' + g + '"]'), function (o) {
      o.classList.remove('on');
    });
    el.classList.add('on');
    mdPreview();
  };
  window.mdCloseApply = function () {
    var ov = document.getElementById('md-apply-ov');
    if (ov) ov.remove();
  };

  function targets() {
    var ms = (window.matches || []).slice();
    if (APPLY.scope === 'upcoming') ms = ms.filter(function (m) { return m.status !== 'finished'; });
    return ms;
  }
  /* ما الذي سيتغيّر فعلاً — يُحسب قبل الكتابة لا بعدها */
  function plan(c) {
    var keys = filled(c);
    var edits = [];
    targets().forEach(function (m) {
      var patch = {};
      keys.forEach(function (k) {
        var cur = String(m[k] == null ? '' : m[k]).trim();
        if (APPLY.mode === 'empty' && cur) return;
        if (cur === String(c[k]).trim()) return;   // لا كتابة بلا تغيير
        patch[k] = String(c[k]).trim();
      });
      if (Object.keys(patch).length) edits.push({ m: m, patch: patch });
    });
    return edits;
  }

  function mdPreview() {
    var box = document.getElementById('md-apply-prev');
    if (!box) return;
    var c = readForm();
    var edits = plan(c);
    var cells = edits.reduce(function (n, e) { return n + Object.keys(e.patch).length; }, 0);
    box.innerHTML = edits.length
      ? ('سيتغيّر <b style="color:' + GOLD2 + '">' + cells + '</b> حقلاً في <b style="color:' + GOLD2 + '">' +
         edits.length + '</b> مباراة.')
      : 'لا شيء سيتغيّر بهذه الخيارات — القيم مطابقة أصلاً أو الحقول مملوءة.';
  }

  window.mdRunApply = async function () {
    var c = readForm();
    var edits = plan(c);
    if (!edits.length) { window.showToast && window.showToast('لا شيء للتطبيق', 'error'); return; }
    var cells = edits.reduce(function (n, e) { return n + Object.keys(e.patch).length; }, 0);

    var ok = window.confirmDialog
      ? await window.confirmDialog({
          title: '↧ تطبيق القيم الافتراضية',
          message: 'سيُكتب ' + cells + ' حقلاً في ' + edits.length + ' مباراة.' +
            (APPLY.mode === 'all' ? '\n\n⚠️ وضع «استبدال الكل»: القيم الموجودة ستُدهس.' : '') +
            (APPLY.scope === 'all' ? '\n⚠️ يشمل المباريات المنتهية.' : ''),
          confirmText: 'تطبيق', danger: APPLY.mode === 'all' })
      : confirm('تطبيق على ' + edits.length + ' مباراة؟');
    if (!ok) return;

    window.mdCloseApply();
    var lid = window._getLeagueId ? window._getLeagueId() : '';
    if (!lid || !window._firestoreWriteBatch) {
      window.showToast && window.showToast('تعذّر الاتصال', 'error');
      return;
    }
    try {
      /* دفعات من ٤٠٠ — حدّ Firestore ٥٠٠ عملية للدفعة الواحدة */
      var i = 0;
      while (i < edits.length) {
        var chunk = edits.slice(i, i + 400);
        var batch = window._firestoreWriteBatch(window._db);
        chunk.forEach(function (e) {
          batch.update(window._firestoreDoc(window._db, 'leagues', lid, 'matches', e.m.id), e.patch);
          for (var k in e.patch) e.m[k] = e.patch[k];   // حدّث النسخة المحلية فوراً
        });
        await batch.commit();
        i += 400;
      }
      window.showToast && window.showToast('✅ طُبّق على ' + edits.length + ' مباراة', 'success');
      if (typeof window.renderMatches === 'function') window.renderMatches();
    } catch (e) {
      window.showToast && window.showToast('تعذّر التطبيق: ' + (e.message || ''), 'error');
    }
  };

  /* ─────────────────────────────────────────────────────────────
     ⑥ الحقن في مركز الإعدادات
     ───────────────────────────────────────────────────────────── */
  function syncBadge() {
    var b = document.getElementById('set-badge-matchdef');
    if (!b) return;
    var c = cfg(), n = filled(c).length;
    b.textContent = !n ? 'لم تُضبط' : (!c.autoFill ? (n + ' · مطفأة') : (n + ' حقول'));
  }

  function inject() {
    var main = document.getElementById('panel-main');
    if (!main) return false;
    if (document.getElementById('set-row-matchdef')) return true;

    if (!document.getElementById('page-set-matchdef')) {
      var d = document.createElement('div');
      d.className = 'section';
      d.id = 'page-set-matchdef';
      main.appendChild(d);
    }

    /* المجموعة ② «المباريات واللاعبون» — بجوار إعدادات المباريات */
    var lists = document.querySelectorAll('#page-settings .set-list');
    var target = lists[1] || lists[0];
    if (!target) return false;
    var row = document.createElement('div');
    row.className = 'set-row';
    row.id = 'set-row-matchdef';
    row.setAttribute('onclick', "showPage('set-matchdef',null)");
    row.innerHTML =
      '<span class="set-row-ic">📋</span>' +
      '<div class="set-row-txt">' +
        '<div class="set-row-t">القيم الافتراضية للمباريات</div>' +
        '<div class="set-row-d">الملعب · الوقت · الطاقم · الراعي</div>' +
      '</div>' +
      '<span class="set-badge" id="set-badge-matchdef"></span>' +
      '<span class="set-row-go">‹</span>';
    /* أول الصفّ في مجموعته: يُضبط مرة قبل إنشاء المباريات */
    target.insertBefore(row, target.firstChild);
    syncBadge();
    return true;
  }

  ready(function () {
    var t = 0;
    var iv = setInterval(function () {
      t++;
      if (inject() || t > 60) { clearInterval(iv); try { syncBadge(); } catch (e) {} }
    }, 400);

    /* «المعلومات الأساسية» فيها حقل الملعب القديم ويكتب defaultVenue.
       لو حُفظ من هناك وجب أن يتبعه الافتراضي، وإلا صار للملعب مصدران
       يتناقضان: واحد في الأساسية وآخر هنا. */
    var origSave = window.saveSettings;
    if (typeof origSave === 'function') {
      window.saveSettings = async function () {
        var r = await origSave.apply(this, arguments);
        try {
          var v = ((window.settings || {}).defaultVenue || '').trim();
          var md = (window.settings || {}).matchDefaults;
          if (md && v && md.venue !== v) {
            md.venue = v;
            var lid = window._getLeagueId ? window._getLeagueId() : '';
            if (lid && window._firestoreSetDoc) {
              await window._firestoreSetDoc(
                window._firestoreDoc(window._db, 'leagues', lid, 'config', 'settings'),
                { matchDefaults: md }, { merge: true });
            }
          }
          syncBadge();
        } catch (e) {}
        return r;
      };
    }

    var orig = window.showPage;
    window.showPage = function (name) {
      var r = orig.apply(this, arguments);
      try {
        if (name === 'set-matchdef') render();
        if (name === 'settings') syncBadge();
      } catch (e) {}
      return r;
    };
  });

  /* واجهة عامة للاختبار والمعاينة */
  window.MatchDefaults = {
    cfg: cfg, apply: window._applyMatchDefaults, render: render,
    GROUPS: GROUPS, fields: fieldKeys, plan: plan, _setApply: function (o) { APPLY = o; }
  };

  console.log('[match-defaults] v336 — القيم الافتراضية للمباريات جاهزة ✅');
})();
