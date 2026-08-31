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
window._fsDb = db;   // للبثّ المباشر (WebRTC receiver)
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

/* ✅︎ اسم صانع الهدف — بالهوية أولاً (يتبع تعديل الاسم فوراً كبقية الأسماء)،
   ويرجع لنص الحدث المخزّن للبيانات القديمة بلا هوية. */
function _liveAssistName(ev, teamId) {
  if (!ev || !ev.assist) return '';
  return _pName(teamId, ev.assistPlayerId, ev.assist || '');
}
window._liveAssistName = _liveAssistName;

/* هل تُعرض الصناعات للجمهور؟ يكفي تفعيل أحد المفتاحين من إعدادات البطولة:
   «صنّاع الأهداف» (قسم الإحصائيات) أو «اختيار الصانع مع الهدف» (الإدخال).
   المنطق: من يسجّل الصانع يريده ظاهراً — ومن أطفأ الاثنين لا يريده إطلاقاً. */
function _assistsPublic() {
  const s = window.settings || {};
  return !!(s.showAssists || s.showAssistPicker);
}
window._assistsPublic = _assistsPublic;

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
/* ════════════════════════════════════════════════════════════════════
 *  أنظمة البطولات الأربعة ومَن يملك ماذا — مرجع واحد لكل الفروع
 *   league   دوري نقاط        → ترتيب ✔  مجموعات ✘  شجرة ✘
 *   groups   مجموعات + إقصاء  → ترتيب ✘  مجموعات ✔  شجرة ✔
 *   knockout إقصاء مباشر      → ترتيب ✘  مجموعات ✘  شجرة ✔
 *   swiss    دوري موحّد        → ترتيب ✔  مجموعات ✘  شجرة ✔
 *  الدوري الموحّد يجمع الاثنين، ولهذا كان يسقط من الفروع المكتوبة يدوياً.
 * ════════════════════════════════════════════════════════════════════ */
/* ── قارئ موحّد لدور المواجهة (ذهاب/إياب) ──
   المنصة كتبت الحقل باسمين مختلفين تاريخياً: `leg` في مباريات الدوري
   والمجموعات، و`legNo` في مباريات الإقصاء — والجمهور كان يقرأ `legNo`
   وحده، فمباريات ذهاب/إياب الدوري والمجموعات **لا تُوسَم إطلاقاً**.
   هذا القارئ يقبل الاثنين فلا تضيع أي مباراة أياً كان مصدرها. */
function _legOf(m) {
  if (!m) return 0;
  const v = (m.legNo != null) ? m.legNo : m.leg;
  const n = parseInt(v, 10);
  return (n === 1 || n === 2) ? n : 0;
}
window._legOf = _legOf;
const _legLabel = n => n === 1 ? 'ذهاب' : n === 2 ? 'إياب' : '';
window._legLabel = _legLabel;

/* ── مناطق الترتيب: قواعد {from,to,label,color} يحدّدها المنظّم ──
   مع ترجمة تلقائية من النظام القديم (six zones بعدّاد لكل واحدة) كي لا
   تفقد البطولات القائمة تلوينها. */
/* ── حالات الفرق في المجموعات (مصدر واحد للأدمن والجمهور) ── */
/* أيقونات SVG لا إيموجي — الإيموجي يختلف شكله بين الأجهزة فيكسر انتظام
   الصفوف، وبعضه لا يُرسم على أندرويد قديم فتظهر الشارة بلا رمز. */
const VIEWER_STATUSES = {
  qualified:  { label: 'متأهل',            ic: 'check',  color: '#27ae60', qualified: true  },
  qualifiedC: { label: 'متأهل مشروط',      ic: 'clock',  color: '#3B7DBF', qualified: true  },
  playoff:    { label: 'ملحق',             ic: 'swords', color: '#D35400', qualified: false },
  eliminated: { label: 'خرج',              ic: 'close',  color: '#C0392B', qualified: false },
  withdrew:   { label: 'منسحب',            ic: 'minus',  color: '#8e44ad', qualified: false },
  banned:     { label: 'مستبعَد',           ic: 'lock',   color: '#7f1d1d', qualified: false }
};
function _viewerStatusMeta(k) {
  return VIEWER_STATUSES[k] || { label: '', ic: '', color: 'var(--t3)', qualified: false };
}
function _statusChip(k) {
  const m = _viewerStatusMeta(k);
  if (!m.label) return '';
  const ic = (m.ic && window.Icon) ? window.Icon(m.ic, 10, m.color) : '';
  return `<span class="gt-status" style="color:${m.color};background:${m.color}1a;border-color:${m.color}55">${ic}${m.label}</span>`;
}
/* خريطة teamStatus الجديدة أولاً، ثم الحقلان القديمان للتوافق */
function _viewerTeamStatus(g, teamId) {
  if (g && g.teamStatus && g.teamStatus[teamId] != null) return g.teamStatus[teamId] || '';
  if (g && (g.qualifiedTeamIds  || []).includes(teamId)) return 'qualified';
  if (g && (g.eliminatedTeamIds || []).includes(teamId)) return 'eliminated';
  return '';
}
window._viewerTeamStatus = _viewerTeamStatus;

/* ── خصم النقاط: يُقرأ من مستند الفريق ويُطرح في كل مواضع الحساب ── */
/* ── شارة حالة الفريق بجانب اسمه ──
   ليست عموداً مستقلاً: العمود يضغط بقية الأعمدة ويكسر انتظام الجدول.
   الشارة تجلس داخل خانة الفريق بعد الاسم، صغيرة وبلون حالتها، وتنكمش
   قبل الاسم عند ضيق المساحة فلا تزيح شيئاً. */
const _SW_SHORT = { qualified:'متأهل', qualifiedC:'مشروط', playoff:'ملحق',
                    eliminated:'خرج', withdrew:'منسحب', banned:'مستبعَد' };
function _swStatusOfV(teamId) {
  if ((window.settings && window.settings.type) !== 'swiss') return '';
  const m = (window.settings && window.settings.swissTeamStatus) || {};
  if (m[teamId] != null) return m[teamId] || '';
  return ((window.settings && window.settings.swissQualifiedIds) || []).includes(teamId) ? 'qualified' : '';
}
function _swNameChip(teamId) {
  const k = _swStatusOfV(teamId);
  if (!k) return '';
  const meta = _viewerStatusMeta(k);
  const ic = (meta.ic && window.Icon) ? window.Icon(meta.ic, 8, meta.color) : '';
  return `<span class="std-tag" style="color:${meta.color};background:${meta.color}1c;border-color:${meta.color}4d">${ic}${_SW_SHORT[k] || meta.label}</span>`;
}
window._swStatusOfV = _swStatusOfV;

function _deductionOfV(teamId) {
  const t = (window.teams || []).find(x => x.id === teamId);
  const n = t ? parseInt(t.deduction, 10) : 0;
  return (!isNaN(n) && n > 0) ? n : 0;
}
function _deductionBadgeV(teamId) {
  const d = _deductionOfV(teamId);
  return d ? `<span class="std-ded" title="خُصمت ${d} نقطة">-${d}</span>` : '';
}
window._deductionOfV = _deductionOfV;

function _viewerZoneRules() {
  const s = window.settings || {};
  if (Array.isArray(s.zoneRules)) return s.zoneRules;
  const z = s.zones || {};
  const LEGACY = [
    ['champion', 'بطل البطولة',  'var(--gold)'],
    ['qualify',  'متأهل',        'var(--green)'],
    ['cond',     'متأهل مشروط',  'var(--blue)'],
    ['normal',   'عادي',         '#666'],
    ['playoff',  'ملحق التأهّل', 'var(--orange)'],
    ['relegate', 'هابط',         'var(--red)']
  ];
  const out = []; let pos = 1;
  LEGACY.forEach(([k, label, color]) => {
    const n = parseInt(z[k], 10) || 0;
    if (n > 0) { out.push({ from: pos, to: pos + n - 1, label, color }); pos += n; }
  });
  return out;
}
function _viewerZoneAt(rules, rank) {
  for (const r of rules) {
    if (rank >= (parseInt(r.from,10)||1) && rank <= (parseInt(r.to,10)||1)) return r;
  }
  return null;
}

const _HAS_BRACKET   = t => t === 'knockout' || t === 'groups' || t === 'swiss';
const _HAS_STANDINGS = t => t === 'league'   || t === 'swiss';
const _HAS_GROUPS    = t => t === 'groups';
window._HAS_BRACKET = _HAS_BRACKET;
window._HAS_STANDINGS = _HAS_STANDINGS;
window._HAS_GROUPS = _HAS_GROUPS;

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
    /* 🔴 كان يستثني swiss — فتصل بيانات الشجرة ولا يُعاد الرسم أبداً،
       فتبقى شجرة الدوري الموحّد فارغة أو عالقة على «جارِ التحميل».
       الشجرة موجودة في ثلاثة أنظمة: إقصاء · مجموعات · دوري موحّد. */
    if(tournamentType==='knockout'||tournamentType==='groups'||tournamentType==='swiss') window.renderAll();
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
/* ════════════════════════════════════════════════════════════════════
 *  صورة اللاعب — مطابقة صارمة تمنع خلط الصور بين المتشابهين في الاسم
 *  ──────────────────────────────────────────────────────────────────
 *  الخلل السابق (خطير): عند فشل العثور على صورة داخل فريق اللاعب، كانت
 *  الدالة تمسح **كل فرق البطولة** وترجع صورة أي لاعب يحمل نفس الاسم.
 *  فـ«محمد» في فريق أ كان يظهر بصورة «محمد» في فريق ب. وداخل الفريق
 *  الواحد، المطابقة بالاسم وحده كانت تعطي صورة زميله المتشابه في الاسم.
 *
 *  القواعد الجديدة (بالترتيب، وأول قاعدة تحسم تُنهي البحث):
 *   ① الهوية (id) هي المرجع المطلق: إن وُجد سجلّ بها في كشف الفريق فهو
 *     اللاعب — نرجع صورته أو لا شيء. ولا ننتقل للاسم إطلاقاً، لأن وجود
 *     الهوية يعني أن اللاعب معروف تماماً وغياب صورته حقيقة لا نقص بحث.
 *   ② الاسم + رقم القميص: مطابقة دقيقة تفصل بين المتشابهين داخل الفريق.
 *   ③ الاسم وحده: **فقط** إن كان الاسم فريداً في الكشف. لو تكرّر ولم
 *     نملك رقماً يفصل بينهم، نرجع فراغاً — لأن عرض ظلّ اللاعب أصدق
 *     من عرض صورة شخص آخر.
 *   ④ لا مسح عابر للفرق مطلقاً: بلا teamId لا صورة.
 * ════════════════════════════════════════════════════════════════════ */
function _lineupPhoto(playerOrId, teamId) {
  if (!window._teamRosters) return '';
  const p = (typeof playerOrId === 'object' && playerOrId) ? playerOrId : { id: playerOrId };
  const roster = teamId ? window._teamRosters[teamId] : null;
  if (!roster || !roster.length) return '';

  const _norm = s => String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

  // ① الهوية تحسم وحدها — لا رجوع للاسم بعدها
  const pid = (p.id != null && p.id !== '') ? String(p.id) : '';
  if (pid) {
    const hit = roster.find(x => x && String(x.id) === pid);
    if (hit) return hit.photo || '';
    // هوية غير موجودة في الكشف (لاعب حُذف مثلاً) → نُكمل بالاسم بحذر
  }

  const n = _norm(p.name);
  if (!n) return '';
  const sameName = roster.filter(x => x && _norm(x.name) === n);
  if (!sameName.length) return '';

  // ② الاسم + الرقم
  if (p.number != null && p.number !== '') {
    const byNum = sameName.find(x => String(x.number) === String(p.number));
    return byNum ? (byNum.photo || '') : '';
  }

  // ③ الاسم وحده — بشرط ألا يكون مكرّراً داخل الفريق
  if (sameName.length === 1) return sameName[0].photo || '';

  // ④ اسم مكرّر بلا رقم يفصل → لا نخمّن
  return '';
}
window._lineupPhoto = _lineupPhoto;

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
  /* صورة اللاعب — عبر المصدر الموحّد نفسه (_lineupPhoto) بقواعده الصارمة،
     فلا تظهر صورة لاعب آخر يحمل نفس الاسم لا من فريقه ولا من فريق آخر. */
  const _pPhoto = (typeof _lineupPhoto === 'function')
    ? _lineupPhoto({ id: player.playerId || null, name: player.name || '' }, player.teamId)
    : '';
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
  // خزّن بيانات اللاعب الحالي للمشاركة + فعّل زر المشاركة
  window._shCurrentPlayer = {
    player, team, appearances, yellowCount, redCount, assistCount,
    playerMatches: playerMatches.slice(0,5)
  };
  const shBtn = document.getElementById('shPlayerBtn');
  if (shBtn) shBtn.innerHTML = _shButton('_shSharePlayerStats()', 'مشاركة الإحصائيات');
  document.getElementById('playerModalOverlay').classList.add('open');
};
window.closePlayerModal = function() {
  document.getElementById('playerModalOverlay').classList.remove('open');
};

// ════════════════════════════════════════
//  GROUPS
// ════════════════════════════════════════
function computeGroupStats(teamIds, groupId) {
  const stats={};
  teamIds.forEach(id=>{ stats[id]={pts:0,p:0,w:0,d:0,l:0,gf:0,ga:0}; });
  /* 🔴 كان يحتسب أي مباراة منتهية بين فريقين من المجموعة — بما فيها
     **مباريات الإقصاء**. فريقان من نفس المجموعة يلتقيان لاحقاً في ربع
     النهائي فتُضاف نتيجتهما لجدول المجموعة وتفسده. نستبعد الإقصاء،
     ونحصر بـ groupId حين يكون مسجّلاً على المباراة (أدقّ من العضوية). */
  matches.filter(m=>m.status==='finished' && !m.isKnockout && !m.knockoutRoundId
                    && (!groupId || !m.groupId || m.groupId===groupId)).forEach(m=>{
    if(teamIds.includes(m.homeId)&&teamIds.includes(m.awayId)) {
      const h=stats[m.homeId], a=stats[m.awayId];
      if(!h||!a) return;
      h.p++;a.p++; h.gf+=(m.homeScore||0);h.ga+=(m.awayScore||0);a.gf+=(m.awayScore||0);a.ga+=(m.homeScore||0);
      if(m.homeScore>m.awayScore) { h.w++;h.pts+=settings.winPts||3;a.l++; }
      else if(m.homeScore<m.awayScore) { a.w++;a.pts+=settings.winPts||3;h.l++; }
      else { h.d++;a.d++;h.pts+=settings.drawPts||1;a.pts+=settings.drawPts||1; }
    }
  });
  // ➖ خصم النقاط يسري على جداول المجموعات أيضاً
  teamIds.forEach(id => { const d = _deductionOfV(id); if (d && stats[id]) stats[id].pts -= d; });
  return stats;
}

// أيقونات SVG أنيقة (بدل الإيموجي) لشارات التأهل/الإخراج — تُبنى مرة، خفيفة الوزن
// ══════════════════════════════════════════════════════════════════
//  🔗 نظام المشاركة الموحّد للجمهور (تشكيلة / هدّافون / لاعب / مجموعة)
//  يبني صورة Canvas بهوية المنصة + نص منشور مرتّب + رابط، ويشاركها.
// ══════════════════════════════════════════════════════════════════
const _SH_GOLD = '#C9A02B', _SH_GOLD2 = '#F0C84A', _SH_DARK = '#080808', _SH_STEEL = '#3A4A5E';

// ── تحويل لون HEX إلى "r,g,b" (مطابق لدالة hexToRgb في cards-system.js) ──
function _shHexToRgb(hex){
  hex = (hex||'').replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const n = parseInt(hex,16);
  if (isNaN(n)) return '201,160,43';
  return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
}

// أيقونة مشاركة SVG أنيقة (لا نص) — تُستخدم في كل أزرار المشاركة الجديدة
function _shShareIconSvg(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>';
}
// زر مشاركة موحّد: دائري صغير، ذهبي عند التحويم، بلا نص — يُدرَج بـ HTML string
function _shButton(onclickAttr, title, extraStyle){
  return `<button class="sh-round-btn" onclick="${onclickAttr}" title="${title||'مشاركة'}" aria-label="مشاركة" style="${extraStyle||''}">${_shShareIconSvg()}</button>`;
}
// رابط صفحة الجمهور الحالية (نفس منطق cards-system لضمان رابط سليم)
function _shPublicUrl(){
  try{
    return `${location.origin}${location.pathname.replace(/\/[^/]*$/,'/')}league-viewer.html?id=${window.LEAGUE_ID}`;
  }catch(e){ return location.href; }
}
function _shLeagueName(){ return (window.league && window.league.name) || 'منصة بطولات'; }

// نص المشاركة الموحّد: عنوان واضح لنوع الصورة + تفاصيل + رابط المنصة — نفس أسلوب أزرار الإدارة
function _shBuildText(kind, lines){
  const L = [];
  const name = _shLeagueName();
  L.push('🏆 *' + name + '*');
  L.push('');
  L.push(...lines);
  L.push('');
  L.push('━━━━━━━━━━━━━━');
  L.push('📲 تابع كل التفاصيل والبث المباشر:');
  L.push(_shPublicUrl());
  L.push('');
  L.push('_منصة بطولات_');
  return L.join('\n');
}

// مشاركة صورة Canvas + نص — يفتح مشاركة النظام (يدعم الصورة)، وإلا تنزيل + نسخ نص
async function _shShareCanvas(canvas, text, filename){
  try{
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.95));
    if(!blob) throw new Error('no blob');
    const file = new File([blob], (filename||'card')+'.png', {type:'image/png'});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({title:_shLeagueName(), text, files:[file]});
      return;
    }
    // بديل: تنزيل + نسخ النص
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=(filename||'card')+'.png'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    if(navigator.clipboard) navigator.clipboard.writeText(text).catch(()=>{});
    if(window.showToast) window.showToast('تم حفظ الصورة ونسخ النص — الصقه عند النشر', 'success');
  }catch(e){
    if(window.showToast) window.showToast('تعذّرت المشاركة', 'error');
    console.warn('_shShareCanvas', e);
  }
}

// ── أدوات رسم مشتركة بهوية المنصة (خلفية داكنة + إطار ذهبي + شريط علوي/سفلي) ──
function _shLoadImg(src){
  return new Promise(res=>{
    if(!src){ res(null); return; }
    if(String(src).length <= 4){ res(null); return; } // إيموجي، لا صورة
    const img = new Image(); img.crossOrigin='anonymous';
    img.onload = ()=>res(img); img.onerror = ()=>res(null);
    img.src = src;
  });
}
// ✅ رسم صورة/شعار داخل مربّع (عادة داخل قصّ دائري) بمنطق "cover" — يملأ المساحة
//    كاملة دون أي تمطيط أو تشويه للشعار (بدل drawImage المباشر الذي كان "يمطّط"
//    أي صورة غير مربّعة الأبعاد لتناسب القُطر، فتخرج بيضاوية الشكل).
//    x,y = أعلى-يسار مربّع الوجهة، size = ضلع المربّع (مطابق لقُطر الدائرة المستخدمة للقصّ).
function _shDrawImgCover(ctx, img, x, y, size){
  if(!img) return;
  const iw = img.naturalWidth || img.width || size;
  const ih = img.naturalHeight || img.height || size;
  if(!iw || !ih){ ctx.drawImage(img, x, y, size, size); return; }
  const srcRatio = iw/ih;
  let sx, sy, sw, sh;
  if(srcRatio > 1){ sh = ih; sw = ih; sx = (iw-sw)/2; sy = 0; }        // أعرض من طولها → قصّ الجانبين
  else            { sw = iw; sh = iw; sx = 0; sy = (ih-sh)/2; }        // أطول من عرضها → قصّ أعلى/أسفل
  ctx.drawImage(img, sx, sy, sw, sh, x, y, size, size);
}
// ══════════════════════════════════════════════════════════════════
//  🎨 مكتبة أيقونات رياضية (SVG مرسومة مباشرة على Canvas)
//  بديل احترافي عن الإيموجي — تظهر بشكل موحّد ومتقن على كل الأجهزة
// ══════════════════════════════════════════════════════════════════
const _shIcons = {
  // كرة قدم — دوائر وخطوط الخماسي التقليدي (أسلوب outline يعمل مع أي لون)
  ball(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y);
    ctx.strokeStyle=color; ctx.lineWidth=s*0.06;
    ctx.beginPath(); ctx.arc(0,0,s/2,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,s*0.16,0,Math.PI*2); ctx.stroke();
    for(let i=0;i<5;i++){
      const a = -Math.PI/2 + i*(Math.PI*2/5);
      const x1=Math.cos(a)*s*0.16, y1=Math.sin(a)*s*0.16;
      const x2=Math.cos(a)*s*0.42, y2=Math.sin(a)*s*0.42;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineWidth=s*0.045; ctx.stroke();
    }
    ctx.restore();
  },
  // كأس (بطولة/إحصائيات)
  trophy(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=s*0.05;
    ctx.beginPath();
    ctx.moveTo(s*0.28,s*0.08); ctx.lineTo(s*0.72,s*0.08);
    ctx.lineTo(s*0.68,s*0.42);
    ctx.quadraticCurveTo(s*0.5,s*0.58,s*0.32,s*0.42);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s*0.28,s*0.12); ctx.quadraticCurveTo(s*0.05,s*0.14,s*0.1,s*0.32); ctx.quadraticCurveTo(s*0.14,s*0.42,s*0.3,s*0.36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.72,s*0.12); ctx.quadraticCurveTo(s*0.95,s*0.14,s*0.9,s*0.32); ctx.quadraticCurveTo(s*0.86,s*0.42,s*0.7,s*0.36); ctx.stroke();
    ctx.fillRect(s*0.44,s*0.56,s*0.12,s*0.18);
    ctx.beginPath(); ctx.moveTo(s*0.3,s*0.82); ctx.lineTo(s*0.7,s*0.82); ctx.lineTo(s*0.62,s*0.72); ctx.lineTo(s*0.38,s*0.72); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  // ميدالية (ترتيب الهدافين)
  medal(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=s*0.05;
    ctx.beginPath(); ctx.arc(0,s*0.08,s*0.34,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(0,s*0.08,s*0.22,0,Math.PI*2); ctx.fill();
    ctx.restore();
  },
  // حذاء (هدّاف/أهداف)
  boot(ctx,x,y,s,color){
    /* حذاء بأسلوب outline — النسخة المصمتة السابقة كانت تتحوّل إلى كتلة
       غير مفهومة عند 13-16px (الحجم المستخدم فعلياً في البطاقات). */
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.085;
    ctx.lineJoin='round'; ctx.lineCap='round';
    const u=s/24;
    ctx.beginPath();
    ctx.moveTo(-9*u,-6*u); ctx.lineTo(-4.5*u,-6*u); ctx.lineTo(-2.6*u,-2.4*u);
    ctx.lineTo(2.6*u,-1*u);
    ctx.quadraticCurveTo(7.6*u,0.4*u,8*u,4.4*u);
    ctx.lineTo(8*u,6.6*u); ctx.lineTo(-9*u,6.6*u); ctx.closePath(); ctx.stroke();
    ctx.lineWidth=s*0.07;
    [-6,-2.5,1,4.5].forEach(px=>{
      ctx.beginPath(); ctx.moveTo(px*u,6.6*u); ctx.lineTo(px*u,9*u); ctx.stroke();
    });
    ctx.restore();
  },
  boots(ctx,x,y,s,color){ _shIcons.boot(ctx,x,y,s,color); },
  // ── أيقونات شريط هوية اللاعب (كانت ناقصة فكانت تُرسم فراغاً) ──
  shirt(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.09;
    ctx.lineJoin='round'; ctx.lineCap='round';
    const u=s/24; ctx.beginPath();
    ctx.moveTo(-4*u,-9*u); ctx.lineTo(0,-7*u); ctx.lineTo(4*u,-9*u);
    ctx.lineTo(9*u,-6*u); ctx.lineTo(7*u,-2*u); ctx.lineTo(5*u,-2*u);
    ctx.lineTo(5*u,9*u); ctx.lineTo(-5*u,9*u); ctx.lineTo(-5*u,-2*u);
    ctx.lineTo(-7*u,-2*u); ctx.lineTo(-9*u,-6*u); ctx.closePath(); ctx.stroke();
    ctx.restore();
  },
  field(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.08;
    const u=s/24;
    ctx.strokeRect(-10*u,-7*u,20*u,14*u);
    ctx.beginPath(); ctx.moveTo(0,-7*u); ctx.lineTo(0,7*u); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,3*u,0,Math.PI*2); ctx.stroke();
    ctx.strokeRect(-10*u,-3.5*u,3*u,7*u);
    ctx.strokeRect(7*u,-3.5*u,3*u,7*u);
    ctx.restore();
  },
  globe(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.08;
    const r=s*0.42;
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0,0,r*0.45,r,0,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  },
  user(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.09;
    ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(0,-s*0.16,s*0.19,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,s*0.34,s*0.34,Math.PI*1.08,Math.PI*1.92); ctx.stroke();
    ctx.restore();
  },
  // تقويم (المباريات)
  calendar(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.07;
    _shRoundRect(ctx,0,s*0.14,s,s*0.8,s*0.08); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,s*0.36); ctx.lineTo(s,s*0.36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.26,0); ctx.lineTo(s*0.26,s*0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.74,0); ctx.lineTo(s*0.74,s*0.22); ctx.stroke();
    ctx.fillStyle=color;
    ctx.fillRect(s*0.22,s*0.5,s*0.14,s*0.14); ctx.fillRect(s*0.44,s*0.5,s*0.14,s*0.14); ctx.fillRect(s*0.66,s*0.5,s*0.14,s*0.14);
    ctx.restore();
  },
  // منحنى صاعد (المعدّل/الإحصائيات)
  trending(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.08; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(0,s*0.75); ctx.lineTo(s*0.32,s*0.42); ctx.lineTo(s*0.5,s*0.58); ctx.lineTo(s,s*0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.68,s*0.12); ctx.lineTo(s,s*0.12); ctx.lineTo(s,s*0.42); ctx.stroke();
    ctx.restore();
  },
  // بطاقة صفراء/حمراء (مستطيل بحواف دائرية)
  card(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s*0.35,y-s/2);
    ctx.fillStyle=color; _shRoundRect(ctx,0,0,s*0.7,s,s*0.12); ctx.fill();
    ctx.restore();
  },
  // مجموعة أشخاص (المجموعات)
  users(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.fillStyle=color;
    ctx.beginPath(); ctx.arc(-s*0.18,-s*0.08,s*0.16,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.18,-s*0.08,s*0.16,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-s*0.18,s*0.28,s*0.24,s*0.2,0,Math.PI,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s*0.18,s*0.28,s*0.24,s*0.2,0,Math.PI,Math.PI*2); ctx.fill();
    ctx.restore();
  },
  // نجمة (لقب/تميّز)
  star(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.fillStyle=color;
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const a1=-Math.PI/2+i*(Math.PI*2/5), a2=a1+Math.PI/5;
      const x1=Math.cos(a1)*s/2, y1=Math.sin(a1)*s/2;
      const x2=Math.cos(a2)*s*0.22, y2=Math.sin(a2)*s*0.22;
      if(i===0) ctx.moveTo(x1,y1); else ctx.lineTo(x1,y1);
      ctx.lineTo(x2,y2);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  // هدف/شبكة (قناص)
  target(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.07;
    [0.5,0.32,0.14].forEach(r=>{ ctx.beginPath(); ctx.arc(0,0,s*r,0,Math.PI*2); ctx.stroke(); });
    ctx.restore();
  },
  // شارة تحقق (متأهل)
  check(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.16; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(s*0.15,s*0.52); ctx.lineTo(s*0.4,s*0.78); ctx.lineTo(s*0.85,s*0.22); ctx.stroke();
    ctx.restore();
  },
  // سيوف متقاطعة (VS بين مساري الشجرة)
  swords(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.1; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(s*0.12,s*0.12); ctx.lineTo(s*0.88,s*0.88); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.88,s*0.12); ctx.lineTo(s*0.12,s*0.88); ctx.stroke();
    ctx.fillStyle=color;
    ctx.beginPath(); ctx.arc(s*0.12,s*0.12,s*0.07,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.88,s*0.12,s*0.07,0,Math.PI*2); ctx.fill();
    ctx.restore();
  },
  // سهم لأسفل (انتقال بين أدوار الشجرة)
  arrowDown(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.14; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(s*0.5,s*0.08); ctx.lineTo(s*0.5,s*0.82); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.25,s*0.58); ctx.lineTo(s*0.5,s*0.9); ctx.lineTo(s*0.75,s*0.58); ctx.stroke();
    ctx.restore();
  },
  // علامة خروج (إقصاء)
  cross(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.strokeStyle=color; ctx.lineWidth=s*0.14; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(s*0.2,s*0.2); ctx.lineTo(s*0.8,s*0.8); ctx.moveTo(s*0.8,s*0.2); ctx.lineTo(s*0.2,s*0.8); ctx.stroke();
    ctx.restore();
  },
  // درع (حراسة/دفاع صلب)
  shield(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(s*0.5,0); ctx.lineTo(s*0.95,s*0.16); ctx.lineTo(s*0.95,s*0.5);
    ctx.quadraticCurveTo(s*0.95,s*0.85,s*0.5,s);
    ctx.quadraticCurveTo(s*0.05,s*0.85,s*0.05,s*0.5);
    ctx.lineTo(s*0.05,s*0.16); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  // شارة نار (فورمة عالية/مقاتل)
  fire(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x-s/2,y-s/2); ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(s*0.5,0);
    ctx.quadraticCurveTo(s*0.9,s*0.35,s*0.65,s*0.55);
    ctx.quadraticCurveTo(s*0.75,s*0.3,s*0.55,s*0.25);
    ctx.quadraticCurveTo(s*0.6,s*0.5,s*0.4,s*0.6);
    ctx.quadraticCurveTo(s*0.2,s*0.7,s*0.3,s*0.9);
    ctx.quadraticCurveTo(s*0.05,s*0.75,s*0.1,s*0.5);
    ctx.quadraticCurveTo(s*0.15,s*0.2,s*0.5,0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  // موبايل/بث (متابعة)
  broadcast(ctx,x,y,s,color){
    ctx.save(); ctx.translate(x,y); ctx.strokeStyle=color; ctx.lineWidth=s*0.09; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(0,s*0.1,s*0.1,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
    ctx.beginPath(); ctx.arc(0,s*0.1,s*0.28,-Math.PI*0.75,-Math.PI*0.25); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,s*0.1,s*0.44,-Math.PI*0.75,-Math.PI*0.25); ctx.stroke();
    ctx.restore();
  },
};
// رسم أيقونة بمربع خلفية دائري خفيف (أسلوب "شارة") — تُستخدم في العناوين والإحصائيات
function _shIconBadge(ctx, name, x, y, size, color, bgAlpha){
  if(bgAlpha){
    ctx.fillStyle = color + Math.round(bgAlpha*255).toString(16).padStart(2,'0');
    ctx.beginPath(); ctx.arc(x, y, size*0.62, 0, Math.PI*2); ctx.fill();
  }
  const fn = _shIcons[name];
  if(fn) fn(ctx, x, y, size, color);
}

function _shRoundRect(ctx,x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
// خلفية رياضية احترافية: تدرّج داكن + ملمس خطوط قطرية خفيفة (يوحي بالملعب) + توهّج زوايا + إطار مزدوج
// ✅ موحّدة مع قسم "بطاقات المشاركة" بالإدارة (cards-system.js → drawBackground)
// نفس التدرّج، نفس الأشرطة القطرية، نفس الأشرطة العلوية/السفلية الذهبية المزدوجة،
// نفس الإطار الدائري ونفس ختم الملعب التكتيكي — لضمان هوية بصرية واحدة للمنصّة كاملة.
function _shBg(ctx,W,H,accentHex){
  const ac  = accentHex || _SH_GOLD;
  const rgb = _shHexToRgb(ac);
  const st  = _shHexToRgb(_SH_STEEL);

  // ✅ تدرّج أغمق بكثير — الأولوية لوضوح الأسماء والشعارات فوق الخلفية، لا لزخرفتها
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,   '#0d0e12');
  bg.addColorStop(0.45,'#08090c');
  bg.addColorStop(1,   '#040405');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // أشرطة قطرية خافتة جداً (بالكاد محسوسة) — لمسة حركة بلا إزعاج بصري
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = -2; i < 8; i++) {
    const x = i * (W / 6);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + W * 0.28, 0);
    ctx.lineTo(x + W * 0.28 - H * 0.5, H);
    ctx.lineTo(x - H * 0.5, H);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? `rgba(${rgb},0.010)` : `rgba(${st},0.010)`;
    ctx.fill();
  }
  ctx.restore();

  // توهّج قطري علوي خافت جداً من الزاوية (طاقة بسيطة بلا تأثير على وضوح المحتوى)
  const cg = ctx.createRadialGradient(W*0.82, H*0.08, 0, W*0.82, H*0.08, W*0.85);
  cg.addColorStop(0, `rgba(${rgb},0.09)`);
  cg.addColorStop(0.5, `rgba(${rgb},0.02)`);
  cg.addColorStop(1, 'transparent');
  ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);

  // إضاءة سفلية خافتة جداً (توازن بسيط فقط)
  const bgl = ctx.createRadialGradient(W*0.2, H*0.95, 0, W*0.2, H*0.95, W*0.7);
  bgl.addColorStop(0, `rgba(${st},0.05)`);
  bgl.addColorStop(1, 'transparent');
  ctx.fillStyle = bgl; ctx.fillRect(0, 0, W, H);

  // شريط علوي مزدوج ذهبي (أعرض = طاقة أكبر)
  ctx.fillStyle = ac; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = `rgba(${st},0.6)`; ctx.fillRect(0, 8, W, 3);
  // شريط سفلي مطابق
  ctx.fillStyle = ac; ctx.fillRect(0, H-8, W, 8);
  ctx.fillStyle = `rgba(${st},0.6)`; ctx.fillRect(0, H-11, W, 3);

  // إطار خارجي رفيع
  const pad = 26;
  ctx.strokeStyle = `rgba(${rgb},0.26)`;
  ctx.lineWidth = 1.5;
  _shRoundRect(ctx, pad, pad, W - pad*2, H - pad*2, 22);
  ctx.stroke();

  // watermark رياضي خفيف جداً: دائرة تكتيكية (كلوحة المدرّب) — داكنة وخافتة
  // كي تبقى واضحة كلمسة تصميم فقط دون التأثير على وضوح النقاط والتفاصيل فوقها،
  // ومحسوبة بحجم يعتمد على أصغر بُعد (W أو H) حتى لا تتضخم في البطاقات الطويلة (كالمجموعات)
  ctx.save();
  ctx.strokeStyle = `rgba(${rgb},0.022)`;
  ctx.lineWidth = 2;
  const wmBase = Math.min(W, H);
  const wmY = H * 0.55, wmR = wmBase * 0.30;
  ctx.beginPath(); ctx.arc(W/2, wmY, wmR, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W/2, wmY, wmR*0.6, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W/2-wmR, wmY); ctx.lineTo(W/2+wmR, wmY); ctx.stroke();
  ctx.restore();
}
// عنوان البطاقة بأسلوب رياضي: أيقونة SVG دائرية أعلى، عنوان تحتها،
// وفاصل مزدوج (ذهبي + فولاذي) مطابق تماماً لفاصل شريط الهوية بقسم بطاقات المشاركة بالإدارة
// ✅ ميدالية البطولة المصغّرة — نفس تصميم "الوسام الرسمي" المستخدم بشريط الهوية بقسم
//    بطاقات المشاركة بالإدارة (شعار دائري + توهج + إشعاعات + حلقة مزدوجة + اسم بتدرّج
//    ذهبي محاط بنجمتين)، بمقاس مصغّر يناسب أعلى بطاقات الجمهور. تُستخدم داخل _shHeader
//    فتُوحَّد هوية كل البطاقات (الإدارة والجمهور) تحت نفس الشكل بالضبط.
async function _shLeagueMedallion(ctx, W, topY){
  const name = _shLeagueName();
  const R = 30, medalCY = topY + 58;
  const rgb = _shHexToRgb(_SH_GOLD), st = _shHexToRgb(_SH_STEEL);
  const cx = W/2;

  const glow = ctx.createRadialGradient(cx, medalCY, 0, cx, medalCY, R*2.4);
  glow.addColorStop(0, `rgba(${rgb},0.28)`); glow.addColorStop(0.5, `rgba(${rgb},0.07)`); glow.addColorStop(1,'transparent');
  ctx.fillStyle = glow; ctx.fillRect(cx-R*2.4, medalCY-R*2.4, R*4.8, R*4.8);

  const ticks = 12;
  for (let i=0;i<ticks;i++){
    const a = (i/ticks)*Math.PI*2;
    const r1 = R+6, r2 = R+(i%2===0?12:9);
    ctx.strokeStyle = i%2===0 ? `rgba(${rgb},0.5)` : `rgba(${st},0.35)`;
    ctx.lineWidth = i%2===0?1.6:1;
    ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*r1, medalCY+Math.sin(a)*r1); ctx.lineTo(cx+Math.cos(a)*r2, medalCY+Math.sin(a)*r2); ctx.stroke();
  }

  ctx.beginPath(); ctx.arc(cx, medalCY, R+4, 0, Math.PI*2);
  ctx.strokeStyle = _SH_GOLD; ctx.lineWidth = 2.2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, medalCY, R+0.5, 0, Math.PI*2);
  ctx.strokeStyle = `rgba(${_shHexToRgb(_SH_GOLD2)},0.6)`; ctx.lineWidth = 1; ctx.stroke();

  ctx.beginPath(); ctx.arc(cx, medalCY, R, 0, Math.PI*2); ctx.fillStyle='#0a0b0d'; ctx.fill();
  const logoImg = await _shLoadImg((window.league && window.league.logo) || '');
  if (logoImg) {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, medalCY, R-3, 0, Math.PI*2); ctx.clip();
    _shDrawImgCover(ctx, logoImg, cx-(R-3), medalCY-(R-3), (R-3)*2); ctx.restore();
  } else {
    _shIconBadge(ctx, 'trophy', cx, medalCY, R*1.05, _SH_GOLD, 0);
  }

  const nameY = medalCY + R + 34;
  const starSz = 10, starGap = 12, sidePad = 70;
  const maxNameW = W - sidePad*2 - (starSz*2+starGap*2+30);
  let fs = 20;
  ctx.font = `bold ${fs}px Tajawal,Arial`;
  while (fs > 13 && ctx.measureText(name).width > maxNameW) { fs -= 1; ctx.font = `bold ${fs}px Tajawal,Arial`; }
  let dispName = name;
  if (ctx.measureText(dispName).width > maxNameW) {
    while (dispName.length>1 && ctx.measureText(dispName+'…').width > maxNameW) dispName = dispName.slice(0,-1);
    dispName += '…';
  }
  const tw = ctx.measureText(dispName).width;
  const grad = ctx.createLinearGradient(cx-tw/2, 0, cx+tw/2, 0);
  grad.addColorStop(0, _SH_GOLD2); grad.addColorStop(0.5, '#fff6de'); grad.addColorStop(1, _SH_GOLD2);
  ctx.textAlign='center'; ctx.fillStyle = grad; ctx.fillText(dispName, cx, nameY);

  const halfW = tw/2, lineY = nameY - fs*0.32;
  _shIconBadge(ctx, 'star', cx-halfW-starGap-starSz/2, lineY, starSz, _SH_GOLD, 0);
  _shIconBadge(ctx, 'star', cx+halfW+starGap+starSz/2, lineY, starSz, _SH_GOLD, 0);
  ctx.strokeStyle = `rgba(${rgb},0.45)`; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(sidePad, lineY); ctx.lineTo(cx-halfW-starGap-starSz-6, lineY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+halfW+starGap+starSz+6, lineY); ctx.lineTo(W-sidePad, lineY); ctx.stroke();

  return (nameY - topY) + 22; // ارتفاع كتلة الميدالية الكلي
}

