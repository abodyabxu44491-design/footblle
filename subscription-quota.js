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

  var GOLD = '#C9A02B', GOLD2 = '#F0C84A';

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
      '.sq-pill.ok{color:#2E9E5B;border-color:rgba(46,158,91,.4);background:rgba(46,158,91,.1)}',
      '.sq-pill.warn{color:#D9A21B;border-color:rgba(217,162,27,.4);background:rgba(217,162,27,.1)}',
      '.sq-pill.bad{color:#e07070;border-color:rgba(192,57,43,.4);background:rgba(192,57,43,.1)}',
      '.sq-dates{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px}',
      '.sq-date{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);',
      ' border-radius:11px;padding:10px 12px}',
      '.sq-date span{display:block;font-size:10px;color:#6a7080;font-weight:700}',
      '.sq-date b{display:block;font-size:13.5px;font-weight:900;color:#e6e8ec;margin-top:2px}',
      '.sq-bars{display:flex;flex-direction:column;gap:13px}',
      '.sq-bar-h{display:flex;align-items:center;gap:8px;margin-bottom:7px}',
      '.sq-bar-h .ic{font-size:15px}',
      '.sq-bar-h .l{font-size:13px;font-weight:800;color:#e6e8ec}',
      '.sq-bar-h .v{margin-inline-start:auto;font-size:12.5px;font-weight:900;',
      ' font-variant-numeric:tabular-nums}',
      '.sq-track{height:10px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}',
      '.sq-fill{height:100%;border-radius:99px;transition:width .5s cubic-bezier(.16,1,.3,1)}',
      '.sq-left{font-size:10.5px;color:#6a7080;font-weight:700;margin-top:5px}',
      '.sq-left b{font-weight:900}',
      '.sq-warn{display:flex;align-items:flex-start;gap:10px;padding:13px 15px;border-radius:13px;',
      ' background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.3);margin-top:13px}',
      '.sq-warn b{display:block;font-size:13px;font-weight:900;color:#e07070;margin-bottom:3px}',
      '.sq-warn span{font-size:11.5px;color:#9aa0aa;line-height:1.85}',
      '.sq-wa{display:inline-flex;align-items:center;gap:7px;margin-top:10px;padding:10px 18px;',
      ' border-radius:11px;background:rgba(37,211,102,.1);border:1px solid rgba(37,211,102,.35);',
      ' color:#25D366;font-size:12.5px;font-weight:900;cursor:pointer;font-family:Tajawal,sans-serif}',
      '.sq-note{font-size:11px;color:#6a7080;line-height:1.9;margin-top:12px;padding:11px 13px;',
      ' border-radius:11px;background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.055)}'
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
        '<span class="v" style="color:#2E9E5B">بلا حدّ</span></div>' +
        '<div class="sq-track"><div class="sq-fill" style="width:100%;' +
        'background:linear-gradient(90deg,#2E9E5B,#4ade80);opacity:.35"></div></div>' +
        '<div class="sq-left">أُضيف <b>' + ar(used) + '</b> ' + unit + '</div></div>';
    }
    var pct = Math.min(100, used / max * 100);
    var left = Math.max(0, max - used);
    var col = pct >= 100 ? ['#C0392B', '#e07070']
            : pct >= 80  ? ['#D9A21B', '#F0C84A']
            : ['#2E9E5B', '#4ade80'];
    return '<div><div class="sq-bar-h"><span class="ic">' + icon + '</span>' +
      '<span class="l">' + label + '</span>' +
      '<span class="v" style="color:' + col[1] + '">' + ar(used) + ' / ' + ar(max) + '</span></div>' +
      '<div class="sq-track"><div class="sq-fill" style="width:' + pct.toFixed(1) + '%;' +
      'background:linear-gradient(90deg,' + col[0] + ',' + col[1] + ')"></div></div>' +
      '<div class="sq-left">' + (left
        ? ('يتبقّى <b style="color:' + col[1] + '">' + ar(left) + '</b> ' + unit)
        : '<b style="color:#e07070">استُنفدت الحصّة</b>') + '</div></div>';
  }

  function daysLeft(end) {
    if (!end) return null;
    var d = Math.ceil((new Date(end) - new Date()) / 86400000);
    return isNaN(d) ? null : d;
  }

  function render() {
    var host = document.getElementById('page-set-sub');
    if (!host) return;
    css();
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

    host.innerHTML =
      '<div class="set-back" onclick="showPage(\'settings\',null)"><span>›</span> الإعدادات</div>' +
      '<div class="page-header"><div class="page-title">💳 الاشتراك</div>' +
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
            '<span class="v" style="color:' + (s.L.photos ? '#2E9E5B' : '#6a7080') + '">' +
              (s.L.photos ? 'مفعّلة' : 'غير مفعّلة') + '</span></div>' +
            '<div class="sq-left">' + (s.L.photos
              ? ('أُضيف <b>' + ar(s.photos) + '</b> صورة')
              : 'غير متاحة في اشتراكك الحالي') + '</div></div>' +
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
          '<b style="color:#D9A21B">اقتربت من الحدّ</b>' +
          '<span>تبقّى أقلّ من ٢٠٪ من حصّتك. لو تتوقّع زيادة، اطلبها قبل أن تحتاجها.</span>' +
          '<button class="sq-wa" onclick="window.open(\'' + waLink(msg) + '\',\'_blank\')">' +
          '💬 طلب زيادة</button></div></div>'
        : '') +

      '<div class="sq-note">ℹ️ الحصّة تُزاد في أي وقت بلا إعادة إنشاء ولا فقدان بيانات — ' +
      'يُحسب <b style="color:#e6e8ec">الفرق فقط</b> للمدة المتبقّية من اشتراكك.</div>' +
      '</div>';
  }
  function dcard(l, v) {
    return '<div class="sq-date"><span>' + l + '</span><b>' + esc(v) + '</b></div>';
  }
  window.SubQuota.render = render;

  /* ─────────────────────────────────────────────────────────────
     ⑥ الربط: المنع عند الإضافة + إعادة الرسم
     ───────────────────────────────────────────────────────────── */
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
          setTimeout(function () { flagSuper(); clearFlag(); render(); }, 400);
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
  });

  console.log('[subscription-quota] v338 ✅');
})();
