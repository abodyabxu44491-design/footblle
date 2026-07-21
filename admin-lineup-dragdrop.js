// ═══════════════════════════════════════════════════════
//  ADMIN LINEUP — DRAG & DROP على الملعب
//  أضف هذا الملف بعد admin_new_2_2.js في HTML:
//  <script type="module" src="admin-lineup-dragdrop.js"></script>
// ═══════════════════════════════════════════════════════

// ══ إعادة استخدام Firebase من الملف الأصلي ══
const _db         = window._db;
const _doc        = window._firestoreDoc;
const _updateDoc  = window._firestoreUpdateDoc;
const _serverTs   = window._serverTimestamp;
const _getLeagueId = () => window._getLeagueId?.() || '';

// ══ STATE ══
let _ddMatchId  = null;   // المباراة الحالية
let _ddSide     = 'home'; // الفريق الحالي
let _ddPlayers  = [];     // [{id, name, number, position, status, x, y}]
let _ddFormation = '4-3-3';
let _ddHomeData = null;
let _ddAwayData = null;
let _dragTarget = null;   // اللاعب الذي يُسحب
let _dragOffX   = 0;
let _dragOffY   = 0;
let _pitchRect  = null;
let _ddRosterHome = []; // لاعبو الفريق المضيف المسجّلون (من صفحة إدارة الفرق)
let _ddRosterAway = []; // لاعبو الفريق الضيف المسجّلون

// ══ تشكيلات لكل عدد لاعبين مع مواضع افتراضية ══
const DD_CONFIGS = {
  5: {
    pitchType: 'futsal',
    formations: {
      '2-1-1': [[50,88],[28,65],[72,65],[50,42],[50,20]],
      '1-2-1': [[50,88],[50,68],[28,44],[72,44],[50,20]],
      '2-2':   [[50,88],[28,65],[72,65],[32,26],[68,26]],
    },
    default: '2-1-1',
  },
  6: {
    pitchType: 'futsal',
    formations: {
      '2-2-1': [[50,88],[28,68],[72,68],[28,46],[72,46],[50,22]],
      '2-1-2': [[50,88],[28,68],[72,68],[50,48],[32,22],[68,22]],
      '1-2-2': [[50,88],[50,68],[28,48],[72,48],[32,22],[68,22]],
    },
    default: '2-2-1',
  },
  7: {
    pitchType: 'seven',
    formations: {
      '2-3-1': [[50,88],[28,70],[72,70],[18,50],[50,48],[82,50],[50,24]],
      '3-2-1': [[50,88],[20,70],[50,68],[80,70],[32,48],[68,48],[50,24]],
      '2-2-2': [[50,88],[30,70],[70,70],[30,48],[70,48],[30,24],[70,24]],
      '3-3':   [[50,88],[20,68],[50,66],[80,68],[20,28],[50,26],[80,28]],
    },
    default: '2-3-1',
  },
  8: {
    pitchType: 'seven',
    formations: {
      '3-3-1': [[50,88],[20,70],[50,68],[80,70],[20,48],[50,46],[80,48],[50,22]],
      '3-2-2': [[50,88],[20,70],[50,68],[80,70],[32,48],[68,48],[30,22],[70,22]],
      '2-3-2': [[50,88],[28,70],[72,70],[18,50],[50,48],[82,50],[30,22],[70,22]],
    },
    default: '3-3-1',
  },
  9: {
    pitchType: 'seven',
    formations: {
      '3-4-1': [[50,88],[20,70],[50,68],[80,70],[14,50],[38,48],[62,48],[86,50],[50,22]],
      '3-3-2': [[50,88],[20,70],[50,68],[80,70],[20,48],[50,46],[80,48],[32,22],[68,22]],
      '4-3-1': [[50,88],[14,70],[38,68],[62,68],[86,70],[20,48],[50,46],[80,48],[50,22]],
    },
    default: '3-4-1',
  },
  10: {
    pitchType: 'full',
    formations: {
      '4-4-1': [[50,88],[14,70],[38,68],[62,68],[86,70],[14,50],[38,48],[62,48],[86,50],[50,22]],
      '4-3-2': [[50,88],[14,70],[38,68],[62,68],[86,70],[20,50],[50,48],[80,50],[32,24],[68,24]],
      '3-4-2': [[50,88],[20,70],[50,68],[80,70],[14,50],[38,48],[62,48],[86,50],[32,24],[68,24]],
    },
    default: '4-4-1',
  },
  11: {
    pitchType: 'full',
    formations: {
      '4-3-3':   [[50,88],[16,72],[36,70],[64,70],[84,72],[25,55],[50,53],[75,55],[20,30],[50,28],[80,30]],
      '4-4-2':   [[50,88],[16,72],[36,70],[64,70],[84,72],[16,52],[36,52],[64,52],[84,52],[35,28],[65,28]],
      '4-2-3-1': [[50,88],[16,72],[36,70],[64,70],[84,72],[35,58],[65,58],[16,42],[50,42],[84,42],[50,25]],
      '3-5-2':   [[50,88],[25,72],[50,70],[75,72],[10,52],[30,52],[50,52],[70,52],[90,52],[35,28],[65,28]],
      '5-3-2':   [[50,88],[10,72],[28,70],[50,68],[72,70],[90,72],[25,50],[50,50],[75,50],[35,28],[65,28]],
      '3-4-3':   [[50,88],[25,72],[50,70],[75,72],[14,52],[38,52],[62,52],[86,52],[20,28],[50,26],[80,28]],
    },
    default: '4-3-3',
  },
};