async function _shHeader(ctx,W,title,sub,iconName){
  const medH = await _shLeagueMedallion(ctx, W, 26);
  const off = medH; // يزاح كل ما بعد الميدالية بارتفاعها بالكامل
  ctx.textAlign='center';
  let titleY = 46+off, dividerY = 58+off, subY = 76+off;
  if(iconName){
    _shIconBadge(ctx, iconName, W/2, 34+off, 30, _SH_GOLD, 0.14);
    titleY = 84+off; dividerY = 96+off; subY = 114+off;
  }
  ctx.fillStyle=_SH_GOLD; ctx.font='900 24px Tajawal,Arial';
  ctx.fillText(title, W/2, titleY);
  dividerY = titleY + 26; // ✅ لا حاجة لعرض اسم البطولة مرة ثانية (ظهر بالميدالية أعلاه) — الفاصل يتبع العنوان مباشرة

  // فاصل مزدوج: ذهبي رفيع فوق ظل فولاذي — مطابق تماماً لأسفل شريط الهوية بقسم بطاقات المشاركة بالإدارة
  ctx.strokeStyle = `rgba(${_shHexToRgb(_SH_GOLD)},0.35)`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, dividerY+0.5); ctx.lineTo(W-80, dividerY+0.5); ctx.stroke();
  ctx.strokeStyle = `rgba(${_shHexToRgb(_SH_STEEL)},0.4)`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(120, dividerY+2.5); ctx.lineTo(W-120, dividerY+2.5); ctx.stroke();

  return (dividerY + 16) - 0; // الارتفاع الكلي للرأس (ميدالية + عنوان + فاصل) من نقطة البداية y=0
}
// ✅ موحّدة مع قسم "بطاقات المشاركة" بالإدارة (cards-system.js → drawBottomBar)
// نفس ارتفاع الشريط، نفس الخط الفاصل العلوي الرفيع، ونفس أسطر الحقوق —
// بالإضافة لاسم البطولة وسطر المتابعة (يفيد الجمهور تحديداً) قبل سطر الحقوق.
function _shFooter(ctx,W,H){
  const BH = 66;
  const by = H - BH;

  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, by+0.5); ctx.lineTo(W-80, by+0.5); ctx.stroke();

  const followLabel = _shLeagueName() + '  ·  تابع البث المباشر والتفاصيل';
  ctx.font = '700 15px Tajawal,Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(followLabel, W/2, by + 28);

  ctx.font = '400 12px Tajawal,Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.fillText('منصة بطولات  ·  تطوير وبرمجة عبدالله السكني', W/2, by + 49);
}

// ── مشاركة ترتيب مجموعة ──
window._shShareGroup = async function(groupId){
  const d = window._shGroupsData && window._shGroupsData[groupId];
  if(!d || !d.sorted || !d.sorted.length){ if(window.showToast) window.showToast('لا توجد بيانات لهذه المجموعة', 'error'); return; }
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const canvas = await _shGenGroupCanvas(d);
    const lines = ['🔷 *ترتيب ' + (d.icon||'👥') + ' المجموعة ' + (d.name||'') + '*', ''];
    d.sorted.forEach((t,i) => {
      const s = d.gs[t.id]||{};
      const tag = (d.showBadges && d.manualQ.has(t.id)) ? ' ✅' : (d.showBadges && d.manualE.has(t.id)) ? ' ❌' : '';
      lines.push(`${i+1}. ${t.name} — ${s.pts||0} نقطة${tag}`);
    });
    const text = _shBuildText('group', lines);
    _shShareCanvas(canvas, text, 'group-'+(d.name||'table'));
  }catch(e){ console.warn('_shShareGroup', e); if(window.showToast) window.showToast('تعذّرت مشاركة المجموعة', 'error'); }
};

async function _shGenGroupCanvas(d){
  const W = 1080;
  const headerH = 350, rowH = 96, footH = 90;
  const H = headerH + d.sorted.length*rowH + footH;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  await _shHeader(ctx, W, 'المجموعة ' + (d.name||''), _shLeagueName(), 'users');

  // مواقع ثابتة (يمين→يسار) مطابقة تماماً لترتيب صفحة الجمهور:
  // # ، الفريق (شعار ثم اسم ملاصق له) ، ل ، ف ، ت ، خ ، ± ، ن
  const posX = 1000;              // رقم الترتيب
  const avSize = 44;
  const logoX = 895;               // بداية شعار الفريق
  const nameRightX = logoX - 16;   // اسم الفريق يبدأ هنا ملاصقاً للشعار ويمتد يساراً
  const nameMinX = 420;            // أقصى امتداد يساري مسموح للاسم (يحمي أعمدة الإحصائيات)
  const cols = [['ل',370],['ف',310],['ت',250],['خ',190],['±',130],['ن',70]];

  // رأس الأعمدة
  let y = headerH;
  ctx.textAlign='center'; ctx.font='700 13px Tajawal,Arial'; ctx.fillStyle='#666';
  cols.forEach(([label,x]) => ctx.fillText(label, x, y));
  y += 26;
  ctx.strokeStyle='rgba(255,255,255,.1)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(40,y); ctx.lineTo(W-40,y); ctx.stroke();
  y += 14;

  for(let i=0;i<d.sorted.length;i++){
    const t = d.sorted[i];
    const s = d.gs[t.id]||{};
    const gd = (s.gf||0)-(s.ga||0);
    const isQ = d.showBadges && d.manualQ.has(t.id);
    const isE = d.showBadges && d.manualE.has(t.id);
    const rowY = y + rowH/2 - 14;
    if(isQ){ ctx.fillStyle='rgba(39,174,96,.08)'; ctx.fillRect(40,y,W-80,rowH-8); }
    else if(isE){ ctx.fillStyle='rgba(214,69,65,.06)'; ctx.fillRect(40,y,W-80,rowH-8); }
    else if(i%2===0){ ctx.fillStyle='rgba(255,255,255,.02)'; ctx.fillRect(40,y,W-80,rowH-8); }

    // رقم الترتيب — أقصى اليمين
    ctx.textAlign='center'; ctx.font='900 20px Tajawal,Arial';
    ctx.fillStyle = isQ?'#27ae60':isE?'#d64541':'#888';
    ctx.fillText(String(i+1), posX, rowY+24);

    // شعار الفريق — ملاصق لرقم الترتيب
    const logoImg = await _shLoadImg(t.logo);
    if(logoImg){
      ctx.save(); ctx.beginPath(); ctx.arc(logoX+avSize/2, rowY+18, avSize/2, 0, Math.PI*2); ctx.clip();
      _shDrawImgCover(ctx, logoImg, logoX, rowY-4, avSize); ctx.restore();
    }

    // شارة تأهل/إخراج — تُحجز مساحتها أولاً (تظهر يسار الاسم، كما في صفحة الجمهور)
    const badgeReserve = (isQ || isE) ? 38 : 0;

    // اسم الفريق — ملاصق للشعار مباشرة (بلا فراغ)، يمتد يساراً مع تقليم تلقائي عند الازدحام
    const maxNameW = Math.max(60, nameRightX - badgeReserve - nameMinX);
    ctx.textAlign='right'; ctx.font='800 21px Tajawal,Arial'; ctx.fillStyle='#fff';
    let dispName = t.name || '';
    if (ctx.measureText(dispName).width > maxNameW) {
      while (dispName.length > 1 && ctx.measureText(dispName + '…').width > maxNameW) dispName = dispName.slice(0, -1);
      dispName += '…';
    }
    ctx.fillText(dispName, nameRightX, rowY+26);

    // شارة تأهل/إخراج — يسار الاسم مباشرة
    if (isQ || isE) {
      const nameW = ctx.measureText(dispName).width;
      const bx = nameRightX - nameW - 8 - 30;
      const bColor = isQ ? '#27ae60' : '#d64541';
      ctx.fillStyle = isQ ? 'rgba(39,174,96,.18)' : 'rgba(214,69,65,.18)';
      _shRoundRect(ctx, bx, rowY+2, 30, 26, 8); ctx.fill();
      _shIconBadge(ctx, isQ?'check':'cross', bx+15, rowY+15, 15, bColor, 0);
    }

    // الأعمدة الرقمية — نفس ترتيب الرأس (ل، ف، ت، خ، ±، ن) يساراً
    ctx.textAlign='center'; ctx.font='700 17px Tajawal,Arial'; ctx.fillStyle='#ccc';
    ctx.fillText(String(s.p||0), cols[0][1], rowY+24);
    ctx.fillStyle='#27ae60'; ctx.fillText(String(s.w||0), cols[1][1], rowY+24);
    ctx.fillStyle='#ccc'; ctx.fillText(String(s.d||0), cols[2][1], rowY+24);
    ctx.fillStyle='#d64541'; ctx.fillText(String(s.l||0), cols[3][1], rowY+24);
    ctx.fillStyle = gd>0?'#27ae60':gd<0?'#d64541':'#999'; ctx.fillText(gd>0?'+'+gd:String(gd), cols[4][1], rowY+24);
    ctx.fillStyle=_SH_GOLD; ctx.font='900 22px Tajawal,Arial'; ctx.fillText(String(s.pts||0), cols[5][1], rowY+24);
    y += rowH;
  }

  _shFooter(ctx, W, H);
  return canvas;
}

// ── مشاركة إحصائيات لاعب ──
window._shSharePlayerStats = async function(){
  const d = window._shCurrentPlayer;
  if(!d || !d.player){ if(window.showToast) window.showToast('تعذّر تجهيز البيانات', 'error'); return; }
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const canvas = await _shGenPlayerCanvas(d);
    const showAssists = !!(window.settings && window.settings.showAssists === true);
    const lines = [
      '⭐ *بطاقة إحصائيات*',
      d.player.name + (d.team && d.team.name ? ' — ' + d.team.name : ''),
      '',
      '⚽ أهداف: ' + (d.player.goals||0),
      showAssists && d.assistCount ? '👟 صناعات: ' + d.assistCount : '',
      '🗓 مباريات: ' + d.appearances,
    ].filter(Boolean);
    const text = _shBuildText('player', lines);
    _shShareCanvas(canvas, text, 'player-'+(d.player.name||'stats'));
  }catch(e){ console.warn('_shSharePlayerStats', e); if(window.showToast) window.showToast('تعذّرت مشاركة الإحصائيات', 'error'); }
};

// لقب تلقائي بحسب نمط اللاعب — يحترم إعداد إظهار الصنّاع (لا نستخدم أرقام صناعات مخفية حتى في اللقب)
function _shPlayerTitle(d){
  const showAssists = !!(window.settings && window.settings.showAssists === true);
  const g = d.player.goals||0, a = showAssists ? (d.assistCount||0) : 0;
  if(g>=8 && a>=5) return { text:'نجم شامل', icon:'star' };
  if(g>=6) return { text:'القنّاص', icon:'target' };
  if(a>=5) return { text:'صانع الألعاب', icon:'boots' };
  if(d.redCount>=1) return { text:'مقاتل الملعب', icon:'fire' };
  if(d.appearances>=8) return { text:'العمود الفقري', icon:'shield' };
  return { text:'لاعب مميز', icon:'ball' };
}

/* أسماء المراكز للجمهور — نفس مفاتيح ROSTER_POSITIONS في لوحة الإدارة
   (الكشف يخزّن المفتاح فقط، وصفحة الجمهور لا تملك جدول الإدارة). */
const _SH_POS = {
  GK:'حارس مرمى', CB:'مدافع وسط', LB:'ظهير أيسر', RB:'ظهير أيمن',
  LWB:'ظهير هجومي أيسر', RWB:'ظهير هجومي أيمن', DM:'حاجب', CM:'وسط',
  CAM:'مهاجم وسط', LM:'جناح أيسر', RM:'جناح أيمن', LW:'جناح أيسر',
  RW:'جناح أيمن', ST:'مهاجم', CF:'مهاجم إضافي'
};
function _shPosLabel(key){ return _SH_POS[key] || ''; }

/* ════════════════════════════════════════════════════════════════════
 *  بطاقة اللاعب — إعادة بناء كاملة
 *  ──────────────────────────────────────────────────────────────────
 *  عيوب النسخة السابقة (ظهرت بمعاينة الصورة الفعلية):
 *   ① بلا صورة = **حرف عربي ضخم** داخل الدائرة — شكل بدائي لا يليق.
 *   ② لا ترويسة إطلاقاً: البطاقة الوحيدة التي لا تحمل ميدالية البطولة
 *     ولا اسمها، فتبدو غريبة عن بقية بطاقات المنصة.
 *   ③ بيانات اللاعب المسجّلة في ملفه (الرقم، المركز، العمر، الطول،
 *     الجنسية) **لا تظهر إطلاقاً** رغم إدخالها من لوحة الإدارة.
 *
 *  التصميم الجديد: ترويسة موحّدة · ظلّ أنيق بدل الحرف · شريط هوية
 *  يعرض بيانات الملف · شبكة إحصائيات · سجلّ المباريات الأخيرة.
 * ════════════════════════════════════════════════════════════════════ */
async function _shGenPlayerCanvas(d){
  const W = 1080;
  const p = d.player, team = d.team || {};

  /* بيانات الملف من الكشف الحيّ — بالهوية أولاً ثم الاسم داخل فريقه فقط
     (نفس قواعد مطابقة الصور الصارمة: لا خلط بين متشابهي الأسماء). */
  const _roster = (window._teamRosters && window._teamRosters[p.teamId]) || [];
  const _norm = s => String(s||'').replace(/[\u064B-\u0652\u0640]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
  let _rp = p.playerId ? _roster.find(x => x && String(x.id) === String(p.playerId)) : null;
  if (!_rp) {
    const same = _roster.filter(x => x && _norm(x.name) === _norm(p.name));
    if (same.length === 1) _rp = same[0];
  }
  _rp = _rp || {};

  const chips = [];
  if (_rp.number != null && _rp.number !== '') chips.push(['shirt', '#' + _rp.number]);
  const posLabel = _shPosLabel(_rp.position);
  if (posLabel) chips.push(['field', posLabel]);
  if (_rp.age)    chips.push(['calendar', _rp.age + ' سنة']);
  if (_rp.height) chips.push(['trending', _rp.height + ' سم']);
  if (_rp.foot)   chips.push(['boots', _rp.foot]);
  if (_rp.nationality) chips.push(['globe', _rp.nationality]);

  /* ── حساب التخطيط قبل الرسم ──
     الارتفاع كان رقماً ثابتاً (470) لا يتبع موضع الاسم فعلياً، فكان اسم
     اللاعب **يتداخل مع شبكة الإحصائيات** كلما غاب شريط الهوية. الآن كل
     موضع يُشتقّ من الذي قبله فلا يمكن أن يتراكبا مهما تغيّر المحتوى. */
  const HEAD_END = 250, AV = 190;
  const avY   = HEAD_END + 24 + AV/2;
  const nameY = avY + AV/2 + 58;
  const teamY = nameY + 32;
  const bodyY = teamY + 30;
  const chipsH   = chips.length ? 56 : 0;
  const matchesN = (d.playerMatches||[]).length;
  const CELL_H = 150;
  const H = bodyY + chipsH + CELL_H + 40 + (matchesN ? 44 + matchesN*58 : 0) + 96;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  // ✅︎ ترويسة موحّدة مع بقية بطاقات المنصة (كانت غائبة تماماً)
  await _shHeader(ctx, W, 'بطاقة لاعب', _shLeagueName(), 'user');

  const [photoImg, logoImg] = await Promise.all([
    _shLoadImg((typeof _lineupPhoto==='function') ? _lineupPhoto({id:p.playerId,name:p.name}, p.teamId) : ''),
    _shLoadImg(team.logo)
  ]);

  // ── صورة اللاعب الدائرية ──
  const avSize = AV;
  ctx.save();
  ctx.beginPath(); ctx.arc(W/2, avY, avSize/2, 0, Math.PI*2); ctx.clip();
  const bg = ctx.createLinearGradient(0, avY-avSize/2, 0, avY+avSize/2);
  bg.addColorStop(0,'#161d27'); bg.addColorStop(1,'#0e1219');
  ctx.fillStyle = bg; ctx.fillRect(W/2-avSize/2, avY-avSize/2, avSize, avSize);
  if(photoImg) _shDrawImgCover(ctx, photoImg, W/2-avSize/2, avY-avSize/2, avSize);
  /* ✅︎ ظلّ لاعب أنيق بدل الحرف — نفس الظلّ المستخدم في التشكيلة،
     منزَّل قليلاً ليقطع الإطار السفلي كبورتريه حقيقي. */
  else _shDrawSilhouette(ctx, W/2, avY + avSize*0.17, avSize*0.92, 'rgba(201,160,43,.32)');
  ctx.restore();
  ctx.strokeStyle=_SH_GOLD; ctx.lineWidth=4;
  ctx.beginPath(); ctx.arc(W/2, avY, avSize/2, 0, Math.PI*2); ctx.stroke();

  // شعار الفريق — شارة على حافة الصورة
  if(logoImg){
    const lx=W/2+avSize/2-16, ly=avY+avSize/2-16;
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, 30, 0, Math.PI*2);
    ctx.fillStyle='#0a0b0d'; ctx.fill(); ctx.clip();
    _shDrawImgCover(ctx, logoImg, lx-26, ly-26, 52);
    ctx.restore();
    ctx.strokeStyle='#0a0b0d'; ctx.lineWidth=5;
    ctx.beginPath(); ctx.arc(lx, ly, 30, 0, Math.PI*2); ctx.stroke();
  }

  // ── الاسم والفريق ──
  ctx.textAlign='center';
  ctx.fillStyle='#fff'; ctx.font='900 40px Tajawal,Arial';
  ctx.fillText(_shTrim(p.name || '', 30), W/2, nameY);
  ctx.fillStyle='#8B939C'; ctx.font='700 19px Tajawal,Arial';
  ctx.fillText(team.name || '', W/2, teamY);

  let y = bodyY;

  /* ── شريط الهوية: بيانات ملف اللاعب المدخلة من لوحة الإدارة ──
     قياس العرض أولاً لتوسيط الشريط بدقة مهما كان عدد البيانات. */
  if (chips.length){
    const CH = 40, PADX = 18, GAPC = 10, ICG = 22;
    ctx.font='800 17px Tajawal,Arial';
    const widths = chips.map(c => ctx.measureText(c[1]).width + ICG + PADX*2);
    const totalW = widths.reduce((a,b)=>a+b,0) + GAPC*(chips.length-1);
    let cx = (W + totalW)/2;                       // RTL: نبدأ من اليمين
    chips.forEach((c, i) => {
      const cw = widths[i];
      const x = cx - cw;
      ctx.fillStyle='rgba(255,255,255,.05)';
      _shRoundRect(ctx, x, y, cw, CH, CH/2); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.lineWidth=1;
      _shRoundRect(ctx, x, y, cw, CH, CH/2); ctx.stroke();
      _shIconBadge(ctx, c[0], x + cw - PADX - 8, y + CH/2, 15, 'rgba(201,160,43,.85)', 0);
      ctx.textAlign='right'; ctx.fillStyle='#D6DBE1'; ctx.font='800 17px Tajawal,Arial';
      ctx.fillText(c[1], x + cw - PADX - ICG, y + CH/2 + 6);
      cx -= cw + GAPC;
    });
    y += chipsH;
  }

  // ── شبكة الإحصائيات — تحترم إعداد «إظهار الصنّاع» (showAssists) ──
  const showAssists = !!(window.settings && window.settings.showAssists === true);
  const stats = [
    ['ball', String(p.goals||0), 'أهداف', _SH_GOLD],
    ...(showAssists ? [['boots', String(d.assistCount||0), 'صناعات', '#27ae60']] : []),
    ['calendar', String(d.appearances||0), 'مباريات', '#3B7DBF'],
    ['trending', d.appearances ? ((p.goals||0)/d.appearances).toFixed(1) : '0.0', 'معدّل', '#c084fc'],
  ];
  const GP = 46, GG = 14, cellH = CELL_H;
  const cellW = (W - GP*2 - GG*(stats.length-1)) / stats.length;
  stats.forEach((s,i) => {
    const x = W - GP - (i+1)*cellW - i*GG;         // RTL: أول خلية يميناً
    const cx = x + cellW/2;
    const g = ctx.createLinearGradient(0, y, 0, y+cellH);
    g.addColorStop(0,'rgba(255,255,255,.055)'); g.addColorStop(1,'rgba(255,255,255,.015)');
    ctx.fillStyle=g; _shRoundRect(ctx, x, y, cellW, cellH, 18); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1;
    _shRoundRect(ctx, x, y, cellW, cellH, 18); ctx.stroke();
    ctx.textAlign='center';
    _shIconBadge(ctx, s[0], cx, y+40, 26, s[3], 0);
    ctx.font='900 34px Tajawal,Arial'; ctx.fillStyle=s[3]; ctx.fillText(s[1], cx, y+98);
    ctx.font='700 14px Tajawal,Arial'; ctx.fillStyle='#8B939C'; ctx.fillText(s[2], cx, y+124);
  });
  y += cellH + 40;

  // ── آخر المباريات ──
  if(matchesN){
    ctx.textAlign='right'; ctx.fillStyle=_SH_GOLD; ctx.font='800 19px Tajawal,Arial';
    ctx.fillText('آخر المباريات', W-GP, y+8);
    ctx.strokeStyle='rgba(201,160,43,.22)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(GP, y+16); ctx.lineTo(W-GP-140, y+16); ctx.stroke();
    y += 44;
    d.playerMatches.forEach(pm => {
      const rowH = 50;
      ctx.fillStyle='rgba(255,255,255,.035)';
      _shRoundRect(ctx, GP, y, W-GP*2, rowH, 12); ctx.fill();
      const rColor = pm.rc==='var(--green)'?'#27ae60':pm.rc==='var(--red)'?'#d64541':'#8B939C';
      // شريط النتيجة الجانبي — فوز/خسارة/تعادل بلمحة
      ctx.fillStyle=rColor;
      _shRoundRect(ctx, W-GP-4, y+10, 4, rowH-20, 2); ctx.fill();
      ctx.textAlign='right'; ctx.font='700 17px Tajawal,Arial'; ctx.fillStyle='#D6DBE1';
      ctx.fillText('ضد ' + _shTrim((pm.opp && pm.opp.name) || '؟', 22), W-GP-20, y+rowH/2+6);
      // النتيجة يساراً داخل قرص، ثم مساهمات اللاعب
      ctx.textAlign='center';
      ctx.font='900 19px Tajawal,Arial'; ctx.fillStyle=rColor;
      ctx.fillText(pm.my+' - '+pm.op, GP+56, y+rowH/2+7);
      let bx = GP + 116;
      ctx.textAlign='left'; ctx.font='800 16px Tajawal,Arial';
      if(pm.myGoals){
        _shIconBadge(ctx,'ball',bx+8,y+rowH/2,15,_SH_GOLD,0);
        ctx.fillStyle=_SH_GOLD; ctx.fillText(String(pm.myGoals), bx+20, y+rowH/2+6);
        bx += 46;
      }
      if(pm.myAssist && showAssists){
        _shIconBadge(ctx,'boots',bx+8,y+rowH/2,15,'#27ae60',0);
        ctx.fillStyle='#27ae60'; ctx.fillText(String(pm.myAssist), bx+20, y+rowH/2+6);
      }
      y += rowH + 8;
    });
  }

  _shFooter(ctx, W, H);
  return canvas;
}

