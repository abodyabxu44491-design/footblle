// ═══════════════════════════════════════════════════════════════════
//  live-page-stats-fix.js  v3
//
//  <script src="./live-page-stats-fix.js"></script>
//  أضفه آخر سكريبت في league-admin HTML
//
//  §1 — يحذف lp-col-side من DOM ويعيد CSS
//  §2 — يحذف بطاقة الإحصائيات القديمة
//  §3 — يبني بطاقة إحصائيات تفاعلية (9 إحصائيات + / −)
//       مع استرجاع القيم من Firebase عند كل فتح
//  §4 — زر "تفعيل / إيقاف الإحصائيات للجمهور"
//  §5 — الحفظ بكلا التنسيقَين + statsEnabled في liveData
//       حتى يظهر / يختفي قسم الإحصائيات في صفحة الجمهور
// ═══════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ══════════════════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════════════════
function injectCSS() {
  if (document.getElementById('_lpsf3_css')) return;
  var s = document.createElement('style');
  s.id = '_lpsf3_css';
  s.textContent = `
  /* §1 — إلغاء العمود الجانبي */
  .lp-col-side  { display: none !important; }
  .lp-body      { display: block !important; }
  .lp-col-main  { width: 100% !important; max-width: 700px; margin: 0 auto; }

  /* §2 — إخفاء البطاقة القديمة (live-page-enhancements) */
  .lp-stats-card { display: none !important; }

  /* ── بطاقة الإحصائيات ── */
  .lpsf3-card {
    background: var(--card2, #161616);
    border: 1px solid var(--border2, #2a2a2a);
    border-radius: 14px;
    padding: 14px;
    margin-top: 4px;
  }
  .lpsf3-head {
    display: flex; align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .lpsf3-title {
    font-size: 12px; font-weight: 900;
    color: var(--gold, #C9A02B);
  }
  .lpsf3-teams {
    font-size: 10px; color: var(--muted, #666);
    display: flex; gap: 5px; align-items: center;
  }
  .lpsf3-tname {
    color: var(--text, #eee); font-weight: 700;
    max-width: 70px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }

  /* صف إحصائية */
  .lpsf3-row {
    display: grid;
    grid-template-columns: 1fr 96px 1fr;
    align-items: center;
    gap: 6px; padding: 5px 0;
    border-bottom: 1px solid var(--border, #1e1e1e);
  }
  .lpsf3-row:last-child { border-bottom: none; }

  /* الجانبان */
  .lpsf3-side { display: flex; align-items: center; gap: 4px; }
  .lpsf3-side-h { justify-content: flex-end; }
  .lpsf3-side-a { justify-content: flex-start; }

  /* القيمة */
  .lpsf3-val {
    font-size: 15px; font-weight: 900;
    color: var(--gold, #C9A02B);
    min-width: 28px; text-align: center;
    font-family: Tajawal, sans-serif;
  }

  /* أزرار + − */
  .lpsf3-btn {
    width: 26px; height: 26px;
    border-radius: 7px;
    background: var(--card3, #1a1a1a);
    border: 1px solid var(--border2, #2a2a2a);
    color: var(--text, #eee);
    font-size: 15px; font-weight: 900;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-family: Tajawal, sans-serif; line-height: 1;
    transition: transform .1s, background .1s;
    flex-shrink: 0;
  }
  .lpsf3-btn:active { transform: scale(.85); background: var(--gold3, #3a2e0a); }

  /* الوسط */
  .lpsf3-mid { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .lpsf3-lbl { font-size: 9px; color: var(--muted, #666); white-space: nowrap; text-align: center; }

  /* شريط */
  .lpsf3-bar { width: 100%; height: 4px; background: var(--card3, #1a1a1a); border-radius: 2px; position: relative; overflow: hidden; }
  .lpsf3-bar-h { position: absolute; right:0; top:0; height:100%; background: var(--gold, #C9A02B); border-radius:2px; transition: width .3s; }
  .lpsf3-bar-a { position: absolute; left:0; top:0; height:100%; background: var(--muted2, #444); border-radius:2px; transition: width .3s; }

  /* زر التفعيل */
  .lpsf3-toggle-btn {
    width: 100%;
    padding: 10px 0;
    margin-top: 12px;
    border-radius: 10px;
    font-size: 12px; font-weight: 900;
    font-family: Tajawal, sans-serif;
    cursor: pointer;
    border: none;
    transition: all .2s;
  }
  .lpsf3-toggle-btn.enabled {
    background: rgba(39,174,96,.12);
    border: 1px solid rgba(39,174,96,.4);
    color: #27ae60;
  }
  .lpsf3-toggle-btn.disabled {
    background: rgba(192,57,43,.09);
    border: 1px solid rgba(192,57,43,.3);
    color: #C0392B;
  }
  `;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════════════════════════════
// تعريف الإحصائيات التسع
// ══════════════════════════════════════════════════════════════════
var STATS = [
  { key:'possession',    lKey:'home_possession', aLKey:'away_possession', label:'⚽ الاستحواذ',  pct:true  },
  { key:'shots',         lKey:'home_shots',      aLKey:'away_shots',      label:'🎯 التسديدات',  pct:false },
  { key:'shotsOnTarget', lKey:'home_shotsOnT',   aLKey:'away_shotsOnT',   label:'🥅 على المرمى', pct:false },
  { key:'corners',       lKey:'home_corners',    aLKey:'away_corners',    label:'⛳ الركنيات',   pct:false },
  { key:'fouls',         lKey:'home_fouls',      aLKey:'away_fouls',      label:'⚠️ الأخطاء',   pct:false },
  { key:'yellowCards',   lKey:'home_yellowCards',aLKey:'away_yellowCards',label:'🟨 الصفراء',   pct:false },
  { key:'redCards',      lKey:'home_redCards',   aLKey:'away_redCards',   label:'🟥 الحمراء',   pct:false },
  { key:'offsides',      lKey:'home_offsides',   aLKey:'away_offsides',   label:'🚩 التسلل',    pct:false },
  { key:'tackles',       lKey:'home_tackles',    aLKey:'away_tackles',    label:'🦵 التدخلات',  pct:false },
];

// ══════════════════════════════════════════════════════════════════
// §1 — تنظيف الصفحة
// ══════════════════════════════════════════════════════════════════
function cleanPage(matchId) {
  var page = document.getElementById('lp-' + matchId);
  if (!page) return;
  var side = page.querySelector('.lp-col-side');
  if (side) side.remove();
  page.querySelectorAll('.lp-stats-card').forEach(function(el) { el.remove(); });
}

// ══════════════════════════════════════════════════════════════════
// §2 — جلب بيانات liveData من Firebase (stats + statsEnabled)
// ══════════════════════════════════════════════════════════════════
function loadFromFirebase(matchId, callback) {
  var db        = window._db;
  var getDoc    = window._firestoreGetDoc;
  var docFn     = window._firestoreDoc;
  var LEAGUE_ID = window._getLeagueId ? window._getLeagueId() : '';
  if (!db || !getDoc || !docFn || !LEAGUE_ID) { callback({}, true); return; }

  getDoc(docFn(db, 'leagues', LEAGUE_ID, 'matches', matchId)).then(function(snap) {
    if (!snap.exists()) { callback({}, true); return; }
    var d  = snap.data();
    var ld = d.liveData || {};
    // ✅ إصلاح: اقرأ stats من liveData.stats أو من match.stats مباشرة
    var savedStats = (ld.stats && Object.keys(ld.stats).length) ? ld.stats
                   : (d.stats  && Object.keys(d.stats).length)  ? d.stats
                   : {};
    // ✅ إصلاح: statsEnabled = true افتراضياً (لا تختفي عند التحديث)
    var enabled = ld.statsEnabled !== false ? true : false;
    callback(savedStats, enabled);
  }).catch(function() { callback({}, true); });
}

// ══════════════════════════════════════════════════════════════════
// §3 — بناء بطاقة الإحصائيات
// ══════════════════════════════════════════════════════════════════
function buildCard(matchId, savedStats, statsEnabled) {
  // منع التكرار
  if (document.getElementById('lpsf3-card-' + matchId)) {
    _syncStateFromSaved(matchId, savedStats, statsEnabled);
    _updateAllUI(matchId);
    _updateToggleBtn(matchId);
    return;
  }

  var lm = window._liveMatches;
  if (!lm || !lm[matchId]) return;
  var st = lm[matchId];
  if (!st.stats) st.stats = {};

  // ✅ إصلاح: افتراضي true — تُظهر للجمهور فور وجود إحصائيات
  st.statsEnabled = statsEnabled !== false ? true : false;

  _syncStateFromSaved(matchId, savedStats, st.statsEnabled);

  var allMatches = window.matches || [];
  var m  = allMatches.find(function(x) { return x.id === matchId; });
  var allTeams = window.teams || [];
  var ht = allTeams.find(function(t) { return t.id === (m && m.homeId); }) || { name: (m && m.homeName) || 'المضيف' };
  var at = allTeams.find(function(t) { return t.id === (m && m.awayId); }) || { name: (m && m.awayName) || 'الضيف' };

  var card = document.createElement('div');
  card.className = 'lpsf3-card';
  card.id = 'lpsf3-card-' + matchId;

  var html = '<div class="lpsf3-head">'
    + '<div class="lpsf3-title">📊 الإحصائيات</div>'
    + '<div class="lpsf3-teams">'
    + '<span class="lpsf3-tname">' + ht.name + '</span>'
    + '<span style="opacity:.3">|</span>'
    + '<span class="lpsf3-tname">' + at.name + '</span>'
    + '</div></div>';

  STATS.forEach(function(def) {
    var hv  = st.stats[def.key + 'Home'] || 0;
    var av  = st.stats[def.key + 'Away'] || 0;
    var sfx = def.pct ? '%' : '';

    html += '<div class="lpsf3-row">'
      + '<div class="lpsf3-side lpsf3-side-h">'
      + '<span class="lpsf3-val" id="lpsf3-h-' + def.key + '-' + matchId + '">' + hv + sfx + '</span>'
      + '<button class="lpsf3-btn" onclick="lpsf3Dec(\'' + matchId + '\',\'' + def.key + '\',\'home\')">−</button>'
      + '<button class="lpsf3-btn" onclick="lpsf3Inc(\'' + matchId + '\',\'' + def.key + '\',\'home\')">+</button>'
      + '</div>'
      + '<div class="lpsf3-mid">'
      + '<div class="lpsf3-lbl">' + def.label + '</div>'
      + '<div class="lpsf3-bar">'
      + '<div class="lpsf3-bar-h" id="lpsf3-bh-' + def.key + '-' + matchId + '" style="width:' + _pct(hv,av) + '%"></div>'
      + '<div class="lpsf3-bar-a" id="lpsf3-ba-' + def.key + '-' + matchId + '" style="width:' + _pct(av,hv) + '%"></div>'
      + '</div></div>'
      + '<div class="lpsf3-side lpsf3-side-a">'
      + '<button class="lpsf3-btn" onclick="lpsf3Dec(\'' + matchId + '\',\'' + def.key + '\',\'away\')">−</button>'
      + '<button class="lpsf3-btn" onclick="lpsf3Inc(\'' + matchId + '\',\'' + def.key + '\',\'away\')">+</button>'
      + '<span class="lpsf3-val" id="lpsf3-a-' + def.key + '-' + matchId + '">' + av + sfx + '</span>'
      + '</div>'
      + '</div>';
  });

  // زر التفعيل/إيقاف للجمهور
  var isEnabled = st.statsEnabled !== false;
  html += '<button class="lpsf3-toggle-btn ' + (isEnabled ? 'enabled' : 'disabled') + '" '
    + 'id="lpsf3-toggle-' + matchId + '" '
    + 'onclick="lpsf3ToggleStats(\'' + matchId + '\')">'
    + (isEnabled ? '✅ الإحصائيات مفعّلة للجمهور — اضغط لإيقافها'
                 : '⭕ الإحصائيات مخفية عن الجمهور — اضغط لتفعيلها')
    + '</button>';

  card.innerHTML = html;

  var page = document.getElementById('lp-' + matchId);
  if (!page) return;
  var evLog = page.querySelector('.lp-events-log');
  if (evLog) evLog.insertAdjacentElement('afterend', card);
  else {
    var mainCol = page.querySelector('.lp-col-main');
    if (mainCol) mainCol.appendChild(card);
  }
}

// مزامنة state من القيم المحفوظة — يدعم كلا التنسيقَين
function _syncStateFromSaved(matchId, savedStats, statsEnabled) {
  var lm = window._liveMatches;
  if (!lm || !lm[matchId]) return;
  var st = lm[matchId];
  if (!st.stats) st.stats = {};
  st.statsEnabled = (statsEnabled !== false);

  STATS.forEach(function(def) {
    // تنسيق جديد: shotsHome / shotsAway
    var hv = savedStats[def.key + 'Home'] != null ? savedStats[def.key + 'Home']
    // تنسيق قديم: home_shots / away_shots
           : savedStats[def.lKey]         != null ? savedStats[def.lKey]
           : null;
    var av = savedStats[def.key + 'Away'] != null ? savedStats[def.key + 'Away']
           : savedStats[def.aLKey]        != null ? savedStats[def.aLKey]
           : null;
    // احفظ دائماً بالتنسيق الجديد في state
    if (hv != null) st.stats[def.key + 'Home'] = hv;
    if (av != null) st.stats[def.key + 'Away'] = av;
  });
}

// ── helpers ──
function _pct(v, o) { var t = v+o; return t ? Math.round(v/t*100) : 50; }

function _updateRowUI(matchId, def) {
  var st = window._liveMatches && window._liveMatches[matchId];
  if (!st) return;
  var hv  = st.stats[def.key + 'Home'] || 0;
  var av  = st.stats[def.key + 'Away'] || 0;
  var sfx = def.pct ? '%' : '';
  var hEl  = document.getElementById('lpsf3-h-'  + def.key + '-' + matchId);
  var aEl  = document.getElementById('lpsf3-a-'  + def.key + '-' + matchId);
  var bhEl = document.getElementById('lpsf3-bh-' + def.key + '-' + matchId);
  var baEl = document.getElementById('lpsf3-ba-' + def.key + '-' + matchId);
  if (hEl)  hEl.textContent  = hv + sfx;
  if (aEl)  aEl.textContent  = av + sfx;
  if (bhEl) bhEl.style.width = _pct(hv,av) + '%';
  if (baEl) baEl.style.width = _pct(av,hv) + '%';
}

function _updateAllUI(matchId) {
  STATS.forEach(function(def) { _updateRowUI(matchId, def); });
}

function _updateToggleBtn(matchId) {
  var st  = window._liveMatches && window._liveMatches[matchId];
  var btn = document.getElementById('lpsf3-toggle-' + matchId);
  if (!btn) return;
  // ✅ افتراضي: true (مُفعَّل) — لا تختفي الإحصائيات عند التحديث
  var on = !st || st.statsEnabled !== false;
  btn.className = 'lpsf3-toggle-btn ' + (on ? 'enabled' : 'disabled');
  btn.textContent = on
    ? '✅ الإحصائيات مفعّلة للجمهور — اضغط لإيقافها'
    : '⭕ الإحصائيات مخفية عن الجمهور — اضغط لتفعيلها';
}

// ══════════════════════════════════════════════════════════════════
// §4 — زيادة / تخفيض
// ══════════════════════════════════════════════════════════════════
window.lpsf3Inc = function(matchId, key, side) { _change(matchId, key, side, +1); };
window.lpsf3Dec = function(matchId, key, side) { _change(matchId, key, side, -1); };

function _change(matchId, key, side, delta) {
  var st = window._liveMatches && window._liveMatches[matchId];
  if (!st) return;
  if (!st.stats) st.stats = {};
  var def = STATS.find(function(d) { return d.key === key; });
  var hF  = key + 'Home';
  var aF  = key + 'Away';

  if (def && def.pct) {
    // استحواذ: مجموع = 100
    if (side === 'home') {
      st.stats[hF] = Math.min(100, Math.max(0, (st.stats[hF]||0) + delta));
      st.stats[aF] = 100 - st.stats[hF];
    } else {
      st.stats[aF] = Math.min(100, Math.max(0, (st.stats[aF]||0) + delta));
      st.stats[hF] = 100 - st.stats[aF];
    }
    _updateRowUI(matchId, def);
    // تحديث الجانب الآخر أيضاً (الاستحواذ يظهر رقمَين)
    _updateRowUI(matchId, def);
  } else {
    var f = side === 'home' ? hF : aF;
    st.stats[f] = Math.max(0, (st.stats[f]||0) + delta);
    if (def) _updateRowUI(matchId, def);
  }

  _debounce(matchId);
}

// ══════════════════════════════════════════════════════════════════
// §4 — تفعيل / إيقاف الإحصائيات للجمهور
// ══════════════════════════════════════════════════════════════════
window.lpsf3ToggleStats = async function(matchId) {
  var st = window._liveMatches && window._liveMatches[matchId];
  if (!st) return;
  st.statsEnabled = !(st.statsEnabled === true);
  _updateToggleBtn(matchId);
  await _doSave(matchId);
  if (window.showToast) {
    window.showToast(
      st.statsEnabled ? '✅ الإحصائيات مفعّلة للجمهور' : '⭕ الإحصائيات أُخفيت عن الجمهور',
      'success'
    );
  }
};

// ══════════════════════════════════════════════════════════════════
// §5 — الحفظ
// ══════════════════════════════════════════════════════════════════
var _timers = {};
function _debounce(matchId) {
  clearTimeout(_timers[matchId]);
  _timers[matchId] = setTimeout(function() { _doSave(matchId); }, 800);
}

async function _doSave(matchId) {
  var st = window._liveMatches && window._liveMatches[matchId];
  if (!st) return;

  var LEAGUE_ID = window._getLeagueId ? window._getLeagueId() : '';
  if (!LEAGUE_ID) return;

  var db        = window._db;
  var updateDoc = window._firestoreUpdateDoc;
  var docFn     = window._firestoreDoc;
  var srvTs     = window._serverTimestamp;
  if (!db || !updateDoc || !docFn) return;

  // بناء كائن stats بكلا التنسيقَين
  var statsObj = {};
  var hasAnyVal = false;
  STATS.forEach(function(def) {
    var hv = st.stats ? st.stats[def.key + 'Home'] : null;
    var av = st.stats ? st.stats[def.key + 'Away'] : null;
    if (hv != null && hv !== 0) {
      statsObj[def.key + 'Home'] = hv;
      statsObj[def.lKey]         = hv;
      hasAnyVal = true;
    } else if (hv === 0) {
      statsObj[def.key + 'Home'] = 0;
      statsObj[def.lKey]         = 0;
    }
    if (av != null && av !== 0) {
      statsObj[def.key + 'Away'] = av;
      statsObj[def.aLKey]        = av;
      hasAnyVal = true;
    } else if (av === 0) {
      statsObj[def.key + 'Away'] = 0;
      statsObj[def.aLKey]        = 0;
    }
  });

  // ✅ إصلاح: تُفعَّل تلقائياً عند وجود أي قيمة
  if (hasAnyVal && st.statsEnabled !== false) {
    st.statsEnabled = true;
    _updateToggleBtn(matchId);
  }

  var saveEl = document.getElementById('lp-save-' + matchId);
  if (saveEl) saveEl.textContent = '⏳';

  try {
    var ref     = docFn(db, 'leagues', LEAGUE_ID, 'matches', matchId);
    var payload = {
      'liveData.stats':        statsObj,
      'liveData.statsEnabled': st.statsEnabled !== false,
    };
    if (srvTs) payload.updatedAt = srvTs();
    await updateDoc(ref, payload);

    if (saveEl) {
      saveEl.textContent = '✅';
      setTimeout(function() { if (saveEl) saveEl.textContent = ''; }, 1800);
    }
  } catch(e) {
    if (saveEl) saveEl.textContent = '❌';
    console.error('[lpsf3] save error', e);
  }
}

// ══════════════════════════════════════════════════════════════════
// الربط: تطبيق عند فتح صفحة البث
// ══════════════════════════════════════════════════════════════════
function applyToPage(matchId) {
  setTimeout(function() {
    cleanPage(matchId);
    loadFromFirebase(matchId, function(savedStats, statsEnabled) {
      buildCard(matchId, savedStats, statsEnabled);
    });
  }, 160);
}

function watchOpen() {
  if (window._lpsf3_watched) return;
  window._lpsf3_watched = true;

  function tryPatch() {
    if (typeof window.openLivePage !== 'function') { setTimeout(tryPatch, 300); return; }
    var orig = window.openLivePage;
    window.openLivePage = function(matchId) {
      orig(matchId);
      applyToPage(matchId);
    };
  }
  tryPatch();
}

// ══════════════════════════════════════════════════════════════════
// تشغيل
// ══════════════════════════════════════════════════════════════════
function run() {
  injectCSS();
  watchOpen();
  // صفحات مفتوحة مسبقاً
  document.querySelectorAll('.live-page-overlay.lp-active').forEach(function(el) {
    var mid = el.id.replace(/^lp-/, '');
    if (mid) applyToPage(mid);
  });
  console.log('[live-page-stats-fix v3] ✅');
}

function waitAndRun() {
  var ready = typeof window._liveMatches !== 'undefined'
           || typeof window.openLivePage === 'function';
  if (!ready) { setTimeout(waitAndRun, 300); return; }
  run();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setTimeout(waitAndRun, 400); });
} else {
  setTimeout(waitAndRun, 400);
}

})();