// ══ SVG الملاعب ══
const DD_PITCH_SVGS = {
  futsal: `
    <rect width="100%" height="100%" fill="#0a1f0a"/>
    <rect x="0" y="0" width="100%" height="32%" fill="#0c220c" opacity=".4"/>
    <rect x="0" y="64%" width="100%" height="32%" fill="#0c220c" opacity=".4"/>
    <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="3"/>
    <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <circle cx="50%" cy="50%" r="12%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="50%" r="1%" fill="rgba(255,255,255,.4)"/>
    <rect x="26%" y="3%" width="48%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="38%" y="3%" width="24%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <rect x="26%" y="81%" width="48%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="38%" y="90%" width="24%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="13%" r="1%" fill="rgba(255,255,255,.3)"/>
    <circle cx="50%" cy="87%" r="1%" fill="rgba(255,255,255,.3)"/>`,
  seven: `
    <rect width="100%" height="100%" fill="#0a1f0a"/>
    <rect x="0" y="0" width="100%" height="25%" fill="#0c220c" opacity=".4"/>
    <rect x="0" y="50%" width="100%" height="25%" fill="#0c220c" opacity=".4"/>
    <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="2"/>
    <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <circle cx="50%" cy="50%" r="13%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="50%" r="1%" fill="rgba(255,255,255,.4)"/>
    <rect x="20%" y="3%" width="60%" height="18%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="35%" y="3%" width="30%" height="8%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <rect x="20%" y="79%" width="60%" height="18%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="35%" y="89%" width="30%" height="8%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="16%" r="1%" fill="rgba(255,255,255,.3)"/>
    <circle cx="50%" cy="84%" r="1%" fill="rgba(255,255,255,.3)"/>`,
  full: `
    <rect width="100%" height="100%" fill="#0a1f0a"/>
    <rect x="0" y="0"   width="100%" height="18%" fill="#0c220c" opacity=".4"/>
    <rect x="0" y="36%" width="100%" height="18%" fill="#0c220c" opacity=".4"/>
    <rect x="0" y="72%" width="100%" height="18%" fill="#0c220c" opacity=".4"/>
    <rect x="5%" y="3%" width="90%" height="94%" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none" rx="2"/>
    <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <circle cx="50%" cy="50%" r="14%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="50%" r="1%" fill="rgba(255,255,255,.4)"/>
    <rect x="22%" y="3%" width="56%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="36%" y="3%" width="28%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <path d="M33% 19% Q50% 26% 67% 19%" stroke="rgba(255,255,255,.08)" stroke-width="1" fill="none"/>
    <rect x="22%" y="81%" width="56%" height="16%" stroke="rgba(255,255,255,.15)" stroke-width="1" fill="none"/>
    <rect x="36%" y="90%" width="28%" height="7%" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <path d="M33% 81% Q50% 74% 67% 81%" stroke="rgba(255,255,255,.08)" stroke-width="1" fill="none"/>
    <circle cx="50%" cy="14%" r="1%" fill="rgba(255,255,255,.3)"/>
    <circle cx="50%" cy="86%" r="1%" fill="rgba(255,255,255,.3)"/>
    <circle cx="5%"  cy="3%"  r="1.5%" stroke="rgba(255,255,255,.12)" stroke-width="1" fill="none"/>
    <circle cx="95%" cy="3%"  r="1.5%" stroke="rgba(255,255,255,.12)" stroke-width="1" fill="none"/>
    <circle cx="5%"  cy="97%" r="1.5%" stroke="rgba(255,255,255,.12)" stroke-width="1" fill="none"/>
    <circle cx="95%" cy="97%" r="1.5%" stroke="rgba(255,255,255,.12)" stroke-width="1" fill="none"/>`,
};