// ── مشاركة أعلى ٥ هدّافين ──
window._shShareTopScorers = async function(){
  const data = (typeof buildScorersData === 'function' ? buildScorersData() : []).slice(0,5);
  if(!data.length){ if(window.showToast) window.showToast('لا توجد أهداف بعد', 'error'); return; }
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const canvas = await _shGenScorersCanvas(data);
    const lines = ['🥇 *قائمة الهدّافين*', ''];
    data.forEach((p,i)=> lines.push(`${i+1}. ${p.name} — ${p.goals} هدف`));
    const text = _shBuildText('scorers', lines);
    _shShareCanvas(canvas, text, 'top-scorers');
  }catch(e){ console.warn('_shShareTopScorers', e); if(window.showToast) window.showToast('تعذّرت مشاركة الهدّافين', 'error'); }
};

/* ════════════════════════════════════════════════════════════════════
 *  بطاقة الهدّافين — إعادة بناء كاملة
 *  ──────────────────────────────────────────────────────────────────
 *  عيوب النسخة السابقة (ظهرت بمعاينة الصورة الفعلية):
 *   ① الترتيب كان معكوساً على قارئ العربية: المرتبة والصورة أقصى اليسار
 *     والاسم أقصى اليمين، وبينهما ~400px فراغ ميت — فتبدو مبعثرة.
 *   ② اللاعب بلا صورة = دائرة زرقاء **فارغة تماماً** بلا أي رمز.
 *   ③ ميداليات ذهبية/فضية/برونزية تُشتّت البصر بلا فائدة.
 *   ④ فجوة ~110px فارغة بين الترويسة وأول صف.
 *   ⑤ «هدف» بخط 11px تحت أيقونة صغيرة = غير مقروء.
 *
 *  التصميم الجديد: بطاقة مستقلة لكل لاعب بترتيب RTL طبيعي —
 *  المرتبة (رقم فقط) → الصورة → الاسم والفريق → الأهداف.
 * ════════════════════════════════════════════════════════════════════ */
async function _shGenScorersCanvas(data){
  const W = 1080, ROW_H = 132, GAP = 14, PAD = 46;
  const headerH = 250;                       // ملاصق للترويسة بلا فجوة ميتة
  const H = headerH + data.length*(ROW_H+GAP) + 96;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  await _shHeader(ctx, W, 'قائمة الهدّافين', _shLeagueName(), 'trophy');

  const teams = window.teams || [];
  let y = headerH;

  for(let i=0;i<data.length;i++){
    const p = data[i];
    const team = teams.find(t=>t.id===p.teamId);
    const lead = i === 0;                     // المتصدّر يُميَّز بالإطار لا بميدالية
    const cy = y + ROW_H/2;

    // ── بطاقة الصف ──
    const g = ctx.createLinearGradient(0, y, 0, y+ROW_H);
    if (lead){ g.addColorStop(0,'rgba(201,160,43,.14)'); g.addColorStop(1,'rgba(201,160,43,.03)'); }
    else     { g.addColorStop(0,'rgba(255,255,255,.045)'); g.addColorStop(1,'rgba(255,255,255,.015)'); }
    ctx.fillStyle = g;
    _shRoundRect(ctx, PAD, y, W-PAD*2, ROW_H, 20); ctx.fill();
    ctx.strokeStyle = lead ? 'rgba(201,160,43,.55)' : 'rgba(255,255,255,.07)';
    ctx.lineWidth = lead ? 2 : 1;
    _shRoundRect(ctx, PAD, y, W-PAD*2, ROW_H, 20); ctx.stroke();

    /* ── ① المرتبة: رقم فقط داخل قرص محايد (بلا ميداليات) ──
       أقصى اليمين لأنها أول ما تُقرأ في العربية. */
    const rankX = W - PAD - 52;
    ctx.fillStyle = lead ? 'rgba(201,160,43,.20)' : 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.arc(rankX, cy, 30, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = lead ? _SH_GOLD : 'rgba(255,255,255,.12)';
    ctx.lineWidth = lead ? 2 : 1;
    ctx.beginPath(); ctx.arc(rankX, cy, 30, 0, Math.PI*2); ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font = '900 28px Tajawal,Arial';
    ctx.fillStyle = lead ? _SH_GOLD : '#C7CCD1';
    ctx.fillText(String(i+1), rankX, cy+1);
    ctx.textBaseline='alphabetic';

    // ── ② صورة اللاعب (أو ظلّه الأنيق) ──
    const AV = 84, avX = rankX - 30 - 22 - AV/2;
    const photo = (typeof _lineupPhoto==='function') ? _lineupPhoto({id:p.playerId,name:p.name}, p.teamId) : '';
    const img = await _shLoadImg(photo);
    ctx.save();
    ctx.beginPath(); ctx.arc(avX, cy, AV/2, 0, Math.PI*2); ctx.clip();
    ctx.fillStyle = '#121820'; ctx.fillRect(avX-AV/2, cy-AV/2, AV, AV);
    if(img) _shDrawImgCover(ctx, img, avX-AV/2, cy-AV/2, AV);
    else {
      /* ✅︎ ظلّ لاعب أنيق بدل الدائرة الفارغة — نفس ظلّ التشكيلة تماماً،
         موضوع بحيث يبرز نصفه العلوي كصورة بورتريه حقيقية. */
      _shDrawSilhouette(ctx, avX, cy + AV*0.16, AV*0.92, 'rgba(201,160,43,.34)');
    }
    ctx.restore();
    ctx.strokeStyle = lead ? _SH_GOLD : 'rgba(255,255,255,.18)';
    ctx.lineWidth = lead ? 3 : 2;
    ctx.beginPath(); ctx.arc(avX, cy, AV/2, 0, Math.PI*2); ctx.stroke();

    // شعار الفريق — شارة صغيرة أسفل الصورة بحلقة تفصله عن الخلفية
    if(team){
      const logoImg = await _shLoadImg(team.logo);
      if(logoImg){
        const lx = avX - AV/2 + 8, ly = cy + AV/2 - 8;
        ctx.save();
        ctx.beginPath(); ctx.arc(lx, ly, 17, 0, Math.PI*2);
        ctx.fillStyle='#0a0b0d'; ctx.fill(); ctx.clip();
        _shDrawImgCover(ctx, logoImg, lx-15, ly-15, 30);
        ctx.restore();
        ctx.strokeStyle='#0a0b0d'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(lx, ly, 17, 0, Math.PI*2); ctx.stroke();
      }
    }

    // ── ③ الاسم والفريق — يبدآن مباشرة بعد الصورة (لا فراغ ميت) ──
    const textX = avX - AV/2 - 22;
    const goalsBoxW = 118;
    const textMinX = PAD + goalsBoxW + 26;
    ctx.textAlign='right';
    ctx.font='800 28px Tajawal,Arial'; ctx.fillStyle = lead ? '#fff' : '#EDEFF2';
    let nm = p.name || '';
    if (ctx.measureText(nm).width > textX - textMinX){
      while (nm.length>1 && ctx.measureText(nm+'…').width > textX - textMinX) nm = nm.slice(0,-1);
      nm += '…';
    }
    ctx.fillText(nm, textX, cy - 6);
    ctx.font='600 17px Tajawal,Arial'; ctx.fillStyle='#8B939C';
    ctx.fillText((team && team.name) || '', textX, cy + 24);

    // ── ④ خانة الأهداف — رقم كبير وكلمة واضحة داخل صندوق مستقل ──
    const gx = PAD + 16, gw = goalsBoxW, gh = 82;
    ctx.fillStyle = lead ? 'rgba(201,160,43,.16)' : 'rgba(255,255,255,.05)';
    _shRoundRect(ctx, gx, cy-gh/2, gw, gh, 14); ctx.fill();
    ctx.strokeStyle = lead ? 'rgba(201,160,43,.45)' : 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    _shRoundRect(ctx, gx, cy-gh/2, gw, gh, 14); ctx.stroke();
    ctx.textAlign='center';
    ctx.font='900 40px Tajawal,Arial'; ctx.fillStyle=_SH_GOLD;
    ctx.fillText(String(p.goals), gx+gw/2, cy+4);
    ctx.font='700 14px Tajawal,Arial'; ctx.fillStyle='#8B939C';
    ctx.fillText('هدف', gx+gw/2, cy+28);

    y += ROW_H + GAP;
  }
  _shFooter(ctx, W, H);
  return canvas;
}

function _shTrim(str, max){ str = str||''; return str.length>max ? str.slice(0,max-1)+'…' : str; }

// ── مشاركة إحصائية مباراة واحدة (استحواذ/تسديدات/ركنيات...) كصورة ──
window._shShareMatchStats = async function(_uid){
  const data = window._shMatchStatsData && window._shMatchStatsData[_uid];
  if(!data){ if(window.showToast) window.showToast('تعذّر تجهيز الإحصائيات', 'error'); return; }
  const { statsData, ht, at, m } = data;
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const canvas = await _shGenMatchStatsCanvas(statsData, ht, at, m);
    if(!canvas){ if(window.showToast) window.showToast('لا توجد إحصائيات بعد', 'error'); return; }
    const hasScore = m && (m.homeScore != null) && (m.awayScore != null);
    const text = _shBuildText('matchstats', [
      '📊 *إحصائية المباراة*',
      (ht?.name||'') + (hasScore ? '  ' + m.homeScore + ' - ' + m.awayScore + '  ' : '  vs  ') + (at?.name||'')
    ].filter(Boolean));
    _shShareCanvas(canvas, text, 'match-stats-'+((ht&&ht.name)||'match'));
  }catch(e){ console.warn('_shShareMatchStats', e); if(window.showToast) window.showToast('تعذّرت مشاركة الإحصائيات', 'error'); }
};

// نفس حقول SFIELDS في _buildUnifiedStatsHtml بالحرف — حتى تطابق البطاقة صفحة الإحصائيات تماماً
const _SH_MSTATS_FIELDS = [
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

async function _shGenMatchStatsCanvas(statsData, ht, at, m){
  const stats = statsData || {};
  const gv = (lk, fk) => { if(stats[lk]!=null) return stats[lk]; if(stats[fk]!=null) return stats[fk]; return null; };
  const rows = _SH_MSTATS_FIELDS.map(f=>{
    const hv = gv(f.lh, f.fh), av = gv(f.la, f.fa);
    if(hv===null && av===null) return null;
    const h = hv??0, a = av??0, tot = (h+a)||1;
    const hPct = f.pct ? h : Math.round(h/tot*100);
    const aPct = f.pct ? a : Math.round(a/tot*100);
    return { ...f, h, a, hPct, aPct };
  }).filter(Boolean);
  if(!rows.length) return null;

  const W = 1080;
  const MEDH = 144; // ✅ ارتفاع ميدالية شعار البطولة الثابت (نفس _shLeagueMedallion دائماً)
  const headerH = 250+MEDH, rowH = 82, padBot = 70;
  const H = headerH + rows.length*rowH + padBot;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  await _shLeagueMedallion(ctx, W, 26); // ✅ نفس شعار واسم البطولة الظاهر بكل بطاقات الإدارة والجمهور

  // ── رأس البطاقة: شعار كل فريق + اسمه + النتيجة إن وُجدت ──
  const [hLogo, aLogo] = await Promise.all([_shLoadImg(ht&&ht.logo), _shLoadImg(at&&at.logo)]);
  const cyLogo = 96+MEDH, rLogo = 42;
  const hx = W*0.76, ax = W*0.24; // المضيف يمين (كما في الصفحة RTL)، الضيف يسار
  [[hx,hLogo,_SH_GOLD],[ax,aLogo,'#C0392B']].forEach(([cx,img,ring])=>{
    if(img){
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cyLogo, rLogo, 0, Math.PI*2); ctx.clip();
      _shDrawImgCover(ctx, img, cx-rLogo, cyLogo-rLogo, rLogo*2); ctx.restore();
    }
    ctx.strokeStyle = ring; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cyLogo, rLogo, 0, Math.PI*2); ctx.stroke();
  });
  ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font='800 20px Tajawal,Arial';
  ctx.fillText(_shTrim(ht&&ht.name||'', 16), hx, cyLogo+rLogo+34);
  ctx.fillText(_shTrim(at&&at.name||'', 16), ax, cyLogo+rLogo+34);

  const hasScore = m && m.homeScore!=null && m.awayScore!=null;
  ctx.font='900 44px Tajawal,Arial'; ctx.fillStyle=_SH_GOLD;
  // ⚠️ الشعار المضيف يمين والضيف يسار، لكن نص الكانفس يُرسم LTR دائماً بغضّ النظر
  // عن اتجاه الصفحة — فلو كتبنا "homeScore - awayScore" يطلع رقم المضيف يسار
  // ورقم الضيف يمين، أي عكس موقع الشعارين تماماً (يبان الخاسر كأنه الفايز).
  // نكتب رقم الضيف أولاً (يسار) ثم المضيف (يمين) ليطابق موضع الشعارين فعلياً.
  ctx.fillText(hasScore ? `${m.awayScore} - ${m.homeScore}` : 'vs', W/2, cyLogo+14);
  ctx.font='700 13px Tajawal,Arial'; ctx.fillStyle='#888';
  ctx.fillText('📊 إحصائية المباراة', W/2, cyLogo+rLogo+34);

  // ── صفوف الإحصائيات ──
  let y = headerH;
  for(const r of rows){
    const barY = y+40, barW = 420, barX0 = W/2-barW/2, barH = 10;
    ctx.textAlign='left'; ctx.fillStyle=_SH_GOLD; ctx.font='900 26px Tajawal,Arial';
    ctx.fillText(r.pct ? r.h+'%' : String(r.h), W/2+barW/2+24, y+14);
    ctx.textAlign='right'; ctx.fillStyle='#aaa'; ctx.font='900 26px Tajawal,Arial';
    ctx.fillText(r.pct ? r.a+'%' : String(r.a), W/2-barW/2-24, y+14);
    ctx.textAlign='center'; ctx.fillStyle='#888'; ctx.font='700 13px Tajawal,Arial';
    ctx.fillText(r.label, W/2, y-2);
    // خلفية الشريط
    ctx.fillStyle='rgba(255,255,255,.08)';
    _shRoundRect(ctx, barX0, barY, barW, barH, barH/2); ctx.fill();
    // جزء الفريق المضيف (يمين، ذهبي)
    const hW = barW*(r.hPct/100);
    ctx.fillStyle=_SH_GOLD;
    _shRoundRect(ctx, barX0+barW-hW, barY, hW, barH, barH/2); ctx.fill();
    // جزء الفريق الضيف (يسار، أزرق)
    const aW = barW*(r.aPct/100);
    ctx.fillStyle='rgba(90,160,220,.75)';
    _shRoundRect(ctx, barX0, barY, aW, barH, barH/2); ctx.fill();
    y += rowH;
  }

  _shFooter(ctx, W, H);
  return canvas;
}

