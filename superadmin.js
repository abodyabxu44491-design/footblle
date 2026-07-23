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
let currentFilter = 'all';

// ══ SUBSCRIPTION DURATION (خطة واحدة فقط — تُحدَّد بالمدة لا بالنوع) ══
const durationState = { nl: 1, sub: 1, renew: 1 };
const durationCustom = { nl: false, sub: false, renew: false };
let _renewingSubId = null;

function todayISO() { return new Date().toISOString().split('T')[0]; }
/* ✅ تفسير endDate كنهاية اليوم بالتوقيت المحلي (لا UTC) */
function subEnd(endDate) {
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
  const diff = (subEnd(s.endDate) - new Date()) / (1000*60*60*24);
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
  const diff = Math.ceil((subEnd(sub.endDate) - new Date()) / (1000*60*60*24));
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
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.leagueActions = function(id) {
  const l = allLeagues.find(x => x.id === id);
  if(!l) return;
  const sub = allSubs.find(s => s.leagueId === id);
  const subInfo = sub ? `${durationLabel(sub.startDate, sub.endDate)} · ينتهي ${sub.endDate || '—'}` : '⚠️ لا يوجد اشتراك';
  const subColor = sub ? (sub.status === 'active' ? 'var(--green)' : 'var(--red)') : 'var(--orange)';
  const buttonLabel = sub ? (sub.status === 'active' ? 'مباشر' : 'موقوف') : 'غير مشترك';
  document.getElementById('mal-title').textContent = '⚙︎️ ' + l.name;
  document.getElementById('mal-body').innerHTML = `
    <div style="display:grid;gap:10px">
      <div style="background:var(--card2);border-radius:10px;padding:12px 14px;font-size:11px;color:var(--muted2);line-height:1.9">
        <div>🆔 المعرف: <strong style="color:var(--text);font-family:monospace">${l.id}</strong></div>
        <div>👤 المالك: <strong style="color:var(--text)">${l.ownerName || '—'}</strong></div>
        <div>📧 البريد: <strong style="color:var(--text)">${l.ownerEmail || '—'}</strong></div>
        <div>📱 الواتساب: <strong style="color:var(--text)">${l.ownerPhone || '—'}</strong></div>
        <div>💳 الاشتراك: <strong style="color:${subColor}">${subInfo}</strong></div>
        <div>🔒 الحالة: <strong style="color:${l.locked ? 'var(--red)' : 'var(--green)'}">${l.locked ? 'مقفول' : 'مفتوح'}</strong></div>
      </div>
      <button class="btn btn-green" style="width:100%;justify-content:center" onclick="window.open('league-viewer.html?id=${l.id}','_blank')">👁 فتح صفحة الجمهور ↗︎</button>
      <button class="btn btn-blue" style="width:100%;justify-content:center" onclick="window.open('league-admin.html?id=${l.id}','_blank')">⚙︎️ فتح لوحة الإدارة ↗︎</button>
      <button class="btn btn-outline" style="width:100%;justify-content:center" onclick="copyStr('league-viewer.html?id=${l.id}')">📋 نسخ رابط الجمهور</button>
      <button class="btn btn-gold" style="width:100%;justify-content:center" onclick="hoOpen('${l.id}')">صفحة التسليم — عرض / طباعة</button>
      <button class="btn btn-outline" style="width:100%;justify-content:center" onclick="hoWA('${l.id}')">إرسال الروابط واتساب</button>
      <hr style="border-color:var(--border);margin:4px 0"/>
      ${l.locked
        ? `<button class="btn btn-green" style="width:100%;justify-content:center" onclick="lockLeague('${l.id}',false)">🔓 فتح قفل البطولة</button>`
        : `<button class="btn" style="width:100%;justify-content:center;background:var(--orange);color:#fff" onclick="lockLeague('${l.id}',true)">🔒 قفل البطولة (منع التعديل)</button>`
      }
      <button class="btn btn-red" style="width:100%;justify-content:center" onclick="deleteLeague('${l.id}')">🗑 حذف البطولة نهائياً</button>
    </div>`;
  openModal('modal-league-actions');
};

window.deleteLeague = async function(id) {
  if(!confirm('هل أنت متأكد من حذف هذه البطولة نهائياً؟\nسيتم حذف الفرق والمباريات والبيانات كاملة.\nلا يمكن التراجع!')) return;
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
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
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
    const diff = (subEnd(s.endDate) - new Date()) / (1000*60*60*24);
    return diff > 0 && diff <= 14;
  });
  if(soon.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--green);font-size:12px">✅︎ لا توجد اشتراكات تنتهي قريباً</div>';
    return;
  }
  el.innerHTML = soon.map(s => {
    const diff = Math.ceil((subEnd(s.endDate) - new Date()) / (1000*60*60*24));
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
    const end = subEnd(s.endDate);
    const days = end ? Math.ceil((end - new Date()) / 86400000) : null;
    const text = st === 'soon' ? `${days} يوم` : lbl;
    const isDone = st === 'cancelled';
    return `<tr>
      <td style="font-weight:700">${s.leagueName || s.leagueId || '—'}</td>
      <td style="color:var(--muted2)">${s.ownerName || '—'}</td>
      <td style="color:var(--muted2);font-size:10px">${durationLabel(s.startDate, s.endDate)}</td>
      <td><span class="${cls}">${s.endDate || '—'}</span></td>
      <td><span style="font-size:10px" class="${cls}">${text}</span></td>
      <td style="display:flex;gap:5px">
        <button class="btn btn-gold btn-xs" onclick="renewSub('${s.id}')">تجديد</button>
        <button class="btn btn-red btn-xs" onclick="cancelSub('${s.id}')" ${isDone ? 'disabled style="opacity:.4;cursor:not-allowed"' : ''}>إلغاء</button>
      </td>
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
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

window.cancelSub = async function(id) {
  if(!confirm('هل تريد إلغاء هذا الاشتراك؟')) return;
  try {
    await updateDoc(doc(db, 'subscriptions', id), { status: 'cancelled', updatedAt: serverTimestamp() });
    showToast('تم إلغاء الاشتراك', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
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
    const end = subEnd(s.endDate);
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
      <td style="font-weight:700">${u.ownerName || '—'}</td>
      <td style="color:var(--muted2);font-family:monospace;font-size:10px">${u.email || '—'}</td>
      <td style="color:var(--muted2)">${u.leagueName || u.leagueId || '—'}</td>
      <td><span class="plan-badge ${subClass}">${subText}</span></td>
      <td><span style="font-size:9px;padding:2px 8px;border-radius:10px;background:${u.active !== false ? 'var(--green2)' : 'var(--red2)'};color:${u.active !== false ? 'var(--green)' : 'var(--red)'};border:1px solid ${u.active !== false ? 'var(--green)' : 'var(--red)'}">${u.active !== false ? '🟢 نشط' : '⚫ موقوف'}</span></td>
      <td style="display:flex;gap:5px">
        <button class="btn btn-red btn-xs" onclick="deleteUser('${u.id}')">حذف</button>
      </td>
    </tr>
  `;
  }).join('');
}

