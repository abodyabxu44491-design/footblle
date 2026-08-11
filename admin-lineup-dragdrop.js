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
let _ddShowBench = true; // هل تظهر الدكة للجمهور؟ (يُحفظ داخل التشكيلة)
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

// ══ SVG الملاعب — عمق احترافي (تدرّج عشب + شرائح جزّ + خطوط بيضاء نقية) ══
function _ddDefs(nStripes) {
  let stripes = '';
  const h = 94 / nStripes;
  for (let i = 0; i < nStripes; i++) {
    const op = i % 2 === 0 ? 0.00 : 0.07;
    stripes += `<rect x="0" y="${(3 + i * h).toFixed(2)}%" width="100%" height="${h.toFixed(2)}%" fill="#ffffff" opacity="${op}"/>`;
  }
  return `<defs>
    <linearGradient id="ddGrass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12401a"/><stop offset=".5" stop-color="#0e3517"/><stop offset="1" stop-color="#0a2b12"/>
    </linearGradient>
    <radialGradient id="ddGlow" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#1a5226" stop-opacity=".5"/><stop offset="1" stop-color="#0a2b12" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#ddGrass)"/>
  <rect width="100%" height="100%" fill="url(#ddGlow)"/>
  ${stripes}`;
}
function _ddLines(o) {
  const L='rgba(255,255,255,.42)', Lf='rgba(255,255,255,.28)', sw='0.5';
  const bx=(100-o.boxW)/2, sx=(100-o.sixW)/2;
  return `
    <rect x="5%" y="3%" width="90%" height="94%" stroke="${L}" stroke-width="${sw}" fill="none" rx="1"/>
    <line x1="5%" y1="50%" x2="95%" y2="50%" stroke="${L}" stroke-width="${sw}"/>
    <circle cx="50%" cy="50%" r="${o.centerR}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
    <circle cx="50%" cy="50%" r="0.9%" fill="${L}"/>
    <rect x="${bx}%" y="3%" width="${o.boxW}%" height="${o.boxH}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
    <rect x="${sx}%" y="3%" width="${o.sixW}%" height="${o.sixH}%" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
    <rect x="${bx}%" y="${97-o.boxH}%" width="${o.boxW}%" height="${o.boxH}%" stroke="${L}" stroke-width="${sw}" fill="none"/>
    <rect x="${sx}%" y="${97-o.sixH}%" width="${o.sixW}%" height="${o.sixH}%" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
    ${o.spot?`<circle cx="50%" cy="${3+o.boxH-o.spot}%" r="0.7%" fill="${L}"/><circle cx="50%" cy="${97-o.boxH+o.spot}%" r="0.7%" fill="${L}"/>`:''}
    <path d="M5 5 A2 2 0 0 1 7 3" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
    <path d="M93 3 A2 2 0 0 1 95 5" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
    <path d="M5 95 A2 2 0 0 0 7 97" stroke="${Lf}" stroke-width="${sw}" fill="none"/>
    <path d="M93 97 A2 2 0 0 0 95 95" stroke="${Lf}" stroke-width="${sw}" fill="none"/>`;
}
const DD_PITCH_SVGS = {
  futsal: _ddDefs(8)  + _ddLines({ boxW:48, boxH:16, sixW:24, sixH:7, centerR:12, spot:0 }),
  seven:  _ddDefs(10) + _ddLines({ boxW:60, boxH:18, sixW:30, sixH:8, centerR:13, spot:9 }),
  full:   _ddDefs(12) + _ddLines({ boxW:56, boxH:16, sixW:28, sixH:7, centerR:14, spot:9 }),
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
      aspect-ratio:9/15;
      max-height:520px;
      border-radius:14px;
      overflow:hidden;
      touch-action:none;
      user-select:none;
      background:#0a2b12;
      box-shadow:0 8px 28px rgba(0,0,0,.4),inset 0 0 60px rgba(0,0,0,.25);
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
    .dd-avatar {
      position:relative;
      width:42px;height:42px;border-radius:50%;
      background:linear-gradient(145deg,#e6c157,#b8860b);
      padding:2px;
      display:flex;align-items:center;justify-content:center;
      font-size:14px;font-weight:900;color:#1a1200;
      font-family:Tajawal,sans-serif;line-height:1;
      box-shadow:0 3px 9px rgba(0,0,0,.5);
      transition:transform .15s;
    }
    .dd-avatar::before{
      content:'';position:absolute;inset:2px;border-radius:50%;
      background:radial-gradient(circle at 50% 35%,#1c2740,#0d1526);z-index:0;
    }
    .dd-avatar > *{position:relative;z-index:1}
    .dd-avatar.has-photo::before{inset:2px}
    .dd-av-sil{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#e6c157}
    .dd-avatar.gk{ background:linear-gradient(145deg,#a86bd6,#7b3fb0) }
    .dd-avatar.gk .dd-av-sil{ color:#CE9FFC }
    .dd-avatar.away{ background:linear-gradient(145deg,#e5645a,#a52a1e) }
    .dd-avatar.away .dd-av-sil{ color:#ff9a90 }
    .dd-av-num{
      position:absolute;bottom:-3px;right:-3px;z-index:2;
      background:linear-gradient(145deg,#e6c157,#b8860b);color:#1a1200;
      font-size:9px;font-weight:900;border-radius:999px;
      min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;
      padding:0 3px;border:2px solid #0a2b12;box-shadow:0 1px 3px rgba(0,0,0,.5);
    }
    .dd-avatar.gk .dd-av-num{ background:linear-gradient(145deg,#a86bd6,#7b3fb0);color:#fff }
    .dd-avatar.away .dd-av-num{ background:linear-gradient(145deg,#e5645a,#a52a1e);color:#fff }
    .dd-name-tag {
      font-size:9px;font-weight:800;color:#fff;
      background:linear-gradient(180deg,rgba(10,20,10,.82),rgba(10,20,10,.92));
      border:1px solid rgba(255,255,255,.08);border-radius:5px;
      padding:2px 7px;white-space:nowrap;
      max-width:66px;overflow:hidden;text-overflow:ellipsis;
      text-align:center;pointer-events:none;
      box-shadow:0 2px 5px rgba(0,0,0,.4);
    }
    .dd-empty-dot .dd-avatar {
      background:rgba(255,255,255,.06);
      padding:0;border:2px dashed #3a4050;
      color:#5a6070;box-shadow:none;
    }
    .dd-empty-dot .dd-avatar::before{ display:none }
    .dd-player-dot.dragging .dd-avatar{ transform:scale(1.15) }

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
    .dd-bench-toggle{ padding:9px 12px; border-radius:10px; border:1px solid var(--border2,#2a2a2a);
      background:var(--card2,#1a1a1a); color:var(--muted,#888); font-family:Tajawal,sans-serif;
      font-weight:800; font-size:11.5px; cursor:pointer; transition:.15s }
    .dd-bench-toggle.dd-bench-on{ border-color:rgba(39,174,96,.4); background:rgba(39,174,96,.12); color:#2ecc71 }
    .dd-bench-toggle:active{ opacity:.8 }
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

  // حالة إظهار الدكة: من التشكيلة المحفوظة (افتراضياً تظهر)
  _ddShowBench = (m.homeLineup && m.homeLineup.showBench === false) ? false : true;

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
        <button class="dd-bench-toggle" id="ddBenchToggle" onclick="ddToggleBench()">
          <span id="ddBenchToggleTxt">🪑 إظهار البدلاء للجمهور: —</span>
        </button>
        <button class="dd-save-btn" onclick="ddSaveToFirebase()">💾 حفظ للجمهور</button>
        <button class="dd-cancel-btn" onclick="closeLineupDragDrop()">إلغاء</button>
      </div>
    </div>`;

  _ddSide = 'home';
  // ── حمّل لاعبي الفريقين المسجّلين (من صفحة إدارة الفرق) لعرضهم في منتقي اللاعبين ──
  _ddRosterHome = (window._teamRosters && window._teamRosters[m.homeId]) || [];
  _ddRosterAway = (window._teamRosters && window._teamRosters[m.awayId]) || [];
  ddRenderBody();
  ddUpdateBenchToggle();
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

  // كشف الفريق الحالي لجلب صور اللاعبين (بالهوية أو بالاسم)
  const _roster = _ddSide === 'home' ? (_ddRosterHome || []) : (_ddRosterAway || []);
  const _norm = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const _photoOf = (p) => {
    if (!_roster.length) return '';
    if (p.id) { const h = _roster.find(x => x && x.id === p.id); if (h && h.photo) return h.photo; }
    if (p.name) { const n = _norm(p.name); const h = _roster.find(x => x && _norm(x.name) === n && x.photo); if (h) return h.photo; }
    return '';
  };
  const _sil = `<svg viewBox="0 0 24 24" width="62%" height="62%" fill="currentColor" style="opacity:.85"><circle cx="12" cy="8" r="4"></circle><path d="M12 14c-4.4 0-8 2.6-8 5.8V22h16v-2.2C20 16.6 16.4 14 12 14z"></path></svg>`;

  container.innerHTML = starters.map((p, i) => {
    const x = p.x ?? 50;
    const y = p.y ?? 50;
    const isGK = i === 0 || p.position === 'GK';
    const num = p.number || (i + 1);
    const name = (p.name || '').split(' ').slice(-1)[0] || `لاعب ${i+1}`;
    const isEmpty = !p.name;
    const photo = isEmpty ? '' : _photoOf(p);
    const inner = photo
      ? `<img src="${photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;pointer-events:none">`
      : (isEmpty ? num : `<div class="dd-av-sil">${_sil}</div>`);

    return `<div class="dd-player-dot ${isEmpty ? 'dd-empty-dot' : ''}"
      id="ddDot-${i}"
      data-idx="${i}"
      style="left:${x}%;top:${y}%">
      <div class="dd-avatar ${isGK ? 'gk' : ''} ${isAway ? 'away' : ''} ${photo?'has-photo':''}">
        ${inner}
        ${isEmpty ? '' : `<span class="dd-av-num">${num}</span>`}
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
  window.ddUpdatePlayer(idx, 'id', p.id || null); // ✅︎ ربط الهوية كي يتبع تعديل الاسم
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
// ── تبديل إظهار الدكة للجمهور ──
window.ddToggleBench = function() {
  _ddShowBench = !_ddShowBench;
  ddUpdateBenchToggle();
};
function ddUpdateBenchToggle() {
  const txt = document.getElementById('ddBenchToggleTxt');
  const btn = document.getElementById('ddBenchToggle');
  if (txt) txt.textContent = _ddShowBench
    ? '🪑 إظهار البدلاء للجمهور: نعم'
    : '🪑 إظهار البدلاء للجمهور: لا';
  if (btn) btn.classList.toggle('dd-bench-on', _ddShowBench);
}

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
      showBench: _ddShowBench,
      players: [...starters, ...subs].map(p => ({
        name:     p.name     || '',
        id:       p.id       || null,
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

// console.log('✅ Admin Lineup Drag & Drop loaded');
