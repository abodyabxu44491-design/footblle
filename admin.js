import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch, where }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
/* ⚡ كاش محلي دائم — تحميل شبه فوري في الزيارات المتكررة */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  db = getFirestore(app);
}
const auth = getAuth(app);

// ──────────────────────────────────────────────────────────────────────────
// 🔧 FIX §0 — كشف Firestore helpers على window للـ Tournament Fix patch
// ──────────────────────────────────────────────────────────────────────────
window._db                  = db;
window._firestoreGetDoc     = getDoc;
window._firestoreDoc        = doc;
window._firestoreCollection = collection;
window._firestoreOnSnapshot = onSnapshot;
window._firestoreUpdateDoc  = updateDoc;
window._firestoreWriteBatch = writeBatch;
window._serverTimestamp     = serverTimestamp;
window._firestoreSetDoc     = setDoc;
window._firestoreAddDoc     = addDoc;

// ══ STATE ══
const params = new URLSearchParams(location.search);
let LEAGUE_ID = params.get('id') || '';
// كشف LEAGUE_ID على window
window._getLeagueId = () => LEAGUE_ID;
window._setLeagueId = (v) => { LEAGUE_ID = v; };
const SITE_URL = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
let league = null;
let teams = [];
let matches = [];
window.matches = matches; // يستخدمه mcv2
let scorers = {};
let settings = { winPts: 3, drawPts: 1, lossePts: 0, type: 'league', zones: { champion: 1, qualify: 2, cond: 1, normal: 0, playoff: 1, relegate: 1 }, tiebreakOrder: ['h2h','gd','gf','draw'] };
window.settings = settings;
const ZONE_COLORS = ['var(--gold)', 'var(--green)', 'var(--blue)', '#888', 'var(--orange)', 'var(--red)'];
const ZONE_KEYS = ['champion', 'qualify', 'cond', 'normal', 'playoff', 'relegate'];
const ZONE_NAMES = ['المتوج 🏆', 'متأهل ✅︎', 'مشروط 🔵', 'عادي ⚪', 'ملعب الهبوط 🟠', 'هابط 🔴'];

// ══ AUTH ══
window.doLogin = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');

  if(!email || !pass) { showLoginErr('أدخل البريد وكلمة المرور'); return; }
  btn.disabled = true;
  document.getElementById('loginBtnText').textContent = 'جاري الدخول...';

  try {
    await signInWithEmailAndPassword(auth, email, pass);

    // تأكيد أن LEAGUE_ID موجود وصحيح
    if(!LEAGUE_ID) {
      throw new Error('missing-league-id');
    }

    const admDoc = await getDoc(doc(db, 'leagueAdmins', auth.currentUser.uid));
    if(!admDoc.exists()) {
      await signOut(auth);
      showLoginErr('ليس لديك صلاحية إدارة هذه البطولة (لا يوجد سجل leagueAdmins)');
      btn.disabled = false;
      document.getElementById('loginBtnText').textContent = '🔐 دخول';
      return;
    }

    const leagueId = admDoc.data().leagueId;
    if(String(leagueId) !== String(LEAGUE_ID)) {
      await signOut(auth);
      showLoginErr('ليس لديك صلاحية إدارة هذه البطولة (leagueId غير مطابق)');
      btn.disabled = false;
      document.getElementById('loginBtnText').textContent = '🔐 دخول';
      return;
    }

    enterApp();
  } catch(e) {
    // ضمان ظهور رسالة دائماً وعدم حدوث "صمت"
    const msg = e?.message === 'missing-league-id'
      ? 'لم يتم تحديد معرف البطولة من رابط الصفحة'
      : getAuthError(e?.code);

    showLoginErr(msg);
    btn.disabled = false;
    document.getElementById('loginBtnText').textContent = '🔐 دخول';
  }
};

function showLoginErr(msg) {
  const el = document.getElementById('loginErr');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

function getAuthError(code) {
  const map = { 'auth/user-not-found': 'البريد غير موجود', 'auth/wrong-password': 'كلمة المرور خاطئة', 'auth/invalid-credential': 'بيانات الدخول خاطئة', 'auth/too-many-requests': 'محاولات كثيرة — انتظر' };
  return map[code] || 'خطأ في تسجيل الدخول';
}

onAuthStateChanged(auth, async (user) => {
  if(user) {
    if(!LEAGUE_ID) {
      const admDoc = await getDoc(doc(db, 'leagueAdmins', user.uid));
      if(admDoc.exists()) { LEAGUE_ID = admDoc.data().leagueId; }
    }
    enterApp();
  }
});

function enterApp() {
   const ls = document.getElementById('loginScreen');
   ls.style.opacity = '0';
   setTimeout(async () => {
     ls.style.display = 'none';
     // فحص إذا كانت البطولة تحتاج Wizard
     await checkAndShowWizard();
   }, 400);
}

// ══ SETUP WIZARD — أول دخول ══
let _wzSelectedType = '';

async function checkAndShowWizard() {
  if(!LEAGUE_ID) {
    document.getElementById('app').style.display = 'block';
    loadLeagueData();
    setTimeout(checkSubscription, 2000);
    return;
  }
  try {
    // FIX: قراءة typeLocked من كلا المكانين (root doc + config/settings)
    const [leagueDoc, settingsDoc] = await Promise.all([
      getDoc(doc(db, 'leagues', LEAGUE_ID)),
      getDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'))
    ]);
    const rootLocked   = leagueDoc.exists()   && leagueDoc.data().typeLocked   === true;
    const configLocked = settingsDoc.exists() && settingsDoc.data().typeLocked === true;

    if(rootLocked || configLocked) {
      // إصلاح: لو config مقفل لكن root غير مقفل — أصلح root
      if(configLocked && !rootLocked && leagueDoc.exists()) {
        const st = settingsDoc.data();
        updateDoc(doc(db, 'leagues', LEAGUE_ID), {
          typeLocked: true, type: st.type || 'league'
        }).catch(() => {});
      }
      _launchApp();
      return;
    }
    // لم يتم الإعداد بعد — عرض Wizard
    showSetupWizard(leagueDoc.exists() ? leagueDoc.data() : {});
  } catch(e) {
    console.error('[checkAndShowWizard] error:', e);
    _launchApp();
  }
}

function _launchApp() {
  document.getElementById('app').style.display = 'block';
  loadLeagueData();
  setTimeout(checkSubscription, 2000);
}

function showSetupWizard(leagueData) {
  const wz = document.getElementById('setupWizard');
  if(!wz) { _launchApp(); return; }
  // تعبئة الاسم المؤقت من Super Admin
  const nameEl = document.getElementById('wz-name');
  const seasonEl = document.getElementById('wz-season');
  if(nameEl && leagueData.name) nameEl.value = leagueData.name;
  if(seasonEl && leagueData.season) seasonEl.value = leagueData.season;
  wz.style.display = 'block';
}

window.wzGoStep = function(step) {
  // Validation
  if(step === 2) {
    const name = document.getElementById('wz-name')?.value.trim();
    if(!name) { showWzError('أدخل اسم البطولة أولاً'); return; }
  }
  if(step === 3) {
    if(!_wzSelectedType) { showWzError('اختر نوع البطولة أولاً'); return; }
    // تعبئة صفحة التأكيد
    const typeNames = { league: '📋 دوري نقاط', groups: '🔷 مجموعات + خروج مغلوب', knockout: '⚡ خروج مغلوب فقط' };
    document.getElementById('wz-confirm-name').textContent = document.getElementById('wz-name')?.value.trim() || '—';
    document.getElementById('wz-confirm-season').textContent = document.getElementById('wz-season')?.value || '2025';
    document.getElementById('wz-confirm-type').textContent = typeNames[_wzSelectedType] || _wzSelectedType;
    _wzRenderDynamicConfig();
  }
  // إخفاء كل الخطوات
  [1,2,3].forEach(i => {
    const el = document.getElementById('wz-step-' + i);
    if(el) el.style.display = 'none';
  });
  // إظهار الخطوة المطلوبة
  const target = document.getElementById('wz-step-' + step);
  if(target) target.style.display = 'block';
  // تحديث المؤشر
  [1,2,3].forEach(i => {
    const dot = document.getElementById('wz-dot-' + i);
    if(!dot) return;
    dot.classList.remove('active','done');
    if(i < step) dot.classList.add('done');
    else if(i === step) dot.classList.add('active');
  });
  const line1 = document.getElementById('wz-line-1');
  const line2 = document.getElementById('wz-line-2');
  if(line1) line1.classList.toggle('wz-line-done', step > 1);
  if(line2) line2.classList.toggle('wz-line-done', step > 2);
};

window.wzSelectType = function(type) {
  _wzSelectedType = type;
  ['league','groups','knockout'].forEach(t => {
    const card = document.getElementById('wzt-' + t);
    if(card) card.classList.toggle('selected', t === type);
  });
};

function showWzError(msg) {
  showToast(msg, 'error');
}

// ═══════════════════════════════════════════════════════════════════
//  الخطوة ٣ الديناميكية — تفاصيل حسب نوع البطولة + إنشاء كل شيء دفعة واحدة
// ═══════════════════════════════════════════════════════════════════
window._wzTeamsTotal  = 8;
window._wzGroupsCount = 4;
window._wzQualifyN    = 2;
window._wzGroupNames  = ['A','B','C','D'];
window._wzBracketKey  = 'qf';

const WZ_BRACKET_SIZES = { f:2, sf:4, qf:8, r16:16, r32:32 };
const WZ_BRACKET_ROUNDS = {
  r32: [{name:'دور الـ 32',slots:16}, {name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
  r16: [{name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
  qf:  [{name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
  sf:  [{name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
  f:   [{name:'النهائي',slots:1}],
};

// أقرب حجم شجرة قياسي يتّسع لعدد الفرق/المتأهلين المطلوب
function _wzSuggestBracketKey(n) {
  const order = ['f','sf','qf','r16','r32'];
  for (const k of order) if (WZ_BRACKET_SIZES[k] >= n) return k;
  return 'r32';
}

function _wzBracketOptionsHtml(selectedKey, gridId) {
  const opts = [
    {k:'r32',label:'دور الـ 32',sub:'32 فريق',icon:'swords'},
    {k:'r16',label:'دور الـ 16',sub:'16 فريق',icon:'target'},
    {k:'qf',label:'ربع النهائي',sub:'8 فرق',icon:'medal'},
    {k:'sf',label:'نصف النهائي',sub:'4 فرق',icon:'medal'},
    {k:'f',label:'النهائي',sub:'فريقان',icon:'trophy'}
  ];
  return `<div style="display:grid;gap:8px;margin-top:8px" id="${gridId}">
    ${opts.map(s => `
      <button type="button" class="type-card ${s.k===selectedKey?'selected':''}" style="display:flex;align-items:center;gap:12px;padding:12px;text-align:right"
        onclick="wzPickBracketKey(this,'${s.k}','${gridId}')">
        <span style="display:flex;align-items:center;justify-content:center">${_ic(s.icon,22)}</span>
        <div><div style="font-size:12px;font-weight:700">${s.label}</div><div style="font-size:10px;color:var(--muted)">${s.sub}</div></div>
      </button>`).join('')}
  </div>`;
}

window.wzPickBracketKey = function(btn, key, gridId) {
  document.querySelectorAll('#' + gridId + ' .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wzBracketKey = key;
};

window.wzSetTeamsTotal = function(val) {
  const n = parseInt(val);
  window._wzTeamsTotal = (n >= 2) ? n : 0;
  if (_wzSelectedType === 'groups') _wzUpdateGroupsMath();
  if (_wzSelectedType === 'knockout') {
    const suggested = _wzSuggestBracketKey(window._wzTeamsTotal || 2);
    window._wzBracketKey = suggested;
    const grid = document.getElementById('wzKoBracketGrid');
    if (grid) grid.outerHTML = _wzBracketOptionsHtml(suggested, 'wzKoBracketGrid');
  }
};

window.wzPickGroupsCount = function(btn, n) {
  document.querySelectorAll('#wzGcGrid .type-card').forEach(b => b.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
  window._wzGroupsCount = n;
  const custom = document.getElementById('wzGcCustom'); if (custom) custom.value = '';
  _wzRegenGroupNames(n);
  _wzUpdateGroupsMath();
};

window.wzCustomGroupsCount = function(inp) {
  const n = parseInt(inp.value);
  if (n >= 2 && n <= 16) {
    document.querySelectorAll('#wzGcGrid .type-card').forEach(b => b.classList.remove('selected'));
    window._wzGroupsCount = n;
    _wzRegenGroupNames(n);
    _wzUpdateGroupsMath();
  }
};

function _wzRegenGroupNames(n) {
  const defaultNames = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
  window._wzGroupNames = defaultNames.slice(0, n);
  const container = document.getElementById('wzGroupNamesBox');
  if (!container) return;
  container.innerHTML = window._wzGroupNames.map((name, i) => `
    <input class="form-input" style="padding:6px;text-align:center;font-weight:700"
      value="${name}" placeholder="مجموعة ${i+1}"
      oninput="window._wzGroupNames[${i}]=this.value" id="wzGName${i}"/>
  `).join('');
}

window.wzPickQualifyN = function(btn, n) {
  document.querySelectorAll('#wzQnGrid .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wzQualifyN = n;
  _wzUpdateGroupsMath();
}

window.wzPickLegMode = function(btn, mode) {
  document.querySelectorAll('#wzLegGrid .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wzLegMode = mode;
}

// يحدّث "كم فريق بكل مجموعة" و"سقف الشجرة المقترح" تلقائياً من الأرقام المدخلة
function _wzUpdateGroupsMath() {
  const total  = window._wzTeamsTotal  || 0;
  const groups = window._wzGroupsCount || 1;
  const qualifyPerGroup = window._wzQualifyN || 2;
  const perGroupAvg = total ? (total / groups) : 0;
  const perGroupTxt = total
    ? (Number.isInteger(perGroupAvg)
        ? `${perGroupAvg} فرق في كل مجموعة`
        : `~${Math.floor(perGroupAvg)}-${Math.ceil(perGroupAvg)} فرق لكل مجموعة (توزيع غير متساوٍ)`)
    : '—';
  const perGroupEl = document.getElementById('wzPerGroupInfo');
  if (perGroupEl) perGroupEl.textContent = perGroupTxt;

  const totalQualifiers = groups * qualifyPerGroup;
  const suggested = _wzSuggestBracketKey(Math.max(totalQualifiers, 2));
  window._wzBracketKey = suggested;
  const qEl = document.getElementById('wzQualifiersInfo');
  if (qEl) qEl.textContent = `${totalQualifiers} فريق متأهل إجمالاً`;
  const grid = document.getElementById('wzGroupsBracketGrid');
  if (grid) grid.outerHTML = _wzBracketOptionsHtml(suggested, 'wzGroupsBracketGrid');
}


// ── كتلة الإعدادات المشتركة في المعالج (مدة الشوط + التشكيلة) ──
// تظهر لكل الأنواع — كان المنظم يضطر لدخول الإعدادات بعد الإنشاء.
function _wzCommonSettingsHtml() {
  window._wzHalfDur   = window._wzHalfDur   || 45;
  window._wzSquadSize = window._wzSquadSize || 11;
  window._wzTieMode   = window._wzTieMode   || 'et_pen';
  const durs  = [10, 15, 20, 25, 30, 35, 40, 45];
  const squads = [5, 6, 7, 8, 9, 10, 11];
  /* ✅︎ حسم التعادل — يظهر للبطولات التي فيها أدوار إقصاء فقط.
     دوري النقاط لا يحتاجه: التعادل نتيجة مشروعة فيه. */
  const tieHtml = (_wzSelectedType === 'groups' || _wzSelectedType === 'knockout') ? `
    <div class="form-group" style="margin-top:16px">
      <label class="form-label">عند تعادل مباراة إقصاء</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px" id="wzTieGrid">
        <button type="button" class="type-card ${window._wzTieMode==='et_pen'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickTie(this,'et_pen')">
          <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('bolt',20)}</div>أشواط إضافية ثم ركلات
        </button>
        <button type="button" class="type-card ${window._wzTieMode==='pen'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickTie(this,'pen')">
          <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('goal',20)}</div>ركلات ترجيح مباشرة
        </button>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">مباريات المجموعات تنتهي بالتعادل دائماً — هذا للإقصاء فقط</div>
    </div>` : '';
  return `
    <div class="form-group" style="margin-top:16px">
      <label class="form-label">مدة الشوط الواحد (دقيقة)</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wzDurGrid">
        ${durs.map(n => `<button type="button" class="type-card ${n===window._wzHalfDur?'selected':''}" style="padding:10px 4px;font-size:13px;font-weight:700" onclick="wzPickHalfDur(this,${n})">${n}</button>`).join('')}
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">الشوطان بنفس المدة — تقدر تغيّرها لاحقاً من الإعدادات</div>
    </div>
    ${tieHtml}
    <div class="form-group" style="margin-top:16px">
      <label class="form-label">عدد لاعبي التشكيلة (شامل الحارس)</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wzSquadGrid">
        ${squads.map(n => `<button type="button" class="type-card ${n===window._wzSquadSize?'selected':''}" style="padding:10px 4px;font-size:13px;font-weight:700" onclick="wzPickSquad(this,${n})">${n}</button>`).join('')}
      </div>
    </div>`;
}

window.wzPickTie = function(btn, mode) {
  window._wzTieMode = mode;
  const g = document.getElementById('wzTieGrid');
  if (g) g.querySelectorAll('.type-card').forEach(c => c.classList.toggle('selected', c === btn));
};

window.wzPickHalfDur = function(btn, n) {
  window._wzHalfDur = n;
  const g = document.getElementById('wzDurGrid');
  if (g) g.querySelectorAll('.type-card').forEach(c => c.classList.toggle('selected', c === btn));
};

window.wzPickSquad = function(btn, n) {
  window._wzSquadSize = n;
  const g = document.getElementById('wzSquadGrid');
  if (g) g.querySelectorAll('.type-card').forEach(c => c.classList.toggle('selected', c === btn));
};

/* ✅︎ أيقونة SVG بدل الإيموجي — نظام الأيقونات مُعرَّف في league-admin.html
   (window.Icon) ويُحمَّل قبل admin.js. نمرّ عبر دالة آمنة تُرجع فراغاً
   لو لم يجهز بعد بدل أن ترمي استثناء. */
function _ic(name, size, color) {
  return (window.Icon ? window.Icon(name, size || 18, color) : '');
}

// يبني نموذج التفاصيل المناسب لنوع البطولة المختار داخل #wz-dynamic-config
function _wzRenderDynamicConfig() {
  const el = document.getElementById('wz-dynamic-config');
  if (!el) return;

  if (_wzSelectedType === 'league') {
    window._wzLegMode = window._wzLegMode || 'single';
    el.innerHTML = `
      <div class="form-group">
        <label class="form-label">عدد الفرق المشاركة</label>
        <input type="number" class="form-input" min="2" max="256" placeholder="مثال: 12"
          value="${window._wzTeamsTotal || ''}" oninput="wzSetTeamsTotal(this.value)"/>
      </div>
      <div class="form-group" style="margin-top:16px">
        <label class="form-label">نوع المباريات</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px" id="wzLegGrid">
          <button type="button" class="type-card ${window._wzLegMode==='single'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickLegMode(this,'single')">
            <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('chevronL',20)}</div>ذهاب فقط
          </button>
          <button type="button" class="type-card ${window._wzLegMode==='double'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickLegMode(this,'double')">
            <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('refresh',20)}</div>ذهاب وإياب
          </button>
        </div>
      </div>
      ${_wzCommonSettingsHtml()}
      <div style="background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.15);border-radius:12px;padding:14px;margin-top:16px;font-size:11px;color:var(--muted2);line-height:1.8">
        ${_ic('bulb',13)} سينشأ جدول ترتيب فارغ الآن. في الخطوة القادمة تضيف الفرق وتتولّد المباريات تلقائياً.
      </div>`;
    return;
  }

  if (_wzSelectedType === 'groups') {
    window._wzGroupsCount = window._wzGroupsCount || 4;
    window._wzQualifyN    = window._wzQualifyN    || 2;
    window._wzLegMode     = window._wzLegMode     || 'single';
    if (!window._wzGroupNames || !window._wzGroupNames.length) window._wzGroupNames = ['A','B','C','D'];

    el.innerHTML = `
      <div class="form-group">
        <label class="form-label">عدد الفرق المشاركة الكلي</label>
        <input type="number" class="form-input" min="2" max="256" placeholder="مثال: 24"
          value="${window._wzTeamsTotal || ''}" oninput="wzSetTeamsTotal(this.value)"/>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">نوع مباريات المجموعات</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px" id="wzLegGrid">
          <button type="button" class="type-card ${window._wzLegMode==='single'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickLegMode(this,'single')">
            <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('chevronL',20)}</div>ذهاب فقط
          </button>
          <button type="button" class="type-card ${window._wzLegMode==='double'?'selected':''}" style="padding:12px 8px;font-size:12px" onclick="wzPickLegMode(this,'double')">
            <div style="margin-bottom:5px;display:flex;justify-content:center">${_ic('refresh',20)}</div>ذهاب وإياب
          </button>
        </div>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">عدد المجموعات</label>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wzGcGrid">
          ${[2,3,4,6,8].map(n => `<button type="button" class="type-card ${n===window._wzGroupsCount?'selected':''}" style="padding:12px 6px;font-size:13px;font-weight:700" onclick="wzPickGroupsCount(this,${n})">${n}</button>`).join('')}
        </div>
        <input type="number" class="form-input" id="wzGcCustom" placeholder="أو أدخل عدداً..." min="2" max="16" style="margin-top:8px" oninput="wzCustomGroupsCount(this)"/>
        <div style="font-size:11px;color:var(--gold2);margin-top:6px" id="wzPerGroupInfo">—</div>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">أسماء المجموعات</label>
        <div id="wzGroupNamesBox" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;margin-top:8px"></div>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">عدد المتأهلين من كل مجموعة</label>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wzQnGrid">
          ${[1,2,3,4].map(n => `<button type="button" class="type-card ${n===window._wzQualifyN?'selected':''}" style="padding:10px 6px;font-size:13px;font-weight:700" onclick="wzPickQualifyN(this,${n})">${n}</button>`).join('')}
        </div>
      </div>

      <div class="form-group" style="margin-top:16px">
        <label class="form-label">من أين تبدأ شجرة الإقصاء</label>
        <div style="font-size:11px;color:var(--gold2);margin-bottom:6px" id="wzQualifiersInfo">—</div>
        ${_wzBracketOptionsHtml(window._wzBracketKey, 'wzGroupsBracketGrid')}
        <div style="font-size:10px;color:var(--muted);margin-top:8px;line-height:1.6">
          هذا اقتراح تلقائي بحسب عدد المتأهلين — تقدر تغيّره يدوياً.
        </div>
      </div>

      ${_wzCommonSettingsHtml()}

      <div style="background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.15);border-radius:12px;padding:12px 14px;margin-top:16px;font-size:11px;color:var(--muted2);line-height:1.7">
        ${_ic('bulb',13)} ستُنشأ المجموعات والشجرة فارغتين الآن بنفس الأرقام أعلاه. في الخطوة القادمة تضيف الفرق وتوزّعها على المجموعات بسهولة.
      </div>`;

    _wzRegenGroupNames(window._wzGroupsCount);
    _wzUpdateGroupsMath();
    return;
  }

  if (_wzSelectedType === 'knockout') {
    window._wzBracketKey = window._wzBracketKey || 'qf';
    el.innerHTML = `
      <div class="form-group">
        <label class="form-label">عدد الفرق المشاركة</label>
        <input type="number" class="form-input" min="2" max="256" placeholder="مثال: 8"
          value="${window._wzTeamsTotal || ''}" oninput="wzSetTeamsTotal(this.value)"/>
      </div>
      <div class="form-group" style="margin-top:16px">
        <label class="form-label">بداية الشجرة من</label>
        ${_wzBracketOptionsHtml(window._wzBracketKey, 'wzKoBracketGrid')}
        <div style="font-size:10px;color:var(--muted);margin-top:8px;line-height:1.6">
          اقتراح تلقائي حسب عدد الفرق — تقدر تغيّره يدوياً.
        </div>
      </div>
      ${_wzCommonSettingsHtml()}

      <div style="background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.15);border-radius:12px;padding:12px 14px;margin-top:16px;font-size:11px;color:var(--muted2);line-height:1.7">
        ${_ic('bulb',13)} ستُنشأ الشجرة فارغة الآن. في الخطوة القادمة تضيف الفرق وتحدد كل مباراة تدخل الشجرة من أين.
      </div>`;
    return;
  }

  el.innerHTML = '';
}

// ينشئ المجموعات فارغة + شجرة الإقصاء فارغة دفعة واحدة، ويحفظ الأرقام المخطط لها
async function _wzCreateGroupsAndBracket() {
  const groupsN  = window._wzGroupsCount || 4;
  const qualify  = window._wzQualifyN || 2;
  const names    = [];
  for (let i = 0; i < groupsN; i++) {
    const inp = document.getElementById('wzGName' + i);
    names.push(inp ? (inp.value.trim() || String.fromCharCode(65+i)) : (window._wzGroupNames[i] || String.fromCharCode(65+i)));
  }
  // ⚠️ لا تضع 🔴/🟥 هنا — محجوزة بكل الموقع لمؤشر "🔴 بث مباشر"، ووضعها
  // كإيقونة مجموعة تلتبس بصرياً بمؤشر البث (نظام SVG يحوّل نفس الرمز لنفس الأيقونة).
  const icons = ['🔵','🟡','🟢','🟣','🟠','⚫','⚪','🔷','🔶','🟦','🟩','🟨','🟪','🟫'];

  // احذف أي مجموعات/شجرة سابقة (إعداد نظيف من الصفر)
  const existingGroups = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'groups'));
  const existingRounds = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
  const delBatch = writeBatch(db);
  existingGroups.forEach(d => delBatch.delete(d.ref));
  existingRounds.forEach(d => delBatch.delete(d.ref));
  await delBatch.commit();

  const batch = writeBatch(db);
  // المجموعات — فارغة دائماً هنا (لا توجد فرق مضافة بعد)
  for (let i = 0; i < groupsN; i++) {
    batch.set(doc(collection(db, 'leagues', LEAGUE_ID, 'groups')), {
      name: names[i], icon: icons[i] || '👥', teamIds: [], qualify, order: i, createdAt: serverTimestamp(),
    });
  }
  // شجرة الإقصاء الفارغة — بنفس منطق معالج الإقصاء المستقل
  const bracketKey = window._wzBracketKey || _wzSuggestBracketKey(groupsN * qualify);
  const rounds = WZ_BRACKET_ROUNDS[bracketKey] || WZ_BRACKET_ROUNDS['qf'];
  rounds.forEach((r, i) => {
    batch.set(doc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds')), {
      name: r.name, order: i, slots: r.slots, matches: [], empty: true, createdAt: serverTimestamp(),
    });
  });
  await batch.commit();

  return { groupsN, qualify, bracketKey, roundsFirstName: rounds[0].name };
}

async function _wzCreateKnockoutOnly() {
  const bracketKey = window._wzBracketKey || _wzSuggestBracketKey(window._wzTeamsTotal || 8);
  const rounds = WZ_BRACKET_ROUNDS[bracketKey] || WZ_BRACKET_ROUNDS['r16'];

  const existing = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
  const delBatch = writeBatch(db);
  existing.forEach(d => delBatch.delete(d.ref));
  await delBatch.commit();

  const batch = writeBatch(db);
  rounds.forEach((r, i) => {
    batch.set(doc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds')), {
      name: r.name, order: i, slots: r.slots, matches: [], empty: true, createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
  return { bracketKey, roundsFirstName: rounds[0].name };
}

// ✅︎ التأكيد الموحّد الجديد — يحل محل wzConfirmSetup: يحفظ بيانات البطولة
// وينشئ المجموعات/الشجرة دفعة واحدة بحسب التفاصيل المدخلة في نفس الخطوة، بدون نوافذ منفصلة لاحقة
window.wzConfirmFinal = async function() {
  const name = document.getElementById('wz-name')?.value.trim();
  const season = document.getElementById('wz-season')?.value || '2025';
  const type = _wzSelectedType;
  if(!name || !type) { showWzError('بيانات ناقصة'); return; }
  if((type === 'groups' || type === 'knockout') && !(window._wzTeamsTotal >= 2)) {
    showWzError('أدخل عدد الفرق المشاركة أولاً'); return;
  }

  const btn = document.getElementById('wzConfirmBtn');
  if(btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإنشاء...'; }

  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), { name, season, updatedAt: serverTimestamp() });
    // ✅︎ احفظ إعدادات المباراة من المعالج مباشرة — لا حاجة لدخول الإعدادات بعد الإنشاء
    const _hd = window._wzHalfDur || 45;
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), {
      type, typeLocked: true,
      plannedTeamsTotal: window._wzTeamsTotal || null,
      plannedGroupsCount: type === 'groups' ? (window._wzGroupsCount || null) : null,
      plannedQualifyN:   type === 'groups' ? (window._wzQualifyN || null) : null,
      legMode: (type === 'groups' || type === 'league') ? (window._wzLegMode || 'single') : null,
      squadSize: window._wzSquadSize || 11,
      matchSettings: {
        half1Duration: _hd,
        half2Duration: _hd,
        halfDuration:  _hd,
        breakDuration: 15,
        et1Duration:   Math.max(5, Math.round(_hd / 3)),
        et2Duration:   Math.max(5, Math.round(_hd / 3)),
        /* ✅︎ حسم التعادل من المعالج — كان لا يُحفظ إطلاقاً فتبقى
           القيم الافتراضية ولا يُطبَّق اختيار المنظّم. */
        hasExtraTime: type === 'league' ? false : (window._wzTieMode !== 'pen'),
        hasPenalties: type === 'league' ? false : true,
      },
      teamsSetupDone: false,
      groupsSetupDone: false,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), { typeLocked: true, type });
    settings.type = type;

    let resultMsg = 'تم إنشاء البطولة';
    if (type === 'groups') {
      const r = await _wzCreateGroupsAndBracket();
      resultMsg = `تم إنشاء ${r.groupsN} مجموعات وشجرة تبدأ من ${r.roundsFirstName}`;
    } else if (type === 'knockout') {
      const r = await _wzCreateKnockoutOnly();
      resultMsg = `تم إنشاء شجرة تبدأ من ${r.roundsFirstName}`;
    }

    const wz = document.getElementById('setupWizard');
    if(wz) { wz.style.opacity = '0'; wz.style.transition = 'opacity .4s'; setTimeout(() => wz.style.display = 'none', 400); }

    _launchApp();
    showToast(resultMsg + ' — أضف الفرق المشاركة الآن', 'success');

    // وجّه الأدمن مباشرة لصفحة الفرق ليعبّئ الفرق المشاركة (الخطوة القادمة)
    setTimeout(() => {
      const teamsSb = document.querySelector('.sb-item[onclick*="\'teams\'"]');
      showPage('teams', teamsSb);
    }, 700);

  } catch(e) {
    showWzError('خطأ في الإنشاء: ' + e.message);
    if(btn) { btn.disabled = false; btn.textContent = 'تأكيد وإنشاء البطولة'; }
  }
};

window.wzConfirmSetup = async function() {
  const name = document.getElementById('wz-name')?.value.trim();
  const season = document.getElementById('wz-season')?.value || '2025';
  const type = _wzSelectedType;
  if(!name || !type) { showWzError('بيانات ناقصة'); return; }

  const btn = document.getElementById('wzConfirmBtn');
  if(btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }

  try {
    // حفظ اسم البطولة + الموسم + النوع + القفل
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
      name, season, updatedAt: serverTimestamp()
    });
    // حفظ النوع في config/settings مع القفل
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), {
      type, typeLocked: true, updatedAt: serverTimestamp()
    }, { merge: true });
    // قفل النوع في مستوى league أيضاً
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
      typeLocked: true, type
    });

    // إغلاق Wizard وتشغيل التطبيق
    const wz = document.getElementById('setupWizard');
    if(wz) { wz.style.opacity = '0'; wz.style.transition = 'opacity .4s'; setTimeout(() => wz.style.display = 'none', 400); }

    settings.type = type;
    _launchApp();

    // ✅︎ FIX: انتظر تحميل التطبيق الكامل قبل فتح wizard المجموعات/الإقصاء
    // 2500ms تكفي للتأكد من حقن الصفحات وتحميل البيانات
    if(type === 'groups') {
      setTimeout(() => { openGroupsWizard(null); }, 2500);
    } else if(type === 'knockout') {
      setTimeout(() => { openKnockoutWizard(null); }, 2500);
    }

  } catch(e) {
    showWzError('خطأ في الحفظ: ' + e.message);
    if(btn) { btn.disabled = false; btn.textContent = '✅︎ تأكيد وابدأ'; }
  }
};


function logoHtml(logo, size, radius) {
   size = size || 32; radius = radius || 8;
   if(!logo) return '<span style="font-size:' + size + 'px">⚽</span>';
   if(logo.startsWith('data:') || logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('/')) {
     return '<img src="' + logo + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:' + radius + 'px;object-fit:cover;display:inline-block;vertical-align:middle" onerror="this.style.display=\'none\';this.nextSibling && (this.nextSibling.style.display=\'inline\')"/><span style="font-size:' + size + 'px;display:none">⚽</span>';
   }
   return '<span style="font-size:' + size + 'px;line-height:1">' + logo + '</span>';
}

window.doLogout = async function() {
  if(confirm('هل تريد الخروج؟')) { await signOut(auth); location.reload(); }
};

// ══ LOAD DATA ══
async function loadLeagueData() {
  if(!LEAGUE_ID) { showToast('لم يتم تحديد معرف البطولة', 'error'); return; }

  // ⚡ تحميل league + settings بالتوازي
  const [leagueDoc, settingsDoc] = await Promise.all([
    getDoc(doc(db, 'leagues', LEAGUE_ID)),
    getDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'))
  ]);

  if(leagueDoc.exists()) {
    league = { id: leagueDoc.id, ...leagueDoc.data() };
    /* ✅︎ تصدير — cards-system.js يقرأ getLeague() = window.league.
       كانت غير مُصدَّرة فيرجع {} دائماً → اسم الدوري وشعاره مفقودان
       من كل البطاقات، فاضطُر المنظّم لكتابتهما يدوياً في كل مرة. */
    window.league = league;
    updateTopbar();
  }

  if(settingsDoc.exists()) {
    const d = settingsDoc.data();
    settings = { ...settings, ...d };
    window.settings = settings;              // ✅︎ مطلوب لنظام الراعي/التوقيت
    if (typeof window.spLoadForm === 'function') window.spLoadForm();
    // ✅︎ FIX: حقن الصفحات أولاً قبل تطبيق الإعدادات
    if (typeof injectGroupsAndKnockoutPages === 'function') {
      injectGroupsAndKnockoutPages();
    }
    applySettings();
  }

  // ⚡ تشغيل كل الـ listeners بالتوازي فوراً
  // Real-time teams
  onSnapshot(collection(db, 'leagues', LEAGUE_ID, 'teams'), (snap) => {
    teams = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    window.teams = teams; // sync for mcv2
    renderTeams();
    window.renderStandings();
    renderScorers();
    renderCards();
    populateMatchSelects();
    document.getElementById('teamsBadge').textContent = teams.length;
    document.getElementById('teamsCount').textContent = teams.length + ' فرق مسجلة';
    document.getElementById('dashTeams').textContent = teams.length;
  }, (err) => {
    console.error('Teams listener error:', err);
    showToast('خطأ في تحميل الفرق: ' + err.message, 'error');
  });

  // Real-time matches
  onSnapshot(query(collection(db, 'leagues', LEAGUE_ID, 'matches'), orderBy('round'), orderBy('date')), (snap) => {
    // نحافظ على مراجع الكائنات الموجودة بدلاً من إعادة إنشاء المصفوفة كاملاً
    // هذا يمنع ضياع تحديثات liveData المحلية عند إغلاق صفحة البث
    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    fresh.forEach(fd => {
      const idx = matches.findIndex(m => m.id === fd.id);
      if (idx === -1) {
        matches.push(fd);
      } else {
        // لو المباراة مفتوحة في البث الآن — لا نطغى على liveData المحلي
        const isLive = !!_liveMatches[fd.id];
        const existing = matches[idx];
        Object.assign(existing, fd);
        if (isLive && _liveMatches[fd.id]) {
          // أعِد مزامنة liveData من state الحي دائماً
          existing.liveData = existing.liveData || {};
          const st = _liveMatches[fd.id];
          existing.liveData.half1StartedAt    = st.half1StartedAt;
          existing.liveData.half2StartedAt    = st.half2StartedAt;
          existing.liveData.halftimeStartedAt = st.halftimeStartedAt;
          existing.liveData.et1StartedAt      = st.et1StartedAt;
          existing.liveData.et2StartedAt      = st.et2StartedAt;
          existing.liveData.matchStatus       = st.matchStatus;
          existing.liveData.currentHalf       = st.currentHalf;
          existing.liveData.timerPaused       = st.timerPaused;
          existing.liveData.timerSeconds      = st.timerSeconds;
          existing.liveData.half1ExtraMinutes = st.half1Extra || 0;
          existing.liveData.half2ExtraMinutes = st.half2Extra || 0;
        }
      }
    });
    // احذف المباريات المحذوفة من Firebase
    const freshIds = new Set(fresh.map(f => f.id));
    for (let i = matches.length - 1; i >= 0; i--) {
      if (!freshIds.has(matches[i].id)) matches.splice(i, 1);
    }
    window.matches = matches;
    window.matches = matches; // sync for mcv2
    window._adminMatchesRef = matches; // يستخدمه admin-lineup-dragdrop.js
    window._adminMatches = matches; // نسخة بديلة مستخدمة في dragdrop
    // Sort by round, then date manually in case of index issues
    matches.sort((a, b) => {
      if((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0);
      return (a.date || '').localeCompare(b.date || '');
    });
    renderMatches();
    // renderQuickEntry() أُزيل — النظام القديم مهجور، الإدخال السريع يفتح صفحة البث الآن
    window.renderStandings();
    renderScorers();
    updateMatchStats();
    renderCards();
    const live = matches.filter(m => m.status === 'live').length;
    const badge = document.getElementById('liveMatchBadge');
    if(live > 0) { badge.style.display = 'inline'; badge.textContent = live + ' مباشر'; }
    else badge.style.display = 'none';
  }, (err) => {
    console.error('Matches listener error:', err);
    showToast('خطأ في تحميل المباريات: ' + err.message, 'error');
  });

  // Safety timeout - hide loader after 10 seconds even if data doesn't load
  setTimeout(() => {
    const loader = document.getElementById('pageLoader');
    if(loader && loader.style.display !== 'none') {
      hideLoader();
      showToast('تأخر في تحميل البيانات، حاول مرة أخرى', 'error');
    }
  }, 10000);

  document.getElementById('viewerLinkDisplay').textContent = SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID;
}

function updateTopbar() {
  if(league) {
    document.getElementById('topbarName').textContent = league.name;
    document.getElementById('topbarIcon').textContent = league.icon || '🏆';
    document.getElementById('loginTitle').textContent = 'إدارة: ' + league.name;
    document.getElementById('loginSub').textContent = league.season || '2025';
    document.title = 'إدارة ' + league.name;
  }
}

function applySettings() {
  const el = document.getElementById('setName'); if(el && league) el.value = league.name || '';
  const el2 = document.getElementById('setSeason'); if(el2 && league) el2.value = league.season || '2025';
  const el3 = document.getElementById('setRounds'); if(el3) el3.value = settings.rounds || 10;
  const el4 = document.getElementById('setWinPts'); if(el4) el4.value = settings.winPts || 3;
  const el5 = document.getElementById('setDrawPts'); if(el5) el5.value = settings.drawPts || 1;
  const el6 = document.getElementById('setVenue'); if(el6) el6.value = settings.defaultVenue || '';

  // ✅︎ إعدادات المباراة (موحّدة: الشوطين + الاستراحة + الوقت الإضافي في مكان واحد)
  const ms = settings.matchSettings || {};
  const h1  = ms.half1Duration || ms.halfDuration || 45;
  const h2  = ms.half2Duration || ms.halfDuration || 45;
  const br  = ms.breakDuration || 15;
  const et1 = ms.et1Duration || 15;
  const et2 = ms.et2Duration || 15;
  const eh1 = document.getElementById('setHalf1Dur'); if(eh1) eh1.value = h1;
  const eh2 = document.getElementById('setHalf2Dur'); if(eh2) eh2.value = h2;
  const ebr = document.getElementById('setBreakDur'); if(ebr) ebr.value = br;
  const eet1 = document.getElementById('setET1Dur'); if(eet1) eet1.value = et1;
  const eet2 = document.getElementById('setET2Dur'); if(eet2) eet2.value = et2;
  // معاينة المدة الكلية
  const prev = document.getElementById('matchDurPreview');
  if(prev) prev.textContent = 'المباراة: ' + (h1 + br + h2) + ' دقيقة';

  // ✅︎ نظام الذهاب والإياب — يظهر فقط لبطولات المجموعات
  const legCard = document.getElementById('legModeCard');
  if (legCard) legCard.style.display = (settings.type === 'groups') ? 'block' : 'none';
  const legMode = settings.legMode || 'single';
  document.getElementById('setLegSingle')?.classList.toggle('selected', legMode === 'single');
  document.getElementById('setLegDouble')?.classList.toggle('selected', legMode === 'double');

  // ✅︎ نظام التشكيلة — إعداد عام على مستوى البطولة
  const squadSize = settings.squadSize || 11;
  [5,6,7,8,9,10,11].forEach(k => {
    document.getElementById('setSquad'+k)?.classList.toggle('selected', k === squadSize);
  });

  if(settings.zones) {
    ZONE_KEYS.forEach(k => {
      const z = document.getElementById('z_' + k);
      if(z) z.value = settings.zones[k] || 0;
    });
    updateZoneTotal();
  }

  // ✅︎ تحميل واجهة الحسم عند التساوي
  renderTiebreakUI();

  // 🔧 FIX: قراءة النوع من config/settings فقط (source of truth)
  // لا نثق بـ settings.type الذي قد يكون 'league' من DEFAULT
  // بل نقرأه مباشرة من Firestore ثم نطبق الواجهة
  const loadedType = settings.type || 'league';

  // عرض نوع البطولة المقفول
  _updateLockedTypeDisplay(loadedType);

  // تأكيد النوع من Firestore قبل تطبيق الواجهة (بدون انتظار)
  if(LEAGUE_ID) {
    getDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings')).then(snap => {
      const trueType = snap.exists() ? (snap.data().type || loadedType) : loadedType;
      if(trueType !== settings.type) {
        settings.type = trueType;
        _updateLockedTypeDisplay(trueType);
      }
      // ضمان بناء الصفحات قبل التكييف
      if(typeof injectGroupsAndKnockoutPages === 'function') injectGroupsAndKnockoutPages();
      if(typeof _adaptAdminUIToType === 'function') window._adaptAdminUIToType(trueType);
      if((trueType === 'groups' || trueType === 'knockout') && typeof loadGroupsAndKnockout === 'function') {
        loadGroupsAndKnockout();
      }
    }).catch(() => {
      // fallback
      if(typeof injectGroupsAndKnockoutPages === 'function') injectGroupsAndKnockoutPages();
      if(typeof _adaptAdminUIToType === 'function') window._adaptAdminUIToType(loadedType);
      if((loadedType === 'groups' || loadedType === 'knockout') && typeof loadGroupsAndKnockout === 'function') {
        loadGroupsAndKnockout();
      }
    });
  }
}

// ══ MATCH STATS ══
function updateMatchStats() {
  const finished = matches.filter(m => m.status === 'finished');
  const totalGoals = finished.reduce((s, m) => s + (m.homeScore || 0) + (m.awayScore || 0), 0);
  const maxRound = finished.reduce((s, m) => Math.max(s, m.round || 0), 0);
  document.getElementById('dashMatches').textContent = matches.length;
  document.getElementById('dashGoals').textContent = totalGoals;
  document.getElementById('dashRound').textContent = maxRound || '—';

  // Update league totals
  if(LEAGUE_ID && auth.currentUser) {
    updateDoc(doc(db, 'leagues', LEAGUE_ID), { matchesCount: matches.length, totalGoals, updatedAt: serverTimestamp() }).catch(() => {});
  }
}

// ══ RENDER TEAMS ══
function renderTeams() {
  if (typeof _checkForceTeamsGate === 'function') _checkForceTeamsGate();
  /* ✅︎ بوابة المجموعات — الخطوة التالية بعد اكتمال الفرق */
  if (typeof window._checkForceGroupsGate === 'function') window._checkForceGroupsGate();
  const el = document.getElementById('teamsList');
  if(teams.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="e-icon">👥</div><div>لا توجد فرق بعد — أضف فريقاً!</div></div>';
    return;
  }
  el.innerHTML = teams.map(t => {
    const isImg = t.logo && (t.logo.startsWith('data:') || t.logo.startsWith('http://') || t.logo.startsWith('https://') || t.logo.startsWith('/'));
    const logoHtml = isImg
      ? '<div class="team-logo-box" style="background-image:url(\'' + t.logo + '\');background-size:cover;background-position:center;font-size:0"></div>'
      : '<div class="team-logo-box">' + (t.logo || '⚽') + '</div>';
    const details = [
      t.coach ? '🧑‍💼 ' + t.coach : '',
      t.stadium ? '🏟 ' + t.stadium : '',
      t.phone ? '📱 ' + t.phone : ''
    ].filter(Boolean).join('  ·  ');
    return '<div class="team-row">'
      + logoHtml
      + '<div style="flex:1;min-width:0">'
      + '<input class="team-name-input" value="' + t.name + '" onblur="updateTeamName(\'' + t.id + '\',this.value)" placeholder="اسم الفريق"/>'
      + (details ? '<div style="font-size:10px;color:var(--muted);margin-top:3px">' + details + '</div>' : '')
      + (t.bio ? '<div style="font-size:10px;color:var(--muted2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + t.bio + '</div>' : '')
      + '</div>'
      + '<div style="font-size:10px;color:var(--muted);text-align:center;min-width:40px;flex-shrink:0">'
      + '<div style="color:var(--gold);font-weight:900;font-size:14px">' + (t.pts || 0) + '</div><div>نقطة</div></div>'
      + '<div style="display:flex;gap:6px;flex-shrink:0">'
      + '<button class="icon-btn" onclick="openRosterModal(\'' + t.id + '\')" title="قائمة اللاعبين" style="background:var(--blue,#2980b9)22;border:1px solid var(--blue,#2980b9)44">👥</button>'
      + '<button class="icon-btn" onclick="openEditTeam(\'' + t.id + '\')" title="تعديل">✏︎️</button>'
      + '<button class="icon-btn del" onclick="deleteTeam(\'' + t.id + '\')">🗑</button>'
      + '</div></div>';
  }).join('');
  updateDoc(doc(db, 'leagues', LEAGUE_ID), { teamsCount: teams.length }).catch(() => {});
}

window.addTeam = async function() {
  const name = document.getElementById('newTeamName').value.trim();
  if(!name) { showToast('⚠️ أدخل اسم الفريق أولاً', 'error'); return; }

  // ✅︎ تنبيه على الاسم المكرر — يمنع الالتباس في الترتيب والهدافين
  const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (teams.some(t => norm(t.name) === norm(name))) {
    showToast(`🚫 يوجد فريق باسم «${name}» بالفعل — اختر اسماً مختلفاً`, 'error');
    return;
  }

  // ✅︎ تنبيه لو تجاوز العدد المحدد في إعدادات البطولة
  const maxT = parseInt(window.settings?.teamsCount || 0);
  if (maxT && teams.length >= maxT) {
    const ok = await window.confirmDialog({
      title: '⚠️ تجاوزت عدد الفرق',
      message: `حدّدت ${maxT} فرق في إعدادات البطولة، وأضفت ${teams.length}.\nهل تريد إضافة فريق إضافي؟`,
      confirmText: 'أضف', danger: false
    });
    if (!ok) return;
  }

  const logo = teamLogoDataUrl || document.getElementById('newTeamLogo').value.trim() || '⚽';
  const shortName = document.getElementById('newTeamShort')?.value.trim() || name.substring(0,3);
  const coach = document.getElementById('newTeamCoach')?.value.trim() || '';
  const manager = document.getElementById('newTeamManager')?.value.trim() || '';
  const stadium = document.getElementById('newTeamStadium')?.value.trim() || '';
  const founded = document.getElementById('newTeamFounded')?.value || '';
  const phone = document.getElementById('newTeamPhone')?.value.trim() || '';
  const insta = document.getElementById('newTeamInsta')?.value.trim() || '';
  const bio = document.getElementById('newTeamBio')?.value.trim() || '';
  try {
    await addDoc(collection(db, 'leagues', LEAGUE_ID, 'teams'), {
      name, logo, shortName, coach, manager, stadium, founded,
      phone, insta, bio, color: selectedTeamColor,
      pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0,
      order: teams.length, createdAt: serverTimestamp()
    });
    closeModal('modal-team');
    resetTeamForm();
    showToast('✅︎ تمت إضافة ' + name, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.resetTeamForm = function() {
  ['newTeamName','newTeamLogo','newTeamShort','newTeamCoach','newTeamManager','newTeamStadium','newTeamFounded','newTeamPhone','newTeamInsta','newTeamBio'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  document.getElementById('teamLogoPreview').textContent = '⚽';
  document.getElementById('teamLogoPreview').style.backgroundImage = '';
  document.getElementById('teamLogoPreview').style.backgroundSize = '';
  teamLogoDataUrl = null;
  selectedTeamColor = '#C9A02B';
  document.querySelectorAll('.tc-swatch').forEach((s,i) => s.classList.toggle('sel', i === 0));
};

// ═══════════════════════════════════════════════════════════════════
// §  بوابة إجبار تعبئة الفرق المشاركة — الخطوة ٢ من إعداد البطولة
//    بعد اختيار عدد الفرق في المعالج، يبقى هذا الحاجز يمنع أي تصفّح
//    لباقي اللوحة حتى تكتمل بيانات كل الفرق المخطط لها
// ═══════════════════════════════════════════════════════════════════
/* ✅︎ حفظ علم اكتمال المجموعات — يستدعيها groups-gate.js
   (لا تستطيع الوصول لـ db/LEAGUE_ID لأنهما module-scoped) */
/* ✅︎ حفظ شعار البطولة — يستدعيها league-logo.js
   (db/LEAGUE_ID module-scoped فلا تراهما الملفات الخارجية) */
window._lgSave = function (dataUrl) {
  if (!LEAGUE_ID) return Promise.reject(new Error('لا توجد بطولة'));
  return updateDoc(doc(db, 'leagues', LEAGUE_ID), {
    logo: dataUrl || '', updatedAt: serverTimestamp()
  });
};

window._gtSave = function () {
  if (!LEAGUE_ID) return;
  updateDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'),
            { groupsSetupDone: true }).catch(() => {});
};

window._checkForceTeamsGate = function () {
  const total = settings && settings.plannedTeamsTotal;
  const done  = settings && settings.teamsSetupDone === true;
  const gateEl = document.getElementById('forceTeamsGate');

  if (!total || done) { if (gateEl) gateEl.style.display = 'none'; return; }

  if (teams.length >= total) {
    settings.teamsSetupDone = true;
    updateDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), { teamsSetupDone: true }).catch(() => {});
    if (gateEl) { gateEl.style.opacity = '0'; setTimeout(() => { gateEl.style.display = 'none'; }, 300); }
    if (settings.type === 'league') {
      // ✅︎ دوري بلا مجموعات: لا توجد بوابة توزيع تالية — الجدول يتولّد فوراً
      window._autoGenerateMatchesIfReady && window._autoGenerateMatchesIfReady();
    } else {
      showToast('✅︎ اكتملت بيانات كل الفرق — وزّعهم على المجموعات الآن', 'success');
    }
    return;
  }
  _renderForceTeamsGate(total);
};

/* ✅︎ توليد جدول الدوري تلقائياً (نوع "league" بدون مجموعات) — بمجرد
   اكتمال بيانات كل الفرق المخطط لها، بدون أي زر يدوي.
   نفس خوارزمية autoSchedule القديمة، لكن بلا نافذة تأكيد وبحارس
   يمنع التكرار (نفس أسلوب _dndAutoGenerateIfFull). */
window._lgGenLock = false;
window._lgAutoGenerateIfFull = async function () {
  if (window._lgGenLock) return;
  window._lgGenLock = true;
  try { await _lgAutoGenInner(); } finally { window._lgGenLock = false; }
};

async function _lgAutoGenInner() {
  if (!settings || settings.type !== 'league') return;
  const total = settings.plannedTeamsTotal;
  if (!total || teams.length < total) return;

  // اقرأ من الخادم مباشرة لتفادي سباق التوليد المزدوج
  let existing = 0;
  try {
    const snap = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'matches'));
    existing = snap.size;
  } catch (e) { return; }
  if (existing > 0) return; // فيه مباريات محفوظة مسبقاً — لا تولّد فوقها

  const n = teams.length;
  const numRounds = n % 2 === 0 ? n - 1 : n;
  const half = Math.floor(n / 2);
  const teamList = teams.map((t, i) => i);
  const rotating = teamList.slice(1);
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    const fixed = teamList[0];
    const rotated = rotating.slice();
    for (let rot = 0; rot < r; rot++) rotated.unshift(rotated.pop());
    if (n % 2 === 0) {
      roundMatches.push([fixed, rotated[rotated.length - 1]]);
      for (let p = 0; p < half - 1; p++) roundMatches.push([rotated[p], rotated[rotated.length - 2 - p]]);
    } else {
      for (let p = 0; p < half; p++) roundMatches.push([rotated[p], rotated[rotated.length - 1 - p]]);
    }
    rounds.push(roundMatches);
  }

  const batch = writeBatch(db);
  let matchCount = 0;
  rounds.forEach((roundMatches, rIdx) => {
    roundMatches.forEach(([iA, iB]) => {
      const ref = doc(collection(db, 'leagues', LEAGUE_ID, 'matches'));
      batch.set(ref, {
        homeId: teams[iA].id, awayId: teams[iB].id,
        homeName: teams[iA].name, awayName: teams[iB].name,
        homeLogo: teams[iA].logo || '⚽', awayLogo: teams[iB].logo || '⚽',
        homeScore: null, awayScore: null,
        date: null, time: null, venue: null,
        round: rIdx + 1,
        status: 'upcoming', createdAt: serverTimestamp()
      });
      matchCount++;
    });
  });

  try {
    await batch.commit();
    showToast(`⚽ اكتملت بيانات الفرق — تولّد جدول الدوري تلقائياً: ${rounds.length} جولة (${matchCount} مباراة)`, 'success');
    if (typeof window._amtRender === 'function') window._amtRender();
  } catch (err) {
    console.error('[league] auto-generate error:', err);
    showToast('⚠️ تعذّر توليد جدول الدوري تلقائياً — جرّب تحديث الصفحة، أو أضف المباريات يدوياً', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
 *  ✅︎ نقطة التوليد الموحّدة — كل مسار بالتطبيق (بوابة الفرق، بوابة
 *  المجموعات، السحب/الإفلات، التوزيع العشوائي) يستدعي هذي الدالة
 *  فقط، بدل ما يقرر بنفسه أي دالة توليد يشغّل. تفادياً لتكرار
 *  الأخطاء (فشل صامت) اللي صارت قبل — كل التوليد من مكان واحد.
 * ═══════════════════════════════════════════════════════════════════ */
window._autoGenerateMatchesIfReady = async function () {
  const t = settings && settings.type;
  try {
    if (t === 'league' && typeof window._lgAutoGenerateIfFull === 'function') {
      await window._lgAutoGenerateIfFull();
    } else if (t === 'groups' && typeof window._dndAutoGenerateIfFull === 'function') {
      await window._dndAutoGenerateIfFull();
    }
    // نوع "knockout": الشجرة تُبنى وقت تأكيد المعالج مباشرة — لا توليد لاحق مطلوب هنا
  } catch (err) {
    console.error('[auto-generate] dispatcher error:', err);
    showToast('⚠️ تعذّر توليد المباريات تلقائياً — جرّب تحديث الصفحة، أو استخدم زر التوليد اليدوي', 'error');
  }
};

function _renderForceTeamsGate(total) {
  let gate = document.getElementById('forceTeamsGate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'forceTeamsGate';
    gate.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(5,5,5,.97);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;font-family:Tajawal,Tajawal,sans-serif;opacity:1;transition:opacity .3s';
    document.body.appendChild(gate);
  }
  gate.style.display = 'flex';
  gate.style.opacity = '1';
  const remaining = Math.max(0, total - teams.length);
  const pct = Math.min(100, Math.round((teams.length / total) * 100));
  gate.innerHTML = `
    <div style="max-width:460px;width:100%;text-align:center">
      <div style="font-size:44px;margin-bottom:10px">👥</div>
      <div style="font-size:17px;font-weight:900;color:var(--gold,#C9A02B);margin-bottom:8px">أضف الفرق المشاركة</div>
      <div style="font-size:12px;color:var(--muted,#888);line-height:1.8;margin-bottom:18px">
        حددت <strong style="color:var(--gold2,#f0c84a)">${total}</strong> فريق عند إعداد البطولة.
        أضف بيانات كل فريق الآن — بعدها توزّعهم على المجموعات بضغطة واحدة، وتتولّد المباريات تلقائياً.
      </div>
      <div style="background:var(--card2,#1a1a1a);border:1px solid var(--border2,#2a2a2a);border-radius:14px;padding:16px;margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted,#888);margin-bottom:8px">
          <span>التقدّم</span><span style="color:var(--gold,#C9A02B);font-weight:900">${teams.length} / ${total}</span>
        </div>
        <div style="height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--gold,#C9A02B);border-radius:4px;transition:width .3s"></div>
        </div>
      </div>
      ${teams.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:18px">
        ${teams.map(t => `<span style="font-size:11px;background:var(--card2,#1a1a1a);border:1px solid var(--border2,#2a2a2a);border-radius:20px;padding:5px 12px;color:var(--text,#eee)">${t.name}</span>`).join('')}
      </div>` : ''}
      <button class="btn btn-gold" style="width:100%;padding:14px;font-size:14px;font-weight:900;border-radius:12px" onclick="openModal('modal-team')">+ إضافة فريق (باقي ${remaining})</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// §  نظام لاعبي الفريق (Roster) — يُسجَّل مرة واحدة لكل فريق
//    ويظهر تلقائياً عند بناء تشكيلة أي مباراة لهذا الفريق (زر 📋)
// ═══════════════════════════════════════════════════════════════════
window._teamRosters = window._teamRosters || {}; // teamId → [{id,name,number,position,status}]

// ✅︎ موحّد مع نظام «قائمة اللاعبين» (openRosterModal) — نفس مجموعة roster بالضبط
// بذلك أي لاعب يُضاف من زر 👥 في بطاقة الفريق يظهر فوراً في منتقي التشكيلة
window._loadTeamRoster = async function(teamId, force) {
  if (!teamId) return [];
  if (!force && window._teamRosters[teamId]) return window._teamRosters[teamId];
  try {
    const snap = await getDocs(query(collection(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster'), orderBy('number', 'asc')));
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    window._teamRosters[teamId] = list;
    return list;
  } catch (e) {
    console.error('roster load error', e);
    window._teamRosters[teamId] = window._teamRosters[teamId] || [];
    return window._teamRosters[teamId];
  }
};

// ══ منتقي لاعب موحّد لأحداث المباراة (هدف/بطاقة/تبديل) ══
// المصدر الوحيد: القائمة الدائمة المسجّلة لكل فريق (leagues/{id}/teams/{teamId}/roster)
// — لا يُخلط أبداً بين لاعبي الفريقين، ولا تظهر أسماء من مباريات سابقة.
window._rosterPosLabel = function(posKey) {
  if (!posKey) return '';
  try {
    if (typeof ROSTER_POSITIONS !== 'undefined') {
      const meta = ROSTER_POSITIONS.find(p => p.key === posKey);
      if (meta) return meta.label;
    }
  } catch (e) {}
  return posKey;
};

// ✅︎ أسماء اللاعبين الذين طردوا (بطاقة حمراء) بالفعل في هذه المباراة لهذا الفريق —
// تُستخدم لاستبعادهم تلقائياً من قائمة اختيار الهدافين/الأحداث القادمة (اللاعب المطرود لا يستمر في اللعب).
// يدعم كِلا اسمي الحقل المستخدَمين في المنصة: side (الإدخال السريع) و team (البث المباشر).
window._redCardedNames = function(events, sideOrTeam) {
  const set = new Set();
  (events || []).forEach(e => {
    if (e && e.type === 'red' && e.player && (e.side === sideOrTeam || e.team === sideOrTeam)) set.add(e.player);
  });
  return set;
};

// يبني أزرار اختيار لاعب من قائمة الفريق المسجّلة فقط. الضغط على زر يملأ الحقل باسم اللاعب،
// وإن لم يوجد أي لاعب مسجَّل لهذا الفريق تظهر رسالة توضيحية دون أي اقتراحات (يبقى الإدخال اليدوي متاحاً دائماً).
// excludeNames: أسماء تُستبعد كلياً من القائمة (مثل المطرودين ببطاقة حمراء في هذه المباراة).
// اللاعب المصاب/الموقوف (حالته في القائمة الدائمة) لا يُستبعد بل يبقى ظاهراً بشكل باهت مع أيقونة تنبيه،
// حتى تنتبه له الإدارة قبل الاختيار دون ما تفقد القدرة على اختياره لو كانت الحالة غير دقيقة.
window._renderRosterPickButtons = function(players, inputId, excludeNames) {
  // يقبل Set أو Array أو null — تحويل آمن لتفادي [].has is not a function
  const excl = excludeNames instanceof Set ? excludeNames
    : Array.isArray(excludeNames) ? new Set(excludeNames)
    : new Set();
  const visible = (players || []).filter(p => !excl.has(p.name));
  if (!visible.length) {
    const msg = (players && players.length)
      ? 'كل لاعبي هذا الفريق المسجّلين مطرودون في هذه المباراة — يمكنك كتابة الاسم يدوياً'
      : 'لا يوجد لاعبون مسجلون في قائمة هذا الفريق — يمكنك كتابة الاسم يدوياً';
    return `<div style="font-size:11px;color:var(--muted,#888);padding:2px">${msg}</div>`;
  }
  return visible.map(p => {
    const nm = (p.name || '').replace(/'/g, "\\'");
    const posLabel = window._rosterPosLabel(p.position);
    const numTag = (p.number !== undefined && p.number !== null && p.number !== '') ? ('#' + p.number + ' · ') : '';
    const flagged = p.status === 'injured' || p.status === 'suspended';
    let stMeta = null;
    try { if (typeof ROSTER_STATUS !== 'undefined') stMeta = ROSTER_STATUS[p.status] || null; } catch (e) {}
    const warnIcon = flagged ? ` <span title="${stMeta?.label || ''}">${stMeta?.icon || '⚠️'}</span>` : '';
    const dimStyle = flagged ? 'opacity:.55;border-style:dashed;' : '';
    return `<button type="button" onclick="document.getElementById('${inputId}').value='${nm}'"
      style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 10px;background:var(--card3,#1a1a1a);border:1px solid var(--border2,#2a2a2a);border-radius:9px;color:var(--text,#eee);font-family:Tajawal,sans-serif;cursor:pointer;text-align:right;${dimStyle}">
      <span style="font-size:12px;font-weight:800">${numTag}${p.name || ''}${warnIcon}</span>
      ${posLabel ? `<span style="font-size:9px;color:var(--muted,#888)">${posLabel}${flagged && stMeta ? ' · ' + stMeta.label : ''}</span>` : (flagged && stMeta ? `<span style="font-size:9px;color:var(--muted,#888)">${stMeta.label}</span>` : '')}
    </button>`;
  }).join('');
};

// ══ BOTTOM SHEET للتأكيد — بديل confirm() في الجوال ══
(function injectSheetStyles() {
  if (document.getElementById('_sheetStyles')) return;
  const s = document.createElement('style');
  s.id = '_sheetStyles';
  s.textContent = `
    @keyframes slideUp { from { transform: translateY(100%); opacity:0 } to { transform: translateY(0); opacity:1 } }
    @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
  `;
  document.head.appendChild(s);
})();
function _showDeleteSheet(title, desc, onConfirm, confirmLabel, confirmColor) {
  const old = document.getElementById('_deleteSheet');
  if (old) old.remove();
  const sheet = document.createElement('div');
  sheet.id = '_deleteSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .15s ease';
  const btnColor = confirmColor || '#C0392B';
  const btnLabel = confirmLabel || '🗑 حذف';
  sheet.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px 20px 36px;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px"></div>
      <div style="font-size:18px;font-weight:900;color:var(--text);margin-bottom:8px;font-family:Tajawal,sans-serif">${title}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.7">${desc}</div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('_deleteSheet').remove()"
          style="flex:1;padding:14px;background:var(--card2);border:1px solid var(--border2);border-radius:14px;color:var(--muted);font-size:14px;font-weight:700;font-family:Tajawal,sans-serif;cursor:pointer">
          إلغاء
        </button>
        <button id="_deleteSheetConfirm"
          style="flex:1.5;padding:14px;background:${btnColor};border:none;border-radius:14px;color:#fff;font-size:14px;font-weight:900;font-family:Tajawal,sans-serif;cursor:pointer">
          ${btnLabel}
        </button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
  document.getElementById('_deleteSheetConfirm').addEventListener('click', async () => {
    sheet.remove();
    await onConfirm();
  });
}

window.deleteTeam = async function(id) {
  const team = teams.find(t => t.id === id);
  const name = team?.name || 'هذا الفريق';
  const linked = matches.filter(m => m.homeId === id || m.awayId === id).length;
  _showDeleteSheet(
    `🗑 حذف ${name}`,
    linked > 0 ? `سيتأثر ${linked} ${linked === 1 ? 'مباراة' : 'مباريات'} مرتبطة بهذا الفريق` : 'سيتم حذف الفريق نهائياً',
    async () => {
      try {
        await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', id));
        showToast('تم حذف ' + name, 'error');
      } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
    }
  );
};

window.updateTeamName = async function(id, name) {
  if(!name.trim()) return;
  const old = teams.find(t => t.id === id);
  await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', id), { name: name.trim() }).catch(() => {});
  // مزامنة الاسم في المباريات المرتبطة
  if (old && old.name !== name.trim() && matches.length > 0) {
    const related = matches.filter(m => m.homeId === id || m.awayId === id);
    if (related.length > 0) {
      const batch = writeBatch(db);
      related.forEach(m => {
        const upd = {};
        if (m.homeId === id) upd.homeName = name.trim();
        if (m.awayId === id) upd.awayName = name.trim();
        batch.update(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id), upd);
      });
      batch.commit().catch(() => {});
    }
  }
};

// ══ RENDER MATCHES ══
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
function renderMatches() {
  /* ✅︎ التبويبات: admin-matches-tabs.js يسجّل نفسه في window._amtRender.
     لا نستطيع استبدال window.renderMatches من الخارج لأن الاستدعاءات
     الداخلية محلية (نفس فخ OVERRIDES.md)، فنُفوّض من داخل الدالة. */
  if (typeof window._amtRender === 'function') return window._amtRender();
  const el = document.getElementById('matchesList');
  if(matches.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">⚽</div><div>لا توجد مباريات — أضف مباراة أو استخدم التوليد التلقائي</div></div>`;
    return;
  }

  const grouped = {};
  matches.forEach(m => {
    // ✅︎ مباريات الشجرة تُجمَّع باسم الدور، المباريات العادية بالجولة
    const key = m.isKnockout && m.knockoutRoundName
      ? `🏆 ${m.knockoutRoundName}`
      : `الجولة ${m.round || 1}`;
    if(!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  });

  // ✅︎ ترتيب الجولات تصاعدياً (الجولة 1 أولاً)، والأدوار الإقصائية بعدها
  const entries = Object.entries(grouped).sort((a, b) => {
    const ka = a[0], kb = b[0];
    const ia = ka.startsWith('🏆'), ib = kb.startsWith('🏆');
    if (ia !== ib) return ia ? 1 : -1;               // الجولات قبل الإقصاء
    const na = parseInt(ka.replace(/\D+/g, '')) || 0;
    const nb = parseInt(kb.replace(/\D+/g, '')) || 0;
    return na - nb;
  });

  // ✅︎ داخل الجولة: المباشر أولاً، ثم بانتظار الإعداد/القادمة، ثم المنتهية
  const rank = m => m.status === 'live' ? 0
                 : m.status === 'finished' ? 2 : 1;

  el.innerHTML = entries.map(([round, ms]) => {
    const list = ms.slice().sort((a, b) => rank(a) - rank(b));
    const done = list.filter(m => m.status === 'finished').length;
    const liveN = list.filter(m => m.status === 'live').length;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;margin:16px 0 10px;
      background:linear-gradient(90deg,rgba(201,160,43,.10),transparent);
      border-right:3px solid var(--gold);border-radius:8px">
      <span style="font-size:12px;font-weight:900;color:var(--gold);letter-spacing:.5px">${round}</span>
      ${liveN ? `<span style="font-size:9px;font-weight:900;color:#fff;background:#C0392B;border-radius:20px;padding:2px 7px">🔴 ${liveN} مباشر</span>` : ''}
      <span style="flex:1"></span>
      <span style="font-size:9px;color:var(--muted)">${done}/${list.length} انتهت</span>
    </div>
    ${list.map(m => renderMatchCard(m)).join('')}
  `;}).join('');
}

/* ✅︎ تصدير لـ admin-matches-tabs.js (module-scoped وإلا) */
window.renderMatchCard = renderMatchCard;
window._amtGetMatches  = () => matches;
window._amtGetSettings = () => settings;

function renderMatchCard(m) {
  const homeTeam = teams.find(t => t.id === m.homeId) || { name: m.homeName || 'فريق ؟', logo: m.homeLogo || '⚽' };
  const awayTeam = teams.find(t => t.id === m.awayId) || { name: m.awayName || 'فريق ؟', logo: m.awayLogo || '⚽' };

  // ✅︎ مباراة "معلّقة" تولّدت تلقائياً من المجموعات ولسه ما أُضيفت تفاصيلها — بطاقة مبسّطة مختلفة
  if (m.status === 'pending') {
    const legLabel = m.leg === 2 ? ' · إياب' : m.leg === 1 ? ' · ذهاب' : '';
    return `
<div class="mcv2-card" style="position:relative;background:#0e0e0e;border:1px dashed #3a3320;border-radius:20px;overflow:hidden;margin-bottom:12px">
  <div style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px dashed #2a2410">
    <span style="font-size:9px;color:#8a7a3a;background:rgba(201,160,43,.08);border:1px solid rgba(201,160,43,.2);border-radius:6px;padding:2px 7px">${m.groupName || ''}${legLabel}</span>
    <span style="font-size:10px;font-weight:700;color:#8a7a3a;padding:4px 10px;border-radius:20px;background:rgba(201,160,43,.06)">⚪ غير مفعّلة</span>
  </div>
  <div style="padding:16px;display:flex;align-items:center;gap:10px">
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.03);overflow:hidden;opacity:.7">${logoHtml(homeTeam.logo, 40, 10)}</div>
      <div style="font-size:12px;font-weight:700;color:#999;text-align:center;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${homeTeam.name}</div>
    </div>
    <div style="font-size:13px;font-weight:900;color:#555">VS</div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.03);overflow:hidden;opacity:.7">${logoHtml(awayTeam.logo, 40, 10)}</div>
      <div style="font-size:12px;font-weight:700;color:#999;text-align:center;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${awayTeam.name}</div>
    </div>
  </div>
  <div style="padding:0 14px 14px;display:flex;gap:8px">
    <button onclick="mcv2OpenInfo('${m.id}')" style="flex:1;padding:12px;border-radius:12px;border:1px solid rgba(201,160,43,.35);background:rgba(201,160,43,.1);color:#C9A02B;font-weight:900;font-size:12px;cursor:pointer;font-family:Tajawal,sans-serif">
      ➕︎ إضافة تفاصيل
    </button>
    <button onclick="mcv2OpenQuickResult('${m.id}')" style="flex:1;padding:12px;border-radius:12px;border:1px solid rgba(39,174,96,.3);background:rgba(39,174,96,.08);color:#27ae60;font-weight:900;font-size:12px;cursor:pointer;font-family:Tajawal,sans-serif">
      📝 خلصت؟ سجّل نتيجتها
    </button>
  </div>
  <button onclick="deleteMatch('${m.id}')" title="حذف"
    style="position:absolute;top:10px;left:12px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.2);border-radius:8px;color:#C0392B;font-size:11px;padding:3px 7px;cursor:pointer">🗑</button>
</div>`;
  }

  const isLive  = m.status === 'live';
  const isFin   = m.status === 'finished';
  const isHT    = m.status === 'halftime';
  const isUpcoming = m.status === 'upcoming';
  const _psA = (function(){
    if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) return { h:m.penaltyScoreHome, a:m.penaltyScoreAway };
    const p = m.penalties || (m.liveData && m.liveData.penalties);
    if (p && (Array.isArray(p.home) || Array.isArray(p.away)) && ((p.home||[]).length || (p.away||[]).length)) {
      const g = r => (typeof r === 'string') ? r==='goal' : !!(r && r.result==='goal');
      return { h:(p.home||[]).filter(g).length, a:(p.away||[]).filter(g).length };
    }
    return null;
  })();
  const _drawRaw = isFin && m.homeScore === m.awayScore;
  const homeWin = isFin && (_psA && _drawRaw ? _psA.h > _psA.a : m.homeScore > m.awayScore);
  const awayWin = isFin && (_psA && _drawRaw ? _psA.a > _psA.h : m.awayScore > m.homeScore);
  const isDraw  = _drawRaw && !_psA;

  // ✅︎ الإيقاف المؤقت يظهر على بطاقة الإدارة أيضاً (لا يبقى "مباشر" والوقت واقف)
  const isPaused = isLive && !!(m.liveData && m.liveData.timerPaused);
  const pauseWhy = isPaused ? String(m.liveData.pauseReason || '').replace(/[<>&"']/g, '').trim() : '';
  const statusLabel = isPaused ? (pauseWhy ? '⏸️ ' + pauseWhy : '⏸️ متوقفة')
                    : isLive ? '🔴 مباشر' : isFin ? '✅︎ انتهت' : isHT ? '⏸ استراحة' : '⏳ قادمة';
  const statusCls   = isPaused ? 'mcv2-s-ht' : isLive ? 'mcv2-s-live' : isFin ? 'mcv2-s-fin' : isHT ? 'mcv2-s-ht' : 'mcv2-s-up';
  const cardCls     = isLive ? 'mcv2-live' : isFin ? 'mcv2-finished' : isUpcoming ? 'mcv2-upcoming' : '';

  const scorersLine = [
    m.homeScorers ? homeTeam.name + ': ' + m.homeScorers : '',
    m.awayScorers ? awayTeam.name + ': ' + m.awayScorers : ''
  ].filter(Boolean).join('  ·  ');

  const roundChip = m.isKnockout && m.knockoutRoundName
    ? `<span style="font-size:10px;font-weight:900;color:#9b59b6;background:rgba(155,89,182,.1);border:1px solid rgba(155,89,182,.2);border-radius:6px;padding:2px 7px">🏆 ${m.knockoutRoundName}</span>`
    : `<span style="font-size:10px;font-weight:900;color:#C9A02B;background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.2);border-radius:6px;padding:2px 7px">ج${m.round || '—'}</span>`;

  // عرض معلومات المباراة الإضافية للبطاقات القادمة
  const matchInfo = isUpcoming ? `
    <div style="padding:8px 14px 12px;font-size:10px;color:#5a5a5a;display:flex;flex-wrap:wrap;gap:8px">
      ${m.venue ? `<span>🏟 ${m.venue}</span>` : ''}
      ${m.referee ? `<span>👨‍⚖️ ${m.referee}</span>` : ''}
      ${m.commentator ? `<span>🎙 ${m.commentator}</span>` : ''}
      ${m.date ? `<span style="color:#C9A02B;font-weight:700">📅 ${m.date} · ${formatTimeTo12H(m.time) || '—'}</span>` : ''}
    </div>` : '';

  // عرض ركلات الترجيح إذا كانت موجودة
  const penScoreLine = _psA ? `
    <div style="padding:0 14px 6px;font-size:11px;color:#9b59b6;font-weight:700">
      🥅 ركلات الترجيح: ${_psA.h} - ${_psA.a}
    </div>` : '';

  // تحديد لون الفائز
  const homeColor = homeWin ? '#C9A02B' : awayWin ? '#eee' : isDraw ? '#888' : '#eee';
  const awayColor = awayWin ? '#C9A02B' : homeWin ? '#eee' : isDraw ? '#888' : '#eee';

  // تحديد النتيجة النهائية (تشمل ركلات الترجيح)
  const displayHomeScore = m.homeScore;
  const displayAwayScore = m.awayScore;

  return `
<div class="mcv2-card ${cardCls}" id="mcard_${m.id}" style="position:relative;background:#0e0e0e;border:1px solid ${isLive ? 'rgba(192,57,43,.3)' : '#1f1f1f'};border-radius:20px;overflow:hidden;margin-bottom:12px;box-shadow:${isLive ? '0 0 25px rgba(192,57,43,.1)' : '0 2px 10px rgba(0,0,0,.2)'}">

  <!-- Header -->
  <div style="padding:12px 16px 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a;background:linear-gradient(135deg,#121212,#0e0e0e)">
    <div style="display:flex;align-items:center;gap:8px">
      ${roundChip}
      ${m.groupName ? `<span style="font-size:9px;color:#2980B9;background:rgba(52,152,219,.08);border:1px solid rgba(52,152,219,.2);border-radius:6px;padding:2px 7px">${m.groupName}</span>` : ''}
    </div>
    <span class="${statusCls}" style="font-size:10px;font-weight:700;padding:4px 12px;border-radius:20px">${statusLabel}</span>
  </div>

  <!-- Teams & Score -->
  <div style="padding:16px 16px 12px;display:flex;align-items:center;gap:10px">
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.03);overflow:hidden">${logoHtml(homeTeam.logo, 48, 12)}</div>
      <div style="font-size:13px;font-weight:${homeWin ? '900' : '700'};color:${homeColor};text-align:center;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${homeTeam.name}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:90px">
      ${(isFin || isLive || isHT)
        ? `<div style="font-size:38px;font-weight:900;color:#C9A02B;font-family:Tajawal,sans-serif;line-height:1;white-space:nowrap">${displayHomeScore ?? 0} — ${displayAwayScore ?? 0}</div>`
        : `<div style="font-size:16px;font-weight:900;color:#555;font-family:Tajawal,sans-serif">VS</div>`}
      ${m.venue && !isUpcoming ? `<div style="font-size:9px;color:#3a3a3a;text-align:center;max-width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🏟 ${m.venue}</div>` : ''}
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.03);overflow:hidden">${logoHtml(awayTeam.logo, 48, 12)}</div>
      <div style="font-size:13px;font-weight:${awayWin ? '900' : '700'};color:${awayColor};text-align:center;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${awayTeam.name}</div>
    </div>
  </div>

  ${penScoreLine}
  ${scorersLine ? `<div style="padding:0 14px 10px;font-size:10px;color:#4a4a4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">⚽ ${scorersLine}</div>` : ''}
  ${matchInfo}

  <!-- أزرار الإدارة -->
  <div style="padding:10px 12px 14px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
    <button onclick="mcv2OpenLive('${m.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 3px;border-radius:14px;border:1px solid rgba(192,57,43,${isLive ? '.5' : '.25'});background:rgba(192,57,43,${isLive ? '.15' : '.08'});color:#C0392B;cursor:pointer;font-family:Tajawal,sans-serif;${isLive ? 'animation:mcv2pulse 1.5s infinite' : ''}">
      <span style="font-size:18px">📡</span>
      <span style="font-size:10px;font-weight:700;text-align:center;line-height:1.25">بث<br>مباشر</span>
    </button>
    <button onclick="mcv2OpenQuickResult('${m.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 3px;border-radius:14px;border:1px solid rgba(39,174,96,.25);background:rgba(39,174,96,.08);color:#27ae60;cursor:pointer;font-family:Tajawal,sans-serif">
      <span style="font-size:18px">📝</span>
      <span style="font-size:10px;font-weight:700;text-align:center;line-height:1.25">إدخال<br>سريع</span>
    </button>
    <button onclick="mcv2OpenInfo('${m.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 3px;border-radius:14px;border:1px solid rgba(201,160,43,.25);background:rgba(201,160,43,.08);color:#C9A02B;cursor:pointer;font-family:Tajawal,sans-serif">
      <span style="font-size:18px">⚙︎️</span>
      <span style="font-size:10px;font-weight:700;text-align:center;line-height:1.25">معلومات</span>
    </button>
    <button onclick="mcv2OpenLineup('${m.id}')" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 3px;border-radius:14px;border:1px solid rgba(142,68,173,.25);background:rgba(142,68,173,.08);color:#8e44ad;cursor:pointer;font-family:Tajawal,sans-serif">
      <span style="font-size:18px">🧠</span>
      <span style="font-size:10px;font-weight:700;text-align:center;line-height:1.25">التشكيلات</span>
    </button>
  </div>

  ${isFin ? `<!-- زر التراجع — للمباريات المنتهية فقط -->
  <div style="padding:0 12px 12px">
    <button onclick="mcv2UndoMatch('${m.id}')" style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(230,126,34,.35);background:rgba(230,126,34,.08);color:#e67e22;cursor:pointer;font-family:Tajawal,sans-serif;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px">
      ${window.Icon ? window.Icon('refresh', 14) : ''} تراجع — إرجاع المباراة كأنها لم تُلعب
    </button>
  </div>` : ''}

  <!-- زر الحذف -->
  <button onclick="deleteMatch('${m.id}')" title="حذف المباراة"
    style="position:absolute;top:12px;left:12px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.2);border-radius:8px;color:#C0392B;font-size:12px;padding:4px 8px;cursor:pointer">
    🗑
  </button>

</div>`;
}

// ══ دوال مساعدة لبطاقات المباريات المضغوطة ══

function _renderScorerTags(scorersStr, matchId, side) {
  if (!scorersStr) return '';
  return scorersStr.split(',').map((s, idx) => {
    const name = s.trim(); if (!name) return '';
    const rx = name.match(/^(.+?)\s*(?:\((\d+)\))?$/);
    const dn = rx ? rx[1].trim() : name;
    const g = rx && rx[2] ? ' (' + rx[2] + ')' : '';
    return '<span class="me-scorer-tag">' + dn + g +
      '<button class="me-tag-del" onclick="mcRemoveScorer(\'' + matchId + '\',\'' + side + '\',' + idx + ')" title="حذف">✕</button></span>';
  }).join('');
}

window.mcToggle = function(id) {
  const exp = document.getElementById('mexp_' + id);
  const icon = document.getElementById('mexpi_' + id);
  const sp = document.getElementById('msp_' + id);
  if (!exp) return;
  const isOpen = exp.style.display !== 'none';
  exp.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.textContent = isOpen ? '▼' : '▲';
  if (sp) sp.style.display = isOpen ? '' : 'none';
};

window.mcAdjust = function(id, side, delta) {
  const el = document.getElementById((side === 'home' ? 'hs_' : 'as_') + id);
  if (!el) return;
  el.value = Math.max(0, (parseInt(el.value || '0') || 0) + delta);
  if (delta === 1) {
    const m = matches.find(x => x.id === id);
    const t = side === 'home'
      ? (teams.find(t => t.id === m?.homeId) || { name: m?.homeName || 'الفريق الأول' })
      : (teams.find(t => t.id === m?.awayId) || { name: m?.awayName || 'الفريق الثاني' });
    _openScorerPicker(id, side, t.name, false);
  }
};

window.mcAddScorer = function(matchId, side, teamName) {
  _openScorerPicker(matchId, side, teamName, false);
};

window.mcRemoveScorer = function(matchId, side, idx) {
  const hidId = (side === 'home' ? 'hsc_' : 'asc_') + matchId;
  const hid = document.getElementById(hidId);
  if (!hid) return;
  const parts = hid.value.split(',').map(s => s.trim()).filter(Boolean);
  parts.splice(idx, 1);
  hid.value = parts.join(', ');
  const tagsEl = document.getElementById((side === 'home' ? 'htags_' : 'atags_') + matchId);
  if (tagsEl) tagsEl.innerHTML = _renderScorerTags(hid.value, matchId, side);
};

// ══ نافذة اختيار الهداف (مشتركة بين المباريات والبث) ══
window._openScorerPicker = function(matchId, side, teamName, required) {
  const old = document.getElementById('scorerPickerOverlay');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'scorerPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--gold3);border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:20px 20px 36px;animation:slideUp .25s ease">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:28px;margin-bottom:4px">⚽</div>
        <div style="font-size:15px;font-weight:900;color:var(--gold);font-family:Tajawal,sans-serif">من سجل الهدف؟</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${teamName}</div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input id="scorerPickerInput" class="form-input" placeholder="اكتب اسم اللاعب..." style="flex:1;font-size:14px" autocomplete="off" oninput="_spFilter()" onkeydown="if(event.key==='Enter')_spConfirm('${matchId}','${side}')"/>
        <div style="display:flex;align-items:center;gap:5px;background:var(--card3);border:1px solid var(--border2);border-radius:10px;padding:6px 10px;font-size:11px;color:var(--muted);white-space:nowrap">
          عدد: <input id="scorerPickerCount" type="number" min="1" max="9" value="1" style="width:32px;background:transparent;border:none;color:var(--text);font-size:13px;font-weight:900;text-align:center"/>
        </div>
      </div>
      <div id="scorerPickerSuggestions" style="display:flex;flex-wrap:wrap;gap:6px;min-height:28px;margin-bottom:16px"></div>
      <div style="display:flex;gap:8px">
        ${!required ? '<button onclick="document.getElementById(\'scorerPickerOverlay\').remove()" style="flex:1;padding:13px;background:var(--card3);border:1px solid var(--border2);border-radius:12px;color:var(--muted);font-size:13px;font-family:Tajawal,sans-serif;cursor:pointer">تخطي</button>' : ''}
        <button onclick="_spConfirm('${matchId}','${side}')" style="flex:2;padding:13px;background:linear-gradient(135deg,var(--gold2),var(--gold));border:none;border-radius:12px;color:#000;font-size:13px;font-weight:900;font-family:Tajawal,sans-serif;cursor:pointer">✅︎ تأكيد</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  if (!required) overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  _spLoadSuggestions();
  if (!required) window.bindModalDismiss(overlay);
  setTimeout(() => document.getElementById('scorerPickerInput')?.focus(), 100);
};

let _spAllNames = [];

window._spLoadSuggestions = function() {
  const namesSet = new Set();
  matches.forEach(m => {
    [m.homeScorers, m.awayScorers].forEach(sc => {
      if (!sc) return;
      sc.split(',').forEach(s => {
        const rx = s.trim().match(/^(.+?)(?:\s*\(\d+\))?$/);
        if (rx) namesSet.add(rx[1].trim());
      });
    });
    if (Array.isArray(m.events)) m.events.forEach(ev => { if (ev.player && ev.player !== '—') namesSet.add(ev.player); });
  });
  _spAllNames = [...namesSet].sort();
  _spRenderSuggestions(_spAllNames.slice(0, 10));
};

window._spFilter = function() {
  const q = (document.getElementById('scorerPickerInput')?.value || '').trim().toLowerCase();
  _spRenderSuggestions(q ? _spAllNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8) : _spAllNames.slice(0, 10));
};

window._spRenderSuggestions = function(names) {
  const el = document.getElementById('scorerPickerSuggestions');
  if (!el) return;
  if (!names.length) { el.innerHTML = '<span style="font-size:11px;color:var(--muted)">اكتب الاسم يدوياً</span>'; return; }
  el.innerHTML = names.map(n => `<button onclick="document.getElementById('scorerPickerInput').value='${n.replace(/'/g, "\\'")}'" style="padding:5px 11px;background:var(--card3);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:12px;font-family:Tajawal,sans-serif;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='var(--border2)'">${n}</button>`).join('');
};

window._spConfirm = function(matchId, side) {
  const name = (document.getElementById('scorerPickerInput')?.value || '').trim();
  const count = parseInt(document.getElementById('scorerPickerCount')?.value || '1') || 1;
  document.getElementById('scorerPickerOverlay')?.remove();
  if (!name) return;
  const entry = count > 1 ? name + ' (' + count + ')' : name;

  // ── إذا في callback مسجَّل (من mcv2) استخدمه أولاً ──
  if (typeof window._mcv2_onScorer === 'function') {
    window._mcv2_onScorer(entry);
    window._mcv2_onScorer = null;
  }

  // ── اكتب في حقل mcv2 إدارة النتيجة ──
  const mcv2Field = document.getElementById((side === 'home' ? 'mcv2-hsc-' : 'mcv2-asc-') + matchId);
  if (mcv2Field) {
    mcv2Field.value = mcv2Field.value.trim() ? mcv2Field.value.trim() + ', ' + entry : entry;
  }

  // ── دائماً اكتب في الحقل القديم (hsc_/asc_) للتوافق مع saveMatchResult ──
  const hidId = (side === 'home' ? 'hsc_' : 'asc_') + matchId;
  const hid = document.getElementById(hidId);
  if (hid) {
    hid.value = hid.value.trim() ? hid.value.trim() + ', ' + entry : entry;
    const tagsEl = document.getElementById((side === 'home' ? 'htags_' : 'atags_') + matchId);
    if (tagsEl) tagsEl.innerHTML = _renderScorerTags(hid.value, matchId, side);
  }

  // ── اكتب أيضاً في حقل qe_ (الإدخال السريع) إذا كان ظاهراً ──
  const qeHid = document.getElementById((side === 'home' ? 'qe_hsc_' : 'qe_asc_') + matchId);
  if (qeHid) {
    qeHid.value = qeHid.value.trim() ? qeHid.value.trim() + ', ' + entry : entry;
  }
};

// ══════════════════════════════════════════════
//  QUICK ENTRY — نظام الإدخال السريع المطوّر
//  تصميم موحّد مع صفحة البث + إحصائيات بنظام +/-
// ══════════════════════════════════════════════
let _qeCurrentIdx = 0;

// ── مخزن الإحصائيات للبطاقة السريعة (لا يُفقد عند إعادة الرسم) ──
window._qeStats = window._qeStats || {}; // matchId → { shotsHome, shotsAway, ... }

function getQuickMatches() {
  const live     = matches.filter(m => m.status === 'live');
  const upcoming = matches.filter(m => m.status === 'upcoming');
  const finished = matches.filter(m => m.status === 'finished').slice(-3);
  return [...live, ...upcoming, ...finished];
}

// ── تهيئة إحصائيات من بيانات المباراة عند أول رسم ──
function _qeInitStats(m) {
  if (window._qeStats[m.id]) return; // لا تُعيد التهيئة لو موجودة
  const s = m.stats || {};
  window._qeStats[m.id] = {
    shotsHome:         s.shotsHome         ?? null,
    shotsAway:         s.shotsAway         ?? null,
    shotsOnTargetHome: s.shotsOnTargetHome ?? null,
    shotsOnTargetAway: s.shotsOnTargetAway ?? null,
    cornersHome:       s.cornersHome       ?? null,
    cornersAway:       s.cornersAway       ?? null,
    foulsHome:         s.foulsHome         ?? null,
    foulsAway:         s.foulsAway         ?? null,
    yellowCardsHome:   s.yellowCardsHome   ?? null,
    yellowCardsAway:   s.yellowCardsAway   ?? null,
    redCardsHome:      s.redCardsHome      ?? null,
    redCardsAway:      s.redCardsAway      ?? null,
    offsidesHome:      s.offsidesHome      ?? null,
    offsidesAway:      s.offsidesAway      ?? null,
    tacklesHome:       s.tacklesHome       ?? null,
    tacklesAway:       s.tacklesAway       ?? null,
    possessionHome:    s.possessionHome    ?? null,
    possessionAway:    s.possessionAway    ?? null,
  };
}

// ── زيادة / تخفيض إحصائية في البطاقة السريعة ──
window.qeStatAdj = function(matchId, field, delta) {
  if (!window._qeStats[matchId]) window._qeStats[matchId] = {};
  const st = window._qeStats[matchId];
  const cur = st[field] ?? 0;

  // الاستحواذ: مجموع = 100
  const isPct = field.startsWith('possession');
  if (isPct) {
    const partner = field === 'possessionHome' ? 'possessionAway' : 'possessionHome';
    st[field]   = Math.min(100, Math.max(0, cur + delta));
    st[partner] = 100 - st[field];
    // تحديث العرض للطرفين
    const pEl = document.getElementById('qe_st_possessionHome_' + matchId);
    const aEl = document.getElementById('qe_st_possessionAway_' + matchId);
    if (pEl) pEl.textContent = st['possessionHome'] + '%';
    if (aEl) aEl.textContent = st['possessionAway'] + '%';
    return;
  }

  st[field] = Math.max(0, cur + delta);
  const el = document.getElementById('qe_st_' + field + '_' + matchId);
  if (el) el.textContent = st[field];
};

function renderQuickEntry() {
  const el = document.getElementById('quickMatchEntry');
  if (!el) return;

  const qMatches = getQuickMatches();
  if (!qMatches.length) {
    el.innerHTML = `<div style="text-align:center;padding:28px 20px;color:var(--muted)">
      <div style="font-size:28px;margin-bottom:8px">📅</div>
      <div style="font-size:13px;font-weight:700">لا توجد مباريات</div>
      <div style="font-size:11px;margin-top:4px;color:var(--muted2)">أضف مباريات من قسم المباريات</div>
    </div>`;
    return;
  }

  if (_qeCurrentIdx >= qMatches.length) _qeCurrentIdx = 0;
  const m = qMatches[_qeCurrentIdx];
  _qeInitStats(m);
  const st = window._qeStats[m.id];

  const ht = teams.find(t => t.id === m.homeId) || { name: m.homeName||'؟', logo: m.homeLogo||'⚽' };
  const at = teams.find(t => t.id === m.awayId) || { name: m.awayName||'؟', logo: m.awayLogo||'⚽' };
  const isLive = m.status === 'live';
  const isFin  = m.status === 'finished';

  // ── شريط التنقل ──
  const navHtml = qMatches.length > 1 ? `
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--card3);border-bottom:1px solid var(--border)">
      <button onclick="qeNav(-1)" style="background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center" ${_qeCurrentIdx===0?'disabled':''}>›</button>
      <div style="flex:1;text-align:center;display:flex;gap:5px;justify-content:center;align-items:center">
        ${qMatches.map((mm,i) => `<span onclick="qeGoTo(${i})" style="display:inline-block;width:${i===_qeCurrentIdx?'20px':'7px'};height:7px;border-radius:4px;background:${i===_qeCurrentIdx?'var(--gold)':'var(--border2)'};cursor:pointer;transition:all .25s"></span>`).join('')}
      </div>
      <button onclick="qeNav(1)" style="background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:7px;width:30px;height:30px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center" ${_qeCurrentIdx===qMatches.length-1?'disabled':''}>‹</button>
      <span style="font-size:10px;color:var(--muted);white-space:nowrap;margin-right:4px">${_qeCurrentIdx+1}/${qMatches.length}</span>
    </div>` : '';

  // ── لوحة النتيجة — تصميم البث ──
  const statusBadge = isLive
    ? `<div style="display:flex;align-items:center;gap:5px"><div style="width:7px;height:7px;border-radius:50%;background:#C0392B;animation:qe-pulse 1.5s infinite"></div><span style="font-size:11px;font-weight:900;color:#C0392B">مباشر</span></div>`
    : isFin
      ? `<div style="font-size:11px;font-weight:700;color:var(--green)">✅︎ انتهت</div>`
      : `<div style="font-size:11px;color:var(--muted)">قادمة</div>`;

  const scorePad = `
    <div style="background:linear-gradient(135deg,rgba(201,160,43,.06),transparent);border:1px solid var(--border2);border-radius:16px;padding:16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        ${statusBadge}
        <div style="font-size:10px;color:var(--muted)">ج${m.round||'?'} ${m.date?'· '+m.date:''}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px">
        <div style="text-align:center">
          <div style="font-size:28px;margin-bottom:4px">${logoHtml(ht.logo,36,10)}</div>
          <div style="font-size:12px;font-weight:900;color:var(--text)">${ht.name}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px">
            <button onclick="qeAdjust('${m.id}','home',-1)" style="width:34px;height:34px;border-radius:9px;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.3);color:#C0392B;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
            <input type="number" readonly id="qe_hs_${m.id}" value="${m.homeScore??''}" placeholder="0" min="0" style="width:44px;height:44px;text-align:center;font-size:22px;font-weight:900;font-family:Tajawal,sans-serif;color:var(--gold);background:var(--card2);border:1px solid var(--border2);border-radius:10px"/>
            <button onclick="qeAdjust('${m.id}','home',1)" style="width:34px;height:34px;border-radius:9px;background:rgba(39,174,96,.12);border:1px solid rgba(39,174,96,.35);color:#27ae60;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
          </div>
        </div>
        <div style="text-align:center;padding:0 4px">
          <div style="font-size:28px;font-weight:900;color:var(--muted2)">–</div>
          ${m.time?`<div style="font-size:10px;color:var(--muted);margin-top:4px">${formatTimeTo12H(m.time)}</div>`:''}
        </div>
        <div style="text-align:center">
          <div style="font-size:28px;margin-bottom:4px">${logoHtml(at.logo,36,10)}</div>
          <div style="font-size:12px;font-weight:900;color:var(--text)">${at.name}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px">
            <button onclick="qeAdjust('${m.id}','away',-1)" style="width:34px;height:34px;border-radius:9px;background:rgba(220,50,50,.1);border:1px solid rgba(220,50,50,.3);color:#C0392B;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
            <input type="number" readonly id="qe_as_${m.id}" value="${m.awayScore??''}" placeholder="0" min="0" style="width:44px;height:44px;text-align:center;font-size:22px;font-weight:900;font-family:Tajawal,sans-serif;color:var(--gold);background:var(--card2);border:1px solid var(--border2);border-radius:10px"/>
            <button onclick="qeAdjust('${m.id}','away',1)" style="width:34px;height:34px;border-radius:9px;background:rgba(39,174,96,.12);border:1px solid rgba(39,174,96,.35);color:#27ae60;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
          </div>
        </div>
      </div>
    </div>`;

  // ── الهدافون (مدمج داخل بطاقة) ──
  const scorersHtml = `
    <div style="background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:12px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--muted2);letter-spacing:1px;margin-bottom:10px">📋 سجل الأحداث</div>
      <div id="qe_events_${m.id}">${_qeEventsListHtml(m)}</div>
      <input type="hidden" id="qe_hsc_${m.id}" value="${m.homeScorers||''}"/>
      <input type="hidden" id="qe_asc_${m.id}" value="${m.awayScorers||''}"/>
    </div>`;

  // ── أحداث سريعة (بطاقات + تبديل) ──
  const eventsHtml = `
    <div style="background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:12px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:var(--muted2);letter-spacing:1px;margin-bottom:10px">🟨 بطاقات</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 24px 1fr 1fr;gap:5px;align-items:center">
        <button onclick="qeEvent('${m.id}','yellow','🟨','${ht.name}','home')" style="padding:8px 3px;border-radius:9px;background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.25);color:#D35400;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center">🟨<div style="font-size:9px;margin-top:2px">${ht.name.split(' ')[0]}</div></button>
        <button onclick="qeEvent('${m.id}','red','🟥','${ht.name}','home')" style="padding:8px 3px;border-radius:9px;background:rgba(220,50,50,.08);border:1px solid rgba(220,50,50,.25);color:#C0392B;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center">🟥<div style="font-size:9px;margin-top:2px">${ht.name.split(' ')[0]}</div></button>
        <div style="text-align:center;color:var(--border2);font-size:18px">│</div>
        <button onclick="qeEvent('${m.id}','yellow','🟨','${at.name}','away')" style="padding:8px 3px;border-radius:9px;background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.25);color:#D35400;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center">🟨<div style="font-size:9px;margin-top:2px">${at.name.split(' ')[0]}</div></button>
        <button onclick="qeEvent('${m.id}','red','🟥','${at.name}','away')" style="padding:8px 3px;border-radius:9px;background:rgba(220,50,50,.08);border:1px solid rgba(220,50,50,.25);color:#C0392B;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center">🟥<div style="font-size:9px;margin-top:2px">${at.name.split(' ')[0]}</div></button>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--muted2);letter-spacing:1px;margin:12px 0 8px;display:flex;align-items:center;gap:5px">${window.Icon?window.Icon('refresh',11):''} تبديل</div>
      <div style="display:grid;grid-template-columns:1fr 24px 1fr;gap:5px;align-items:center">
        <button onclick="qeEvent('${m.id}','sub','🔄','${ht.name}','home')" style="padding:9px 3px;border-radius:9px;background:rgba(52,152,219,.08);border:1px solid rgba(52,152,219,.28);color:#3498db;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center;font-weight:700"><span style="display:inline-flex;align-items:center;gap:4px">${window.Icon?window.Icon('refresh',12):''} تبديل</span><div style="font-size:9px;margin-top:2px;color:var(--muted)">${ht.name.split(' ')[0]}</div></button>
        <div style="text-align:center;color:var(--border2);font-size:18px">│</div>
        <button onclick="qeEvent('${m.id}','sub','🔄','${at.name}','away')" style="padding:9px 3px;border-radius:9px;background:rgba(52,152,219,.08);border:1px solid rgba(52,152,219,.28);color:#3498db;font-size:11px;cursor:pointer;font-family:Tajawal,sans-serif;text-align:center;font-weight:700"><span style="display:inline-flex;align-items:center;gap:4px">${window.Icon?window.Icon('refresh',12):''} تبديل</span><div style="font-size:9px;margin-top:2px;color:var(--muted)">${at.name.split(' ')[0]}</div></button>
      </div>
    </div>`;

  // ── الإحصائيات بنظام +/- مطابق لصفحة البث ──
  const STAT_DEFS = [
    { label:'🎯 تسديدات',  hKey:'shotsHome',         aKey:'shotsAway',         pct:false },
    { label:'🥅 على المرمى',hKey:'shotsOnTargetHome', aKey:'shotsOnTargetAway', pct:false },
    { label:'⛳ أركان',     hKey:'cornersHome',        aKey:'cornersAway',       pct:false },
    { label:'⚠️ أخطاء',    hKey:'foulsHome',          aKey:'foulsAway',         pct:false },
    { label:'🟨 صفراء',    hKey:'yellowCardsHome',    aKey:'yellowCardsAway',   pct:false },
    { label:'🟥 حمراء',    hKey:'redCardsHome',       aKey:'redCardsAway',      pct:false },
    { label:'🚩 تسلل',     hKey:'offsidesHome',       aKey:'offsidesAway',      pct:false },
    { label:'🦵 تدخلات',   hKey:'tacklesHome',        aKey:'tacklesAway',       pct:false },
    { label:'⚽ استحواذ',   hKey:'possessionHome',     aKey:'possessionAway',    pct:true  },
  ];

  const statsRows = STAT_DEFS.map(def => {
    const hv = st[def.hKey] ?? 0;
    const av = st[def.aKey] ?? 0;
    const sfx = def.pct ? '%' : '';
    const total = def.pct ? 100 : (hv + av || 1);
    const hPct = def.pct ? hv : Math.round((hv / total) * 100);
    return `
      <div style="display:grid;grid-template-columns:1fr 100px 1fr;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:5px">
          <button onclick="qeStatAdj('${m.id}','${def.hKey}',-1)" style="width:22px;height:22px;border-radius:5px;background:var(--card3);border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
          <span id="qe_st_${def.hKey}_${m.id}" style="font-size:14px;font-weight:900;color:var(--gold);font-family:Tajawal,sans-serif;min-width:28px;text-align:center">${hv}${sfx}</span>
          <button onclick="qeStatAdj('${m.id}','${def.hKey}',1)" style="width:22px;height:22px;border-radius:5px;background:var(--card3);border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
        </div>
        <div style="text-align:center">
          <div style="font-size:9px;color:var(--muted2);margin-bottom:4px">${def.label}</div>
          <div style="height:4px;background:var(--card3);border-radius:2px;position:relative;overflow:hidden">
            <div style="position:absolute;right:0;top:0;height:100%;width:${hPct}%;background:var(--gold);border-radius:2px;transition:width .3s"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-start;gap:5px">
          <button onclick="qeStatAdj('${m.id}','${def.aKey}',-1)" style="width:22px;height:22px;border-radius:5px;background:var(--card3);border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
          <span id="qe_st_${def.aKey}_${m.id}" style="font-size:14px;font-weight:900;color:var(--t2,#aaa);font-family:Tajawal,sans-serif;min-width:28px;text-align:center">${av}${sfx}</span>
          <button onclick="qeStatAdj('${m.id}','${def.aKey}',1)" style="width:22px;height:22px;border-radius:5px;background:var(--card3);border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center">+</button>
        </div>
      </div>`;
  }).join('');

  const statsHtml = `
    <div style="background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:10px;font-weight:700;color:var(--gold);letter-spacing:1px">📊 الإحصائيات</div>
        <div style="display:flex;gap:8px;font-size:10px;font-weight:700;color:var(--muted2)">
          <span>${ht.name}</span><span style="color:var(--border2)">|</span><span>${at.name}</span>
        </div>
      </div>
      ${statsRows}
    </div>`;

  // ── أزرار الإجراءات ──
  const actionsHtml = `
    <div style="display:flex;gap:8px">
      <button class="btn btn-gold" style="flex:1;padding:12px" onclick="qeSave('${m.id}')">💾 حفظ وتحديث الترتيب</button>
      <button onclick="openLivePage('${m.id}')" style="padding:10px 14px;background:rgba(220,50,50,.12);border:1px solid rgba(220,50,50,.4);color:#C0392B;border-radius:10px;font-size:13px;cursor:pointer;font-family:Tajawal,sans-serif;font-weight:700">🔴 بث</button>
      <button onclick="window.openMatchLineup?.('${m.id}') || window.openLineupDragDrop?.('${m.id}')" style="padding:10px 14px;background:rgba(201,160,43,.1);border:1px solid rgba(201,160,43,.3);color:#C9A02B;border-radius:10px;font-size:13px;cursor:pointer;font-family:Tajawal,sans-serif">👥</button>
    </div>`;

  // ── حقن CSS النبض مرة واحدة ──
  if (!document.getElementById('_qe_extra_css')) {
    const s = document.createElement('style');
    s.id = '_qe_extra_css';
    s.textContent = `
      @keyframes qe-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
      #quickMatchEntry input[type=number]::-webkit-inner-spin-button,
      #quickMatchEntry input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
    `;
    document.head.appendChild(s);
  }

  el.innerHTML = navHtml + `<div style="padding:12px">` + scorePad + eventsHtml + scorersHtml + statsHtml + actionsHtml + `</div>`;
}

window.qeNav = function(dir) {
  const qm = getQuickMatches();
  _qeCurrentIdx = Math.max(0, Math.min(qm.length-1, _qeCurrentIdx + dir));
  renderQuickEntry();
};
window.qeGoTo = function(idx) { _qeCurrentIdx = idx; renderQuickEntry(); };

/* ✅︎ §10: النتيجة تُشتق من الأحداث — (+) يفتح نافذة الهدف، (−) يحذف آخر هدف */
window.qeAdjust = function(id, side, delta) {
  const m = matches.find(x => x.id === id);
  if (!m) return;
  const t = side === 'home'
    ? (teams.find(t => t.id === m.homeId) || { name: m.homeName || 'الفريق الأول' })
    : (teams.find(t => t.id === m.awayId) || { name: m.awayName || 'الفريق الثاني' });

  if (delta === 1) {
    // إضافة هدف كحدث مستقل
    return window._qeOpenEventModal(id, 'goal', '⚽', t.name, side);
  }

  // (−) — احذف آخر هدف لهذا الفريق (حدث حقيقي من قاعدة البيانات)
  const evs = Array.isArray(m.events) ? m.events : [];
  let lastIdx = -1;
  evs.forEach((e, i) => { if (e.type === 'goal' && e.side === side) lastIdx = i; });
  if (lastIdx === -1) { showToast('لا توجد أهداف لحذفها', 'error'); return; }
  window.qeDeleteEvent(id, lastIdx);
};

// ══════════════════════════════════════════════════════════════
// §10 — إدخال النتيجة السريع: نظام قائم على الأحداث بالكامل
//   • لا حقول نصية — كل هدف/بطاقة/تبديل = حدث مستقل
//   • الحذف يزيل الحدث من قاعدة البيانات ومن كل الواجهات
// ══════════════════════════════════════════════════════════════
function _qeEventsListHtml(m) {
  const evs = Array.isArray(m.events) ? m.events : [];
  if (!evs.length) {
    return `<div style="text-align:center;padding:14px;color:var(--muted);font-size:11px">
      لا توجد أحداث بعد — استخدم الأزرار بالأسفل لإضافة هدف أو بطاقة
    </div>`;
  }
  return evs.map((e, i) => {
    const label = e.extraMinute ? `${e.minute}+${e.extraMinute}'` : `${e.minute || 0}'`;
    const nameHtml = e.type === 'sub'
      ? `<span style="color:#e05252">${window.Icon?window.Icon('download',10):''} ${e.playerOut || e.player || '؟'}</span> <span style="color:#2ecc71">${window.Icon?window.Icon('upload',10):''} ${e.playerIn || e.player2 || '؟'}</span>`
      : `${e.player || '؟'}`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--border2)">
      <span style="min-width:38px;font-size:11px;font-weight:900;color:var(--gold)">${label}</span>
      <span style="font-size:14px">${e.icon || '•'}</span>
      <span style="flex:1;font-size:11px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${nameHtml}
        <span style="color:var(--muted);font-weight:400"> · ${e.teamName || ''}</span>
      </span>
      <button onclick="qeDeleteEvent('${m.id}',${i})" title="حذف الحدث"
        style="width:26px;height:26px;border-radius:7px;border:1px solid rgba(220,50,50,.3);background:rgba(220,50,50,.08);color:#C0392B;font-size:12px;cursor:pointer">🗑</button>
    </div>`;
  }).join('');
}

/* حذف حدث — يُحذف من قاعدة البيانات وتُعاد النتيجة للحساب من الأحداث */
window.qeDeleteEvent = async function(matchId, idx) {
  const m = matches.find(x => x.id === matchId);
  if (!m || !Array.isArray(m.events)) return;
  const ev = m.events[idx];
  if (!ev) return;

  const evs = m.events.filter((_, i) => i !== idx);
  m.events = evs;

  // إعادة احتساب النتيجة من الأحداث (المصدر الوحيد للحقيقة)
  const recount = side => evs.filter(e => e.type === 'goal' && e.side === side).length;
  m.homeScore = recount('home');
  m.awayScore = recount('away');
  _qeSyncScorerMirrors(m);

  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), {
      events: evs,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      homeScorers: m.homeScorers || '',
      awayScorers: m.awayScorers || '',
      updatedAt: serverTimestamp(),
    });
    _qeRefresh(matchId);
    showToast('🗑 تم حذف الحدث', 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

/* مرايا نصية للتوافق مع الواجهات القديمة (الجمهور/البطاقات) */
function _qeSyncScorerMirrors(m) {
  const names = side => (m.events || [])
    .filter(e => e.type === 'goal' && e.side === side)
    .map(e => e.player || '؟').join(', ');
  m.homeScorers = names('home');
  m.awayScorers = names('away');
}

/* تحديث فوري لكل الواجهات المرتبطة بالمباراة */
function _qeRefresh(matchId) {
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  const list = document.getElementById('qe_events_' + matchId);
  if (list) list.innerHTML = _qeEventsListHtml(m);
  const hs = document.getElementById('qe_hs_' + matchId); if (hs) hs.value = m.homeScore ?? 0;
  const as_ = document.getElementById('qe_as_' + matchId); if (as_) as_.value = m.awayScore ?? 0;
  const h1 = document.getElementById('qe_hsc_' + matchId); if (h1) h1.value = m.homeScorers || '';
  const a1 = document.getElementById('qe_asc_' + matchId); if (a1) a1.value = m.awayScorers || '';
  try { renderMatches && renderMatches(); } catch (e) {}
  try { recalcStandings && recalcStandings(); } catch (e) {}
}

/* نافذة إضافة حدث — نفس فكرة صفحة البث (اسم اللاعب + الدقيقة) */
window._qeOpenEventModal = async function(matchId, type, icon, teamName, side) {
  document.getElementById('qeEvOverlay')?.remove();
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  const teamId = side === 'home' ? m.homeId : m.awayId;
  const titles = { goal: 'تسجيل هدف', own: 'هدف عكسي', yellow: 'بطاقة صفراء', red: 'بطاقة حمراء', sub: 'تبديل' };

  const ov = document.createElement('div');
  ov.id = 'qeEvOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:18px';
  const _isSub = (type === 'sub');
  const _bodyHtml = _isSub
    ? `<div id="qeSubPickerBox">${window._subBuildPickerHtml ? window._subBuildPickerHtml(matchId, side) : ''}</div>`
    : `<div style="font-size:10px;color:var(--muted,#888);margin-bottom:5px">اسم اللاعب</div>
       <input id="qeEvPlayer" placeholder="اكتب أو اختر لاعباً من القائمة بالأسفل"
         style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--border2,#2a2a2a);background:var(--card2,#1a1a1a);color:var(--text,#eee);font-family:Tajawal,sans-serif;font-size:13px;box-sizing:border-box"/>
       <div id="qeEvRosterBox" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
         <span style="font-size:11px;color:var(--muted,#888)">جارِ تحميل قائمة لاعبي ${teamName}...</span>
       </div>`;

  ov.innerHTML = `
    <div style="width:100%;max-width:340px;background:var(--card,#111);border:1px solid var(--border2,#2a2a2a);border-radius:16px;padding:16px;font-family:Tajawal,sans-serif">
      <div style="font-size:15px;font-weight:900;color:var(--gold,#C9A02B);text-align:center;margin-bottom:4px">${icon} ${titles[type] || 'حدث'}</div>
      <div style="font-size:11px;color:var(--muted,#888);text-align:center;margin-bottom:12px">${teamName}</div>

      ${_bodyHtml}

      <div style="font-size:10px;color:var(--muted,#888);margin:10px 0 5px">الدقيقة</div>
      <input id="qeEvMinute" type="number" min="1" max="130" value="1"
        style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--border2,#2a2a2a);background:var(--card2,#1a1a1a);color:var(--text,#eee);font-family:Tajawal,sans-serif;font-size:13px;text-align:center;box-sizing:border-box"/>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button onclick="document.getElementById('qeEvOverlay').remove()"
          style="padding:11px;border-radius:9px;border:1px solid var(--border2,#2a2a2a);background:transparent;color:var(--muted,#888);font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">إلغاء</button>
        <button onclick="qeCommitEvent('${matchId}','${type}','${icon}','${String(teamName).replace(/'/g, "\\'")}','${side}')"
          style="padding:11px;border-radius:9px;border:none;background:var(--gold,#C9A02B);color:#000;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">✅︎ إضافة</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  window.bindModalDismiss(ov);
  if (_isSub) window._subResetSelection && window._subResetSelection();
  else setTimeout(() => document.getElementById('qeEvPlayer')?.focus(), 60);

  // منتقي الروستر (للأحداث غير التبديل فقط)
  if (!_isSub) {
    // ✅︎ لاعبو هذا الفريق فقط من القائمة الدائمة المسجَّلة — بدون أي خلط مع الفريق الآخر
    // ✅︎ ونستبعد من طُرد ببطاقة حمراء بالفعل في هذه المباراة
    const roster = teamId ? await window._loadTeamRoster(teamId) : [];
    const excludeNames = window._redCardedNames(m.events, side);
    const box = document.getElementById('qeEvRosterBox');
    if (box) box.innerHTML = window._renderRosterPickButtons(roster, 'qeEvPlayer', excludeNames);
  }
};

/* تثبيت الحدث في قاعدة البيانات */
window.qeCommitEvent = async function(matchId, type, icon, teamName, side) {
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  const minute = parseInt(document.getElementById('qeEvMinute')?.value) || 1;

  let player, evExtra = {};
  if (type === 'sub') {
    const sel = window._subSelected || { out: '', in: '' };
    const out = (sel.out || '').trim();
    const inp = (sel.in || '').trim();
    if (!out || !inp) { showToast('اختر لاعباً خارجاً ولاعباً داخلاً', 'error'); return; }
    player = out;
    evExtra = { player2: inp, playerOut: out, playerIn: inp };
  } else {
    player = (document.getElementById('qeEvPlayer')?.value || '').trim() || '؟';
  }
  document.getElementById('qeEvOverlay')?.remove();

  const evs = Array.isArray(m.events) ? [...m.events] : [];
  evs.push({ minute, icon, player, teamName, type, side, ...evExtra });
  evs.sort((a, b) => (a.minute || 0) - (b.minute || 0));
  m.events = evs;

  // الأهداف تُحتسب من الأحداث — الهدف العكسي يُحسب للفريق الآخر
  const recount = s => evs.filter(e => e.type === 'goal' && e.side === s).length;
  m.homeScore = recount('home');
  m.awayScore = recount('away');
  _qeSyncScorerMirrors(m);

  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), {
      events: evs,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      homeScorers: m.homeScorers || '',
      awayScorers: m.awayScorers || '',
      updatedAt: serverTimestamp(),
    });
    _qeRefresh(matchId);
    showToast(type === 'sub' ? `🔄 ${evExtra.playerOut} ⇄ ${evExtra.playerIn} · ${teamName}` : `${icon} ${player} · ${teamName}`, 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.qeEvent = async function(matchId, type, icon, teamName, side) {
  const m = matches.find(x=>x.id===matchId);
  if(!m) return;

  // ✅︎ §10: كل الأحداث تمر عبر نافذة موحّدة قائمة على الأحداث (بدل prompt والحقول النصية)
  return window._qeOpenEventModal(matchId, type, icon, teamName, side);
};

window._qeEventLegacy = async function(matchId, type, icon, teamName, side) {
  const m = matches.find(x=>x.id===matchId);
  if(!m) return;

  // لو هدف — استخدم scorer picker بدل prompt
  if (type === 'goal') {
    // أولاً احسب الدقيقة
    const minStr = prompt(`دقيقة الهدف (${teamName}):`, '1');
    if(minStr === null) return;
    const minute = parseInt(minStr) || 1;

    // افتح picker الهداف
    _openScorerPicker(matchId, side, teamName, false);

    // بعد ما يختار الاسم — نبني الحدث
    const origConfirm = window._spConfirm;
    window._spConfirm = async function(mId, s) {
      window._spConfirm = origConfirm; // أعد الأصلية
      const name = (document.getElementById('scorerPickerInput')?.value || '').trim();
      const count = parseInt(document.getElementById('scorerPickerCount')?.value || '1') || 1;
      document.getElementById('scorerPickerOverlay')?.remove();
      const playerName = name || '؟';
      const entry = count > 1 ? playerName + ' (' + count + ')' : playerName;

      const evs = Array.isArray(m.events) ? [...m.events] : [];
      evs.push({ minute, icon, player: playerName, teamName, type: 'goal', side });
      evs.sort((a,b) => (a.minute||0)-(b.minute||0));

      // حدّث النتيجة
      if(side==='home') {
        const sc = (m.homeScore||0)+1;
        m.homeScore = sc;
        const el2 = document.getElementById(`qe_hs_${matchId}`);
        if(el2) el2.value = sc;
      } else {
        const sc = (m.awayScore||0)+1;
        m.awayScore = sc;
        const el2 = document.getElementById(`qe_as_${matchId}`);
        if(el2) el2.value = sc;
      }

      // أضف الاسم لحقل الهدافين
      const scFieldId = side==='home' ? `qe_hsc_${matchId}` : `qe_asc_${matchId}`;
      const scField = document.getElementById(scFieldId);
      if(scField) scField.value = scField.value.trim() ? scField.value.trim() + ', ' + entry : entry;

      // حفظ Firebase
      try {
        await updateDoc(doc(db,'leagues',LEAGUE_ID,'matches',matchId), {
          events: evs, updatedAt: serverTimestamp(),
          ...(side==='home' ? {homeScore: m.homeScore} : {awayScore: m.awayScore}),
        });
        showToast(`⚽ هدف! ${playerName} · ${teamName}`, 'success');
      } catch(e) { showToast('خطأ: '+e.message,'error'); }
    };
    return;
  }

  // بطاقات — prompt عادي
  const minStr = prompt(`دقيقة الحدث (${icon} ${teamName}):`, '1');
  if(minStr === null) return;
  const playerName = prompt(`اسم اللاعب:`,'') ?? '';

  const evs = Array.isArray(m.events) ? [...m.events] : [];
  evs.push({ minute: parseInt(minStr)||1, icon, player: playerName||'؟', teamName, type, side });
  evs.sort((a,b) => (a.minute||0)-(b.minute||0));

  try {
    await updateDoc(doc(db,'leagues',LEAGUE_ID,'matches',matchId), {
      events: evs, updatedAt: serverTimestamp(),
    });
    showToast(`${icon} ${type==='yellow'?'بطاقة صفراء':'بطاقة حمراء'} · ${teamName}`, 'success');
  } catch(e) { showToast('خطأ: '+e.message,'error'); }
};

window.qeSave = async function(id) {
  const hs  = parseInt(document.getElementById(`qe_hs_${id}`)?.value ?? '');
  const as_ = parseInt(document.getElementById(`qe_as_${id}`)?.value ?? '');
  const hsc = document.getElementById(`qe_hsc_${id}`)?.value || '';
  const asc = document.getElementById(`qe_asc_${id}`)?.value || '';
  if (isNaN(hs) || isNaN(as_)) { showToast('أدخل النتيجة أولاً', 'error'); return; }

  // ⛔ مباريات الإقصاء لا تقبل التعادل
  const _koM = matches.find(x => x.id === id);
  if (_koM && _koM.isKnockout && hs === as_) {
    showToast('⛔ مباراة إقصائية لا تنتهي بالتعادل — حدّد الفائز بركلات الترجيح', 'error');
    return;
  }

  // ── اقرأ الإحصائيات من _qeStats (نظام +/-) ──
  const qst = window._qeStats && window._qeStats[id];
  const statsObj = {}; let hasStats = false;
  if (qst) {
    const fields = ['shotsHome','shotsAway','shotsOnTargetHome','shotsOnTargetAway',
                    'cornersHome','cornersAway','foulsHome','foulsAway',
                    'yellowCardsHome','yellowCardsAway','redCardsHome','redCardsAway',
                    'offsidesHome','offsidesAway','tacklesHome','tacklesAway',
                    'possessionHome','possessionAway'];
    fields.forEach(k => {
      if (qst[k] != null) { statsObj[k] = qst[k]; hasStats = true; }
    });
  }

  try {
    const upd = { homeScore:hs, awayScore:as_, homeScorers:hsc, awayScorers:asc, status:'finished', updatedAt:serverTimestamp() };
    if (hasStats) upd.stats = statsObj;
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', id), upd);
    await recalcStandings();
    showToast('✅︎ تم الحفظ وتحديث الترتيب', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.qeToggleLive = async function(id, isLive) {
  // مُستبدَل بـ openLivePage — يوجّه للصفحة الجديدة
  // ✅︎ عبر window: تُطبَّق نسخة league-admin.html (التي تعيد تشغيل العدّاد)
  window.openLivePage(id);
};

// ══ SAVE MATCH ══
window.saveMatchResult = async function(id) {
  const hs = parseInt(document.getElementById('hs_' + id)?.value ?? '');
  const as_ = parseInt(document.getElementById('as_' + id)?.value ?? '');
  const hsc = document.getElementById('hsc_' + id)?.value || '';
  const asc = document.getElementById('asc_' + id)?.value || '';
  const mom = document.getElementById('mom_' + id)?.value || '';
  const ven = document.getElementById('ven_' + id)?.value || '';
  const sum = document.getElementById('sum_' + id)?.value || '';

  // ── جمع الإحصائيات ──
  const statKeys = ['pos','sht','sht_t','cor','foul','pass','ycard','rcard'];
  const statLabels = { pos:'possession', sht:'shots', sht_t:'shotsOnTarget', cor:'corners', foul:'fouls', pass:'passes', ycard:'yellowCards', rcard:'redCards' };
  const statsObj = {};
  let hasStats = false;
  statKeys.forEach(key => {
    const hv = document.getElementById('st_h_' + key + '_' + id)?.value;
    const av = document.getElementById('st_a_' + key + '_' + id)?.value;
    if(hv !== '' && hv != null) { statsObj[statLabels[key] + 'Home'] = parseFloat(hv); hasStats = true; }
    if(av !== '' && av != null) { statsObj[statLabels[key] + 'Away'] = parseFloat(av); hasStats = true; }
  });

  if(isNaN(hs) || isNaN(as_)) { showToast('أدخل النتيجة أولاً', 'error'); return; }

  try {
    const updateData = {
      homeScore: hs, awayScore: as_,
      homeScorers: hsc, awayScorers: asc,
      manOfMatch: mom, venue: ven,
      summary: sum,
      status: 'finished', updatedAt: serverTimestamp()
    };
    if(hasStats) updateData.stats = statsObj;

    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', id), updateData);

    // Recalculate standings from all matches
    await recalcStandings();
    showToast('✅︎ تم حفظ النتيجة وتحديث الترتيب', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.setMatchLive = async function(id, isLive) {
  // مُستبدَل بـ openLivePage
  window.openLivePage(id);
};

window.deleteMatch = async function(id) {
  const m = matches.find(x => x.id === id);
  const ht = teams.find(t => t.id === m?.homeId);
  const at = teams.find(t => t.id === m?.awayId);
  const label = ht && at ? `${ht.name} × ${at.name}` : 'هذه المباراة';
  _showDeleteSheet(
    `🗑 حذف المباراة`,
    label,
    async () => {
      await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', id));
      await recalcStandings();
      showToast('تم حذف المباراة', 'error');
    }
  );
};

// ══ AUTO-CALCULATE STANDINGS ══
async function recalcStandings() {
  const teamMap = {};
  teams.forEach(t => {
    teamMap[t.id] = { id: t.id, name: t.name, logo: t.logo, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  });

  // ── نحسب المباريات المنتهية مع دعم ركلات الترجيح ──
  const finished = matches.filter(m => m.status === 'finished' && 
    (typeof m.homeScore === 'number' || typeof m.penaltyScoreHome === 'number'));
  const WP = settings.winPts || 3, DP = settings.drawPts || 1;

  // Parse scorers
  const goalsMap = {};
  finished.forEach(m => {
    const ht = teamMap[m.homeId], at = teamMap[m.awayId];
    if(!ht || !at) return;

    // ── تخطي حساب النقاط للمباريات في دور الإقصاء إذا كانت تعادل مع ركلات ترجيح ──
    // النقاط تُحسب فقط للمباريات العادية أو إذا كان هناك فائز واضح
    const hs = m.penaltyScoreHome != null ? m.penaltyScoreHome : (typeof m.homeScore === 'number' ? m.homeScore : null);
    const as_ = m.penaltyScoreAway != null ? m.penaltyScoreAway : (typeof m.awayScore === 'number' ? m.awayScore : null);

    if (hs === null || as_ === null) return; // لا نحسب النقاط إذا لم تكن النتيجة مكتملة

    ht.p++; at.p++;
    ht.gf += hs; ht.ga += as_;
    at.gf += as_; at.ga += hs;
    if(hs > as_) { ht.w++; ht.pts += WP; at.l++; }
    else if(hs < as_) { at.w++; at.pts += WP; ht.l++; }
    else { ht.d++; at.d++; ht.pts += DP; at.pts += DP; }

    // Parse scorers string
    const parseScorers = (str, teamId) => {
      if(!str) return;
      str.split(',').forEach(s => {
        const match = s.trim().match(/^(.+?)\s*(?:\((\d+)\))?$/);
        if(match) {
          const name = match[1].trim();
          const goals = parseInt(match[2] || '1');
          if(!goalsMap[name]) goalsMap[name] = { name, teamId, goals: 0 };
          goalsMap[name].goals += goals;
        }
      });
    };
    parseScorers(m.homeScorers, m.homeId);
    parseScorers(m.awayScorers, m.awayId);
  });

  // Batch update teams
  const batch = writeBatch(db);
  Object.values(teamMap).forEach(t => {
    batch.update(doc(db, 'leagues', LEAGUE_ID, 'teams', t.id), {
      p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, pts: t.pts
    });
  });

  // ✅︎ تحديث homeScorers/awayScorers في كل مباراة منتهية إذا كانت فارغة
  // هذا يضمن أن الـ Viewer يقرأها بشكل صحيح من matches[]
  finished.forEach(m => {
    const hasScorers = m.homeScorers || m.awayScorers;
    if (!hasScorers && m.liveData && m.liveData.events && m.liveData.events.length) {
      const buildStr = (side) => {
        const goalMap = {};
        m.liveData.events.forEach(ev => {
          if (ev.type !== 'goal' || ev.team !== side) return;
          const name = (ev.player || '').trim();
          if (!name || name === '—' || name === '؟') return;
          goalMap[name] = (goalMap[name] || 0) + 1;
        });
        return Object.entries(goalMap)
          .map(([n, g]) => g > 1 ? `${n} (${g})` : n).join(', ');
      };
      const hs = buildStr('home'), as_ = buildStr('away');
      if (hs || as_) {
        batch.update(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id), {
          homeScorers: hs, awayScorers: as_
        });
      }
    }
  });

  // Save scorers to dedicated collection (للاستخدام المستقبلي)
  const scorersColl = collection(db, 'leagues', LEAGUE_ID, 'scorers');
  const snapS = await getDocs(scorersColl);
  snapS.forEach(d => batch.delete(d.ref));
  Object.values(goalsMap).forEach(s => {
    batch.set(doc(scorersColl), s);
  });

  await batch.commit();
}

// ══ RENDER STANDINGS ══
function getZoneColor(pos) {
  let acc = 0;
  for(let i = 0; i < ZONE_KEYS.length; i++) {
    const cnt = settings.zones?.[ZONE_KEYS[i]] || 0;
    if(pos >= acc && pos < acc + cnt) return ZONE_COLORS[i];
    acc += cnt;
  }
  return '#888';
}

function renderStandings() {
  const d1 = document.getElementById('dashStandings');
  const d2 = document.getElementById('fullStandings');

  // ✅︎ جدول الترتيب العام خاص بنظام "دوري نقاط" فقط.
  //    خارج الدوري: القسم محذوف تماماً — لا تنبيه ولا رسالة مكانه.
  const type = (window.settings && window.settings.type) || 'league';
  if (type !== 'league') {
    if (d1) d1.innerHTML = '';
    if (d2) d2.innerHTML = '';
    // إخفاء الحاويات نفسها حتى لا يبقى إطار فارغ
    document.getElementById('dashStandingsCard')?.style.setProperty('display', 'none');
    document.getElementById('page-standings')?.style.setProperty('display', 'none');
    const legEl0 = document.getElementById('zoneLegend');
    if (legEl0) legEl0.innerHTML = '';
    return;
  }

  const sorted = [...teams].sort((a, b) => {
    if(b.pts !== a.pts) return b.pts - a.pts;
    return (b.gf - b.ga) - (a.gf - a.ga);
  });

  const html = `
    <div class="sp-row sp-header" style="grid-template-columns:28px 1fr 30px 30px 30px 30px 30px 38px">
      <span class="sp-pos" style="color:var(--gold);font-size:9px">#</span>
      <span class="sp-team" style="font-size:9px;color:var(--gold)">الفريق</span>
      <span class="sp-val" style="color:var(--gold);font-size:9px">ل</span>
      <span class="sp-val" style="color:var(--gold);font-size:9px">ف</span>
      <span class="sp-val" style="color:var(--gold);font-size:9px">ت</span>
      <span class="sp-val" style="color:var(--gold);font-size:9px">خ</span>
      <span class="sp-val" style="color:var(--gold);font-size:9px">±</span>
      <span class="sp-pts" style="color:var(--gold);font-size:9px">ن</span>
    </div>
    ${sorted.map((t, i) => {
      const zc = getZoneColor(i);
      const gd = t.gf - t.ga;
      return `<div class="sp-row" style="grid-template-columns:28px 1fr 30px 30px 30px 30px 30px 38px;border-right:3px solid ${zc}">
        <span class="sp-pos" style="color:${zc}">${i + 1}</span>
        <span class="sp-team"><span class="sp-logo">${logoHtml(t.logo, 16, 4)}</span><span style="font-size:12px;font-weight:700">${t.name}</span></span>
        <span class="sp-val">${t.p || 0}</span>
        <span class="sp-val" style="color:var(--green)">${t.w || 0}</span>
        <span class="sp-val">${t.d || 0}</span>
        <span class="sp-val" style="color:var(--red)">${t.l || 0}</span>
        <span class="sp-val" style="color:${gd > 0 ? 'var(--green)' : gd < 0 ? 'var(--red)' : '#888'}">${gd > 0 ? '+' + gd : gd}</span>
        <span class="sp-pts" style="color:${zc}">${t.pts || 0}</span>
      </div>`;
    }).join('')}`;

  if(d1) d1.innerHTML = html;
  if(d2) d2.innerHTML = html;

  // Zone legend
  const legEl = document.getElementById('zoneLegend');
  if(legEl) {
    legEl.innerHTML = ZONE_KEYS.map((k, i) => {
      if((settings.zones?.[k] || 0) === 0) return '';
      return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted)">
        <div style="width:10px;height:10px;border-radius:2px;background:${ZONE_COLORS[i]}"></div>${ZONE_NAMES[i]}
      </div>`;
    }).join('');
  }
}
// ✅︎ تصدير — استدعاءات admin.js تمر عبر window ليُطبَّق override في all-fixes.js
window.renderStandings = renderStandings;

// ══ RENDER SCORERS ══
function renderScorers() {
  const el = document.getElementById('scorersList');
  // Build scorers from matches
  const goalsMap = {};
  matches.filter(m => m.status === 'finished').forEach(m => {
    const parseS = (str, teamId, teamName, teamLogo) => {
      if(!str) return;
      str.split(',').forEach(s => {
        const match = s.trim().match(/^(.+?)\s*(?:\((\d+)\))?$/);
        if(match) {
          const name = match[1].trim();
          const goals = parseInt(match[2] || '1');
          if(!goalsMap[name]) { const t = teams.find(t => t.id === teamId); goalsMap[name] = { name, teamName: t?.name || teamName, teamLogo: t?.logo || teamLogo, goals: 0 }; }
          goalsMap[name].goals += goals;
        }
      });
    };
    parseS(m.homeScorers, m.homeId, m.homeName, m.homeLogo);
    parseS(m.awayScorers, m.awayId, m.awayName, m.awayLogo);
  });

  const sorted = Object.values(goalsMap).sort((a, b) => b.goals - a.goals);
  if(sorted.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="e-icon">⚽</div><div>لا توجد أهداف مسجلة بعد</div></div>`;
    return;
  }
  el.innerHTML = sorted.slice(0, 10).map((s, i) => `
    <div class="card" style="margin-bottom:10px;${i === 0 ? 'border-color:var(--gold);background:linear-gradient(135deg,#141000,var(--card))' : ''}">
      <div class="card-body" style="display:flex;align-items:center;gap:14px">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;background:${i === 0 ? 'linear-gradient(135deg,var(--gold2),var(--gold3))' : i === 1 ? '#333' : i === 2 ? '#2a1a0a' : 'var(--card2)'};color:${i === 0 ? '#000' : i === 1 ? '#ccc' : i === 2 ? '#b87333' : '#555'}">${i + 1}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${s.name}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${logoHtml(s.teamLogo, 14, 3)} ${s.teamName || '—'}</div>
          ${i === 0 ? '<span style="font-size:9px;background:#141000;border:1px solid var(--gold3);color:var(--gold);padding:1px 7px;border-radius:4px;margin-top:5px;display:inline-block">الهداف الأول 🏆</span>' : ''}
        </div>
        <div style="text-align:center">
          <div style="font-size:26px;font-weight:900;font-family:Tajawal,sans-serif;color:${i === 0 ? 'var(--gold)' : i === 1 ? '#ccc' : i === 2 ? '#b87333' : '#888'}">${s.goals}</div>
          <div style="font-size:9px;color:var(--muted)">هدف</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ══ RENDER CARDS ══
function renderCards() {
  // لو cards-system.js محمّل، استخدم النسخة الجديدة
  if (window._cardsSystemLoaded) return window._renderCardsNew();
  const el = document.getElementById('cardsList');
  const lastMatch = matches.filter(m => m.status === 'finished').pop();
  const nextMatch = matches.find(m => m.status === 'upcoming' || m.status === 'live');

  // حساب الهداف الأول من نتائج المباريات
  const goalsMap = {};
  matches.filter(m => m.status === 'finished').forEach(m => {
    const parseS = (str, teamId, teamName, teamLogo) => {
      if(!str) return;
      str.split(',').forEach(p => {
        const name = p.trim().split('(')[0].trim();
        if(!name) return;
        const t = teams.find(t => t.id === teamId);
        if(!goalsMap[name]) goalsMap[name] = { name, teamName: t?.name||teamName, teamLogo: t?.logo||teamLogo, goals: 0 };
        goalsMap[name].goals++;
      });
    };
    parseS(m.homeScorers, m.homeId, m.homeName, m.homeLogo);
    parseS(m.awayScorers, m.awayId, m.awayName, m.awayLogo);
  });
  const topScorer = Object.values(goalsMap).sort((a,b)=>b.goals-a.goals)[0];

  el.innerHTML = [
    {
      icon: '🟡', label: 'بطاقة قبل المباراة',
      sub: nextMatch ? `${(teams.find(t=>t.id===nextMatch.homeId)||{name:'?'}).name} × ${(teams.find(t=>t.id===nextMatch.awayId)||{name:'?'}).name}` : 'لا توجد مباريات قادمة',
      action: 'generatePreMatchCard()'
    },
    {
      icon: '🟢', label: 'بطاقة بعد المباراة',
      sub: lastMatch ? `${(teams.find(t=>t.id===lastMatch.homeId)||{name:'؟'}).name} ${lastMatch.homeScore} - ${lastMatch.awayScore} ${(teams.find(t=>t.id===lastMatch.awayId)||{name:'؟'}).name}` : 'لا توجد نتائج بعد',
      action: 'generatePostMatchCard()'
    },
    {
      icon: '🔵', label: 'بطاقة جدول الترتيب',
      sub: 'الترتيب الحالي',
      action: 'shareStandings()'
    },
    {
      icon: '⚽', label: 'بطاقة الهدافين',
      sub: topScorer ? `الهداف: ${topScorer.name} (${topScorer.goals} أهداف)` : 'أدخل نتائج أولاً',
      action: 'generateScorersCard()'
    },
  ].map(c => `
    <div class="card" style="cursor:pointer;margin-bottom:10px" onclick="${c.action}">
      <div class="card-body" style="display:flex;align-items:center;gap:14px">
        <div style="width:50px;height:50px;background:var(--card3);border-radius:12px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border2)">${_ic(c.icon,24)}</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:700">${c.label}</div><div style="font-size:10px;color:var(--muted);margin-top:3px">${c.sub}</div></div>
        <button class="btn btn-outline btn-sm">توليد</button>
      </div>
    </div>
  `).join('');
}

// ══ CARD GENERATION FUNCTIONS ══

function drawCardBase(ctx, W, H, title, subtitle) {
  // خلفية
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);
  // إطار ذهبي
  ctx.strokeStyle = '#C9A02B';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W-20, H-20);
  // عنوان
  ctx.fillStyle = '#C9A02B';
  ctx.font = 'bold 26px Tajawal, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(title, W/2, 52);
  if(subtitle) {
    ctx.fillStyle = '#888';
    ctx.font = '13px Tajawal, Arial';
    ctx.fillText(subtitle, W/2, 74);
  }
  // فوتر
  ctx.fillStyle = '#444';
  ctx.font = '11px Tajawal, Arial';
  ctx.fillText('منصة بطولات', W/2, H-14);
}

function downloadCanvas(canvas, name) {
  canvas.toBlob(blob => {
    if(navigator.share && navigator.canShare && navigator.canShare({files:[new File([blob],name+'.png',{type:'image/png'})]})) {
      navigator.share({ title: name, files: [new File([blob], name+'.png', {type:'image/png'})] }).catch(()=>{});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.png';
      a.click();
    }
  }, 'image/png');
}

function loadImg(src) {
  return new Promise(resolve => {
    if(!src || src.length < 5 || (!src.startsWith('data:') && !src.startsWith('http'))) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

window.generatePreMatchCard = async function() {
  const nextMatch = matches.find(m => m.status === 'upcoming' || m.status === 'live');
  if(!nextMatch) { showToast('لا توجد مباريات قادمة', 'error'); return; }
  const ht = teams.find(t=>t.id===nextMatch.homeId) || { name: nextMatch.homeName||'؟', logo: nextMatch.homeLogo||'' };
  const at = teams.find(t=>t.id===nextMatch.awayId) || { name: nextMatch.awayName||'؟', logo: nextMatch.awayLogo||'' };
  
  const canvas = document.createElement('canvas');
  const W=900, H=540; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');
  
  // خلفية أنيقة
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0a0a0a');
  grad.addColorStop(1, '#050505');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  
  // إطار ذهبي
  ctx.strokeStyle = '#C9A02B';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, W-28, H-28);
  
  // عنوان البطولة
  ctx.fillStyle = '#C9A02B';
  ctx.font = 'bold 28px Tajawal, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(league?.name || 'منصة البطولات', W/2, 42);
  
  ctx.fillStyle = '#666';
  ctx.font = '14px Tajawal, Arial';
  ctx.fillText('بطاقة قبل المباراة الرسمية', W/2, 68);
  
  // شعارات الفرق
  const [hImg, aImg] = await Promise.all([loadImg(ht.logo), loadImg(at.logo)]);
  const logoSize = 100;
  
  if(hImg) ctx.drawImage(hImg, W/4-logoSize/2, 95, logoSize, logoSize);
  else { ctx.font='70px Arial'; ctx.textAlign='center'; ctx.fillText(ht.logo||'⚽', W/4, 165); }
  ctx.fillStyle='#fff'; ctx.font='bold 20px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText(ht.name, W/4, 220);
  
  ctx.fillStyle='#C9A02B'; ctx.font='bold 44px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText('VS', W/2, 190);
  
  if(aImg) ctx.drawImage(aImg, 3*W/4-logoSize/2, 95, logoSize, logoSize);
  else { ctx.font='70px Arial'; ctx.textAlign='center'; ctx.fillText(at.logo||'⚽', 3*W/4, 165); }
  ctx.fillStyle='#fff'; ctx.font='bold 20px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText(at.name, 3*W/4, 220);
  
  // الفاصل
  ctx.strokeStyle='rgba(201,160,43,.2)';
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(60, 250);
  ctx.lineTo(W-60, 250);
  ctx.stroke();
  
  // التفاصيل الكاملة
  const details = [
    nextMatch.date ? '📅 ' + nextMatch.date : '',
    nextMatch.time ? '⏰ ' + formatTimeTo12H(nextMatch.time) : '',
    nextMatch.venue ? '🏟 ' + nextMatch.venue : '',
    nextMatch.referee ? '👨‍⚷ ' + nextMatch.referee : '',
    nextMatch.commentator ? '🎙 ' + nextMatch.commentator : ''
  ].filter(Boolean);
  
  if(details.length) {
    ctx.fillStyle='#888'; ctx.font='14px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText(details.join('  |  '), W/2, 280);
  }
  
  // الجولة
  ctx.fillStyle='#C9A02B'; ctx.font='bold 16px Tajawal, Arial';
  ctx.fillText('الجولة ' + (nextMatch.round||' — '), W/2, 315);
  
  // الفوتر
  ctx.fillStyle='#444'; ctx.font='12px Tajawal, Arial';
  ctx.fillText('🌐 منصة البطولات الرسمية', W/2, H-25);
  
  downloadCanvas(canvas, 'pre-match-' + ht.name + '-vs-' + at.name);
  showToast('✅︎ تم توليد بطاقة قبل المباراة', 'success');
};

window.generatePostMatchCard = async function() {
  const lastMatch = matches.filter(m => m.status === 'finished').pop();
  if(!lastMatch) { showToast('لا توجد نتائج بعد', 'error'); return; }
  const ht = teams.find(t=>t.id===lastMatch.homeId) || { name: lastMatch.homeName||'؟', logo: lastMatch.homeLogo||'' };
  const at = teams.find(t=>t.id===lastMatch.awayId) || { name: lastMatch.awayName||'؟', logo: lastMatch.awayLogo||'' };
  const hw = lastMatch.homeScore > lastMatch.awayScore;
  const aw = lastMatch.awayScore > lastMatch.homeScore;
  const isDraw = lastMatch.homeScore === lastMatch.awayScore;
  
  // ── النتيجة النهائية (تشمل ركلات الترجيح إذا كانت موجودة) ──
  const finalHs = lastMatch.penaltyScoreHome != null && isDraw 
    ? lastMatch.penaltyScoreHome : lastMatch.homeScore;
  const finalAs = lastMatch.penaltyScoreAway != null && isDraw 
    ? lastMatch.penaltyScoreAway : lastMatch.awayScore;
  const finalWinner = hw ? ht.name : aw ? at.name : null;
  
  const canvas = document.createElement('canvas');
  const W=900, H=540; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');
  
  // خلفية مميزة
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0a0a0a');
  grad.addColorStop(1, '#050505');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  
  // إطار ذهبي أنيق
  ctx.strokeStyle = '#C9A02B';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, W-28, H-28);
  
  // عنوان البطولة
  ctx.fillStyle = '#C9A02B';
  ctx.font = 'bold 28px Tajawal, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(league?.name || 'منصة البطولات', W/2, 42);
  
  ctx.fillStyle = '#666';
  ctx.font = '14px Tajawal, Arial';
  ctx.fillText('بطاقة نتيجة مباراة رسمية', W/2, 68);
  
  // شعارات الفرق
  const [hImg, aImg] = await Promise.all([loadImg(ht.logo), loadImg(at.logo)]);
  const logoSize = 100;
  
  // الفريق الأول
  if(hImg) ctx.drawImage(hImg, W/4-logoSize/2, 95, logoSize, logoSize);
  else { ctx.font='70px Arial'; ctx.textAlign='center'; ctx.fillText(ht.logo||'⚽', W/4, 165); }
  ctx.fillStyle = hw ? '#C9A02B' : '#fff';
  ctx.font = 'bold 20px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText(ht.name, W/4, 220);
  
  // النتيجة الكبيرة
  ctx.fillStyle='#fff'; ctx.font='bold 64px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText(finalHs + ' - ' + finalAs, W/2, 195);
  
  // ركلات الترجيح تحت النتيجة
  if(lastMatch.penaltyScoreHome != null && isDraw) {
    ctx.fillStyle='#9b59b6'; ctx.font='bold 16px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText('(ركلات الترجيح: ' + lastMatch.penaltyScoreHome + '-' + lastMatch.penaltyScoreAway + ')', W/2, 230);
  }
  
  // الفريق الثاني
  if(aImg) ctx.drawImage(aImg, 3*W/4-logoSize/2, 95, logoSize, logoSize);
  else { ctx.font='70px Arial'; ctx.textAlign='center'; ctx.fillText(at.logo||'⚽', 3*W/4, 165); }
  ctx.fillStyle = aw ? '#C9A02B' : (isDraw ? '#888' : '#fff');
  ctx.font = 'bold 20px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText(at.name, 3*W/4, 220);
  
  // الفائز
  const winnerY = 260;
  if(finalWinner) {
    ctx.fillStyle='#C9A02B'; ctx.font='bold 20px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText('🏆 الفائز: ' + finalWinner, W/2, winnerY);
  } else {
    ctx.fillStyle='#888'; ctx.font='bold 18px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText('🤝 تعادل', W/2, winnerY);
  }
  
  // الفواصل
  ctx.strokeStyle='rgba(201,160,43,.2)';
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(60, winnerY+25);
  ctx.lineTo(W-60, winnerY+25);
  ctx.stroke();
  
  // التفاصيل
  const details = [
    lastMatch.venue ? '🏟 ' + lastMatch.venue : '',
    lastMatch.referee ? '👨‍⚷ ' + lastMatch.referee : '',
    lastMatch.date ? '📅 ' + lastMatch.date + ' · ' + (formatTimeTo12H(lastMatch.time)||'') : '',
    lastMatch.commentator ? '🎙 ' + lastMatch.commentator : ''
  ].filter(Boolean);
  
  if(details.length) {
    ctx.fillStyle='#888'; ctx.font='13px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText(details.join('  |  '), W/2, winnerY+50);
  }
  
  // الهدافون
  const scorersText = [lastMatch.homeScorers, lastMatch.awayScorers].filter(Boolean).join('  |  ');
  if(scorersText) {
    ctx.fillStyle='#aaa'; ctx.font='12px Tajawal, Arial'; ctx.textAlign='center';
    ctx.fillText('⚽ الهدافون: ' + scorersText, W/2, winnerY+75);
  }
  
  // الجولة
  ctx.fillStyle='#555'; ctx.font='13px Tajawal, Arial'; ctx.textAlign='center';
  ctx.fillText('الجولة ' + (lastMatch.round||' — '), W/2, winnerY+100);
  
  // الفوتر
  ctx.fillStyle='#444'; ctx.font='12px Tajawal, Arial';
  ctx.fillText('🌐 منصة البطولات الرسمية', W/2, H-25);
  
  downloadCanvas(canvas, 'result-' + ht.name + '-vs-' + at.name);
  showToast('✅︎ تم توليد بطاقة بعد المباراة', 'success');
};

window.generateScorersCard = function() {
  const goalsMap = {};
  matches.filter(m => m.status === 'finished').forEach(m => {
    const parseS = (str, teamId, teamName) => {
      if(!str) return;
      str.split(',').forEach(p => {
        const name = p.trim().split('(')[0].trim();
        if(!name) return;
        const t = teams.find(t => t.id === teamId);
        if(!goalsMap[name]) goalsMap[name] = { name, teamName: t?.name||teamName, goals: 0 };
        goalsMap[name].goals++;
      });
    };
    parseS(m.homeScorers, m.homeId, m.homeName);
    parseS(m.awayScorers, m.awayId, m.awayName);
  });
  const sorted = Object.values(goalsMap).sort((a,b)=>b.goals-a.goals).slice(0,8);
  if(sorted.length === 0) { showToast('لا توجد أهداف بعد', 'error'); return; }

  const canvas = document.createElement('canvas');
  const W=800, H=Math.max(500, 120 + sorted.length*56 + 40);
  canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');
  drawCardBase(ctx, W, H, league?.name || 'منصة بطولات', 'قائمة الهدافين');

  sorted.forEach((s, i) => {
    const y = 100 + i*56;
    ctx.fillStyle = i%2===0 ? '#111' : '#0d0d0d';
    ctx.fillRect(30, y, W-60, 50);
    // الترتيب
    ctx.fillStyle = i===0 ? '#C9A02B' : '#888';
    ctx.font = 'bold ' + (i===0?'22':'18') + 'px Tajawal, Arial';
    ctx.textAlign = 'left';
    ctx.fillText(i+1, 50, y+32);
    // الاسم
    ctx.fillStyle = '#f2f2f2';
    ctx.font = (i===0 ? 'bold ' : '') + '16px Tajawal, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(s.name, W-100, y+22);
    ctx.fillStyle = '#888';
    ctx.font = '12px Tajawal, Arial';
    ctx.fillText(s.teamName, W-100, y+40);
    // الأهداف
    ctx.fillStyle = '#C9A02B';
    ctx.font = 'bold 22px Tajawal, Arial';
    ctx.textAlign = 'left';
    ctx.fillText(s.goals + ' ⚽', 80, y+32);
  });

  downloadCanvas(canvas, 'scorers-' + (league?.name||'league'));
  showToast('✅︎ تم توليد بطاقة الهدافين', 'success');
};

// ══ ADD MATCH ══
function populateMatchSelects() {
  ['matchHome', 'matchAway'].forEach(id => {
    const sel = document.getElementById(id);
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = teams.map(t => {
     const logoText = (t.logo && !t.logo.startsWith('data:') && !t.logo.startsWith('http')) ? t.logo : '';
     return `<option value="${t.id}">${logoText ? logoText + ' ' : ''}${t.name}</option>`;
   }).join('');
    if(prev) sel.value = prev;
  });
}

window.addMatch = async function() {
  const homeId = document.getElementById('matchHome')?.value;
  const awayId = document.getElementById('matchAway')?.value;

  // ✅︎ تنبيهات واضحة ومحدّدة — كل خطأ له رسالته الخاصة
  if (!homeId && !awayId) { showToast('⚠️ اختر الفريقين أولاً', 'error'); return; }
  if (!homeId) { showToast('⚠️ اختر الفريق الأول (المضيف)', 'error'); return; }
  if (!awayId) { showToast('⚠️ اختر الفريق الثاني (الضيف)', 'error'); return; }
  if (homeId === awayId) {
    const t = teams.find(x => x.id === homeId);
    showToast(`🚫 لا يمكن إنشاء مباراة بين «${t?.name || 'الفريق'}» ونفسه — اختر فريقين مختلفين`, 'error');
    return;
  }

  const homeTeam = teams.find(t => t.id === homeId);
  const awayTeam = teams.find(t => t.id === awayId);
  const date = document.getElementById('matchDate')?.value;
  const time = document.getElementById('matchTime')?.value || '16:00';
  const venue = document.getElementById('matchVenue')?.value || 'ملعب الحارة';
  const round = parseInt(document.getElementById('matchRound')?.value || '1');

  // ✅︎ رقم الجولة يُحسب رياضياً من عدد الفرق ونظام الذهاب/الإياب — لا يُختار بحرية.
  // فريق زوجي: جولات = n-1 · فردي: جولات = n · ذهاب وإياب: × 2 (نفس صيغة groups-gate.js)
  if (round < 1) { showToast('⚠️ رقم الجولة يجب أن يكون 1 أو أكثر', 'error'); return; }
  if (typeof window.gtRoundsFor === 'function') {
    const legMode = (settings && settings.legMode) || 'single';
    let poolSize = null;
    if (settings?.type === 'groups') {
      const g = (window.adminGroups || []).find(x => (x.teamIds || []).includes(homeId));
      if (g) poolSize = (g.teamIds || []).length;
    } else if (settings?.type === 'league') {
      poolSize = teams.length;
    }
    if (poolSize != null) {
      const maxRounds = window.gtRoundsFor(poolSize, legMode);
      if (maxRounds && round > maxRounds) {
        showToast(`⚠️ عدد جولات ${settings?.type === 'groups' ? 'هذه المجموعة' : 'البطولة'} ${maxRounds} فقط (${poolSize} فرق · ${legMode === 'double' ? 'ذهاب وإياب' : 'ذهاب فقط'}) — لا توجد جولة ${round}`, 'error');
        return;
      }
    }
  }

  // ✅︎ تنبيه على المباراة المكررة (نفس الفريقين في نفس الجولة) — مع السماح بالمتابعة
  /* ✅︎ حارس المجموعات — منع باتّ لمباراة بين فريقين من مجموعتين مختلفتين.
     في نظام المجموعات، فرق المجموعة A لا تلعب ضد فرق المجموعة B إطلاقاً
     في دور المجموعات — الالتقاء يكون في الإقصاء فقط. هذا خطأ بنيوي
     يفسد جدول الترتيب، فنرفضه رفضاً تاماً لا مجرد تحذير. */
  if (settings?.type === 'groups') {
    const G = window.adminGroups || [];
    const gOf = id => G.find(g => (g.teamIds || []).includes(id));
    const gh = gOf(homeId), ga = gOf(awayId);
    if (gh && ga && gh.id !== ga.id) {
      showToast(`❌︎ «${homeTeam?.name}» في المجموعة ${gh.name} و«${awayTeam?.name}» في المجموعة ${ga.name} — لا يلتقيان في دور المجموعات`, 'error');
      return;
    }
    if (!gh || !ga) {
      const miss = !gh ? homeTeam?.name : awayTeam?.name;
      showToast(`❌︎ «${miss}» غير موزّع على أي مجموعة — وزّعه أولاً من صفحة المجموعات`, 'error');
      return;
    }
  }

  /* ✅︎ فحص التكرار عبر البطولة كلها — لا داخل الجولة فقط.
     كان يفحص نفس الجولة فقط، فيمرّ «أ ضد ب» في الجولة 1 ثم مرة أخرى
     في الجولة 2 بصمت. وفي نظام ذهاب فقط الفريقان يلتقيان مرة واحدة
     في البطولة كلها — والتكرار يفسد جدول الترتيب.
     الحد المسموح: 1 للذهاب فقط · 2 للذهاب والإياب. */
  const _legDbl = ((settings && settings.legMode) || 'single') === 'double';
  const _maxMeet = _legDbl ? 2 : 1;
  const _prev = matches.filter(m => !m.isKnockout &&
    ((m.homeId === homeId && m.awayId === awayId) || (m.homeId === awayId && m.awayId === homeId)));

  // ✅︎ dup: علم يسجّل إذا كانت هذه مباراة مكررة أصلاً (حتى لا نكرّر
  // نفس التحذير مرتين — كان المتغيّر يُستخدم بالأسفل بدون تعريف
  // (ReferenceError) فيوقف الدالة بصمت ولا تُحفظ المباراة إطلاقاً.
  const dup = _prev.length >= _maxMeet;
  if (dup) {
    const rs = _prev.map(m => 'الجولة ' + (m.round || 1)).join(' و');
    const ok = await window.confirmDialog({
      title: 'مباراة مكررة',
      message: `«${homeTeam?.name}» و«${awayTeam?.name}» بينهما ${_prev.length} مباراة بالفعل (${rs}).\n\n` +
               `نظام البطولة «${_legDbl ? 'ذهاب وإياب' : 'ذهاب فقط'}» يسمح بـ ${_maxMeet} ` +
               `${_maxMeet === 1 ? 'مباراة واحدة' : 'مباراتين'} بينهما.\n\n` +
               `إنشاء مباراة إضافية سيُفسد جدول الترتيب. متأكد؟`,
      confirmText: 'أنشئها رغم ذلك', danger: true
    });
    if (!ok) return;
  }

  // ✅︎ تنبيه لو الفريق يلعب مباراتين في نفس الجولة
  const busy = matches.find(m => !m.isKnockout && (m.round || 1) === round &&
    [m.homeId, m.awayId].some(id => id === homeId || id === awayId));
  if (busy && !dup) {
    const clash = [homeId, awayId].find(id => id === busy.homeId || id === busy.awayId);
    const ct = teams.find(t => t.id === clash);
    const ok = await window.confirmDialog({
      title: '⚠️ تعارض في الجولة',
      message: `«${ct?.name || 'أحد الفرق'}» له مباراة أخرى في الجولة ${round}.\nهل تريد المتابعة؟`,
      confirmText: 'متابعة', danger: false
    });
    if (!ok) return;
  }

  // حقول إضافية
  const referee = document.getElementById('matchReferee')?.value.trim() || '';
  const commentator = document.getElementById('matchCommentator')?.value.trim() || '';
  const linesman1 = document.getElementById('matchLinesman1')?.value.trim() || '';
  const linesman2 = document.getElementById('matchLinesman2')?.value.trim() || '';
  const sponsor = document.getElementById('matchSponsor')?.value.trim() || '';
  const photographer = document.getElementById('matchPhotographer')?.value.trim() || '';
  const announcer = document.getElementById('matchAnnouncer')?.value.trim() || '';
  const attendance = document.getElementById('matchAttendance')?.value || '';
  const notes = document.getElementById('matchNotes')?.value.trim() || '';
  // ✅︎ اربط المباراة بمعرّف المجموعة — نفس ما يفعله التوليد التلقائي،
  // وإلا فحذف/إعادة توليد مباريات مجموعة معيّنة لا يراها لأنها بلا groupId
  const _groupId = (settings?.type === 'groups')
    ? ((window.adminGroups || []).find(g => (g.teamIds || []).includes(homeId))?.id || null)
    : null;

  try {
    await addDoc(collection(db, 'leagues', LEAGUE_ID, 'matches'), {
      homeId, awayId,
      homeName: homeTeam?.name, awayName: awayTeam?.name,
      homeLogo: homeTeam?.logo, awayLogo: awayTeam?.logo,
      homeScore: null, awayScore: null,
      date, time, venue, round,
      ...(_groupId ? { groupId: _groupId } : {}),
      referee, commentator, linesman1, linesman2,
      sponsor, photographer, announcer, attendance, notes,
      status: 'upcoming', createdAt: serverTimestamp()
    });
    closeModal('modal-match');
    // إعادة تعيين الحقول الإضافية
    ['matchReferee','matchCommentator','matchLinesman1','matchLinesman2','matchSponsor','matchPhotographer','matchAnnouncer','matchAttendance','matchNotes'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    showToast('تمت إضافة المباراة ✓', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ══ AUTO SCHEDULE ══
window.autoSchedule = async function() {
  if(teams.length < 2) { showToast('أضف فريقين على الأقل أولاً', 'error'); return; }
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: `توليد جدول المباريات تلقائياً لـ ${teams.length} فرق؟`, confirmText: 'تأكيد', danger: false }))) return;

  const today = new Date();
  const batch = writeBatch(db);
  let matchDay = new Date(today);
  let round = 1;
  let matchCount = 0;

  // Round-robin — كل جولة تحتوي على مباريات متعددة في نفس اليوم
  const n = teams.length;
  // نبني جولات round-robin صحيحة
  // عدد الجولات = n-1 (عدد زوجي) أو n (عدد فردي)
  const rounds = [];
  const teamList = teams.map((t, i) => i); // indices

  // خوارزمية round-robin القياسية
  const numRounds = n % 2 === 0 ? n - 1 : n;
  const half = Math.floor(n / 2);
  const rotating = teamList.slice(1); // نثبت الأول ونُدير الباقين

  for(let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    const fixed = teamList[0];
    const rotated = rotating.slice();
    // تدوير بمقدار r
    for(let rot = 0; rot < r; rot++) {
      rotated.unshift(rotated.pop());
    }

    // تشكيل أزواج الجولة
    if(n % 2 === 0) {
      roundMatches.push([fixed, rotated[rotated.length - 1]]);
      for(let p = 0; p < half - 1; p++) {
        roundMatches.push([rotated[p], rotated[rotated.length - 2 - p]]);
      }
    } else {
      // عدد فردي — نتجاهل الفريق الأول (استراحة)
      for(let p = 0; p < half; p++) {
        roundMatches.push([rotated[p], rotated[rotated.length - 1 - p]]);
      }
    }
    rounds.push(roundMatches);
  }

  // كتابة المباريات في Firestore
  rounds.forEach((roundMatches, rIdx) => {
    roundMatches.forEach(([iA, iB]) => {
      const ref = doc(collection(db, 'leagues', LEAGUE_ID, 'matches'));
      batch.set(ref, {
        homeId: teams[iA].id, awayId: teams[iB].id,
        homeName: teams[iA].name, awayName: teams[iB].name,
        homeLogo: teams[iA].logo, awayLogo: teams[iB].logo,
        homeScore: null, awayScore: null,
        date: new Date(today.getTime() + rIdx * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        time: '16:00', venue: 'ملعب الحارة', round: rIdx + 1,
        status: 'upcoming', createdAt: serverTimestamp()
      });
      matchCount++;
    });
  });

  await batch.commit();
  showToast(`✅︎ تم توليد ${rounds.length} جولة — ${matchCount} مباراة`, 'success');
};

// ══ SETTINGS ══
// ══ TIEBREAK UI ══
const TIEBREAK_LABELS = {
  h2h:  { label: '⚔️ المواجهات المباشرة', desc: 'النتيجة بين الفريقين' },
  gd:   { label: '± فارق الأهداف',        desc: 'مسجلة – مستقبلة' },
  gf:   { label: '⚽ الأهداف المسجلة',    desc: 'إجمالي الأهداف' },
  draw: { label: '🎲 القرعة',             desc: 'عشوائي (آخر حل)' }
};

function renderTiebreakUI() {
  const container = document.getElementById('tiebreakList');
  if (!container) return;
  const order = settings.tiebreakOrder || ['h2h','gd','gf','draw'];
  container.innerHTML = order.map((key, i) => {
    const info = TIEBREAK_LABELS[key] || { label: key, desc: '' };
    return `<div class="tb-item" data-key="${key}" style="display:flex;align-items:center;gap:10px;background:var(--card2);border:1px solid var(--border2);border-radius:10px;padding:10px 12px;cursor:grab;user-select:none">
      <div style="font-size:16px;color:var(--muted);flex-shrink:0">☰</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${info.label}</div>
        <div style="font-size:10px;color:var(--muted2)">${info.desc}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${i > 0 ? `<button onclick="moveTbItem('${key}',-1)" style="background:var(--card3);border:1px solid var(--border2);border-radius:5px;width:24px;height:22px;cursor:pointer;font-size:11px;color:var(--text)">↑</button>` : '<div style="width:24px;height:22px"></div>'}
        ${i < order.length - 1 ? `<button onclick="moveTbItem('${key}',1)" style="background:var(--card3);border:1px solid var(--border2);border-radius:5px;width:24px;height:22px;cursor:pointer;font-size:11px;color:var(--text)">↓</button>` : '<div style="width:24px;height:22px"></div>'}
      </div>
    </div>`;
  }).join('');
}

window.moveTbItem = function(key, dir) {
  const order = settings.tiebreakOrder || ['h2h','gd','gf','draw'];
  const idx = order.indexOf(key);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  settings.tiebreakOrder = order;
  renderTiebreakUI();
};

window.saveSettings = async function() {
  const name = document.getElementById('setName')?.value.trim();
  const season = document.getElementById('setSeason')?.value;
  const rounds = parseInt(document.getElementById('setRounds')?.value || 10);
  const winPts = parseInt(document.getElementById('setWinPts')?.value || 3);
  const drawPts = parseInt(document.getElementById('setDrawPts')?.value || 1);
  const defaultVenue = document.getElementById('setVenue')?.value.trim() || '';

  // ✅︎ إعدادات المباراة من مستوى البطولة (موحّدة بالكامل: الشوطين + الاستراحة + الوقت الإضافي)
  const matchSettings = {
    half1Duration: parseInt(document.getElementById('setHalf1Dur')?.value || 45),
    half2Duration: parseInt(document.getElementById('setHalf2Dur')?.value || 45),
    breakDuration: parseInt(document.getElementById('setBreakDur')?.value || 15),
    et1Duration:   parseInt(document.getElementById('setET1Dur')?.value || 15),
    et2Duration:   parseInt(document.getElementById('setET2Dur')?.value || 15),
    hasExtraTime: document.querySelector('.toggle-row[data-key="hasExtraTime"] .toggle-switch')?.classList.contains('on') !== false,
    hasPenalties: document.querySelector('.toggle-row[data-key="hasPenalties"] .toggle-switch')?.classList.contains('on') !== false,
  };

  const toggles = {};
  document.querySelectorAll('.toggle-row[data-key]').forEach(row => {
    const key = row.dataset.key;
    if(!['hasExtraTime','hasPenalties'].includes(key))
      toggles[key] = row.querySelector('.toggle-switch').classList.contains('on');
  });

  // ✅︎ حفظ ترتيب الحسم عند التساوي
  const tiebreakOrder = [];
  document.querySelectorAll('#tiebreakList .tb-item').forEach(item => {
    tiebreakOrder.push(item.dataset.key);
  });
  settings.tiebreakOrder = tiebreakOrder.length ? tiebreakOrder : ['h2h','gd','gf','draw'];

  try {
    if(name) await updateDoc(doc(db, 'leagues', LEAGUE_ID), { name, season, updatedAt: serverTimestamp() });
    // النوع محفوظ كما هو — لا يُعدَّل
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), {
      rounds, winPts, drawPts, matchSettings, ...toggles,
      type: settings.type || 'league',
      typeLocked: true,
      zones: settings.zones,
      tiebreakOrder: settings.tiebreakOrder,
      defaultVenue,
      updatedAt: serverTimestamp()
    }, { merge: true });
    settings.winPts = winPts; settings.drawPts = drawPts;
    settings.matchSettings = matchSettings;
    settings.defaultVenue = defaultVenue;
    showToast('تم حفظ الإعدادات ✓', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── حفظ الراعي في config/settings ──
window._spPersist = async function(sponsor) {
  const LID = window._getLeagueId ? window._getLeagueId() : '';
  if (!LID) throw new Error('لا توجد بطولة');
  await setDoc(doc(db, 'leagues', LID, 'config', 'settings'),
    { sponsor, updatedAt: serverTimestamp() }, { merge: true });
  settings.sponsor = sponsor;
  window.settings = settings;
};

window.saveZones = async function() {
  const zones = {};
  ZONE_KEYS.forEach(k => { zones[k] = parseInt(document.getElementById('z_' + k)?.value || 0); });
  settings.zones = zones;
  try {
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), { zones, updatedAt: serverTimestamp() }, { merge: true });
    window.renderStandings();
    showToast('تم حفظ المناطق ✓', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.updateZoneTotal = function() {
  const total = ZONE_KEYS.reduce((s, k) => s + parseInt(document.getElementById('z_' + k)?.value || 0), 0);
  const el = document.getElementById('zoneTotal');
  if(el) { el.textContent = total + ' / ' + teams.length; el.style.color = total === teams.length ? 'var(--green)' : 'var(--red)'; }
};

window.setSquadSize = async function(n) {
  settings.squadSize = n;
  [5,6,7,8,9,10,11].forEach(k => {
    document.getElementById('setSquad'+k)?.classList.toggle('selected', k === n);
  });
  try {
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), { squadSize: n, updatedAt: serverTimestamp() }, { merge: true });
    showToast(`✅︎ نظام التشكيلة: ${n} لاعبين — يطبَّق على كل المباريات`, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.setLegMode = async function(mode) {
  settings.legMode = mode;
  document.getElementById('setLegSingle')?.classList.toggle('selected', mode === 'single');
  document.getElementById('setLegDouble')?.classList.toggle('selected', mode === 'double');
  try {
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), { legMode: mode, updatedAt: serverTimestamp() }, { merge: true });
    showToast(mode === 'double' ? '✅︎ المباريات القادمة: ذهاب وإياب' : '✅︎ المباريات القادمة: ذهاب فقط', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.updateMatchDurPreview = function() {
  const h1 = parseInt(document.getElementById('setHalf1Dur')?.value || 45);
  const h2 = parseInt(document.getElementById('setHalf2Dur')?.value || 45);
  const br = parseInt(document.getElementById('setBreakDur')?.value || 15);
  const prev = document.getElementById('matchDurPreview');
  if(prev) prev.textContent = 'المباراة: ' + (h1 + br + h2) + ' دقيقة';
};

/* ✅︎ نشر جماعي — بدل تفعيل 8 مباريات واحدة واحدة.
   يحوّل المباريات المعلّقة (pending) إلى قادمة (upcoming) دفعة واحدة،
   فتظهر للجمهور فوراً. المنظّم يضيف التاريخ لاحقاً وقت ما يشاء. */
window.publishPendingMatches = async function (roundNum) {
  const all = window.matches || [];
  let pend = all.filter(m => m.status === 'pending' && !m.isKnockout);
  if (roundNum != null) pend = pend.filter(m => (m.round || 1) === roundNum);

  if (!pend.length) {
    showToast(roundNum != null ? 'لا مباريات معلّقة في هذه الجولة' : 'لا مباريات معلّقة', 'error');
    return;
  }

  const label = roundNum != null ? `الجولة ${roundNum}` : 'كل الجولات';
  if (!(await window.confirmDialog({
    title: 'نشر المباريات للجمهور',
    message: `سيتم نشر ${pend.length} مباراة (${label}) لتظهر للجمهور كمباريات قادمة.\n\nتقدر تضيف التاريخ والملعب لكل مباراة لاحقاً.`,
    confirmText: 'نشر الآن',
    danger: false
  }))) return;

  try {
    for (let i = 0; i < pend.length; i += 400) {
      const b = writeBatch(db);
      pend.slice(i, i + 400).forEach(m =>
        b.update(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id), { status: 'upcoming' }));
      await b.commit();
    }
    showToast(`تم نشر ${pend.length} مباراة — ظهرت للجمهور`, 'success');
  } catch (e) {
    showToast('خطأ في النشر: ' + e.message, 'error');
  }
};

// ══ DANGER ZONE ══

/* ✅︎ مسح كل المباريات — يعيد المنظّم لنقطة الصفر بلا حذف الفرق.
   يحذف مستندات المباريات على دفعات (حد Firestore: 500/دفعة)،
   ويصفّر matchesGenerated حتى يعمل التوليد التلقائي من جديد. */
window.clearAllMatches = async function () {
  const all = window.matches || [];
  if (!all.length) { showToast('لا توجد مباريات لحذفها', 'error'); return; }

  const grp = all.filter(m => !m.isKnockout).length;
  const ko  = all.length - grp;
  const det = [grp ? `${grp} مباراة مجموعات/دوري` : '', ko ? `${ko} مباراة إقصاء` : '']
                .filter(Boolean).join(' · ');

  if (!(await window.confirmDialog({
    title: 'مسح كل المباريات',
    message: `سيتم حذف ${all.length} مباراة نهائياً (${det}) مع كل نتائجها وأحداثها.\n\nالفرق والمجموعات لن تُحذف.\n\nلا يمكن التراجع.`,
    confirmText: 'مسح الكل',
    danger: true
  }))) return;

  try {
    for (let i = 0; i < all.length; i += 400) {
      const b = writeBatch(db);
      all.slice(i, i + 400).forEach(m =>
        b.delete(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id)));
      await b.commit();
    }
    // صفّر أعلام التوليد ليعمل التوليد التلقائي مجدداً
    const gs = window.adminGroups || [];
    if (gs.length) {
      const b2 = writeBatch(db);
      gs.forEach(g => b2.update(doc(db, 'leagues', LEAGUE_ID, 'groups', g.id),
                                { matchesGenerated: false }));
      await b2.commit();
    }
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), { matchesCount: 0 }).catch(() => {});
    showToast(`تم حذف ${all.length} مباراة — يمكنك التوليد من جديد`, 'success');
  } catch (e) {
    showToast('خطأ في الحذف: ' + e.message, 'error');
  }
};

window.closeLeague = async function() {
  _showDeleteSheet(
    '🔒 إغلاق البطولة',
    'سيتم تحويل البطولة لأرشيف للعرض فقط — لا يمكن التراجع',
    async () => {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID), { status: 'archived', updatedAt: serverTimestamp() });
      showToast('تم إغلاق البطولة — أرشيف', 'error');
    },
    '🔒 إغلاق نهائياً',
    '#C0392B'
  );
};

window.resetStandings = async function() {
  _showDeleteSheet(
    '🔄 إعادة تعيين الترتيب',
    'سيتم حذف جميع النتائج وإعادة الترتيب من الصفر — لا يمكن التراجع',
    async () => {
      const batch = writeBatch(db);
      matches.forEach(m => { batch.update(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id), { homeScore: null, awayScore: null, status: 'upcoming' }); });
      teams.forEach(t => { batch.update(doc(db, 'leagues', LEAGUE_ID, 'teams', t.id), { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }); });
      await batch.commit();
      showToast('تم إعادة الضبط', 'error');
    },
    '🔄 إعادة الضبط',
    '#C0392B'
  );
};

// ══════════════════════════════════════════════════════════════
// §13 — منطقة الحذر: إعادة ضبط البطولة + مسح جميع البيانات
// ══════════════════════════════════════════════════════════════

/* حذف كل مستندات مجموعة فرعية على دفعات */
async function _dzWipeCollection(colName) {
  const snap = await getDocs(collection(db, 'leagues', LEAGUE_ID, colName));
  const ids = snap.docs.map(d => d.id);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, 'leagues', LEAGUE_ID, colName, id)));
    await batch.commit();
  }
  return ids.length;
}

/* 🔄 إعادة ضبط البطولة — ترجع لنقطة البداية: شاشة اختيار النوع + معالج الإنشاء */
window.resetTournament = async function() {
  _showDeleteSheet(
    '🔄 إعادة ضبط البطولة بالكامل',
    'سيتم حذف جميع الفرق والمباريات والمجموعات وشجرة الإقصاء والأحداث، وتُفتح البطولة من جديد بمعالج الإنشاء (اختيار نوع البطولة). لا يمكن التراجع.',
    async () => {
      try {
        showToast('⏳ جاري إعادة الضبط...', 'success');
        for (const c of ['matches', 'teams', 'groups', 'knockout', 'events']) {
          await _dzWipeCollection(c).catch(() => {});
        }
        // فتح القفل — يعود المعالج للظهور عند الدخول
        await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'),
          { typeLocked: false, type: null, setupComplete: false, updatedAt: serverTimestamp() },
          { merge: true });
        await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
          typeLocked: false, type: null, matchesCount: 0, totalGoals: 0, updatedAt: serverTimestamp()
        }).catch(() => {});
        showToast('✅︎ تمت إعادة الضبط — إعادة التشغيل', 'success');
        setTimeout(() => location.reload(), 900);
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
    },
    '🔄 إعادة الضبط بالكامل',
    '#C0392B'
  );
};

/* 🗑 مسح جميع البيانات — يبقي البطولة ونوعها، ويحذف المحتوى فقط */
window.wipeAllData = async function() {
  _showDeleteSheet(
    '🗑 مسح جميع البيانات',
    'سيتم حذف جميع الفرق والمباريات والأحداث والإحصائيات مع الإبقاء على نوع البطولة وإعداداتها. لا يمكن التراجع.',
    async () => {
      try {
        showToast('⏳ جاري المسح...', 'success');
        for (const c of ['matches', 'teams', 'events']) {
          await _dzWipeCollection(c).catch(() => {});
        }
        await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
          matchesCount: 0, totalGoals: 0, updatedAt: serverTimestamp()
        }).catch(() => {});
        showToast('✅︎ تم مسح جميع البيانات', 'success');
        setTimeout(() => location.reload(), 900);
      } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
    },
    '🗑 مسح كل شيء',
    '#C0392B'
  );
};

// ══════════════════════════════════════════════════════════════
// 🪟 نظام النوافذ الموحّد — كل نافذة تُغلق بثلاث طرق دائماً:
//    1. زر الإغلاق/إلغاء   2. الضغط على الخلفية   3. مفتاح Escape
//    ولا تبقى معلّقة أبداً حتى لو فشل الحفظ.
// ══════════════════════════════════════════════════════════════
window._modalIds = window._modalIds || [
  'mcv2-info-ov', 'mcv2-qr-ov', 'bracketPickSheet', 'gaOverlay',
  'scorerPickerOverlay', 'qeEvOverlay', 'qrGoalOv', 'lpPauseOv', 'confirmDlgOv'
];

/* أغلق أعلى نافذة مفتوحة (تُستخدم مع Escape) */
window.closeTopModal = function () {
  // نغلق آخر نافذة أُضيفت للـ DOM (الأعلى بصرياً)
  const open = window._modalIds
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!open.length) return false;
  open[open.length - 1].remove();
  return true;
};

/* اربط الإغلاق بالخلفية + Escape لأي نافذة overlay */
window.bindModalDismiss = function (overlayEl, onClose) {
  if (!overlayEl) return;
  // الضغط على الخلفية نفسها (وليس على المحتوى)
  overlayEl.addEventListener('mousedown', function (e) {
    if (e.target === overlayEl) {
      if (typeof onClose === 'function') onClose();
      else overlayEl.remove();
    }
  });
};

/* Escape عام — يغلق أعلى نافذة مفتوحة */
if (!window._escBound) {
  window._escBound = true;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeTopModal();
  });
}

/* ══ نافذة تأكيد موحّدة — بديل confirm() القبيح، تُغلق بالخلفية وEscape ══
   الاستخدام:  if (await confirmDialog({title, message, confirmText, danger})) { ... } */
window.confirmDialog = function (opts) {
  const o = opts || {};
  return new Promise(resolve => {
    document.getElementById('confirmDlgOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'confirmDlgOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px';
    const color = o.danger === false ? '#C9A02B' : '#C0392B';
    ov.innerHTML = `
      <div style="width:100%;max-width:340px;background:var(--card,#111);border:1px solid ${color}44;border-radius:16px;padding:18px;font-family:Tajawal,sans-serif">
        <div style="font-size:15px;font-weight:900;color:${color};text-align:center;margin-bottom:8px">${o.title || 'تأكيد'}</div>
        <div style="font-size:12px;color:var(--muted2,#aaa);text-align:center;line-height:1.8;white-space:pre-line;margin-bottom:16px">${o.message || ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button id="cdCancel" style="padding:12px;border-radius:10px;border:1px solid var(--border2,#2a2a2a);background:transparent;color:var(--muted,#888);font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">${o.cancelText || 'إلغاء'}</button>
          <button id="cdOk" style="padding:12px;border-radius:10px;border:none;background:${color};color:#fff;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">${o.confirmText || 'تأكيد'}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const done = v => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      if (e.key === 'Enter')  { e.stopPropagation(); done(true); }
    }
    ov.querySelector('#cdOk').onclick = () => done(true);
    ov.querySelector('#cdCancel').onclick = () => done(false);
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(false); });
    document.addEventListener('keydown', onKey, true);
  });
};

// ══ SHARE ══
window.shareStandings = function() {
   const url = SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID;
   const text = `🏆 ${league?.name || 'البطولة'}\n\nتابع البطولة لحظة بلحظة 👇\nكل النتائج والترتيب والهدافون والبث المباشر في مكان واحد.\n\nاضغط الرابط وتابع كل التفاصيل مجاناً:\n🔗 ${url}`;
   window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
 };

window.shareViaWA = function() {
  const url = SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID;
  window.open('https://wa.me/?text=' + encodeURIComponent(`🏆 ${league?.name || 'الدوري'}\n🌐 ${url}`), '_blank');
};

window.copyViewerLink = function() {
  const url = SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID;
  if(navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('تم نسخ الرابط 📋', 'success')).catch(() => prompt('انسخ الرابط:', url));
  } else {
    prompt('انسخ الرابط:', url);
  }
};

window.openViewer = function() { window.open(SITE_URL + 'league-viewer.html?id=' + LEAGUE_ID, '_blank'); };

// ══ HELPERS ══
window.selectType = function(el, type) {
  if (type === 'groups') {
    // Show groups setup wizard instead of direct switch
    openGroupsWizard(el);
    return;
  }
  if (type === 'knockout') {
    // Show knockout bracket setup wizard
    openKnockoutWizard(el);
    return;
  }
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  settings.type = type;
  const notes = { league: '✅︎ جدول الترتيب الكامل يظهر للجمهور', groups: '🔷 مجموعات منفصلة + شجرة الإقصاء', knockout: '⚡ شجرة البطولة تتحدث بعد كل نتيجة' };
  const el2 = document.getElementById('typeNote'); if(el2) el2.textContent = notes[type] || '';
};

// ══ GROUPS SETUP WIZARD ══
window.openGroupsWizard = function(typeCardEl) {
  // inject wizard modal if not present
  if (!document.getElementById('modal-groups-wizard')) {
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'modal-groups-wizard';
    m.innerHTML = `
      <div class="modal" style="max-width:500px;width:95%">
        <div class="modal-header">
          <div class="modal-title">🔷 إعداد نظام المجموعات</div>
          <button class="modal-close" onclick="closeModal('modal-groups-wizard')">✕</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.7">
            حدد إعدادات المجموعات — ستُنشأ تلقائياً وتستطيع بعدها إضافة الفرق لكل مجموعة
          </div>

          <div class="form-group">
            <label class="form-label">عدد المجموعات</label>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wizGroupCountGrid">
              ${[2,3,4,6,8].map(n => `<button class="type-card ${n===4?'selected':''}" style="padding:12px 6px;font-size:13px;font-weight:700" onclick="wizSelectGroupCount(this,${n})">${n}</button>`).join('')}
            </div>
            <input type="number" class="form-input" id="wizGroupCountCustom" placeholder="أو أدخل عدداً..." min="2" max="16" style="margin-top:8px" oninput="wizCustomGroupCount(this)"/>
          </div>

          <div class="form-group" style="margin-top:16px">
            <label class="form-label">عدد الفرق في كل مجموعة <span style="color:var(--muted)">(اختياري)</span></label>
            <input type="number" class="form-input" id="wizTeamsPerGroup" placeholder="اتركه فارغاً للتوزيع المتساوي" min="2" max="20"/>
          </div>

          <div class="form-group" style="margin-top:16px">
            <label class="form-label">أسماء المجموعات</label>
            <div id="wizGroupNamesContainer" style="margin-top:8px">
              <!-- generated dynamically -->
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:6px">يمكنك تعديل الأسماء كما تريد</div>
          </div>

          <div class="form-group" style="margin-top:16px">
            <label class="form-label">عدد المتأهلين من كل مجموعة</label>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px" id="wizQualifyGrid">
              ${[1,2,3,4].map(n => `<button class="type-card ${n===2?'selected':''}" style="padding:10px 6px;font-size:13px;font-weight:700" onclick="wizSelectQualify(this,${n})">${n}</button>`).join('')}
            </div>
          </div>

          <div class="form-group" style="margin-top:16px">
            <label class="form-label">توزيع الفرق</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
              <button class="type-card selected" id="wizDistAuto" style="padding:12px 8px;font-size:11px" onclick="wizSelectDist('auto')">
                <div style="font-size:18px;margin-bottom:4px">🎲</div>توزيع تلقائي عشوائي
              </button>
              <button class="type-card" id="wizDistManual" style="padding:12px 8px;font-size:11px" onclick="wizSelectDist('manual')">
                <div style="font-size:18px;margin-bottom:4px">✋</div>توزيع يدوي بعد الإنشاء
              </button>
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:24px">
            <button class="btn btn-outline" style="flex:1" onclick="closeModal('modal-groups-wizard')">إلغاء</button>
            <button class="btn btn-gold" style="flex:2" onclick="wizConfirmGroups()">✅︎ إنشاء المجموعات</button>
          </div>
        </div>
      </div>`;
    m.addEventListener('click', e => { if(e.target === m) closeModal('modal-groups-wizard'); });
    document.body.appendChild(m);
  }

  // Store reference to type card
  window._wizTypeCardEl = typeCardEl;
  window._wizGroupCount = 4;
  window._wizQualify = 2;
  window._wizDist = 'auto';
  window._wizNames = ['A','B','C','D','E','F','G','H'];

  wizGenerateGroupNames(4);
  openModal('modal-groups-wizard');
};

window.wizSelectGroupCount = function(btn, n) {
  document.querySelectorAll('#wizGroupCountGrid .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wizGroupCount = n;
  document.getElementById('wizGroupCountCustom').value = '';
  wizGenerateGroupNames(n);
};

window.wizCustomGroupCount = function(inp) {
  const n = parseInt(inp.value);
  if (n >= 2 && n <= 16) {
    document.querySelectorAll('#wizGroupCountGrid .type-card').forEach(b => b.classList.remove('selected'));
    window._wizGroupCount = n;
    wizGenerateGroupNames(n);
  }
};

window.wizSelectQualify = function(btn, n) {
  document.querySelectorAll('#wizQualifyGrid .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wizQualify = n;
};

window.wizSelectDist = function(mode) {
  window._wizDist = mode;
  document.getElementById('wizDistAuto').classList.toggle('selected', mode === 'auto');
  document.getElementById('wizDistManual').classList.toggle('selected', mode === 'manual');
};

window.wizGenerateGroupNames = function(n) {
  const defaultNames = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
  const container = document.getElementById('wizGroupNamesContainer');
  if (!container) return;
  window._wizNames = defaultNames.slice(0, n);
  container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px">
    ${window._wizNames.map((name, i) => `
      <input class="form-input" style="padding:6px;text-align:center;font-weight:700"
        value="${name}" placeholder="مجموعة ${i+1}"
        oninput="window._wizNames[${i}]=this.value"
        id="wizName${i}"/>
    `).join('')}
  </div>`;
};

window.wizConfirmGroups = async function() {
  const n = window._wizGroupCount || 4;
  const qualify = window._wizQualify || 2;
  const dist = window._wizDist || 'manual';

  // Read actual names from inputs
  const names = [];
  for(let i = 0; i < n; i++) {
    const inp = document.getElementById('wizName' + i);
    names.push(inp ? (inp.value.trim() || String.fromCharCode(65+i)) : String.fromCharCode(65+i));
  }

  // Update type card UI
  if (window._wizTypeCardEl) {
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
    window._wizTypeCardEl.classList.add('selected');
  }
  settings.type = 'groups';

  // Save to Firestore
  try {
    // ✅︎ FIX: احفظ النوع + قفله في config/settings وفي league document
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), {
      type: 'groups', typeLocked: true, updatedAt: serverTimestamp()
    }, { merge: true });
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
      type: 'groups', typeLocked: true, updatedAt: serverTimestamp()
    });

    // Delete existing groups
    const existingSnap = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'groups'));
    const delBatch = writeBatch(db);
    existingSnap.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();

    // Create groups
    // ⚠️ لا تضع 🔴/🟥 — محجوزة لمؤشر "بث مباشر" بكل الموقع (راجع OVERRIDES.md)
    const icons = ['🔵','🟡','🟢','🟣','🟠','⚫','⚪','🔷','🔶','🟦','🟩','🟨','🟪','🟫'];
    const batch2 = writeBatch(db);
    const teamsToDistribute = dist === 'auto' ? [...teams].sort(() => Math.random() - 0.5) : [];
    for(let i = 0; i < n; i++) {
      const start = Math.floor(i * teamsToDistribute.length / n);
      const end = Math.floor((i+1) * teamsToDistribute.length / n);
      const groupTeamIds = dist === 'auto' ? teamsToDistribute.slice(start, end).map(t => t.id) : [];
      batch2.set(doc(collection(db, 'leagues', LEAGUE_ID, 'groups')), {
        name: names[i],
        icon: icons[i] || '👥',
        teamIds: groupTeamIds,
        qualify,
        order: i,
        createdAt: serverTimestamp()
      });
    }
    await batch2.commit();

    closeModal('modal-groups-wizard');
    showToast(`✅︎ تم إنشاء ${n} مجموعات بنجاح`, 'success');

    // Update UI
    window._adaptAdminUIToType('groups');
    if (adminGroups.length === 0) loadGroupsAndKnockout();
    // Navigate to groups page — ✅︎ استخدم صفحة السحب والإفلات الجديدة إن كانت مُفعّلة
    setTimeout(() => {
      const sbEl = document.getElementById('sb-groups-dnd') || document.getElementById('sb-groups');
      const pageName = document.getElementById('sb-groups-dnd') ? 'groups-dnd' : 'groups';
      showPage(pageName, sbEl);
    }, 300);

    const noteEl = document.getElementById('typeNote');
    if (noteEl) noteEl.textContent = `✅︎ تم إنشاء ${n} مجموعات — انتقل لصفحة المجموعات لإضافة الفرق`;

  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ══ KNOCKOUT SETUP WIZARD ══
window.openKnockoutWizard = function(typeCardEl) {
  if (!document.getElementById('modal-knockout-wizard')) {
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'modal-knockout-wizard';
    m.innerHTML = `
      <div class="modal" style="max-width:460px;width:95%">
        <div class="modal-header">
          <div class="modal-title">⚡ إعداد نظام خروج المغلوب</div>
          <button class="modal-close" onclick="closeModal('modal-knockout-wizard')">✕</button>
        </div>
        <div class="modal-body" style="padding:20px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.7">
            حدد من أين تبدأ الشجرة — ستكون الشجرة فارغة وأنت تحدد من يدخل كل دور
          </div>

          <div class="form-group">
            <label class="form-label">بداية الشجرة من</label>
            <div style="display:grid;gap:8px;margin-top:8px" id="wizBracketStartGrid">
              ${[
                {k:'r32',label:'دور الـ 32',sub:'32 فريق',icon:'swords'},
                {k:'r16',label:'دور الـ 16',sub:'16 فريق',icon:'target'},
                {k:'qf',label:'ربع النهائي',sub:'8 فرق',icon:'medal'},
                {k:'sf',label:'نصف النهائي',sub:'4 فرق',icon:'medal'},
                {k:'f',label:'النهائي',sub:'فريقان',icon:'trophy'}
              ].map((s,i) => `
                <button class="type-card ${i===1?'selected':''}" style="display:flex;align-items:center;gap:12px;padding:12px;text-align:right" 
                  id="wkStart_${s.k}" onclick="wizSelectBracketStart(this,'${s.k}')">
                  <span style="display:flex;align-items:center;justify-content:center">${_ic(s.icon,22)}</span>
                  <div><div style="font-size:12px;font-weight:700">${s.label}</div><div style="font-size:10px;color:var(--muted)">${s.sub}</div></div>
                </button>`).join('')}
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:24px">
            <button class="btn btn-outline" style="flex:1" onclick="closeModal('modal-knockout-wizard')">إلغاء</button>
            <button class="btn btn-gold" style="flex:2" onclick="wizConfirmKnockout()">⚡ إنشاء الشجرة</button>
          </div>
        </div>
      </div>`;
    m.addEventListener('click', e => { if(e.target === m) closeModal('modal-knockout-wizard'); });
    document.body.appendChild(m);
  }

  window._wizKoTypeCardEl = typeCardEl;
  window._wizBracketStart = 'r16';
  openModal('modal-knockout-wizard');
};

window.wizSelectBracketStart = function(btn, key) {
  document.querySelectorAll('#wizBracketStartGrid .type-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  window._wizBracketStart = key;
};

window.wizConfirmKnockout = async function() {
  const startKey = window._wizBracketStart || 'r16';
  const roundMap = {
    r32: [{name:'دور الـ 32',slots:16}, {name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    r16: [{name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    qf:  [{name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    sf:  [{name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    f:   [{name:'النهائي',slots:1}]
  };
  const rounds = roundMap[startKey] || roundMap['r16'];

  if (window._wizKoTypeCardEl) {
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
    window._wizKoTypeCardEl.classList.add('selected');
  }
  settings.type = 'knockout';

  try {
    // ✅︎ FIX: احفظ النوع + قفله في config/settings وفي league document
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), {
      type: 'knockout', typeLocked: true, updatedAt: serverTimestamp()
    }, { merge: true });
    await updateDoc(doc(db, 'leagues', LEAGUE_ID), {
      type: 'knockout', typeLocked: true, updatedAt: serverTimestamp()
    });

    // Delete existing knockout rounds
    const existing = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
    const delBatch = writeBatch(db);
    existing.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();

    // Create empty knockout rounds (no teams — admin fills manually)
    const batch2 = writeBatch(db);
    rounds.forEach((r, i) => {
      batch2.set(doc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds')), {
        name: r.name,
        order: i,
        slots: r.slots,
        matches: [],
        empty: true,
        createdAt: serverTimestamp()
      });
    });
    await batch2.commit();

    closeModal('modal-knockout-wizard');
    showToast(`✅︎ تم إنشاء شجرة إقصاء من ${rounds[0].name}`, 'success');

    window._adaptAdminUIToType('knockout');
    if (adminKnockoutRounds.length === 0) loadGroupsAndKnockout();
    setTimeout(() => showPage('knockout', document.getElementById('sb-knockout')), 300);

    const noteEl = document.getElementById('typeNote');
    if (noteEl) noteEl.textContent = `⚡ شجرة بدأت من ${rounds[0].name} — انتقل لصفحة الإقصاء لإضافة الفرق`;

  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

function selectTypeSilent(type) {
  settings.type = type;
  document.querySelectorAll('.type-card').forEach((c, i) => {
    const t = ['league', 'groups', 'knockout'][i];
    if(t === type) c.classList.add('selected'); else c.classList.remove('selected');
  });
}

function _updateLockedTypeDisplay(type) {
  const typeMap = {
    league:   { icon:'list', name:'دوري نقاط', desc:'جدول ترتيب كامل · مناطق متأهلين وهابطين' },
    groups:   { icon:'users', name:'مجموعات + خروج مغلوب', desc:'دور المجموعات ← ثم شجرة إقصاء' },
    knockout: { icon:'tree', name:'خروج مغلوب فقط', desc:'شجرة إقصاء مباشرة من البداية' }
  };
  const info = typeMap[type] || typeMap['league'];
  const iconEl = document.getElementById('typeLockedIcon');
  const nameEl = document.getElementById('typeLockedName');
  const descEl = document.getElementById('typeLockedDesc');
  if(iconEl) iconEl.textContent = info.icon;
  if(nameEl) nameEl.textContent = info.name;
  if(descEl) descEl.textContent = info.desc;
}

window.toggleSwitch = function(row) {
  const sw = row.querySelector('.toggle-switch');
  sw.classList.toggle('on');
  const key = row.dataset.key;
  if (!key || !LEAGUE_ID) return;
  const val = sw.classList.contains('on');
  setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), { [key]: val, updatedAt: serverTimestamp() }, { merge: true })
    .then(() => showToast((val ? '✅︎ ' : '🔕 ') + (row.querySelector('.toggle-name')?.textContent?.trim() || key), 'success'))
    .catch(() => { showToast('خطأ في الحفظ', 'error'); sw.classList.toggle('on'); });
};
window.openModal = function(id) {
  const el = document.getElementById(id);
  if (!el) return;                       // ✅︎ لا تنهار لو العنصر غير موجود
  // ✅︎ خانة الملعب تُعبَّأ تلقائياً من "الملعب الافتراضي" بالإعدادات — يفيد البطولات التي تُقام كلها على ملعب واحد
  if (id === 'modal-match') {
    const venueEl = document.getElementById('matchVenue');
    if (venueEl) venueEl.value = (window.settings && window.settings.defaultVenue) || 'ملعب الحارة';
  }
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
};
/* ✅︎ إغلاق موحّد: يدعم نوعَي النوافذ في المنصة
   - نوافذ .modal-overlay الثابتة → إزالة كلاس open
   - نوافذ overlay المُنشأة ديناميكياً → إزالة العنصر نفسه
   وآمن تماماً لو العنصر غير موجود (كان ينهار بـ TypeError) */
window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList && el.classList.contains('modal-overlay')) {
    el.classList.remove('open');
  } else {
    el.remove();
  }
  const anyOpen = document.querySelector('.modal-overlay.open');
  const anyDyn  = (window._modalIds || []).some(x => document.getElementById(x));
  if (!anyOpen && !anyDyn) document.body.style.overflow = '';
};
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target === m) closeModal(m.id); }));

window.showPage = function(name, sb, mn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('page-' + name);
  if(el) el.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.mn-item').forEach(i => i.classList.remove('active'));
  if(sb) sb.classList.add('active');
  if(mn) {
    mn.classList.add('active');
    // ✅︎ إصلاح: scroll العنصر النشط ليكون مرئياً في الجوال
    mn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  document.querySelectorAll('.sb-item').forEach(i => {
    const oc = i.getAttribute('onclick') || '';
    const dp = i.getAttribute('data-page') || '';
    if(oc.includes("'" + name + "'") || dp === name) i.classList.add('active');
  });
  // ✅︎ sync mobile nav active state even when navigated from sidebar
  document.querySelectorAll('.mn-item').forEach(i => {
    const oc = i.getAttribute('onclick') || '';
    if(oc.includes("'" + name + "'")) {
      i.classList.add('active');
      i.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

let toastT;
window.showToast = function(msg, type = 'success') {
  /* ✅︎ متين: يُنشئ العنصر لو مفقود (كان يرمي استثناء ويكسر الدالة
     المستدعية)، ويُطيل مدة الأخطاء لأنها تحتاج قراءة فعلية. */
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  // انقله لآخر الـ body ليعلو أي نافذة فُتحت بعده
  if (t.parentNode !== document.body || t.nextSibling) document.body.appendChild(t);
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), type === 'error' ? 5000 : 3000);
};

// ══ TOP TABS SWITCH (simplified — no old live panel) ══
window.switchTopTab = function(tab, btn) {
  // kept for backward compat with nav buttons — no-op now
};

// ══ CONST ══
const PLATFORM_NAME = 'منصة البطولات';

// ══════════════════════════════════════════════════════════════════
// 🔴 نظام البث المباشر الجديد — PER-MATCH LIVE CONTROL
// كل مباراة لها صفحة بث مستقلة تُفتح بضغطة زر "🔴 بث"
// البيانات تُحفظ في: leagues/{id}/matches/{matchId} (حقل liveData)
// يدعم بث أكثر من مباراة في نفس الوقت
// ══════════════════════════════════════════════════════════════════

// ── State per match ──
const _liveMatches = {}; // matchId → { timer, state }
window._liveMatches = _liveMatches; // يستخدمه live-page-fixes.js

// ── Settings helper ──
function _getLiveSettings() {
  const ms = (window.settings && window.settings.matchSettings) || {};
  return {
    half1Duration: ms.half1Duration || ms.halfDuration || 45,
    half2Duration: ms.half2Duration || ms.halfDuration || 45,
    breakDuration: ms.breakDuration || 15,
    et1Duration:   ms.et1Duration   || 15,
    et2Duration:   ms.et2Duration   || 15,
    hasExtraTime:  ms.hasExtraTime !== false,
    hasPenalties:  ms.hasPenalties !== false,
  };
}

// ─────────────────────────────────────────────────────────────────
// openLivePage — يُفتح بضغطة زر "🔴 بث" على بطاقة المباراة
// ─────────────────────────────────────────────────────────────────
window.openLivePage = function(matchId) {
  if (!matchId) { showToast('لم يتم تحديد المباراة', 'error'); return; }
  window._lvCurrentMatchId = matchId; // يستخدمه lvOpenLineupFromLive
  window._lvAddTimeMatchId = matchId; // يستخدمه lvConfirmAddTime
  window._lvEventMatchId   = matchId; // يستخدمه lvSaveEvent
  const match = matches.find(m => m.id === matchId);
  if (!match) { showToast('المباراة غير موجودة', 'error'); return; }

  // إذا الصفحة مفتوحة بالفعل — أحضرها للأمام وأعد تشغيل العداد
  const existing = document.getElementById('lp-' + matchId);
  if (existing) {
    _lpShow(matchId);
    // ── إصلاح مشكلة 1: أعد تشغيل العداد عند الرجوع للصفحة ──
    const _st = _liveMatches[matchId];
    if (_st && !_st.timerInterval && !_st.timerPaused &&
        ['live','extratime1','extratime2'].includes(_st.matchStatus)) {
      _st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
    }
    window._lpUpdateStatusUI && window._lpUpdateStatusUI(matchId);
    window._lpUpdateTimerDisplay && window._lpUpdateTimerDisplay(matchId);
    return;
  }

  const ht = teams.find(t => t.id === match.homeId) || { name: match.homeName || '؟', logo: match.homeLogo || '⚽' };
  const at = teams.find(t => t.id === match.awayId) || { name: match.awayName || '؟', logo: match.awayLogo || '⚽' };
  // الإعدادات: نعطي الأولوية للقيم المحفوظة في liveData (ثابتة للمباراة) ثم إعدادات البطولة
  const _cfgBase = _getLiveSettings();
  const _ld = match.liveData || {};
  const cfg = {
    half1Duration: _ld.half1Duration || _cfgBase.half1Duration,
    half2Duration: _ld.half2Duration || _cfgBase.half2Duration,
    breakDuration: _ld.breakDuration || _cfgBase.breakDuration,
    et1Duration:   _ld.et1Duration   || _cfgBase.et1Duration,
    et2Duration:   _ld.et2Duration   || _cfgBase.et2Duration,
    hasExtraTime:  _cfgBase.hasExtraTime,
    hasPenalties:  _cfgBase.hasPenalties,
  };

  // ── أنشئ state ──
  _liveMatches[matchId] = {
    matchId,
    homeScore:    match.liveData?.homeScore ?? 0,
    awayScore:    match.liveData?.awayScore ?? 0,
    timerRunning: false,
    timerInterval: null,
    matchStatus:  match.liveData?.matchStatus || 'upcoming',
    currentHalf:  match.liveData?.currentHalf || 1,
    events:       match.liveData?.events || [],
    half1Extra:   match.liveData?.half1ExtraMinutes || 0,
    half2Extra:   match.liveData?.half2ExtraMinutes || 0,
    et1Extra:     match.liveData?.et1ExtraMinutes   || 0,
    et2Extra:     match.liveData?.et2ExtraMinutes   || 0,
    half1StartedAt:    match.liveData?.half1StartedAt    || null,
    half2StartedAt:    match.liveData?.half2StartedAt    || null,
    halftimeStartedAt: match.liveData?.halftimeStartedAt || null,
    et1StartedAt:      match.liveData?.et1StartedAt      || null,
    et2StartedAt:      match.liveData?.et2StartedAt      || null,
    timerSeconds: match.liveData?.timerSeconds      || 0,
    phaseSeconds: match.liveData?.phaseSeconds      || match.liveData?.timerSeconds || 0,
    timerPaused:  match.liveData?.timerPaused       || false,
    pausedAt:     match.liveData?.pausedAt          || null,
    pauseReason:  match.liveData?.pauseReason       || '',
    streamUrl:    match.liveData?.streamUrl || '',
    streamActive: match.liveData?.streamActive || false,
    streamPlatform: match.liveData?.streamPlatform || 'youtube',
    homeLineup:   match.liveData?.homeLineup || null,
    awayLineup:   match.liveData?.awayLineup || null,
    stats:        match.liveData?.stats || match.stats || {},
    statsEnabled: match.liveData?.statsEnabled !== false,
    /* ✅︎ إصلاح جذري — نوع المباراة لم يكن يُنسخ إلى حالة البث إطلاقاً.
       الكود يفحص  st.isKnockout || (st.knockoutRoundId != null)
       فكانت النتيجة false دائماً → لا زر ركلات ترجيح، ولا وقت إضافي
       تلقائي عند التعادل، ولا أي فرق بين مباريات المجموعات والإقصاء.
       هذا سبب شكوى "الإعدادات موجودة لكنها لا تعمل". */
    isKnockout:        !!(match.isKnockout || match.knockoutRoundId != null),
    knockoutRoundId:   match.knockoutRoundId ?? null,
    knockoutRoundName: match.knockoutRoundName || '',
    cfg,
    unsubscribe: null,
  };

  // ── إصلاح 1: شغّل العداد فوراً إذا كانت المباراة جارية ──
  const _stInit = _liveMatches[matchId];
  if (_stInit && !_stInit.timerPaused &&
      ['live','extratime1','extratime2'].includes(_stInit.matchStatus)) {
    _stInit.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
  }
  _startAutoSaveV2(matchId);

  // ── بنِّ الصفحة ──
  _buildLivePage(matchId, match, ht, at);
  _lpShow(matchId);

  // ── اشترك في التحديثات الـ realtime ──
  _lpSubscribe(matchId);
};

function _lpShow(matchId) {
  // أخفِّ كل صفحات البث الأخرى
  document.querySelectorAll('.live-page-overlay').forEach(el => el.classList.remove('lp-active'));
  const page = document.getElementById('lp-' + matchId);
  if (page) page.classList.add('lp-active');
}

function _lpHide(matchId) {
  const page = document.getElementById('lp-' + matchId);
  if (page) page.classList.remove('lp-active');
}

window.closeLivePage = async function(matchId) {
  const st = _liveMatches[matchId];
  if (st) {
    clearInterval(st.timerInterval);
    if (st._autoSaveV2) clearInterval(st._autoSaveV2);
    if (st.unsubscribe) st.unsubscribe();

    // احفظ في Firebase أولاً لو المباراة جارية — يضمن صحة البيانات عند إعادة الفتح
    const isActive = ['live','halftime','extratime1','halftime_et','extratime2','penalties'].includes(st.matchStatus);
    if (isActive) {
      st.timerSeconds = window._calcSecsFromServer(st);
      try { await window._lpSaveV2(matchId); } catch(e) {}
    }

    // احفظ في كائن المباراة المحلي أيضاً (احتياط لو onSnapshot لم يصل بعد)
    const m = matches.find(x => x.id === matchId);
    if (m) {
      m.liveData = m.liveData || {};
      m.liveData.matchStatus       = st.matchStatus;
      m.liveData.currentHalf       = st.currentHalf;
      m.liveData.homeScore         = st.homeScore;
      m.liveData.awayScore         = st.awayScore;
      m.liveData.timerSeconds      = st.timerSeconds;
      m.liveData.timerPaused       = st.timerPaused || false;
      m.liveData.half1StartedAt    = st.half1StartedAt;
      m.liveData.half2StartedAt    = st.half2StartedAt;
      m.liveData.halftimeStartedAt = st.halftimeStartedAt;
      m.liveData.et1StartedAt      = st.et1StartedAt;
      m.liveData.et2StartedAt      = st.et2StartedAt;
      m.liveData.half1ExtraMinutes = st.half1Extra || 0;
      m.liveData.half2ExtraMinutes = st.half2Extra || 0;
      m.liveData.et1ExtraMinutes   = st.et1Extra   || 0;
      m.liveData.et2ExtraMinutes   = st.et2Extra   || 0;
      m.liveData.events            = st.events     || [];
      m.liveData.penalties         = st.penalties  || null;
      m.liveData.stats             = st.stats      || {};
      m.liveData.half1Duration     = st.cfg?.half1Duration || 45;
      m.liveData.half2Duration     = st.cfg?.half2Duration || 45;
      m.liveData.et1Duration       = st.cfg?.et1Duration   || 15;
      m.liveData.et2Duration       = st.cfg?.et2Duration   || 15;
      m.liveData.breakDuration     = st.cfg?.breakDuration || 15;
    }
    delete _liveMatches[matchId];
  }
  const page = document.getElementById('lp-' + matchId);
  if (page) page.remove();
};

// ─────────────────────────────────────────────────────────────────
// بناء صفحة البث HTML
// ─────────────────────────────────────────────────────────────────
function _buildLivePage(matchId, match, ht, at) {
  const overlay = document.createElement('div');
  overlay.className = 'live-page-overlay';
  overlay.id = 'lp-' + matchId;

  const mId = matchId; // alias for template strings
  overlay.innerHTML = `
    <!-- TopBar -->
    <div class="lp-topbar">
      <button class="lp-close-btn" onclick="closeLivePage('${mId}')">✕ إغلاق</button>
      <div class="lp-title">🔴 بث مباشر · ${ht.name} × ${at.name}</div>
      <div class="lp-save-indicator" id="lp-save-${mId}">متصل</div>
    </div>

    <div class="lp-body">

      <!-- ══ العمود الرئيسي ══ -->
      <div class="lp-col-main">

        <!-- لوحة النتيجة -->
        <div class="lp-scoreboard">
          <div class="lp-sb-toprow">
            <div class="lp-status-badge" id="lp-status-${mId}">قبل المباراة</div>
            <div class="lp-period" id="lp-period-${mId}">الشوط الأول</div>
          </div>
          <div class="lp-sb-teams">
            <div class="lp-sb-team">
              <div class="lp-team-logo">${_lpLogoHtml(ht.logo, 52)}</div>
              <div class="lp-team-name">${ht.name}</div>
            </div>
            <div class="lp-sb-center">
              <div class="lp-score-row">
                <div class="lp-score" id="lp-sh-${mId}">0</div>
                <div class="lp-score-sep">
                  <div class="lp-extra-time" id="lp-extra-${mId}" style="display:none"></div>
                  <div class="lp-timer-display" id="lp-timer-${mId}">00:00</div>
                  <span>-</span>
                </div>
                <div class="lp-score" id="lp-sa-${mId}">0</div>
              </div>
            </div>
            <div class="lp-sb-team">
              <div class="lp-team-logo">${_lpLogoHtml(at.logo, 52)}</div>
              <div class="lp-team-name">${at.name}</div>
            </div>
          </div>

          <!-- أزرار التحكم الزمني -->
          <!-- ✅︎ الأزرار تُبنى ديناميكياً عبر _updateTimeControlBtns حسب حالة المباراة
               (وهي التي تُظهر زر «⏱️ بدل الضائع» أثناء الشوطين والوقت الإضافي) -->
          <div class="lp-time-controls" id="lp-time-controls-${mId}"></div>

<!-- ✅︎ قسم ركلات الترجيح الكامل -->
          <div id="lp-pen-section-${mId}" style="display:none;margin-top:10px;
            background:rgba(155,89,182,.07);border:1px solid rgba(155,89,182,.25);
            border-radius:12px;padding:14px;font-family:Tajawal,sans-serif">
            <div style="font-size:13px;font-weight:700;color:#9b59b6;margin-bottom:12px;text-align:center">
              🥅 ركلات الترجيح
            </div>

            <!-- النتيجة الحالية -->
            <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px">
              <div style="text-align:center">
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${ht.name}</div>
                <div id="lp-pen-sh-${mId}" style="font-size:28px;font-weight:900;color:#9b59b6">0</div>
              </div>
              <div style="font-size:18px;color:var(--muted)">—</div>
              <div style="text-align:center">
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${at.name}</div>
                <div id="lp-pen-sa-${mId}" style="font-size:28px;font-weight:900;color:#9b59b6">0</div>
              </div>
            </div>

            <!-- أزرار التسجيل -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <!-- الفريق المضيف -->
              <div style="background:rgba(0,0,0,.15);border-radius:9px;padding:10px">
                <div style="font-size:11px;font-weight:700;color:#fff;margin-bottom:8px;text-align:center">
                  ${ht.name}
                </div>
                <div style="display:flex;gap:6px;justify-content:center;margin-bottom:6px">
                  <button onclick="lpPenScore('${mId}','home','goal')"
                    style="flex:1;padding:8px 4px;border-radius:8px;border:none;background:rgba(39,174,96,.2);
                    color:#27ae60;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
                    ✅︎ هدف
                  </button>
                  <button onclick="lpPenScore('${mId}','home','miss')"
                    style="flex:1;padding:8px 4px;border-radius:8px;border:none;background:rgba(192,57,43,.2);
                    color:#C0392B;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
                    ❌︎ تفويت
                  </button>
                </div>
                <div id="lp-pen-home-dots-${mId}" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;min-height:20px"></div>
              </div>
              <!-- الفريق الضيف -->
              <div style="background:rgba(0,0,0,.15);border-radius:9px;padding:10px">
                <div style="font-size:11px;font-weight:700;color:#fff;margin-bottom:8px;text-align:center">
                  ${at.name}
                </div>
                <div style="display:flex;gap:6px;justify-content:center;margin-bottom:6px">
                  <button onclick="lpPenScore('${mId}','away','goal')"
                    style="flex:1;padding:8px 4px;border-radius:8px;border:none;background:rgba(39,174,96,.2);
                    color:#27ae60;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
                    ✅︎ هدف
                  </button>
                  <button onclick="lpPenScore('${mId}','away','miss')"
                    style="flex:1;padding:8px 4px;border-radius:8px;border:none;background:rgba(192,57,43,.2);
                    color:#C0392B;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
                    ❌︎ تفويت
                  </button>
                </div>
                <div id="lp-pen-away-dots-${mId}" style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;min-height:20px"></div>
              </div>
            </div>

            <!-- زر تراجع + إنهاء -->
            <div style="display:flex;gap:8px;margin-top:10px">
              <button onclick="lpPenUndo('${mId}')"
                style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border2);
                background:transparent;color:var(--muted);font-family:Tajawal,sans-serif;font-size:12px;cursor:pointer">
                ↩️ تراجع
              </button>
              <button onclick="lpEndMatch('${mId}')"
                style="flex:1;padding:8px;border-radius:8px;border:none;
                background:rgba(192,57,43,.15);color:#C0392B;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
                ⏹ إنهاء المباراة
              </button>
            </div>
          </div>
        </div>

        <!-- أزرار النتيجة -->
        <div class="lp-score-controls">
          <div class="lp-sc-row">
            <div class="lp-sc-team">${_lpLogoHtml(ht.logo, 24)} ${ht.name}</div>
            <div class="lp-sc-btns">
              <button class="lp-sc-plus" onclick="lpAddGoal('${mId}','home')">+</button>
              <button class="lp-sc-minus" onclick="lpRemoveGoal('${mId}','home')">−</button>
            </div>
          </div>
          <div class="lp-sc-row">
            <div class="lp-sc-team">${_lpLogoHtml(at.logo, 24)} ${at.name}</div>
            <div class="lp-sc-btns">
              <button class="lp-sc-plus" onclick="lpAddGoal('${mId}','away')">+</button>
              <button class="lp-sc-minus" onclick="lpRemoveGoal('${mId}','away')">−</button>
            </div>
          </div>
        </div>

        <!-- أزرار الأحداث -->
        <div class="lp-events-grid">
          <div class="lp-eg-label">📋 أحداث</div>
          <div class="lp-eg-btns">
            <button class="lp-ev-btn lp-ev-goal" onclick="lpOpenEvent('${mId}','goal','⚽','هدف')">⚽ هدف</button>
            <button class="lp-ev-btn lp-ev-yellow" onclick="lpOpenEvent('${mId}','yellow','🟡','بطاقة صفراء')">🟡 صفراء</button>
            <button class="lp-ev-btn lp-ev-red" onclick="lpOpenEvent('${mId}','red','🔴','بطاقة حمراء')">🔴 حمراء</button>
            <button class="lp-ev-btn lp-ev-sub" onclick="lpOpenEvent('${mId}','sub','🔄','تبديل')">${window.Icon?window.Icon('refresh',12):''} تبديل</button>
            <button class="lp-ev-btn lp-ev-inj" onclick="lpOpenEvent('${mId}','injury','🤕','إصابة')">🤕 إصابة</button>
            <button class="lp-ev-btn lp-ev-var" onclick="lpOpenEvent('${mId}','var','📺','VAR')">📺 VAR</button>
          </div>
        </div>

        <!-- سجل الأحداث -->
        <div class="lp-events-log">
          <div class="lp-log-header">
            <span>📝 سجل الأحداث</span>
            <button class="lp-clear-btn" onclick="lpClearEvents('${mId}')">مسح الكل</button>
          </div>
          <div id="lp-events-list-${mId}" class="lp-events-list">
            <div class="lp-no-events">لا توجد أحداث بعد</div>
          </div>
        </div>

        <!-- البث المباشر -->
        <div class="lp-stream-section">
          <div class="lp-stream-label">📡 البث المباشر</div>
          <div class="lp-platforms" id="lp-platforms-${mId}">
            <button class="lp-plt sel-yt" id="lp-plt-yt-${mId}" onclick="lpSetPlatform('${mId}','youtube')">▶︎️ YouTube</button>
            <button class="lp-plt" id="lp-plt-fb-${mId}" onclick="lpSetPlatform('${mId}','facebook')">📘 Facebook</button>
            <button class="lp-plt" id="lp-plt-tw-${mId}" onclick="lpSetPlatform('${mId}','twitch')">🎮 Twitch</button>
            <button class="lp-plt" id="lp-plt-ot-${mId}" onclick="lpSetPlatform('${mId}','other')">📺 أخرى</button>
          </div>
          <input class="lp-stream-input" id="lp-stream-url-${mId}" placeholder="الصق رابط البث هنا..." value="${match.liveData?.streamUrl || ''}"/>
          <div class="lp-stream-hint">مثال: https://www.youtube.com/watch?v=XXXXX</div>
          <button class="lp-stream-activate" id="lp-stream-act-${mId}" onclick="lpActivateStream('${mId}')">📡 تفعيل البث للجمهور</button>
          <div class="lp-stream-active-bar" id="lp-stream-bar-${mId}" style="display:none">
            <div class="lp-stream-dot"></div>
            <span>البث مفعّل للجمهور</span>
            <button onclick="lpStopStream('${mId}')">إيقاف</button>
          </div>
        </div>

      </div><!-- /lp-col-main -->

      <!-- ══ العمود الجانبي ══ -->
      <div class="lp-col-side">

        <!-- معلومات المباراة -->
        <div class="lp-info-card">
          <div class="lp-ic-title">📋 معلومات المباراة</div>
          <div class="lp-ic-row">
            <label>📅 التاريخ</label>
            <input class="lp-ic-input" id="lp-date-${mId}" type="date" value="${match.date || ''}"/>
          </div>
          <div class="lp-ic-row">
            <label>⏰ الوقت</label>
            <input class="lp-ic-input" id="lp-time-${mId}" type="time" value="${match.time || '16:00'}"/>
          </div>
          <div class="lp-ic-row">
            <label>🏟 الملعب</label>
            <input class="lp-ic-input" id="lp-venue-${mId}" value="${match.venue || ''}"/>
          </div>
          <div class="lp-ic-row">
            <label>🎯 الجولة</label>
            <input class="lp-ic-input" id="lp-round-${mId}" type="number" value="${match.round || 1}"/>
          </div>
        </div>

        <!-- طاقم المباراة -->
        <div class="lp-info-card">
          <div class="lp-ic-title">👔 الطاقم</div>
          <div class="lp-ic-row"><label>🏁 الحكم</label><input class="lp-ic-input" id="lp-referee-${mId}" value="${match.referee || ''}"/></div>
          <div class="lp-ic-row"><label>🚩 خط 1</label><input class="lp-ic-input" id="lp-lns1-${mId}" value="${match.linesman1 || ''}"/></div>
          <div class="lp-ic-row"><label>🚩 خط 2</label><input class="lp-ic-input" id="lp-lns2-${mId}" value="${match.linesman2 || ''}"/></div>
          <div class="lp-ic-row"><label>🎙 المعلق</label><input class="lp-ic-input" id="lp-comm-${mId}" value="${match.commentator || ''}"/></div>
          <div class="lp-ic-row"><label>🏅 الراعي</label><input class="lp-ic-input" id="lp-sponsor-${mId}" value="${match.sponsor || ''}"/></div>
          <div class="lp-ic-row"><label>📸 المصور</label><input class="lp-ic-input" id="lp-photo-${mId}" value="${match.photographer || ''}"/></div>
          <div class="lp-ic-row"><label>🎤 المذيع</label><input class="lp-ic-input" id="lp-ann-${mId}" value="${match.announcer || ''}"/></div>
        </div>

        <!-- إضافات -->
        <div class="lp-info-card">
          <div class="lp-ic-title">⭐︎ إضافات</div>
          <div class="lp-ic-row"><label>👑 رجل المباراة</label><input class="lp-ic-input" id="lp-mom-${mId}" value="${match.manOfMatch || ''}"/></div>
          <div class="lp-ic-row"><label>👥 الجمهور</label><input class="lp-ic-input" id="lp-att-${mId}" type="number" value="${match.attendance || ''}"/></div>
          <div class="lp-ic-row"><label>📝 ملاحظات</label><textarea class="lp-ic-input" id="lp-notes-${mId}" rows="2">${match.notes || ''}</textarea></div>
        </div>

        <!-- التشكيلة -->
        <div class="lp-info-card">
          <div class="lp-ic-title">👥 التشكيلة</div>
          <div class="lp-lineup-tabs">
            <button class="lp-ltab active" id="lp-ltab-h-${mId}" onclick="lpLineupTab('${mId}','home',this)">${ht.name}</button>
            <button class="lp-ltab" id="lp-ltab-a-${mId}" onclick="lpLineupTab('${mId}','away',this)">${at.name}</button>
          </div>
          <div id="lp-lineup-side-${mId}" style="display:none;font-size:10px;color:var(--muted);text-align:center;padding:4px">المضيف</div>
          <div class="lp-lineup-formations" id="lp-formations-${mId}">
            ${['4-3-3','4-4-2','4-2-3-1','3-5-2','5-3-2'].map(f =>
              `<button class="lp-f-btn${f==='4-3-3'?' active':''}" data-f="${f}" onclick="lpSetFormation('${mId}','${f}',this)">${f}</button>`
            ).join('')}
          </div>
          <div id="lp-lineup-players-${mId}" class="lp-lineup-players"></div>
          <button class="lp-btn lp-btn-lineup-save" onclick="lpSaveLineup('${mId}')">💾 حفظ التشكيلة للجمهور</button>
        </div>

        <button class="lp-btn lp-btn-save-all" onclick="lpSaveAll('${mId}')">💾 حفظ وإرسال للجمهور</button>

      </div><!-- /lp-col-side -->

    </div><!-- /lp-body -->

    <!-- Modal الحدث -->
    <div class="lp-event-modal" id="lp-evmodal-${mId}" style="display:none">
      <div class="lp-evmodal-box">
        <div class="lp-evmodal-title" id="lp-evmodal-title-${mId}">تسجيل حدث</div>
        <div class="lp-evmodal-row">
          <label>الفريق</label>
          <select class="lp-evmodal-sel" id="lp-evteam-${mId}" onchange="window._lpOnTeamChange('${mId}')">
            <option value="home">${ht.name}</option>
            <option value="away">${at.name}</option>
          </select>
        </div>
        <div class="lp-evmodal-row" id="lp-evplayerrow-${mId}">
          <label>اسم اللاعب</label>
          <input class="lp-evmodal-input" id="lp-evplayer-${mId}" placeholder="اكتب اسم اللاعب..."/>
        </div>
        <div id="lp-evsubpicker-${mId}" style="display:none"></div>
        <div class="lp-evmodal-row" id="lp-evplayer2row-${mId}" style="display:none">
          <label>اللاعب الداخل</label>
          <input class="lp-evmodal-input" id="lp-evplayer2-${mId}" placeholder="اسم اللاعب الداخل"/>
        </div>
        <div class="lp-evmodal-row">
          <label>الدقيقة</label>
          <input class="lp-evmodal-input" id="lp-evmin-${mId}" type="number" placeholder="مثال: 23"/>
        </div>
        <div class="lp-evmodal-row">
          <label>ملاحظة</label>
          <input class="lp-evmodal-input" id="lp-evnote-${mId}" placeholder="مثال: ركلة جزاء"/>
        </div>
        <div class="lp-evmodal-btns">
          <button onclick="lpCloseEventModal('${mId}')">إلغاء</button>
          <button class="lp-evmodal-confirm" onclick="lpConfirmEvent('${mId}')">✅︎ تسجيل</button>
        </div>
      </div>
    </div>

    <!-- Modal الوقت الإضافي -->
    <div class="lp-addtime-modal" id="lp-atmodal-${mId}" style="display:none">
      <div class="lp-atmodal-box">
        <div class="lp-atmodal-title">➕︎ وقت إضافي</div>
        <div class="lp-atmodal-half" id="lp-at-half-${mId}">الشوط الحالي</div>
        <div class="lp-atmodal-quick">
          <button onclick="lpSetAddTime('${mId}',1)">+1</button>
          <button onclick="lpSetAddTime('${mId}',2)">+2</button>
          <button onclick="lpSetAddTime('${mId}',3)">+3</button>
          <button onclick="lpSetAddTime('${mId}',5)">+5</button>
        </div>
        <input class="lp-evmodal-input" id="lp-at-mins-${mId}" type="number" min="0" max="30" value="1"/>
        <div class="lp-evmodal-btns">
          <button onclick="lpCloseAddTime('${mId}')">إلغاء</button>
          <button class="lp-evmodal-confirm" onclick="lpConfirmAddTime('${mId}')">✅︎ تأكيد</button>
        </div>
      </div>
    </div>

  `;

  document.body.appendChild(overlay);

  // init lineup
  window._lpLineupSide = window._lpLineupSide || {};
  window._lpLineupFormation = window._lpLineupFormation || {};
  window._lpLineupSide[matchId] = 'home';
  window._lpLineupFormation[matchId] = '4-3-3';
  _lpRenderLineupPlayers(matchId);

  // init score display
  const st = _liveMatches[matchId];
  document.getElementById('lp-sh-' + matchId).textContent = st.homeScore;
  document.getElementById('lp-sa-' + matchId).textContent = st.awayScore;
  _lpRenderEvents(matchId);
  _lpUpdateStatusUI(matchId);

  // restore stream bar
  if (st.streamActive) {
    const bar = document.getElementById('lp-stream-bar-' + matchId);
    if (bar) bar.style.display = 'flex';
  }
}

// ── Logo helper ──
function _lpLogoHtml(logo, size) {
  if (!logo) return `<span style="font-size:${size}px">⚽</span>`;
  if (logo.startsWith('data:') || logo.startsWith('http') || logo.startsWith('/')) {
    return `<img src="${logo}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size*0.25)}px;object-fit:cover;vertical-align:middle" onerror="this.style.display='none'"/>`;
  }
  return `<span style="font-size:${size}px;line-height:1">${logo}</span>`;
}

// ── Subscribe to realtime updates ──
function _lpSubscribe(matchId) {
  const st = _liveMatches[matchId];
  if (!st || !LEAGUE_ID) return;
  if (st.unsubscribe) st.unsubscribe();
  st.unsubscribe = onSnapshot(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    const ld = d.liveData;
    if (!ld) return;
    // تحديث فقط لو الأدمن لا يتحكم الآن (timerPaused أو مش running)
    // هذا يمنع التضارب مع الحفظ الحالي
    /* ✅︎ FIX 9 — كشف منظّم آخر يكتب على نفس المباراة.
       lastWriteWins يبقى، لكن لا مزيد من التدمير الصامت: نُحذّر فوراً.
       نتجاهل كتاباتنا نحن، والكتابات القديمة (>15ث) من جلسة ميتة. */
    if (ld.writerId && window._LP_SESSION && ld.writerId !== window._LP_SESSION) {
      const age = Date.now() - (ld.writerAt || 0);
      if (age < 15000 && !st._conflictWarnedAt) {
        st._conflictWarnedAt = Date.now();
        window.showToast && window.showToast(
          '⚠️ منظّم آخر يدير هذه المباراة الآن — قد تتضارب التعديلات', 'error');
        setTimeout(() => { if (st) st._conflictWarnedAt = null; }, 30000);
      }
    }

    if (!st.timerRunning && !st.timerPaused) {
      // sync النتيجة والأحداث من الخادم
      if (typeof ld.homeScore === 'number') st.homeScore = ld.homeScore;
      if (typeof ld.awayScore === 'number') st.awayScore = ld.awayScore;
      const shEl = document.getElementById('lp-sh-' + matchId);
      const saEl = document.getElementById('lp-sa-' + matchId);
      if (shEl) shEl.textContent = st.homeScore;
      if (saEl) saEl.textContent = st.awayScore;
      if (Array.isArray(ld.events)) {
        st.events = ld.events;
        if (typeof _lpRenderEvents === 'function') _lpRenderEvents(matchId);
      }
    }
  });
}


// ─────────────────────────────────────────────────────────────────
// GOALS
// ─────────────────────────────────────────────────────────────────
window.lpAddGoal = function(matchId, side) {
  const match = matches.find(m => m.id === matchId);
  const st = _liveMatches[matchId];
  if (!st || !match) return;
  const ht = teams.find(t => t.id === match.homeId) || { name: match.homeName || 'الأول' };
  const at = teams.find(t => t.id === match.awayId) || { name: match.awayName || 'الثاني' };
  const teamName = side === 'home' ? ht.name : at.name;
  const teamId = side === 'home' ? match.homeId : match.awayId;
  _lpOpenScorerPicker(matchId, side, teamName, teamId);
};

async function _lpOpenScorerPicker(matchId, side, teamName, teamId) {
  const old = document.getElementById('lp-scorer-overlay-' + matchId);
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'lp-scorer-overlay-' + matchId;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center';

  overlay.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--gold3);border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:20px 20px 36px;animation:slideUp .25s ease">
      <div style="text-align:center;margin-bottom:14px">
        <div style="font-size:26px">⚽</div>
        <div style="font-size:15px;font-weight:900;color:var(--gold);font-family:Tajawal,sans-serif">من سجل الهدف؟</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">${teamName}</div>
      </div>
      <input id="lp-sp-input-${matchId}" class="form-input" placeholder="اكتب اسم اللاعب..." style="font-size:14px;margin-bottom:10px" autocomplete="off"/>
      <div id="lp-sp-roster-${matchId}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        <span style="font-size:11px;color:var(--muted)">جارِ تحميل قائمة اللاعبين...</span>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('lp-scorer-overlay-${matchId}')?.remove();lpRemoveGoalNoScorer?.('${matchId}','${side}')" style="flex:1;padding:12px;background:var(--card3);border:1px solid var(--border2);border-radius:12px;color:var(--muted);font-size:12px;font-family:Tajawal,sans-serif;cursor:pointer">تخطي</button>
        <button onclick="_lpConfirmGoal('${matchId}','${side}')" style="flex:2;padding:12px;background:linear-gradient(135deg,var(--gold2),var(--gold));border:none;border-radius:12px;color:#000;font-size:13px;font-weight:900;font-family:Tajawal,sans-serif;cursor:pointer">✅︎ هدف!</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('lp-sp-input-' + matchId)?.focus(), 100);

  // ✅︎ لاعبو هذا الفريق فقط من القائمة الدائمة المسجَّلة — ممنوع ظهور لاعب من الفريق الآخر
  // ✅︎ ونستبعد من طُرد ببطاقة حمراء بالفعل في هذه المباراة
  const roster = teamId ? await window._loadTeamRoster(teamId) : [];
  const st = _liveMatches[matchId];
  const excludeNames = window._redCardedNames(st?.events, side);
  const box = document.getElementById('lp-sp-roster-' + matchId);
  if (box) box.innerHTML = window._renderRosterPickButtons(roster, 'lp-sp-input-' + matchId, excludeNames);
}

window._lpConfirmGoal = async function(matchId, side) {
  const name = (document.getElementById('lp-sp-input-' + matchId)?.value || '').trim();
  document.getElementById('lp-scorer-overlay-' + matchId)?.remove();
  await _lpCommitGoal(matchId, side, name || null, 1);
};

window.lpRemoveGoalNoScorer = async function(matchId, side) {
  await _lpCommitGoal(matchId, side, null, 1);
};

async function _lpCommitGoal(matchId, side, playerName, count) {
  const st = _liveMatches[matchId];
  if (!st) return;
  if (side === 'home') st.homeScore += count;
  else st.awayScore += count;
  const shEl = document.getElementById('lp-sh-' + matchId);
  const saEl = document.getElementById('lp-sa-' + matchId);
  if (shEl) shEl.textContent = st.homeScore;
  if (saEl) saEl.textContent = st.awayScore;

  if (playerName) {
    const match = matches.find(m => m.id === matchId);
    const ht = teams.find(t => t.id === match?.homeId) || {};
    const at = teams.find(t => t.id === match?.awayId) || {};
    const teamName = side === 'home' ? (ht.name || 'الأول') : (at.name || 'الثاني');
    for (let i = 0; i < count; i++) {
      // ✅︎ دقيقة الحدث من المصدر الموحّد — تحترم إزاحة الشوط (48' وليس 45'+3)
      const _evM = window._evMinute(st);
      const _evBaseMin  = _evM.minute;
      const _evExtra    = _evM.extraMinute;
      const _evHalfKey  = st.matchStatus==='extratime1'?'et1':st.matchStatus==='extratime2'?'et2':st.currentHalf;
      // ✅︎ هوية اللاعب — تمنع دمج لاعبين بنفس الاسم في الهدافين
      const _evTeamId = side === 'home' ? match?.homeId : match?.awayId;
      const _evId     = window._resolvePlayerId
        ? window._resolvePlayerId(_evTeamId, playerName, matchId, side) : {};
      st.events.unshift({
        id: Date.now() + i, type: 'goal', icon: '⚽', label: 'هدف',
        team: side, teamName, player: playerName,
        teamId: _evTeamId || null,
        playerId: _evId.playerId || null,
        playerNumber: _evId.number != null ? _evId.number : null,
        minute: _evBaseMin || '?',
        extraMinute: _evExtra,
        half: _evHalfKey,
        note: '', time: new Date().toLocaleTimeString('ar')
      });
    }
    _lpRenderEvents(matchId);
  }
  await _lpSave(matchId);
  showToast('⚽ هدف!' + (playerName ? ' · ' + playerName : ''), 'success');
}

window.lpRemoveGoal = async function(matchId, side) {
  const st = _liveMatches[matchId];
  if (!st) return;
  if (side === 'home' && st.homeScore > 0) st.homeScore--;
  else if (side === 'away' && st.awayScore > 0) st.awayScore--;
  const shEl = document.getElementById('lp-sh-' + matchId);
  const saEl = document.getElementById('lp-sa-' + matchId);
  if (shEl) shEl.textContent = st.homeScore;
  if (saEl) saEl.textContent = st.awayScore;
  await _lpSave(matchId);
};

// ─────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────
window._lpCurrentEventType = {};
window._lpCurrentEventIcon = {};
window._lpCurrentEventLabel = {};

window.lpOpenEvent = function(matchId, type, icon, label) {
  window._lpCurrentEventType[matchId] = type;
  window._lpCurrentEventIcon[matchId] = icon;
  window._lpCurrentEventLabel[matchId] = label;
  const modal = document.getElementById('lp-evmodal-' + matchId);
  const titleEl = document.getElementById('lp-evmodal-title-' + matchId);
  const player2Row = document.getElementById('lp-evplayer2row-' + matchId);
  const playerRow = document.getElementById('lp-evplayerrow-' + matchId);
  const subPicker = document.getElementById('lp-evsubpicker-' + matchId);
  const minEl = document.getElementById('lp-evmin-' + matchId);
  const playerEl = document.getElementById('lp-evplayer-' + matchId);
  const noteEl = document.getElementById('lp-evnote-' + matchId);
  const st = _liveMatches[matchId];
  if (titleEl) titleEl.textContent = icon + ' ' + label;

  const isSub = (type === 'sub');
  // في التبديل: نُخفي الحقول النصية ونعرض منتقي الأساسي/الدكة
  if (playerRow)  playerRow.style.display  = isSub ? 'none' : '';
  if (player2Row) player2Row.style.display = 'none'; // لم نعد نستخدم الحقل النصّي للداخل
  if (subPicker) {
    subPicker.style.display = isSub ? 'block' : 'none';
    if (isSub && window._subBuildPickerHtml) {
      window._subResetSelection && window._subResetSelection();
      const team = document.getElementById('lp-evteam-' + matchId)?.value || 'home';
      subPicker.innerHTML = window._subBuildPickerHtml(matchId, team);
      window._lpSubMatchId = matchId; // ليعرف مستمع الفريق أي مباراة يعيد بناءها
    }
  }
  if (minEl) minEl.value = st ? Math.floor(st.timerSeconds / 60) : '';
  if (playerEl) playerEl.value = '';
  if (noteEl) noteEl.value = '';
  if (modal) modal.style.display = 'flex';
};

// إعادة بناء منتقي التبديل عند تغيير الفريق داخل النافذة
window._lpOnTeamChange = function(matchId) {
  if (window._lpCurrentEventType[matchId] !== 'sub') return;
  const subPicker = document.getElementById('lp-evsubpicker-' + matchId);
  if (subPicker && window._subBuildPickerHtml) {
    window._subResetSelection && window._subResetSelection();
    const team = document.getElementById('lp-evteam-' + matchId)?.value || 'home';
    subPicker.innerHTML = window._subBuildPickerHtml(matchId, team);
  }
};

window.lpCloseEventModal = function(matchId) {
  const modal = document.getElementById('lp-evmodal-' + matchId);
  if (modal) modal.style.display = 'none';
};

window.lpConfirmEvent = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const match = matches.find(m => m.id === matchId);
  const type = window._lpCurrentEventType[matchId] || 'goal';
  const icon = window._lpCurrentEventIcon[matchId] || '⚽';
  const label = window._lpCurrentEventLabel[matchId] || 'حدث';
  const team = document.getElementById('lp-evteam-' + matchId)?.value || 'home';
  let player = document.getElementById('lp-evplayer-' + matchId)?.value.trim() || '—';
  let player2 = document.getElementById('lp-evplayer2-' + matchId)?.value.trim() || '';

  // ── التبديل: اقرأ الاختيار من منتقي الأساسي/الدكة ──
  if (type === 'sub') {
    const sel = window._subSelected || { out: '', in: '' };
    const out = (sel.out || '').trim();
    const inp = (sel.in || '').trim();
    if (!out || !inp) {
      showToast('اختر لاعباً خارجاً ولاعباً داخلاً', 'error');
      return;
    }
    player  = out;   // اللاعب الخارج (المتوافق مع الأنظمة القديمة)
    player2 = inp;   // اللاعب الداخل
  }

  const minute = document.getElementById('lp-evmin-' + matchId)?.value || '?';
  const note = document.getElementById('lp-evnote-' + matchId)?.value.trim() || '';
  const ht = teams.find(t => t.id === match?.homeId) || {};
  const at = teams.find(t => t.id === match?.awayId) || {};
  const teamName = team === 'home' ? (ht.name || 'الأول') : (at.name || 'الثاني');

  // ✅︎ دقيقة الحدث من المصدر الموحّد
  const _evM2 = window._evMinute(st);
  const _evManual   = parseInt(minute);
  const _evBaseMin2 = !isNaN(_evManual) ? _evManual : _evM2.minute;
  const _evExtra2   = !isNaN(_evManual) ? 0 : _evM2.extraMinute;
  const _evHalfKey2 = st.matchStatus==='extratime1'?'et1':st.matchStatus==='extratime2'?'et2':st.currentHalf;
  const _evTeamId2 = team === 'home' ? match?.homeId : match?.awayId;
  const _evId2 = window._resolvePlayerId
    ? window._resolvePlayerId(_evTeamId2, player, matchId, team) : {};
  const ev = { id: Date.now(), type, icon, label, team, teamName, player, player2,
    teamId: _evTeamId2 || null,
    playerId: _evId2.playerId || null,
    playerNumber: _evId2.number != null ? _evId2.number : null,
    minute: _evBaseMin2 || minute || '?',
    extraMinute: _evExtra2,
    half: _evHalfKey2,
    note, time: new Date().toLocaleTimeString('ar') };
  // حقول منظّمة للتبديل (تُستخدم في عرض الجمهور والتشكيلة)
  if (type === 'sub') { ev.playerOut = player; ev.playerIn = player2; }
  st.events.unshift(ev);

  if (type === 'goal') {
    if (team === 'home') { st.homeScore++; const el = document.getElementById('lp-sh-' + matchId); if (el) el.textContent = st.homeScore; }
    else { st.awayScore++; const el = document.getElementById('lp-sa-' + matchId); if (el) el.textContent = st.awayScore; }
  }

  _lpRenderEvents(matchId);
  lpCloseEventModal(matchId);
  await _lpSave(matchId);
  showToast(icon + ' تم التسجيل', 'success');
};

window._lpRenderEvents = function _lpRenderEvents(matchId) {
  const container = document.getElementById('lp-events-list-' + matchId);
  if (!container) return;
  const st = _liveMatches[matchId];
  const events = st?.events || [];
  if (!events.length) {
    container.innerHTML = '<div class="lp-no-events">لا توجد أحداث بعد</div>';
    return;
  }
  container.innerHTML = events.map(ev => {
    const desc = ev.type === 'sub'
      ? `<span style="color:#e05252">${window.Icon?window.Icon('download',10):''} ${ev.playerOut || ev.player || ''}</span> <span style="color:#2ecc71">${window.Icon?window.Icon('upload',10):''} ${ev.playerIn || ev.player2 || ''}</span> · ${ev.teamName || ''}`
      : `<strong>${ev.player}</strong>${ev.player2 ? ' ← ' + ev.player2 : ''} · ${ev.teamName || ''}`;
    return `
    <div class="lp-ev-item">
      <div class="lp-ev-min">${ev.minute}'</div>
      <div class="lp-ev-icon">${ev.icon}</div>
      <div class="lp-ev-desc">${desc}</div>
      <button class="lp-ev-del" onclick="lpDeleteEvent('${matchId}',${ev.id})">✕</button>
    </div>`;
  }).join('');
}

window.lpDeleteEvent = async function(matchId, id) {
  const st = _liveMatches[matchId];
  if (!st) return;
  st.events = st.events.filter(e => e.id !== id);
  _lpRenderEvents(matchId);
  await _lpSave(matchId);
};

window.lpClearEvents = async function(matchId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'مسح كل الأحداث؟', confirmText: '🗑 نعم، احذف', danger: true }))) return;
  const st = _liveMatches[matchId];
  if (!st) return;
  st.events = [];
  _lpRenderEvents(matchId);
  await _lpSave(matchId);
};

// ─────────────────────────────────────────────────────────────────
// STREAM
// ─────────────────────────────────────────────────────────────────
window.lpSetPlatform = function(matchId, platform) {
  const st = _liveMatches[matchId];
  if (!st) return;
  st.streamPlatform = platform;
  const platforms = { youtube: 'lp-plt-yt', facebook: 'lp-plt-fb', twitch: 'lp-plt-tw', other: 'lp-plt-ot' };
  Object.entries(platforms).forEach(([k, id]) => {
    const el = document.getElementById(id + '-' + matchId);
    if (el) el.className = 'lp-plt' + (k === platform ? ' lp-plt-active' : '');
  });
};

window.lpActivateStream = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const url = document.getElementById('lp-stream-url-' + matchId)?.value.trim();
  if (!url) { showToast('أدخل رابط البث أولاً', 'error'); return; }
  st.streamUrl = url;
  st.streamActive = true;
  const bar = document.getElementById('lp-stream-bar-' + matchId);
  if (bar) bar.style.display = 'flex';
  await _lpSave(matchId);
  showToast('📡 تم تفعيل البث!', 'success');
};

window.lpStopStream = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  st.streamActive = false;
  const bar = document.getElementById('lp-stream-bar-' + matchId);
  if (bar) bar.style.display = 'none';
  await _lpSave(matchId);
  showToast('تم إيقاف البث', 'success');
};

// ─────────────────────────────────────────────────────────────────
// LINEUP
// ─────────────────────────────────────────────────────────────────
const LP_FORMATIONS = { '4-3-3':11, '4-4-2':11, '4-2-3-1':11, '3-5-2':11, '5-3-2':11 };
const LP_POS_AR = {
  GK:'حارس', CB:'مدافع', LB:'ظهير أيسر', RB:'ظهير أيمن',
  CM:'وسط', CAM:'مهاجم وسط', CDM:'حاجب',
  LW:'جناح أيسر', RW:'جناح أيمن', ST:'مهاجم', CF:'مهاجم إضافي'
};

window.lpLineupTab = function(matchId, side, btn) {
  window._lpLineupSide[matchId] = side;
  const tabs = document.querySelectorAll(`#lp-ltab-h-${matchId}, #lp-ltab-a-${matchId}`);
  tabs.forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _lpRenderLineupPlayers(matchId);
};

window.lpSetFormation = function(matchId, f, btn) {
  window._lpLineupFormation[matchId] = f;
  document.querySelectorAll('#lp-formations-' + matchId + ' .lp-f-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _lpRenderLineupPlayers(matchId);
};

function _lpRenderLineupPlayers(matchId) {
  const container = document.getElementById('lp-lineup-players-' + matchId);
  if (!container) return;
  const side = (window._lpLineupSide && window._lpLineupSide[matchId]) || 'home';
  const st = _liveMatches[matchId];
  const saved = side === 'home' ? st?.homeLineup : st?.awayLineup;
  const savedPlayers = saved?.players || [];
  const total = 16; // 11 أساسي + 5 بدلاء
  let html = '';
  for (let i = 0; i < total; i++) {
    const isSub = i >= 11;
    const p = savedPlayers[i] || {};
    html += `<div class="lp-lp-row">
      <div class="lp-lp-idx" style="color:${isSub?'var(--muted)':'var(--gold)'}">${isSub ? 'B'+(i-10) : i+1}</div>
      <input type="number" placeholder="#" min="1" max="99" id="lp-lnum-${i}-${matchId}" value="${p.number||''}" class="lp-lp-num"/>
      <input type="text" placeholder="${isSub ? 'بديل '+(i-10) : 'اسم اللاعب'}" id="lp-lname-${i}-${matchId}" value="${p.name||''}" class="lp-lp-name"/>
      <select id="lp-lpos-${i}-${matchId}" class="lp-lp-pos">
        ${Object.entries(LP_POS_AR).map(([k,v])=>`<option value="${k}" ${p.posKey===k?'selected':''}>${v}</option>`).join('')}
      </select>
    </div>`;
  }
  container.innerHTML = html;
}

window.lpSaveLineup = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const side = (window._lpLineupSide && window._lpLineupSide[matchId]) || 'home';
  const formation = (window._lpLineupFormation && window._lpLineupFormation[matchId]) || '4-3-3';
  const players = [];
  for (let i = 0; i < 16; i++) {
    const name = document.getElementById(`lp-lname-${i}-${matchId}`)?.value.trim() || '';
    const num = document.getElementById(`lp-lnum-${i}-${matchId}`)?.value || '';
    const posKey = document.getElementById(`lp-lpos-${i}-${matchId}`)?.value || 'CM';
    if (name) players.push({ number: num, name, position: LP_POS_AR[posKey] || posKey, posKey, isSub: i >= 11 });
  }
  const lineupObj = { formation, players, updatedAt: Date.now() };
  if (side === 'home') st.homeLineup = lineupObj;
  else st.awayLineup = lineupObj;
  await _lpSave(matchId);
  showToast('✅︎ تم حفظ تشكيلة ' + (side === 'home' ? 'المضيف' : 'الضيف'), 'success');
};

// ─────────────────────────────────────────────────────────────────
// SAVE TO FIREBASE — يحفظ في matches/{matchId}.liveData
// ─────────────────────────────────────────────────────────────────
// ✅︎ مؤشر حالة الحفظ الموحّد لصفحة البث — يوضح للإدارة هل التغييرات محفوظة فعلاً على الخادم أو لا،
// خصوصاً مهم أثناء البث حيث انقطاع الاتصال اللحظي قد يُضيّع حدثاً (هدف/بطاقة) دون أن يلاحظ أحد.
window._lpSetSaveState = function(matchId, state, text) {
  const el = document.getElementById('lp-save-' + matchId);
  if (!el) return;
  el.classList.remove('lp-save-saving', 'lp-save-ok', 'lp-save-err');
  if (state === 'saving') { el.classList.add('lp-save-saving'); el.textContent = text || '💾 يحفظ...'; }
  else if (state === 'ok') { el.classList.add('lp-save-ok'); el.textContent = text || '✅︎ تم الحفظ'; }
  else if (state === 'err') { el.classList.add('lp-save-err'); el.textContent = text || '❌︎ فشل الحفظ — سيُعاد المحاولة'; }
  else { el.textContent = text || 'متصل'; }
};

async function _lpSave(matchId) {
  const st = _liveMatches[matchId];
  if (!st || !LEAGUE_ID) return;
  window._lpSetSaveState(matchId, 'saving');

  const liveData = {
    matchId,
    homeScore: st.homeScore,
    awayScore: st.awayScore,
    timerSeconds: st.timerSeconds,
    /* ✅︎ FIX 1 — حالة الإيقاف. بدونها كان updateDoc({liveData}) يستبدل الكائن
       كاملاً فتُحذف من الخادم، فتنطلق ساعة الجمهور بينما الأدمن متجمّد،
       ويختفي سبب الإيقاف. أي هدف/بطاقة أثناء التوقف كان يفجّر الساعة. */
    phaseSeconds: st.phaseSeconds != null ? st.phaseSeconds : (st.timerSeconds || 0),
    timerPaused:  st.timerPaused || false,
    pausedAt:     st.pausedAt || null,
    pauseReason:  st.pauseReason || '',
    matchStatus: st.matchStatus,
    currentHalf: st.currentHalf,
    half1StartedAt: st.half1StartedAt || null,
    half2StartedAt: st.half2StartedAt || null,
    // ✅︎ المدد دائماً من الإعدادات — لا رقم ثابت
    et1StartedAt: st.et1StartedAt || null,
    et2StartedAt: st.et2StartedAt || null,
    halftimeStartedAt: st.halftimeStartedAt || null,
    half1ExtraMinutes: st.half1ExtraMinutes ?? st.half1Extra ?? 0,
    half2ExtraMinutes: st.half2ExtraMinutes ?? st.half2Extra ?? 0,
    et1ExtraMinutes:   st.et1ExtraMinutes   ?? st.et1Extra   ?? 0,
    et2ExtraMinutes:   st.et2ExtraMinutes   ?? st.et2Extra   ?? 0,
    half1ExtraSet: !!st.half1ExtraSet, half2ExtraSet: !!st.half2ExtraSet,
    et1ExtraSet:   !!st.et1ExtraSet,   et2ExtraSet:   !!st.et2ExtraSet,
    ...(() => { const c = _getCfg(matchId); return {
      halfDuration:  c.half1Duration,
      half1Duration: c.half1Duration,
      half2Duration: c.half2Duration,
      et1Duration:   c.et1Duration,
      et2Duration:   c.et2Duration,
      breakDuration: c.breakDuration,
    }; })(),
    period: (() => {
      if (st.matchStatus === 'halftime') return 'استراحة نصف الوقت';
      if (st.matchStatus === 'ended') return 'انتهت المباراة';
      return st.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول';
    })(),
    events: st.events,
    streamUrl: st.streamUrl || '',
    streamActive: st.streamActive || false,
    streamPlatform: st.streamPlatform || 'youtube',
    homeLineup: st.homeLineup || null,
    awayLineup: st.awayLineup || null,
    leagueId: LEAGUE_ID,
    updatedAt: serverTimestamp(),
  };

  // أيضاً نحدّث الحقول الجانبية من الفورم
  const extraData = {
    date: document.getElementById('lp-date-' + matchId)?.value || '',
    time: document.getElementById('lp-time-' + matchId)?.value || '',
    venue: document.getElementById('lp-venue-' + matchId)?.value || '',
    round: parseInt(document.getElementById('lp-round-' + matchId)?.value || 1),
    referee: document.getElementById('lp-referee-' + matchId)?.value.trim() || '',
    linesman1: document.getElementById('lp-lns1-' + matchId)?.value.trim() || '',
    linesman2: document.getElementById('lp-lns2-' + matchId)?.value.trim() || '',
    commentator: document.getElementById('lp-comm-' + matchId)?.value.trim() || '',
    sponsor: document.getElementById('lp-sponsor-' + matchId)?.value.trim() || '',
    photographer: document.getElementById('lp-photo-' + matchId)?.value.trim() || '',
    announcer: document.getElementById('lp-ann-' + matchId)?.value.trim() || '',
    manOfMatch: document.getElementById('lp-mom-' + matchId)?.value.trim() || '',
    attendance: document.getElementById('lp-att-' + matchId)?.value || '',
    notes: document.getElementById('lp-notes-' + matchId)?.value.trim() || '',
  };

  // حدّث status المباراة
  let matchStatus = 'upcoming';
  if (st.matchStatus === 'live' || st.matchStatus === 'halftime') matchStatus = 'live';
  else if (st.matchStatus === 'ended') matchStatus = 'finished';

  try {
    /* ✅︎ FIX 9 — هوية الكاتب (نفس منطق _lpSaveV2) */
    liveData.writerId = window._LP_SESSION || null;
    liveData.writerAt = Date.now();
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), {
      liveData,
      ...extraData,
      status: matchStatus,
      homeScore: st.matchStatus === 'ended' ? st.homeScore : null,
      awayScore: st.matchStatus === 'ended' ? st.awayScore : null,
      updatedAt: serverTimestamp(),
    });
    window._lpSetSaveState(matchId, 'ok');
    setTimeout(() => { const e2 = document.getElementById('lp-save-' + matchId); if (e2 && !e2.classList.contains('lp-save-saving')) window._lpSetSaveState(matchId, 'idle'); }, 3000);
  } catch(e) {
    window._lpSetSaveState(matchId, 'err');
    showToast('خطأ في الحفظ: ' + e.message, 'error');
  }
}

window.lpSaveAll = function(matchId) { _lpSave(matchId); showToast('💾 جاري الحفظ...', 'success'); };

// Auto-save كل 15 ثانية للمباريات المباشرة
setInterval(() => {
  Object.keys(_liveMatches).forEach(matchId => {
    const st = _liveMatches[matchId];
    if (st && (st.matchStatus === 'live' || st.matchStatus === 'halftime')) {
      _lpSave(matchId);
    }
  });
}, 15000);

// ─────────────────────────────────────────────────────────────────
// CSS — صفحة البث
// ─────────────────────────────────────────────────────────────────
(function injectLivePageCSS() {
  if (document.getElementById('_lp_css')) return;
  const s = document.createElement('style');
  s.id = '_lp_css';
  s.textContent = `
    @keyframes lp-save-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    .live-page-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 5000;
      background: var(--bg, #080808);
      overflow-y: auto;
      flex-direction: column;
      font-family: 'Tajawal', sans-serif;
    }
    .live-page-overlay.lp-active { display: flex; flex-direction: column; }

    .lp-topbar {
      display: flex; align-items: center; gap: 12px;
      background: linear-gradient(135deg,#0d0a00,#0a0a0a);
      border-bottom: 1px solid var(--gold3, #3a2e00);
      padding: 14px 16px; position: sticky; top: 0; z-index: 100;
    }
    .lp-close-btn {
      background: var(--card3,#1a1a1a); border: 1px solid var(--border2,#2a2a2a);
      color: var(--muted,#666); border-radius: 8px; padding: 7px 12px;
      font-family: Tajawal,sans-serif; font-size: 12px; cursor: pointer; white-space: nowrap;
    }
    .lp-close-btn:hover { border-color: var(--red,#C0392B); color: var(--red,#C0392B); }
    .lp-title { flex: 1; font-size: 13px; font-weight: 900; color: var(--gold,#C9A02B); }
    .lp-save-indicator {
      font-size: 11px; font-weight: 800; min-width: 70px; text-align: center;
      padding: 4px 10px; border-radius: 20px; white-space: nowrap;
      background: rgba(255,255,255,.06); color: var(--muted,#888); border: 1px solid rgba(255,255,255,.1);
      transition: background .2s, color .2s, border-color .2s;
    }
    .lp-save-indicator.lp-save-saving { background: rgba(201,160,43,.12); color: #C9A02B; border-color: rgba(201,160,43,.35); animation: lp-save-pulse 1s infinite; }
    .lp-save-indicator.lp-save-ok     { background: rgba(39,174,96,.12);  color: #27ae60; border-color: rgba(39,174,96,.35); }
    .lp-save-indicator.lp-save-err    { background: rgba(192,57,43,.14); color: #ff6b5b; border-color: rgba(192,57,43,.4); }

    .lp-body {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 16px; padding: 16px; flex: 1;
    }
    @media (max-width: 800px) {
      .lp-body { grid-template-columns: 1fr; }
    }

    /* Scoreboard */
    .lp-scoreboard {
      background: linear-gradient(135deg,#0d0a00,#111);
      border: 1px solid var(--gold3,#3a2e00); border-radius: 18px;
      padding: 20px; margin-bottom: 14px;
    }
    .lp-sb-toprow { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .lp-status-badge {
      padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;
      background: var(--card3,#1a1a1a); border: 1px solid var(--border2,#2a2a2a); color: var(--muted,#666);
    }
    .lp-status-badge.lp-s-live { background: rgba(220,50,50,.15); border-color: rgba(220,50,50,.4); color: #C0392B; }
    .lp-status-badge.lp-s-half { background: rgba(243,156,18,.1); border-color: rgba(243,156,18,.3); color: #D35400; }
    .lp-status-badge.lp-s-ended { background: rgba(39,174,96,.1); border-color: rgba(39,174,96,.3); color: #27ae60; }
    .lp-period { font-size: 11px; color: var(--muted,#666); }

    .lp-sb-teams { display: flex; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 16px; }
    .lp-sb-team { text-align: center; flex: 1; }
    .lp-team-logo { display: flex; justify-content: center; align-items: center; margin-bottom: 8px; }
    .lp-team-name { font-size: 13px; font-weight: 900; color: var(--text,#eee); }
    .lp-sb-center { text-align: center; }
    .lp-score-row { display: flex; align-items: center; gap: 10px; justify-content: center; }
    .lp-score { font-size: 52px; font-weight: 900; color: var(--gold,#C9A02B); font-family: 'Tajawal',sans-serif; min-width: 60px; text-align: center; }
    .lp-score-sep { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .lp-score-sep span { font-size: 28px; color: var(--muted,#666); }
    .lp-timer-display { font-size: 16px; font-weight: 900; color: var(--gold,#C9A02B); font-family: 'Tajawal',sans-serif; }
    .lp-extra-time { font-size: 12px; font-weight: 900; color: #f97316; }
    /* ✅︎ تنسيق بدل الضائع: +5 و +2:14 جنب بعض فوق · 45:00 تحت */
    .lp-extra-time { align-items:center; justify-content:center; gap:5px; line-height:1; margin-bottom:2px; white-space:nowrap; }
    .lp-add-min { display:inline-block; font-size:10px; font-weight:900; color:#fff; background:#f97316; border-radius:5px; padding:1px 6px; line-height:1.5; letter-spacing:.3px; }
    .lp-stop-t  { display:inline-block; font-size:12px; font-weight:900; color:#D35400; font-variant-numeric:tabular-nums; }
    .lp-btn-addtime { background:rgba(249,115,22,.12); border:1px solid rgba(249,115,22,.35); color:#f97316; }
    .lp-btn-addtime:active { background:rgba(249,115,22,.22); }

    /* Time controls */
    .lp-time-controls { display: flex; flex-wrap: wrap; gap: 8px; }
    .lp-btn { padding: 10px 16px; border-radius: 10px; font-family: Tajawal,sans-serif; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid; transition: all .15s; }
    .lp-btn-start { background: linear-gradient(135deg,#1a4a1a,#27ae60); border-color: #27ae60; color: #fff; }
    .lp-btn-pause { background: rgba(243,156,18,.1); border-color: #D35400; color: #D35400; }
    /* ✅︎ زر الاستئناف — أخضر واضح ونابض ليدل أن المباراة متوقفة */
    .lp-btn-resume { background: rgba(39,174,96,.15); border: 1px solid rgba(39,174,96,.5); color:#27ae60; animation: lpPulse 1.6s ease-in-out infinite; }
    @keyframes lpPulse { 0%,100%{opacity:1} 50%{opacity:.62} }
    .lp-btn-ht { background: var(--card2,#111); border-color: var(--border2,#2a2a2a); color: var(--muted,#666); }
    .lp-btn-et { background: var(--card2,#111); border-color: var(--border2,#2a2a2a); color: var(--muted,#666); }
    .lp-btn-end { background: rgba(220,50,50,.1); border-color: rgba(220,50,50,.4); color: #C0392B; }
    .lp-btn:hover { filter: brightness(1.2); }

    /* Score controls */
    .lp-score-controls { background: var(--card,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
    .lp-sc-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border,#1a1a1a); }
    .lp-sc-row:last-child { border-bottom: none; }
    .lp-sc-team { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--text,#eee); flex: 1; }
    .lp-sc-btns { display: flex; gap: 8px; }
    .lp-sc-plus { width: 40px; height: 40px; background: linear-gradient(135deg,rgba(39,174,96,.2),rgba(39,174,96,.1)); border: 1px solid rgba(39,174,96,.4); border-radius: 10px; color: #27ae60; font-size: 20px; font-weight: 900; cursor: pointer; }
    .lp-sc-minus { width: 40px; height: 40px; background: rgba(220,50,50,.1); border: 1px solid rgba(220,50,50,.3); border-radius: 10px; color: #C0392B; font-size: 20px; cursor: pointer; }

    /* Events grid */
    .lp-events-grid { background: var(--card,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
    .lp-eg-label { font-size: 11px; font-weight: 700; color: var(--muted2,#555); letter-spacing: 1px; margin-bottom: 10px; }
    .lp-eg-btns { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
    .lp-ev-btn { padding: 10px 6px; border-radius: 10px; font-family: Tajawal,sans-serif; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid; text-align: center; }
    .lp-ev-goal { background: rgba(39,174,96,.08); border-color: rgba(39,174,96,.25); color: #27ae60; }
    .lp-ev-yellow { background: rgba(243,156,18,.08); border-color: rgba(243,156,18,.25); color: #D35400; }
    .lp-ev-red { background: rgba(220,50,50,.08); border-color: rgba(220,50,50,.25); color: #C0392B; }
    .lp-ev-sub { background: rgba(52,152,219,.08); border-color: rgba(52,152,219,.25); color: #2980B9; }
    .lp-ev-inj { background: rgba(155,89,182,.08); border-color: rgba(155,89,182,.25); color: #9b59b6; }
    .lp-ev-var { background: rgba(127,140,141,.08); border-color: rgba(127,140,141,.25); color: #7f8c8d; }

    /* Events log */
    .lp-events-log { background: var(--card,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
    .lp-log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 11px; font-weight: 700; color: var(--muted2,#555); }
    .lp-clear-btn { background: transparent; border: 1px solid var(--border2,#2a2a2a); color: var(--muted,#666); border-radius: 6px; padding: 3px 8px; font-size: 10px; cursor: pointer; font-family: Tajawal,sans-serif; }
    .lp-events-list { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .lp-ev-item { display: grid; grid-template-columns: 28px 24px 1fr 22px; align-items: center; gap: 6px; background: var(--card2,#111); border-radius: 8px; padding: 7px 8px; }
    .lp-ev-min { font-size: 10px; font-weight: 700; color: var(--gold,#C9A02B); }
    .lp-ev-icon { font-size: 14px; text-align: center; }
    .lp-ev-desc { font-size: 12px; color: var(--text,#eee); }
    .lp-ev-del { background: none; border: none; color: var(--muted,#666); cursor: pointer; font-size: 11px; padding: 2px; }
    .lp-ev-del:hover { color: var(--red,#C0392B); }
    .lp-no-events { text-align: center; padding: 16px; color: var(--muted,#666); font-size: 11px; }

    /* Stream */
    .lp-stream-section { background: var(--card,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
    .lp-stream-label { font-size: 11px; font-weight: 700; color: var(--muted2,#555); letter-spacing: 1px; margin-bottom: 10px; }
    .lp-platforms { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .lp-plt { padding: 7px 12px; border-radius: 9px; font-family: Tajawal,sans-serif; font-size: 11px; font-weight: 700; cursor: pointer; background: var(--card2,#111); border: 1px solid var(--border2,#2a2a2a); color: var(--muted,#666); transition: all .15s; }
    .lp-plt.lp-plt-active, .lp-plt.sel-yt { border-color: var(--gold,#C9A02B); color: var(--gold,#C9A02B); background: var(--gold2,rgba(201,160,43,.08)); }
    .lp-stream-input { width: 100%; box-sizing: border-box; background: var(--card2,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 10px; padding: 10px 12px; color: var(--text,#eee); font-family: Tajawal,sans-serif; font-size: 12px; margin-bottom: 6px; }
    .lp-stream-hint { font-size: 10px; color: var(--muted,#666); margin-bottom: 10px; }
    .lp-stream-activate { width: 100%; padding: 11px; background: linear-gradient(135deg,rgba(220,50,50,.15),rgba(220,50,50,.08)); border: 1px solid rgba(220,50,50,.35); border-radius: 10px; color: #C0392B; font-family: Tajawal,sans-serif; font-size: 12px; font-weight: 700; cursor: pointer; }
    .lp-stream-active-bar { display: flex; align-items: center; gap: 8px; background: rgba(39,174,96,.08); border: 1px solid rgba(39,174,96,.25); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
    .lp-stream-dot { width: 8px; height: 8px; border-radius: 50%; background: #27ae60; animation: pulse 1.5s infinite; }
    .lp-stream-active-bar span { flex: 1; font-size: 12px; color: #27ae60; }
    .lp-stream-active-bar button { background: transparent; border: 1px solid rgba(220,50,50,.3); color: #C0392B; border-radius: 7px; padding: 4px 10px; font-family: Tajawal,sans-serif; font-size: 11px; cursor: pointer; }

    /* Side cards */
    .lp-col-side { display: flex; flex-direction: column; gap: 12px; }
    .lp-info-card { background: var(--card,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 14px; padding: 14px; }
    .lp-ic-title { font-size: 11px; font-weight: 700; color: var(--gold,#C9A02B); letter-spacing: 1px; margin-bottom: 12px; }
    .lp-ic-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    .lp-ic-row label { font-size: 10px; color: var(--muted,#666); }
    .lp-ic-input { background: var(--card2,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 8px; padding: 8px 10px; color: var(--text,#eee); font-family: Tajawal,sans-serif; font-size: 12px; width: 100%; box-sizing: border-box; }
    .lp-ic-input:focus { border-color: var(--gold3,#3a2e00); outline: none; }

    /* Lineup */
    .lp-lineup-tabs { display: flex; gap: 8px; margin-bottom: 10px; }
    .lp-ltab { flex: 1; padding: 7px; border: 1px solid var(--border2,#2a2a2a); border-radius: 8px; background: transparent; color: var(--muted,#666); font-family: Tajawal,sans-serif; font-size: 11px; cursor: pointer; }
    .lp-ltab.active { border-color: var(--gold,#C9A02B); color: var(--gold,#C9A02B); background: var(--gold2,rgba(201,160,43,.08)); }
    .lp-lineup-formations { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
    .lp-f-btn { padding: 4px 9px; border: 1px solid var(--border2,#2a2a2a); border-radius: 6px; background: var(--card2,#111); color: var(--muted,#666); font-size: 10px; cursor: pointer; font-family: Tajawal,sans-serif; }
    .lp-f-btn.active { border-color: var(--gold,#C9A02B); color: var(--gold,#C9A02B); background: var(--gold2,rgba(201,160,43,.08)); }
    .lp-lineup-players { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; margin-bottom: 10px; }
    .lp-lp-row { display: grid; grid-template-columns: 22px 32px 1fr 60px; gap: 4px; align-items: center; }
    .lp-lp-idx { font-size: 9px; font-weight: 700; text-align: center; }
    .lp-lp-num { background: var(--card2,#111); border: 1px solid var(--border,#1a1a1a); border-radius: 6px; padding: 5px 3px; color: var(--text,#eee); font-family: Tajawal,sans-serif; font-size: 11px; text-align: center; width: 100%; }
    .lp-lp-name { background: var(--card2,#111); border: 1px solid var(--border,#1a1a1a); border-radius: 6px; padding: 5px 6px; color: var(--text,#eee); font-family: Tajawal,sans-serif; font-size: 11px; width: 100%; }
    .lp-lp-pos { background: var(--card2,#111); border: 1px solid var(--border,#1a1a1a); border-radius: 6px; padding: 5px 2px; color: var(--muted,#666); font-family: Tajawal,sans-serif; font-size: 9px; }
    .lp-btn-lineup-save { width: 100%; padding: 10px; background: linear-gradient(135deg,rgba(201,160,43,.1),rgba(201,160,43,.06)); border: 1px solid var(--gold3,#3a2e00); color: var(--gold,#C9A02B); border-radius: 10px; font-family: Tajawal,sans-serif; font-size: 12px; font-weight: 700; cursor: pointer; }
    .lp-btn-save-all { padding: 13px; background: linear-gradient(135deg,var(--gold2,rgba(201,160,43,.2)),var(--gold3,#3a2e00)); border: 1px solid var(--gold,#C9A02B); color: var(--gold,#C9A02B); border-radius: 12px; font-family: Tajawal,sans-serif; font-size: 13px; font-weight: 900; cursor: pointer; width: 100%; }

    /* Modals */
    .lp-event-modal, .lp-addtime-modal {
      position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.7);
      backdrop-filter: blur(4px); align-items: flex-end; justify-content: center;
    }
    .lp-event-modal { display: none; }
    .lp-addtime-modal { display: none; }
    .lp-evmodal-box, .lp-atmodal-box {
      background: var(--card,#111); border: 1px solid var(--gold3,#3a2e00);
      border-radius: 20px 20px 0 0; width: 100%; max-width: 480px;
      padding: 20px 20px 36px; display: flex; flex-direction: column; gap: 12px;
    }
    .lp-evmodal-title, .lp-atmodal-title { font-size: 16px; font-weight: 900; color: var(--gold,#C9A02B); text-align: center; font-family: Tajawal,sans-serif; }
    .lp-atmodal-half { font-size: 11px; color: var(--muted,#666); text-align: center; }
    .lp-evmodal-row { display: flex; flex-direction: column; gap: 5px; }
    .lp-evmodal-row label { font-size: 11px; color: var(--muted,#666); }
    .lp-evmodal-input, .lp-evmodal-sel { background: var(--card2,#111); border: 1px solid var(--border2,#2a2a2a); border-radius: 10px; padding: 10px 12px; color: var(--text,#eee); font-family: Tajawal,sans-serif; font-size: 13px; }
    .lp-evmodal-btns { display: flex; gap: 10px; margin-top: 4px; }
    .lp-evmodal-btns button { flex: 1; padding: 12px; border-radius: 12px; font-family: Tajawal,sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; background: var(--card3,#1a1a1a); border: 1px solid var(--border2,#2a2a2a); color: var(--muted,#666); }
    .lp-evmodal-confirm { background: linear-gradient(135deg,var(--gold2,rgba(201,160,43,.2)),var(--gold3,#3a2e00)) !important; border-color: var(--gold,#C9A02B) !important; color: var(--gold,#C9A02B) !important; flex: 2 !important; }
    .lp-atmodal-quick { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
    .lp-atmodal-quick button { background: var(--card3,#1a1a1a); border: 1px solid var(--border2,#2a2a2a); border-radius: 10px; padding: 10px; font-size: 14px; font-weight: 900; color: var(--text,#eee); font-family: Tajawal,sans-serif; cursor: pointer; }

    @keyframes pulse {
      0%,100% { opacity: 1; } 50% { opacity: .4; }
    }
  `;
  document.head.appendChild(s);
})();


// ══════════════════════════════════════════════════════════════════
// 🔴 LIVE SYSTEM V2 PATCH — تحسينات نظام البث
// يُطبَّق بعد الكتلة الأصلية مباشرة
// يضيف: ساعة مزامنة، أشواط إضافية، ركلات جزاء، إحصائيات
// ══════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────
// §1 — قراءة الإعدادات الموسعة
// ─────────────────────────────────────────────────────────────────
function _getCfg(matchId) {
  const ms = (window.settings && window.settings.matchSettings) || {};
  const st = _liveMatches[matchId];
  // ✅︎ FIX §3: الأولوية: cfg في state > liveData في matches > matchSettings > 45
  const base = (st && st.cfg) ? st.cfg : {};
  const ld   = matches.find(function(m) { return m.id === matchId; })?.liveData || {};
  return {
    half1Duration:    base.half1Duration    || ld.half1Duration    || ms.half1Duration    || ms.halfDuration || 45,
    half2Duration:    base.half2Duration    || ld.half2Duration    || ms.half2Duration    || ms.halfDuration || 45,
    breakDuration:    base.breakDuration    || ld.breakDuration    || ms.breakDuration    || 15,
    et1Duration:      base.et1Duration      || ld.et1Duration      || ms.et1Duration      || 15,
    et2Duration:      base.et2Duration      || ld.et2Duration      || ms.et2Duration      || 15,
    hasExtraTime:     base.hasExtraTime     !== undefined ? base.hasExtraTime     : (ms.hasExtraTime     !== false),
    hasPenalties:     base.hasPenalties     !== undefined ? base.hasPenalties     : (ms.hasPenalties     !== false),
  };
}

// ─────────────────────────────────────────────────────────────────
// §2 — ساعة المزامنة الحقيقية من Firebase timestamps
// ─────────────────────────────────────────────────────────────────
function _calcSecsFromServer(st) {
  if (!st) return 0;
  if (st.timerPaused) return st.timerSeconds || 0;
  const phase = st.matchStatus;
  if (phase === 'live' || phase === 'extratime1' || phase === 'extratime2') {
    const ref = _getPhaseRef(st);
    if (ref) {
      const refMs = (typeof ref === 'number') ? ref
                  : (ref && typeof ref.toMillis === 'function') ? ref.toMillis()
                  : (ref && typeof ref.seconds === 'number') ? ref.seconds * 1000
                  : null;
      if (refMs) return Math.floor((Date.now() - refMs) / 1000);
    }
  }
  if (phase === 'halftime' || phase === 'halftime_et') return st.timerSeconds || 0;
  return st.timerSeconds || 0;
}
// ✅︎ تصدير للـwindow — استدعاءات admin.js الداخلية تمر عبره الآن
//    حتى تُطبَّق نسخة TimerCore الموحّدة (في league-admin.html) بدل تخطّيها.
window._calcSecsFromServer = _calcSecsFromServer;

function _getPhaseRef(st) {
  switch (st.matchStatus) {
    case 'live':        return st.currentHalf === 2 ? st.half2StartedAt : st.half1StartedAt;
    case 'extratime1':  return st.et1StartedAt;
    case 'extratime2':  return st.et2StartedAt;
    default:            return null;
  }
}

function _getHalfDur(st) {
  const cfg = _getCfg(st.matchId);
  switch (st.matchStatus) {
    case 'live':       return st.currentHalf === 2 ? cfg.half2Duration : cfg.half1Duration;
    case 'extratime1': return cfg.et1Duration;
    case 'extratime2': return cfg.et2Duration;
    default:           return cfg.half1Duration;
  }
}

function _getExtraMins(st) {
  switch (st.matchStatus) {
    case 'live':       return st.currentHalf === 2 ? (st.half2Extra||0) : (st.half1Extra||0);
    case 'extratime1': return st.et1Extra || 0;
    case 'extratime2': return st.et2Extra || 0;
    default:           return 0;
  }
}

// ─────────────────────────────────────────────────────────────────
// §5 — أزرار التحكم الزمني الديناميكية
// ─────────────────────────────────────────────────────────────────
function _updateTimeControlBtns(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const cfg = _getCfg(matchId);
  const container = document.getElementById('lp-time-controls-' + matchId);
  if (!container) return;

  const phase = st.matchStatus;
  let html = '';

  // ✅︎ زر بدل الضائع — كان النظام موجوداً بلا أي زر يستدعيه
  const addTimeBtn = `<button class="lp-btn lp-btn-addtime" onclick="lpOpenAddTime('${matchId}')">⏱️ بدل الضائع</button>`;

  // ✅︎ زر إيقاف/استئناف — يتبدّل حسب الحالة ويظهر في كل الفترات الجارية
  const pauseBtn = st.timerPaused
    ? `<button class="lp-btn lp-btn-resume" onclick="lpPauseMatch('${matchId}')">▶︎️ استئناف</button>`
    : `<button class="lp-btn lp-btn-pause" onclick="lpPauseMatch('${matchId}')">⏸️ إيقاف مؤقت</button>`;

  // قبل المباراة
  if (phase === 'upcoming') {
    html = `<button class="lp-btn lp-btn-start" onclick="lpStartMatch('${matchId}')">▶︎️ بدء المباراة</button>`;

  // الشوط الأول جارٍ
  } else if (phase === 'live' && st.currentHalf === 1) {
    html = `${pauseBtn}${addTimeBtn}
      <button class="lp-btn lp-btn-ht" onclick="lpHalfTime('${matchId}')">⏹️ إنهاء الشوط الأول</button>`;

  // استراحة بين الشوطين
  } else if (phase === 'halftime') {
    html = `<button class="lp-btn lp-btn-start" onclick="lpStartSecondHalf('${matchId}')">▶︎️ بدء الشوط الثاني</button>`;

  // الشوط الثاني جارٍ - زر ركلات الترجيح للمباريات الإقصائية تلقائياً
  } else if (phase === 'live' && st.currentHalf === 2) {
    /* ✅︎ أزرار الحسم تظهر لمباريات الإقصاء فقط، وحسب إعدادات المنظّم.
       مباريات المجموعات: زر الإنهاء فقط — التعادل نتيجة مشروعة. */
    const isKnockout = st.isKnockout || (st.knockoutRoundId != null);
    const drawn = (st.homeScore || 0) === (st.awayScore || 0);
    const showET  = isKnockout && drawn && cfg.hasExtraTime !== false;
    const showPen = isKnockout && drawn && cfg.hasPenalties !== false;
    html = `${pauseBtn}${addTimeBtn}
      <button class="lp-btn lp-btn-end" onclick="lpEndMatch('${matchId}')">🏁 إنهاء المباراة</button>
      ${showET  ? `<button class="lp-btn lp-btn-et"  onclick="lpStartET1('${matchId}')">⚡ وقت إضافي</button>` : ''}
      ${showPen ? `<button class="lp-btn lp-btn-pen" onclick="lpStartPenalties('${matchId}')">🥅 ركلات ترجيح</button>` : ''}`;

  // الوقت الإضافي الأول
  } else if (phase === 'extratime1') {
    html = `${pauseBtn}${addTimeBtn}
      <button class="lp-btn lp-btn-ht" onclick="lpHalfTimeET('${matchId}')">⏹️ إنهاء الإضافي الأول</button>`;

  // استراحة بين الوقتين الإضافيين
  } else if (phase === 'halftime_et') {
    html = `<button class="lp-btn lp-btn-start" onclick="lpStartET2('${matchId}')">▶︎️ بدء الإضافي الثاني</button>`;

  // الوقت الإضافي الثاني
  } else if (phase === 'extratime2') {
    const isKnockout = st.isKnockout || (st.knockoutRoundId != null);
    const drawn = (st.homeScore || 0) === (st.awayScore || 0);
    const showPen = isKnockout && drawn && cfg.hasPenalties !== false;
    html = `${pauseBtn}${addTimeBtn}
      <button class="lp-btn lp-btn-end" onclick="lpEndMatch('${matchId}')">🏁 إنهاء المباراة</button>
      ${showPen ? `<button class="lp-btn lp-btn-pen" onclick="lpStartPenalties('${matchId}')">🥅 ركلات ترجيح</button>` : ''}`;

  // ركلات الترجيح
  } else if (phase === 'penalties') {
    html = `<button class="lp-btn lp-btn-end" onclick="lpEndMatch('${matchId}')">🏁 إنهاء المباراة</button>`;

  // انتهت
  } else if (phase === 'ended') {
    html = `<div style="display:flex;align-items:center;gap:8px;background:rgba(39,174,96,.08);border:1px solid rgba(39,174,96,.25);border-radius:10px;padding:12px 16px;font-size:13px;font-weight:700;color:#27ae60">✅︎ انتهت المباراة</div>`;
  }

  container.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────
// §6 — Override بناء صفحة البث (أضف id للأزرار)
// ─────────────────────────────────────────────────────────────────
// patch openLivePage

// ─────────────────────────────────────────────────────────────────


// إخفاء/إظهار لوحة المدة
// إخفاء/إظهار أزرار الوقت الإضافي والركلات
window.lpToggleExtraControls = function(matchId) {
  const el     = document.getElementById('lp-extra-controls-' + matchId);
  const toggle = document.getElementById('lp-extra-toggle-'   + matchId);
  if (!el) return;
  const hidden = el.style.display === 'none' || el.style.display === '';
  el.style.display = hidden ? 'block' : 'none';
  if (toggle) toggle.textContent = hidden ? '⬆︎️ إخفاء' : '⬇︎️ وقت إضافي / ركلات الترجيح';
};

// ── ركلات الترجيح: تسجيل هدف أو تفويت ───────────────────────────
window.lpPenScore = async function(matchId, side, result) {
  const st = _liveMatches[matchId];
  if (!st || st.matchStatus !== 'penalties') return;
  if (!st.penalties) st.penalties = { home: [], away: [] };
  // نفتح منتقي لاعب سريعاً (اختياري) لتسجيل من سجّل/ضيّع
  window._penPickShooter(matchId, side, result);
};

// يسجّل الركلة فعلياً (بعد اختيار اللاعب أو تخطّيه)
window._lpCommitPen = async function(matchId, side, result, playerName) {
  const st = _liveMatches[matchId];
  if (!st) return;
  if (!st.penalties) st.penalties = { home: [], away: [] };

  // نخزّن كائناً {result, player} — متوافق مع القديم الذي كان نصاً
  st.penalties[side].push({ result: result, player: (playerName || '').trim() });

  const _isGoal = r => (typeof r === 'string' ? r === 'goal' : r && r.result === 'goal');
  const homeGoals = st.penalties.home.filter(_isGoal).length;
  const awayGoals = st.penalties.away.filter(_isGoal).length;

  const sh = document.getElementById('lp-pen-sh-' + matchId);
  const sa = document.getElementById('lp-pen-sa-' + matchId);
  if (sh) sh.textContent = homeGoals;
  if (sa) sa.textContent = awayGoals;

  _lpRenderPenDots(matchId);
  st.penHomeScore = homeGoals;
  st.penAwayScore = awayGoals;
  await window._lpSaveV2(matchId);
};

// منتقي رامي الركلة (سريع، قابل للتخطّي)
window._penPickShooter = function(matchId, side, result) {
  const match = matches.find(m => m.id === matchId);
  const lu = side === 'home' ? match?.homeLineup : match?.awayLineup;
  const players = (lu && Array.isArray(lu.players)) ? lu.players.filter(p => p.name) : [];
  const resLabel = result === 'goal' ? '✅ سجّل' : '❌ ضيّع';
  const resColor = result === 'goal' ? '#27ae60' : '#C0392B';

  const btns = players.length
    ? players.map(p => `<button onclick="window._penChoose('${matchId}','${side}','${result}','${String(p.name).replace(/'/g,"\\'")}')"
        style="display:flex;align-items:center;gap:6px;padding:9px 10px;border-radius:9px;
        border:1px solid var(--border2,#2a2a2a);background:var(--card2,#1a1a1a);color:var(--text,#eee);
        font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer;text-align:right;width:100%">
        <span style="min-width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:rgba(255,255,255,.06);font-size:10px;font-weight:900;color:var(--gold,#C9A02B)">${p.number||'—'}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
      </button>`).join('')
    : '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">لا توجد تشكيلة محفوظة لهذا الفريق</div>';

  const ov = document.createElement('div');
  ov.id = 'penPickOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML = `
    <div style="width:100%;max-width:320px;background:var(--card,#111);border:1px solid var(--border2,#2a2a2a);border-radius:16px;padding:16px;font-family:Tajawal,sans-serif;max-height:80vh;display:flex;flex-direction:column">
      <div style="font-size:14px;font-weight:900;color:${resColor};text-align:center;margin-bottom:2px">${resLabel} الركلة</div>
      <div style="font-size:11px;color:var(--muted,#888);text-align:center;margin-bottom:12px">اختر اللاعب (أو تخطَّ)</div>
      <div style="display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1">${btns}</div>
      <button onclick="window._penChoose('${matchId}','${side}','${result}','')"
        style="margin-top:12px;padding:10px;border-radius:9px;border:1px solid var(--border2,#2a2a2a);background:transparent;color:var(--muted,#888);font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">
        تخطّي (بدون اسم)
      </button>
    </div>`;
  document.body.appendChild(ov);
  if (window.bindModalDismiss) window.bindModalDismiss(ov);
};
window._penChoose = function(matchId, side, result, playerName) {
  document.getElementById('penPickOverlay')?.remove();
  window._lpCommitPen(matchId, side, result, playerName);
};

// تراجع عن آخر ركلة
window.lpPenUndo = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st || !st.penalties) return;
  const hLen = (st.penalties.home || []).length;
  const aLen = (st.penalties.away || []).length;
  if (hLen === 0 && aLen === 0) return;
  if (hLen >= aLen) { st.penalties.home.pop(); } else { st.penalties.away.pop(); }
  const _isGoal = r => (typeof r === 'string' ? r === 'goal' : r && r.result === 'goal');
  const homeGoals = st.penalties.home.filter(_isGoal).length;
  const awayGoals = st.penalties.away.filter(_isGoal).length;
  const sh = document.getElementById('lp-pen-sh-' + matchId);
  const sa = document.getElementById('lp-pen-sa-' + matchId);
  if (sh) sh.textContent = homeGoals;
  if (sa) sa.textContent = awayGoals;
  st.penHomeScore = homeGoals;
  st.penAwayScore = awayGoals;
  _lpRenderPenDots(matchId);
  await window._lpSaveV2(matchId);
};

// رسم نقاط الركلات (✅ هدف / ❌ تفويت) — يدعم النص القديم والكائن الجديد
function _lpRenderPenDots(matchId) {
  const st = _liveMatches[matchId];
  if (!st || !st.penalties) return;
  ['home','away'].forEach(function(side) {
    const el = document.getElementById('lp-pen-' + side + '-dots-' + matchId);
    if (!el) return;
    el.innerHTML = (st.penalties[side] || []).map(function(r) {
      const isGoal = (typeof r === 'string') ? r === 'goal' : r && r.result === 'goal';
      const nm = (typeof r === 'object' && r && r.player) ? r.player : '';
      const mark = '<span style="font-size:15px">' + (isGoal ? '✅︎' : '❌︎') + '</span>';
      return nm
        ? '<span style="display:inline-flex;align-items:center;gap:2px" title="' + nm + '">' + mark + '</span>'
        : mark;
    }).join('');
  });
}


window.lpOpenAddTime = function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const cfg = st.cfg || _getLiveSettings();
  const halfLabel = st.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول';
  const halfDur = st.currentHalf === 2 ? cfg.half2Duration : cfg.half1Duration;
  const modal = document.getElementById('lp-atmodal-' + matchId);
  const halfEl = document.getElementById('lp-at-half-' + matchId);
  const inp = document.getElementById('lp-at-mins-' + matchId);
  if (halfEl) halfEl.textContent = halfLabel + ' (' + halfDur + ' د)';
  if (inp) inp.value = 1;
  if (modal) modal.style.display = 'flex';
};

window.lpSetAddTime = function(matchId, n) {
  const inp = document.getElementById('lp-at-mins-' + matchId);
  if (inp) inp.value = n;
};

// دوال عرض التايمر والحالة
// ─────────────────────────────────────────────────────────────────
window._lpUpdateTimerDisplay = function _lpUpdateTimerDisplay(matchId) {
  // ⛔ النسخة القديمة أُزيلت — كانت تحسب بدل الضائع بمنطق مختلف عن الجمهور
  //    (وتُفصل الشوط بعد 5 ثوانٍ فقط إذا لم يُحدَّد بدل ضائع).
  //    البديل: TimerCore + timer-admin.js — يُعرِّفان هذه الدالة بعد تحميل admin.js.
  //    هذا مجرد احتياطي لو لم يُحمَّل timer-admin بعد.
  const st = _liveMatches[matchId];
  if (!st) return;
  const timerEl = document.getElementById('lp-timer-' + matchId);
  if (timerEl && !window.TimerCore) timerEl.textContent = '--:--';
};

// ── إنهاء الشوط تلقائياً عند انتهاء الوقت ──
window._lpAutoEndHalf = function(matchId) {
  const st = _liveMatches[matchId];
  if (!st || st._autoEndPending) return;
  st._autoEndPending = true;

  clearInterval(st.timerInterval);
  st.timerInterval = null;

  if (st.matchStatus === 'live' && st.currentHalf === 1) {
    // انهِ الشوط الأول تلقائياً
    window.lpHalfTime(matchId);
  } else if (st.matchStatus === 'live' && st.currentHalf === 2) {
    // للمباريات الإقصائية: إذا كانت التعادل — ابدأ الوقت الإضافي تلقائيًا
    const isKnockout = st.isKnockout || (st.knockoutRoundId != null);
    const cfg = _getCfg(matchId);
    
    if (isKnockout && st.homeScore === st.awayScore && cfg.hasExtraTime) {
      // ✅︎ ابدأ الوقت الإضافي الأول تلقائيًا (تعادل في مباراة إقصائية)
      // عدّاد الفترة يبدأ من الصفر — الإزاحة (90 د) تُضاف عند العرض في TimerCore.
      // ⚠️ لا تستخدم offset هنا وإلا ظهرت الساعة 180:00 عند الجمهور.
      st.matchStatus       = 'extratime1';
      st.et1ExtraMinutes   = 0;
      st.et1ExtraSet       = false;
      st.et1StartedAt      = Date.now();
      st.halftimeStartedAt = null;
      st.timerPaused       = false;
      st.phaseSeconds      = 0;
      st.timerSeconds      = 0;
      st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
      window._lpUpdateStatusUI(matchId);
      window._lpUpdateTimerDisplay(matchId);
      window.showToast && window.showToast('⚡ بدأ الوقت الإضافي التلقائياً (تعادل)', 'info');
    } else {
      // لا ننهي تلقائياً — المنظم يضغط "إنهاء المباراة"
      st.timerSeconds = window._calcSecsFromServer(st);
      st.timerPaused  = true;
      window._lpUpdateStatusUI(matchId);
      window._lpUpdateTimerDisplay(matchId);
      /* ✅︎ الرسالة حسب نوع المباراة — كانت تقترح وقتاً إضافياً
         حتى على مباريات المجموعات التي لا تملكه أصلاً. */
      var msg;
      if (!isKnockout) {
        msg = st.homeScore === st.awayScore
          ? '⏰ انتهى الوقت — التعادل نتيجة نهائية، اضغط "إنهاء المباراة"'
          : '⏰ انتهى الوقت — اضغط "إنهاء المباراة"';
      } else if (st.homeScore === st.awayScore) {
        var routes = [];
        if (cfg.hasExtraTime !== false) routes.push('الوقت الإضافي');
        if (cfg.hasPenalties !== false) routes.push('ركلات الترجيح');
        msg = routes.length
          ? '⏰ تعادل في مباراة إقصاء — لازم فائز عبر ' + routes.join(' أو ')
          : '⚠️ تعادل إقصاء بلا وقت إضافي ولا ركلات — راجع الإعدادات';
      } else {
        msg = '⏰ انتهى الوقت — اضغط "إنهاء المباراة"';
      }
      window.showToast && window.showToast(msg, 'info');
    }
  } else if (st.matchStatus === 'extratime1') {
    window.lpHalfTimeET(matchId);
  } else if (st.matchStatus === 'extratime2') {
    st.timerSeconds = window._calcSecsFromServer(st);
    st.timerPaused  = true;
    window._lpUpdateStatusUI(matchId);
    window._lpUpdateTimerDisplay(matchId);
    window.showToast && window.showToast('⏰ انتهى الوقت الإضافي', 'info');
  }
  setTimeout(() => { if (st) delete st._autoEndPending; }, 5000);
};

window._lpUpdateStatusUI = function _lpUpdateStatusUI(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const statusEl = document.getElementById('lp-status-' + matchId);
  const periodEl = document.getElementById('lp-period-' + matchId);
  const statusMap = {
    upcoming:    ['⏳ قبل المباراة',    'قبل المباراة',                    'lp-s-upcoming'],
    live:        ['🔴 مباشر',           st.currentHalf===2?'الشوط الثاني':'الشوط الأول', 'lp-s-live'],
    halftime:    ['⏸️ بين الشوطين',     '⏸️ بين الشوطين',                  'lp-s-half'],
    extratime1:  ['⚡ الإضافي الأول',   'الوقت الإضافي الأول',             'lp-s-live'],
    halftime_et: ['⏸️ بين الإضافيين',  '⏸️ بين الإضافيين',                'lp-s-half'],
    extratime2:  ['⚡ الإضافي الثاني',  'الوقت الإضافي الثاني',            'lp-s-live'],
    penalties:   ['🥅 ركلات الترجيح',   'ركلات الترجيح',                   'lp-s-live'],
    ended:       ['🏁 انتهت',           'انتهت المباراة',                   'lp-s-ended'],
  };
  const [statusText, periodText, cls] = statusMap[st.matchStatus] || statusMap['upcoming'];
  // ✅︎ حالة الإيقاف المؤقت تطغى على "مباشر" لتوضيح أن الوقت متوقف
  const ACTIVE = ['live', 'extratime1', 'extratime2'];
  const paused = st.timerPaused && ACTIVE.includes(st.matchStatus);
  if (statusEl) {
    statusEl.textContent = paused ? '⏸️ متوقفة مؤقتاً' : statusText;
    statusEl.className = 'lp-status-badge ' + (paused ? 'lp-s-half' : cls);
  }
  if (periodEl) periodEl.textContent = paused
    ? periodText + (st.pauseReason ? ' — ⏸️ ' + st.pauseReason : ' — الوقت متوقف')
    : periodText;
  if (typeof _updateTimeControlBtns === 'function') _updateTimeControlBtns(matchId);
};

// §9 — Override دوال التحكم الزمني
// ─────────────────────────────────────────────────────────────────

// بدء المباراة — الشوط الأول
window.lpStartMatch = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;

  clearInterval(st.timerInterval);
  st.timerInterval = null;

  const cfg = _getCfg(matchId);

  st.matchStatus        = 'live';
  st.currentHalf        = 1;
  st.timerPaused        = false;
  st.timerSeconds       = 0;
  st.half1Extra         = 0;
  st.half2Extra         = 0;
  st.half1StartedAt     = Date.now();
  st.half2StartedAt     = null;
  st.halftimeStartedAt  = null;
  st._autoEndPending    = false;
  // احفظ الإعدادات في state لضمان ثباتها طوال المباراة
  st.cfg = { ...cfg };

  // شغّل loop الساعة
  st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
  window._lpUpdateTimerDisplay(matchId);
  window._lpUpdateStatusUI(matchId);
  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('▶︎ بدأت المباراة 🔴', 'success');
};

// إيقاف مؤقت / استئناف
/* ══ أسباب الإيقاف الجاهزة — ضغطة واحدة بدل الكتابة ══ */
window.LP_PAUSE_REASONS = [
  { icon: 'cloudRain', label: 'أحوال جوية' },
  { icon: 'injury',    label: 'إصابة لاعب' },
  { icon: 'bulb',      label: 'انقطاع الإضاءة' },
  { icon: 'users',     label: 'دخول الجمهور' },
  { icon: 'whistle',   label: 'قرار الحكم' },
  { icon: 'settings',  label: 'مشكلة فنية' },
];

/* نافذة سبب الإيقاف — يقدر يختار أو يكتب أو يتخطّى */
window.lpOpenPauseReason = function(matchId) {
  document.getElementById('lpPauseOv')?.remove();
  const ov = document.createElement('div');
  ov.id = 'lpPauseOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100005;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML = `
    <div style="width:100%;max-width:340px;background:var(--card,#111);border:1px solid rgba(243,156,18,.35);border-radius:16px;padding:18px;font-family:Tajawal,sans-serif">
      <div style="font-size:15px;font-weight:900;color:#D35400;text-align:center">⏸️ إيقاف المباراة مؤقتاً</div>
      <div style="font-size:11px;color:var(--muted,#888);text-align:center;margin-bottom:14px">سبب الإيقاف — يظهر للجمهور (اختياري)</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px">
        ${window.LP_PAUSE_REASONS.map(r => `
          <button type="button" onclick="lpPickPauseReason('${r.label}')"
            style="padding:10px 6px;border-radius:10px;border:1px solid var(--border2,#2a2a2a);background:var(--card2,#1a1a1a);color:var(--text,#eee);font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer;text-align:center">
            <div style="margin-bottom:4px;display:flex;justify-content:center">${_ic(r.icon,18)}</div>${r.label}
          </button>`).join('')}
      </div>

      <input id="lpPauseReasonInput" maxlength="60" placeholder="أو اكتب سبباً آخر..."
        style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--border2,#2a2a2a);background:var(--card2,#1a1a1a);color:var(--text,#eee);font-family:Tajawal,sans-serif;font-size:13px;box-sizing:border-box"/>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button onclick="lpConfirmPause('${matchId}', true)"
          style="padding:12px;border-radius:10px;border:1px solid var(--border2,#2a2a2a);background:transparent;color:var(--muted,#888);font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">تخطّي</button>
        <button onclick="lpConfirmPause('${matchId}', false)"
          style="padding:12px;border-radius:10px;border:none;background:#D35400;color:#fff;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">⏸️ إيقاف</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  window.bindModalDismiss(ov);
  setTimeout(() => document.getElementById('lpPauseReasonInput')?.focus(), 60);
};

/* اختيار سبب جاهز — يعبّي الحقل مباشرة */
window.lpPickPauseReason = function(label) {
  const inp = document.getElementById('lpPauseReasonInput');
  if (inp) { inp.value = label; inp.focus(); }
};

/* تنفيذ الإيقاف بعد اختيار السبب (أو التخطّي) */
window.lpConfirmPause = function(matchId, skip) {
  const inp = document.getElementById('lpPauseReasonInput');
  let reason = skip ? '' : (inp?.value || '').trim();
  // ✅︎ تنظيف: السبب يُعرض للجمهور كنص، فنمنع أي وسوم/حقن
  reason = reason.replace(/[<>&"']/g, '').slice(0, 60);
  document.getElementById('lpPauseOv')?.remove();
  window._lpDoPause(matchId, reason);
};

/* ⏸️/▶︎️ إيقاف مؤقت واستئناف — يعمل على كل الواجهات فوراً
   ⚠️ إصلاح مهم: TimerCore يقرأ phaseSeconds وقت الإيقاف (وليس timerSeconds)،
   فكان العدّاد يقفز لقيمة خاطئة عند الإيقاف. */
window.lpPauseMatch = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const ACTIVE = ['live', 'extratime1', 'extratime2'];
  if (!ACTIVE.includes(st.matchStatus)) {
    showToast('الإيقاف متاح أثناء الشوط فقط', 'error');
    return;
  }
  // عند الإيقاف: اسأل عن السبب أولاً. عند الاستئناف: نفّذ مباشرة.
  if (!st.timerPaused) { window.lpOpenPauseReason(matchId); return; }
  return window._lpDoPause(matchId, '');
};

window._lpDoPause = async function(matchId, reason) {
  const st = _liveMatches[matchId];
  if (!st) return;

  if (!st.timerPaused) {
    // ⏸️ إيقاف — ثبّت ثواني الفترة الحالية
    const secs = (window.TimerCore && window.TimerCore.phaseSecs)
      ? window.TimerCore.phaseSecs(st)
      : window._calcSecsFromServer(st);
    st.phaseSeconds = secs;
    st.timerSeconds = secs;   // مرآة للتوافق الخلفي
    st.timerPaused  = true;
    st.pausedAt     = Date.now();
    st.pauseReason  = reason || '';
    clearInterval(st.timerInterval);
    st.timerInterval = null;
    showToast(reason ? `⏸️ توقفت: ${reason}` : '⏸️ تم إيقاف الوقت مؤقتاً', 'success');
  } else {
    // ▶︎️ استئناف — أعد ضبط مرجع البداية بحيث يكمل من نفس اللحظة
    const secs  = st.phaseSeconds || st.timerSeconds || 0;
    const offset = secs * 1000;
    st.timerPaused = false;
    st.pausedAt    = null;
    st.pauseReason = '';   // ✅︎ يختفي السبب من كل الواجهات عند الاستئناف
    if (st.matchStatus === 'live' && st.currentHalf === 1) st.half1StartedAt = Date.now() - offset;
    if (st.matchStatus === 'live' && st.currentHalf === 2) st.half2StartedAt = Date.now() - offset;
    if (st.matchStatus === 'extratime1') st.et1StartedAt = Date.now() - offset;
    if (st.matchStatus === 'extratime2') st.et2StartedAt = Date.now() - offset;
    clearInterval(st.timerInterval);
    st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
    showToast('▶︎️ تم استئناف المباراة', 'success');
  }
  window._lpUpdateStatusUI(matchId);
  window._lpUpdateTimerDisplay(matchId);
  // ✅︎ احفظ فوراً حتى يظهر التوقف/الاستئناف عند الجمهور مباشرة
  try { await window._lpSaveV2(matchId); } catch (e) {}
};

// إنهاء الشوط الأول — بين الشوطين
window.lpHalfTime = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  // احفظ الثواني الحالية قبل الإيقاف
  st.timerSeconds = window._calcSecsFromServer(st);
  clearInterval(st.timerInterval);
  st.timerInterval    = null;
  st.timerPaused      = true;
  st.matchStatus      = 'halftime';
  st.halftimeStartedAt = Date.now();

  window._lpUpdateStatusUI(matchId);
  // أظهر "بين الشوطين" في التايمر
  const timerEl = document.getElementById('lp-timer-' + matchId);
  const extraEl = document.getElementById('lp-extra-' + matchId);
  if (timerEl) timerEl.textContent = '⏸️';
  if (extraEl) { extraEl.style.display = 'none'; extraEl.textContent = ''; }

  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('⏸️ بين الشوطين', 'success');
};

// بدء الشوط الثاني
window.lpStartSecondHalf = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;

  // أوقف أي interval قديم نهائياً
  clearInterval(st.timerInterval);
  st.timerInterval = null;

  const cfg = _getCfg(matchId);
  // الشوط الثاني يبدأ زمنياً من نهاية الشوط الأول (نظام FIFA)
  const h1Dur = (cfg.half1Duration || 45) + (st.half1Extra || 0);
  const offsetMs = h1Dur * 60 * 1000;

  st.matchStatus       = 'live';
  st.currentHalf       = 2;
  st.timerPaused       = false;   // مهم: ألغِ الـ pause من الاستراحة
  st.timerSeconds      = h1Dur * 60;
  st.half2Extra        = 0;
  st.half2StartedAt    = Date.now() - offsetMs;
  st.halftimeStartedAt = null;
  st._autoEndPending   = false;   // أعِد تعيين auto-end

  window._lpUpdateStatusUI(matchId);
  window._lpUpdateTimerDisplay(matchId);   // تحديث فوري للعرض

  // شغّل العداد بعد تحديث DOM
  st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);

  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('▶︎️ بدأ الشوط الثاني', 'success');
};

// بدء الوقت الإضافي الأول
window.lpStartET1 = async function(matchId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'بدء الوقت الإضافي الأول؟', confirmText: 'تأكيد', danger: false }))) return;
  const st = _liveMatches[matchId];
  if (!st) return;
  clearInterval(st.timerInterval);

  // ── ET1 يكمل من نهاية الشوط الثاني ──
  // مثال: شوط1=20 + شوط2=20 → ET1 يبدأ من 40:00
  const h1Dur  = (st.cfg?.half1Duration || 45) + (st.half1Extra || 0);
  const h2Dur  = (st.cfg?.half2Duration || 45) + (st.half2Extra || 0);
  const totalPrev = (h1Dur + h2Dur) * 60;

  st.matchStatus  = 'extratime1';
  st.timerPaused  = false;
  st.timerSeconds = totalPrev;
  st.et1Extra     = 0;
  st.et1StartedAt = Date.now() - totalPrev * 1000;

  st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
  window._lpUpdateStatusUI(matchId);
  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('⚡ بدأ الوقت الإضافي الأول', 'success');
};

// استراحة الوقت الإضافي
window.lpHalfTimeET = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  clearInterval(st.timerInterval);
  st.matchStatus = 'halftime_et';
  st.timerSeconds = window._calcSecsFromServer(st);
  st.halftimeStartedAt = Date.now();
  window._lpUpdateStatusUI(matchId);
  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('☕ استراحة الوقت الإضافي', 'success');
};

// بدء الوقت الإضافي الثاني
window.lpStartET2 = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  clearInterval(st.timerInterval);

  // ── ET2 يكمل من نهاية ET1 ──
  const h1Dur  = (st.cfg?.half1Duration || 45) + (st.half1Extra || 0);
  const h2Dur  = (st.cfg?.half2Duration || 45) + (st.half2Extra || 0);
  const et1Dur = (st.cfg?.et1Duration   || 15) + (st.et1Extra   || 0);
  const totalPrev = (h1Dur + h2Dur + et1Dur) * 60;

  st.matchStatus  = 'extratime2';
  st.timerPaused  = false;
  st.timerSeconds = totalPrev;
  st.et2Extra     = 0;
  st.et2StartedAt = Date.now() - totalPrev * 1000;

  st.timerInterval = setInterval(() => window._lpUpdateTimerDisplay(matchId), 500);
  window._lpUpdateStatusUI(matchId);
  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('⚡ بدأ الوقت الإضافي الثاني', 'success');
};

// بدء ركلات الجزاء
window.lpStartPenalties = async function(matchId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'بدء ركلات الترجيح؟', confirmText: 'تأكيد', danger: false }))) return;
  const st = _liveMatches[matchId];
  if (!st) return;
  clearInterval(st.timerInterval);
  st.matchStatus = 'penalties';
  st.penalties   = st.penalties || { home: [], away: [] };
  st.timerPaused = false;

  // أظهر قسم الركلات
  const penSection = document.getElementById('lp-pen-section-' + matchId);
  if (penSection) penSection.style.display = 'block';

  window._lpUpdateStatusUI(matchId);
  await window._lpSaveV2(matchId);
  window.showToast && window.showToast('🥅 بدأت ركلات الترجيح', 'success');
};

// إنهاء المباراة
// ── دالة مساعدة: بناء نص الهدافين من مصفوفة events ──────────────
// تُجمّع الأهداف لكل لاعب وتُنتج نصاً مثل: "أحمد, خالد (2), سعيد"
function _buildScorersFromEvents(events, side) {
  if (!events || !events.length) return '';
  const goalMap = {}; // name → count
  events.forEach(function(ev) {
    // ⛔ أهداف ركلات الترجيح لا تُحتسب في ترتيب الهدافين (قاعدة رسمية)
    if (ev.type === 'penalty' || ev.isShootout || ev.shootout) return;
    if (ev.type !== 'goal') return;
    if (ev.team !== side) return;
    const name = (ev.player || '').trim();
    if (!name || name === '—' || name === '?') return;
    goalMap[name] = (goalMap[name] || 0) + 1;
  });
  return Object.entries(goalMap)
    .map(function(e) { return e[1] > 1 ? e[0] + ' (' + e[1] + ')' : e[0]; })
    .join(', ');
}

window.lpEndMatch = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;

  // ⛔ مباريات الإقصاء لا تنتهي بالتعادل — لازم فائز (نتيجة أو ركلات ترجيح)
  const _koMatch = matches.find(function(x){ return x.id === matchId; });
  if (_koMatch && _koMatch.isKnockout && (st.homeScore || 0) === (st.awayScore || 0)) {
    const _pIsGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
    const _ph = st.penalties ? (st.penalties.home || []).filter(_pIsGoal).length : 0;
    const _pa = st.penalties ? (st.penalties.away || []).filter(_pIsGoal).length : 0;
    const _hasPens = !!(st.penalties && ((st.penalties.home||[]).length || (st.penalties.away||[]).length));
    if (!_hasPens || _ph === _pa) {
      window.showToast && window.showToast(
        '⛔ مباراة إقصائية لا تنتهي بالتعادل — ابدأ ركلات الترجيح وحدّد الفائز', 'error');
      return;
    }
  }

  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'هل تريد إنهاء المباراة نهائياً؟', confirmText: 'تأكيد', danger: true }))) return;
  clearInterval(st.timerInterval);
  st.timerPaused = false;
  st.matchStatus = 'ended';
  window._lpUpdateStatusUI(matchId);

  // ✅︎ FIX §4: بناء homeScorers/awayScorers من events تلقائياً
  // نبني قائمة الهدافين من سجل الأحداث لضمان تحديث جدول الهدافين
  const eventsScorersHome = _buildScorersFromEvents(st.events || [], 'home');
  const eventsScorersAway = _buildScorersFromEvents(st.events || [], 'away');

  // نُدمج مع ما هو محفوظ يدوياً في الحقول (لو المنظم أدخل شيئاً يدوياً)
  const LEAGUE_ID = window._getLeagueId ? window._getLeagueId() : '';
  if (LEAGUE_ID) {
    try {
      const existingMatch = matches.find(function(m) { return m.id === matchId; });
      const manualHome = existingMatch && existingMatch.homeScorers ? existingMatch.homeScorers : '';
      const manualAway = existingMatch && existingMatch.awayScorers ? existingMatch.awayScorers : '';

      // إذا كان هناك هدافون يدويون احتفظ بهم، وإلا استخدم الـ events
      const finalHome = manualHome || eventsScorersHome;
      const finalAway = manualAway || eventsScorersAway;

      // ── بناء أحداث ركلات الترجيح إذا كانت موجودة ──
      const penEvents = [];
      if (st.penalties) {
        (st.penalties.home || []).forEach((r, i) => {
          penEvents.push({
            minute: 'رك' + (i + 1),
            type: 'penalty',
            team: 'home',
            player: '', // لا نعرف اسم اللاعب
            result: r,
            timestamp: Date.now() + i
          });
        });
        (st.penalties.away || []).forEach((r, i) => {
          penEvents.push({
            minute: 'رك' + (i + 1),
            type: 'penalty',
            team: 'away',
            player: '',
            result: r,
            timestamp: Date.now() + 100 + i
          });
        });
      }

      if (finalHome || finalAway || penEvents.length) {
        // ✅ احفظ نتيجة ركلات الترجيح كحقول مباشرة (penaltyScoreHome/Away)
        //    حتى تظهر تحت النتيجة المتعادلة في بطاقات المباريات والرئيسية —
        //    كانت تُحفظ فقط في liveData.penalties فيظهر "تعادل" بلا فائز.
        const _pIsGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
        let _penPayload = {};
        if (st.penalties && ((st.penalties.home||[]).length || (st.penalties.away||[]).length)) {
          _penPayload.penaltyScoreHome = (st.penalties.home||[]).filter(_pIsGoal).length;
          _penPayload.penaltyScoreAway = (st.penalties.away||[]).filter(_pIsGoal).length;
        }
        await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), {
          homeScorers: finalHome,
          awayScorers: finalAway,
          events: [...(st.events || []), ...penEvents],
          ..._penPayload
        });
        // تحديث الـ local state أيضاً لضمان صحة recalcStandings
        if (existingMatch) {
          existingMatch.homeScorers = finalHome;
          existingMatch.awayScorers = finalAway;
          existingMatch.events = [...(existingMatch.events || []), ...penEvents];
          if (_penPayload.penaltyScoreHome != null) {
            existingMatch.penaltyScoreHome = _penPayload.penaltyScoreHome;
            existingMatch.penaltyScoreAway = _penPayload.penaltyScoreAway;
          }
          // تحديث liveData لضمان العرض الصحيح في الصفحة الجمهور
          if (!existingMatch.liveData) existingMatch.liveData = {};
          existingMatch.liveData.events = [...(existingMatch.liveData?.events || []), ...penEvents];
          existingMatch.liveData.penalties = st.penalties;
        }
      }
    } catch(e) {
      console.warn('[lpEndMatch] فشل حفظ الهدافين:', e.message);
    }
  }

  await window._lpSaveV2(matchId);

  // ✅︎ ترقية الفائز تلقائياً للدور التالي إذا كانت مباراة إقصاء
  try {
    const finishedMatch = matches.find(m => m.id === matchId);
    if (finishedMatch && finishedMatch.isKnockout && finishedMatch.knockoutRoundId) {
      const hs = (st.penalties && st.penHomeScore != null) ? st.penHomeScore : st.homeScore;
      const as2 = (st.penalties && st.penAwayScore != null) ? st.penAwayScore : st.awayScore;
      if (typeof hs === 'number' && typeof as2 === 'number' && hs !== as2 && typeof _autoAdvanceWinner === 'function') {
        await _autoAdvanceWinner(finishedMatch.knockoutRoundId, matchId, hs, as2);
      }
    }
  } catch(e) { console.warn('[lpEndMatch] auto-advance:', e.message); }

  // تحديث الترتيب والهدافين بعد إنهاء المباراة
  try { await recalcStandings(); } catch(e) {}

  window.showToast && window.showToast('✅︎ انتهت المباراة — تم الحفظ', 'success');
};

// وقت إضافي — override ليدعم ET1/ET2
window.lpConfirmAddTime = async function(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const mins = parseInt(document.getElementById('lp-at-mins-' + matchId)?.value || 1);
  if (isNaN(mins) || mins < 1) return;

  const cfg = _getCfg(matchId);

  // حساب الوقت الحالي بالدقائق
  const currentSecs = window._calcSecsFromServer(st);
  const currentMins = Math.floor(currentSecs / 60);

  switch (st.matchStatus) {
    case 'live': {
      const halfDur = st.currentHalf === 2
        ? (cfg.half2Duration || 45)
        : (cfg.half1Duration || 45);
      if (st.currentHalf === 2) {
        st.half2Extra = (st.half2Extra || 0) + mins;
        // انقل مرجع الوقت فقط إذا وصلنا لنهاية الشوط فعلاً
        if (st.half2StartedAt && currentMins >= halfDur)
          st.half2StartedAt -= mins * 60000;
      } else {
        st.half1Extra = (st.half1Extra || 0) + mins;
        if (st.half1StartedAt && currentMins >= halfDur)
          st.half1StartedAt -= mins * 60000;
      }
      break;
    }
    case 'extratime1':
      st.et1Extra = (st.et1Extra || 0) + mins;
      if (st.et1StartedAt && currentMins >= (cfg.et1Duration || 15))
        st.et1StartedAt -= mins * 60000;
      break;
    case 'extratime2':
      st.et2Extra = (st.et2Extra || 0) + mins;
      if (st.et2StartedAt && currentMins >= (cfg.et2Duration || 15))
        st.et2StartedAt -= mins * 60000;
      break;
  }

  window.lpCloseAddTime && window.lpCloseAddTime(matchId);
  window._lpUpdateTimerDisplay && window._lpUpdateTimerDisplay(matchId);
  window.showToast && window.showToast('➕︎ +' + mins + "' بدل ضائع", 'success');
  await window._lpSaveV2(matchId);
};

// ─────────────────────────────────────────────────────────────────
// §10 — حفظ V2 إلى Firebase (يُغني عن _lpSave القديمة)
// ─────────────────────────────────────────────────────────────────
async function _lpSaveV2(matchId) {
  const st = _liveMatches[matchId];
  if (!st) return;
  const LEAGUE_ID = window._getLeagueId ? window._getLeagueId() : '';
  if (!LEAGUE_ID) return;

  window._lpSetSaveState(matchId, 'saving');

  // اقرأ الحقول الجانبية
  function _val(id) { return document.getElementById(id + '-' + matchId)?.value || ''; }

  const liveData = {
    matchId,
    homeScore:         st.homeScore   || 0,
    awayScore:         st.awayScore   || 0,
    timerSeconds:      st.timerSeconds|| 0,
    // ✅︎ phaseSeconds هو ما يقرأه TimerCore وقت الإيقاف — بدونه يظهر 00:00 للجمهور
    phaseSeconds:      st.phaseSeconds != null ? st.phaseSeconds : (st.timerSeconds || 0),
    timerPaused:       st.timerPaused || false,
    pausedAt:          st.pausedAt || null,
    // ✅︎ سبب الإيقاف — يُعرض للجمهور على البطاقة
    pauseReason:       st.pauseReason || '',
    matchStatus:       st.matchStatus || 'upcoming',
    currentHalf:       st.currentHalf || 1,
    half1StartedAt:    st.half1StartedAt  || null,
    half2StartedAt:    st.half2StartedAt  || null,
    halftimeStartedAt: st.halftimeStartedAt || null,
    et1StartedAt:      st.et1StartedAt  || null,
    et2StartedAt:      st.et2StartedAt  || null,
    /* ✅︎ FIX 8 — الأسماء الجديدة أولاً. كان يقرأ st.half1Extra (القديم) فقط،
       فينجو بالصدفة عبر mirror الغلاف. أي حفظ قبل ارتباط الغلاف = بدل ضائع 0. */
    half1ExtraMinutes: st.half1ExtraMinutes ?? st.half1Extra ?? 0,
    half2ExtraMinutes: st.half2ExtraMinutes ?? st.half2Extra ?? 0,
    et1ExtraMinutes:   st.et1ExtraMinutes   ?? st.et1Extra   ?? 0,
    et2ExtraMinutes:   st.et2ExtraMinutes   ?? st.et2Extra   ?? 0,
    // ✅︎ هل حدّد المنظم بدل الضائع يدوياً لهذه الفترة (وإلا فهو عدّ افتراضي حتى 15 د)
    half1ExtraSet:     !!st.half1ExtraSet,
    half2ExtraSet:     !!st.half2ExtraSet,
    et1ExtraSet:       !!st.et1ExtraSet,
    et2ExtraSet:       !!st.et2ExtraSet,
    half1Duration:     st.cfg?.half1Duration || (window.settings?.matchSettings?.half1Duration) || 45,
    half2Duration:     st.cfg?.half2Duration || (window.settings?.matchSettings?.half2Duration) || 45,
    et1Duration:       st.cfg?.et1Duration   || (window.settings?.matchSettings?.et1Duration)  || 15,
    et2Duration:       st.cfg?.et2Duration  || 15,
    breakDuration:     st.cfg?.breakDuration || 15,
    period: _getPeriodText(st),
    events:       st.events      || [],
    stats:        st.stats       || {},
    penalties:    st.penalties   || null,
    penHomeScore: st.penHomeScore != null ? st.penHomeScore : null,
    penAwayScore: st.penAwayScore != null ? st.penAwayScore : null,
    streamUrl:    st.streamUrl   || '',
    streamActive: st.streamActive|| false,
    streamPlatform: st.streamPlatform || 'youtube',
    homeLineup:   st.homeLineup  || null,
    awayLineup:   st.awayLineup  || null,
    leagueId:     LEAGUE_ID,
    updatedAt:    true ? serverTimestamp() : Date.now(),
  };

  const extraData = {
    date:        _val('lp-date'),
    time:        _val('lp-time'),
    venue:       _val('lp-venue'),
    round:       parseInt(_val('lp-round') || 1),
    referee:     _val('lp-referee'),
    linesman1:   _val('lp-lns1'),
    linesman2:   _val('lp-lns2'),
    commentator: _val('lp-comm'),
    sponsor:     _val('lp-sponsor'),
    photographer:_val('lp-photo'),
    announcer:   _val('lp-ann'),
    manOfMatch:  _val('lp-mom'),
    attendance:  _val('lp-att'),
    notes:       _val('lp-notes'),
  };

  let matchStatus = 'upcoming';
  if (['live','halftime','extratime1','halftime_et','extratime2','penalties'].includes(st.matchStatus)) matchStatus = 'live';
  else if (st.matchStatus === 'ended') matchStatus = 'finished';

  // ── تحديد النتيجة النهائية (تشمل ركلات الترجيح إذا كانت موجودة) ──
  const finalHomeScore = st.matchStatus === 'ended' 
    ? (st.penHomeScore != null && st.penalties ? st.penHomeScore : st.homeScore) 
    : null;
  const finalAwayScore = st.matchStatus === 'ended' 
    ? (st.penAwayScore != null && st.penalties ? st.penAwayScore : st.awayScore) 
    : null;

  try {
    const ref = doc(db, 'leagues', LEAGUE_ID, 'matches', matchId);
    /* ✅︎ FIX 9 — هوية الكاتب. لا يمنع الكتابة (last-write-wins يبقى)،
       لكنه يكشف وجود منظّم آخر على نفس المباراة فوراً بدل التدمير الصامت.
       window._LP_SESSION يُولَّد مرة لكل تبويب في timer-hotfix.js */
    liveData.writerId = window._LP_SESSION || null;
    liveData.writerAt = Date.now();
    await updateDoc(ref, {
      liveData,
      ...extraData,
      status: matchStatus,
      homeScore: finalHomeScore,
      awayScore: finalAwayScore,
      endTime: st.matchStatus === 'ended' ? serverTimestamp() : null,
      penaltyScoreHome: st.penalties ? (st.penHomeScore != null ? st.penHomeScore : null) : null,
      penaltyScoreAway: st.penalties ? (st.penAwayScore != null ? st.penAwayScore : null) : null,
      updatedAt: serverTimestamp(),
    });
    window._lpSetSaveState(matchId, 'ok');
    setTimeout(() => { const e2 = document.getElementById('lp-save-' + matchId); if (e2 && !e2.classList.contains('lp-save-saving')) window._lpSetSaveState(matchId, 'idle'); }, 3000);
  } catch(e) {
    window._lpSetSaveState(matchId, 'err');
    window.showToast && window.showToast('خطأ في الحفظ: ' + e.message, 'error');
  }
}

// كشف _lpSaveV2 للاستخدام من الكود القديم
window._lpSaveV2 = _lpSaveV2;

// Override الـ save القديمة تماماً
window._lpSave = _lpSaveV2;

function _getPeriodText(st) {
  const map = {
    upcoming:    'قبل المباراة',
    live:        st.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول',
    halftime:    '⏸️ بين الشوطين',
    extratime1:  '⚡ الإضافي الأول',
    halftime_et: '⏸️ بين الإضافيين',
    extratime2:  '⚡ الإضافي الثاني',
    penalties:   '🥅 ركلات الترجيح',
    ended:       '🏁 انتهت المباراة',
  };
  return map[st.matchStatus] || 'قبل المباراة';
}

// Auto-save V2 كل 20 ثانية
function _startAutoSaveV2(matchId) {
  // ألغِ القديمة لو موجودة
  const st = _liveMatches[matchId];
  if (!st) return;
  if (st._autoSaveV2) clearInterval(st._autoSaveV2);
  st._autoSaveV2 = setInterval(() => {
    const s = _liveMatches[matchId];
    if (!s) { clearInterval(st._autoSaveV2); return; }
    if (['live','halftime','extratime1','halftime_et','extratime2','penalties'].includes(s.matchStatus)) {
      window._lpSaveV2(matchId);
    }
  }, 20000);
}

// ─────────────────────────────────────────────────────────────────
// §11 — إعدادات البطولة: إضافة ET1/ET2 في صفحة الإعدادات
// ─────────────────────────────────────────────────────────────────
function _injectETSettings() {
  const etToggle = document.querySelector('.toggle-row[data-key="hasExtraTime"]');
  if (!etToggle || document.getElementById('setET1Dur')) return;

  const etSettingsHTML = `
    <div id="et-settings-block" style="margin-top:10px;padding:10px 12px;background:var(--card3);border-radius:10px;border:1px solid var(--border2)">
      <div style="font-size:10px;color:var(--muted2);font-weight:700;margin-bottom:10px">⚡ إعدادات الوقت الإضافي</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">⏱ وإضافي 1 (د)</label>
          <input class="form-input" type="number" id="setET1Dur" value="15" min="1" max="30" oninput="updateMatchDurPreview()"/>
        </div>
        <div class="form-group">
          <label class="form-label">⏱ وإضافي 2 (د)</label>
          <input class="form-input" type="number" id="setET2Dur" value="15" min="1" max="30" oninput="updateMatchDurPreview()"/>
        </div>
      </div>
    </div>`;

  etToggle.insertAdjacentHTML('afterend', etSettingsHTML);
}

// ✅︎ ملاحظة: حفظ وتحميل مدة الوقت الإضافي (ET1/ET2) موحّد الآن مباشرة
// داخل saveSettings() و applySettings() الرئيسيتين — لا حاجة لتصحيح منفصل هنا.

// ─────────────────────────────────────────────────────────────────
// §12 — تحديث الـ Viewer (liveData القادم من Firebase)
//  يُوسّع _calcMatchSecs و renderLiveFullCard
// ─────────────────────────────────────────────────────────────────

// دالة موحدة لحساب الثواني الحالية من بيانات liveData
window._calcMatchSecsV2 = function(d) {
  if (!d) return 0;
  if (d.timerPaused) return d.timerSeconds || 0;
  const phase = d.matchStatus;
  let ref = null;
  if (phase === 'live')       ref = d.currentHalf === 2 ? d.half2StartedAt : d.half1StartedAt;
  if (phase === 'extratime1') ref = d.et1StartedAt;
  if (phase === 'extratime2') ref = d.et2StartedAt;
  if (ref) {
    // تحويل Firestore Timestamp إذا كان object
    const refMs = (typeof ref === 'number') ? ref
                : (ref && typeof ref.toMillis === 'function') ? ref.toMillis()
                : (ref && typeof ref.seconds === 'number') ? ref.seconds * 1000
                : null;
    if (refMs) return Math.floor((Date.now() - refMs) / 1000);
  }
  return d.timerSeconds || 0;
};

// دالة عرض الوقت الموحدة للـ Viewer
window._fmtTimerV2 = function(d) {
  if (!d) return '--:--';
  const phase = d.matchStatus;
  if (phase === 'halftime')    return '⏸️ بين الشوطين';
  if (phase === 'halftime_et') return '⏸️ بين الإضافيين';
  if (phase === 'penalties')   return '🥅 ر.ج';
  if (phase === 'ended')       return '🏁 انتهت';
  if (phase === 'upcoming')    return '--:--';

  // المدة من إعدادات المنظم — لا 45 ثابتة
  let halfDur, xMins;
  if (phase === 'extratime1') {
    halfDur = d.et1Duration  || 15;
    xMins   = d.et1ExtraMinutes || 0;
  } else if (phase === 'extratime2') {
    halfDur = d.et2Duration  || 15;
    xMins   = d.et2ExtraMinutes || 0;
  } else {
    halfDur = d.currentHalf === 2
      ? (d.half2Duration || d.halfDuration || 45)
      : (d.half1Duration || d.halfDuration || 45);
    xMins   = d.currentHalf === 2 ? (d.half2ExtraMinutes||0) : (d.half1ExtraMinutes||0);
  }

  const secs = window._calcMatchSecsV2(d);
  const mm = Math.floor(secs / 60), ss = secs % 60;
  const dispMm = String(Math.min(mm, halfDur)).padStart(2,'0');
  const dispSs = mm < halfDur ? String(ss).padStart(2,'0') : '00';
  let out = dispMm + ':' + dispSs;
  if (mm >= halfDur && xMins > 0) {
    const xm = Math.min(Math.floor(Math.max(0, secs - halfDur * 60) / 60), xMins);
    out += ' +' + xm + "'";
  }
  return out;
};

// دالة نص الفترة للجمهور
window._getPeriodLabelV2 = function(d) {
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
};

// ─────────────────────────────────────────────────────────────────
// §13 — CSS الإضافي
// ─────────────────────────────────────────────────────────────────
function _injectV2CSS() {
  if (document.getElementById('_lpv2_css')) return;
  const s = document.createElement('style');
  s.id = '_lpv2_css';
  s.textContent = `
    /* Status extra */
    .lp-s-et  { background:rgba(243,156,18,.12)!important; border-color:rgba(243,156,18,.4)!important; color:#D35400!important; }
    .lp-s-pen { background:rgba(155,89,182,.12)!important; border-color:rgba(155,89,182,.4)!important; color:#9b59b6!important; }

    /* Buttons extra */
    .lp-btn-et2  { background:rgba(243,156,18,.12); border:1px solid rgba(243,156,18,.4); color:#D35400; }
    .lp-btn-pen  { background:rgba(155,89,182,.12); border:1px solid rgba(155,89,182,.4); color:#9b59b6; }
    .lp-btn-et2:hover { background:rgba(243,156,18,.22); }
    .lp-btn-pen:hover { background:rgba(155,89,182,.22); }

    /* ══ Stats ══ */
    .lp-stats-card {
      background:var(--card2,#161616);
      border:1px solid var(--border2,#2a2a2a);
      border-radius:14px; padding:14px; margin:10px 0;
    }
    .lp-stats-header {
      display:flex; align-items:center; gap:8px;
      margin-bottom:12px; flex-wrap:wrap;
      font-size:12px; font-weight:900; color:var(--gold,#C9A02B);
    }
    .lp-stats-teams { display:flex; gap:6px; align-items:center; font-size:10px; color:var(--muted); margin-right:auto; }
    .lp-stats-team-name { color:var(--text,#eee); font-weight:700; }
    .lp-stats-save-btn {
      padding:5px 12px; background:linear-gradient(135deg,var(--gold2,#7a5f1a),var(--gold,#C9A02B));
      border:none; border-radius:8px; color:#000; font-size:11px; font-weight:900;
      font-family:Tajawal,sans-serif; cursor:pointer;
    }
    .lp-stat-row {
      display:grid; grid-template-columns:90px 1fr;
      gap:8px; align-items:center; padding:5px 0;
      border-bottom:1px solid var(--border,#222);
    }
    .lp-stat-row:last-child { border-bottom:none; }
    .lp-stat-label { font-size:11px; color:var(--muted,#666); }
    .lp-stat-controls { display:flex; align-items:center; gap:6px; }
    .lp-stat-side { display:flex; align-items:center; gap:5px; }
    .lp-stat-side-away { flex-direction:row-reverse; }
    .lp-stat-btn {
      width:26px; height:26px; border-radius:6px;
      background:var(--card3,#1a1a1a); border:1px solid var(--border2,#2a2a2a);
      color:var(--text,#eee); font-size:14px; font-weight:900; cursor:pointer;
      display:flex; align-items:center; justify-content:center; line-height:1;
      font-family:Tajawal,sans-serif;
    }
    .lp-stat-btn:active { transform:scale(.92); }
    .lp-stat-val { font-size:15px; font-weight:900; color:var(--gold,#C9A02B); min-width:28px; text-align:center; font-family:Tajawal,sans-serif; }
    .lp-stat-divider { font-size:16px; flex:1; text-align:center; opacity:.5; }
    /* possession bar */
    .lp-stat-bar-wrap { flex:1; height:6px; background:var(--card3,#1a1a1a); border-radius:3px; position:relative; overflow:hidden; }
    .lp-stat-bar-inner { position:absolute; top:0; height:100%; background:var(--gold,#C9A02B); border-radius:3px; transition:width .3s; }

    /* ══ Penalties ══ */
    .lp-pen-card {
      background:linear-gradient(135deg,rgba(155,89,182,.08),transparent);
      border:1px solid rgba(155,89,182,.25); border-radius:14px;
      padding:14px; margin:10px 0;
    }
    .lp-pen-header { font-size:13px; font-weight:900; color:#9b59b6; margin-bottom:12px; text-align:center; }
    .lp-pen-body { display:flex; align-items:center; gap:10px; }
    .lp-pen-team { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; }
    .lp-pen-team-name { font-size:11px; font-weight:700; color:var(--text,#eee); text-align:center; }
    .lp-pen-kicks { display:flex; flex-wrap:wrap; gap:3px; justify-content:center; min-height:20px; }
    .lp-pen-kick { font-size:14px; }
    .lp-pen-score-big { font-size:36px; font-weight:900; color:#9b59b6; font-family:Tajawal,sans-serif; }
    .lp-pen-add-btn {
      padding:7px 14px; border-radius:8px; font-size:11px; font-weight:700;
      cursor:pointer; border:none; font-family:Tajawal,sans-serif; width:100%;
      background:rgba(39,174,96,.15); border:1px solid rgba(39,174,96,.35); color:#27ae60;
    }
    .lp-pen-add-btn.lp-pen-miss { background:rgba(192,57,43,.1); border-color:rgba(192,57,43,.3); color:#C0392B; }
    .lp-pen-vs { font-size:13px; color:var(--muted,#666); font-weight:700; }
    .lp-pen-undo-btn {
      width:100%; margin-top:10px; padding:8px; background:var(--card3,#1a1a1a);
      border:1px solid var(--border2,#2a2a2a); border-radius:8px;
      color:var(--muted,#666); font-size:11px; cursor:pointer; font-family:Tajawal,sans-serif;
    }
    .lp-pen-goal  { color:#27ae60; }
    .lp-pen-miss-dot { color:#C0392B; }
  `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────
// §14 — تهيئة بعد تحميل الصفحة
// ─────────────────────────────────────────────────────────────────
function _init() {
  _injectETSettings();
  _injectV2CSS();
  // ✅︎ ملاحظة: applySettings() الرئيسية تحمّل الآن حقول ET1/ET2 مباشرة، لا حاجة لتصحيح إضافي هنا.
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
else _init();

// ─────────────────────────────────────────────────────────────────
// §15 — تصدير لدعم الـ Viewer مستقبلاً
// ─────────────────────────────────────────────────────────────────
window._liveSystemV2 = {
  calcSecs:       _calcSecsFromServer,
  getHalfDur:     _getHalfDur,
  getExtraMins:   _getExtraMins,
  getPeriodText:  _getPeriodText,
};

// console.log('[LIVE V2] ✅︎ نظام البث الرسمي المتكامل — تم التحميل');




// كشف أي أخطاء غير ظاهرة للمستخدم (يساعد في معرفة سبب "ما يعطيني تنبيه")
window.addEventListener('unhandledrejection', (e) => {
  try { console.error('UnhandledRejection:', e.reason); } catch(_) {}
});
window.addEventListener('error', (e) => {
  try { console.error('WindowError:', e.message); } catch(_) {}
});

// ══ SUBSCRIPTION CHECK ══
async function checkSubscription() {
  if(!LEAGUE_ID) return;
  try {
    // جلب الاشتراك المرتبط بالبطولة
    const subsSnap = await getDocs(query(collection(db, 'subscriptions'), where('leagueId', '==', LEAGUE_ID)));
    if(subsSnap.empty) {
      // لا يوجد اشتراك — أظهر overlay
      showLockedOverlay('لا يوجد اشتراك نشط', `لم يتم تفعيل اشتراك لهذه البطولة في منصة ${PLATFORM_NAME}. تواصل مع المسؤول.`);
      renderSubscriptionInfo(null);
      return;
    }
    const sub = subsSnap.docs[0].data();
    const now = new Date();
    const end = sub.endDate ? new Date(sub.endDate) : null;
    const diff = end ? Math.ceil((end - now) / (1000*60*60*24)) : 999;

    renderSubscriptionInfo(sub, diff);

    if(sub.status === 'cancelled' || sub.status === 'expired' || diff <= 0) {
      showLockedOverlay('انتهى الاشتراك', `انتهى اشتراكك في منصة ${PLATFORM_NAME} بتاريخ ${sub.endDate || '—'}. تواصل مع المسؤول لتجديده.`);
      return;
    }

    // تحذير إذا أقل من 7 أيام
    if(diff <= 7) {
      const banner = document.getElementById('subExpiredBanner');
      const msg = document.getElementById('subExpiredMsg');
      if(banner) banner.style.display = 'block';
      if(msg) msg.textContent = `⚠️ ينتهي اشتراكك بعد ${diff} يوم (${sub.endDate}) — تواصل مع المسؤول للتجديد`;
    }

    // فحص قفل البطولة من superadmin
    const leagueDoc = await getDoc(doc(db, 'leagues', LEAGUE_ID));
    if(leagueDoc.exists()) {
      const ld = leagueDoc.data();
      if(ld.locked) {
        showLockedOverlay('البطولة مقفلة', `قام المسؤول بقفل هذه البطولة. لا يمكن إجراء أي تعديلات حتى يتم رفع القفل.`);
        return;
      }
      if(ld.status === 'suspended') {
        showLockedOverlay('البطولة موقوفة', `تم إيقاف هذه البطولة من قبل مسؤول المنصة. تواصل معه لمعرفة السبب.`);
        return;
      }
    }
  } catch(e) { }
}

// ══ عرض تفاصيل الاشتراك في صفحة الإعدادات ══
function renderSubscriptionInfo(sub, diff) {
  const statusEl = document.getElementById('subInfoStatus');
  const startEl  = document.getElementById('subInfoStart');
  const endEl    = document.getElementById('subInfoEnd');
  const daysEl   = document.getElementById('subInfoDays');
  const barEl    = document.getElementById('subInfoBar');
  const noteEl   = document.getElementById('subInfoNote');
  if(!statusEl) return;

  if(!sub) {
    statusEl.textContent = '⚠️ لا يوجد اشتراك';
    statusEl.style.color = 'var(--red)';
    startEl.textContent = '—';
    endEl.textContent = '—';
    daysEl.textContent = '—';
    if(barEl) barEl.style.width = '0%';
    if(noteEl) noteEl.textContent = 'تواصل مع مسؤول المنصة لتفعيل اشتراك لهذه البطولة.';
    return;
  }

  const d = typeof diff === 'number' ? diff : 999;
  let statusText = '🟢 نشط', statusColor = 'var(--green)';
  if(sub.status === 'cancelled') { statusText = '⚫ ملغى'; statusColor = 'var(--muted2)'; }
  else if(d <= 0) { statusText = '🔴 منتهي'; statusColor = 'var(--red)'; }
  else if(d <= 7) { statusText = '⚠️ ينتهي قريباً'; statusColor = 'var(--orange)'; }

  statusEl.textContent = statusText;
  statusEl.style.color = statusColor;
  startEl.textContent = sub.startDate || '—';
  endEl.textContent = sub.endDate || '—';
  daysEl.textContent = d > 0 && d < 999 ? d + ' يوم' : (d <= 0 ? 'منتهي' : '—');
  daysEl.style.color = statusColor;

  if(barEl && sub.startDate && sub.endDate) {
    const total = (new Date(sub.endDate) - new Date(sub.startDate)) / (1000*60*60*24);
    const passed = (now => now - new Date(sub.startDate))(new Date()) / (1000*60*60*24);
    const pct = total > 0 ? Math.min(100, Math.max(0, (passed / total) * 100)) : 0;
    barEl.style.width = pct + '%';
    barEl.style.background = statusColor;
  }
  if(noteEl) {
    noteEl.textContent = d <= 7 && d > 0
      ? 'اشتراكك على وشك الانتهاء — تواصل مع مسؤول المنصة للتجديد.'
      : (d <= 0 ? 'انتهى الاشتراك — تواصل مع مسؤول المنصة للتجديد فوراً.' : 'اشتراكك نشط وكل شيء يعمل بشكل طبيعي.');
  }
}

/* ✅︎ القفل صار حقيقياً — كان بصرياً فقط.
   قبلاً: classList.add('show') فقط. أي منظّم منتهٍ اشتراكه يحذف
   #lockedOverlay من DevTools (سطر واحد) ويواصل العمل بالكامل،
   لأن قواعد Firestore كانت تفحص canManage() ولا تعرف شيئاً عن الاشتراك.
   الآن: القواعد ترفض الكتابة على الخادم (الدفاع الحقيقي)، وهذه طبقة
   ثانية تمنع المحاولة أصلاً وتعطي رسالة مفهومة بدل أخطاء غامضة. */
window._LEAGUE_LOCKED = false;

function showLockedOverlay(title, msg) {
  window._LEAGUE_LOCKED = true;
  const ov = document.getElementById('lockedOverlay');
  const t = document.getElementById('lockedTitle');
  const m = document.getElementById('lockedMsg');
  if (t) t.textContent = title;
  if (m) m.textContent = msg;
  if (ov) {
    ov.classList.add('show');
    // أعده لآخر body ليعلو أي نافذة، وراقب حذفه
    if (ov.parentNode !== document.body || ov.nextSibling) document.body.appendChild(ov);
    if (!ov._guard) {
      ov._guard = new MutationObserver(() => {
        if (window._LEAGUE_LOCKED && !document.body.contains(ov)) {
          document.body.appendChild(ov);   // أُعيده لو حُذف
        }
      });
      ov._guard.observe(document.body, { childList: true });
    }
  }
}

/* حارس الكتابة — يمنع أي استدعاء يعدّل البيانات وهي مقفلة */
window._assertUnlocked = function (what) {
  if (!window._LEAGUE_LOCKED) return true;
  showToast('البطولة مقفلة — ' + (what || 'لا يمكن التعديل') + '. تواصل مع المسؤول', 'error');
  return false;
};

// ══ TEAM — معالجة الشعار ══
// Default must exist in global scope before `addTeam()`/save runs
let selectedTeamColor = '#C9A02B';
// teamLogoDataUrl holds either a base64 image (from upload) or null when using emoji
let teamLogoDataUrl = null;


window.handleTeamLogoUpload = function(input) {
  const file = input.files[0];
  if(!file) return;
  if(!/^image\//.test(file.type)) { showToast('اختر ملف صورة', 'error'); return; }
  if(file.size > 5 * 1024 * 1024) { showToast('الصورة أكبر من 5MB', 'error'); return; }
  // ✅︎ ضغط إجباري — بدونه: صورة 2MB تصير 2.67MB بـ base64 وتتجاوز حد وثيقة
  //    Firestore (1MB)، ويُحمَّل الشعار كاملاً لكل زائر عند كل فتح للصفحة.
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 256;
      let w = img.width, h = img.height;
      if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      else if (h > MAX)     { w = Math.round(w * MAX / h); h = MAX; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let out = c.toDataURL('image/webp', 0.85);
      if (out.length > 60000 || out.indexOf('data:image/webp') !== 0) out = c.toDataURL('image/png');
      if (out.length > 60000) out = c.toDataURL('image/jpeg', 0.8);
      teamLogoDataUrl = out;
      const prev = document.getElementById('teamLogoPreview');
      if(prev) {
        prev.textContent = '';
        prev.style.backgroundImage = 'url(' + teamLogoDataUrl + ')';
        prev.style.backgroundSize = 'cover';
        prev.style.backgroundPosition = 'center';
      }
      const li = document.getElementById('newTeamLogo');
      if (li) li.value = '';
      document.querySelectorAll('.ep-btn.sel').forEach(b => b.classList.remove('sel'));
    };
    img.onerror = function(){ showToast('تعذّر قراءة الصورة', 'error'); };
    img.src = e.target.result;
    return;
    // (الكود القديم أدناه لم يعد يُنفَّذ)
    teamLogoDataUrl = e.target.result;
    const prev = document.getElementById('teamLogoPreview');
    if(prev) {
      prev.textContent = '';
      prev.style.backgroundImage = 'url(' + teamLogoDataUrl + ')';
      prev.style.backgroundSize = 'cover';
      prev.style.backgroundPosition = 'center';
    }
    document.getElementById('newTeamLogo').value = '';
    document.querySelectorAll('.ep-btn.sel').forEach(b => b.classList.remove('sel'));
  };
  reader.readAsDataURL(file);
};
window._clearTeamLogoData = function() { teamLogoDataUrl = null; };
window.updateLogoPreview = function() {
  const val = document.getElementById('newTeamLogo').value;
  const prev = document.getElementById('teamLogoPreview');
  if(prev) {
    prev.textContent = val || '⚽';
    prev.style.backgroundImage = '';
    prev.style.backgroundSize = '';
  }
  teamLogoDataUrl = null;
  document.querySelectorAll('.ep-btn.sel').forEach(b => b.classList.remove('sel'));
};

// تهيئة picker الإيموجي
function initEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  if(!picker) return;
  const emojis = ['🦅','🦁','🐯','🐻','🦊','🐺','🦈','🐬','🦉','🦋','🌟','⚡','🔥','💎','👑','🏆','⚽','🎯','🛡️','⚔️','🌙','☀︎️','🌊','🏔️','🌹','🦄','🐉','🎪','🚀','🎭','🌴','🍀','💪','🤝','🎖️','🏅','🌺','🎨','🔮','🌈'];
  picker.innerHTML = emojis.map(e =>
    `<button class="ep-btn" onclick="selectEmoji('${e}')" type="button">${e}</button>`
  ).join('');
}

window.selectEmoji = function(emoji) {
  teamLogoDataUrl = null;
  const prev = document.getElementById('teamLogoPreview');
  if(prev) { prev.textContent = emoji; prev.style.backgroundImage = ''; prev.style.backgroundSize = ''; }
  document.getElementById('newTeamLogo').value = emoji;
  document.querySelectorAll('.ep-btn').forEach(b => b.classList.toggle('sel', b.textContent === emoji));
};

// ══ TEAM — تعديل فريق ══
let editingTeamId = null;
let editLogoDataUrl = null;
let editLogoDelete = false;

window.openEditTeam = function(id) {
  const t = teams.find(x => x.id === id);
  if(!t) return;
  editingTeamId = id;
  editLogoDataUrl = null;
  editLogoDelete = false;
  document.getElementById('editTeamId').value = id;
  document.getElementById('editTeamName').value = t.name || '';
  document.getElementById('editTeamShort').value = t.shortName || '';
  document.getElementById('editTeamCoach').value = t.coach || '';
  document.getElementById('editTeamManager').value = t.manager || '';
  document.getElementById('editTeamStadium').value = t.stadium || '';
  document.getElementById('editTeamFounded').value = t.founded || '';
  document.getElementById('editTeamPhone').value = t.phone || '';
  document.getElementById('editTeamInsta').value = t.insta || '';
  document.getElementById('editTeamBio').value = t.bio || '';
  const prev = document.getElementById('editLogoPreview');
  const isImg = t.logo && (t.logo.startsWith('data:') || t.logo.startsWith('http://') || t.logo.startsWith('https://') || t.logo.startsWith('/'));
  if(isImg) {
    prev.textContent = '';
    prev.style.backgroundImage = 'url(' + t.logo + ')';
    prev.style.backgroundSize = 'cover';
    prev.style.backgroundPosition = 'center';
  } else {
    prev.textContent = t.logo || '⚽';
    prev.style.backgroundImage = '';
  }
  openModal('modal-edit-team');
};

window.handleEditLogoUpload = function(input) {
  const file = input.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024) { showToast('الصورة أكبر من 2MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    editLogoDataUrl = e.target.result;
    editLogoDelete = false;
    const prev = document.getElementById('editLogoPreview');
    prev.textContent = '';
    prev.style.backgroundImage = 'url(' + editLogoDataUrl + ')';
    prev.style.backgroundSize = 'cover';
    prev.style.backgroundPosition = 'center';
  };
  reader.readAsDataURL(file);
};

window.deleteEditLogo = function() {
  if(confirm('هل تريد حذف الشعار؟ سيتم استبداله بإيموجي افتراضي')) {
    editLogoDelete = true;
    editLogoDataUrl = null;
    const prev = document.getElementById('editLogoPreview');
    prev.textContent = '⚽';
    prev.style.backgroundImage = '';
    showToast('سيتم حذف الشعار عند الحفظ', 'error');
  }
};

window.saveEditTeam = async function() {
  const id = editingTeamId;
  if(!id) return;
  const name = document.getElementById('editTeamName').value.trim();
  if(!name) { showToast('أدخل اسم الفريق', 'error'); return; }
  const t = teams.find(x => x.id === id);
  let logo;
  if(editLogoDelete) {
    logo = '⚽';
  } else if(editLogoDataUrl) {
    logo = editLogoDataUrl;
  } else {
    logo = t?.logo || '⚽';
  }
  const data = {
    name,
    logo,
    shortName: document.getElementById('editTeamShort').value.trim(),
    coach: document.getElementById('editTeamCoach').value.trim(),
    manager: document.getElementById('editTeamManager').value.trim(),
    stadium: document.getElementById('editTeamStadium').value.trim(),
    founded: document.getElementById('editTeamFounded').value || '',
    phone: document.getElementById('editTeamPhone').value.trim(),
    insta: document.getElementById('editTeamInsta').value.trim(),
    bio: document.getElementById('editTeamBio').value.trim(),
  };
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', id), data);

    // ── مزامنة الشعار والاسم في كل المباريات المرتبطة ──
    const logoChanged = logo !== t?.logo;
    const nameChanged = name !== t?.name;
    if ((logoChanged || nameChanged) && matches.length > 0) {
      const relatedMatches = matches.filter(m => m.homeId === id || m.awayId === id);
      if (relatedMatches.length > 0) {
        const batch = writeBatch(db);
        relatedMatches.forEach(m => {
          const updates = {};
          if (m.homeId === id) {
            if (logoChanged) updates.homeLogo = logo;
            if (nameChanged) updates.homeName = name;
          }
          if (m.awayId === id) {
            if (logoChanged) updates.awayLogo = logo;
            if (nameChanged) updates.awayName = name;
          }
          batch.update(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id), updates);
        });
        await batch.commit();
      }
    }

    closeModal('modal-edit-team');
    showToast('✅︎ تم تحديث بيانات ' + name, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};
window.selectTeamColor = function(el) {
  selectedTeamColor = el.dataset.color;
  document.querySelectorAll('.tc-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
};
window.selectTeamColorCustom = function(val) {
  selectedTeamColor = val;
  document.querySelectorAll('.tc-swatch').forEach(s => s.classList.remove('sel'));
};

// ══ PWA — تثبيت ══
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('installBanner');
  if(banner && !localStorage.getItem('pwa_dismissed')) banner.style.display = 'block';
});
document.getElementById('installBtn')?.addEventListener('click', async () => {
  if(deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById('installBanner').style.display = 'none';
    if(outcome === 'accepted') localStorage.setItem('pwa_installed','1');
  }
});
document.querySelector('.ib-dismiss')?.addEventListener('click', () => {
  localStorage.setItem('pwa_dismissed','1');
});

// ══ iOS INSTALL BANNER ══
(function() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const dismissed = sessionStorage.getItem('ios_install_dismissed');
  if (isIos && !isStandalone && !dismissed) {
    setTimeout(() => {
      const b = document.getElementById('iosBanner');
      if(b) b.classList.add('show');
    }, 2500);
  }
})();

// تشغيل فحص الاشتراك بعد الدخول — مُدمج في enterApp الأصلي
const _origEnterApp = window.enterApp;
window.enterApp = function() {
  _origEnterApp?.();
  initEmojiPicker();
};

// Set today as default match date
const mdEl = document.getElementById('matchDate');
if(mdEl) mdEl.value = new Date().toISOString().split('T')[0];



// ══════════════════════════════════════════════════════════════
// 🔥 GROUPS & KNOCKOUT ADMIN ENGINE — PATCH
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// 🔥 GROUPS & KNOCKOUT ADMIN ENGINE — PATCH (أضف في نهاية admin.js)
// ══════════════════════════════════════════════════════════════
// يُضاف في نهاية ملف admin.js الموجود
// يُضيف:
//   - إدارة المجموعات (إنشاء، إضافة فرق، تحديد متأهلين)
//   - إدارة أدوار الإقصائي (إنشاء أدوار، إضافة مباريات، تحديد متأهلين)
//   - واجهة ديناميكية في لوحة التحكم حسب نوع البطولة
// ══════════════════════════════════════════════════════════════

// ━━ STATE إضافي ━━
let adminGroups = [];       // مجموعات من Firestore
let adminKnockoutRounds = []; // أدوار إقصائية من Firestore

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── A. تحميل المجموعات والأدوار من Firestore ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function loadGroupsAndKnockout() {
  if (!LEAGUE_ID) return;

  // real-time groups
  onSnapshot(collection(db, 'leagues', LEAGUE_ID, 'groups'), (snap) => {
    adminGroups = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    window.adminGroups = adminGroups;   // ✅︎ تصدير لحارس المجموعات
    window.renderGroupsAdmin();
    /* ✅︎ أعد فحص بوابة المجموعات مع كل تغيير توزيع */
    if (typeof window._checkForceGroupsGate === 'function') window._checkForceGroupsGate();
  }, (err) => console.error('Groups listener error:', err));

  // real-time knockoutRounds
  onSnapshot(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'), (snap) => {
    adminKnockoutRounds = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    renderKnockoutAdmin();
  }, (err) => console.error('KnockoutRounds listener error:', err));

  // real-time settings (لمتابعة bracketPublished)
  onSnapshot(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'), (snap) => {
    if(snap.exists()) {
      const data = snap.data();
      settings = { ...settings, ...data };
      window.settings = settings;
      updateBracketPublishUI(data.bracketPublished === true);
    }
  }, () => {});
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── B. تحديث selectType ليُظهر/يُخفي أقسام المجموعات والإقصاء ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _origSelectType = window.selectType;
window.selectType = function (el, type) {
  if (_origSelectType) _origSelectType(el, type); // الأصل يحفظ settings.type
  window._adaptAdminUIToType(type);
};

function _adaptAdminUIToType(type) {
  const sbGroups = document.getElementById('sb-groups');
  const sbKnockout = document.getElementById('sb-knockout');
  const sbZones = document.getElementById('sb-zones');
  // إخفاء/إظهار زر الترتيب في الـ sidebar — يظهر فقط في نظام الدوري
  const sbStandings = document.querySelector('.sb-item[onclick*="standings"]');
  if (sbStandings) sbStandings.style.display = (type === 'league') ? 'flex' : 'none';

  if (sbGroups) sbGroups.style.display = (type === 'groups') ? 'flex' : 'none';
  if (sbKnockout) sbKnockout.style.display = (type === 'knockout' || type === 'groups') ? 'flex' : 'none';
  if (sbZones) sbZones.style.display = (type === 'league') ? 'flex' : 'none';

  // موبايل نافيجيشن — إخفاء زر الترتيب
  const mnStandings = document.querySelector('.mn-item[onclick*="standings"]');
  if (mnStandings) mnStandings.style.display = (type === 'league') ? '' : 'none';

  // ✅︎ إصلاح: إظهار/إخفاء أزرار المجموعات والإقصاء في الجوال بناءً على النوع
  const mnGroups   = document.getElementById('mn-groups');
  const mnKnockout = document.getElementById('mn-knockout');
  if (mnGroups)   mnGroups.style.display   = (type === 'groups')                       ? '' : 'none';
  if (mnKnockout) mnKnockout.style.display = (type === 'knockout' || type === 'groups') ? '' : 'none';

  // ✅︎ بطاقة "الترتيب الحالي" في لوحة التحكم — تُخفى تماماً خارج الدوري
  //    (كانت تبقى ظاهرة ويتغيّر عنوانها فقط)
  const dashCard = document.getElementById('dashStandingsCard');
  if (dashCard) dashCard.style.display = (type === 'league') ? '' : 'none';

  // ✅︎ زر "تفاصيل الترتيب" في أي مكان آخر
  document.querySelectorAll('[onclick*="showPage(\'standings\'"]').forEach(el => {
    const item = el.closest('.sb-item, .mn-item');
    if (!item) el.style.display = (type === 'league') ? '' : 'none';
  });

  _updateDashboardForType(type);

  // ⛔ typeNote أُزيل — القسم المحذوف يختفي بلا تنبيه مكانه
  const noteEl = document.getElementById('typeNote');
  if (noteEl) { noteEl.textContent = ''; noteEl.style.display = 'none'; }
}
window._adaptAdminUIToType = _adaptAdminUIToType;  // ✅︎ كانت محلية — all-fixes.js ينتظرها للأبد

function _updateDashboardForType(type) {
  // بطاقة الترتيب تُخفى بالكامل خارج الدوري — لا حاجة لإعادة تسميتها
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── C. إضافة عناصر HTML لإدارة المجموعات والإقصاء ──
//    (تُحقَن ديناميكياً في #panel-main)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function injectGroupsAndKnockoutPages() {
  const panelMain = document.getElementById('panel-main');
  if (!panelMain) return;

  // ── صفحة إدارة المجموعات ──
  if (!document.getElementById('page-groups')) {
    const groupsPage = document.createElement('div');
    groupsPage.className = 'section';
    groupsPage.id = 'page-groups';
    groupsPage.innerHTML = `
      <div class="page-header">
        <div class="page-title">👥 إدارة المجموعات</div>
        <div class="page-sub">إنشاء المجموعات وإضافة الفرق وتحديد المتأهلين</div>
        <div class="page-actions">
          <button class="btn btn-gold" onclick="adminAddGroup()">+ إضافة مجموعة</button>
          <button class="btn btn-outline" onclick="adminAutoCreateGroups()">⚙︎️ إعادة الإعداد</button>
        </div>
      </div>
      <div style="background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.15);border-radius:12px;padding:12px 14px;margin-bottom:16px;font-size:11px;color:var(--muted2);line-height:1.7">
        💡 <strong style="color:var(--gold)">كيفية الاستخدام:</strong>
        اختر كل مجموعة ← أضف الفرق المشاركة ← حدد عدد المتأهلين ← ثم أنشئ أدوار الإقصاء
      </div>
      <div id="groupsAdminList">
        <div class="spin"></div>
      </div>`;
    panelMain.querySelector('.section')?.parentElement?.insertBefore(groupsPage, panelMain.querySelector('.section'));
    panelMain.appendChild(groupsPage);
  }

  // ── صفحة إدارة الإقصاء ──
  if (!document.getElementById('page-knockout')) {
    const knockoutPage = document.createElement('div');
    knockoutPage.className = 'section';
    knockoutPage.id = 'page-knockout';
    knockoutPage.innerHTML = `
      <div class="page-header">
        <div class="page-title">🌳 إدارة الإقصاء</div>
        <div class="page-sub">شجرة الأدوار الإقصائية</div>
      </div>
      <div id="knockoutAdminList">
        <div class="spin"></div>
      </div>`;
    panelMain.appendChild(knockoutPage);
  }

  // ── إضافة عناصر السايدبار ──
  injectSidebarItems();
  injectAdminCSS();
  injectAdminModals();
}

function injectSidebarItems() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // إضافة قبل الـ LABEL "الإعدادات"
  const settingsLabel = Array.from(sidebar.querySelectorAll('.sb-label')).find(el => el.textContent.includes('الإعدادات'));

  const groupsItem = document.createElement('div');
  groupsItem.className = 'sb-item';
  groupsItem.id = 'sb-groups';
  groupsItem.style.display = 'none';
  groupsItem.setAttribute('data-page', 'groups');
  groupsItem.innerHTML = '<span class="sb-icon">👥</span> المجموعات';
  groupsItem.onclick = () => showPage('groups', groupsItem);

  const knockoutItem = document.createElement('div');
  knockoutItem.className = 'sb-item';
  knockoutItem.id = 'sb-knockout';
  knockoutItem.style.display = 'none';
  knockoutItem.setAttribute('data-page', 'knockout');
  knockoutItem.innerHTML = '<span class="sb-icon">🌳</span> الإقصاء';
  knockoutItem.onclick = () => showPage('knockout', knockoutItem);

  if (settingsLabel) {
    sidebar.insertBefore(knockoutItem, settingsLabel);
    sidebar.insertBefore(groupsItem, knockoutItem);
  } else {
    sidebar.appendChild(groupsItem);
    sidebar.appendChild(knockoutItem);
  }

  // إضافة للموبايل نافيجيشن
  const mobileNav = document.querySelector('.mobile-nav');
  if (mobileNav && !document.getElementById('mn-groups')) {
    const mnGroups = document.createElement('button');
    mnGroups.className = 'mn-item';
    mnGroups.id = 'mn-groups';
    mnGroups.style.display = 'none';
    mnGroups.innerHTML = '<span class="mn-icon">👥</span>مجموعات';
    mnGroups.onclick = () => { showPage('groups', null, mnGroups); switchTopTab('main', null); };
    mobileNav.appendChild(mnGroups);

    const mnKnockout = document.createElement('button');
    mnKnockout.className = 'mn-item';
    mnKnockout.id = 'mn-knockout';
    mnKnockout.style.display = 'none';
    mnKnockout.innerHTML = '<span class="mn-icon">🌳</span>إقصاء';
    mnKnockout.onclick = () => { showPage('knockout', null, mnKnockout); switchTopTab('main', null); };
    mobileNav.appendChild(mnKnockout);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── D. رندر إدارة المجموعات ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderGroupsAdmin() {
  const el = document.getElementById('groupsAdminList');
  if (!el) return;

  if (adminGroups.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="e-icon">👥</div>
        <div>لا توجد مجموعات بعد</div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px">أضف مجموعة أو استخدم التوزيع التلقائي</div>
      </div>`;
    return;
  }

  el.innerHTML = adminGroups.map(g => {
    const groupTeams = (g.teamIds || []).map(id => teams.find(t => t.id === id)).filter(Boolean);
    const qualifyCount = g.qualify || 2;

    return `
      <div class="admin-group-card">
        <div class="agc-header">
          <div class="agc-info">
            <div class="agc-title">${g.icon || '👥'} المجموعة ${g.name || ''}</div>
            <div class="agc-sub">${groupTeams.length} فريق · المتأهلون: أفضل ${qualifyCount}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="icon-btn" onclick="adminEditGroup('${g.id}')" title="تعديل">✏︎️</button>
            <button class="icon-btn del" onclick="adminDeleteGroup('${g.id}')">🗑</button>
          </div>
        </div>

        <!-- قائمة الفرق في المجموعة -->
        <div class="agc-teams">
          ${groupTeams.length === 0
            ? `<div style="text-align:center;padding:12px;color:var(--muted);font-size:11px">لا توجد فرق — أضف فرقاً للمجموعة</div>`
            : groupTeams.map((t, i) => {
                const isManualQ = (g.qualifiedTeamIds||[]).includes(t.id);
                const hasManualQ = (g.qualifiedTeamIds||[]).length > 0;
                const isAutoQ = !hasManualQ && i < qualifyCount;
                const isQ = isManualQ || isAutoQ;
                return `
              <div class="agc-team-row">
                <span style="color:${isQ ? 'var(--green)' : 'var(--muted)'};font-size:10px;font-weight:700;width:16px">${i + 1}</span>
                <span style="font-size:18px">${typeof logoHtml === 'function' ? logoHtml(t.logo, 20, 5) : t.logo || '⚽'}</span>
                <span style="flex:1;font-size:12px;font-weight:600">${t.name}</span>
                <button onclick="adminToggleQualified('${g.id}','${t.id}')"
                  style="font-size:9px;padding:2px 7px;border-radius:5px;border:1px solid ${isManualQ?'var(--green)':'var(--border2)'};background:${isManualQ?'rgba(39,174,96,.15)':'transparent'};color:${isManualQ?'var(--green)':'var(--muted)'};cursor:pointer;white-space:nowrap">
                  ${isManualQ ? '✅︎ متأهل' : '+ تأهيل'}
                </button>
                <button class="icon-btn del" style="width:24px;height:24px;font-size:10px" onclick="adminRemoveTeamFromGroup('${g.id}','${t.id}')">✕</button>
              </div>`;
              }).join('')
          }
        </div>

        <!-- ✅︎ §4: توزيع الفرق بالضغط — نافذة تعرض الفرق غير الموزّعة فقط -->
        <div class="agc-add-team">
          <button class="btn btn-gold btn-sm" style="width:100%" onclick="openGroupAssign('${g.id}')">
            👥 توزيع الفرق على هذه المجموعة
          </button>
        </div>

        <!-- إعداد عدد المتأهلين + زر الاعتماد الرسمي -->
        <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--muted2);flex:1">عدد المتأهلين من المجموعة</span>
          <input type="number" class="form-input" style="width:60px;padding:5px;text-align:center;font-size:12px"
            value="${qualifyCount}" min="1" max="${groupTeams.length}"
            onchange="adminUpdateGroupQualify('${g.id}', this.value)"/>
        </div>

        <!-- ✅︎ FIX §2: زر الاعتماد الرسمي — يتحكم في ما يظهر للجمهور -->
        <div style="padding:10px 12px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;background:${g.qualificationPublished ? 'rgba(39,174,96,.04)' : 'rgba(243,156,18,.03)'}">
          <div>
            <div style="font-size:11px;font-weight:700;color:${g.qualificationPublished ? 'var(--green)' : 'var(--muted2)'}">
              ${g.qualificationPublished ? '🌍 المتأهلون ظاهرون للجمهور' : '🔒 المتأهلون مخفيون عن الجمهور'}
            </div>
            <div style="font-size:9px;color:var(--muted);margin-top:2px">
              ${g.qualificationPublished ? 'اضغط لإخفائهم مؤقتاً' : 'ينشرون تلقائياً بمجرد ما تحدد فريقاً متأهلاً'}
            </div>
          </div>
          <button onclick="adminPublishQualification('${g.id}')"
            style="padding:7px 14px;border-radius:9px;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;
            border:1px solid ${g.qualificationPublished ? 'rgba(39,174,96,.4)' : 'rgba(243,156,18,.4)'};
            background:${g.qualificationPublished ? 'rgba(39,174,96,.12)' : 'rgba(243,156,18,.1)'};
            color:${g.qualificationPublished ? 'var(--green)' : '#D35400'}">
            ${g.qualificationPublished ? '🔒 إخفاء' : '✅︎ اعتماد ونشر'}
          </button>
        </div>
      </div>`;
  }).join('');
}
// ✅︎ تصدير — يسمح لـall-fixes.js باستبدالها فعلياً
window.renderGroupsAdmin = renderGroupsAdmin;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── E. إدارة المجموعات — العمليات ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.adminToggleQualified = async function(groupId, teamId) {
  const g = adminGroups.find(x => x.id === groupId);
  if(!g) return;
  const current = g.qualifiedTeamIds || [];
  let updated;
  if(current.includes(teamId)) {
    updated = current.filter(id => id !== teamId);
  } else {
    updated = [...current, teamId];
  }
  try {
    /* ✅︎ رجّعنا خطوتين منفصلتين (أثبت أنها الطريقة المضمونة):
       تحديد الفريق متأهلاً هنا لا يغيّر qualificationPublished إطلاقاً.
       الظهور للجمهور يتم فقط بالضغط على زر "اعتماد ونشر" بالأسفل. */
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), {
      qualifiedTeamIds: updated,
      updatedAt: serverTimestamp()
    });
    showToast(updated.includes(teamId) ? '✅︎ حُدد الفريق متأهلاً (لسه ما ظهر للجمهور — اضغط اعتماد ونشر)' : 'تم إلغاء التأهل', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ✅︎ FIX §2: اعتماد المتأهلين رسمياً ونشرهم للجمهور
window.adminPublishQualification = async function(groupId) {
  const g = adminGroups.find(x => x.id === groupId);
  if (!g) return;
  const isPublished = g.qualificationPublished === true;
  const next = !isPublished;

  if (next && (g.qualifiedTeamIds || []).length === 0) {
    showToast('حدد المتأهلين أولاً قبل الاعتماد', 'error');
    return;
  }

  if (next && !confirm(`اعتماد المتأهلين رسمياً للمجموعة "${g.name || ''}"؟ سيظهرون للجمهور فوراً.`)) return;

  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), {
      qualificationPublished: next,
      updatedAt: serverTimestamp()
    });
    showToast(next ? '🌍 تم نشر المتأهلين للجمهور' : '🔒 تم إخفاء المتأهلين عن الجمهور', next ? 'success' : 'error');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.adminAddGroup = async function () {
  injectGroupModal();
  window._editingGroupId = null;
  document.getElementById('gmTitle').textContent = '+ إضافة مجموعة';
  document.getElementById('gmName').value = '';
  document.getElementById('gmIcon').value = '👥';
  document.getElementById('gmQualify').value = '2';
  openModal('modal-group-edit');
};

window.adminDeleteGroup = async function (groupId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'حذف هذه المجموعة؟', confirmText: '🗑 نعم، احذف', danger: true }))) return;
  try {
    await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId));
    showToast('تم حذف المجموعة', 'error');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.adminEditGroup = async function (groupId) {
  const g = adminGroups.find(x => x.id === groupId);
  if (!g) return;
  injectGroupModal();
  window._editingGroupId = groupId;
  document.getElementById('gmTitle').textContent = 'تعديل المجموعة';
  document.getElementById('gmName').value = g.name || '';
  document.getElementById('gmIcon').value = g.icon || '👥';
  document.getElementById('gmQualify').value = g.qualify || 2;
  openModal('modal-group-edit');
};

function injectGroupModal() {
  if (document.getElementById('modal-group-edit')) return;
  const m = document.createElement('div');
  m.className = 'modal-overlay';
  m.id = 'modal-group-edit';
  m.innerHTML = `
    <div class="modal" style="max-width:380px;width:95%">
      <div class="modal-header">
        <div class="modal-title" id="gmTitle">المجموعة</div>
        <button class="modal-close" onclick="closeModal('modal-group-edit')">✕</button>
      </div>
      <div class="modal-body" style="padding:20px">
        <div class="form-group">
          <label class="form-label">اسم المجموعة</label>
          <input class="form-input" id="gmName" placeholder="مثال: A, B, ألف, باء"/>
        </div>
        <div class="form-group" style="margin-top:14px">
          <label class="form-label">الأيقونة</label>
          <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:6px">
            ${['🔵','🟡','🟢','🟣','🟠','⚫','🏆','⚽','🎯','🥊'].map(ic =>
              `<button style="font-size:20px;padding:6px;background:var(--card3);border:1px solid var(--border);border-radius:8px;cursor:pointer"
                onclick="document.getElementById('gmIcon').value='${ic}'">${ic}</button>`).join('')}
          </div>
          <input class="form-input" id="gmIcon" placeholder="إيموجي..." style="margin-top:8px"/>
        </div>
        <div class="form-group" style="margin-top:14px">
          <label class="form-label">عدد المتأهلين من هذه المجموعة</label>
          <input class="form-input" type="number" id="gmQualify" min="1" max="10" value="2"/>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn btn-outline" style="flex:1" onclick="closeModal('modal-group-edit')">إلغاء</button>
          <button class="btn btn-gold" style="flex:2" onclick="adminSaveGroup()">💾 حفظ</button>
        </div>
      </div>
    </div>`;
  m.addEventListener('click', e => { if(e.target === m) closeModal('modal-group-edit'); });
  document.body.appendChild(m);
}

window.adminSaveGroup = async function () {
  const name = document.getElementById('gmName').value.trim();
  const icon = document.getElementById('gmIcon').value.trim() || '👥';
  const qualify = parseInt(document.getElementById('gmQualify').value) || 2;
  if (!name) { showToast('أدخل اسم المجموعة', 'error'); return; }
  const gid = window._editingGroupId;
  try {
    if (gid) {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', gid), {
        name, icon, qualify, updatedAt: serverTimestamp()
      });
      showToast('✅︎ تم التحديث', 'success');
    } else {
      await addDoc(collection(db, 'leagues', LEAGUE_ID, 'groups'), {
        name, icon, teamIds: [], qualify, order: adminGroups.length, createdAt: serverTimestamp()
      });
      showToast(`✅︎ تمت إضافة المجموعة "${name}"`, 'success');
    }
    closeModal('modal-group-edit');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.adminAddTeamToGroup = async function (groupId) {
  const sel = document.getElementById('addTeamSel-' + groupId);
  if (!sel || !sel.value) { showToast('اختر فريقاً أولاً', 'error'); return; }
  const teamId = sel.value;
  const g = adminGroups.find(x => x.id === groupId);
  if (!g) return;

  // فحص إذا الفريق موجود في مجموعة أخرى
  const otherGroup = adminGroups.find(x => x.id !== groupId && (x.teamIds || []).includes(teamId));
  if (otherGroup) {
    if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: `هذا الفريق موجود في المجموعة "${otherGroup.name}". هل تريد نقله؟`, confirmText: 'تأكيد', danger: false }))) return;
    // إزالة من المجموعة الأخرى
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', otherGroup.id), {
      teamIds: (otherGroup.teamIds || []).filter(id => id !== teamId),
      updatedAt: serverTimestamp()
    });
  }

  const newIds = [...(g.teamIds || []), teamId];
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), {
      teamIds: newIds, updatedAt: serverTimestamp()
    });
    const t = teams.find(x => x.id === teamId);
    showToast(`✅︎ تمت إضافة "${t?.name || teamId}" للمجموعة`, 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ══════════════════════════════════════════════════════════════
// §4 — توزيع الفرق على المجموعات بالضغط (بدل السحب والإفلات)
//   • نافذة تعرض الفرق غير الموزّعة فقط
//   • يختار العدد المحدد للمجموعة ثم "حفظ"
//   • الفرق المختارة تختفي من بقية المجموعات تلقائياً
// ══════════════════════════════════════════════════════════════
window._gaSelected = window._gaSelected || {};

window.openGroupAssign = function (groupId) {
  const g = adminGroups.find(x => x.id === groupId);
  if (!g) return;

  // الفرق غير الموزّعة = ليست في أي مجموعة أخرى
  const takenElsewhere = new Set();
  adminGroups.forEach(x => {
    if (x.id !== groupId) (x.teamIds || []).forEach(id => takenElsewhere.add(id));
  });
  const current = new Set(g.teamIds || []);
  const pool = (window.teams || []).filter(t => !takenElsewhere.has(t.id));

  _gaSelected[groupId] = new Set(current);
  const cap = g.size || g.capacity || (window.settings?.groupSize) || 4;

  document.getElementById('gaOverlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'gaOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center;padding:0';
  ov.innerHTML = `
    <div style="width:100%;max-width:520px;background:var(--card,#111);border:1px solid var(--border2,#2a2a2a);border-radius:20px 20px 0 0;padding:18px;max-height:86vh;display:flex;flex-direction:column;font-family:Tajawal,sans-serif">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:16px;font-weight:900;color:var(--gold,#C9A02B)">${g.icon || '👥'} ${g.name}</div>
        <button onclick="document.getElementById('gaOverlay').remove()"
          style="width:30px;height:30px;border-radius:8px;border:1px solid var(--border2,#2a2a2a);background:transparent;color:var(--muted,#888);cursor:pointer;font-size:15px">✕</button>
      </div>
      <div style="font-size:11px;color:var(--muted,#888);margin-bottom:12px">
        اختر الفرق — <span id="gaCount" style="color:var(--gold,#C9A02B);font-weight:900">${current.size}</span> / ${cap}
      </div>
      <div id="gaList" style="overflow-y:auto;flex:1;display:grid;gap:8px;padding-bottom:8px">
        ${pool.length ? pool.map(t => {
          const on = current.has(t.id);
          return `<button type="button" id="ga_${t.id}" onclick="gaToggle('${groupId}','${t.id}',${cap})"
            style="display:flex;align-items:center;gap:10px;padding:11px;border-radius:12px;cursor:pointer;text-align:right;
            border:1px solid ${on ? 'var(--gold,#C9A02B)' : 'var(--border2,#2a2a2a)'};
            background:${on ? 'rgba(201,160,43,.12)' : 'var(--card2,#1a1a1a)'}">
            <span style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden">${logoHtml(t.logo, 24, 6)}</span>
            <span style="flex:1;font-size:13px;font-weight:700;color:var(--text,#eee)">${t.name}</span>
            <span id="gatick_${t.id}" style="font-size:14px;color:var(--gold,#C9A02B)">${on ? '✅︎' : '⚪'}</span>
          </button>`;
        }).join('') : `<div style="text-align:center;padding:26px;color:var(--muted,#888);font-size:12px">
          ✅︎ كل الفرق موزّعة على المجموعات
        </div>`}
      </div>
      <button onclick="gaSave('${groupId}')"
        style="margin-top:10px;padding:14px;border-radius:12px;border:none;background:var(--gold,#C9A02B);color:#000;font-family:Tajawal,sans-serif;font-weight:900;font-size:14px;cursor:pointer">
        💾 حفظ
      </button>
    </div>`;
  document.body.appendChild(ov);
  window.bindModalDismiss(ov);
};

window.gaToggle = function (groupId, teamId, cap) {
  const sel = _gaSelected[groupId];
  if (!sel) return;
  if (sel.has(teamId)) sel.delete(teamId);
  else {
    if (sel.size >= cap) { showToast(`الحد الأقصى ${cap} فرق لهذه المجموعة`, 'error'); return; }
    sel.add(teamId);
  }
  const on = sel.has(teamId);
  const btn = document.getElementById('ga_' + teamId);
  const tick = document.getElementById('gatick_' + teamId);
  if (btn) {
    btn.style.borderColor = on ? 'var(--gold,#C9A02B)' : 'var(--border2,#2a2a2a)';
    btn.style.background = on ? 'rgba(201,160,43,.12)' : 'var(--card2,#1a1a1a)';
  }
  if (tick) tick.textContent = on ? '✅︎' : '⚪';
  const cnt = document.getElementById('gaCount');
  if (cnt) cnt.textContent = sel.size;
};

window.gaSave = async function (groupId) {
  const sel = _gaSelected[groupId];
  if (!sel) return;
  const ids = [...sel];
  const g = adminGroups.find(x => x.id === groupId);
  const cap = g ? (g.size || g.capacity || (window.settings?.groupSize) || 4) : 0;

  // ⚠️ تنبيه واضح لو العدد ناقص — مع السماح بالحفظ الجزئي
  if (cap && ids.length > 0 && ids.length < cap) {
    const ok = await window.confirmDialog({
      title: '⚠️ المجموعة غير مكتملة',
      message: `اخترت ${ids.length} من ${cap} فرق. تقدر تكمل الباقي لاحقاً.\nهل تحفظ الآن؟`,
      confirmText: '💾 احفظ',
      danger: false
    });
    if (!ok) return;
  }

  // ✅︎ أغلق النافذة فوراً — لا تنتظر الشبكة (كانت تعلّق لو تأخر الحفظ)
  window.closeModal('gaOverlay');
  showToast('⏳ جاري الحفظ...', 'success');

  try {
    const batch = writeBatch(db);
    // الفرق المختارة تُزال من أي مجموعة أخرى (لا تتكرر أبداً)
    adminGroups.forEach(x => {
      if (x.id === groupId) return;
      const kept = (x.teamIds || []).filter(id => !sel.has(id));
      if (kept.length !== (x.teamIds || []).length) {
        batch.update(doc(db, 'leagues', LEAGUE_ID, 'groups', x.id), { teamIds: kept, updatedAt: serverTimestamp() });
      }
    });
    batch.update(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), { teamIds: ids, updatedAt: serverTimestamp() });
    await batch.commit();
    showToast(`✅︎ تم حفظ ${ids.length} ${ids.length === 1 ? 'فريق' : 'فرق'} في المجموعة`, 'success');
    try { renderGroupsAdmin && window.renderGroupsAdmin(); } catch (e) {}
  } catch (e) {
    showToast('❌︎ فشل الحفظ: ' + e.message, 'error');
  }
};

window.adminRemoveTeamFromGroup = async function (groupId, teamId) {
  const g = adminGroups.find(x => x.id === groupId);
  if (!g) return;
  const t = teams.find(x => x.id === teamId);
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: `إزالة "${t?.name || teamId}" من المجموعة؟`, confirmText: '🗑 نعم، احذف', danger: true }))) return;
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), {
      teamIds: (g.teamIds || []).filter(id => id !== teamId),
      updatedAt: serverTimestamp()
    });
    showToast('تم إزالة الفريق', 'error');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.adminUpdateGroupQualify = async function (groupId, value) {
  const n = parseInt(value);
  if (isNaN(n) || n < 1) return;
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'groups', groupId), {
      qualify: n, updatedAt: serverTimestamp()
    });
    showToast(`✅︎ تم تحديث المتأهلين: ${n}`, 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// توزيع الفرق تلقائياً على مجموعات متساوية — يفتح الـ wizard
window.adminAutoCreateGroups = async function () {
  // Open wizard with auto-distribute pre-selected
  const typeCard = document.querySelector('.type-card.selected') || document.querySelector('.type-card');
  openGroupsWizard(typeCard);
  // Pre-select auto distribute
  setTimeout(() => { window._wizDist = 'auto'; wizSelectDist('auto'); }, 100);
  return;

  // Legacy code below (kept for reference)
  if (teams.length === 0) { showToast('أضف الفرق أولاً', 'error'); return; }
  const groupCount = 4;
  const perGroup = Math.ceil(teams.length / groupCount);
  const qualifyPer = 2;
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: '...', confirmText: 'تأكيد', danger: false }))) return;

  // حذف المجموعات القديمة أولاً
  const batch1 = writeBatch(db);
  adminGroups.forEach(g => batch1.delete(doc(db, 'leagues', LEAGUE_ID, 'groups', g.id)));
  await batch1.commit();

  // إنشاء مجموعات جديدة
  const groupNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const groupIcons = ['🔵', '🔴', '🟡', '🟢', '🟣', '🟠', '⚪', '⚫'];
  const shuffled = [...teams].sort(() => Math.random() - 0.5);

  const batch2 = writeBatch(db);
  for (let i = 0; i < groupCount; i++) {
    const startIdx = Math.floor(i * teams.length / groupCount);
    const endIdx = Math.floor((i + 1) * teams.length / groupCount);
    const groupTeams = shuffled.slice(startIdx, endIdx);
    batch2.set(doc(collection(db, 'leagues', LEAGUE_ID, 'groups')), {
      name: groupNames[i] || (i + 1).toString(),
      icon: groupIcons[i] || '👥',
      teamIds: groupTeams.map(t => t.id),
      qualify: qualifyPer,
      order: i,
      createdAt: serverTimestamp()
    });
  }
  await batch2.commit();
  showToast(`✅︎ تم إنشاء ${groupCount} مجموعات وتوزيع الفرق`, 'success');
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── F. رندر إدارة الإقصاء ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ✅︎ تجميع المتأهلين المعتمدين رسمياً من كل المجموعات (المصدر الوحيد لملء شجرة الإقصاء)
function _getQualifiedPool() {
  const pool = [];
  (adminGroups || []).filter(g => g.qualificationPublished === true).forEach(g => {
    (g.qualifiedTeamIds || []).forEach(tid => {
      const t = teams.find(x => x.id === tid);
      if (t) pool.push({ id: t.id, name: t.name, logo: t.logo, groupName: g.name });
    });
  });
  return pool;
}

// الفرق الموضوعة بالفعل في أي مباراة إقصاء حالياً (حتى لا تُختار مرتين)
function _getPlacedKnockoutTeamIds() {
  const set = new Set();
  matches.filter(m => m.isKnockout).forEach(m => {
    if (m.homeId) set.add(m.homeId);
    if (m.awayId) set.add(m.awayId);
  });
  return set;
}

function renderKnockoutAdmin() {
  const el = document.getElementById('knockoutAdminList');
  if (!el) return;

  // ══════════════════════════════════════════════════════
  // الحالة 1: لا توجد أدوار → اعرض زر إنشاء الشجرة
  // ══════════════════════════════════════════════════════
  if (adminKnockoutRounds.length === 0) {
    el.innerHTML = `
      <div style="background:var(--card2);border:1px solid var(--border2);border-radius:16px;padding:20px;text-align:center">
        <div style="font-size:15px;font-weight:900;color:var(--text);margin-bottom:12px">🌳 إنشاء شجرة الإقصاء</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:18px">لم تقم بإنشاء أي دور إقصائي بعد</div>
        <button onclick="openKnockoutWizard(null)" style="padding:12px 24px;border-radius:10px;border:none;background:var(--gold);color:#000;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;cursor:pointer">📝 إضافة دور الإقصاء الآن</button>
      </div>`;
    return;
  }

  // ══════════════════════════════════════════════════════
  // الحالة 2: الشجرة موجودة → اعرضها بشكل شجرة عمودية تفاعلية (مطابقة لتصميم الجمهور، تدعم الجوال طولياً)
  // ══════════════════════════════════════════════════════
  const isPublished = settings.bracketPublished === true;

  const publishBar = `
    <div style="margin-bottom:14px;padding:12px 14px;
      background:${isPublished ? 'rgba(39,174,96,.07)' : 'rgba(201,160,43,.05)'};
      border:1px solid ${isPublished ? 'rgba(39,174,96,.25)' : 'rgba(201,160,43,.2)'};
      border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-size:12px;font-weight:700;color:${isPublished ? 'var(--green)' : 'var(--gold)'}">
          ${isPublished ? '🌍 الشجرة ظاهرة للجمهور' : '🔒 الشجرة مخفية عن الجمهور'}
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">
          ${isPublished ? 'اضغط لإخفائها مؤقتاً' : 'عبِّئ المباريات ثم انشر'}
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="adminResetBracket()"
          style="padding:7px 12px;border-radius:8px;font-family:Tajawal,sans-serif;font-size:11px;cursor:pointer;
          border:1px solid rgba(192,57,43,.3);background:rgba(192,57,43,.07);color:var(--red)">
          🗑 إعادة بناء
        </button>
        <button onclick="toggleBracketPublish()"
          style="padding:8px 16px;border-radius:9px;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;
          border:1px solid ${isPublished ? 'rgba(39,174,96,.4)' : 'rgba(201,160,43,.4)'};
          background:${isPublished ? 'rgba(39,174,96,.12)' : 'rgba(201,160,43,.1)'};
          color:${isPublished ? 'var(--green)' : 'var(--gold)'}">
          ${isPublished ? '🔒 إخفاء' : '🌍 نشر للجمهور'}
        </button>
      </div>
    </div>`;

  // ── مجمّع الفرق المتأهلة المتاحة (للتذكير فوق الشجرة) ──
  const placed = _getPlacedKnockoutTeamIds();
  const availablePool = _getQualifiedPool().filter(t => !placed.has(t.id));
  const poolBar = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--card2);border:1px solid var(--border2);border-radius:12px">
      <div style="font-size:10px;color:var(--muted2);font-weight:700;margin-bottom:6px">
        ⏳ متأهلون بانتظار وضعهم في الشجرة (${availablePool.length})
      </div>
      ${availablePool.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${availablePool.map(t =>
            `<span style="font-size:10px;background:rgba(39,174,96,.08);border:1px solid rgba(39,174,96,.25);color:var(--green);border-radius:20px;padding:3px 10px">${t.name}</span>`
          ).join('')}</div>`
        : `<div style="font-size:10px;color:var(--muted)">لا يوجد — إما كلهم موضوعون، أو لسه ما اعتمدت المتأهلين من صفحة المجموعات</div>`
      }
    </div>`;

  // ── الشجرة نفسها: أدوار مكدّسة عمودياً (فوق لتحت) — كل دور غير النهائي ينقسم يسار/يمين (مرآة) ──
  const roundsSorted = [...adminKnockoutRounds].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const firstOrder = roundsSorted.length ? (roundsSorted[0].order ?? 0) : 0;

  const treeHtml = roundsSorted.map((round, idx) => {
    const isFirstRound = (round.order ?? idx) === firstOrder;
    const isFinal = idx === roundsSorted.length - 1;
    const slots = round.slots || 1;
    const slotArr = new Array(slots).fill(null);
    // ✅︎ لا تُسقط أي مباراة بصمت — لو الخانة مأخوذة/الرقم خارج المدى ضعها في أول فراغ
    const _overflow = [];
    matches.forEach(m => {
      if (m.knockoutRoundId === round.id) {
        const s = m.knockoutSlot != null ? m.knockoutSlot : -1;
        if (s >= 0 && s < slots && !slotArr[s]) slotArr[s] = m;
        else _overflow.push(m);
      }
    });
    _overflow.forEach(m => {
      const free = slotArr.indexOf(null);
      if (free !== -1) slotArr[free] = m;
    });

    const doneCount = slotArr.filter(m => m && m.status === 'finished').length;

    let bodyHtml;
    if (slots <= 1) {
      bodyHtml = `<div class="ab-final-row">${_adminBracketBox(slotArr[0], round.id, 0, isFirstRound)}</div>`;
    } else {
      const half = slots / 2;
      const leftSlots  = slotArr.slice(0, half);
      const rightSlots = slotArr.slice(half);
      bodyHtml = `<div class="ab-pair-row">
        <div class="ab-side">${leftSlots.map((m,i) => _adminBracketBox(m, round.id, i, isFirstRound)).join('')}</div>
        <div class="ab-side-sep">${isFinal ? '' : '↓ ↓'}</div>
        <div class="ab-side">${rightSlots.map((m,i) => _adminBracketBox(m, round.id, i+half, isFirstRound)).join('')}</div>
      </div>`;
    }

    return `
      <div class="ab-round">
        <div class="ab-round-hd">
          <span class="ab-round-name">${round.name}</span>
          <span class="ab-round-cnt">${doneCount}/${slots} منتهية</span>
        </div>
        ${bodyHtml}
      </div>
      ${idx < roundsSorted.length - 1 ? `<div class="ab-arrow">⬇︎</div>` : ''}
    `;
  }).join('');

  el.innerHTML = publishBar + poolBar + `<div class="ab-tree">${treeHtml}</div>`;
}

// ── صندوق مباراة واحد في الشجرة التفاعلية ──
function _adminBracketBox(m, roundId, slotIdx, isFirstRound) {
  if (!m) {
    if (isFirstRound) {
      return `<div class="ab-box ab-empty" onclick="adminOpenBracketSlot('${roundId}',${slotIdx})">
        <div class="ab-team ab-tbd">➕︎ اضغط لاختيار فريق</div>
      </div>`;
    }
    return `<div class="ab-box ab-empty ab-waiting">
      <div class="ab-team ab-tbd">⏳ ينتظر الفائز</div>
    </div>`;
  }
  const ht = teams.find(t => t.id === m.homeId) || { name: m.homeName || 'TBD', logo: '' };
  const at = teams.find(t => t.id === m.awayId) || { name: m.awayName || 'TBD', logo: '' };
  const fin  = m.status === 'finished';
  const live = m.status === 'live';
  const pend = m.status === 'pending';
  const hw = fin && (m.penaltyScoreHome != null ? m.penaltyScoreHome > m.penaltyScoreAway : (m.homeScore ?? 0) > (m.awayScore ?? 0));
  const aw = fin && (m.penaltyScoreAway != null ? m.penaltyScoreAway > m.penaltyScoreHome : (m.awayScore ?? 0) > (m.homeScore ?? 0));
  return `<div class="ab-box ${pend ? 'ab-pending' : ''} ${live ? 'ab-live' : ''}" onclick="mcv2OpenInfo('${m.id}')">
    ${pend ? '<div class="ab-pending-tag">⚪ غير مفعّلة</div>' : live ? '<div class="ab-live-tag">🔴 مباشر</div>' : ''}
    <div class="ab-team ${hw ? 'ab-winner' : ''}${fin && !hw && aw ? ' ab-loser' : ''}">
      <span class="ab-logo">${logoHtml(ht.logo, 16, 4)}</span>
      <span class="ab-name">${ht.name}</span>
      <span class="ab-score">${fin || live ? (m.homeScore ?? 0) : ''}</span>
    </div>
    <div class="ab-team ${aw ? 'ab-winner' : ''}${fin && !aw && hw ? ' ab-loser' : ''}">
      <span class="ab-logo">${logoHtml(at.logo, 16, 4)}</span>
      <span class="ab-name">${at.name}</span>
      <span class="ab-score">${fin || live ? (m.awayScore ?? 0) : ''}</span>
    </div>
  </div>`;
}

// ── فتح خانة فارغة في الشجرة: يفتح مباراة موجودة، أو منتقي المتأهلين لو الدور الأول وفارغة ──
window.adminOpenBracketSlot = function(roundId, slotIdx) {
  const round = adminKnockoutRounds.find(r => r.id === roundId);
  if (!round) return;
  const existing = matches.find(m => m.knockoutRoundId === roundId && (m.knockoutSlot ?? 0) === slotIdx);
  if (existing) { window.mcv2OpenInfo(existing.id); return; }

  const placed = _getPlacedKnockoutTeamIds();
  const pool = _getQualifiedPool().filter(t => !placed.has(t.id));
  window._bracketSlotPick = null;
  _openBracketTeamPicker(pool, roundId, slotIdx);
};

function _openBracketTeamPicker(pool, roundId, slotIdx) {
  let sheet = document.getElementById('bracketPickSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'bracketPickSheet'; document.body.appendChild(sheet); }
  sheet.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.75);display:flex;align-items:flex-end;justify-content:center;font-family:Tajawal,sans-serif';
  const pending = window._bracketSlotPick;
  const title = pending ? `اختر الفريق الثاني (الأول: ${pending.homeName})` : 'اختر الفريق الأول من المتأهلين';
  const rows = pool.length ? pool.map(t => `
    <div onclick="_adminPickBracketTeam('${roundId}',${slotIdx},'${t.id}')" style="padding:12px 14px;border-bottom:1px solid #1f2229;display:flex;gap:10px;align-items:center;cursor:pointer">
      <div style="width:26px;flex-shrink:0">${logoHtml(t.logo, 22, 5)}</div>
      <div style="flex:1;color:#eee;font-size:13px">${t.name}</div>
      <div style="font-size:10px;color:#888">${t.groupName}</div>
    </div>`).join('')
    : `<div style="text-align:center;padding:30px 14px;color:#888;font-size:12px;line-height:1.8">
        لا يوجد متأهلون متاحون بعد.<br>اعتمد المتأهلين من صفحة المجموعات أولاً (زر «✅︎ اعتماد»).
      </div>`;
  sheet.innerHTML = `
    <div style="background:#111318;border-radius:18px 18px 0 0;width:100%;max-width:480px;max-height:70vh;display:flex;flex-direction:column">
      <div style="padding:14px 16px;border-bottom:1px solid #1f2229;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <div style="color:#C9A02B;font-weight:900;font-size:13px">${title}</div>
        <button onclick="_closeBracketPicker()" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="overflow-y:auto">${rows}</div>
    </div>`;
  // ✅︎ الضغط على الخلفية يغلق المنتقي
  window.bindModalDismiss(sheet, () => window._closeBracketPicker());
}

window._closeBracketPicker = function() {
  document.getElementById('bracketPickSheet')?.remove();
  window._bracketSlotPick = null;
};

window._adminPickBracketTeam = async function(roundId, slotIdx, teamId) {
  const t = teams.find(x => x.id === teamId);
  if (!t) return;

  // أول فريق — خزّنه مؤقتاً وأعد فتح المنتقي لاختيار الفريق الثاني
  if (!window._bracketSlotPick) {
    window._bracketSlotPick = { roundId, slotIdx, homeId: t.id, homeName: t.name, homeLogo: t.logo };
    const placed = _getPlacedKnockoutTeamIds(); placed.add(t.id);
    const pool = _getQualifiedPool().filter(x => !placed.has(x.id));
    _openBracketTeamPicker(pool, roundId, slotIdx);
    return;
  }

  // ثاني فريق — أنشئ المباراة (معلّقة حتى يضيف المنظم تفاصيلها)
  const home = window._bracketSlotPick;
  window._bracketSlotPick = null;
  document.getElementById('bracketPickSheet')?.remove();

  const round = adminKnockoutRounds.find(r => r.id === roundId);
  try {
    const matchRef = doc(collection(db, 'leagues', LEAGUE_ID, 'matches'));
    await setDoc(matchRef, {
      homeId: home.homeId, homeName: home.homeName, homeLogo: home.homeLogo || '⚽',
      awayId: t.id, awayName: t.name, awayLogo: t.logo || '⚽',
      homeScore: null, awayScore: null,
      isKnockout: true, knockoutRoundId: roundId, knockoutRoundName: round?.name || '',
      knockoutSlot: slotIdx,
      round: round?.order ?? 0,
      date: null, time: null, venue: null,
      status: 'upcoming', createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'knockoutRounds', roundId), {
      matchIds: [...(round?.matchIds || []), matchRef.id], updatedAt: serverTimestamp()
    });
    showToast('✅︎ أُنشئت المباراة وتظهر للجمهور الآن', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── G. إدارة الإقصاء — العمليات ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ROUND_NAMES = ['دور الـ 32', 'دور الـ 16', 'ربع النهائي', 'نصف النهائي', 'النهائي'];

// ✅︎ اختيار نقطة بداية الشجرة من الواجهة المباشرة
window._selectedBracketStart = 'qf'; // افتراضي ربع النهائي

window.adminSelectBracketStart = function(key, btn) {
  window._selectedBracketStart = key;
  document.querySelectorAll('[id^="bstart_"]').forEach(b => {
    b.style.borderColor = 'var(--border2)';
    b.style.background  = 'var(--card3)';
    const chk = b.querySelector('.bstart-check');
    if (chk) chk.style.display = 'none';
  });
  btn.style.borderColor = 'var(--gold)';
  btn.style.background  = 'rgba(201,160,43,.08)';
  const chk = btn.querySelector('.bstart-check');
  if (chk) chk.style.display = 'block';
};

window.adminConfirmBracketCreate = async function() {
  const startKey = window._selectedBracketStart || 'qf';
  const roundMap = {
    r32: [{name:'دور الـ 32',slots:16}, {name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    r16: [{name:'دور الـ 16',slots:8}, {name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    qf:  [{name:'ربع النهائي',slots:4}, {name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    sf:  [{name:'نصف النهائي',slots:2}, {name:'النهائي',slots:1}],
    f:   [{name:'النهائي',slots:1}],
  };
  const rounds = roundMap[startKey] || roundMap['qf'];

  try {
    // حذف الأدوار القديمة
    const existing = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
    const delBatch = writeBatch(db);
    existing.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();

    // إنشاء الأدوار الجديدة كاملة
    const batch2 = writeBatch(db);
    rounds.forEach((r, i) => {
      batch2.set(doc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds')), {
        name: r.name, order: i, slots: r.slots,
        matchIds: [], matches: [], createdAt: serverTimestamp()
      });
    });
    await batch2.commit();

    showToast(`✅︎ تم إنشاء شجرة من ${rounds[0].name}`, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// إعادة بناء الشجرة من الصفر
window.adminResetBracket = async function() {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'حذف الشجرة الحالية وإعادة البناء؟ سيتم حذف جميع مباريات الإقصاء', confirmText: '🗑 نعم، احذف', danger: true }))) return;
  try {
    // حذف مباريات الإقصاء من matches/
    const koMatches = matches.filter(m => m.isKnockout);
    const batch = writeBatch(db);
    koMatches.forEach(m => batch.delete(doc(db, 'leagues', LEAGUE_ID, 'matches', m.id)));
    // حذف الأدوار
    const existing = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
    existing.forEach(d => batch.delete(d.ref));
    await batch.commit();
    showToast('تم حذف الشجرة — اختر نوعاً جديداً', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.wizConfirmKnockout = window.adminConfirmBracketCreate;


function injectKnockoutRoundModal() {
  if (document.getElementById('modal-knockout-round')) return;
  const m = document.createElement('div');
  m.className = 'modal-overlay';
  m.id = 'modal-knockout-round';
  m.innerHTML = `
    <div class="modal" style="max-width:400px;width:95%">
      <div class="modal-header">
        <div class="modal-title">🌳 إضافة دور إقصاء</div>
        <button class="modal-close" onclick="closeModal('modal-knockout-round')">✕</button>
      </div>
      <div class="modal-body" style="padding:20px">
        <div style="font-size:11px;color:var(--muted2);margin-bottom:14px;line-height:1.7;background:var(--card3);border-radius:8px;padding:9px 12px">
          💡 اختر الدور من الأزرار أو اكتب اسماً مخصصاً — الشجرة يدوية بالكامل وأنت من يحدد الفرق
        </div>
        <div class="form-group">
          <label class="form-label">اختر الدور</label>
          <div style="display:grid;gap:8px;margin-top:8px" id="krStageGrid">
            ${[
              {k:'r32', label:'دور الـ 32', sub:'32 فريق · 16 مباراة', icon:'swords'},
              {k:'r16', label:'دور الـ 16', sub:'16 فريق · 8 مباريات', icon:'target'},
              {k:'qf',  label:'ربع النهائي', sub:'8 فرق · 4 مباريات', icon:'medal'},
              {k:'sf',  label:'نصف النهائي', sub:'4 فرق · 2 مباراتان', icon:'medal'},
              {k:'3rd', label:'مباراة الثالث', sub:'لتحديد المركز الثالث', icon:'medal'},
              {k:'f',   label:'النهائي', sub:'فريقان · المباراة الأخيرة', icon:'trophy'},
            ].map(s => `
              <button class="kr-stage-btn" id="krSt_${s.k}" onclick="krSelectStage(this,'${s.k}','${s.label}')"
                style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--card3);border:2px solid var(--border2);border-radius:12px;cursor:pointer;transition:all .15s;text-align:right;width:100%">
                <span style="flex-shrink:0;display:flex;align-items:center">${_ic(s.icon,22)}</span>
                <div style="flex:1">
                  <div style="font-size:12px;font-weight:700;color:var(--text)">${s.label}</div>
                  <div style="font-size:10px;color:var(--muted);margin-top:2px">${s.sub}</div>
                </div>
                <span class="kr-check" style="display:none;color:var(--green);font-size:16px">✓</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="form-group" style="margin-top:14px">
          <label class="form-label">أو اسم مخصص</label>
          <input class="form-input" id="krName" placeholder="مثال: دور المجموعة أ، مباراة افتتاحية..." oninput="krClearStageSelect()"/>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn btn-outline" style="flex:1" onclick="closeModal('modal-knockout-round')">إلغاء</button>
          <button class="btn btn-gold" style="flex:2" onclick="adminSaveKnockoutRound()">🌳 إضافة الدور</button>
        </div>
      </div>
    </div>`;
  m.addEventListener('click', e => { if(e.target === m) closeModal('modal-knockout-round'); });
  document.body.appendChild(m);
}

window.krSelectStage = function(btn, key, label) {
  document.querySelectorAll('#krStageGrid .kr-stage-btn').forEach(b => {
    b.style.borderColor = 'var(--border2)';
    b.style.background = 'var(--card3)';
    const chk = b.querySelector('.kr-check');
    if (chk) chk.style.display = 'none';
  });
  btn.style.borderColor = 'var(--gold)';
  btn.style.background = 'rgba(201,160,43,.08)';
  const chk = btn.querySelector('.kr-check');
  if (chk) chk.style.display = 'block';
  const inp = document.getElementById('krName');
  if (inp) inp.value = label;
  window._krSelectedStage = key;
};

window.krClearStageSelect = function() {
  document.querySelectorAll('#krStageGrid .kr-stage-btn').forEach(b => {
    b.style.borderColor = 'var(--border2)';
    b.style.background = 'var(--card3)';
    const chk = b.querySelector('.kr-check');
    if (chk) chk.style.display = 'none';
  });
  window._krSelectedStage = null;
};

window.adminSaveKnockoutRound = async function () {
  const name = document.getElementById('krName').value.trim();
  if (!name) { showToast('أدخل اسم الدور', 'error'); return; }
  try {
    await addDoc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'), {
      name, order: adminKnockoutRounds.length, matches: [], createdAt: serverTimestamp()
    });
    showToast(`✅︎ تمت إضافة "${name}"`, 'success');
    closeModal('modal-knockout-round');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── نشر / إخفاء الشجرة للجمهور ──
window.toggleBracketPublish = async function () {
  const current = settings.bracketPublished === true;
  const next = !current;
  try {
    await setDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'),
      { bracketPublished: next, updatedAt: serverTimestamp() }, { merge: true });
    settings.bracketPublished = next;
    updateBracketPublishUI(next);
    showToast(next ? '✅︎ تم نشر الشجرة للجمهور' : '🔒 تم إخفاء الشجرة عن الجمهور', next ? 'success' : 'error');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

function updateBracketPublishUI(published) {
  const btn   = document.getElementById('bracketPublishBtn');
  const sub   = document.getElementById('bracketPublishSub');
  const bar   = document.getElementById('bracketPublishBar');
  if(!btn) return;
  if(published) {
    btn.textContent = '🌍 منشورة — إخفاء';
    btn.style.background = 'rgba(39,174,96,.12)';
    btn.style.borderColor = 'rgba(39,174,96,.4)';
    btn.style.color = 'var(--green)';
    if(sub) sub.textContent = 'الشجرة ظاهرة للجمهور الآن — اضغط لإخفائها';
    if(bar) bar.style.borderColor = 'rgba(39,174,96,.3)';
  } else {
    btn.textContent = '🔒 مخفية — نشر';
    btn.style.background = 'var(--card2)';
    btn.style.borderColor = 'var(--border2)';
    btn.style.color = 'var(--muted)';
    if(sub) sub.textContent = 'انشر الشجرة بعد ما تكمل إعدادها';
    if(bar) bar.style.borderColor = 'var(--border2)';
  }
}

window.adminDeleteKnockoutRound = async function (roundId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'حذف هذا الدور وكل مبارياته؟', confirmText: '🗑 نعم، احذف', danger: true }))) return;
  try {
    await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'knockoutRounds', roundId));
    showToast('تم حذف الدور', 'error');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ════════════════════════════════════════════════════════════
//  نظام الشجرة المرتبط بـ matches/ — كل مباراة في الشجرة
//  هي document حقيقي في matches/ مع knockoutRoundId
// ════════════════════════════════════════════════════════════

// إضافة مباراة لدور إقصائي — تُنشأ كـ document حقيقي في matches/
window.adminSaveMatchToRound = async function (roundId) {
  const homeId = document.getElementById('km-home-' + roundId)?.value;
  const awayId = document.getElementById('km-away-' + roundId)?.value;
  const date   = document.getElementById('km-date-' + roundId)?.value || '';
  const time   = document.getElementById('km-time-' + roundId)?.value || '16:00';

  if (!homeId || !awayId)   { showToast('اختر الفريقين', 'error'); return; }
  if (homeId === awayId)    { showToast('لا يمكن أن يلعب الفريق ضد نفسه', 'error'); return; }

  const round = adminKnockoutRounds.find(r => r.id === roundId);
  if (!round) return;

  const ht    = teams.find(t => t.id === homeId) || {};
  const at    = teams.find(t => t.id === awayId) || {};

  // ✅︎ منع تجاوز الحد المسموح (slots)
  const maxAllowed = round.slots || 1;
  if ((round.matchIds || []).length >= maxAllowed) {
    showToast(`الدور ممتلئ — ${maxAllowed}/${maxAllowed} مباريات`, 'error');
    return;
  }

  // ─── منع تكرار نفس الفريقين في نفس الدور ───────────────
  const existing = (round.matchIds || []);
  for (const mid of existing) {
    const em = matches.find(m => m.id === mid);
    if (em && ((em.homeId === homeId && em.awayId === awayId) ||
               (em.homeId === awayId && em.awayId === homeId))) {
      showToast('هذه المباراة موجودة مسبقاً في الدور', 'error');
      return;
    }
  }

  try {
    // ✅︎ إنشاء document حقيقي في matches/ مع ربط الشجرة
    const matchRef = doc(collection(db, 'leagues', LEAGUE_ID, 'matches'));
    const matchData = {
      homeId,    homeName: ht.name  || '',  homeLogo: ht.logo  || '',
      awayId,    awayName: at.name  || '',  awayLogo: at.logo  || '',
      date, time,
      status:    'upcoming',
      homeScore: null, awayScore: null,
      homeScorers: '', awayScorers: '',
      round:     round.order ?? 0,
      // ✅︎ حقول الشجرة
      knockoutRoundId:   roundId,
      knockoutRoundName: round.name || '',
      knockoutSlot:      (round.matchIds || []).length, // رقم المباراة في الدور
      isKnockout:        true,
      createdAt: serverTimestamp(),
    };
    await setDoc(matchRef, matchData);

    // ✅︎ أضف matchId فقط في knockoutRounds (للترتيب والربط)
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'knockoutRounds', roundId), {
      matchIds: [...(round.matchIds || []), matchRef.id],
      updatedAt: serverTimestamp()
    });

    showToast(`✅︎ تمت إضافة ${ht.name} vs ${at.name} — يمكن الآن بثها`, 'success');

    // إعادة تعيين الـ selects
    const hEl = document.getElementById('km-home-' + roundId);
    const aEl = document.getElementById('km-away-' + roundId);
    if (hEl) hEl.value = '';
    if (aEl) aEl.value = '';

  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// حذف مباراة من الشجرة — يحذف الـ match document أيضاً
window.adminRemoveMatchFromRound = async function (roundId, matchId) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'حذف هذه المباراة؟ سيتم حذفها من المباريات أيضاً', confirmText: '🗑 نعم، احذف', danger: true }))) return;
  const round = adminKnockoutRounds.find(r => r.id === roundId);
  if (!round) return;
  try {
    // حذف من matches/
    await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId));
    // حذف الـ id من knockoutRounds
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'knockoutRounds', roundId), {
      matchIds: (round.matchIds || []).filter(id => id !== matchId),
      updatedAt: serverTimestamp()
    });
    showToast('تم حذف المباراة', 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// تحديث نتيجة مباراة الشجرة — يُحدّث الـ match document الحقيقي
window.adminUpdateKnockoutMatchResult = async function (roundId, matchId, homeScore, awayScore) {
  const hs = parseInt(homeScore), as_ = parseInt(awayScore);
  const penH = parseInt(document.getElementById('ks-pen-h-' + matchId)?.value ?? '') || null;
  const penA = parseInt(document.getElementById('ks-pen-a-' + matchId)?.value ?? '') || null;
  
  if (isNaN(hs) || isNaN(as_)) { showToast('أدخل النتيجة أولاً', 'error'); return; }
  
  // تحديد النتيجة النهائية (تشمل ركلات الترجيح إذا كانت موجودة)
  const finalHs = (penH != null && hs === as_) ? penH : hs;
  const finalAs = (penA != null && hs === as_) ? penA : as_;
  
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), {
      homeScore: hs, awayScore: as_,
      penaltyScoreHome: penH,
      penaltyScoreAway: penA,
      status: 'finished',
      endTime: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    showToast('✅︎ تم حفظ النتيجة', 'success');

    // ─── تقدم تلقائي للفائز للدور التالي ──────────────────
    if (settings.autoAdvanceWinner !== false) {
      await _autoAdvanceWinner(roundId, matchId, finalHs, finalAs);
    }
    await recalcStandings();
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── تقدم الفائز تلقائياً للدور التالي ──────────────────────────
async function _autoAdvanceWinner(roundId, matchId, homeScore, awayScore) {
  const match = matches.find(m => m.id === matchId);
  if (!match) return;

  const winnerId   = homeScore > awayScore ? match.homeId   : match.awayId;
  const winnerName = homeScore > awayScore ? match.homeName : match.awayName;
  const winnerLogo = homeScore > awayScore ? match.homeLogo : match.awayLogo;

  // أوجد الدور التالي
  const roundsSorted = [...adminKnockoutRounds].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const curIdx = roundsSorted.findIndex(r => r.id === roundId);
  if (curIdx === -1 || curIdx >= roundsSorted.length - 1) return; // النهائي

  const nextRound = roundsSorted[curIdx + 1];
  if (!nextRound) return;

  // أوجد الـ slot المناسب في الدور التالي
  // الـ slot = Math.floor(knockoutSlot / 2) في مباريات الدور الحالي
  const curMatch = matches.find(m => m.id === matchId);
  const slotInNext = curMatch ? Math.floor((curMatch.knockoutSlot ?? 0) / 2) : null;

  if (slotInNext === null) return;

  // ابحث عن مباراة في الدور التالي تحمل نفس الـ slot
  const nextMatchIds = nextRound.matchIds || [];
  for (const nMid of nextMatchIds) {
    const nm = matches.find(m => m.id === nMid);
    if (!nm || nm.knockoutSlot !== slotInNext) continue;

    // الـ slot زوجي → home | فردي → away
    const isHome = (curMatch.knockoutSlot ?? 0) % 2 === 0;
    const updateData = isHome
      ? { homeId: winnerId, homeName: winnerName, homeLogo: winnerLogo }
      : { awayId: winnerId, awayName: winnerName, awayLogo: winnerLogo };
    try {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', nMid), updateData);
    } catch(e) { console.warn('autoAdvance:', e.message); }
    return;
  }

  // إذا ما في مباراة في الدور التالي بنفس الـ slot → أنشئها (معلّقة حتى يضيف المنظم تفاصيلها)
  const matchRef = doc(collection(db, 'leagues', LEAGUE_ID, 'matches'));
  const isHome = (curMatch.knockoutSlot ?? 0) % 2 === 0;
  await setDoc(matchRef, {
    homeId:    isHome ? winnerId   : '',
    homeName:  isHome ? winnerName : 'TBD',
    homeLogo:  isHome ? winnerLogo : '',
    awayId:    isHome ? ''         : winnerId,
    awayName:  isHome ? 'TBD'     : winnerName,
    awayLogo:  isHome ? ''        : winnerLogo,
    status: 'pending', homeScore: null, awayScore: null,
    homeScorers: '', awayScorers: '',
    date: null, time: null, venue: null,
    round: nextRound.order ?? 0,
    knockoutRoundId:   nextRound.id,
    knockoutRoundName: nextRound.name || '',
    knockoutSlot:      slotInNext,
    isKnockout:        true,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'knockoutRounds', nextRound.id), {
    matchIds: [...nextMatchIds, matchRef.id],
    updatedAt: serverTimestamp()
  });
}

// إنشاء أدوار الإقصاء تلقائياً من المتأهلين
window.adminAutoCreateKnockout = async function () {
  // جمع المتأهلين من المجموعات
  // ملاحظة: بما أن نظامك الحالي لا يحتوي matches للمجموعات داخل leagues/{id}/matches،
  // نعتمد على ترتيب الفرق داخل group.teamIds (كما يتم تعديله عبر UI).

  if (!adminGroups || adminGroups.length === 0) {
    showToast('لا توجد مجموعات. أضف مجموعات أولاً', 'error');
    return;
  }

  const qualifiersByPos = [];
  adminGroups.forEach(g => {
    const gTeams = (g.teamIds || []).map(id => teams.find(t => t.id === id)).filter(Boolean);
    const qualCount = parseInt(g.qualify || 2);
    const safeCount = Math.max(1, Math.min(qualCount, gTeams.length));

    const top = gTeams.slice(0, safeCount).map((t, i) => ({
      teamId: t.id,
      teamName: t.name,
      teamLogo: t.logo,
      pos: i + 1,
      groupId: g.id,
      groupName: g.name
    }));
    qualifiersByPos.push(...top);
  });

  if (qualifiersByPos.length < 2) {
    showToast('لا يوجد متأهلون كافون. تأكد من وجود فرق متأهلة في المجموعات', 'error');
    return;
  }

  // عدد المتأهلين يجب أن يكون قوة 2 في أغلب الحالات.
  // إذا لم يكن كذلك، سنبني bracket لأقرب قوة 2 <= K (بدون تخمين).
  const K = qualifiersByPos.length;
  const pow2 = (n) => {
    let p = 1;
    while (p * 2 <= n) p *= 2;
    return p;
  };
  const targetK = pow2(K);
  if (targetK < 2) {
    showToast('عدد المتأهلين غير كافٍ لبناء شجرة إقصاء', 'error');
    return;
  }

  // نأخذ أول targetK متأهلين حسب ترتيبهم الحالي في qualifiersByPos
  const qualifiers = qualifiersByPos.slice(0, targetK);

  // اسم الدور حسب عدد المتأهلين
  const roundName = targetK === 2 ? 'النهائي' :
    targetK === 4 ? 'نصف النهائي' :
      targetK === 8 ? 'ربع النهائي' :
        `دور الـ ${targetK}`;

  // إعادة إنشاء كاملة: احذف الأدوار الحالية ثم أنشئ من جديد
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: `سيتم إنشاء شجرة إقصاء كاملة تلقائياً (${targetK} متأهل) بدءاً من: ${roundName}. سيتم استبدال الأدوار الحالية. هل تريد المتابعة؟`, confirmText: 'تأكيد', danger: false }))) return;

  // حذف knockoutRounds الحالية
  const roundsSnap = await getDocs(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'));
  const batchDel = writeBatch(db);
  roundsSnap.forEach(d => batchDel.delete(d.ref));
  await batchDel.commit();

  // إنشاء الأدوار المتسلسلة
  // totalRounds = log2(targetK)
  const totalRounds = Math.log2(targetK);

  // بناء مصفوفة حزم لكل round: round 0 = أول دور
  // مباريات كل round يتم توليدها من قائمة teams الحالية
  let current = qualifiers.slice(); // قائمة متأهلين/مراكز

  const levelToName = (matchesCount) => {
    // matchesCount = targetK/2 => دور 16 مثلاً
    // سنستخدم نفس منطقك العام
    const t = matchesCount * 2;
    if (t === 2) return 'النهائي';
    if (t === 4) return 'نصف النهائي';
    if (t === 8) return 'ربع النهائي';
    return `دور الـ ${t}`;
  };

  // helper: ترتيب current إلى أزواج
  // لتقليل مواجهة الفرق من نفس المجموعة مبكراً: إذا أمكن، نبدّل الشريك
  const pairRound = (teamsList) => {
    const pairs = [];
    // strategy: pair i with (last-i)
    const arr = teamsList.slice();
    let used = new Set();

    for (let i = 0; i < arr.length / 2; i++) {
      const a = arr[i];
      const bIdx = arr.length - 1 - i;
      const b = arr[bIdx];

      // محاولة تجنب نفس groupId
      let home = a;
      let away = b;
      if (home.groupId && away.groupId && home.groupId === away.groupId) {
        // ابحث عن بديل
        for (let j = arr.length - 1 - i; j >= 0; j--) {
          const cand = arr[j];
          if (!cand || cand.teamId === home.teamId) continue;
          if (cand.groupId && cand.groupId === home.groupId) continue;
          // بدّل فقط لو المرشح غير مستخدم في هذا الزوج (تقريباً)
          away = cand;
          break;
        }
      }

      pairs.push({ home, away });
      used.add(home.teamId);
      used.add(away.teamId);
    }
    return pairs;
  };

  for (let r = 0; r < totalRounds; r++) {
    const matchesCount = current.length / 2;
    const pairs = pairRound(current);

    const matches = pairs.map((p, idx) => ({
      id: Date.now() + r * 10000 + idx,
      homeId: p.home.teamId,
      homeName: p.home.teamName,
      homeLogo: p.home.teamLogo,
      awayId: p.away.teamId,
      awayName: p.away.teamName,
      awayLogo: p.away.teamLogo,
      status: 'upcoming',
      homeScore: null,
      awayScore: null
    }));

    const name = levelToName(matchesCount);

    await addDoc(collection(db, 'leagues', LEAGUE_ID, 'knockoutRounds'), {
      name,
      order: r,
      matches,
      autoGenerated: true,
      createdAt: serverTimestamp()
    });

    // في الجولة التالية: الفائزين غير معروفين، لكننا فقط نحدد مكان المباريات.
    // سنستخدم ترتيب current (الشريط من الأفضل/الأسوأ) لتوليد home/away placeholders.
    // عملياً في UI، الجولات القادمة ستتحدث عندما تُسجل النتائج.
    // لذا نختار قائمة nextPlaceholders بنفس size = matchesCount
    current = current.slice(0, current.length / 2);
  }

  showToast('✅︎ تم إنشاء شجرة الإقصاء كاملة بنجاح', 'success');
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── H. CSS للأدمن ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function injectAdminCSS() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── شجرة الإقصاء العمودية التفاعلية (تدعم الجوال طولياً، بدون تمرير أفقي) ── */
    .ab-tree { display:flex; flex-direction:column; gap:0; }
    .ab-round { margin-bottom:6px; }
    .ab-round-hd {
      display:flex; align-items:center; justify-content:space-between;
      padding:6px 4px; margin-bottom:8px;
    }
    .ab-round-name { font-size:12px; font-weight:900; color:var(--gold,#C9A02B); }
    .ab-round-cnt { font-size:10px; color:var(--muted,#888); }
    .ab-pair-row { display:grid; grid-template-columns:1fr auto 1fr; gap:6px; align-items:center; }
    .ab-side { display:flex; flex-direction:column; gap:8px; }
    .ab-side-sep { font-size:11px; color:var(--muted2,#555); text-align:center; writing-mode:vertical-rl; }
    .ab-final-row { display:flex; justify-content:center; }
    .ab-final-row .ab-box { max-width:280px; width:100%; border-color:var(--gold,#C9A02B) !important; }
    .ab-arrow { text-align:center; font-size:16px; color:var(--muted2,#444); margin:2px 0 10px; }
    .ab-box {
      background:var(--card2,#141414); border:1px solid var(--border2,#2a2a2a); border-radius:10px;
      overflow:hidden; cursor:pointer; position:relative; transition:border-color .15s;
    }
    .ab-box:active { border-color:var(--gold,#C9A02B); }
    .ab-box.ab-empty { display:flex; align-items:center; justify-content:center; min-height:52px; border-style:dashed; }
    .ab-box.ab-waiting { opacity:.55; cursor:default; }
    .ab-box.ab-pending { border-style:dashed; border-color:rgba(201,160,43,.4); }
    .ab-box.ab-live { border-color:rgba(192,57,43,.5); box-shadow:0 0 14px rgba(192,57,43,.12); }
    .ab-team { display:flex; align-items:center; gap:7px; padding:8px 9px; }
    .ab-team.ab-winner { background:linear-gradient(90deg,rgba(201,160,43,.10),transparent); }
    .ab-team.ab-winner .ab-name { color:var(--gold,#C9A02B); font-weight:900; }
    /* ✅︎ الخاسر يبقى ظاهراً لكن مميّز — زي التطبيقات الرسمية */
    .ab-team.ab-loser { opacity:.45; }
    .ab-team.ab-loser .ab-name { color:#777; font-weight:600; text-decoration:line-through; text-decoration-color:rgba(220,50,50,.5); }
    .ab-team.ab-loser .ab-logo { filter:grayscale(1); }
    .ab-team.ab-tbd { color:var(--muted,#777); font-weight:600; justify-content:center; width:100%; font-size:11px; padding:14px 9px; }
    .ab-team + .ab-team { border-top:1px solid var(--border,#1f1f1f); }
    .ab-logo { flex-shrink:0; display:flex; }
    .ab-name { flex:1; font-size:11px; font-weight:700; color:var(--text,#eee); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ab-score { font-size:12.5px; font-weight:900; color:var(--text,#eee); min-width:16px; text-align:center; font-family:Tajawal,sans-serif; }
    .ab-team.ab-winner .ab-score { color:var(--gold,#C9A02B); }
    .ab-pending-tag {
      position:absolute; top:-9px; right:8px; font-size:8px; font-weight:700;
      background:var(--dark,#0c0c0c); color:var(--gold,#C9A02B); padding:1px 6px; border-radius:8px;
      border:1px solid rgba(201,160,43,.3);
    }
    .ab-live-tag {
      position:absolute; top:-9px; right:8px; font-size:8px; font-weight:700;
      background:var(--dark,#0c0c0c); color:#C0392B; padding:1px 6px; border-radius:8px;
      border:1px solid rgba(192,57,43,.4);
    }
    @media (min-width:640px) {
      .ab-pair-row { grid-template-columns:1fr 40px 1fr; }
    }

    /* ── Match Stats Toggle ── */
    .me-stats-toggle summary::-webkit-details-marker { display:none; }
    .me-stats-toggle[open] summary span:last-child::before { content:'▲ '; }
    .me-stats-toggle summary span:last-child::before { content:'▼ '; }

    /* ── Admin Group Card ── */
    .admin-group-card {
      background: var(--card2);
      border: 1px solid var(--border2);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .agc-header {
      background: linear-gradient(135deg, #141200, #0d0d0d);
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .agc-title { font-size: 13px; font-weight: 900; color: var(--gold); }
    .agc-sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .agc-teams { padding: 8px 12px; }
    .agc-team-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 4px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .agc-team-row:last-child { border-bottom: none; }
    .agc-add-team {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--card3);
    }

    /* ── Admin Knockout Card ── */
    .admin-knockout-card {
      background: var(--card2);
      border: 1px solid var(--border2);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .akc-header {
      background: linear-gradient(135deg, #0a1a0a, #0d0d0d);
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .akc-title { font-size: 13px; font-weight: 900; color: var(--green); }
    .akc-sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .akc-matches { padding: 8px 12px; }
    .akc-match-row {
      display: flex;
      align-items: center;
      padding: 7px 4px;
      border-bottom: 1px solid var(--border);
      gap: 4px;
    }
    .akc-match-row:last-child { border-bottom: none; }
    .akc-add-match {
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--card3);
    }

    /* ── Type Note ── */
    #typeNote {
      font-size: 11px;
      color: var(--muted2);
      padding: 10px 12px;
      background: var(--card3);
      border-radius: 8px;
      margin-top: 10px;
      line-height: 1.6;
    }
  `;
  document.head.appendChild(style);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── I. Modals إضافية (نتيجة مباراة إقصاء) ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function injectAdminModals() {
  // لا نحتاج modal إضافي — النتيجة تُدخل مباشرة في بطاقة الدور
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── J. تكامل مع saveSettings ──
//    عند حفظ نوع البطولة = groups أو knockout → حمّل المجموعات تلقائياً
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 FIX: saveSettings يقرأ النوع من Firestore بعد الحفظ (لا من settings.type مباشرة)
const _origSaveSettings = window.saveSettings;
window.saveSettings = async function () {
  if (_origSaveSettings) await _origSaveSettings();
  // قراءة النوع من Firestore مباشرة بعد الحفظ
  try {
    const snap = await getDoc(doc(db, 'leagues', LEAGUE_ID, 'config', 'settings'));
    const type = snap.exists() ? (snap.data().type || 'league') : (settings.type || 'league');
    settings.type = type;
    window._adaptAdminUIToType(type);
    if (type === 'groups' || type === 'knockout') {
      if (adminGroups.length === 0 && adminKnockoutRounds.length === 0) {
        loadGroupsAndKnockout();
      }
    }
  } catch(e) {
    const type = settings.type || 'league';
    window._adaptAdminUIToType(type);
  }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ── K. تهيئة عند الدخول ──
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 FIX: enterApp patch موحد — لا نعتمد على setTimeout للنوع
// النوع يُقرأ من Firestore مباشرة في applySettings بعد تحميل البيانات
const _origEnterAppGroups = window.enterApp;
window.enterApp = function () {
  if (_origEnterAppGroups) _origEnterAppGroups();
  // حقن الصفحات في DOM فوراً (لا تضر لو النوع دوري)
  injectGroupsAndKnockoutPages();
  // النوع الحقيقي سيُطبَّق في applySettings بعد قراءة Firestore
};

// console.log('[AdminGroupsPatch] ✅︎ Groups & Knockout management engine loaded');


// ══════════════════════════════════════════════════════════════════════════════
// 🎯 TOURNAMENT FIX — DRAG & DROP GROUPS ENGINE
// يُضاف في نهاية admin.js
// ══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';
  if (window.__DND_GROUPS_LOADED__) return;
  window.__DND_GROUPS_LOADED__ = true;

  // ── State ──
  let _dndDragTeamId    = null;
  let _dndDragFromGroup = null; // null = bank (unassigned)
  let _dndGroups        = [];   // mirror of adminGroups
  let _dndSelectedTeamId = null;   // ✅︎ للضغط بدل السحب (أساسي على الجوال)
  let _dndSelectedFrom   = null;   // null = bank

  // ── CSS ──
  function injectDnDCSS() {
    if (document.getElementById('_dnd_css')) return;
    const s = document.createElement('style');
    s.id = '_dnd_css';
    s.textContent = `
      /* Bank */
      .dnd-bank {
        display:flex; flex-wrap:wrap; gap:8px;
        min-height:52px; padding:10px 12px;
        background:var(--card2,#111);
        border:2px dashed var(--border2,#2a2a2a);
        border-radius:12px; transition:border-color .2s,background .2s;
      }
      .dnd-bank-over { border-color:var(--gold,#C9A02B) !important; background:rgba(201,160,43,.05) !important; }
      .dnd-bank-empty { width:100%; text-align:center; font-size:11px; color:var(--green,#27ae60); padding:8px; }

      /* Chip */
      .dnd-chip {
        display:inline-flex; align-items:center; gap:6px;
        background:var(--card3,#1a1a1a); border:1px solid var(--border,#222);
        border-radius:8px; padding:5px 8px 5px 5px;
        cursor:grab; user-select:none;
        transition:transform .15s,box-shadow .15s,opacity .15s;
        font-size:12px; font-weight:600; color:var(--text,#eee);
        max-width:160px;
      }
      .dnd-chip:hover { border-color:var(--gold,#C9A02B); transform:translateY(-1px); box-shadow:0 4px 12px rgba(201,160,43,.15); }
      .dnd-chip.dragging { opacity:.45; transform:scale(.93); cursor:grabbing; }
      .dnd-chip-selected { border-color:var(--gold,#C9A02B) !important; background:rgba(201,160,43,.15) !important; box-shadow:0 0 0 2px rgba(201,160,43,.3); }
      .dnd-chip-lbl { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:88px; }
      .dnd-chip-rm  { background:none; border:none; color:#C0392B; font-size:10px; cursor:pointer; padding:0 1px; opacity:.6; flex-shrink:0; }
      .dnd-chip-rm:hover { opacity:1; }

      /* Group card */
      .dnd-gcard {
        background:var(--card2,#111); border:2px solid var(--border2,#2a2a2a);
        border-radius:14px; overflow:hidden; transition:border-color .2s;
      }
      .dnd-gcard.dnd-over { border-color:var(--gold,#C9A02B); background:rgba(201,160,43,.03); }
      .dnd-gcard-pickable { border-color:rgba(201,160,43,.5); cursor:pointer; animation:dndPickPulse 1.4s infinite; }
      @keyframes dndPickPulse { 0%,100%{box-shadow:0 0 0 0 rgba(201,160,43,.25)} 50%{box-shadow:0 0 0 6px rgba(201,160,43,0)} }
      .dnd-gcard-hd {
        background:linear-gradient(135deg,#141200,#0d0d0d);
        padding:11px 13px; display:flex; justify-content:space-between; align-items:center;
        border-bottom:1px solid var(--border,#222);
      }
      .dnd-gcard-zone {
        min-height:58px; padding:8px 10px;
        display:flex; flex-direction:column; gap:4px;
      }
      .dnd-gcard-hint {
        text-align:center; font-size:11px; color:var(--muted,#555);
        padding:12px; border:1.5px dashed var(--border,#333);
        border-radius:8px; pointer-events:none;
      }
      .dnd-slot { display:flex; align-items:center; gap:6px; padding:2px 0; }
      .dnd-slot.qualify .dnd-chip { border-color:rgba(39,174,96,.4); background:rgba(39,174,96,.06); }
      .dnd-qualify-badge {
        font-size:9px; background:rgba(39,174,96,.12); color:var(--green,#27ae60);
        border:1px solid rgba(39,174,96,.3); border-radius:4px;
        padding:1px 5px; white-space:nowrap; flex-shrink:0;
      }
      .dnd-gcard-ft {
        display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        padding:9px 13px; border-top:1px solid var(--border,#222);
        background:var(--card3,#0e0e0e);
      }
      #page-groups-dnd .page-header { margin-bottom:18px; }
    `;
    document.head.appendChild(s);
  }

  // ── Page injection ──
  function injectDnDPage() {
    if (document.getElementById('page-groups-dnd')) return;

    const panelMain = document.getElementById('panel-main') || document.querySelector('.main') || document.body;
    const page = document.createElement('div');
    page.className = 'section';
    page.id = 'page-groups-dnd';
    page.innerHTML = `
      <div class="page-header">
        <div class="page-title">👥 توزيع الفرق على المجموعات</div>
        <div class="page-sub">اسحب الفرق من البنك إلى المجموعات المناسبة — التغييرات تُحفظ فوراً</div>
        <div class="page-actions" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-gold" style="font-size:12px" onclick="adminAddGroup()">+ مجموعة جديدة</button>
          <button class="btn btn-outline" style="font-size:12px" onclick="dndAutoDistribute()">🎲 توزيع عشوائي</button>
          <button class="btn btn-outline btn-sm" style="font-size:11px" onclick="dndGenerateAllGroupMatches()">⚽ توليد مباريات</button>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:1px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
          📦 الفرق غير الموزعة
          <span id="dnd-unassigned-count" style="font-size:10px;color:var(--muted);font-weight:400;margin-right:8px"></span>
        </div>
        <div id="dnd-bank"
          class="dnd-bank"
          ondragover="event.preventDefault();this.classList.add('dnd-bank-over')"
          ondragleave="this.classList.remove('dnd-bank-over')"
          ondrop="dndDropBank(event)"
          onclick="dndBankTap(event)">
        </div>
      </div>
      <div id="dnd-groups-grid" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(255px,1fr))"></div>
    `;
    panelMain.appendChild(page);

    // توجيه sb-groups لهذه الصفحة
    const sbg = document.getElementById('sb-groups');
    if (sbg) {
      sbg.id = 'sb-groups-dnd';
      sbg.setAttribute('data-page', 'groups-dnd');
      sbg.onclick = () => window.showPage('groups-dnd', sbg);
    }
    // ✅︎ إصلاح: نفس التوجيه لزر الموبايل السفلي — كان لا يزال يفتح صفحة المجموعات
    // القديمة (بدون سحب وإفلات)، فيرى مستخدمو الجوال واجهة مختلفة عن الديسكتوب
    const mng = document.getElementById('mn-groups');
    if (mng) {
      mng.id = 'mn-groups-dnd';
      mng.onclick = () => { window.showPage('groups-dnd', null, mng); if (typeof switchTopTab === 'function') switchTopTab('main', null); };
    }
  }

  // ── Logo helper ──
  function _logo(logo, sz) {
    sz = sz || 24;
    if (!logo) return `<span style="font-size:${sz}px">⚽</span>`;
    if (logo.startsWith('data:') || logo.startsWith('http')) {
      return `<img src="${logo}" style="width:${sz}px;height:${sz}px;border-radius:5px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>`;
    }
    return `<span style="font-size:${sz}px;line-height:1">${logo}</span>`;
  }

  // ── Render bank ──
  function renderBank() {
    const bank = document.getElementById('dnd-bank');
    const cnt  = document.getElementById('dnd-unassigned-count');
    if (!bank) return;

    const assignedIds = new Set(_dndGroups.flatMap(g => g.teamIds || []));
    const unassigned  = (window.teams || []).filter(t => !assignedIds.has(t.id));

    if (cnt) cnt.textContent = `(${unassigned.length} فريق)`;

    if (unassigned.length === 0) {
      bank.innerHTML = `<div class="dnd-bank-empty">✅︎ كل الفرق موزعة على المجموعات</div>`;
      return;
    }

    bank.innerHTML = unassigned.map(t => chipHtml(t, null)).join('');
  }

  // ── Render groups ──
  // ✅︎ ترتيب حقيقي داخل المجموعة من نتائج المباريات الفعلية (بدل ترتيب الإضافة العشوائي)
  function _computeGroupStats(teamIds) {
    const stats = {};
    teamIds.forEach(id => { stats[id] = { pts:0, p:0, w:0, d:0, l:0, gf:0, ga:0 }; });
    (window.matches||[]).filter(m => m.status === 'finished').forEach(m => {
      if (!teamIds.includes(m.homeId) || !teamIds.includes(m.awayId)) return;
      const h = stats[m.homeId], a = stats[m.awayId];
      if (!h || !a) return;
      h.p++; a.p++;
      h.gf += (m.homeScore||0); h.ga += (m.awayScore||0);
      a.gf += (m.awayScore||0); a.ga += (m.homeScore||0);
      if ((m.homeScore||0) > (m.awayScore||0)) { h.w++; h.pts += (window.settings?.winPts||3); a.l++; }
      else if ((m.homeScore||0) < (m.awayScore||0)) { a.w++; a.pts += (window.settings?.winPts||3); h.l++; }
      else { h.d++; a.d++; h.pts += (window.settings?.drawPts||1); a.pts += (window.settings?.drawPts||1); }
    });
    return stats;
  }

  function _sortGroupTeamsByStandings(gTeams) {
    const ids = gTeams.map(t => t.id);
    const stats = _computeGroupStats(ids);
    return [...gTeams].sort((a, b) => {
      const sa = stats[a.id] || {}, sb = stats[b.id] || {};
      if ((sb.pts||0) !== (sa.pts||0)) return (sb.pts||0) - (sa.pts||0);
      const gda = (sa.gf||0) - (sa.ga||0), gdb = (sb.gf||0) - (sb.ga||0);
      if (gdb !== gda) return gdb - gda;
      return (sb.gf||0) - (sa.gf||0);
    });
  }

  function renderGroups() {
    const grid = document.getElementById('dnd-groups-grid');
    if (!grid) return;

    if (_dndGroups.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--muted);font-size:12px">
        لا توجد مجموعات بعد
        <button class="btn btn-gold btn-sm" style="margin-right:10px" onclick="adminAddGroup()">+ أنشئ مجموعة</button>
      </div>`;
      return;
    }

    grid.innerHTML = _dndGroups.map(g => {
      const gTeamsRaw  = (window.teams || []).filter(t => (g.teamIds || []).includes(t.id));
      const gTeams     = _sortGroupTeamsByStandings(gTeamsRaw); // ✅︎ مرتّبة فعلياً بالنقاط، لا بترتيب الإضافة
      const qualify    = g.qualify || 2;
      const manualQ    = new Set(g.qualifiedTeamIds || []);
      const hasManualQ = manualQ.size > 0;
      const isPublished = g.qualificationPublished === true;

      return `
        <div class="dnd-gcard ${_dndSelectedTeamId ? 'dnd-gcard-pickable' : ''}" id="dnd-gc-${g.id}"
          ondragover="dndGroupOver(event,'${g.id}')"
          ondragleave="dndGroupLeave(event,'${g.id}')"
          ondrop="dndDropGroup(event,'${g.id}')"
          onclick="dndGroupTap(event,'${g.id}')">

          <div class="dnd-gcard-hd">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px">${g.icon || '👥'}</span>
              <div>
                <div style="font-size:13px;font-weight:900;color:var(--gold)">المجموعة ${g.name}</div>
                <div style="font-size:10px;color:var(--muted)">${gTeams.length} فريق · ${qualify} متأهل</div>
              </div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="icon-btn" onclick="event.stopPropagation();adminEditGroup('${g.id}')" style="font-size:12px;width:28px;height:28px">✏︎️</button>
              <button class="icon-btn del" onclick="event.stopPropagation();adminDeleteGroup('${g.id}')" style="font-size:12px;width:28px;height:28px">🗑</button>
            </div>
          </div>

          <div class="dnd-gcard-zone" id="dnd-zone-${g.id}">
            ${gTeams.length === 0
              ? `<div class="dnd-gcard-hint">اسحب الفرق هنا أو اضغط عليها من البنك</div>`
              : gTeams.map((t, i) => {
                  const isManualQ = manualQ.has(t.id);
                  const isAutoQ   = !hasManualQ && i < qualify;
                  const isQ       = isManualQ || isAutoQ;
                  return `
                  <div class="dnd-slot ${isQ ? 'qualify' : ''}">
                    <span style="font-size:10px;font-weight:700;width:16px;color:${isQ ? 'var(--green)' : 'var(--muted)'};">${i+1}</span>
                    ${chipHtml(t, g.id)}
                    <button onclick="event.stopPropagation();adminToggleQualified('${g.id}','${t.id}')"
                      style="font-size:9px;padding:2px 6px;border-radius:5px;border:1px solid ${isManualQ?'var(--green)':'var(--border2)'};background:${isManualQ?'rgba(39,174,96,.15)':'transparent'};color:${isManualQ?'var(--green)':'var(--muted)'};cursor:pointer;white-space:nowrap;flex-shrink:0">
                      ${isManualQ ? '✅︎ متأهل' : (isAutoQ ? '☑️ تلقائي' : '+ تأهيل')}
                    </button>
                  </div>
                `; }).join('')
            }
          </div>

          <div class="dnd-gcard-ft">
            <span style="font-size:11px;color:var(--muted2);flex:none">عدد المتأهلين:</span>
            <input type="number" class="form-input" style="width:52px;padding:4px 7px;text-align:center;font-size:12px"
              value="${qualify}" min="1" max="${Math.max(gTeams.length,1)}"
              onclick="event.stopPropagation()"
              onchange="adminUpdateGroupQualify('${g.id}',this.value)"/>
            <button class="btn btn-outline btn-sm" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();dndGenGroupMatches('${g.id}')">⚽ توليد مباريات</button>
          </div>

          <!-- ✅︎ اعتماد المتأهلين رسمياً — هذا ما يحدد من يظهر لصفحة الجمهور ومن يتاح اختياره في شجرة الإقصاء -->
          <div onclick="event.stopPropagation()" style="padding:10px 12px;border-top:1px solid var(--border,#222);display:flex;align-items:center;justify-content:space-between;gap:8px;background:${isPublished ? 'rgba(39,174,96,.05)' : 'rgba(243,156,18,.04)'}">
            <div style="min-width:0">
              <div style="font-size:10px;font-weight:700;color:${isPublished ? 'var(--green)' : 'var(--muted2)'}">
                ${isPublished ? '🌍 معتمد — متاح للشجرة والجمهور' : '🔒 غير معتمد بعد'}
              </div>
              <div style="font-size:9px;color:var(--muted);margin-top:2px">${isPublished ? 'اضغط لإخفائه مؤقتاً' : 'حدد المتأهلين ثم اعتمد'}</div>
            </div>
            <button onclick="adminPublishQualification('${g.id}')"
              style="padding:6px 12px;border-radius:8px;font-family:Tajawal,sans-serif;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;
              border:1px solid ${isPublished ? 'rgba(39,174,96,.4)' : 'rgba(243,156,18,.4)'};
              background:${isPublished ? 'rgba(39,174,96,.12)' : 'rgba(243,156,18,.1)'};
              color:${isPublished ? 'var(--green)' : '#D35400'}">
              ${isPublished ? '🔒 إخفاء' : '✅︎ اعتماد'}
            </button>
          </div>
        </div>`;
    }).join('');
  }

  function chipHtml(team, fromGroupId) {
    const from = fromGroupId || 'bank';
    const isSel = _dndSelectedTeamId === team.id;
    return `<div class="dnd-chip ${isSel ? 'dnd-chip-selected' : ''}"
      draggable="true"
      data-tid="${team.id}"
      data-from="${from}"
      ondragstart="dndStart(event,'${team.id}','${from}')"
      ondragend="dndEnd(event)"
      onclick="dndChipTap(event,'${team.id}','${from}')">
      ${_logo(team.logo, 22)}
      <span class="dnd-chip-lbl">${team.name}</span>
      ${fromGroupId
        ? `<button class="dnd-chip-rm" onclick="event.stopPropagation();adminRemoveTeamFromGroup('${fromGroupId}','${team.id}')">✕</button>`
        : ''
      }
    </div>`;
  }

  // ✅︎ اختيار فريق بالضغط ثم الضغط على مجموعة لنقله إليها — بديل يعمل على الجوال (السحب HTML5 لا يعمل باللمس)
  window.dndChipTap = function(e, teamId, fromGroup) {
    e.stopPropagation();
    const from = fromGroup === 'bank' ? null : fromGroup;
    if (_dndSelectedTeamId === teamId) {
      // ضغط ثاني على نفس الشريحة = إلغاء التحديد
      _dndSelectedTeamId = null; _dndSelectedFrom = null;
    } else {
      _dndSelectedTeamId = teamId; _dndSelectedFrom = from;
      if (typeof window.showToast === 'function') {
        const t = (window.teams||[]).find(x => x.id === teamId);
        window.showToast(`👆 ${t?.name||''} محدد — اضغط على مجموعة لإضافته`, 'success');
      }
    }
    renderBank(); renderGroups();
  };

  // ── Drag events ──
  window.dndStart = function(e, teamId, fromGroup) {
    _dndDragTeamId    = teamId;
    _dndDragFromGroup = fromGroup === 'bank' ? null : fromGroup;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', teamId);
  };

  window.dndEnd = function(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.dnd-gcard').forEach(c => c.classList.remove('dnd-over'));
    const bank = document.getElementById('dnd-bank');
    if (bank) bank.classList.remove('dnd-bank-over');
  };

  window.dndGroupOver = function(e, gid) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = document.getElementById('dnd-gc-' + gid);
    if (card) card.classList.add('dnd-over');
  };

  window.dndGroupLeave = function(e, gid) {
    const card = document.getElementById('dnd-gc-' + gid);
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('dnd-over');
  };

  // ── منطق الإسناد الفعلي (مشترك بين السحب والضغط) ──
  async function _dndAssignTeam(teamId, fromGroup, targetGid) {
    if (!teamId || !window.LEAGUE_ID) return;
    if (fromGroup === targetGid) return; // نفس المجموعة

    const LID = window.LEAGUE_ID;
    const batch = writeBatch(db);

    if (fromGroup) {
      const oldG = _dndGroups.find(g => g.id === fromGroup);
      if (oldG) {
        const newIds = (oldG.teamIds||[]).filter(id => id !== teamId);
        batch.update(doc(db,'leagues',LID,'groups',fromGroup), {
          teamIds: newIds,
          updatedAt: serverTimestamp()
        });
        oldG.teamIds = newIds; // ✅︎ حدّث الحالة المحلية فوراً
      }
    }

    const targetG = _dndGroups.find(g => g.id === targetGid);
    if (targetG && !(targetG.teamIds||[]).includes(teamId)) {
      const newIds = [...(targetG.teamIds||[]), teamId];
      batch.update(doc(db,'leagues',LID,'groups',targetGid), {
        teamIds: newIds,
        updatedAt: serverTimestamp()
      });
      targetG.teamIds = newIds; // ✅︎ حدّث الحالة المحلية فوراً
    }

    await batch.commit();
    const team = (window.teams||[]).find(t => t.id === teamId);
    if (typeof window.showToast === 'function') {
      window.showToast(`✅︎ "${team?.name||teamId}" → المجموعة ${targetG?.name||''}`, 'success');
    }
    // ✅︎ تحقق: هل اكتمل توزيع كل الفرق المخطط لها الآن؟ ولّد المباريات تلقائياً (غير مفعّلة بعد)
    if (typeof window._autoGenerateMatchesIfReady === 'function') {
      await window._autoGenerateMatchesIfReady();
    }
  }

  window.dndDropGroup = async function(e, targetGid) {
    e.preventDefault();
    const card = document.getElementById('dnd-gc-' + targetGid);
    if (card) card.classList.remove('dnd-over');

    const teamId    = _dndDragTeamId || e.dataTransfer.getData('text/plain');
    const fromGroup = _dndDragFromGroup;
    _dndDragTeamId = null; _dndDragFromGroup = null;

    try {
      await _dndAssignTeam(teamId, fromGroup, targetGid);
    } catch(err) {
      console.error('[DnD] dropGroup error:', err);
      if (typeof window.showToast === 'function') window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ✅︎ الضغط على بطاقة مجموعة لإسناد الفريق المحدد حالياً إليها (بديل السحب على الجوال)
  window.dndGroupTap = async function(e, targetGid) {
    if (e) e.stopPropagation();
    if (!_dndSelectedTeamId) return; // ما فيه فريق محدد — تجاهل الضغط
    const teamId = _dndSelectedTeamId, fromGroup = _dndSelectedFrom;
    _dndSelectedTeamId = null; _dndSelectedFrom = null;
    try {
      await _dndAssignTeam(teamId, fromGroup, targetGid);
    } catch(err) {
      if (typeof window.showToast === 'function') window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  async function _dndReturnToBank(teamId, fromGroup) {
    if (!teamId || !fromGroup || !window.LEAGUE_ID) return;
    const g = _dndGroups.find(x => x.id === fromGroup);
    if (!g) return;
    await updateDoc(doc(db,'leagues',window.LEAGUE_ID,'groups',fromGroup), {
      teamIds: (g.teamIds||[]).filter(id => id !== teamId),
      updatedAt: serverTimestamp()
    });
    const team = (window.teams||[]).find(t => t.id === teamId);
    if (typeof window.showToast === 'function') window.showToast(`"${team?.name||teamId}" أُعيد للبنك`, 'success');
  }

  window.dndDropBank = async function(e) {
    e.preventDefault();
    const bank = document.getElementById('dnd-bank');
    if (bank) bank.classList.remove('dnd-bank-over');

    const teamId    = _dndDragTeamId || e.dataTransfer.getData('text/plain');
    const fromGroup = _dndDragFromGroup;
    _dndDragTeamId = null; _dndDragFromGroup = null;
    try {
      await _dndReturnToBank(teamId, fromGroup);
    } catch(err) {
      if (typeof window.showToast === 'function') window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ✅︎ الضغط على البنك لإعادة الفريق المحدد إليه (لو كان داخل مجموعة)
  window.dndBankTap = async function(e) {
    if (!_dndSelectedTeamId || !_dndSelectedFrom) {
      // لا يوجد فريق محدد من مجموعة — امسح أي تحديد وأعد الرسم فقط
      if (_dndSelectedTeamId) { _dndSelectedTeamId = null; _dndSelectedFrom = null; renderBank(); renderGroups(); }
      return;
    }
    const teamId = _dndSelectedTeamId, fromGroup = _dndSelectedFrom;
    _dndSelectedTeamId = null; _dndSelectedFrom = null;
    try {
      await _dndReturnToBank(teamId, fromGroup);
    } catch(err) {
      if (typeof window.showToast === 'function') window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ── توزيع عشوائي ──
  window.dndAutoDistribute = async function() {
    if (!_dndGroups.length) { if(window.showToast) window.showToast('أنشئ مجموعات أولاً', 'error'); return; }
    if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: 'سيتم توزيع كل الفرق عشوائياً على المجموعات. هل تريد المتابعة؟', confirmText: 'تأكيد', danger: false }))) return;

    const allTeams  = [...(window.teams||[])].sort(() => Math.random() - 0.5);
    const n         = _dndGroups.length;
    const LID       = window.LEAGUE_ID;
    const batch     = writeBatch(db);

    _dndGroups.forEach((g, i) => {
      const start = Math.floor(i * allTeams.length / n);
      const end   = Math.floor((i+1) * allTeams.length / n);
      const ids   = allTeams.slice(start, end).map(t => t.id);
      batch.update(doc(db,'leagues',LID,'groups',g.id), {
        teamIds: ids, updatedAt: serverTimestamp()
      });
      g.teamIds = ids; // ✅︎ حدّث الحالة المحلية فوراً حتى يعمل فحص الاكتمال بدون تأخير
    });

    try {
      await batch.commit();
      if(window.showToast) window.showToast('✅︎ تم التوزيع العشوائي', 'success');
      if (typeof window._autoGenerateMatchesIfReady === 'function') await window._autoGenerateMatchesIfReady();
    } catch(err) {
      if(window.showToast) window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ── جدولة دورة كاملة بطريقة الدائرة (Circle Method) ──
  //    كل جولة = كل فريق يلعب مباراة واحدة فقط ضد فريق من مجموعته.
  //    هذا هو المعيار الرسمي للجدولة — بدلاً من إعطاء كل مباراة رقم جولة مستقل.
  function _dndBuildRounds(gTeams) {
    const arr = gTeams.slice();
    const bye = (arr.length % 2 !== 0);
    if (bye) arr.push(null); // فريق وهمي: من يقابله يستريح هذه الجولة
    const n = arr.length;
    const roundsCount = n - 1;
    const half = n / 2;
    const rounds = [];
    let rot = arr.slice(1); // الأول ثابت، الباقي يدور

    for (let r = 0; r < roundsCount; r++) {
      const line = [arr[0]].concat(rot);
      const pairs = [];
      for (let i = 0; i < half; i++) {
        const a = line[i], b = line[n - 1 - i];
        if (!a || !b) continue; // مباراة راحة — تُتجاهل
        // تبديل الأرضية بالتناوب لتوزيع عادل للمضيف
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      rot.unshift(rot.pop()); // تدوير
    }
    return rounds;
  }

  // ── يبني مباريات مجموعة (ذهاب + إياب) في batch معطى، بحالة "معلّقة" غير منشورة بعد ──
  //    ✅︎ مرتّبة بالجولات: الجولة 1 كل الفرق تلعب، ثم الجولة 2 ... إلخ
  function _dndAddGroupFixturesToBatch(batch, g, gTeams, startCount) {
    const legMode = (window.settings && window.settings.legMode) || 'single'; // ✅︎ افتراضياً ذهاب فقط
    const rounds  = _dndBuildRounds(gTeams);
    let created = 0;

    // الدور الأول (ذهاب) — الجولات بالترتيب
    rounds.forEach((pairs, ri) => {
      pairs.forEach(([home, away]) => {
        const r = doc(collection(db,'leagues',window.LEAGUE_ID,'matches'));
        batch.set(r, {
          homeId: home.id, homeName: home.name, homeLogo: home.logo||'⚽',
          awayId: away.id, awayName: away.name, awayLogo: away.logo||'⚽',
          homeScore: null, awayScore: null,
          groupId: g.id, groupName: `المجموعة ${g.name}`,
          status: 'upcoming', createdAt: serverTimestamp()
        });
        created++;
      });
    });

    // الدور الثاني (إياب) — يكمل ترقيم الجولات بعد الذهاب
    if (legMode === 'double') {
      rounds.forEach((pairs, ri) => {
        pairs.forEach(([home, away]) => {
          const r = doc(collection(db,'leagues',window.LEAGUE_ID,'matches'));
          batch.set(r, {
            // الأرضية معكوسة في الإياب
            homeId: away.id, homeName: away.name, homeLogo: away.logo||'⚽',
            awayId: home.id, awayName: home.name, awayLogo: home.logo||'⚽',
            homeScore: null, awayScore: null,
            groupId: g.id, groupName: `المجموعة ${g.name}`,
            round: rounds.length + ri + 1, leg: 2,
            date: null, time: null, venue: null,
            status: 'upcoming', createdAt: serverTimestamp()
          });
          created++;
        });
      });
    }
    return (startCount || 0) + created;
  }

  // ── توليد مباريات مجموعة واحدة (يدوي، بتأكيد) ──
  /* ✅︎ نفس إصلاح زر «توليد الكل»: احذف ثم أعد البناء.
     كان هذا الزر أيضاً يضيف فوق الموجود — فيتضاعف عند كل ضغطة.
     (كانت الرسالة تقول «ذهاب وإياب» دائماً حتى في وضع الذهاب فقط.) */
  window.dndGenGroupMatches = async function(groupId) {
    const g = _dndGroups.find(x => x.id === groupId);
    if (!g) return;
    const gTeams = (window.teams||[]).filter(t => (g.teamIds||[]).includes(t.id));
    if (gTeams.length < 2) { if(window.showToast) window.showToast('المجموعة تحتاج فريقين على الأقل', 'error'); return; }

    const legMode = (window.settings && window.settings.legMode) || 'single';
    const dbl = legMode === 'double';
    const n = gTeams.length;
    const rds = (n % 2 === 0 ? n - 1 : n) * (dbl ? 2 : 1);
    const mts = (n * (n - 1) / 2) * (dbl ? 2 : 1);

    const existing = (window.matches || []).filter(m => !m.isKnockout && m.groupId === groupId);
    const warn = existing.length
      ? `\n\n⚠️ سيتم حذف ${existing.length} مباراة حالية لهذه المجموعة وإعادة بنائها.`
      : '';

    if (!(await window.confirmDialog({
      title: `توليد مباريات المجموعة ${g.name}`,
      message: `النظام: ${dbl ? 'ذهاب وإياب' : 'ذهاب فقط'}\n${n} فرق · ${rds} جولات · ${mts} مباراة${warn}`,
      confirmText: 'توليد',
      danger: existing.length > 0
    }))) return;

    try {
      if (existing.length) {
        const bd = writeBatch(db);
        existing.forEach(m => bd.delete(doc(db,'leagues',window.LEAGUE_ID,'matches',m.id)));
        await bd.commit();
      }
      const batch = writeBatch(db);
      const count = _dndAddGroupFixturesToBatch(batch, g, gTeams, 0);
      batch.update(doc(db,'leagues',window.LEAGUE_ID,'groups',groupId), { matchesGenerated: true });
      await batch.commit();
      if(window.showToast) window.showToast(`${count} مباراة للمجموعة ${g.name} — أضف تفاصيلها من قسم المباريات`, 'success');
    } catch(err) {
      if(window.showToast) window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ── توليد مباريات كل المجموعات (يدوي، بتأكيد) ──
  /* ✅︎ إصلاح جذري: كان الزر يضيف بلا حذف ولا فحص matchesGenerated.
     فأي ضغطة ثانية تضاعف كل المباريات (6 -> 12 -> 18)، وتتكرر نفس
     المباراة، ويحسبها جدول الترتيب مراراً = أرقام خاطئة تماماً.
     وبما أن _dndAutoGenerateIfFull يولّد تلقائياً عند اكتمال التوزيع،
     كانت أول ضغطة يدوية كافية للتضاعف.
     الحل: احذف مباريات المجموعات القديمة ثم أعد التوليد — العملية
     صارت idempotent: نفس النتيجة مهما تكرّرت. */
  window.dndGenerateAllGroupMatches = async function() {
    if (!_dndGroups.length) { if(window.showToast) window.showToast('لا توجد مجموعات', 'error'); return; }

    const legMode = (window.settings && window.settings.legMode) || 'single';
    const legTxt  = legMode === 'double' ? 'ذهاب وإياب' : 'ذهاب فقط';

    // احسب المتوقع لعرضه للمنظّم قبل التأكيد
    let expect = 0, det = [];
    for (const g of _dndGroups) {
      const n = (window.teams||[]).filter(t => (g.teamIds||[]).includes(t.id)).length;
      if (n < 2) continue;
      const rds = (n % 2 === 0 ? n - 1 : n) * (legMode === 'double' ? 2 : 1);
      const mts = (n * (n - 1) / 2) * (legMode === 'double' ? 2 : 1);
      expect += mts;
      det.push(`المجموعة ${g.name}: ${n} فرق · ${rds} جولات · ${mts} مباراة`);
    }
    if (!expect) { if(window.showToast) window.showToast('لا توجد مجموعة فيها فريقان فأكثر', 'error'); return; }

    const existing = (window.matches || []).filter(m => !m.isKnockout && m.groupId);
    const warn = existing.length
      ? `\n\n⚠️ سيتم حذف ${existing.length} مباراة مجموعات حالية وإعادة بنائها من الصفر.`
      : '';

    if (!(await window.confirmDialog({
      title: 'توليد مباريات المجموعات',
      message: `النظام: ${legTxt}\n\n${det.join('\n')}\n\nالمجموع: ${expect} مباراة${warn}`,
      confirmText: 'توليد',
      danger: existing.length > 0
    }))) return;

    try {
      // ① احذف مباريات المجموعات القديمة (لا نلمس الإقصاء)
      if (existing.length) {
        for (let i = 0; i < existing.length; i += 400) {
          const b = writeBatch(db);
          existing.slice(i, i + 400).forEach(m =>
            b.delete(doc(db, 'leagues', window.LEAGUE_ID, 'matches', m.id)));
          await b.commit();
        }
      }
      // ② أعد البناء
      const batch = writeBatch(db);
      let total = 0;
      for (const g of _dndGroups) {
        const gTeams = (window.teams||[]).filter(t => (g.teamIds||[]).includes(t.id));
        if (gTeams.length < 2) continue;
        total = _dndAddGroupFixturesToBatch(batch, g, gTeams, total);
        batch.update(doc(db,'leagues',window.LEAGUE_ID,'groups',g.id), { matchesGenerated: true });
      }
      await batch.commit();
      if(window.showToast) window.showToast(`تم توليد ${total} مباراة — أضف تفاصيلها من قسم المباريات`, 'success');
    } catch(err) {
      if(window.showToast) window.showToast('خطأ: ' + err.message, 'error');
    }
  };

  // ✅︎ توليد صامت تلقائي: يُستدعى بعد كل إسناد فريق — بمجرد ما توزّعت كل الفرق
  // المخطط لها (حتى لو التوزيع غير متساوٍ بين المجموعات) تتولّد المباريات
  // تلقائياً لكل مجموعة فيها فريقان فأكثر، بدون أي تأكيد يدوي
  window._dndAutoGenerateIfFull = async function() {
    /* ✅︎ قفل إعادة الدخول — يمنع تشغيلين متزامنين قبل أن يكتب أحدهما.
       بدونه: سحب فريق + توزيع عشوائي قد يستدعيان الدالة معاً، وكلاهما
       يقرأ «صفر مباريات» قبل أن يكتب الآخر → تكرار. */
    if (window._dndGenLock) return;
    window._dndGenLock = true;
    try {
      await _dndAutoGenInner();
    } finally {
      window._dndGenLock = false;
    }
  };

  async function _dndAutoGenInner() {
    const total = window.settings && window.settings.plannedTeamsTotal;
    if (!total) return; // بطولة قديمة بدون تخطيط مسبق — فقط بالزر اليدوي

    const assignedTotal = _dndGroups.reduce((sum, g) => sum + (g.teamIds||[]).length, 0);
    if (assignedTotal < total) return; // لسه فيه فرق ما وُزّعت

    /* ✅︎ إصلاح سباق التوليد المزدوج (سبب «7 جولات»):
       الحارس القديم كان يقرأ window.matches — لكنها لا تُحدَّث فوراً
       بعد الكتابة (onSnapshot يصل بعد لحظة). فلو استُدعيت الدالة مرتين
       متتاليتين (سحب ثم عشوائي، أو نقرتان)، ترى كلاهما مصفوفة قديمة
       فارغة → تولّدان معاً → مباريات مكررة وجولات مبعثرة.
       الحل: اقرأ العدد الحقيقي من الخادم لحظة التوليد. */
    let liveGroupMatchIds = {};
    try {
      const snap = await getDocs(collection(db, 'leagues', window.LEAGUE_ID, 'matches'));
      snap.forEach(d => {
        const m = d.data();
        if (!m.isKnockout && m.groupId) {
          (liveGroupMatchIds[m.groupId] = liveGroupMatchIds[m.groupId] || 0);
          liveGroupMatchIds[m.groupId]++;
        }
      });
    } catch (e) { return; } // لو فشل الفحص، لا نخاطر بالتكرار

    const batch = writeBatch(db);
    let grandTotal = 0;
    let touchedAny = false;
    for (const g of _dndGroups) {
      const gTeams = (window.teams||[]).filter(t => (g.teamIds||[]).includes(t.id));
      if (gTeams.length < 2) continue;
      // ✅︎ الفحص الآن من الخادم — لا من window.matches القديمة
      if (liveGroupMatchIds[g.id] > 0) continue;
      grandTotal = _dndAddGroupFixturesToBatch(batch, g, gTeams, grandTotal);
      batch.update(doc(db,'leagues',window.LEAGUE_ID,'groups',g.id), { matchesGenerated: true });
      touchedAny = true;
    }
    if (!touchedAny) return;

    try {
      await batch.commit();
      if (typeof window.showToast === 'function') {
        window.showToast(`⚽ اكتمل توزيع كل الفرق — تولّدت ${grandTotal} مباراة تلقائياً (أضف تفاصيلها من قسم المباريات)`, 'success');
      }
    } catch(err) {
      console.error('[DnD] auto-generate error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ تعذّر توليد مباريات المجموعات — جرّب زر "توليد مباريات" يدوياً بصفحة المجموعات', 'error');
      }
    }
  };

  // ── مزامنة _dndGroups مع adminGroups ──
  function syncGroups() {
    _dndGroups = (window.adminGroups || []);
    renderBank();
    renderGroups();
  }

  // ── Hook على renderGroupsAdmin ──
  const _origRenderGroupsAdmin = window.renderGroupsAdmin;
  window.renderGroupsAdmin = function() {
    if (_origRenderGroupsAdmin) _origRenderGroupsAdmin();
    _dndGroups = (window.adminGroups || []);
    renderBank();
    renderGroups();
  };

  // ── Hook على renderTeams لتحديث البنك ──
  const _origRenderTeams2 = window.renderTeams;
  window.renderTeams = function() {
    if (_origRenderTeams2) _origRenderTeams2();
    // إعادة رسم البنك إذا كنا في نظام المجموعات
    if (window.settings && window.settings.type === 'groups') {
      renderBank();
    }
  };

  // ── التهيئة ──
  function init() {
    injectDnDCSS();
    injectDnDPage();
    // انتظار adminGroups
    const watch = setInterval(() => {
      if (window.adminGroups !== undefined) {
        clearInterval(watch);
        _dndGroups = window.adminGroups;
        syncGroups();
      }
    }, 300);
    setTimeout(() => clearInterval(watch), 15000);
  }

  // تشغيل التهيئة بعد دخول التطبيق
  const _origEnterAppDnD = window.enterApp;
  window.enterApp = function() {
    if (_origEnterAppDnD) _origEnterAppDnD();
    setTimeout(init, 800);
  };

  // console.log('[DnD Groups] ✅︎ Drag & Drop engine loaded');
})();
// ══════════════════════════════════════════════════════════════
// LINEUP PATCH — إدارة التشكيلات من لوحة التحكم
// أضف هذا الكود في نهاية ملف admin_new_2.js
// ══════════════════════════════════════════════════════════════

// ── بيانات التشكيلات المؤقتة ──
const adminLineupState = {};
/*
  adminLineupState[matchId] = {
    home: { formation: '4-3-3', players: [{name, number, position, status},...] },
    away: { formation: '4-3-3', players: [{name, number, position, status},...] }
  }
*/




// ══════════════════════════════════════════════════════════════
// ROSTER PATCH — إدارة قائمة اللاعبين الدائمة لكل فريق
// أضف هذا الكود في نهاية admin_new_2.js (بعد lineup_patch_admin.js)
// Firebase path: leagues/{id}/teams/{teamId}/roster/{playerId}
// ══════════════════════════════════════════════════════════════

// ── Cache للاعبين محلياً ──
const rosterCache = {}; // rosterCache[teamId] = [players]
const rosterListeners = {}; // onSnapshot listeners للإلغاء لاحقاً

const ROSTER_POSITIONS = [
  { key:'GK',  label:'حارس مرمى',       group:'GK'  },
  { key:'CB',  label:'مدافع وسط',       group:'DEF' },
  { key:'LB',  label:'ظهير أيسر',       group:'DEF' },
  { key:'RB',  label:'ظهير أيمن',       group:'DEF' },
  { key:'LWB', label:'ظهير هجومي أيسر', group:'DEF' },
  { key:'RWB', label:'ظهير هجومي أيمن', group:'DEF' },
  { key:'DM',  label:'حاجب',            group:'MID' },
  { key:'CM',  label:'وسط',             group:'MID' },
  { key:'CAM', label:'مهاجم وسط',       group:'MID' },
  { key:'LM',  label:'جناح أيسر',       group:'MID' },
  { key:'RM',  label:'جناح أيمن',       group:'MID' },
  { key:'LW',  label:'جناح أيسر',       group:'FWD' },
  { key:'RW',  label:'جناح أيمن',       group:'FWD' },
  { key:'ST',  label:'مهاجم',           group:'FWD' },
  { key:'CF',  label:'مهاجم إضافي',     group:'FWD' },
];

const ROSTER_GROUP_COLORS = {
  GK:  '#8E44AD',
  DEF: '#2980b9',
  MID: '#27ae60',
  FWD: '#C9A02B',
  OTHER: '#888',
};

const ROSTER_STATUS = {
  active:    { label: 'متاح',   color: 'var(--green,#27ae60)',   icon: '✅︎' },
  injured:   { label: 'مصاب',   color: '#C0392B',                icon: '🤕' },
  suspended: { label: 'موقوف',  color: '#D35400',                icon: '🟨' },
  absent:    { label: 'غائب',   color: 'var(--muted,#888)',      icon: '❌︎' },
};

// ══ فتح مودال قائمة اللاعبين ══
window.openRosterModal = async function(teamId) {
  const team = teams.find(t => t.id === teamId);
  if(!team) return;

  // إنشاء المودال
  let modal = document.getElementById('rosterModal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'rosterModal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.88);
      display:flex;align-items:flex-end;justify-content:center;
    `;
    modal.onclick = e => { if(e.target === modal) closeRosterModal(); };
    document.body.appendChild(modal);
  }

  const logoHtmlStr = team.logo && (team.logo.startsWith('data:') || team.logo.startsWith('http'))
    ? `<img src="${team.logo}" style="width:34px;height:34px;border-radius:8px;object-fit:cover" />`
    : `<span style="font-size:26px">${team.logo || '⚽'}</span>`;

  modal.innerHTML = `
    <div style="
      background:var(--card,#181818);border-radius:20px 20px 0 0;
      width:100%;max-width:700px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;
    ">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;
                  border-bottom:1px solid var(--border,#2a2a2a);flex-shrink:0">
        ${logoHtmlStr}
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${team.name}</div>
          <div style="font-size:11px;color:var(--muted,#888)" id="rosterCount">جاري التحميل...</div>
        </div>
        <button onclick="closeRosterModal()"
          style="background:none;border:none;color:var(--muted,#888);font-size:22px;cursor:pointer;padding:4px">✕</button>
      </div>

      <!-- Add Player Form -->
      <div style="padding:14px 20px;border-bottom:1px solid var(--border,#2a2a2a);
                  background:var(--card2,#1e1e1e);flex-shrink:0">
        <div style="font-size:10px;color:var(--muted,#888);margin-bottom:10px;font-weight:700;letter-spacing:.5px">
          ➕︎ إضافة لاعب جديد
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <input type="number" id="rosterNumInput" placeholder="#" min="1" max="99"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('rosterNameInput').focus();}"
            style="width:52px;padding:9px 6px;text-align:center;background:var(--dark,#111);
                   border:1px solid var(--border,#333);border-radius:8px;color:var(--text,#fff);
                   font-family:Tajawal,sans-serif;font-size:13px;font-weight:700"/>
          <input type="text" id="rosterNameInput" placeholder="اسم اللاعب — واضغط Enter لإضافة سريعة" 
            onkeydown="if(event.key==='Enter'){event.preventDefault();addRosterPlayer('${teamId}');}"
            style="flex:1;min-width:140px;padding:9px 12px;background:var(--dark,#111);
                   border:1px solid var(--border,#333);border-radius:8px;color:var(--text,#fff);
                   font-family:Tajawal,sans-serif;font-size:13px"/>
          <select id="rosterPosInput"
            style="padding:9px 8px;background:var(--dark,#111);border:1px solid var(--border,#333);
                   border-radius:8px;color:var(--muted,#aaa);font-family:Tajawal,sans-serif;font-size:12px">
            <option value="">المركز</option>
            ${ROSTER_POSITIONS.map(p => `<option value="${p.key}">${p.label}</option>`).join('')}
          </select>
          <select id="rosterStatusInput"
            style="padding:9px 8px;background:var(--dark,#111);border:1px solid var(--border,#333);
                   border-radius:8px;color:var(--muted,#aaa);font-family:Tajawal,sans-serif;font-size:12px">
            ${Object.entries(ROSTER_STATUS).map(([k,v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
          </select>
          <button onclick="addRosterPlayer('${teamId}')"
            style="padding:9px 18px;background:var(--gold,#C9A02B);color:#000;border:none;
                   border-radius:8px;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;
                   cursor:pointer;white-space:nowrap">
            إضافة
          </button>
        </div>
      </div>

      <!-- Players List -->
      <div id="rosterListContainer" style="flex:1;overflow-y:auto;padding:12px 20px">
        <div style="text-align:center;padding:30px;color:var(--muted,#888)">
          <div style="font-size:30px;opacity:.3;margin-bottom:8px">⏳</div>
          <div style="font-size:12px">جاري تحميل اللاعبين...</div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:12px 20px;border-top:1px solid var(--border,#2a2a2a);
                  display:flex;gap:8px;flex-shrink:0">
        <button onclick="importRosterToLineup('${teamId}')"
          style="flex:1;padding:11px;background:var(--blue,#2980b9);color:#fff;border:none;
                 border-radius:10px;font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;cursor:pointer">
          📋 استخدم القائمة في التشكيلة
        </button>
        <button onclick="closeRosterModal()"
          style="padding:11px 18px;background:var(--card2,#222);color:var(--muted,#888);
                 border:1px solid var(--border,#333);border-radius:10px;
                 font-family:Tajawal,sans-serif;font-size:13px;cursor:pointer">
          إغلاق
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  modal.dataset.teamId = teamId;

  // تحميل اللاعبين من Firebase مع real-time listener
  loadRosterRealtime(teamId);
};

window.closeRosterModal = function() {
  const modal = document.getElementById('rosterModal');
  if(modal) modal.style.display = 'none';
  document.body.style.overflow = '';
};

// ── Real-time listener للـ roster ──
function loadRosterRealtime(teamId) {
  // إلغاء الـ listener السابق إن وجد
  if(rosterListeners[teamId]) {
    rosterListeners[teamId]();
    delete rosterListeners[teamId];
  }

  const rosterRef = collection(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster');
  const q = query(rosterRef, orderBy('number'));

  rosterListeners[teamId] = onSnapshot(q, snap => {
    const players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rosterCache[teamId] = players;
    window._teamRosters[teamId] = players; // ✅︎ مزامنة مع منتقي لاعبي التشكيلة

    // تحديث العداد
    const countEl = document.getElementById('rosterCount');
    if(countEl) countEl.textContent = `${players.length} لاعب مسجل`;

    // اقتراح رقم القميص التالي تلقائياً في حقل الإضافة
    const numEl = document.getElementById('rosterNumInput');
    if(numEl && !numEl.value && document.activeElement !== numEl) {
      const maxNum = players.reduce((mx, p) => Math.max(mx, parseInt(p.number) || 0), 0);
      numEl.value = maxNum + 1;
    }

    renderRosterList(teamId, players);
  }, err => {
    console.warn('Roster load error:', err);
    const container = document.getElementById('rosterListContainer');
    if(container) container.innerHTML = `
      <div style="text-align:center;padding:30px;color:#C0392B;font-size:12px">
        خطأ في التحميل: ${err.message}
      </div>`;
  });
}

function renderRosterList(teamId, players) {
  const container = document.getElementById('rosterListContainer');
  if(!container) return;

  if(players.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:50px 20px;color:var(--muted,#888)">
        <div style="font-size:40px;opacity:.2;margin-bottom:12px">👥</div>
        <div style="font-size:14px;font-weight:700">لا يوجد لاعبون بعد</div>
        <div style="font-size:11px;margin-top:6px;opacity:.7">أضف لاعبين من النموذج أعلاه</div>
      </div>`;
    return;
  }

  // تجميع اللاعبين حسب المركز
  const groups = { GK: [], DEF: [], MID: [], FWD: [], OTHER: [] };
  const posGroupMap = {
    GK:'GK', CB:'DEF', LB:'DEF', RB:'DEF', LWB:'DEF', RWB:'DEF',
    DM:'MID', CM:'MID', CAM:'MID', LM:'MID', RM:'MID',
    LW:'FWD', RW:'FWD', ST:'FWD', CF:'FWD'
  };
  const groupLabels = { GK:'🧤 حراس المرمى', DEF:'🛡 الدفاع', MID:'⚙︎️ خط الوسط', FWD:'⚡ الهجوم', OTHER:'👤 أخرى' };

  players.forEach(p => {
    const grp = posGroupMap[p.position] || 'OTHER';
    groups[grp].push(p);
  });

  container.innerHTML = Object.entries(groups)
    .filter(([, arr]) => arr.length > 0)
    .map(([grp, arr]) => `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--muted,#888);
                    letter-spacing:.5px;margin-bottom:8px;padding-bottom:6px;
                    border-bottom:1px solid var(--border,#1a1a1a)">
          ${groupLabels[grp]} (${arr.length})
        </div>
        ${arr.map(p => renderRosterPlayerRow(p, teamId)).join('')}
      </div>
    `).join('');
}

function renderRosterPlayerRow(p, teamId) {
  const st = ROSTER_STATUS[p.status || 'active'] || ROSTER_STATUS.active;
  const posMeta = ROSTER_POSITIONS.find(r => r.key === p.position);
  const posLabel = posMeta?.label || (p.position || '—');
  const groupColor = ROSTER_GROUP_COLORS[posMeta?.group || 'OTHER'];

  return `
    <div id="roster-row-${p.id}" style="
      display:flex;align-items:center;gap:10px;padding:10px 12px;
      background:var(--card2,#1e1e1e);border:1px solid var(--border,#2a2a2a);
      border-radius:10px;margin-bottom:6px;
      ${p.status !== 'active' ? 'opacity:.7' : ''}
    ">
      <!-- رقم القميص -->
      <div style="
        width:32px;height:32px;border-radius:50%;
        background:${groupColor}1a;border:2px solid ${groupColor};
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:800;color:${groupColor};flex-shrink:0
      ">${p.number || '?'}</div>

      <!-- الاسم والمركز -->
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text,#fff);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${p.name || '—'}
        </div>
        <div style="font-size:10px;color:var(--muted,#888);margin-top:2px">${posLabel}</div>
      </div>

      <!-- الحالة -->
      <div style="
        font-size:10px;padding:3px 9px;border-radius:20px;
        background:${st.color}22;color:${st.color};
        border:1px solid ${st.color}44;white-space:nowrap;flex-shrink:0
      ">
        ${st.icon} ${st.label}
      </div>

      <!-- أزرار الإجراءات -->
      <div style="display:flex;gap:4px;flex-shrink:0">
        <!-- تغيير الحالة -->
        <select onchange="updateRosterStatus('${teamId}','${p.id}',this.value)"
          style="padding:5px;background:var(--dark,#111);border:1px solid var(--border,#333);
                 border-radius:6px;color:var(--muted,#888);font-family:Tajawal,sans-serif;font-size:10px">
          ${Object.entries(ROSTER_STATUS).map(([k,v]) =>
            `<option value="${k}" ${(p.status||'active')===k?'selected':''}>${v.icon}</option>`
          ).join('')}
        </select>
        <!-- تعديل -->
        <button onclick="editRosterPlayer('${teamId}','${p.id}')"
          style="padding:5px 8px;background:var(--card3,#2a2a2a);border:1px solid var(--border,#333);
                 border-radius:6px;font-size:12px;cursor:pointer">✏︎️</button>
        <!-- حذف -->
        <button onclick="deleteRosterPlayer('${teamId}','${p.id}','${(p.name||'').replace(/'/g,"\\'")}' )"
          style="padding:5px 8px;background:#C0392B22;border:1px solid #C0392B44;
                 border-radius:6px;font-size:12px;cursor:pointer">🗑</button>
      </div>
    </div>
  `;
}

// ── إضافة لاعب ──
window.addRosterPlayer = async function(teamId) {
  const numEl    = document.getElementById('rosterNumInput');
  const nameEl   = document.getElementById('rosterNameInput');
  const posEl    = document.getElementById('rosterPosInput');
  const statusEl = document.getElementById('rosterStatusInput');

  const name   = nameEl?.value.trim();
  const number = parseInt(numEl?.value) || null;
  const pos    = posEl?.value || '';
  const status = statusEl?.value || 'active';

  if(!name) { showToast('أدخل اسم اللاعب', 'error'); return; }

  try {
    await addDoc(collection(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster'), {
      name, number, position: pos, status,
      createdAt: serverTimestamp()
    });
    // ✅︎ تفريغ الاسم فقط، مع اقتراح الرقم التالي والإبقاء على المركز/الحالة — لإدخال سريع متتالٍ
    if(nameEl) { nameEl.value = ''; nameEl.focus(); }
    if(numEl)  numEl.value = number ? String(number + 1) : '';
    showToast(`✅︎ تمت إضافة ${name}`, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── حذف لاعب ──
window.deleteRosterPlayer = async function(teamId, playerId, playerName) {
  if (!(await window.confirmDialog({ title: '⚠️ تأكيد', message: `حذف اللاعب "${playerName}"؟`, confirmText: '🗑 نعم، احذف', danger: true }))) return;
  try {
    await deleteDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster', playerId));
    showToast('تم حذف اللاعب', 'error');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── تحديث حالة اللاعب ──
window.updateRosterStatus = async function(teamId, playerId, status) {
  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster', playerId), { status });
    showToast(`تم تحديث الحالة: ${ROSTER_STATUS[status]?.label || status}`, 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ── تعديل لاعب (inline) ──
window.editRosterPlayer = function(teamId, playerId) {
  const row = document.getElementById(`roster-row-${playerId}`);
  if(!row) return;

  const player = rosterCache[teamId]?.find(p => p.id === playerId);
  if(!player) return;

  row.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center;width:100%;flex-wrap:wrap">
      <input type="number" id="edit-num-${playerId}" value="${player.number||''}" placeholder="#" min="1" max="99"
        style="width:52px;padding:8px 4px;text-align:center;background:var(--dark,#111);
               border:1px solid var(--gold,#C9A02B);border-radius:8px;color:var(--text,#fff);
               font-family:Tajawal,sans-serif;font-size:13px;font-weight:700"/>
      <input type="text" id="edit-name-${playerId}" value="${player.name||''}" placeholder="اسم اللاعب"
        style="flex:1;min-width:130px;padding:8px 12px;background:var(--dark,#111);
               border:1px solid var(--gold,#C9A02B);border-radius:8px;color:var(--text,#fff);
               font-family:Tajawal,sans-serif;font-size:13px"/>
      <select id="edit-pos-${playerId}"
        style="padding:8px;background:var(--dark,#111);border:1px solid var(--border,#333);
               border-radius:8px;color:var(--muted,#aaa);font-family:Tajawal,sans-serif;font-size:11px">
        <option value="">مركز</option>
        ${ROSTER_POSITIONS.map(p => `<option value="${p.key}" ${player.position===p.key?'selected':''}>${p.label}</option>`).join('')}
      </select>
      <button onclick="saveRosterEdit('${teamId}','${playerId}')"
        style="padding:8px 14px;background:var(--gold,#C9A02B);color:#000;border:none;
               border-radius:8px;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer">
        حفظ
      </button>
      <button onclick="cancelRosterEdit('${teamId}','${playerId}')"
        style="padding:8px 10px;background:var(--card3,#2a2a2a);border:1px solid var(--border,#333);
               border-radius:8px;color:var(--muted,#888);font-size:12px;cursor:pointer">
        إلغاء
      </button>
    </div>
  `;
  document.getElementById(`edit-name-${playerId}`)?.focus();
};

window.saveRosterEdit = async function(teamId, playerId) {
  const num  = parseInt(document.getElementById(`edit-num-${playerId}`)?.value) || null;
  const name = document.getElementById(`edit-name-${playerId}`)?.value.trim();
  const pos  = document.getElementById(`edit-pos-${playerId}`)?.value || '';

  if(!name) { showToast('أدخل اسم اللاعب', 'error'); return; }

  try {
    await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'teams', teamId, 'roster', playerId), {
      number: num, name, position: pos, updatedAt: serverTimestamp()
    });
    showToast('✅︎ تم تحديث بيانات اللاعب', 'success');
    // الـ listener سيعيد الرسم تلقائياً
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.cancelRosterEdit = function(teamId, playerId) {
  const players = rosterCache[teamId] || [];
  renderRosterList(teamId, players);
};

// ── استيراد القائمة إلى التشكيلة ──
window.importRosterToLineup = function(teamId) {
  const players = rosterCache[teamId] || [];
  if(players.length === 0) {
    showToast('أضف لاعبين أولاً', 'error');
    return;
  }

  // العثور على آخر مباراة للفريق
  const teamMatches = matches.filter(m =>
    (m.homeId === teamId || m.awayId === teamId) && m.status !== 'finished'
  );

  if(teamMatches.length === 0) {
    showToast('لا توجد مباريات قادمة لهذا الفريق', 'error');
    return;
  }

  // إذا كانت مباراة واحدة، نفتح التشكيلة مباشرة
  const match = teamMatches[0];
  const side  = match.homeId === teamId ? 'home' : 'away';

  closeRosterModal();

  // تهيئة بيانات التشكيلة من القائمة
  if(!adminLineupState[match.id]) {
    adminLineupState[match.id] = {
      home: { formation: '4-3-3', players: [] },
      away: { formation: '4-3-3', players: [] }
    };
  }

  // ترتيب اللاعبين: الحارس أولاً ثم باقي المراكز
  const sorted = [...players].sort((a, b) => {
    const order = { GK: 0, CB: 1, LB: 2, RB: 3, LWB: 4, RWB: 5, DM: 6, CM: 7, CAM: 8, LM: 9, RM: 10, LW: 11, RW: 12, ST: 13, CF: 14 };
    return (order[a.position] ?? 99) - (order[b.position] ?? 99);
  });

  adminLineupState[match.id][side] = {
    formation: '4-3-3',
    players: sorted.map(p => ({
      name:     p.name,
      number:   p.number,
      position: p.position,
      status:   p.status || 'active'
    }))
  };

  setTimeout(() => window.openLineupModal(match.id), 200);
  showToast(`✅︎ تم استيراد ${players.length} لاعب — اختر التشكيل وأكمل`, 'success');
};

// console.log('[ROSTER PATCH] ✅︎ تم تحميل نظام إدارة اللاعبين');


// ═══════════════════════════════════════════════════════════════════
//  🎴 نظام بطاقات المباريات v2 — CSS + Modals
//  مضمّن مباشرة في admin_new_3.js
// ═══════════════════════════════════════════════════════════════════

(function initMatchCardsV2() {

  // ── CSS ──
  function injectCSS() {
    if (document.getElementById('_mcv2_css')) return;
    const s = document.createElement('style');
    s.id = '_mcv2_css';
    s.textContent = `
      @keyframes mcv2pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
      .mcv2-s-live { background:rgba(192,57,43,.12); border:1px solid rgba(192,57,43,.35); color:#C0392B; animation:mcv2pulse 1.5s infinite; }
      .mcv2-s-fin  { background:rgba(39,174,96,.08);  border:1px solid rgba(39,174,96,.25);  color:#27ae60; }
      .mcv2-s-ht   { background:rgba(243,156,18,.1);  border:1px solid rgba(243,156,18,.3);  color:#D35400; }
      .mcv2-s-up   { background:rgba(136,136,136,.08);border:1px solid rgba(136,136,136,.18);color:#666; }

      /* Sheet overlay */
      .mcv2-overlay {
        position:fixed;inset:0;z-index:9500;
        background:rgba(0,0,0,.82);backdrop-filter:blur(8px);
        display:flex;align-items:flex-end;justify-content:center;
      }
      .mcv2-sheet {
        background:#0e0e0e;border:1px solid;border-radius:22px 22px 0 0;
        width:100%;max-width:520px;max-height:92vh;overflow:hidden;
        display:flex;flex-direction:column;
        animation:mcv2slideUp .28s cubic-bezier(.16,1,.3,1);
      }
      @keyframes mcv2slideUp {
        from{transform:translateY(40px);opacity:0}
        to  {transform:translateY(0);   opacity:1}
      }
      .mcv2-shdr {
        display:flex;align-items:center;gap:10px;
        padding:16px 18px 12px;flex-shrink:0;
        border-bottom:1px solid #1f1f1f;
        background:linear-gradient(135deg,#111100,#0d0d0d);
      }
      .mcv2-sbody {
        overflow-y:auto;flex:1;padding:16px 18px 36px;
        -webkit-overflow-scrolling:touch;
      }
      .mcv2-sbody::-webkit-scrollbar{width:3px}
      .mcv2-sbody::-webkit-scrollbar-thumb{background:#333;border-radius:2px}

      .mcv2-inp  { width:100%;background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:10px 12px;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;outline:none;box-sizing:border-box; }
      .mcv2-inp:focus { border-color:#3a3a3a; }
      .mcv2-lbl  { font-size:10px;color:#666;font-weight:700;letter-spacing:.5px;margin-bottom:5px;display:block; }
      .mcv2-fld  { margin-bottom:13px; }
      .mcv2-g2   { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
      .mcv2-sec  { font-size:10px;font-weight:900;letter-spacing:.5px;margin-bottom:8px;margin-top:14px;padding-top:10px;border-top:1px solid #1a1a1a; }

      .mcv2-sbtn { width:100%;padding:14px;border:none;border-radius:12px;font-family:Tajawal,sans-serif;font-size:14px;font-weight:900;cursor:pointer;margin-top:10px; }
      .mcv2-sbtn:active{opacity:.8}
      .mcv2-sbtn-gold   { background:linear-gradient(135deg,#E8BE45,#C9A02B);color:#000; }
      .mcv2-sbtn-green  { background:linear-gradient(135deg,#27ae60,#1a8a48);color:#fff; }
      .mcv2-sbtn-dark   { background:#1a1a1a;border:1px solid #2a2a2a;color:#888; }

      .mcv2-toggle-btn.mcv2-toggle-on {
        background:rgba(155,89,182,.12) !important; border-color:rgba(155,89,182,.4) !important; color:#c084fc !important;
      }

      .mcv2-score-board {
        border-radius:16px;padding:16px 12px;text-align:center;margin-bottom:14px;
      }
      .mcv2-adj {
        width:38px;height:38px;border-radius:10px;border:1px solid;
        font-size:20px;font-weight:900;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        font-family:Tajawal,sans-serif;transition:filter .15s;
      }
      .mcv2-adj:active{filter:brightness(1.4)}
      .mcv2-adj-p{background:rgba(39,174,96,.12);border-color:rgba(39,174,96,.35);color:#27ae60}
      .mcv2-adj-m{background:rgba(192,57,43,.1);border-color:rgba(192,57,43,.3);color:#C0392B}

      .mcv2-status-opt {
        padding:6px 13px;border-radius:20px;font-size:11px;font-weight:700;
        cursor:pointer;border:1px solid #2a2a2a;background:#141414;color:#555;
        font-family:Tajawal,sans-serif;transition:all .15s;
      }
      .mcv2-status-flex { display:flex;gap:7px;flex-wrap:wrap; }

      .mcv2-ltab {
        flex:1;padding:9px;border-radius:10px;border:1px solid #2a2a2a;
        background:#141414;color:#666;font-family:Tajawal,sans-serif;
        font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .mcv2-ltab.mcv2-active{border-color:#8e44adaa;color:#8e44ad;background:rgba(142,68,173,.1)}
      .mcv2-fbtn {
        padding:5px 13px;border-radius:20px;border:1px solid #2a2a2a;
        background:#141414;color:#666;font-family:Tajawal,sans-serif;
        font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;
      }
      .mcv2-fbtn.mcv2-active{border-color:#8e44adaa;color:#8e44ad;background:rgba(142,68,173,.1)}
    `;
    document.head.appendChild(s);
  }

  // ── helpers ──
  function _getM(id) { return (window.matches || []).find(m => m.id === id) || null; }
  function _getT(id, fn, fl) { return (window.teams || []).find(t => t.id === id) || { name: fn || '؟', logo: fl || '⚽' }; }
  function _ov(id) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = id; ov.className = 'mcv2-overlay';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }
  function _hdr(icon, title, color, closeId) {
    return `<div class="mcv2-shdr" style="border-bottom-color:${color}22">
      <span style="font-size:20px">${icon}</span>
      <span style="flex:1;font-size:15px;font-weight:900;color:${color};font-family:Tajawal,Tajawal,sans-serif">${title}</span>
      <button onclick="document.getElementById('${closeId}').remove()" style="background:transparent;border:1px solid #2a2a2a;border-radius:8px;color:#666;padding:4px 10px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:11px">✕ إغلاق</button>
    </div>`;
  }

  // ═══════════════════
  //  1️⃣  زر البث
  // ═══════════════════
  window.mcv2OpenLive = function(matchId) {
    if (typeof window.openLivePage === 'function') {
      window.openLivePage(matchId);
    } else {
      window.showToast && window.showToast('⚠️ نظام البث لم يُحمَّل بعد', 'error');
    }
  };

  // ═══════════════════
  //  ✅︎ 2️⃣ نتيجة سريعة — لمباراة خلصت ولا تحتاج بث مباشر:
  //  تسجّل كل شيء (نتيجة، وقت إضافي، ركلات ترجيح، إحصائيات كاملة) وتنشر فوراً
  // ═══════════════════
  const QR_STATS = [
    { k:'possession',    l:'⚽ الاستحواذ %', pct:true  },
    { k:'shots',         l:'🎯 التسديدات',   pct:false },
    { k:'shotsOnTarget', l:'🥅 على المرمى',  pct:false },
    { k:'corners',       l:'⛳ الركنيات',    pct:false },
    { k:'fouls',         l:'⚠️ الأخطاء',     pct:false },
    { k:'yellowCards',   l:'🟨 الصفراء',     pct:false },
    { k:'redCards',      l:'🟥 الحمراء',     pct:false },
    { k:'offsides',      l:'🚩 التسلل',      pct:false },
    { k:'tackles',       l:'🦵 التدخلات',    pct:false },
  ];
  window._qrStats = window._qrStats || {}; // matchId → { possessionHome, possessionAway, ... }

  function _qrInit(m) {
    if (window._qrStats[m.id]) return;
    const s = m.stats || {};
    const obj = {};
    QR_STATS.forEach(d => {
      obj[d.k+'Home'] = s[d.k+'Home'] ?? (d.pct ? 50 : 0);
      obj[d.k+'Away'] = s[d.k+'Away'] ?? (d.pct ? 50 : 0);
    });
    window._qrStats[m.id] = obj;
  }

  window.mcv2QStatAdj = function(matchId, key, delta) {
    const st = window._qrStats[matchId]; if (!st) return;
    const isPct = key.startsWith('possession');
    if (isPct) {
      const homeKey = 'possessionHome', awayKey = 'possessionAway';
      const cur = key === homeKey ? st[homeKey] : st[awayKey];
      const next = Math.min(100, Math.max(0, cur + delta));
      st[key] = next;
      const otherKey = key === homeKey ? awayKey : homeKey;
      st[otherKey] = 100 - next;
      const elA = document.getElementById(`qr-val-${key}-${matchId}`);
      const elB = document.getElementById(`qr-val-${otherKey}-${matchId}`);
      if (elA) elA.textContent = st[key];
      if (elB) elB.textContent = st[otherKey];
      return;
    }
    st[key] = Math.max(0, (st[key]||0) + delta);
    const el = document.getElementById(`qr-val-${key}-${matchId}`);
    if (el) el.textContent = st[key];
  };

  /* ✅︎ النتيجة مشتقّة من الأحداث: (+) يفتح نافذة الهدف، (−) يحذف آخر هدف */
  window.mcv2QAdjS = function(matchId, side, delta) {
    const m = _getM(matchId); if (!m) return;
    if (delta === 1) return window.qrAddGoal(matchId, side);
    const evs = Array.isArray(m.events) ? m.events : [];
    let last = -1;
    evs.forEach((e, i) => { if (e.type === 'goal' && e.side === side) last = i; });
    if (last === -1) { window.showToast && window.showToast('لا توجد أهداف لحذفها', 'error'); return; }
    window.qrDeleteGoal(matchId, last);
  };

  window.mcv2QToggleET = function(matchId) {
    const box = document.getElementById('qr-et-box-' + matchId);
    const btn = document.getElementById('qr-et-btn-' + matchId);
    const on = box.style.display === 'none';
    box.style.display = on ? 'block' : 'none';
    btn.classList.toggle('mcv2-toggle-on', on);
  };

  window.mcv2QTogglePen = function(matchId) {
    const box = document.getElementById('qr-pen-box-' + matchId);
    const btn = document.getElementById('qr-pen-btn-' + matchId);
    const on = box.style.display === 'none';
    box.style.display = on ? 'block' : 'none';
    btn.classList.toggle('mcv2-toggle-on', on);
  };

  // ══ ✅︎ الأهداف في النتيجة السريعة — نظام أحداث زي صفحة البث ══
  window._qrEventsHtml = function(m) {
    const evs = (Array.isArray(m.events) ? m.events : []).filter(e => e.type === 'goal');
    if (!evs.length) {
      return `<div style="text-align:center;padding:12px;color:#666;font-size:11px">
        لا توجد أهداف — اضغط «＋ هدف» لتسجيل هدف باسم اللاعب
      </div>`;
    }
    return evs.map((e) => {
      const realIdx = m.events.indexOf(e);
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #1a1a1a">
        <span style="min-width:34px;font-size:11px;font-weight:900;color:#C9A02B">${e.minute || 0}'</span>
        <span style="font-size:13px">⚽</span>
        <span style="flex:1;font-size:11px;font-weight:700;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${e.player || '؟'}<span style="color:#777;font-weight:400"> · ${e.teamName || ''}</span>
        </span>
        <button onclick="qrDeleteGoal('${m.id}',${realIdx})" title="حذف"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(220,50,50,.3);background:rgba(220,50,50,.08);color:#C0392B;font-size:11px;cursor:pointer">🗑</button>
      </div>`;
    }).join('');
  };

  /* إعادة رسم قائمة الأهداف + لوحة النتيجة داخل النافذة */
  window._qrRefresh = function(matchId) {
    const m = _getM(matchId); if (!m) return;
    const box = document.getElementById('qr-events-' + matchId);
    if (box) box.innerHTML = window._qrEventsHtml(m);
    const hEl = document.getElementById('qr-score-home-' + matchId);
    const aEl = document.getElementById('qr-score-away-' + matchId);
    if (hEl) hEl.textContent = m.homeScore ?? 0;
    if (aEl) aEl.textContent = m.awayScore ?? 0;
    const h1 = document.getElementById('qr-hsc-' + matchId);
    const a1 = document.getElementById('qr-asc-' + matchId);
    if (h1) h1.value = m.homeScorers || '';
    if (a1) a1.value = m.awayScorers || '';
  };

  /* يعيد احتساب النتيجة والمرايا النصية من الأحداث */
  function _qrSync(m) {
    const evs = Array.isArray(m.events) ? m.events : [];
    m.homeScore = evs.filter(e => e.type === 'goal' && e.side === 'home').length;
    m.awayScore = evs.filter(e => e.type === 'goal' && e.side === 'away').length;
    // ⚠️ لا نضع الدقيقة هنا بصيغة "الاسم(N)" — كل الأنظمة التي تقرأ هذا
    // النص (ScorersCore, buildScorersData) تُفسِّر الرقم بين القوسين على
    // أنه عدد الأهداف وليس دقيقة التسجيل. كل حدث هدف = هدف واحد فعلاً،
    // فيكفي اسم اللاعب فقط (تكرار الاسم لهدفين يُحتسب صح تلقائياً).
    const names = side => evs.filter(e => e.type === 'goal' && e.side === side)
      .map(e => e.player).join(', ');
    m.homeScorers = names('home');
    m.awayScorers = names('away');
  }

  window.qrAddGoal = async function(matchId, side) {
    const m = _getM(matchId); if (!m) return;
    const t = side === 'home'
      ? _getT(m.homeId, m.homeName, m.homeLogo)
      : _getT(m.awayId, m.awayName, m.awayLogo);
    const teamId = side === 'home' ? m.homeId : m.awayId;

    document.getElementById('qrGoalOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'qrGoalOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = `
      <div style="width:100%;max-width:330px;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:16px;font-family:Tajawal,sans-serif">
        <div style="font-size:15px;font-weight:900;color:#C9A02B;text-align:center">⚽ تسجيل هدف</div>
        <div style="font-size:11px;color:#888;text-align:center;margin-bottom:12px">${t.name}</div>
        <div style="font-size:10px;color:#888;margin-bottom:5px">اسم اللاعب</div>
        <input id="qrGoalPlayer" placeholder="اكتب أو اختر لاعباً من القائمة بالأسفل"
          style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;box-sizing:border-box"/>
        <div id="qrGoalRosterBox" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          <span style="font-size:11px;color:#888">جارِ تحميل قائمة لاعبي ${t.name}...</span>
        </div>
        <div style="font-size:10px;color:#888;margin:10px 0 5px">الدقيقة</div>
        <input id="qrGoalMinute" type="number" min="1" max="130" value="1"
          style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;text-align:center;box-sizing:border-box"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
          <button onclick="document.getElementById('qrGoalOv').remove()"
            style="padding:11px;border-radius:9px;border:1px solid #2a2a2a;background:transparent;color:#888;font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">إلغاء</button>
          <button onclick="qrCommitGoal('${matchId}','${side}','${String(t.name).replace(/'/g,"\\'")}')"
            style="padding:11px;border-radius:9px;border:none;background:#27ae60;color:#fff;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">✅︎ إضافة</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    window.bindModalDismiss(ov);
    setTimeout(() => document.getElementById('qrGoalPlayer')?.focus(), 60);

    // ✅︎ لاعبو هذا الفريق فقط من القائمة الدائمة المسجَّلة — بدون خلط مع الفريق الآخر
    // ✅︎ ونستبعد من طُرد ببطاقة حمراء بالفعل في هذه المباراة
    const roster = teamId ? await window._loadTeamRoster(teamId) : [];
    const excludeNames = window._redCardedNames(m.events, side);
    const box = document.getElementById('qrGoalRosterBox');
    if (box) box.innerHTML = window._renderRosterPickButtons(roster, 'qrGoalPlayer', excludeNames);
  };

  window.qrCommitGoal = function(matchId, side, teamName) {
    const m = _getM(matchId); if (!m) return;
    const player = (document.getElementById('qrGoalPlayer')?.value || '').trim() || '؟';
    const minute = parseInt(document.getElementById('qrGoalMinute')?.value) || 1;
    document.getElementById('qrGoalOv')?.remove();
    const evs = Array.isArray(m.events) ? [...m.events] : [];
    evs.push({ minute, icon: '⚽', player, teamName, type: 'goal', side });
    evs.sort((a, b) => (a.minute || 0) - (b.minute || 0));
    m.events = evs;
    _qrSync(m);
    window._qrRefresh(matchId);
    window.showToast && window.showToast(`⚽ ${player} · ${teamName}`, 'success');
  };

  window.qrDeleteGoal = function(matchId, idx) {
    const m = _getM(matchId); if (!m || !Array.isArray(m.events)) return;
    m.events = m.events.filter((_, i) => i !== idx);
    _qrSync(m);
    window._qrRefresh(matchId);
    window.showToast && window.showToast('🗑 تم حذف الهدف', 'success');
  };

  // ── عرض البطاقات والتبديلات (كل الأحداث عدا الأهداف) ──
  window._qrCardEventsHtml = function(m) {
    const evs = (Array.isArray(m.events) ? m.events : [])
      .filter(e => e.type === 'yellow' || e.type === 'red' || e.type === 'sub');
    if (!evs.length) {
      return `<div style="text-align:center;padding:8px;color:#666;font-size:10px">لا توجد بطاقات أو تبديلات بعد</div>`;
    }
    return evs.map((e) => {
      const realIdx = m.events.indexOf(e);
      const _card = (c) => `<span style="display:inline-block;width:9px;height:12px;border-radius:2px;background:${c};vertical-align:-1px"></span>`;
      let ic = _card('#f1c40f'), body = e.player || '؟';
      if (e.type === 'red') ic = _card('#e74c3c');
      if (e.type === 'sub') {
        ic = window.Icon ? window.Icon('refresh', 13) : '';
        body = `<span style="color:#e05252">${window.Icon?window.Icon('download',10):''} ${e.playerOut || e.player || '؟'}</span> <span style="color:#2ecc71">${window.Icon?window.Icon('upload',10):''} ${e.playerIn || e.player2 || '؟'}</span>`;
      }
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid #1a1a1a">
        <span style="min-width:30px;font-size:11px;font-weight:900;color:#C9A02B">${e.minute || 0}'</span>
        <span style="font-size:13px">${ic}</span>
        <span style="flex:1;font-size:11px;font-weight:700;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${body}<span style="color:#777;font-weight:400"> · ${e.teamName || ''}</span>
        </span>
        <button onclick="qrDeleteCardEvent('${m.id}',${realIdx})" title="حذف"
          style="width:24px;height:24px;border-radius:6px;border:1px solid rgba(220,50,50,.3);background:rgba(220,50,50,.08);color:#C0392B;font-size:11px;cursor:pointer">🗑</button>
      </div>`;
    }).join('');
  };

  window.qrDeleteCardEvent = function(matchId, idx) {
    const m = _getM(matchId); if (!m || !Array.isArray(m.events)) return;
    m.events = m.events.filter((_, i) => i !== idx);
    const box = document.getElementById('qr-cardevents-' + matchId);
    if (box) box.innerHTML = window._qrCardEventsHtml(m);
    window.showToast && window.showToast('🗑 تم الحذف', 'success');
  };

  // ── إضافة بطاقة (صفراء/حمراء) عبر منتقي اللاعبين ──
  window.qrAddCard = async function(matchId, side, cardType) {
    const m = _getM(matchId); if (!m) return;
    const t = side === 'home' ? _getT(m.homeId, m.homeName, m.homeLogo) : _getT(m.awayId, m.awayName, m.awayLogo);
    const teamId = side === 'home' ? m.homeId : m.awayId;
    const icon = cardType === 'red' ? '🟥' : '🟨';
    const label = cardType === 'red' ? 'بطاقة حمراء' : 'بطاقة صفراء';
    const color = cardType === 'red' ? '#e74c3c' : '#f1c40f';

    document.getElementById('qrCardOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'qrCardOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = `
      <div style="width:100%;max-width:330px;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:16px;font-family:Tajawal,sans-serif">
        <div style="font-size:15px;font-weight:900;color:${color};text-align:center">${icon} ${label}</div>
        <div style="font-size:11px;color:#888;text-align:center;margin-bottom:12px">${t.name}</div>
        <div style="font-size:10px;color:#888;margin-bottom:5px">اسم اللاعب</div>
        <input id="qrCardPlayer" placeholder="اكتب أو اختر لاعباً"
          style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;box-sizing:border-box"/>
        <div id="qrCardRosterBox" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          <span style="font-size:11px;color:#888">جارِ التحميل...</span>
        </div>
        <div style="font-size:10px;color:#888;margin:10px 0 5px">الدقيقة</div>
        <input id="qrCardMinute" type="number" min="1" max="130" value="1"
          style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;text-align:center;box-sizing:border-box"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
          <button onclick="document.getElementById('qrCardOv').remove()"
            style="padding:11px;border-radius:9px;border:1px solid #2a2a2a;background:transparent;color:#888;font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">إلغاء</button>
          <button onclick="qrCommitCard('${matchId}','${side}','${cardType}','${icon}','${String(t.name).replace(/'/g,"\\'")}')"
            style="padding:11px;border-radius:9px;border:none;background:${color};color:#000;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">✅︎ إضافة</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    window.bindModalDismiss(ov);
    setTimeout(() => document.getElementById('qrCardPlayer')?.focus(), 60);
    const roster = teamId ? await window._loadTeamRoster(teamId) : [];
    const box = document.getElementById('qrCardRosterBox');
    if (box) box.innerHTML = window._renderRosterPickButtons(roster, 'qrCardPlayer', new Set());
  };

  window.qrCommitCard = function(matchId, side, cardType, icon, teamName) {
    const m = _getM(matchId); if (!m) return;
    const player = (document.getElementById('qrCardPlayer')?.value || '').trim() || '؟';
    const minute = parseInt(document.getElementById('qrCardMinute')?.value) || 1;
    document.getElementById('qrCardOv')?.remove();
    const evs = Array.isArray(m.events) ? [...m.events] : [];
    evs.push({ minute, icon, player, teamName, type: cardType, side });
    evs.sort((a, b) => (a.minute || 0) - (b.minute || 0));
    m.events = evs;
    const box = document.getElementById('qr-cardevents-' + matchId);
    if (box) box.innerHTML = window._qrCardEventsHtml(m);
    window.showToast && window.showToast(`${icon} ${player} · ${teamName}`, 'success');
  };

  // ── إضافة تبديل عبر منتقي الأساسي/الدكة ──
  window.qrAddSub = function(matchId, side) {
    const m = _getM(matchId); if (!m) return;
    const t = side === 'home' ? _getT(m.homeId, m.homeName, m.homeLogo) : _getT(m.awayId, m.awayName, m.awayLogo);
    window._subResetSelection && window._subResetSelection();
    document.getElementById('qrSubOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'qrSubOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = `
      <div style="width:100%;max-width:360px;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:16px;font-family:Tajawal,sans-serif;max-height:82vh;display:flex;flex-direction:column">
        <div style="font-size:15px;font-weight:900;color:#3498db;text-align:center">${window.Icon?window.Icon('refresh',15):''} تبديل لاعب</div>
        <div style="font-size:11px;color:#888;text-align:center;margin-bottom:12px">${t.name}</div>
        <div style="overflow-y:auto;flex:1">${window._subBuildPickerHtml ? window._subBuildPickerHtml(matchId, side) : ''}</div>
        <div style="font-size:10px;color:#888;margin:10px 0 5px">الدقيقة</div>
        <input id="qrSubMinute" type="number" min="1" max="130" value="1"
          style="width:100%;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:13px;text-align:center;box-sizing:border-box"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
          <button onclick="document.getElementById('qrSubOv').remove()"
            style="padding:11px;border-radius:9px;border:1px solid #2a2a2a;background:transparent;color:#888;font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">إلغاء</button>
          <button onclick="qrCommitSub('${matchId}','${side}','${String(t.name).replace(/'/g,"\\'")}')"
            style="padding:11px;border-radius:9px;border:none;background:#3498db;color:#fff;font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer">✅︎ إضافة</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    window.bindModalDismiss(ov);
  };

  window.qrCommitSub = function(matchId, side, teamName) {
    const m = _getM(matchId); if (!m) return;
    const sel = window._subSelected || { out: '', in: '' };
    const out = (sel.out || '').trim(), inp = (sel.in || '').trim();
    if (!out || !inp) { window.showToast && window.showToast('اختر لاعباً خارجاً وداخلاً', 'error'); return; }
    const minute = parseInt(document.getElementById('qrSubMinute')?.value) || 1;
    document.getElementById('qrSubOv')?.remove();
    const evs = Array.isArray(m.events) ? [...m.events] : [];
    evs.push({ minute, icon: '🔄', player: out, player2: inp, playerOut: out, playerIn: inp, teamName, type: 'sub', side });
    evs.sort((a, b) => (a.minute || 0) - (b.minute || 0));
    m.events = evs;
    const box = document.getElementById('qr-cardevents-' + matchId);
    if (box) box.innerHTML = window._qrCardEventsHtml(m);
    window.showToast && window.showToast(`🔄 ${out} ⇄ ${inp} · ${teamName}`, 'success');
  };

  // ══ ركلات الترجيح التفصيلية (نفس بنية البث: penalties.home/away = [{result,player}]) ══
  const _penIsGoal = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');

  window._qrPenListHtml = function(m) {
    const pens = m.penalties || { home: [], away: [] };
    const row = (side, label) => {
      const arr = pens[side] || [];
      const dots = arr.length
        ? arr.map(r => {
            const g = _penIsGoal(r);
            const nm = (typeof r === 'object' && r && r.player) ? r.player : '';
            return `<span title="${nm}" style="font-size:13px">${g ? '✅︎' : '❌︎'}</span>`;
          }).join(' ')
        : '<span style="font-size:10px;color:#666">—</span>';
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0">
        <span style="font-size:10px;color:#999;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
        <span style="display:flex;gap:3px;flex-wrap:wrap">${dots}</span>
      </div>`;
    };
    const ht = _getT(m.homeId, m.homeName, m.homeLogo);
    const at = _getT(m.awayId, m.awayName, m.awayLogo);
    return row('home', ht.name) + row('away', at.name);
  };

  function _qrPenSync(m) {
    if (!m.penalties) return;
    m.penaltyScoreHome = (m.penalties.home || []).filter(_penIsGoal).length;
    m.penaltyScoreAway = (m.penalties.away || []).filter(_penIsGoal).length;
  }
  function _qrPenRefresh(matchId, m) {
    const list = document.getElementById('qr-pen-list-' + matchId);
    if (list) list.innerHTML = window._qrPenListHtml(m);
    const h = document.getElementById('qr-pen-sc-home-' + matchId);
    const a = document.getElementById('qr-pen-sc-away-' + matchId);
    if (h) h.textContent = m.penaltyScoreHome ?? 0;
    if (a) a.textContent = m.penaltyScoreAway ?? 0;
  }

  // ضغط سجّل/ضيّع → منتقي لاعب سريع (قابل للتخطّي) ثم تسجيل الركلة
  window.qrPenShot = function(matchId, side, result) {
    const m = _getM(matchId); if (!m) return;
    const t = side === 'home' ? _getT(m.homeId, m.homeName, m.homeLogo) : _getT(m.awayId, m.awayName, m.awayLogo);
    const lu = side === 'home' ? m.homeLineup : m.awayLineup;
    const players = (lu && Array.isArray(lu.players)) ? lu.players.filter(p => p.name) : [];
    const resLabel = result === 'goal' ? '✅ سجّل' : '❌ ضيّع';
    const resColor = result === 'goal' ? '#2ecc71' : '#e74c3c';

    const btns = players.length
      ? players.map(p => `<button onclick="qrPenChoose('${matchId}','${side}','${result}','${String(p.name).replace(/'/g,"\\'")}')"
          style="display:flex;align-items:center;gap:6px;padding:9px 10px;border-radius:9px;border:1px solid #2a2a2a;background:#1a1a1a;color:#eee;font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer;text-align:right;width:100%">
          <span style="min-width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:rgba(255,255,255,.06);font-size:10px;font-weight:900;color:#C9A02B">${p.number||'—'}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
        </button>`).join('')
      : '<div style="font-size:11px;color:#888;text-align:center;padding:12px">لا توجد تشكيلة محفوظة — يمكنك التخطّي</div>';

    document.getElementById('qrPenOv')?.remove();
    const ov = document.createElement('div');
    ov.id = 'qrPenOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML = `
      <div style="width:100%;max-width:320px;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:16px;font-family:Tajawal,sans-serif;max-height:80vh;display:flex;flex-direction:column">
        <div style="font-size:14px;font-weight:900;color:${resColor};text-align:center">${resLabel} الركلة</div>
        <div style="font-size:11px;color:#888;text-align:center;margin-bottom:12px">${t.name} — اختر اللاعب أو تخطَّ</div>
        <div style="display:flex;flex-direction:column;gap:6px;overflow-y:auto;flex:1">${btns}</div>
        <button onclick="qrPenChoose('${matchId}','${side}','${result}','')"
          style="margin-top:12px;padding:10px;border-radius:9px;border:1px solid #2a2a2a;background:transparent;color:#888;font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer">تخطّي (بدون اسم)</button>
      </div>`;
    document.body.appendChild(ov);
    window.bindModalDismiss(ov);
  };

  window.qrPenChoose = function(matchId, side, result, playerName) {
    document.getElementById('qrPenOv')?.remove();
    const m = _getM(matchId); if (!m) return;
    if (!m.penalties) m.penalties = { home: [], away: [] };
    m.penalties[side].push({ result, player: (playerName || '').trim() });
    _qrPenSync(m);
    _qrPenRefresh(matchId, m);
  };

  window.qrPenUndo = function(matchId) {
    const m = _getM(matchId); if (!m || !m.penalties) return;
    const h = (m.penalties.home || []).length, a = (m.penalties.away || []).length;
    if (!h && !a) return;
    if (h >= a) m.penalties.home.pop(); else m.penalties.away.pop();
    _qrPenSync(m);
    _qrPenRefresh(matchId, m);
  };

  window.mcv2OpenQuickResult = function(matchId) {
    const m = _getM(matchId); if (!m) return;
    _qrInit(m);
    const ht = _getT(m.homeId, m.homeName, m.homeLogo);
    const at = _getT(m.awayId, m.awayName, m.awayLogo);
    const hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
    const wentET  = !!m.wentToExtraTime;
    const wentPen = !!m.penalties || m.penaltyScoreHome != null;
    /* ✅︎ أزرار الحسم في الإدخال السريع — للإقصاء فقط وحسب الإعدادات.
       كانت تظهر لكل المباريات بلا أي تمييز، فيسجّل المنظّم ركلات ترجيح
       على مباراة مجموعات — وهو مستحيل واقعياً ويفسد جدول الترتيب. */
    const _qrKO  = !!(m.isKnockout || m.knockoutRoundId != null);
    const _qrMs  = (window.settings && window.settings.matchSettings) || {};
    const _qrET  = _qrKO && _qrMs.hasExtraTime !== false;
    const _qrPen = _qrKO && _qrMs.hasPenalties !== false;
    const ovId = 'mcv2-qr-ov';
    const ov = _ov(ovId);
    const st = window._qrStats[matchId];

    const statsRows = QR_STATS.map(d => `
      <div style="display:grid;grid-template-columns:1fr 90px 1fr;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #1a1a1a">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:5px">
          <button onclick="mcv2QStatAdj('${matchId}','${d.k}Home',-1)" style="width:22px;height:22px;border-radius:5px;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:13px;cursor:pointer">−</button>
          <span id="qr-val-${d.k}Home-${matchId}" style="font-size:13px;font-weight:900;color:#C9A02B;min-width:26px;text-align:center;font-family:Tajawal,sans-serif">${st[d.k+'Home']}</span>
          <button onclick="mcv2QStatAdj('${matchId}','${d.k}Home',1)" style="width:22px;height:22px;border-radius:5px;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:13px;cursor:pointer">+</button>
        </div>
        <div style="text-align:center;font-size:9px;color:#777">${d.l}</div>
        <div style="display:flex;align-items:center;gap:5px">
          <button onclick="mcv2QStatAdj('${matchId}','${d.k}Away',-1)" style="width:22px;height:22px;border-radius:5px;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:13px;cursor:pointer">−</button>
          <span id="qr-val-${d.k}Away-${matchId}" style="font-size:13px;font-weight:900;color:#aaa;min-width:26px;text-align:center;font-family:Tajawal,sans-serif">${st[d.k+'Away']}</span>
          <button onclick="mcv2QStatAdj('${matchId}','${d.k}Away',1)" style="width:22px;height:22px;border-radius:5px;background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:13px;cursor:pointer">+</button>
        </div>
      </div>`).join('');

    ov.innerHTML = `
<div class="mcv2-sheet" style="border-color:#27ae6033">
  ${_hdr('📝', `نتيجة سريعة — ${ht.name} × ${at.name}`, '#27ae60', ovId)}
  <div class="mcv2-sbody">

    <div style="background:rgba(39,174,96,.06);border:1px solid rgba(39,174,96,.2);border-radius:10px;padding:9px 12px;margin-bottom:14px;font-size:11px;color:#7fcf9f;line-height:1.7">
      💡 لمباراة انتهت فعلياً بدون بث مباشر — سجّل كل شيء واضغط نشر، تظهر للجمهور فوراً كمباراة منتهية.
    </div>

    <!-- التاريخ والملعب -->
    <div class="mcv2-g2">
      <div class="mcv2-fld"><label class="mcv2-lbl">📅 التاريخ</label><input class="mcv2-inp" type="date" id="qr-date-${matchId}" value="${m.date || ''}"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">🏟️ الملعب</label><input class="mcv2-inp" id="qr-venue-${matchId}" value="${m.venue || ''}" placeholder="ملعب الحارة"/></div>
    </div>

    <!-- النتيجة -->
    <div class="mcv2-score-board" style="background:linear-gradient(135deg,#0d1a0d,#0d0d0d);border:1px solid #27ae6033;margin-top:10px">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;margin-bottom:12px">⚽ النتيجة (الوقت الأصلي)</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px">
        <div style="flex:1;text-align:center">
          <div style="font-size:13px;font-weight:900;color:#eee;margin-bottom:8px">${ht.name}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px">
            <button class="mcv2-adj mcv2-adj-m" onclick="mcv2QAdjS('${matchId}','home',-1)">−</button>
            <div style="font-size:44px;font-weight:900;color:#C9A02B;font-family:Tajawal,sans-serif;min-width:52px;text-align:center;line-height:1" id="qr-score-home-${matchId}">${hs}</div>
            <button class="mcv2-adj mcv2-adj-p" onclick="mcv2QAdjS('${matchId}','home',1)">+</button>
          </div>
        </div>
        <div style="font-size:22px;color:#333">—</div>
        <div style="flex:1;text-align:center">
          <div style="font-size:13px;font-weight:900;color:#eee;margin-bottom:8px">${at.name}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px">
            <button class="mcv2-adj mcv2-adj-m" onclick="mcv2QAdjS('${matchId}','away',-1)">−</button>
            <div style="font-size:44px;font-weight:900;color:#C9A02B;font-family:Tajawal,sans-serif;min-width:52px;text-align:center;line-height:1" id="qr-score-away-${matchId}">${as_}</div>
            <button class="mcv2-adj mcv2-adj-p" onclick="mcv2QAdjS('${matchId}','away',1)">+</button>
          </div>
        </div>
      </div>
    </div>

    <!-- وقت إضافي / ركلات ترجيح — للإقصاء فقط -->
    ${(_qrET || _qrPen) ? `
    <div style="display:flex;gap:8px;margin-top:12px">
      ${_qrET ? `<button id="qr-et-btn-${matchId}" class="mcv2-toggle-btn ${wentET?'mcv2-toggle-on':''}" onclick="mcv2QToggleET('${matchId}')" style="flex:1;padding:10px;border-radius:10px;border:1px solid #333;background:#161616;color:#ccc;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">⏱ احتاجت وقت إضافي؟</button>` : ''}
      ${_qrPen ? `<button id="qr-pen-btn-${matchId}" class="mcv2-toggle-btn ${wentPen?'mcv2-toggle-on':''}" onclick="mcv2QTogglePen('${matchId}')" style="flex:1;padding:10px;border-radius:10px;border:1px solid #333;background:#161616;color:#ccc;font-family:Tajawal,sans-serif;font-size:11px;font-weight:700;cursor:pointer">🥅 وصلت ركلات ترجيح؟</button>` : ''}
    </div>
    <div style="margin-top:8px;padding:8px 12px;background:rgba(230,126,34,.07);border:1px solid rgba(230,126,34,.2);border-radius:9px;font-size:10px;color:#e67e22;text-align:center;font-weight:700">
      ⛔ مباراة إقصائية — لا تُحفظ بالتعادل، لازم فائز (بالنتيجة أو بركلات الترجيح)
    </div>` : `
    <div style="margin-top:12px;padding:9px 12px;background:rgba(255,255,255,.03);border-radius:9px;font-size:10px;color:#777;text-align:center">
      ℹ️ مباراة مجموعات — التعادل نتيجة نهائية (نقطة لكل فريق)
    </div>`}
    <div id="qr-et-box-${matchId}" style="display:${wentET?'block':'none'};margin-top:8px;padding:10px 12px;background:#161616;border-radius:10px;border:1px solid rgba(243,156,18,.2)">
      <div style="font-size:10px;color:#D35400;margin-bottom:6px">⏱ النتيجة أعلاه تُعتبر بعد الوقت الإضافي (٩٠+١٥+١٥)</div>
    </div>
    <div id="qr-pen-box-${matchId}" style="display:${wentPen?'block':'none'};margin-top:8px;padding:10px 12px;background:#161616;border-radius:10px;border:1px solid rgba(155,89,182,.25)">
      <div style="font-size:10px;color:#9b59b6;font-weight:700;margin-bottom:10px">🥅 ركلات الترجيح — سجّل كل ركلة</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <div style="font-size:10px;color:#aaa;text-align:center;font-weight:700;margin-bottom:6px">${ht.name} · <span id="qr-pen-sc-home-${matchId}">0</span></div>
          <div style="display:flex;gap:5px">
            <button onclick="qrPenShot('${matchId}','home','goal')" style="flex:1;padding:8px;border-radius:8px;background:rgba(39,174,96,.12);border:1px solid rgba(39,174,96,.35);color:#2ecc71;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">✅ سجّل</button>
            <button onclick="qrPenShot('${matchId}','home','miss')" style="flex:1;padding:8px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);color:#e74c3c;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">❌ ضيّع</button>
          </div>
        </div>
        <div>
          <div style="font-size:10px;color:#aaa;text-align:center;font-weight:700;margin-bottom:6px">${at.name} · <span id="qr-pen-sc-away-${matchId}">0</span></div>
          <div style="display:flex;gap:5px">
            <button onclick="qrPenShot('${matchId}','away','goal')" style="flex:1;padding:8px;border-radius:8px;background:rgba(39,174,96,.12);border:1px solid rgba(39,174,96,.35);color:#2ecc71;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">✅ سجّل</button>
            <button onclick="qrPenShot('${matchId}','away','miss')" style="flex:1;padding:8px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);color:#e74c3c;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">❌ ضيّع</button>
          </div>
        </div>
      </div>
      <div id="qr-pen-list-${matchId}" style="margin-top:10px">${window._qrPenListHtml(m)}</div>
      <button onclick="qrPenUndo('${matchId}')" style="margin-top:8px;width:100%;padding:7px;border-radius:8px;background:transparent;border:1px solid #333;color:#888;font-size:10px;cursor:pointer;font-family:Tajawal,sans-serif">↩ تراجع عن آخر ركلة</button>
    </div>

    <!-- ✅︎ سجل الأهداف — يُضاف بزر (+) في لوحة النتيجة أعلاه (نفس نظام البث) -->
    <div class="mcv2-sec" style="color:#C9A02B">⚽ سجل الأهداف</div>
    <div id="qr-events-${matchId}" style="background:#111;border-radius:10px;padding:8px 10px">${_qrEventsHtml(m)}</div>
    <input type="hidden" id="qr-hsc-${matchId}" value="${m.homeScorers || ''}"/>
    <input type="hidden" id="qr-asc-${matchId}" value="${m.awayScorers || ''}"/>

    <!-- 🟨 بطاقات وتبديلات -->
    <div class="mcv2-sec" style="color:#e67e22">بطاقات وتبديلات</div>
    <div style="background:#111;border-radius:10px;padding:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:10px;color:#888;text-align:center;font-weight:700;margin-bottom:2px">${ht.name}</div>
          <button onclick="qrAddCard('${matchId}','home','yellow')" style="padding:8px;border-radius:9px;background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.3);color:#f1c40f;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif"><span style="display:inline-block;width:9px;height:12px;border-radius:2px;background:#f1c40f;vertical-align:-1px;margin-inline-end:5px"></span>بطاقة صفراء</button>
          <button onclick="qrAddCard('${matchId}','home','red')" style="padding:8px;border-radius:9px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);color:#e74c3c;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif"><span style="display:inline-block;width:9px;height:12px;border-radius:2px;background:#e74c3c;vertical-align:-1px;margin-inline-end:5px"></span>بطاقة حمراء</button>
          <button onclick="qrAddSub('${matchId}','home')" style="padding:8px;border-radius:9px;background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.3);color:#3498db;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">${window.Icon?window.Icon('refresh',12):''} تبديل</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="font-size:10px;color:#888;text-align:center;font-weight:700;margin-bottom:2px">${at.name}</div>
          <button onclick="qrAddCard('${matchId}','away','yellow')" style="padding:8px;border-radius:9px;background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.3);color:#f1c40f;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif"><span style="display:inline-block;width:9px;height:12px;border-radius:2px;background:#f1c40f;vertical-align:-1px;margin-inline-end:5px"></span>بطاقة صفراء</button>
          <button onclick="qrAddCard('${matchId}','away','red')" style="padding:8px;border-radius:9px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);color:#e74c3c;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif"><span style="display:inline-block;width:9px;height:12px;border-radius:2px;background:#e74c3c;vertical-align:-1px;margin-inline-end:5px"></span>بطاقة حمراء</button>
          <button onclick="qrAddSub('${matchId}','away')" style="padding:8px;border-radius:9px;background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.3);color:#3498db;font-size:11px;font-weight:700;cursor:pointer;font-family:Tajawal,sans-serif">${window.Icon?window.Icon('refresh',12):''} تبديل</button>
        </div>
      </div>
      <div id="qr-cardevents-${matchId}" style="margin-top:10px">${window._qrCardEventsHtml(m)}</div>
    </div>

    <!-- الإحصائيات الكاملة (نفس تصميم صفحة البث) -->
    <div class="mcv2-sec" style="color:#2980B9">📊 الإحصائيات الكاملة</div>
    <div style="background:#111;border-radius:10px;padding:8px 10px">${statsRows}</div>

    <!-- رجل المباراة + ملخص -->
    <div class="mcv2-sec" style="color:#C9A02B">🏅 رجل المباراة</div>
    <div class="mcv2-fld"><input class="mcv2-inp" id="qr-mom-${matchId}" value="${m.manOfMatch || ''}" placeholder="اسم اللاعب"/></div>
    <div class="mcv2-sec" style="color:#666">📝 ملخص المباراة</div>
    <div class="mcv2-fld"><textarea class="mcv2-inp" id="qr-sum-${matchId}" rows="2" style="resize:none" placeholder="أبرز أحداث المباراة...">${m.summary || ''}</textarea></div>

    <button class="mcv2-sbtn mcv2-sbtn-green" onclick="mcv2SaveQuickResult('${matchId}')">🚀 نشر النتيجة للجمهور</button>
  </div>
</div>`;
  };

  window.mcv2SaveQuickResult = async function(matchId) {
    const m = _getM(matchId); if (!m) return;
    const hs  = parseInt(document.getElementById(`qr-score-home-${matchId}`)?.textContent || '0') || 0;
    const as_ = parseInt(document.getElementById(`qr-score-away-${matchId}`)?.textContent || '0') || 0;
    const date  = document.getElementById(`qr-date-${matchId}`)?.value || new Date().toISOString().split('T')[0];
    const venue = document.getElementById(`qr-venue-${matchId}`)?.value.trim() || '';
    const hsc = document.getElementById(`qr-hsc-${matchId}`)?.value.trim() || '';
    const asc = document.getElementById(`qr-asc-${matchId}`)?.value.trim() || '';
    const mom = document.getElementById(`qr-mom-${matchId}`)?.value.trim() || '';
    const sum = document.getElementById(`qr-sum-${matchId}`)?.value.trim() || '';

    const wentET  = document.getElementById('qr-et-box-'+matchId)?.style.display !== 'none';
    const wentPen = document.getElementById('qr-pen-box-'+matchId)?.style.display !== 'none';
    // العدد: من الحقول الرقمية (qr-pen-h/a) أولاً، وإلا من تفاصيل الركلات إن وُجدت
    const _pg = r => (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal');
    const penObj = (wentPen && m.penalties && ((m.penalties.home||[]).length || (m.penalties.away||[]).length)) ? m.penalties : null;
    const _penHField = parseInt(document.getElementById('qr-pen-h-'+matchId)?.value ?? '');
    const _penAField = parseInt(document.getElementById('qr-pen-a-'+matchId)?.value ?? '');
    let penH = null, penA = null;
    if (wentPen) {
      if (!isNaN(_penHField) || !isNaN(_penAField)) {
        penH = isNaN(_penHField) ? 0 : _penHField;
        penA = isNaN(_penAField) ? 0 : _penAField;
      } else if (penObj) {
        penH = (penObj.home || []).filter(_pg).length;
        penA = (penObj.away || []).filter(_pg).length;
      }
    }

    // ── الإحصائيات: نحفظ بالتنسيقين (Home/Away و home_/away_) حتى تتوافق مع كل مكان يقرأها ──
    const st = window._qrStats[matchId] || {};
    const statsObj = {};
    QR_STATS.forEach(d => {
      statsObj[d.k+'Home'] = st[d.k+'Home'] ?? 0;
      statsObj[d.k+'Away'] = st[d.k+'Away'] ?? 0;
      statsObj['home_'+d.k] = st[d.k+'Home'] ?? 0;
      statsObj['away_'+d.k] = st[d.k+'Away'] ?? 0;
    });

    // ⛔ مباريات الإقصاء لا تقبل التعادل — لازم فائز (بالنتيجة أو بركلات الترجيح)
    if (m.isKnockout && hs === as_) {
      const _penDecides = (penH != null && penA != null && penH !== penA);
      if (!_penDecides) {
        window.showToast && window.showToast(
          '⛔ مباراة إقصائية لا تنتهي بالتعادل — فعّل ركلات الترجيح وحدّد الفائز', 'error');
        return;
      }
    }

    const updateData = {
      homeScore: hs, awayScore: as_,
      date, venue,
      // ✅︎ الأحداث هي المصدر — تُحفظ ليظهر الهدافون في الجمهور والإحصائيات
      events: Array.isArray(m.events) ? m.events : [],
      homeScorers: hsc, awayScorers: asc,
      manOfMatch: mom, summary: sum,
      wentToExtraTime: wentET,
      penaltyScoreHome: penH,
      penaltyScoreAway: penA,
      penalties: penObj,
      stats: statsObj,
      status: 'finished',
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), updateData);
      if (typeof recalcStandings === 'function') await recalcStandings();

      // ✅︎ ترقية الفائز تلقائياً لو مباراة إقصاء
      if (m.isKnockout && m.knockoutRoundId) {
        const finalH = (wentPen && !isNaN(penH)) ? penH : hs;
        const finalA = (wentPen && !isNaN(penA)) ? penA : as_;
        if (finalH !== finalA && typeof _autoAdvanceWinner === 'function') {
          await _autoAdvanceWinner(m.knockoutRoundId, matchId, finalH, finalA);
        }
      }

      delete window._qrStats[matchId];
      document.getElementById('mcv2-qr-ov')?.remove();
      window.showToast && window.showToast('✅︎ تم نشر النتيجة للجمهور', 'success');
    } catch(e) {
      window.showToast && window.showToast('❌︎ خطأ في الحفظ: ' + e.message, 'error');
    }
  };

  // ═══════════════════
  //  ✅︎ ملاحظة: نظام "إدخال النتيجة" المنفصل (mcv2OpenResult) أُزيل نهائياً.
  //  كان غير مرتبط بأي زر أصلاً (كود ميت). صفحة "📡 بث" الآن هي المكان
  //  الوحيد لكل شيء: النتيجة، الوقت الإضافي، ركلات الترجيح، والإحصائيات
  //  الكاملة (9 إحصائيات) — بدل تكرار نفس الوظيفة في مكانين مختلفين.
  // ═══════════════════

  // ═══════════════════
  //  ↩️ التراجع عن المباراة — إعادتها كأنها لم تُلعب
  //     يمسح: النتيجة، الهدافين، كل الأحداث، ركلات الترجيح، الإحصائيات،
  //     رجل المباراة، الملخص، بيانات البث — وتعود «قادمة» قابلة للبث من جديد.
  // ═══════════════════
  window.mcv2UndoMatch = async function(matchId) {
    const m = _getM(matchId); if (!m) return;
    const LEAGUE_ID = window._getLeagueId ? window._getLeagueId() : (window.LEAGUE_ID || '');
    if (!LEAGUE_ID) { window.showToast && window.showToast('خطأ في تحديد البطولة', 'error'); return; }

    const ok = await window.confirmDialog({
      title: '↩️ تراجع عن المباراة',
      message: 'سيُمسح كل شيء عن هذه المباراة (النتيجة، الأهداف، من سجّلها، البطاقات، التبديلات، ركلات الترجيح، الإحصائيات) وتعود كأنها لم تُلعب — لتبثّها من جديد.\n\nمتأكد؟',
      confirmText: 'نعم، تراجع', danger: true
    });
    if (!ok) return;

    // إيقاف أي بث حيّ قائم لهذه المباراة
    try {
      const stLive = _liveMatches && _liveMatches[matchId];
      if (stLive && stLive.timerInterval) clearInterval(stLive.timerInterval);
      if (_liveMatches) delete _liveMatches[matchId];
      const lp = document.getElementById('lp-' + matchId);
      if (lp) lp.remove();
    } catch(e) {}

    // القيم التي تُعيد المباراة لحالة نظيفة تماماً
    const cleared = {
      homeScore: null, awayScore: null,
      homeScorers: '', awayScorers: '',
      events: [],
      penaltyScoreHome: null, penaltyScoreAway: null,
      wentToExtraTime: false,
      manOfMatch: '', summary: '', stats: null,
      liveData: null,
      status: 'upcoming',
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId), cleared);
      // نظّف الحالة المحلية أيضاً
      const lm = matches.find(x => x.id === matchId);
      if (lm) {
        Object.assign(lm, {
          homeScore: null, awayScore: null, homeScorers: '', awayScorers: '',
          events: [], penaltyScoreHome: null, penaltyScoreAway: null,
          wentToExtraTime: false, manOfMatch: '', summary: '', stats: null,
          liveData: null, status: 'upcoming'
        });
      }
      document.getElementById('mcv2-qr-ov')?.remove();
      document.getElementById('mcv2-info-ov')?.remove();
      await recalcStandings();
      if (typeof renderMatches === 'function') renderMatches();
      window.showToast && window.showToast('↩️ رجعت المباراة — جاهزة للبث من جديد', 'success');
    } catch(e) {
      window.showToast && window.showToast('خطأ: ' + e.message, 'error');
    }
  };

  // ═══════════════════
  //  3️⃣  معلومات المباراة
  // ═══════════════════
  window.mcv2OpenInfo = function(matchId) {
    const m = _getM(matchId); if (!m) return;
    const ht = _getT(m.homeId, m.homeName, m.homeLogo);
    const at = _getT(m.awayId, m.awayName, m.awayLogo);
    const ovId = 'mcv2-info-ov';
    const ov = _ov(ovId);
    const isPending = m.status === 'pending';
    // ✅︎ لمباراة معلّقة غير مفعّلة: الهدف من فتح هذه النافذة هو نشرها، فنرشّح "قادمة" افتراضياً
    const effectiveStatus = isPending ? 'upcoming' : m.status;

    const STATS = [
      { k:'upcoming', l:'⏳ قادمة',   c:'#666' },
      { k:'live',     l:'🔴 مباشر',   c:'#C0392B' },
      { k:'halftime', l:'⏸ استراحة', c:'#D35400' },
      { k:'finished', l:'✅︎ انتهت',   c:'#27ae60' },
    ];

    // ✅︎ حمّل شعار راعي المباراة المحفوظ حتى لا يُفقد عند الحفظ
    if (typeof window.spSetMatchLogo === 'function') window.spSetMatchLogo(matchId, m.sponsorData?.logo || null);

    ov.innerHTML = `
<div class="mcv2-sheet" style="border-color:#C9A02B33">
  ${_hdr('⚙︎️', `معلومات المباراة — ${ht.name} × ${at.name}`, '#C9A02B', ovId)}
  <div class="mcv2-sbody">

    ${isPending ? `<div style="background:rgba(201,160,43,.08);border:1px solid rgba(201,160,43,.25);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#e0c060;line-height:1.7">
      🆕 مباراة جديدة تولّدت تلقائياً من المجموعة — عبّئ التاريخ والملعب واضغط النشر لتظهر للجمهور فوراً.
    </div>` : ''}

    <div class="mcv2-g2">
      <div class="mcv2-fld"><label class="mcv2-lbl">📅 التاريخ</label><input class="mcv2-inp" type="date" id="mcv2-idate-${matchId}" value="${m.date || ''}"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">⏰ الوقت</label><input class="mcv2-inp" type="time" id="mcv2-itime-${matchId}" value="${m.time || ''}"/></div>
    </div>
    ${!m.isKnockout ? `
    <div class="mcv2-fld">
      <label class="mcv2-lbl">🔢 الجولة <span style="color:var(--muted);font-weight:400">— انقل المباراة لجولة أخرى</span></label>
      <input class="mcv2-inp" type="number" min="1" max="60" id="mcv2-iround-${matchId}" value="${m.round || 1}"/>
    </div>` : ''}
    <div class="mcv2-fld"><label class="mcv2-lbl">🏟️ الملعب</label><input class="mcv2-inp" id="mcv2-iven-${matchId}" value="${m.venue || ''}" placeholder="ملعب الحارة"/></div>
    <div class="mcv2-g2">
      <div class="mcv2-fld"><label class="mcv2-lbl">👨‍⚖️ الحكم</label><input class="mcv2-inp" id="mcv2-iref-${matchId}" value="${m.referee || ''}" placeholder="اسم الحكم"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">🎙️ المعلق</label><input class="mcv2-inp" id="mcv2-icom-${matchId}" value="${m.commentator || ''}" placeholder="اسم المعلق"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">🚩 مساعد ١</label><input class="mcv2-inp" id="mcv2-ils1-${matchId}" value="${m.linesman1 || ''}" placeholder="الحكم المساعد"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">🚩 مساعد ٢</label><input class="mcv2-inp" id="mcv2-ils2-${matchId}" value="${m.linesman2 || ''}" placeholder="الحكم المساعد"/></div>
    </div>
    <div class="mcv2-fld"><label class="mcv2-lbl">📡 رابط البث</label><input class="mcv2-inp" id="mcv2-istr-${matchId}" value="${m.streamUrl || ''}" placeholder="https://youtube.com/live/..."/></div>
    <div class="mcv2-g2">
      <div class="mcv2-fld"><label class="mcv2-lbl">🏷️ راعي المباراة</label><input class="mcv2-inp" id="spm-name-${matchId}" value="${(m.sponsorData?.name) || m.sponsor || ''}" placeholder="اسم الراعي"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">رابط الراعي</label><input class="mcv2-inp" id="spm-url-${matchId}" value="${(m.sponsorData?.url) || ''}" placeholder="موقع أو رقم واتساب"/></div>
      <div class="mcv2-fld"><label class="mcv2-lbl">شعار الراعي</label>
        <div style="display:flex;align-items:center;gap:8px">
          <div id="spm-prev-${matchId}" class="sp-drop" style="width:48px;height:48px;flex:0 0 48px" onclick="document.getElementById('spm-file-${matchId}').click()">${m.sponsorData?.logo ? `<img src="${m.sponsorData.logo}" style="width:100%;height:100%;object-fit:contain"/>` : '<span style="font-size:16px;color:var(--muted)">🏷️</span>'}</div>
          <input type="file" id="spm-file-${matchId}" accept="image/*" style="display:none" onchange="spHandleMatchLogo(this,'${matchId}')"/>
          <button class="btn" style="font-size:10px;padding:4px 8px" onclick="spSetMatchLogo('${matchId}',null);document.getElementById('spm-prev-${matchId}').innerHTML='<span style=\'font-size:16px;color:var(--muted)\'>🏷️</span>'">إزالة</button>
        </div>
      </div>
      <div class="mcv2-fld"><label class="mcv2-lbl">👥 الجمهور</label><input class="mcv2-inp" type="number" id="mcv2-iatt-${matchId}" value="${m.attendance || ''}" placeholder="500"/></div>
    </div>
    <div class="mcv2-fld"><label class="mcv2-lbl">📝 ملاحظات</label><textarea class="mcv2-inp" id="mcv2-inotes-${matchId}" rows="2" style="resize:none" placeholder="أي ملاحظات للجمهور...">${m.notes || ''}</textarea></div>

    <div class="mcv2-sec" style="color:#C9A02B">🚦 حالة المباراة</div>
    <div class="mcv2-status-flex" id="mcv2-istat-${matchId}">
      ${STATS.map(s => `
        <button class="mcv2-status-opt" id="mcv2-ist-${s.k}-${matchId}"
          style="${effectiveStatus === s.k ? `background:${s.c}18;border-color:${s.c}44;color:${s.c}` : ''}"
          onclick="mcv2SelStat('${matchId}','${s.k}','${s.c}')">${s.l}
        </button>`).join('')}
    </div>

    <button class="mcv2-sbtn mcv2-sbtn-gold" onclick="mcv2SaveInfo('${matchId}')">${isPending ? '🚀 نشر المباراة للجمهور' : '💾 حفظ المعلومات'}</button>
  </div>
</div>`;

    ov.__selStatus = effectiveStatus;
  };

  window.mcv2SelStat = function(matchId, status, color) {
    document.getElementById('mcv2-info-ov').__selStatus = status;
    ['upcoming','live','halftime','finished'].forEach(k => {
      const btn = document.getElementById(`mcv2-ist-${k}-${matchId}`);
      if (!btn) return;
      btn.style.background = ''; btn.style.borderColor = '#2a2a2a'; btn.style.color = '#555';
    });
    const active = document.getElementById(`mcv2-ist-${status}-${matchId}`);
    if (active) { active.style.background = `${color}18`; active.style.borderColor = `${color}44`; active.style.color = color; }
  };

  window.mcv2SaveInfo = async function(matchId) {
    const m = _getM(matchId); if (!m) return;
    const status = document.getElementById('mcv2-info-ov')?.__selStatus || m.status;
    const data = {
      date:        document.getElementById(`mcv2-idate-${matchId}`)?.value  || m.date,
      time:        document.getElementById(`mcv2-itime-${matchId}`)?.value  || m.time,
      venue:       document.getElementById(`mcv2-iven-${matchId}`)?.value.trim()  || '',
      referee:     document.getElementById(`mcv2-iref-${matchId}`)?.value.trim()  || '',
      commentator: document.getElementById(`mcv2-icom-${matchId}`)?.value.trim()  || '',
      linesman1:   document.getElementById(`mcv2-ils1-${matchId}`)?.value.trim()  || '',
      linesman2:   document.getElementById(`mcv2-ils2-${matchId}`)?.value.trim()  || '',
      streamUrl:   document.getElementById(`mcv2-istr-${matchId}`)?.value.trim()  || '',
      sponsor:     document.getElementById(`spm-name-${matchId}`)?.value.trim() || '',
      sponsorData: (typeof window.spReadMatchForm === 'function' ? window.spReadMatchForm(matchId) : null),
      attendance:  document.getElementById(`mcv2-iatt-${matchId}`)?.value  || '',
      notes:       document.getElementById(`mcv2-inotes-${matchId}`)?.value.trim() || '',
      status,
    };
    // ✅︎ نقل المباراة لجولة أخرى (مباريات الدوري/المجموعات فقط)
    const rEl = document.getElementById(`mcv2-iround-${matchId}`);
    if (rEl && !m.isKnockout) {
      const rv = parseInt(rEl.value);
      if (!isNaN(rv) && rv >= 1) data.round = rv;
    }
    try {
      await updateDoc(doc(db, 'leagues', LEAGUE_ID, 'matches', matchId),
        { ...data, updatedAt: serverTimestamp() });
      document.getElementById('mcv2-info-ov')?.remove();
      window.showToast && window.showToast('✅︎ تم حفظ المعلومات', 'success');

      // ✅︎ ترقية الفائز تلقائياً لو صارت هذي مباراة إقصاء منتهية وفيها نتيجة حاسمة
      if (status === 'finished' && m.isKnockout && m.knockoutRoundId) {
        const hs = m.penaltyScoreHome != null ? m.penaltyScoreHome : m.homeScore;
        const as2 = m.penaltyScoreAway != null ? m.penaltyScoreAway : m.awayScore;
        if (typeof hs === 'number' && typeof as2 === 'number' && hs !== as2 && typeof _autoAdvanceWinner === 'function') {
          await _autoAdvanceWinner(m.knockoutRoundId, matchId, hs, as2);
        }
      }
    } catch(e) {
      window.showToast && window.showToast('خطأ: ' + e.message, 'error');
    }
  };

  // ═══════════════════
  //  4️⃣  التشكيلات
  // ═══════════════════
  window.mcv2OpenLineup = function(matchId) {
    if (typeof window.openLineupDragDrop === 'function') {
      window.openLineupDragDrop(matchId);
    } else if (typeof window.openMatchLineup === 'function') {
      window.openMatchLineup(matchId);
    } else if (typeof window.openLineupModal === 'function') {
      window.openLineupModal(matchId);
    } else {
      // انتظر تحميل الملف حتى 6 ثوانٍ
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (typeof window.openLineupDragDrop === 'function') {
          clearInterval(iv);
          window.openLineupDragDrop(matchId);
        } else if (tries > 20) {
          clearInterval(iv);
          window.showToast && window.showToast('⚠️ نظام التشكيلات لم يُحمَّل', 'error');
        }
      }, 300);
    }
  };

  // ── init ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCSS);
  } else {
    injectCSS();
  }

  // console.log('[CARDS V2] ✅︎ نظام البطاقات v2 — تم التحميل');

})();