window.deleteUser = async function(id) {
  if(!confirm('هل تريد حذف هذا المستخدم؟')) return;
  try {
    await deleteDoc(doc(db, 'leagueAdmins', id));
    showToast('تم حذف المستخدم', 'error');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
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
    await setDoc(doc(db, 'leagueAdmins', uid), {
      ownerName,
      email: ownerEmail,
      phone,
      leagueId: slug,
      leagueName: name,
      active: true,
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
    setTimeout(() => { showPage('leagues', null); btn.disabled = false; btn.textContent = '🚀 إنشاء البطولة وتفعيلها'; }, 2000);
  } catch(e) {
    showToast('خطأ: ' + (e.message || e.code), 'error');
    btn.disabled = false;
    btn.textContent = '🚀 إنشاء البطولة وتفعيلها';
  }
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
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
};

// ══ PLATFORM SETTINGS ══
window.savePlatformSettings = async function() {
  const settings = {
    platformName: document.getElementById('platformName')?.value,
    signature: document.getElementById('platformSig')?.value,
    welcome: document.getElementById('platformWelcome')?.value,
    updatedAt: serverTimestamp(),
  };
  document.querySelectorAll('.toggle-row[data-key]').forEach(row => {
    settings[row.dataset.key] = row.querySelector('.tg-sw').classList.contains('on');
  });
  try {
    await setDoc(doc(db, 'settings', 'platform'), settings, { merge: true });
    showToast('تم حفظ الإعدادات ✓', 'success');
  } catch(e) { showToast('خطأ: ' + e.message, 'error'); }
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
  const txt = encodeURIComponent(`🏆 ${name}\n\n🌐 رابط الجمهور:\n${viewerUrl}\n\n⚙︎️ لوحة الإدارة:\n${adminUrl}\n\n📧 البريد: ${email}\n🔑 كلمة المرور: ${pass}`);
  window.open('https://wa.me/?text=' + txt, '_blank');
};


/* ✅︎ جسر التسليم — يمرّر بيانات البطولة الحقيقية من leagues[] */
function _hoData(id) {
  const l = allLeagues.find(x => x.id === id) || {};
  return {
    id: id, name: l.name || 'البطولة', owner: l.ownerName || '',
    phone: l.ownerPhone || '', email: l.ownerEmail || '',
    season: l.season || '2025', type: l.type || 'league', logo: l.logo || '', pass: ''
  };
}
window.hoOpen = (id) => window.openHandover(_hoData(id));
window.hoWA   = (id) => window.sendHandoverWA(_hoData(id));

window.sendWALeague = function(name, id, phone) {
  const viewerUrl = SITE_URL + 'league-viewer.html?id=' + id;
  const adminUrl = SITE_URL + 'league-admin.html?id=' + id;
  const txt = encodeURIComponent(`🏆 ${name}\n\n🌐 رابط الجمهور:\n${viewerUrl}\n\n⚙︎️ لوحة الإدارة:\n${adminUrl}`);
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
};

window.toggleSw = function(row) { row.querySelector('.tg-sw').classList.toggle('on'); };
window.openModal = function(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; };
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target === m) closeModal(m.id); }));

let toastT;
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
