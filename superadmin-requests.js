/* ═══════════════════════════════════════════════════════════════════
 *  superadmin-requests.js — v338
 *  طلبات الاشتراك · رابط الاشتراك · اقتراح النطاق · تنبيهات الحصة
 *  ───────────────────────────────────────────────────────────────────
 *  ما يضيفه:
 *
 *  ① قسم «رابط الاشتراك» — يولّد رابط صفحة الاشتراك ومعه نصّ شرح
 *     جاهز، ويرسله للعميل على واتساب بضغطة.
 *
 *  ② قسم «طلبات الاشتراك» — الطلبات تصل من الصفحة **مباشرةً إلى هنا**
 *     بلا واتساب. كل طلب ببياناته كاملة (الاسم · الجوال · البريد ·
 *     كلمة المرور التي اختارها · الفرق · اللاعبون · المدة · السعر)،
 *     وزرّ «تفعيل الاشتراك» يملأ نموذج إنشاء البطولة كاملاً.
 *
 *  ③ اقتراح المعرّف (النطاق) — أربعة أحرف مرتّبة تُشتقّ من اسم صاحب
 *     الدوري أو اسم البطولة، ويُفحص توفّرها قبل الاقتراح.
 *
 *  ④ حدود الاشتراك — حقول الفرق واللاعبين والصور تُحفظ مع البطولة،
 *     ولوحة الإدارة تلتزم بها وتُنبّه عند اقترابها.
 *
 *  ⑤ تنبيهات الحصة — البطولات التي استنفدت حصّتها تظهر هنا بشارة
 *     حمراء كي يُتواصل معها وتُزاد حصّتها.
 *
 *  يُحمَّل آخر ملف في superadmin.html.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ⚠️ superadmin.js وحدة نمطية — تعمل بعد السكربتات العادية.
     ننتظر ظهور دوالّها قبل الحقن. */
  function ready(fn, t) {
    t = t || 0;
    if (window._db && window.showPage && window.showToast) return fn();
    if (t > 400) return;
    setTimeout(function () { ready(fn, t + 1); }, 60);
  }

  var FS = {};                 // مراجع Firestore تُلتقط من الصفحة
  var REQS = [];               // الطلبات الواردة
  var LEAGUES = [];            // البطولات (لتنبيهات الحصة)
  var unsubReq = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ar(n) { return Number(n || 0).toLocaleString('ar-EG'); }
  function toast(m, k) { if (window.showToast) window.showToast(m, k || 'success'); }

  /* ─────────────────────────────────────────────────────────────
     ① رابط الاشتراك — التوليد والإرسال
     ───────────────────────────────────────────────────────────── */
  function subUrl() {
    var base = (window.SITE_URL || location.origin).replace(/\/+$/, '');
    var custom = (localStorage.getItem('sa_sub_url') || '').trim();
    return custom || (base + '/subscribe.html');
  }

  function pitchText(name) {
    var greet = name ? ('أهلاً ' + name + ' 👋\n') : 'السلام عليكم 👋\n';
    return greet +
      'هذي صفحة الاشتراك بمنصة بطولات:\n' +
      subUrl() + '\n\n' +
      'ادخلها وعبّي بياناتك وأرسل طلبك 👇';
  }

  window.saCopySubLink = function () {
    var t = subUrl();
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('✅ نُسخ الرابط'); });
    else { var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a);
           a.select(); document.execCommand('copy'); a.remove(); toast('✅ نُسخ الرابط'); }
  };
  window.saSendSubLink = function () {
    var phone = (document.getElementById('sa_sl_phone') || {}).value || '';
    var name  = (document.getElementById('sa_sl_name')  || {}).value || '';
    var d = phone.replace(/\D/g, '');
    if (d && d.indexOf('0') === 0) d = '966' + d.slice(1);     // 05… → 9665…
    if (d && d.length === 9) d = '966' + d;
    var msg = encodeURIComponent(pitchText(name.trim()));
    window.open(d ? ('https://wa.me/' + d + '?text=' + msg)
                  : ('https://wa.me/?text=' + msg), '_blank');
  };
  window.saCopyPitch = function () {
    var name = (document.getElementById('sa_sl_name') || {}).value || '';
    var t = pitchText(name.trim());
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('✅ نُسخ النصّ'); });
  };
  window.saSaveSubUrl = function () {
    var v = (document.getElementById('sa_sl_url') || {}).value.trim();
    localStorage.setItem('sa_sub_url', v);
    renderLink();
    toast('✅ حُفظ الرابط');
  };

  function renderLink() {
    var el = document.getElementById('page-sublink');
    if (!el) return;
    el.innerHTML =
      '<div class="ph"><div class="ph-title">🔗 رابط الاشتراك</div>' +
      '<div class="ph-sub">ولّد الرابط وأرسله للعميل — ويصلك طلبه هنا مباشرة</div></div>' +

      '<div class="card"><div class="card-hd"><div class="card-title">📎 الرابط</div></div>' +
      '<div class="card-bd">' +
        '<div class="sa-url">' + esc(subUrl()) + '</div>' +
        '<div class="sa-row" style="margin-top:12px">' +
          '<button class="btn btn-gold" onclick="saCopySubLink()">📋 نسخ الرابط</button>' +
          '<button class="btn btn-outline" onclick="saEditUrl()">✎ تعديل</button>' +
        '</div>' +
        '<div id="sa_url_box" style="display:none;margin-top:12px">' +
          '<input class="fi" id="sa_sl_url" dir="ltr" value="' + esc(subUrl()) + '"/>' +
          '<button class="btn btn-gold btn-sm" style="margin-top:8px" onclick="saSaveSubUrl()">حفظ</button>' +
        '</div>' +
      '</div></div>' +

      '<div class="card" style="margin-top:14px">' +
      '<div class="card-hd"><div class="card-title">📤 إرسال للعميل</div></div>' +
      '<div class="card-bd">' +
        '<div class="frow">' +
          '<div class="fg"><label>اسم العميل <span style="color:var(--muted2,#888);font-weight:400">(اختياري)</span></label>' +
            '<input class="fi" id="sa_sl_name" placeholder="محمد أحمد" oninput="saPreview()"/></div>' +
          '<div class="fg"><label>رقم الواتساب</label>' +
            '<input class="fi" id="sa_sl_phone" dir="ltr" placeholder="0591234567"/>' +
            '<div class="fhint">اتركه فارغاً لاختيار جهة الاتصال بنفسك</div></div>' +
        '</div>' +
        '<label style="display:block;font-size:12px;font-weight:800;color:var(--muted2,#888);margin:6px 0 7px">' +
          'نصّ الرسالة — يُولَّد تلقائياً</label>' +
        '<div class="sa-pitch" id="sa_pitch">' + esc(pitchText('')) + '</div>' +
        '<div class="sa-row" style="margin-top:12px">' +
          '<button class="btn btn-green" onclick="saSendSubLink()">💬 إرسال على واتساب</button>' +
          '<button class="btn btn-outline" onclick="saCopyPitch()">📋 نسخ النصّ</button>' +
        '</div>' +
      '</div></div>';
  }
  window.saEditUrl = function () {
    var b = document.getElementById('sa_url_box');
    if (b) b.style.display = b.style.display === 'none' ? '' : 'none';
  };
  window.saPreview = function () {
    var n = (document.getElementById('sa_sl_name') || {}).value || '';
    var p = document.getElementById('sa_pitch');
    if (p) p.textContent = pitchText(n.trim());
  };

  /* ─────────────────────────────────────────────────────────────
     ② طلبات الاشتراك — الاستماع والعرض
     ───────────────────────────────────────────────────────────── */
  function listen() {
    if (!FS.onSnapshot || unsubReq) return;
    try {
      unsubReq = FS.onSnapshot(FS.collection(FS.db, 'subRequests'), function (snap) {
        REQS = [];
        snap.forEach(function (d) { REQS.push(Object.assign({ id: d.id }, d.data())); });
        REQS.sort(function (a, b) {
          return (b.createdAtMs || 0) - (a.createdAtMs || 0);
        });
        renderReqs(); syncBadge();
      }, function () { /* صامت — القواعد قد تمنع القراءة قبل النشر */ });
    } catch (e) {}
  }

  function syncBadge() {
    var n = REQS.filter(function (r) { return (r.status || 'new') === 'new'; }).length;
    var b = document.getElementById('reqBadge');
    if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
    /* تنبيهات الحصة */
    var q = LEAGUES.filter(function (l) { return l.quotaAlert; }).length;
    var qb = document.getElementById('quotaBadge');
    if (qb) { qb.textContent = q; qb.style.display = q ? '' : 'none'; }
  }

  function when(r) {
    if (!r.createdAtMs) return '';
    var d = new Date(r.createdAtMs), now = Date.now();
    var m = Math.round((now - r.createdAtMs) / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return 'قبل ' + ar(m) + ' دقيقة';
    if (m < 1440) return 'قبل ' + ar(Math.round(m / 60)) + ' ساعة';
    return d.toLocaleDateString('ar-SA');
  }

  function reqCard(r) {
    var st = r.status || 'new';
    var stMeta = { new: ['جديد', '#C9A02B'], done: ['مُفعَّل', '#27AE60'], skip: ['متجاهَل', '#888'] }[st] || ['جديد', '#C9A02B'];
    return '<div class="sa-req' + (st !== 'new' ? ' sa-req-done' : '') + '">' +
      '<div class="sa-req-h">' +
        '<span class="sa-req-name">' + esc(r.name || 'بلا اسم') + '</span>' +
        '<span class="sa-req-st" style="color:' + stMeta[1] + ';border-color:' + stMeta[1] + '55">' + stMeta[0] + '</span>' +
        '<span class="sa-req-t">' + when(r) + '</span>' +
      '</div>' +
      '<div class="sa-req-g">' +
        kv('📱 الجوال', r.phone) +
        kv('✉️ البريد', r.email) +
        kv('🔑 كلمة المرور', r.password) +
        kv('👥 الفرق', ar(r.teams) + ' فريق') +
        kv('🧍 اللاعبون', r.playersOn ? (ar(r.players) + ' لاعب') : 'بلا كشوف') +
        kv('📸 الصور', r.photos ? 'نعم' : 'لا') +
        kv('🗓 المدة', ar(r.dur) + ' شهر') +
        kv('💰 الإجمالي', ar(r.total) + ' ﷼') +
      '</div>' +
      '<div class="sa-req-a">' +
        (st === 'new'
          ? '<button class="btn btn-gold btn-sm" onclick="saActivate(\'' + r.id + '\')">⚡ تفعيل الاشتراك</button>' +
            '<button class="btn btn-outline btn-sm" onclick="saReqWA(\'' + r.id + '\')">💬 مراسلة</button>' +
            '<button class="btn btn-outline btn-sm" onclick="saReqSkip(\'' + r.id + '\')">تجاهل</button>'
          : '<button class="btn btn-outline btn-sm" onclick="saReqWA(\'' + r.id + '\')">💬 مراسلة</button>' +
            '<button class="btn btn-outline btn-sm" onclick="saReqDel(\'' + r.id + '\')">🗑 حذف</button>') +
      '</div></div>';
  }
  function kv(k, v) {
    return '<div class="sa-kv"><span>' + k + '</span><b>' + esc(v || '—') + '</b></div>';
  }

  function renderReqs() {
    var el = document.getElementById('page-requests');
    if (!el) return;
    var news = REQS.filter(function (r) { return (r.status || 'new') === 'new'; });
    var old  = REQS.filter(function (r) { return (r.status || 'new') !== 'new'; });
    el.innerHTML =
      '<div class="ph"><div class="ph-title">📥 طلبات الاشتراك</div>' +
      '<div class="ph-sub">تصل من صفحة الاشتراك مباشرة — اضغط «تفعيل» ليُملأ النموذج تلقائياً</div></div>' +
      (REQS.length ? '' :
        '<div class="card"><div class="card-bd" style="text-align:center;padding:34px">' +
        '<div style="font-size:34px;opacity:.4;margin-bottom:8px">📭</div>' +
        '<div style="font-size:14px;font-weight:800">لا توجد طلبات بعد</div>' +
        '<div style="font-size:12px;color:var(--muted2,#888);margin-top:5px">' +
        'أرسل رابط الاشتراك للعملاء من قسم «رابط الاشتراك»</div></div></div>') +
      (news.length ? '<div class="sa-grp">جديدة (' + ar(news.length) + ')</div>' + news.map(reqCard).join('') : '') +
      (old.length  ? '<div class="sa-grp">سابقة (' + ar(old.length) + ')</div>' + old.map(reqCard).join('') : '');
  }

  window.saReqWA = function (id) {
    var r = REQS.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var d = String(r.phone || '').replace(/\D/g, '');
    if (d.indexOf('0') === 0) d = '966' + d.slice(1);
    if (d.length === 9) d = '966' + d;
    var msg = 'أهلاً ' + (r.name || '') + ' 👋\nوصلني طلبك ✅\n\n' +
      'الإجمالي: ' + (r.total || 0) + ' ﷼ لمدة ' + (r.dur || 1) + ' شهر\n\n' +
      'للتحويل البنكي:\nالبنك: ......\nالآيبان: ......\nالاسم: عبدالله السكني\n\n' +
      'أرسل لي صورة الإيصال، وتوصلك بطولتك جاهزة خلال ٢٤ ساعة 🏆';
    window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(msg), '_blank');
  };
  window.saReqSkip = function (id) { setStatus(id, 'skip'); };
  window.saReqDel = async function (id) {
    if (!confirm('حذف الطلب نهائياً؟')) return;
    try { await FS.deleteDoc(FS.doc(FS.db, 'subRequests', id)); toast('🗑 حُذف'); } catch (e) {}
  };
  async function setStatus(id, st) {
    try { await FS.updateDoc(FS.doc(FS.db, 'subRequests', id), { status: st }); } catch (e) {}
  }

  /* ── تفعيل الطلب: يملأ نموذج إنشاء البطولة كاملاً ── */
  window.saActivate = async function (id) {
    var r = REQS.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    window.showPage('new-league', null);
    setTimeout(async function () {
      var set = function (i, v) { var e = document.getElementById(i); if (e && v != null) e.value = v; };
      set('nl_owner', r.name);
      set('nl_phone', r.phone);
      set('nl_email', r.email);
      set('nl_pass',  r.password);
      set('nl_name',  r.leagueName || ((r.name || '').split(' ')[0] ? ('دوري ' + (r.name || '').split(' ')[0]) : ''));
      /* الحصص */
      set('nl_maxTeams',   r.teams);
      set('nl_maxPlayers', r.playersOn ? r.players : 0);
      var ph = document.getElementById('nl_photos');
      if (ph) ph.checked = !!r.photos;
      /* المدة */
      if (window.selectDuration) {
        var cards = document.querySelectorAll('#nl_durations .dur-card');
        var map = { 1: 0, 3: 1, 6: 2, 12: 3 };
        var idx = map[r.dur];
        if (idx != null && cards[idx]) window.selectDuration(cards[idx], r.dur, 'nl');
      }
      /* اقتراح المعرّف */
      await window.saSuggestSlug(r.name || r.leagueName || '');
      /* اربط الطلب بالبطولة عند الإنشاء */
      window._saPendingReq = id;
      toast('✅ عُبّئت البيانات — راجعها واضغط إنشاء');
    }, 260);
  };

  /* ─────────────────────────────────────────────────────────────
     ③ اقتراح المعرّف — أربعة أحرف مرتّبة ومتاحة
     ───────────────────────────────────────────────────────────── */
  var AR2EN = { 'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh',
    'د':'d','ذ':'th','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a',
    'غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'h','و':'w','ي':'y','ى':'a','ء':'' };

  function translit(s) {
    return String(s || '').split('').map(function (c) {
      if (AR2EN[c] != null) return AR2EN[c];
      if (/[a-zA-Z]/.test(c)) return c.toLowerCase();
      return ' ';
    }).join('').replace(/\s+/g, ' ').trim();
  }
  /* أربعة أحرف تُقرأ: نأخذ من الاسم، ونتجنّب تلاصق الصوامت الثقيل */
  function fourFrom(src) {
    var t = translit(src).replace(/[^a-z ]/g, '');
    var words = t.split(' ').filter(Boolean);
    var cands = [];
    if (words.length >= 2) cands.push((words[0].slice(0, 2) + words[1].slice(0, 2)));
    if (words[0]) cands.push(words[0].slice(0, 4));
    if (words[0] && words[0].length >= 4) cands.push(words[0][0] + words[0].slice(-3));
    return cands.map(function (c) { return c.replace(/[^a-z]/g, ''); })
                .filter(function (c) { return c.length >= 3; });
  }
  var VOWELS = 'aeiouy';
  function pretty4() {
    /* مقطعان: صامت+صائت × 2 — دائماً قابل للنطق */
    var C = 'bdfghjklmnrstwz', V = 'aeiou';
    return C[Math.floor(Math.random()*C.length)] + V[Math.floor(Math.random()*V.length)] +
           C[Math.floor(Math.random()*C.length)] + V[Math.floor(Math.random()*V.length)];
  }
  async function free(slug) {
    if (!FS.getDoc) return true;
    try { var d = await FS.getDoc(FS.doc(FS.db, 'leagues', slug)); return !d.exists(); }
    catch (e) { return true; }
  }
  window.saSuggestSlug = async function (src) {
    var input = document.getElementById('nl_slug');
    if (!input) return;
    src = src || (document.getElementById('nl_name') || {}).value ||
                 (document.getElementById('nl_owner') || {}).value || '';
    var tries = fourFrom(src).concat([pretty4(), pretty4(), pretty4(), pretty4(), pretty4(), pretty4()]);
    for (var i = 0; i < tries.length; i++) {
      var s = tries[i].slice(0, 4);
      if (s.length < 3) continue;
      if (await free(s)) {
        input.value = s;
        if (window.updateLinks) window.updateLinks();
        showSuggestions(tries.slice(i + 1, i + 4));
        return s;
      }
    }
  };
  function showSuggestions(list) {
    var box = document.getElementById('nl_slug_sugg');
    if (!box) return;
    list = (list || []).filter(Boolean).map(function (s) { return s.slice(0, 4); });
    box.innerHTML = list.length
      ? 'بدائل: ' + list.map(function (s) {
          return '<button class="sa-chip" onclick="saPickSlug(\'' + s + '\')">' + s + '</button>';
        }).join('')
      : '';
  }
  window.saPickSlug = function (s) {
    var i = document.getElementById('nl_slug');
    if (i) { i.value = s; if (window.updateLinks) window.updateLinks(); }
  };

  /* ─────────────────────────────────────────────────────────────
     ④ حقن الواجهة
     ───────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('sa-req-css')) return;
    var s = document.createElement('style');
    s.id = 'sa-req-css';
    s.textContent = [
      '.sa-url{font-family:ui-monospace,monospace;font-size:13px;color:var(--gold,#C9A02B);',
      ' background:var(--dark,#121212);border:1px solid var(--border,#2c2c2c);border-radius:10px;',
      ' padding:13px 15px;word-break:break-all;direction:ltr;text-align:left}',
      '.sa-row{display:flex;gap:9px;flex-wrap:wrap}',
      '.sa-pitch{white-space:pre-wrap;font-size:12.5px;line-height:1.95;color:#c3c7ce;',
      ' background:var(--dark,#121212);border:1px solid var(--border,#2c2c2c);',
      ' border-radius:11px;padding:13px 15px;max-height:230px;overflow-y:auto}',
      '.sa-grp{font-size:11px;font-weight:900;color:#6a7080;letter-spacing:.6px;margin:18px 0 9px}',
      '.sa-req{background:var(--card,#1a1a1a);border:1px solid var(--border,#2c2c2c);',
      ' border-radius:14px;padding:14px;margin-bottom:11px}',
      '.sa-req-done{opacity:.62}',
      '.sa-req-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:11px}',
      '.sa-req-name{font-size:15px;font-weight:900;color:#e6e8ec}',
      '.sa-req-st{font-size:10px;font-weight:900;border:1px solid;border-radius:999px;padding:3px 10px}',
      '.sa-req-t{margin-inline-start:auto;font-size:10.5px;color:#6a7080;font-weight:700}',
      '.sa-req-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px}',
      '.sa-kv{background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.055);',
      ' border-radius:10px;padding:8px 11px}',
      '.sa-kv span{display:block;font-size:10px;color:#6a7080;font-weight:700}',
      '.sa-kv b{display:block;font-size:12.5px;font-weight:800;color:#d7dae0;margin-top:2px;',
      ' word-break:break-all;direction:ltr;text-align:right}',
      '.sa-req-a{display:flex;gap:8px;flex-wrap:wrap}',
      '.sa-chip{background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.3);',
      ' color:var(--gold,#C9A02B);border-radius:8px;padding:4px 11px;font-size:11.5px;',
      ' font-weight:800;font-family:ui-monospace,monospace;cursor:pointer;margin-inline-start:6px}',
      '.sa-quota{display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:12px;',
      ' background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.3);margin-bottom:9px}',
      '.sa-quota b{font-size:13px;font-weight:900;color:#e07070}',
      '.sa-quota span{font-size:11.5px;color:#9aa0aa;font-weight:700}',
      '.btn-green{background:linear-gradient(145deg,#2AD36A,#1EB955);color:#fff;border:none}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function inject() {
    var side = document.querySelector('.sidebar');
    var main = document.getElementById('panel-main') || document.querySelector('.main');
    if (!side || !main) return false;
    if (document.getElementById('sb-requests')) return true;
    css();

    /* الصفحتان */
    ['page-sublink', 'page-requests'].forEach(function (id) {
      if (document.getElementById(id)) return;
      var d = document.createElement('div');
      d.className = 'section'; d.id = id;
      main.appendChild(d);
    });

    /* بنود القائمة — بعد «الاشتراكات» */
    var after = side.querySelector('.sb-item[onclick*="\'subs\'"]');
    function item(id, page, icon, label, badgeId, cls) {
      var el = document.createElement('div');
      el.className = 'sb-item'; el.id = id;
      el.setAttribute('onclick', "showPage('" + page + "',this)");
      el.innerHTML = '<span class="sb-icon">' + icon + '</span>' + label +
        (badgeId ? '<span class="sb-badge ' + (cls || 'bg-gold') + '" id="' + badgeId +
                   '" style="display:none">0</span>' : '');
      return el;
    }
    if (after && after.parentNode) {
      var a = item('sb-requests', 'requests', '📥', 'طلبات الاشتراك', 'reqBadge', 'bg-green');
      var b = item('sb-sublink',  'sublink',  '🔗', 'رابط الاشتراك');
      after.parentNode.insertBefore(a, after.nextSibling);
      after.parentNode.insertBefore(b, a.nextSibling);
    }

    /* حقول الحصص في نموذج إنشاء البطولة */
    injectQuotaFields();
    injectSlugButton();
    return true;
  }

  function injectQuotaFields() {
    if (document.getElementById('nl_maxTeams')) return;
    var durCard = document.querySelector('#page-new-league .card:nth-of-type(3)');
    if (!durCard) return;
    var card = document.createElement('div');
    card.className = 'card';
    card.style.marginTop = '14px';
    card.innerHTML =
      '<div class="card-hd"><div class="card-title">📦 حدود الاشتراك</div></div>' +
      '<div class="card-bd">' +
        '<div class="frow">' +
          '<div class="fg"><label>الحد الأقصى للفرق</label>' +
            '<input class="fi" id="nl_maxTeams" type="number" min="0" value="16"/>' +
            '<div class="fhint">صفر = بلا حدّ</div></div>' +
          '<div class="fg"><label>الحد الأقصى للاعبين</label>' +
            '<input class="fi" id="nl_maxPlayers" type="number" min="0" value="200"/>' +
            '<div class="fhint">صفر = بلا حدّ</div></div>' +
        '</div>' +
        '<label style="display:flex;align-items:center;gap:9px;cursor:pointer;margin-top:6px">' +
          '<input type="checkbox" id="nl_photos" checked style="width:18px;height:18px"/>' +
          '<span style="font-size:13px;font-weight:700">السماح بصور اللاعبين</span></label>' +
      '</div>';
    durCard.parentNode.insertBefore(card, durCard.nextSibling);
  }

  function injectSlugButton() {
    var inp = document.getElementById('nl_slug');
    if (!inp || document.getElementById('nl_slug_sugg')) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:7px;align-items:center;margin-top:6px;flex-wrap:wrap';
    wrap.innerHTML =
      '<button class="btn btn-outline btn-sm" onclick="saSuggestSlug()">✨ اقترح معرّفاً</button>' +
      '<span id="nl_slug_sugg" style="font-size:11px;color:#6a7080;font-weight:700"></span>';
    inp.parentNode.appendChild(wrap);
  }

  /* ─────────────────────────────────────────────────────────────
     ⑤ الربط بمنطق الإنشاء + تنبيهات الحصة
     ───────────────────────────────────────────────────────────── */
  ready(function () {
    FS.db = window._db || window.db;
    ['collection','doc','getDoc','setDoc','updateDoc','deleteDoc','addDoc','onSnapshot']
      .forEach(function (k) { FS[k] = window['_firestore' + k[0].toUpperCase() + k.slice(1)] || window[k]; });

    var t = 0;
    var iv = setInterval(function () {
      t++;
      if (inject() || t > 80) { clearInterval(iv); listen(); }
    }, 350);

    /* عرض الصفحات عند فتحها */
    var orig = window.showPage;
    window.showPage = function (name) {
      var r = orig.apply(this, arguments);
      try {
        if (name === 'sublink')  renderLink();
        if (name === 'requests') renderReqs();
      } catch (e) {}
      return r;
    };

    /* حفظ الحصص مع البطولة + إغلاق الطلب المرتبط */
    var origCreate = window.createLeague;
    if (typeof origCreate === 'function') {
      window.createLeague = async function () {
        var slug = (document.getElementById('nl_slug') || {}).value || '';
        var r = await origCreate.apply(this, arguments);
        try {
          var limits = {
            maxTeams:   parseInt((document.getElementById('nl_maxTeams') || {}).value, 10) || 0,
            maxPlayers: parseInt((document.getElementById('nl_maxPlayers') || {}).value, 10) || 0,
            photos:     !!(document.getElementById('nl_photos') || {}).checked
          };
          if (slug) await FS.setDoc(FS.doc(FS.db, 'leagues', slug), { limits: limits }, { merge: true });
          if (window._saPendingReq) {
            await FS.updateDoc(FS.doc(FS.db, 'subRequests', window._saPendingReq),
              { status: 'done', leagueId: slug });
            window._saPendingReq = null;
          }
        } catch (e) {}
        return r;
      };
    }

    /* تنبيهات الحصة على البطولات */
    if (FS.onSnapshot) {
      try {
        FS.onSnapshot(FS.collection(FS.db, 'leagues'), function (snap) {
          LEAGUES = [];
          snap.forEach(function (d) { LEAGUES.push(Object.assign({ id: d.id }, d.data())); });
          syncBadge(); renderQuotaAlerts();
        }, function () {});
      } catch (e) {}
    }
  });

  function renderQuotaAlerts() {
    var host = document.getElementById('page-overview');
    if (!host) return;
    var hit = LEAGUES.filter(function (l) { return l.quotaAlert; });
    var old = document.getElementById('sa-quota-box');
    if (!hit.length) { if (old) old.remove(); return; }
    if (old) old.remove();
    css();
    var d = document.createElement('div');
    d.id = 'sa-quota-box';
    d.className = 'card';
    d.style.marginBottom = '14px';
    d.innerHTML = '<div class="card-hd"><div class="card-title" style="color:#e07070">' +
      '⚠️ بطولات استنفدت حصّتها (' + ar(hit.length) + ')</div></div><div class="card-bd">' +
      hit.map(function (l) {
        var q = l.quotaAlert || {};
        return '<div class="sa-quota"><span style="font-size:19px">📦</span>' +
          '<div style="flex:1"><b>' + esc(l.name || l.id) + '</b>' +
          '<span style="display:block">' + esc(q.msg || 'بلغت الحدّ') + '</span></div>' +
          '<button class="btn btn-gold btn-sm" onclick="saRaise(\'' + l.id + '\')">زيادة الحصة</button></div>';
      }).join('') + '</div>';
    host.insertBefore(d, host.firstChild);
  }

  window.saRaise = async function (lid) {
    var l = LEAGUES.filter(function (x) { return x.id === lid; })[0];
    if (!l) return;
    var cur = (l.limits || {});
    var t = prompt('الحد الأقصى للفرق (' + (cur.maxTeams || 0) + '):', cur.maxTeams || 16);
    if (t === null) return;
    var p = prompt('الحد الأقصى للاعبين (' + (cur.maxPlayers || 0) + '):', cur.maxPlayers || 200);
    if (p === null) return;
    var newMaxPlayers = parseInt(p, 10) || 0;
    var addedPlayers = newMaxPlayers - (cur.maxPlayers || 0);
    try {
      await FS.setDoc(FS.doc(FS.db, 'leagues', lid), {
        limits: { maxTeams: parseInt(t,10)||0, maxPlayers: newMaxPlayers, photos: cur.photos !== false },
        quotaAlert: null,
        quotaBoost: addedPlayers > 0 ? { addedPlayers: addedPlayers, addedAt: Date.now(), seen: false } : null
      }, { merge: true });
      toast('✅ زِيدت حصّة ' + (l.name || lid));
    } catch (e) { toast('تعذّر التحديث', 'error'); }
  };

  console.log('[superadmin-requests] v338 ✅');
})();
