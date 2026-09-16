import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword }
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
const db = getFirestore(app);
const auth = getAuth(app);

/* ✅︎ تصدير جسر Firestore — superadmin.js موديول، فمتغيّراته (db, doc, setDoc...)
   غير مرئية للملفات العادية اللي تُحمَّل بعده بدون type="module"
   (مثل superadmin-requests.js و handover.js). بدون هذا التصدير تظل
   تلك الملفات تنتظر إلى الأبد شرطاً لا يتحقق أبداً، فلا تُحقن أقسامها
   ولا تعمل ميزاتها إطلاقاً — رغم أن كل أكوادها سليمة. */
window._db = db;
window._firestoreCollection = collection;
window._firestoreDoc        = doc;
window._firestoreGetDoc     = getDoc;
window._firestoreGetDocs    = getDocs;
window._firestoreSetDoc     = setDoc;
window._firestoreAddDoc     = addDoc;
window._firestoreUpdateDoc  = updateDoc;
window._firestoreDeleteDoc  = deleteDoc;
window._firestoreOnSnapshot = onSnapshot;
window._firestoreQuery      = query;
window._firestoreOrderBy    = orderBy;
window._firestoreWhere      = where;

// ══ STATE ══
const SITE_URL = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
/* ✅︎ تصدير — superadmin.js موديول، فـ SITE_URL غير مرئية لـ inline onclick.
   كانت أزرار «الجمهور/الإدارة» على البطاقة ترمي ReferenceError صامتاً
   ولا تفعل شيئاً، بينما أزرار نافذة «إجراءات» تعمل لأنها نصوص حرفية. */
window.SITE_URL = SITE_URL;
window.openLeagueViewer = (id) => window.open(SITE_URL + 'league-viewer.html?id=' + id, '_blank');
window.openLeagueAdmin  = (id) => window.open(SITE_URL + 'league-admin.html?id='  + id, '_blank');
let allLeagues = [];
let allSubs = [];
let allAdmins = [];
let currentFilter = 'all';

// ══ SUBSCRIPTION DURATION (خطة واحدة فقط — تُحدَّد بالمدة لا بالنوع) ══
const durationState = { nl: 1, sub: 1, renew: 1 };
const durationCustom = { nl: false, sub: false, renew: false };
let _renewingSubId = null;

function todayISO() { return new Date().toISOString().split('T')[0]; }
/* ✅ تفسير endDate كنهاية اليوم بالتوقيت المحلي (لا UTC) */
function subEndLocal(endDate) {
  if (!endDate) return null;
  const m = String(endDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 23, 59, 59, 999);
  const d = new Date(endDate);
  return isNaN(d.getTime()) ? null : d;
}