async function _shGenFullStatsCanvas(d){
  const W = 1080;
  const sections = [];
  if(d.scorers.length) sections.push({title:'الهدّافون', icon:'ball',  color:_SH_GOLD,  unit:'هدف',   field:'goals', rows:d.scorers});
  if(d.assists.length) sections.push({title:'صنّاع الأهداف', icon:'boots', color:'#2ecc71', unit:'صناعة', field:'count', rows:d.assists});
  if(d.yellows.length) sections.push({title:'البطاقات الصفراء', icon:'card', color:'#e6c157', unit:'بطاقة', field:'count', rows:d.yellows});
  if(d.reds.length)    sections.push({title:'البطاقات الحمراء', icon:'card', color:'#e5533d', unit:'بطاقة', field:'count', rows:d.reds});

  const rowH = 82, secTitleH = 54, secGapAfter = 18, headerH = 280;
  let H = headerH;
  sections.forEach(s => { H += secTitleH + s.rows.length*rowH + secGapAfter; });
  H += 90;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  await _shHeader(ctx, W, 'إحصائيات البطولة', _shLeagueName(), 'trending');

  let y = headerH;
  const teamsArr = window.teams || [];
  for(const sec of sections){
    _shIconBadge(ctx, sec.icon, 56, y+18, 15, sec.color, 0.14);
    ctx.textAlign='right'; ctx.fillStyle=sec.color; ctx.font='900 19px Tajawal,Arial';
    ctx.fillText(sec.title, W-56, y+24);
    ctx.strokeStyle='rgba(255,255,255,.10)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(40,y+40); ctx.lineTo(W-40,y+40); ctx.stroke();
    y += secTitleH;
    for(let i=0;i<sec.rows.length;i++){
      const p = sec.rows[i];
      const team = teamsArr.find(t=>t.id===p.teamId);
      const rowY = y + rowH/2 - 8;
      if(i%2===0){ ctx.fillStyle='rgba(255,255,255,.02)'; ctx.fillRect(40, y, W-80, rowH-6); }
      const medalColor = i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'rgba(255,255,255,.14)';
      ctx.fillStyle = medalColor;
      ctx.beginPath(); ctx.arc(80, rowY+8, 18, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = i<3 ? '#1a1200' : '#ccc'; ctx.font='900 14px Tajawal,Arial';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(String(i+1), 80, rowY+9);
      ctx.textBaseline='alphabetic';
      const photo = (typeof _lineupPhoto === 'function') ? _lineupPhoto({id:p.playerId, name:p.name}, p.teamId) : '';
      const img = await _shLoadImg(photo);
      const avX = 148, avSize = 52;
      ctx.save(); ctx.beginPath(); ctx.arc(avX, rowY+8, avSize/2, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle='#121820'; ctx.fillRect(avX-avSize/2, rowY+8-avSize/2, avSize, avSize);
      if(img) _shDrawImgCover(ctx, img, avX-avSize/2, rowY+8-avSize/2, avSize);
      /* ✅︎ ظلّ لاعب بدل الدائرة الفارغة — نفس علاج بطاقتَي الهدّافين واللاعب */
      else _shDrawSilhouette(ctx, avX, rowY+8 + avSize*0.16, avSize*0.92, 'rgba(201,160,43,.34)');
      ctx.restore();
      ctx.strokeStyle = sec.color; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(avX, rowY+8, avSize/2, 0, Math.PI*2); ctx.stroke();
      if(team && team.logo){
        const logoImg = await _shLoadImg(team.logo);
        if(logoImg){
          ctx.save(); ctx.beginPath(); ctx.arc(avX+avSize/2-4, rowY+8+avSize/2-4, 12, 0, Math.PI*2); ctx.clip();
          _shDrawImgCover(ctx, logoImg, avX+avSize/2-16, rowY+8+avSize/2-16, 24); ctx.restore();
        }
      }
      ctx.textAlign='right'; ctx.fillStyle='#fff'; ctx.font='800 18px Tajawal,Arial';
      ctx.fillText(p.name||'', W-220, rowY-2);
      ctx.fillStyle='#888'; ctx.font='600 12px Tajawal,Arial';
      ctx.fillText(p.teamName || (team&&team.name) || '', W-220, rowY+18);
      ctx.textAlign='center'; ctx.fillStyle=sec.color; ctx.font='900 26px Tajawal,Arial';
      ctx.fillText(String(p[sec.field]||0), W-90, rowY+2);
      ctx.fillStyle='#666'; ctx.font='700 10px Tajawal,Arial';
      ctx.fillText(sec.unit, W-90, rowY+20);
      y += rowH;
    }
    y += secGapAfter;
  }
  _shFooter(ctx, W, H);
  return canvas;
}
window._shShareLineup = async function(_uid){
  const data = window._shLineupData && window._shLineupData[_uid];
  if(!data){ if(window.showToast) window.showToast('تعذّر تجهيز التشكيلة', 'error'); return; }
  const awayShown = document.getElementById('vlu-away-'+_uid)?.style.display === 'block';
  const lineup = awayShown ? data.al : data.hl;
  const team = awayShown ? data.at : data.ht;
  if(!lineup || !lineup.players || !lineup.players.filter(p=>!p.isSub).length){
    if(window.showToast) window.showToast('لا توجد تشكيلة لهذا الفريق بعد', 'error'); return;
  }
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const teamId = awayShown ? data.awayId : data.homeId;
    const canvas = await _shGenLineupCanvas(lineup, team, awayShown, teamId, data.m);
    const text = _shBuildText('lineup', [
      '👥 *تشكيلة ' + (team.name||'') + '*',
      lineup.formation ? 'التشكيل: ' + lineup.formation : ''
    ].filter(Boolean));
    _shShareCanvas(canvas, text, 'lineup-'+(team.name||'team'));
  }catch(e){ console.warn('_shShareLineup', e); if(window.showToast) window.showToast('تعذّرت مشاركة التشكيلة', 'error'); }
};

// ✅ ظلّ اللاعب الافتراضي (نفس أيقونة _playerSilhouetteSVG المستخدمة في صفحة الجمهور)
//    تُرسم عندما لا توجد صورة مرفوعة للاعب — بدل الاكتفاء برقمه فقط.
function _shDrawSilhouette(ctx, cx, cy, size, color){
  ctx.save();
  ctx.translate(cx - size/2, cy - size/2);
  ctx.scale(size/24, size/24);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(12, 8, 4, 0, Math.PI*2); ctx.fill();
  ctx.fill(new Path2D('M12 14c-4.4 0-8 2.6-8 5.8V22h16v-2.2C20 16.6 16.4 14 12 14z'));
  ctx.restore();
}

async function _shGenLineupCanvas(lineup, team, isAway, teamId, m){
  const starters = lineup.players.filter(p=>!p.isSub);
  const subs = lineup.players.filter(p=>p.isSub).filter(()=> lineup.showBench !== false);
  const n = lineup.playerCount || starters.length;
  const W = 1080;
  const pitchX = 24, pitchW = W - 48;

  // ══════════════════════════════════════════════════════════════════
  // معامل تكبير موحّد S: كل الأحجام أدناه (أفاتار/خطوط/حشوات) هي نفس
  // القيم بالبكسل المستخدمة فعلياً في صفحة الجمهور (renderPitchViewer)
  // مضروبة بـ S، حتى تُطابق البطاقة الجمهور تماماً بنفس النِسَب — بدل
  // اختراع أحجام مستقلة كما كان سابقاً.
  // ══════════════════════════════════════════════════════════════════
  const REF_W = 380; // عرض حاوية مرجعي يقارب حاوية الجمهور على الجوال
  const S = pitchW / REF_W;

  const accent = isAway ? '#C0392B' : _SH_GOLD;
  const S1='#171A1D', S2='#1E2226', B1='#2A2F35', B2='#363C43';

  // ── نوع الملعب ونِسَبه — نفس _vpPitchType/_VPitchSVG بالحرف في صفحة الجمهور ──
  const pType = n<=6 ? 'futsal' : n<=9 ? 'seven' : 'full';
  const pLabel = n<=6 ? `🔵 فوتسال (${n} لاعبين)` : n<=9 ? `🟢 سباعي (${n} لاعبين)` : `🟡 ملعب كامل (${n} لاعبين)`;
  const _pitchCfg = pType==='futsal'
    ? { boxW:48, boxH:16, sixW:24, sixH:7,  centerR:12, spot:0, nStripes:8  }
    : pType==='seven'
    ? { boxW:60, boxH:18, sixW:30, sixH:8,  centerR:13, spot:9, nStripes:10 }
    : { boxW:56, boxH:16, sixW:28, sixH:7,  centerR:14, spot:9, nStripes:12 };

  // ── أحجام اللاعبين (مطابقة renderPitchViewer × S) ──
  const avSize  = Math.round((n<=6?56:n<=8?50:n<=9?46:42) * S);
  const nameFS  = (n<=6?10.5:n<=9?9.5:9) * S;
  const numFS   = (n<=6?11:10) * S;
  const numSz   = Math.round((n<=6?20:n<=9?18:16) * S);
  const benchAv = Math.round(44 * S);

  // ── شريط أعلى الملعب (نفس شريط "شريط أعلى الملعب" في الجمهور) ──
  const topBarPadY = 11*S, topBarPadX = 14*S;
  const topBarFS = 11*S, formFS = 12.5*S;
  const topBarH  = Math.round(topBarPadY*2 + 18.5*S);

  const headerH = 178; // شعار + اسم الفريق أعلى البطاقة (خاص بالمشاركة، لا يوجد في الجمهور)
  // ✅ نسبة الملعب الحقيقية aspect-ratio:10/13 من CSS (كانت مغلوطة سابقاً وتُسبّب
  //    اختلاف شكل الميلان تماماً عن الجمهور)
  const pitchGeomH = Math.round(pitchW * 13/10);
  const cardY = headerH;
  const pitchY = cardY + topBarH;
  const cardBottomY = pitchY + pitchGeomH;

  // ── أبعاد قسم البدلاء ──
  const benchGapTop = 10*S, benchPad = 12*S;
  const benchTitleH = Math.round(10*S + 22*S);
  const benchCols = 3, benchGap = 8*S;
  const benchCellW = (pitchW - benchGap*(benchCols-1)) / benchCols;
  const benchRows = subs.length ? Math.ceil(subs.length/benchCols) : 0;
  const benchCellH = Math.round(10*S + benchAv + 14*S + 12*S + 18*S);
  const benchH = subs.length ? Math.round(benchPad*2 + benchTitleH + benchRows*benchCellH + Math.max(0,benchRows-1)*benchGap) : 0;

  const H = Math.round(cardBottomY + (subs.length ? benchGapTop + benchH : 0) + 100);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  _shBg(ctx, W, H);
  const [logoImg] = await Promise.all([_shLoadImg(team.logo)]);
  if(logoImg){
    ctx.save(); ctx.beginPath(); ctx.arc(W/2, 78, 34, 0, Math.PI*2); ctx.clip();
    _shDrawImgCover(ctx, logoImg, W/2-34, 78-34, 68); ctx.restore();
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(W/2, 78, 34, 0, Math.PI*2); ctx.stroke();
  }
  ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font='900 26px Tajawal,Arial';
  ctx.fillText(team.name || '', W/2, 138);

  // ══════════════════════════════════════════════════════════════════
  // بطاقة التشكيلة الكاملة (شريط علوي + ملعب) — إطار مدوّر واحد
  // مطابق تماماً لبنية renderPitchViewer في صفحة الجمهور
  // ══════════════════════════════════════════════════════════════════
  const cardH = topBarH + pitchGeomH;
  _shRoundRect(ctx, pitchX, cardY, pitchW, cardH, 16*S);
  ctx.fillStyle = S2; ctx.fill();
  ctx.save(); ctx.clip();

  // -- الشريط العلوي: تدرّج s1→s2 + خط فاصل b1 (نفس الجمهور حرفياً) --
  const barGrad = ctx.createLinearGradient(0, cardY, 0, cardY+topBarH);
  barGrad.addColorStop(0, S1); barGrad.addColorStop(1, S2);
  ctx.fillStyle = barGrad;
  ctx.fillRect(pitchX, cardY, pitchW, topBarH);
  ctx.strokeStyle = B1; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pitchX, cardY+topBarH); ctx.lineTo(pitchX+pitchW, cardY+topBarH); ctx.stroke();

  const barMidY = cardY + topBarH/2;
  // الشريط الملوّن + تسمية نوع الملعب — يمين الشريط (الصفحة RTL)
  ctx.fillStyle = accent;
  _shRoundRect(ctx, pitchX+pitchW-topBarPadX-5*S, barMidY-7.5*S, 5*S, 15*S, 3*S); ctx.fill();
  ctx.fillStyle = '#9BA3AD'; ctx.font = `800 ${topBarFS}px Tajawal,Arial`; ctx.textAlign='right';
  ctx.fillText(pLabel, pitchX+pitchW-topBarPadX-5*S-7*S, barMidY+topBarFS*0.35);

  // شارة التشكيل (formation) — يسار الشريط
  if(lineup.formation){
    ctx.font = `900 ${formFS}px Tajawal,Arial`;
    const fTxt = lineup.formation;
    const fW = ctx.measureText(fTxt).width + 24*S;
    const fH = 20*S;
    ctx.fillStyle = isAway ? 'rgba(192,57,43,.14)' : 'rgba(201,160,43,.12)';
    ctx.strokeStyle = isAway ? 'rgba(192,57,43,.35)' : 'rgba(201,160,43,.3)';
    ctx.lineWidth = 1;
    _shRoundRect(ctx, pitchX+topBarPadX, barMidY-fH/2, fW, fH, 8*S); ctx.fill(); ctx.stroke();
    ctx.fillStyle = isAway ? '#ff9a90' : '#e6c157'; ctx.textAlign='center';
    ctx.fillText(fTxt, pitchX+topBarPadX+fW/2, barMidY+formFS*0.35);
  }

  // ── أرضية الملعب (مطابقة تماماً لتصميم الملعب الحقيقي في صفحة الجمهور) ──
  // -- 1) رسم الأرضية "مسطّحة" على كانفس مساعد بنفس القيم الحقيقية تماماً --
  const pitchSrc = document.createElement('canvas');
  pitchSrc.width = pitchW; pitchSrc.height = pitchGeomH;
  const pctx = pitchSrc.getContext('2d');
  const grassGrad = pctx.createLinearGradient(0, 0, 0, pitchGeomH);
  grassGrad.addColorStop(0, '#2e8b40');
  grassGrad.addColorStop(0.5, '#268038');
  grassGrad.addColorStop(1, '#1f7231');
  pctx.fillStyle = grassGrad;
  pctx.fillRect(0, 0, pitchW, pitchGeomH);
  const pitchGlow = pctx.createRadialGradient(pitchW/2, pitchGeomH*0.35, 0, pitchW/2, pitchGeomH*0.35, pitchW*0.8);
  pitchGlow.addColorStop(0, 'rgba(75,179,95,.45)');
  pitchGlow.addColorStop(1, 'rgba(31,114,49,0)');
  pctx.fillStyle = pitchGlow;
  pctx.fillRect(0, 0, pitchW, pitchGeomH);
  const nStripes = _pitchCfg.nStripes, stripeH = (pitchGeomH*0.94)/nStripes, stripesTop = pitchGeomH*0.03;
  for(let i=0;i<nStripes;i++){
    pctx.fillStyle = i%2===0 ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,.10)';
    pctx.fillRect(0, stripesTop+i*stripeH, pitchW, stripeH);
  }
  // ── خطوط الملعب (نِسَب _pitchCfg الديناميكية، بسماكة تتناسب مع S حتى تبان واضحة دوماً) ──
  const L = 'rgba(255,255,255,.78)', Lf = 'rgba(255,255,255,.55)';
  const lw1 = Math.max(2.2, 2.2*S*0.6), lw2 = Math.max(1.8, 1.8*S*0.6);
  pctx.strokeStyle=L; pctx.lineWidth=lw1;
  _shRoundRect(pctx, pitchW*0.05, pitchGeomH*0.03, pitchW*0.90, pitchGeomH*0.94, 4); pctx.stroke();
  pctx.beginPath(); pctx.moveTo(pitchW*0.05, pitchGeomH*0.5); pctx.lineTo(pitchW*0.95, pitchGeomH*0.5); pctx.stroke();
  pctx.beginPath(); pctx.arc(pitchW/2, pitchGeomH*0.5, pitchW*(_pitchCfg.centerR/100), 0, Math.PI*2); pctx.stroke();
  pctx.fillStyle=L; pctx.beginPath(); pctx.arc(pitchW/2, pitchGeomH*0.5, 3.2, 0, Math.PI*2); pctx.fill();
  const boxW=pitchW*(_pitchCfg.boxW/100), boxH=pitchGeomH*(_pitchCfg.boxH/100), sixW=pitchW*(_pitchCfg.sixW/100), sixH=pitchGeomH*(_pitchCfg.sixH/100);
  const boxX = pitchW/2 - boxW/2, sixX = pitchW/2 - sixW/2;
  pctx.strokeStyle=L; pctx.lineWidth=lw1;
  pctx.strokeRect(boxX, pitchGeomH*0.03, boxW, boxH);
  pctx.strokeStyle=Lf; pctx.lineWidth=lw2;
  pctx.strokeRect(sixX, pitchGeomH*0.03, sixW, sixH);
  if(_pitchCfg.spot){
    pctx.fillStyle=L; pctx.beginPath(); pctx.arc(pitchW/2, pitchGeomH*0.03+boxH-pitchGeomH*(_pitchCfg.spot/100), 3.2, 0, Math.PI*2); pctx.fill();
  }
  pctx.strokeStyle=L; pctx.lineWidth=lw1;
  pctx.strokeRect(boxX, pitchGeomH*0.97-boxH, boxW, boxH);
  pctx.strokeStyle=Lf; pctx.lineWidth=lw2;
  pctx.strokeRect(sixX, pitchGeomH*0.97-sixH, sixW, sixH);
  if(_pitchCfg.spot){
    pctx.fillStyle=L; pctx.beginPath(); pctx.arc(pitchW/2, pitchGeomH*0.97-boxH+pitchGeomH*(_pitchCfg.spot/100), 3.2, 0, Math.PI*2); pctx.fill();
  }
  pctx.strokeStyle=Lf; pctx.lineWidth=lw2;
  const cornerR = pitchW*0.02;
  [[pitchW*0.05,pitchGeomH*0.03],[pitchW*0.95,pitchGeomH*0.03],
   [pitchW*0.05,pitchGeomH*0.97],[pitchW*0.95,pitchGeomH*0.97]].forEach(([cx,cy],idx)=>{
    const angles = [[0,Math.PI/2],[Math.PI/2,Math.PI],[-Math.PI/2,0],[Math.PI,Math.PI*1.5]];
    pctx.beginPath(); pctx.arc(cx, cy, cornerR, angles[idx][0], angles[idx][1]); pctx.stroke();
  });

  // -- 2) إسقاط منظوري حقيقي (مطابق لـ CSS: perspective(820px) rotateX(26deg) scale(1.015) origin:50% 100%) --
  const _P_THETA = 26 * Math.PI / 180;
  const _P_SCALE = 1.015;
  const _P_D = pitchGeomH * 1.8;
  function _pRawFrac(yPct){
    let ly = (yPct/100 - 1) * pitchGeomH * _P_SCALE;
    const yRot = ly * Math.cos(_P_THETA);
    const zRot = ly * Math.sin(_P_THETA);
    const s = _P_D / (_P_D - zRot);
    return (pitchGeomH + yRot*s) / pitchGeomH; // 0=أعلى الملعب (بعيد) .. 1=أسفله (قريب) قبل أي تطبيع
  }
  // ✅ تطبيع المدى الرأسي بحيث تغطّي الأرضية المائلة كامل صندوق الملعب من 0% إلى 100%
  //    بدون أي شريط أفقي مسطّح غير معالج أعلى الملعب (كان يترك فجوة كبيرة فارغة).
  const _pFracMin = _pRawFrac(0), _pFracMax = _pRawFrac(100);
  function _pProj(xPct, yPct){
    let lx = (xPct/100 - 0.5) * pitchW * _P_SCALE;
    const raw = _pRawFrac(yPct);
    const nf = (raw - _pFracMin) / (_pFracMax - _pFracMin);
    let ly = (yPct/100 - 1) * pitchGeomH * _P_SCALE;
    const zRot = ly * Math.sin(_P_THETA);
    const s = _P_D / (_P_D - zRot);
    return { x: pitchX + pitchW/2 + lx*s, y: pitchY + nf*pitchGeomH, s };
  }

  ctx.save(); ctx.beginPath(); ctx.rect(pitchX, pitchY, pitchW, pitchGeomH); ctx.clip();
  const baseBg = ctx.createLinearGradient(pitchX, pitchY, pitchX+pitchW*0.6, pitchY+pitchGeomH);
  baseBg.addColorStop(0, '#0d3d1e'); baseBg.addColorStop(0.45, '#0a3319'); baseBg.addColorStop(1, '#072712');
  ctx.fillStyle = baseBg;
  ctx.fillRect(pitchX, pitchY, pitchW, pitchGeomH);
  const _STRIPS = 320;
  const _OVERLAP = 1.8;
  for(let i=0;i<_STRIPS;i++){
    const y0 = i/_STRIPS*pitchGeomH;
    const y1 = Math.min(pitchGeomH, (i+1)/_STRIPS*pitchGeomH + _OVERLAP);
    const y0Pct = y0/pitchGeomH*100, y1Pct = y1/pitchGeomH*100;
    const p0 = _pProj(0, y0Pct), p1 = _pProj(100, y0Pct), p2 = _pProj(0, y1Pct);
    const sw = pitchW, sh = y1 - y0;
    const a = (p1.x - p0.x)/sw, b = (p1.y - p0.y)/sw;
    const c = (p2.x - p0.x)/sh, d = (p2.y - p0.y)/sh;
    const e = p0.x - a*0 - c*y0, f = p0.y - b*0 - d*y0;
    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(pitchSrc, 0, y0, sw, sh, 0, y0, sw, sh);
    ctx.restore();
  }
  const topDark = ctx.createLinearGradient(0, pitchY, 0, pitchY+pitchGeomH);
  topDark.addColorStop(0, 'rgba(0,0,0,.14)');
  topDark.addColorStop(0.28, 'rgba(0,0,0,0)');
  topDark.addColorStop(0.86, 'rgba(0,0,0,0)');
  topDark.addColorStop(1, 'rgba(0,0,0,.08)');
  ctx.fillStyle = topDark;
  ctx.fillRect(pitchX, pitchY, pitchW, pitchGeomH);
  const topHi = ctx.createRadialGradient(W/2, pitchY+pitchGeomH*0.08, 0, W/2, pitchY+pitchGeomH*0.08, pitchW*0.7);
  topHi.addColorStop(0, 'rgba(255,255,255,.10)');
  topHi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topHi;
  ctx.fillRect(pitchX, pitchY, pitchW, pitchGeomH);
  ctx.restore();

  ctx.restore(); // نهاية قصّ بطاقة التشكيلة (شريط + ملعب)
  ctx.strokeStyle = B2; ctx.lineWidth = 1;
  _shRoundRect(ctx, pitchX, cardY, pitchW, cardH, 16*S); ctx.stroke();

  // ── رسم اللاعبين — مطابقة حرفية لتصميم الجمهور (تدرّج حلقة، شارة رقم بيضاء بحدّ أخضر،
  //    نجمة MOTM، وظلّ اللاعب الافتراضي بدل الرقم عند غياب الصورة) ──
  // ✅ توزيع رأسي "مُحكَم" بدل منحنى ثابت يفترض مدى 0-100 كاملاً — نحسب فعلياً
  //    أعلى/أدنى خط لاعبين في هذه التشكيلة تحديداً ونوزّع المسافة عليهما، فلا يبقى
  //    فراغ كبير فوق خط الهجوم عندما يكون أقرب خط للمرمى الأمامي بعيداً عن 0%.
  const _yVals = starters.map(p => p.y ?? 50);
  const _yMin = Math.min(..._yVals), _yMax = Math.max(..._yVals);
  const _yPadTop = 15, _yPadBot = 5;
  const _yRange = Math.max(1, _yMax - _yMin);
  const _persp = (yPct) => {
    const t = (yPct - _yMin) / _yRange;              // 0..1 ضمن مدى اللاعبين الفعلي
    return _yPadTop + Math.pow(Math.max(0,Math.min(1,t)), 0.92) * (100 - _yPadTop - _yPadBot);
  };
  const _ringColors = isGK => isGK ? ['#a86bd6','#7b3fb0'] : (isAway ? ['#e5645a','#a52a1e'] : ['#e6c157','#b8860b']);
  const _motm = (m && typeof _resolveMOTM === 'function') ? _resolveMOTM(m) : null;
  const _isMOTM = (p) => {
    if (!_motm || !_motm.name) return false;
    if (_motm.playerId && p.id) return _motm.playerId === p.id;
    return (typeof _normName==='function' ? _normName(_motm.name)===_normName(p.name||'') : _motm.name===p.name);
  };
  await Promise.all(starters.map(async (p, i) => {
    const x = pitchX + (p.x ?? 50)/100 * pitchW;
    const y = pitchY + (_persp(p.y ?? 50)/100) * pitchGeomH;
    const isGK = i===0 || p.position==='GK';
    const num = p.number || (i+1);
    const isMOTM = _isMOTM(p);
    const photo = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, teamId) : '';
    const img = await _shLoadImg(photo);
    const [ringA, ringB] = _ringColors(isGK);
    const aTxt = isGK ? '#CE9FFC' : (isAway ? '#ff9a90' : '#e6c157');
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, avSize/2, 0, Math.PI*2); ctx.clip();
    if(img){ _shDrawImgCover(ctx, img, x-avSize/2, y-avSize/2, avSize); }
    else{
      const bgGrad = ctx.createRadialGradient(x, y-avSize*0.09, avSize*0.05, x, y, avSize*0.7);
      bgGrad.addColorStop(0,'#22304e'); bgGrad.addColorStop(1,'#0d1526');
      ctx.fillStyle = bgGrad; ctx.fillRect(x-avSize/2, y-avSize/2, avSize, avSize);
      _shDrawSilhouette(ctx, x, y, avSize*0.62, aTxt);
    }
    ctx.restore();
    if(isMOTM){
      ctx.shadowColor='rgba(230,193,87,.6)'; ctx.shadowBlur=10*S;
      ctx.strokeStyle='#e6c157'; ctx.lineWidth=2.2*S;
      ctx.beginPath(); ctx.arc(x, y, avSize/2+1*S, 0, Math.PI*2); ctx.stroke();
      ctx.shadowBlur=0;
    } else {
      const ringGrad = ctx.createLinearGradient(x-avSize/2, y-avSize/2, x+avSize/2, y+avSize/2);
      ringGrad.addColorStop(0, ringA); ringGrad.addColorStop(1, ringB);
      ctx.strokeStyle = ringGrad; ctx.lineWidth = 1.5*S;
      ctx.beginPath(); ctx.arc(x, y, avSize/2+0.5*S, 0, Math.PI*2); ctx.stroke();
    }
    // شارة الرقم: بيضاء بحدّ أخضر داكن (مطابقة الأصل تماماً)
    ctx.fillStyle='#fff'; ctx.strokeStyle='#1f7231'; ctx.lineWidth=2*S;
    ctx.beginPath(); ctx.arc(x+avSize/2-6*S, y+avSize/2-6*S, numSz/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#111'; ctx.font=`900 ${numFS}px Tajawal,Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(num), x+avSize/2-6*S, y+avSize/2-6*S+1*S);
    ctx.textBaseline='alphabetic';
    // شارة الكابتن
    const isCap = lineup.captain && p.name && (p.name===lineup.captain || (p.id && p.id===lineup.captainId));
    if(isCap){
      ctx.fillStyle='#111'; ctx.strokeStyle='#e6c157'; ctx.lineWidth=2*S;
      ctx.beginPath(); ctx.arc(x-avSize/2+6*S, y+avSize/2-6*S, 11*S, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#e6c157'; ctx.font=`900 ${11*S}px Tajawal,Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('C', x-avSize/2+6*S, y+avSize/2-6*S+1*S);
      ctx.textBaseline='alphabetic';
    }
    // نجمة رجل المباراة
    if(isMOTM){
      const sx = x+avSize/2-3*S, sy = y-avSize/2+3*S;
      const starGrad = ctx.createLinearGradient(sx-9*S, sy-9*S, sx+9*S, sy+9*S);
      starGrad.addColorStop(0, '#e6c157'); starGrad.addColorStop(1, '#b8860b');
      ctx.fillStyle=starGrad; ctx.strokeStyle='#1f7231'; ctx.lineWidth=2*S;
      ctx.beginPath(); ctx.arc(sx, sy, 9.5*S, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      _shIconBadge(ctx, 'star', sx, sy, 11*S, '#1a1200', 0);
    }
    // اسم اللاعب
    const shortName = (p.name||'').split(' ').slice(-1)[0] || String(num);
    ctx.font=`800 ${nameFS}px Tajawal,Arial`; ctx.textAlign='center';
    const tw = ctx.measureText(shortName).width + 18*S;
    ctx.fillStyle='rgba(8,16,8,.88)';
    _shRoundRect(ctx, x-tw/2, y+avSize/2+10*S, tw, 24*S, 6*S); ctx.fill();
    ctx.fillStyle='#fff';
    ctx.fillText(shortName, x, y+avSize/2+27*S);
  }));

  // ── قسم البدلاء (بطاقات مستطيلة، مطابقة لتصميم الجمهور — نفس ألوان s2/s1/b1/b2 الحقيقية) ──
  if(subs.length){
    const by = cardBottomY + benchGapTop;
    _shRoundRect(ctx, pitchX, by, pitchW, benchH, 14*S);
    const bg2 = ctx.createLinearGradient(0, by, 0, by+benchH);
    bg2.addColorStop(0, S2); bg2.addColorStop(1, S1);
    ctx.fillStyle = bg2; ctx.fill();
    ctx.strokeStyle = B2; ctx.lineWidth = 1; ctx.stroke();

    let ty = by + benchPad + 7*S;
    ctx.fillStyle = accent;
    _shRoundRect(ctx, pitchX+pitchW-benchPad-5*S, ty-7*S, 5*S, 14*S, 3*S); ctx.fill();
    ctx.fillStyle = '#EDEFF2'; ctx.font = `900 ${11*S}px Tajawal,Arial`; ctx.textAlign='right';
    const _benchTitle = 'مقاعد البدلاء';
    ctx.fillText(_benchTitle, pitchX+pitchW-benchPad-5*S-7*S, ty+4*S);
    const titleW = ctx.measureText(_benchTitle).width;
    const titleLeftX = pitchX+pitchW-benchPad-5*S-7*S - titleW;
    const countTxt = String(subs.length);
    ctx.font = `900 ${10*S}px Tajawal,Arial`;
    const ctW = ctx.measureText(countTxt).width + 16*S;
    const badgeX = titleLeftX - 10*S - ctW;
    ctx.fillStyle = 'rgba(201,160,43,.14)';
    _shRoundRect(ctx, badgeX, ty-11*S, ctW, 22*S, 11*S); ctx.fill();
    ctx.fillStyle = accent; ctx.textAlign='center';
    ctx.fillText(countTxt, badgeX+ctW/2, ty+4*S);

    ty = by + benchPad + benchTitleH;
    await Promise.all(subs.map(async (p, i) => {
      const col = i % benchCols, row = Math.floor(i/benchCols);
      const tileX = pitchX + col*(benchCellW+benchGap);
      const tileY = ty + row*(benchCellH+benchGap);
      ctx.fillStyle = '#141824'; ctx.strokeStyle = B1; ctx.lineWidth = 1;
      _shRoundRect(ctx, tileX, tileY, benchCellW, benchCellH, 12*S); ctx.fill(); ctx.stroke();
      const cx = tileX + benchCellW/2, cy = tileY + 10*S + benchAv/2;
      const photo = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, teamId) : '';
      const img = await _shLoadImg(photo);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, benchAv/2, 0, Math.PI*2); ctx.clip();
      if(img) _shDrawImgCover(ctx, img, cx-benchAv/2, cy-benchAv/2, benchAv);
      else {
        const g = ctx.createRadialGradient(cx, cy-benchAv*0.07, benchAv*0.05, cx, cy, benchAv*0.7);
        g.addColorStop(0,'#1c2740'); g.addColorStop(1,'#0d1526');
        ctx.fillStyle = g; ctx.fillRect(cx-benchAv/2, cy-benchAv/2, benchAv, benchAv);
        _shDrawSilhouette(ctx, cx, cy, benchAv*0.6, '#666E78');
      }
      ctx.restore();
      ctx.strokeStyle='rgba(230,205,140,.4)'; ctx.lineWidth=1.5*S;
      ctx.beginPath(); ctx.arc(cx, cy, benchAv/2, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle='#fff'; ctx.strokeStyle='#141824'; ctx.lineWidth=1.5*S;
      ctx.beginPath(); ctx.arc(cx+benchAv/2-4*S, cy+benchAv/2-4*S, 9*S, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#111'; ctx.font=`900 ${9*S}px Tajawal,Arial`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(String(p.number||'—'), cx+benchAv/2-4*S, cy+benchAv/2-4*S+1*S);
      ctx.textBaseline='alphabetic';
      const bName = (p.name||'—').split(' ').slice(0,2).join(' ');
      ctx.fillStyle='#eee'; ctx.font=`700 ${12*S}px Tajawal,Arial`; ctx.textAlign='center';
      const nameY = cy+benchAv/2+22*S;
      ctx.fillText(bName.length>14?bName.slice(0,13)+'…':bName, cx, nameY);
      if(p.status && p.status!=='active'){
        const statusMap = { injured:{txt:'🤕 مصاب', color:'#C0392B'}, suspended:{txt:'🟨 موقوف', color:_SH_GOLD}, absent:{txt:'❌ غائب', color:'#888'} };
        const st = statusMap[p.status];
        if(st){
          ctx.font=`700 ${10*S}px Tajawal,Arial`;
          const stW = Math.min(ctx.measureText(st.txt).width + 14*S, benchCellW-16*S);
          ctx.fillStyle = st.color + '22';
          _shRoundRect(ctx, cx-stW/2, nameY+8*S, stW, 17*S, 5*S); ctx.fill();
          ctx.fillStyle = st.color;
          ctx.fillText(st.txt, cx, nameY+20*S);
        }
      }
    }));
  }

  _shFooter(ctx, W, H);
  return canvas;
}

