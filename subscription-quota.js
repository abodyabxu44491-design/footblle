/* ═══════════════════════════════════════════════════════════════════
 *  subscription-quota.js — v338
 *  حدود الاشتراك في لوحة الإدارة: أشرطة الاستهلاك والتنبيهات
 *  ───────────────────────────────────────────────────────────────────
 *  الفكرة:
 *
 *    كل بطولة لها حصّة يحدّدها السوبر أدمن عند الإنشاء:
 *      limits: { maxTeams, maxPlayers, photos }
 *
 *    هذا الملف يجعل الحصّة **مرئية ومُلزِمة** في لوحة الإدارة:
 *
 *    ① قسم الاشتراك يعرض أشرطة استهلاك حيّة: كم فريقاً أُضيف وكم بقي،
 *       وكم لاعباً، وهل الصور مسموحة — مع تواريخ الاشتراك وأيامه.
 *
 *    ② عند بلوغ الحدّ تُمنع الإضافة برسالة واضحة تقول السبب والحلّ،
 *       بدل أن تفشل الكتابة بخطأ غامض من قواعد الأمان.
 *
 *    ③ وعند البلوغ تُرفع **راية للسوبر أدمن** (quotaAlert) فتظهر عنده
 *       في نظرة عامة بزرّ «زيادة الحصة» — فيتواصل قبل أن يتعطّل العميل.
 *
 *  والتنبيه يُرفع مرة واحدة ويُمسح تلقائياً متى زِيدت الحصّة.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GOLD = '#C9A02B', GOLD2 = 'var(--gold2,#E8BE45)';

  function ready(fn, t) {
    t = t || 0;
    if (window.settings !== undefined && typeof window.showPage === 'function' &&
        typeof window._getLeagueId === 'function') return fn();
    if (t > 500) return;
    setTimeout(function () { ready(fn, t + 1); }, 60);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var ar = function (n) { return Number(n || 0).toLocaleString('ar-EG'); };

  /* ─────────────────────────────────────────────────────────────
     ① قراءة الحصّة والاستهلاك
     ───────────────────────────────────────────────────────────── */
  function limits() {
    /* مستند البطولة يُصدَّر في admin.js باسم window.league */
    var doc = window.league || window.leagueInfo || window._leagueDoc || {};
    var L = doc.limits || {};
    return {
      maxTeams:   Number(L.maxTeams   || 0),
      maxPlayers: Number(L.maxPlayers || 0),
      photos:     L.photos !== false
    };
  }
  function usedTeams() { return (window.teams || []).length; }
  function usedPlayers() {
    var R = window._teamRosters || {};
    var n = 0, seen = {};
    Object.keys(R).forEach(function (tid) {
      (R[tid] || []).forEach(function (p) {
        var k = tid + '::' + (p.id || p.name);
        if (!seen[k]) { seen[k] = 1; n++; }
      });
    });
    /* لو لم تُحمَّل الكشوف بعد، نستعمل العدّاد المحفوظ */
    var doc = window.league || {};
    if (!n && doc.playersCount) n = Number(doc.playersCount) || 0;
    return n;
  }
  function usedPhotos() {
    var R = window._teamRosters || {}, n = 0;
    Object.keys(R).forEach(function (tid) {
      (R[tid] || []).forEach(function (p) { if (p.photo || p.image || p.avatar) n++; });
    });
    return n;
  }

  function state() {
    var L = limits();
    var t = usedTeams(), p = usedPlayers();
    return {
      L: L, teams: t, players: p, photos: usedPhotos(),
      teamsLeft:   L.maxTeams   ? Math.max(0, L.maxTeams   - t) : Infinity,
      playersLeft: L.maxPlayers ? Math.max(0, L.maxPlayers - p) : Infinity,
      teamsPct:    L.maxTeams   ? Math.min(100, t / L.maxTeams   * 100) : 0,
      playersPct:  L.maxPlayers ? Math.min(100, p / L.maxPlayers * 100) : 0
    };
  }
  window.SubQuota = { state: state, limits: limits };

  /* ─────────────────────────────────────────────────────────────
     ② المنع عند بلوغ الحدّ
     ───────────────────────────────────────────────────────────── */
  function block(kind, n) {
    var s = state();
    if (kind === 'team') {
      if (!s.L.maxTeams) return null;
      if (s.teams + (n || 1) > s.L.maxTeams)
        return 'وصلت للحدّ الأقصى من الفرق في اشتراكك (' + ar(s.L.maxTeams) + ' فريقاً).\n\n' +
               'لزيادة الحصّة تواصل معنا على الواتساب — وتُضاف فوراً بلا إعادة إنشاء.';
    }
    if (kind === 'player') {
      if (!s.L.maxPlayers) return null;
      if (s.players + (n || 1) > s.L.maxPlayers)
        return 'وصلت للحدّ الأقصى من اللاعبين في اشتراكك (' + ar(s.L.maxPlayers) + ' لاعباً).\n\n' +
               'لزيادة الحصّة تواصل معنا على الواتساب — وتُضاف فوراً بلا إعادة إنشاء.';
    }
    if (kind === 'photo' && !s.L.photos)
      return 'صور اللاعبين غير مفعّلة في اشتراكك.\n\nتواصل معنا لتفعيلها.';
    return null;
  }
  window.SubQuota.block = block;

  async function deny(msg) {
    if (window.confirmDialog) {
      await window.confirmDialog({ title: '📦 حدّ الاشتراك', message: msg,
        confirmText: 'حسناً', hideCancel: true });
    } else if (window.showToast) window.showToast(msg.split('\n')[0], 'error');
    else alert(msg);
    flagSuper();
  }

  /* ─────────────────────────────────────────────────────────────
     ③ رفع راية للسوبر أدمن — مرة واحدة
     ───────────────────────────────────────────────────────────── */
  var flagged = false;
  async function flagSuper() {
    if (flagged) return;
    var s = state();
    var hitT = s.L.maxTeams   && s.teams   >= s.L.maxTeams;
    var hitP = s.L.maxPlayers && s.players >= s.L.maxPlayers;
    if (!hitT && !hitP) return;
    flagged = true;
    var parts = [];
    if (hitT) parts.push('الفرق ' + ar(s.teams) + '/' + ar(s.L.maxTeams));
    if (hitP) parts.push('اللاعبون ' + ar(s.players) + '/' + ar(s.L.maxPlayers));
    try {
      var lid = window._getLeagueId();
      if (lid && window._firestoreSetDoc) {
        await window._firestoreSetDoc(
          window._firestoreDoc(window._db, 'leagues', lid),
          { quotaAlert: { msg: parts.join(' · '), at: Date.now() } }, { merge: true });
      }
    } catch (e) {}
  }
  /* ومسح الراية متى اتّسعت الحصّة */
  async function clearFlag() {
    var s = state();
    var ok = (!s.L.maxTeams || s.teams < s.L.maxTeams) &&
             (!s.L.maxPlayers || s.players < s.L.maxPlayers);
    if (!ok) return;
    flagged = false;
    try {
      var lid = window._getLeagueId();
      var info = window.league || {};
      if (lid && info.quotaAlert && window._firestoreSetDoc) {
        await window._firestoreSetDoc(
          window._firestoreDoc(window._db, 'leagues', lid), { quotaAlert: null }, { merge: true });
      }
    } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────────
     ④ CSS
     ───────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('sq-css')) return;
    var s = document.createElement('style');
    s.id = 'sq-css';
    s.textContent = [
      '.sq{font-family:Tajawal,sans-serif}',
      '.sq-hero{background:linear-gradient(150deg,rgba(201,160,43,.1),rgba(201,160,43,.02));',
      ' border:1px solid rgba(201,160,43,.26);border-radius:16px;padding:16px;margin-bottom:14px}',
      '.sq-hero-t{display:flex;align-items:center;gap:9px;margin-bottom:12px}',
      '.sq-hero-t b{font-size:15px;font-weight:900;color:' + GOLD2 + '}',
      '.sq-pill{margin-inline-start:auto;font-size:10.5px;font-weight:900;border-radius:999px;',
      ' padding:4px 12px;border:1px solid}',
      '.sq-pill.ok{color:var(--green,#27AE60);border-color:rgba(46,158,91,.4);background:rgba(46,158,91,.1)}',
      '.sq-pill.warn{color:var(--gold,#C9A02B);border-color:rgba(217,162,27,.4);background:rgba(217,162,27,.1)}',
      '.sq-pill.bad{color:var(--red,#C0392B);border-color:rgba(192,57,43,.4);background:rgba(192,57,43,.1)}',
      '.sq-dates{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px}',
      '.sq-date{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);',
      ' border-radius:11px;padding:10px 12px}',
      '.sq-date span{display:block;font-size:10px;color:var(--muted,#5a5a5a);font-weight:700}',
      '.sq-date b{display:block;font-size:13.5px;font-weight:900;color:var(--text,#efefef);margin-top:2px}',
      '.sq-bars{display:flex;flex-direction:column;gap:13px}',
      '.sq-bar-h{display:flex;align-items:center;gap:8px;margin-bottom:7px}',
      '.sq-bar-h .ic{font-size:15px}',
      '.sq-bar-h .l{font-size:13px;font-weight:800;color:var(--text,#efefef)}',
      '.sq-bar-h .v{margin-inline-start:auto;font-size:12.5px;font-weight:900;',
      ' font-variant-numeric:tabular-nums}',
      '.sq-track{height:10px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}',
      '.sq-fill{height:100%;border-radius:99px;transition:width .5s cubic-bezier(.16,1,.3,1)}',
      '.sq-left{font-size:10.5px;color:var(--muted,#5a5a5a);font-weight:700;margin-top:5px}',
      '.sq-left b{font-weight:900}',
      '.sq-warn{display:flex;align-items:flex-start;gap:10px;padding:13px 15px;border-radius:13px;',
      ' background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.3);margin-top:13px}',
      '.sq-warn b{display:block;font-size:13px;font-weight:900;color:var(--red,#C0392B);margin-bottom:3px}',
      '.sq-warn span{font-size:11.5px;color:var(--muted2,#888);line-height:1.85}',
      '.sq-wa{display:inline-flex;align-items:center;gap:7px;margin-top:10px;padding:10px 18px;',
      ' border-radius:11px;background:rgba(37,211,102,.1);border:1px solid rgba(37,211,102,.35);',
      ' color:#25D366;font-size:12.5px;font-weight:900;cursor:pointer;font-family:Tajawal,sans-serif}',
      '.sq-note{font-size:11px;color:var(--muted,#5a5a5a);line-height:1.9;margin-top:12px;padding:11px 13px;',
      ' border-radius:11px;background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.055)}',
      '.sq-cred-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06)}',
      '.sq-cred-row:first-of-type{border-top:none}',
      '.sq-cred-l{font-size:10.5px;color:var(--muted,#5a5a5a);font-weight:700;min-width:66px;flex-shrink:0}',
      '.sq-cred-v{flex:1;font-size:12px;font-weight:800;color:var(--text,#efefef);word-break:break-all}',
      '.sq-cred-b{background:rgba(201,160,43,.12);border:1px solid rgba(201,160,43,.3);color:' + GOLD + ';',
      ' border-radius:7px;width:26px;height:26px;flex-shrink:0;cursor:pointer;font-size:11px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
     ⑤ رسم قسم الاشتراك
     ───────────────────────────────────────────────────────────── */
  var WA = '966591757224';
  function waLink(msg) {
    return 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
  }

  function bar(icon, label, used, max, unit) {
    if (!max) {
      return '<div><div class="sq-bar-h"><span class="ic">' + icon + '</span>' +
        '<span class="l">' + label + '</span>' +
        '<span class="v" style="color:var(--green,#27AE60)">بلا حدّ</span></div>' +
        '<div class="sq-track"><div class="sq-fill" style="width:100%;' +
        'background:linear-gradient(90deg,var(--green,#27AE60),#4ade80);opacity:.35"></div></div>' +
        '<div class="sq-left">أُضيف <b>' + ar(used) + '</b> ' + unit + '</div></div>';
    }
    var pct = Math.min(100, used / max * 100);
    var left = Math.max(0, max - used);
    var col = pct >= 100 ? ['#C0392B', 'var(--red,#C0392B)']
            : pct >= 80  ? ['var(--gold,#C9A02B)', 'var(--gold2,#E8BE45)']
            : ['var(--green,#27AE60)', '#4ade80'];
    return '<div><div class="sq-bar-h"><span class="ic">' + icon + '</span>' +
      '<span class="l">' + label + '</span>' +
      '<span class="v" style="color:' + col[1] + '">' + ar(used) + ' / ' + ar(max) + '</span></div>' +
      '<div class="sq-track"><div class="sq-fill" style="width:' + pct.toFixed(1) + '%;' +
      'background:linear-gradient(90deg,' + col[0] + ',' + col[1] + ')"></div></div>' +
      '<div class="sq-left">' + (left
        ? ('يتبقّى <b style="color:' + col[1] + '">' + ar(left) + '</b> ' + unit)
        : '<b style="color:var(--red,#C0392B)">استُنفدت الحصّة</b>') + '</div></div>';
  }

  function daysLeft(end) {
    if (!end) return null;
    var d = Math.ceil((new Date(end) - new Date()) / 86400000);
    return isNaN(d) ? null : d;
  }

  /* ─────────────────────────────────────────────────────────────
     ⑤ب بيانات الدخول — تُجلب مرة واحدة من leagueAdmins/{uid}
        (كلمة المرور الأصلية إن كانت محفوظة) ثم تُعرض بقسم الاشتراك
     ───────────────────────────────────────────────────────────── */
  var creds = { loaded: false, email: '', pass: '', shown: false };
  async function loadCreds() {
    if (creds.loaded) return;
    creds.loaded = true;
    try {
      var info = window.league || {};
      creds.email = info.ownerEmail || (window._authEmail || '');
      var uid = info.ownerUid;
      if (uid && window._firestoreGetDoc) {
        var snap = await window._firestoreGetDoc(window._firestoreDoc(window._db, 'leagueAdmins', uid));
        if (snap.exists()) creds.pass = snap.data().initialPassword || '';
      }
    } catch (e) {}
    render();
  }
  window.sqTogglePass = function () {
    creds.shown = !creds.shown;
    render();
  };
  window.sqCopyCred = function (val) {
    if (!val) return;
    if (navigator.clipboard) navigator.clipboard.writeText(val).then(function () {
      if (window.showToast) window.showToast('تم النسخ', 'success');
    });
  };

  /* ─────────────────────────────────────────────────────────────
     ⑤ج إشعار «تمت إضافة مساحة لاعبين» — يظهر مرة واحدة فقط بعد ما
        يزيد السوبر أدمن الحصّة، بشاشة الدخول وبقسم الاشتراك، ثم
        يُعلَّم كمقروء بقاعدة البيانات فلا يتكرر.
     ───────────────────────────────────────────────────────────── */
  var boostChecked = false;
  async function checkQuotaBoost() {
    if (boostChecked) return;
    var info = window.league || {};
    var b = info.quotaBoost;
    if (!b || b.seen) return;
    boostChecked = true;
    var n = ar(b.addedPlayers || 0);
    if (window.showToast) window.showToast('🎉 تمت إضافة ' + n + ' مساحة لاعب إضافية لاشتراكك!', 'success');
    try {
      var lid = window._getLeagueId();
      if (lid && window._firestoreSetDoc) {
        await window._firestoreSetDoc(
          window._firestoreDoc(window._db, 'leagues', lid),
          { quotaBoost: { addedPlayers: b.addedPlayers || 0, addedAt: b.addedAt || Date.now(), seen: true } },
          { merge: true });
      }
    } catch (e) {}
  }

  function render() {
    var host = document.getElementById('page-set-sub');
    if (!host) return;
    css();
    loadCreds();
    checkQuotaBoost();
    var s = state();
    var info = window.league || window.leagueInfo || {};
    var sub  = info.subscription || {};
    var dl   = daysLeft(sub.endDate || info.subEnd);

    var hitT = s.L.maxTeams   && s.teams   >= s.L.maxTeams;
    var hitP = s.L.maxPlayers && s.players >= s.L.maxPlayers;
    var near = (s.L.maxTeams   && s.teamsPct   >= 80) ||
               (s.L.maxPlayers && s.playersPct >= 80);
    var pill = (hitT || hitP) ? ['bad', 'استُنفدت'] : near ? ['warn', 'اقتربت'] : ['ok', 'ضمن الحدّ'];

    var msg = 'السلام عليكم 👋\nأبغى أزيد حصّة اشتراكي في منصة بطولات.\n\n' +
      'البطولة: ' + (info.name || window._getLeagueId()) + '\n' +
      'الفرق: ' + ar(s.teams) + (s.L.maxTeams ? ' / ' + ar(s.L.maxTeams) : '') + '\n' +
      'اللاعبون: ' + ar(s.players) + (s.L.maxPlayers ? ' / ' + ar(s.L.maxPlayers) : '');

    var showBoost = info.quotaBoost && !info.quotaBoost.seen;

    host.innerHTML =
      '<div class="set-back" onclick="showPage(\'settings\',null)"><span>›</span> الإعدادات</div>' +
      '<div class="page-header"><div class="page-title">💳 الاشتراك</div>' +

      (showBoost
        ? '<div class="sq-warn" style="background:rgba(46,158,91,.08);border-color:rgba(46,158,91,.35);margin-top:12px;margin-bottom:0">' +
          '<span style="font-size:19px">🎉</span><div><b style="color:var(--green,#27AE60)">تمت إضافة مساحة لاعبين!</b>' +
          '<span>زِيدت حصّتك بـ<b style="color:var(--text,#efefef)"> ' + ar(info.quotaBoost.addedPlayers || 0) + ' </b>لاعب إضافي — تقدر تضيفهم الآن.</span></div></div>'
        : '') +
      '<div class="page-sub">حالة اشتراكك وحدوده</div></div>' +
      '<div class="sq">' +

      /* حالة الاشتراك */
      '<div class="sq-hero">' +
        '<div class="sq-hero-t"><span style="font-size:18px">📦</span>' +
          '<b>حدود اشتراكك</b>' +
          '<span class="sq-pill ' + pill[0] + '">' + pill[1] + '</span></div>' +
        '<div class="sq-bars">' +
          bar('👥', 'الفرق',      s.teams,   s.L.maxTeams,   'فريق') +
          bar('🧍', 'اللاعبون',   s.players, s.L.maxPlayers, 'لاعب') +
          '<div><div class="sq-bar-h"><span class="ic">📸</span>' +
            '<span class="l">صور اللاعبين</span>' +
            '<span class="v" style="color:' + (s.L.photos ? 'var(--green,#27AE60)' : 'var(--muted,#5a5a5a)') + '">' +
              (s.L.photos ? 'مفعّلة' : 'غير مفعّلة') + '</span></div>' +
            '<div class="sq-left">' + (s.L.photos
              ? ('أُضيف <b>' + ar(s.photos) + '</b> صورة')
              : 'غير متاحة في اشتراكك الحالي') + '</div></div>' +
        '</div>' +
      '</div>' +

      /* بيانات الدخول — بريده وكلمة مروره، للمرجع السريع */
      '<div class="sq-hero" style="padding:14px 16px">' +
        '<div class="sq-hero-t" style="margin-bottom:10px"><span style="font-size:16px">🔑</span>' +
          '<b style="font-size:12.5px">بيانات الدخول للوحة الإدارة</b></div>' +
        '<div class="sq-cred-row"><span class="sq-cred-l">البريد</span>' +
          '<span class="sq-cred-v" dir="ltr">' + esc(creds.email || '—') + '</span>' +
          (creds.email ? '<button class="sq-cred-b" onclick="sqCopyCred(\'' + esc(creds.email).replace(/'/g,"\\'") + '\')">📋</button>' : '') +
        '</div>' +
        '<div class="sq-cred-row"><span class="sq-cred-l">كلمة المرور</span>' +
          '<span class="sq-cred-v" dir="ltr">' + (creds.pass ? (creds.shown ? esc(creds.pass) : '••••••••') : 'غير محفوظة') + '</span>' +
          (creds.pass ? (
            '<button class="sq-cred-b" onclick="sqTogglePass()">' + (creds.shown ? '🙈' : '👁') + '</button>' +
            '<button class="sq-cred-b" onclick="sqCopyCred(\'' + esc(creds.pass).replace(/'/g,"\\'") + '\')">📋</button>'
          ) : '') +
        '</div>' +
      '</div>' +

      /* التواريخ */
      '<div class="sq-dates">' +
        dcard('الحالة', sub.status === 'expired' ? 'منتهٍ' : 'نشط') +
        dcard('البداية', sub.startDate || info.subStart || '—') +
        dcard('الانتهاء', sub.endDate || info.subEnd || '—') +
        dcard('المتبقّي', dl == null ? '—' : (dl > 0 ? ar(dl) + ' يوم' : 'انتهى')) +
      '</div>' +

      /* التحذير */
      ((hitT || hitP)
        ? '<div class="sq-warn"><span style="font-size:19px">⚠️</span><div>' +
          '<b>استُنفدت حصّة اشتراكك</b>' +
          '<span>' + (hitT ? 'بلغت الحدّ الأقصى من الفرق. ' : '') +
                    (hitP ? 'بلغت الحدّ الأقصى من اللاعبين. ' : '') +
          'ما أُضيف يبقى كما هو ويعمل بلا مشاكل — لكن لا تقدر تضيف المزيد حتى تُزاد الحصّة.</span>' +
          '<button class="sq-wa" onclick="window.open(\'' + waLink(msg) + '\',\'_blank\')">' +
          '💬 تواصل لزيادة الحصّة</button></div></div>'
        : near
        ? '<div class="sq-warn" style="background:rgba(217,162,27,.06);border-color:rgba(217,162,27,.3)">' +
          '<span style="font-size:19px">🔔</span><div>' +
          '<b style="color:var(--gold,#C9A02B)">اقتربت من الحدّ</b>' +
          '<span>تبقّى أقلّ من ٢٠٪ من حصّتك. لو تتوقّع زيادة، اطلبها قبل أن تحتاجها.</span>' +
          '<button class="sq-wa" onclick="window.open(\'' + waLink(msg) + '\',\'_blank\')">' +
          '💬 طلب زيادة</button></div></div>'
        : '') +

      '<div class="sq-note">ℹ️ الحصّة تُزاد في أي وقت بلا إعادة إنشاء ولا فقدان بيانات — ' +
      'يُحسب <b style="color:var(--text,#efefef)">الفرق فقط</b> للمدة المتبقّية من اشتراكك.</div>' +
      '</div>';
  }
  function dcard(l, v) {
    return '<div class="sq-date"><span>' + l + '</span><b>' + esc(v) + '</b></div>';
  }
  window.SubQuota.render = render;

  /* ─────────────────────────────────────────────────────────────
     ⑥ الربط: المنع عند الإضافة + إعادة الرسم
     ───────────────────────────────────────────────────────────── */
  /* مزامنة عدد اللاعبين الفعلي إلى مستند البطولة — admin.js يحدّث
     teamsCount تلقائياً لكن لا يحدّث playersCount، وهذا الرقم يحتاجه
     السوبر أدمن بنافذة تفاصيل البطولة (لا يرى الكشوف مباشرة). */
  var lastSyncedPlayers = -1;
  async function syncPlayersCount() {
    try {
      var n = usedPlayers();
      if (n === lastSyncedPlayers) return;
      var lid = window._getLeagueId();
      if (!lid || !window._firestoreSetDoc) return;
      await window._firestoreSetDoc(
        window._firestoreDoc(window._db, 'leagues', lid), { playersCount: n }, { merge: true });
      lastSyncedPlayers = n;
    } catch (e) {}
  }

  function wrap(name, kind, argN) {
    var t = 0;
    var iv = setInterval(function () {
      t++;
      if (typeof window[name] === 'function') {
        clearInterval(iv);
        var orig = window[name];
        window[name] = async function () {
          var n = argN ? (arguments[argN] || 1) : 1;
          var msg = block(kind, n);
          if (msg) { await deny(msg); return; }
          var r = await orig.apply(this, arguments);
          setTimeout(function () { flagSuper(); clearFlag(); render(); syncPlayersCount(); }, 400);
          return r;
        };
      } else if (t > 400) clearInterval(iv);
    }, 60);
  }

  ready(function () {
    /* أ) منع تجاوز الحدّ */
    wrap('addTeam',            'team');     /* إضافة فريق */
    wrap('addRosterPlayer',    'player');   /* إضافة لاعب للكشف */
    wrap('savePlayerProfile',  'player');   /* حفظ ملف لاعب */

    /* ب) قسم الاشتراك يُرسم عند فتحه */
    var orig = window.showPage;
    window.showPage = function (name) {
      var r = orig.apply(this, arguments);
      try { if (name === 'set-sub') render(); } catch (e) {}
      return r;
    };

    /* ج) فحص دوريّ خفيف — يرفع الراية لو تجاوزت الحصّة بطريق آخر */
    setTimeout(function () { flagSuper(); clearFlag(); }, 4000);
    setInterval(function () { flagSuper(); clearFlag(); }, 120000);

    /* د) إشعار زيادة الحصّة يظهر فور الدخول للوحة، مو بس عند فتح
          قسم الاشتراك تحديداً — العميل يستحق يعرف فوراً. */
    setTimeout(function () { checkQuotaBoost(); }, 2500);

    /* هـ) مزامنة أولية لعدد اللاعبين (تفيد نافذة السوبر أدمن) */
    setTimeout(function () { syncPlayersCount(); }, 5000);
  });

  console.log('[subscription-quota] v338 ✅');
})();