function addMonthsISO(startISO, months) {
  const d = startISO ? new Date(startISO) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

window.selectDuration = function(el, months, ctx) {
  document.querySelectorAll('#' + ctx + '_durations .dur-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  durationCustom[ctx] = months === 0;
  durationState[ctx] = months || durationState[ctx];
  const endInput = document.getElementById(ctx + '_end');
  if(months === 0) {
    // مخصص — يسمح للمستخدم بتعديل تاريخ الانتهاء يدوياً
    if(endInput) endInput.readOnly = false;
  } else {
    if(endInput) endInput.readOnly = false;
    recalcDuration(ctx);
  }
};

window.recalcDuration = function(ctx) {
  if(durationCustom[ctx]) return; // مخصص: لا نحسب تلقائياً
  const startInput = document.getElementById(ctx + '_start');
  const endInput = document.getElementById(ctx + '_end');
  const start = startInput?.value || todayISO();
  if(startInput && !startInput.value) startInput.value = start;
  if(endInput) endInput.value = addMonthsISO(start, durationState[ctx]);
};

function initDurationDefaults() {
  ['nl', 'sub', 'renew'].forEach(ctx => {
    const startInput = document.getElementById(ctx + '_start');
    if(startInput && !startInput.value) startInput.value = todayISO();
    recalcDuration(ctx);
  });
}

// ══ AUTH ══
window.doLogin = async function() {
  const email = document.getElementById('saEmail').value.trim();
  const pass = document.getElementById('saPass').value;
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('lgErr');

  if(!email || !pass){ showErr('أدخل البريد وكلمة المرور'); return; }

  btn.disabled = true;
  document.getElementById('loginBtnText').textContent = 'جاري الدخول...';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // check if superadmin
    const admDoc = await getDoc(doc(db, 'admins', auth.currentUser.uid));
    if(!admDoc.exists() || admDoc.data().role !== 'superadmin') {
      await signOut(auth);
      showErr('ليس لديك صلاحية الدخول كـ Super Admin — تأكد من إنشاء سجل admins/{uid} برول superadmin في Firebase Console');
      btn.disabled = false;
      document.getElementById('loginBtnText').textContent = '👑 دخول المنصة';
      return;
    }
    enterApp();
  } catch(e) {
    showErr(getAuthError(e.code));
    btn.disabled = false;
    document.getElementById('loginBtnText').textContent = '👑 دخول المنصة';
  }
};

function showErr(msg) {
  const el = document.getElementById('lgErr');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

function getAuthError(code) {
  const map = {
    'auth/user-not-found': 'البريد الإلكتروني غير موجود',
    'auth/wrong-password': 'كلمة المرور خاطئة',
    'auth/invalid-email': 'بريد إلكتروني غير صحيح',
    'auth/too-many-requests': 'محاولات كثيرة — انتظر قليلاً',
    'auth/invalid-credential': 'بيانات الدخول خاطئة',
  };
  return map[code] || 'خطأ في تسجيل الدخول';
}

onAuthStateChanged(auth, async (user) => {
  if(user) {
    const admDoc = await getDoc(doc(db, 'admins', user.uid));
    if(admDoc.exists() && admDoc.data().role === 'superadmin') {
      enterApp();
    }
  }
});

function enterApp() {
  const ls = document.getElementById('loginScreen');
  ls.style.opacity = '0';
  setTimeout(() => {
    ls.style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('currentAdminEmail').textContent = auth.currentUser?.email || '—';
    loadData();
  }, 400);
}

window.doLogout = async function() {
  if(confirm('هل تريد الخروج؟')) {
    await signOut(auth);
    location.reload();
  }
};

// ══ LOAD DATA ══
async function loadData() {
  initDurationDefaults();
  // Real-time listener for leagues
  onSnapshot(collection(db, 'leagues'), (snap) => {
    allLeagues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateStats();
    renderLeagues(currentFilter);
    renderActiveQuick();
    renderAnalytics();
    document.getElementById('leaguesBadge').textContent = allLeagues.length;
    document.getElementById('leaguesCount').textContent = allLeagues.length + ' بطولة مسجلة في المنصة';
  });

  // Real-time listener for subscriptions
  onSnapshot(collection(db, 'subscriptions'), (snap) => {
    allSubs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSubs();
    renderExpiringOverview();
    updateSubStats();
    document.getElementById('subsBadge').textContent = allSubs.filter(s => s.status === 'active').length;
    // populate league select in modal
    const sel = document.getElementById('sub_league');
    if(sel) {
      sel.innerHTML = '<option value="">-- اختر بطولة --</option>' +
        allLeagues.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    }
  });

  // Real-time listener for users
  onSnapshot(collection(db, 'leagueAdmins'), (snap) => {
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allAdmins = users; // ✅︎ نُبقيها عامة ليقدر _hoData يجيب منها كلمة المرور المحفوظة
    renderUsers(users);
    document.getElementById('usersBadge').textContent = users.length;
    document.getElementById('statUsers').textContent = users.length;
  });
}

// ══ STATS ══
function updateStats() {
  const active = allLeagues.filter(l => l.status === 'active').length;
  document.getElementById('statTotal').textContent = allLeagues.length;
  document.getElementById('statActive').textContent = active;
  document.getElementById('activeCount').textContent = active;
  document.getElementById('lastUpdate').textContent = 'آخر تحديث: الآن ' + new Date().toLocaleTimeString('ar');
}

function subStatus(s) {
  if(s.status === 'cancelled') return 'cancelled';
  if(!s.endDate) return s.status === 'active' ? 'active' : 'expired';
  const diff = (subEndLocal(s.endDate) - new Date()) / (1000*60*60*24);
  if(diff <= 0) return 'expired';
  if(diff <= 14) return 'soon';
  return 'active';
}

function updateSubStats() {
  const active = allSubs.filter(s => subStatus(s) === 'active').length;
  const soon = allSubs.filter(s => subStatus(s) === 'soon').length;
  const expired = allSubs.filter(s => subStatus(s) === 'expired').length;
  document.getElementById('statSubs').textContent = allSubs.filter(s => s.status === 'active').length;
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set('statSubsActive', active);
  set('statSubsSoon', soon);
  set('statSubsExpired', expired);
  set('statSubsTotal', allSubs.length);

  const expEl = document.getElementById('expiringSoon');
  if(expEl) expEl.innerHTML = soon > 0 ? `<span style="color:var(--orange)">⚠ ${soon} تنتهي قريباً</span>` : `<span style="color:var(--muted)">كل الاشتراكات سليمة</span>`;
}

function leagueSubDaysLabel(leagueId) {
  const sub = allSubs.find(s => s.leagueId === leagueId);
  if(!sub || !sub.endDate) return '—';
  const diff = Math.ceil((subEndLocal(sub.endDate) - new Date()) / (1000*60*60*24));
  if(diff <= 0) return 'منتهي';
  return diff + ' يوم';
}

function leagueSubBadge(leagueId) {
  const sub = allSubs.find(s => s.leagueId === leagueId);
  const st = sub ? subStatus(sub) : 'expired';
  const map = { active: ['plan-active', '🟢 مشترك'], soon: ['plan-soon', '⚠ ينتهي قريباً'], expired: ['plan-expired', '🔴 غير مشترك'], cancelled: ['plan-cancelled', '⚫ ملغى'] };
  const [cls, txt] = map[st] || map.expired;
  return `<span class="plan-badge ${cls}">${txt}</span>`;
}

// ══ RENDER LEAGUES ══
function renderLeagues(filter = 'all') {
  currentFilter = filter;
  const grid = document.getElementById('leaguesGrid');
  const filtered = filter === 'all' ? allLeagues : allLeagues.filter(l => l.status === filter);

  if(filtered.length === 0) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);grid-column:1/-1">
      <div style="font-size:40px;margin-bottom:10px">🏆</div>
      <div>لا توجد بطولات ${filter !== 'all' ? 'بهذا الفلتر' : 'بعد'}</div>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(l => `
    <div class="league-card">
      <div class="lc-header">
        <div class="lc-badge">${l.icon || '🏆'}</div>
        <div class="lc-info">
          <div class="lc-name">${l.name}</div>
          <div class="lc-meta">${typeLabel(l.type)} · ${l.ownerName || '—'} · ${l.season || '2025'}</div>
        </div>
        ${statusBadge(l.status)}
      </div>
      <div class="lc-body">
        <div class="lc-stats">
          <div class="lc-stat"><div class="lc-stat-n">${l.teamsCount || 0}</div><div class="lc-stat-l">فريق</div></div>
          <div class="lc-stat"><div class="lc-stat-n">${l.matchesCount || 0}</div><div class="lc-stat-l">مباراة</div></div>
          <div class="lc-stat"><div class="lc-stat-n" style="font-size:11px">${leagueSubDaysLabel(l.id)}</div><div class="lc-stat-l">الاشتراك</div></div>
        </div>
        <div class="lc-links">
          <span class="link-pill lp-viewer" onclick="openLeagueViewer('${l.id}')">الجمهور ↗︎</span>
          <span class="link-pill lp-admin" onclick="openLeagueAdmin('${l.id}')">الإدارة ↗︎</span>
        </div>
      </div>
      <div class="lc-footer">
        ${leagueSubBadge(l.id)}
        <button class="btn btn-outline btn-xs" onclick="leagueActions('${l.id}')">⋯ إجراءات</button>
        ${l.status === 'active'
          ? `<button class="btn btn-red btn-xs" onclick="toggleLeague('${l.id}','suspended')">🔴 إيقاف</button>`
          : `<button class="btn btn-green btn-xs" onclick="toggleLeague('${l.id}','active')">🟢 تفعيل</button>`}
      </div>
    </div>
  `).join('');
}

window.filterLeagues = function(f, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active', 'btn-gold'));
  if(btn) { btn.classList.add('active'); }
  renderLeagues(f);
};

window.toggleLeague = async function(id, newStatus) {
  try {
    await updateDoc(doc(db, 'leagues', id), { status: newStatus, updatedAt: serverTimestamp() });
    showToast(newStatus === 'active' ? 'تم تفعيل البطولة ✓' : 'تم إيقاف البطولة', newStatus === 'active' ? 'success' : 'error');
  } catch(e) { showToast('حدث خطأ: ' + e.message, 'error'); }
};

// ══ قفل/فتح البطولة ══
window.lockLeague = async function(id, lock) {
  try {
    await updateDoc(doc(db, 'leagues', id), { locked: lock, updatedAt: serverTimestamp() });
    showToast(lock ? '🔒 تم قفل البطولة — المدير لا يستطيع التعديل' : '🔓 تم فتح القفل', lock ? 'error' : 'success');
    closeModal('modal-league-actions');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

/* ✅︎ إضافة مساحة لاعبين إضافية — الطريقة الأسرع من داخل نافذة البطولة:
   يسأل "كم لاعب تريد تضيفه؟" (إضافة فوق الموجود، لا استبدال)، يرفع
   الحدّ، يمسح راية "استنفدت الحصّة" إن وجدت، ويترك للعميل إشعاراً
   لطيفاً (quotaBoost) يظهر له تلقائياً بلوحته + بقسم الاشتراك. */
window.hoAddPlayers = async function (id) {
  const l = allLeagues.find(x => x.id === id);
  if (!l) return;
  const cur = l.limits || {};
  const addStr = prompt('كم لاعباً إضافياً تريد إضافته لحصّة «' + (l.name || id) + '»؟\n\n(الحصّة الحالية: ' + (cur.maxPlayers || 0) + ' لاعب)', '50');
  if (addStr === null) return;
  const add = parseInt(addStr, 10);
  if (!add || add <= 0) { showToast('اكتب رقماً صحيحاً أكبر من صفر', 'error'); return; }
  const newMax = (cur.maxPlayers || 0) + add;
  try {
    await setDoc(doc(db, 'leagues', id), {
      limits: { maxTeams: cur.maxTeams || 0, maxPlayers: newMax, photos: cur.photos !== false },
      quotaAlert: null,
      quotaBoost: { addedPlayers: add, addedAt: Date.now(), seen: false }
    }, { merge: true });
    showToast('✅︎ أُضيفت ' + add + ' مساحة لاعب — الحصّة الآن ' + newMax, 'success');
    leagueActions(id); // إعادة رسم النافذة بالأرقام الجديدة
  } catch (e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

/* ✅︎ حفظ تعديلات سريعة على بيانات البطولة (الاسم/الموسم) من نفس النافذة */
window.saveLeagueQuickEdit = async function (id) {
  const name = (document.getElementById('le-name') || {}).value?.trim();
  const season = (document.getElementById('le-season') || {}).value?.trim();
  if (!name) { showToast('اسم البطولة مطلوب', 'error'); return; }
  try {
    await updateDoc(doc(db, 'leagues', id), { name, season: season || '2025', updatedAt: serverTimestamp() });
    showToast('✅︎ تم حفظ التعديلات', 'success');
    leagueActions(id);
  } catch (e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

window.leagueActions = function(id) {
  const l = allLeagues.find(x => x.id === id);
  if(!l) return;
  const sub = allSubs.find(s => s.leagueId === id);
  const subInfo = sub ? `${durationLabel(sub.startDate, sub.endDate)} · ينتهي ${sub.endDate || '—'}` : 'لا يوجد اشتراك';
  const subColor = sub ? (sub.status === 'active' ? 'var(--green)' : 'var(--red)') : 'var(--orange)';
  const cur = l.limits || {};
  const teamsUsed = l.teamsCount || 0, playersUsed = l.playersCount || 0;
  const teamsPct = cur.maxTeams ? Math.min(100, teamsUsed / cur.maxTeams * 100) : 0;
  const playersPct = cur.maxPlayers ? Math.min(100, playersUsed / cur.maxPlayers * 100) : 0;
  const barColor = p => p >= 100 ? 'var(--red)' : p >= 80 ? 'var(--orange)' : 'var(--green)';
  const adminRec = allAdmins.find(a => a.id === l.ownerUid);
  const hasPass = !!(adminRec && adminRec.initialPassword);

  document.getElementById('mal-title').textContent = '⚙︎️ ' + l.name;
  document.getElementById('mal-body').innerHTML = `
    <div style="display:grid;gap:14px">

      <!-- ── معلومات عامة (قابلة للتعديل) ── -->
      <div style="background:var(--card2);border-radius:12px;padding:14px">
        <div style="font-size:10.5px;font-weight:800;color:var(--gold);margin-bottom:10px">معلومات البطولة</div>
        <div style="display:grid;gap:8px;grid-template-columns:2fr 1fr">
          <div><label style="font-size:9.5px;color:var(--muted2)">اسم البطولة</label>
            <input id="le-name" class="fi" value="${(l.name||'').replace(/"/g,'&quot;')}" style="width:100%;margin-top:3px"/></div>
          <div><label style="font-size:9.5px;color:var(--muted2)">الموسم</label>
            <input id="le-season" class="fi" value="${(l.season||'2025').replace(/"/g,'&quot;')}" style="width:100%;margin-top:3px"/></div>
        </div>
        <button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;margin-top:9px" onclick="saveLeagueQuickEdit('${l.id}')">💾 حفظ التعديلات</button>
        <hr style="border-color:var(--border);margin:12px 0"/>
        <div style="display:grid;gap:6px;font-size:11px;color:var(--muted2);line-height:1.9">
          <div>المعرّف: <strong style="color:var(--text);font-family:monospace">${l.id}</strong></div>
          <div>المالك: <strong style="color:var(--text)">${l.ownerName || '—'}</strong></div>
          <div style="display:flex;align-items:center;gap:6px">البريد: <strong style="color:var(--text)">${l.ownerEmail || '—'}</strong>
            ${l.ownerEmail ? `<button class="ic-btn-mini" onclick="copyStr('${l.ownerEmail}')" title="نسخ">📋</button>` : ''}</div>
          <div style="display:flex;align-items:center;gap:6px">الواتساب: <strong style="color:var(--text)">${l.ownerPhone || '—'}</strong>
            ${l.ownerPhone ? `<button class="ic-btn-mini" onclick="copyStr('${l.ownerPhone}')" title="نسخ">📋</button>` : ''}</div>
          <div>الاشتراك: <strong style="color:${subColor}">${subInfo}</strong></div>
          <div>القفل: <strong style="color:${l.locked ? 'var(--red)' : 'var(--green)'}">${l.locked ? 'مقفولة' : 'مفتوحة'}</strong></div>
        </div>
      </div>

      <!-- ── الحصّة (فرق ولاعبون) ── -->
      <div style="background:var(--card2);border-radius:12px;padding:14px">
        <div style="font-size:10.5px;font-weight:800;color:var(--gold);margin-bottom:10px">حصّة الاشتراك</div>
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
            <span>👥 الفرق</span><span style="font-weight:800">${teamsUsed} / ${cur.maxTeams || '∞'}</span>
          </div>
          <div style="height:7px;border-radius:99px;background:var(--card3);overflow:hidden">
            <div style="height:100%;width:${teamsPct}%;background:${barColor(teamsPct)};border-radius:99px"></div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
            <span>🧍 اللاعبون</span><span style="font-weight:800">${playersUsed} / ${cur.maxPlayers || '∞'}</span>
          </div>
          <div style="height:7px;border-radius:99px;background:var(--card3);overflow:hidden">
            <div style="height:100%;width:${playersPct}%;background:${barColor(playersPct)};border-radius:99px"></div>
          </div>
        </div>
        <button class="btn btn-gold btn-sm" style="width:100%;justify-content:center;margin-top:12px" onclick="hoAddPlayers('${l.id}')">➕ إضافة مساحة لاعبين</button>
      </div>

      <!-- ── وصول سريع ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <button class="btn btn-outline btn-sm" style="justify-content:center;flex-direction:column;gap:4px;padding:10px 4px" onclick="window.open('league-viewer.html?id=${l.id}','_blank')">👁<span style="font-size:9.5px">الجمهور</span></button>
        <button class="btn btn-outline btn-sm" style="justify-content:center;flex-direction:column;gap:4px;padding:10px 4px" onclick="window.open('league-admin.html?id=${l.id}','_blank')">⚙︎️<span style="font-size:9.5px">الإدارة</span></button>
        <button class="btn btn-outline btn-sm" style="justify-content:center;flex-direction:column;gap:4px;padding:10px 4px" onclick="window.open('broadcaster.html?league=${l.id}','_blank')">🎥<span style="font-size:9.5px">البثّ</span></button>
      </div>

      <!-- ── تسليم البطولة ── -->
      <div>
        <div style="font-size:10.5px;font-weight:800;color:var(--gold);margin-bottom:8px">تسليم البطولة للعميل</div>
        <button class="btn btn-gold" style="width:100%;justify-content:center" onclick="hoShareLink('${l.id}')">🔗 نسخ رابط تسليم للمشاركة</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <button class="btn btn-outline btn-sm" style="justify-content:center" onclick="hoOpen('${l.id}')">عرض / PDF</button>
          <button class="btn btn-outline btn-sm" style="justify-content:center" onclick="hoWA('${l.id}')">إرسال واتساب</button>
        </div>
      </div>

      ${hasPass ? '' : `
      <div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.25);border-radius:10px;padding:10px 12px;font-size:10.5px;color:#e0a733;line-height:1.8">
        ⚠️ كلمة المرور الأصلية غير محفوظة (بطولة قديمة) — استخدم أحد الخيارين:
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn btn-outline btn-sm" style="justify-content:center" onclick="sendOwnerPasswordReset('${l.id}')">🔑 رابط تعيين جديدة</button>
        <button class="btn btn-outline btn-sm" style="justify-content:center" onclick="updateStoredPassword('${l.id}')">✏️ تسجيل يدوي</button>
      </div>`}

      <!-- ── منطقة الخطر ── -->
      <div style="border:1px solid var(--red);border-radius:12px;padding:12px">
        <div style="font-size:10.5px;font-weight:800;color:var(--red);margin-bottom:9px">منطقة الخطر</div>
        <div style="display:grid;gap:8px">
          ${l.locked
            ? `<button class="btn btn-green btn-sm" style="width:100%;justify-content:center" onclick="lockLeague('${l.id}',false)">🔓 فتح قفل البطولة</button>`
            : `<button class="btn btn-sm" style="width:100%;justify-content:center;background:var(--orange);color:#fff" onclick="lockLeague('${l.id}',true)">🔒 قفل البطولة (منع التعديل)</button>`
          }
          <button class="btn btn-red btn-sm" style="width:100%;justify-content:center" onclick="deleteLeague('${l.id}')">🗑 حذف البطولة نهائياً</button>
        </div>
      </div>
    </div>`;
  openModal('modal-league-actions');
};

// ══ استعادة كلمة مرور المنظّم (بطولات قديمة بلا كلمة مرور محفوظة) ══
// ✅︎ Firebase Auth لا يخزّن كلمات المرور بشكل قابل للاسترجاع لأي أحد —
//    حتى السوبر أدمن. الخياران الوحيدان الممكنان فعلياً بدون خادم خاص:
//    1) إرسال رابط رسمي من Firebase للمنظّم ليضع كلمة مرور جديدة بنفسه.
//    2) لو أخبرك المنظّم بكلمة مرور جديدة اختارها، سجّلها هنا يدوياً
//       فقط لغرض العرض/الطباعة لاحقاً في صفحة التسليم (هذا لا يغيّر
//       كلمة الدخول الفعلية — فقط يسجّلها للمرجع).
window.sendOwnerPasswordReset = async function(id) {
  const l = allLeagues.find(x => x.id === id);
  if (!l || !l.ownerEmail) { showToast('لا يوجد بريد إلكتروني مسجَّل لهذه البطولة', 'error'); return; }
  if (!confirm('سيصل بريد رسمي من Firebase إلى «' + l.ownerEmail + '» يتيح للمنظّم اختيار كلمة مرور جديدة بنفسه.\n\nمتابعة؟')) return;
  try {
    const { initializeApp: _initApp, deleteApp: _deleteApp } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'
    );
    const { getAuth: _getAuth, sendPasswordResetEmail: _sendReset } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
    );
    // ✅︎ نفس أسلوب app ثانوي معزول المستخدم عند إنشاء البطولات —
    //    يمنع أي تأثير على جلسة السوبر أدمن الحالية.
    const secondaryApp = _initApp(firebaseConfig, 'secondary-reset-' + Date.now());
    const secondaryAuth = _getAuth(secondaryApp);
    try {
      await _sendReset(secondaryAuth, l.ownerEmail);
    } finally {
      await _deleteApp(secondaryApp);
    }
    showToast('✅︎ أُرسل رابط تعيين كلمة المرور إلى ' + l.ownerEmail, 'success');
  } catch (e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

window.updateStoredPassword = async function(id) {
  const l = allLeagues.find(x => x.id === id);
  if (!l || !l.ownerUid) { showToast('تعذّر تحديد حساب المنظّم لهذه البطولة', 'error'); return; }
  const newPass = prompt(
    'اكتب كلمة المرور التي أخبرك بها المنظّم (بعد أن غيّرها بنفسه عبر رابط الاستعادة).\n\n' +
    'تنبيه: هذا الحقل للتسجيل والعرض في صفحة التسليم فقط — لا يغيّر كلمة الدخول الفعلية.'
  );
  if (!newPass) return;
  if (newPass.length < 6) { showToast('كلمة المرور المسجَّلة يجب أن تكون 6 أحرف على الأقل', 'error'); return; }
  try {
    await setDoc(doc(db, 'leagueAdmins', l.ownerUid), { initialPassword: newPass }, { merge: true });
    showToast('✅︎ تم تسجيل كلمة المرور — ستظهر الآن في صفحة التسليم', 'success');
  } catch (e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

window.deleteLeague = async function(id) {
  const lg = allLeagues.find(l => l.id === id);
  const lgName = lg ? lg.name : '';
  const teamsN = lg ? (lg.teamsCount || 0) : 0;
  // تحذير قوي: يتطلب كتابة اسم البطولة للتأكيد (يمنع الحذف بالخطأ)
  const typed = prompt(
    '⚠️ حذف نهائي وخطير!\n\n' +
    'سيتم حذف بطولة «' + lgName + '» بالكامل:\n' +
    '• كل الفرق (' + teamsN + ') والمباريات والنتائج\n' +
    '• الهدّافين والترتيب والبث والاشتراكات\n\n' +
    'لا يمكن التراجع نهائياً عن هذا الإجراء.\n\n' +
    'للتأكيد، اكتب اسم البطولة بالضبط:\n«' + lgName + '»'
  );
  if (typed == null) return;                       // ألغى
  if (typed.trim() !== lgName.trim()) {
    showToast('الاسم غير مطابق — أُلغي الحذف حفاظاً على البيانات', 'error');
    return;
  }
  try {
    showToast('جاري حذف البطولة وبياناتها...', 'info');
    // حذف sub-collections أولاً
    for (const sub of ['teams','matches','scorers']) {
      const snap = await getDocs(collection(db, 'leagues', id, sub));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }

    // حذف live match doc (doc: leagues/{leagueId}/live/match)
    await deleteDoc(doc(db, 'leagues', id, 'live', 'match')).catch(() => {});

    // حذف الاشتراكات المرتبطة
    const subsDel = allSubs.filter(s => s.leagueId === id);
    await Promise.all(subsDel.map(s => deleteDoc(doc(db, 'subscriptions', s.id))));

    // أخيراً حذف البطولة نفسها
    await deleteDoc(doc(db, 'leagues', id));
    closeModal('modal-league-actions');
    showToast('تم حذف البطولة وجميع بياناتها 🗑', 'success');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

// ══ RENDER ACTIVE QUICK ══
function renderActiveQuick() {
  const el = document.getElementById('activeLeaguesQuick');
  const active = allLeagues.filter(l => l.status === 'active').slice(0, 4);
  if(active.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">لا توجد دوريات نشطة حالياً</div>';
    return;
  }
  el.innerHTML = active.map(l => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:22px">${l.icon || '🏆'}</span>
        <div>
          <div style="font-size:13px;font-weight:700">${l.name}</div>
          <div style="font-size:10px;color:var(--muted)">${typeLabel(l.type)} · ${l.teamsCount || 0} فريق</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-outline btn-xs" onclick="window.open('league-admin.html?id=${l.id}','_blank')">إدارة ↗︎</button>
      </div>
    </div>
  `).join('');
}

// ══ RENDER EXPIRING ══
function renderExpiringOverview() {
  const el = document.getElementById('expiringSubsOverview');
  const soon = allSubs.filter(s => {
    if(!s.endDate) return false;
    const diff = (subEndLocal(s.endDate) - new Date()) / (1000*60*60*24);
    return diff > 0 && diff <= 14;
  });
  if(soon.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--green);font-size:12px">✅︎ لا توجد اشتراكات تنتهي قريباً</div>';
    return;
  }
  el.innerHTML = soon.map(s => {
    const diff = Math.ceil((subEndLocal(s.endDate) - new Date()) / (1000*60*60*24));
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:700">${s.leagueName || s.leagueId}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${s.ownerName || '—'}</div>
      </div>
      <div style="text-align:left">
        <div class="exp-soon">⏰ ينتهي بعد ${diff} يوم</div>
        <button class="btn btn-gold btn-xs" style="margin-top:5px" onclick="renewSub('${s.id}')">تجديد</button>
      </div>
    </div>`;
  }).join('');
}

// ══ RENDER SUBS ══
function renderSubs() {
  const tbody = document.getElementById('subsTable');
  if (!tbody) return;
  // ✅︎ المصدر الوحيد للحالة: subStatus() — كانت مكررة بمنطق مختلف
  const META = {
    active:    ['exp-ok',      'نشط'],
    soon:      ['exp-soon',    'تنتهي قريباً'],
    expired:   ['exp-expired', 'منتهي'],
    cancelled: ['exp-expired', 'ملغى'],
  };
  if (!allSubs.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا توجد اشتراكات بعد</td></tr>';
    return;
  }
  // رتّب: المنتهية قريباً أولاً (الأهم للسوبر أدمن)
  const order = { soon: 0, expired: 1, active: 2, cancelled: 3 };
  const rows = [...allSubs].sort((a, b) => {
    const d = order[subStatus(a)] - order[subStatus(b)];
    if (d) return d;
    return String(a.endDate || '').localeCompare(String(b.endDate || ''));
  });

  tbody.innerHTML = rows.map(s => {
    const st = subStatus(s);
    const [cls, lbl] = META[st] || META.active;
    const end = subEndLocal(s.endDate);
    const days = end ? Math.ceil((end - new Date()) / 86400000) : null;
    const text = st === 'soon' ? `${days} يوم` : lbl;
    const isDone = st === 'cancelled';
    return `<tr>
      <td data-label="البطولة" style="font-weight:700">${s.leagueName || s.leagueId || '—'}</td>
      <td data-label="المالك" style="color:var(--muted2)">${s.ownerName || '—'}</td>
      <td data-label="المدة" style="color:var(--muted2);font-size:10px">${durationLabel(s.startDate, s.endDate)}</td>
      <td data-label="ينتهي"><span class="${cls}">${s.endDate || '—'}</span></td>
      <td data-label="الحالة"><span style="font-size:10px" class="${cls}">${text}</span></td>
      <td class="sa-td-actions"><div style="display:flex;gap:5px">
        <button class="btn btn-gold btn-xs" onclick="renewSub('${s.id}')">تجديد</button>
        <button class="btn btn-red btn-xs" onclick="cancelSub('${s.id}')" ${isDone ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>إلغاء</button>
      </div></td>
    </tr>`;
  }).join('');
}

function durationLabel(startDate, endDate) {
  if(!startDate || !endDate) return '—';
  const months = Math.round((new Date(endDate) - new Date(startDate)) / (1000*60*60*24*30));
  if(months >= 12 && months % 12 === 0) return (months/12) + (months === 12 ? ' سنة' : ' سنوات');
  return months + (months === 1 ? ' شهر' : ' أشهر');
}

window.renewSub = function(id) {
  const s = allSubs.find(x => x.id === id);
  if(!s) return;
  _renewingSubId = id;
  const lbl = document.getElementById('renew_leagueLabel');
  if(lbl) lbl.textContent = `${s.leagueName || s.leagueId || '—'} · ${s.ownerName || '—'}`;
  // نبدأ التجديد من تاريخ انتهاء الاشتراك الحالي إن كان بالمستقبل، وإلا من اليوم
  const now = new Date();
  const currentEnd = s.endDate ? new Date(s.endDate) : now;
  const startFrom = currentEnd > now ? currentEnd : now;
  const startISO = startFrom.toISOString().split('T')[0];
  const startInput = document.getElementById('renew_start');
  if(startInput) startInput.value = startISO;
  durationCustom.renew = false;
  durationState.renew = 1;
  document.querySelectorAll('#renew_durations .dur-card').forEach((c, i) => c.classList.toggle('selected', i === 0));
  recalcDuration('renew');
  openModal('modal-renew-sub');
};

window.confirmRenewSub = async function() {
  if(!_renewingSubId) return;
  const newEnd = document.getElementById('renew_end')?.value;
  if(!newEnd) { showToast('حدد تاريخ الانتهاء الجديد', 'error'); return; }
  try {
    const _renewSub = allSubs.find(x => x.id === _renewingSubId);
    await updateDoc(doc(db, 'subscriptions', _renewingSubId), {
      endDate: newEnd,
      status: 'active',
      updatedAt: serverTimestamp()
    });
    /* ✅ الأهم: إعادة تفعيل البطولة نفسها.
       كان التجديد يُفعّل الاشتراك فقط بينما تبقى البطولة موقوفة
       (suspended) من الإيقاف التلقائي — فيظل الجمهور والأدمن مقفلين
       رغم التجديد. */
    if (_renewSub && _renewSub.leagueId) {
      await updateDoc(doc(db, 'leagues', _renewSub.leagueId), {
        status: 'active', locked: false, updatedAt: serverTimestamp()
      });
    }
    closeModal('modal-renew-sub');
    showToast('تم تجديد الاشتراك وإعادة تفعيل البطولة ✓', 'success');
    _renewingSubId = null;
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

window.cancelSub = async function(id) {
  if(!confirm('هل تريد إلغاء هذا الاشتراك؟')) return;
  try {
    await updateDoc(doc(db, 'subscriptions', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    showToast('تم إلغاء الاشتراك', 'success');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

// ══ فحص الاشتراكات المنتهية تلقائياً ══
async function autoCheckExpiredSubs() {
  /* ✅ تاريخ اليوم بالتوقيت المحلي (لا UTC) — كان الاشتراك يُنهى قبل
     يومه الأخير في المناطق ذات الإزاحة الموجبة. والمقارنة بـ «<» تعني
     أن يوم الانتهاء نفسه يبقى نشطاً كاملاً. */
  const d = new Date();
  const now = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  allSubs.forEach(async (s) => {
    if(s.status !== 'active') return;
    if(s.endDate && s.endDate < now) {
      try {
        // تحديث حالة الاشتراك
        await updateDoc(doc(db, 'subscriptions', s.id), { status: 'expired', updatedAt: serverTimestamp() });
        /* ✅ انتهاء الاشتراك يقفل لوحة الإدارة فقط (locked) — ولا يوقف
           البطولة (suspended) حتى تبقى صفحة الجمهور تعمل للمتابعين.
           الإيقاف الكامل يبقى قراراً يدوياً للمسؤول. */
        if(s.leagueId) {
          await updateDoc(doc(db, 'leagues', s.leagueId), { locked: true, updatedAt: serverTimestamp() });
        }
        showToast(`⏰ انتهى اشتراك ${s.leagueName || s.leagueId} — قُفلت الإدارة وبقيت صفحة الجمهور`, 'error');
      } catch(e) { }
    }
  });
}

/* ✅ إصلاح تلقائي: بطولة موقوفة/مقفلة رغم أن اشتراكها ساري تُستعاد.
   يعالج البطولات التي أوقفها النظام سابقاً ولم تُستعد بعد التجديد. */
async function autoRestoreActiveSubs() {
  const nowTs = Date.now();
  for (const s of (allSubs || [])) {
    if (s.status !== 'active' || !s.leagueId) continue;
    const end = subEndLocal(s.endDate);
    /* ✅ منع التذبذب: لا نستعيد إلا إذا بقي يوم كامل على الأقل.
       بلا هذا الهامش قد يقفل autoCheckExpiredSubs ويفتح هذا في نفس
       الدقيقة فيتصارعان (يوقف ويرجع ويوقف). */
    if (!end || (end.getTime() - nowTs) < 24 * 60 * 60 * 1000) continue;
    try {
      const lref = doc(db, 'leagues', s.leagueId);
      const lsnap = await getDoc(lref);
      if (!lsnap.exists()) continue;
      const ld = lsnap.data();
      if (ld.status === 'suspended' || ld.locked) {
        await updateDoc(lref, { status: 'active', locked: false, updatedAt: serverTimestamp() });
        showToast(`✓ أُعيد تفعيل ${s.leagueName || s.leagueId} (اشتراكه ساري)`, 'success');
      }
    } catch (e) { /* تجاهل */ }
  }
}
setTimeout(autoRestoreActiveSubs, 5000);

// تشغيل الفحص كل ساعة
setInterval(autoCheckExpiredSubs, 3600000);
// وعند أول تحميل
setTimeout(autoCheckExpiredSubs, 3000);

// ══ RENDER USERS ══
function renderUsers(users) {
  const tbody = document.getElementById('usersTable');
  if(users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">لا يوجد مستخدمون بعد</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const sub = allSubs.find(s => s.leagueId === u.leagueId);
    const st = sub ? subStatus(sub) : 'expired';
    const subMap = { active: ['plan-active', '🟢 ' + (sub?.endDate || '')], soon: ['plan-soon', '⚠ ' + (sub?.endDate || '')], expired: ['plan-expired', '🔴 لا يوجد'], cancelled: ['plan-cancelled', '⚫ ملغى'] };
    const [subClass, subText] = subMap[st] || subMap.expired;
    return `
    <tr>
      <td data-label="الاسم" style="font-weight:700">${u.ownerName || '—'}</td>
      <td data-label="البريد" style="color:var(--muted2);font-family:monospace;font-size:10px">${u.email || '—'}</td>
      <td data-label="البطولة" style="color:var(--muted2)">${u.leagueName || u.leagueId || '—'}</td>
      <td data-label="الاشتراك"><span class="plan-badge ${subClass}">${subText}</span></td>
      <td data-label="الحالة"><span style="font-size:9px;padding:2px 8px;border-radius:10px;background:${u.active !== false ? 'var(--green2)' : 'var(--red2)'};color:${u.active !== false ? 'var(--green)' : 'var(--red)'};border:1px solid ${u.active !== false ? 'var(--green)' : 'var(--red)'}">${u.active !== false ? '🟢 نشط' : '⚫ موقوف'}</span></td>
      <td class="sa-td-actions"><div style="display:flex;gap:5px">
        <button class="btn btn-red btn-xs" onclick="deleteUser('${u.id}')">حذف</button>
      </div></td>
    </tr>
  `;
  }).join('');
}

window.deleteUser = async function(id) {
  if(!confirm('هل تريد حذف هذا المستخدم؟')) return;
  try {
    await deleteDoc(doc(db, 'leagueAdmins', id));
    showToast('تم حذف المستخدم', 'error');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

// ══ ANALYTICS ══
function renderAnalytics() {
  const types = { league: 0, groups: 0, knockout: 0 };
  const subStatuses = { active: 0, soon: 0, expired: 0 };
  let totalTeams = 0, totalMatches = 0;

  allLeagues.forEach(l => {
    if(types[l.type] !== undefined) types[l.type]++;
    totalTeams += l.teamsCount || 0;
    totalMatches += l.matchesCount || 0;
  });

  allSubs.forEach(s => {
    const st = subStatus(s);
    if(subStatuses[st] !== undefined) subStatuses[st]++;
  });

  const maxT = Math.max(...Object.values(types), 1);
  document.getElementById('typeChart').innerHTML = [
    { label: 'دوري نقاط', val: types.league, color: 'var(--gold)' },
    { label: 'مجموعات', val: types.groups, color: 'var(--blue)' },
    { label: 'خروج مغلوب', val: types.knockout, color: 'var(--red)' },
  ].map(item => `
    <div class="bar-row">
      <div class="bar-label">${item.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.val/maxT*100).toFixed(0)}%;background:${item.color}"></div></div>
      <div class="bar-val">${item.val}</div>
    </div>`).join('');

  const maxP = Math.max(...Object.values(subStatuses), 1);
  document.getElementById('planChart').innerHTML = [
    { label: '🟢 نشط', val: subStatuses.active, color: 'var(--green)' },
    { label: '⚠ تنتهي قريباً', val: subStatuses.soon, color: 'var(--orange)' },
    { label: '🔴 منتهي', val: subStatuses.expired, color: 'var(--red)' },
  ].map(item => `
    <div class="bar-row">
      <div class="bar-label">${item.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.val/maxP*100).toFixed(0)}%;background:${item.color}"></div></div>
      <div class="bar-val">${item.val}</div>
    </div>`).join('');

  document.getElementById('totalTeams').textContent = totalTeams;
  document.getElementById('totalMatches').textContent = totalMatches;
  document.getElementById('totalGoals').textContent = allLeagues.reduce((s, l) => s + (l.totalGoals || 0), 0);
}

// ══ CREATE LEAGUE ══
window.updateLinks = function() {
  const slug = (document.getElementById('nl_slug')?.value || '').trim().toLowerCase().replace(/\s+/g, '-');
  const s = slug || 'league-id';
  document.getElementById('nl_slug_preview').textContent = s;
  document.getElementById('nl_slug_preview2').textContent = s;
};

window.createLeague = async function() {
  const name       = document.getElementById('nl_name')?.value.trim()   || '';
  const slug       = document.getElementById('nl_slug')?.value.trim().toLowerCase() || '';
  const ownerName  = document.getElementById('nl_owner')?.value.trim()  || '';
  const ownerEmail = document.getElementById('nl_email')?.value.trim()  || '';
  const ownerPass  = document.getElementById('nl_pass')?.value          || '';
  const phone      = document.getElementById('nl_phone')?.value.trim()  || '';
  // ✅︎ نوع البطولة لا يُحدَّد هنا — صاحب الدوري يختاره من المعالج عند أول دخول ويُقفل هناك
  const season     = document.getElementById('nl_season')?.value        || '2025';
  const startDate  = document.getElementById('nl_start')?.value         || '';
  const endDate    = document.getElementById('nl_end')?.value           || '';

  if(!name || !slug || !ownerName || !ownerEmail || !ownerPass) {
    showToast('أكمل جميع الحقول المطلوبة *', 'error'); return;
  }
  if(ownerPass.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error'); return; }

  // 🛡️ منع تكرار المعرّف (slug) — وإلا setDoc يدهس بطولة موجودة
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    showToast('المعرّف يجب أن يكون حروفاً إنجليزية صغيرة وأرقاماً وشرطات فقط (2-40)', 'error');
    return;
  }
  try {
    const existing = await getDoc(doc(db, 'leagues', slug));
    if (existing.exists()) {
      showToast('المعرّف «' + slug + '» مستخدم بالفعل — اختر معرّفاً آخر', 'error');
      return;
    }
  } catch (e) { /* لو فشل الفحص نكمل — القاعدة ستمنع لاحقاً */ }

  const btn = document.getElementById('createBtn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الإنشاء...';

  try {
    // ══════════════════════════════════════════════════════════════
    // 🔧 FIX: إنشاء حساب صاحب الدوري عبر Secondary App
    // المشكلة القديمة: createUserWithEmailAndPassword على auth الرئيسي
    // كان يُبدّل جلسة Super Admin تلقائياً للمستخدم الجديد.
    // الحل: نُنشئ Firebase app ثانوي مؤقت لإنشاء المستخدم بشكل معزول
    // دون المساس بجلسة Super Admin الحالية.
    // ══════════════════════════════════════════════════════════════
    const { initializeApp: _initApp, deleteApp: _deleteApp } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'
    );
    const { getAuth: _getAuth, createUserWithEmailAndPassword: _createUser } = await import(
      'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
    );

    const secondaryApp = _initApp(firebaseConfig, 'secondary-' + Date.now());
    const secondaryAuth = _getAuth(secondaryApp);

    let uid;
    try {
      const userCred = await _createUser(secondaryAuth, ownerEmail, ownerPass);
      uid = userCred.user.uid;
    } finally {
      // نحذف الـ app الثانوي فوراً بعد إنشاء المستخدم
      await _deleteApp(secondaryApp);
    }
    // ══ جلسة Super Admin لم تتغير ✅︎ ══

    // 2) Save league document
    // ✅︎ FIX: نُزيل أي حقل undefined قبل الإرسال لـ Firestore
    const leagueData = {
      id:           slug,
      name,
      icon:         '🏆',
      type:         'league',
      typeLocked:   false,
      season:       season || '2025',
      ownerName:    ownerName || '',
      ownerEmail:   ownerEmail || '',
      ownerPhone:   phone || '',
      ownerUid:     uid,
      status:       'active',
      teamsCount:   0,
      matchesCount: 0,
      totalGoals:   0,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
    };
    await setDoc(doc(db, 'leagues', slug), leagueData);

    // 3) Save league admin profile
    // ✅︎ نحفظ كلمة المرور هنا (مرة واحدة عند الإنشاء) لأن Firebase Auth لا
    //    يخزّنها بشكل قابل للاسترجاع لاحقاً — بدون هذا الحفظ ستختفي كلمة
    //    المرور للأبد بعد إغلاق هذه النافذة، ولن يقدر أحد رؤيتها مرة أخرى
    //    (حتى صفحة التسليم نفسها)، وهذا بالضبط سبب اختفائها في البطولات القديمة.
    await setDoc(doc(db, 'leagueAdmins', uid), {
      ownerName,
      email: ownerEmail,
      phone,
      leagueId: slug,
      leagueName: name,
      active: true,
      initialPassword: ownerPass,
      createdAt: serverTimestamp(),
    });

    // 4) Save subscription
    await addDoc(collection(db, 'subscriptions'), {
      leagueId: slug,
      leagueName: name,
      ownerName,
      ownerEmail,
      status: 'active',
      startDate: startDate || todayISO(),
      endDate: endDate || addMonthsISO(startDate || todayISO(), 1),
      createdAt: serverTimestamp(),
    });

    showToast('✅︎ تم إنشاء البطولة بنجاح! الروابط جاهزة', 'success');
    _showNewLeagueLinks(slug, name);
    setTimeout(() => { btn.disabled = false; btn.textContent = '🚀 إنشاء البطولة وتفعيلها'; }, 1500);
  } catch(e) {
    showToast('خطأ: ' + window._trErr(e), 'error');
    btn.disabled = false;
    btn.textContent = '🚀 إنشاء البطولة وتفعيلها';
  }
};

// نافذة الروابط الثلاثة فور إنشاء البطولة
window._showNewLeagueLinks = function(slug, name){
  const V = SITE_URL + 'league-viewer.html?id=' + slug;
  const A = SITE_URL + 'league-admin.html?id=' + slug;
  const B = SITE_URL + 'broadcaster.html?league=' + slug;
  const linkRow = (label, url, color) =>
    `<div style="background:var(--card,#1a1a2e);border:1px solid var(--border,#2a2a3e);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:800;color:${color};margin-bottom:4px">${label}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <input readonly value="${url}" onclick="this.select()" style="flex:1;background:transparent;border:none;color:var(--muted,#9aa);font-size:11px;font-family:monospace;direction:ltr;text-align:left;outline:none">
        <button onclick="navigator.clipboard.writeText('${url}');this.textContent='تم';setTimeout(()=>this.textContent='نسخ',1200)" style="background:${color};color:#fff;border:none;border-radius:7px;padding:6px 12px;font-weight:800;font-family:inherit;cursor:pointer;font-size:12px">نسخ</button>
      </div>
    </div>`;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML =
    `<div style="background:var(--bg,#12121e);border:1px solid var(--border,#2a2a3e);border-radius:18px;padding:20px;max-width:440px;width:100%;font-family:Tajawal,sans-serif">
      <div style="text-align:center;margin-bottom:8px;display:flex;justify-content:center"><svg viewBox="0 0 24 24" fill="none" stroke="#C9A02B" stroke-width="1.6" width="34" height="34"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>
      <h3 style="text-align:center;color:var(--text,#fff);margin:0 0 4px;font-size:18px">تم إنشاء «${name}»</h3>
      <p style="text-align:center;color:var(--muted,#9aa);font-size:12.5px;margin:0 0 16px">الروابط الثلاثة جاهزة للمشاركة</p>
      ${linkRow('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> صفحة الجمهور', V, '#22c55e')}
      ${linkRow('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> لوحة الإدارة', A, '#3b82f6')}
      ${linkRow('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" style="vertical-align:-2px"><path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z"/></svg> استوديو البثّ', B, '#C9A02B')}
      <button onclick="sendWALeague('${name.replace(/'/g,'')}','${slug}','')" style="width:100%;background:#25d366;color:#fff;border:none;border-radius:10px;padding:12px;font-weight:800;font-family:inherit;cursor:pointer;margin-top:6px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2a10 10 0 00-8.5 15.3L2 22l4.8-1.5A10 10 0 1012 2zm0 18a8 8 0 01-4.1-1.1l-.3-.2-2.8.9.9-2.8-.2-.3A8 8 0 1112 20z"/></svg>إرسال الروابط واتساب</button>
      <button onclick="this.closest('div[style*=fixed]').remove();showPage('leagues',null)" style="width:100%;background:var(--card,#1a1a2e);color:var(--text,#fff);border:1px solid var(--border,#2a2a3e);border-radius:10px;padding:11px;font-weight:800;font-family:inherit;cursor:pointer">تم — عرض كل البطولات</button>
    </div>`;
  ov.onclick = e => { if(e.target===ov){ ov.remove(); showPage('leagues',null); } };
  document.body.appendChild(ov);
};

window.createSubscription = async function() {
  const owner = document.getElementById('sub_owner')?.value.trim();
  const email = document.getElementById('sub_email')?.value.trim();
  const leagueId = document.getElementById('sub_league')?.value;
  const startDate = document.getElementById('sub_start')?.value || todayISO();
  const endDate = document.getElementById('sub_end')?.value || addMonthsISO(startDate, 1);

  if(!owner || !email || !leagueId) { showToast('أكمل الحقول المطلوبة', 'error'); return; }

  const league = allLeagues.find(l => l.id === leagueId);
  try {
    await addDoc(collection(db, 'subscriptions'), {
      leagueId, leagueName: league?.name || leagueId,
      ownerName: owner, ownerEmail: email,
      status: 'active', startDate, endDate,
      createdAt: serverTimestamp(),
    });
    closeModal('modal-new-sub');
    showToast('تم إنشاء الاشتراك ✓', 'success');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

// ══ PLATFORM SETTINGS ══
window.savePlatformSettings = async function() {
  const settings = {
    platformName: document.getElementById('platformName')?.value,
    signature: document.getElementById('platformSig')?.value,
    welcome: document.getElementById('platformWelcome')?.value,
    hlsServer: (document.getElementById('platformHlsServer')?.value || '').trim(),
    hlsCdn: (document.getElementById('platformHlsCdn')?.value || '').trim(),
    updatedAt: serverTimestamp(),
  };
  document.querySelectorAll('.toggle-row[data-key]').forEach(row => {
    settings[row.dataset.key] = row.querySelector('.tg-sw').classList.contains('on');
  });
  try {
    await setDoc(doc(db, 'settings', 'platform'), settings, { merge: true });
    showToast('تم حفظ الإعدادات ✓', 'success');
  } catch(e) { showToast('خطأ: ' + window._trErr(e), 'error'); }
};

// ══ CHANGE PASSWORD ══
window.changePassword = async function() {
  const p1 = document.getElementById('newPass1')?.value;
  const p2 = document.getElementById('newPass2')?.value;
  if(!p1 || p1 !== p2) { showToast('كلمتا المرور غير متطابقتين', 'error'); return; }
  if(p1.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error'); return; }
  try {
    await updatePassword(auth.currentUser, p1);
    showToast('تم تغيير كلمة المرور ✓', 'success');
    document.getElementById('newPass1').value = '';
    document.getElementById('newPass2').value = '';
  } catch(e) { showToast('خطأ: قد تحتاج لإعادة تسجيل الدخول', 'error'); }
};

// ══ HELPERS ══
function statusBadge(s) {
  const map = {
    active: '<span class="lc-status s-active">🟢 نشط</span>',
    draft: '<span class="lc-status s-draft">⚪ مسودة</span>',
    archived: '<span class="lc-status s-archived">🏁 أرشيف</span>',
    suspended: '<span class="lc-status s-suspended">🔴 موقوف</span>',
  };
  return map[s] || '';
}
function typeLabel(t) { return { league: 'دوري نقاط', groups: 'مجموعات', knockout: 'خروج مغلوب' }[t] || 'دوري'; }

window.sendViaWA = function() {
  const slug = document.getElementById('nl_slug')?.value || 'league';
  const name = document.getElementById('nl_name')?.value || 'البطولة';
  const email = document.getElementById('nl_email')?.value || '';
  const pass = document.getElementById('nl_pass')?.value || '';
  const viewerUrl = SITE_URL + 'league-viewer.html?id=' + slug;
  const adminUrl = SITE_URL + 'league-admin.html?id=' + slug;
  const broadcastUrl = SITE_URL + 'broadcaster.html?league=' + slug;
  const txt = encodeURIComponent(`🏆 ${name}\n\n🌐 رابط الجمهور:\n${viewerUrl}\n\n⚙︎️ لوحة الإدارة:\n${adminUrl}\n\n🎥 استوديو البثّ:\n${broadcastUrl}\n\n📧 البريد: ${email}\n🔑 كلمة المرور: ${pass}`);
  window.open('https://wa.me/?text=' + txt, '_blank');
};


/* ✅︎ جسر التسليم — يمرّر بيانات البطولة الحقيقية من leagues[] */
function _hoData(id) {
  const l = allLeagues.find(x => x.id === id) || {};
  // ✅︎ نجيب كلمة المرور المحفوظة وقت إنشاء البطولة (leagueAdmins/{uid}.initialPassword).
  //    للبطولات القديمة التي أُنشئت قبل هذا الحقل، ستبقى فارغة لأن Firebase Auth
  //    لا يخزّن كلمات المرور بشكل قابل للاسترجاع — لا توجد طريقة لاستعادتها،
  //    والحل الوحيد لها هو تعيين كلمة مرور جديدة (زر «تعيين كلمة مرور جديدة»).
  const adminRec = allAdmins.find(a => a.id === l.ownerUid) || {};
  return {
    id: id, name: l.name || 'البطولة', owner: l.ownerName || '',
    phone: l.ownerPhone || '', email: l.ownerEmail || '',
    season: l.season || '2025', type: l.type || 'league', logo: l.logo || '',
    pass: adminRec.initialPassword || ''
  };
}
window.hoOpen = (id) => window.openHandover(_hoData(id));
window.hoWA   = (id) => window.sendHandoverWA(_hoData(id));

/* ✅︎ رابط تسليم قابل للمشاركة — بديل الـ PDF الوحيد المتاح سابقاً.
   يولّد رمزاً عشوائياً طويلاً غير قابل للتخمين، يحفظ نسخة من بيانات
   التسليم تحته بقاعدة البيانات (handoverLinks/{token})، ويعطيك رابط
   ثابت (handover-view.html?t=…) تقدر ترسله للعميل مباشرة — يفتح له
   نفس صفحة التسليم الأنيقة بأزرار حقيقية تعمل، بدل صورة PDF ثابتة. */
/* ═══════════════════════════════════════════════════════════════════
 *  🔧 تشخيص صلاحية السوبر أدمن — أُضيف (v338.3)
 *  ─────────────────────────────────────────────────────────────────
 *  بلاغ: «نسخ رابط صفحة التسليم» يرجع خطأ صلاحية.
 *  قاعدة handoverLinks تسمح بالإنشاء لـ isSuperAdmin() فقط، وهي في
 *  القواعد الجديدة تعني: وجود مستند admins/{uid} بحقل role='superadmin'.
 *
 *  المشكلة أن رسالة permission-denied عامة، فلا يعرف المنظّم أيّ سبب:
 *    (أ) مستند admins/{uid} غير موجود أصلاً — وهو الأرجح.
 *    (ب) موجود لكن حقل role ليس 'superadmin' (خطأ إملائي أو نوع خاطئ).
 *    (ج) القواعد القديمة ما زالت منشورة، وفيها isSuperAdmin تعني
 *        «مسجّل دخول وليس له سجلّ leagueAdmins» — فإن كان حساب السوبر
 *        أدمن نفسه مالكاً لبطولة (له سجلّ في leagueAdmins) سقطت صلاحيته.
 *
 *  هذا الفحص المسبق يقرأ admins/{uid} قبل الكتابة ويقول للمستخدم
 *  بالضبط ماذا ينقصه وأين ينشئه — بدل «خطأ» مبهم.
 *  (القراءة مسموحة لصاحب السجلّ نفسه، فلا تُضيف أي كشف بيانات.)
 * ═══════════════════════════════════════════════════════════════════ */
async function _assertSuperAdmin() {
  const u = auth.currentUser;
  if (!u) return 'انتهت جلستك — سجّل الدخول من جديد';
  try {
    const snap = await getDoc(doc(db, 'admins', u.uid));
    if (!snap.exists()) {
      return 'صلاحية السوبر أدمن غير مفعّلة لهذا الحساب.\n\n'
           + 'افتح Firebase Console ← Firestore Database ← أنشئ مجموعة «admins» '
           + 'ومستنداً معرّفه:\n' + u.uid
           + '\nوبداخله حقل نصّي role = superadmin';
    }
    if (snap.data().role !== 'superadmin') {
      return 'مستند admins موجود لكن قيمة الحقل role ليست «superadmin».\n\n'
           + 'القيمة الحالية: ' + JSON.stringify(snap.data().role)
           + '\nصحّحها في Firebase Console (نصّ، حروف صغيرة، بلا مسافات).';
    }
    return null;   // الصلاحية سليمة
  } catch (e) {
    /* تعذّرت القراءة: غالباً قواعد قديمة لا تعرف مجموعة admins. */
    return 'تعذّر التحقّق من صلاحيتك. الأرجح أن قواعد Firestore الجديدة '
         + 'لم تُنشر بعد — انشر ملف firestore.rules ثم أعد المحاولة.';
  }
}

window.hoShareLink = async function (id) {
  try {
    const why = await _assertSuperAdmin();
    if (why) { alert('⚠️ تعذّر إنشاء رابط التسليم\n\n' + why); return; }
    const d = _hoData(id);
    const token = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)))
      .replace(/-/g, '');
    const payload = {
      name: d.name, owner: d.owner, phone: d.phone, email: d.email,
      pass: d.pass, season: d.season, logo: d.logo,
      viewerUrl: SITE_URL + 'league-viewer.html?id=' + id,
      adminUrl:  SITE_URL + 'league-admin.html?id='  + id,
      broadcastUrl: SITE_URL + 'broadcaster.html?league=' + id,
      leagueId: id,
      createdAt: serverTimestamp(),
      /* ⏳ انتهاء صلاحية — أُضيف (v338.3)
         handoverLinks قاعدته `allow get: if true` (لا بدّ من ذلك: العميل
         يفتح الرابط بلا حساب)، والمستند يحوي كلمة مرور الإدارة. فإن
         أُعيد توجيه الرابط في مجموعة واتساب بقيت مكشوفة **للأبد**.
         الآن ينتهي بعد ١٤ يوماً — مدّة كافية لتسليم العميل، ثم يصير
         الرابط بلا قيمة. صفحة handover-view تفحص هذا الحقل وترفض
         عرض البيانات بعده. */
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000
    };
    await setDoc(doc(db, 'handoverLinks', token), payload);
    const link = SITE_URL + 'handover-view.html?t=' + token;
    /* 🔴 كان: await navigator.clipboard.writeText(link)
       ─────────────────────────────────────────────────────────────
       واجهة الحافظة تشترط **إذن نابع من نقرة المستخدم**، والنقرة هنا
       استُهلكت في `await setDoc` قبلها. فيرفض المتصفح — سفاري و iOS
       والمتصفحات المضمّنة داخل واتساب بالذات — ويرمي NotAllowedError،
       وتظهر رسالة «غير مدعوم». كما أن navigator.clipboard غير موجود
       أصلاً خارج سياق آمن (HTTP أو معاينة محلية).

       البديل: نافذة مشاركة تعرض الرابط جاهزاً — نسخ بنقرة مباشرة
       (فالإذن حاضر)، أو واتساب، أو مشاركة النظام. ولا تعتمد على أي
       واجهة قد تغيب: تسقط إلى execCommand ثم إلى التحديد اليدوي. */
    _showShareSheet({
      title: 'رابط صفحة التسليم',
      sub: 'أرسله للعميل — ينتهي تلقائياً بعد ١٤ يوماً',
      link: link,
      wa: 'رابط تسليم بطولتك:\n' + link
    });
  } catch (e) {
    if (e && e.code === 'permission-denied') {
      alert('🚫 رفضت قواعد Firestore إنشاء رابط التسليم.\n\n'
          + 'تأكّد أن ملف firestore.rules المُحدَّث منشور، وأن مستند '
          + 'admins/' + (auth.currentUser ? auth.currentUser.uid : '{uid}')
          + ' يحمل role = superadmin.');
    } else {
      showToast('خطأ: ' + window._trErr(e), 'error');
    }
    console.error('[hoShareLink]', e);
  }
};

window.sendWALeague = function(name, id, phone) {
  const viewerUrl = SITE_URL + 'league-viewer.html?id=' + id;
  const adminUrl = SITE_URL + 'league-admin.html?id=' + id;
  const broadcastUrl = SITE_URL + 'broadcaster.html?league=' + id;
  const txt = encodeURIComponent(`🏆 ${name}\n\n🌐 رابط الجمهور:\n${viewerUrl}\n\n⚙︎️ لوحة الإدارة:\n${adminUrl}\n\n🎥 استوديو البثّ:\n${broadcastUrl}`);
  const url = phone ? `https://wa.me/${phone}?text=${txt}` : `https://wa.me/?text=${txt}`;
  window.open(url, '_blank');
};

window.copyText = function(id) {
  const el = document.getElementById(id);
  if(!el) return;
  const txt = el.textContent.trim();
  if(navigator.clipboard) {
    navigator.clipboard.writeText(txt).then(() => showToast('تم النسخ 📋', 'success')).catch(() => prompt('انسخ:', txt));
  } else { prompt('انسخ:', txt); }
};

window.copyStr = function(str) {
  if(navigator.clipboard) {
    navigator.clipboard.writeText(str).then(() => showToast('تم النسخ 📋', 'success')).catch(() => prompt('انسخ:', str));
  } else { prompt('انسخ:', str); }
};

// ══ NAVIGATION ══
window.showPage = function(name, sb, mn) {
  /* حمّل التسعير عند فتح قسمه فقط — لا نُحمّله مع كل صفحة بلا داعٍ */
  try { if (arguments[0] === 'pricing' && typeof window.loadPricingAdmin === 'function') window.loadPricingAdmin(); } catch (e) {}

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('page-' + name);
  if(el) el.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.mn-item').forEach(i => i.classList.remove('active'));
  if(sb) sb.classList.add('active');
  if(mn) mn.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i => {
    if((i.getAttribute('onclick') || '').includes("'" + name + "'")) i.classList.add('active');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if(name === 'platform') _loadPlatformSettings();
};

// تحميل إعدادات المنصة المركزية لملء الحقول
window._loadPlatformSettings = async function(){
  try{
    const snap = await getDoc(doc(db,'settings','platform'));
    if(!snap.exists()) return;
    const s = snap.data();
    const set = (id,v)=>{ const el=document.getElementById(id); if(el && v!=null) el.value = v; };
    set('platformName', s.platformName);
    set('platformSig', s.signature);
    set('platformWelcome', s.welcome);
    set('platformHlsServer', s.hlsServer);
    set('platformHlsCdn', s.hlsCdn);
    document.querySelectorAll('#page-platform .toggle-row[data-key]').forEach(row=>{
      const k = row.dataset.key;
      if(s[k] === false) row.querySelector('.tg-sw').classList.remove('on');
      else if(s[k] === true) row.querySelector('.tg-sw').classList.add('on');
    });
  }catch(e){ console.warn('load platform settings', e); }
};

window.toggleSw = function(row) { row.querySelector('.tg-sw').classList.toggle('on'); };
window.openModal = function(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; };
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target === m) closeModal(m.id); }));

let toastT;
// ترجمة أخطاء Firebase الشائعة للعربية
window._trErr = function(e) {
  const raw = (e && (e.message || e.code || e)) + '';
  const s = raw.toLowerCase();
  if (s.indexOf('quota') !== -1 || s.indexOf('resource-exhausted') !== -1 || (s.indexOf('storage') !== -1 && s.indexOf('limit') !== -1))
    return 'تجاوزت مساحة التخزين المسموحة. قلّل حجم الصور أو احذف بيانات قديمة.';
  if (s.indexOf('permission') !== -1) return 'لا تملك صلاحية لهذا الإجراء.';
  if (s.indexOf('network') !== -1 || s.indexOf('offline') !== -1 || s.indexOf('failed to fetch') !== -1)
    return 'مشكلة في الاتصال بالإنترنت. حاول مجدداً.';
  if (s.indexOf('email-already') !== -1) return 'البريد الإلكتروني مستخدم بالفعل.';
  if (s.indexOf('weak-password') !== -1) return 'كلمة المرور ضعيفة (6 أحرف على الأقل).';
  if (s.indexOf('invalid-email') !== -1) return 'بريد إلكتروني غير صحيح.';
  if (s.indexOf('too-many-requests') !== -1) return 'محاولات كثيرة — انتظر قليلاً.';
  return raw;
};

window.showToast = function(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000);
};

// Init dates
const today = new Date();
const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
const dateEl = document.getElementById('nl_start');
const endDateEl = document.getElementById('nl_end');
if(dateEl) dateEl.value = today.toISOString().split('T')[0];
if(endDateEl) endDateEl.value = nextMonth.toISOString().split('T')[0];
const subStart = document.getElementById('sub_start');
const subEnd = document.getElementById('sub_end');
if(subStart) subStart.value = today.toISOString().split('T')[0];
if(subEnd) subEnd.value = nextMonth.toISOString().split('T')[0];


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

// ══ Android PWA Install ══
let deferredPromptSA = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPromptSA = e;
  // يمكن إضافة زر تثبيت للأندرويد مستقبلاً
});

/* ═══════════════════════════════════════════════════════════════════
 *  🩺 الفحص الذاتي للصلاحيات — v338.3
 *  ─────────────────────────────────────────────────────────────────
 *  سبب وجوده: أخطاء الصلاحية في Firestore ترجع رسالة واحدة عامة
 *  (permission-denied) لكل الأسباب الممكنة. فالمستخدم يرى «خطأ» ولا
 *  يعرف هل المشكلة في حسابه أم في القواعد أم في بيانات قديمة.
 *
 *  هذا الفحص يجرّب الاحتمالات واحداً واحداً ويقول الجواب مباشرةً:
 *    ① هل سجلّ admins/{uid} موجود وصحيح؟  (هو ما يفحصه كود الدخول)
 *    ② هل توجد نسخة leagueAdmins/{uid} تُسقط صلاحيتك مع القواعد
 *       القديمة؟ (القديمة تعرّف السوبر أدمن بـ «ليس له سجلّ منظّم»)
 *    ③ هل القواعد الجديدة منشورة فعلاً؟ نستدلّ بكتابة اختبارية على
 *       handoverLinks ثم نحذفها فوراً — وهي المسار نفسه الذي اشتُكي
 *       منه، فنختبر الواقع لا نظنّه.
 *
 *  كل الفحوص للقراءة عدا (③) وهو يكتب مستنداً مؤقتاً ويحذفه في finally.
 * ═══════════════════════════════════════════════════════════════════ */
window.saSelfCheck = async function () {
  const u = auth.currentUser;
  if (!u) { alert('انتهت جلستك — سجّل الدخول من جديد.'); return; }

  const L = [];
  let mustDeploy = false, mustDelete = false;

  L.push('🩺 فحص صلاحيات السوبر أدمن');
  L.push('─────────────────────────────');
  L.push('الحساب: ' + (u.email || '—'));
  L.push('UID: ' + u.uid);
  L.push('');

  // ① سجلّ الصلاحية
  try {
    const a = await getDoc(doc(db, 'admins', u.uid));
    if (!a.exists()) {
      L.push('❌ admins/{uid} غير موجود — وهذا يمنع الدخول أصلاً.');
    } else if (a.data().role !== 'superadmin') {
      L.push('❌ admins/{uid} موجود لكن role = ' + JSON.stringify(a.data().role));
      L.push('   المطلوب نصّاً: superadmin');
    } else {
      L.push('✅ سجلّ الصلاحية سليم (admins/{uid}.role = superadmin)');
    }
  } catch (e) {
    L.push('⚠️ تعذّرت قراءة admins/{uid} — القواعد الجديدة غالباً غير منشورة.');
    mustDeploy = true;
  }

  // ② تعارض سجلّ المنظّم
  try {
    const la = await getDoc(doc(db, 'leagueAdmins', u.uid));
    if (la.exists()) {
      mustDelete = true;
      L.push('⚠️ يوجد leagueAdmins/' + u.uid + ' مرتبط ببطولة: ' +
             (la.data().leagueId || '—'));
      L.push('   مع القواعد القديمة هذا **يُسقط** صلاحيتك كسوبر أدمن.');
      L.push('   (القواعد الجديدة لا تتأثر به إطلاقاً.)');
    } else {
      L.push('✅ لا يوجد سجلّ منظّم يتعارض مع حسابك');
    }
  } catch (e) {
    L.push('⚠️ تعذّرت قراءة leagueAdmins/{uid}');
  }

  // ③ اختبار حقيقي على المسار المُشتكى منه
  const probe = '__selfcheck_' + Date.now();
  let wrote = false;
  try {
    await setDoc(doc(db, 'handoverLinks', probe), { probe: true, at: Date.now() });
    wrote = true;
    L.push('✅ صلاحية إنشاء روابط التسليم تعمل — القواعد تقبل كتابتك');
  } catch (e) {
    mustDeploy = true;
    L.push('❌ رُفضت كتابة رابط التسليم (' + ((e && e.code) || 'خطأ') + ')');
    L.push('   هذا هو سبب رسالة «لا توجد صلاحية» التي واجهتها.');
  } finally {
    if (wrote) { try { await deleteDoc(doc(db, 'handoverLinks', probe)); } catch (e) {} }
  }

  L.push('');
  L.push('─────── الخلاصة ───────');
  if (!mustDeploy && !mustDelete) {
    L.push('🎉 كل شيء سليم — لا إجراء مطلوب منك.');
  } else {
    if (mustDeploy) {
      L.push('👈 إجراء مطلوب: انشر ملف firestore.rules الجديد.');
      L.push('   Firebase Console ← Firestore Database ← Rules');
      L.push('   الصق محتوى firestore.rules ثم Publish.');
      L.push('   (أو من الطرفية: firebase deploy --only firestore:rules)');
    }
    if (mustDelete && !mustDeploy) {
      L.push('👈 اختياري: احذف leagueAdmins/' + u.uid + ' — لم يعد له أثر');
      L.push('   بعد نشر القواعد الجديدة.');
    }
  }

  alert(L.join('\n'));
  console.log(L.join('\n'));
};

/* ═══════════════════════════════════════════════════════════════════
 *  📤 نافذة المشاركة — v338.4
 *  ─────────────────────────────────────────────────────────────────
 *  بديل موثوق لـ navigator.clipboard الذي يفشل بعد أي await، وخارج
 *  السياق الآمن، وداخل المتصفحات المضمّنة في تطبيقات المراسلة.
 *
 *  ثلاث طبقات تراجع، لا تفشل كلها معاً أبداً:
 *    ① navigator.clipboard — النقرة هنا مباشرة فالإذن حاضر
 *    ② document.execCommand('copy') — يعمل بلا HTTPS
 *    ③ تحديد النصّ تلقائياً ليَنسخ المستخدم يدوياً
 *  ومعها واتساب ومشاركة النظام، فللمستخدم دائماً مخرج.
 * ═══════════════════════════════════════════════════════════════════ */
window._showShareSheet = function (o) {
  document.getElementById('shShareOv')?.remove();
  const G = 'var(--gold,#C9A02B)';
  const ov = document.createElement('div');
  ov.id = 'shShareOv';
  ov.style.cssText =
    'position:fixed;inset:0;z-index:100030;background:rgba(0,0,0,.74);display:flex;' +
    'align-items:flex-end;justify-content:center;font-family:Tajawal,sans-serif';
  ov.innerHTML =
    '<div style="width:100%;max-width:520px;background:var(--card,#1a1a1a);' +
      'border:1px solid var(--border2,#383838);border-bottom:none;border-radius:20px 20px 0 0;' +
      'padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px))">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px">' +
        '<div><div style="font-size:15px;font-weight:900;color:' + G + '">' + (o.title || 'مشاركة') + '</div>' +
        (o.sub ? '<div style="font-size:11px;color:var(--muted2,#888);margin-top:3px;font-weight:700">' + o.sub + '</div>' : '') +
        '</div>' +
        '<button id="shX" style="background:var(--card2,#202020);border:1px solid var(--border2,#383838);' +
          'color:var(--text,#efefef);width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:14px">✕</button>' +
      '</div>' +
      '<input id="shLink" readonly value="' + String(o.link).replace(/"/g, '&quot;') + '" ' +
        'style="width:100%;box-sizing:border-box;padding:12px;border-radius:11px;background:var(--dark,#121212);' +
        'border:1px solid var(--border,#2c2c2c);color:var(--text,#efefef);font-size:12px;' +
        'font-family:monospace;direction:ltr;text-align:left;margin-bottom:10px"/>' +
      '<div style="display:flex;gap:7px;flex-wrap:wrap">' +
        '<button id="shCopy" style="flex:2;min-width:120px;padding:13px;border-radius:12px;border:none;' +
          'background:' + G + ';color:#1a1200;font-family:Tajawal,sans-serif;font-size:13px;font-weight:900;cursor:pointer">نسخ الرابط</button>' +
        '<button id="shWa" style="flex:1;min-width:104px;padding:13px;border-radius:12px;' +
          'border:1px solid rgba(37,211,102,.4);background:rgba(37,211,102,.12);color:#25D366;' +
          'font-family:Tajawal,sans-serif;font-size:13px;font-weight:900;cursor:pointer">واتساب</button>' +
        (navigator.share ? '<button id="shNat" style="flex:1;min-width:92px;padding:13px;border-radius:12px;' +
          'border:1px solid var(--border2,#383838);background:var(--card2,#202020);color:var(--text,#efefef);' +
          'font-family:Tajawal,sans-serif;font-size:13px;font-weight:900;cursor:pointer">مشاركة</button>' : '') +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.querySelector('#shX').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };

  const inp = ov.querySelector('#shLink');
  const btn = ov.querySelector('#shCopy');
  btn.onclick = async () => {
    let ok = false;
    try {                                   // ① الحافظة الحديثة
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(o.link); ok = true;
      }
    } catch (e) {}
    if (!ok) {                              // ② الطريقة القديمة
      try {
        inp.removeAttribute('readonly');
        inp.select(); inp.setSelectionRange(0, 99999);
        ok = document.execCommand('copy');
        inp.setAttribute('readonly', 'readonly');
      } catch (e) {}
    }
    if (ok) {
      btn.textContent = '✓ تم النسخ';
      btn.style.background = 'var(--green,#27AE60)';
      setTimeout(() => { btn.textContent = 'نسخ الرابط'; btn.style.background = G; }, 1600);
    } else {                                // ③ تحديد يدوي
      inp.select(); inp.setSelectionRange(0, 99999);
      btn.textContent = 'انسخ يدوياً ↑';
    }
  };
  ov.querySelector('#shWa').onclick = () =>
    window.open('https://wa.me/?text=' + encodeURIComponent(o.wa || o.link), '_blank');
  const nat = ov.querySelector('#shNat');
  if (nat) nat.onclick = () =>
    navigator.share({ title: o.title || '', text: o.wa || '', url: o.link }).catch(() => {});
};

/* ═══════════════════════════════════════════════════════════════════
 *  💰 التسعير والعروض — v338.4
 *  ─────────────────────────────────────────────────────────────────
 *  مصدر الحقيقة: settings/pricing. تقرؤه subscribe.html عند كل فتح،
 *  ولو تعذّر تعمل بقيمها الاحتياطية المكتوبة فيها — فلا تتعطّل صفحة
 *  الاشتراك أبداً بسبب هذه اللوحة.
 *
 *  تنبيه أمني: settings مقروء للمسجّلين فقط في القواعد. لكن صفحة
 *  الاشتراك عامة ويقرؤها زوّار بلا حساب — لذلك يجب أن تكون قاعدة
 *  settings/pricing وحدها `read: if true`. (مضبوطة في firestore.rules.)
 * ═══════════════════════════════════════════════════════════════════ */
const PR_DEFAULTS = {
  base:50, teamsIncluded:16, teamsBlock:8, teamsPrice:10,
  playersIncluded:200, playersBlock:50, playersPrice:15,
  photoFree:200, photoBlock:100, photoPrice:15,
  playersOff:false, photosOff:false,
  t3:10, t6:15, t12:25,
  promo:{ on:false, title:'', note:'', type:'pct', value:0, from:'', to:'' },
  codes:[]
};
let _prCodes = [];

const _prG = (id) => document.getElementById(id);
const _prNum = (id, dflt) => {
  const el = _prG(id); if (!el) return dflt;
  const v = parseInt(el.value, 10);
  return (isFinite(v) && v >= 0) ? v : dflt;
};

window.loadPricingAdmin = async function () {
  let v = { ...PR_DEFAULTS };
  try {
    const snap = await getDoc(doc(db, 'settings', 'pricing'));
    if (snap.exists()) {
      const d = snap.data() || {};
      v = { ...v, ...d };
      if (Array.isArray(d.tiers)) {           // نحوّل الشرائح لحقول مقروءة
        const f = (m) => { const t = d.tiers.find(x => x.min === m); return t ? Math.round(t.d * 100) : v['t' + m]; };
        v.t3 = f(3); v.t6 = f(6); v.t12 = f(12);
      }
      v.promo = { ...PR_DEFAULTS.promo, ...(d.promo || {}) };
    }
  } catch (e) { showToast('تعذّر تحميل التسعير — تُعرض القيم الافتراضية', 'error'); }

  ['base','teamsIncluded','teamsBlock','teamsPrice','playersIncluded','playersBlock',
   'playersPrice','photoFree','photoBlock','photoPrice','t3','t6','t12']
    .forEach(k => { const el = _prG('pr_' + k); if (el) el.value = v[k]; });
  const po = _prG('pr_playersOff'); if (po) po.checked = !!v.playersOff;
  const fo = _prG('pr_photosOff');  if (fo) fo.checked = !!v.photosOff;

  const p = v.promo || {};
  const set = (id, val) => { const el = _prG(id); if (el) el.value = val == null ? '' : val; };
  const on = _prG('pr_promoOn'); if (on) on.checked = !!p.on;
  set('pr_promoTitle', p.title); set('pr_promoNote', p.note);
  set('pr_promoType', p.type || 'pct'); set('pr_promoValue', p.value || 0);
  set('pr_promoFrom', p.from); set('pr_promoTo', p.to);

  _prCodes = Array.isArray(v.codes) ? v.codes.slice() : [];
  prRenderCodes();

  const lk = _prG('pr_link');
  if (lk) lk.value = (typeof SITE_URL !== 'undefined' ? SITE_URL : location.origin + '/') + 'subscribe.html';
};

window.prRenderCodes = function () {
  const box = _prG('pr_codes');
  if (!box) return;
  if (!_prCodes.length) {
    box.innerHTML = '<div class="fhint" style="text-align:center;padding:14px">لا أكواد بعد — أضف كوداً ليستعمله العملاء.</div>';
    return;
  }
  box.innerHTML = _prCodes.map((c, i) =>
    '<div class="pr-code">' +
      '<input class="fi" style="flex:1;min-width:88px" value="' + String(c.code || '').replace(/"/g,'&quot;') +
        '" placeholder="CODE" dir="ltr" oninput="prSetCode(' + i + ',\'code\',this.value)"/>' +
      '<select class="fs" style="width:78px" onchange="prSetCode(' + i + ',\'type\',this.value)">' +
        '<option value="pct"' + (c.type !== 'flat' ? ' selected' : '') + '>٪</option>' +
        '<option value="flat"' + (c.type === 'flat' ? ' selected' : '') + '>﷼</option>' +
      '</select>' +
      '<input class="fi" style="width:74px" type="number" min="0" value="' + (c.value || 0) +
        '" oninput="prSetCode(' + i + ',\'value\',this.value)"/>' +
      '<label class="pr-sw" style="margin:0"><input type="checkbox"' + (c.on !== false ? ' checked' : '') +
        ' onchange="prSetCode(' + i + ',\'on\',this.checked)"/><span>مفعّل</span></label>' +
      '<button class="btn btn-outline btn-sm" onclick="prDelCode(' + i + ')">حذف</button>' +
    '</div>').join('');
};
window.prSetCode = (i, k, v) => {
  if (!_prCodes[i]) return;
  _prCodes[i][k] = (k === 'value') ? (parseInt(v, 10) || 0) : v;
};
window.prAddCode = () => { _prCodes.push({ code:'', type:'pct', value:10, on:true }); prRenderCodes(); };
window.prDelCode = (i) => { _prCodes.splice(i, 1); prRenderCodes(); };

window.savePricing = async function () {
  const why = await _assertSuperAdmin();
  if (why) { alert('⚠️ تعذّر حفظ التسعير\n\n' + why); return; }

  const codes = _prCodes
    .filter(c => String(c.code || '').trim())
    .map(c => ({ code: String(c.code).trim().toUpperCase(),
                 type: c.type === 'flat' ? 'flat' : 'pct',
                 value: parseInt(c.value, 10) || 0,
                 on: c.on !== false }));

  /* الشرائح تُحفظ بالصيغة التي تفهمها subscribe.html (min/d) وبترتيب
     تنازلي — دالّة discOf تأخذ أول تطابق، فالترتيب جزء من صحّتها. */
  const tiers = [
    { min:12, d:(_prNum('pr_t12',25) / 100) },
    { min:6,  d:(_prNum('pr_t6',15)  / 100) },
    { min:3,  d:(_prNum('pr_t3',10)  / 100) },
    { min:1,  d:0 }
  ];

  const payload = {
    base:            _prNum('pr_base', 50),
    teamsIncluded:   _prNum('pr_teamsIncluded', 16),
    teamsBlock:      Math.max(1, _prNum('pr_teamsBlock', 8)),
    teamsPrice:      _prNum('pr_teamsPrice', 10),
    playersIncluded: _prNum('pr_playersIncluded', 200),
    playersBlock:    Math.max(1, _prNum('pr_playersBlock', 50)),
    playersPrice:    _prNum('pr_playersPrice', 15),
    photoFree:       _prNum('pr_photoFree', 200),
    photoBlock:      Math.max(1, _prNum('pr_photoBlock', 100)),
    photoPrice:      _prNum('pr_photoPrice', 15),
    playersOff:      !!(_prG('pr_playersOff') || {}).checked,
    photosOff:       !!(_prG('pr_photosOff')  || {}).checked,
    tiers,
    promo: {
      on:    !!(_prG('pr_promoOn') || {}).checked,
      title: (_prG('pr_promoTitle') || {}).value || '',
      note:  (_prG('pr_promoNote')  || {}).value || '',
      type:  (_prG('pr_promoType')  || {}).value || 'pct',
      value: _prNum('pr_promoValue', 0),
      from:  (_prG('pr_promoFrom') || {}).value || '',
      to:    (_prG('pr_promoTo')   || {}).value || ''
    },
    codes,
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, 'settings', 'pricing'), payload, { merge: true });
    showToast('✅︎ حُفظ التسعير — يظهر فوراً في صفحة الاشتراك', 'success');
  } catch (e) {
    if (e && e.code === 'permission-denied') {
      alert('🚫 رفضت القواعد الحفظ.\n\nتأكّد أن firestore.rules المُحدَّث منشور، '
          + 'وأن admins/' + (auth.currentUser ? auth.currentUser.uid : '{uid}') + ' يحمل role = superadmin.');
    } else showToast('خطأ: ' + window._trErr(e), 'error');
  }
};

window.prShareLink = function () {
  const lk = _prG('pr_link');
  if (!lk || !lk.value) return;
  _showShareSheet({
    title: 'رابط صفحة الاشتراك',
    sub: 'الأسعار والعروض تُطبَّق تلقائياً',
    link: lk.value,
    wa: 'اشترك في المنصة:\n' + lk.value
  });
};