function _qSvgCheck(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" style="flex-shrink:0"><path d="M20 6L9 17l-5-5"/></svg>';
}
function _qSvgX(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="10" height="10" style="flex-shrink:0"><path d="M18 6L6 18M6 6l12 12"/></svg>';
}
function renderGroupsStandings() {
  const el=document.getElementById('groupsContent');
  if(!el) return;
  if(!groups.length) { el.innerHTML='<div class="empty-state"><span class="empty-icon">👥</span><div>لا توجد مجموعات</div></div>'; return; }
  el.innerHTML=groups.map(g=>{
    const gTeams=(g.teamIds||[]).map(id=>teams.find(t=>t.id===id)).filter(Boolean);
    const gs=computeGroupStats(g.teamIds||[], g.id);
    const sorted=gTeams.sort((a,b)=>{const sa=gs[a.id]||{},sb=gs[b.id]||{};if((sb.pts||0)!==(sa.pts||0))return(sb.pts||0)-(sa.pts||0);const fa={...a,...sa},fb={...b,...sb};return applyTiebreak(fa,fb,matches);});
    const qCount=g.qualify||2;
    const manualQ=new Set(g.qualifiedTeamIds||[]);
    const manualE=new Set(g.eliminatedTeamIds||[]);
    // التأهل والإخراج يدويان بالكامل — لا استنتاج تلقائي. تظهر فقط بعد الاعتماد الرسمي.
    const isPublished = g.qualificationPublished === true;
    const showBadges = isPublished;
    // خزّن بيانات المجموعة للمشاركة (بعد حساب التأهل كي تُطابق الشارات الظاهرة للجمهور)
    window._shGroupsData = window._shGroupsData || {};
    window._shGroupsData[g.id] = { name: g.name, icon: g.icon, sorted, gs, qCount, manualQ, manualE, showBadges };

    /* 🔴 كان يطابق بعضوية الفريقين فقط — فأي مباراة إقصاء بين فريقين من
       نفس المجموعة تُحسب ضمن «مباريات المجموعة». نستبعد الإقصاء صراحةً،
       ونفضّل المطابقة بـ groupId حين يكون موجوداً (أدقّ من العضوية). */
    const groupMatches=matches.filter(m=>
      !m.isKnockout && !m.knockoutRoundId &&
      (m.groupId ? m.groupId===g.id
                 : (gTeams.some(t=>t.id===m.homeId)&&gTeams.some(t=>t.id===m.awayId))));
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
        <div style="display:flex;align-items:center;gap:8px">
          <div class="group-sub">${showBadges&&manualQ.size ? `${manualQ.size} متأهل` : `متأهلون: أفضل ${qCount}`}</div>
          ${_shButton(`_shShareGroup('${g.id}')`, 'مشاركة المجموعة')}
        </div>
      </div>
      <div class="gt-header">
        <div>#</div><div>الفريق</div>
        <div>ل</div><div>ف</div><div>ت</div><div>خ</div><div>±</div><div>ن</div>
      </div>
      ${sorted.map((t,i)=>{
        const s=gs[t.id]||{};const gd=(s.gf||0)-(s.ga||0);
        /* الحالة يدويّة بالكامل — فقط ما حدّده المنظّم صراحةً.
           تُقرأ من خريطة teamStatus الجديدة (متأهل · مشروط · ملحق · خارج ·
           منسحب · مستبعَد)، وترجع للحقلين القديمين في البطولات السابقة. */
        const stKey = showBadges ? _viewerTeamStatus(g, t.id) : '';
        const stm   = _viewerStatusMeta(stKey);
        const isQ    = !!stm.qualified;
        const isElim = !!stKey && !stm.qualified && stKey !== 'playoff';
        const rowColor = stKey ? stm.color : 'var(--t3)';
        return`<div class="gt-row${isQ?' gt-row-qualified':''}${isElim?' gt-row-eliminated':''}">
          <div class="gt-pos" style="color:${rowColor}">${i+1}</div>
          <div class="gt-team">
            <span>${logoHtml(t.logo,18,4)}</span>
            <span class="gt-name">${t.name}</span>
            ${stKey ? _statusChip(stKey) : ''}
          </div>
          <div class="gt-val">${s.p||0}</div>
          <div class="gt-val" style="color:var(--green)">${s.w||0}</div>
          <div class="gt-val">${s.d||0}</div>
          <div class="gt-val" style="color:var(--red)">${s.l||0}</div>
          <div class="gt-val" style="color:${gd>0?'var(--green)':gd<0?'var(--red)':'#666'}">${gd>0?'+'+gd:gd}</div>
          <div class="gt-pts" style="color:${isQ?'var(--green)':'var(--gold)'}">${s.pts||0}${_deductionBadgeV(t.id)}</div>
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
    const bShBtn0 = document.getElementById('shBracketBtn');
    if (bShBtn0) bShBtn0.innerHTML = '';
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
      // ✅︎ خانات "نصف مكتملة": فريق واحد تأهّل لهذه الخانة رسمياً وينتظر الفريق الثاني —
      //    يظهر للجمهور فوراً كفريق واحد مقابل TBD، بدون أي مباراة فعلية بعد.
      const takenSlots = new Set(withSlot.map(x => x.slot));
      Object.entries(r.slotPicks || {}).forEach(([slotIdx, pick]) => {
        const s = parseInt(slotIdx, 10);
        if (!pick || takenSlots.has(s)) return;
        withSlot.push({
          m: {
            id: null, isKnockout: true, knockoutRoundId: r.id, knockoutSlot: s,
            homeId: pick.teamId, homeName: pick.teamName, homeLogo: pick.teamLogo,
            awayId: null, awayName: null, status: 'pending',
          },
          slot: s
        });
      });
      return { name: roundNames[i] || r.name || ('الدور '+(i+1)), slots: r.slots, matchesWithSlot: withSlot };
    });

    // ✅︎ نفصل دور "مباراة تحديد المركز الثالث" إن وُجد — يُعرض كبطاقة صغيرة مستقلة بجانب النهائي
    const thirdIdx = resolvedRounds.findIndex(r => /ثالث/.test(r.name));
    const thirdRound = thirdIdx >= 0 ? resolvedRounds.splice(thirdIdx, 1)[0] : null;

    if (isCleanBracket(resolvedRounds)) {
      /* التصميم المرايا العمودي لا يحتاج خطوط SVG محسوبة من مواضع فعلية:
         التدرّج نحو المنتصف تُظهره الأسهم بين الأدوار، فلا شيء يُرسم فوق
         البطاقات ولا يحتاج إعادة حساب عند تغيّر المقاس أو التمرير. */
      el.innerHTML = buildVerticalBracketHTML(resolvedRounds, thirdRound);
      _btmDrawJoiners(el);
    } else {
      el.innerHTML = buildLinearBracketHTML(resolvedRounds, thirdRound);
    }
    window._shBracketData = { rounds: resolvedRounds, thirdRound };
    const bShBtn1 = document.getElementById('shBracketBtn');
    if (bShBtn1) bShBtn1.innerHTML = resolvedRounds.length ? _shButton('_shShareBracket()', 'مشاركة الشجرة') : '';
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
      const bShBtn2 = document.getElementById('shBracketBtn');
      if (bShBtn2) bShBtn2.innerHTML = '';
      return;
    }
    const resolvedRounds = rounds.map(r => ({ name: r.name, slots: r.ms.length, matchesWithSlot: r.ms.map((m,idx)=>({m,slot:idx})) }));
    el.innerHTML = buildLinearBracketHTML(resolvedRounds, null);
    window._shBracketData = { rounds: resolvedRounds, thirdRound: null };
    const bShBtn3 = document.getElementById('shBracketBtn');
    if (bShBtn3) bShBtn3.innerHTML = _shButton('_shShareBracket()', 'مشاركة الشجرة');
  }
}

// ── مشاركة شجرة البطولة — نفس تصميم صفحة الجمهور بالضبط (شجرة عمودية يسار/يمين
//    تتلاقى بالنهائي لو كانت "شجرة نظيفة"، وإلا قائمة أدوار كصفحة الجمهور) ──
window._shShareBracket = async function(){
  const d = window._shBracketData;
  if(!d || !d.rounds || !d.rounds.length){
    if(window.showToast) window.showToast('لا توجد شجرة بعد', 'error'); return;
  }
  if(window.showToast) window.showToast('جارِ تجهيز الصورة…', 'success');
  try{
    const canvas = isCleanBracket(d.rounds)
      ? await _shGenBracketTreeCanvas(d.rounds, d.thirdRound)
      : await _shGenBracketCanvas(d.rounds, d.thirdRound);
    const lines = ['🌳 *شجرة البطولة*', ''];
    const finalRound = d.rounds[d.rounds.length-1];
    const finalMatch = finalRound && finalRound.matchesWithSlot[0] && finalRound.matchesWithSlot[0].m;
    if(finalMatch && finalMatch.status === 'finished'){
      const _ps = _penScore(finalMatch);
      const hw = _ps ? _ps.h > _ps.a : (finalMatch.homeScore??0) > (finalMatch.awayScore??0);
      const champ = hw ? (finalMatch.homeName || (teams.find(t=>t.id===finalMatch.homeId)||{}).name) : (finalMatch.awayName || (teams.find(t=>t.id===finalMatch.awayId)||{}).name);
      if(champ) lines.push('🏆 البطل: ' + champ);
    }
    const text = _shBuildText('bracket', lines);
    _shShareCanvas(canvas, text, 'bracket');
  }catch(e){ console.warn('_shShareBracket', e); if(window.showToast) window.showToast('تعذّرت مشاركة الشجرة', 'error'); }
};

async function _shGenBracketCanvas(rounds, thirdRound){
  const W = 1080;
  const allRounds = thirdRound ? rounds.concat([thirdRound]) : rounds;
  const roundLabelH = 50, matchH = 108, matchGap = 14, roundGap = 26, headerH = 280;
  let H = headerH;
  allRounds.forEach(r => { H += roundLabelH + Math.max(r.matchesWithSlot.length,1)*(matchH+matchGap) - matchGap + roundGap; });
  H += 90;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, W, H);
  await _shHeader(ctx, W, 'شجرة البطولة', _shLeagueName(), 'trophy');

  let y = headerH;
  const teamsArr = window.teams || [];
  for(const r of allRounds){
    const isFinalRound = r === rounds[rounds.length-1];
    ctx.fillStyle = isFinalRound ? 'rgba(201,160,43,.14)' : 'rgba(255,255,255,.04)';
    _shRoundRect(ctx, 40, y, W-80, roundLabelH-10, 10); ctx.fill();
    ctx.textAlign='center'; ctx.fillStyle = isFinalRound ? _SH_GOLD : '#ccc';
    ctx.font='900 17px Tajawal,Arial';
    ctx.fillText(r.name || '', W/2, y+27);
    y += roundLabelH;

    const ms = r.matchesWithSlot.length ? r.matchesWithSlot : [{m:null}];
    for(const {m} of ms){
      _shRoundRect(ctx, 60, y, W-120, matchH-matchGap, 12);
      ctx.fillStyle='rgba(255,255,255,.03)'; ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1; ctx.stroke();

      const hasHome = m && (m.homeId || m.homeName);
      const hasAway = m && (m.awayId || m.awayName);
      const ht = hasHome ? (m.homeId ? (teamsArr.find(t=>t.id===m.homeId)||{name:m.homeName||'TBD',logo:''}) : {name:m.homeName||'TBD',logo:''}) : {name:'TBD',logo:''};
      const at = hasAway ? (m.awayId ? (teamsArr.find(t=>t.id===m.awayId)||{name:m.awayName||'TBD',logo:''}) : {name:m.awayName||'TBD',logo:''}) : {name:'TBD',logo:''};
      const isFin = m && m.status==='finished', isLive = m && m.status==='live';
      const _ps = m ? _penScore(m) : null;
      const hw = isFin && (_ps ? _ps.h > _ps.a : (m.homeScore??0) > (m.awayScore??0));
      const aw = isFin && (_ps ? _ps.a > _ps.h : (m.awayScore??0) > (m.homeScore??0));

      const rowH2 = (matchH-matchGap)/2;
      const rows = [{team:ht, win:hw, score:m&&(isFin||isLive)?(m.homeScore??0):null, pen:isFin&&_ps?_ps.h:null},
                    {team:at, win:aw, score:m&&(isFin||isLive)?(m.awayScore??0):null, pen:isFin&&_ps?_ps.a:null}];
      for(let ri=0; ri<2; ri++){
        const rw = rows[ri];
        const cy = y + rowH2*ri + rowH2/2 + 2;
        ctx.textAlign='right'; ctx.font = rw.win ? '800 16px Tajawal,Arial' : '600 16px Tajawal,Arial';
        ctx.fillStyle = rw.win ? '#fff' : hasHome||hasAway ? '#aaa' : '#555';
        ctx.fillText(rw.team.name || 'TBD', W-84, cy+5);
        ctx.textAlign='left'; ctx.font='900 17px Tajawal,Arial';
        ctx.fillStyle = rw.win ? _SH_GOLD : '#888';
        ctx.fillText(rw.score!=null ? String(rw.score)+(rw.pen!=null?' (رك '+rw.pen+')':'') : (isLive?'—':''), 84, cy+5);
      }
      if(isLive){ ctx.fillStyle='#e5533d'; ctx.beginPath(); ctx.arc(70, y+(matchH-matchGap)/2, 5, 0, Math.PI*2); ctx.fill(); }
      y += matchH;
    }
    y += roundGap - matchGap;
  }
  _shFooter(ctx, W, H);
  return canvas;
}

// ── صندوق مباراة واحد داخل شجرة البطولة (يطابق تصميم btMatchBox في صفحة الجمهور) ──
// ── صندوق مباراة داخل شجرة البطولة — مطابق تماماً لتصميم .bt-match الحقيقي
//    بصفحة الجمهور: خلفية صلبة #1E2226، حدود #363C43، شعار دائري لكل فريق،
//    تمييز الفائز بخلفية ذهبية خفيفة + اسم ذهبي عريض + سهم ▸، وتعتيم الخاسر
//    مع شطب اسمه وتحويل شعاره للتدرج الرمادي — بالضبط كما تظهر في البث.
/* ════════════════════════════════════════════════════════════════════
 *  بطاقة الشجرة على canvas — تخطيط أفقي مطابق لصفحة الجمهور
 *  ──────────────────────────────────────────────────────────────────
 *  كانت هذه الدالة ما زالت ترسم **التصميم القديم** (صفّان فوق بعضهما)
 *  بينما تحوّلت الشجرة في الموقع إلى تخطيط أفقي — فتخرج صورة المشاركة
 *  بشكل مختلف عمّا يراه الجمهور تماماً.
 *
 *  الآن نفس البنية: فريق يمين · الوسط · فريق يسار، والشعار فوق الاسم
 *  في كل جهة، وعمود وسط ثابت العرض (نتيجة · موعد · «ضد»).
 * ════════════════════════════════════════════════════════════════════ */
async function _btBoxCanvas(ctx, m, x, y, w, h, isFinal, tbdText){
  const _TBD    = tbdText || 'بانتظار المتأهل';
  const hasHome = m && (m.homeId || m.homeName);
  const hasAway = m && (m.awayId || m.awayName);
  const isEmpty = !hasHome && !hasAway;
  const isFin   = m && m.status === 'finished';
  const isLive  = m && m.status === 'live';
  const _ps     = m ? _penScore(m) : null;
  const R       = isFinal ? 12 : 9;

  // ── خلفية البطاقة وحدودها ──
  ctx.fillStyle = isFinal ? 'rgba(201,160,43,.05)' : isEmpty ? '#0d0f12' : '#131720';
  _shRoundRect(ctx, x, y, w, h, R); ctx.fill();
  ctx.strokeStyle = isFinal ? _SH_GOLD
    : isLive ? '#D64541'
    : isFin  ? 'rgba(201,160,43,.26)'
    : isEmpty? '#242A31' : '#39414A';
  ctx.lineWidth = isFinal ? 2.2 : 1.3;
  _shRoundRect(ctx, x, y, w, h, R); ctx.stroke();

  const teamsArr = window.teams || [];
  const ht = (m && m.homeId) ? (teamsArr.find(t=>t.id===m.homeId) || {name:m.homeName||_TBD, logo:''})
                             : {name:(m&&m.homeName)||_TBD, logo:''};
  const at = (m && m.awayId) ? (teamsArr.find(t=>t.id===m.awayId) || {name:m.awayName||_TBD, logo:''})
                             : {name:(m&&m.awayName)||_TBD, logo:''};

  const decided = isFin && (_ps ? _ps.h !== _ps.a : (m.homeScore??0) !== (m.awayScore??0));
  const hw = decided && (_ps ? _ps.h > _ps.a : (m.homeScore??0) > (m.awayScore??0));
  const aw = decided && !hw;

  // مقاسات تتناسب مع حجم البطاقة (النهائي أكبر)
  const lr     = isFinal ? 30 : 24;                 // نصف قطر الشعار
  const nameFS = isFinal ? 19 : 16;
  const logoY  = y + h * 0.36;
  const nameY  = y + h * 0.78;

  // ── جهة فريق واحدة: الشعار فوق الاسم ──
  const drawSide = async (team, win, lose, tbd, cx) => {
    const lg = team.logo || '';
    const isUrl = /^(data:|https?:|\/)/.test(lg);
    const img = (lg && isUrl) ? await _shLoadImg(lg) : null;

    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, logoY, lr, 0, Math.PI*2);
      ctx.fillStyle = '#0a0b0d'; ctx.fill(); ctx.clip();
      if (lose) ctx.filter = 'grayscale(1) opacity(.55)';
      _shDrawImgCover(ctx, img, cx-lr, logoY-lr, lr*2);
      ctx.restore();
      ctx.strokeStyle = win ? _SH_GOLD : lose ? '#333A40' : '#5A6470';
      ctx.lineWidth = win ? 2 : 1.3;
      ctx.beginPath(); ctx.arc(cx, logoY, lr, 0, Math.PI*2); ctx.stroke();
    } else if (lg && !isUrl) {
      /* شعار إيموجي — الموقع يدعمه، فلولا هذا الفرع لخرجت البطولات التي
         تستعمله بدروع فارغة في الصورة بينما موقعها يعرض شعاراتها. */
      ctx.beginPath(); ctx.arc(cx, logoY, lr, 0, Math.PI*2);
      ctx.fillStyle = '#0a0b0d'; ctx.fill();
      ctx.strokeStyle = win ? _SH_GOLD : '#5A6470'; ctx.lineWidth = win ? 2 : 1.3; ctx.stroke();
      ctx.save();
      if (lose) ctx.globalAlpha = .5;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font = Math.round(lr*1.3)+'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",Tajawal,Arial';
      ctx.fillText(lg, cx, logoY+1);
      ctx.restore(); ctx.textBaseline='alphabetic';
    } else {
      ctx.save(); ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.arc(cx, logoY, lr, 0, Math.PI*2);
      ctx.fillStyle = '#12161b'; ctx.fill();
      ctx.strokeStyle = '#3A424B'; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.restore();
      _shIconBadge && _shIconBadge(ctx, 'shield', cx, logoY, lr*0.85, '#4A535D', 0);
    }

    // الاسم تحت الشعار — يُقصّ بأمان داخل نصف عرض البطاقة
    ctx.textAlign = 'center';
    ctx.font = (win ? '900 ' : tbd ? '600 ' : '800 ') + (tbd ? nameFS-3 : nameFS) + 'px Tajawal,Arial';
    ctx.fillStyle = win ? _SH_GOLD : (lose || tbd) ? '#6B7480' : '#EDEFF2';
    let nm = team.name || _TBD;
    const maxW = w/2 - (isFinal ? 80 : 56);
    if (ctx.measureText(nm).width > maxW) {
      while (nm.length > 1 && ctx.measureText(nm+'…').width > maxW) nm = nm.slice(0,-1);
      nm += '…';
    }
    ctx.fillText(nm, cx, nameY);
  };

  await drawSide(ht, hw, isFin && !hw && aw, !hasHome, x + w*0.75);   // المضيف يميناً
  await drawSide(at, aw, isFin && !aw && hw, !hasAway, x + w*0.25);   // الضيف يساراً

  // ── عمود الوسط: نتيجة · موعد · «ضد» ──
  const cxm = x + w/2;
  ctx.textAlign = 'center';
  if (isFin || isLive) {
    /* 🔴 رسم النتيجة كنصّ واحد «2 : 1» يضع نتيجة المضيف **يساراً** لأن
       الأرقام تُرسم LTR — بينما فريق المضيف مرسوم يميناً. فتُقرأ النتيجة
       معكوسة. نرسم كل رقم في موضعه صراحةً: المضيف يمين الفاصل والضيف يساره. */
    const scFS = isFinal ? 40 : 30;
    ctx.font = `900 ${scFS}px Tajawal,Arial`;
    ctx.fillStyle = '#EDEFF2';
    const scY = y + h*0.5, gapS = scFS * 0.42;
    ctx.textAlign = 'left';
    ctx.fillText(String(m.homeScore ?? 0), cxm + gapS, scY);      // المضيف يميناً
    ctx.textAlign = 'right';
    ctx.fillText(String(m.awayScore ?? 0), cxm - gapS, scY);      // الضيف يساراً
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(scFS*0.6)}px Tajawal,Arial`;
    ctx.fillStyle = '#5A6470';
    ctx.fillText(':', cxm, scY - scFS*0.06);
    ctx.font = `900 ${scFS}px Tajawal,Arial`;
    if (_ps) {
      ctx.font = `800 ${isFinal ? 13 : 11}px Tajawal,Arial`;
      ctx.fillStyle = _SH_GOLD;
      ctx.fillText(`رك ${_ps.a}-${_ps.h}`, cxm, y + h*0.68);   // الضيف يساراً كالنتيجة
    }
  } else if (m && (m.date || m.time)) {
    const t = m.time ? (typeof formatTimeTo12H === 'function' ? formatTimeTo12H(m.time) : m.time) : '';
    if (t) {
      ctx.font = `800 ${isFinal ? 16 : 14}px Tajawal,Arial`;
      ctx.fillStyle = _SH_GOLD;
      ctx.fillText(t, cxm, y + h*0.46);
    }
    if (m.date) {
      ctx.font = `700 ${isFinal ? 13 : 12}px Tajawal,Arial`;
      ctx.fillStyle = '#8B939C';
      ctx.fillText(_btShortDate(m.date), cxm, y + h*0.64);
    }
  } else {
    ctx.font = `700 ${isFinal ? 18 : 14}px Tajawal,Arial`;
    ctx.fillStyle = '#5A6470';
    ctx.fillText('ضد', cxm, y + h*0.55);
  }

  // نقطة البث المباشر
  if (isLive) {
    ctx.fillStyle = '#D64541';
    ctx.beginPath(); ctx.arc(x+14, y+13, 4.5, 0, Math.PI*2); ctx.fill();
  }
}

// ── شجرة البطولة على canvas — **نفس تصميم المرايا العمودي** المعروض للجمهور
//    وفي لوحة الإدارة: المسار الأول فوق، النهائي في القلب، المسار الثاني تحت.
//    المباريات في شبكة عمودية بعمودين، والأسهم تتّجه نحو النهائي من الجهتين.
async function _shGenBracketTreeCanvas(rounds, thirdRound){
  const COL = 2;                                  // عمودان — مطابق للشبكة على الجوال
  const BOX_W = 420, BOX_H = 132, GAP_X = 26, GAP_Y = 40;  // GAP_Y يتّسع لقوس الوصل
  const SIDE = 46, LABEL_H = 34, FLOW_H = 44, HEADER_H = 280;  // LABEL_H = مساحة تلميح اسم الدور
  const W = SIDE*2 + COL*BOX_W + (COL-1)*GAP_X;   // 46*2 + 840 + 26 = 958 → نوسّعها لـ1080

  const CW = Math.max(1080, W);
  const originX = Math.round((CW - (COL*BOX_W + (COL-1)*GAP_X)) / 2);

  const lastIdx = rounds.length - 1;
  const finalRound = rounds[lastIdx];
  const finalMatch = (finalRound.matchesWithSlot[0] || {}).m || null;
  const pre = rounds.slice(0, lastIdx);

  // نص الانتظار السياقي — مطابق تماماً لنسخة HTML
  const waitText = (idx) => idx === 0 ? 'بانتظار القرعة' : `فائز ${rounds[idx-1].name}`;

  /* ① خطّط كل الأقسام أولاً لحساب الارتفاع الكلي قبل إنشاء اللوحة.
     كل قسم = { name, cards:[{m,tbd}], rows } */
  const sections = [];
  const halfOf = (r, half) => {
    const arr = buildSlotArr(r);
    const mid = Math.ceil(arr.length / 2);
    return half === 'top' ? arr.slice(0, mid) : arr.slice(mid);
  };
  pre.forEach((r, idx) => {
    const part = halfOf(r, 'top');
    if (part.length) sections.push({ name: r.name, cards: part, tbd: waitText(idx), flow: 'down' });
  });
  sections.push({ name: finalRound.name, cards: [finalMatch], tbd: 'بانتظار المتأهل', isFinal: true, flow: 'up' });
  pre.slice().reverse().forEach((r) => {
    const idx = pre.indexOf(r);
    const part = halfOf(r, 'bottom');
    if (part.length) sections.push({ name: r.name, cards: part, tbd: waitText(idx), flow: 'up' });
  });

  sections.forEach(sec => { sec.rows = Math.ceil(sec.cards.length / COL); });

  let H = HEADER_H;
  sections.forEach((sec, i) => {
    H += LABEL_H + sec.rows * (sec.isFinal ? BOX_H + 40 : BOX_H) + (sec.rows - 1) * GAP_Y;
    /* 🔴 كانت 210px تُحجَز للبطل دائماً — فتبقى **مساحة بيضاء ضخمة**
       أسفل النهائي في كل بطولة لم يُحسم نهائيها بعد. نحجزها فقط إن
       وُجد بطل فعلي. */
    if (sec.isFinal && _btChampCanvasInfo(finalMatch)) H += 210;
    if (i < sections.length - 1) H += FLOW_H;
  });
  if (thirdRound) H += 70 + BOX_H + 30;
  H += 100;

  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = H;
  const ctx = canvas.getContext('2d');
  _shBg(ctx, CW, H);
  await _shHeader(ctx, CW, 'شجرة البطولة', _shLeagueName(), 'trophy');

  let y = HEADER_H;

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];

    /* لا لوح خلفي للنهائي — مطابقة لنسختَي الجمهور والإدارة.
       الكتلة الذهبية كانت تكسر انتظام الشجرة؛ التمييز يأتي من الشارة
       والبطاقة نفسيهما (معيّنان جانبيان + إطار ذهبي). */

    /* تلميح اسم الدور — نصّ خافت لا شارة (مطابق للجمهور والإدارة) */
    ctx.textAlign = 'center';
    ctx.font = `700 ${sec.isFinal ? 19 : 17}px Tajawal,Arial`;
    ctx.fillStyle = sec.isFinal ? 'rgba(201,160,43,.9)' : 'rgba(139,147,156,.85)';
    ctx.fillText(sec.name, CW/2, y + 12);

    y += LABEL_H;

    /* ── خطوط القسم: الفرع يخرج من أسفل البطاقة عند منتصف عرضها
       (ومن أعلاها في النصف السفلي) ثم ينعطف نحو العمود الفقري ── */
    if (!sec.isFinal && sec.cards.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(201,160,43,.34)';
      ctx.lineWidth = 2;
      const spineX = CW / 2;
      const down = sec.flow === 'down';
      const dir  = down ? 1 : -1;
      const junctions = [];
      let top = Infinity, bot = -Infinity;
      for (let i = 0; i < sec.cards.length; i++) {
        const row = Math.floor(i / COL), col = i % COL;
        const total = Math.min(COL, sec.cards.length - row * COL);
        const rowW = total * BOX_W + (total - 1) * GAP_X;
        const sx = Math.round((CW - rowW) / 2);
        const bx = sx + (total - 1 - col) * (BOX_W + GAP_X);
        const by = y + row * (BOX_H + GAP_Y);
        const cx = bx + BOX_W / 2;
        const off = down ? by + BOX_H : by;
        const jy  = off + dir * 14;
        ctx.beginPath();
        ctx.moveTo(cx, off); ctx.lineTo(cx, jy);
        if (Math.abs(cx - spineX) > 3) ctx.lineTo(spineX, jy);
        ctx.stroke();
        junctions.push(jy);
        if (by < top) top = by;
        if (by + BOX_H > bot) bot = by + BOX_H;
      }
      const jTop = Math.min(...junctions), jBot = Math.max(...junctions);
      if (jBot > jTop) { ctx.beginPath(); ctx.moveTo(spineX, jTop); ctx.lineTo(spineX, jBot); ctx.stroke(); }
      const edgeOut = down ? bot + 30 : top - 30;
      ctx.beginPath(); ctx.moveTo(spineX, down ? jBot : jTop); ctx.lineTo(spineX, edgeOut); ctx.stroke();
      // عقد ذهبية عند نقاط الالتقاء
      ctx.fillStyle = 'rgba(201,160,43,.75)';
      junctions.forEach(jy => { ctx.beginPath(); ctx.arc(spineX, jy, 3.4, 0, Math.PI*2); ctx.fill(); });
      ctx.restore();
    }

    // ── بطاقات القسم في شبكة من عمودين (RTL: العمود الأول يميناً) ──
    for (let i = 0; i < sec.cards.length; i++) {
      const row = Math.floor(i / COL), col = i % COL;
      const total = Math.min(COL, sec.cards.length - row*COL);
      // توسيط الصف الأخير لو كان ناقصاً (مثل بطاقة النهائي الوحيدة)
      const rowW = total*BOX_W + (total-1)*GAP_X;
      const startX = Math.round((CW - rowW) / 2);
      const x = startX + (total - 1 - col) * (BOX_W + GAP_X);   // RTL
      const by = y + row * (BOX_H + GAP_Y);
      /* النهائي أكبر قليلاً — نفس التمييز الخفيف في الجمهور والإدارة */
      const bw = sec.isFinal ? BOX_W * 2 + GAP_X : BOX_W;   // عرض بطاقتين + الفجوة
      const bh = sec.isFinal ? BOX_H + 40 : BOX_H;
      const bx = sec.isFinal ? (CW - bw) / 2 : x;
      await _btBoxCanvas(ctx, sec.cards[i], bx, by, bw, bh, !!sec.isFinal, sec.tbd);
    }
    y += sec.rows * (sec.isFinal ? BOX_H + 40 : BOX_H) + (sec.rows - 1) * GAP_Y;

    // ── لوحة البطل داخل قسم النهائي مباشرة (تُرسم فقط عند وجود بطل) ──
    const champ = sec.isFinal ? _btChampCanvasInfo(finalMatch) : null;
    if (champ) {
      y += 18;
      {
        const pw = BOX_W * 2 + GAP_X, px = (CW-pw)/2, ph = 168;
        ctx.fillStyle='rgba(201,160,43,.06)';      // مسطّحة بلا تدرّج
        _shRoundRect(ctx, px, y, pw, ph, 12); ctx.fill();
        ctx.strokeStyle='rgba(201,160,43,.30)'; ctx.lineWidth=1.4;
        _shRoundRect(ctx, px, y, pw, ph, 12); ctx.stroke();
        const logoImg = champ.logo ? await _shLoadImg(champ.logo) : null;
        if (logoImg) {
          ctx.save();
          ctx.beginPath(); ctx.arc(CW/2, y+50, 30, 0, Math.PI*2); ctx.clip();
          _shDrawImgCover(ctx, logoImg, CW/2-30, y+20, 60);
          ctx.restore();
          ctx.strokeStyle=_SH_GOLD; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(CW/2, y+50, 30, 0, Math.PI*2); ctx.stroke();
        } else {
          _shIconBadge(ctx, 'trophy', CW/2, y+48, 40, _SH_GOLD, 0.12);
        }
        ctx.textAlign='center';
        ctx.font='900 34px Tajawal,Arial'; ctx.fillStyle=_SH_GOLD;
        ctx.fillText(champ.name, CW/2, y+114);
        ctx.font='800 14px Tajawal,Arial'; ctx.fillStyle='#8B939C';
        ctx.fillText('بطل البطولة', CW/2, y+142);
      }
      y += 192 - 18;
    }

    // ── سهم التدفّق نحو النهائي ──
    if (si < sections.length - 1) {
      // خطّ عمودي مستقيم بلا سهم ولا خطوط جانبية متلاشية
      const acx = CW/2;
      ctx.strokeStyle = 'rgba(201,160,43,.30)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(acx, y + 6); ctx.lineTo(acx, y + FLOW_H - 6); ctx.stroke();
      y += FLOW_H;
    }
  }

  // ── مباراة تحديد المركز الثالث ──
  if (thirdRound) {
    const m3 = (thirdRound.matchesWithSlot[0] || {}).m || null;
    y += 22;
    ctx.textAlign='center'; ctx.fillStyle='#cc8888'; ctx.font='800 20px Tajawal,Arial';
    const _tw3 = ctx.measureText(thirdRound.name||'').width;
    _shIconBadge(ctx, 'medal', CW/2 - _tw3/2 - 22, y+8, 22, '#cc8888', 0);
    ctx.fillText(thirdRound.name||'', CW/2+12, y+16);
    y += 44;
    await _btBoxCanvas(ctx, m3, CW/2-BOX_W/2, y, BOX_W, BOX_H, false, 'خاسر نصف النهائي');
    y += BOX_H + 20;
  }

  _shFooter(ctx, CW, H);
  return canvas;
}

// معلومات البطل للوحة التتويج (الاسم + الشعار) — أو null لو لم يُحسم النهائي
function _btChampCanvasInfo(finalMatch) {
  if (!finalMatch || finalMatch.status !== 'finished') return null;
  const _ps = _penScore(finalMatch);
  /* 🔴 نهائي انتهى بالتعادل بلا ركلات ترجيح: لا فائز بعد. كان الشرط
     `home > away` وحده فيعطي false عند التعادل، فيُتوَّج **فريق الضيف**
     بطلاً بالخطأ. لا بطل إلا بنتيجة حاسمة. */
  const _h = finalMatch.homeScore ?? 0, _a = finalMatch.awayScore ?? 0;
  const decided = _ps ? _ps.h !== _ps.a : _h !== _a;
  if (!decided) return null;
  const hw = _ps ? _ps.h > _ps.a : (_h > _a);
  const id = hw ? finalMatch.homeId : finalMatch.awayId;
  const t = (window.teams || []).find(x => x.id === id) || {};
  const name = t.name || (hw ? finalMatch.homeName : finalMatch.awayName) || '';
  return name ? { name, logo: t.logo || '' } : null;
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
/* ════════════════════════════════════════════════════════════════════
 *  شجرة الإقصاء — تصميم المرايا العمودي (أسلوب التطبيقات الرسمية)
 *  ──────────────────────────────────────────────────────────────────
 *  الترتيب من أعلى لأسفل يعكس مسارَي البطولة نحو النهائي في المنتصف:
 *
 *      دور الـ32  ← المسار الأول (النصف العلوي من القرعة)
 *      دور الـ16
 *      ربع النهائي
 *      نصف النهائي
 *      ══ النهائي ══   ← المنتصف تماماً
 *      نصف النهائي
 *      ربع النهائي     ← المسار الثاني (النصف السفلي، مرآة للأعلى)
 *      دور الـ16
 *      دور الـ32
 *
 *  لماذا هذا التصميم:
 *   • التمرير **طولي فقط** — لا تمرير عرضي إطلاقاً، فيعمل بنفس الراحة
 *     من دور الـ32 كما في النهائي، وهو الاتجاه الطبيعي للهاتف.
 *   • كل دور يُقسَم نصفين: نصفه الأعلى فوق النهائي ونصفه الأسفل تحته،
 *     فيرى الجمهور مسار كل فريق نحو المنتصف بلا لبس.
 *   • الأسهم بين الأدوار تتّجه **نحو النهائي**: للأسفل في النصف العلوي
 *     وللأعلى في النصف السفلي — فتتقارب العين على البطل في الوسط.
 *   • كل البطاقات بمقاس واحد ثابت مهما كان الدور أو حالة التأهل.
 * ════════════════════════════════════════════════════════════════════ */
/* ── بطاقة النهائي: نفس بطاقة قسم المباريات بكل مميزاتها ──
   بدل إعادة بناء تصميم مشابه، نستدعي `_matchCard` نفسها — فترث تلقائياً:
   الساعة الحيّة والدقيقة الجارية · حالة «متوقفة» وسببها · العدّ التنازلي
   خلال ٢٤ ساعة · «على وشك البدء» · ركلات الترجيح مع نتيجة الوقت الأصلي ·
   شارة الدور وذهاب/إياب · شارة التوقّع · الموعد والتاريخ.
   وأي ميزة تُضاف لبطاقة المباريات مستقبلاً تصل النهائي بلا عمل إضافي.

   نرجع لبطاقة الشجرة فقط حين لا يكون الطرفان معروفَين بعد — لأن
   `_matchCard` تعرض «؟» بينما الشجرة تحتاج «بانتظار المتأهل». */
function _finalCardHTML(finalMatch, lastIdx) {
  const known = finalMatch && (finalMatch.homeId || finalMatch.homeName)
                           && (finalMatch.awayId || finalMatch.awayName);
  if (known && typeof _matchCard === 'function') {
    return `<div class="btm-final-card">${_matchCard(finalMatch)}</div>`;
  }
  return btMatchBox(finalMatch, true, false, `r${lastIdx}-s0`, 'بانتظار المتأهل');
}

function buildVerticalBracketHTML(rounds, thirdRound) {
  const lastIdx = rounds.length - 1;
  const finalRound = rounds[lastIdx];
  const finalMatch = (finalRound.matchesWithSlot[0] || {}).m || null;
  const pre = rounds.slice(0, lastIdx);          // كل الأدوار عدا النهائي

  /* نص الطرف غير المحسوم يوضّح **من** يُنتظَر بالضبط، بدل عبارة عامة:
     في الدور الأول ننتظر القرعة/المجموعات، وبعده ننتظر فائز الدور السابق. */
  const waitText = (idx) => idx === 0
    ? 'بانتظار القرعة'
    : `فائز ${rounds[idx - 1].name}`;   // مختصر كي لا يُقصّ داخل البطاقة

  // قسم دور واحد (نصفه العلوي أو السفلي)
  const section = (r, idx, half) => {
    const arr = buildSlotArr(r);
    const mid = Math.ceil(arr.length / 2);
    const part = half === 'top' ? arr.slice(0, mid) : arr.slice(mid);
    if (!part.length) return '';
    const offset = half === 'top' ? 0 : mid;
    const cards = part.map((m, i) =>
      btMatchBox(m, false, false, `r${idx}-s${i + offset}`, waitText(idx))
    ).join('');
    /* data-half يخبر رسّام الخطوط باتّجاه التدفّق: أقسام النصف العلوي
       يخرج منها الخطّ لأسفل، والسفلي لأعلى — كلاهما نحو النهائي. */
    /* تلميح اسم الدور: نصّ خافت بلا شارة ولا إطار ولا خطوط — يكفي
       ليعرف القارئ أي دور يشاهد، بلا الزخرفة التي كانت تثقل الشجرة. */
    return `
      <div class="btm-round" data-half="${half}">
        <div class="btm-hint">${r.name}</div>
        <div class="btm-grid">${cards}</div>
      </div>`;
  };

  const ARROW_DOWN = '<div class="btm-flow btm-flow-down"><span class="btm-chev"></span></div>';
  const ARROW_UP   = '<div class="btm-flow btm-flow-up"><span class="btm-chev"></span></div>';

  // النصف العلوي: من الدور الأول نزولاً نحو النهائي
  const topHtml = pre.map((r, idx) => section(r, idx, 'top'))
    .filter(Boolean).join(ARROW_DOWN);
  /* النصف السفلي مرآة للأعلى: يبدأ من نصف النهائي مباشرة تحت النهائي،
     ويتّسع نزولاً حتى الدور الأول. لذلك نعكس ترتيب الأدوار **مرة واحدة**
     ونحتفظ بفهرس كل دور الأصلي (idx) كي تبقى معرّفات الخانات صحيحة. */
  const botHtml = pre.map((r, idx) => ({ r, idx })).reverse()
    .map(({ r, idx }) => section(r, idx, 'bottom'))
    .filter(Boolean).join(ARROW_UP);

  const champHtml = btChampionHTML(finalMatch);
  const thirdHtml = thirdRound ? btThirdPlaceHTML(thirdRound) : '';

  /* هل في الشجرة أي مباراة لها موعد معروض؟ إن نعم نوسّع عمود النتيجة
     **لكل** البطاقات فيبقى المقاس موحّداً؛ وإن لا نُبقيه ضيقاً فتتّسع
     أسماء الفرق. القرار على مستوى الشجرة كلها لا البطاقة الواحدة. */
  const _anySched = rounds.some(r => (r.matchesWithSlot || []).some(({ m }) =>
    m && m.status !== 'finished' && m.status !== 'live' && (m.date || m.time)));

  return `
    <div class="btm-wrap${_anySched ? ' btm-has-sched' : ''}">
      ${topHtml}
      ${topHtml ? ARROW_DOWN : ''}
      <!-- النهائي في القلب -->
      <div class="btm-round btm-final-round">
        <div class="btm-hint btm-hint-final">${finalRound.name}</div>
        <div class="btm-grid btm-grid-final">
          ${_finalCardHTML(finalMatch, lastIdx)}
        </div>
        ${champHtml}
      </div>
      ${botHtml ? ARROW_UP : ''}
      ${botHtml}
      ${thirdHtml}
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════
 *  خطوط الشجرة — وصلات الأزواج المتقابلة
 *  ──────────────────────────────────────────────────────────────────
 *  كل مباراتين متجاورتين (2k و 2k+1) يلتقي فائزاهما في مباراة واحدة
 *  بالدور التالي. نرسم بينهما **قوساً يجمعهما في ساق واحدة** داخل فراغ
 *  الشبكة، بنقطة ذهبية عند الملتقى — فتُقرأ الشجرة كشجرة فعلاً لا كأقسام
 *  مرصوصة.
 *
 *  لماذا وصلات أزواج لا خطوط ممتدة حتى البطاقة الهدف:
 *  في تخطيط عمودي بشبكة عمودين، البطاقة الهدف تقع في قسم لاحق تفصله
 *  صفوف كاملة وشارة دور. أي خط يمتدّ إليها سيمرّ **فوق بطاقات أخرى** —
 *  وهو بالضبط عيب التصميم القديم الذي تخلّصنا منه. فالوصلة المحلية هنا
 *  صحيحة هندسياً ولا تعبر فوق أي بطاقة إطلاقاً.
 * ════════════════════════════════════════════════════════════════════ */
function _btmDrawJoiners(root) {
  /* ════════════════════════════════════════════════════════════════
   *  خطوط الشجرة — عمود فقري مركزي وفروع قصيرة
   *  ────────────────────────────────────────────────────────────────
   *  المحاولة السابقة رسمت «قوس زوج» تحت كل بطاقتين متجاورتين، وكانت
   *  ساقه تنزل إلى **فراغ بين الصفوف** لا إلى شيء — فتبدو أقواساً
   *  معلّقة عشوائية تُشوّش أكثر مما تُوضّح.
   *
   *  الآن: خطّ عمودي واحد يمرّ بمحور الشجرة، وكل بطاقة تتصل به بفرع
   *  أفقي قصير من حافتها الداخلية. النتيجة بنية واحدة متّصلة ومنتظمة
   *  تقود العين من الأدوار نحو النهائي — ولا يمرّ خطّ فوق أي بطاقة.
   * ════════════════════════════════════════════════════════════════ */
  const wrap = root && root.querySelector('.btm-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('svg.btm-lines').forEach(el => el.remove());
  wrap.style.position = 'relative';

  const wr = wrap.getBoundingClientRect();
  const paths = [], nodes = [];

  wrap.querySelectorAll('.btm-round').forEach(sec => {
    if (!sec.getAttribute('data-half')) return;          // النهائي بلا فروع
    const cards = [...sec.querySelectorAll('.bt-match')];
    if (!cards.length) return;

    const R = cards.map(c => c.getBoundingClientRect());
    const spineX = Math.round((Math.min(...R.map(r => r.left)) +
                               Math.max(...R.map(r => r.right))) / 2 - wr.left);

    /* ── الفرع يخرج من **أسفل** البطاقة عند منتصف عرضها ──
       (وفي النصف السفلي من الشجرة يخرج من أعلاها، لأن التدفّق يصعد نحو
       النهائي). ينزل قليلاً ثم ينعطف نحو العمود الفقري — وهو الشكل
       المتعارف عليه في شجر البطولات، بدل خروجه من الحافة الجانبية. */
    const down = sec.getAttribute('data-half') === 'top';
    const dir  = down ? 1 : -1;
    const junctions = [];
    R.forEach(r => {
      const cx  = Math.round(r.left + r.width / 2 - wr.left);
      const off = Math.round((down ? r.bottom : r.top) - wr.top);   // حافة الخروج
      const jy  = off + dir * 11;                                    // مستوى الانعطاف
      paths.push(`M ${cx} ${off} L ${cx} ${jy}` +
                 (Math.abs(cx - spineX) > 3 ? ` L ${spineX} ${jy}` : ''));
      nodes.push({ x: spineX, y: jy });
      junctions.push(jy);
    });

    // العمود الفقري يصل نقاط الانعطاف ببعضها ويمتدّ نحو الدور التالي
    const jTop = Math.min(...junctions), jBot = Math.max(...junctions);
    if (jBot > jTop) paths.push(`M ${spineX} ${jTop} L ${spineX} ${jBot}`);
    const edgeOut = down
      ? Math.round(Math.max(...R.map(r => r.bottom)) - wr.top) + 22
      : Math.round(Math.min(...R.map(r => r.top))    - wr.top) - 22;
    paths.push(`M ${spineX} ${down ? jBot : jTop} L ${spineX} ${edgeOut}`);
  });

  if (!paths.length) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'btm-lines');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0';
  svg.innerHTML =
    paths.map(d => `<path d="${d}" fill="none" stroke="rgba(201,160,43,.34)" stroke-width="1.5" shape-rendering="crispEdges"/>`).join('') +
    nodes.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.4" fill="rgba(201,160,43,.75)"/>`).join('');
  wrap.appendChild(svg);
}
window._btmDrawJoiners = _btmDrawJoiners;

/* إعادة الرسم عند تغيّر المقاس — المواضع محسوبة من الصفحة الفعلية */
if (!window._btmResizeBound) {
  window._btmResizeBound = true;
  let _t;
  window.addEventListener('resize', () => {
    clearTimeout(_t);
    _t = setTimeout(() => {
      const el = document.getElementById('bracketContent');
      if (el && el.querySelector('.btm-wrap')) _btmDrawJoiners(el);
    }, 180);
  });
}

/* ⚠️ غير مستخدَم — لا يُستدعى من أي مكان (بقايا التصميم المرايا القديم).
   لا تُحيِه قبل تحديث CSS: البطاقات الآن تملأ خلية شبكة (--btm-w) وستفيض
   من أعمدة .bt-col ذات العرض 158px. الشجرة الفعلية = buildVerticalBracketHTML. */
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

/* تاريخ مختصر «يوم/شهر» — الشكل الكامل 2026-09-08 لا يسع عمود النتيجة */
function _btShortDate(d) {
  const p = String(d || '').split('-');
  if (p.length !== 3) return String(d || '');
  return `${p[2]}/${p[1]}`;
}

function btMatchBox(m, isFinal, mirror, brkAttr, tbdText) {
  /* ════════════════════════════════════════════════════════════════
   *  بطاقة الشجرة — تخطيط أفقي كبطاقة المباريات
   *  فريق يمين · الوسط (نتيجة أو موعد) · فريق يسار
   *  ────────────────────────────────────────────────────────────────
   *  المقاس كما هو (لا تكبير): الشعار فوق الاسم في كل جهة، فيتّسع
   *  التخطيط الأفقي داخل 156px بلا قصّ. وعمود الوسط ثابت العرض دائماً،
   *  فمقاس كل البطاقات واحد سواء حملت نتيجة أو موعداً أو لا شيء.
   * ════════════════════════════════════════════════════════════════ */
  const _TBD = tbdText || 'بانتظار المتأهل';
  const brk = brkAttr ? ` data-brk="${brkAttr}"` : '';
  const hasHome = m && (m.homeId || m.homeName);
  const hasAway = m && (m.awayId || m.awayName);
  const crestTbd = `<span class="btc-crest">${window.Icon ? window.Icon('shield', 14) : ''}</span>`;

  // جهة فريق واحدة: الشعار فوق والاسم تحته
  const side = (t, win, lose, isTbd) => `
    <div class="btc-side${win ? ' btc-win' : ''}${lose ? ' btc-lose' : ''}">
      <span class="btc-logo">${t && t.logo ? logoHtml(t.logo, 24, 6) : crestTbd}</span>
      <span class="btc-name${isTbd ? ' btc-tbd' : ''}">${(t && t.name) || _TBD}</span>
    </div>`;

  // ── خانة لم يتأهل لها أحد بعد ──
  if (!hasHome && !hasAway) {
    return `<div class="bt-match btc bt-empty"${brk}>
      ${side(null, false, false, true)}
      <div class="btc-mid"><span class="btc-vs">ضد</span></div>
      ${side(null, false, false, true)}
    </div>`;
  }

  const ht = m.homeId ? (teams.find(t=>t.id===m.homeId)||{name:m.homeName||_TBD,logo:''}) : {name:m.homeName||_TBD,logo:''};
  const at = m.awayId ? (teams.find(t=>t.id===m.awayId)||{name:m.awayName||_TBD,logo:''}) : {name:m.awayName||_TBD,logo:''};
  const isFin  = m.status === 'finished';
  const isLive = m.status === 'live';
  const _ps = _penScore(m);
  const hw = isFin && (_ps ? _ps.h > _ps.a : (m.homeScore ?? 0) > (m.awayScore ?? 0));
  const aw = isFin && (_ps ? _ps.a > _ps.h : (m.awayScore ?? 0) > (m.homeScore ?? 0));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : (hasAway ? `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')` : '');

  /* الوسط: نتيجة · أو موعد · أو «ضد». كلها في نفس العمود ثابت العرض
     فلا يتغيّر مقاس البطاقة باختلاف المحتوى. */
  let mid;
  if (isFin || isLive) {
    mid = `<span class="btc-score">${m.homeScore ?? 0}<i>:</i>${m.awayScore ?? 0}</span>
           ${_ps ? `<span class="btc-pen">رك ${_ps.h}-${_ps.a}</span>` : ''}`;
  } else if (m.date || m.time) {
    const t = m.time ? (typeof formatTimeTo12H === 'function' ? formatTimeTo12H(m.time) : m.time) : '';
    mid = `${t ? `<span class="btc-time">${t}</span>` : ''}
           ${m.date ? `<span class="btc-date">${_btShortDate(m.date)}</span>` : ''}`;
  } else {
    mid = `<span class="btc-vs">ضد</span>`;
  }

  return `<div class="bt-match btc ${isLive?'bt-live':isFin?'bt-done':''}${isFinal?' bt-final':''}"${brk} onclick="${clickFn}">
    ${isLive ? '<span class="bt-live-dot"></span>' : ''}
    ${side(ht, hw, isFin && !hw && aw, !hasHome)}
    <div class="btc-mid">${mid}</div>
    ${side(at, aw, isFin && !aw && hw, !hasAway)}
  </div>`;
}

function btChampionHTML(finalMatch) {
  if (!finalMatch || finalMatch.status !== 'finished') return '';
  const _ps = _penScore(finalMatch);
  /* 🔴 لا بطل إلا بنتيجة حاسمة: نهائي منتهٍ بالتعادل بلا ركلات ترجيح كان
     يُتوَّج فيه **فريق الضيف** بطلاً، لأن الشرط `home > away` يعطي false
     عند التعادل فيُقرأ كفوز للضيف. */
  const _h = finalMatch.homeScore ?? 0, _a = finalMatch.awayScore ?? 0;
  const decided = _ps ? _ps.h !== _ps.a : _h !== _a;
  if (!decided) return '';
  const hw = _ps ? _ps.h > _ps.a : (_h > _a);
  /* ✅︎ كان يقرأ homeName/awayName فقط — وهما فارغان في المسار الطبيعي
     حيث تُخزَّن المباراة بـ homeId/awayId. فكان البطل **لا يظهر إطلاقاً**
     مهما انتهى النهائي. نحلّ الاسم من الفرق أولاً ثم نرجع للنص المخزَّن. */
  const _nameOf = (id, fallback) =>
    (id ? (teams.find(t => t.id === id) || {}).name : '') || fallback || '';
  const champName = hw
    ? _nameOf(finalMatch.homeId, finalMatch.homeName)
    : _nameOf(finalMatch.awayId, finalMatch.awayName);
  if (!champName) return '';
  const champLogo = (teams.find(t => t.id === (hw ? finalMatch.homeId : finalMatch.awayId)) || {}).logo || '';
  return `<div class="bt-champion">
    ${champLogo ? `<div class="bt-champion-logo">${logoHtml(champLogo, 42, 10)}</div>`
                : '<div class="bt-champion-crown">🏆</div>'}
    <div class="bt-champion-name">${champName}</div>
    <div class="bt-champion-tag">بطل البطولة</div>
  </div>`;
}

function btThirdPlaceHTML(thirdRound) {
  const m = (thirdRound.matchesWithSlot[0] || {}).m || null;
  /* طرفا هذه المباراة هما **خاسرا** نصف النهائي لا الفائزون، فعبارة
     «بانتظار المتأهل» كانت خاطئة منطقياً ومربكة للجمهور. */
  return `<div class="bt-thirdplace">
    <div class="bt-thirdplace-label">🥉 ${thirdRound.name}</div>
    ${btMatchBox(m, false, false, '', 'خاسر نصف النهائي')}
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
  const leg1 = legs.slice().sort((a,b)=>(_legOf(a)||1)-(_legOf(b)||1))[0];
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
  /* ✅︎ كان يستعمل _TBD وهو متغيّر داخل btMatchBox — خارج نطاقه هنا تماماً،
     فكان أي طرف غير محسوم في العرض الخطي يرمي ReferenceError ويُفرِغ التبويب. */
  const _TBD = /ثالث/.test(String(roundName||'')) ? 'خاسر نصف النهائي' : 'بانتظار المتأهل';
  if (!hasHome && !hasAway) return `
    <div class="bracket-match bm-empty">
      <div class="bm-team"><span class="bm-name" style="color:var(--t3)">${_TBD}</span></div>
      <div class="bm-sep" style="height:1px;background:var(--b1)"></div>
      <div class="bm-team"><span class="bm-name" style="color:var(--t3)">${_TBD}</span></div>
    </div>`;

  const ht = m.homeId ? (teams.find(t=>t.id===m.homeId)||{name:m.homeName||_TBD,logo:''}) : {name:m.homeName||_TBD,logo:''};
  const at = m.awayId ? (teams.find(t=>t.id===m.awayId)||{name:m.awayName||_TBD,logo:''}) : {name:m.awayName||_TBD,logo:''};
  const isFin  = m.status==='finished';
  const isLive = m.status==='live';
  const _ps = _penScore(m);
  const hw = isFin && (_ps ? _ps.h > _ps.a : (m.homeScore ?? 0) > (m.awayScore ?? 0));
  const aw = isFin && (_ps ? _ps.a > _ps.h : (m.awayScore ?? 0) > (m.homeScore ?? 0));
  const clickFn = m.id ? `openMatchDetail('${m.id}')` : (hasAway ? `openBracketMatch('','${encodeURIComponent(String(m.id||''))}')` : '');
  // شارة المجموع الكلي (تظهر على مباراة الإياب عند اكتمال المواجهة)
  const _agg = (_legOf(m) === 2) ? _aggForMatch(m) : null;
  const aggBadge = _agg ? `<div style="text-align:center;font-size:9px;font-weight:800;color:var(--gold);background:rgba(201,160,43,.1);border-top:1px solid var(--b1);padding:3px">المجموع: ${_agg.aggA} - ${_agg.aggB}</div>` : '';
  return `<div class="bracket-match ${isLive?'bm-live':isFin?'bm-done':''}" onclick="${clickFn}">
    <div class="bm-team ${hw?'bm-winner':''}">
      <span class="bm-logo">${logoHtml(ht.logo,20,5)}</span>
      <span class="bm-name">${ht.name}${_legOf(m)?`<span style="font-size:8px;color:var(--t3);margin-inline-start:4px">${_legLabel(_legOf(m))}</span>`:''}</span>
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
  /* الملحق تبويب اختياري تماماً: لا يظهر إلا إذا فعّله المنظّم **ونشره**.
     فالبطولات التي لا ملحق فيها لا ترى الزرّ إطلاقاً. */
  const poEl = document.getElementById('tab-playoff');
  const playoffOK = (typeof _poVisible === 'function') && _poVisible();
  const poBtn = playoffOK
    ? `<button class="bn-item" id="bn-playoff" onclick="switchTab('playoff',null,this)"><span class="bi">${window.Icon?Icon('swords',19):''}</span>${_poV().name}</button>`
    : '';
  if (poEl) poEl.style.display = playoffOK ? 'block' : 'none';

  if(type === 'knockout') {
    bn.innerHTML = `
      <button class="bn-item active" id="bn-home"     onclick="switchTab('home',null,this)"><span class="bi">${window.Icon?Icon('home',19):''}</span>الرئيسية</button>
      ${bracketOK ? `<button class="bn-item" id="bn-bracket"  onclick="switchTab('bracket',null,this)"><span class="bi">${window.Icon?Icon('tree',19):''}</span>الشجرة</button>` : ''}
      ${poBtn}
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
      ${poBtn}
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
      ${poBtn}
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
      ${poBtn}
      <button class="bn-item" id="bn-matches"   onclick="switchTab('matches',null,this)"><span class="bi">${window.Icon?Icon('ball',19):''}</span>المباريات</button>
      <button class="bn-item" id="bn-teams"     onclick="switchTab('teams',null,this)"><span class="bi">${window.Icon?Icon('users',19):''}</span>الفرق</button>
      <button class="bn-item" id="bn-stats"     onclick="switchTab('stats',null,this)"><span class="bi">${window.Icon?Icon('chart',19):''}</span>إحصائيات</button>
      <button class="bn-item" id="bn-live"      onclick="switchTab('live',null,this)" style="display:none"><span class="bi">${window.Icon?Icon('live',19):''}</span>مباشر</button>`;
    if(standEl) standEl.style.display = '';
  }
  // ✅︎ للـ home-section sub-header "عرض الكل" — أخفه إذا مش دوري نقاط أو موحّد
  if(!_HAS_STANDINGS(type)) {
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
  if (name === 'playoff') renderPlayoff();
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
      ].map(([lbl,key,val,clr])=>`
        <div style="padding:12px 6px;text-align:center;position:relative">
          <div style="font-size:22px;font-weight:900;font-family:'Tajawal',sans-serif;color:${clr};line-height:1">${val}${key==='pts'?_deductionBadgeV(t.id):''}</div>
          <div style="font-size:9px;color:var(--t3);margin-top:2px">${lbl}</div>
        </div>`).join('')}
    </div>
    ${_deductionOfV(t.id) ? `
      <div style="margin:0 14px 12px;padding:10px 12px;border-radius:10px;
                  background:rgba(224,82,82,.07);border:1px solid rgba(224,82,82,.25);text-align:center">
        <div style="font-size:12px;font-weight:900;color:#e05252">➖ خُصمت ${_deductionOfV(t.id)} نقطة</div>
        ${t.deductionReason ? `<div style="font-size:10px;color:var(--t3);margin-top:3px">${t.deductionReason}</div>` : ''}
      </div>` : ''}
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
  if (typeof _psFullStop === 'function') _psFullStop();   // أغلق البث ويوقف إعادة المحاولة
  if (_psDetailUnsub) { try{_psDetailUnsub();}catch(e){} _psDetailUnsub=null; }
  if (_psScoreTick) { clearInterval(_psScoreTick); _psScoreTick=null; }
  if (typeof _destroyHlsPlayers === 'function') _destroyHlsPlayers();
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
/* صورة اللاعب من الكشف الحيّ — تمرّ عبر _lineupPhoto نفسها كي تُطبَّق
   القواعد الصارمة ذاتها في كل مكان: الهوية تحسم، ثم الاسم+الرقم، ثم
   الاسم إن كان فريداً فقط، وبلا أي مسح عابر للفرق. توحيد المصدر يمنع
   عودة الخلط من باب خلفي عند تعديل أحد النسخ دون الأخرى. */
function _playerPhoto(teamId, playerId, name) {
  return _lineupPhoto({ id: playerId || null, name: name || '' }, teamId);
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
  // زر مشاركة جدول الهدّافين (أعلى 5 دائماً، بغض النظر عن حالة «عرض المزيد»)
  const scShBtn = document.getElementById('shStatsScorersBtn');
  if (scShBtn) scShBtn.innerHTML = scorers.length ? _shButton('_shShareTopScorers()', 'مشاركة الهدّافين') : '';

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
    const shBtn = document.getElementById('shScorersBtn');
    if (shBtn) shBtn.innerHTML = data.length ? _shButton('_shShareTopScorers()', 'مشاركة الهدّافين') : '';
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
  /* 🔴 كان يحتسب **كل** المباريات المنتهية بما فيها مباريات الإقصاء.
     في «الدوري الموحّد» (جدول ثم إقصاء) كانت نتائج الإقصاء تُضاف لجدول
     الترتيب فتُفسده — الجدول يخصّ الدور الدوري وحده.
     وركلات الترجيح لا تُحتسب في الجدول إطلاقاً: المباراة تعادل. */
  matches.filter(m => m.status === 'finished' && !m.isKnockout && !m.knockoutRoundId).forEach(m => {
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
  /* ➖ خصم النقاط الإداري — يُطرح بعد اكتمال الحساب من المباريات.
     الجمهور يحسب مستقلاً عن الإدارة، فلولا الطرح هنا لظهر للجمهور
     ترتيب مخالف لما يراه المنظّم في لوحته. */
  Object.keys(statsMap).forEach(id => {
    const d = _deductionOfV(id);
    if (d) statsMap[id].pts -= d;
  });
  teams.forEach(t => { if (statsMap[t.id]) Object.assign(t, statsMap[t.id]); });

  const sorted = [...teams].sort((a, b) => {
    if ((b.pts||0) !== (a.pts||0)) return (b.pts||0)-(a.pts||0);
    return applyTiebreak(a, b, matches);
  });

  /* مناطق الترتيب — قواعد مرنة يحدّدها المنظّم (من مركز إلى مركز باسم
     ولون)، مع ترجمة تلقائية للبطولات القديمة ذات المناطق الستّ الثابتة. */
  const _zRules = _viewerZoneRules();
  const zoneColors = {};
  sorted.forEach((_, i) => {
    const zr = _viewerZoneAt(_zRules, i + 1);
    if (zr) zoneColors[i] = zr.color;
  });

  const tableHtml = `
    <div class="std-wrap${sorted.some(t => _swStatusOfV(t.id)) ? ' std-has-tag' : ''}">
      <div class="std-head">
        <span class="std-h-pos">#</span>
        <span></span>
        <span class="std-h-team">الفريق</span>
        <span class="std-h-num" title="لعب">ل</span>
        <span class="std-h-num std-hide-sm" title="فاز">ف</span>
        <span class="std-h-num std-hide-sm" title="تعادل">ت</span>
        <span class="std-h-num std-hide-sm" title="خسر">خ</span>
        <span class="std-h-gd" title="فارق الأهداف">الفارق</span>
        <span class="std-h-pts">نقاط</span>
      </div>
      <div class="std-body">
        ${sorted.map((t, i) => {
          const s = statsMap[t.id] || {};
          const gd = (s.gf||0)-(s.ga||0);
          const zc = zoneColors[i] || '';
          const rank = i+1;
          /* ✅︎ الفارق: نغلّفه بعزل ثنائي الاتجاه — بدونه يعرض المتصفح
             «‎-3» في سياق RTL كأنها «3-» وتُقرأ خطأً. */
          const gdTxt = `<bdi>${gd>0?'+'+gd:gd}</bdi>`;
          return `<div class="std-row ${i===0?'std-first':''}" style="--zc:${zc||'transparent'}" onclick="openTeamProfile('${t.id}')">
            <span class="std-pos">
              <span class="std-pos-num" style="${zc?`color:${zc}`:''}">${rank}</span>
            </span>
            <span class="std-logo">${logoHtml(t.logo,30,8)}</span>
            <span class="std-team"><span class="std-name">${t.name}</span>${_swNameChip(t.id)}</span>
            <span class="std-num">${s.p||0}</span>
            <span class="std-num std-hide-sm" style="color:var(--green)">${s.w||0}</span>
            <span class="std-num std-hide-sm">${s.d||0}</span>
            <span class="std-num std-hide-sm" style="color:var(--red)">${s.l||0}</span>
            <span class="std-gd" style="color:${gd>0?'var(--green)':gd<0?'var(--red)':'var(--t3)'}">${gdTxt}</span>
            <span class="std-pts">${s.pts||0}${_deductionBadgeV(t.id)}</span>
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
    legEl.innerHTML = _zRules.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 14px">` +
      _zRules.map(r => `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--t3)">
        <div style="width:10px;height:10px;border-radius:2px;background:${r.color}"></div>${r.label}</div>`).join('') +
      `</div>` : '';
  }
}
// ✅︎ تصدير — يسمح لـall-fixes.js باستبدالها فعلياً
window.renderStandings = renderStandings;

/* ════════════════════════════════════════════════════════════════════
 *  🥊 الملحق عند الجمهور — تبويب مستقلّ
 *  ──────────────────────────────────────────────────────────────────
 *  يظهر **فقط** إذا فعّله المنظّم ونشره (`playoff.enabled && published`)،
 *  فالبطولات التي لا ملحق فيها لا ترى التبويب إطلاقاً.
 *  يعرض: الصيغة والمقاعد · المباريات · المتأهلون عبر الملحق.
 * ════════════════════════════════════════════════════════════════════ */
function _poV() {
  const p = (window.settings && window.settings.playoff) || {};
  return {
    enabled:      !!p.enabled,
    published:    !!p.published,
    name:         p.name || 'الملحق',
    // ✅︎ الإدارة تكتب `type` الآن؛ `format` اسم قديم نقبله للبطولات السابقة
    type:         p.type || p.format || 'single',
    slots:        parseInt(p.slots, 10) > 0 ? parseInt(p.slots, 10) : 1,
    teamIds:      Array.isArray(p.teamIds) ? p.teamIds : [],
    qualifiedIds: Array.isArray(p.qualifiedIds) ? p.qualifiedIds : [],
    venue:        p.venue || '',
    extraTime:    p.extraTime !== false,
    penalties:    p.penalties !== false,
    awayGoals:    !!p.awayGoals,
    note:         p.note || ''
  };
}
window._poV = _poV;

// هل يُعرض التبويب أصلاً؟
function _poVisible() {
  const p = _poV();
  return p.enabled && p.published;
}
window._poVisible = _poVisible;

const _PO_FMT_V = {
  single:  'مباراة واحدة',
  double:  'ذهاب وإياب',
  mini:    'دوري مصغّر',
  groups:  'مجموعات',
  bracket: 'شجرة إقصاء'
};

function renderPlayoff() {
  const el = document.getElementById('playoffContent');
  if (!el) return;
  const p = _poV();

  const tEl = document.getElementById('poTitle');
  if (tEl) tEl.textContent = p.name;

  if (!_poVisible()) { el.innerHTML = ''; return; }

  const ms = (matches || []).filter(m => m.isPlayoff === true)
    .sort((a, b) => (a.playoffOrder ?? 0) - (b.playoffOrder ?? 0));
  const done = ms.filter(m => m.status === 'finished').length;

  // ── شريط المعلومات: الصيغة · المقاعد · قواعد الحسم ──
  const rules = [];
  if (p.extraTime) rules.push('وقت إضافي');
  if (p.penalties) rules.push('ركلات ترجيح');
  if (p.type === 'double' && p.awayGoals) rules.push('أهداف الخارج');

  const info = `
    <div class="po-info">
      <div class="po-chip"><span class="po-chip-v">${_PO_FMT_V[p.type] || ''}</span><span class="po-chip-l">الصيغة</span></div>
      <div class="po-chip"><span class="po-chip-v">${p.slots}</span><span class="po-chip-l">مقعد متاح</span></div>
      <div class="po-chip"><span class="po-chip-v">${done}/${ms.length}</span><span class="po-chip-l">لُعبت</span></div>
    </div>
    ${rules.length ? `<div class="po-rules">${rules.map(r => `<span>${r}</span>`).join('')}</div>` : ''}
    ${p.venue ? `<div class="po-venue">${window.Icon ? window.Icon('stadium', 12) : ''} ${p.venue}</div>` : ''}`;

  // ── المتأهلون عبر الملحق ──
  const qHtml = p.qualifiedIds.length ? `
    <div class="po-block">
      <div class="po-block-t">${window.Icon ? window.Icon('check', 13, 'var(--green)') : ''} المتأهلون عبر ${p.name}</div>
      <div class="po-qual">
        ${p.qualifiedIds.map(id => {
          const t = (teams || []).find(x => x.id === id) || { name: '؟', logo: '' };
          return `<div class="po-qual-item">${logoHtml(t.logo, 26, 7)}<span>${t.name}</span></div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── المباريات: نستعمل بطاقة المباريات نفسها فترث كل مميزاتها ──
  const mHtml = ms.length ? `
    <div class="po-block">
      <div class="po-block-t">${window.Icon ? window.Icon('ball', 13, 'var(--gold)') : ''} مباريات ${p.name}</div>
      ${ms.map(m => (typeof _matchCard === 'function') ? _matchCard(m) : '').join('')}
    </div>` : `
    <div class="po-empty">
      ${window.Icon ? window.Icon('clock', 26, 'var(--t3)') : ''}
      <div>لم تُحدَّد مباريات الملحق بعد</div>
    </div>`;

  // ── الفرق المشاركة (حين لا مباريات بعد) ──
  const teamsHtml = (!ms.length && p.teamIds.length) ? `
    <div class="po-block">
      <div class="po-block-t">${window.Icon ? window.Icon('users', 13, 'var(--t2)') : ''} الفرق المشاركة</div>
      <div class="po-qual">
        ${p.teamIds.map(id => {
          const t = (teams || []).find(x => x.id === id) || { name: '؟', logo: '' };
          return `<div class="po-qual-item">${logoHtml(t.logo, 26, 7)}<span>${t.name}</span></div>`;
        }).join('')}
      </div>
    </div>` : '';

  el.innerHTML = info + qHtml + mHtml + teamsHtml +
    (p.note ? `<div class="po-note">${p.note}</div>` : '');
}
window.renderPlayoff = renderPlayoff;

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
function _buildUnifiedStatsHtml(d, ht, at, shareBtnHtml) {
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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
      <div class="md-section-title" style="margin:0">📊 الإحصائيات</div>
      ${shareBtnHtml || ''}
    </div>
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

// _computeInsights أُزيلت بالكامل بطلب المستخدم (لم تعد مستخدمة في أي مكان)




// ══════════════════════════════════════════════════════════════
//  شارات اللاعب على التشكيلة (هدف/بطاقة) — مثل التطبيقات الكبيرة
//  تحسب من أحداث المباراة عدد الأهداف ونوع البطاقات لكل لاعب،
//  وترجع HTML صغيراً يُركَّب فوق دائرة اللاعب في الملعب.
// ══════════════════════════════════════════════════════════════
function _playerMatchBadges(events, side, playerName, number, playerId) {
  if (!Array.isArray(events)) return '';
  if (!playerName && !playerId) return '';
  const nm = String(playerName || '').trim();
  const nmNorm = (typeof _normName === 'function') ? _normName(nm) : nm.toLowerCase();
  const sideOf = e => e.side || e.team;
  const nameOf = e => String(e.player || '').trim();
  const pid = (playerId != null && playerId !== '') ? String(playerId) : '';
  const normEq = (a) => {
    if (!nmNorm) return false;
    const an = (typeof _normName === 'function') ? _normName(a) : String(a||'').toLowerCase();
    return an === nmNorm || (an.length>=3 && nmNorm.length>=3 && (an.indexOf(nmNorm)===0 || nmNorm.indexOf(an)===0));
  };

  let goals = 0, yellow = 0, red = false, subOut = null, subIn = null, assists = 0;
  const hasNum = number != null && number !== '';
  // مطابقة اللاعب — الأولوية القصوى للهوية (playerId):
  //   ① لو الحدث يحمل هوية ولدينا هوية اللاعب → المطابقة بالهوية وحدها (أدقّ ما يكون،
  //      فينعكس نقل/تعديل الهدف فوراً على اللاعب الصحيح دون تعلّق بالاسم القديم).
  //   ② الحدث بلا هوية (بيانات قديمة) → رجوع آمن للرقم إن توفّر، وإلا الاسم المُطبّع.
  const matchesPlayer = (e, nameField, numField, idField) => {
    const eid = (e[idField] != null && e[idField] !== '') ? String(e[idField]) : '';
    if (pid && eid) return eid === pid;          // كلاهما له هوية → الهوية تحسم
    if (eid && !pid) return false;               // الحدث لهوية محدّدة ولاعبنا بلا هوية → ليس هو
    if (hasNum && e[numField] != null && e[numField] !== '') {
      return String(e[numField]) === String(number);
    }
    return normEq(e[nameField]);
  };
  events.forEach(e => {
    if (sideOf(e) !== side) return;
    if (e.type === 'sub') {
      const mn = e.extraMinute > 0 ? (e.minute + '+' + e.extraMinute) : e.minute;
      if (matchesPlayer(e, 'playerOut', 'playerOutNumber', 'playerOutId')) subOut = mn;
      if (matchesPlayer(e, 'playerIn', 'playerInNumber', 'playerInId')) subIn = mn;
      return;
    }
    /* ✅︎ الصناعة تُفحص قبل مطابقة صاحب الحدث: صانع الهدف ليس مسجّله،
       فلو تركناها بعد الـ return لما ظهرت شارة صناعة أبداً. */
    if (e.type === 'goal' && e.assist &&
        matchesPlayer(e, 'assist', 'assistNumber', 'assistPlayerId')) assists++;
    if (!matchesPlayer(e, 'player', 'playerNumber', 'playerId')) return;
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
  /* ✅︎ شارة صناعة الأهداف (حذاء أخضر) — تظهر على اللاعب في الملعب وفي الدكة،
     وتحترم إعدادات البطولة تماماً كسطر الصناعة في الخط الزمني. */
  if (assists > 0 && (typeof _assistsPublic !== 'function' || _assistsPublic())) {
    const acnt = assists > 1 ? `<span class="pl-badge-goalcount pl-badge-acount">${assists}</span>` : '';
    const boot = (window.Icon ? window.Icon('boots', 11) : '👟');
    badges.push('<span class="pl-badge pl-badge-assist" title="صناعة هدف">' + boot + acnt + '</span>');
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

  /* شارة الدور (ذهاب/إياب) بجانب شارة الجولة — بلونين مختلفين ليُفرَّق
     بينهما بلمحة. لا تظهر إطلاقاً في بطولات الذهاب فقط. */
  const _lg = _legOf(m);
  const legBadge = _lg
    ? `<span class="mc-leg${_lg === 2 ? ' mc-leg-2' : ''}">${_legLabel(_lg)}</span>`
    : '';
  const roundBadge = m.isKnockout && m.knockoutRoundName
    ? `<div class="mc2-round"><span class="mc2-rb mc2-rb-ko">${m.knockoutRoundName}</span>${legBadge}</div>`
    : (m.round ? `<div class="mc2-round"><span class="mc2-rb">الجولة ${m.round}</span>${legBadge}</div>`
               : (legBadge ? `<div class="mc2-round">${legBadge}</div>` : ''));

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

  // 🧠 أبرز الأرقام — أُزيلت بطلب المستخدم (كانت تقطع تسلسل قائمة المباريات)

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
    // بثّ احترافي HLS (m3u8) → مشغّل hls.js (يتحمّل آلاف، يعمل على كل المتصفحات)
    if (/\.m3u8(\?|$)/i.test(url)) return { type:'hls', src:url };
    // رابط فيديو مباشر (mp4/webm)
    if (/\.(mp4|webm)(\?|$)/i.test(url)) return { type:'video', src:url };
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
// ════════════════════════════════════════════════════════════
//  بثّ المنصة (WebRTC P2P) — يستقبل البث من تطبيق المذيع مباشرة
//  دون أي خادم فيديو (تكلفة توزيع = صفر). الإشارة عبر Firestore.
// ════════════════════════════════════════════════════════════
// خوادم ICE للمشاهد — STUN متعددة + TURN اختياري (window._psTurn)
const _PS_RTC = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...(Array.isArray(window._psTurn) ? window._psTurn : [])
  ],
  iceCandidatePoolSize: 8,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};
let _psPeer = null, _psViewerId = null, _psStreamId = null, _psUnsubs = [];
let _psRetry = 0, _psRetryTimer = null;
let _psVideoEl = null;

function _psCleanup() {
  try { _psPeer && _psPeer.close(); } catch(e){}
  _psUnsubs.forEach(u => { try{ u(); }catch(e){} });
  _psUnsubs = []; _psPeer = null;
  // أوقف صوت/مصدر عنصر الفيديو السابق (منع تكرار الصوت عند إعادة الاتصال)
  if (_psVideoEl) {
    try{ _psVideoEl.pause(); _psVideoEl.srcObject = null; }catch(e){}
    _psVideoEl = null;
  }
  // احذف مستند المشاهد ليُحرّر مقعده
  if (_psStreamId && _psViewerId && window._fsDb) {
    import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js").then(fs=>{
      fs.deleteDoc(fs.doc(window._fsDb,'liveStreams',_psStreamId,'viewers',_psViewerId)).catch(()=>{});
    });
  }
  _psStreamId = null; _psViewerId = null;
}
// إغلاق كامل ونهائي (عند مغادرة التفاصيل) — يوقف إعادة المحاولة أيضاً
function _psFullStop() {
  clearTimeout(_psRetryTimer); _psRetryTimer = null; _psRetry = 0;
  _psLastReplayAt = {}; _psLastScore = {};   // صفّر تتبّع الإعادة والأهداف
  _psCleanup();
}

// إعادة اتصال ذكية: تباعد متزايد (1s,2s,4s… بحدّ أقصى 8s) لا تستسلم أبداً
// طالما البث مباشر. تُنظّف الاتصال القديم أولاً لتفادي التسريب.
function _psReconnectViewer(oldPc, videoEl, statusEl){
  if (!_psStreamId) return;
  _psRetry = (_psRetry||0) + 1;
  const delay = Math.min(1000 * Math.pow(2, Math.min(_psRetry-1, 3)), 8000); // 1,2,4,8,8…
  clearTimeout(_psRetryTimer);
  _psRetryTimer = setTimeout(() => {
    if (!_psStreamId) return;
    // لو تعافى الاتصال وحده، لا تُعد
    if (oldPc && oldPc.connectionState === 'connected'){ _psRetry = 0; if(statusEl) statusEl.style.display='none'; return; }
    _psConnectViewer(_psStreamId, videoEl, statusEl);
  }, delay);
}

// يُستدعى عند فتح تفاصيل مباراة فيها بث منصة نشط
async function _psConnectViewer(streamId, videoEl, statusEl) {
  _psCleanup();
  _psStreamId = streamId;
  const fs = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
  const db = window._fsDb;
  if (!db) { if(statusEl) statusEl.textContent='تعذّر الاتصال'; return; }

  _psViewerId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const pc = new RTCPeerConnection(_PS_RTC);
  _psPeer = pc;

  // نستقبل مسار الفيديو من المذيع
  _psVideoEl = videoEl;
  pc.ontrack = e => {
    // buffer صغير يمتصّ تذبذب الشبكة الضعيفة (يقلّل التقطيع مقابل تأخير بسيط ~نصف ثانية)
    try{
      pc.getReceivers().forEach(r=>{
        if(r.track && 'playoutDelayHint' in r) r.playoutDelayHint = 0.5;
        if(r.track && 'jitterBufferTarget' in r) r.jitterBufferTarget = 500;
      });
    }catch(_){}
    if (videoEl.srcObject !== e.streams[0]) {
      videoEl.srcObject = e.streams[0];
      // نحاول التشغيل بالصوت مباشرة؛ لو منع المتصفح autoplay، نشغّل مكتوماً
      // ثم نفعّل الصوت تلقائياً عند أول تفاعل للمستخدم (نقرة/لمسة في أي مكان).
      videoEl.muted = false;
      videoEl.play().then(()=>{
        _psSyncMuteBtn(_psMatchIdOf(videoEl), false);
      }).catch(()=>{
        videoEl.muted = true;
        videoEl.play().catch(()=>{});
        _psArmAutoUnmute(videoEl);
      });
      if (statusEl) statusEl.style.display = 'none';
    }
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (statusEl) {
      if (st === 'connecting') { statusEl.style.display='flex'; statusEl.textContent = 'جارِ الاتصال بالبث…'; }
      if (st === 'connected') { statusEl.style.display='none'; _psRetry = 0; }
    }
    // 'disconnected' غالباً مؤقّت (تذبذب شبكة) — ننتظر قليلاً قبل التدخّل،
    // فقد يتعافى وحده. 'failed' انقطاع فعلي → نعيد الاتصال فوراً.
    if (st === 'disconnected') {
      if (statusEl) { statusEl.style.display='flex'; statusEl.textContent = 'الشبكة متذبذبة…'; }
      clearTimeout(_psRetryTimer);
      _psRetryTimer = setTimeout(() => {
        if (_psStreamId && ['disconnected','failed'].includes(pc.connectionState)) {
          _psReconnectViewer(pc, videoEl, statusEl);
        }
      }, 2500);
    } else if (st === 'failed') {
      if (statusEl) { statusEl.style.display='flex'; statusEl.textContent = 'إعادة الاتصال…'; }
      _psReconnectViewer(pc, videoEl, statusEl);
    }
  };

  // نحن الطرف الطالب: نُنشئ Offer (نستقبل فيديو+صوت فقط)
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const viewerRef = fs.doc(db,'liveStreams',streamId,'viewers',_psViewerId);
  // ICE من المشاهد → للمذيع
  const vcandCol = fs.collection(db,'liveStreams',streamId,'viewers',_psViewerId,'vcandidates');
  pc.onicecandidate = ev => { if(ev.candidate) fs.addDoc(vcandCol, ev.candidate.toJSON()).catch(()=>{}); };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await fs.setDoc(viewerRef, { offer:{ type:offer.type, sdp:offer.sdp }, at: Date.now() });

  // انتظر Answer من المذيع
  const un1 = fs.onSnapshot(viewerRef, snap => {
    const d = snap.data();
    if (d && d.answer && pc.signalingState !== 'stable') {
      pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(()=>{});
    }
  });
  // استقبل ICE من المذيع
  const bcandCol = fs.collection(db,'liveStreams',streamId,'viewers',_psViewerId,'bcandidates');
  const un2 = fs.onSnapshot(bcandCol, s => {
    s.docChanges().forEach(c => {
      if (c.type==='added') pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(()=>{});
    });
  });
  _psUnsubs.push(un1, un2);
}

// مشغّل بث المنصة — يشترك في مستند البث ويحدّث الفيديو + التعليق لحظياً
let _psDetailUnsub = null;
let _psScoreTick = null;
function _psWatchStream(streamId, matchId) {
  if (_psDetailUnsub) { try{_psDetailUnsub();}catch(e){} _psDetailUnsub=null; }
  const db = window._fsDb; if (!db) return;
  import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js").then(fs=>{
    _psDetailUnsub = fs.onSnapshot(fs.doc(db,'liveStreams',streamId), snap=>{
      const box = document.getElementById('ps-box-'+matchId);
      if (!box) return;
      const d = snap.exists() ? snap.data() : null;
      const active = d && d.status === 'live';
      // كشف إعادة جديدة (P2P عبر data أو Storage عبر url) → اعرضها بأنيميشن احترافي
      if (d && d.replay && (d.replay.data || d.replay.url) && d.replay.at && d.replay.at !== _psLastReplayAt[matchId]) {
        _psLastReplayAt[matchId] = d.replay.at;
        _psShowReplay(matchId, d.replay);
      }
      // الفيديو
      if (active) {
        let v = document.getElementById('ps-'+matchId);
        if (!v) {
          box.innerHTML = _psVideoShell(matchId, d.broadcaster||'');
          v = document.getElementById('ps-'+matchId);
        }
        if (v && !v._connected) {
          v._connected = true;
          // بث احترافي عبر خادم (HLS، يتحمّل آلاف) لو متاح، وإلا P2P المباشر.
          if (d.hlsUrl && d.streamMode === 'hls') {
            v._mode = 'hls';
            _initHlsPlayer('ps-'+matchId, d.hlsUrl);
            const st = document.getElementById('ps-'+matchId+'-status');
            if (st) st.style.display = 'none';
          } else {
            v._mode = 'p2p';
            _psConnectViewer(streamId, v, document.getElementById('ps-'+matchId+'-status'));
          }
        }
        // حدّث شريط النتيجة/الوقت من liveData، وشغّل مؤقّت ثانية إن لزم
        const _m = (window.matches||[]).find(x=>x.id===matchId);
        if (_m && typeof _psUpdateScorebar==='function') _psUpdateScorebar(_m);
        if (!_psScoreTick) {
          _psScoreTick = setInterval(()=>{
            // يستمر ما دامت حاوية البث موجودة (لا يتوقف لو تأخّرت قائمة المباريات لحظة)
            if (!document.getElementById('ps-scorebar-'+matchId)) { clearInterval(_psScoreTick); _psScoreTick=null; return; }
            const mm = (window.matches||[]).find(x=>x.id===matchId);
            if (mm) _psUpdateScorebar(mm);
          }, 1000);
        }
      } else {
        box.innerHTML = '';
        if (_psScoreTick){ clearInterval(_psScoreTick); _psScoreTick=null; }
        _psFullStop();
      }
    });
  });
}
function _psVideoShell(matchId, broadcaster){
  return `
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:900;color:var(--t2);display:inline-flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z"/></svg>بثّ المنصة المباشر</span>
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:900;color:#fff;background:#ff2d55;border-radius:999px;padding:3px 10px">
          <span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block;animation:_psPulse 1.4s infinite"></span>مباشر
        </span>
      </div>
      <div id="ps-wrap-${matchId}" style="position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden">
        <video id="ps-${matchId}" autoplay playsinline muted style="width:100%;height:100%;object-fit:contain;background:#000" onclick="_psToggleFsControls('${matchId}')"></video>
        <!-- شريط النتيجة والوقت الحيّ فوق الفيديو (يتحكم فيه المنظّم من الإدارة) -->
        <div id="ps-scorebar-${matchId}" class="ps-scorebar"></div>
        <button class="ps-fs-exit" onclick="_psExitPseudoFs(document.getElementById('ps-wrap-${matchId}'))" title="خروج">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <!-- شعار المنصة (علامة مائية احترافية أعلى يمين) -->
        <div class="ps-watermark"><img src="icon-512.png" onerror="this.parentElement.style.display='none'"></div>
        <!-- أزرار التحكم (كتم + ملء الشاشة) — تبقى مع الشريط في ملء الشاشة -->
        <button onclick="_psToggleMute('${matchId}')" id="ps-mute-${matchId}" title="الصوت" style="position:absolute;bottom:10px;left:52px;z-index:7;width:36px;height:36px;border:none;border-radius:9px;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM4.5 4.5l15 15M15.54 8.46a5 5 0 011.4 2.54" style="opacity:.9"/></svg>
        </button>
        <div id="ps-soundhint-${matchId}" onclick="_psToggleMute('${matchId}')" style="position:absolute;bottom:52px;left:10px;z-index:8;background:var(--gold);color:#1a1200;font-size:11px;font-weight:900;padding:5px 10px;border-radius:8px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.4);display:flex;align-items:center;gap:5px;animation:_psSoundPulse 1.6s infinite">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14"/></svg>اضغط للصوت
        </div>
        <button onclick="_psFullscreen('${matchId}')" title="ملء الشاشة" style="position:absolute;bottom:10px;left:10px;z-index:7;width:36px;height:36px;border:none;border-radius:9px;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
        </button>
        <div id="ps-${matchId}-status" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#9aa;background:#0a0e17;font-size:13px">
          <div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.15);border-top-color:#ff2d55;border-radius:50%;animation:_psSpin 1s linear infinite"></div>
          جارِ الاتصال بالبث…
        </div>
      </div>
      ${broadcaster ? `<div style="font-size:11.5px;color:var(--t3);margin-top:6px;text-align:center;display:flex;align-items:center;justify-content:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>${broadcaster}</div>` : ''}
    </div>
    <style>
      @keyframes _psSpin{to{transform:rotate(360deg)}}@keyframes _psPulse{0%,100%{opacity:1}50%{opacity:.3}}
      @keyframes _psSoundPulse{0%,100%{transform:scale(1);box-shadow:0 3px 12px rgba(0,0,0,.4)}50%{transform:scale(1.06);box-shadow:0 4px 18px rgba(201,160,43,.6)}}
      /* ملء الشاشة: الحاوية تتمدّد كاملة، والشريط يبقى ظاهراً ويكبر قليلاً */
      [id^="ps-wrap-"]:fullscreen{width:100vw;height:100vh;border-radius:0;background:#000;
        display:flex;align-items:center;justify-content:center;overflow:visible}
      [id^="ps-wrap-"]:-webkit-full-screen{width:100vw;height:100vh;border-radius:0;background:#000;overflow:visible}
      [id^="ps-wrap-"]:fullscreen video{width:100%;height:100%}
      [id^="ps-wrap-"]:-webkit-full-screen video{width:100%;height:100%}
      /* ملء الشاشة: الشريط يبقى على الجانب (يسار) بحجم مكبّر متناسق — لا يقفز ولا يختفي عند الهدف */
      [id^="ps-wrap-"]:fullscreen .ps-scorebar,
      [id^="ps-wrap-"]:-webkit-full-screen .ps-scorebar{
        top:22px;left:22px;height:44px;
        transform:scale(1.12);transform-origin:top left;z-index:2147483647}
      [id^="ps-wrap-"]:fullscreen .ps-scorebar .ps-tm,
      [id^="ps-wrap-"]:-webkit-full-screen .ps-scorebar .ps-tm{display:inline!important;max-width:200px;font-size:14px}
      [id^="ps-wrap-"]:fullscreen .ps-scorebar .ps-tm-sh,
      [id^="ps-wrap-"]:-webkit-full-screen .ps-scorebar .ps-tm-sh{display:none!important}
      [id^="ps-wrap-"]:fullscreen .ps-watermark,
      [id^="ps-wrap-"]:-webkit-full-screen .ps-watermark{top:22px;right:22px;width:44px;height:44px}
      /* ملء شاشة زائف (iOS/سفاري): الحاوية تملأ النافذة والشريط يبقى ظاهراً على الجانب */
      .ps-pseudo-fs{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;
        max-width:none!important;aspect-ratio:auto!important;border-radius:0!important;z-index:99999!important;
        background:#000!important;margin:0!important;overflow:visible!important}
      /* أثناء ملء الشاشة الزائف: أخفِ شريط التنقّل وأي عناصر صفحة */
      body:has(.ps-pseudo-fs) .bottom-nav,
      body:has(.ps-pseudo-fs) #bottomNav{display:none!important}
      .ps-pseudo-fs video{width:100%!important;height:100%!important;object-fit:contain!important}
      .ps-pseudo-fs .ps-scorebar{top:22px;left:22px;height:44px;transform:scale(1.12);
        transform-origin:top left;z-index:100001}
      .ps-pseudo-fs .ps-scorebar .ps-tm{display:inline!important;max-width:200px;font-size:14px}
      .ps-pseudo-fs .ps-scorebar .ps-tm-sh{display:none!important}
      .ps-pseudo-fs .ps-watermark{top:22px;right:22px;width:44px;height:44px}
      .ps-pseudo-fs .ps-fs-exit{display:flex!important}
      /* زر الخروج يمين-أسفل حتى لا يتعارض مع الشريط والشعار أعلى */
      .ps-fs-exit{display:none;position:absolute;bottom:18px;right:18px;z-index:100002;width:40px;height:40px;
        border:none;border-radius:10px;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);color:#fff;
        align-items:center;justify-content:center;cursor:pointer}
      .ps-scorebar{position:absolute;top:10px;left:10px;z-index:6;
        display:flex;align-items:stretch;height:27px;border-radius:7px;overflow:hidden;
        box-shadow:0 3px 12px rgba(0,0,0,.45);font-family:Tajawal,sans-serif;
        border:1px solid rgba(201,160,43,.28);backdrop-filter:blur(4px)}
      .ps-scorebar .ps-side{display:flex;align-items:center;gap:5px;padding:0 7px;
        background:linear-gradient(180deg,rgba(26,31,46,.95),rgba(18,21,31,.95))}
      .ps-scorebar .ps-side.home{border-bottom:2px solid var(--gold)}
      .ps-scorebar .ps-side.away{border-bottom:2px solid #3B7DBF}
      .ps-scorebar .ps-tm{display:none}
      .ps-scorebar .ps-tm-sh{display:inline;font-size:11.5px;font-weight:900;color:#fff;letter-spacing:.2px;
        white-space:nowrap;max-width:58px;overflow:hidden;text-overflow:ellipsis}
      .ps-scorebar .ps-lg{width:16px;height:16px;border-radius:3px;object-fit:cover;flex-shrink:0;
        display:inline-flex;align-items:center;justify-content:center;font-size:10px}
      .ps-scorebar .ps-sc{display:flex;align-items:center;gap:5px;padding:0 9px;
        background:linear-gradient(180deg,#0b0e16,#060810);font-size:14px;font-weight:900;color:#fff;
        font-variant-numeric:tabular-nums}
      .ps-scorebar .ps-sc .ps-dot{width:2px;height:2px;border-radius:50%;background:rgba(201,160,43,.55)}
      .ps-scorebar .ps-sc span.ps-goal-flash{animation:psGoalFlash 1s ease-out;
        display:inline-block;border-radius:3px}
      @keyframes psGoalFlash{0%{color:#fff;text-shadow:none}
        20%{color:#1a1200;background:var(--gold);text-shadow:0 0 8px var(--gold);padding:0 3px}
        100%{color:#fff;text-shadow:none;background:transparent}}
      .ps-scorebar .ps-ck{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 8px;
        background:linear-gradient(180deg,#e6c157,#c9a02b);color:#1a1200;min-width:36px;gap:0;line-height:1.05}
      .ps-scorebar .ps-ck .ps-tk{font-size:10.5px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:.2px}
      .ps-scorebar .ps-ck .ps-ph{font-size:7px;font-weight:800;opacity:.82;letter-spacing:.1px}
      /* على الشاشات الأوسع (تابلت/كمبيوتر) نُظهر الاسم الكامل بحجم مناسب */
      @media(min-width:560px){
        .ps-scorebar{height:30px;top:12px;left:12px}
        .ps-scorebar .ps-tm{display:inline;font-size:12px;font-weight:800;color:#fff;white-space:nowrap;
          max-width:120px;overflow:hidden;text-overflow:ellipsis}
        .ps-scorebar .ps-tm-sh{display:none}
        .ps-scorebar .ps-sc{font-size:15px}
      }
      /* شعار المنصة — علامة مائية مصغّرة متناسقة مع الشريط */
      .ps-watermark{position:absolute;top:10px;right:10px;z-index:5;opacity:.85;
        width:27px;height:27px;border-radius:7px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.4);
        border:1px solid rgba(201,160,43,.28);background:rgba(10,14,22,.55);backdrop-filter:blur(4px)}
      .ps-watermark img{width:100%;height:100%;object-fit:cover;display:block}
      /* نافذة الإعادة الاحترافية */
      .ps-replay{position:absolute;inset:0;z-index:9;background:#000;display:flex;align-items:center;justify-content:center;
        opacity:0;transition:opacity .3s}
      .ps-replay.show{opacity:1}
      .ps-replay.out{opacity:0}
      .ps-replay-vid{width:100%;height:100%;object-fit:contain;background:#000}
      .ps-replay-tag{position:absolute;top:12px;left:12px;z-index:2;display:flex;align-items:center;gap:6px;
        background:var(--live);color:#fff;font-family:Tajawal,sans-serif;font-size:12px;font-weight:900;
        padding:5px 11px;border-radius:7px;letter-spacing:.5px;box-shadow:0 3px 12px rgba(214,69,65,.5);
        animation:psReplayTag .4s ease-out}
      @keyframes psReplayTag{from{transform:translateX(-16px);opacity:0}to{transform:translateX(0);opacity:1}}
      .ps-replay-close{position:absolute;top:10px;right:12px;z-index:2;width:34px;height:34px;border:none;
        border-radius:50%;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);color:#fff;font-size:22px;
        line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .ps-replay-bar{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.15);z-index:2}
      .ps-replay-fill{height:100%;width:0;background:var(--gold);transition:width .2s linear}
      .ps-replay-ctrls{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:3;
        display:flex;gap:8px}
      .ps-rc-btn{min-width:40px;height:36px;padding:0 12px;border:1px solid rgba(201,160,43,.4);border-radius:9px;
        background:rgba(10,14,22,.7);backdrop-filter:blur(6px);color:#fff;font-family:Tajawal,sans-serif;
        font-size:13px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .ps-rc-btn:active{transform:scale(.94)}
    </style>`;
}
// ملء الشاشة مع قلب تلقائي للوضع الأفقي على الجوال (تجربة مشاهدة كاملة)
window._psFullscreen = function(matchId){
  const wrap = document.getElementById('ps-wrap-'+matchId);
  const video = document.getElementById('ps-'+matchId);
  const el = wrap || video;
  if (!el) return;

  // لو نحن أصلاً في «ملء شاشة زائف» → اخرج منه
  if (wrap && wrap.classList.contains('ps-pseudo-fs')) { _psExitPseudoFs(wrap); return; }

  // نفضّل ملء شاشة الحاوية (يُبقي شريط النتيجة ظاهراً فوق الفيديو).
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(el)).then(()=>{
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
    }).catch(()=>{
      // فشل ملء شاشة الحاوية → ملء شاشة زائف (الشريط يبقى ظاهراً)
      _psEnterPseudoFs(wrap || el);
    });
  } else if (wrap) {
    // iOS/سفاري لا يدعم requestFullscreen للحاوية:
    // نستخدم «ملء شاشة زائف» بدل ملء شاشة الفيديو الأصلي (الذي يُخفي الشريط).
    _psEnterPseudoFs(wrap);
  } else if (video && video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  }
};
// ملء شاشة زائف: تكبير الحاوية لملء نافذة المتصفح عبر CSS ثابت — الشريط يبقى فوق الفيديو.
function _psEnterPseudoFs(wrap){
  if (!wrap) return;
  wrap.classList.add('ps-pseudo-fs');
  document.documentElement.style.overflow = 'hidden';
  // أخفِ شريط التنقّل السفلي (إخفاء كامل لكل شيء عدا البث)
  const nav = document.getElementById('bottomNav') || document.querySelector('.bottom-nav');
  if (nav){ nav._psPrevDisplay = nav.style.display; nav.style.display = 'none'; }
  if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{});
  // زر خروج + مفتاح ESC
  wrap._psEscHandler = (e)=>{ if(e.key==='Escape') _psExitPseudoFs(wrap); };
  document.addEventListener('keydown', wrap._psEscHandler);
}
function _psExitPseudoFs(wrap){
  if (!wrap) return;
  wrap.classList.remove('ps-pseudo-fs');
  document.documentElement.style.overflow = '';
  const nav = document.getElementById('bottomNav') || document.querySelector('.bottom-nav');
  if (nav){ nav.style.display = nav._psPrevDisplay || ''; }
  if (screen.orientation && screen.orientation.unlock){ try{ screen.orientation.unlock(); }catch(e){} }
  if (wrap._psEscHandler){ document.removeEventListener('keydown', wrap._psEscHandler); wrap._psEscHandler=null; }
}
window._psExitPseudoFs = _psExitPseudoFs;
document.addEventListener('fullscreenchange', ()=>{
  if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
    try{ screen.orientation.unlock(); }catch(e){}
  }
});
// استخراج matchId من عنصر الفيديو (id = ps-<matchId>)
function _psMatchIdOf(v){ return v && v.id ? v.id.replace(/^ps-/,'') : ''; }
// مزامنة شكل زر الكتم مع الحالة الفعلية
function _psSyncMuteBtn(matchId, muted){
  const btn = document.getElementById('ps-mute-'+matchId);
  const hint = document.getElementById('ps-soundhint-'+matchId);
  if(btn){
    btn.style.background = muted ? 'rgba(0,0,0,.55)' : 'var(--live)';
    btn.innerHTML = muted
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM4.5 4.5l15 15M15.54 8.46a5 5 0 011.4 2.54" style="opacity:.9"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
  }
  if(hint && !muted) hint.style.display = 'none';
}
// تفعيل الصوت تلقائياً عند أول تفاعل للمستخدم (يلتفّ حول سياسة autoplay)
let _psAutoUnmuteArmed = false;
function _psArmAutoUnmute(videoEl){
  if(_psAutoUnmuteArmed) return;
  _psAutoUnmuteArmed = true;
  const unmute = ()=>{
    try{
      if(_psVideoEl){ _psVideoEl.muted = false; _psVideoEl.play().catch(()=>{});
        _psSyncMuteBtn(_psMatchIdOf(_psVideoEl), false); }
    }catch(e){}
    document.removeEventListener('pointerdown', unmute, true);
    document.removeEventListener('touchstart', unmute, true);
    document.removeEventListener('keydown', unmute, true);
    _psAutoUnmuteArmed = false;
  };
  document.addEventListener('pointerdown', unmute, true);
  document.addEventListener('touchstart', unmute, true);
  document.addEventListener('keydown', unmute, true);
}

// كتم/تشغيل صوت البث (يبدأ مكتوماً لأن autoplay يتطلب ذلك)
window._psToggleMute = function(matchId){
  const v = document.getElementById('ps-'+matchId);
  const btn = document.getElementById('ps-mute-'+matchId);
  const hint = document.getElementById('ps-soundhint-'+matchId);
  if (!v) return;
  v.muted = !v.muted;
  if (!v.muted) v.play().catch(()=>{});
  if (btn){
    btn.style.background = v.muted ? 'rgba(0,0,0,.55)' : 'var(--live)';
    btn.innerHTML = v.muted
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM4.5 4.5l15 15M15.54 8.46a5 5 0 011.4 2.54" style="opacity:.9"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>';
  }
  // أخفِ شارة «اضغط للصوت» بمجرد تفعيل الصوت
  if (hint && !v.muted) hint.style.display = 'none';
};
// نقرة على الفيديو تفعّل الصوت أول مرة (تجربة مثل التطبيقات)
window._psToggleFsControls = function(matchId){
  const v = document.getElementById('ps-'+matchId);
  if (v && v.muted) { window._psToggleMute(matchId); }
};
let _psLastScore = {};
let _psLastReplayAt = {};
// نافذة الإعادة الاحترافية (تظهر فوق البث عند إرسال المذيع لقطة إعادة)
function _psShowReplay(matchId, replay){
  const wrap = document.getElementById('ps-wrap-'+matchId);
  if (!wrap) return;
  const old = document.getElementById('ps-replay-'+matchId);
  if (old) old.remove();
  // المصدر: P2P (data base64) أو Storage (url)
  const src = replay.data || replay.url;
  if (!src) return;
  const ov = document.createElement('div');
  ov.id = 'ps-replay-'+matchId;
  ov.className = 'ps-replay';
  ov.innerHTML = `
    <div class="ps-replay-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>REPLAY · الإعادة${replay.slow?' · بطيئة':''}</div>
    <video class="ps-replay-vid" src="${src}" autoplay playsinline></video>
    <div class="ps-replay-ctrls">
      <button class="ps-rc-btn" data-act="speed" title="السرعة">${replay.slow?'0.5×':'1×'}</button>
      <button class="ps-rc-btn" data-act="again" title="إعادة التشغيل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/></svg></button>
    </div>
    <button class="ps-replay-close" aria-label="إغلاق">×</button>
    <div class="ps-replay-bar"><div class="ps-replay-fill"></div></div>`;
  wrap.appendChild(ov);
  const vid = ov.querySelector('.ps-replay-vid');
  const fill = ov.querySelector('.ps-replay-fill');
  // سرعة الإعادة البطيئة
  let slow = !!replay.slow;
  const applySpeed = ()=>{ vid.playbackRate = slow ? 0.5 : 1; };
  vid.onloadedmetadata = applySpeed;
  const close = ()=>{ try{vid.pause();}catch(e){} ov.classList.add('out'); setTimeout(()=>ov.remove(),300); };
  ov.querySelector('.ps-replay-close').onclick = close;
  // أزرار التحكم
  ov.querySelector('[data-act="again"]').onclick = ()=>{ try{ vid.currentTime=0; vid.play(); }catch(e){} };
  ov.querySelector('[data-act="speed"]').onclick = (e)=>{
    slow = !slow; applySpeed(); e.target.textContent = slow?'0.5×':'1×';
  };
  vid.onended = close;
  vid.ontimeupdate = ()=>{ if(vid.duration) fill.style.width = (vid.currentTime/vid.duration*100)+'%'; };
  // إغلاق تلقائي احتياطي (أطول للبطيئة)
  setTimeout(close, slow ? 45000 : 30000);
  requestAnimationFrame(()=>ov.classList.add('show'));
}
// يبني/يحدّث شريط النتيجة من liveData (يُستدعى لحظياً مع كل تحديث للمباراة)
// شعار الفريق (رابط/إيموجي/افتراضي) — يُبنى مرة واحدة
function _psLogo(t){
  return t.logo && String(t.logo).startsWith('http')
    ? `<img class="ps-lg" src="${t.logo}" loading="lazy">`
    : (t.logo ? `<span class="ps-lg">${t.logo}</span>`
              : `<span class="ps-lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="15" style="opacity:.7"><circle cx="12" cy="12" r="9"/><path d="M12 7l2.5 1.8-1 3h-3l-1-3z"/></svg></span>`);
}
// اسم مختصر بأسلوب القنوات: للأسماء اللاتينية 3 أحرف (RMA/BAR)،
// وللعربية نُبقي الكلمة الأولى كاملة (الاختصار بالأحرف يشوّه العربية).
function _psShort(name){
  const n = String(name||'').trim();
  if(!n) return '';
  const isArabic = /[\u0600-\u06FF]/.test(n);
  if(isArabic){
    const w = n.split(/\s+/);
    // كلمة واحدة → كاملة؛ أكثر → أول كلمة (أوضح من دمج أحرف)
    return w[0];
  }
  const w = n.split(/\s+/);
  if(w.length>=2) return (w[0][0]+w[1][0]+(w[1][1]||'')).toUpperCase();
  return n.slice(0,3).toUpperCase();
}
// ① البناء (مرة واحدة): الشعارات والأسماء الثابتة — لا تُلمس كل ثانية
function _psBuildScorebar(m){
  const bar = document.getElementById('ps-scorebar-'+m.id);
  if(!bar) return;
  const ht = (window.teams||[]).find(t=>t.id===m.homeId) || {name:m.homeName||'', logo:m.homeLogo||''};
  const at = (window.teams||[]).find(t=>t.id===m.awayId) || {name:m.awayName||'', logo:m.awayLogo||''};
  bar.innerHTML =
    `<div class="ps-side home">${_psLogo(ht)}<span class="ps-tm" title="${(ht.name||'').replace(/"/g,'')}">${ht.name||''}</span><span class="ps-tm-sh">${_psShort(ht.name)}</span></div>`+
    `<div class="ps-sc"><span id="ps-hs-${m.id}">0</span><span class="ps-dot"></span><span id="ps-as-${m.id}">0</span></div>`+
    `<div class="ps-side away"><span class="ps-tm" title="${(at.name||'').replace(/"/g,'')}">${at.name||''}</span><span class="ps-tm-sh">${_psShort(at.name)}</span>${_psLogo(at)}</div>`+
    `<div class="ps-ck" id="ps-ck-${m.id}" style="display:none"><span class="ps-ph" id="ps-ph-${m.id}"></span><span class="ps-tk" id="ps-tk-${m.id}"></span></div>`;
  bar._built = true;
}
// شارة الشوط بأسلوب القنوات
function _psPhaseLabel(d){
  const st = d && d.matchStatus;
  if(st==='halftime') return 'الاستراحة';
  if(st==='extratime1') return 'و.إ 1';
  if(st==='extratime2') return 'و.إ 2';
  if(st==='penalties') return 'ركلات';
  if(d && d.currentHalf===2) return 'ش2';
  if(d && (d.currentHalf===1 || st==='live')) return 'ش1';
  return '';
}
// وميض ذهبي قصير عند تغيّر النتيجة (مثل القنوات)
function _psFlash(el){
  if(!el) return;
  el.classList.remove('ps-goal-flash');
  void el.offsetWidth; // إعادة تشغيل الأنيميشن
  el.classList.add('ps-goal-flash');
}
// ② التحديث (كل ثانية): النتيجة والوقت فقط — بلا إعادة بناء ولا وميض شعارات
function _psUpdateScorebar(m){
  const bar = document.getElementById('ps-scorebar-'+m.id);
  if(!bar) return;
  if(!bar._built) _psBuildScorebar(m);
  const d = m.liveData || {};
  const hs = d.homeScore ?? m.homeScore ?? 0;
  const as = d.awayScore ?? m.awayScore ?? 0;
  const _ckRaw = (typeof _clock==='function') ? _clock(d) : '';
  const ck = (_ckRaw && _ckRaw !== '--') ? _ckRaw : '';
  const phase = _psPhaseLabel(d);
  const H = document.getElementById('ps-hs-'+m.id);
  const A = document.getElementById('ps-as-'+m.id);
  const C = document.getElementById('ps-ck-'+m.id);
  const PH = document.getElementById('ps-ph-'+m.id);
  const TK = document.getElementById('ps-tk-'+m.id);
  if(H && H.textContent !== String(hs)){ H.textContent = hs; _psFlash(H); }
  if(A && A.textContent !== String(as)){ A.textContent = as; _psFlash(A); }
  if(TK) TK.textContent = ck;
  if(PH) PH.textContent = phase;
  // نُظهر كبسولة الوقت فقط عند بدء المباراة (استوديو تحليلي قبلها)
  if(C) C.style.display = (ck || phase) ? '' : 'none';
}
// حاوية فارغة تُملأ لحظياً من مستمع البثّ. تظهر متى وُجد بثّ نشط —
// حتى قبل بدء المباراة (استوديو تحليلي). المستمع نفسه يقرّر الإظهار/الإخفاء.
function _buildPlatformStream(m) {
  if (!m) return '';
  // نراقب البثّ للمباريات غير المنتهية (قادمة أو مباشرة) — لدعم البثّ التحليلي المبكر
  if (m.status === 'finished') return '';
  const sid = `${window.LEAGUE_ID}__${m.id}`;
  setTimeout(()=>_psWatchStream(sid, m.id), 60);
  return `<div id="ps-box-${m.id}"></div>`;
}

// ════════════════════════════════════════════════════════════
//  مشغّل HLS احترافي (hls.js) — يشغّل بثّ .m3u8 على كل المتصفحات،
//  يتحمّل آلاف المشاهدين لأن التوزيع على مصدر البث (حساب صاحب البطولة).
//  التكلفة على صاحب البطولة، لا على المنصة.
// ════════════════════════════════════════════════════════════
let _hlsLibPromise = null;
let _hlsInstances = {};
function _loadHlsLib() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (_hlsLibPromise) return _hlsLibPromise;
  _hlsLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('hls load failed'));
    document.head.appendChild(s);
  });
  return _hlsLibPromise;
}
async function _initHlsPlayer(videoId, src) {
  const video = document.getElementById(videoId);
  if (!video || video._hlsReady) return;
  video._hlsReady = true;
  // Safari/iOS يشغّل HLS أصلاً بلا مكتبة
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.play().catch(()=>{});
    return;
  }
  try {
    const Hls = await _loadHlsLib();
    if (Hls && Hls.isSupported()) {
      // نظّف نسخة سابقة لنفس العنصر
      if (_hlsInstances[videoId]) { try{_hlsInstances[videoId].destroy();}catch(e){} }
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 3,   // قريب من الحيّ
        maxBufferLength: 20,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6
      });
      _hlsInstances[videoId] = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        }
      });
    } else {
      video.src = src; // محاولة أخيرة
    }
  } catch(e) {
    video.src = src;
  }
}
function _destroyHlsPlayers() {
  Object.keys(_hlsInstances).forEach(k => { try{_hlsInstances[k].destroy();}catch(e){} });
  _hlsInstances = {};
}

function _buildVideoEmbed(m) {
  // بثّ المنصة يظهر عبر حاويته المستقلة (_buildPlatformStream)؛ هنا الروابط الخارجية فقط
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
    badge = '<span style="font-size:11px;font-weight:700;color:var(--t3);display:inline-flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>إعادة</span>';
  } else {
    badge = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:var(--gold);background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.3);border-radius:999px;padding:3px 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>ما قبل المباراة</span>';
  }
  const _vidIc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px"><path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z"/></svg> ';
  const title = _vidIc + (isLive ? 'البث المباشر' : (isFin ? 'إعادة المباراة' : 'تحليلات ما قبل المباراة'));

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

  let player;
  if (emb.type === 'hls') {
    const _hid = 'hls-' + m.id;
    setTimeout(() => _initHlsPlayer(_hid, emb.src), 40);
    player = `<video id="${_hid}" controls autoplay playsinline muted style="width:100%;height:100%;border:0;background:#000"></video>`;
  } else if (emb.type === 'video') {
    player = `<video src="${emb.src}" controls autoplay playsinline style="width:100%;height:100%;border:0;background:#000"></video>`;
  } else {
    player = `<iframe src="${emb.src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0" style="width:100%;height:100%;border:0"></iframe>`;
  }

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
    /* نظام التشكيلات قسم اختياري: لا يظهر تبويبه للجمهور إلا إذا فعّله
       المنظّم من «الأقسام المفعّلة» — كبقية الأقسام الاختيارية. */
    if (window.settings && window.settings.showLineups === true) tabs.push({id:'lineup', label:'التشكيلات'});
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
        // خزّن بيانات إحصائية المباراة لهذه المباراة (يقرأها زر المشاركة)
        window._shMatchStatsData = window._shMatchStatsData || {};
        window._shMatchStatsData[matchId] = { statsData, ht, at, m };
        const shareBtn  = _shButton(`_shShareMatchStats('${matchId}')`, 'مشاركة الإحصائيات');
        const statsHtml = _buildUnifiedStatsHtml(mergedD, ht, at, shareBtn);
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
            /* ✅︎ صانع الهدف — سطر ثانوي تحت اسم الهدّاف تماماً كالتطبيقات الرسمية */
            const _asNm = (!isOwn && _assistsPublic()) ? _liveAssistName(ev, _goalTeamId) : '';
            const _asHtml = _asNm
              ? `<span class="vt-goal-assist">${window.Icon ? window.Icon('boots', 10) : '👟'}<span>صناعة: ${_asNm}</span></span>`
              : '';
            const content = `<div class="vt-goalw">
              <div class="vt-goal">
                <span class="vt-goal-name"${isOwn?' style="color:var(--t3);font-style:italic"':''}>${goalName}</span>
                <span class="vt-goal-min">${minLabel(ev)}</span>
              </div>
              ${_asHtml}
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
          // حجم الأفاتار موحّد لكل اللاعبين (بلا تكبير للحارس ولا تصغير للهجوم) —
          // اعتُمد نفس حجم خط الهجوم السابق كمقاس ثابت للجميع بناءً على طلب المستخدم.
          const _avSize = n <= 6 ? 56 : n <= 8 ? 50 : n <= 9 ? 46 : 42;
          const _nameFS = n <= 6 ? 10.5 : n <= 9 ? 9.5 : 9;
          const _numFS  = n <= 6 ? 11 : 10;
          const _numSz  = n <= 6 ? 20 : n <= 9 ? 18 : 16;
          // منحنى ارتفاع بسيط فقط لتوزيع اللاعبين على الملعب (بلا أي تكبير/تصغير للحجم):
          //   الأعلى يقترب من 7%، الأسفل يمتد إلى 95%.
          const _persp = (y) => {
            const t = y / 100;                         // 0..1
            const yy = 7 + Math.pow(t, 0.94) * 88;
            return { yy };                              // كل اللاعبين بنفس الحجم مهما كان مركزهم
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
            const { yy } = _persp(y);
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
            const badges = window._playerMatchBadges ? window._playerMatchBadges(m.events, side, p.name, num, p.id) : '';
            const _photo = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, teamIdForPhoto) : '';
            const _silhouette = (window._playerSilhouetteSVG ? `<span style="display:block;width:66%;height:66%;color:${aTxt};opacity:.92">${window._playerSilhouetteSVG()}</span>` : num);
            // القرص الداخلي: صورة أو ظلّ اللاعب داخل خلفية داكنة نظيفة
            const inner = _photo
              ? `<img src="${_photo}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
              : `<div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 32%,#22304e,#0d1526);display:flex;align-items:center;justify-content:center">${_silhouette}</div>`;
            const _safeNm = (_liveNm||'').replace(/'/g,"\\'");
            return `<div onclick="window.openPlayerModal && openPlayerModal('${_safeNm}','${teamIdForPhoto||''}','${p.id||''}')"
                style="position:absolute;left:${x}%;top:${yy}%;cursor:pointer;
                transform:translate(-50%,-50%);
                display:flex;flex-direction:column;
                align-items:center;gap:4px;z-index:${Math.round(y)+5}">
              <div style="position:relative;width:${_avSize}px;height:${_avSize}px;border-radius:50%;overflow:hidden;
                background:#0d1526;
                box-shadow:${isMOTM
                  ? '0 0 0 2px #e6c157, 0 0 10px rgba(230,193,87,.75), 0 4px 12px rgba(0,0,0,.5)'
                  : `0 0 0 1.5px rgba(230,205,140,.42)${isGK ? ', 0 0 0 3px rgba(168,107,214,.34)' : ''}, 0 4px 11px rgba(0,0,0,.5)`};">
                ${inner}
              </div>
              <div style="position:absolute;width:${_avSize}px;height:${_avSize}px;top:0;pointer-events:none">
                <span style="position:absolute;bottom:-3px;right:-3px;background:#fff;color:#111;
                  font-size:${_numFS}px;font-weight:900;border-radius:999px;min-width:${_numSz}px;height:${_numSz}px;
                  display:flex;align-items:center;justify-content:center;padding:0 3px;
                  border:2px solid #1f7231;box-shadow:0 2px 4px rgba(0,0,0,.5)">${num}</span>
                ${cap ? `<span title="الكابتن" style="position:absolute;bottom:-3px;left:-3px;background:#111;color:#e6c157;font-size:9px;font-weight:900;border-radius:999px;width:17px;height:17px;display:flex;align-items:center;justify-content:center;border:2px solid #e6c157">C</span>` : ''}
                ${isMOTM ? `<span title="نجم المباراة" style="position:absolute;top:-6px;right:-6px;background:linear-gradient(145deg,#e6c157,#b8860b);border-radius:999px;width:19px;height:19px;display:flex;align-items:center;justify-content:center;border:2px solid #1f7231;box-shadow:0 2px 5px rgba(0,0,0,.5);font-size:10px;line-height:1">★</span>` : ''}
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
                const _sBadges = window._playerMatchBadges ? window._playerMatchBadges(m.events, isAway?'away':'home', p.name, p.number, p.id) : '';
                const _bPhoto = (typeof _lineupPhoto === 'function') ? _lineupPhoto(p, _benchTeamId) : '';
                const _safeBNm = (_bLiveNm||'').replace(/'/g,"\\'");
                const _bAvatar = _bPhoto
                  ? `<img src="${_bPhoto}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
                  : `<div style="width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#1c2740,#0d1526);display:flex;align-items:center;justify-content:center;color:var(--t3)">${window._playerSilhouetteSVG ? `<span style="display:block;width:60%;height:60%">${window._playerSilhouetteSVG()}</span>` : (p.number||'—')}</div>`;
                return `
                <div onclick="window.openPlayerModal && openPlayerModal('${_safeBNm}','${_benchTeamId||''}','${p.id||''}')"
                  style="display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;
                  background:var(--s2);border:1px solid var(--b1);border-radius:12px;padding:10px 4px;text-align:center;transition:.15s">
                  <div style="position:relative;width:44px;height:44px;border-radius:50%;overflow:hidden;background:#0d1526;box-shadow:0 0 0 1.5px rgba(230,205,140,.4),0 2px 6px rgba(0,0,0,.4)">${_bAvatar}</div>
                  <div style="position:relative;width:44px;height:44px;margin-top:-44px;pointer-events:none">
                    <span style="position:absolute;bottom:-2px;right:-2px;background:#fff;color:#111;font-size:8.5px;font-weight:900;border-radius:999px;min-width:15px;height:15px;display:flex;align-items:center;justify-content:center;padding:0 2px;border:1.5px solid var(--s2)">${p.number||'—'}</span>
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

        // خزّن بيانات المشاركة لهذه التشكيلة (يقرأها زر المشاركة لمعرفة الفريق المعروض حالياً)
        window._shLineupData = window._shLineupData || {};
        window._shLineupData[_uid] = { hl, al, ht, at, matchId, homeId: m.homeId, awayId: m.awayId, m };

        if (!hasHL && !hasAL) {
          return `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
            <div style="font-size:40px;margin-bottom:10px;opacity:.3">👥</div>
            <div style="font-size:13px">لم يتم إدخال أي تشكيلة بعد</div>
            <div style="font-size:11px;margin-top:6px;color:var(--t3)">ينتظر إدخال التشكيلتين من لوحة التحكم</div>
          </div>`;
        }

        return `
          <div style="display:flex;gap:6px;margin-bottom:12px;align-items:center">
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
            ${_shButton(`_shShareLineup('${_uid}')`, 'مشاركة التشكيلة')}
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
    const _lgD = _legOf(m);
    const _lgBadgeD = _lgD
      ? `<span class="mc-leg${_lgD === 2 ? ' mc-leg-2' : ''}" style="margin-inline-start:6px">${_legLabel(_lgD)}</span>`
      : '';
    const knockoutBadgeHtml = (m.isKnockout && m.knockoutRoundName) || _lgD
      ? `<div style="text-align:center;margin-bottom:10px">
           ${m.isKnockout && m.knockoutRoundName ? `<span style="font-size:11px;font-weight:800;color:#9b59b6;background:rgba(155,89,182,.1);border:1px solid rgba(155,89,182,.25);border-radius:20px;padding:4px 14px">
             🏆 ${m.knockoutRoundName}
           </span>` : ''}${_lgBadgeD}
         </div>`
      : '';
    // ✅︎ بطاقة الراعي — راعي المباراة يتقدّم على راعي البطولة
    const _spHtml = (typeof window._spMatchHTML === 'function') ? window._spMatchHTML(m) : '';
    // 🎥 بث فيديو مضمّن — يظهر فقط إن وُجد رابط (قبل/أثناء/بعد). بلا عدّاد ولا بوابة.
    const _psHtml = _buildPlatformStream(m);
    const _videoHtml = _buildVideoEmbed(m);
    body.innerHTML = knockoutBadgeHtml + headerHtml + _psHtml + _videoHtml + _spHtml + tabsHtml + contentHtml;

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
