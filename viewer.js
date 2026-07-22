// ═══════════════════════════════════════════════════════
//  منصة البطولات — viewer.js
//  نسخة محسّنة: تفاصيل المباراة + تشكيلات ديناميكية Firebase
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, getDoc, onSnapshot, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
/* ✅ أداء: analytics و messaging كانا يُستوردان ثابتاً (~90KB) فيؤخّران
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
const db  = getFirestore(app);
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

let settings = { winPts:3, drawPts:1, zones:{ champion:1, qualify:2, cond:1, normal:0, playoff:1, relegate:1 }, bracketPublished: false, tiebreakOrder: ['h2h','gd','gf','draw'] };
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
const ZONE_NAMES  = ['المتوج 🏆','متأهل ✅','مشروط 🔵','عادي ⚪','ملعب الهبوط 🟠','هابط 🔴'];

// تشكيلات ثابتة لـ 11 لاعب
const FORMATION_POSITIONS = {
  '4-3-3':   [
    {x:50,y:88,pos:'GK'},
    {x:16,y:72,pos:'LB'},{x:36,y:70,pos:'CB'},{x:64,y:70,pos:'CB'},{x:84,y:72,pos:'RB'},
    {x:25,y:55,pos:'CM'},{x:50,y:53,pos:'CM'},{x:75,y:55,pos:'CM'},
    {x:20,y:30,pos:'LW'},{x:50,y:28,pos:'ST'},{x:80,y:30,pos:'RW'},
  ],
  '4-4-2':   [
    {x:50,y:88,pos:'GK'},
    {x:16,y:72,pos:'LB'},{x:36,y:70,pos:'CB'},{x:64,y:70,pos:'CB'},{x:84,y:72,pos:'RB'},
    {x:16,y:52,pos:'LM'},{x:36,y:52,pos:'CM'},{x:64,y:52,pos:'CM'},{x:84,y:52,pos:'RM'},
    {x:35,y:28,pos:'ST'},{x:65,y:28,pos:'ST'},
  ],
  '4-2-3-1': [
    {x:50,y:88,pos:'GK'},
    {x:16,y:72,pos:'LB'},{x:36,y:70,pos:'CB'},{x:64,y:70,pos:'CB'},{x:84,y:72,pos:'RB'},
    {x:35,y:58,pos:'DM'},{x:65,y:58,pos:'DM'},
    {x:16,y:42,pos:'LW'},{x:50,y:42,pos:'CAM'},{x:84,y:42,pos:'RW'},
    {x:50,y:25,pos:'ST'},
  ],
  '3-5-2':   [
    {x:50,y:88,pos:'GK'},
    {x:25,y:72,pos:'CB'},{x:50,y:70,pos:'CB'},{x:75,y:72,pos:'CB'},
    {x:10,y:52,pos:'LWB'},{x:30,y:52,pos:'CM'},{x:50,y:52,pos:'CM'},{x:70,y:52,pos:'CM'},{x:90,y:52,pos:'RWB'},
    {x:35,y:28,pos:'ST'},{x:65,y:28,pos:'ST'},
  ],
  '5-3-2':   [
    {x:50,y:88,pos:'GK'},
    {x:10,y:72,pos:'LWB'},{x:28,y:70,pos:'CB'},{x:50,y:68,pos:'CB'},{x:72,y:70,pos:'CB'},{x:90,y:72,pos:'RWB'},
    {x:25,y:50,pos:'CM'},{x:50,y:50,pos:'CM'},{x:75,y:50,pos:'CM'},
    {x:35,y:28,pos:'ST'},{x:65,y:28,pos:'ST'},
  ],
};

// ════════════════════════════════════════
//  توليد مواضع ديناميكية لأي عدد لاعبين
// ════════════════════════════════════════
function getDynamicPositions(playerCount) {
  // إذا في تشكيلة محددة، استخدمها
  if(playerCount === 11) return FORMATION_POSITIONS['4-3-3'];

  const positions = [];
  // حارس دائماً
  positions.push({x:50, y:90, pos:'GK'});

  const outfield = playerCount - 1;
  if(outfield <= 0) return positions;

  // توزيع تلقائي حسب عدد اللاعبين
  let rows;
  if(outfield <= 3)       rows = [outfield];           // صف واحد
  else if(outfield <= 5)  rows = [2, outfield-2];      // صفان
  else if(outfield <= 7)  rows = [2, 2, outfield-4];
  else if(outfield <= 9)  rows = [3, 3, outfield-6];
  else                    rows = [3, 3, outfield-6];

  const rowCount = rows.length;
  rows.forEach((count, rowIdx) => {
    const yPos = 75 - (rowIdx * (55 / rowCount));
    for(let i = 0; i < count; i++) {
      const xPos = count === 1 ? 50 : 15 + (i * (70 / (count-1)));
      const posLabel = rowIdx === rowCount-1 ? 'ST' : rowIdx === 0 ? 'CB' : 'CM';
      positions.push({x:xPos, y:yPos, pos:posLabel});
    }
  });
  return positions;
}

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
async function init() {
  if(!LEAGUE_ID) { showError('رابط غير صحيح'); return; }

  const [leagueDoc, settDoc] = await Promise.all([
    getDoc(doc(db,'leagues',LEAGUE_ID)),
    getDoc(doc(db,'leagues',LEAGUE_ID,'config','settings')),
  ]);

  if(!leagueDoc.exists()) { showError('البطولة غير موجودة'); return; }
  league = _sanitizeDoc({id: leagueDoc.id, ...leagueDoc.data()});

  // فور معرفة شعار البطولة: اعرضه في شاشة التحميل بدل أيقونة المنصة العامة
  if (league.logo) {
    const _pl = document.getElementById('plLogo');
    if (_pl) _pl.src = league.logo;
  }

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
    }
  }, ()=>{});

  let teamsLoaded = false, matchesLoaded = false;
  const checkHide = () => { if(teamsLoaded && matchesLoaded) hideLoader(); };

  onSnapshot(collection(db,'leagues',LEAGUE_ID,'teams'), snap => {
    teams = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()}));
    teamsLoaded = true; window.renderAll(); checkHide();
  }, () => { teamsLoaded = true; checkHide(); });

  onSnapshot(
    query(collection(db,'leagues',LEAGUE_ID,'matches'), orderBy('round'), orderBy('date')),
    snap => {
      matches = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()}));
      matches.sort((a,b)=>(a.round||0)-(b.round||0)||(a.date||'').localeCompare(b.date||''));
      matchesLoaded = true; window.renderAll(); checkHide();
    }, () => { matchesLoaded = true; checkHide(); }
  );

  onSnapshot(collection(db,'leagues',LEAGUE_ID,'groups'), snap => {
    groups = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if(tournamentType==='groups') window.renderAll();
  }, ()=>{});

  onSnapshot(collection(db,'leagues',LEAGUE_ID,'knockoutRounds'), snap => {
    knockoutRounds = snap.docs.map(d=>_sanitizeDoc({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    if(tournamentType==='knockout'||tournamentType==='groups') window.renderAll();
  }, ()=>{});

  // ✅ البث الجديد: يُقرأ من matches/{matchId}.liveData — لا يحتاج onSnapshot مستقل
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
  /* ✅ شعار البطولة فوق الاسم — مصدره إعدادات الإدارة (leagues/{id}.logo) */
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
  if(!logo) return `<span style="font-size:${size}px">⚽</span>`;
  if(logo.startsWith('data:')||logo.startsWith('http')||logo.startsWith('/')) {
    return `<img src="${logo}" style="width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:cover;display:inline-block;vertical-align:middle" onerror="this.style.display='none'"/>`;
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
  } else if(tournamentType==='groups') {
    renderGroupsStandings();
    renderKnockoutBracket();
    renderHomeGroups();
    // ✅ FIX §1: لا نعرض جدول الترتيب العام في نظام المجموعات
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
// ✅ تصدير — بدونه كان _origRA في الـpatch أدناه = undefined
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
  // ✅ يستقبل liveData الآن (وليس أرقاماً مفككة) — يمنع فقدان الإزاحة
  const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
  if (!c) return '00:00';
  // FIX 7: عند 45:00 بالضبط لا شارة بدل ضائع حتى تمرّ ثانية أو يُعلنها المنظّم
  if (!c.inStoppage || !c.showStoppage) return c.clock;
  // ✅ +5 فوق · الوقت الرسمي · العدّاد تحت
  // ✅ التنسيق: +5 و +2:14 جنب بعض في صف واحد فوق · 45:00 تحت
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
    // ✅ المرجع الوحيد: TimerCore — نفس ما تراه لوحة التحكم
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
function _buildViewerEmbed(url, platform) {
  try {
    if (!url) return '';
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (ytMatch) {
      return `<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;margin-bottom:8px">
        <iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=0" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>`;
    }
    // YouTube Live
    const ytLive = url.match(/youtube\.com\/live\/([\w-]{11})/);
    if (ytLive) {
      return `<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;margin-bottom:8px">
        <iframe src="https://www.youtube.com/embed/${ytLive[1]}?autoplay=0" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>`;
    }
    return ''; // fallback to link card
  } catch(e) { return ''; }
}

// ── كشف _buildViewerEmbed على window ────────────────────────────
window._buildViewerEmbed = _buildViewerEmbed;

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

let currentLineup = null;

window.openLineup = function(matchId) {
  const m=matches.find(x=>x.id===matchId);
  if(!m) return;
  const ht=teams.find(t=>t.id===m.homeId)||{name:m.homeName||'المضيف',logo:m.homeLogo||'⚽'};
  const at=teams.find(t=>t.id===m.awayId)||{name:m.awayName||'الضيف',logo:m.awayLogo||'⚽'};
  const overlay=document.getElementById('lineupOverlay');
  const titleEl=document.getElementById('lineupTitle');
  if(!overlay) return;
  if(titleEl) titleEl.textContent=ht.name+' × '+at.name;
  currentLineup={m,ht,at};

  const tabsEl=document.getElementById('lineupTabs');
  const hasBoth = (m.homeLineup?.players?.length||0)>0 && (m.awayLineup?.players?.length||0)>0;
  if(tabsEl) tabsEl.innerHTML=`
    <button class="lineup-team-tab active" onclick="showLineupTeam('home',this)">
      ${logoHtml(ht.logo,18,5)} ${ht.name}
    </button>
    <button class="lineup-team-tab" onclick="showLineupTeam('away',this)">
      ${at.name} ${logoHtml(at.logo,18,5)}
    </button>
    ${hasBoth?`<button class="lineup-team-tab" onclick="showLineupTeam('both',this)">⚡ المقارنة</button>`:''}`;

  showLineupTeam('home', tabsEl?.querySelector('.lineup-team-tab'));
  overlay.classList.add('show');
  document.body.style.overflow='hidden';
};

window.closeLineup = function() {
  document.getElementById('lineupOverlay')?.classList.remove('show');
  document.body.style.overflow='';
};

window.showLineupTeam = function(side, btn) {
  document.querySelectorAll('.lineup-team-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(!currentLineup) return;
  const {m, ht, at}=currentLineup;
  const contentEl=document.getElementById('lineupContent');
  if(!contentEl) return;

  // ══ وضع المقارنة بين الفريقين ══
  if(side==='both') {
    const hl=m.homeLineup, al=m.awayLineup;
    const hf=hl?.formation||'4-3-3', af=al?.formation||'4-3-3';
    const hp=hl?.players||[], ap=al?.players||[];
    const hpos=FORMATION_POSITIONS[hf]||getDynamicPositions(hp.length);
    const apos=FORMATION_POSITIONS[af]||getDynamicPositions(ap.length);
    contentEl.innerHTML=`
      <div class="lineup-both-wrap">
        <div class="lineup-both-col">
          <div class="lineup-both-title">${logoHtml(ht.logo,16,4)} ${ht.name} · <span>${hf}</span></div>
          <div class="pitch pitch-half">
            ${renderPitchLines(hp.length)}
            ${renderPlayersOnPitch(hp,hpos,false)}
          </div>
        </div>
        <div class="lineup-both-col">
          <div class="lineup-both-title">${logoHtml(at.logo,16,4)} ${at.name} · <span>${af}</span></div>
          <div class="pitch pitch-half">
            ${renderPitchLines(ap.length)}
            ${renderPlayersOnPitch(ap,apos,true)}
          </div>
        </div>
      </div>`;
    return;
  }

  const team=side==='home'?ht:at;
  const lineupKey=side==='home'?'homeLineup':'awayLineup';
  const lineup=m[lineupKey];

  if(!lineup||!lineup.players||!lineup.players.length) {
    contentEl.innerHTML=`<div class="empty-state" style="padding:60px 20px">
      <span class="empty-icon">👥</span>
      <div>لم تُدخَل التشكيلة بعد</div>
      <div style="font-size:10px;margin-top:6px;color:var(--t3)">يضيفها مدير البطولة من لوحة التحكم</div>
    </div>`;
    return;
  }

  const formation=lineup.formation||'4-3-3';
  const players=lineup.players||[];
  const playerCount=players.length;
  const positions=FORMATION_POSITIONS[formation]||getDynamicPositions(playerCount);

  contentEl.innerHTML=`
    <div class="lineup-formation-bar">
      <span>${logoHtml(team.logo,18,5)}</span>
      <span class="lf-name">${team.name}</span>
      <span class="lf-badge">${formation}</span>
      <span class="lf-count">${playerCount} لاعب</span>
    </div>
    <div class="pitch" id="pitchCanvas">
      ${renderPitchLines(playerCount)}
      ${renderPlayersOnPitch(players,positions,side==='away')}
    </div>
    <div style="padding:0 0 80px">${renderLineupList(players)}</div>
  `;
};

function renderPitchLines(n=11) {
  const t=n<=6?'futsal':n<=9?'seven':'full';
  if(t==='futsal') return `<svg class="pitch-lines" viewBox="0 0 100 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="90" height="150" stroke="rgba(255,255,255,.15)" stroke-width=".8" rx="3"/>
    <line x1="5" y1="80" x2="95" y2="80" stroke="rgba(255,255,255,.1)" stroke-width=".8"/>
    <circle cx="50" cy="80" r="12" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="26" y="5" width="48" height="24" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="38" y="5" width="24" height="10" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <rect x="26" y="131" width="48" height="24" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="38" y="145" width="24" height="10" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <circle cx="50" cy="20" r="1" fill="rgba(255,255,255,.2)"/><circle cx="50" cy="140" r="1" fill="rgba(255,255,255,.2)"/>
  </svg>`;
  if(t==='seven') return `<svg class="pitch-lines" viewBox="0 0 100 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="90" height="150" stroke="rgba(255,255,255,.14)" stroke-width=".8" rx="2"/>
    <line x1="5" y1="80" x2="95" y2="80" stroke="rgba(255,255,255,.1)" stroke-width=".8"/>
    <circle cx="50" cy="80" r="13" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="20" y="5" width="60" height="28" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="35" y="5" width="30" height="12" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <rect x="20" y="127" width="60" height="28" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="35" y="143" width="30" height="12" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <circle cx="50" cy="20" r="1" fill="rgba(255,255,255,.2)"/><circle cx="50" cy="140" r="1" fill="rgba(255,255,255,.2)"/>
  </svg>`;
  return `<svg class="pitch-lines" viewBox="0 0 100 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="90" height="150" stroke="rgba(255,255,255,.12)" stroke-width=".8" rx="2"/>
    <line x1="5" y1="80" x2="95" y2="80" stroke="rgba(255,255,255,.1)" stroke-width=".8"/>
    <circle cx="50" cy="80" r="14" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="22" y="5" width="56" height="20" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="22" y="135" width="56" height="20" stroke="rgba(255,255,255,.08)" stroke-width=".8" fill="none"/>
    <rect x="36" y="5" width="28" height="8" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <rect x="36" y="147" width="28" height="8" stroke="rgba(255,255,255,.06)" stroke-width=".8" fill="none"/>
    <circle cx="50" cy="20" r="1" fill="rgba(255,255,255,.2)"/><circle cx="50" cy="140" r="1" fill="rgba(255,255,255,.2)"/>
  </svg>`;
}

function renderPlayersOnPitch(players, positions, isAway=false) {
  return players.slice(0, positions.length).map((p,i)=>{
    const pos=positions[i]||{x:50,y:50,pos:'?'};
    const y=isAway?(105-pos.y):pos.y;
    const isGK=pos.pos==='GK';
    const num=p.number||(i+1);
    const name=(p.name||'').split(' ').slice(-1)[0];
    return `<div class="player-dot" style="left:${pos.x}%;top:${y}%" onclick="showToast('${num} · ${(p.name||'').replace(/'/g,"\\'")} · ${pos.pos}')">
      <div class="player-avatar ${isGK?'gk':''} ${isAway?'away':''}">${num}</div>
      <div class="player-name-tag">${name}</div>
    </div>`;
  }).join('');
}

function renderLineupList(players) {
  if(!players||!players.length) return '';
  const posMap={GK:'GK',CB:'DEF',LB:'DEF',RB:'DEF',LWB:'DEF',RWB:'DEF',DM:'MID',CM:'MID',CAM:'MID',LM:'MID',RM:'MID',LW:'FWD',RW:'FWD',ST:'FWD'};
  const posLabels={GK:'حارس المرمى',DEF:'الدفاع',MID:'خط الوسط',FWD:'الهجوم',SUB:'البدلاء'};
  const groups={GK:[],DEF:[],MID:[],FWD:[],SUB:[]};
  players.forEach((p,i)=>{ const g=posMap[p.position?.toUpperCase()]||(i>10?'SUB':'FWD'); groups[g].push(p); });
  return `<div class="lineup-list">${Object.entries(groups).filter(([,a])=>a.length>0).map(([grp,arr])=>`
    <div class="lineup-pos-group">
      <div class="lineup-pos-label">${posLabels[grp]||grp}</div>
      ${arr.map(p=>`<div class="lineup-player-row">
        <div class="lp-num">${p.number||'—'}</div>
        <div class="lp-info"><div class="lp-name">${p.name||'لاعب'}</div><div class="lp-pos">${p.position||''}</div></div>
        ${p.position==='GK'?'<div class="lp-badge gk">GK</div>':''}
        ${p.status==='injured'?'<div class="lp-badge inj">مصاب</div>':''}
        ${p.status==='suspended'?'<div class="lp-badge sus">موقوف</div>':''}
      </div>`).join('')}
    </div>`).join('')}</div>`;
}

// ════════════════════════════════════════
//  PLAYER MODAL
// ════════════════════════════════════════
window.openPlayerModal = function(playerName, teamId) {
  const SC = window.ScorersCore;
  const norm = n => SC ? SC.normName(n) : String(n || '').trim().toLowerCase();
  const data = buildScorersData();

  // ✅ لو مُرِّر teamId نبحث بالاسم + الفريق معاً (يفصل بين لاعبين متشابهي الاسم
  // في فريقين مختلفين). وإلا نرجع للبحث بالاسم فقط (توافق مع نداءات قديمة).
  let player = teamId
    ? data.find(p => p.teamId === teamId && norm(p.name) === norm(playerName))
    : data.find(p => p.name === playerName);
  if (!player) player = data.find(p => norm(p.name) === norm(playerName));
  if (!player) return;

  const pTeamId = player.teamId;
  const playerMatches = [];
  let momCount = 0;

  matches.filter(m => m.status === 'finished').forEach(m => {
    const isHomeTeam = pTeamId && m.homeId === pTeamId;
    const isAwayTeam = pTeamId && m.awayId === pTeamId;
    if (!isHomeTeam && !isAwayTeam) return; // مباراة لا تخص فريق هذا اللاعب

    let myGoals = 0;
    const evs = _matchEvents(m);
    const goalEvs = evs.filter(e => e && e.type === 'goal');
    if (goalEvs.length) {
      goalEvs.forEach(ev => {
        const evTeamId = ev.teamId || (_evSide(ev) === 'home' ? m.homeId : m.awayId);
        if (evTeamId !== pTeamId) return;
        const same = player.playerId
          ? (ev.playerId && ev.playerId === player.playerId)
          : (norm(ev.player) === norm(player.name));
        if (same) myGoals++;
      });
    } else {
      const scText = isHomeTeam ? m.homeScorers : m.awayScorers;
      if (scText) scText.split(',').forEach(s => {
        const r = s.trim().match(/^(.+?)\s*(?:\((\d+)\))?$/);
        if (r && norm(r[1]) === norm(player.name)) myGoals += parseInt(r[2] || '1');
      });
    }

    const opp = isHomeTeam ? (teams.find(t => t.id === m.awayId) || {name: m.awayName || '؟'})
                            : (teams.find(t => t.id === m.homeId) || {name: m.homeName || '؟'});
    const my = isHomeTeam ? m.homeScore : m.awayScore, op = isHomeTeam ? m.awayScore : m.homeScore;
    const result = my > op ? 'فوز' : my < op ? 'خسارة' : 'تعادل';
    const rc = my > op ? 'var(--green)' : my < op ? 'var(--red)' : 'var(--gold)';
    if (myGoals > 0) playerMatches.push({ m, opp, my, op, result, rc, myGoals });

    if (m.manOfMatch && norm(m.manOfMatch) === norm(player.name)) momCount++;
  });

  const team = teams.find(t => t.id === player.teamId) || {logo: player.teamLogo};
  document.getElementById('pmLogo').innerHTML = logoHtml(team.logo || player.teamLogo, 36, 10);
  document.getElementById('pmName').textContent = player.name;
  document.getElementById('pmTeam').textContent = player.teamName;
  document.getElementById('pmGoals').textContent = player.goals;
  document.getElementById('pmMatches').textContent = playerMatches.length;
  document.getElementById('pmAvg').textContent = playerMatches.length ? (player.goals / playerMatches.length).toFixed(1) : '0.0';
  document.getElementById('pmMOM').textContent = momCount;
  const listEl = document.getElementById('pmMatchList');
  if (!playerMatches.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:11px">لا توجد بيانات</div>';
  } else {
    listEl.innerHTML = playerMatches.slice(0, 10).map(({m, opp, my, op, result, rc, myGoals}) => `
      <div class="pm-match-row">
        <div class="pm-match-result" style="color:${rc}">${result}</div>
        <div class="pm-match-vs">ضد ${opp.name} · جولة ${m.round||1}</div>
        <div style="font-size:11px;color:var(--t3)">${my}-${op}</div>
        ${myGoals>0?`<div class="pm-goals-badge">⚽×${myGoals}</div>`:''}
      </div>`).join('');
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
    // ✅ FIX §2: لا نُظهر المتأهلين للجمهور إلا بعد الاعتماد الرسمي
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
          return `<div class="gm-row${live?' gm-live':''}" onclick="openMatchDetail('${m.id}')">
            <div class="gm-team gm-home">${logoHtml(ht.logo,16,4)} <span>${ht.name}</span></div>
            <div class="gm-score${fin||live?' gm-score-fin':''}">
              ${fin||live
                ? `${m.homeScore??0} - ${m.awayScore??0}${m.penaltyScoreHome != null 
                    ? `<span style="display:block;font-size:9px;color:var(--gold)">رك: ${m.penaltyScoreHome}-${m.penaltyScoreAway}</span>` 
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
        <div class="group-sub">${hasManualQ?`✅ ${manualQ.size} متأهل`:`متأهلون: أفضل ${qCount}`}</div>
      </div>
      <div class="gt-header">
        <div>#</div><div>الفريق</div>
        <div>ل</div><div>ف</div><div>ت</div><div>خ</div><div>±</div><div>ن</div>
      </div>
      ${sorted.map((t,i)=>{
        const s=gs[t.id]||{};const gd=(s.gf||0)-(s.ga||0);
        // ✅ FIX §2: علامات التأهل تظهر فقط بعد الاعتماد الرسمي
        const isQ=hasManualQ?manualQ.has(t.id):i<qCount;
        const isElim=hasManualQ&&!manualQ.has(t.id)&&manualQ.size>=qCount;
        // إذا لم يُعتمد بعد — لا نُظهر أي علامة تأهل أو إقصاء
        const showBadges = isPublished;
        return`<div class="gt-row${(isQ&&showBadges)?' gt-row-qualified':''}${(isElim&&showBadges)?' gt-row-eliminated':''}">
          <div class="gt-pos" style="color:${(isQ&&showBadges)?'var(--green)':(isElim&&showBadges)?'var(--red)':'var(--t3)'}">${i+1}</div>
          <div class="gt-team">
            <span>${logoHtml(t.logo,18,4)}</span>
            <span class="gt-name">${t.name}</span>
            ${(isQ&&showBadges)?'<span class="qualify-badge">✅ متأهل</span>':''}
            ${(isElim&&showBadges)?'<span class="elim-badge">❌ خرج</span>':''}
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
  }).join('');
}


// ════════════════════════════════════════
//  KNOCKOUT BRACKET
// ════════════════════════════════════════
function buildRoundNames(total,rounds) {
  // ✅ الأولوية دائماً لـ r.name المحفوظ في Firebase
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
      // ✅ لا نعتمد على matchIds وحدها: أي مباراة تحمل knockoutRoundId لهذا الدور
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

    // ✅ نفصل دور "مباراة تحديد المركز الثالث" إن وُجد — يُعرض كبطاقة صغيرة مستقلة بجانب النهائي
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
      <div class="btv-arrow">⬇</div>`;
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
    // ✅ لا تُسقط أي مباراة بصمت: لو الخانة مأخوذة أو الرقم خارج المدى
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
  const hw = isFin && ((m.penaltyScoreHome != null ? m.penaltyScoreHome > m.penaltyScoreAway : (m.homeScore ?? 0) > (m.awayScore ?? 0)));
  const aw = isFin && ((m.penaltyScoreAway != null ? m.penaltyScoreAway > m.penaltyScoreHome : (m.awayScore ?? 0) > (m.homeScore ?? 0)));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')`;
  // ✅ المباراة المنتهية تبقى ظاهرة ببطاقتها كاملة (الفائز + الخاسر) — لا تُفرَّغ أبداً
  const penH = (isFin && m.penaltyScoreHome != null) ? `<span class="bt-pen">رك ${m.penaltyScoreHome}</span>` : '';
  const penA = (isFin && m.penaltyScoreAway != null) ? `<span class="bt-pen">رك ${m.penaltyScoreAway}</span>` : '';
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
  const hw = isFin && ((m.penaltyScoreHome != null 
    ? m.penaltyScoreHome > m.penaltyScoreAway
    : (m.homeScore ?? 0) > (m.awayScore ?? 0)));
  const aw = isFin && ((m.penaltyScoreAway != null 
    ? m.penaltyScoreAway > m.penaltyScoreHome
    : (m.awayScore ?? 0) > (m.homeScore ?? 0)));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')`;
  return `<div class="bracket-match ${isLive?'bm-live':isFin?'bm-done':''}" onclick="${clickFn}">
    <div class="bm-team ${hw?'bm-winner':''}">
      <span class="bm-logo">${logoHtml(ht.logo,20,5)}</span>
      <span class="bm-name">${ht.name}</span>
      <span class="bm-score">${isFin||isLive ? m.homeScore??0 : ''}${isFin && m.penaltyScoreHome != null ? `<span style="font-size:9px;color:var(--gold);display:block">رك: ${m.penaltyScoreHome}</span>` : ''}</span>
    </div>
    <div class="bm-sep" style="height:1px;background:var(--b1)"></div>
    <div class="bm-team ${aw?'bm-winner':''}">
      <span class="bm-logo">${logoHtml(at.logo,20,5)}</span>
      <span class="bm-name">${at.name}</span>
      <span class="bm-score">${isFin||isLive ? m.awayScore??0 : ''}${isFin && m.penaltyScoreAway != null ? `<span style="font-size:9px;color:var(--gold);display:block">رك: ${m.penaltyScoreAway}</span>` : ''}</span>
    </div>
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
  const isFin  = bm.status === 'finished';
  const isLive = bm.status === 'live';
  // ── تحديد الفائز مع دعم ركلات الترجيح ──
  const hw = isFin && ((bm.penaltyScoreHome != null 
    ? bm.penaltyScoreHome > bm.penaltyScoreAway
    : (bm.homeScore ?? 0) > (bm.awayScore ?? 0)));
  const aw = isFin && ((bm.penaltyScoreAway != null 
    ? bm.penaltyScoreAway > bm.penaltyScoreHome
    : (bm.awayScore ?? 0) > (bm.homeScore ?? 0)));

  const lName = document.getElementById('mdLeagueName');
  if(lName) lName.textContent = (league?.name||'') + ' · ' + (roundName||'شجرة البطولة');

  // ── عرض النتيجة مع ركلات الترجيح إذا وجدت ──
  const scoreHtml = isFin || isLive
    ? `<div class="md-score">${bm.homeScore??0} - ${bm.awayScore??0}${bm.penaltyScoreHome != null ? `<br><span style="font-size:12px;color:var(--gold)">رك: ${bm.penaltyScoreHome} - ${bm.penaltyScoreAway}</span>` : ''}</div>`
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
             ? (ev.result === 'goal' ? '🥅 ✅' : '🥅 ❌')
             : ev.icon||'⚽'}</div>
           <div class="md-ev-info">
             <div class="md-ev-player">${ev.type === 'penalty' 
               ? (ev.result === 'goal' ? 'هدف' : 'تفويت') + ' (ركلات ترجيح)'
               : ev.player||''}</div>
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
      <button class="bn-item" id="bn-scorers"  onclick="switchTab('scorers',null,this)"><span class="bi">${window.Icon?Icon('medal',19):''}</span>الهدافون</button>
      <button class="bn-item" id="bn-stats"    onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"     onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = 'none';
    if(brkEl)   brkEl.style.display   = bracketOK ? 'block' : 'none';
    // ✅ FIX §1: إخفاء حاويات الترتيب في نظام الإقصاء
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
      <button class="bn-item" id="bn-scorers"  onclick="switchTab('scorers',null,this)"><span class="bi">${window.Icon?Icon('medal',19):''}</span>الهدافون</button>
      <button class="bn-item" id="bn-stats"    onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"     onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = 'none';
    if(gEl)     gEl.style.display     = 'block';
    if(brkEl)   brkEl.style.display   = bracketOK ? 'block' : 'none';
    // ✅ FIX §1: إخفاء حاويات الترتيب العام في نظام المجموعات
    ['fullStandings','homeStandings','zoneLegend'].forEach(function(id) {
      var el = document.getElementById(id); if(el) el.style.display = 'none';
    });
  } else {
    // league - ensure all tabs are shown
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"      onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      <button class="bn-item" id="bn-standings" onclick="switchTab('standings',null,this)"><span class="bi">${window.Icon?Icon('list',19):''}</span>الترتيب</button>
      <button class="bn-item" id="bn-matches"   onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"     onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-scorers"   onclick="switchTab('scorers',null,this)"><span class="bi">${window.Icon?Icon('medal',19):''}</span>الهدافون</button>
      <button class="bn-item" id="bn-stats"     onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"      onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = '';
  }
  // ✅ للـ home-section sub-header "عرض الكل" — أخفه إذا مش دوري نقاط
  if(type !== 'league') {
    document.querySelectorAll('[onclick*="switchTab(\'standings\'"]').forEach(el => {
      if(el.classList.contains('home-sub-btn')) el.style.display = 'none';
    });
  }
}

function getDynamicTabOrder() {
  if(tournamentType==='knockout') return ['home','bracket','matches','teams','scorers','stats'];
  if(tournamentType==='groups')   return ['home','groups','bracket','matches','teams','scorers','stats'];
  return ['home','standings','matches','teams','scorers','stats'];
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
  // ✅ toggle class للـ animation
  btn.classList.toggle('open', !isOpen);
};

window.switchTab = function(name, btn, mn) {
  // ✅ إزالة active + مسح أي inline style من كل الـ sections
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
  const homeWins=fin.filter(m=>m.homeScore>m.awayScore).length;
  const awayWins=fin.filter(m=>m.awayScore>m.homeScore).length;
  const rows=[
    ['🗓 مباريات منتهية',fin.length],
    ['⚽ مجموع الأهداف',goals],
    ['📈 معدل أهداف/مباراة',fin.length?(goals/fin.length).toFixed(1):0],
    ['🏠 فوز أصحاب الأرض',homeWins],
    ['✈️ فوز الضيف',awayWins],
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
        '<button onclick="window._doShareTG()" style="display:flex;align-items:center;gap:8px;background:#0d1520;border:1px solid rgba(0,136,204,.2);border-radius:14px;padding:14px 12px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;color:#0088cc"><span style="font-size:20px">✈️</span> تيليجرام</button>' +
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
      if (sp) sp.textContent = '✅';
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
  // ✅ لا تصمت لو البيانات لم تُحمَّل بعد — الرابط وحده كافٍ للمشاركة
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
    const btn=document.getElementById('themeToggle'); if(btn) btn.textContent='☀️';
  }
})();
window.toggleTheme = function() {
  const isL=document.documentElement.classList.toggle('light');
  localStorage.setItem('theme',isL?'light':'dark');
  const btn=document.getElementById('themeToggle'); if(btn) btn.textContent=isL?'☀️':'🌙';
};

// ════════════════════════════════════════
//  OFFLINE
// ════════════════════════════════════════
window.addEventListener('online', ()=>{ document.getElementById('offlineBar')?.classList.remove('show'); showToast('عدت للاتصال ✅','success'); });
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
    // ✅ فلتر الـ tabs الموجودة فعلاً في DOM (تتجنب bracket المخفية)
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
  if(!deferredPrompt) { showToast('التطبيق جاهز للتثبيت من القائمة ⬇️','success'); return; }
  deferredPrompt.prompt();
  const {outcome}=await deferredPrompt.userChoice;
  if(outcome==='accepted') showToast('✅ تم التثبيت بنجاح!','success');
  deferredPrompt=null;
  const f=document.getElementById('installFab'); if(f) f.style.display='none';
};

// ════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  const map={'1':'home','2':'standings','3':'matches','4':'stats','5':'scorers'};
  if(map[e.key]) window.switchTab(map[e.key],null,document.getElementById('bn-'+map[e.key]));
  if(e.key==='Escape') { window.closeMatchDetail(); window.closeLineup(); window.closeLiveOverlay(); }
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
        <div style="display:flex;gap:3px;margin-top:4px">
          ${form.map(f=>`<div style="width:7px;height:7px;border-radius:2px;background:${f==='w'?'var(--green)':f==='l'?'var(--red)':'var(--t3)'}"></div>`).join('')}
        </div>
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
  const finished = matches
    .filter(m => m.status === 'finished' && (m.homeId === teamId || m.awayId === teamId))
    .slice(-count);
  return finished.map(m => {
    const isHome = m.homeId === teamId;
    const myScore = isHome ? (m.homeScore || 0) : (m.awayScore || 0);
    const opScore = isHome ? (m.awayScore || 0) : (m.homeScore || 0);
    if (myScore > opScore) return 'w';
    if (myScore < opScore) return 'l';
    return 'd';
  });
}

// ════════════════════════════════════════
//  TEAM PROFILE OVERLAY
// ════════════════════════════════════════
window.openTeamProfile = function(teamId) {
  const t = teams.find(x=>x.id===teamId);
  if(!t) return;
  const overlay = document.getElementById('teamProfileOverlay');
  const body = document.getElementById('teamProfileBody');
  if(!overlay||!body) return;

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

  // لاعبو الفريق
  const players = t.players || [];

  // هدافو الفريق من المباريات
  const scorersMap = {};
  matches.filter(m=>m.status==='finished').forEach(m=>{
    const isHome = m.homeId===teamId;
    const isAway = m.awayId===teamId;
    if(!isHome&&!isAway) return;
    const sc = isHome?m.homeScorers:m.awayScorers;
    if(!sc) return;
    sc.split(',').forEach(s=>{
      const rx=s.trim().match(/^(.+?)\s*(?:\((\d+)\))?$/);
      if(!rx) return;
      const name=rx[1].trim(), g=parseInt(rx[2]||'1');
      if(!scorersMap[name]) scorersMap[name]=0;
      scorersMap[name]+=g;
    });
  });
  const topScorers = Object.entries(scorersMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  body.innerHTML = `
    <!-- هيدر الفريق -->
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:24px 16px 20px;text-align:center">
      <div style="width:72px;height:72px;border-radius:16px;background:var(--s2);border:1px solid var(--b2);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        ${logoHtml(t.logo, 56, 12)}
      </div>
      <div style="font-size:20px;font-weight:900;color:var(--t1);margin-bottom:4px">${t.name}</div>
      <div style="font-size:11px;color:var(--t3)">المركز ${pos} · ${league?.name||'البطولة'}</div>
    </div>

    <!-- إحصائيات سريعة -->
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

    <!-- الفورم -->
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">آخر النتائج</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${form.map(f=>`
          <div style="width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;
            background:${f==='w'?'var(--gn-bg)':f==='l'?'var(--lv-bg)':'var(--s3)'};
            border:1px solid ${f==='w'?'var(--gn-br)':f==='l'?'var(--lv-br)':'var(--b2)'};
            color:${f==='w'?'var(--green)':f==='l'?'var(--live)':'var(--t3)'}">
            ${f==='w'?'ف':f==='l'?'خ':'ت'}
          </div>`).join('')}
        ${!form.length?'<div style="font-size:11px;color:var(--t3)">لا توجد مباريات بعد</div>':''}
      </div>
    </div>

    <!-- إحصائيات تفصيلية -->
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">الإحصائيات</div>
      ${[
        ['الأهداف المسجلة','⚽',stats.gf,'var(--gold)'],
        ['الأهداف المستقبلة','🥅',stats.ga,'var(--red)'],
        ['فارق الأهداف','±',stats.gd>=0?'+'+stats.gd:stats.gd,stats.gd>0?'var(--green)':stats.gd<0?'var(--red)':'var(--t3)'],
        ['التعادلات','🤝',stats.d,'var(--t2)'],
      ].map(([lbl,ic,val,clr])=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--b1);font-size:12px">
          <span style="color:var(--t3)">${ic} ${lbl}</span>
          <span style="font-weight:900;color:${clr};font-family:'Tajawal',sans-serif;font-size:14px">${val}</span>
        </div>`).join('')}
    </div>

    <!-- آخر النتائج -->
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

    <!-- المباريات القادمة -->
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

    <!-- الهدافون -->
    ${topScorers.length?`
    <div style="background:var(--s1);border-bottom:1px solid var(--b1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">هدافو الفريق</div>
      ${topScorers.map(([name,goals],i)=>`
        <div onclick="closeTeamProfile();setTimeout(()=>openPlayerModal('${name.replace(/'/g,"\\'")}','${teamId}'),300)" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--b1);cursor:pointer">
          <div style="width:26px;height:26px;border-radius:7px;background:${i===0?'linear-gradient(135deg,#ffd700,#b8860b)':'var(--s3)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:${i===0?'#000':'var(--t3)'}">
            ${i===0?'🥇':i+1}
          </div>
          <div style="flex:1;font-size:13px;font-weight:700;color:var(--t1)">${name}</div>
          <div style="font-size:18px;font-weight:900;color:var(--gold);font-family:'Tajawal',sans-serif">${goals}</div>
          <div style="font-size:10px;color:var(--t3)">هدف</div>
        </div>`).join('')}
    </div>`:'' }

    <!-- اللاعبون -->
    ${players.length?`
    <div style="background:var(--s1);padding:14px 16px;margin-bottom:6px">
      <div style="font-size:10px;font-weight:700;color:var(--t3);letter-spacing:1px;margin-bottom:10px">قائمة اللاعبين</div>
      ${players.map(p=>`
        <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--b1)">
          <div style="width:28px;height:28px;border-radius:7px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:var(--t2)">${p.number||'—'}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--t1)">${p.name||'لاعب'}</div>
            <div style="font-size:10px;color:var(--t3);margin-top:1px">${p.position||''}</div>
          </div>
          ${p.position==='GK'?'<span style="font-size:9px;background:rgba(142,68,173,.14);color:#8E44AD;border:1px solid rgba(142,68,173,.3);border-radius:5px;padding:2px 6px;font-weight:700">GK</span>':''}
          ${p.status==='injured'?'<span style="font-size:9px;background:var(--lv-bg);color:var(--live);border:1px solid var(--lv-br);border-radius:5px;padding:2px 6px;font-weight:700">مصاب</span>':''}
          ${p.status==='suspended'?'<span style="font-size:9px;background:var(--g-bg);color:var(--gold);border:1px solid var(--g-br);border-radius:5px;padding:2px 6px;font-weight:700">موقوف</span>':''}
        </div>`).join('')}
    </div>`:'' }

    <div style="height:env(safe-area-inset-bottom,16px)"></div>
  `;

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
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

// ✅ إعادة تشغيل التايمر عند العودة للصفحة
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
function applyTiebreak(a, b, matchList) {
  const order = settings.tiebreakOrder || ['h2h','gd','gf','draw'];
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
    }
  }
  return (a.name||'').localeCompare(b.name||'');
}

// ── جمع كشوف اللاعبين (كشف الفريق الرسمي + تشكيلات المباريات) ──
// يُستخدم لإيجاد هوية اللاعب (id) حتى لو تشابهت الأسماء بين فريقين.
function _collectScorerRosters() {
  const out = {};
  const src = window._teamRosters || window.rosterCache || {};
  Object.keys(src).forEach(tid => {
    out[tid] = (src[tid] || []).map(p => ({ id: p.id, name: p.name, number: p.number }));
  });
  (matches || []).forEach(m => {
    [['home', m.homeId], ['away', m.awayId]].forEach(([side, tid]) => {
      if (!tid) return;
      const ld = m.liveData || {};
      const lu = side === 'home' ? ld.homeLineup : ld.awayLineup;
      if (!lu || !lu.players) return;
      out[tid] = out[tid] || [];
      lu.players.forEach(p => {
        if (!p || !p.name) return;
        const norm = window.ScorersCore ? window.ScorersCore.normName(p.name) : p.name;
        const exists = out[tid].some(x => (window.ScorersCore ? window.ScorersCore.normName(x.name) : x.name) === norm);
        if (!exists) out[tid].push({ id: p.id || null, name: p.name, number: p.number });
      });
    });
  });
  return out;
}

// ── buildScorersData ──────────────────────────────────────
// ✅ يفصل اللاعبين بالهوية (playerId أو teamId+الاسم المُطبَّع) عبر ScorersCore
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

  // احتياط طارئ فقط — لن يُستخدم عادة لأن scorers-core.js محمَّل دائماً في صفحة الجمهور
  const map = {};
  matches.filter(m => m.status === 'finished').forEach(m => {
    [[m.homeScorers, m.homeId], [m.awayScorers, m.awayId]].forEach(([sc, tid]) => {
      if (!sc) return;
      sc.split(',').forEach(s => {
        const rx = s.trim().match(/^(.+?)\s*(?:\((\d+)\))?$/);
        if (!rx) return;
        const name = rx[1].trim(), g = parseInt(rx[2] || '1');
        if (!name) return;
        const key = tid + '::' + name;
        if (!map[key]) {
          const team = teams.find(t => t.id === tid) || {};
          map[key] = { name, goals: 0, teamId: tid, teamName: team.name || '', teamLogo: team.logo || '' };
        }
        map[key].goals += g;
      });
    });
    const hasTextScorers = m.homeScorers || m.awayScorers;
    const _evsFallback = _matchEvents(m);
    if (!hasTextScorers && _evsFallback.length) {
      _evsFallback.forEach(ev => {
        if (ev.type !== 'goal') return;
        const name = (ev.player || '').trim();
        if (!name || name === '—' || name === '؟' || name === '?') return;
        const tid = ev.teamId || (_evSide(ev) === 'home' ? m.homeId : m.awayId);
        const key = tid + '::' + name;
        if (!map[key]) {
          const team = teams.find(t => t.id === tid) || {};
          map[key] = { name, goals: 0, teamId: tid, teamName: team.name || '', teamLogo: team.logo || '' };
        }
        map[key].goals += 1;
      });
    }
  });
  return Object.values(map).sort((a, b) => b.goals - a.goals);
}

// ── renderScorers ─────────────────────────────────────────
function renderScorers() {
  const data = buildScorersData();
  ['fullScorers', 'homeScorers'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isHome = id === 'homeScorers';
    const list = isHome ? data.slice(0, 5) : data;
    if (!list.length) {
      el.innerHTML = '<div class="empty-state" style="padding:30px 20px;text-align:center;color:var(--t3)"><div style="font-size:36px;margin-bottom:8px;opacity:.3">⚽</div><div>لا توجد أهداف بعد</div></div>';
      return;
    }
    el.innerHTML = list.map((p, i) => {
      const team = teams.find(t => t.id === p.teamId) || {};
      const medalColors = ['#FFD700','#C0C0C0','#CD7F32'];
      const medal = i < 3 ? `<span style="font-size:16px">${['🥇','🥈','🥉'][i]}</span>` : `<div style="width:22px;height:22px;border-radius:6px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:var(--t3)">${i+1}</div>`;
      return `<div class="scorer-row ${i===0?'top1':''}" onclick="openPlayerModal('${p.name.replace(/'/g,"\'")}','${p.teamId||''}')">
        ${medal}
        <div style="width:32px;height:32px;border-radius:8px;overflow:hidden;background:var(--s3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${logoHtml(team.logo || p.teamLogo, 28, 6)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--t1)">${p.name}</div>
          <div style="font-size:10px;color:var(--t3);margin-top:1px">${p.teamName}</div>
        </div>
        <div style="text-align:center;min-width:32px">
          <div style="font-size:20px;font-weight:900;color:var(--gold);font-family:'Tajawal',sans-serif">${p.goals}</div>
          <div style="font-size:9px;color:var(--t3)">هدف</div>
        </div>
        <div style="font-size:14px;color:var(--t3)">←</div>
      </div>`;
    }).join('');
  });
}

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
  const ZONE_NAMES2  = ['المتوج 🏆','متأهل ✅','مشروط 🔵','عادي ⚪','ملعب الهبوط 🟠','هابط 🔴'];
  let zoneIdx = 0, rowIdx = 0;
  const zoneColors = {};
  ZONE_KEYS2.forEach((k, ki) => {
    const count = z[k] || 0;
    for (let i = 0; i < count; i++) {
      zoneColors[rowIdx++] = ZONE_COLORS2[ki];
    }
  });

  const tableHtml = `
    <div class="standings-card-scroll">
      <table style="width:100%;min-width:360px;border-collapse:collapse">
        <thead>
          <tr style="font-size:9px;color:var(--t3);border-bottom:1px solid var(--b1)">
            <th style="padding:7px 5px;text-align:right;font-weight:600">#</th>
            <th style="padding:7px 5px;text-align:right;font-weight:600">الفريق</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600">ل</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600">ف</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600">ت</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600">خ</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600">±</th>
            <th style="padding:7px 5px;text-align:center;font-weight:600;color:var(--gold)">ن</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((t, i) => {
            const s = statsMap[t.id] || {};
            const gd = (s.gf||0)-(s.ga||0);
            const zc = zoneColors[i] || '';
            return `<tr style="border-bottom:1px solid var(--b1);cursor:pointer" onclick="openTeamProfile('${t.id}')">
              <td style="padding:9px 5px;font-size:11px;font-weight:900;color:${zc||'var(--t3)'};border-right:3px solid ${zc||'transparent'}">${i+1}</td>
              <td style="padding:9px 5px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${logoHtml(t.logo,22,5)}
                  <span style="font-size:12px;font-weight:700;color:var(--t1)">${t.name}</span>
                </div>
              </td>
              <td style="padding:9px 5px;text-align:center;font-size:12px;color:var(--t2)">${s.p||0}</td>
              <td style="padding:9px 5px;text-align:center;font-size:12px;color:var(--green)">${s.w||0}</td>
              <td style="padding:9px 5px;text-align:center;font-size:12px;color:var(--t2)">${s.d||0}</td>
              <td style="padding:9px 5px;text-align:center;font-size:12px;color:var(--red)">${s.l||0}</td>
              <td style="padding:9px 5px;text-align:center;font-size:12px;color:${gd>0?'var(--green)':gd<0?'var(--red)':'#666'}">${gd>0?'+'+gd:gd}</td>
              <td style="padding:9px 5px;text-align:center;font-size:14px;font-weight:900;color:var(--gold);font-family:'Tajawal',sans-serif">${s.pts||0}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
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
// ✅ تصدير — يسمح لـall-fixes.js باستبدالها فعلياً
window.renderStandings = renderStandings;

// ── renderMatches ─────────────────────────────────────────
function renderMatches(filter) {
  /* ✅ التبويبات: matches-tabs.js يسجّل نفسه هنا. لا نستطيع استبدال
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


init();

// ════════════════════════════════════════
//  PUSH NOTIFICATIONS — FCM Web
// ════════════════════════════════════════

/* ✅ يُنشأ عند الحاجة فقط (زر الإشعارات) — لا وقت التحميل */
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
      showToast('✅ تم تفعيل الإشعارات! ستصلك تنبيهات المباريات', 'success');
    } else {
      showToast('❌ لم يتم السماح بالإشعارات', 'error');
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
      // console.log('[PUSH] Token saved ✅');
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
//  ✅ النظام الموحّد النهائي — بطاقات مباريات بتصميم SofaScore
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

  // ✅ المصدر الوحيد للحقيقة — نفس حساب لوحة التحكم بالضبط
  const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
  if (!c) return '--';
  // FIX 7: عند 45:00 بالضبط لا شارة بدل ضائع حتى تمرّ ثانية أو يُعلنها المنظّم
  if (!c.inStoppage || !c.showStoppage) return c.clock;
  // بدل الضائع — ثلاثة أسطر مرتبة:
  //   +5      ← الدقائق المضافة المُعلنة (فوق)
  //   45:00   ← الوقت الرسمي متجمّد (الوسط)
  //   +2:14   ← عدّاد بدل الضائع الجاري (تحت)
  // ✅ التنسيق: +5 و +2:14 جنب بعض في صف واحد فوق · 45:00 تحت
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
    '🏅':'medal','🏆':'trophy','⚡':'bolt','✅':'check','❌':'close'
  };
  var name = map[t] || byEmoji[ic] || 'ball';
  return (window.Icon ? window.Icon(name, size) : (ic || ''));
}

function _p(n) { return String(n).padStart(2, '0'); }
const _LIVE = ['live','halftime','extratime1','halftime_et','extratime2','penalties'];

// ══════════════════════════════════════════════════════════════
//  بطاقة المباراة الموحّدة (مثل SofaScore / FlashScore)
//  - نفس البطاقة لكل الحالات: upcoming / live / finished
//  - لا أقسام منفصلة، لا عناوين مكررة
// ══════════════════════════════════════════════════════════════

// ── هدافو المباراة مقسومين بين الفريقين مع خط فاصل ──
// (مثل التطبيقات: كل فريق في عمود، الخط يفصلهما)
// ملاحظة: كانت _mdScorers تُستخدم لعرض شريط الهدافين فوق شريط التبويبات
// في نافذة تفاصيل المباراة — أُزيلت بطلب الإدارة (الهدف يظهر الآن فقط
// داخل الخط الزمني بتبويب "الأحداث").

function _matchCard(m) {
  const ht  = (window.teams||[]).find(t => t.id === m.homeId) || { name: m.homeName||'؟', logo: m.homeLogo||'' };
  const at  = (window.teams||[]).find(t => t.id === m.awayId) || { name: m.awayName||'؟', logo: m.awayLogo||'' };
  const d   = m.liveData;
  const isL = m.status === 'live' && d && _LIVE.includes(d.matchStatus);
  const isF = m.status === 'finished';
  const hw  = isF && (m.homeScore || 0) > (m.awayScore || 0);
  const aw  = isF && (m.awayScore || 0) > (m.homeScore || 0);

  // ── وسط البطاقة ──
  let center = '';
  if (isL) {
    const ph    = d.matchStatus;
    const isPen = ph === 'penalties';
    const isHT  = ph === 'halftime' || ph === 'halftime_et';
    const pLabel = isPen ? 'ركلات' : isHT ? 'استراحة'
                 : (ph === 'live' || ph === 'extratime1' || ph === 'extratime2' ? 'مباشر' : _periodLabel(d));
    const isPenScore = isPen && d.penalties;
    const penH = isPenScore ? (d.penalties.home||[]).filter(Boolean).length : null;
    const penA = isPenScore ? (d.penalties.away||[]).filter(Boolean).length : null;
    // ✅ الإيقاف المؤقت — يظهر للجمهور بدل نبضة "مباشر"
    const isPaused = !!d.timerPaused && ['live','extratime1','extratime2'].includes(ph);
    // ✅ تنظيف السبب عند العرض أيضاً (دفاع مزدوج ضد أي بيانات قديمة/غير نظيفة)
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
        ${d.streamActive && d.streamUrl ? `<div class="mc2-stream">بث مباشر</div>` : ''}
      </div>`;
  } else if (isF) {
    center = `
      <div class="mc2-mid">
        <div class="mc2-score mc2-done">
          <span class="${hw?'mc2-win':''}">${m.homeScore ?? 0}</span>
          <span class="mc2-sep">:</span>
          <span class="${aw?'mc2-win':''}">${m.awayScore ?? 0}</span>
        </div>
        <div class="mc2-note">انتهت</div>
      </div>`;
  } else {
    center = `
      <div class="mc2-mid">
        <div class="mc2-time">${m.time ? formatTimeTo12H(m.time) : 'VS'}</div>
        ${m.date ? `<div class="mc2-note">${m.date}</div>` : ''}
      </div>`;
  }

  const roundBadge = m.isKnockout && m.knockoutRoundName
    ? `<div class="mc2-round"><span class="mc2-rb mc2-rb-ko">${m.knockoutRoundName}</span></div>`
    : (m.round ? `<div class="mc2-round"><span class="mc2-rb">الجولة ${m.round}</span></div>` : '');

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
                       // ✅ شبكة أمان: مباريات "معلّقة" قديمة من قبل الإصلاح،
                       // لو الفريقان معروفان (مو TBD بانتظار نتيجة دور سابق) نعرضها
                       (m.status === 'pending' && m.homeId && m.awayId))
                     .sort((a,b)=>(a.round||0)-(b.round||0)||(a.date||'').localeCompare(b.date||''));
  const finished = (window.matches||[]).filter(m => m.status === 'finished')
                     .slice(-3).reverse();

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

  // آخر النتائج
  if (finished.length) {
    if (html) html += `<div style="height:8px"></div>`;
    html += `<div style="font-size:11px;font-weight:700;color:var(--t3,#666);padding:4px 2px 6px">✅ آخر النتائج</div>`;
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
  const finished = (window.matches||[]).filter(m => m.status === 'finished').slice(-3).reverse();
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
  set('homeResultsSection',  finished, '✅ آخر النتائج');
}

// ── عداد البطاقات ──────────────────────────────────────────────
const _c2timers = {};
function _startCard2Clock(m) {
  clearInterval(_c2timers[m.id]);
  _c2timers[m.id] = setInterval(() => {
    const latest = (window.matches||[]).find(x => x.id === m.id);
    const d = latest && latest.liveData;
    if (!d) return;
    // ✅ توقّف فوري عند بلوغ سقف بدل الضائع المُحدَّد — بلا انتظار تحديث الصفحة
    const c = window.TimerCore && window.TimerCore.compute(d, window.settings);
    const frozen = !!(c && c.shouldAutoEnd);
    // ✅ الإيقاف المؤقت: TimerCore يُرجع phaseSeconds الثابتة، فالساعة تتجمّد تلقائياً
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
(function() {
  if (window._matchDetailV3Fixed) return;
  window._matchDetailV3Fixed = true;

  window.openMatchDetail = function(matchId) {
    const m = (window.matches||[]).find(x => x.id === matchId);
    if (!m) return;

    const ht = (window.teams||[]).find(t => t.id === m.homeId) || { name: m.homeName||'؟', logo: m.homeLogo||'' };
    const at = (window.teams||[]).find(t => t.id === m.awayId) || { name: m.awayName||'؟', logo: m.awayLogo||'' };
    const d  = m.liveData;
    const isL = m.status === 'live' && d && _LIVE.includes(d.matchStatus);
    const isF = m.status === 'finished';

    const overlay = document.getElementById('matchDetailOverlay');
    const body    = document.getElementById('matchDetailBody');
    if(!overlay||!body) return;

    const isUpcoming = !isL && !isF;

    // ── تبويبات ── (بلا "نظرة عامة" وبلا "المعلومات" — أُلغيتا بطلب الإدارة)
    // تبويب واحد لتفاصيل/أحداث المباراة: قبل البداية "الأحداث" (يعرض تفاصيل
    // المباراة عند الضغط عليه فقط — لا يظهر تلقائياً)، وبعد بدء المباراة
    // يتحوّل تلقائياً إلى "مجريات المباراة" (الخط الزمني الفعلي للأحداث).
    const tabs = [];
    // البث — أولاً لو مباشر
    if (d && isL && d.streamActive && d.streamUrl) tabs.push({id:'stream', label:'البث'});
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

      // ══ البث ══
      if (tabId === 'stream') {
        const embed = typeof window._buildViewerEmbed === 'function' ? window._buildViewerEmbed(d.streamUrl, d.streamPlatform) : '';
        const icons  = {youtube:'▶️',facebook:'📘',twitch:'🎮',other:'📺'};
        return embed || `<a href="${d.streamUrl}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:14px;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.3);border-radius:14px;padding:16px;text-decoration:none">
          <span style="font-size:28px">${icons[d.streamPlatform]||'▶️'}</span>
          <span style="flex:1"><div style="font-size:14px;font-weight:900;color:#C0392B">شاهد البث المباشر</div>
          <div style="font-size:11px;color:var(--t3);margin-top:3px">${d.streamPlatform||'اضغط للمشاهدة'}</div></span>
          <span style="font-size:18px;color:var(--t3)">←</span></a>`;
      }

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

        // ── خط زمني رأسي: كل الأحداث بترتيب متسلسل بمسافات ثابتة
        //    (وليس بحسب الفارق الزمني الحقيقي) — أهداف الفريق الأول يساراً،
        //    أهداف الفريق الثاني يميناً، وبقية الأحداث كبطاقة وسط الخط ──
        // ✅ نقرأ من المصدر الموحّد: يدعم أحداث الإدخال السريع (m.events)
        //    وأحداث صفحة البث المباشر (m.liveData.events) معاً.
        const evs = _matchEvents(m).slice();

        function minLabel(ev) {
          return ev.extraMinute > 0 ? `${ev.minute}+${ev.extraMinute}'` : `${ev.minute}'`;
        }

        // صفوف الأحداث الفعلية (أهداف + بطاقات + تبديلات...)
        const rows = evs.map(ev => ({
          minute: ev.minute || 0,
          order: (ev.extraMinute || 0) * 0.01,
          kind: ev.type === 'goal' ? 'goal' : 'chip',
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
        const reachedPens = !!(d && d.penalties && (d.matchStatus === 'penalties' || isF))
          || (isF && (m.penaltyScoreHome != null || m.penaltyScoreAway != null));
        if (reachedPens) {
          rows.push({ minute: 998, order: 0.95, kind: 'marker', label: 'بدأت ركلات الترجيح' });
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
          const ev = r.ev;
          if (r.kind === 'goal') {
            const side = _evSide(ev) === 'away' ? 'right' : 'left';
            const content = `<div class="vt-goal">
              <span class="vt-goal-name">${ev.player || '—'}</span>
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
          return `<div class="vt-row vt-row-mid">
            <div class="vt-chip vt-chip-event">
              <span class="vt-chip-ic">${_evIcon(ev, 13)}</span>
              <span class="vt-chip-txt"><strong>${ev.player || ''}</strong>${ev.player2 ? ` ← ${ev.player2}` : ''}
                <span class="vt-chip-team">(${sideLbl})</span></span>
              <span class="vt-chip-min">${minLabel(ev)}</span>
            </div>
          </div>`;
        }

        const rowsHtml = rows.map(rowHtml).join('');
        const teamsHeader = `<div class="vt-teams"><span>${ht.name}</span><span>${at.name}</span></div>`;
        const emptyHtml = !evs.length
          ? '<div class="vt-empty">لا توجد أحداث بعد</div>'
          : '';

        let penHtml = '';
        if (d && d.penalties && (d.matchStatus === 'penalties' || isF)) {
          const hp = d.penalties.home || [], ap = d.penalties.away || [];
          const hGoals = hp.filter(r => r === 'goal').length;
          const aGoals = ap.filter(r => r === 'goal').length;
          const winnerName = hGoals !== aGoals ? (hGoals > aGoals ? ht.name : at.name) : '';

          function kickRow(list) {
            if (!list.length) return '<div class="pen-empty">—</div>';
            return `<div class="pen-kicks">${list.map((r, i) => `
              <span class="pen-kick ${r === 'goal' ? 'pen-in' : 'pen-out'}" title="ركلة ${i + 1}">
                ${window.Icon ? window.Icon(r === 'goal' ? 'check' : 'close', 12) : ''}
              </span>`).join('')}</div>`;
          }

          penHtml = `<div class="pen-card">
            <div class="pen-head">
              <span class="pen-head-ic">${window.Icon ? window.Icon('target', 15) : ''}</span>
              <span>ركلات الترجيح</span>
            </div>
            <div class="pen-teams">
              <div class="pen-team">
                <div class="pen-team-name">${ht.name}</div>
                <div class="pen-team-score">${hGoals}</div>
                ${kickRow(hp)}
              </div>
              <div class="pen-sep">—</div>
              <div class="pen-team">
                <div class="pen-team-name">${at.name}</div>
                <div class="pen-team-score">${aGoals}</div>
                ${kickRow(ap)}
              </div>
            </div>
            ${winnerName ? `<div class="pen-winner">${winnerName} يتأهل بركلات الترجيح</div>` : ''}
          </div>`;
        }

        return `<div class="vt-timeline">${teamsHeader}<div class="vt-line"></div>${rowsHtml}</div>${emptyHtml}${penHtml}`;
      }

      if (tabId === 'lineup') {
        const hl = m.homeLineup || (d && d.homeLineup);
        const al = m.awayLineup || (d && d.awayLineup);

        // ══ SVG الملاعب — نفس DD_PITCH_SVGS في admin-lineup-dragdrop.js ══
        const _VPitchSVG = {
          futsal: `<rect width="100%" height="100%" fill="#0a1f0a"/>
            <rect x="0" y="0" width="100%" height="32%" fill="#0c220c" opacity=".4"/>
            <rect x="0" y="64%" width="100%" height="32%" fill="#0c220c" opacity=".4"/>
            <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="3"/>
            <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
            <circle cx="50%" cy="50%" r="12%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <circle cx="50%" cy="50%" r="1.2%" fill="rgba(255,255,255,.4)"/>
            <rect x="26%" y="3%" width="48%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="38%" y="3%" width="24%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <rect x="26%" y="81%" width="48%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="38%" y="90%" width="24%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>`,
          seven: `<rect width="100%" height="100%" fill="#0a1f0a"/>
            <rect x="0" y="0" width="100%" height="25%" fill="#0c220c" opacity=".4"/>
            <rect x="0" y="50%" width="100%" height="25%" fill="#0c220c" opacity=".4"/>
            <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="2"/>
            <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
            <circle cx="50%" cy="50%" r="13%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <circle cx="50%" cy="50%" r="1.2%" fill="rgba(255,255,255,.4)"/>
            <rect x="20%" y="3%" width="60%" height="18%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="35%" y="3%" width="30%" height="8%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <rect x="20%" y="79%" width="60%" height="18%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="35%" y="89%" width="30%" height="8%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>`,
          full: `<rect width="100%" height="100%" fill="#0a1f0a"/>
            <rect x="0" y="0" width="100%" height="18%" fill="#0c220c" opacity=".4"/>
            <rect x="0" y="36%" width="100%" height="18%" fill="#0c220c" opacity=".4"/>
            <rect x="0" y="72%" width="100%" height="18%" fill="#0c220c" opacity=".4"/>
            <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="2"/>
            <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
            <circle cx="50%" cy="50%" r="14%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <circle cx="50%" cy="50%" r="1.2%" fill="rgba(255,255,255,.4)"/>
            <rect x="22%" y="3%" width="56%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="36%" y="3%" width="28%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <rect x="22%" y="81%" width="56%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
            <rect x="36%" y="90%" width="28%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <circle cx="5%"  cy="3%"  r="1.5%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <circle cx="95%" cy="3%"  r="1.5%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <circle cx="5%"  cy="97%" r="1.5%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
            <circle cx="95%" cy="97%" r="1.5%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>`,
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

          // نقاط اللاعبين
          const dots = starters.map((p, i) => {
            const x   = p.x ?? 50;
            const y   = p.y ?? 50;
            const isGK= i === 0;
            const num = p.number || (i + 1);
            const shortName = (p.name || '').split(' ').slice(-1)[0] || `${i+1}`;
            const aBg  = isGK ? 'rgba(142,68,173,.22)' : bgClr;
            const aBrd = isGK ? '#9B59B6'              : brdClr;
            const aTxt = isGK ? '#CE9FFC'              : txtClr;
            const cap  = lineup.captain && p.name && p.name === lineup.captain;
            return `<div style="position:absolute;left:${x}%;top:${y}%;
                transform:translate(-50%,-50%);display:flex;flex-direction:column;
                align-items:center;gap:2px;z-index:5">
              <div style="width:30px;height:30px;border-radius:50%;
                background:${aBg};border:2px solid ${aBrd};
                display:flex;align-items:center;justify-content:center;
                font-size:11px;font-weight:900;color:${aTxt};
                font-family:Tajawal,sans-serif;
                box-shadow:0 2px 8px rgba(0,0,0,.6)">
                ${cap ? '©' : num}
              </div>
              <div style="font-size:7px;font-weight:700;color:#fff;
                background:rgba(0,0,0,.8);border-radius:3px;
                padding:1px 5px;white-space:nowrap;max-width:50px;
                overflow:hidden;text-overflow:ellipsis;text-align:center;">
                ${shortName}
              </div>
            </div>`;
          }).join('');

          // البدلاء
          const subsHtml = subs.length ? `
            <div style="margin-top:10px;background:var(--s2);border:1px solid var(--b2);
              border-radius:10px;padding:10px">
              <div style="font-size:9px;font-weight:700;color:var(--t3);
                letter-spacing:1px;margin-bottom:6px">BENCH</div>
              ${subs.map(p => `
                <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                  border-bottom:1px solid var(--b1)">
                  <div style="width:22px;height:22px;border-radius:5px;
                    background:var(--s3);border:1px solid var(--b2);
                    display:flex;align-items:center;justify-content:center;
                    font-size:9px;font-weight:900;color:var(--t3);flex-shrink:0">
                    ${p.number||'—'}
                  </div>
                  <div style="font-size:11px;font-weight:700;color:var(--t2);flex:1">
                    ${p.name||'—'}
                  </div>
                  <div style="font-size:9px;color:var(--t3)">${p.position||''}</div>
                  ${p.status==='injured'   ? `<span style="font-size:8px;color:#C0392B;background:rgba(192,57,43,.1);border-radius:4px;padding:1px 5px">🤕</span>` : ''}
                  ${p.status==='suspended' ? `<span style="font-size:8px;color:#C9A02B;background:rgba(201,160,43,.1);border-radius:4px;padding:1px 5px">🟨</span>` : ''}
                  ${p.status==='absent'    ? `<span style="font-size:8px;color:#666;background:rgba(0,0,0,.2);border-radius:4px;padding:1px 5px">❌</span>` : ''}
                </div>`).join('')}
            </div>` : '';

          return `
            <div style="background:var(--s2);border:1px solid var(--b2);border-radius:12px;overflow:hidden">
              <!-- شريط أعلى الملعب -->
              <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:var(--s1);border-bottom:1px solid var(--b1)">
                <div style="font-size:10px;color:var(--t3)">${_vpPitchLabel(n)}</div>
                ${formation ? `<div style="font-size:11px;font-weight:900;
                  color:${isAway?'#C0392B':'var(--gold)'};
                  background:${isAway?'rgba(192,57,43,.1)':'rgba(201,160,43,.08)'};
                  border:1px solid ${isAway?'rgba(192,57,43,.3)':'rgba(201,160,43,.25)'};
                  border-radius:6px;padding:2px 10px">${formation}</div>` : ''}
              </div>
              <!-- الملعب -->
              <div style="position:relative;width:100%;aspect-ratio:9/16;
                max-height:380px;overflow:hidden">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none"
                  style="position:absolute;inset:0;width:100%;height:100%">
                  ${svg}
                </svg>
                ${dots}
              </div>
            </div>
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
              🏠 ${ht.name} ${hasHL ? '' : '(لم تُدخَل)'}
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
              ✈️ ${at.name} ${hasAL ? '' : '(لم تُدخَل)'}
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
          ${d.streamActive && d.streamUrl ? `<span class="mdh-stream">بث مباشر</span>` : ''}
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
    // ✅ badge اسم المرحلة لمباريات الشجرة
    const knockoutBadgeHtml = m.isKnockout && m.knockoutRoundName
      ? `<div style="text-align:center;margin-bottom:10px">
           <span style="font-size:11px;font-weight:800;color:#9b59b6;background:rgba(155,89,182,.1);border:1px solid rgba(155,89,182,.25);border-radius:20px;padding:4px 14px">
             🏆 ${m.knockoutRoundName}
           </span>
         </div>`
      : '';
    // ✅ بطاقة الراعي — راعي المباراة يتقدّم على راعي البطولة
    const _spHtml = (typeof window._spMatchHTML === 'function') ? window._spMatchHTML(m) : '';
    body.innerHTML = knockoutBadgeHtml + headerHtml + _spHtml + tabsHtml + contentHtml;

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


/* ✅ تصدير لـ matches-tabs.js — هذه الدوال module-scoped فلا تراها
   الملفات الأخرى. renderMatches تُستبدَل، والاثنتان الأخريان تُستدعيان. */
/* ✅ تصدير — match-share-card.js و matches-tabs.js تقرأ هذه.
   بلا التصدير ترجع undefined صامتة (نفس فخ OVERRIDES.md).
   نُحدّثها مع كل snapshot عبر _syncGlobals(). */
window.LEAGUE_ID = LEAGUE_ID;
window.formatTimeTo12H = formatTimeTo12H;
function _syncGlobals() {
  /* ✅ matches/teams عندها getter بس (Object.defineProperty فوق بالملف) —
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

/* ✅ FIX 10 — إعادة رسم فورية لكل الساعات.
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
    if (!clockEl) { clearInterval(_detailClocks[matchId]); return; }
    const m = (window.matches||[]).find(x => x.id === matchId);
    if (m && m.liveData) clockEl.innerHTML = _clock(m.liveData);
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

// console.log('[VIEWER V3] ✅ النظام الموحّد النهائي — بدون بنرات أو تكرار');
