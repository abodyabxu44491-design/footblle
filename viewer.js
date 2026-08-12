// ═══════════════════════════════════════════════════════
//  منصة البطولات — viewer.js
//  نسخة محسّنة: تفاصيل المباراة + تشكيلات ديناميكية Firebase
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
/* ✅︎ أداء: analytics و messaging كانا يُستوردان ثابتاً (~90KB) فيؤخّران
   ظهور الصفحة على كل زائر. analytics لا يُستخدم إطلاقاً (getAnalytics فقط)،
   و messaging لا يُحتاج إلا عند الضغط على زر الإشعارات.
   الآن: تحميل كسول — لا يلمس المسار الحرج. */
let _msgMod = null;
async function _loadMessaging() {
  if (!_msgMod) {
    _msgMod = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js");
  }
  return _msgMod;
}

const firebaseConfig = {
  apiKey: "AIzaSyDdn-sS67sthhLrZRrIDZ6ynauWVin_WNU",
  authDomain: "footblle2.firebaseapp.com",
  projectId: "footblle2",
  storageBucket: "footblle2.firebasestorage.app",
  messagingSenderId: "541343956211",
  appId: "1:541343956211:web:a1d757a4ecd655d3e47da8",
  measurementId: "G-E56JDRY7S1"
};
const app = initializeApp(firebaseConfig);
/* ⚡ كاش محلي دائم: يجعل onSnapshot يقرأ فوراً من القرص عند إعادة الفتح
   (بما فيه شعارات الفرق base64) ثم يزامن في الخلفية — فتحميل شبه فوري
   في الزيارات المتكررة بدل انتظار الشبكة. مع fallback آمن. */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  db = getFirestore(app);
}
/* analytics بعد اكتمال الرسم — لا يؤخّر أول ظهور */
(function () {
  var go = function () {
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js")
      .then(function (m) { try { m.getAnalytics(app); } catch (e) {} })
      .catch(function () {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 6000 });
  else setTimeout(go, 4000);
})();

// ══ STATE ══
const params   = new URLSearchParams(location.search);
const LEAGUE_ID = params.get('id') || '';

// 🔗 فتح مباراة محددة من الرابط (?id=..&match=..) — مرة واحدة فقط
let _deepLinkOpened = false;
function _maybeOpenDeepLinkMatch() {
  if (_deepLinkOpened) return;
  const mid = params.get('match');
  if (!mid) return;
  const found = (window.matches || []).some(x => x.id === mid);
  if (!found) return; // ننتظر تحميل المباريات
  _deepLinkOpened = true;
  try { if (typeof openMatchDetail === 'function') openMatchDetail(mid); } catch(e){}
}
const SITE_URL  = location.origin + location.pathname.replace(/\/[^/]*$/, '/');

// ══ حماية من حقن HTML في بيانات المنظّم (XSS) ══
// أسماء الفرق/اللاعبين/البطولة تُعرض عبر innerHTML في عشرات المواضع.
// بدل تعديل كل موضع، نُصفّي الحقول النصية عند مصدرها (لحظة القراءة من
// Firestore). نُزيل أقواس الوسوم فقط — يبقى النص طبيعياً ولا يُنفَّذ كـ HTML.
function _stripTags(v) {
  return typeof v === 'string' ? v.replace(/[<>]/g, '') : v;
}
// حقول نصية يكتبها المنظّم وقد تُعرض كـ HTML
const _TEXT_FIELDS = ['name', 'shortName', 'coach', 'stadium', 'city',
  'group', 'title', 'label', 'note', 'notes', 'scorer', 'player',
  'playerName', 'assist', 'reason', 'season'];
function _sanitizeDoc(o) {
  if (!o || typeof o !== 'object') return o;
  _TEXT_FIELDS.forEach(k => { if (k in o) o[k] = _stripTags(o[k]); });
  // اللاعبون داخل الفريق (roster) وأحداث المباراة
  if (Array.isArray(o.roster)) o.roster.forEach(_sanitizeDoc);
  if (Array.isArray(o.players)) o.players.forEach(_sanitizeDoc);
  if (Array.isArray(o.scorers)) o.scorers.forEach(_sanitizeDoc);
  if (Array.isArray(o.events)) o.events.forEach(_sanitizeDoc);
  return o;
}
window._sanitizeDoc = _sanitizeDoc;

let league   = null;
let teams    = [];
let matches  = [];
let groups   = [];
let knockoutRounds = [];

function formatTimeTo12H(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// ── مصدر أحداث المباراة الموحّد ──
// «الإدخال السريع» يحفظ الأحداث في m.events (أعلى مستوى الوثيقة)،
// بينما صفحة البث المباشر تحفظها في m.liveData.events. أي كود يعرض
// أحداث المباراة (الخط الزمني، ملف اللاعب، الهدافون) يجب يقرأ من
// هذه الدالة حتى لا تختفي أهداف المباريات المُدخَلة عبر الإدخال السريع.
function _matchEvents(m) {
  if (!m) return [];
  const live = m.liveData && Array.isArray(m.liveData.events) ? m.liveData.events : [];
  if (live.length) return live;
  return Array.isArray(m.events) ? m.events : [];
}
// ── جهة الفريق في الحدث ── بعض الأنظمة تكتب `team` وبعضها `side`
function _evSide(ev) {
  return (ev && (ev.team || ev.side)) || 'home';
}

/* ✅ FIX: اسم الهدّاف الحيّ من الكشف (لو الحدث مربوط بـ playerId ومحمَّل
 * الكشف عند الجمهور)، وإلا نرجع للنص المجمَّد وقت تسجيل الهدف.
 * ملاحظة: البطاقات/التبديلات/التشكيلات لا تحمل playerId إطلاقاً حالياً،
 * فهذه الدالة مفيدة فقط لأحداث النوع 'goal'. */
/* ═══════════════════════════════════════════════════════════════════
 *  نظام أسماء اللاعبين — مصدر واحد موثوق + تحديث حيّ فوري
 *  ───────────────────────────────────────────────────────────────────
 *  المصدر الوحيد للاسم الحالي: كشف الفريق في قاعدة البيانات
 *  (leagues/{id}/teams/{teamId}/roster) مُزامَن حيّاً في window._teamRosters.
 *  كل نقاط العرض (هدّافون، بطاقات، أحداث، تبديلات، تشكيلات، نافذة اللاعب)
 *  تحلّ الاسم عبر _pName(teamId, playerId) — لا مصادر منافسة، لا تعارض.
 *  عند تعديل المنظّم للاسم والضغط على حفظ → onSnapshot يُحدّث الكشف →
 *  إعادة رسم مُجمّعة → الاسم الجديد يظهر فوراً في كل مكان.
 * ═══════════════════════════════════════════════════════════════════ */

window._teamRosters   = window._teamRosters   || {};
window._rosterListeners = window._rosterListeners || {};

// ✅ المُحلّل الموحّد: الاسم الحالي للاعب حسب هويته من الكشف الحيّ.
//    يرجع fallback (النص المخزَّن وقت الحدث) إذا لا هوية أو الكشف لم يصل بعد.
function _pName(teamId, playerId, fallback) {
  fallback = fallback || '';
  if (!playerId) return fallback;
  const roster = window._teamRosters && window._teamRosters[teamId];
  if (!roster || !roster.length) return fallback;
  const p = roster.find(x => x && x.id === playerId);
  return (p && p.name) ? p.name : fallback;
}
window._pName = _pName;

// اسم لاعب حدث (هدف/بطاقة) — يحلّ عبر ev.playerId
function _liveEventPlayerName(ev, teamId) {
  if (!ev) return '';
  return _pName(teamId, ev.playerId, ev.player || '');
}

// اسم أحد طرفَي التبديل. which = 'in' (الداخل) أو 'out' (الخارج).
function _liveSubName(ev, teamId, which) {
  if (!ev) return '';
  const isIn = which === 'in';
  const fallback = isIn ? (ev.playerIn || ev.player2 || '') : (ev.playerOut || ev.player || '');
  const pid = isIn ? (ev.playerInId || ev.player2Id || null)
                   : (ev.playerOutId || ev.playerId || null);
  return _pName(teamId, pid, fallback);
}

// إعادة رسم مُجمّعة (debounce) — تُستدعى عند وصول/تحديث أي كشف كي لا يومض
// أثناء تحميل عدة كشوف دفعة واحدة، وتحدّث كل الأقسام المرئية مرة واحدة.
window._scheduleNameRerender = function () {
  if (window._rosterRerenderT) clearTimeout(window._rosterRerenderT);
  window._rosterRerenderT = setTimeout(() => {
    try { if (typeof renderScorers === 'function') renderScorers(); } catch (e) {}      // الرئيسية + الإحصائيات
    try {
      const ov = document.getElementById('matchDetailOverlay');
      if (ov && ov.classList.contains('show') && window._lastMatchDetailId && typeof openMatchDetail === 'function') {
        openMatchDetail(window._lastMatchDetailId);                                        // خط الأحداث + التشكيلات
      }
    } catch (e) {}
    try {
      const tp = document.getElementById('teamProfileOverlay');
      if (tp && tp.style.display !== 'none' && window._lastTeamProfileId && typeof openTeamProfile === 'function') {
        openTeamProfile(window._lastTeamProfileId);                                        // صفحة الفريق
      }
    } catch (e) {}
    try {
      // نافذة إحصائيات اللاعب المفتوحة → تُعاد بالاسم الحيّ (الهوية تُبقيها على نفس اللاعب)
      const pm = document.getElementById('playerModalOverlay');
      if (pm && pm.classList.contains('open') && window._lastPlayerModal && typeof openPlayerModal === 'function') {
        const a = window._lastPlayerModal;
        openPlayerModal(a.playerName, a.teamId, a.playerId);
      }
    } catch (e) {}
  }, 100);
};

// المستمع الحيّ الوحيد لكشف كل فريق. آمن ضد الاستدعاء المتكرر (لا يُنشئ مستمعاً مكرراً).
function _ensureRosterLoaded(teamId, onLoaded) {
  if (!teamId) return;
  window._teamRosters = window._teamRosters || {};
  if (window._rosterListeners[teamId]) {
    if (window._teamRosters[teamId] && window._teamRosters[teamId].length && typeof onLoaded === 'function') onLoaded();
    return;
  }
  window._teamRosters[teamId] = window._teamRosters[teamId] || [];
  const _applyOnce = (list) => {
    window._teamRosters[teamId] = list;
    window._scheduleNameRerender();
    if (typeof onLoaded === 'function') onLoaded();
  };
  try {
    window._rosterListeners[teamId] = onSnapshot(
      query(collection(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster'), orderBy('number', 'asc')),
      snap => {
        const list = [];
        snap.forEach(dd => list.push(_sanitizeDoc({ id: dd.id, ...dd.data() })));
        _applyOnce(list);
      },
      () => {}
    );
  } catch (e) {
    getDocs(query(collection(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster'), orderBy('number', 'asc')))
      .then(snap => { const l = []; snap.forEach(dd => l.push(_sanitizeDoc({ id: dd.id, ...dd.data() }))); _applyOnce(l); })
      .catch(() => {});
  }
}

let settings = { winPts:3, drawPts:1, zones:{ champion:1, qualify:2, cond:1, normal:0, playoff:1, relegate:1 }, bracketPublished: false, tiebreakOrder: ['gd','gf','h2h','wins','cards','draw'] };
window.settings = settings;
let matchFilter   = 'all';
let searchQuery   = '';
let countdownInterval = null;
let tournamentType = 'league';

// متتبّع الأهداف — يعمل per-match الآن
let _lastScores = {}; // matchId → {h, a}
let _lastExtra  = {}; // matchId → "phase:mins:set" آخر حالة بدل ضائع تم إشعار الجمهور بها

// ── كشف البيانات على window ─────────────────────────────────────
// ضروري: ES module لا يكشف المتغيرات المحلية على window تلقائياً
Object.defineProperty(window, 'matches', { get: () => matches, configurable: true });
Object.defineProperty(window, 'teams',   { get: () => teams,   configurable: true });
Object.defineProperty(window, 'groups',  { get: () => groups,  configurable: true });

const ZONE_COLORS = ['var(--gold)', 'var(--green)', 'var(--blue)', '#666', 'var(--orange)', 'var(--red)'];
const ZONE_KEYS   = ['champion','qualify','cond','normal','playoff','relegate'];
const ZONE_NAMES  = ['المتوج 🏆','متأهل ✅︎','مشروط 🔵','عادي ⚪','ملعب الهبوط 🟠','هابط 🔴'];

// FORMATION_POSITIONS / getDynamicPositions أُزيلا: كانا يخدمان نظام openLineup القديم
// (غير مستخدم إطلاقاً — كل عرض التشكيلة الفعلي يستخدم إحداثيات x/y المحفوظة لكل لاعب)

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
// ⚡ توليد مانيفست ديناميكي لكل بطولة (اسمها + شعارها + رابط بدء صحيح)
// يقبل استدعاءً مبكّراً بـ id فقط (قبل تحميل Firebase) لضمان أن التثبيت
// السريع يلتقط start_url صحيحاً، ثم يُحدَّث بالاسم/الشعار لاحقاً.
function _installDynamicManifest(league) {
  try {
    const id = LEAGUE_ID;
    if (!id) return;
    const name = (league && league.name) ? String(league.name) : 'بطولة';
    const base = location.pathname.replace(/[^/]*$/, '') || './';
    const startUrl = `${base}league-viewer.html?id=${encodeURIComponent(id)}&source=pwa`;
    const scope = `${base}league-viewer.html?id=${encodeURIComponent(id)}`;

    // أيقونة التطبيق = شعار البطولة إن كان صورة، وإلا أيقونة المنصة
    const logoIsImg = league && league.logo &&
      (String(league.logo).startsWith('data:') || String(league.logo).startsWith('http'));
    const icons = logoIsImg
      ? [
          { src: league.logo, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: league.logo, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ];

    const manifest = {
      id: `/league-viewer.html?id=${id}`,
      name: name,
      short_name: name.length > 12 ? name.slice(0, 12) : name,
      description: `تابع بطولة ${name} مباشرة`,
      start_url: startUrl,
      scope: scope,
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      background_color: '#080808',
      theme_color: '#080808',
      orientation: 'portrait-primary',
      lang: 'ar', dir: 'rtl',
      icons: icons,
      categories: ['sports', 'entertainment'],
      prefer_related_applications: false,
    };

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
    link.setAttribute('href', url);

    // عنوان الصفحة أيضاً = اسم البطولة (يظهر في التطبيق وسجل المتصفح)
    document.title = name;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', name);
    else {
      const mt = document.createElement('meta');
      mt.name = 'apple-mobile-web-app-title'; mt.content = name;
      document.head.appendChild(mt);
    }
  } catch (e) { /* تجاهل بصمت — المانيفست الثابت يبقى بديلاً */ }
}

async function init() {
  if(!LEAGUE_ID) {
    // كل بطولة مستقلة في المتصفح. لكن داخل التطبيق المثبّت (standalone) فقط:
    // نستعيد بطولة التطبيق المحفوظة لحظة تثبيته — فلا يخرب الرابط أبداً.
    const _standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || navigator.standalone === true
      || new URLSearchParams(location.search).get('source') === 'pwa';
    let _appLeague = '';
    try { _appLeague = localStorage.getItem('installedLeagueId') || ''; } catch(e){}
    if (_standalone && /^[A-Za-z0-9_-]{3,}$/.test(_appLeague)) {
      location.replace('league-viewer.html?id=' + encodeURIComponent(_appLeague) + '&source=pwa');
      return;
    }
    showError('رابط غير صحيح', 'لم يتم تحديد البطولة. افتح رابط البطولة الكامل من المنظّم.');
    return;
  }

  /* ⚡ التحميل الأولي مع صمود أمام ضعف الشبكة:
     كان فشل الاتصال يرمي خطأً غير معالَج فتبقى الصفحة فارغة/عالقة.
     الآن نُعيد المحاولة تلقائياً بفواصل متزايدة. */
  let leagueDoc, settDoc;
  try {
    [leagueDoc, settDoc] = await Promise.all([
      getDoc(doc(db,'leagues',LEAGUE_ID)),
      getDoc(doc(db,'leagues',LEAGUE_ID,'config','settings')),
    ]);
  } catch (e) {
    window._initTries = (window._initTries || 0) + 1;
    if (window._initTries <= 5) {
      setTimeout(init, Math.min(2000 * window._initTries, 10000));
      return;
    }
    showError('تعذّر الاتصال', 'تحقّق من الإنترنت وأعد فتح الصفحة.');
    return;
  }
  window._initTries = 0;

  if(!leagueDoc.exists()) { showError('البطولة غير موجودة'); return; }
  league = _sanitizeDoc({id: leagueDoc.id, ...leagueDoc.data()});

  // احفظ معرّف هذه البطولة — يُستعاد داخل التطبيق المثبّت فقط لو فُتح بلا id.
  // (لا يؤثر على زوّار المتصفح لأن الاستعادة مشروطة بوضع standalone.)
  try { localStorage.setItem('installedLeagueId', LEAGUE_ID); } catch(e){}

  // فور معرفة شعار البطولة: اعرضه في شاشة التحميل بدل أيقونة المنصة العامة
  if (league.logo) {
    const _pl = document.getElementById('plLogo');
    if (_pl) _pl.src = league.logo;
  }

  // ⚡ مانيفست ديناميكي: اسم التطبيق = اسم البطولة، ورابط البدء يحمل معرّفها
  // (يمنع "الرابط غير صحيح" عند فتح التطبيق المثبّت، لأنه يفتح البطولة مباشرة)
  _installDynamicManifest(league);

  if(league.status === 'suspended') { showError('البطولة موقوفة مؤقتاً','هذه البطولة موقوفة حالياً. تابعنا لاحقاً.'); return; }

  updateHeader();
  if(settDoc.exists()) settings = {...settings, ...settDoc.data()};
  window.settings = settings;
  tournamentType = settings.type || league.type || 'league';
  adaptUIToType();

  // استمع لتغيّرات الإعدادات (bracketPublished وغيرها) بشكل لحظي
  onSnapshot(doc(db,'leagues',LEAGUE_ID,'config','settings'), snap => {
    if(snap.exists()) {
      settings = {...settings, ...snap.data()};
      window.settings = settings;
      if (typeof window._spRender === 'function') window._spRender();
      adaptUIToType();
      renderKnockoutBracket();
      if (typeof renderStats === 'function') renderStats();
    }
  }, ()=>{});

  let teamsLoaded = false, matchesLoaded = false;
  const checkHide = () => { if(teamsLoaded && matchesLoaded) hideLoader(); };

  /* ⚡ صمود أمام ضعف الشبكة:
     عند فشل المستمع لا نمسح البيانات المعروضة ولا نترك الصفحة فارغة —
     نُبقي آخر نسخة ونُعيد الاشتراك تلقائياً بفواصل متزايدة حتى يعود
     الاتصال. (كان الفشل يترك المباريات فارغة بلا أي محاولة استرجاع.) */
  window._vwRetries = window._vwRetries || {};
  function _resilient(key, build, apply, maxDelay) {
    maxDelay = maxDelay || 30000;
    let stop = null;
    const start = () => {
      try {
        stop = onSnapshot(build(), snap => {
          window._vwRetries[key] = 0;
          apply(snap);
        }, () => {
          const n = (window._vwRetries[key] = (window._vwRetries[key] || 0) + 1);
          if (key === 'teams')   { teamsLoaded = true; }
          if (key === 'matches') { matchesLoaded = true; }
          checkHide();
          const delay = Math.min(2000 * n, maxDelay);
          setTimeout(() => { try { stop && stop(); } catch(e){} start(); }, delay);
        });
      } catch (e) {
        setTimeout(start, 5000);
      }
    };
    start();
  }

  _resilient('teams',
    () => collection(db,'leagues',LEAGUE_ID,'teams'),
    snap => {
      teams = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()}));
      teamsLoaded = true; window.renderAll(); checkHide();
      // ✅︎ ابدأ مستمعي كشوف كل الفرق فوراً — كي ينعكس تعديل أي اسم لاعب
      //    مباشرةً في كل مكان (الهدّافون، البطاقات، الأحداث، التشكيلات، الرئيسية)
      //    دون انتظار فتح تبويب أو مباراة.
      try {
        (teams || []).forEach(t => {
          if (t && t.id && typeof _ensureRosterLoaded === 'function') _ensureRosterLoaded(t.id);
        });
      } catch (e) {}
    });

  _resilient('matches',
    () => query(collection(db,'leagues',LEAGUE_ID,'matches'), orderBy('round'), orderBy('date')),
    snap => {
      matches = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()}));
      matches.sort((a,b)=>(a.round||0)-(b.round||0)||(a.date||'').localeCompare(b.date||''));
      matchesLoaded = true; window.renderAll(); checkHide();
      // 🔗 رابط مباراة مباشر: افتح المباراة المحددة في الرابط تلقائياً (مرة واحدة)
      _maybeOpenDeepLinkMatch();
    });

  onSnapshot(collection(db,'leagues',LEAGUE_ID,'groups'), snap => {
    groups = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if(tournamentType==='groups') window.renderAll();
  }, ()=>{});

  onSnapshot(collection(db,'leagues',LEAGUE_ID,'knockoutRounds'), snap => {
    knockoutRounds = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if(tournamentType==='knockout'||tournamentType==='groups') window.renderAll();
  }, ()=>{});

  // ✅︎ البث الجديد: يُقرأ من matches/{matchId}.liveData — لا يحتاج onSnapshot مستقل
}

function showError(title, msg) {
  hideLoader();
  const ep = document.getElementById('errorPage');
  if(!ep) return;
  ep.style.display = 'flex';
  const divs = ep.querySelectorAll('div');
  if(divs[1]) divs[1].textContent = title;
  if(divs[2] && msg) divs[2].textContent = msg;
}

function hideLoader() {
  const l = document.getElementById('pageLoader');
  if(!l) return;
  l.classList.add('out');
  setTimeout(()=>l.style.display='none',500);
}

// ════════════════════════════════════════
//  HEADER
// ════════════════════════════════════════
function updateHeader() {
  if(!league) return;
  const name = league.name || 'البطولة';
  document.title = name + ' — منصة بطولات';
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', name);
  const el = n => document.getElementById(n);
  if(el('leagueName')) el('leagueName').textContent = name;
  /* ✅︎ شعار البطولة فوق الاسم — مصدره إعدادات الإدارة (leagues/{id}.logo) */
  const _lw = el('leagueLogoWrap'), _li = el('leagueLogoImg');
  if (_lw && _li) {
    if (league.logo) { _li.src = league.logo; _lw.style.display = 'flex'; }
    else { _lw.style.display = 'none'; }
  }
  if(el('leagueSeason')) el('leagueSeason').textContent = league.season || '2025';
  const statusMap = {active:'🟢 جارية', archived:'🏁 منتهية', suspended:'🔴 موقوفة', draft:'⚪ مسودة'};
  if(el('leagueStatus')) el('leagueStatus').textContent = statusMap[league.status]||'🟢 جارية';
  const typeMap = {league:'دوري نقاط', groups:'مجموعات', knockout:'كأس إقصائي'};
  if(el('leagueType')) el('leagueType').textContent = typeMap[league.type]||'دوري نقاط';
}

// ════════════════════════════════════════
//  LOGO HELPER
// ════════════════════════════════════════
function logoHtml(logo, size=32, radius=8) {
  if(!logo) return `<span style="font-size:${size}px">⚽︎</span>`;
  if(logo.startsWith('data:')||logo.startsWith('http')||logo.startsWith('/')) {
    return `<img src="${logo}" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:cover;display:inline-block;vertical-align:middle" onerror="this.style.display='none'"/>`;
  }
  return `<span style="font-size:${size}px;line-height:1">${logo}</span>`;
}

// ════════════════════════════════════════
//  RENDER ALL
// ════════════════════════════════════════
function renderAll() {
  _syncGlobals();
  updateStats();
  updateLiveBanner();
  updateLastSeen();

  if(tournamentType==='knockout') {
    renderKnockoutBracket();
    renderHomeKnockout();
  } else if(tournamentType==='swiss') {
    // الدوري الموحّد: جدول ترتيب واحد + شجرة إقصاء
    if (typeof window.renderStandings === 'function') window.renderStandings();
    renderHomeSection();
    renderKnockoutBracket();
  } else if(tournamentType==='groups') {
    renderGroupsStandings();
    renderKnockoutBracket();
    renderHomeGroups();
    // ✅︎ FIX §1: لا نعرض جدول الترتيب العام في نظام المجموعات
    // window.renderStandings() خاص بنظام الدوري فقط

  } else {
    if (typeof window.renderStandings === 'function') window.renderStandings();
    renderHomeSection();
  }


  if (typeof renderScorers === 'function') renderScorers();
  renderTeamsGrid();
  if (typeof renderMatches === 'function') renderMatches(matchFilter);
  renderChart();
  renderSummaryStats();
}
// ✅︎ تصدير — بدونه كان _origRA في الـpatch أدناه = undefined
//    فلا تعمل updateStats/updateLiveBanner/renderStandings إطلاقاً.
window.renderAll = renderAll;

// ════════════════════════════════════════
//  STATS BAR — أُزيل شريط الإحصائيات من واجهة الجمهور بطلب الإدارة.
//  أُبقيت الدالة كـ no-op حتى لا ينكسر استدعاؤها من renderAll().
// ════════════════════════════════════════
function updateStats() {}

function updateLastSeen() {
  const el = document.getElementById('standingsSub');
  if(el) el.textContent = 'آخر تحديث ' + new Date().toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',hour12:true});
}

// ════════════════════════════════════════
//  LIVE BANNER (أعلى الصفحة)
// ════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  SMART BANNER — مباشر / على وشك البدء / قادمة
// ══════════════════════════════════════════════════════
let _bannerCdInterval = null; // عداد البنر التنازلي

function updateLiveBanner() {
  const banner = document.getElementById('smartBanner');
  if(!banner) return;

  const liveMatches    = matches.filter(m => m.status === 'live');
  const upcomingAll    = matches.filter(m => m.status === 'upcoming' || (m.status === 'pending' && m.homeId && m.awayId))
    .sort((a,b)=>(a.round||0)-(b.round||0)||(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||''));
  const nextMatch      = upcomingAll[0] || null;

  clearInterval(_bannerCdInterval);

  // ── حالة 1: في مباراة مباشرة ──────────────────────
  if(liveMatches.length > 0) {
    const live = liveMatches[0];
    const ht = teams.find(t=>t.id===live.homeId)||{name:live.homeName||'?',logo:live.homeLogo||''};
    const at = teams.find(t=>t.id===live.awayId)||{name:live.awayName||'?',logo:live.awayLogo||''};
    const extra = liveMatches.length > 1 ? `<span class="sb-extra-badge">+${liveMatches.length-1} مباراة</span>` : '';
    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="sb-live" onclick="switchTab('live',null,document.getElementById('bn-live'))">
        <span class="sb-live-dot"></span>
        <div class="sb-live-teams">
          ${logoHtml(ht.logo,20,5)}
          <span class="sb-live-name">${ht.name}</span>
          <span class="sb-live-score">${live.homeScore??0} - ${live.awayScore??0}</span>
          <span class="sb-live-name">${at.name}</span>
          ${logoHtml(at.logo,20,5)}
        </div>
        ${extra}
        <span class="sb-live-arrow">←</span>
      </div>`;
    return;
  }

  // ── حالة 2 + 3: لا يوجد بث — نحسب وقت المباراة القادمة ──
  if(!nextMatch) { banner.style.display = 'none'; return; }

  const ht = teams.find(t=>t.id===nextMatch.homeId)||{name:nextMatch.homeName||'?',logo:nextMatch.homeLogo||''};
  const at = teams.find(t=>t.id===nextMatch.awayId)||{name:nextMatch.awayName||'?',logo:nextMatch.awayLogo||''};

  function getTargetTime() {
    if(!nextMatch.date) return null;
    const [y,mo,d] = nextMatch.date.split('-').map(Number);
    const [h,mi]   = (nextMatch.time||'00:00').split(':').map(Number);
    const t = new Date(y, mo-1, d, h, mi, 0, 0);
    return isNaN(t.getTime()) ? null : t;
  }

  const target = getTargetTime();
  if(!target) { banner.style.display = 'none'; return; }

  const fmtN = n => String(n).padStart(2,'0');

  function renderBanner() {
    const diff = target - new Date();

    // ── حالة 3: على وشك البدء (أقل من 5 دقائق أو وقت مر) ──
    if(diff <= 5 * 60 * 1000) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <div class="sb-kickoff" onclick="openMatchDetail('${nextMatch.id}')">
          <span class="sb-kickoff-pulse"></span>
          <div class="sb-kickoff-teams">
            ${logoHtml(ht.logo,22,5)}
            <span class="sb-kickoff-name">${ht.name}</span>
            <span class="sb-kickoff-vs">على وشك البدء</span>
            <span class="sb-kickoff-name">${at.name}</span>
            ${logoHtml(at.logo,22,5)}
          </div>
        </div>`;
      // لما يصير الوقت المباراة ونبقى ننتظر من الأدمن، نوقف العداد
      if(diff <= 0) clearInterval(_bannerCdInterval);
      return;
    }

    // ── حالة 2: عداد تنازلي للمباراة القادمة ──
    const D = Math.floor(diff/86400000);
    const H = Math.floor((diff%86400000)/3600000);
    const M = Math.floor((diff%3600000)/60000);
    const S = Math.floor((diff%60000)/1000);

    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="sb-upcoming" onclick="openMatchDetail('${nextMatch.id}')">
        <div class="sb-upcoming-left">
          <div class="sb-upcoming-label">⏳ المباراة القادمة</div>
          <div class="sb-upcoming-teams">
            ${logoHtml(ht.logo,18,4)}
            <span>${ht.name}</span>
            <span class="sb-upcoming-vs">×</span>
            <span>${at.name}</span>
            ${logoHtml(at.logo,18,4)}
          </div>
          <div class="sb-upcoming-meta">ج${nextMatch.round||'?'} · ${nextMatch.date||''} ${nextMatch.time?formatTimeTo12H(nextMatch.time):''}</div>
        </div>
        <div class="sb-countdown">
          ${D>0?`<div class="sb-cd-unit"><div class="sb-cd-num">${fmtN(D)}</div><div class="sb-cd-lbl">يوم</div></div>`:''}
          <div class="sb-cd-unit"><div class="sb-cd-num" id="sbc-h">${fmtN(H)}</div><div class="sb-cd-lbl">ساعة</div></div>
          <div class="sb-cd-unit"><div class="sb-cd-num" id="sbc-m">${fmtN(M)}</div><div class="sb-cd-lbl">دقيقة</div></div>
          <div class="sb-cd-unit"><div class="sb-cd-num" id="sbc-s">${fmtN(S)}</div><div class="sb-cd-lbl">ثانية</div></div>
        </div>
      </div>`;
  }

  // عرض فوري ثم تحديث كل ثانية
  renderBanner();
  _bannerCdInterval = setInterval(() => {
    const diff = target - new Date();
    // تحديث الأرقام فقط إذا البنر نوعه countdown (لا kickoff)
    if(diff > 5*60*1000) {
      const H = Math.floor((diff%86400000)/3600000);
      const M = Math.floor((diff%3600000)/60000);
      const S = Math.floor((diff%60000)/1000);
      const eh = document.getElementById('sbc-h');
      const em = document.getElementById('sbc-m');
      const es = document.getElementById('sbc-s');
      if(eh) eh.textContent = fmtN(H);
      if(em) em.textContent = fmtN(M);
      if(es) es.textContent = fmtN(S);
    } else {
      // انتقل لوضع "على وشك البدء" — أعد رسم البنر
      renderBanner();
    }
  }, 1000);
}


// ════════════════════════════════════════
//  LIVE — النظام الجديد (per-match)
//  يقرأ من matches/{id}.liveData
//  يدعم عدة مباريات مباشرة في نفس الوقت
// ════════════════════════════════════════

// ── عداد الوقت per-match في بطاقات المباريات ──


// ── نتيجة ركلات الترجيح من أي مصدر: الحقل المباشر أولاً، وإلا liveData.penalties
// يعيد {h, a} أو null. يضمن ظهور الفائز حتى للمباريات القديمة التي حُفظت
// بلا penaltyScoreHome (لها فقط liveData.penalties).
function _penScore(m) {
  if (!m) return null;
  if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) {
    return { h: m.penaltyScoreHome, a: m.penaltyScoreAway };
  }
  const p = m.penalties || (m.liveData && m.liveData.penalties);
  if (p && (Array.isArray(p.home) || Array.isArray(p.away))) {
    const isGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
    const h = (p.home || []).filter(isGoal).length;
    const a = (p.away || []).filter(isGoal).length;
    if ((p.home || []).length || (p.away || []).length) return { h, a };
  }
  return null;
}

// ── تحويل Firestore Timestamp إلى milliseconds ──────────────────
// Firebase يُعيد Timestamp object بـ .seconds أو number أو null
function _tsMs(ref) {
  if (!ref) return null;
  if (typeof ref === 'number') return ref;
  if (typeof ref.toMillis === 'function') return ref.toMillis();
  if (typeof ref.seconds === 'number') return ref.seconds * 1000 + Math.floor((ref.nanoseconds || 0) / 1e6);
  return null;
}

function _calcMatchSecs(d) {
  return window.TimerCore ? window.TimerCore.phaseSecs(d) : 0;
}

// ⛔ _halfDur / _extraMins / _extraCap أُزيلت — TimerCore هو المرجع الوحيد للمدد.
//    (كانت تكرّر منطق القراءة وتخاطر بالانحراف عن لوحة التحكم)

function _extraSet(d) {
  if (!d) return false;
  const phase = d.matchStatus;
  if (phase === 'extratime1') return !!d.et1ExtraSet;
  if (phase === 'extratime2') return !!d.et2ExtraSet;
  return d.currentHalf === 2 ? !!d.half2ExtraSet : !!d.half1ExtraSet;
}

// السقف الفعلي لبدل الضائع: رقم المنظم لو حدده، وإلا 15 د افتراضياً
const DEFAULT_STOPPAGE_CAP = 15;


// جميع الأوضاع التي تعتبر مباراة "حية"
const LIVE_PHASES = ['live','halftime','extratime1','halftime_et','extratime2','penalties'];

function _periodLabelLong(d) {
  if (!d) return '';
  const map = {
    upcoming:    'قبل المباراة',
    live:        d.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول',
    halftime:    '⏸️ بين الشوطين',
    extratime1:  '⚡ الإضافي الأول',
    halftime_et: '⏸️ بين الإضافيين',
    extratime2:  '⚡ الإضافي الثاني',
    penalties:   '🥅 ركلات الترجيح',
    ended:       '🏁 انتهت المباراة',
  };
  return map[d.matchStatus] || '';
}


// توقيت حدث: "45'+2" أو "90'+3" بشكل صحيح
function _evMinuteLabel(ev) {
  if (!ev) return '?';
  const m = parseInt(ev.minute) || 0;
  // لو فيه extra minute محفوظة
  if (ev.extraMinute && ev.extraMinute > 0)
    return ev.minute + "+<sup>" + ev.extraMinute + "</sup>";
  return ev.minute + "'";
}

function _fmtMatchTimer(d) {
  // ✅︎ يستقبل liveData الآن (وليس أرقاماً مفككة) — يمنع فقدان الإزاحة
  const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
  if (!c) return '00:00';
  // FIX 7: عند 45:00 بالضبط لا شارة بدل ضائع حتى تمرّ ثانية أو يُعلنها المنظّم
  if (!c.inStoppage || !c.showStoppage) return c.clock;
  // ✅︎ +5 فوق · الوقت الرسمي · العدّاد تحت
  // ✅︎ التنسيق: +5 و +2:14 جنب بعض في صف واحد فوق · 45:00 تحت
  const badge = (c.phase.extraSet && c.phase.extra > 0)
    ? `<span class="mc-add-min">+${c.phase.extra}</span>` : '';
  return `<span class="mc-stop-row">${badge}<span class="mc-extra-t">${c.stoppageClock}</span></span>`
       + `<span class="mc-clk-head">${c.clock}</span>`;
}

// ── توليد Goal Toast ──
function checkGoalChanges() {
  matches.filter(m => m.status === 'live' && m.liveData && LIVE_PHASES.includes(m.liveData.matchStatus)).forEach(m => {
    const d = m.liveData;
    const h = d.homeScore ?? 0, a = d.awayScore ?? 0;
    const prev = _lastScores[m.id];
    if (!prev) { _lastScores[m.id] = {h, a}; return; }
    if (h > prev.h) {
      const ht = teams.find(t => t.id === m.homeId) || {};
      showGoalToast('⚽ هدف! ' + (ht.name || m.homeName || 'المضيف') + ' ' + h + '-' + a);
      haptic([50,30,50]);
    } else if (a > prev.a) {
      const at = teams.find(t => t.id === m.awayId) || {};
      showGoalToast('⚽ هدف! ' + (at.name || m.awayName || 'الضيف') + ' ' + h + '-' + a);
      haptic([50,30,50]);
    }
    _lastScores[m.id] = {h, a};
  });
}

// هل الفترة الحالية دخلت فعلياً في بدل الضائع (انتهى وقتها الأصلي)؟
function _isInStoppage(d) {
  const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
  return !!(c && c.inStoppage);
}

// ── تنبيه فوري للجمهور عند تحديد/تعديل بدل الضائع يدوياً ──
// (لا يُطلق إطلاقاً إذا كان التحديد مسبقاً قبل انتهاء الوقت الأصلي — يبقى مخفياً)
function checkExtraTimeChanges() {
  matches.filter(m => m.status === 'live' && m.liveData && LIVE_PHASES.includes(m.liveData.matchStatus)).forEach(m => {
    const d = m.liveData;
    // ✅︎ المرجع الوحيد: TimerCore — نفس ما تراه لوحة التحكم
    const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
    if (!c || !c.inStoppage || !c.phase.extraSet) return;
    const mins = c.phase.extra;
    const sig  = d.matchStatus + ':' + mins;
    const prev = _lastExtra[m.id];
    if (prev !== undefined && prev !== sig) {
      showGoalToast('⏱️ بدل الضائع: +' + mins + ' دقيقة');
      haptic([40,30,40]);
    }
    _lastExtra[m.id] = sig;
  });
}

function showGoalToast(msg) {
  const el = document.getElementById('goalToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}


// ── Embed builder ──
// ── (أُزيل نظام البث القديم _buildViewerEmbed — اعتُمد النظام الجديد) ──

// [openMatchDetail patch removed — live data injected inside main openMatchDetail]

// ── رندر قسم "مباريات مباشرة" في الرئيسية ──
// [renderHomeLive, _buildHomeLiveCard removed — see renderHomeSection below]

function _vwrLogoHtml(logo, size) {
  if (!logo) return `<span style="font-size:${size}px">⚽</span>`;
  if (logo.startsWith('data:') || logo.startsWith('http') || logo.startsWith('/')) {
    return `<img src="${logo}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*.22)}px;object-fit:cover;vertical-align:middle" onerror="this.replaceWith('⚽')"/>`;
  }
  return `<span style="font-size:${size}px;line-height:1">${logo}</span>`;
}

// ── تحديث renderMatchCard لعرض LIVE badge + بيانات من liveData ──
// نلتقط القيم من m.liveData بدلاً من م.status فقط
// (يعمل لأن onSnapshot للمباريات يجلب liveData كجزء من وثيقة المباراة)

// renderAll patch consolidated — see _renderAllV2Patched below



// ── رندر تاب "مباشر الآن" الكامل ──
// [renderLiveMatchesTab removed — see §D override below]

// openLineup/closeLineup/showLineupTeam/renderPitchLines أُزيلت — كانت مودال قديم منفصل
// وغير مستخدم إطلاقًا (لا يوجد أي زر يستدعي openLineup). ميزاته المطورة (صور/ظل اللاعب/
// شبكة البدلاء) نُقلت إلى renderPitchViewer، وهو المُصيّر الفعلي لتبويب "التشكيلة" في الجمهور.

// ── استخراج تبديلات فريق من أحداث المباراة ──
function _teamSubs(m, side) {
  const evs = (typeof _matchEvents === 'function') ? _matchEvents(m) : ((m.liveData && m.liveData.events) || m.events || []);
  const wantId = side === 'home' ? m.homeId : m.awayId;
  const subs = [];
  (evs || []).forEach(ev => {
    if (!ev || ev.type !== 'sub') return;
    // طابق الفريق بعدة طرق: team / side / teamId
    let s = ev.team || ev.side;
    if (!s && ev.teamId != null && wantId != null) s = (ev.teamId === wantId) ? side : (side === 'home' ? 'away' : 'home');
    if (!s) s = 'home';
    if (s !== side) return;
    const mn = ev.extraMinute > 0 ? (ev.minute + '+' + ev.extraMinute) : (ev.minute != null ? ev.minute : '');
    const out = (ev.playerOut || ev.player || '').trim();
    const inn = (ev.playerIn  || ev.player2 || '').trim();
    if (!out && !inn) return; // تبديل فارغ — تجاهل
    // ✅ اسم حيّ من الكشف بالهوية (يتبع تعديل الاسم فوراً)، وإلا المخزّن
    const outLive = (typeof _liveSubName === 'function') ? _liveSubName(ev, wantId, 'out') : out;
    const inLive  = (typeof _liveSubName === 'function') ? _liveSubName(ev, wantId, 'in')  : inn;
    subs.push({ out: outLive || out, in: inLive || inn, min: mn });
  });
  return subs;
}
// تطبيع اسم اللاعب للمطابقة (إزالة المسافات الزائدة والتشكيل والتطويل)
function _normName(s) {
  return (s || '')
    .replace(/[\u064B-\u0652\u0640]/g, '') // تشكيل + تطويل
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// خريطة اسم اللاعب → {dir:'in'|'out', min} لعرض السهم على الملعب
function _subMap(subs) {
  const map = {};
  (subs || []).forEach(s => {
    if (s.out) map[_normName(s.out)] = { dir: 'out', min: s.min };
    if (s.in)  map[_normName(s.in)]  = { dir: 'in',  min: s.min };
  });
  return map;
}

// صورة لاعب التشكيلة حسب هويته من أي كشف محمّل
// صورة لاعب التشكيلة: التشكيلة قد تُحفظ بلا id (بالاسم/الرقم فقط)،
// فنبحث بالهوية إن وُجدت، وإلا بالاسم (والرقم إن توفّر) في كشوف الفرق.
function _lineupPhoto(playerOrId, teamId) {
  if (!window._teamRosters) return '';
  const p = (typeof playerOrId === 'object') ? playerOrId : { id: playerOrId };
  const _norm = s => String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  const scan = (roster) => {
    if (!roster || !roster.length) return '';
    // 1) بالهوية
    if (p.id) { const h = roster.find(x => x && x.id === p.id); if (h && h.photo) return h.photo; }
    // 2) بالاسم + الرقم (أدق)
    if (p.name != null) {
      const n = _norm(p.name);
      let h = roster.find(x => x && _norm(x.name) === n && (p.number==null || String(x.number)===String(p.number)) && x.photo);
      if (h) return h.photo;
      // 3) بالاسم فقط
      h = roster.find(x => x && _norm(x.name) === n && x.photo);
      if (h) return h.photo;
    }
    return '';
  };
  // ابحث في فريق محدّد أولاً إن مُرّر، وإلا كل الفرق
  if (teamId && window._teamRosters[teamId]) { const r = scan(window._teamRosters[teamId]); if (r) return r; }
  for (const tid in window._teamRosters) { const r = scan(window._teamRosters[tid]); if (r) return r; }
  return '';
}

// ظلّ لاعب (silhouette) SVG أنيق — يُعرض بدل الصورة عند غيابها (كالتطبيقات الرسمية)
window._playerSilhouetteSVG = function() {
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="8" r="4"></circle>
    <path d="M12 14c-4.4 0-8 2.6-8 5.8V22h16v-2.2C20 16.6 16.4 14 12 14z"></path>
  </svg>`;
};

// renderPlayersOnPitch / renderSubsSection / renderLineupList أُزيلت — كانت جزءًا من
// مودال openLineup القديم غير المستخدم. الوظائف المكافئة (مع الصور/الظل/الضغط للإحصائيات)
// أصبحت داخل renderPitchViewer مباشرة (المُصيّر الفعلي لتبويب "التشكيلة").

// ════════════════════════════════════════
//  PLAYER MODAL
// ════════════════════════════════════════
window.openPlayerModal = function(playerName, teamId, playerId) {
  // ✅ خزّن آخر استدعاء كي يُعاد رسم النافذة بالاسم الحيّ عند تعديل الكشف
  window._lastPlayerModal = { playerName, teamId, playerId };
  const SC = window.ScorersCore;
  const norm = n => SC ? SC.normName(n) : String(n || '').trim().toLowerCase();
  const data = buildScorersData();

  // ✅︎ الأولوية للهوية (playerId): تفصل تماماً بين لاعبين بنفس الاسم ونفس الفريق.
  //    ثم الاسم+الفريق، ثم الاسم وحده (توافق مع نداءات قديمة).
  let player = null;
  if (playerId) player = data.find(p => p.playerId && p.playerId === playerId);
  if (!player && teamId) player = data.find(p => p.teamId === teamId && norm(p.name) === norm(playerName));
  if (!player) player = data.find(p => p.name === playerName);
  if (!player) player = data.find(p => norm(p.name) === norm(playerName));
  // لو ما وُجد في الهدّافين (لاعب بطاقات فقط بلا أهداف)، ابنِ سجلاً مؤقتاً بالهوية
  if (!player && (playerId || playerName)) {
    const t = (teams || []).find(x => x.id === teamId) || {};
    player = { name: playerName || '', teamId: teamId || null, teamName: t.name || '',
               teamLogo: t.logo || '', goals: 0, playerId: playerId || null };
  }
  if (!player) return;

  const pTeamId = player.teamId;
  const playerMatches = [];
  let yellowCount = 0, redCount = 0, assistCount = 0;
  let appearances = 0;

  // مطابقة اسم مرنة (تتجاهل التشكيل والمسافات الزائدة)
  const _norm2 = s => String(s || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const nameMatches = (a, b) => _norm2(a) === _norm2(b);

  matches.filter(m => m.status === 'finished').forEach(m => {
    const isHomeTeam = pTeamId && m.homeId === pTeamId;
    const isAwayTeam = pTeamId && m.awayId === pTeamId;
    if (!isHomeTeam && !isAwayTeam) return;

    const evs = _matchEvents(m);
    let myGoals = 0, myYellow = 0, myRed = 0, myAssist = 0;

    if (evs.length) {
      evs.forEach(ev => {
        if (!ev) return;
        const evTeamId = ev.teamId || (_evSide(ev) === 'home' ? m.homeId : m.awayId);
        if (evTeamId !== pTeamId) return;
        // مطابقة اللاعب: بالهوية إن كانت متوفّرة في الطرفين، وإلا بالاسم.
        // (الأحداث القديمة بلا playerId تُطابَق بالاسم حتى مع وجود هوية للاعب)
        const matchPlayer = (evId, evName) => {
          if (player.playerId && evId) return evId === player.playerId;
          return nameMatches(evName, player.name);
        };
        // صناعة الهدف: تُنسب لصانعها
        if (ev.type === 'goal' && ev.assist && !ev.isShootout && !ev.shootout) {
          if (matchPlayer(ev.assistPlayerId, ev.assist)) myAssist++;
        }
        if (!matchPlayer(ev.playerId, ev.player)) return;
        if (ev.type === 'goal') myGoals++;
        else if (ev.type === 'yellow') myYellow++;
        else if (ev.type === 'red') myRed++;
      });
    } else {
      const scText = isHomeTeam ? m.homeScorers : m.awayScorers;
      if (scText) scText.split(',').forEach(s => {
        const nm = s.trim().replace(/\s*\(\d+\)\s*$/, '').replace(/[\s\u00A0]*\d+\+?\d*'?\s*$/, '').trim();
        if (nameMatches(nm, player.name)) myGoals++;
      });
    }
    yellowCount += myYellow; redCount += myRed; assistCount += myAssist;

    const opp = isHomeTeam ? (teams.find(t => t.id === m.awayId) || {name: m.awayName || '؟'})
                            : (teams.find(t => t.id === m.homeId) || {name: m.homeName || '؟'});
    const my = isHomeTeam ? m.homeScore : m.awayScore, op = isHomeTeam ? m.awayScore : m.homeScore;
    const result = my > op ? 'فوز' : my < op ? 'خسارة' : 'تعادل';
    const rc = my > op ? 'var(--green)' : my < op ? 'var(--red)' : 'var(--gold)';

    // ── هل شارك اللاعب فعلاً في هذه المباراة؟ وكيف؟ ──
    // 'start'  = أساسي     · 'sub'   = بديل نزل (مع دقيقة النزول)
    // 'bench'  = على الدكة ولم ينزل (لا تُحتسب مباراة)  · null = لا علاقة له
    const _lu = isHomeTeam ? m.homeLineup : m.awayLineup;
    let playStatus = null, subInMinute = null, subOutMinute = null;
    const _plMatch = (pl) => player.playerId
      ? (pl.id && pl.id === player.playerId)
      : nameMatches(pl.name, player.name);
    if (_lu && Array.isArray(_lu.players)) {
      const inLineup = _lu.players.find(_plMatch);
      if (inLineup) playStatus = inLineup.isSub ? 'bench' : 'start';
    }
    // فحص أحداث التبديل: من نزل بديلاً يُحتسب لاعباً، ونعرف دقيقته
    const _subEvents = _matchEvents(m).filter(ev => ev && ev.type === 'sub');
    _subEvents.forEach(ev => {
      const evTeamId = ev.teamId || (_evSide(ev) === 'home' ? m.homeId : m.awayId);
      if (evTeamId !== pTeamId) return;
      // الداخل (player2 / playerIn)
      const inName = ev.player2 || ev.playerIn || ev.in;
      const inId   = ev.player2Id || ev.playerInId || null;
      const outName= ev.player || ev.playerOut || ev.out;
      const outId  = ev.playerId || ev.playerOutId || null;
      const matchesIn  = player.playerId && inId  ? inId  === player.playerId : nameMatches(inName,  player.name);
      const matchesOut = player.playerId && outId ? outId === player.playerId : nameMatches(outName, player.name);
      if (matchesIn)  { playStatus = 'sub'; subInMinute = (ev.minute != null ? ev.minute : ev.min); }
      if (matchesOut && playStatus == null) { /* خرج لكن لم نجده بالتشكيلة → كان أساسياً */ playStatus = 'start'; }
      if (matchesOut) subOutMinute = (ev.minute != null ? ev.minute : ev.min);
    });
    // شبكة أمان: إن لم تتوفّر تشكيلة إطلاقاً لكن سجّل/أخذ كرت → اعتبره لعب (بيانات قديمة)
    if (playStatus == null && (myGoals > 0 || myAssist > 0 || myYellow > 0 || myRed > 0)) {
      playStatus = 'start';
    }

    const _played = (playStatus === 'start' || playStatus === 'sub');
    if (_played) appearances++;
    // البطاقات/الصناعات تُحتسب دائماً (وقعت فعلاً)؛ لكن «لعب مباراة» تشترط النزول
    yellowCount += myYellow; redCount += myRed; assistCount += myAssist;

    // اعرض المباراة إن لعبها فعلاً (أساسي/بديل نزل) — حتى لو لم يسجّل،
    // أو إن كان له حدث مؤثّر (توافق مع بيانات قديمة بلا تشكيلة).
    if (_played || myGoals > 0 || myAssist > 0 || myYellow > 0 || myRed > 0) {
      playerMatches.push({ m, opp, my, op, result, rc, myGoals, myAssist, myYellow, myRed,
                           playStatus, subInMinute, subOutMinute });
    }
  });

  const team = teams.find(t => t.id === player.teamId) || {logo: player.teamLogo};
  // صورة اللاعب إن وُجدت (بالهوية أو بالاسم) وإلا شعار الفريق
  let _pPhoto = '';
  if (window._teamRosters && window._teamRosters[player.teamId]) {
    const _roster = window._teamRosters[player.teamId];
    let _rp = player.playerId ? _roster.find(x => x && x.id === player.playerId) : null;
    if (!_rp || !_rp.photo) {
      const _nn = s => String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
      _rp = _roster.find(x => x && _nn(x.name) === _nn(player.name) && x.photo) || _rp;
    }
    if (_rp && _rp.photo) _pPhoto = _rp.photo;
  }
  document.getElementById('pmLogo').innerHTML = _pPhoto
    ? `<img src="${_pPhoto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : logoHtml(team.logo || player.teamLogo, 36, 10);
  // اسم حيّ من الكشف حسب الهوية إن توفّرت
  const _liveName = (player.playerId && typeof _liveEventPlayerName === 'function')
    ? _liveEventPlayerName({ player: player.name, playerId: player.playerId }, player.teamId)
    : player.name;
  document.getElementById('pmName').textContent = _liveName || player.name;
  // اسم الفريق تحت الاسم؛ والتفاصيل الاختيارية في قسم مرتّب مستقل (بطاقات)
  document.getElementById('pmTeam').textContent = player.teamName || '';
  // 🏅 لقب اللاعب — شارة ذهبية تُمنح حسب أدائه في البطولة
  const _titleEl = document.getElementById('pmTitle');
  if (_titleEl) {
    const _title = (typeof _playerTitle === 'function') ? _playerTitle(player) : null;
    if (_title) {
      _titleEl.style.display = 'inline-flex';
      _titleEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;
        font-size:11px;font-weight:800;color:${_title.color};
        background:${_title.color}1f;border:1px solid ${_title.color}55;
        border-radius:999px;padding:3px 11px">${_title.icon} ${_title.label}</span>`;
    } else {
      _titleEl.style.display = 'none';
      _titleEl.innerHTML = '';
    }
  }
  try {
    const _rp = (window._teamRosters && window._teamRosters[player.teamId] || []).find(x => {
      if (player.playerId && x.id === player.playerId) return true;
      const _n = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
      return _n(x.name) === _n(player.name);
    });
    const _posLabel = { GK:'حارس مرمى', DEF:'مدافع', MID:'وسط', FWD:'مهاجم' };
    // أيقونات SVG أنيقة (بدل الإيموجي) — لون موحّد يتبع النص
    const _svg = {
      number: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      position: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
      age: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      nationality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
      height: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 6l4-3 4 3M8 18l4 3 4-3"/></svg>',
      foot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v9c0 2 1 3 3 3h1c3 0 5 1 5 4v0H7c-1.5 0-3-1-3-3V4z"/></svg>',
    };
    const chips = [];
    if (_rp) {
      if (_rp.number != null && _rp.number !== '') chips.push([_svg.number,'الرقم', '#' + _rp.number]);
      if (_rp.position) chips.push([_svg.position,'المركز', _posLabel[_rp.position] || _rp.position]);
      if (_rp.age) chips.push([_svg.age,'العمر', _rp.age + ' سنة']);
      if (_rp.nationality) chips.push([_svg.nationality,'الجنسية', _rp.nationality]);
      if (_rp.height) chips.push([_svg.height,'الطول', _rp.height + ' سم']);
      if (_rp.foot) chips.push([_svg.foot,'القدم', _rp.foot]);
    }
    const box = document.getElementById('pmDetails');
    if (box) {
      box.innerHTML = chips.length
        ? `<div class="pm-details-grid">${chips.map(([ic,lbl,val]) =>
            `<div class="pm-detail"><div class="pm-detail-ic">${ic}</div><div class="pm-detail-txt"><div class="pm-detail-lbl">${lbl}</div><div class="pm-detail-val">${val}</div></div></div>`
          ).join('')}</div>`
        : '';
    }
  } catch (e) {}
  document.getElementById('pmGoals').textContent = player.goals;
  // ✅ «مباريات لعبها» = المشاركات الفعلية فقط (أساسي أو بديل نزل).
  //    من كان على الدكة ولم ينزل لا يُحتسب. رجوع آمن لطول القائمة للبيانات القديمة.
  const _matchesPlayed = appearances > 0 ? appearances : playerMatches.filter(x => x.playStatus === 'start' || x.playStatus === 'sub' || x.myGoals || x.myAssist || x.myYellow || x.myRed).length;
  document.getElementById('pmMatches').textContent = _matchesPlayed;
  document.getElementById('pmAvg').textContent = _matchesPlayed ? (player.goals / _matchesPlayed).toFixed(1) : '0.0';
  // 👟 الصناعات — تظهر إذا فعّلها المنظّم أو إذا كان للاعب صناعات مسجّلة
  const _showAssistStat = (window.settings && window.settings.showAssists) || assistCount > 0;
  const _asCell = document.getElementById('pmAssistCell');
  const _asVal = document.getElementById('pmAssists');
  if (_asVal) _asVal.textContent = assistCount;
  if (_asCell) _asCell.style.display = _showAssistStat ? '' : 'none';
  const listEl = document.getElementById('pmMatchList');
  if (!playerMatches.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">لا توجد بيانات</div>';
  } else {
    listEl.innerHTML = playerMatches.slice(0, 15).map(({m, opp, my, op, result, rc, myGoals, myAssist, myYellow, myRed, playStatus, subInMinute, subOutMinute}) => {
      // شارة المشاركة: أساسي / بديل نزل بالدقيقة (كالتطبيقات الرسمية)
      let roleBadge = '';
      if (playStatus === 'sub') {
        const _mn = (subInMinute != null && subInMinute !== '') ? `${subInMinute}'` : '';
        roleBadge = `<span style="font-size:9px;font-weight:800;color:var(--green,#27ae60);background:rgba(39,174,96,.14);border-radius:4px;padding:1px 5px;display:inline-flex;align-items:center;gap:2px" title="نزل بديلاً">▲ ${_mn||'بديل'}</span>`;
      } else if (playStatus === 'start') {
        const _out = (subOutMinute != null && subOutMinute !== '') ? `<span style="font-size:9px;font-weight:800;color:#e5533d;background:rgba(229,83,61,.12);border-radius:4px;padding:1px 5px;margin-inline-start:3px" title="خرج">▼ ${subOutMinute}'</span>` : '';
        roleBadge = `<span style="font-size:9px;font-weight:800;color:var(--t2);background:var(--s3);border-radius:4px;padding:1px 5px">أساسي</span>${_out}`;
      }
      return `
      <div class="pm-match-row">
        <div class="pm-match-result" style="color:${rc}">${result}</div>
        <div class="pm-match-vs">ضد ${opp.name} · جولة ${m.round||1}</div>
        <div style="font-size:11px;color:var(--t3)">${my}-${op}</div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          ${roleBadge}
          ${myGoals>0?`<span class="pm-goals-badge">${window.Icon?window.Icon('ball',11):'⚽'}×${myGoals}</span>`:''}
          ${myAssist>0?`<span class="pm-goals-badge" style="background:rgba(39,174,96,.15);color:var(--green,#27ae60)" title="صناعة">👟×${myAssist}</span>`:''}
          ${myYellow>0?`<span style="width:9px;height:12px;background:#E8B93B;border-radius:2px;display:inline-block" title="بطاقة صفراء"></span>`:''}
          ${myRed>0?`<span style="width:9px;height:12px;background:#C0392B;border-radius:2px;display:inline-block" title="بطاقة حمراء"></span>`:''}
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('playerModalOverlay').classList.add('open');
};
window.closePlayerModal = function() {
  document.getElementById('playerModalOverlay').classList.remove('open');
};

// ════════════════════════════════════════
//  GROUPS
// ════════════════════════════════════════
function computeGroupStats(teamIds) {
  const stats={};
  teamIds.forEach(id=>{ stats[id]={pts:0,p:0,w:0,d:0,l:0,gf:0,ga:0}; });
  matches.filter(m=>m.status==='finished').forEach(m=>{
    if(teamIds.includes(m.homeId)&&teamIds.includes(m.awayId)) {
      const h=stats[m.homeId], a=stats[m.awayId];
      if(!h||!a) return;
      h.p++;a.p++; h.gf+=(m.homeScore||0);h.ga+=(m.awayScore||0);a.gf+=(m.awayScore||0);a.ga+=(m.homeScore||0);
      if(m.homeScore>m.awayScore) { h.w++;h.pts+=settings.winPts||3;a.l++; }
      else if(m.homeScore<m.awayScore) { a.w++;a.pts+=settings.winPts||3;h.l++; }
      else { h.d++;a.d++;h.pts+=settings.drawPts||1;a.pts+=settings.drawPts||1; }
    }
  });
  return stats;
}

function renderGroupsStandings() {
  const el=document.getElementById('groupsContent');
  if(!el) return;
  if(!groups.length) { el.innerHTML='<div class="empty-state"><span class="empty-icon">👥</span><div>لا توجد مجموعات</div></div>'; return; }
  el.innerHTML=groups.map(g=>{
    const gTeams=(g.teamIds||[]).map(id=>teams.find(t=>t.id===id)).filter(Boolean);
    const gs=computeGroupStats(g.teamIds||[]);
    const sorted=gTeams.sort((a,b)=>{const sa=gs[a.id]||{},sb=gs[b.id]||{};if((sb.pts||0)!==(sa.pts||0))return(sb.pts||0)-(sa.pts||0);const fa={...a,...sa},fb={...b,...sb};return applyTiebreak(fa,fb,matches);});
    const qCount=g.qualify||2;
    const manualQ=new Set(g.qualifiedTeamIds||[]);
    // ✅︎ FIX §2: لا نُظهر المتأهلين للجمهور إلا بعد الاعتماد الرسمي
    const isPublished = g.qualificationPublished === true;
    const hasManualQ = isPublished && manualQ.size > 0;

    const groupMatches=matches.filter(m=>gTeams.some(t=>t.id===m.homeId)&&gTeams.some(t=>t.id===m.awayId));
    const gmHtml=groupMatches.length?`
      <div class="group-matches-toggle" onclick="toggleGroupMatches(this,'${g.id}')">
        <span>⚽ مباريات المجموعة (${groupMatches.length})</span><span class="gmt-arrow">▼</span>
      </div>
      <div class="group-matches-list" id="gml-${g.id}" style="display:none">
        ${groupMatches.map(m=>{
          const ht=teams.find(t=>t.id===m.homeId)||{name:m.homeName||'?',logo:''};
          const at=teams.find(t=>t.id===m.awayId)||{name:m.awayName||'?',logo:''};
          const fin=m.status==='finished',live=m.status==='live';
          const _psR=_penScore(m);
          return `<div class="gm-row${live?' gm-live':''}" onclick="openMatchDetail('${m.id}')">
            <div class="gm-team gm-home">${logoHtml(ht.logo,16,4)} <span>${ht.name}</span></div>
            <div class="gm-score${fin||live?' gm-score-fin':''}">
              ${fin||live
                ? `${m.homeScore??0} - ${m.awayScore??0}${_psR 
                    ? `<span style="display:block;font-size:9px;color:var(--gold)">رك: ${_psR.h}-${_psR.a}</span>` 
                    : ''}`
                : m.date||'—'
              }
            </div>
            <div class="gm-team gm-away"><span>${at.name}</span> ${logoHtml(at.logo,16,4)}</div>
            ${live?'<div class="gm-live-badge">🔴</div>':''}
          </div>`;
        }).join('')}
      </div>`:'';

    return `<div class="group-card">
      <div class="group-header">
        <div class="group-title">${g.icon||'👥'} المجموعة ${g.name||''}</div>
        <div class="group-sub">${hasManualQ?`✅︎ ${manualQ.size} متأهل`:`متأهلون: أفضل ${qCount}`}</div>
      </div>
      <div class="gt-header">
        <div>#</div><div>الفريق</div>
        <div>ل</div><div>ف</div><div>ت</div><div>خ</div><div>±</div><div>ن</div>
      </div>
      ${sorted.map((t,i)=>{
        const s=gs[t.id]||{};const gd=(s.gf||0)-(s.ga||0);
        // ✅︎ FIX §2: علامات التأهل تظهر فقط بعد الاعتماد الرسمي
        const isQ=hasManualQ?manualQ.has(t.id):i<qCount;
        const isElim=hasManualQ&&!manualQ.has(t.id)&&manualQ.size>=qCount;
        // إذا لم يُعتمد بعد — لا نُظهر أي علامة تأهل أو إقصاء
        const showBadges = isPublished;
        return`<div class="gt-row${(isQ&&showBadges)?' gt-row-qualified':''}${(isElim&&showBadges)?' gt-row-eliminated':''}">
          <div class="gt-pos" style="color:${(isQ&&showBadges)?'var(--green)':(isElim&&showBadges)?'var(--red)':'var(--t3)'}">${i+1}</div>
          <div class="gt-team">
            <span>${logoHtml(t.logo,18,4)}</span>
            <span class="gt-name">${t.name}</span>
            ${(isQ&&showBadges)?'<span class="qualify-badge">✅︎ متأهل</span>':''}
            ${(isElim&&showBadges)?'<span class="elim-badge">❌︎ خرج</span>':''}
          </div>
          <div class="gt-val">${s.p||0}</div>
          <div class="gt-val" style="color:var(--green)">${s.w||0}</div>
          <div class="gt-val">${s.d||0}</div>
          <div class="gt-val" style="color:var(--red)">${s.l||0}</div>
          <div class="gt-val" style="color:${gd>0?'var(--green)':gd<0?'var(--red)':'#666'}">${gd>0?'+'+gd:gd}</div>
          <div class="gt-pts" style="color:${(isQ&&showBadges)?'var(--green)':'var(--gold)'}">${s.pts||0}</div>
        </div>`;
      }).join('')}
      ${gmHtml}
    </div>`;
  }).join('') + _tiebreakNoteHtml();
}

// ── لوحة توضّح للجمهور طريقة الحسم عند التساوي بالنقاط ──
function _tiebreakNoteHtml() {
  const LBL = {
    h2h:  { t:'المواجهات المباشرة', d:'النتيجة بين الفريقين', ic:'⚔️' },
    gd:   { t:'فارق الأهداف',        d:'المسجّلة ناقص المستقبَلة', ic:'±' },
    gf:   { t:'الأهداف المسجّلة',    d:'الأكثر تسجيلاً', ic:'⚽' },
    wins: { t:'عدد الانتصارات',      d:'الأكثر فوزاً', ic:'🏅' },
    cards:{ t:'اللعب النظيف',        d:'الأقل بطاقات', ic:'🟨' },
    draw: { t:'القرعة',              d:'الحل الأخير', ic:'🎲' }
  };
  const dis = settings.tiebreakDisabled || [];
  const order = (settings.tiebreakOrder || ['gd','gf','h2h','wins','cards','draw'])
    .filter(k => LBL[k] && (k === 'draw' || dis.indexOf(k) === -1));
  if (!order.length) return '';
  const rows = order.map((k, i) => {
    const r = LBL[k];
    return `<div class="tbn-row">
      <span class="tbn-n">${i+1}</span>
      <span class="tbn-ic">${r.ic}</span>
      <span class="tbn-txt"><b>${r.t}</b><small>${r.d}</small></span>
    </div>`;
  }).join('');
  return `
    <div class="tbn-card">
      <div class="tbn-title">⚖️ عند التساوي بالنقاط</div>
      <div class="tbn-sub">يُرتَّب الفريقان حسب التالي بالترتيب</div>
      <div class="tbn-list">${rows}</div>
    </div>`;
}


// ════════════════════════════════════════
//  KNOCKOUT BRACKET
// ════════════════════════════════════════
function buildRoundNames(total,rounds) {
  // ✅︎ الأولوية دائماً لـ r.name المحفوظ في Firebase
  // buildRoundNames كـ fallback فقط لو الاسم فارغ
  return rounds.map((r,i)=>{
    if(r && r.name) return r.name; // اسم من Firebase
    const pos=total-i;
    return pos===1?'🏆 النهائي':pos===2?'نصف النهائي':pos===3?'ربع النهائي':pos===4?'دور الـ 16':pos===5?'دور الـ 32':'الدور '+(i+1);
  });
}

function renderKnockoutBracket() {
  const el = document.getElementById('bracketContent');
  if(!el) return;

  if(!settings.bracketPublished) {
    el.innerHTML = `
      <div style="text-align:center;padding:60px 24px">
        <div style="font-size:52px;margin-bottom:14px;opacity:.4">🌳</div>
        <div style="font-size:15px;font-weight:900;color:var(--t2);margin-bottom:8px">الشجرة قيد الإعداد</div>
        <div style="font-size:12px;color:var(--t3);line-height:1.8;max-width:260px;margin:0 auto">
          يعمل مدير البطولة على ترتيب أدوار الإقصاء — ستظهر هنا فور الانتهاء
        </div>
      </div>`;
    return;
  }

  if(knockoutRounds.length > 0) {
    // نحضّر كل دور بمبارياته الحقيقية (من matches[] عبر matchIds) + رقم slot لكل مباراة
    const total = knockoutRounds.length;
    const roundNames = buildRoundNames(total, knockoutRounds);
    const resolvedRounds = knockoutRounds.map((r,i) => {
      const matchIds = r.matchIds || [];
      const roundMs  = matchIds.map(mid => matches.find(m => m.id === mid)).filter(Boolean);
      // ✅︎ لا نعتمد على matchIds وحدها: أي مباراة تحمل knockoutRoundId لهذا الدور
      //    تُضاف أيضاً — كانت المباريات المنتهية تختفي من الشجرة لو تأخّر تحديث matchIds
      //    أو حُذف الـ id منها، فتظهر الخانة فارغة رغم وجود المباراة ونتيجتها.
      const byRoundId = matches.filter(m =>
        m.knockoutRoundId === r.id && !roundMs.some(x => x.id === m.id)
      );
      const merged   = roundMs.concat(byRoundId);
      const legacyMs = merged.length === 0 ? (r.matches || []) : [];
      const allMs    = merged.length ? merged : legacyMs;
      // slot: نعتمد m.knockoutSlot إن وُجد، وإلا ترتيب الظهور في matchIds
      const withSlot = allMs.map((m, idx) => ({ m, slot: (m.knockoutSlot != null ? m.knockoutSlot : idx) }));
      return { name: roundNames[i] || r.name || ('الدور '+(i+1)), slots: r.slots, matchesWithSlot: withSlot };
    });

    // ✅︎ نفصل دور "مباراة تحديد المركز الثالث" إن وُجد — يُعرض كبطاقة صغيرة مستقلة بجانب النهائي
    const thirdIdx = resolvedRounds.findIndex(r => /ثالث/.test(r.name));
    const thirdRound = thirdIdx >= 0 ? resolvedRounds.splice(thirdIdx, 1)[0] : null;

    if (isCleanBracket(resolvedRounds)) {
      el.innerHTML = buildVerticalBracketHTML(resolvedRounds, thirdRound);
    } else {
      el.innerHTML = buildLinearBracketHTML(resolvedRounds, thirdRound);
    }
  } else {
    // fallback: بناء من matches العادية (لا توجد بنية knockoutRounds محفوظة أصلاً)
    const roundGroups = {};
    matches.filter(m => m.isKnockout || m.knockoutRoundId).forEach(m => {
      const rid = m.knockoutRoundId || String(m.round||1);
      if(!roundGroups[rid]) roundGroups[rid] = { name: m.knockoutRoundName || ('الدور '+(m.round||1)), order: m.round||1, ms: [] };
      roundGroups[rid].ms.push(m);
    });
    const rounds = Object.values(roundGroups).sort((a,b) => a.order - b.order);
    if(!rounds.length) {
      el.innerHTML = `<div class="empty-state"><span class="empty-icon">🌳</span><div>لا توجد مباريات بعد</div></div>`;
      return;
    }
    const resolvedRounds = rounds.map(r => ({ name: r.name, slots: r.ms.length, matchesWithSlot: r.ms.map((m,idx)=>({m,slot:idx})) }));
    el.innerHTML = buildLinearBracketHTML(resolvedRounds, null);
  }
}

// ── هل بنية الأدوار "شجرة نظيفة" (كل عدد slots = نصف الدور السابق، وتنتهي بمباراة نهائي واحدة)؟ ──
function isCleanBracket(rounds) {
  if (!rounds.length) return false;
  if (rounds.some(r => !r.slots || r.slots < 1)) return false;
  const last = rounds[rounds.length - 1];
  if (last.slots !== 1) return false;
  for (let i = 0; i < rounds.length - 1; i++) {
    if (rounds[i].slots !== rounds[i+1].slots * 2) return false;
  }
  return true;
}

// ════════════════════════════════════════
//  شجرة مرايا احترافية — مسار يسار ↔ مسار يمين، والنهائي في الوسط
// ════════════════════════════════════════
// ════════════════════════════════════════
//  شجرة عمودية احترافية — تدعم الجوال طولياً (بدون تمرير أفقي)
//  كل دور يُعرض كصف كامل، ينقسم لمسارين (يسار/يمين) يتقابلان في النهائي بالمنتصف
// ════════════════════════════════════════
function buildVerticalBracketHTML(rounds, thirdRound) {
  const finalRound = rounds[rounds.length - 1];
  const pre = rounds.slice(0, -1);
  const finalMatch = (finalRound.matchesWithSlot[0] || {}).m || null;

  const roundsHtml = pre.map((r, idx) => {
    const arr = buildSlotArr(r);
    const half = r.slots / 2;
    const leftSlots  = arr.slice(0, half);
    const rightSlots = arr.slice(half);
    return `
      <div class="btv-round">
        <div class="btv-round-label">${r.name}</div>
        <div class="btv-pair-row">
          <div class="btv-side">${leftSlots.map(m => btMatchBox(m, false)).join('')}</div>
          <div class="btv-vs">⚔</div>
          <div class="btv-side">${rightSlots.map(m => btMatchBox(m, false)).join('')}</div>
        </div>
      </div>
      <div class="btv-arrow">⬇︎</div>`;
  }).join('');

  return `
    <div class="btv-wrap">
      ${roundsHtml}
      <div class="btv-round btv-final-round">
        <div class="btv-round-label">${finalRound.name}</div>
        <div class="btv-final-box">${btMatchBox(finalMatch, true)}</div>
        ${btChampionHTML(finalMatch)}
        ${thirdRound ? btThirdPlaceHTML(thirdRound) : ''}
      </div>
    </div>`;
}

function buildMirroredBracketHTML(rounds, thirdRound) {
  const finalRound = rounds[rounds.length - 1];
  const pre = rounds.slice(0, -1);
  const N0 = pre.length ? pre[0].slots : 1;
  const UNIT = 78; // px لكل صف مباراة في الدور الأول
  const sideHeight = Math.max(N0, 1) * UNIT;

  const leftRounds = pre.map(r => ({
    name: r.name, slots: r.slots,
    slotArr: buildSlotArr(r).slice(0, r.slots / 2)
  }));
  const rightRounds = pre.map(r => ({
    name: r.name, slots: r.slots,
    slotArr: buildSlotArr(r).slice(r.slots / 2)
  })).slice().reverse();

  const finalMatch = (finalRound.matchesWithSlot[0] || {}).m || null;

  return `
    <div class="bracket-tree-wrap"><div class="bracket-tree">
      ${buildSideHTML(leftRounds, 'left', sideHeight)}
      <div class="bt-col-final" style="height:${sideHeight}px">
        <div class="bt-round-label">${finalRound.name}</div>
        ${btMatchBox(finalMatch, true)}
        ${btChampionHTML(finalMatch)}
        ${thirdRound ? btThirdPlaceHTML(thirdRound) : ''}
      </div>
      ${buildSideHTML(rightRounds, 'right', sideHeight)}
    </div></div>`;
}

function buildSlotArr(round) {
  const arr = new Array(round.slots).fill(null);
  const overflow = [];
  round.matchesWithSlot.forEach(({m, slot}) => {
    // ✅︎ لا تُسقط أي مباراة بصمت: لو الخانة مأخوذة أو الرقم خارج المدى
    //    ضعها في أول خانة فاضية — بدل أن تختفي من الشجرة تماماً.
    if (slot != null && slot >= 0 && slot < round.slots && !arr[slot]) arr[slot] = m;
    else overflow.push(m);
  });
  overflow.forEach(m => {
    const free = arr.indexOf(null);
    if (free !== -1) arr[free] = m;
  });
  return arr;
}

function buildSideHTML(roundsList, side, sideHeight) {
  const cols = roundsList.map(r => {
    const N = r.slotArr.length;
    if (!N) return '';
    const slotsHtml = r.slotArr.map((m, i) => `
      <div class="bt-slot" style="top:${(i + 0.5) / N * 100}%">${btMatchBox(m, false)}</div>`).join('');
    let connHtml = '';
    if (N >= 2) {
      for (let i = 0; i < N / 2; i++) {
        const top = (2*i + 0.5) / N * 100;
        const bottom = (2*i + 1.5) / N * 100;
        connHtml += `<div class="bt-conn bt-conn-${side}" style="top:${top}%;height:${bottom-top}%"></div>`;
      }
    }
    return `<div class="bt-col" style="height:100%">
      <div class="bt-round-label">${r.name}</div>
      ${slotsHtml}${connHtml}
    </div>`;
  }).join('');
  return `<div class="bt-side bt-side-${side}" style="height:${sideHeight}px">${cols}</div>`;
}

function btMatchBox(m, isFinal) {
  const hasHome = m && (m.homeId || m.homeName);
  const hasAway = m && (m.awayId || m.awayName);
  if (!hasHome && !hasAway) {
    return `<div class="bt-match bt-empty${isFinal?' bt-final':''}">
      <div class="bt-team"><span class="bt-logo">⚪</span><span class="bt-name bt-tbd">TBD</span></div>
      <div class="bt-sep"></div>
      <div class="bt-team"><span class="bt-logo">⚪</span><span class="bt-name bt-tbd">TBD</span></div>
    </div>`;
  }
  const ht = m.homeId ? (teams.find(t=>t.id===m.homeId)||{name:m.homeName||'TBD',logo:''}) : {name:m.homeName||'TBD',logo:''};
  const at = m.awayId ? (teams.find(t=>t.id===m.awayId)||{name:m.awayName||'TBD',logo:''}) : {name:m.awayName||'TBD',logo:''};
  const isFin  = m.status === 'finished';
  const isLive = m.status === 'live';
  const _ps = _penScore(m);
  const hw = isFin && (_ps ? _ps.h > _ps.a : (m.homeScore ?? 0) > (m.awayScore ?? 0));
  const aw = isFin && (_ps ? _ps.a > _ps.h : (m.awayScore ?? 0) > (m.homeScore ?? 0));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')`;
  // ✅︎ المباراة المنتهية تبقى ظاهرة ببطاقتها كاملة (الفائز + الخاسر) — لا تُفرَّغ أبداً
  const penH = (isFin && _ps) ? `<span class="bt-pen">رك ${_ps.h}</span>` : '';
  const penA = (isFin && _ps) ? `<span class="bt-pen">رك ${_ps.a}</span>` : '';
  return `<div class="bt-match ${isLive?'bt-live':isFin?'bt-done':''}${isFinal?' bt-final':''}" onclick="${clickFn}">
    ${isLive ? '<span class="bt-live-dot">🔴</span>' : ''}
    <div class="bt-team ${hw?'bt-winner':''}${isFin&&!hw&&aw?' bt-loser':''}">
      <span class="bt-logo">${logoHtml(ht.logo,18,5)}</span>
      <span class="bt-name ${!hasHome?'bt-tbd':''}">${ht.name}</span>
      <span class="bt-score">${isFin||isLive ? m.homeScore??0 : ''}${penH}</span>
    </div>
    <div class="bt-sep"></div>
    <div class="bt-team ${aw?'bt-winner':''}${isFin&&!aw&&hw?' bt-loser':''}">
      <span class="bt-logo">${logoHtml(at.logo,18,5)}</span>
      <span class="bt-name ${!hasAway?'bt-tbd':''}">${at.name}</span>
      <span class="bt-score">${isFin||isLive ? m.awayScore??0 : ''}${penA}</span>
    </div>
  </div>`;
}

function btChampionHTML(finalMatch) {
  if (!finalMatch || finalMatch.status !== 'finished') return '';
  const hw = (finalMatch.penaltyScoreHome != null ? finalMatch.penaltyScoreHome > finalMatch.penaltyScoreAway : (finalMatch.homeScore ?? 0) > (finalMatch.awayScore ?? 0));
  const champName = hw ? (finalMatch.homeName || '') : (finalMatch.awayName || '');
  if (!champName) return '';
  return `<div class="bt-champion">
    <div class="bt-champion-crown">🏆</div>
    <div class="bt-champion-name">${champName}</div>
    <div class="bt-champion-tag">بطل البطولة</div>
  </div>`;
}

function btThirdPlaceHTML(thirdRound) {
  const m = (thirdRound.matchesWithSlot[0] || {}).m || null;
  return `<div class="bt-thirdplace">
    <div class="bt-thirdplace-label">🥉 ${thirdRound.name}</div>
    ${btMatchBox(m, false)}
  </div>`;
}

// ════════════════════════════════════════
//  عرض خطي (Fallback) — يُستخدم فقط إذا كانت بنية الأدوار غير منتظمة
// ════════════════════════════════════════
function buildLinearBracketHTML(rounds, thirdRound) {
  const all = thirdRound ? [...rounds, thirdRound] : rounds;
  return `<div class="bracket-scroll"><div class="bracket-rounds">
    ${all.map(r => {
      const N = r.matchesWithSlot.length;
      const items = N === 0
        ? Array.from({length: r.slots || 1}, () => `
             <div class="bracket-match bm-empty">
               <div class="bm-team"><span class="bm-name" style="color:var(--t3);opacity:.5">TBD</span></div>
               <div class="bm-sep" style="height:1px;background:var(--b1)"></div>
               <div class="bm-team"><span class="bm-name" style="color:var(--t3);opacity:.5">TBD</span></div>
             </div>`).join('')
        : r.matchesWithSlot.map(({m}) => renderBracketMatchLinear(m, r.name)).join('');
      return `<div class="bracket-round">
        <div class="bracket-round-label">${r.name}</div>
        <div class="bracket-matches">${items}</div>
      </div>`;
    }).join('')}
  </div></div>`;
}

// حساب المجموع الكلي لمواجهة ذهاب وإياب (تشترك المباراتان في نفس knockoutRoundId+slot)
function _aggForMatch(m) {
  if (!settings.koTwoLegs || !m || !m.knockoutRoundId) return null;
  const legs = matches.filter(x =>
    x.knockoutRoundId === m.knockoutRoundId &&
    (x.knockoutSlot ?? 0) === (m.knockoutSlot ?? 0) &&
    (x.isKnockout || x.knockoutRoundId));
  if (legs.length < 2) return null;
  const finished = legs.filter(x => x.status === 'finished');
  if (finished.length < 2) return null;
  // نحدّد الفريقين المرجعيين من الذهاب (legNo=1)
  const leg1 = legs.slice().sort((a,b)=>(a.legNo||1)-(b.legNo||1))[0];
  const teamA = leg1.homeId, teamB = leg1.awayId;
  let aggA = 0, aggB = 0;
  finished.forEach(l => {
    if (l.homeId === teamA) { aggA += (l.homeScore||0); aggB += (l.awayScore||0); }
    else                    { aggB += (l.homeScore||0); aggA += (l.awayScore||0); }
  });
  return { teamA, teamB, aggA, aggB, winner: aggA>aggB?teamA:aggB>aggA?teamB:null };
}

function renderBracketMatchLinear(m, roundName) {
  const hasHome = m.homeId || m.homeName;
  const hasAway = m.awayId || m.awayName;
  if (!hasHome && !hasAway) return `
    <div class="bracket-match bm-empty">
      <div class="bm-team"><span class="bm-name" style="color:var(--t3)">TBD</span></div>
      <div class="bm-sep" style="height:1px;background:var(--b1)"></div>
      <div class="bm-team"><span class="bm-name" style="color:var(--t3)">TBD</span></div>
    </div>`;

  const ht = m.homeId ? (teams.find(t=>t.id===m.homeId)||{name:m.homeName||'TBD',logo:''}) : {name:m.homeName||'TBD',logo:''};
  const at = m.awayId ? (teams.find(t=>t.id===m.awayId)||{name:m.awayName||'TBD',logo:''}) : {name:m.awayName||'TBD',logo:''};
  const isFin  = m.status==='finished';
  const isLive = m.status==='live';
  const _ps = _penScore(m);
  const hw = isFin && (_ps ? _ps.h > _ps.a : (m.homeScore ?? 0) > (m.awayScore ?? 0));
  const aw = isFin && (_ps ? _ps.a > _ps.h : (m.awayScore ?? 0) > (m.homeScore ?? 0));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')`;
  // شارة المجموع الكلي (تظهر على مباراة الإياب عند اكتمال المواجهة)
  const _agg = (m.legNo === 2) ? _aggForMatch(m) : null;
  const aggBadge = _agg ? `<div style="text-align:center;font-size:9px;font-weight:800;color:var(--gold);background:rgba(201,160,43,.1);border-top:1px solid var(--b1);padding:3px">المجموع: ${_agg.aggA} - ${_agg.aggB}</div>` : '';
  return `<div class="bracket-match ${isLive?'bm-live':isFin?'bm-done':''}" onclick="${clickFn}">
    <div class="bm-team ${hw?'bm-winner':''}">
      <span class="bm-logo">${logoHtml(ht.logo,20,5)}</span>
      <span class="bm-name">${ht.name}${m.legNo?`<span style="font-size:8px;color:var(--t3);margin-inline-start:4px">${m.legNo===1?'ذهاب':'إياب'}</span>`:''}</span>
      <span class="bm-score">${isFin||isLive ? m.homeScore??0 : ''}${isFin && _ps ? `<span style="font-size:9px;color:var(--gold);display:block">رك: ${_ps.h}</span>` : ''}</span>
    </div>
    <div class="bm-sep" style="height:1px;background:var(--b1)"></div>
    <div class="bm-team ${aw?'bm-winner':''}">
      <span class="bm-logo">${logoHtml(at.logo,20,5)}</span>
      <span class="bm-name">${at.name}</span>
      <span class="bm-score">${isFin||isLive ? m.awayScore??0 : ''}${isFin && _ps ? `<span style="font-size:9px;color:var(--gold);display:block">رك: ${_ps.a}</span>` : ''}</span>
    </div>
    ${aggBadge}
    ${isLive ? '<div class="bm-live-dot">🔴</div>' : ''}
  </div>`;
}

// ════════════════════════════════════════
//  فتح تفاصيل مباراة الشجرة
// ════════════════════════════════════════
window.openBracketMatch = function(roundId, matchId) {
  const rid = decodeURIComponent(roundId);
  const mid = decodeURIComponent(matchId);

  // ابحث في knockoutRounds أولاً
  let bm = null, roundName = '';
  for(const r of knockoutRounds) {
    const found = (r.matches||[]).find(x => String(x.id) === String(mid));
    if(found) { bm = found; roundName = r.name || ''; break; }
  }
  // إذا ما لقيناها → جرّب matches العادية
  if(!bm) { openMatchDetail(mid); return; }

  const overlay = document.getElementById('matchDetailOverlay');
  const body    = document.getElementById('matchDetailBody');
  if(!overlay||!body) return;

  const ht = bm.homeId ? (teams.find(t=>t.id===bm.homeId)||{name:bm.homeName||'TBD',logo:'❓'}) : {name:bm.homeName||'TBD',logo:'❓'};
  const at = bm.awayId ? (teams.find(t=>t.id===bm.awayId)||{name:bm.awayName||'TBD',logo:'❓'}) : {name:bm.awayName||'TBD',logo:'❓'};
  // ✅ FIX: حمّل كشفي الفريقين مسبقاً حتى تظهر أسماء الهدافين المحدَّثة فوراً
  if (bm.events && bm.events.some(e => e.type === 'goal' && e.playerId)) {
    _ensureRosterLoaded(ht.id, () => { if (overlay.classList.contains('show')) window.openBracketMatch(roundId, matchId); });
    _ensureRosterLoaded(at.id, () => { if (overlay.classList.contains('show')) window.openBracketMatch(roundId, matchId); });
  }
  const isFin  = bm.status === 'finished';
  const isLive = bm.status === 'live';
  // ── تحديد الفائز مع دعم ركلات الترجيح ──
  const _psD = _penScore(bm);
  const hw = isFin && (_psD ? _psD.h > _psD.a : (bm.homeScore ?? 0) > (bm.awayScore ?? 0));
  const aw = isFin && (_psD ? _psD.a > _psD.h : (bm.awayScore ?? 0) > (bm.homeScore ?? 0));

  const lName = document.getElementById('mdLeagueName');
  if(lName) lName.textContent = (league?.name||'') + ' · ' + (roundName||'شجرة البطولة');

  // ── عرض النتيجة مع ركلات الترجيح إذا وجدت ──
  const scoreHtml = isFin || isLive
    ? `<div class="md-score">${bm.homeScore??0} - ${bm.awayScore??0}${_psD ? `<br><span style="font-size:12px;color:var(--gold)">رك: ${_psD.h} - ${_psD.a}</span>` : ''}</div>`
    : `<div class="md-score" style="font-size:18px;color:var(--t3);letter-spacing:4px">VS</div>`;

  body.innerHTML = `
    <div class="md-scoreboard">
      <div class="md-teams">
        <div class="md-team">
          <div class="md-logo">${logoHtml(ht.logo,40,10)}</div>
          <div class="md-tname ${hw?'md-winner':''}">${ht.name}</div>
        </div>
        <div class="md-center">
          ${scoreHtml}
          ${isLive ? '<div class="md-live-badge">🔴 مباشر</div>' : ''}
          ${isFin  ? '<div style="font-size:10px;color:var(--t3);margin-top:4px">انتهت المباراة</div>' : ''}
          ${!isFin&&!isLive&&bm.date ? `<div style="font-size:10px;color:var(--t3);margin-top:4px">${bm.date}${bm.time?' · '+formatTimeTo12H(bm.time):''}</div>` : ''}
        </div>
        <div class="md-team">
          <div class="md-logo">${logoHtml(at.logo,40,10)}</div>
          <div class="md-tname ${aw?'md-winner':''}">${at.name}</div>
        </div>
      </div>
      <div class="md-meta-row">
        <span class="md-chip">🌳 ${roundName||'شجرة البطولة'}</span>
        ${bm.venue ? `<span class="md-chip">🏟 ${bm.venue}</span>` : ''}
      </div>
    </div>

${bm.events&&bm.events.length ? `
     <div class="md-section">
       <div class="md-section-title">📋 أحداث المباراة</div>
       ${bm.events.map(ev=>`
         <div class="md-event">
           <div class="md-ev-min">${ev.type === 'penalty' ? 'رك' : ev.minute||'—'}'</div>
           <div class="md-ev-icon">${ev.type === 'penalty'
             ? (ev.result === 'goal' ? '🥅 ✅︎' : '🥅 ❌︎')
             : ev.icon||'⚽'}</div>
           <div class="md-ev-info">
             <div class="md-ev-player">${ev.type === 'penalty' 
               ? (ev.result === 'goal' ? 'هدف' : 'تفويت') + ' (ركلات ترجيح)'
               : _liveEventPlayerName(ev, _evSide(ev) === 'away' ? at.id : ht.id)}</div>
             <div class="md-ev-team">${ev.teamName||''}</div>
           </div>
         </div>`).join('')}
     </div>` : ''}

    ${hw||aw ? `
    <div class="md-section">
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                  background:rgba(201,160,43,.08);border:1px solid rgba(201,160,43,.2);border-radius:14px">
        <span style="font-size:28px">🏆</span>
        <div>
          <div style="font-size:11px;color:var(--gold);font-weight:700;margin-bottom:2px">المتأهل للدور القادم</div>
          <div style="font-size:15px;font-weight:900;color:var(--t1)">${hw?ht.name:at.name}</div>
        </div>
      </div>
    </div>` : ''}
  `;

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
};

// ════════════════════════════════════════
//  HOME KNOCKOUT / GROUPS
// ════════════════════════════════════════
function renderHomeKnockout() {
  renderHomeSection();
}

function renderHomeGroups() {
  // النظام الموحّد لا يعتمد دوال homeUpcoming/homeRecent.
  renderHomeSection();
}


// ════════════════════════════════════════
//  ADAPT UI TO TYPE
// ════════════════════════════════════════
function adaptUIToType() {
  const type = tournamentType;
  const bn = document.querySelector('.bottom-nav');
  if(!bn) return;

  const standEl = document.getElementById('tab-standings');
  const gEl     = document.getElementById('tab-groups');
  const brkEl   = document.getElementById('tab-bracket');

  // الشجرة تظهر للجمهور فقط إذا نشرها المدير (bracketPublished = true)
  const bracketOK = settings.bracketPublished === true;

  if(type === 'knockout') {
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"     onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      ${bracketOK ? `<button class="bn-item" id="bn-bracket"  onclick="switchTab('bracket',null,this)"><span class="bi">${window.Icon?Icon('tree',19):''}</span>الشجرة</button>` : ''}
      <button class="bn-item" id="bn-matches"  onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"    onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-stats"    onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"     onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = 'none';
    if(brkEl)   brkEl.style.display   = bracketOK ? 'block' : 'none';
    // ✅︎ FIX §1: إخفاء حاويات الترتيب في نظام الإقصاء
    ['fullStandings','homeStandings','zoneLegend'].forEach(function(id) {
      var el = document.getElementById(id); if(el) el.style.display = 'none';
    });
  } else if(type === 'groups') {
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"     onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      <button class="bn-item" id="bn-groups"   onclick="switchTab('groups',null,this)"><span class="bi">${window.Icon?Icon('target',19):''}</span>المجموعات</button>
      ${bracketOK ? `<button class="bn-item" id="bn-bracket" onclick="switchTab('bracket',null,this)"><span class="bi">${window.Icon?Icon('tree',19):''}</span>الشجرة</button>` : ''}
      <button class="bn-item" id="bn-matches"  onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"    onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-stats"    onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"     onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = 'none';
    if(gEl)     gEl.style.display     = 'block';
    if(brkEl)   brkEl.style.display   = bracketOK ? 'block' : 'none';
    // ✅︎ FIX §1: إخفاء حاويات الترتيب العام في نظام المجموعات
    ['fullStandings','homeStandings','zoneLegend'].forEach(function(id) {
      var el = document.getElementById(id); if(el) el.style.display = 'none';
    });
  } else if(type === 'swiss') {
    // الدوري الموحّد: جدول ترتيب واحد + شجرة إقصاء (تظهر عند نشرها)
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"      onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      <button class="bn-item" id="bn-standings" onclick="switchTab('standings',null,this)"><span class="bi">${window.Icon?Icon('list',19):''}</span>الترتيب</button>
      ${bracketOK ? `<button class="bn-item" id="bn-bracket"  onclick="switchTab('bracket',null,this)"><span class="bi">${window.Icon?Icon('tree',19):''}</span>الإقصاء</button>` : ''}
      <button class="bn-item" id="bn-matches"   onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"     onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-stats"     onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"      onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = '';
    if(brkEl)   brkEl.style.display   = bracketOK ? 'block' : 'none';
    // ✅︎ إظهار حاويات الترتيب الداخلية (قد تكون مخفية من نوع آخر)
    ['fullStandings','homeStandings','zoneLegend'].forEach(function(id) {
      var el = document.getElementById(id); if(el) el.style.display = '';
    });
  } else {
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"      onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      <button class="bn-item" id="bn-standings" onclick="switchTab('standings',null,this)"><span class="bi">${window.Icon?Icon('list',19):''}</span>الترتيب</button>
      <button class="bn-item" id="bn-matches"   onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"     onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-stats"     onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"      onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = '';
  }
  // ✅︎ للـ home-section sub-header "عرض الكل" — أخفه إذا مش دوري نقاط أو موحّد
  if(type !== 'league' && type !== 'swiss') {
    document.querySelectorAll('[onclick*="switchTab(\'standings\'"]').forEach(el => {
      if(el.classList.contains('home-sub-btn')) el.style.display = 'none';
    });
  }
}

function getDynamicTabOrder() {
  if(tournamentType==='knockout') return ['home','bracket','matches','teams','stats'];
  if(tournamentType==='groups')   return ['home','groups','bracket','matches','teams','stats'];
  if(tournamentType==='swiss')    return ['home','standings','bracket','matches','teams','stats'];
  return ['home','standings','matches','teams','stats'];
}

// ════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════
window.toggleGroupMatches = function(btn, gid) {
  const list = document.getElementById('gml-'+gid);
  if(!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  const arrow = btn.querySelector('.gmt-arrow');
  if(arrow) arrow.textContent = isOpen ? '▼' : '▲';
  // ✅︎ toggle class للـ animation
  btn.classList.toggle('open', !isOpen);
};

window.switchTab = function(name, btn, mn) {
  // ✅︎ إزالة active + مسح أي inline style من كل الـ sections
  document.querySelectorAll('.section').forEach(s => {
    s.classList.remove('active');
    s.style.display = ''; // مسح inline style حتى يتحكم CSS
  });
  const el = document.getElementById('tab-' + name);
  if (el) {
    el.classList.add('active');
    // لا نكتب style.display — CSS يتولى عبر .section.active { display:block }
  }
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  if (mn) mn.classList.add('active');
  const bnEl = document.getElementById('bn-' + name);
  if (bnEl) {
    bnEl.classList.add('active');
    bnEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  hideSharePanel();
  haptic('light');
  if (name === 'groups')  renderGroupsStandings();
  if (name === 'bracket') renderKnockoutBracket();
  if (name === 'stats')   { if (typeof renderStats === 'function') renderStats(); if (typeof renderChart === 'function') renderChart(); if (typeof renderSummaryStats === 'function') renderSummaryStats(); }
};

window.filterMatches = function(f, btn) {
  document.querySelectorAll('.fp').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if (typeof renderMatches === 'function') renderMatches(f);
  matchFilter = f;
};

window.filterMatchSearch = function(val) {
  searchQuery=val.trim().toLowerCase();
  const c=document.getElementById('searchClear'); if(c) c.style.display=searchQuery?'block':'none';
  if (typeof renderMatches === 'function') renderMatches(matchFilter);
};
window.clearSearch = function() {
  const inp=document.getElementById('matchSearch'); if(inp) inp.value='';
  searchQuery='';
  const c=document.getElementById('searchClear'); if(c) c.style.display='none';
  if (typeof renderMatches === 'function') renderMatches(matchFilter);
};

// ════════════════════════════════════════
//  CHARTS
// ════════════════════════════════════════
let chartMode='goals';
window.showChart = function(mode, btn) {
  chartMode=mode;
  document.querySelectorAll('.chart-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderChart();
};

function renderChart() {
  const el=document.getElementById('chartWrap');
  if(!el||!teams.length) return;
  const sorted=[...teams].sort((a,b)=>{
    if(chartMode==='goals') return (b.gf||0)-(a.gf||0);
    if(chartMode==='wins') return (b.w||0)-(a.w||0);
    return (b.p||0)-(a.p||0);
  }).slice(0,8);
  const maxVal=Math.max(...sorted.map(t=>chartMode==='goals'?(t.gf||0):chartMode==='wins'?(t.w||0):(t.p||0)),1);
  const colors=['#C9A02B','#2dc653','#3b82f6','#f97316','#8b5cf6','#C0392B','#14b8a6','#f59e0b'];
  el.innerHTML=sorted.map((t,i)=>{
    const val=chartMode==='goals'?(t.gf||0):chartMode==='wins'?(t.w||0):(t.p||0);
    const pct=Math.max(8,Math.round(val/maxVal*100));
    return `<div class="chart-bar-row">
      <div class="chart-label">${t.name}</div>
      <div class="chart-bar-bg">
        <div class="chart-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}">
          <span class="chart-bar-val">${val}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderSummaryStats() {
  const el=document.getElementById('summaryStats'); if(!el) return;
  const fin=matches.filter(m=>m.status==='finished');
  const goals=fin.reduce((s,m)=>s+(m.homeScore||0)+(m.awayScore||0),0);
  const draws=fin.filter(m=>m.homeScore===m.awayScore).length;
  const decisive=fin.filter(m=>m.homeScore!==m.awayScore).length;
  const rows=[
    ['🗓 مباريات منتهية',fin.length],
    ['⚽ مجموع الأهداف',goals],
    ['📈 معدل أهداف/مباراة',fin.length?(goals/fin.length).toFixed(1):0],
    ['🏆 مباريات حُسمت',decisive],
    ['🤝 تعادلات',draws],
  ];
  el.innerHTML=rows.map(([l,v])=>`
    <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--b1);font-size:11px">
      <span style="color:var(--t3)">${l}</span>
      <span style="font-weight:700">${v}</span>
    </div>`).join('');
}

// ════════════════════════════════════════
//  SHARE
// ════════════════════════════════════════
// ── share modal (custom bottom sheet) ───────────────────────────
function _buildShareModal() {
  if (document.getElementById('_shareModal')) return;
  const el = document.createElement('div');
  el.id = '_shareModal';
  el.innerHTML =
    '<div id="_shareBackdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9998;backdrop-filter:blur(6px)" onclick="window._closeShareModal()"></div>' +
    '<div id="_shareSheet" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#0f1115;border-radius:20px 20px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom,0));border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -8px 40px rgba(0,0,0,.6);transform:translateY(100%);transition:transform .3s cubic-bezier(.32,1,.56,1)">' +
      '<div style="width:36px;height:4px;background:#2a2d35;border-radius:2px;margin:0 auto 18px;cursor:pointer" onclick="window._closeShareModal()"></div>' +
      '<div id="_shareTitle" style="font-family:Tajawal,sans-serif;font-size:15px;font-weight:900;color:#e8eaf0;text-align:center;margin-bottom:4px"></div>' +
      '<div style="font-size:11px;color:#5a6070;text-align:center;margin-bottom:20px;font-family:Tajawal,sans-serif">اختر طريقة المشاركة</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<button onclick="window._doShareWA()" style="display:flex;align-items:center;gap:8px;background:#0d1f14;border:1px solid rgba(37,211,102,.2);border-radius:14px;padding:14px 12px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;color:#25d366"><span style="font-size:20px">📲</span> واتساب</button>' +
        '<button onclick="window._doShareTG()" style="display:flex;align-items:center;gap:8px;background:#0d1520;border:1px solid rgba(0,136,204,.2);border-radius:14px;padding:14px 12px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;color:#0088cc"><span style="font-size:20px">✈︎️</span> تيليجرام</button>' +
        '<button onclick="window._doCopyLink()" id="_copyBtn" style="display:flex;align-items:center;gap:8px;background:#14161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px 12px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;color:#9aa0b0"><span style="font-size:20px">🔗</span> نسخ الرابط</button>' +
        '<button onclick="window._closeShareModal()" style="display:flex;align-items:center;gap:8px;background:#14161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px 12px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;color:#5a6070"><span style="font-size:20px">✕</span> إغلاق</button>' +
      '</div>' +
      '<div id="_shareUrlBox" style="background:#14161b;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:9px 12px;font-size:10px;color:#5a6070;font-family:monospace;text-align:center;word-break:break-all;line-height:1.5"></div>' +
    '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(function() {
    document.getElementById('_shareSheet').style.transform = 'translateY(0)';
  });
}

window._closeShareModal = function() {
  const sheet = document.getElementById('_shareSheet');
  if (!sheet) return;
  sheet.style.transform = 'translateY(100%)';
  setTimeout(function() { const m = document.getElementById('_shareModal'); if(m) m.remove(); }, 320);
};

// ── حقوق المنصة — تظهر في كل مشاركة ──
const CREDIT = 'منصة بطولات — تطوير وبرمجة عبدالله السكني';

function _getShareData() {
  const url    = SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID;
  const name   = (league && league.name) || 'البطولة';
  const season = (league && league.season) ? ' · ' + league.season : '';
  const type   = tournamentType || (league && league.type) || 'league';

  // رسالة ترحيب بسيطة باسم البطولة فقط — بلا نوع البطولة ولا عدد الفرق
  const parts = [];
  parts.push('🏆 ' + name + season);
  parts.push('');
  parts.push('تابع البطولة لحظة بلحظة 👇');
  parts.push('كل النتائج والترتيب والهدافون والبث المباشر في مكان واحد.');
  parts.push('');
  parts.push('اضغط الرابط وتابع كل التفاصيل مجاناً:');
  parts.push('🔗 ' + url);
  parts.push('');
  parts.push(CREDIT);

  return { url: url, name: name, text: parts.join('\n'), type: type };
}

window._doShareWA = function() {
  const d = _getShareData();
  window.open('https://wa.me/?text=' + encodeURIComponent(d.text), '_blank');
  window._closeShareModal();
};

window._doShareTG = function() {
  const d = _getShareData();
  window.open('https://t.me/share/url?url=' + encodeURIComponent(d.url) + '&text=' + encodeURIComponent(d.text), '_blank');
  window._closeShareModal();
};

window._doCopyLink = function() {
  const d = _getShareData();
  const btn = document.getElementById('_copyBtn');
  const finish = function() {
    if (btn) {
      btn.style.color = '#2dc653';
      btn.style.borderColor = 'rgba(45,198,83,.3)';
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = '✅︎';
    }
    showToast('تم نسخ الرابط 🔗', 'success');
    setTimeout(function() { window._closeShareModal(); }, 1200);
  };
  const fallback = function() {
    const inp = document.createElement('input');
    inp.value = d.url;
    inp.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(inp);
    inp.select();
    document.execCommand('copy');
    document.body.removeChild(inp);
    finish();
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(d.url).then(finish).catch(fallback);
  } else {
    fallback();
  }
};

window.showSharePanel = function() {
  // ✅︎ لا تصمت لو البيانات لم تُحمَّل بعد — الرابط وحده كافٍ للمشاركة
  const d = _getShareData();
  if (navigator.share) {
    // ⚠️ لا نمرّر url منفصلاً: واتساب وتيليجرام يعرضان الرابط فقط ويحذفان النص.
    //    النص أصلاً يحتوي الرابط بداخله — فتصل الرسالة كاملة زي الإعلان.
    navigator.share({ title: d.name, text: d.text })
      .catch(function(){ /* ألغى المستخدم — تجاهل */ });
  } else {
    _buildShareModal();
    const t = document.getElementById('_shareTitle');
    const u = document.getElementById('_shareUrlBox');
    if (t) t.textContent = '🏆 ' + d.name;
    if (u) u.textContent = d.url;
  }
};

window.hideSharePanel = function() {
  window._closeShareModal();
};

window.shareViaWA = function() { window.showSharePanel(); };

window.copyLink = function() {
  const d = _getShareData();
  const fallback = function() {
    const inp = document.createElement('input');
    inp.value = d.url;
    inp.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(inp);
    inp.select();
    document.execCommand('copy');
    document.body.removeChild(inp);
    showToast('تم نسخ الرابط 🔗', 'success');
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(d.url)
      .then(function() { showToast('تم نسخ الرابط 🔗', 'success'); })
      .catch(fallback);
  } else {
    fallback();
  }
};

function openWA(text) { window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank'); }


window.shareAsImage = async function() {
  const canvas=document.getElementById('shareCanvas');
  const ctx=canvas.getContext('2d');
  const W=800,H=600; canvas.width=W;canvas.height=H;
  ctx.fillStyle='#08090b'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#C9A02B'; ctx.lineWidth=2; ctx.strokeRect(12,12,W-24,H-24);
  ctx.fillStyle='#C9A02B'; ctx.font='bold 26px Tajawal,Arial'; ctx.textAlign='center';
  ctx.fillText(league?.name||'منصة بطولات',W/2,60);
  const sorted=[...teams].sort((a,b)=>(b.pts||0)-(a.pts||0)).slice(0,8);
  sorted.forEach((t,i)=>{
    const y=100+i*58;
    ctx.fillStyle=i%2===0?'#111':'#0d0d0d'; ctx.fillRect(30,y,W-60,54);
    ctx.fillStyle='#C9A02B'; ctx.font='bold 18px Tajawal,Arial'; ctx.textAlign='left'; ctx.fillText(i+1,48,y+34);
    ctx.fillStyle='#e8eaf0'; ctx.font='16px Tajawal,Arial'; ctx.textAlign='right'; ctx.fillText(t.name,W-90,y+34);
    ctx.fillStyle='#C9A02B'; ctx.font='bold 20px Tajawal,Arial'; ctx.textAlign='left'; ctx.fillText((t.pts||0)+' ن',80,y+34);
  });
  ctx.fillStyle='#555'; ctx.font='12px Tajawal,Arial'; ctx.textAlign='center'; ctx.fillText('منصة البطولات الرياضية',W/2,H-20);
  canvas.toBlob(async blob=>{
    const file=new File([blob],'league.png',{type:'image/png'});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})) {
      await navigator.share({files:[file],title:league?.name}).catch(()=>{});
    } else {
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(league?.name||'league')+'.png'; a.click();
    }
  },'image/png');
  showToast('جاري إنشاء الصورة... 🖼','success');
};

// ════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════
let _toastT;
window.showToast = function(msg,type='success') {
  const t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.className='toast '+type+' show';
  clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('show'),3000);
};

// ════════════════════════════════════════
//  HAPTIC
// ════════════════════════════════════════
window.haptic = function(style='light') {
  if(!navigator.vibrate) return;
  const p={light:[10],medium:[30],heavy:[50],success:[10,40,10],goal:[60,30,60]};
  navigator.vibrate(Array.isArray(style)?style:p[style]||[10]);
};

// ════════════════════════════════════════
//  THEME
// ════════════════════════════════════════
(function(){
  if(localStorage.getItem('theme')==='light') {
    document.documentElement.classList.add('light');
    const btn=document.getElementById('themeToggle'); if(btn) btn.textContent='☀︎️';
  }
})();
window.toggleTheme = function() {
  const isL=document.documentElement.classList.toggle('light');
  localStorage.setItem('theme',isL?'light':'dark');
  const btn=document.getElementById('themeToggle'); if(btn) btn.textContent=isL?'☀︎️':'🌙';
};

// ════════════════════════════════════════
//  OFFLINE
// ════════════════════════════════════════
window.addEventListener('online', ()=>{ document.getElementById('offlineBar')?.classList.remove('show'); showToast('عدت للاتصال ✅︎','success'); });
window.addEventListener('offline', ()=>{ document.getElementById('offlineBar')?.classList.add('show'); });
if(!navigator.onLine) document.getElementById('offlineBar')?.classList.add('show');

// ════════════════════════════════════════
//  SCROLL — BACK TO TOP
// ════════════════════════════════════════
window.addEventListener('scroll',()=>{
  const b=document.getElementById('backToTop');
  if(b) window.scrollY>400?b.classList.add('show'):b.classList.remove('show');
},{passive:true});

// ════════════════════════════════════════
//  SWIPE بين التبويبات
// ════════════════════════════════════════
(function(){
  const content=document.querySelector('.content');
  if(!content) return;
  let tx=0,ty=0;
  content.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
  content.addEventListener('touchend',e=>{
    const dx=tx-e.changedTouches[0].clientX, dy=Math.abs(ty-e.changedTouches[0].clientY);
    if(Math.abs(dx)<60||dy>80) return;
    const active=document.querySelector('.section.active'); if(!active) return;
    const cur=active.id.replace('tab-','');
    // ✅︎ فلتر الـ tabs الموجودة فعلاً في DOM (تتجنب bracket المخفية)
    const allTabs=getDynamicTabOrder();
    const tabs=allTabs.filter(t=>document.getElementById('bn-'+t));
    const idx=tabs.indexOf(cur); if(idx===-1) return;
    if(dx>0&&idx<tabs.length-1) { haptic('light'); window.switchTab(tabs[idx+1],null,document.getElementById('bn-'+tabs[idx+1])); }
    else if(dx<0&&idx>0) { haptic('light'); window.switchTab(tabs[idx-1],null,document.getElementById('bn-'+tabs[idx-1])); }
  },{passive:true});
})();

// ════════════════════════════════════════
//  INSTALL PWA
// ════════════════════════════════════════
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredPrompt=e; const f=document.getElementById('installFab'); if(f) f.style.display='flex'; });
window.installApp = async function() {
  if(!deferredPrompt) { showToast('التطبيق جاهز للتثبيت من القائمة ⬇︎️','success'); return; }
  deferredPrompt.prompt();
  const {outcome}=await deferredPrompt.userChoice;
  if(outcome==='accepted') showToast('✅︎ تم التثبيت بنجاح!','success');
  deferredPrompt=null;
  const f=document.getElementById('installFab'); if(f) f.style.display='none';
};

// ════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  const map={'1':'home','2':'standings','3':'matches','4':'stats'};
  if(map[e.key]) window.switchTab(map[e.key],null,document.getElementById('bn-'+map[e.key]));
  if(e.key==='Escape') { window.closeMatchDetail(); window.closeLiveOverlay(); }
});

// ════════════════════════════════════════
//  HAPTIC على كل الأزرار
// ════════════════════════════════════════
document.addEventListener('click',e=>{
  if(e.target.closest('button,.bn-item,.fp,.match-card,.scorer-row')) haptic(12);
},{passive:true});

// ════════════════════════════════════════
//  SHORTCUTS من URL
// ════════════════════════════════════════
(function(){
  const tab=new URLSearchParams(location.search).get('tab');
  if(tab) setTimeout(()=>window.switchTab&&window.switchTab(tab,null,document.getElementById('bn-'+tab)),800);
})();

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
// ════════════════════════════════════════
//  TEAMS GRID
// ════════════════════════════════════════
function renderTeamsGrid() {
  const el = document.getElementById('teamsGrid');
  if(!el) return;
  if(!teams.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">👥</span><div>لا توجد فرق بعد</div></div>';
    return;
  }
  const sorted = [...teams].sort((a,b)=>(b.pts||0)-(a.pts||0));
  el.innerHTML = sorted.map(t => {
    const stats = getTeamStats(t.id);
    const form = getTeamForm(t.id, 5);
    const pos = sorted.findIndex(x=>x.id===t.id) + 1;
    return `
    <div onclick="openTeamProfile('${t.id}')" style="
      background:var(--s1);border-bottom:1px solid var(--b1);
      padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;
      transition:background .12s;
    " onpointerdown="this.style.background='var(--s2)'" onpointerup="this.style.background='var(--s1)'" onpointerleave="this.style.background='var(--s1)'">
      <div style="width:24px;text-align:center;font-size:12px;font-weight:900;color:var(--t3)">${pos}</div>
      <div style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;background:var(--s3);display:flex;align-items:center;justify-content:center">
        ${logoHtml(t.logo, 40, 10)}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:900;color:var(--t1)">${t.name}</div>
        ${form.length ? `<div style="display:flex;gap:4px;margin-top:5px">
          ${form.map(f=>{
            const c = f==='w' ? 'var(--green,#27ae60)' : f==='l' ? 'var(--red,#C0392B)' : '#8a90a0';
            const ch = f==='w' ? 'ف' : f==='l' ? 'خ' : 'ت';
            return `<div style="width:17px;height:17px;border-radius:5px;background:${c};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)">${ch}</div>`;
          }).join('')}
        </div>` : ''}
      </div>
      <div style="text-align:center;min-width:36px">
        <div style="font-size:18px;font-weight:900;color:var(--gold);font-family:'Tajawal',sans-serif">${t.pts||0}</div>
        <div style="font-size:9px;color:var(--t3)">نقطة</div>
      </div>
      <div style="font-size:16px;color:var(--t3)">←</div>
    </div>`;
  }).join('');
}

function getTeamStats(teamId) {
  const fin = matches.filter(m=>m.status==='finished'&&(m.homeId===teamId||m.awayId===teamId));
  let w=0,d=0,l=0,gf=0,ga=0;
  fin.forEach(m=>{
    const isHome = m.homeId===teamId;
    const myG = isHome?(m.homeScore||0):(m.awayScore||0);
    const opG = isHome?(m.awayScore||0):(m.homeScore||0);
    gf+=myG; ga+=opG;
    if(myG>opG) w++; else if(myG===opG) d++; else l++;
  });
  return {p:fin.length,w,d,l,gf,ga,gd:gf-ga};
}

function getTeamForm(teamId, count) {
  // ✅ مرتّبة زمنياً (الأقدم → الأحدث) لعرض صحيح للفورم
  const finished = matches
    .filter(m => m.status === 'finished' && (m.homeId === teamId || m.awayId === teamId))
    .sort((a, b) => {
      const _t = m => (m.date ? new Date(m.date + 'T' + (m.time || '00:00')).getTime() : 0) || (m.round || 0);
      return _t(a) - _t(b);
    })
    .slice(-count);
  return finished.map(m => {
    const isHome = m.homeId === teamId;
    const myScore = isHome ? (m.homeScore || 0) : (m.awayScore || 0);
    const opScore = isHome ? (m.awayScore || 0) : (m.homeScore || 0);
    const r = myScore > opScore ? 'w' : myScore < opScore ? 'l' : 'd';
    return r;
  });
}
// ── فورم مفصّل (مع الخصم والنتيجة) لعرض غنيّ في صفحة الفريق ──
function getTeamFormDetailed(teamId, count) {
  const finished = matches
    .filter(m => m.status === 'finished' && (m.homeId === teamId || m.awayId === teamId))
    .sort((a, b) => {
      const _t = m => (m.date ? new Date(m.date + 'T' + (m.time || '00:00')).getTime() : 0) || (m.round || 0);
      return _t(a) - _t(b);
    })
    .slice(-count);
  return finished.map(m => {
    const isHome = m.homeId === teamId;
    const myScore = isHome ? (m.homeScore || 0) : (m.awayScore || 0);
    const opScore = isHome ? (m.awayScore || 0) : (m.homeScore || 0);
    const oppId = isHome ? m.awayId : m.homeId;
    const opp = (teams || []).find(t => t.id === oppId);
    const r = myScore > opScore ? 'w' : myScore < opScore ? 'l' : 'd';
    return { r, my: myScore, op: opScore, oppName: (opp && opp.name) || m.awayName || '؟', round: m.round || 0 };
  });
}

// ════════════════════════════════════════
//  TEAM PROFILE OVERLAY
// ════════════════════════════════════════
// ── عدّ البطاقات الصفراء/الحمراء لفريق عبر كل مبارياته المنتهية ──
function _teamCardsSplit(teamId) {
  let y = 0, r = 0;
  (matches || []).forEach(m => {
    if (m.status !== 'finished') return;
    if (m.homeId !== teamId && m.awayId !== teamId) return;
    const side = m.homeId === teamId ? 'home' : 'away';
    _matchEvents(m).forEach(ev => {
      if (_evSide(ev) !== side) return;
      if (ev.type === 'yellow') y++;
      else if (ev.type === 'red') r++;
    });
  });
  return { y, r };
}

window.openTeamProfile = function(teamId) {
  const t = teams.find(x=>x.id===teamId);
  if(!t) return;
  const overlay = document.getElementById('teamProfileOverlay');
  const body = document.getElementById('teamProfileBody');
  if(!overlay||!body) return;
  window._lastTeamProfileId = teamId; // كي يعيد مستمع الكشف رسم الصفحة عند تعديل اسم

  const lnEl = document.getElementById('tpLeagueName');
  if(lnEl) lnEl.textContent = t.name;

  const stats = getTeamStats(teamId);
  const form = getTeamForm(teamId, 8);
  const sorted = [...teams].sort((a,b)=>(b.pts||0)-(a.pts||0));
  const pos = sorted.findIndex(x=>x.id===teamId) + 1;

  // مباريات الفريق
  const teamMatches = matches.filter(m=>m.homeId===teamId||m.awayId===teamId);
  const finished = teamMatches.filter(m=>m.status==='finished').slice(-5).reverse();
  const upcoming = teamMatches.filter(m=>m.status==='upcoming').slice(0,3);

  // لاعبو الفريق من الكشف الحيّ الموحّد (المستمع يعيد الرسم عند أي تعديل اسم)
  window._teamRosters = window._teamRosters || {};
  _ensureRosterLoaded(teamId);
  const players = (window._teamRosters[teamId] && window._teamRosters[teamId].length)
    ? window._teamRosters[teamId]
    : (t.players || []);

  // هدّافو الفريق — من نفس محرّك الهدّافين (بالهوية) كي يطابق جدول الهدّافين
  // ولا يعرض الدقائق أو يخبص. buildScorersData يرجع {name, playerId, teamId, goals, ...}
  const _allScorers = (typeof buildScorersData === 'function') ? buildScorersData() : [];
  const topScorers = _allScorers
    .filter(p => p.teamId === teamId && p.goals > 0)
    .slice(0, 8)
    .map(p => [p.name, p.goals, p.playerId]);

  // ══ الأقسام مبنية كمتغيّرات ثم موزّعة على تبويبات ══
  const _infoSection = (function(){
      const _ic = (n) => window.Icon ? window.Icon(n, 14) : '';
      const rows = [
        ['المدرب',        t.coach,     _ic('user')],
        ['المدير',        t.manager,   _ic('users')],
        ['الملعب',        t.stadium,   _ic('stadium')],
        ['سنة التأسيس',   t.founded,   _ic('calendar')],
        ['الاسم المختصر', t.shortName, _ic('tag')],
        ['إنستغرام',      t.insta,     _ic('camera')],
      ].filter(r => r[1] && String(r[1]).trim());
      const bio = (t.bio && String(t.bio).trim()) ? String(t.bio).trim() : '';
      if (!rows.length && !bio) return '';
      return `
      <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
        <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">معلومات النادي</div>
        ${rows.map(([lbl,val,ic])=>`
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--b1)">
            <span style="width:20px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--t3)">${ic}</span>
            <span style="font-size:11px;color:var(--t3);flex:0 0 auto">${lbl}</span>
            <span style="flex:1;text-align:end;font-size:12px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${val}</span>
          </div>`).join('')}
        ${bio ? `<div style="margin-top:10px;padding:10px;border-radius:9px;background:var(--s2);font-size:11.5px;line-height:1.9;color:var(--t2)">${bio}</div>` : ''}
      </div>`;
    })();

  const _statsSection = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);background:var(--s1);border-bottom:1px solid var(--b1);margin-bottom:6px">
      ${[
        ['نقطة','pts',t.pts||0,'var(--gold)'],
        ['لعب','p',stats.p,'var(--t2)'],
        ['فوز','w',stats.w,'var(--green)'],
        ['خسر','l',stats.l,'var(--red)'],
      ].map(([lbl,,val,clr])=>`
        <div style="padding:12px 6px;text-align:center;position:relative">
          <div style="font-size:22px;font-weight:900;font-family:'Tajawal',sans-serif;color:${clr};line-height:1">${val}</div>
          <div style="font-size:9px;color:var(--t3);margin-top:2px">${lbl}</div>
        </div>`).join('')}
    </div>
    ${(function(){
      const c = _teamCardsSplit(teamId);
      const cells = [
        ['سجّل',     stats.gf, 'var(--green)'],
        ['استقبل',   stats.ga, 'var(--red)'],
        ['± الفارق', (stats.gd>0?'+':'')+stats.gd, stats.gd>0?'var(--green)':stats.gd<0?'var(--red)':'var(--t2)'],
        ['🟨 صفراء', c.y, '#E5B800'],
        ['🟥 حمراء', c.r, '#E5533D'],
      ];
      return `
      <div style="display:grid;grid-template-columns:repeat(5,1fr);background:var(--s1);border-bottom:1px solid var(--b1);margin-bottom:6px">
        ${cells.map(([lbl,val,clr])=>`
          <div style="padding:12px 4px;text-align:center">
            <div style="font-size:19px;font-weight:900;font-family:'Tajawal',sans-serif;color:${clr};line-height:1">${val}</div>
            <div style="font-size:9px;color:var(--t3);margin-top:3px">${lbl}</div>
          </div>`).join('')}
      </div>`;
    })()}
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px">آخر النتائج</span>
        ${(() => {
          const _fd = (typeof getTeamFormDetailed === 'function') ? getTeamFormDetailed(teamId, 5) : [];
          const w = _fd.filter(x=>x.r==='w').length, d = _fd.filter(x=>x.r==='d').length, l = _fd.filter(x=>x.r==='l').length;
          return _fd.length ? `<span style="font-size:10px;color:var(--t3)"><b style="color:var(--green,#27ae60)">${w}ف</b> · <b style="color:#8a90a0">${d}ت</b> · <b style="color:var(--red,#C0392B)">${l}خ</b></span>` : '';
        })()}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${(() => {
          const _fd = (typeof getTeamFormDetailed === 'function') ? getTeamFormDetailed(teamId, 5) : form.map(r=>({r}));
          return _fd.map(f=>{
            const c = f.r==='w' ? 'var(--green,#27ae60)' : f.r==='l' ? 'var(--red,#C0392B)' : '#8a90a0';
            const ch = f.r==='w'?'ف':f.r==='l'?'خ':'ت';
            const sub = (f.my!=null) ? `<div style="font-size:8px;color:var(--t3);margin-top:3px;white-space:nowrap">${f.my}-${f.op}</div>` : '';
            const tip = f.oppName ? `title="ضد ${f.oppName} (${f.my}-${f.op})"` : '';
            return `<div ${tip} style="display:flex;flex-direction:column;align-items:center;gap:0">
              <div style="width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#fff;background:${c};box-shadow:0 2px 5px rgba(0,0,0,.3)">${ch}</div>
              ${sub}
            </div>`;
          }).join('');
        })()}
        ${!form.length?'<div style="font-size:11px;color:var(--t3)">لا توجد مباريات بعد</div>':''}
      </div>
    </div>
    ${_infoSection}`;

  const _matchesSection = `
    ${finished.length?`
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">آخر المباريات</div>
      ${finished.map(m=>{
        const isHome=m.homeId===teamId;
        const opp=teams.find(x=>x.id===(isHome?m.awayId:m.homeId))||{name:isHome?(m.awayName||'؟'):(m.homeName||'؟'),logo:''};
        const myG=isHome?(m.homeScore||0):(m.awayScore||0);
        const opG=isHome?(m.awayScore||0):(m.homeScore||0);
        const res=myG>opG?'ف':myG<opG?'خ':'ت';
        const rc=myG>opG?'var(--green)':myG<opG?'var(--live)':'var(--t3)';
        const rb=myG>opG?'var(--gn-bg)':myG<opG?'var(--lv-bg)':'var(--s3)';
        const rbr=myG>opG?'var(--gn-br)':myG<opG?'var(--lv-br)':'var(--b2)';
        return `
        <div onclick="openMatchDetail('${m.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--b1);cursor:pointer">
          <div style="width:28px;height:28px;border-radius:7px;background:${rb};border:1px solid ${rbr};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:${rc};flex-shrink:0">${res}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--t1)">ضد ${opp.name}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:1px">جولة ${m.round||1}${m.date?' · '+m.date:''}</div>
          </div>
          <div style="font-size:16px;font-weight:900;font-family:'Tajawal',sans-serif;color:var(--t1)">${myG} - ${opG}</div>
        </div>`;
      }).join('')}
    </div>`:'' }
    ${upcoming.length?`
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">المباريات القادمة</div>
      ${upcoming.map(m=>{
        const isHome=m.homeId===teamId;
        const opp=teams.find(x=>x.id===(isHome?m.awayId:m.homeId))||{name:isHome?(m.awayName||'؟'):(m.homeName||'؟'),logo:''};
        return `
        <div onclick="openMatchDetail('${m.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--b1);cursor:pointer">
          <div style="width:32px;height:32px;border-radius:8px;overflow:hidden;flex-shrink:0;background:var(--s3);display:flex;align-items:center;justify-content:center">
            ${logoHtml(opp.logo,28,6)}
          </div>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:700;color:var(--t1)">ضد ${opp.name}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:1px">جولة ${m.round||1}${m.date?' · '+m.date:''}${m.time?' · '+formatTimeTo12H(m.time):''}</div>
          </div>
          <div style="font-size:10px;color:var(--gold);background:var(--g-bg);border:1px solid var(--g-br);border-radius:6px;padding:3px 8px;font-weight:700">قادمة</div>
        </div>`;
      }).join('')}
    </div>`:'' }
    ${(!finished.length && !upcoming.length)?'<div style="padding:40px 20px;text-align:center;color:var(--t3);font-size:12px">لا توجد مباريات بعد</div>':''}`;

  const _playersSection = `
    ${topScorers.length?`
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">هدافو الفريق</div>
      ${topScorers.map(([name,goals,pid],i)=>{
        const _ph = (typeof _lineupPhoto==='function') ? _lineupPhoto({id:pid,name}, teamId) : '';
        const _rank = i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1);
        const _av = _ph
          ? `<div style="position:relative;width:40px;height:40px;flex-shrink:0">
               <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--s3);border:2px solid ${i===0?'#e6c157':'var(--b2)'}"><img src="${_ph}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>
               <span style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;background:${i===0?'linear-gradient(135deg,#ffd700,#b8860b)':'var(--s2)'};border:1.5px solid var(--s1);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:${i===0?'#000':'var(--t2)'}">${i+1}</span>
             </div>`
          : `<div style="width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 50% 35%,#1c2740,#0d1526);border:2px solid ${i===0?'#e6c157':'var(--b2)'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:${i===0?'#e6c157':'var(--t3)'};flex-shrink:0">${_rank}</div>`;
        return `
        <div onclick="closeTeamProfile();setTimeout(()=>openPlayerModal('${name.replace(/'/g,"\\'")}','${teamId}','${pid||''}'),300)" style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--b1);cursor:pointer">
          ${_av}
          <div style="flex:1;min-width:0;font-size:13.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
          <div style="display:flex;align-items:baseline;gap:3px"><span style="font-size:19px;font-weight:900;color:var(--gold);font-family:'Tajawal',sans-serif">${goals}</span><span style="font-size:10px;color:var(--t3)">هدف</span></div>
        </div>`;}).join('')}
    </div>`:'' }
    ${players.length?`
    <div style="background:var(--s1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">قائمة اللاعبين</div>
      ${players.map(p=>{
        const _sn=(p.name||'').replace(/'/g,"\\'");
        const _isGK = p.position==='GK';
        const _ringC = _isGK ? '#8E44AD' : 'var(--b2)';
        const _av = p.photo
          ? `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden"><img src="${p.photo}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`
          : `<div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#1c2740,#0d1526);display:flex;align-items:center;justify-content:center;color:${_isGK?'#CE9FFC':'var(--t3)'}">${window._playerSilhouetteSVG?`<span style="display:block;width:58%;height:58%">${window._playerSilhouetteSVG()}</span>`:(p.number||'—')}</div>`;
        return `
        <div onclick="closeTeamProfile();setTimeout(()=>openPlayerModal('${_sn}','${teamId}','${p.id||''}'),300)" style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--b1);cursor:pointer">
          <div style="position:relative;width:42px;height:42px;flex-shrink:0;border-radius:50%;border:2px solid ${_ringC};padding:1px">
            ${_av}
            ${p.number?`<span style="position:absolute;bottom:-3px;right:-3px;min-width:17px;height:17px;padding:0 3px;border-radius:999px;background:var(--s2);border:1.5px solid var(--s1);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:var(--t2)">${p.number}</span>`:''}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name||'لاعب'}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:1px">${({GK:'حارس مرمى',DEF:'مدافع',MID:'وسط',FWD:'مهاجم',SUB:'بديل'})[p.position]||p.position||''}</div>
          </div>
          ${_isGK?'<span style="font-size:9px;background:rgba(142,68,173,.14);color:#8E44AD;border:1px solid rgba(142,68,173,.3);border-radius:5px;padding:2px 6px;font-weight:700">GK</span>':''}
          ${p.status==='injured'?'<span style="font-size:9px;background:var(--lv-bg);color:var(--live);border:1px solid var(--lv-br);border-radius:5px;padding:2px 6px;font-weight:700">مصاب</span>':''}
          ${p.status==='suspended'?'<span style="font-size:9px;background:var(--g-bg);color:var(--gold);border:1px solid var(--g-br);border-radius:5px;padding:2px 6px;font-weight:700">موقوف</span>':''}
        </div>`;}).join('')}
    </div>`:'' }
    ${(!topScorers.length && !players.length)?'<div style="padding:40px 20px;text-align:center;color:var(--t3);font-size:12px">لم تُدخَل قائمة اللاعبين بعد</div>':''}`;

  body.innerHTML = `
    <!-- هيدر الفريق -->
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:24px 16px 20px;text-align:center">
      <div style="width:72px;height:72px;border-radius:16px;background:var(--s2);border:1px solid var(--b2);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        ${logoHtml(t.logo, 56, 12)}
      </div>
      <div style="font-size:20px;font-weight:900;color:var(--t1);margin-bottom:4px">${t.name}</div>
      <div style="font-size:11px;color:var(--t3)">المركز ${pos} · ${league?.name||'البطولة'}</div>
    </div>

    <!-- شريط التبويبات -->
    <div class="tp-tabs">
      <button class="tp-tab active" data-tp="overview" onclick="tpSwitch('overview',this)">نظرة عامة</button>
      <button class="tp-tab" data-tp="matches" onclick="tpSwitch('matches',this)">المباريات</button>
      <button class="tp-tab" data-tp="players" onclick="tpSwitch('players',this)">اللاعبون</button>
    </div>

    <div class="tp-panel" data-tp-panel="overview">${_statsSection}</div>
    <div class="tp-panel" data-tp-panel="matches" style="display:none">${_matchesSection}</div>
    <div class="tp-panel" data-tp-panel="players" style="display:none">${_playersSection}</div>

    <div style="height:env(safe-area-inset-bottom,16px)"></div>
  `;

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
};

// تبديل تبويبات ملف الفريق
window.tpSwitch = function(name, btn) {
  document.querySelectorAll('.tp-tab').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tp-panel').forEach(p => {
    p.style.display = (p.getAttribute('data-tp-panel') === name) ? 'block' : 'none';
  });
  const sc = document.getElementById('teamProfileBody');
  if (sc) sc.scrollTop = 0;
};

window.closeTeamProfile = function() {
  document.getElementById('teamProfileOverlay')?.classList.remove('show');
  document.body.style.overflow = '';
};

function startCardTimers() {
  if (typeof window.renderLiveMatchesTab === 'function') {
    window.renderLiveMatchesTab();
  }
}

// ✅︎ إعادة تشغيل التايمر عند العودة للصفحة
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // المستخدم رجع للصفحة — أعد تشغيل التايمر
    startCardTimers();
  }
});

// iOS Safari: pageshow يُطلق عند العودة من cache
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    startCardTimers();
  }
});

// ════════════════════════════════════════════════════════════
//  دوال مكملة — النظام الموحّد النهائي (V3)
// ════════════════════════════════════════════════════════════

// ── closeMatchDetail ──────────────────────────────────────
window.closeMatchDetail = function() {
  document.getElementById('matchDetailOverlay')?.classList.remove('show');
  document.body.style.overflow = '';
  Object.values(_detailClocks||{}).forEach(t => clearInterval(t));
};

// ── closeLiveOverlay (stub — لا توجد overlay بث منفصلة) ──
window.closeLiveOverlay = function() {};

// ── applyTiebreak ─────────────────────────────────────────
function _teamCardCount(teamId, matchList) {
  // عدد البطاقات (صفراء=1، حمراء=3 كوزن عادل) لفريق عبر كل مبارياته المنتهية
  let pts = 0;
  (matchList || matches).forEach(m => {
    if (m.status !== 'finished') return;
    if (m.homeId !== teamId && m.awayId !== teamId) return;
    const side = m.homeId === teamId ? 'home' : 'away';
    const evs = _matchEvents(m);
    evs.forEach(ev => {
      if (_evSide(ev) !== side) return;
      if (ev.type === 'yellow') pts += 1;
      else if (ev.type === 'red') pts += 3;
    });
  });
  return pts;
}

function applyTiebreak(a, b, matchList) {
  const _dis = settings.tiebreakDisabled || [];
  const order = (settings.tiebreakOrder || ['gd','gf','h2h','wins','cards','draw'])
    .filter(r => r === 'draw' || _dis.indexOf(r) === -1);
  for (const rule of order) {
    if (rule === 'h2h') {
      const h2h = (matchList||matches).filter(m =>
        m.status === 'finished' &&
        ((m.homeId === a.id && m.awayId === b.id) ||
         (m.homeId === b.id && m.awayId === a.id))
      );
      let aP = 0, bP = 0;
      h2h.forEach(m => {
        const aIsHome = m.homeId === a.id;
        const aG = aIsHome ? (m.homeScore||0) : (m.awayScore||0);
        const bG = aIsHome ? (m.awayScore||0) : (m.homeScore||0);
        if (aG > bG) aP += settings.winPts||3;
        else if (aG < bG) bP += settings.winPts||3;
        else { aP += settings.drawPts||1; bP += settings.drawPts||1; }
      });
      if (aP !== bP) return bP - aP;
    } else if (rule === 'gd') {
      const agd = (a.gf||0)-(a.ga||0), bgd = (b.gf||0)-(b.ga||0);
      if (agd !== bgd) return bgd - agd;
    } else if (rule === 'gf') {
      if ((a.gf||0) !== (b.gf||0)) return (b.gf||0)-(a.gf||0);
    } else if (rule === 'wins') {
      if ((a.w||0) !== (b.w||0)) return (b.w||0)-(a.w||0);
    } else if (rule === 'cards') {
      const ca = _teamCardCount(a.id, matchList), cb = _teamCardCount(b.id, matchList);
      if (ca !== cb) return ca - cb; // الأقل بطاقات يتقدّم
    }
  }
  return (a.name||'').localeCompare(b.name||'');
}
window.applyTiebreak = applyTiebreak;

// ── جمع كشوف اللاعبين (كشف الفريق الرسمي + تشكيلات المباريات) ──
// يُستخدم لإيجاد هوية اللاعب (id) حتى لو تشابهت الأسماء بين فريقين.
function _collectScorerRosters() {
  const out = {};
  // ① المصدر الموثوق: الكشف الحيّ (subcollection) — الاسم منه لا يُلمَس أبداً
  const src = window._teamRosters || window.rosterCache || {};
  Object.keys(src).forEach(tid => {
    out[tid] = (src[tid] || []).map(p => ({ id: p.id, name: p.name, number: p.number }));
  });
  const _hasId  = (tid, id)  => id && out[tid] && out[tid].some(x => x.id === id);
  const _hasNm  = (tid, nm)  => {
    const norm = window.ScorersCore ? window.ScorersCore.normName(nm) : nm;
    return out[tid] && out[tid].some(x => (window.ScorersCore ? window.ScorersCore.normName(x.name) : x.name) === norm);
  };
  // ② تكملة فقط للاعبين غير الموجودين في الكشف (تشكيلات/بيانات قديمة) —
  //    لا نعدّل اسم لاعب له هوية موجودة أصلاً (الكشف هو الحَكَم).
  (matches || []).forEach(m => {
    [['home', m.homeId], ['away', m.awayId]].forEach(([side, tid]) => {
      if (!tid) return;
      out[tid] = out[tid] || [];
      const ld = m.liveData || {};
      const lu = side === 'home' ? ld.homeLineup : ld.awayLineup;
      if (!lu || !lu.players) return;
      lu.players.forEach(p => {
        if (!p || !p.name) return;
        if (p.id && _hasId(tid, p.id)) return;         // له هوية في الكشف → لا تكرّره
        if (!p.id && _hasNm(tid, p.name)) return;       // موجود بالاسم → لا تكرّره
        out[tid].push({ id: p.id || null, name: p.name, number: p.number });
      });
    });
  });
  return out;
}

// ── buildScorersData ──────────────────────────────────────
// ✅︎ يفصل اللاعبين بالهوية (playerId أو teamId+الاسم المُطبَّع) عبر ScorersCore
//    بدل تجميع الأهداف بالاسم المجرّد — لاعبان بنفس الاسم في فريقين مختلفين
//    (مثال: "علي" في الجوارح و"علي" في النجوم) لم يعودا يُدمَجان في سطر واحد.
function buildScorersData() {
  if (window.ScorersCore) {
    return window.ScorersCore.build({
      matches: matches || [],
      teams: teams || [],
      rosters: _collectScorerRosters()
    });
  }

  // احتياط (scorers-core.js غير محمّل) — يبني من الأحداث أولاً (الأدق)،
  // ويتجاهل الدقيقة في النص فلا يتكرّر «سالم 12» و«سالم 40» كلاعبين.
  const map = {};
  const _normNm = s => String(s || '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 🛡️ كشف الأسماء المكرّرة فعلياً داخل نفس الفريق (لاعبان مختلفان، نفس الاسم):
  //    نبنيه من قوائم اللاعبين. عند التكرار الفعلي نفصل بالـ playerId؛
  //    غير ذلك نوحّد بالاسم (فلا يتكرّر نفس اللاعب عبر الجولات).
  const _dupNames = {}; // "tid::name" => true إذا وُجد لاعبان بنفس الاسم في الفريق
  (function detectDuplicates(){
    (teams || []).forEach(t => {
      const roster = t.players || t.roster || [];
      const seen = {};
      roster.forEach(p => {
        const nm = _normNm(p && (p.name || p.playerName));
        if (!nm) return;
        const k = t.id + '::' + nm;
        if (seen[k]) _dupNames[k] = true;   // ظهر مرتين = اسم مكرّر فعلاً
        seen[k] = true;
      });
    });
  })();

  const addGoal = (rawName, tid, playerId) => {
    // 🔄 لو الهدف مرتبط بـ playerId، اجلب الاسم الحالي من قائمة الفريق
    //    (فتغيير اسم اللاعب في الفريق ينعكس تلقائياً في ترتيب الهدافين).
    let displayName = rawName;
    if (playerId) {
      const team = teams.find(t => t.id === tid);
      const roster = (team && (team.players || team.roster)) || [];
      const p = roster.find(pl => pl && (pl.id === playerId || pl.playerId === playerId));
      if (p && (p.name || p.playerName)) displayName = p.name || p.playerName;
    }
    const name = _normNm(displayName);
    if (!name || name === '—' || name === '؟' || name === '?') return;
    const dupKey = tid + '::' + name;
    const key = (_dupNames[dupKey] && playerId) ? (tid + '::id::' + playerId) : dupKey;
    if (!map[key]) {
      const team = teams.find(t => t.id === tid) || {};
      map[key] = { name, goals: 0, teamId: tid, teamName: team.name || '', teamLogo: team.logo || '', playerId: playerId || null };
    }
    map[key].goals += 1;
    if (!map[key].playerId && playerId) map[key].playerId = playerId;
  };

  matches.filter(m => m.status === 'finished').forEach(m => {
    const evs = _matchEvents(m);
    if (evs.length) {
      // المصدر الأساسي: الأحداث (تفصل بالهوية، تتجاهل الدقيقة تلقائياً)
      evs.forEach(ev => {
        if (!ev) return;
        if (ev.type === 'penalty' || ev.isShootout || ev.shootout) return; // ترجيح لا يُحتسب
        if (ev.type !== 'goal') return; // العكسي 'own' لا يُنسب للاعب
        const tid = ev.teamId || (_evSide(ev) === 'home' ? m.homeId : m.awayId);
        addGoal(ev.player, tid, ev.playerId);
      });
    } else {
      // احتياطي: حقول النص — مع تجريد الدقيقة من آخر الاسم
      [[m.homeScorers, m.homeId], [m.awayScorers, m.awayId]].forEach(([sc, tid]) => {
        if (!sc) return;
        sc.split(',').forEach(s => {
          // «سالم 12» أو «سالم 12'» أو «سالم (2)» → نجرّد الدقيقة/العدد الملتصق
          let name = s.trim()
            .replace(/\s*\(\d+\)\s*$/, '')            // (2) في النهاية
            .replace(/[\s\u00A0]*\d+\+?\d*'?\s*$/, '') // 12 أو 45+2 أو 90'
            .trim();
          if (name) addGoal(name, tid, null);
        });
      });
    }
  });
  return Object.values(map).sort((a, b) => b.goals - a.goals);
}

// ── renderScorers ─────────────────────────────────────────
// كم عنصراً يُعرض ابتداءً في كل قسم (الهدّافون: الكل)
const STAT_PREVIEW = 5;
window._statExpanded = window._statExpanded || { scorers:false, assists:false, yellow:false, red:false };

// خيارات العرض التي يضبطها المنظّم من إعدادات البطولة.
// المفاتيح تُحفظ مسطّحة داخل وثيقة settings (showAssists / showAssistPicker ...)،
// مع دعم رجوع للبنية القديمة displayOptions إن وُجدت.
function _displayOpts() {
  const s = window.settings || {};
  const legacy = (window.league && window.league.displayOptions) || {};
  return Object.assign({}, legacy, s.displayOptions || {}, {
    showAssists: s.showAssists,
    showAssistPicker: s.showAssistPicker,
    showScorers: s.showScorers,
    showStats: s.showStats
  });
}

// صفّ لاعب موحّد داخل الإحصائيات (يُستعمل لكل الأقسام الأربعة)
// صورة اللاعب من الكشف الحيّ: بالهوية إن وُجدت، وإلا بالاسم (للأحداث القديمة)
function _playerPhoto(teamId, playerId, name) {
  if (!window._teamRosters || !window._teamRosters[teamId]) return '';
  const roster = window._teamRosters[teamId];
  if (playerId) {
    const p = roster.find(x => x && x.id === playerId);
    if (p && p.photo) return p.photo;
  }
  if (name) {
    const _norm = s => String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    const n = _norm(name);
    const p = roster.find(x => x && _norm(x.name) === n && x.photo);
    if (p) return p.photo;
  }
  return '';
}

function _statRow(p, i, valField, valColor, unitLabel) {
  const team = teams.find(t => t.id === p.teamId) || {};
  const teamLogo = team.logo || p.teamLogo || '';
  const photo = _playerPhoto(p.teamId, p.playerId, p.name);
  const medal = i < 3
    ? `<span style="font-size:16px">${['🥇','🥈','🥉'][i]}</span>`
    : `<div style="width:22px;height:22px;border-radius:6px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:var(--t3)">${i+1}</div>`;
  const val = p[valField];
  const safeName = String(p.name || '').replace(/'/g, "\\'");
  const safePid = p.playerId ? String(p.playerId).replace(/'/g, "\\'") : '';
  // الصورة: دائرة أنيقة لصورة اللاعب + شارة صغيرة لشعار الفريق بالزاوية.
  // إن لم توجد صورة → شعار الفريق في مربّع كالسابق (بلا تغيير للمظهر القديم).
  const avatar = photo
    ? `<div style="position:relative;width:38px;height:38px;flex-shrink:0">
         <div style="width:38px;height:38px;border-radius:50%;overflow:hidden;background:var(--s3);border:1.5px solid var(--b2)">
           <img src="${photo}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">
         </div>
         ${teamLogo ? `<div style="position:absolute;bottom:-2px;left:-2px;width:17px;height:17px;border-radius:50%;overflow:hidden;background:var(--s1);border:1.5px solid var(--s1);display:flex;align-items:center;justify-content:center">${logoHtml(teamLogo, 14, 3)}</div>` : ''}
       </div>`
    : `<div style="width:32px;height:32px;border-radius:8px;overflow:hidden;background:var(--s3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
         ${logoHtml(teamLogo, 28, 6)}
       </div>`;
  return `<div class="scorer-row ${i===0?'top1':''}" onclick="openPlayerModal('${safeName}','${p.teamId||''}','${safePid}')">
    ${medal}
    ${avatar}
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:700;color:var(--t1)">${p.name}</div>
      <div style="font-size:10px;color:var(--t3);margin-top:1px">${p.teamName}</div>
    </div>
    <div style="text-align:center;min-width:32px">
      <div style="font-size:20px;font-weight:900;color:${valColor};font-family:'Tajawal',sans-serif">${val}</div>
      <div style="font-size:9px;color:var(--t3)">${unitLabel}</div>
    </div>
    <div style="font-size:14px;color:var(--t3)">←</div>
  </div>`;
}

function _emptyStat(icon, msg) {
  return `<div class="empty-state"><div style="font-size:32px;margin-bottom:6px;opacity:.3">${icon}</div><div>${msg}</div></div>`;
}

// يرسم قسماً واحداً (صنّاع/صفراء/حمراء): معاينة ٥ + زر عرض المزيد
function _renderStatSection(listId, moreBtnId, data, key, valColor, unit, emptyIcon, emptyMsg) {
  const el = document.getElementById(listId);
  const moreBtn = document.getElementById(moreBtnId);
  if (!el) return;
  const searching = !!window._statsQuery;
  if (!data.length) {
    el.innerHTML = _emptyStat(emptyIcon, searching ? 'لا يوجد لاعب بهذا الاسم' : emptyMsg);
    if (moreBtn) moreBtn.style.display = 'none';
    return;
  }
  const expanded = searching || !!window._statExpanded[key];
  const shown = expanded ? data : data.slice(0, STAT_PREVIEW);
  el.innerHTML = shown.map((p, i) => _statRow(p, i, 'count', valColor, unit)).join('');
  if (moreBtn) {
    if (!searching && data.length > STAT_PREVIEW) {
      moreBtn.style.display = 'block';
      moreBtn.textContent = expanded ? 'عرض أقل ↑' : `عرض المزيد (${data.length - STAT_PREVIEW}) ↓`;
    } else {
      moreBtn.style.display = 'none';
    }
  }
}

window.toggleStatMore = function (key, btn) {
  window._statExpanded[key] = !window._statExpanded[key];
  renderStats();
};

// ── بحث اللاعبين داخل الإحصائيات (يفلتر الأقسام الأربعة بالاسم) ──
window._statsQuery = '';
function _normStatsQ(s) {
  return String(s || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
window.filterStatsSearch = function (val) {
  window._statsQuery = _normStatsQ(val);
  const c = document.getElementById('statsSearchClear');
  if (c) c.style.display = window._statsQuery ? 'block' : 'none';
  renderStats();
};
window.clearStatsSearch = function () {
  const inp = document.getElementById('statsSearch'); if (inp) inp.value = '';
  window._statsQuery = '';
  const c = document.getElementById('statsSearchClear'); if (c) c.style.display = 'none';
  renderStats();
};
function _applyStatsFilter(list) {
  const q = window._statsQuery;
  if (!q) return list;
  return list.filter(p => _normStatsQ(p.name).includes(q));
}

// ── الدالة الرئيسية: تبني كل الأقسام ──
function renderStats() {
  const opts = _displayOpts();
  // تأكد أن كشوف كل الفرق مُشترَك بها (المستمع الموحّد يعيد الرسم عند أي تحديث)
  (teams || []).forEach(t => { if (t && t.id) _ensureRosterLoaded(t.id); });
  const _searching = !!window._statsQuery;
  // أخفِ ملخص البطولة أثناء البحث لإبراز نتائج اللاعب
  const _sumWrap = document.getElementById('statsSummaryWrap');
  if (_sumWrap) _sumWrap.style.display = _searching ? 'none' : 'block';
  const _rosters = _collectScorerRosters();
  const scorers = _applyStatsFilter(buildScorersData());

  // 1) الهدّافون — أفضل 5 مع "عرض المزيد" (عند البحث تُعرض كل المطابقات)
  const sc = document.getElementById('statScorers');
  const scMore = document.getElementById('more-scorers');
  if (sc) {
    if (!scorers.length) {
      sc.innerHTML = _emptyStat('⚽', _searching ? 'لا يوجد لاعب بهذا الاسم' : 'لا توجد أهداف بعد');
      if (scMore) scMore.style.display = 'none';
    } else {
      const expanded = _searching || !!window._statExpanded.scorers;
      const shown = expanded ? scorers : scorers.slice(0, STAT_PREVIEW);
      sc.innerHTML = shown.map((p, i) => _statRow(p, i, 'goals', 'var(--gold)', 'هدف')).join('');
      if (scMore) {
        if (!_searching && scorers.length > STAT_PREVIEW) {
          scMore.style.display = 'block';
          scMore.textContent = expanded ? 'عرض أقل ↑' : `عرض المزيد (${scorers.length - STAT_PREVIEW}) ↓`;
        } else {
          scMore.style.display = 'none';
        }
      }
    }
  }

  // 2) الصنّاع — لا يظهر إلا إذا فعّله المنظّم
  const assistsBlock = document.getElementById('stb-assists');
  const showAssists = opts.showAssists === true;
  if (assistsBlock) assistsBlock.style.display = showAssists ? 'block' : 'none';
  if (showAssists && window.StatsCore) {
    const assists = _applyStatsFilter(window.StatsCore.buildAssists({ matches: matches || [], teams: teams || [], rosters: _rosters }));
    _renderStatSection('statAssists', 'more-assists', assists, 'assists', 'var(--green,#27ae60)', 'صناعة', '👟', 'لا توجد صناعات بعد');
  }

  // 3) البطاقات الصفراء
  if (window.StatsCore) {
    const yellows = _applyStatsFilter(window.StatsCore.buildYellows({ matches: matches || [], teams: teams || [], rosters: _rosters }));
    _renderStatSection('statYellow', 'more-yellow', yellows, 'yellow', '#e6b800', 'بطاقة', '🟨', 'لا توجد بطاقات صفراء');
  }

  // 4) البطاقات الحمراء
  if (window.StatsCore) {
    const reds = _applyStatsFilter(window.StatsCore.buildReds({ matches: matches || [], teams: teams || [], rosters: _rosters }));
    _renderStatSection('statRed', 'more-red', reds, 'red', 'var(--red,#c0392b)', 'بطاقة', '🟥', 'لا توجد بطاقات حمراء');
  }
}

// توافق خلفي: أي استدعاء قديم لـ renderScorers يوجَّه للنظام الجديد
function renderScorers() {
  const home = document.getElementById('homeScorers');
  if (home) {
    const data = buildScorersData().slice(0, 5);
    home.innerHTML = data.length
      ? data.map((p, i) => _statRow(p, i, 'goals', 'var(--gold)', 'هدف')).join('')
      : _emptyStat('⚽', 'لا توجد أهداف بعد');
  }
  renderStats();
}
window.renderStats = renderStats;
window.renderScorers = renderScorers;

// ── renderStandings ───────────────────────────────────────
function renderStandings() {
  // حساب إحصائيات الفرق من المباريات
  const statsMap = {};
  teams.forEach(t => {
    statsMap[t.id] = { id: t.id, p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 };
  });
  matches.filter(m => m.status === 'finished').forEach(m => {
    const h = statsMap[m.homeId], a = statsMap[m.awayId];
    if (!h || !a) return;
    h.p++; a.p++;
    h.gf += (m.homeScore||0); h.ga += (m.awayScore||0);
    a.gf += (m.awayScore||0); a.ga += (m.homeScore||0);
    if ((m.homeScore||0) > (m.awayScore||0)) {
      h.w++; h.pts += settings.winPts||3; a.l++;
    } else if ((m.homeScore||0) < (m.awayScore||0)) {
      a.w++; a.pts += settings.winPts||3; h.l++;
    } else {
      h.d++; a.d++; h.pts += settings.drawPts||1; a.pts += settings.drawPts||1;
    }
  });

  // تحديث بيانات الفرق
  teams.forEach(t => { if (statsMap[t.id]) Object.assign(t, statsMap[t.id]); });

  const sorted = [...teams].sort((a, b) => {
    if ((b.pts||0) !== (a.pts||0)) return (b.pts||0)-(a.pts||0);
    return applyTiebreak(a, b, matches);
  });

  const z = settings.zones || {};
  const ZONE_KEYS2   = ['champion','qualify','cond','normal','playoff','relegate'];
  const ZONE_COLORS2 = ['var(--gold)','var(--green)','var(--blue)','#666','var(--orange)','var(--red)'];
  const ZONE_NAMES2  = ['المتوج 🏆','متأهل ✅︎','مشروط 🔵','عادي ⚪','ملعب الهبوط 🟠','هابط 🔴'];
  let zoneIdx = 0, rowIdx = 0;
  const zoneColors = {};
  ZONE_KEYS2.forEach((k, ki) => {
    const count = z[k] || 0;
    for (let i = 0; i < count; i++) {
      zoneColors[rowIdx++] = ZONE_COLORS2[ki];
    }
  });

  const tableHtml = `
    <div class="std-wrap">
      <div class="std-head">
        <span class="std-h-pos">#</span>
        <span class="std-h-team">الفريق</span>
        <span class="std-h-num">ل</span>
        <span class="std-h-num std-hide-sm">ف</span>
        <span class="std-h-num std-hide-sm">ت</span>
        <span class="std-h-num std-hide-sm">خ</span>
        <span class="std-h-num">+/-</span>
        <span class="std-h-pts">نقاط</span>
      </div>
      <div class="std-body">
        ${sorted.map((t, i) => {
          const s = statsMap[t.id] || {};
          const gd = (s.gf||0)-(s.ga||0);
          const zc = zoneColors[i] || '';
          const rank = i+1;
          return `<div class="std-row ${i===0?'std-first':''}" onclick="openTeamProfile('${t.id}')">
            <span class="std-pos">
              <span class="std-zone-bar" style="background:${zc||'transparent'}"></span>
              <span class="std-pos-num" style="${zc?`color:${zc}`:''}">${rank}</span>
            </span>
            <span class="std-team">
              <span class="std-logo">${logoHtml(t.logo,26,6)}</span>
              <span class="std-name">${t.name}</span>
            </span>
            <span class="std-num">${s.p||0}</span>
            <span class="std-num std-hide-sm" style="color:var(--green)">${s.w||0}</span>
            <span class="std-num std-hide-sm">${s.d||0}</span>
            <span class="std-num std-hide-sm" style="color:var(--red)">${s.l||0}</span>
            <span class="std-num" style="color:${gd>0?'var(--green)':gd<0?'var(--red)':'var(--t3)'}">${gd>0?'+'+gd:gd}</span>
            <span class="std-pts">${s.pts||0}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  ['fullStandings','homeStandings'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!sorted.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">لا توجد فرق</div>'; return; }
    el.innerHTML = tableHtml;
  });

  // legend
  const legEl = document.getElementById('zoneLegend');
  if (legEl) {
    const keys = ZONE_KEYS2.filter(k => (z[k]||0) > 0);
    legEl.innerHTML = keys.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px">` +
      keys.map((k, i) => `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--t3)"><div style="width:10px;height:10px;border-radius:2px;background:${ZONE_COLORS2[ZONE_KEYS2.indexOf(k)]}"></div>${ZONE_NAMES2[ZONE_KEYS2.indexOf(k)]}</div>`).join('') +
      `</div>` : '';
  }
}
// ✅︎ تصدير — يسمح لـall-fixes.js باستبدالها فعلياً
window.renderStandings = renderStandings;

// ── renderMatches ─────────────────────────────────────────
function renderMatches(filter) {
  /* ✅︎ التبويبات: matches-tabs.js يسجّل نفسه هنا. لا نستطيع استبدال
     window.renderMatches من الخارج لأن كل الاستدعاءات الداخلية محلية
     (نفس فخ OVERRIDES.md)، فنُفوّض من داخل الدالة نفسها. */
  if (typeof window._mtRender === 'function') return window._mtRender();
  filter = filter || matchFilter || 'all';
  const el = document.getElementById('matchesList');
  if (!el) return;

  let list = [...matches];

  // فلتر الحالة
  if (filter === 'live')     list = list.filter(m => m.status === 'live');
  if (filter === 'upcoming') list = list.filter(m => m.status === 'upcoming' || (m.status === 'pending' && m.homeId && m.awayId));
  if (filter === 'finished') list = list.filter(m => m.status === 'finished');

  // فلتر البحث
  if (searchQuery) {
    list = list.filter(m => {
      const ht = teams.find(t => t.id === m.homeId);
      const at = teams.find(t => t.id === m.awayId);
      const hName = (ht?.name || m.homeName || '').toLowerCase();
      const aName = (at?.name || m.awayName || '').toLowerCase();
      return hName.includes(searchQuery) || aName.includes(searchQuery) ||
             String(m.round || '').includes(searchQuery);
    });
  }

  if (!list.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
      <div style="font-size:40px;margin-bottom:10px;opacity:.3">⚽</div>
      <div style="font-size:13px">لا توجد مباريات</div>
    </div>`;
    return;
  }

  // تجميع حسب الجولة
  const rounds = {};
  list.forEach(m => {
    const r = m.round || 0;
    if (!rounds[r]) rounds[r] = [];
    rounds[r].push(m);
  });

  let html = '';
  Object.keys(rounds).sort((a,b) => Number(a)-Number(b)).forEach(r => {
    html += `<div style="font-size:11px;font-weight:700;color:var(--t3);padding:10px 14px 6px;background:var(--bg)">${r>0 ? 'الجولة ' + r : 'مباريات'}</div>`;
    html += rounds[r].map(m => _matchCard(m)).join('');
  });

  el.innerHTML = html;

  // شغّل عدادات المباريات المباشرة
  list.filter(m => m.status === 'live').forEach(m => _startCard2Clock(m));
}

// ── renderHomeUpcomingMatches / renderHomeRecentResults ───
// (تستخدمهم renderHomeKnockout في بعض الحالات)
function renderHomeUpcomingMatches() {
  // مُدمَج في renderHomeSection - لا حاجة لتنفيذ مستقل
}
function renderHomeRecentResults() {
  // مُدمَج في renderHomeSection - لا حاجة لتنفيذ مستقل
}


// ⚡ ولّد المانيفست فوراً من id في الرابط (قبل Firebase) — تثبيت فوري آمن
if (LEAGUE_ID) { try { _installDynamicManifest(null); } catch(e){} }

// مؤشّر نسخة مرئي (للتأكد من وصول التحديث) — يختفي تلقائياً بعد 6 ثوانٍ
(function(){
  try{
    var b=document.createElement('div');
    b.textContent='build v75';
    b.style.cssText='position:fixed;bottom:6px;left:6px;z-index:99999;'
      +'background:rgba(0,0,0,.6);color:#C9A02B;font:700 9px Tajawal,sans-serif;'
      +'padding:2px 7px;border-radius:6px;pointer-events:none;opacity:.7';
    (document.body||document.documentElement).appendChild(b);
    setTimeout(function(){ b.style.transition='opacity .6s'; b.style.opacity='0';
      setTimeout(function(){ b.remove(); },700); }, 6000);
  }catch(e){}
})();

init();

// ════════════════════════════════════════
//  PUSH NOTIFICATIONS — FCM Web
// ════════════════════════════════════════

/* ✅︎ يُنشأ عند الحاجة فقط (زر الإشعارات) — لا وقت التحميل */
let messaging = null;
async function _msg() {
  if (!messaging) {
    const m = await _loadMessaging();
    messaging = m.getMessaging(app);
    // اربط مستقبل الرسائل أول مرة فقط
    m.onMessage(messaging, _onPush);
  }
  return messaging;
}

// VAPID key — يجب إضافتها من Firebase Console > Project Settings > Cloud Messaging
// 🔑 VAPID KEY — ضع مفتاحك هنا من:
// Firebase Console → Project Settings → Cloud Messaging → Web configuration → Key pair
const VAPID_KEY = window.VAPID_KEY || '';

let _notifGranted = false;

// تحقق من حالة الإشعارات عند التحميل
(function checkNotifState() {
  if(!('Notification' in window)) return;
  const bell = document.getElementById('notifBell');
  if(Notification.permission === 'granted') {
    _notifGranted = true;
    if(bell) { bell.textContent = '🔔'; bell.style.color = 'var(--gold)'; bell.style.borderColor = 'var(--gold)'; }
    subscribeFCM();
  } else if(Notification.permission === 'denied') {
    if(bell) { bell.textContent = '🔕'; bell.style.color = 'var(--muted)'; }
  }
})();

window.toggleNotifications = function() {
  if(Notification.permission === 'granted') {
    showToast('الإشعارات مفعّلة بالفعل 🔔', 'success');
    return;
  }
  const modal = document.getElementById('notifModal');
  if(modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
};

window.closeNotifModal = function() {
  const modal = document.getElementById('notifModal');
  if(modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
};

window.requestNotifPermission = async function() {
  const btn = document.getElementById('notifEnableBtn');
  if(btn) { btn.textContent = '⏳ جاري التفعيل...'; btn.disabled = true; }
  try {
    const permission = await Notification.requestPermission();
    if(permission === 'granted') {
      _notifGranted = true;
      await subscribeFCM();
      const bell = document.getElementById('notifBell');
      if(bell) { bell.textContent = '🔔'; bell.style.color = 'var(--gold)'; bell.style.borderColor = 'var(--gold)'; }
      window.closeNotifModal();
      showToast('✅︎ تم تفعيل الإشعارات! ستصلك تنبيهات المباريات', 'success');
    } else {
      showToast('❌︎ لم يتم السماح بالإشعارات', 'error');
      if(btn) { btn.textContent = '🔔 تفعيل الإشعارات'; btn.disabled = false; }
    }
  } catch(e) {
    console.warn('[PUSH] Error:', e);
    showToast('تعذّر تفعيل الإشعارات', 'error');
    if(btn) { btn.textContent = '🔔 تفعيل الإشعارات'; btn.disabled = false; }
  }
};

async function subscribeFCM() {
  // بدون VAPID key لا يمكن الاشتراك
  if(!VAPID_KEY) {
    console.warn('[PUSH] VAPID_KEY غير موجود — لن تعمل الإشعارات');
    console.warn('[PUSH] أضف VAPID_KEY من Firebase Console → Project Settings → Cloud Messaging → Web configuration → Key pair');
    showToast('⚠️ الإشعارات تحتاج إعداداً إضافياً من لوحة Firebase', 'error');
    return;
  }
  try {
    if(!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const _m = await _loadMessaging();
    await _msg();
    const token = await _m.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if(token && LEAGUE_ID) {
      // حفظ التوكن في Firebase مرتبطاً بالبطولة
      // حفظ التوكن في Firestore
      const { setDoc: _setDoc2, serverTimestamp: _sts } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      await _setDoc2(doc(db, 'leagues', LEAGUE_ID, 'notifTokens', token), {
        token, platform: navigator.userAgent.includes('Mobile') ? 'mobile' : 'web',
        createdAt: _sts(), leagueId: LEAGUE_ID
      });
      // console.log('[PUSH] Token saved ✅︎');
    }
  } catch(e) {
    console.warn('[PUSH] FCM subscribe error:', e);
  }
}

// استقبال الإشعارات وهو في الصفحة
function _onPush(payload) {
  const { title, body } = payload.notification || {};
  if(!title) return;
  // Toast مرئي داخل التطبيق
  showGoalToast(title + (body ? ' — ' + body : ''));
  haptic('goal');
  // إشعار محلي إذا الصفحة في الخلفية
  if(document.hidden && _notifGranted) {
    new Notification(title, { body, icon: './icon-192.png', badge: './icon-192.png', dir: 'rtl', lang: 'ar' });
  }
}

// ── إحصائيات موحّدة للمباراة (تُستخدم في تفاصيل المباراة) ──
function _buildUnifiedStatsHtml(d, ht, at) {
  // تحقق من statsEnabled — إذا كان false بشكل صريح، لا تعرض
  if (d && d.statsEnabled === false) return '';

  // اقرأ الإحصائيات من liveData.stats أو مباشرة من d
  const stats = (d && d.stats) || {};

  // دالة تجلب قيمة من تنسيقين
  const gv = (liveKey, finKey) => {
    if (stats[liveKey] != null) return stats[liveKey];
    if (stats[finKey]  != null) return stats[finKey];
    return null;
  };

  const SFIELDS = [
    { lh:'home_possession', la:'away_possession', fh:'possessionHome', fa:'possessionAway', label:'⚽ الاستحواذ', pct:true  },
    { lh:'home_shots',      la:'away_shots',      fh:'shotsHome',      fa:'shotsAway',      label:'🎯 التسديدات', pct:false },
    { lh:'home_shotsOnT',   la:'away_shotsOnT',   fh:'shotsOnTargetHome', fa:'shotsOnTargetAway', label:'🥅 على المرمى', pct:false },
    { lh:'home_corners',    la:'away_corners',    fh:'cornersHome',    fa:'cornersAway',    label:'⛳ الركنيات',  pct:false },
    { lh:'home_fouls',      la:'away_fouls',      fh:'foulsHome',      fa:'foulsAway',      label:'⚠️ الأخطاء',  pct:false },
    { lh:'home_yellowCards',la:'away_yellowCards',fh:'yellowCardsHome',fa:'yellowCardsAway',label:'🟨 الصفراء',  pct:false },
    { lh:'home_redCards',   la:'away_redCards',   fh:'redCardsHome',   fa:'redCardsAway',   label:'🟥 الحمراء',  pct:false },
    { lh:'home_offsides',   la:'away_offsides',   fh:'offsidesHome',   fa:'offsidesAway',   label:'🚩 التسلل',   pct:false },
    { lh:'home_tackles',    la:'away_tackles',    fh:'tacklesHome',    fa:'tacklesAway',    label:'🦵 التدخلات', pct:false },
  ];

  const rows = SFIELDS.map(f => {
    const hv = gv(f.lh, f.fh);
    const av = gv(f.la, f.fa);
    if (hv === null && av === null) return '';
    const h = hv ?? 0, a = av ?? 0;
    const tot = h + a || 1;
    const hPct = f.pct ? h : Math.round(h / tot * 100);
    const aPct = f.pct ? a : Math.round(a / tot * 100);
    return `<div style="display:grid;grid-template-columns:1fr 100px 1fr;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <div style="text-align:right;font-size:15px;font-weight:900;color:var(--gold,#C9A02B);font-family:Tajawal,sans-serif">${f.pct ? h+'%' : h}</div>
      <div style="text-align:center">
        <div style="font-size:9px;color:var(--t3,#666);margin-bottom:3px">${f.label}</div>
        <div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;position:relative">
          <div style="position:absolute;right:0;top:0;height:100%;width:${hPct}%;background:var(--gold,#C9A02B);border-radius:3px"></div>
          <div style="position:absolute;left:0;top:0;height:100%;width:${aPct}%;background:rgba(90,160,220,.5);border-radius:3px"></div>
        </div>
      </div>
      <div style="text-align:left;font-size:15px;font-weight:900;color:var(--t2,#aaa);font-family:Tajawal,sans-serif">${f.pct ? a+'%' : a}</div>
    </div>`;
  }).filter(Boolean).join('');

  if (!rows) return '';

  return `<div class="md-section">
    <div class="md-section-title">📊 الإحصائيات</div>
    <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:var(--t3,#666);margin-bottom:6px;padding:0 2px">
      <span>${ht ? ht.name : ''}</span><span>${at ? at.name : ''}</span>
    </div>
    ${rows}
  </div>`;
}



// ═══════════════════════════════════════════════════════════════
//  ✅︎ النظام الموحّد النهائي — بطاقات مباريات بتصميم SofaScore
//  - لا بنرات علوية
//  - لا أقسام مستقلة "مباشر الآن"
//  - نفس البطاقة تتحوّل live تلقائياً في مكانها
//  - تفاصيل المباراة بدون تكرار
// ═══════════════════════════════════════════════════════════════

// ── لوغو موحّد ──────────────────────────────────────────────────
function _logo(logo, size) {
  size = size || 40;
  if (!logo) return `<span style="font-size:${Math.round(size*.7)}px">⚽</span>`;
  if (logo.startsWith('data:') || logo.startsWith('http') || logo.startsWith('/'))
    return `<img src="${logo}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*.22)}px;object-fit:cover;display:block" onerror="this.style.display='none'" loading="lazy"/>`;
  return `<span style="font-size:${Math.round(size*.7)}px;line-height:1">${logo}</span>`;
}

// ── حساب ثواني المباراة ─────────────────────────────────────────
function _secs(d) {
  return window.TimerCore ? window.TimerCore.phaseSecs(d) : 0;
}

// ── تنسيق الوقت الموحّد ─────────────────────────────────────────
function _clock(d) {
  if (!d) return '--';
  const ph = d.matchStatus;
  if (ph === 'halftime' || ph === 'halftime_et') {
    if (d.halftimeStartedAt) {
      const brk  = (d.breakDuration || 15) * 60;
      const htMs = _tsMs(d.halftimeStartedAt);
      const rem  = htMs ? Math.max(0, brk - Math.floor((Date.now() - htMs) / 1000)) : 0;
      return _p(Math.floor(rem / 60)) + ':' + _p(rem % 60);
    }
    return 'استراحة';
  }
  if (ph === 'penalties') return 'ركلات';
  if (ph === 'ended')     return 'انتهت';
  if (!ph || ph === 'upcoming') return '--';

  // ✅︎ المصدر الوحيد للحقيقة — نفس حساب لوحة التحكم بالضبط
  const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
  if (!c) return '--';
  // FIX 7: عند 45:00 بالضبط لا شارة بدل ضائع حتى تمرّ ثانية أو يُعلنها المنظّم
  if (!c.inStoppage || !c.showStoppage) return c.clock;
  // بدل الضائع — ثلاثة أسطر مرتبة:
  //   +5      ← الدقائق المضافة المُعلنة (فوق)
  //   45:00   ← الوقت الرسمي متجمّد (الوسط)
  //   +2:14   ← عدّاد بدل الضائع الجاري (تحت)
  // ✅︎ التنسيق: +5 و +2:14 جنب بعض في صف واحد فوق · 45:00 تحت
  const badge = (c.phase.extraSet && c.phase.extra > 0)
    ? `<span class="mc-add-min">+${c.phase.extra}</span>` : '';
  return `<span class="mc-stop-row">${badge}<span class="mc-extra-t">${c.stoppageClock}</span></span>`
       + `<span class="mc-clk-head">${c.clock}</span>`;
}

function _periodLabel(d) {
  if (!d) return '';
  return { live: d.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول', halftime: 'بين الشوطين',
    extratime1: 'إضافي١', halftime_et: 'بين الشوطين', extratime2: 'إضافي٢',
    penalties: 'ركلات', ended: 'انتهت' }[d.matchStatus] || '';
}


// ── أيقونة الحدث: تعتمد على النوع (وليس الإيموجي المخزَّن) ──
// تدعم الأحداث القديمة عبر التعرّف على الإيموجي المحفوظ.
function _evIcon(ev, size) {
  size = size || 17;
  var t = (ev && ev.type) || '';
  var ic = (ev && ev.icon) || '';
  // بطاقات: نُبقيها ملوّنة (مربّع أصفر/أحمر) لأنها لغة كرة القدم المعروفة
  if (t === 'yellow' || ic === '🟨') return '<span class="ev-card ev-y"></span>';
  if (t === 'red'    || ic === '🟥') return '<span class="ev-card ev-r"></span>';
  var map = {
    goal:'ball', penalty:'goal', own_goal:'ball', assist:'handshake',
    sub:'refresh', injury:'injury', var:'eye', miss:'close', save:'shield'
  };
  var byEmoji = {
    '⚽':'ball','🥅':'goal','🔄':'refresh','🤕':'injury','🎯':'target',
    '🏅':'medal','🏆':'trophy','⚡':'bolt','✅︎':'check','❌︎':'close'
  };
  var name = map[t] || byEmoji[ic] || 'ball';
  return (window.Icon ? window.Icon(name, size) : (ic || ''));
}

function _p(n) { return String(n).padStart(2, '0'); }
const _LIVE = ['live','halftime','extratime1','halftime_et','extratime2','penalties'];

// ══════════════════════════════════════════════════════════════
//  رجل المباراة (Man of the Match) — مُحلّل موحّد
//  الأولوية:
//   1) اختيار يدوي صريح (m.manOfMatch) — من أي مسار إدخال في الإدارة
//      (نافذة التفاصيل / الإدخال السريع / نظام البطاقات / شاشة نهاية البث)
//   2) استنتاج تلقائي من الأحداث (للأحداث القديمة بلا اختيار):
//      الأعلى نقاطاً = أهداف×3 + صناعات×2، مع استبعاد من طُرد (بطاقة حمراء)،
//      وترجيح الفريق الفائز عند التعادل في النقاط.
//  يُرجع { name, teamId, auto } أو null.
// ══════════════════════════════════════════════════════════════
function _resolveMOTM(m) {
  if (!m) return null;
  // ── 1) اختيار يدوي (نص الاسم كما أُدخل) ──
  const manual = (m.manOfMatch || (m.liveData && m.liveData.manOfMatch) || '').toString().trim();
  if (manual) {
    // حاول ربطه بفريقه لعرض الشعار/فتح صفحته (بحث في كشوف/تشكيلات الفريقين)
    let teamId = null, pid = null;
    const _tryTeam = (tid, lineup) => {
      if (teamId) return;
      const roster = (window._teamRosters && window._teamRosters[tid]) || [];
      const pool = [...(roster||[]), ...(((lineup||{}).players)||[])];
      const hit = pool.find(p => p && _normName(p.name) === _normName(manual));
      if (hit) { teamId = tid; pid = hit.id || null; }
    };
    _tryTeam(m.homeId, m.homeLineup);
    _tryTeam(m.awayId, m.awayLineup);
    return { name: manual, teamId, playerId: pid, auto: false };
  }
  // ── 2) استنتاج تلقائي من الأحداث ──
  const evs = (typeof _matchEvents === 'function') ? _matchEvents(m) : (m.events || []);
  if (!Array.isArray(evs) || !evs.length) return null;
  const score = {};                                   // key → {name, teamId, pid, goals, assists, red}
  const _sideTeam = (ev) => (ev.teamId) || ((ev.side || ev.team) === 'away' ? m.awayId : m.homeId);
  const _key = (name, tid) => (tid || '') + '::' + _normName(name);
  evs.forEach(ev => {
    if (!ev) return;
    const tid = _sideTeam(ev);
    const nm = (ev.player || '').toString().trim();
    if (nm && (ev.type === 'goal')) {
      const k = _key(nm, tid); (score[k] = score[k] || { name: nm, teamId: tid, pid: ev.playerId || null, goals: 0, assists: 0, red: 0 }).goals++;
    }
    if (ev.assist) {
      const an = ev.assist.toString().trim(); const k = _key(an, tid);
      (score[k] = score[k] || { name: an, teamId: tid, pid: ev.assistPlayerId || null, goals: 0, assists: 0, red: 0 }).assists++;
    }
    if (nm && ev.type === 'red') {
      const k = _key(nm, tid); (score[k] = score[k] || { name: nm, teamId: tid, pid: ev.playerId || null, goals: 0, assists: 0, red: 0 }).red++;
    }
  });
  const cands = Object.values(score).filter(c => c.red === 0 && (c.goals > 0 || c.assists > 0));
  if (!cands.length) return null;
  const winnerTeam = (m.homeScore > m.awayScore) ? m.homeId : (m.awayScore > m.homeScore) ? m.awayId : null;
  cands.sort((a, b) => {
    const pa = a.goals * 3 + a.assists * 2, pb = b.goals * 3 + b.assists * 2;
    if (pb !== pa) return pb - pa;
    if (b.goals !== a.goals) return b.goals - a.goals;          // الأكثر أهدافاً
    const wa = a.teamId === winnerTeam ? 1 : 0, wb = b.teamId === winnerTeam ? 1 : 0;
    return wb - wa;                                              // من الفريق الفائز
  });
  const top = cands[0];
  return { name: top.name, teamId: top.teamId, playerId: top.pid, auto: true, goals: top.goals, assists: top.assists };
}
window._resolveMOTM = _resolveMOTM;

// ══════════════════════════════════════════════════════════════
//  📖 قصة المباراة — سرد تلقائي ذكي من الأحداث
//  يولّد فقرة عربية طبيعية تحكي مجريات المباراة: من افتتح، متى
//  عادل الخصم، من حسم، أبرز اللحظات. يعتمد كلياً على أحداث المباراة.
//  يُرجع نصّاً أو '' إن لم تكفِ الأحداث.
// ══════════════════════════════════════════════════════════════
function _buildMatchStory(m, ht, at) {
  if (!m) return '';
  const evs = ((typeof _matchEvents === 'function') ? _matchEvents(m) : (m.events || [])).slice()
    .filter(e => e && (e.type === 'goal' || e.type === 'own'))
    .sort((a, b) => (a.minute || 0) - (b.minute || 0) || (a.extraMinute || 0) - (b.extraMinute || 0));
  const hs = m.homeScore, as = m.awayScore;
  if (hs == null || as == null) return '';
  const hName = (ht && ht.name) || 'المضيف';
  const aName = (at && at.name) || m.awayName || 'الضيف';

  // اسم اللاعب الحيّ للحدث
  const _pn = (ev) => {
    const tid = ev.teamId || ((ev.side || ev.team) === 'away' ? m.awayId : m.homeId);
    const raw = (ev.player || '').toString().trim();
    if (typeof _pName === 'function' && ev.playerId && tid) return _pName(tid, ev.playerId, raw);
    return raw;
  };
  const _teamOf = (ev) => ((ev.teamId === m.awayId) || (ev.side || ev.team) === 'away') ? aName : hName;
  const _min = (ev) => ev.extraMinute > 0 ? `${ev.minute}+${ev.extraMinute}` : ev.minute;

  const parts = [];

  // ── المقدّمة: نبرة حسب فارق النتيجة ──
  const diff = Math.abs(hs - as);
  const winner = hs > as ? hName : as > hs ? aName : null;
  if (!evs.length) {
    // تعادل سلبي أو لا أهداف مسجّلة
    if (hs === 0 && as === 0) return `انتهت المباراة بين ${hName} و${aName} بالتعادل السلبي دون أهداف، في لقاء ${_storyAdj('دفاعي')}.`;
    return '';
  }

  // أول هدف
  const first = evs[0];
  const firstScorer = first.type === 'own' ? null : _pn(first);
  const firstTeam = _teamOf(first);
  if (first.type === 'own') {
    parts.push(`افتتح ${firstTeam} التسجيل عبر هدف عكسي في الدقيقة ${_min(first)}`);
  } else {
    parts.push(`افتتح ${firstTeam} التسجيل عن طريق ${firstScorer} في الدقيقة ${_min(first)}`);
    if (first.assist) parts[parts.length-1] += ` بعد تمريرة من ${first.assist}`;
  }

  // ── تتبّع تحوّلات الأفضلية (تعادل/تقدّم) ──
  let rh = 0, ra = 0;
  const narr = [];
  const _lam = (team) => team.startsWith('ال') ? 'لل' + team.slice(2) : 'لـ' + team;  // لـالنصر → للنصر
  let leadCount = 0;
  evs.forEach((ev, i) => {
    const isHome = (ev.teamId === m.homeId) || (ev.side || ev.team) === 'home';
    const forHome = ev.type === 'own' ? !isHome : isHome;
    if (forHome) rh++; else ra++;
    if (i === 0) return;                                   // الهدف الأول ذُكر في المقدّمة
    const scorer = ev.type === 'own' ? null : _pn(ev);
    const team = forHome ? hName : aName;
    if (rh === ra) {
      narr.push(`أدرك ${team} التعادل${scorer ? ` عبر ${scorer}` : ' بهدف عكسي'} (${rh}-${ra}) في الدقيقة ${_min(ev)}`);
    } else {
      leadCount++;
      const lead = rh > ra ? hName : aName;
      const gainsLead = lead === team;
      // تنويع الصياغة حتى لا تتكرر
      let phrase;
      if (ev.type === 'own') phrase = `عزّز ${team} تقدّمه بهدف عكسي في الدقيقة ${_min(ev)}`;
      else if (gainsLead && leadCount === 1) phrase = `أضاف ${scorer} الهدف الثاني ${_lam(team)} في الدقيقة ${_min(ev)}`;
      else if (gainsLead) phrase = `وسّع ${scorer} الفارق ${_lam(team)} في الدقيقة ${_min(ev)}`;
      else phrase = `قلّص ${scorer} الفارق ${_lam(team)} في الدقيقة ${_min(ev)}`;
      narr.push(phrase);
    }
  });
  if (narr.length) parts.push(narr.slice(0, 4).join('، ثم '));

  // ── الخاتمة: النتيجة والحسم ──
  let ending;
  if (winner) {
    const last = evs[evs.length - 1];
    const lastLate = (last.minute || 0) >= 80;
    if (diff >= 3) ending = `ليحسم ${winner} اللقاء بنتيجة عريضة ${Math.max(hs,as)}-${Math.min(hs,as)}`;
    else if (lastLate && diff === 1) ending = `لينتزع ${winner} فوزاً ثميناً في اللحظات الأخيرة بنتيجة ${Math.max(hs,as)}-${Math.min(hs,as)}`;
    else ending = `لينتهي اللقاء بفوز ${winner} ${Math.max(hs,as)}-${Math.min(hs,as)}`;
  } else {
    ending = `لينتهي اللقاء بالتعادل ${hs}-${as} في مباراة ${_storyAdj('مثيرة')}`;
  }
  parts.push(ending);

  // ── رجل المباراة (إن وُجد) ──
  const motm = (typeof _resolveMOTM === 'function') ? _resolveMOTM(m) : null;
  let tail = '';
  if (motm && motm.name) tail = ` وكان ${motm.name} نجم اللقاء بلا منازع.`;

  // دمج نظيف
  let story = parts.join('، ').replace(/،\s*،/g, '،').replace(/\s+/g, ' ').trim();
  story = story.charAt(0) + story.slice(1) + '.';
  return story + tail;
}
function _storyAdj(base) { return base; }
window._buildMatchStory = _buildMatchStory;

// ══════════════════════════════════════════════════════════════
//  🏅 ألقاب اللاعبين — تُمنح تلقائياً حسب الأداء عبر البطولة
//  تقارن اللاعب ببقية اللاعبين وتمنحه لقباً مميّزاً (القنّاص، صانع
//  الألعاب، النجم الشامل، الجدار...). تُرجع { label, icon, color } أو null.
//  player: { name, playerId, teamId, goals }
// ══════════════════════════════════════════════════════════════
function _playerTitle(player) {
  if (!player) return null;
  const GOLD = '#e6c157';
  try {
    const scorers = (typeof buildScorersData === 'function') ? buildScorersData() : [];
    // مطابقة اللاعب في قائمة الهدّافين (بالهوية ثم الاسم)
    const _match = (s) => player.playerId && s.playerId ? s.playerId === player.playerId
      : (typeof _normName === 'function' ? _normName(s.name) === _normName(player.name) : s.name === player.name);
    const rank = scorers.findIndex(_match);           // ترتيبه في الهدّافين (0 = الأول)
    const myGoals = player.goals || 0;

    // ترتيب الصنّاع (إن توفّر StatsCore)
    let assistRank = -1, myAssists = 0;
    if (window.StatsCore && typeof window.StatsCore.buildAssists === 'function') {
      try {
        const assists = window.StatsCore.buildAssists({
          matches: matches || [], teams: teams || [],
          rosters: (typeof _collectScorerRosters === 'function') ? _collectScorerRosters() : {}
        }) || [];
        assistRank = assists.findIndex(_match);
        if (assistRank >= 0) myAssists = assists[assistRank].count || assists[assistRank].assists || 0;
      } catch (e) {}
    }

    // ── منح اللقب بالأولوية ──
    // النجم الشامل: من أفضل 3 هدّافين وأفضل 3 صنّاع معاً
    if (rank >= 0 && rank < 3 && assistRank >= 0 && assistRank < 3 && myGoals >= 2 && myAssists >= 2)
      return { label: 'النجم الشامل', icon: '⭐', color: GOLD };
    // القنّاص: هدّاف البطولة الأول (بشرط أهداف فعلية)
    if (rank === 0 && myGoals >= 2)
      return { label: 'القنّاص', icon: '🎯', color: GOLD };
    // صانع الألعاب: صانع البطولة الأول
    if (assistRank === 0 && myAssists >= 2)
      return { label: 'صانع الألعاب', icon: '🎩', color: '#3b82f6' };
    // الهدّاف: ضمن أفضل 3
    if (rank >= 0 && rank < 3 && myGoals >= 2)
      return { label: 'من أبرز الهدّافين', icon: '⚽', color: GOLD };
    // الصانع: ضمن أفضل 3 صنّاع
    if (assistRank >= 0 && assistRank < 3 && myAssists >= 2)
      return { label: 'من أبرز الصنّاع', icon: '👟', color: '#27ae60' };
    // هدّاف نشط عموماً
    if (myGoals >= 3)
      return { label: 'هدّاف مميّز', icon: '⚽', color: GOLD };
  } catch (e) {}
  return null;
}
window._playerTitle = _playerTitle;

// ══════════════════════════════════════════════════════════════
//  🧠 الإحصائيات المخفية الذكية — تكتشف حقائق تلقائياً من البيانات
//  مثل: أطول سلسلة لا هزيمة، أكبر فوز، أكثر مباراة أهدافاً، هدّاف
//  في مباريات متتالية. تُرجع مصفوفة { icon, text, color } جاهزة للعرض.
// ══════════════════════════════════════════════════════════════
function _computeInsights() {
  const out = [];
  const GOLD = 'var(--gold)';
  const fin = (matches || []).filter(m => m.status === 'finished' && m.homeScore != null && m.awayScore != null);
  if (!fin.length) return out;

  const _sortT = arr => arr.slice().sort((a, b) => {
    const _t = m => (m.date ? new Date(m.date + 'T' + (m.time || '00:00')).getTime() : 0) || (m.round || 0);
    return _t(a) - _t(b);
  });

  // ── 1) أطول سلسلة لا هزيمة حالية (لأي فريق) ──
  let bestUnbeaten = { team: null, n: 0 };
  (teams || []).forEach(t => {
    const mine = _sortT(fin.filter(m => m.homeId === t.id || m.awayId === t.id));
    let streak = 0;
    for (let i = mine.length - 1; i >= 0; i--) {
      const m = mine[i], isH = m.homeId === t.id;
      const my = isH ? m.homeScore : m.awayScore, op = isH ? m.awayScore : m.homeScore;
      if (my >= op) streak++; else break;
    }
    if (streak > bestUnbeaten.n) bestUnbeaten = { team: t, n: streak };
  });
  if (bestUnbeaten.n >= 3)
    out.push({ icon: '🛡️', color: 'var(--green,#27ae60)', text: `${bestUnbeaten.team.name} لم يخسر منذ ${bestUnbeaten.n} مباريات` });

  // ── 2) أطول سلسلة انتصارات حالية ──
  let bestWins = { team: null, n: 0 };
  (teams || []).forEach(t => {
    const mine = _sortT(fin.filter(m => m.homeId === t.id || m.awayId === t.id));
    let streak = 0;
    for (let i = mine.length - 1; i >= 0; i--) {
      const m = mine[i], isH = m.homeId === t.id;
      const my = isH ? m.homeScore : m.awayScore, op = isH ? m.awayScore : m.homeScore;
      if (my > op) streak++; else break;
    }
    if (streak > bestWins.n) bestWins = { team: t, n: streak };
  });
  if (bestWins.n >= 3)
    out.push({ icon: '🔥', color: GOLD, text: `${bestWins.team.name} حقّق ${bestWins.n} انتصارات متتالية` });

  // ── 3) أكبر فوز في البطولة ──
  let biggest = { diff: 0, m: null };
  fin.forEach(m => {
    const d = Math.abs(m.homeScore - m.awayScore);
    if (d > biggest.diff) biggest = { diff: d, m };
  });
  if (biggest.m && biggest.diff >= 3) {
    const m = biggest.m;
    const winId = m.homeScore > m.awayScore ? m.homeId : m.awayId;
    const wt = (teams || []).find(t => t.id === winId);
    out.push({ icon: '💥', color: 'var(--red,#C0392B)', text: `أكبر فوز: ${wt ? wt.name : ''} ${Math.max(m.homeScore, m.awayScore)}-${Math.min(m.homeScore, m.awayScore)}` });
  }

  // ── 4) أكثر مباراة أهدافاً ──
  let mostGoals = { total: 0, m: null };
  fin.forEach(m => {
    const tot = (m.homeScore || 0) + (m.awayScore || 0);
    if (tot > mostGoals.total) mostGoals = { total: tot, m };
  });
  if (mostGoals.m && mostGoals.total >= 4) {
    const m = mostGoals.m;
    const ht = (teams || []).find(t => t.id === m.homeId), at = (teams || []).find(t => t.id === m.awayId);
    out.push({ icon: '⚽', color: GOLD, text: `أكثر مباراة إثارة: ${ht ? ht.name : ''} ${m.homeScore}-${m.awayScore} ${at ? at.name : ''} (${mostGoals.total} أهداف)` });
  }

  // ── 5) هدّاف في مباريات متتالية ──
  try {
    const scorers = (typeof buildScorersData === 'function') ? buildScorersData() : [];
    if (scorers.length) {
      const top = scorers[0];
      // احسب سلسلة التسجيل للهدّاف الأول
      const tid = top.teamId;
      const mine = _sortT(fin.filter(m => m.homeId === tid || m.awayId === tid));
      let streak = 0;
      for (let i = mine.length - 1; i >= 0; i--) {
        const evs = _matchEvents(mine[i]);
        const scored = evs.some(e => e && e.type === 'goal' &&
          (top.playerId && e.playerId ? e.playerId === top.playerId : _normName(e.player || '') === _normName(top.name)));
        if (scored) streak++; else break;
      }
      if (streak >= 3)
        out.push({ icon: '🎯', color: GOLD, text: `${top.name} سجّل في ${streak} مباريات متتالية` });
    }
  } catch (e) {}

  return out;
}
window._computeInsights = _computeInsights;




// ══════════════════════════════════════════════════════════════
//  شارات اللاعب على التشكيلة (هدف/بطاقة) — مثل التطبيقات الكبيرة
//  تحسب من أحداث المباراة عدد الأهداف ونوع البطاقات لكل لاعب،
//  وترجع HTML صغيراً يُركَّب فوق دائرة اللاعب في الملعب.
// ══════════════════════════════════════════════════════════════
function _playerMatchBadges(events, side, playerName, number) {
  if (!Array.isArray(events) || !playerName) return '';
  const nm = String(playerName).trim();
  const nmNorm = (typeof _normName === 'function') ? _normName(nm) : nm.toLowerCase();
  const sideOf = e => e.side || e.team;
  const nameOf = e => String(e.player || '').trim();
  const normEq = (a) => {
    const an = (typeof _normName === 'function') ? _normName(a) : String(a||'').toLowerCase();
    return an === nmNorm || (an.length>=3 && nmNorm.length>=3 && (an.indexOf(nmNorm)===0 || nmNorm.indexOf(an)===0));
  };

  let goals = 0, yellow = 0, red = false, subOut = null, subIn = null;
  const hasNum = number != null && number !== '';
  // مطابقة اللاعب: بالرقم إن توفّر في الحدث (أدقّ)، وإلا بالاسم المُطبّع
  const matchesPlayer = (e, nameField, numField) => {
    if (hasNum && e[numField] != null && e[numField] !== '') {
      return String(e[numField]) === String(number);
    }
    return normEq(e[nameField]);
  };
  events.forEach(e => {
    if (sideOf(e) !== side) return;
    if (e.type === 'sub') {
      const mn = e.extraMinute > 0 ? (e.minute + '+' + e.extraMinute) : e.minute;
      if (matchesPlayer(e, 'playerOut', 'playerOutNumber') || normEq(e.playerOut || e.player)) subOut = mn;
      if (matchesPlayer(e, 'playerIn', 'playerInNumber') || normEq(e.playerIn || e.player2)) subIn = mn;
      return;
    }
    if (!matchesPlayer(e, 'player', 'playerNumber')) return;
    if (e.type === 'goal') goals++;
    else if (e.type === 'yellow') yellow++;
    else if (e.type === 'red') red = true;
  });
  const secondYellow = yellow >= 2;
  const showRed = red || secondYellow;

  const badges = [];
  if (showRed) {
    badges.push('<span class="pl-badge pl-badge-red" title="بطاقة حمراء"></span>');
  } else if (yellow === 1) {
    badges.push('<span class="pl-badge pl-badge-yellow" title="بطاقة صفراء"></span>');
  }
  if (goals > 0) {
    const cnt = goals > 1 ? `<span class="pl-badge-goalcount">${goals}</span>` : '';
    const ball = (window.Icon ? window.Icon('ball', 11) : '⚽');
    badges.push('<span class="pl-badge pl-badge-goal">' + ball + cnt + '</span>');
  }
  // سهم التبديل
  if (subOut != null) badges.push(`<span class="pl-badge pl-badge-subout" title="خرج ${subOut}'">${window.Icon?window.Icon('download',9):'▼'}</span>`);
  else if (subIn != null) badges.push(`<span class="pl-badge pl-badge-subin" title="دخل ${subIn}'">${window.Icon?window.Icon('upload',9):'▲'}</span>`);

  if (!badges.length) return '';
  return '<div class="pl-badges">' + badges.join('') + '</div>';
}
window._playerMatchBadges = _playerMatchBadges;


//  - نفس البطاقة لكل الحالات: upcoming / live / finished
//  - لا أقسام منفصلة، لا عناوين مكررة
// ══════════════════════════════════════════════════════════════

// ── هدافو المباراة مقسومين بين الفريقين مع خط فاصل ──
// (مثل التطبيقات: كل فريق في عمود، الخط يفصلهما)
// ملاحظة: كانت _mdScorers تُستخدم لعرض شريط الهدافين فوق شريط التبويبات
// في نافذة تفاصيل المباراة — أُزيلت بطلب الإدارة (الهدف يظهر الآن فقط
// داخل الخط الزمني بتبويب "الأحداث").

// ── وقت انطلاق المباراة من التاريخ + الوقت ──
function _matchStartTime(m) {
  if (!m || !m.date) return null;
  const [y, mo, dd] = String(m.date).split('-').map(Number);
  const [h, mi]     = String(m.time || '00:00').split(':').map(Number);
  const t = new Date(y, (mo || 1) - 1, dd || 1, h || 0, mi || 0, 0, 0);
  return isNaN(t.getTime()) ? null : t;
}

// ── تنسيق العدّ التنازلي: يوم/ساعة/دقيقة/ثانية حسب المتبقّي ──
function _fmtCountdown(diff) {
  if (diff == null || diff < 0) diff = 0;
  const p = n => String(n).padStart(2, '0');
  const D = Math.floor(diff / 86400000);
  const H = Math.floor((diff % 86400000) / 3600000);
  const M = Math.floor((diff % 3600000) / 60000);
  const S = Math.floor((diff % 60000) / 1000);
  if (D > 0) return `${D}ي ${p(H)}:${p(M)}:${p(S)}`;
  return `${p(H)}:${p(M)}:${p(S)}`;
}

// ── مؤقّت موحّد لكل بطاقات العدّ التنازلي (تحديث كل ثانية بلا إعادة رسم) ──
let _cardCdTimer = null;
function _scheduleCardCountdown() {
  if (_cardCdTimer) return;
  _cardCdTimer = setInterval(() => {
    const nodes = document.querySelectorAll('.mc2-cd[data-cd]');
    if (!nodes.length) { clearInterval(_cardCdTimer); _cardCdTimer = null; return; }
    const now = Date.now();
    nodes.forEach(el => {
      const target = parseInt(el.getAttribute('data-cd'), 10);
      const diff = target - now;
      if (diff <= 5 * 60 * 1000) {
        // دخلت مرحلة "على وشك البدء" — أعد رسم القسم لتحديث الحالة
        if (typeof window._refreshHome === 'function') window._refreshHome();
        else if (typeof renderHomeSection === 'function') renderHomeSection();
        clearInterval(_cardCdTimer); _cardCdTimer = null;
        return;
      }
      el.textContent = _fmtCountdown(diff);
    });
  }, 1000);
}

function _matchCard(m) {
  const ht  = (window.teams||[]).find(t => t.id === m.homeId) || { name: m.homeName||'؟', logo: m.homeLogo||'' };
  const at  = (window.teams||[]).find(t => t.id === m.awayId) || { name: m.awayName||'؟', logo: m.awayLogo||'' };
  const d   = m.liveData;
  const isL = m.status === 'live' && d && _LIVE.includes(d.matchStatus);
  const isF = m.status === 'finished';
  const _psM = _penScore(m);
  const hw  = isF && (_psM ? _psM.h > _psM.a : (m.homeScore || 0) > (m.awayScore || 0));
  const aw  = isF && (_psM ? _psM.a > _psM.h : (m.awayScore || 0) > (m.homeScore || 0));

  // ── وسط البطاقة ──
  let center = '';
  if (isL) {
    const ph    = d.matchStatus;
    const isPen = ph === 'penalties';
    const isHT  = ph === 'halftime' || ph === 'halftime_et';
    const pLabel = isPen ? 'ركلات' : isHT ? 'استراحة'
                 : (ph === 'live' || ph === 'extratime1' || ph === 'extratime2' ? 'مباشر' : _periodLabel(d));
    const isPenScore = isPen && d.penalties;
    const _penIsGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
    const penH = isPenScore ? (d.penalties.home||[]).filter(_penIsGoal).length : null;
    const penA = isPenScore ? (d.penalties.away||[]).filter(_penIsGoal).length : null;
    // ✅︎ الإيقاف المؤقت — يظهر للجمهور بدل نبضة "مباشر"
    const isPaused = !!d.timerPaused && ['live','extratime1','extratime2'].includes(ph);
    // ✅︎ تنظيف السبب عند العرض أيضاً (دفاع مزدوج ضد أي بيانات قديمة/غير نظيفة)
    const pReason  = String(d.pauseReason || '').replace(/[<>&"']/g, '').trim().slice(0, 60);
    const tag = isPaused
      ? `<div class="mc2-livetag mc2-paused">⏸️ متوقفة</div>`
      : `<div class="mc2-livetag"><span class="mc-live-dot"></span>${pLabel}</div>`;

    center = `
      <div class="mc2-mid">
        ${tag}
        ${isPenScore ? '' : `<div class="mc2-clock" id="mc2-clock-${m.id}">${_clock(d)}</div>`}
        <div class="mc2-score">
          <span>${isPenScore ? penH : (d.homeScore ?? 0)}</span>
          <span class="mc2-sep">:</span>
          <span>${isPenScore ? penA : (d.awayScore ?? 0)}</span>
        </div>
        ${isPenScore ? `<div class="mc2-note">(${d.homeScore ?? 0}-${d.awayScore ?? 0} بعد الوقت الأصلي)</div>` : ''}
        ${isPaused && pReason ? `<div class="mc2-pause-reason">🛈 ${pReason}</div>` : ''}
      </div>`;
  } else if (isF) {
    center = `
      <div class="mc2-mid">
        <div class="mc2-score mc2-done">
          <span class="${hw?'mc2-win':''}">${m.homeScore ?? 0}</span>
          <span class="mc2-sep">:</span>
          <span class="${aw?'mc2-win':''}">${m.awayScore ?? 0}</span>
        </div>
        ${_psM ? `<div class="mc2-note" style="color:var(--gold);font-weight:800">ركلات الترجيح ${_psM.h}-${_psM.a}</div>` : `<div class="mc2-note">انتهت</div>`}
      </div>`;
  } else {
    // ── عدّاد تنازلي داخل البطاقة إذا كانت المباراة خلال ٢٤ ساعة ──
    const _target = _matchStartTime(m);
    const _diff   = _target ? (_target - new Date()) : null;
    const _within24 = _diff != null && _diff > 0 && _diff <= 86400000;
    const _verge    = _diff != null && _diff <= 5 * 60 * 1000 && _diff > -30 * 60 * 1000;

    if (_verge) {
      center = `
        <div class="mc2-mid">
          <div class="mc2-verge"><span class="mc2-verge-dot"></span>على وشك البدء</div>
          ${m.time ? `<div class="mc2-note">${formatTimeTo12H(m.time)}</div>` : ''}
        </div>`;
    } else if (_within24) {
      center = `
        <div class="mc2-mid">
          <div class="mc2-cd" data-cd="${_target.getTime()}" data-mid="${m.id}">${_fmtCountdown(_diff)}</div>
          <div class="mc2-cd-lbl">${m.time ? formatTimeTo12H(m.time) : ''}</div>
        </div>`;
      _scheduleCardCountdown();
    } else {
      center = `
        <div class="mc2-mid">
          <div class="mc2-time">${m.time ? formatTimeTo12H(m.time) : 'VS'}</div>
          ${m.date ? `<div class="mc2-note">${m.date}</div>` : ''}
        </div>`;
    }
  }

  const roundBadge = m.isKnockout && m.knockoutRoundName
    ? `<div class="mc2-round"><span class="mc2-rb mc2-rb-ko">${m.knockoutRoundName}</span></div>`
    : (m.round ? `<div class="mc2-round"><span class="mc2-rb">الجولة ${m.round}</span></div>` : '');

  // شارة التوقّع (مسابقة التوقّع المحلية)
  const predB = (typeof window.predBadge === 'function') ? window.predBadge(m.id) : '';

  return `
    <div class="mc2 ${isL?'mc2-live':''} ${isF?'mc2-fin':''}" onclick="openMatchDetail('${m.id}')">
      ${roundBadge}
      <div class="mc2-team">
        <div class="mc2-logo">${_logo(ht.logo, 40)}</div>
        <div class="mc2-name ${hw?'mc2-win':''}">${ht.name}</div>
      </div>
      ${center}
      <div class="mc2-team">
        <div class="mc2-logo">${_logo(at.logo, 40)}</div>
        <div class="mc2-name ${aw?'mc2-win':''}">${at.name}</div>
      </div>
      ${predB ? `<div class="mc2-pred">${predB}</div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//  renderHomeSection — الرئيسية بلا بنرات
// ══════════════════════════════════════════════════════════════
function renderHomeSection() {
  const el = document.getElementById('homeMatchesSection');
  if (!el) {
    // fallback: استخدم homeLiveSection القديم إن وُجد
    _renderFallbackSections();
    return;
  }

  const live     = (window.matches||[]).filter(m => m.status === 'live');
  const upcoming = (window.matches||[]).filter(m =>
                       m.status === 'upcoming' ||
                       // ✅︎ شبكة أمان: مباريات "معلّقة" قديمة من قبل الإصلاح،
                       // لو الفريقان معروفان (مو TBD بانتظار نتيجة دور سابق) نعرضها
                       (m.status === 'pending' && m.homeId && m.awayId))
                     .sort((a,b)=>(a.round||0)-(b.round||0)||(a.date||'').localeCompare(b.date||''));
  // آخر النتائج = آخر ما انتهى فعلياً (حسب وقت الإنهاء)، لا حسب ترتيب المصفوفة.
  // هذا يضمن ظهور مباريات الأدوار الإقصائية بدل مباريات المجموعات القديمة
  // بمجرد انتهائها، لأن ترتيبها في المصفوفة قد يسبق الإقصاء.
  const finished = (window.matches||[]).filter(m => m.status === 'finished')
                     .slice()
                     .sort((a,b) => {
                       const ta = _tsMs(a.updatedAt), tb = _tsMs(b.updatedAt);
                       if (ta != null && tb != null) return tb - ta;      // الأحدث انتهاءً أولاً
                       if (ta != null) return -1;
                       if (tb != null) return 1;
                       // fallback: الدور الأعلى (الإقصاء) ثم التاريخ
                       return (b.round||0)-(a.round||0) || (b.date||'').localeCompare(a.date||'');
                     })
                     .slice(0, 3);

  let html = '';

  // مباريات مباشرة — بدون عنوان منفصل، البطاقة نفسها تعبّر
  if (live.length) {
    html += live.map(m => _matchCard(m)).join('');
  }

  // مباريات قادمة
  if (upcoming.length) {
    if (html) html += `<div style="height:8px"></div>`;
    html += `<div style="font-size:11px;font-weight:700;color:var(--t3,#666);padding:4px 2px 6px">⏳ القادمة</div>`;
    html += upcoming.slice(0, 3).map(m => _matchCard(m)).join('');
  }

  // 🧠 أبرز الأرقام — إحصائيات ذكية مكتشفة تلقائياً
  try {
    const insights = (typeof _computeInsights === 'function') ? _computeInsights() : [];
    if (insights.length) {
      if (html) html += `<div style="height:8px"></div>`;
      html += `<div style="font-size:11px;font-weight:700;color:var(--t3,#666);padding:4px 2px 6px">🧠 أبرز الأرقام</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">`;
      html += insights.slice(0, 4).map(ins => `
        <div style="display:flex;align-items:center;gap:11px;background:var(--s1);border:1px solid var(--b1);
          border-inline-start:3px solid ${ins.color};border-radius:12px;padding:12px 14px">
          <span style="font-size:20px;flex-shrink:0">${ins.icon}</span>
          <span style="font-size:13px;font-weight:700;color:var(--t1);line-height:1.5">${ins.text}</span>
        </div>`).join('');
      html += `</div>`;
    }
  } catch (e) {}

  // آخر النتائج
  if (finished.length) {
    if (html) html += `<div style="height:8px"></div>`;
    html += `<div style="font-size:11px;font-weight:700;color:var(--t3,#666);padding:4px 2px 6px">✅︎ آخر النتائج</div>`;
    html += finished.map(m => _matchCard(m)).join('');
  }

  if (!html) {
    html = `<div style="text-align:center;padding:40px 20px;color:var(--t3,#666)">
      <div style="font-size:40px;margin-bottom:10px;opacity:.3">⚽</div>
      <div style="font-size:13px">لا توجد مباريات بعد</div>
    </div>`;
  }

  el.innerHTML = html;

  // شغّل العداد لكل مباراة مباشرة
  live.forEach(m => _startCard2Clock(m));
}

// Fallback للـ HTML القديم
function _renderFallbackSections() {
  const live     = (window.matches||[]).filter(m => m.status === 'live');
  const upcoming = (window.matches||[]).filter(m =>
                       m.status === 'upcoming' ||
                       (m.status === 'pending' && m.homeId && m.awayId)).slice(0,3);
  const finished = (window.matches||[]).filter(m => m.status === 'finished')
                     .slice()
                     .sort((a,b) => {
                       const ta = _tsMs(a.updatedAt), tb = _tsMs(b.updatedAt);
                       if (ta != null && tb != null) return tb - ta;
                       if (ta != null) return -1;
                       if (tb != null) return 1;
                       return (b.round||0)-(a.round||0) || (b.date||'').localeCompare(a.date||'');
                     })
                     .slice(0, 3);
  const set = (id, items, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!items.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = (label ? `<div style="font-size:11px;font-weight:700;color:var(--t3,#666);padding:4px 2px 8px">${label}</div>` : '')
      + items.map(m => _matchCard(m)).join('');
    if (id === 'homeLiveSection') items.forEach(m => _startCard2Clock(m));
  };
  set('homeLiveSection',     live,     '');
  set('homeUpcomingSection', upcoming, '⏳ القادمة');
  set('homeResultsSection',  finished, '✅︎ آخر النتائج');
}

// ── عداد البطاقات ──────────────────────────────────────────────
const _c2timers = {};
function _startCard2Clock(m) {
  clearInterval(_c2timers[m.id]);
  _c2timers[m.id] = setInterval(() => {
    const latest = (window.matches||[]).find(x => x.id === m.id);
    const d = latest && latest.liveData;
    if (!d) return;
    // ✅︎ توقّف فوري عند بلوغ سقف بدل الضائع المُحدَّد — بلا انتظار تحديث الصفحة
    const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
    const frozen = !!(c && c.shouldAutoEnd);
    // ✅︎ الإيقاف المؤقت: TimerCore يُرجع phaseSeconds الثابتة، فالساعة تتجمّد تلقائياً
    const paused = !!d.timerPaused;
    // بطاقة الرئيسية
    const homeEl = document.getElementById('mc2-clock-' + m.id);
    if (homeEl) homeEl.innerHTML = _clock(d);
    // بطاقة تاب المباريات
    const tabEl  = document.getElementById('mc-elapsed-' + m.id);
    if (tabEl) tabEl.innerHTML = _clock(d);
    // بطاقة تاب مباشر
    const liveEl = document.getElementById('lt-clock2-' + m.id);
    if (liveEl) liveEl.innerHTML = _clock(d);
    if (!homeEl && !tabEl && !liveEl) clearInterval(_c2timers[m.id]);
    // الساعة بلغت الحد — جمّدها (تبقى القيمة الأخيرة معروضة)
    // ⚠️ لا نوقف المؤقّت عند الإيقاف المؤقت: نبقيه ليلتقط الاستئناف فوراً
    else if (frozen && !paused) clearInterval(_c2timers[m.id]);
  }, 500);
}

// ══════════════════════════════════════════════════════════════
//  تاب "مباشر الآن" — نفس البطاقة الموحّدة
// ══════════════════════════════════════════════════════════════
function renderLiveMatchesTab() {
  const el = document.getElementById('liveMatchesList');
  if (!el) return;
  const live = (window.matches||[]).filter(m =>
    m.status === 'live' && m.liveData && _LIVE.includes(m.liveData.matchStatus)
  );
  if (!live.length) {
    el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--t3,#666)">
      <div style="font-size:50px;margin-bottom:12px;opacity:.3">🔴</div>
      <div style="font-size:14px">لا توجد مباريات مباشرة حالياً</div>
    </div>`;
    return;
  }
  el.innerHTML = live.map(m => _matchCard(m)).join('');
  live.forEach(m => _startCard2Clock(m));
}

// ══════════════════════════════════════════════════════════════
//  Override renderAll — يوحّد كل نقاط الدخول
// ══════════════════════════════════════════════════════════════
if (!window._renderAllV2Patched) {
  window._renderAllV2Patched = true;
  const _origRA = window.renderAll;
  window.renderAll = function() {
    _origRA && _origRA();
    renderHomeSection();
    renderLiveMatchesTab();
    checkGoalChanges && checkGoalChanges();
    checkExtraTimeChanges && checkExtraTimeChanges();
  };
}

// ══════════════════════════════════════════════════════════════
//  openMatchDetail — واجهة احترافية مع تبويبات
// ══════════════════════════════════════════════════════════════

// ── تحويل رابط بث إلى iframe مضمّن (يوتيوب/فيسبوك/تويتش/رابط مباشر) ──
function _toEmbedUrl(url) {
  if (!url) return null;
  url = String(url).trim();
  try {
    // YouTube: watch?v= / youtu.be/ / live/ / shorts/ / embed/
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (m) return { type:'iframe', src:`https://www.youtube.com/embed/${m[1]}?autoplay=1&playsinline=1` };
    // YouTube channel live: youtube.com/@handle/live أو /channel/ID/live — نفتح الرابط كما هو
    if (/youtube\.com\/.+\/live/.test(url)) return { type:'iframe', src:url.replace('/live','/embed/live_stream') };
    // Twitch
    m = url.match(/twitch\.tv\/([A-Za-z0-9_]+)/);
    if (m) return { type:'iframe', src:`https://player.twitch.tv/?channel=${m[1]}&parent=${location.hostname}&autoplay=true` };
    // رابط فيديو مباشر (mp4/m3u8/webm)
    if (/\.(mp4|webm|m3u8)(\?|$)/i.test(url)) return { type:'video', src:url };
    // Facebook: التضمين يعمل فقط من الصفحات (Pages)، ويفشل من الحسابات الشخصية
    //   (رسالة Video Unavailable). لذا نعرضه كزر «شاهد البث» الأضمن.
    if (/facebook\.com\/|fb\.watch\//.test(url)) return { type:'link', src:url, platform:'فيسبوك' };
    // منصات تمنع التضمين المباشر للبث → زر «شاهد البث» يفتح تطبيقها
    if (/tiktok\.com|instagram\.com|snapchat\.com|(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com|kwai|likee/i.test(url)) {
      let platform = 'المنصة';
      if (/tiktok/i.test(url))          platform = 'تيك توك';
      else if (/instagram/i.test(url))  platform = 'إنستغرام';
      else if (/snapchat/i.test(url))   platform = 'سناب شات';
      else if (/x\.com|twitter/i.test(url)) platform = 'إكس (تويتر)';
      return { type:'link', src:url, platform };
    }
  } catch(e) {}
  // غير معروف → زر «شاهد البث» (أأمن من iframe فارغ)
  return { type:'link', src:url, platform:'الرابط' };
}

// ── بناء قسم الفيديو المضمّن داخل صفحة المباراة ──
function _buildVideoEmbed(m) {
  const url = m && (m.videoUrl || (m.liveData && m.liveData.videoUrl));
  if (!url) return '';
  // يظهر الفيديو في كل الحالات ما دام هناك رابط:
  //  - قبل البدء: تحاليل/إحماء/استوديو ما قبل المباراة
  //  - أثناء البث: البث المباشر
  //  - بعد الانتهاء: إعادة
  const emb = _toEmbedUrl(url);
  if (!emb) return '';
  const isLive = m.status === 'live';
  const isFin  = m.status === 'finished';
  let badge;
  if (isLive) {
    badge = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:900;color:#E5533D;background:rgba(229,83,61,.12);border:1px solid rgba(229,83,61,.3);border-radius:999px;padding:3px 10px"><span style="width:6px;height:6px;border-radius:50%;background:#E5533D;display:inline-block"></span>مباشر الآن</span>';
  } else if (isFin) {
    badge = '<span style="font-size:11px;font-weight:700;color:var(--t3)">📼 إعادة</span>';
  } else {
    badge = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:var(--gold);background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.3);border-radius:999px;padding:3px 10px">🎙️ ما قبل المباراة</span>';
  }
  const title = isLive ? '🎥 البث المباشر' : (isFin ? '🎥 إعادة المباراة' : '🎥 تحليلات ما قبل المباراة');

  // منصات تمنع التضمين (تيك توك/فيسبوك شخصي…) → زر «شاهد البث» يفتح تطبيقها
  if (emb.type === 'link') {
    const verb = isLive ? 'شاهد البث المباشر' : (isFin ? 'شاهد الإعادة' : 'شاهد التحليلات');
    // سطر نتيجة حيّ أسفل الزر (للمباريات المباشرة)
    let liveLine = '';
    if (isLive && m.liveData) {
      const ht0 = (window.teams||[]).find(t => t.id === m.homeId) || { name:m.homeName||'' };
      const at0 = (window.teams||[]).find(t => t.id === m.awayId) || { name:m.awayName||'' };
      const ck  = (typeof _clock === 'function') ? _clock(m.liveData) : '';
      liveLine = `
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:10px;padding:8px 12px;background:var(--s1);border:1px solid var(--b1);border-radius:10px;font-size:13px;font-weight:800;color:var(--t1)">
          <span>${ht0.name}</span>
          <b id="md-vsh-${m.id}">${m.liveData.homeScore ?? 0}</b><span style="opacity:.5">:</span><b id="md-vsa-${m.id}">${m.liveData.awayScore ?? 0}</b>
          <span>${at0.name}</span>
          <span id="md-vtimer-${m.id}" style="color:#E5533D;font-weight:900">${ck}</span>
        </div>`;
      if (typeof _startDetailClock2 === 'function') setTimeout(() => _startDetailClock2(m.id), 0);
    }
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;font-weight:900;color:var(--t2)">${title}</span>
          ${badge}
        </div>
        <a href="${emb.src}" target="_blank" rel="noopener"
           style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-decoration:none;
                  padding:30px 16px;border-radius:14px;background:linear-gradient(135deg,rgba(229,83,61,.12),rgba(201,160,43,.08));
                  border:1px solid var(--b1)">
          <div style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;font-size:28px">▶️</div>
          <div style="font-size:15px;font-weight:900;color:var(--t1)">${verb}</div>
          <div style="font-size:12px;color:var(--t3)">على ${emb.platform} — يفتح في التطبيق</div>
        </a>
        ${liveLine}
      </div>`;
  }

  const player = emb.type === 'video'
    ? `<video src="${emb.src}" controls autoplay playsinline style="width:100%;height:100%;border:0;background:#000"></video>`
    : `<iframe src="${emb.src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0" style="width:100%;height:100%;border:0"></iframe>`;

  // شريط النتيجة والوقت فوق الفيديو (للمباريات المباشرة فقط)
  const ht = (window.teams||[]).find(t => t.id === m.homeId) || { name:m.homeName||'', logo:m.homeLogo||'' };
  const at = (window.teams||[]).find(t => t.id === m.awayId) || { name:m.awayName||'', logo:m.awayLogo||'' };
  const d  = m.liveData;
  let scoreBar = '';
  if (isLive && d) {
    const _lg = (l) => l
      ? `<img src="${l}" style="width:20px;height:20px;border-radius:4px;object-fit:cover" alt="">`
      : `<span style="width:20px;height:20px;border-radius:4px;background:rgba(255,255,255,.15);display:inline-flex;align-items:center;justify-content:center;font-size:11px">⚽</span>`;
    const clockTxt = (typeof _clock === 'function') ? _clock(d) : '';
    scoreBar = `
      <div style="position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;justify-content:center;gap:10px;
                  padding:7px 12px;background:linear-gradient(180deg,rgba(0,0,0,.78),rgba(0,0,0,0));pointer-events:none">
        <span style="display:inline-flex;align-items:center;gap:6px;color:#fff;font-size:12px;font-weight:800;font-family:Tajawal,sans-serif">${_lg(ht.logo)}${ht.name}</span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:2px 10px">
          <b id="md-vsh-${m.id}" style="color:#fff;font-size:15px;font-family:Tajawal,sans-serif">${d.homeScore ?? 0}</b>
          <span style="color:#fff;opacity:.6">:</span>
          <b id="md-vsa-${m.id}" style="color:#fff;font-size:15px;font-family:Tajawal,sans-serif">${d.awayScore ?? 0}</b>
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;color:#fff;font-size:12px;font-weight:800;font-family:Tajawal,sans-serif">${at.name}${_lg(at.logo)}</span>
        <span id="md-vtimer-${m.id}" style="display:inline-flex;align-items:center;gap:4px;color:#E5533D;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;background:rgba(0,0,0,.5);border-radius:6px;padding:2px 8px">${clockTxt}</span>
      </div>`;
    if (typeof _startDetailClock2 === 'function') setTimeout(() => _startDetailClock2(m.id), 0);
  }
  return `
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:900;color:var(--t2)">${title}</span>
        ${badge}
      </div>
      <div id="md-video-wrap-${m.id}" style="position:relative;width:100%;padding-top:56.25%;border-radius:14px;overflow:hidden;background:#000;border:1px solid var(--b1)">
        <div style="position:absolute;inset:0">${player}</div>
        ${scoreBar}
        <button onclick="_toggleVideoFullscreen('${m.id}')" title="ملء الشاشة"
          style="position:absolute;bottom:8px;left:8px;z-index:6;width:34px;height:34px;border:0;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">⛶</button>
      </div>
      <a href="${url}" target="_blank" rel="noopener"
         style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;padding:9px;border-radius:10px;
                background:var(--s1);border:1px solid var(--b1);text-decoration:none;color:var(--t2);font-size:12px;font-weight:800">
        ▶️ لم يظهر البث؟ شاهده على المصدر ↗
      </a>
    </div>`;
}

// ملء الشاشة لمشغّل الفيديو
function _toggleVideoFullscreen(matchId) {
  const wrap = document.getElementById('md-video-wrap-' + matchId);
  if (!wrap) return;
  const el = wrap.querySelector('video') || wrap;
  try {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.webkitEnterFullscreen) el.webkitEnterFullscreen(); // iOS video
    else wrap.requestFullscreen && wrap.requestFullscreen();
  } catch(e) {}
}
window._toggleVideoFullscreen = _toggleVideoFullscreen;

// ── بوابة ما قبل البدء: تظهر للمباريات التي لم تبدأ بعد ──
// ── (أُزيلت بوابة/عدّاد ما قبل البدء — الفيديو وحده يظهر عند وجود رابط) ──

(function() {
  if (window._matchDetailV3Fixed) return;
  window._matchDetailV3Fixed = true;

  window.openMatchDetail = function(matchId) {
    const m = (window.matches||[]).find(x => x.id === matchId);
    if (!m) return;
    window._lastMatchDetailId = matchId;

    const ht = (window.teams||[]).find(t => t.id === m.homeId) || { name: m.homeName||'؟', logo: m.homeLogo||'' };
    const at = (window.teams||[]).find(t => t.id === m.awayId) || { name: m.awayName||'؟', logo: m.awayLogo||'' };
    const d  = m.liveData;
    const isL = m.status === 'live' && d && _LIVE.includes(d.matchStatus);
    const isF = m.status === 'finished';

    const overlay = document.getElementById('matchDetailOverlay');
    const body    = document.getElementById('matchDetailBody');
    if(!overlay||!body) return;

    // ✅ FIX: حمّل كشفي الفريقين مسبقاً حتى تظهر أسماء الهدافين المحدَّثة
    //    فوراً في خط زمن أحداث المباراة، بدل انتظار الجمهور يفتح صفحة الفريق.
    const _mdEvents = (d && d.events) || m.events || [];
    if (_mdEvents.some(e => e && e.type === 'goal' && e.playerId)) {
      _ensureRosterLoaded(ht.id, () => { if (overlay.classList.contains('show')) window.openMatchDetail(matchId); });
      _ensureRosterLoaded(at.id, () => { if (overlay.classList.contains('show')) window.openMatchDetail(matchId); });
    }

    const isUpcoming = !isL && !isF;

    // ── تبويبات ── (بلا "نظرة عامة" وبلا "المعلومات" — أُلغيتا بطلب الإدارة)
    // تبويب واحد لتفاصيل/أحداث المباراة: قبل البداية "الأحداث" (يعرض تفاصيل
    // المباراة عند الضغط عليه فقط — لا يظهر تلقائياً)، وبعد بدء المباراة
    // يتحوّل تلقائياً إلى "مجريات المباراة" (الخط الزمني الفعلي للأحداث).
    const tabs = [];
    tabs.push({id:'events', label: isUpcoming ? 'الأحداث' : 'مجريات المباراة'});
    if (!isUpcoming) tabs.push({id:'stats', label:'الإحصائيات'});
    tabs.push({id:'lineup', label:'التشكيلات'});
    tabs.push({id:'h2h', label:'المواجهات'});

    // كشف الإحصائيات — يدعم تنسيقَين:
    // live-page-enhancements: liveData.stats = {home_shots, away_shots, home_possession...}
    // quick-entry / mcv2:     m.stats = {shotsHome, shotsAway, possessionHome...}
    const _statsLive = (d && d.stats) || null;
    const _statsFin  = m.stats || null;

    const activeTab = (tabs[0] && tabs[0].id) || 'lineup';

    // ── بناء محتوى كل تبويب ──
    function buildTabContent(tabId) {

      // ══ الإحصائيات — يدعم كلا التنسيقين + يحترم statsEnabled ══
      if (tabId === 'stats') {
        // للمباريات المنتهية: نعرض دائماً بغض النظر عن statsEnabled
        // للمباريات المباشرة: نحترم statsEnabled
        const statsData = _statsLive || _statsFin || {};
        const mergedD   = { stats: statsData, statsEnabled: isF ? true : (d ? d.statsEnabled : true) };
        const statsHtml = _buildUnifiedStatsHtml(mergedD, ht, at);
        if (!statsHtml) return `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
          <div style="font-size:36px;margin-bottom:10px;opacity:.3">📈</div>
          <div style="font-size:13px">لم تُدخَل إحصائيات بعد</div>
          <div style="font-size:11px;margin-top:6px">يضيفها مدير البطولة من لوحة التحكم</div>
        </div>`;
        return statsHtml;
      }

      if (tabId === 'events') {
        // ── قبل بدء المباراة: تفاصيل المباراة فقط (ليست أحداثاً بعد) ──
        if (isUpcoming) {
          const info = buildInfoPanel();
          return info || '<div class="vt-empty">لم تُضَف تفاصيل المباراة بعد</div>';
        }

        // ملاحظة: رجل المباراة يُميَّز فقط على اللاعب داخل التشكيلة (شارة نجمة ذهبية)،
        // ولا يُعرض كبطاقة منفصلة هنا — بطلب الإدارة.

        // ── خط زمني رأسي: كل الأحداث بترتيب متسلسل بمسافات ثابتة
        //    (وليس بحسب الفارق الزمني الحقيقي) — أهداف الفريق الأول يساراً،
        //    أهداف الفريق الثاني يميناً، وبقية الأحداث كبطاقة وسط الخط ──
        // ✅︎ نقرأ من المصدر الموحّد: يدعم أحداث الإدخال السريع (m.events)
        //    وأحداث صفحة البث المباشر (m.liveData.events) معاً.
        const evs = _matchEvents(m).slice();

        function minLabel(ev) {
          return ev.extraMinute > 0 ? `${ev.minute}+${ev.extraMinute}'` : `${ev.minute}'`;
        }

        // صفوف الأحداث الفعلية (أهداف + بطاقات + تبديلات...)
        const rows = evs.map(ev => ({
          minute: ev.minute || 0,
          order: (ev.extraMinute || 0) * 0.01,
          kind: (ev.type === 'goal' || ev.type === 'own') ? 'goal' : 'chip',
          ev
        }));

        // ── علامة اصطناعية: نهاية الشوط الأول / بداية الثاني ──
        const cfg = window.TimerCore ? window.TimerCore.getCfg(d || {}, window.settings)
                                      : { half1Duration: 45, half2Duration: 45 };
        const half1 = cfg.half1Duration || 45;
        // المصدر الدقيق: مؤقّت صفحة البث المباشر (لو استُخدم)
        const reachedHT_live = !!(d && (d.currentHalf === 2 ||
          ['halftime','extratime1','halftime_et','extratime2','penalties','ended'].includes(d.matchStatus)));
        // احتياط ذكي: الإدخال السريع لا يملك مؤقّتاً أصلاً — لو المباراة
        // انتهت وفيها حدث بعد نهاية الشوط الأول المفترضة، فمعنى هذا إنها
        // تجاوزت الشوط الأول فعلاً، فنُظهر العلامة استنتاجاً من الدقائق.
        const reachedHT_inferred = !reachedHT_live && isF && evs.some(e => (e.minute || 0) > half1);
        if (reachedHT_live || reachedHT_inferred) {
          rows.push({ minute: half1, order: 0.5, kind: 'marker', label: 'نهاية الشوط الأول' });
        }

        // ── علامة اصطناعية: بداية ركلات الترجيح (إن وصلت المباراة إليها) ──
        const _pdMark = (d && d.penalties) || m.penalties || (m.liveData && m.liveData.penalties);
        const _hasPenMark = !!(_pdMark && ((_pdMark.home||[]).length || (_pdMark.away||[]).length));
        const reachedPens = (_hasPenMark && ((d && d.matchStatus === 'penalties') || isF))
          || (isF && (m.penaltyScoreHome != null || m.penaltyScoreAway != null));
        if (reachedPens) {
          rows.push({ minute: 998, order: 0.95, kind: 'marker', label: 'بدأت ركلات الترجيح' });

          // ── ركلات الترجيح داخل الخط الزمني نفسه (بنفس تنسيق الأهداف) ──
          const _pIsGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
          const _pName   = r => (typeof r === 'object' && r && r.player) ? String(r.player) : '';
          const _ph = (_pdMark && _pdMark.home) || [];
          const _pa = (_pdMark && _pdMark.away) || [];
          const _maxK = Math.max(_ph.length, _pa.length);
          let _ord = 0.96;
          for (let i = 0; i < _maxK; i++) {
            if (_ph[i] !== undefined) {
              rows.push({ minute: 998, order: (_ord += 0.001), kind: 'pen',
                penSide: 'home', penNo: i + 1,
                penGoal: _pIsGoal(_ph[i]), penName: _pName(_ph[i]) });
            }
            if (_pa[i] !== undefined) {
              rows.push({ minute: 998, order: (_ord += 0.001), kind: 'pen',
                penSide: 'away', penNo: i + 1,
                penGoal: _pIsGoal(_pa[i]), penName: _pName(_pa[i]) });
            }
          }
          const _phG = _ph.filter(_pIsGoal).length;
          const _paG = _pa.filter(_pIsGoal).length;
          const _aggPs = (typeof _penScore === 'function') ? _penScore(m) : null;
          const _fh = _maxK ? _phG : (_aggPs ? _aggPs.h : 0);
          const _fa = _maxK ? _paG : (_aggPs ? _aggPs.a : 0);
          if (_maxK || _aggPs) {
            const _win = _fh !== _fa ? (_fh > _fa ? ht.name : at.name) : '';
            rows.push({ minute: 998, order: 0.98, kind: 'penresult',
              label: `ركلات الترجيح ${_fh} - ${_fa}`, winner: _win });
          }
        }

        // ── علامة تقدّم المباراة الحيّة — تُدرَج في مكانها الزمني ضمن التسلسل ──
        if (isL) {
          const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
          if (c) {
            rows.push({
              minute: c.displayMin, order: 0.9, kind: 'live',
              label: `${_periodLabel(d)} · ${_clock(d)}`
            });
          }
        }

        if (isF) rows.push({ minute: 999, order: 1, kind: 'marker', label: 'نهاية المباراة' });

        rows.sort((a, b) => (a.minute - b.minute) || (a.order - b.order));

        // ── كشف البطاقة الصفراء الثانية: تُعرض كطرد (صفراء+حمراء) ──
        const _secondYellowIds = new Set();
        const _yCount = {};
        rows.filter(r => r.ev && r.ev.type === 'yellow')
          .forEach(r => {
            const ev = r.ev;
            const side = _evSide(ev);
            const who = side + '::' + _normName(ev.player || ev.playerNumber || '');
            _yCount[who] = (_yCount[who] || 0) + 1;
            if (_yCount[who] === 2) _secondYellowIds.add(ev.id != null ? ev.id : ev);
          });

        function rowHtml(r) {
          if (r.kind === 'marker') {
            return `<div class="vt-row vt-row-mid">
              <div class="vt-chip vt-chip-marker">${r.label}</div>
            </div>`;
          }
          if (r.kind === 'live') {
            return `<div class="vt-row vt-row-mid">
              <div class="vt-chip vt-chip-live"><span class="vt-live-dot"></span>${r.label}</div>
            </div>`;
          }
          // ── ركلة ترجيح: نفس تنسيق الهدف (يمين/يسار) بأيقونة ✓/✗ ──
          if (r.kind === 'pen') {
            const side = r.penSide === 'away' ? 'left' : 'right';
            const nm = r.penName || (r.penGoal ? 'سجّل' : 'ضيّع');
            const content = `<div class="vt-goal vt-pen-${r.penGoal ? 'in' : 'out'}">
              <span class="vt-goal-name">${nm}</span>
              <span class="vt-goal-min">رك ${r.penNo}</span>
            </div>`;
            return `<div class="vt-row vt-row-${side}">
              <div class="vt-side vt-side-left">${side === 'left' ? content : ''}</div>
              <div class="vt-marker"><span class="vt-dot ${r.penGoal ? 'vt-dot-penin' : 'vt-dot-penout'}">${window.Icon ? window.Icon(r.penGoal ? 'check' : 'close', 11) : (r.penGoal ? '✓' : '✗')}</span></div>
              <div class="vt-side vt-side-right">${side === 'right' ? content : ''}</div>
            </div>`;
          }
          // ── نتيجة ركلات الترجيح النهائية ──
          if (r.kind === 'penresult') {
            return `<div class="vt-row vt-row-mid">
              <div class="vt-chip vt-chip-penres">
                <span>${r.label}</span>
                ${r.winner ? `<span class="vt-penres-win">${window.Icon ? window.Icon('trophy', 12) : ''} ${r.winner}</span>` : ''}
              </div>
            </div>`;
          }

          const ev = r.ev;
          if (r.kind === 'goal') {
            const side = _evSide(ev) === 'away' ? 'left' : 'right';
            const isOwn = ev.type === 'own';
            const _goalTeamId = _evSide(ev) === 'away' ? at.id : ht.id;
            const goalName = isOwn ? 'هدف عكسي' : (_liveEventPlayerName(ev, _goalTeamId) || '—');
            const content = `<div class="vt-goal">
              <span class="vt-goal-name"${isOwn?' style="color:var(--t3);font-style:italic"':''}>${goalName}</span>
              <span class="vt-goal-min">${minLabel(ev)}</span>
            </div>`;
            return `<div class="vt-row vt-row-${side}">
              <div class="vt-side vt-side-left">${side === 'left' ? content : ''}</div>
              <div class="vt-marker"><span class="vt-dot vt-dot-goal">${window.Icon ? window.Icon('ball', 12) : ''}</span></div>
              <div class="vt-side vt-side-right">${side === 'right' ? content : ''}</div>
            </div>`;
          }
          // بطاقات / تبديلات / إصابات / فار — بطاقة صغيرة في منتصف الخط
          const sideLbl = _evSide(ev) === 'away' ? at.name : ht.name;

          // ── التبديل: عرض احترافي بسهمين (داخل أخضر / خارج أحمر) ──
          if (ev.type === 'sub') {
            const _subTeamId = _evSide(ev) === 'away' ? at.id : ht.id;
            const inName  = _liveSubName(ev, _subTeamId, 'in')  || ev.playerIn  || ev.player2 || '';
            const outName = _liveSubName(ev, _subTeamId, 'out') || ev.playerOut || ev.player  || '';
            return `<div class="vt-row vt-row-mid">
              <div class="vt-chip vt-chip-sub">
                <span class="vt-sub-min">${minLabel(ev)}</span>
                <span class="vt-sub-body">
                  <span class="vt-sub-line vt-sub-in"><span class="vt-sub-arrow">${window.Icon ? window.Icon('upload', 10) : '▲'}</span>${inName}</span>
                  <span class="vt-sub-line vt-sub-out"><span class="vt-sub-arrow">${window.Icon ? window.Icon('download', 10) : '▼'}</span>${outName}</span>
                </span>
                <span class="vt-chip-team">(${sideLbl})</span>
              </div>
            </div>`;
          }

          // ── البطاقة الصفراء الثانية = طرد (تصميم مميّز مثل التطبيقات الرسمية) ──
          const _isSecondYellow = ev.type === 'yellow' && _secondYellowIds.has(ev.id != null ? ev.id : ev);
          if (_isSecondYellow) {
            const _syTeamId = _evSide(ev) === 'away' ? at.id : ht.id;
            const _syName = _liveEventPlayerName(ev, _syTeamId) || ev.player || '';
            return `<div class="vt-row vt-row-mid">
              <div class="vt-chip vt-chip-event vt-chip-sy">
                <span class="vt-chip-ic"><span class="ev-card2"><span class="ev-card ev-y"></span><span class="ev-card ev-r"></span></span></span>
                <span class="vt-chip-txt"><strong>${_syName}</strong>
                  <span class="vt-sy-label">بطاقة ثانية · طرد</span>
                  <span class="vt-chip-team">(${sideLbl})</span></span>
                <span class="vt-chip-min">${minLabel(ev)}</span>
              </div>
            </div>`;
          }

          const _chipTeamId = _evSide(ev) === 'away' ? at.id : ht.id;
          const _chipName = _liveEventPlayerName(ev, _chipTeamId) || ev.player || '';
          const _chipName2 = ev.player2 ? (_liveSubName(ev, _chipTeamId, 'in') || ev.player2) : '';
          return `<div class="vt-row vt-row-mid">
            <div class="vt-chip vt-chip-event">
              <span class="vt-chip-ic">${_evIcon(ev, 13)}</span>
              <span class="vt-chip-txt"><strong>${_chipName}</strong>${_chipName2 ? ` ← ${_chipName2}` : ''}
                <span class="vt-chip-team">(${sideLbl})</span></span>
              <span class="vt-chip-min">${minLabel(ev)}</span>
            </div>
          </div>`;
        }

        const rowsHtml = rows.map(rowHtml).join('');
        // ✅︎ FIX: الحاوية direction:ltr، والأهداف الآن: المضيف يميناً / الضيف يساراً
        //    (نفس ترتيب لوحة النتيجة RTL فوق). لذا الترويسة: الضيف يسار، المضيف يمين.
        const teamsHeader = `<div class="vt-teams">
          <span class="vt-team-h">${at.logo ? _logo(at.logo, 18) : ''}<b>${at.name}</b></span>
          <span class="vt-team-h">${ht.logo ? _logo(ht.logo, 18) : ''}<b>${ht.name}</b></span>
        </div>`;
        const emptyHtml = !evs.length
          ? '<div class="vt-empty">لا توجد أحداث بعد</div>'
          : '';

        // 📖 قصة المباراة (للمباريات المنتهية فقط)
        //    - تُخفى كلياً إن عطّلها المنظّم من إعدادات البطولة (showStory === false)
        //    - النص اليدوي (m.matchStory) يطغى على السرد التلقائي
        let storyHtml = '';
        const _storyEnabled = !(window.settings && window.settings.showStory === false);
        if (isF && _storyEnabled) {
          const _manual = (m.matchStory || '').toString().trim();
          const _esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          const _storyRaw = _manual || ((typeof _buildMatchStory === 'function') ? _buildMatchStory(m, ht, at) : '');
          const _story = _storyRaw ? _esc(_storyRaw) : '';
          if (_story) {
            storyHtml = `
              <div style="margin-bottom:14px;position:relative;overflow:hidden;
                background:linear-gradient(135deg,rgba(201,160,43,.10),rgba(201,160,43,.03));
                border:1px solid rgba(201,160,43,.28);border-radius:14px;padding:14px 16px">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px">
                  <span style="width:4px;height:15px;border-radius:3px;background:var(--gold)"></span>
                  <span style="font-size:12px;font-weight:900;color:var(--gold);letter-spacing:.3px">📖 قصة المباراة</span>
                </div>
                <p style="font-size:13px;line-height:2;color:var(--t1);margin:0;text-align:justify;white-space:pre-wrap">${_story}</p>
              </div>`;
          }
        }

        return `${storyHtml}<div class="vt-timeline">${teamsHeader}<div class="vt-line"></div>${rowsHtml}</div>${emptyHtml}`;
      }

      if (tabId === 'lineup') {
        const hl = m.homeLineup || (d && d.homeLineup);
        const al = m.awayLineup || (d && d.awayLineup);

        // ══ SVG الملاعب — نفس DD_PITCH_SVGS في admin-lineup-dragdrop.js ══
        // ══ ملعب احترافي بعمق واقعي (تدرّج عشب + خطوط جزّ + خطوط بيضاء نقية) ══
        // defs مشتركة تُحقن مرة واحدة في كل SVG: تدرّج عشب رأسي + توهّج + قناع ظل داخلي
        const _vpDefs = (nStripes) => {
          // شرائح الجزّ المتناوبة (أفقية) — تعطي إحساس العمق كالبث التلفزيوني
          let stripes = '';
          const h = 94 / nStripes;
          for (let i = 0; i < nStripes; i++) {
            const op = i % 2 === 0 ? 0.00 : 0.10;
            stripes += `<rect x="0" y="${(3 + i * h).toFixed(2)}%" width="100%" height="${h.toFixed(2)}%" fill="#ffffff" opacity="${op}"/>`;
          }
          return `<defs>
            <linearGradient id="vpGrass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2e8b40"/>
              <stop offset=".5" stop-color="#268038"/>
              <stop offset="1" stop-color="#1f7231"/>
            </linearGradient>
            <radialGradient id="vpGlow" cx="50%" cy="35%" r="75%">
              <stop offset="0" stop-color="#4bb35f" stop-opacity=".45"/>
              <stop offset="1" stop-color="#1f7231" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#vpGrass)"/>
          <rect width="100%" height="100%" fill="url(#vpGlow)"/>
          ${stripes}`;
        };
        const _vpLines = (opt) => {
          // opt: { boxW, boxH, sixW, sixH, centerR, spot, arcs }  كلها نِسَب
          const L = 'rgba(255,255,255,.78)';      // خطوط بيضاء نقية واضحة
          const Lf = 'rgba(255,255,255,.55)';     // أخفت قليلاً للتفاصيل
          const sw = '0.55';
          const bx = (100 - opt.boxW) / 2, sx = (100 - opt.sixW) / 2;
          const spot = opt.spot;
          const penTop = 3 + opt.boxH - (spot || 0);       // نقطة الجزاء العلوية
          const penBot = 97 - opt.boxH + (spot || 0);
          return `
            <rect x="5%" y="3%" width="90%" height="94%" stroke="${L}" stroke-width="${sw}" fill="none" rx="1"/>
            <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="${L}" stroke-width="${sw}"/>
            <circle cx="50%" cy="50%" r="${opt.centerR}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
            <circle cx="50%" cy="50%" r="0.9%" fill="${L}"/>
            <!-- منطقة الجزاء العلوية -->
            <rect x="${bx}%" y="3%" width="${opt.boxW}%" height="${opt.boxH}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
            <rect x="${sx}%" y="3%" width="${opt.sixW}%" height="${opt.sixH}%" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
            ${spot ? `<circle cx="50%" cy="${penTop}%" r="0.7%" fill="${L}"/>` : ''}
            ${opt.arcs ? `<path d="M ${bx+ (opt.boxW*0.28)} ${3+opt.boxH} A ${opt.centerR} ${opt.centerR} 0 0 0 ${bx+(opt.boxW*0.72)} ${3+opt.boxH}" stroke="${Lf}" stroke-width="${sw}" fill="none" transform="scale(1)"/>` : ''}
            <!-- منطقة الجزاء السفلية -->
            <rect x="${bx}%" y="${97-opt.boxH}%" width="${opt.boxW}%" height="${opt.boxH}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
            <rect x="${sx}%" y="${97-opt.sixH}%" width="${opt.sixW}%" height="${opt.sixH}%" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
            ${spot ? `<circle cx="50%" cy="${penBot}%" r="0.7%" fill="${L}"/>` : ''}
            <!-- زوايا الملعب -->
            <path d="M5 5 A2 2 0 0 1 7 3" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
            <path d="M93 3 A2 2 0 0 1 95 5" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
            <path d="M5 95 A2 2 0 0 0 7 97" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
            <path d="M93 97 A2 2 0 0 0 95 95" stroke="${Lf}" stroke-width="${sw}" fill="none"/>`;
        };
        const _VPitchSVG = {
          futsal: _vpDefs(8)  + _vpLines({ boxW:48, boxH:16, sixW:24, sixH:7,  centerR:12, spot:0,  arcs:false }),
          seven:  _vpDefs(10) + _vpLines({ boxW:60, boxH:18, sixW:30, sixH:8,  centerR:13, spot:9,  arcs:false }),
          full:   _vpDefs(12) + _vpLines({ boxW:56, boxH:16, sixW:28, sixH:7,  centerR:14, spot:9,  arcs:false }),
        };

        // ══ نفس منطق DD_CONFIGS — pitchType حسب عدد اللاعبين الأساسيين ══
        function _vpPitchType(n) {
          // نفس DD_CONFIGS في admin-lineup-dragdrop.js
          if (n <= 6)  return 'futsal';  // 5,6
          if (n <= 9)  return 'seven';   // 7,8,9
          return 'full';                 // 10,11
        }
        function _vpPitchLabel(n) {
          if (n <= 6)  return `🔵 فوتسال (${n} لاعبين)`;
          if (n <= 9)  return `🟢 سباعي (${n} لاعبين)`;
          return `🟡 ملعب كامل (${n} لاعبين)`;
        }

        // ══ رسم الملعب مع اللاعبين بمواضعهم ══
function renderPitchViewer(lineup, isAway) {
           if (!lineup || !lineup.players || !lineup.players.length) {
             return `<div style="text-align:center;padding:36px 20px;color:var(--t3);font-size:12px">
               <div style="font-size:36px;margin-bottom:8px;opacity:.3">👥</div>
               لم يتم إدخال التشكيلة بعد
             </div>`;
           }
           // ── الحصول على عدد اللاعبين من البيانات المخزنة أو حسابه ──
           const starters = lineup.players.filter(p => !p.isSub);
           const subs     = lineup.players.filter(p =>  p.isSub);
           const n        = lineup.playerCount || starters.length;
          const pType    = _vpPitchType(n);
          const svg      = _VPitchSVG[pType];
          const formation= lineup.formation || '';
          const brdClr   = isAway ? '#C0392B' : '#C9A02B';
          const bgClr    = isAway ? 'rgba(192,57,43,.18)'   : 'rgba(201,160,43,.15)';
          const txtClr   = isAway ? '#ff8080'               : '#C9A02B';

          // ══ نقاط اللاعبين — تصميم احترافي بمنظور ثلاثي الأبعاد ══
          const _gkGrad = 'linear-gradient(145deg,#a86bd6,#7b3fb0)';
          const _homeGrad = 'linear-gradient(145deg,#e6c157,#b8860b)';
          const _awayGrad = 'linear-gradient(145deg,#e5645a,#a52a1e)';
          // حجم الأفاتار يتكيّف مع عدد اللاعبين (أقل لاعبين = أكبر وأوضح)
          const _avSize = n <= 6 ? 62 : n <= 8 ? 56 : n <= 9 ? 52 : 46;
          const _nameFS = n <= 6 ? 11 : n <= 9 ? 10 : 9;
          const _numFS  = n <= 6 ? 12 : 10.5;
          const _numSz  = n <= 6 ? 22 : n <= 9 ? 20 : 18;
          // تحويل المنظور: y الأصلي (0=أعلى/هجوم، 100=أسفل/حارس) →
          //   نضغط الأعلى (أبعد) قليلاً ونعطي الأسفل مساحة أكبر (أقرب) = إحساس الأرض المائلة.
          //   كذلك اللاعب الأبعد (y صغير) يصغر قليلاً لتعزيز العمق.
          const _persp = (y) => {
            const t = y / 100;                         // 0..1
            // منحنى بسيط: الأعلى يقترب من 7%، الأسفل يمتد إلى 95%
            const yy = 7 + Math.pow(t, 0.94) * 88;
            const scale = 0.88 + t * 0.22;             // 0.88 (أبعد) → 1.10 (أقرب)
            return { yy, scale };
          };
          // 🌟 رجل المباراة — يُحسب مرة واحدة (اختيار يدوي أو استنتاج تلقائي)
          //    ويُميَّز على اللاعب نفسه في التشكيلة بشارة نجمة ذهبية.
          const _motm = (typeof _resolveMOTM === 'function') ? _resolveMOTM(m) : null;
          const _isMOTM = (p) => {
            if (!_motm || !_motm.name) return false;
            if (_motm.playerId && p.id) return _motm.playerId === p.id;
            return _normName(_motm.name) === _normName(p.name || '');
          };
          const dots = starters.map((p, i) => {
            const x   = p.x ?? 50;
            const y   = p.y ?? 50;
            const { yy, scale } = _persp(y);
            const isGK= i === 0 || p.position === 'GK';
            const num = p.number || (i + 1);
            const teamIdForPhoto = isAway ? m.awayId : m.homeId;
            // ✅ اسم حيّ من الكشف بالهوية (يتبع تعديل الاسم فوراً)، وإلا المخزّن
            const _liveNm = (typeof _pName === 'function' && p.id) ? _pName(teamIdForPhoto, p.id, p.name) : (p.name || '');
            const shortName = (_liveNm || '').split(' ').slice(-1)[0] || `${i+1}`;
            const ringGrad = isGK ? _gkGrad : (isAway ? _awayGrad : _homeGrad);
            const aTxt = isGK ? '#CE9FFC' : (isAway ? '#ff9a90' : '#e6c157');
            const cap  = lineup.captain && p.name && (p.name === lineup.captain || (p.id && p.id === lineup.captainId));
            const isMOTM = _isMOTM(p);
            const side = isAway ? 'away' : 'home';
            const badges = window._playerMatchBadges ? window._playerMatchBadges(m.events, side, p.name, num) : '';
            const _photo = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, teamIdForPhoto) : '';
            const _silhouette = (window._playerSilhouetteSVG ? `<span style="display:block;width:66%;height:66%;color:${aTxt};opacity:.92">${window._playerSilhouetteSVG()}</span>` : num);
            // القرص الداخلي: صورة أو ظلّ اللاعب داخل خلفية داكنة نظيفة
            const inner = _photo
              ? `<img src="${_photo}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
              : `<div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 32%,#22304e,#0d1526);display:flex;align-items:center;justify-content:center">${_silhouette}</div>`;
            const _safeNm = (_liveNm||'').replace(/'/g,"\\'");
            return `<div onclick="window.openPlayerModal && openPlayerModal('${_safeNm}','${teamIdForPhoto||''}','${p.id||''}')"
                style="position:absolute;left:${x}%;top:${yy}%;cursor:pointer;
                transform:translate(-50%,-50%) scale(${scale.toFixed(3)});
                display:flex;flex-direction:column;
                align-items:center;gap:4px;z-index:${Math.round(y)+5}">
              <div style="position:relative;width:${_avSize}px;height:${_avSize}px;border-radius:50%;
                background:${isMOTM ? 'linear-gradient(145deg,#e6c157,#b8860b)' : ringGrad};padding:2.5px;
                box-shadow:0 5px 14px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.25)${isMOTM ? ',0 0 0 3px rgba(201,160,43,.35),0 0 16px rgba(230,193,87,.5)' : ''};">
                <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:#0d1526">${inner}</div>
                <span style="position:absolute;bottom:-4px;right:-4px;background:${ringGrad};color:#1a1200;
                  font-size:${_numFS}px;font-weight:900;border-radius:999px;min-width:${_numSz}px;height:${_numSz}px;
                  display:flex;align-items:center;justify-content:center;padding:0 3px;
                  border:2.5px solid #1f7231;box-shadow:0 2px 4px rgba(0,0,0,.5)">${num}</span>
                ${cap ? `<span style="position:absolute;top:-5px;left:-5px;background:#111;color:#e6c157;font-size:9px;font-weight:900;border-radius:999px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:2px solid #e6c157">C</span>` : ''}
                ${isMOTM ? `<span title="نجم المباراة" style="position:absolute;top:-7px;right:-7px;background:linear-gradient(145deg,#e6c157,#b8860b);border-radius:999px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:2px solid #1f7231;box-shadow:0 2px 5px rgba(0,0,0,.5);font-size:11px;line-height:1">★</span>` : ''}
                ${badges}
              </div>
              <div style="font-size:${_nameFS}px;font-weight:800;color:#fff;letter-spacing:.2px;
                background:linear-gradient(180deg,rgba(8,16,8,.86),rgba(8,16,8,.94));
                border:1px solid rgba(255,255,255,.1);
                border-radius:6px;padding:2px 9px;white-space:nowrap;max-width:88px;
                overflow:hidden;text-overflow:ellipsis;text-align:center;
                box-shadow:0 2px 6px rgba(0,0,0,.45)">
                ${shortName}
              </div>
            </div>`;
          }).join('');

          // البدلاء — تظهر فقط إذا فعّلها المنظّم (showBench)
          const _benchAllowed = lineup.showBench !== false;
          const _benchTeamId = isAway ? m.awayId : m.homeId;
          const _benchRing = isAway ? 'linear-gradient(145deg,#e5645a,#a52a1e)' : 'linear-gradient(145deg,#e6c157,#b8860b)';
          const subsHtml = (_benchAllowed && subs.length) ? `
            <div style="margin-top:10px;background:linear-gradient(180deg,var(--s2),var(--s1));border:1px solid var(--b2);
              border-radius:14px;padding:12px">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">
                <span style="width:5px;height:14px;border-radius:3px;background:${isAway?'#C0392B':'var(--gold)'}"></span>
                <span style="font-size:11px;font-weight:900;color:var(--t1);letter-spacing:.5px">مقاعد البدلاء</span>
                <span style="background:${isAway?'rgba(192,57,43,.14)':'rgba(201,160,43,.14)'};color:${isAway?'#e5645a':'var(--gold)'};font-size:10px;font-weight:900;border-radius:999px;padding:1px 8px">${subs.length}</span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              ${subs.map(p => {
                const _bLiveNm = (typeof _pName === 'function' && p.id) ? _pName(_benchTeamId, p.id, p.name) : (p.name || '');
                const _sBadges = window._playerMatchBadges ? window._playerMatchBadges(m.events, isAway?'away':'home', p.name, p.number) : '';
                const _bPhoto = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, _benchTeamId) : '';
                const _safeBNm = (_bLiveNm||'').replace(/'/g,"\\'");
                const _bAvatar = _bPhoto
                  ? `<img src="${_bPhoto}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
                  : `<div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#1c2740,#0d1526);display:flex;align-items:center;justify-content:center;color:var(--t3)">${window._playerSilhouetteSVG ? `<span style="display:block;width:60%;height:60%">${window._playerSilhouetteSVG()}</span>` : (p.number||'—')}</div>`;
                return `
                <div onclick="window.openPlayerModal && openPlayerModal('${_safeBNm}','${_benchTeamId||''}','${p.id||''}')"
                  style="display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;
                  background:var(--s2);border:1px solid var(--b1);border-radius:12px;padding:10px 4px;text-align:center;transition:.15s">
                  <div style="position:relative;width:44px;height:44px;border-radius:50%;background:${_benchRing};padding:2px;box-shadow:0 2px 6px rgba(0,0,0,.4)">
                    <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:#0d1526">${_bAvatar}</div>
                    <span style="position:absolute;bottom:-2px;right:-2px;background:${_benchRing};color:#1a1200;font-size:8.5px;font-weight:900;border-radius:999px;min-width:15px;height:15px;display:flex;align-items:center;justify-content:center;padding:0 2px;border:1.5px solid var(--s2)">${p.number||'—'}</span>
                    ${_sBadges}
                  </div>
                  <div style="font-size:10.5px;font-weight:700;color:var(--t1);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(_bLiveNm||'—').split(' ').slice(0,2).join(' ')}</div>
                  ${p.status==='injured'   ? `<span style="font-size:8px;color:#C0392B;background:rgba(192,57,43,.1);border-radius:4px;padding:1px 5px">🤕 مصاب</span>` : ''}
                  ${p.status==='suspended' ? `<span style="font-size:8px;color:#C9A02B;background:rgba(201,160,43,.1);border-radius:4px;padding:1px 5px">🟨 موقوف</span>` : ''}
                  ${p.status==='absent'    ? `<span style="font-size:8px;color:#888;background:rgba(0,0,0,.2);border-radius:4px;padding:1px 5px">❌ غائب</span>` : ''}
                </div>`;}).join('')}
              </div>
            </div>` : '';

          // ── قسم التبديلات (من أحداث المباراة) ──
          const _subsSide = isAway ? 'away' : 'home';
          const _subsTeamId = isAway ? m.awayId : m.homeId;
          const _matchSubs = (typeof _teamSubs === 'function') ? _teamSubs(m, _subsSide) : [];
          const _subAvatar = (name) => {
            const ph = (typeof _lineupPhoto === 'function' && name) ? _lineupPhoto({ name }, _subsTeamId) : '';
            return ph
              ? `<span style="display:inline-block;width:20px;height:20px;border-radius:50%;overflow:hidden;flex-shrink:0;vertical-align:middle;margin-left:4px"><img src="${ph}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></span>`
              : '';
          };
          const subsSection = _matchSubs.length ? `
            <div style="margin-top:10px;background:var(--s2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:11px;font-weight:900;color:var(--t1)">🔄 التبديلات</span>
                <span style="background:var(--gold);color:#000;font-size:10px;font-weight:900;border-radius:999px;padding:1px 8px">${_matchSubs.length}</span>
              </div>
              ${_matchSubs.map(s => `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--b1)">
                  <span style="min-width:32px;font-size:12px;font-weight:900;color:var(--gold)">${s.min!==''?s.min+"'":''}</span>
                  <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
                    <span style="font-size:12.5px;font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_subAvatar(s.in)}<span style="color:#27ae60;font-weight:900">${window.Icon?window.Icon('upload',11):'▲'}</span> ${s.in||'—'}</span>
                    <span style="font-size:12px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_subAvatar(s.out)}<span style="color:#e5533d;font-weight:900">${window.Icon?window.Icon('download',11):'▼'}</span> ${s.out||'—'}</span>
                  </div>
                </div>`).join('')}
            </div>` : '';

          return `
            <div style="background:var(--s2);border:1px solid var(--b2);border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.35)">
              <!-- شريط أعلى الملعب -->
              <div style="display:flex;align-items:center;justify-content:space-between;
                padding:11px 14px;background:linear-gradient(180deg,var(--s1),var(--s2));border-bottom:1px solid var(--b1)">
                <div style="display:flex;align-items:center;gap:7px">
                  <span style="width:5px;height:15px;border-radius:3px;background:${isAway?'#C0392B':'var(--gold)'}"></span>
                  <span style="font-size:11px;font-weight:800;color:var(--t2)">${_vpPitchLabel(n)}</span>
                </div>
                ${formation ? `<div style="font-size:12.5px;font-weight:900;letter-spacing:1px;
                  color:${isAway?'#ff9a90':'#e6c157'};
                  background:${isAway?'rgba(192,57,43,.14)':'rgba(201,160,43,.12)'};
                  border:1px solid ${isAway?'rgba(192,57,43,.35)':'rgba(201,160,43,.3)'};
                  border-radius:8px;padding:3px 12px">${formation}</div>` : ''}
              </div>
              <!-- الملعب — منظور ثلاثي الأبعاد (الأرض مائلة، اللاعبون منتصبون) -->
              <div style="position:relative;width:100%;aspect-ratio:10/13;
                max-height:480px;overflow:hidden;background:#1f7231;
                perspective:820px;perspective-origin:50% 42%">
                <!-- طبقة الأرض المائلة: تبدأ قريبة من الحارس (أسفل) وتبتعد نحو الهجوم (أعلى) -->
                <div style="position:absolute;inset:-2% -5% -2% -5%;
                  transform:rotateX(26deg) scale(1.015);transform-origin:50% 100%;
                  border-radius:6px;overflow:hidden;
                  box-shadow:inset 0 0 70px rgba(0,0,0,.22)">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                    style="position:absolute;inset:0;width:100%;height:100%">
                    ${svg}
                  </svg>
                </div>
                <!-- تعتيم علوي خفيف يعزّز إحساس البُعد في جهة الهجوم -->
                <div style="position:absolute;inset:0;pointer-events:none;
                  background:linear-gradient(180deg,rgba(0,0,0,.14),transparent 28%,transparent 86%,rgba(0,0,0,.08))"></div>
                <!-- إضاءة علوية ناعمة -->
                <div style="position:absolute;inset:0;pointer-events:none;
                  background:radial-gradient(ellipse at 50% 8%,rgba(255,255,255,.10),transparent 55%)"></div>
                <!-- طبقة اللاعبين (منتصبون فوق الأرض المائلة) -->
                <div style="position:absolute;inset:0">
                  ${dots}
                </div>
              </div>
            </div>
            ${subsSection}
            ${subsHtml}`;
        }

        // ══ التبويبان: مضيف / ضيف ══
        const _uid = matchId + '-vlu';
        const hasHL = hl && hl.players && hl.players.filter(p=>!p.isSub).length > 0;
        const hasAL = al && al.players && al.players.filter(p=>!p.isSub).length > 0;

        if (!hasHL && !hasAL) {
          return `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
            <div style="font-size:40px;margin-bottom:10px;opacity:.3">👥</div>
            <div style="font-size:13px">لم يتم إدخال أي تشكيلة بعد</div>
            <div style="font-size:11px;margin-top:6px;color:var(--t3)">ينتظر إدخال التشكيلتين من لوحة التحكم</div>
          </div>`;
        }

        return `
          <div style="display:flex;gap:6px;margin-bottom:12px">
            <button onclick="(function(btn){
              document.getElementById('vlu-home-${_uid}').style.display='block';
              document.getElementById('vlu-away-${_uid}').style.display='none';
              btn.style.background='rgba(201,160,43,.12)';btn.style.color='var(--gold)';btn.style.borderColor='rgba(201,160,43,.3)';
              var ab=document.getElementById('vlu-btn-away-${_uid}');
              ab.style.background='var(--s2)';ab.style.color='var(--t3)';ab.style.borderColor='var(--b2)';
            })(this)" id="vlu-btn-home-${_uid}"
              style="flex:1;padding:9px 6px;border-radius:10px;
              border:1px solid rgba(201,160,43,.3);
              background:rgba(201,160,43,.12);color:var(--gold);
              font-size:11px;font-weight:800;font-family:Tajawal,sans-serif;cursor:pointer">
              ${ht.name} ${hasHL ? '' : '(لم تُدخَل)'}
            </button>
            <button onclick="(function(btn){
              document.getElementById('vlu-home-${_uid}').style.display='none';
              document.getElementById('vlu-away-${_uid}').style.display='block';
              btn.style.background='rgba(192,57,43,.1)';btn.style.color='#C0392B';btn.style.borderColor='rgba(192,57,43,.3)';
              var hb=document.getElementById('vlu-btn-home-${_uid}');
              hb.style.background='var(--s2)';hb.style.color='var(--t3)';hb.style.borderColor='var(--b2)';
            })(this)" id="vlu-btn-away-${_uid}"
              style="flex:1;padding:9px 6px;border-radius:10px;
              border:1px solid var(--b2);
              background:var(--s2);color:var(--t3);
              font-size:11px;font-weight:800;font-family:Tajawal,sans-serif;cursor:pointer">
              ${at.name} ${hasAL ? '' : '(لم تُدخَل)'}
            </button>
          </div>
          <div id="vlu-home-${_uid}">${renderPitchViewer(hl, false)}</div>
          <div id="vlu-away-${_uid}" style="display:none">${renderPitchViewer(al, true)}</div>`;
      }

      // ══ المواجهات السابقة ══
      if (tabId === 'h2h') {
        const allMatches = window.matches || [];
        const h2hMatches = allMatches.filter(x =>
          x.status === 'finished' && x.id !== m.id &&
          ((x.homeId === m.homeId && x.awayId === m.awayId) ||
           (x.homeId === m.awayId && x.awayId === m.homeId))
        ).sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 10);

        if (!h2hMatches.length) return `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
          <div style="font-size:40px;margin-bottom:10px;opacity:.3">🤝</div>
          <div style="font-size:13px">لا توجد مواجهات سابقة</div>
          <div style="font-size:11px;margin-top:6px">أول مباراة بين هذين الفريقين</div>
        </div>`;

        // إحصائيات المواجهات
        let hw = 0, aw = 0, dr = 0;
        h2hMatches.forEach(x => {
          const flipped = x.homeId === m.awayId;
          const hG = flipped ? (x.awayScore||0) : (x.homeScore||0);
          const aG = flipped ? (x.homeScore||0) : (x.awayScore||0);
          if (hG > aG) hw++; else if (aG > hG) aw++; else dr++;
        });
        const tot = hw + aw + dr;

        const summary = `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;text-align:center">
            <div style="background:rgba(201,160,43,.08);border:1px solid rgba(201,160,43,.2);border-radius:10px;padding:10px">
              <div style="font-size:22px;font-weight:900;color:var(--gold);font-family:Tajawal,sans-serif">${hw}</div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px">فوز ${ht.name}</div>
            </div>
            <div style="background:var(--s2);border:1px solid var(--b2);border-radius:10px;padding:10px">
              <div style="font-size:22px;font-weight:900;color:var(--t2);font-family:Tajawal,sans-serif">${dr}</div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px">تعادل</div>
            </div>
            <div style="background:rgba(192,57,43,.06);border:1px solid rgba(192,57,43,.18);border-radius:10px;padding:10px">
              <div style="font-size:22px;font-weight:900;color:var(--live);font-family:Tajawal,sans-serif">${aw}</div>
              <div style="font-size:10px;color:var(--t3);margin-top:2px">فوز ${at.name}</div>
            </div>
          </div>`;

        const rows = h2hMatches.map(x => {
          const flipped = x.homeId === m.awayId;
          const hG = flipped ? (x.awayScore||0) : (x.homeScore||0);
          const aG = flipped ? (x.homeScore||0) : (x.awayScore||0);
          const winner = hG > aG ? 'home' : aG > hG ? 'away' : 'draw';
          const clr = winner === 'draw' ? 'var(--t3)' : winner === 'home' ? 'var(--gold)' : 'var(--live)';
          return `<div onclick="openMatchDetail('${x.id}')" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--s1);border-radius:10px;margin-bottom:6px;cursor:pointer">
            <div style="flex:1;font-size:12px;font-weight:700;color:var(--t1);text-align:center">${ht.name}</div>
            <div style="text-align:center;min-width:60px">
              <div style="font-size:17px;font-weight:900;color:${clr};font-family:Tajawal,sans-serif">${hG} - ${aG}</div>
              <div style="font-size:9px;color:var(--t3)">${x.date||''}</div>
            </div>
            <div style="flex:1;font-size:12px;font-weight:700;color:var(--t1);text-align:center">${at.name}</div>
          </div>`;
        }).join('');

        return summary + rows;
      }

      return '';
    } // end buildTabContent

    // ── لوحة معلومات المباراة — تظهر تلقائياً فقط للمباريات القادمة ──
    // (زر "المعلومات" أُلغي؛ عند القادمة تُعرض هنا كل التفاصيل مرتّبة)
    function buildInfoPanel() {
      const rows = [
        { ic:'stadium',   label:'الملعب',          val: m.venue },
        { ic:'calendar',  label:'الجولة',          val: m.round ? `الجولة ${m.round}` : null },
        { ic:'whistle',   label:'الحكم',            val: m.referee },
        { ic:'mic',       label:'المعلق',           val: m.commentator },
        { ic:'flag',      label:'حكم مساعد 1',     val: m.linesman1 },
        { ic:'flag',      label:'حكم مساعد 2',     val: m.linesman2 },
        { ic:'users',     label:'السعة المتوقعة',  val: m.attendance },
        { ic:'camera',    label:'المصور',           val: m.photographer },
        { ic:'mic',       label:'المذيع',           val: m.announcer },
        { ic:'handshake', label:'الراعي',           val: m.sponsor },
        { ic:'edit',      label:'ملاحظات',          val: m.notes },
      ].filter(r => r.val);

      if (!rows.length) return '';

      return `<div class="mi-panel">
        <div class="mi-panel-title">${window.Icon ? window.Icon('info', 15) : ''}<span>تفاصيل المباراة</span></div>
        <div class="mi-rows">
          ${rows.map(r => `
            <div class="mi-row">
              <span class="mi-ic">${window.Icon ? window.Icon(r.ic, 16) : ''}</span>
              <span class="mi-label">${r.label}</span>
              <span class="mi-val">${r.val}</span>
            </div>`).join('')}
        </div>
      </div>`;
    }

    // ── هيدر المباراة — موحّد لكل الحالات ──
    let headerHtml = '';
    {
      const ph = d && d.matchStatus;
      const isPen = ph === 'penalties';
      const isHT  = ph === 'halftime' || ph === 'halftime_et';
      const statusLabel = isPen ? 'ركلات الترجيح' : isHT ? 'استراحة' : 'مباشر';

      let midHtml;
      if (isL) {
        midHtml = `
          <div class="mdh-period">${_periodLabel(d)}</div>
          <div class="mdh-score">${d?.homeScore ?? 0}<span class="mdh-sep">:</span>${d?.awayScore ?? 0}</div>
          <div class="mdh-clock" id="md-timer-${m.id}">${_clock(d)}</div>`;
      } else if (isF) {
        const hw = (m.homeScore || 0) > (m.awayScore || 0);
        const aw = (m.awayScore || 0) > (m.homeScore || 0);
        midHtml = `
          <div class="mdh-score">
            <span class="${hw ? 'mdh-win' : ''}">${m.homeScore ?? 0}</span>
            <span class="mdh-sep">:</span>
            <span class="${aw ? 'mdh-win' : ''}">${m.awayScore ?? 0}</span>
          </div>
          <div class="mdh-note">انتهت</div>`;
      } else {
        midHtml = `
          <div class="mdh-time">${m.time ? formatTimeTo12H(m.time) : 'VS'}</div>
          ${m.date ? `<div class="mdh-note">${m.date}</div>` : ''}`;
      }

      headerHtml = `
      <div class="mdh ${isL ? 'mdh-live' : ''}">
        ${isL ? `<div class="mdh-top">
          <span class="mdh-tag"><span class="mc-live-dot"></span>${statusLabel}</span>
        </div>` : ''}
        <div class="mdh-grid">
          <div class="mdh-team">
            <div class="mdh-logo">${_logo(ht.logo, 42)}</div>
            <div class="mdh-name">${ht.name}</div>
          </div>
          <div class="mdh-mid">${midHtml}</div>
          <div class="mdh-team">
            <div class="mdh-logo">${_logo(at.logo, 42)}</div>
            <div class="mdh-name">${at.name}</div>
          </div>
        </div>
        <div class="mdh-share">
          <button class="mdh-sh-btn mdh-sh-card" onclick="window.shareMatchCard && window.shareMatchCard('${m.id}')">
            <span class="ic-inline">${window.Icon ? window.Icon('share', 15) : ''}</span>
            مشاركة بطاقة المباراة
          </button>
        </div>
      </div>`;
    }

    // ── شريط التبويبات (أفقي قابل للتمرير) ──
    let tabsHtml = '';
    if (tabs.length > 1) {
      tabsHtml = `<div class="md-tabs" id="md-tabs-bar-${matchId}">${tabs.map((t) => {
        const isActive = t.id === activeTab;
        return `<button class="md-tab${isActive?' on':''}" id="md-tab-${t.id}-${matchId}"
          onclick="window._mdSwitchTab('${t.id}','${matchId}')">${t.label}</button>`;
      }).join('')}</div>`;
    }

    // ── محتوى التبويبات ──
    let contentHtml = '';
    tabs.forEach((t) => {
      const isVisible = t.id === activeTab;
      contentHtml += `<div id="md-content-${t.id}-${matchId}" style="display:${isVisible?'block':'none'}">${buildTabContent(t.id)}</div>`;
    });

    // ── تجميع HTML ──
    // ✅︎ badge اسم المرحلة لمباريات الشجرة
    const knockoutBadgeHtml = m.isKnockout && m.knockoutRoundName
      ? `<div style="text-align:center;margin-bottom:10px">
           <span style="font-size:11px;font-weight:800;color:#9b59b6;background:rgba(155,89,182,.1);border:1px solid rgba(155,89,182,.25);border-radius:20px;padding:4px 14px">
             🏆 ${m.knockoutRoundName}
           </span>
         </div>`
      : '';
    // ✅︎ بطاقة الراعي — راعي المباراة يتقدّم على راعي البطولة
    const _spHtml = (typeof window._spMatchHTML === 'function') ? window._spMatchHTML(m) : '';
    // 🎥 بث فيديو مضمّن — يظهر فقط إن وُجد رابط (قبل/أثناء/بعد). بلا عدّاد ولا بوابة.
    const _videoHtml = _buildVideoEmbed(m);
    body.innerHTML = knockoutBadgeHtml + headerHtml + _videoHtml + _spHtml + tabsHtml + contentHtml;

    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    // تبديل التبويبات
    window._mdSwitchTab = function(tabId, mid) {
      tabs.forEach(t => {
        const tabBtn = document.getElementById('md-tab-' + t.id + '-' + mid);
        const content = document.getElementById('md-content-' + t.id + '-' + mid);
        if (tabBtn && content) {
          if (t.id === tabId) {
            tabBtn.style.color = 'var(--gold)';
            tabBtn.style.borderBottomColor = 'var(--gold)';
            content.style.display = 'block';
            // مرر للتبويب ليظهر في المنتصف
            tabBtn.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});
          } else {
            tabBtn.style.color = 'var(--t3)';
            tabBtn.style.borderBottomColor = 'transparent';
            content.style.display = 'none';
          }
        }
      });
    };

    // تحديث العداد للمباريات المباشرة
    if (isL && d) {
      _startDetailClock2(matchId);
    }
  };
})();


/* ✅︎ تصدير لـ matches-tabs.js — هذه الدوال module-scoped فلا تراها
   الملفات الأخرى. renderMatches تُستبدَل، والاثنتان الأخريان تُستدعيان. */
/* ✅︎ تصدير — match-share-card.js و matches-tabs.js تقرأ هذه.
   بلا التصدير ترجع undefined صامتة (نفس فخ OVERRIDES.md).
   نُحدّثها مع كل snapshot عبر _syncGlobals(). */
window.LEAGUE_ID = LEAGUE_ID;
window.formatTimeTo12H = formatTimeTo12H;
function _syncGlobals() {
  /* ✅︎ matches/teams عندها getter بس (Object.defineProperty فوق بالملف) —
     محاولة الكتابة فيها هنا كانت تطلع TypeError فورية (وضع الموديول صارم)،
     فتنهار renderAll() بأول سطر ولا يشتغل أي تحديث بعدها إطلاقاً —
     هذا كان السبب الحقيقي لعدم ظهور المباريات للجمهور. الاثنان أصلاً
     يتحدّثان تلقائياً عبر الـ getter، فلا حاجة لإعادة كتابتهما هنا. */
  window.league  = league;
  window.settings = settings;
}
window._syncGlobals = _syncGlobals;

window.renderMatches    = renderMatches;
window._matchCard       = _matchCard;
window._startCard2Clock = _startCard2Clock;

// ── عداد صفحة التفاصيل ──────────────────────────────────────────
const _detailClocks = {};

/* ✅︎ FIX 10 — إعادة رسم فورية لكل الساعات.
   المتصفح يخنق setInterval في التبويب الخلفي فتظهر فجوة عند العودة.
   يستدعيها clock-sync.js عند visibilitychange/pageshow. الساعة تُحسب
   من الطابع الزمني، فتصحّح نفسها لحظة الرسم. */
window._clockRepaint = function () {
  const list = window.matches || [];
  list.forEach(m => {
    if (!m || !m.liveData) return;
    const html = _clock(m.liveData);
    ['mc2-clock-', 'lt-clock2-', 'md-timer-'].forEach(pfx => {
      const el = document.getElementById(pfx + m.id);
      if (el) el.innerHTML = html;
    });
  });
};

function _startDetailClock2(matchId) {
  clearInterval(_detailClocks[matchId]);
  _detailClocks[matchId] = setInterval(() => {
    const clockEl = document.getElementById('md-timer-' + matchId);
    const vEl     = document.getElementById('md-vtimer-' + matchId); // مؤقّت شريط الفيديو
    if (!clockEl && !vEl) { clearInterval(_detailClocks[matchId]); return; }
    const m = (window.matches||[]).find(x => x.id === matchId);
    if (m && m.liveData) {
      const txt = _clock(m.liveData);
      if (clockEl) clockEl.innerHTML = txt;
      if (vEl) vEl.innerHTML = txt;
      // تحديث نتيجة شريط الفيديو لحظياً
      const sh = document.getElementById('md-vsh-' + matchId);
      const sa = document.getElementById('md-vsa-' + matchId);
      if (sh) sh.textContent = m.liveData.homeScore ?? 0;
      if (sa) sa.textContent = m.liveData.awayScore ?? 0;
    }
  }, 500);
}

// ── إخفاء homeLiveSection القديم إن وُجد ────────────────────────
(function() {
  const old = document.getElementById('homeLiveSection');
  if (old) old.style.display = 'none';
  const banner = document.getElementById('smartBanner');
  if (banner) banner.style.display = 'none';
})();

// ── كشف الدوال الداخلية على window للاستخدام الخارجي ────────────
window._tsMs              = _tsMs;
window._clock             = _clock;
window._secs              = _secs;
window._calcMatchSecs     = _calcMatchSecs;
window._startDetailClock2 = _startDetailClock2;
window._buildUnifiedStatsHtml = _buildUnifiedStatsHtml;

// console.log('[VIEWER V3] ✅︎ النظام الموحّد النهائي — بدون بنرات أو تكرار');