// ══ CSS ══
(function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    #ddModal {
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,.9);
      display:flex;flex-direction:column;
      align-items:center;justify-content:flex-start;
      overflow-y:auto;
    }
    .dd-modal-inner {
      background:#0f1115;
      width:100%;max-width:640px;
      min-height:100vh;
      display:flex;flex-direction:column;
      border-left:1px solid #1f2229;border-right:1px solid #1f2229;
    }
    .dd-topbar {
      display:flex;align-items:center;justify-content:space-between;
      padding:14px 16px;
      background:#0a0b0e;
      border-bottom:1px solid #1f2229;
      position:sticky;top:0;z-index:10;
    }
    .dd-title { font-size:14px;font-weight:900;color:#e8eaf0 }
    .dd-close {
      background:#1a1d24;border:1px solid #262a34;color:#9aa0b0;
      border-radius:8px;padding:7px 14px;font-family:Tajawal,sans-serif;
      font-size:12px;font-weight:600;cursor:pointer;
    }
    .dd-tabs {
      display:grid;grid-template-columns:1fr 1fr;
      border-bottom:1px solid #1f2229;
    }
    .dd-tab {
      padding:12px 8px;text-align:center;
      font-size:13px;font-weight:700;
      background:#0f1115;color:#5a6070;
      border:none;cursor:pointer;font-family:Tajawal,sans-serif;
      border-bottom:2px solid transparent;transition:all .2s;
    }
    .dd-tab.active { color:#C9A02B;border-bottom-color:#C9A02B;background:#0f1115 }

    /* اختيار التشكيلة */
    .dd-formations {
      display:flex;flex-wrap:wrap;gap:6px;
      padding:12px 16px;border-bottom:1px solid #1f2229;
    }
    .dd-f-btn {
      padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;
      border:1px solid #262a34;background:#14161b;color:#9aa0b0;
      cursor:pointer;font-family:Tajawal,sans-serif;transition:all .2s;
    }
    .dd-f-btn.active {
      background:rgba(201,160,43,.1);border-color:rgba(201,160,43,.4);color:#C9A02B;
    }

    /* الملعب */
    .dd-pitch-wrap {
      padding:12px 16px;background:#08090b;
      border-bottom:1px solid #1f2229;
    }
    .dd-pitch {
      position:relative;
      width:100%;
      aspect-ratio:9/16;
      max-height:480px;
      border-radius:10px;
      overflow:hidden;
      touch-action:none;
      user-select:none;
    }
    .dd-pitch svg { position:absolute;inset:0;width:100%;height:100% }

    /* اللاعب على الملعب */
    .dd-player-dot {
      position:absolute;
      transform:translate(-50%,-50%);
      display:flex;flex-direction:column;align-items:center;gap:3px;
      cursor:grab;
      z-index:5;
      transition:filter .15s;
    }
    .dd-player-dot.dragging {
      cursor:grabbing;
      z-index:20;
      
    }
    .dd-player-dot.dragging .dd-avatar {
      transform:scale(1.2);
      border-color:#C9A02B;
    }
    .dd-avatar {
      width:38px;height:38px;border-radius:50%;
      background:rgba(201,160,43,.15);
      border:2px solid #C9A02B;
      display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:900;color:#C9A02B;
      font-family:Tajawal,sans-serif;line-height:1;
      transition:transform .15s, border-color .15s;
    }
    .dd-avatar.gk {
      background:rgba(142,68,173,.15);
      border-color:#8E44AD;color:#8E44AD;
    }
    .dd-avatar.away {
      background:rgba(192,57,43,.15);
      border-color:#C0392B;color:#C0392B;
    }
    .dd-name-tag {
      font-size:8px;font-weight:700;color:#fff;
      background:rgba(0,0,0,.8);border-radius:4px;
      padding:2px 5px;white-space:nowrap;
      max-width:60px;overflow:hidden;text-overflow:ellipsis;
      text-align:center;pointer-events:none;
    }
    .dd-empty-dot .dd-avatar {
      background:rgba(255,255,255,.04);
      border:2px dashed #262a34;
      color:#3a3f50;
    }

    /* قائمة اللاعبين */
    .dd-list-wrap {
      padding:12px 16px 0;
    }
    .dd-list-title {
      font-size:10px;color:#5a6070;letter-spacing:1px;
      font-weight:700;margin-bottom:8px;
      text-transform:uppercase;
    }
    .dd-player-row {
      display:flex;align-items:center;gap:8px;
      padding:10px;
      background:#14161b;border:1px solid #1f2229;
      border-radius:10px;margin-bottom:6px;
    }
    .dd-p-num {
      width:32px;height:32px;border-radius:8px;
      background:#1a1d24;display:flex;align-items:center;justify-content:center;
      flex-shrink:0;
    }
    .dd-p-num input {
      width:100%;background:transparent;border:none;outline:none;
      text-align:center;font-size:12px;font-weight:900;color:#C9A02B;
      font-family:Tajawal,sans-serif;
    }
    .dd-p-name input {
      background:transparent;border:none;outline:none;
      font-size:13px;font-weight:600;color:#e8eaf0;
      font-family:Tajawal,sans-serif;width:100%;
    }
    .dd-p-name input::placeholder { color:#3a3f50 }
    .dd-player-row { align-items:flex-start; }
    .dd-p-num, .dd-p-pos, .dd-p-status { margin-top:2px; }
    .dd-roster-select {
      width:100%;background:#1a1d24;border:1px solid #262a34;
      color:#7d8394;border-radius:7px;padding:5px 8px;
      font-family:Tajawal,sans-serif;font-size:10.5px;outline:none;
    }
    .dd-roster-select:focus { border-color:#C9A02B; color:#C9A02B; }
    .dd-p-pos select, .dd-p-status select {
      background:#1a1d24;border:1px solid #262a34;
      color:#9aa0b0;border-radius:7px;padding:5px 6px;
      font-family:Tajawal,sans-serif;font-size:10px;outline:none;
    }
    .dd-add-sub {
      width:100%;padding:10px;margin:8px 0 16px;
      background:transparent;border:1px dashed #262a34;
      border-radius:10px;color:#5a6070;font-family:Tajawal,sans-serif;
      font-size:12px;cursor:pointer;transition:all .2s;
    }
    .dd-add-sub:active { background:#14161b }

    /* Footer */
    .dd-footer {
      padding:14px 16px;
      border-top:1px solid #1f2229;
      position:sticky;bottom:0;background:#0f1115;
      display:flex;gap:8px;
    }
    .dd-save-btn {
      flex:1;padding:14px;
      background:linear-gradient(135deg,#C9A02B,#b8960e);
      color:#000;border:none;border-radius:12px;
      font-family:Tajawal,sans-serif;font-size:14px;font-weight:900;
      cursor:pointer;transition:opacity .2s;
    }
    .dd-save-btn:active { opacity:.8 }
    .dd-cancel-btn {
      padding:14px 18px;background:#14161b;
      border:1px solid #262a34;color:#9aa0b0;
      border-radius:12px;font-family:Tajawal,sans-serif;
      font-size:12px;cursor:pointer;
    }

    /* التعامل مع drop zone highlight */
    .dd-pitch.drag-over::after {
      content:'';position:absolute;inset:0;
      border:2px dashed rgba(201,160,43,.4);
      border-radius:10px;pointer-events:none;
    }
  `;
  document.head.appendChild(style);
})();

// ══ فتح المودال ══
window.openLineupDragDrop = function(matchId) {
  // إذا كانت openLineupModal موجودة من الملف الأصلي، override بهذا
  const matchesArr = window._adminMatches || [];
  // نحاول نجيب matches من state الأصلي
  const m = (window._adminMatchesRef || []).find(x => x.id === matchId)
         || (typeof matches !== 'undefined' ? matches.find(x => x.id === matchId) : null);

  if(!m) { alert('لم يتم إيجاد المباراة'); return; }

  _ddMatchId = matchId;

  // تهيئة البيانات من Firebase أو فارغة
  _ddHomeData = m.homeLineup
    ? JSON.parse(JSON.stringify(m.homeLineup))
    : { formation: null, players: [] };
  _ddAwayData = m.awayLineup
    ? JSON.parse(JSON.stringify(m.awayLineup))
    : { formation: null, players: [] };

  const ht = (typeof teams !== 'undefined' ? teams.find(t => t.id === m.homeId) : null)
          || { name: m.homeName || 'المضيف', logo: '⚽' };
  const at = (typeof teams !== 'undefined' ? teams.find(t => t.id === m.awayId) : null)
          || { name: m.awayName || 'الضيف', logo: '⚽' };

  // بناء المودال
  let modal = document.getElementById('ddModal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'ddModal';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  modal.innerHTML = `
    <div class="dd-modal-inner">
      <div class="dd-topbar">
        <div class="dd-title">👥 التشكيلة — ${ht.name} × ${at.name}</div>
        <button class="dd-close" onclick="closeLineupDragDrop()">✕ إغلاق</button>
      </div>
      <div class="dd-tabs">
        <button class="dd-tab active" id="ddTabHome" onclick="ddSwitchSide('home')">
          ${logoSmall(ht.logo)} ${ht.name}
        </button>
        <button class="dd-tab" id="ddTabAway" onclick="ddSwitchSide('away')">
          ${at.name} ${logoSmall(at.logo)}
        </button>
      </div>
      <div id="ddBody"></div>
      <div class="dd-footer">
        <button class="dd-save-btn" onclick="ddSaveToFirebase()">💾 حفظ للجمهور</button>
        <button class="dd-cancel-btn" onclick="closeLineupDragDrop()">إلغاء</button>
      </div>
    </div>`;

  _ddSide = 'home';
  // ── حمّل لاعبي الفريقين المسجّلين (من صفحة إدارة الفرق) لعرضهم في منتقي اللاعبين ──
  _ddRosterHome = (window._teamRosters && window._teamRosters[m.homeId]) || [];
  _ddRosterAway = (window._teamRosters && window._teamRosters[m.awayId]) || [];
  ddRenderBody();
  if (typeof window._loadTeamRoster === 'function') {
    Promise.all([
      window._loadTeamRoster(m.homeId),
      window._loadTeamRoster(m.awayId),
    ]).then(([homeList, awayList]) => {
      _ddRosterHome = homeList || [];
      _ddRosterAway = awayList || [];
      // أعد رسم قائمة اللاعبين فقط (بدون قطع سحب اللاعبين على الملعب إن كان جارياً)
      if (document.getElementById('ddModal')?.style.display === 'flex') ddRenderPlayersList();
    });
  }
};

window.closeLineupDragDrop = function() {
  const modal = document.getElementById('ddModal');
  if(modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  // تنظيف الـ listeners عند الإغلاق
  if(window._ddMouseMove) document.removeEventListener('mousemove', window._ddMouseMove);
  if(window._ddMouseUp)   document.removeEventListener('mouseup',   window._ddMouseUp);
  window._ddMouseMove = null;
  window._ddMouseUp   = null;
  _dragTarget = null;
};

// ══ تبديل الفريق ══
window.ddSwitchSide = function(side) {
  ddReadCurrentInputs(); // احفظ المدخلات الحالية
  _ddSide = side;
  document.getElementById('ddTabHome')?.classList.toggle('active', side === 'home');
  document.getElementById('ddTabAway')?.classList.toggle('active', side === 'away');
  ddRenderBody();
};

// ══ الحصول على بيانات الفريق الحالي ══
function ddCurrentData() {
  return _ddSide === 'home' ? _ddHomeData : _ddAwayData;
}

// ══ الحصول على عدد اللاعبين الحالي (أو الافتراضي 11) ══
function ddCurrentPlayerCount() {
  const data = ddCurrentData();
  return data.playerCount || 11;
}

// ══ رسم الجسم الكامل ══
function ddRenderBody() {
  const body = document.getElementById('ddBody');
  if(!body) return;
  const data = ddCurrentData();
  // ✅ حجم التشكيلة أصبح إعداداً عاماً على مستوى البطولة كاملة (من صفحة الإعدادات)
  // بدل الاختيار اليدوي في كل مباراة — يطبَّق تلقائياً هنا وفي صفحة الجمهور
  const globalSquadSize = (window.settings && window.settings.squadSize) || 11;
  const actualCount = DD_CONFIGS[globalSquadSize] ? globalSquadSize : 11;
  data.playerCount = actualCount; // ✅ يُثبَّت دائماً على قيمة إعدادات البطولة
  const cfg = DD_CONFIGS[actualCount] || DD_CONFIGS[11];

  // عرض معلوماتي فقط (بدون تغيير) — التحكم الفعلي من صفحة الإعدادات ← نظام التشكيلة
  const countInfo = `
    <div style="padding:8px 16px;border-bottom:1px solid #1f2229;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:10px;color:#5a6070">👕 نظام التشكيلة (من إعدادات البطولة)</div>
      <div style="font-size:12px;font-weight:900;color:#C9A02B">${actualCount} لاعبين</div>
    </div>`;

  // التشكيلة: إما محفوظة أو الافتراضية
  if(!_ddFormation || !cfg.formations[_ddFormation]) {
    _ddFormation = data.formation || cfg.default;
  }
  if(!cfg.formations[_ddFormation]) _ddFormation = cfg.default;

  const pitchSvg = DD_PITCH_SVGS[cfg.pitchType] || DD_PITCH_SVGS.full;
  const formationBtns = Object.keys(cfg.formations).map(f => `
    <button class="dd-f-btn ${f === _ddFormation ? 'active' : ''}"
      onclick="ddChangeFormation('${f}')">${f}
    </button>`).join('');

  // تهيئة المواضع للاعبين
  ddInitPositions(cfg, _ddFormation);

  body.innerHTML = `
    ${countInfo}
    <!-- أزرار التشكيلة -->
    <div class="dd-formations">${formationBtns}</div>

    <!-- الملعب -->
    <div class="dd-pitch-wrap">
      <div class="dd-pitch" id="ddPitch">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          style="position:absolute;inset:0;width:100%;height:100%">
          ${pitchSvg}
        </svg>
        <div id="ddPlayersOnPitch"></div>
      </div>
      <div style="text-align:center;margin-top:8px;font-size:10px;color:#5a6070">
        👆 اسحب اللاعبين لتغيير مواضعهم على الملعب
      </div>
    </div>

    <!-- قائمة اللاعبين -->
    <div class="dd-list-wrap" id="ddPlayersList"></div>
  `;

  ddRenderPitchPlayers();
  ddRenderPlayersList();
  ddAttachPitchEvents();
}

// ══ تهيئة المواضع ══
function ddInitPositions(cfg, formation) {
  const data = ddCurrentData();
  const defaultPos = cfg.formations[formation] || cfg.formations[cfg.default];

  // اللاعبون الأساسيون فقط (بدون بدلاء)
  const starters = data.players.filter(p => !p.isSub);
  const subs = data.players.filter(p => p.isSub);

  // ── الحصول على عدد اللاعبين المطلوب (من الإعدادات أو من playerCount) ──
  const targetCount = data.playerCount || defaultPos.length;

  // إذا عدد اللاعبين أقل من المواضع المستهدفة، أضف فراغات
  while(starters.length < targetCount) {
    starters.push({ name:'', number: starters.length + 1, position:'', status:'active', x:null, y:null });
  }

  // حدد المواضع الافتراضية للاعبين الذين ليس لهم موضع
  starters.forEach((p, i) => {
    if(p.x == null || p.y == null) {
      p.x = defaultPos[i]?.[0] ?? 50;
      p.y = defaultPos[i]?.[1] ?? 50;
    }
  });

  data.players = [...starters, ...subs];
  data.formation = formation;
  _ddFormation = formation;
}

// ══ رسم اللاعبين على الملعب ══
function ddRenderPitchPlayers() {
  const container = document.getElementById('ddPlayersOnPitch');
  if(!container) return;
  const data = ddCurrentData();
  const allStarters = data.players.filter(p => !p.isSub);
  // ── اخذ فقط اللاعبين الأساسيين حسب العدد المحدد ──
  const targetCount = data.playerCount || 11;
  const starters = allStarters.slice(0, targetCount);
  const isAway = _ddSide === 'away';

  container.innerHTML = starters.map((p, i) => {
    const x = p.x ?? 50;
    const y = p.y ?? 50;
    const isGK = i === 0 || p.position === 'GK';
    const num = p.number || (i + 1);
    const name = (p.name || '').split(' ').slice(-1)[0] || `لاعب ${i+1}`;
    const isEmpty = !p.name;

    return `<div class="dd-player-dot ${isEmpty ? 'dd-empty-dot' : ''}"
      id="ddDot-${i}"
      data-idx="${i}"
      style="left:${x}%;top:${y}%">
      <div class="dd-avatar ${isGK ? 'gk' : ''} ${isAway ? 'away' : ''}">
        ${num}
      </div>
      <div class="dd-name-tag">${isEmpty ? '؟' : name}</div>
    </div>`;
  }).join('');
}

// ══ رسم قائمة اللاعبين ══
function ddRenderPlayersList() {
const el = document.getElementById('ddPlayersList');
  if(!el) return;
  const data = ddCurrentData();
  const allStarters = data.players.filter(p => !p.isSub);
  // ── اخذ فقط اللاعبين الأساسيين حسب العدد المحدد ──
  const targetCount = data.playerCount || 11;
  const starters = allStarters.slice(0, targetCount);
  const subs = data.players.filter(p => p.isSub);

  // تعريف renderRow داخل الدالة لأنها تعتمد على data playerCount
  const renderRow = (p, i, isSub = false) => {
    const idxArg = isSub ? ("'sub-" + i + "'") : i; // ✅ اقتباس صحيح (كان يكسر onclick للبدلاء)
    const roster = _ddSide === 'home' ? _ddRosterHome : _ddRosterAway;
    const rosterOptions = (roster || []).map(rp =>
      `<option value="${rp.id}">${rp.number != null && rp.number !== '' ? '#' + rp.number + ' — ' : ''}${rp.name || '(بدون اسم)'}${rp.position ? ' · ' + rp.position : ''}</option>`
    ).join('');
    return `
    <div class="dd-player-row" data-idx="${isSub ? 'sub-'+i : i}">
      <div class="dd-p-num">
        <input type="number" min="1" max="99" value="${p.number || ''}"
          placeholder="#"
          onchange="ddUpdatePlayer(${idxArg}, 'number', this.value)"
        />
      </div>
      <div class="dd-p-name" style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input type="text"
          style="width:100%"
          value="${p.name || ''}"
          placeholder="${i === 0 && !isSub ? 'الحارس' : isSub ? 'بديل...' : 'اسم اللاعب...'}"
          onchange="ddUpdatePlayer(${idxArg}, 'name', this.value)"
          oninput="ddUpdatePlayer(${idxArg}, 'name', this.value); ddRefreshDot(${isSub ? -1 : i})"
        />
        <select class="dd-roster-select" onchange="_ddPickRosterPlayer(${idxArg}, this.value); this.selectedIndex=0;">
          <option value="" selected disabled>👥 اختر من لاعبي الفريق...</option>
          ${rosterOptions}
        </select>
      </div>
      <div class="dd-p-pos">
        <select onchange="ddUpdatePlayer(${idxArg}, 'position', this.value)">
          <option value="">مركز</option>
          ${['GK','CB','LB','RB','LWB','RWB','DM','CM','CAM','LM','RM','LW','RW','ST'].map(pos =>
            `<option value="${pos}" ${p.position===pos?'selected':''}>${pos}</option>`
          ).join('')}
        </select>
      </div>
      <div class="dd-p-status">
        <select onchange="ddUpdatePlayer(${idxArg}, 'status', this.value)"
          style="color:${p.status==='injured'?'#C0392B':p.status==='suspended'?'#C9A02B':p.status==='absent'?'#666':'#9aa0b0'}">
          <option value="active"   ${p.status==='active'||!p.status?'selected':''}>✅ متاح</option>
          <option value="injured"  ${p.status==='injured'?'selected':''}>🤕 مصاب</option>
          <option value="suspended"${p.status==='suspended'?'selected':''}>🟨 موقوف</option>
          <option value="absent"   ${p.status==='absent'?'selected':''}>❌ غائب</option>
        </select>
      </div>
    </div>`;
  };

  el.innerHTML = `
    <div class="dd-list-title">الأساسيون (${starters.length})</div>
    ${starters.map((p, i) => renderRow(p, i, false)).join('')}
    <div class="dd-list-title" style="margin-top:14px">البدلاء</div>
    ${subs.map((p, i) => renderRow(p, i, true)).join('')}
    <button class="dd-add-sub" onclick="ddAddSub()">+ إضافة بديل</button>
  `;
}

// ══ تحديث لاعب ══
window.ddUpdatePlayer = function(idx, field, value) {
  const data = ddCurrentData();
  const starters = data.players.filter(p => !p.isSub);
  const subs = data.players.filter(p => p.isSub);

  if(typeof idx === 'string' && idx.startsWith('sub-')) {
    const si = parseInt(idx.replace('sub-', ''));
    if(subs[si]) subs[si][field] = field === 'number' ? parseInt(value) || '' : value;
  } else {
    if(starters[idx]) starters[idx][field] = field === 'number' ? parseInt(value) || '' : value;
  }
  data.players = [...starters, ...subs];
};

// تحديث الاسم على الملعب مباشرة
window.ddRefreshDot = function(idx) {
  if(idx < 0) return;
  const data = ddCurrentData();
  const starters = data.players.filter(p => !p.isSub);
  const p = starters[idx]; if(!p) return;
  const dot = document.getElementById('ddDot-' + idx);
  if(!dot) return;
  const tag = dot.querySelector('.dd-name-tag');
  if(tag) tag.textContent = (p.name || '').split(' ').slice(-1)[0] || `لاعب ${idx+1}`;
  if(p.name) dot.classList.remove('dd-empty-dot');
  else dot.classList.add('dd-empty-dot');
};

window.ddAddSub = function() {
  const data = ddCurrentData();
  data.players.push({ name:'', number:'', position:'', status:'active', isSub:true });
  ddRenderPlayersList();
};

// ══ اختيار لاعب من قائمة الفريق المسجّلين (عبر select عادي — بدون أي طبقة/نافذة منفصلة) ══
window._ddPickRosterPlayer = function(idx, playerId) {
  if (!playerId) return;
  const roster = _ddSide === 'home' ? _ddRosterHome : _ddRosterAway;
  const p = (roster || []).find(x => x.id === playerId);
  if(!p) return;

  window.ddUpdatePlayer(idx, 'name', p.name || '');
  if(p.number !== '' && p.number != null) window.ddUpdatePlayer(idx, 'number', p.number);
  if(p.position) window.ddUpdatePlayer(idx, 'position', p.position);

  ddRenderPlayersList();
  if(typeof idx === 'number') { window.ddRefreshDot(idx); ddRenderPitchPlayers(); }
};

// ══ تغيير التشكيلة ══
window.ddChangeFormation = function(f) {
  ddReadCurrentInputs();
  const data = ddCurrentData();
  // ── استخدام playerCount المخزن ──
  const playerCount = data.playerCount || data.players.filter(p => !p.isSub).length || 11;
  const cfg = DD_CONFIGS[playerCount] || DD_CONFIGS[11];
  if(!cfg.formations[f]) return;
  _ddFormation = f;
  // أعد توزيع المواضع حسب التشكيلة الجديدة
  const starters = data.players.filter(p => !p.isSub);
  cfg.formations[f].forEach(([x, y], i) => {
    if(starters[i]) { starters[i].x = x; starters[i].y = y; }
  });
  ddRenderBody();
};

// ══ تغيير عدد اللاعبين ══
window.ddSetPlayerCount = function(count) {
  ddReadCurrentInputs();
  const data = ddCurrentData();
  const currentStarters = data.players.filter(p => !p.isSub);
  const currentSubs = data.players.filter(p => p.isSub);
  
  // تهيئة اللاعبين الأساسيين حسب العدد الجديد
  const newStarters = [];
  const usedFromSubs = []; // البدلاء المستخدمين كأساسيين
  
  for(let i = 0; i < count; i++) {
    if(currentStarters[i]) {
      newStarters.push({ ...currentStarters[i], isSub: false });
    } else if(currentSubs[i]) {
      // استخدم البدل إذا لم يكن هناك لاعب
      newStarters.push({ ...currentSubs[i], isSub: false });
      usedFromSubs.push(i);
    } else {
      // أضف فراغ
      newStarters.push({ name:'', number:'', position:'', status:'active', x:null, y:null, isSub:false });
    }
  }
  
  // البدلاء الباقين (مع إزالة الذين استُخدموا كأساسيين)
  const remainingSubs = currentSubs.filter((_, idx) => !usedFromSubs.includes(idx));
  
  // اللاعبون الزائدون من الأساسيين يصبحون بدلاء
  const excessStarters = currentStarters.slice(count).map(p => ({ ...p, isSub: true }));
  
  data.players = [...newStarters, ...remainingSubs, ...excessStarters].slice(0, 30);
  data.playerCount = count;
  ddRenderBody();
};

// ══ قراءة المدخلات الحالية ══
function ddReadCurrentInputs() {
  const data = ddCurrentData();
  const starters = data.players.filter(p => !p.isSub);
  starters.forEach((p, i) => {
    const row = document.querySelector(`[data-idx="${i}"]`);
    if(!row) return;
    const numEl  = row.querySelector('input[type="number"]');
    const nameEl = row.querySelector('input[type="text"]');
    const posEl  = row.querySelector('.dd-p-pos select');
    const stEl   = row.querySelector('.dd-p-status select');
    if(numEl)  p.number   = parseInt(numEl.value) || '';
    if(nameEl) p.name     = nameEl.value.trim();
    if(posEl)  p.position = posEl.value;
    if(stEl)   p.status   = stEl.value;
  });
  
  // ── قراءة البدلاء أيضاً ──
  const subs = data.players.filter(p => p.isSub);
  subs.forEach((p, i) => {
    const row = document.querySelector(`[data-idx="sub-${i}"]`);
    if(!row) return;
    const numEl  = row.querySelector('input[type="number"]');
    const nameEl = row.querySelector('input[type="text"]');
    const posEl  = row.querySelector('.dd-p-pos select');
    const stEl   = row.querySelector('.dd-p-status select');
    if(numEl)  p.number   = parseInt(numEl.value) || '';
    if(nameEl) p.name     = nameEl.value.trim();
    if(posEl)  p.position = posEl.value;
    if(stEl)   p.status   = stEl.value;
  });
}

// ══ DRAG & DROP — Touch + Mouse ══
function ddAttachPitchEvents() {
  const pitch = document.getElementById('ddPitch');
  if(!pitch) return;

  // ── TOUCH ──
  pitch.addEventListener('touchstart', e => {
    const dot = e.target.closest('.dd-player-dot');
    if(!dot) return;
    e.preventDefault();
    _pitchRect = pitch.getBoundingClientRect();
    const touch = e.touches[0];
    const dotRect = dot.getBoundingClientRect();
    _dragOffX = touch.clientX - dotRect.left - dotRect.width / 2;
    _dragOffY = touch.clientY - dotRect.top - dotRect.height / 2;
    _dragTarget = dot;
    dot.classList.add('dragging');
    pitch.classList.add('drag-over');
  }, { passive: false });

  pitch.addEventListener('touchmove', e => {
    if(!_dragTarget || !_pitchRect) return;
    e.preventDefault();
    const touch = e.touches[0];
    const x = ((touch.clientX - _dragOffX - _pitchRect.left) / _pitchRect.width  * 100);
    const y = ((touch.clientY - _dragOffY - _pitchRect.top)  / _pitchRect.height * 100);
    const cx = Math.max(6, Math.min(94, x));
    const cy = Math.max(4, Math.min(96, y));
    _dragTarget.style.left = cx + '%';
    _dragTarget.style.top  = cy + '%';
  }, { passive: false });

  pitch.addEventListener('touchend', e => {
    if(!_dragTarget) return;
    const idx = parseInt(_dragTarget.dataset.idx);
    const data = ddCurrentData();
    const starters = data.players.filter(p => !p.isSub);
    if(starters[idx]) {
      starters[idx].x = parseFloat(_dragTarget.style.left);
      starters[idx].y = parseFloat(_dragTarget.style.top);
    }
    _dragTarget.classList.remove('dragging');
    pitch.classList.remove('drag-over');
    _dragTarget = null;
  }, { passive: true });

  // ── MOUSE (ديسكتوب) ──
  pitch.addEventListener('mousedown', e => {
    const dot = e.target.closest('.dd-player-dot');
    if(!dot) return;
    e.preventDefault();
    _pitchRect = pitch.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    _dragOffX = e.clientX - dotRect.left - dotRect.width / 2;
    _dragOffY = e.clientY - dotRect.top  - dotRect.height / 2;
    _dragTarget = dot;
    dot.classList.add('dragging');
    pitch.classList.add('drag-over');
  });

  // إزالة الـ listeners القديمة قبل إضافة الجديدة لتجنب التراكم
  if(window._ddMouseMove) document.removeEventListener('mousemove', window._ddMouseMove);
  if(window._ddMouseUp)   document.removeEventListener('mouseup',   window._ddMouseUp);

  window._ddMouseMove = function(e) {
    if(!_dragTarget || !_pitchRect) return;
    const x = ((e.clientX - _dragOffX - _pitchRect.left) / _pitchRect.width  * 100);
    const y = ((e.clientY - _dragOffY - _pitchRect.top)  / _pitchRect.height * 100);
    const cx = Math.max(6, Math.min(94, x));
    const cy = Math.max(4, Math.min(96, y));
    _dragTarget.style.left = cx + '%';
    _dragTarget.style.top  = cy + '%';
  };

  window._ddMouseUp = function() {
    if(!_dragTarget) return;
    const idx = parseInt(_dragTarget.dataset.idx);
    const data = ddCurrentData();
    const starters = data.players.filter(p => !p.isSub);
    if(starters[idx]) {
      starters[idx].x = parseFloat(_dragTarget.style.left);
      starters[idx].y = parseFloat(_dragTarget.style.top);
    }
    _dragTarget.classList.remove('dragging');
    document.getElementById('ddPitch')?.classList.remove('drag-over');
    _dragTarget = null;
  };

  document.addEventListener('mousemove', window._ddMouseMove);
  document.addEventListener('mouseup',   window._ddMouseUp);
}

// ══ حفظ في Firebase ══
window.ddSaveToFirebase = async function() {
  if(!_ddMatchId) return;
  ddReadCurrentInputs();

  const LEAGUE_ID = _getLeagueId();
  if(!LEAGUE_ID) { alert('لم يتم تحديد البطولة'); return; }

  const btn = document.querySelector('.dd-save-btn');
  if(btn) { btn.textContent = '⏳ جاري الحفظ...'; btn.disabled = true; }

  const cleanPlayers = (data) => {
    const targetCount = data.playerCount || 11;
    const starters = data.players.filter(p => !p.isSub).slice(0, targetCount);
    const subs = data.players.filter(p => p.isSub);
    return {
      formation: data.formation || _ddFormation,
      playerCount: targetCount,
      players: [...starters, ...subs].map(p => ({
        name:     p.name     || '',
        number:   p.number   || '',
        position: p.position || '',
        status:   p.status   || 'active',
        x:        p.x != null ? Math.round(p.x * 10) / 10 : null,
        y:        p.y != null ? Math.round(p.y * 10) / 10 : null,
        isSub:    p.isSub    || false,
      })).filter(p => p.name || p.number),
      updatedAt: new Date().toISOString(),
    };
  };

  try {
    await _updateDoc(
      _doc(_db, 'leagues', LEAGUE_ID, 'matches', _ddMatchId),
      {
        homeLineup:       cleanPlayers(_ddHomeData),
        awayLineup:       cleanPlayers(_ddAwayData),
        lineupUpdatedAt:  _serverTs(),
      }
    );

    // تحديث الـ cache المحلي
    if(typeof matches !== 'undefined') {
      const m = matches.find(x => x.id === _ddMatchId);
      if(m) {
        m.homeLineup = cleanPlayers(_ddHomeData);
        m.awayLineup = cleanPlayers(_ddAwayData);
      }
    }

    if(typeof showToast === 'function')
      showToast('✅ تم حفظ التشكيلتين — ستظهر للجمهور فوراً', 'success');

    closeLineupDragDrop();
  } catch(e) {
    if(typeof showToast === 'function') showToast('❌ خطأ: ' + e.message, 'error');
    if(btn) { btn.textContent = '💾 حفظ للجمهور'; btn.disabled = false; }
  }
};

// ══ Override openLineupModal من الملف الأصلي ══
window.openLineupModal = window.openLineupDragDrop;

// ══ Helper: شعار صغير ══
function logoSmall(logo) {
  if(!logo) return '⚽';
  if(logo.startsWith('data:')||logo.startsWith('http')||logo.startsWith('/'))
    return `<img src="${logo}" style="width:18px;height:18px;border-radius:4px;object-fit:cover;vertical-align:middle"/>`;
  return `<span style="font-size:16px">${logo}</span>`;
}

console.log('✅ Admin Lineup Drag & Drop loaded');
