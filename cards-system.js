// ═══════════════════════════════════════════════════════════════════
//  cards-system.js  v4 — نظام البطاقات الاحترافي مع هوية موحدة
//  أضفه بعد admin_new.js في league-admin.html:
//  <script src="./cards-system.js"></script>
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── ثوابت التصميم ────────────────────────────────────────────────
  const GOLD   = '#C9A02B';
  const GOLD2  = '#F0C84A';
  const DARK   = '#080808';

  // ─── ألوان نوع البطاقة ────────────────────────────────────────────
  const TYPE_COLORS = {
    prematch:  { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.35)',  text: '#60a5fa',  label: '⚽ بطاقة مباراة'   },
    postmatch: { bg: 'rgba(201,160,43,0.10)',  border: 'rgba(201,160,43,0.35)',  text: '#F0C84A',  label: '🏁 نتيجة مباراة'  },
    mom:       { bg: 'rgba(168,85,247,0.10)',  border: 'rgba(168,85,247,0.35)',  text: '#c084fc',  label: '🌟 رجل المباراة'  },
    qual:      { bg: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.35)',   text: '#4ade80',  label: '🏆 بطاقة تأهل'    },
  };

  // ─── CSS القسم ────────────────────────────────────────────────────
  const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;900&display=swap');

  #page-cards { padding: 0 !important; background: transparent; }

  /* ── قسم هوية البطولة (ثابت أعلى الصفحة) ── */
  .cs-identity-panel {
    background: linear-gradient(135deg, #0d0d0d 0%, #141000 100%);
    border-bottom: 1px solid rgba(201,160,43,.15);
    padding: 14px 16px;
  }
  .cs-identity-label {
    font-size: 9px; font-weight: 700; color: #555;
    text-transform: uppercase; letter-spacing: 1.2px;
    font-family: Tajawal, sans-serif; margin-bottom: 10px;
  }
  .cs-identity-row {
    display: flex; align-items: center; gap: 10px;
  }
  /* شعار البطولة — مربع كبير قابل للنقر */
  .cs-id-logo-wrap {
    width: 56px; height: 56px; border-radius: 12px;
    background: rgba(201,160,43,.07);
    border: 1px dashed rgba(201,160,43,.3);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; flex-shrink: 0; cursor: pointer;
    position: relative; transition: all .2s;
  }
  .cs-id-logo-wrap:hover { border-color: rgba(201,160,43,.6); background: rgba(201,160,43,.12); }
  .cs-id-logo-wrap img { width: 100%; height: 100%; object-fit: cover; border-radius: 11px; }
  .cs-id-logo-wrap .cs-id-logo-placeholder { font-size: 24px; }
  .cs-id-logo-wrap input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .cs-id-logo-edit {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: rgba(0,0,0,.7); font-size: 8px; font-weight: 700;
    color: ${GOLD}; text-align: center; padding: 2px 0;
    font-family: Tajawal, sans-serif;
    opacity: 0; transition: opacity .2s;
  }
  .cs-id-logo-wrap:hover .cs-id-logo-edit { opacity: 1; }

  .cs-id-info { flex: 1; min-width: 0; }
  .cs-id-name-input {
    width: 100%; background: rgba(255,255,255,0.05);
    border: 1px solid rgba(201,160,43,.25); border-radius: 8px;
    padding: 5px 9px; color: #eee; font-size: 14px; font-weight: 900;
    font-family: Tajawal, sans-serif; outline: none; box-sizing: border-box;
    transition: border-color .2s;
  }
  .cs-id-name-input:focus { border-color: rgba(201,160,43,.6); background: rgba(255,255,255,0.07); }
  .cs-id-name-input::placeholder { color: #444; font-weight: 400; }
  .cs-id-sub { font-size: 10px; color: #555; margin-top: 4px; font-family: Tajawal, sans-serif; }

  /* ألوان هوية البطولة */
  .cs-id-colors { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .cs-id-colors-label { font-size: 9px; color: #555; font-family: Tajawal, sans-serif; }
  .cs-id-swatch {
    width: 20px; height: 20px; border-radius: 5px;
    cursor: pointer; border: 2px solid transparent;
    transition: all .15s; flex-shrink: 0;
  }
  .cs-id-swatch.active { border-color: #fff; transform: scale(1.2); }
  .cs-id-custom {
    width: 20px; height: 20px; border-radius: 5px;
    border: 1.5px dashed rgba(255,255,255,.25);
    cursor: pointer; overflow: hidden; position: relative;
    background: linear-gradient(135deg,#222,#333);
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #888;
  }
  .cs-id-custom input[type=color] {
    position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
  }

  /* ── Header القسم (اسم البطولة وزر الإعدادات) ── */
  .cs-header {
    background: linear-gradient(135deg, #0d0d0d 0%, #1a1400 100%);
    border-bottom: 1px solid rgba(201,160,43,.2);
    padding: 12px 16px;
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 10px;
  }
  .cs-header-league-logo {
    width: 30px; height: 30px; border-radius: 7px;
    object-fit: cover; border: 1px solid rgba(201,160,43,.3);
    background: rgba(201,160,43,.06); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; font-size: 16px;
  }
  .cs-header-league-logo img { width: 100%; height: 100%; object-fit: cover; }
  .cs-header-text { flex: 1; min-width: 0; }
  .cs-header-title {
    font-size: 14px; font-weight: 900;
    color: ${GOLD}; font-family: Tajawal, sans-serif;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cs-header-sub { font-size: 10px; color: #555; margin-top: 1px; font-family: Tajawal,sans-serif; }

  /* ── Tabs ── */
  .cs-tabs {
    display: flex; gap: 4px;
    padding: 10px 16px 0;
    border-bottom: 1px solid rgba(255,255,255,.06);
    background: #0d0d0d;
  }
  .cs-tab {
    flex: 1; padding: 9px 4px; text-align: center;
    font-size: 12px; font-weight: 700; color: #555;
    border: none; background: transparent;
    border-bottom: 2px solid transparent;
    cursor: pointer; font-family: Tajawal, sans-serif; transition: all .2s;
  }
  .cs-tab.active { color: ${GOLD}; border-bottom-color: ${GOLD}; }

  /* ── قائمة المباريات ── */
  .cs-matches-wrap { padding: 12px 16px; }
  .cs-match-item {
    display: flex; align-items: center; gap: 10px;
    background: #0f0f0f; border: 1px solid rgba(255,255,255,.06);
    border-radius: 14px; padding: 11px 13px;
    margin-bottom: 8px; cursor: pointer;
    transition: all .2s; position: relative; overflow: hidden;
  }
  .cs-match-item::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px; background: transparent; transition: background .2s;
  }
  .cs-match-item:hover { border-color: rgba(201,160,43,.3); background: #141414; }
  .cs-match-item:hover::before { background: ${GOLD}; }
  .cs-match-item.upcoming::before { background: #3b82f6; }
  .cs-match-item.live::before { background: #ef4444; }
  .cs-match-item.finished::before { background: ${GOLD}; }
  .cs-match-teams-logos { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .cs-match-team-logo {
    width: 28px; height: 28px; border-radius: 6px;
    object-fit: cover; background: #1a1a1a;
    border: 1px solid rgba(255,255,255,.06);
  }
  .cs-match-vs-dot { font-size: 9px; color: #444; font-weight: 700; }
  .cs-match-teams { flex: 1; min-width: 0; }
  .cs-match-names {
    font-size: 13px; font-weight: 700; color: #eee;
    font-family: Tajawal, sans-serif; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .cs-match-meta { font-size: 10px; color: #555; margin-top: 2px; }
  .cs-match-score {
    font-size: 17px; font-weight: 900; color: ${GOLD};
    font-family: Tajawal, sans-serif; min-width: 50px; text-align: center; flex-shrink: 0;
  }
  .cs-match-badge {
    font-size: 9px; font-weight: 700; padding: 2px 7px;
    border-radius: 20px; white-space: nowrap; flex-shrink: 0;
  }
  .cs-match-badge.upcoming { background: rgba(59,130,246,.1); color: #60a5fa; border: 1px solid rgba(59,130,246,.2); }
  .cs-match-badge.live     { background: rgba(239,68,68,.1);  color: #f87171; border: 1px solid rgba(239,68,68,.2); animation: cs-pulse 1.5s infinite; }
  .cs-match-badge.finished { background: rgba(201,160,43,.08); color: ${GOLD}; border: 1px solid rgba(201,160,43,.2); }
  @keyframes cs-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

  /* ── Modal البطاقة ── */
  #cs-modal {
    position: fixed; inset: 0; z-index: 9000;
    background: rgba(0,0,0,.92); backdrop-filter: blur(10px);
    display: none; flex-direction: column; overflow-y: auto;
  }
  #cs-modal.open { display: flex; }
  .cs-modal-inner {
    margin: auto; width: 100%; max-width: 560px;
    padding: 16px; min-height: 100vh;
    display: flex; flex-direction: column; gap: 12px;
  }
  .cs-modal-top {
    display: flex; align-items: center; gap: 10px; padding-bottom: 12px;
  }
  .cs-modal-back {
    width: 36px; height: 36px; border-radius: 50%;
    background: #1a1a1a; border: 1px solid rgba(255,255,255,.1);
    color: #aaa; font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .cs-modal-league-badge {
    display: flex; align-items: center; gap: 6px;
    background: rgba(201,160,43,.07); border: 1px solid rgba(201,160,43,.18);
    border-radius: 20px; padding: 3px 10px 3px 5px;
    margin-left: auto; flex-shrink: 0;
  }
  .cs-modal-league-badge img { width: 20px; height: 20px; border-radius: 4px; object-fit: cover; }
  .cs-modal-league-badge span {
    font-size: 10px; font-weight: 700; color: ${GOLD2};
    font-family: Tajawal, sans-serif; max-width: 110px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cs-modal-title { font-size: 15px; font-weight: 900; color: #eee; font-family: Tajawal, sans-serif; }
  .cs-modal-sub   { font-size: 11px; color: #555; margin-top: 1px; }

  /* ── شارة نوع البطاقة ── */
  .cs-card-type-badge {
    display: inline-flex; align-items: center; gap: 5px;
    border-radius: 20px; padding: 5px 14px;
    font-size: 11px; font-weight: 700;
    font-family: Tajawal, sans-serif; border: 1px solid; margin-bottom: 4px;
  }

  /* ── بطاقات الأنواع ── */
  .cs-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cs-type-card {
    background: #0f0f0f; border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px; padding: 15px 12px; cursor: pointer;
    transition: all .2s; text-align: center; position: relative; overflow: hidden;
  }
  .cs-type-card::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(135deg, rgba(201,160,43,.06), transparent);
    opacity: 0; transition: opacity .2s;
  }
  .cs-type-card:hover { border-color: rgba(201,160,43,.35); }
  .cs-type-card:hover::after { opacity: 1; }
  .cs-type-card-icon { font-size: 26px; margin-bottom: 7px; }
  .cs-type-card-name { font-size: 12px; font-weight: 700; color: #ddd; font-family: Tajawal, sans-serif; }
  .cs-type-card-desc { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.5; }

  /* ── تاريخ البطاقات السابقة ── */
  .cs-history-item {
    background: #0f0f0f; border: 1px solid rgba(255,255,255,.06);
    border-radius: 12px; overflow: hidden; margin-bottom: 8px;
    display: flex; align-items: center; gap: 12px; padding: 10px 12px;
    cursor: pointer; transition: all .15s;
  }
  .cs-history-item:hover { border-color: rgba(201,160,43,.2); }
  .cs-history-thumb {
    width: 56px; height: 56px; border-radius: 8px;
    object-fit: cover; background: #1a1a1a; flex-shrink: 0;
    border: 1px solid rgba(255,255,255,.05);
  }
  .cs-history-info { flex: 1; min-width: 0; }
  .cs-history-name { font-size: 12px; font-weight: 700; color: #ddd; font-family: Tajawal, sans-serif; }
  .cs-history-date { font-size: 10px; color: #555; margin-top: 2px; }

  /* ── نموذج الحقول ── */
  .cs-form { display: grid; gap: 10px; }
  .cs-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .cs-form-group label {
    display: block; font-size: 10px; font-weight: 700;
    color: #666; margin-bottom: 5px; font-family: Tajawal, sans-serif;
    text-transform: uppercase; letter-spacing: .5px;
  }
  .cs-form-group input, .cs-form-group select {
    width: 100%; background: #111; border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px; padding: 9px 12px; color: #eee;
    font-family: Tajawal, sans-serif; font-size: 12px; outline: none;
    transition: border-color .2s; box-sizing: border-box;
  }
  .cs-form-group input:focus, .cs-form-group select:focus { border-color: rgba(201,160,43,.4); }
  .cs-form-group input::placeholder { color: #333; }

  /* ── معاينة الكانفاس ── */
  .cs-preview-wrap {
    background: #0a0a0a; border: 1px solid rgba(201,160,43,.15);
    border-radius: 16px; padding: 12px; overflow: hidden;
  }
  .cs-preview-label {
    font-size: 10px; color: #555; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 10px; font-family: Tajawal, sans-serif;
  }
  #cs-preview-canvas { width: 100%; border-radius: 10px; display: block; }

  /* ── أزرار الإجراءات ── */
  .cs-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cs-action-btn {
    padding: 12px 8px; border-radius: 12px; border: none;
    font-family: Tajawal, sans-serif; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all .2s; display: flex;
    align-items: center; justify-content: center; gap: 6px;
  }
  .cs-action-btn.primary { background: linear-gradient(135deg, ${GOLD}, #a07818); color: #000; }
  .cs-action-btn.primary:hover { filter: brightness(1.1); }
  .cs-action-btn.secondary { background: #1a1a1a; color: #aaa; border: 1px solid rgba(255,255,255,.08); }
  .cs-action-btn.secondary:hover { border-color: rgba(201,160,43,.3); color: ${GOLD}; }
  .cs-action-btn.share-wa { background: rgba(37,211,102,.1); color: #25d366; border: 1px solid rgba(37,211,102,.2); }
  .cs-action-btn.share-tg { background: rgba(0,136,204,.1); color: #0088cc; border: 1px solid rgba(0,136,204,.2); }

  /* ── مؤشر التحميل ── */
  .cs-spinner {
    width: 32px; height: 32px; border: 3px solid rgba(201,160,43,.15);
    border-top-color: ${GOLD}; border-radius: 50%;
    animation: cs-spin .7s linear infinite; margin: 40px auto;
  }
  @keyframes cs-spin { to { transform: rotate(360deg); } }
  .cs-empty {
    text-align: center; padding: 40px 20px; color: #444;
    font-family: Tajawal, sans-serif; font-size: 13px;
  }
  .cs-empty-icon { font-size: 36px; margin-bottom: 10px; }

  /* ── قسم رجل المباراة ── */
  .cs-mom-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .cs-mom-player {
    background: #111; border: 1px solid rgba(255,255,255,.06);
    border-radius: 10px; padding: 10px 6px; text-align: center;
    cursor: pointer; transition: all .15s; font-family: Tajawal, sans-serif;
  }
  .cs-mom-player:hover, .cs-mom-player.selected { border-color: rgba(201,160,43,.4); background: rgba(201,160,43,.05); }
  .cs-mom-player.selected { border-color: ${GOLD}; }
  .cs-mom-player-name { font-size: 11px; font-weight: 700; color: #ddd; }
  .cs-mom-player-team { font-size: 9px; color: #555; margin-top: 2px; }
  `;

  // ─── حقن CSS ──────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('cs-styles')) return;
    const s = document.createElement('style');
    s.id = 'cs-styles'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─── حالة النظام ──────────────────────────────────────────────────
  let _state = {
    view: 'list',
    matchId: null,
    cardType: null,
    canvasData: null,
    history: {},
    accentColor: null,           // لون هوية البطولة
    leagueLogoOverride: null,    // شعار البطولة المرفوع يدوياً
    leagueNameOverride: null,    // اسم البطولة المخصص
  };

  // ─── ألوان accent المتاحة ──────────────────────────────────────────
  const ACCENT_PRESETS = [
    { name: 'ذهبي',   value: '#C9A02B' },
    { name: 'أزرق',   value: '#3B82F6' },
    { name: 'أخضر',   value: '#22C55E' },
    { name: 'أحمر',   value: '#EF4444' },
    { name: 'بنفسجي', value: '#A855F7' },
    { name: 'فيروزي', value: '#14B8A6' },
  ];

  // ─── الوصول للبيانات ──────────────────────────────────────────────
  function getMatches() { return window.matches || []; }
  function getTeams()   { return window.teams   || []; }
  function getLeague()  { return window.league  || {}; }
  function getSettings(){ return window.settings || {}; }
  function getTeam(id, fallbackName, fallbackLogo) {
    const t = getTeams().find(t => t.id === id);
    return t || { name: fallbackName || '؟', logo: fallbackLogo || '' };
  }
  function getLeagueName() {
    return _state.leagueNameOverride || getLeague().name || getSettings().leagueName || 'البطولة';
  }
  function fmt12(t) {
    if (!t) return '';
    if (typeof window.formatTimeTo12H === 'function') return window.formatTimeTo12H(t);
    const [h, m] = t.split(':').map(Number);
    return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'م' : 'ص'}`;
  }

  // ─── تحميل صور ────────────────────────────────────────────────────
  function loadImg(src) {
    return new Promise(resolve => {
      if (!src || src.length < 5 || (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/'))) {
        resolve(null); return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  function loadLeagueLogo() {
    return loadImg(_state.leagueLogoOverride || getLeague().logo);
  }

  // ── hex → rgb ─────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  }

  // ── roundRect polyfill ────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
    else {
      ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
      ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
      ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
      ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
    }
  }

  // ── كتابة نص ─────────────────────────────────────────────────────
  function drawText(ctx, text, x, y, font, color, align, shadowColor, shadowBlur) {
    ctx.font = font; ctx.textAlign = align || 'center';
    if (shadowColor) { ctx.shadowColor = shadowColor; ctx.shadowBlur = shadowBlur || 12; }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  }

  // ── فاصل أفقي ────────────────────────────────────────────────────
  function drawDivider(ctx, W, y, opacity, accent) {
    const ac  = accent || _state.accentColor || GOLD;
    const rgb = hexToRgb(ac);
    const g   = ctx.createLinearGradient(0, y, W, y);
    g.addColorStop(0,   'transparent');
    g.addColorStop(0.2, `rgba(${rgb},${opacity || 0.3})`);
    g.addColorStop(0.5, `rgba(${rgb},${(opacity||0.3)*1.5})`);
    g.addColorStop(0.8, `rgba(${rgb},${opacity || 0.3})`);
    g.addColorStop(1,   'transparent');
    ctx.strokeStyle = g; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W-60, y); ctx.stroke();
  }

  // ── رسم شعار فريق ────────────────────────────────────────────────
  function drawLogo(ctx, img, emoji, x, y, size) {
    if (img) {
      ctx.save(); ctx.beginPath();
      const r = size * 0.18;
      ctx.roundRect(x, y, size, size, r); ctx.clip();
      ctx.drawImage(img, x, y, size, size); ctx.restore();
    } else if (emoji && emoji.length <= 4) {
      ctx.font = `${size*0.75}px Arial`; ctx.textAlign = 'center';
      ctx.fillText(emoji, x+size/2, y+size*0.78);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  رسم خلفية البطاقة الموحدة
  // ════════════════════════════════════════════════════════════════
  function drawBackground(ctx, W, H, accent) {
    const ac  = accent || _state.accentColor || GOLD;
    const rgb = hexToRgb(ac);

    // خلفية داكنة أساسية
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#0b0b0b');
    bg.addColorStop(0.5, '#0d0d0d');
    bg.addColorStop(1,   '#080808');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // شبكة خفيفة
    ctx.strokeStyle = 'rgba(255,255,255,0.018)'; ctx.lineWidth = 1;
    for (let x=0; x<W; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=0; y<H; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // توهج مركزي خفيف
    const glow = ctx.createRadialGradient(W/2, H*0.45, 0, W/2, H*0.45, W*0.65);
    glow.addColorStop(0, `rgba(${rgb},0.07)`);
    glow.addColorStop(0.5, `rgba(${rgb},0.02)`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // إطار خارجي
    const pad = 16;
    ctx.strokeStyle = ac; ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, W-pad*2, H-pad*2);

    // زوايا مزخرفة
    const cs = 30, cp = pad;
    ctx.strokeStyle = ac; ctx.lineWidth = 3;
    [[cp,cp],[W-cp-cs,cp],[cp,H-cp-cs],[W-cp-cs,H-cp-cs]].forEach(([cx,cy]) => {
      const ir = cx > W/2, ib = cy > H/2;
      ctx.beginPath(); ctx.moveTo(cx+(ir?cs:0), cy); ctx.lineTo(cx+(ir?cs:0), cy+cs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy+(ib?cs:0)); ctx.lineTo(cx+cs, cy+(ib?cs:0)); ctx.stroke();
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  شريط الهوية العلوي (مدمج داخل البطاقة - يملأ العرض كاملاً)
  // ════════════════════════════════════════════════════════════════
  // يرسم شريطاً أعلى البطاقة يحتوي: شعار البطولة + اسمها
  // الارتفاع: 72px
  async function drawTopIdentityBar(ctx, W, topY, lgImg) {
    const name   = getLeagueName();
    const accent = _state.accentColor || GOLD;
    const rgb    = hexToRgb(accent);
    const BH     = 72;

    // خلفية الشريط
    const bbg = ctx.createLinearGradient(0, topY, W, topY+BH);
    bbg.addColorStop(0, `rgba(${rgb},0.15)`);
    bbg.addColorStop(0.5, `rgba(${rgb},0.22)`);
    bbg.addColorStop(1, `rgba(${rgb},0.12)`);
    ctx.fillStyle = bbg;
    ctx.fillRect(0, topY, W, BH);

    // خط سفلي فاصل
    const lineG = ctx.createLinearGradient(0, topY+BH, W, topY+BH);
    lineG.addColorStop(0, 'transparent');
    lineG.addColorStop(0.15, `rgba(${rgb},0.5)`);
    lineG.addColorStop(0.5, `rgba(${rgb},0.9)`);
    lineG.addColorStop(0.85, `rgba(${rgb},0.5)`);
    lineG.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineG; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, topY+BH); ctx.lineTo(W, topY+BH); ctx.stroke();

    const cy = topY + BH / 2;
    const logoSz = 48;

    if (lgImg) {
      // شعار + نص مركزي
      ctx.font = 'bold 28px Tajawal,Arial';
      const tw = ctx.measureText(name).width;
      const gap = 14;
      const total = logoSz + gap + tw;
      const startX = (W - total) / 2;

      // هالة الشعار
      ctx.fillStyle = `rgba(${rgb},0.15)`;
      ctx.beginPath(); ctx.arc(startX+logoSz/2, cy, logoSz/2+7, 0, Math.PI*2); ctx.fill();

      // الشعار دائري
      ctx.save(); ctx.beginPath();
      ctx.arc(startX+logoSz/2, cy, logoSz/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(lgImg, startX, cy-logoSz/2, logoSz, logoSz); ctx.restore();

      // حلقة
      ctx.strokeStyle = `rgba(${rgb},0.6)`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(startX+logoSz/2, cy, logoSz/2+2, 0, Math.PI*2); ctx.stroke();

      // اسم البطولة
      ctx.font = 'bold 28px Tajawal,Arial';
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      ctx.shadowColor = `rgba(${rgb},0.7)`; ctx.shadowBlur = 18;
      ctx.fillText(name, startX+logoSz+gap, cy+10);
      ctx.shadowBlur = 0; ctx.textAlign = 'center';

    } else {
      // بدون شعار
      ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.fillText('🏆', W/2-100, cy+11);
      ctx.font = 'bold 28px Tajawal,Arial'; ctx.fillStyle = '#ffffff';
      ctx.shadowColor = `rgba(${rgb},0.6)`; ctx.shadowBlur = 16;
      ctx.fillText(name, W/2+20, cy+11);
      ctx.shadowBlur = 0;
    }

    return BH;
  }

  // ════════════════════════════════════════════════════════════════
  //  شريط المرحلة (تحت الهوية مباشرة)
  // ════════════════════════════════════════════════════════════════
  function drawStageBar(ctx, W, y, stageLabel) {
    if (!stageLabel) return 0;
    const accent = _state.accentColor || GOLD;
    const rgb    = hexToRgb(accent);
    const BH     = 44;

    ctx.font = '700 20px Tajawal,Arial';
    const tw = ctx.measureText(stageLabel).width + 56;
    const bx = W/2 - tw/2;

    // خلفية الشارة
    ctx.fillStyle = `rgba(${rgb},0.08)`;
    ctx.strokeStyle = `rgba(${rgb},0.3)`;
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, y+4, tw, BH-8, 22); ctx.fill(); ctx.stroke();

    // نقطة مضيئة يمين النص
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(bx+18, y+BH/2, 4, 0, Math.PI*2); ctx.fill();

    drawText(ctx, stageLabel, W/2+8, y+BH/2+7, '700 20px Tajawal,Arial', accent, 'center', `rgba(${rgb},0.4)`, 10);
    return BH;
  }

  // ════════════════════════════════════════════════════════════════
  //  شريط فوتر موحد أسفل البطاقة
  // ════════════════════════════════════════════════════════════════
  function drawBottomBar(ctx, W, H) {
    const accent = _state.accentColor || GOLD;
    const rgb    = hexToRgb(accent);
    // ✅ 66px بدل 48 — يتّسع لسطرَي الحقوق دون قصّ
    const BH     = 66;
    const by     = H - BH;

    // خلفية الشريط
    const bg2 = ctx.createLinearGradient(0, by, 0, H);
    bg2.addColorStop(0, 'rgba(0,0,0,0)');
    bg2.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    bg2.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = bg2; ctx.fillRect(0, by, W, BH);

    // خط علوي
    const lg = ctx.createLinearGradient(0, by, W, by);
    lg.addColorStop(0, 'transparent');
    lg.addColorStop(0.15, `rgba(${rgb},0.35)`);
    lg.addColorStop(0.5, `rgba(${rgb},0.7)`);
    lg.addColorStop(0.85, `rgba(${rgb},0.35)`);
    lg.addColorStop(1, 'transparent');
    ctx.strokeStyle = lg; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();

    // نقاط زينة
    [W*0.2, W*0.5, W*0.8].forEach(dx => {
      ctx.fillStyle = `rgba(${rgb},0.6)`;
      ctx.beginPath(); ctx.arc(dx, by, 2.5, 0, Math.PI*2); ctx.fill();
    });

    // ✅ حقوق المنصة — سطران: الاسم ثم المطوّر
    ctx.textAlign = 'center';
    ctx.font = '700 15px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.fillText('منصة بطولات', W/2, by + 28);
    ctx.font = '400 12px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillText('تطوير وبرمجة عبدالله السكني', W/2, by + 47);
  }

  // ════════════════════════════════════════════════════════════════
  //  خانة تفصيل (وقت/حكم/معلق/ملعب)
  // ════════════════════════════════════════════════════════════════
  function drawDetailCells(ctx, W, items, startY, accent) {
    if (!items.length) return 0;
    const rgb     = hexToRgb(accent);
    const SIDE    = 38;
    const GAP     = 12;
    const H_CELL  = 80;
    const totalW  = W - SIDE*2;
    const cols    = items.length;
    const cw      = (totalW - GAP*(cols-1)) / cols;

    items.forEach((d, i) => {
      const cx = SIDE + i*(cw+GAP);

      // خلفية
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = `rgba(${rgb},0.2)`;
      ctx.lineWidth = 1.5;
      roundRect(ctx, cx, startY, cw, H_CELL, 14); ctx.fill(); ctx.stroke();

      // خط علوي ملون
      const tg = ctx.createLinearGradient(cx, startY, cx+cw, startY);
      tg.addColorStop(0, 'transparent'); tg.addColorStop(0.3, `rgba(${rgb},0.55)`);
      tg.addColorStop(0.7, `rgba(${rgb},0.55)`); tg.addColorStop(1, 'transparent');
      ctx.strokeStyle = tg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx+18, startY+1); ctx.lineTo(cx+cw-18, startY+1); ctx.stroke();

      // التسمية
      drawText(ctx, d.label, cx+cw/2, startY+22, '600 14px Tajawal,Arial', '#666', 'center');

      // القيمة مع أيقونة
      const val = `${d.icon}  ${d.val}`;
      ctx.font = '700 19px Tajawal,Arial';
      const vtw = ctx.measureText(val).width;
      const fs  = vtw > cw-24 ? Math.max(13, 19*(cw-24)/vtw) : 19;
      drawText(ctx, val, cx+cw/2, startY+56, `700 ${fs}px Tajawal,Arial`, '#eeeeee', 'center');
    });
    return H_CELL;
  }

  // ════════════════════════════════════════════════════════════════
  //  بطاقة شعارَي الفريقين (مشتركة بين prematch/postmatch)
  //  ترسم: الشعارات + اسمَي الفريقين + النص المركزي (VS أو النتيجة)
  // ════════════════════════════════════════════════════════════════
  /* ✅ hEmoji/aEmoji: أيقونة كل فريق الحقيقية. كانت مثبّتة على '⚽'
     فتضيع الأيقونة التي اختارها المنظّم لكل فريق في كل البطاقات. */
  function drawTeamsSection(ctx, W, topY, hImg, aImg, htName, atName, centerText, centerColor, accent, logoSize, hEmoji, aEmoji) {
    const rgb    = hexToRgb(accent);
    const LS     = logoSize || 210;
    const HCX    = W/2 - 272;
    const ACX    = W/2 + 272;
    const LTY    = topY;
    const LCY    = LTY + LS/2;

    // هالتان خلف الشعارين
    [HCX, ACX].forEach(cx => {
      const g = ctx.createRadialGradient(cx, LCY, 0, cx, LCY, LS*0.75);
      g.addColorStop(0, `rgba(${rgb},0.13)`);
      g.addColorStop(0.5, `rgba(${rgb},0.05)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, LCY, LS*0.75, 0, Math.PI*2); ctx.fill();
    });

    // رسم الشعارين
    drawLogo(ctx, hImg, hEmoji || '⚽', HCX-LS/2, LTY, LS);
    drawLogo(ctx, aImg, aEmoji || '⚽', ACX-LS/2, LTY, LS);

    // نص مركزي (VS أو النتيجة)
    ctx.font = typeof centerText === 'string' && centerText.includes('–') ? 'bold 84px Tajawal,Arial' : 'bold 58px Tajawal,Arial';
    ctx.textAlign = 'center'; ctx.fillStyle = centerColor || accent;
    ctx.shadowColor = `rgba(${hexToRgb(centerColor||accent)},0.55)`;
    ctx.shadowBlur = 28;
    /* ✅ اتجاه صريح ltr للنتيجة — بدونه قد يرث الكانفس اتجاه الصفحة (rtl)
       فينعكس ترتيب الرقمين وتظهر نتيجة المضيف مكان الضيف. */
    ctx.save();
    ctx.direction = 'ltr';
    ctx.fillText(centerText, W/2, LCY + (centerText.includes('–') ? 30 : 20));
    ctx.restore();
    ctx.shadowBlur = 0;

    // أسماء الفرق
    const NY = LTY + LS + 22;
    const drawName = (name, cx, highlight) => {
      ctx.font = 'bold 26px Tajawal,Arial';
      const tw = ctx.measureText(name).width;
      const bw = tw + 40, bh = 40;
      ctx.fillStyle   = highlight ? `rgba(${rgb},0.12)` : 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = highlight ? `rgba(${rgb},0.38)` : `rgba(255,255,255,0.07)`;
      ctx.lineWidth   = 1.2;
      roundRect(ctx, cx-bw/2, NY-28, bw, bh, 20); ctx.fill(); ctx.stroke();
      drawText(ctx, name, cx, NY, 'bold 26px Tajawal,Arial', highlight ? accent : '#dddddd', 'center', `rgba(${rgb},0.2)`, 6);
    };
    drawName(htName, HCX, false);
    drawName(atName, ACX, false);

    return NY + 22; // Y بعد الأسماء
  }

  // ════════════════════════════════════════════════════════════════
  //  بطاقة قبل المباراة — prematch
  // ════════════════════════════════════════════════════════════════
  async function genPreMatchCanvas(m, extras) {
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const [hImg, aImg, lgImg] = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    const accent = _state.accentColor || GOLD;

    // ─ خلفية
    drawBackground(ctx, W, H, accent);

    // ─ 1) شريط هوية البطولة (أعلى البطاقة مباشرة)
    const ID_TOP = 16;
    const idH    = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg);
    let   curY   = ID_TOP + idH + 16;

    // ─ 2) شارة المرحلة
    const stage = extras.stage || m.knockoutRoundName || (m.round ? `الجولة ${m.round}` : '');
    const stH   = drawStageBar(ctx, W, curY, stage);
    curY += stH + (stH ? 18 : 0);

    // ─ 3) قسم الفرق (الشعارات + VS + الأسماء)
    const afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, 'VS', accent, accent, 210, ht.logo, at.logo);
    curY = afterTeams + 10;
    drawDivider(ctx, W, curY, 0.3);
    curY += 22;

    // ─ 4) خانات التفاصيل
    // ✅ التاريخ كان يُطلب في النموذج ثم يُهمل تماماً على البطاقة
    const timeVal = fmt12(extras.time || m.time);
    const dateVal = extras.date || m.date || '';
    const cells = [
      { icon: '📅', label: 'التاريخ', val: dateVal },
      { icon: '⏰', label: 'الوقت',  val: timeVal },
      { icon: '🏟️', label: 'الملعب', val: extras.venue       || m.venue       || '' },
      { icon: '🧑‍⚖️', label: 'الحكم',  val: extras.referee  || m.referee  || '' },
      { icon: '🎙️', label: 'المعلق', val: extras.commentator || m.commentator || '' },
    ].filter(d => d.val);
    const row1 = cells.slice(0, 2);
    const row2 = cells.slice(2, 4);
    const row3 = cells.slice(4, 6);

    if (row1.length) { drawDetailCells(ctx, W, row1, curY, accent); curY += 80 + 10; }
    if (row2.length) { drawDetailCells(ctx, W, row2, curY, accent); curY += 80 + 10; }
    if (row3.length) { drawDetailCells(ctx, W, row3, curY, accent); curY += 80 + 10; }

    // ─ 5) فوتر
    drawBottomBar(ctx, W, H);
    return canvas;
  }

  // ════════════════════════════════════════════════════════════════
  //  بطاقة نتيجة المباراة — postmatch
  // ════════════════════════════════════════════════════════════════
  async function genPostMatchCanvas(m, extras) {
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const [hImg, aImg, lgImg] = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    const hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
    const hw = hs > as_, aw = as_ > hs, isDraw = hs === as_;
    const hasPens = m.penaltyScoreHome != null && isDraw;
    const accent  = _state.accentColor || GOLD;
    const rgb     = hexToRgb(accent);

    drawBackground(ctx, W, H, accent);

    // ─ 1) هوية البطولة
    const ID_TOP = 16;
    const idH    = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg);
    let curY     = ID_TOP + idH + 12;

    // ─ 2) شارة نهاية المباراة + المرحلة
    const stage    = extras.stage || m.knockoutRoundName || (m.round ? `الجولة ${m.round}` : '');
    const endLabel = stage ? `🏁  نهاية المباراة  ·  ${stage}` : '🏁  نهاية المباراة';
    drawText(ctx, endLabel, W/2, curY+16, '700 17px Tajawal,Arial', '#666', 'center');
    curY += 38;

    // ─ 3) قسم الفرق + النتيجة
    const scoreStr  = `${hs}  –  ${as_}`;
    const afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, scoreStr, '#ffffff', accent, 192, ht.logo, at.logo);
    curY = afterTeams;

    // ركلات الترجيح
    if (hasPens) {
      drawText(ctx, `(ركلات الترجيح: ${m.penaltyScoreHome} – ${m.penaltyScoreAway})`, W/2, curY+2, '700 17px Tajawal,Arial', '#9b59b6', 'center');
      curY += 30;
    }

    // الفائز / تعادل
    curY += 8;
    if (!isDraw || hasPens) {
      const winnerName = hw ? ht.name : hasPens ? (m.penaltyScoreHome > m.penaltyScoreAway ? ht.name : at.name) : at.name;
      // ✅ "يتأهل" فقط في الإقصائيات — في الدوري لا أحد يتأهل، هو فائز فقط
      const _isKO = !!(m.isKnockout || m.knockoutRoundId != null || m.knockoutRoundName) ||
                    (getSettings().type === 'knockout');
      const verb  = _isKO ? 'يتأهل' : 'الفائز';
      const label = _isKO ? `🏆  ${winnerName}  ${verb}` : `🏆  ${verb}:  ${winnerName}`;
      ctx.font = 'bold 24px Tajawal,Arial'; ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width + 48;
      ctx.fillStyle = `rgba(${rgb},0.1)`;
      ctx.strokeStyle = `rgba(${rgb},0.3)`; ctx.lineWidth = 1;
      roundRect(ctx, W/2-tw/2, curY, tw, 38, 19); ctx.fill(); ctx.stroke();
      drawText(ctx, label, W/2, curY+25, 'bold 22px Tajawal,Arial', accent, 'center', `rgba(${rgb},0.4)`, 8);
      curY += 50;
    } else {
      drawText(ctx, '🤝  تعادل', W/2, curY+20, 'bold 22px Tajawal,Arial', '#888', 'center');
      curY += 44;
    }

    drawDivider(ctx, W, curY, 0.25);
    curY += 22;

    // الهدافون
    const hSc = (m.homeScorers||'').split(',').map(s=>s.trim()).filter(Boolean);
    const aSc = (m.awayScorers||'').split(',').map(s=>s.trim()).filter(Boolean);
    if (hSc.length || aSc.length) {
      drawText(ctx, '⚽  الهدافون', W/2, curY, '700 15px Tajawal,Arial', '#555', 'center');
      curY += 28;
      const all = [...hSc.map(s=>({n:s,t:ht.name})), ...aSc.map(s=>({n:s,t:at.name}))];
      all.slice(0,6).forEach((s,i) => {
        drawText(ctx, `${s.n}  ·  ${s.t}`, W/2, curY, '600 17px Tajawal,Arial', i%2===0?'#ddd':'#aaa', 'center');
        curY += 28;
      });
    }

    // رجل المباراة
    const mom = extras.mom || m.manOfMatch;
    if (mom) {
      curY += 6;
      drawDivider(ctx, W, curY, 0.18);
      curY += 28;
      drawText(ctx, `🌟  رجل المباراة:  ${mom}`, W/2, curY, 'bold 21px Tajawal,Arial', accent, 'center', `rgba(${rgb},0.4)`, 8);
    }

    drawBottomBar(ctx, W, H);
    return canvas;
  }

  // ════════════════════════════════════════════════════════════════
  //  بطاقة رجل المباراة — MOM
  // ════════════════════════════════════════════════════════════════
  async function genMOMCanvas(m, extras) {
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const mom = extras.mom || m.manOfMatch || 'لاعب المباراة';
    const momTeam = extras.momTeam || '';
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const [hImg, aImg, lgImg] = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    const accent = _state.accentColor || GOLD;
    const rgb    = hexToRgb(accent);

    // خلفية خاصة برجل المباراة
    const bg = ctx.createRadialGradient(W/2, H*0.4, 0, W/2, H*0.4, W*0.75);
    bg.addColorStop(0, '#161200'); bg.addColorStop(0.5, '#0d0d0a'); bg.addColorStop(1, '#080808');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.018)'; ctx.lineWidth = 1;
    for (let x=0; x<W; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    const pad = 16;
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, W-pad*2, H-pad*2);
    const cs = 30, cp = pad;
    ctx.lineWidth = 3;
    [[cp,cp],[W-cp-cs,cp],[cp,H-cp-cs],[W-cp-cs,H-cp-cs]].forEach(([cx,cy]) => {
      const ir=cx>W/2, ib=cy>H/2;
      ctx.beginPath(); ctx.moveTo(cx+(ir?cs:0), cy); ctx.lineTo(cx+(ir?cs:0), cy+cs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy+(ib?cs:0)); ctx.lineTo(cx+cs, cy+(ib?cs:0)); ctx.stroke();
    });

    // 1) هوية
    const ID_TOP = 16;
    const idH    = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg);
    let curY     = ID_TOP + idH + 16;
    drawDivider(ctx, W, curY, 0.2);
    curY += 20;

    // 2) أيقونة + عنوان
    drawText(ctx, '🌟', W/2, curY+56, '68px Arial', '#fff', 'center');
    curY += 72;
    drawText(ctx, 'رجل المباراة', W/2, curY+8, 'bold 30px Tajawal,Arial', accent, 'center', `rgba(${rgb},0.4)`, 14);
    curY += 32;
    drawText(ctx, `${ht.name}  ×  ${at.name}`, W/2, curY+6, '700 17px Tajawal,Arial', '#666', 'center');
    curY += 24;
    drawDivider(ctx, W, curY, 0.18);
    curY += 20;

    // 3) اسم اللاعب
    ctx.font = 'bold 70px Tajawal,Arial'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = accent; ctx.shadowBlur = 42;
    ctx.fillText(mom, W/2, curY + 70);
    ctx.shadowBlur = 0; curY += 82;

    if (momTeam) {
      const tw = ctx.measureText(momTeam).width + 40;
      ctx.font = '700 18px Tajawal,Arial';
      ctx.fillStyle = `rgba(${rgb},0.1)`;
      ctx.strokeStyle = `rgba(${rgb},0.25)`; ctx.lineWidth = 1;
      roundRect(ctx, W/2-tw/2, curY, tw, 34, 17); ctx.fill(); ctx.stroke();
      drawText(ctx, momTeam, W/2, curY+23, '700 17px Tajawal,Arial', accent, 'center');
      curY += 46;
    }

    drawDivider(ctx, W, curY, 0.2); curY += 22;

    // 4) إحصائيات
    const stats = [
      extras.goals   != null ? { label:'أهداف',   val: extras.goals   } : null,
      extras.assists != null ? { label:'تمريرات', val: extras.assists  } : null,
      extras.rating  != null ? { label:'التقييم', val: extras.rating   } : null,
    ].filter(Boolean);

    if (stats.length) {
      const cw = Math.min(210, (W-120)/stats.length);
      const sx = W/2 - (cw*stats.length)/2;
      stats.forEach((s,i) => {
        const cx = sx + i*cw + cw/2;
        ctx.fillStyle = `rgba(${rgb},0.08)`;
        ctx.strokeStyle = `rgba(${rgb},0.18)`; ctx.lineWidth = 1;
        roundRect(ctx, cx-cw/2+6, curY, cw-12, 88, 14); ctx.fill(); ctx.stroke();
        drawText(ctx, String(s.val), cx, curY+54, 'bold 42px Tajawal,Arial', accent, 'center');
        drawText(ctx, s.label,       cx, curY+76, '600 14px Tajawal,Arial', '#666', 'center');
      });
      curY += 102;
    }

    // 5) النتيجة والمباراة
    drawText(ctx, `${m.homeScore??0}  –  ${m.awayScore??0}`, W/2, curY+10, 'bold 52px Tajawal,Arial', '#fff', 'center', 'rgba(0,0,0,.3)', 8);
    curY += 52;
    drawText(ctx, `${ht.name}  ×  ${at.name}`, W/2, curY+2, '600 17px Tajawal,Arial', '#555', 'center');

    drawBottomBar(ctx, W, H);
    return canvas;
  }

  // ════════════════════════════════════════════════════════════════
  //  بطاقة التأهل — qual
  // ════════════════════════════════════════════════════════════════
  async function genQualCanvas(m, extras) {
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
    const hw = hs > as_;
    const hasPens = m.penaltyScoreHome != null && hs === as_;
    const winner  = hw ? ht : hasPens ? (m.penaltyScoreHome > m.penaltyScoreAway ? ht : at) : at;
    const qualName   = extras.qual || winner.name;
    const nextStage  = extras.nextStage || '';
    const W = 1080, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const [wImg, lgImg] = await Promise.all([loadImg(winner.logo), loadLeagueLogo()]);
    const accent = _state.accentColor || GOLD;
    const rgb    = hexToRgb(accent);

    // خلفية احتفالية
    const bg = ctx.createRadialGradient(W/2, H*0.45, 0, W/2, H*0.45, W*0.8);
    bg.addColorStop(0,'#121200'); bg.addColorStop(0.4,'#0e0e0c'); bg.addColorStop(1,'#080808');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (let r=80; r<W; r+=75) {
      ctx.strokeStyle = `rgba(${rgb},${0.028*(1-r/W)})`;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(W/2, H*0.45, r, 0, Math.PI*2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.018)'; ctx.lineWidth = 1;
    for (let x=0; x<W; x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    const pad = 16;
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, W-pad*2, H-pad*2);
    const cs=30, cp=pad;
    ctx.lineWidth = 3;
    [[cp,cp],[W-cp-cs,cp],[cp,H-cp-cs],[W-cp-cs,H-cp-cs]].forEach(([cx,cy])=>{
      const ir=cx>W/2, ib=cy>H/2;
      ctx.beginPath(); ctx.moveTo(cx+(ir?cs:0),cy); ctx.lineTo(cx+(ir?cs:0),cy+cs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx,cy+(ib?cs:0)); ctx.lineTo(cx+cs,cy+(ib?cs:0)); ctx.stroke();
    });

    // 1) هوية
    const ID_TOP = 16;
    const idH    = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg);
    let curY     = ID_TOP + idH + 14;
    drawDivider(ctx, W, curY, 0.22); curY += 18;

    // 2) كأس + "تأهل إلى"
    drawText(ctx, '🏆', W/2, curY+70, '78px Arial', '#fff', 'center');
    curY += 84;
    // ✅ لا تكتب "تأهّل إلى" بلا مرحلة — كانت تظهر معلّقة بلا معنى
    if (nextStage) { drawText(ctx, 'تأهّل إلى', W/2, curY, '700 20px Tajawal,Arial', '#666', 'center'); curY += 30; }
    else           { drawText(ctx, 'تأهّل للدور التالي', W/2, curY, '700 20px Tajawal,Arial', '#666', 'center'); curY += 30; }

    if (nextStage) {
      const nw = (() => { ctx.font = 'bold 18px Tajawal,Arial'; return ctx.measureText(nextStage).width+44; })();
      ctx.fillStyle = `rgba(${rgb},0.1)`; ctx.strokeStyle = `rgba(${rgb},0.25)`; ctx.lineWidth = 1;
      roundRect(ctx, W/2-nw/2, curY, nw, 36, 18); ctx.fill(); ctx.stroke();
      drawText(ctx, nextStage, W/2, curY+24, 'bold 18px Tajawal,Arial', accent, 'center');
      curY += 50;
    }

    // 3) شعار الفائز
    const ls = 200;
    if (wImg) {
      ctx.fillStyle = `rgba(${rgb},0.1)`;
      ctx.beginPath(); ctx.arc(W/2, curY+ls/2, ls/2+16, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},0.3)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(W/2, curY+ls/2, ls/2+7, 0, Math.PI*2); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.arc(W/2, curY+ls/2, ls/2, 0, Math.PI*2); ctx.clip();
      ctx.drawImage(wImg, W/2-ls/2, curY, ls, ls); ctx.restore();
    } else {
      ctx.font = '110px Arial'; ctx.textAlign = 'center'; ctx.fillText('⚽', W/2, curY+110);
    }
    curY += ls + 22;

    // 4) اسم المتأهل
    ctx.font = 'bold 54px Tajawal,Arial'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = accent; ctx.shadowBlur = 38;
    ctx.fillText(qualName, W/2, curY); ctx.shadowBlur = 0;
    curY += 28;
    drawDivider(ctx, W, curY, 0.22); curY += 24;

    // 5) نتيجة المباراة
    const sLabel = `${ht.name}  ${hs} – ${as_}  ${at.name}`;
    ctx.font = 'bold 24px Tajawal,Arial'; ctx.textAlign = 'center';
    const sW = ctx.measureText(sLabel).width + 40;
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.strokeStyle = `rgba(${rgb},0.12)`; ctx.lineWidth = 1;
    roundRect(ctx, W/2-sW/2, curY, sW, 38, 19); ctx.fill(); ctx.stroke();
    drawText(ctx, sLabel, W/2, curY+26, 'bold 22px Tajawal,Arial', '#888', 'center');
    if (hasPens) {
      drawText(ctx, `(ركلات: ${m.penaltyScoreHome} – ${m.penaltyScoreAway})`, W/2, curY+60, '700 17px Tajawal,Arial', '#9b59b6', 'center');
    }

    drawBottomBar(ctx, W, H);
    return canvas;
  }

  // ════════════════════════════════════════════════════════════════
  //  واجهة المستخدم
  // ════════════════════════════════════════════════════════════════

  // ── بناء قسم هوية البطولة (ثابت أعلى الصفحة) ─────────────────
  function buildIdentityPanel() {
    const lg     = getLeague();
    const name   = getLeagueName();
    const logo   = _state.leagueLogoOverride || lg.logo || '';
    const accent = _state.accentColor || GOLD;

    const logoHtml = logo
      ? `<img src="${logo}" alt="" onerror="this.src='';this.style.display='none'">`
      : `<span class="cs-id-logo-placeholder">🏆</span>`;

    const swatches = ACCENT_PRESETS.map(p => `
      <div class="cs-id-swatch ${p.value===accent?'active':''}"
           style="background:${p.value}"
           onclick="window._csSetAccent('${p.value}',this)"
           title="${p.name}"></div>
    `).join('');

    /* ✅ الاسم والشعار للعرض فقط — مصدرهما إعدادات البطولة.
       كان هنا حقل اسم ورفع شعار منفصلان، فيضطر المنظّم لتعبئتهما في كل
       مرة وقد يختلفان عن الإعدادات. الآن مصدر واحد لا يتكرر. */
    return `
      <div class="cs-identity-panel" id="cs-identity-panel">
        <div class="cs-identity-label">🏆 هوية البطولة — من الإعدادات</div>
        <div class="cs-identity-row">
          <div class="cs-id-logo-wrap" style="cursor:default" title="يُغيَّر من الإعدادات">
            ${logoHtml}
          </div>
          <div class="cs-id-info">
            <div style="font-size:14px;font-weight:900;color:#eee;padding:6px 0;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
            <div class="cs-id-sub">
              الاسم والشعار من الإعدادات —
              <span style="color:#C9A02B;cursor:pointer;text-decoration:underline"
                onclick="window._csGoSettings&&window._csGoSettings()">تغييرهما</span>
            </div>
            <div class="cs-id-colors">
              <span class="cs-id-colors-label">اللون:</span>
              ${swatches}
              <div class="cs-id-custom" title="لون مخصص">
                +
                <input type="color" value="${accent}" oninput="window._csSetAccent(this.value,null)">
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── قائمة المباريات ───────────────────────────────────────────
  function renderCardsPage() {
    const el = document.getElementById('cardsList');
    if (!el) return;
    const matches = getMatches();
    const live     = matches.filter(m => m.status === 'live');
    const upcoming = matches.filter(m => m.status === 'upcoming');
    const finished = matches.filter(m => m.status === 'finished').reverse();

    const renderGroup = (title, list) => {
      if (!list.length) return '';
      return `
        <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:14px 0 8px;font-family:Tajawal,sans-serif">${title}</div>
        ${list.map(m => {
          const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
          const at = getTeam(m.awayId, m.awayName, m.awayLogo);
          const scoreHtml = m.status==='finished'||m.status==='live'
            ? `<div class="cs-match-score">${m.homeScore??'—'} – ${m.awayScore??'—'}</div>`
            : `<div class="cs-match-score" style="font-size:13px;color:#555">${m.time?fmt12(m.time):'—'}</div>`;
          const hist = (_state.history[m.id]||[]).length;
          const histBadge = hist > 0 ? `<span style="font-size:9px;background:rgba(201,160,43,.1);color:${GOLD};border:1px solid rgba(201,160,43,.2);border-radius:10px;padding:1px 7px;margin-right:4px">${hist} بطاقة</span>` : '';
          return `
            <div class="cs-match-item ${m.status}" onclick="window._csOpenMatch('${m.id}')">
              <div class="cs-match-teams-logos">
                ${ht.logo?`<img class="cs-match-team-logo" src="${ht.logo}" alt="">`:`<div class="cs-match-team-logo" style="display:flex;align-items:center;justify-content:center;font-size:14px">⚽</div>`}
                <span class="cs-match-vs-dot">VS</span>
                ${at.logo?`<img class="cs-match-team-logo" src="${at.logo}" alt="">`:`<div class="cs-match-team-logo" style="display:flex;align-items:center;justify-content:center;font-size:14px">⚽</div>`}
              </div>
              <div class="cs-match-teams">
                <div class="cs-match-names">${ht.name} <span style="color:#444">×</span> ${at.name}</div>
                <div class="cs-match-meta">
                  ${histBadge}
                  ${m.date?`📅 ${m.date}`:''}
                  ${m.round?` · الجولة ${m.round}`:''}
                  ${m.knockoutRoundName?` · ${m.knockoutRoundName}`:''}
                </div>
              </div>
              ${scoreHtml}
              <span class="cs-match-badge ${m.status}">${m.status==='live'?'🔴 مباشر':m.status==='upcoming'?'قادمة':'🏁 انتهت'}</span>
            </div>`;
        }).join('')}`;
    };

    if (!matches.length) {
      el.innerHTML = `<div class="cs-empty"><div class="cs-empty-icon">🎴</div>لا توجد مباريات بعد</div>`;
      return;
    }

    el.innerHTML = `
      <div class="cs-matches-wrap">
        ${renderGroup('🔴 مباشرة الآن', live)}
        ${renderGroup('⏳ المباريات القادمة', upcoming)}
        ${renderGroup('🏁 المباريات المنتهية', finished)}
      </div>`;
  }

  // ── Modal اختيار نوع البطاقة ──────────────────────────────────
  function openMatchModal(matchId) {
    _state.matchId = matchId;
    const m = getMatches().find(x => x.id === matchId);
    if (!m) return;
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const isFinished = m.status === 'finished' || m.status === 'live';
    const history    = _state.history[matchId] || [];
    const lgName     = getLeagueName();
    const lgLogo     = _state.leagueLogoOverride || getLeague().logo || '';

    const modal = getModal();
    modal.querySelector('.cs-modal-inner').innerHTML = `
      <div class="cs-modal-top">
        <button class="cs-modal-back" onclick="window._csCloseModal()">‹</button>
        <div style="flex:1;min-width:0">
          <div class="cs-modal-title">${ht.name} × ${at.name}</div>
          <div class="cs-modal-sub">${m.status==='finished'?`🏁 ${m.homeScore} – ${m.awayScore}`:m.status==='live'?'🔴 مباشر':fmt12(m.time)||'قادمة'}</div>
        </div>
        <div class="cs-modal-league-badge">
          ${lgLogo?`<img src="${lgLogo}" alt="">`:`<span style="font-size:14px">🏆</span>`}
          <span>${lgName}</span>
        </div>
      </div>

      <div style="font-size:11px;color:#555;font-weight:700;letter-spacing:.8px;text-transform:uppercase;font-family:Tajawal,sans-serif;margin-bottom:6px">إنشاء بطاقة جديدة</div>
      <div class="cs-type-grid">
        ${!isFinished?`
        <div class="cs-type-card" onclick="window._csOpenForm('prematch')">
          <div class="cs-type-card-icon">⚽</div>
          <div class="cs-type-card-name">قبل المباراة</div>
          <div class="cs-type-card-desc">موعد · شعارات · تفاصيل</div>
        </div>`:''}
        ${isFinished?`
        <div class="cs-type-card" onclick="window._csOpenForm('postmatch')">
          <div class="cs-type-card-icon">🏁</div>
          <div class="cs-type-card-name">النتيجة النهائية</div>
          <div class="cs-type-card-desc">النتيجة · الهدافون · الفائز</div>
        </div>
        <div class="cs-type-card" onclick="window._csOpenForm('mom')">
          <div class="cs-type-card-icon">🌟</div>
          <div class="cs-type-card-name">رجل المباراة</div>
          <div class="cs-type-card-desc">اسم اللاعب · إحصائياته</div>
        </div>
        <div class="cs-type-card" onclick="window._csOpenForm('qual')">
          <div class="cs-type-card-icon">🏆</div>
          <div class="cs-type-card-name">بطاقة التأهل</div>
          <div class="cs-type-card-desc">المتأهل · الدور القادم</div>
        </div>`:''}
        ${!isFinished?`
        <div class="cs-type-card" style="opacity:.35;cursor:not-allowed">
          <div class="cs-type-card-icon">🏁</div>
          <div class="cs-type-card-name">النتيجة</div>
          <div class="cs-type-card-desc">متاحة بعد الانتهاء</div>
        </div>`:''}
      </div>

      ${history.length?`
      <div style="font-size:11px;color:#555;font-weight:700;letter-spacing:.8px;text-transform:uppercase;font-family:Tajawal,sans-serif;margin-top:14px;margin-bottom:6px">البطاقات السابقة</div>
      ${history.map((h,i)=>`
        <div class="cs-history-item" onclick="window._csShowHistoryCard(${i},'${matchId}')">
          <img class="cs-history-thumb" src="${h.dataUrl}" alt=""/>
          <div class="cs-history-info">
            <div class="cs-history-name">${h.label}</div>
            <div class="cs-history-date">${h.dateStr}</div>
          </div>
          <div style="font-size:18px;color:#333">›</div>
        </div>`).join('')}`:''}
    `;
    openModal();
  }

  // ── Modal النموذج ─────────────────────────────────────────────
  function openFormModal(type) {
    _state.cardType = type;
    const m = getMatches().find(x => x.id === _state.matchId);
    if (!m) return;
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo);
    const at = getTeam(m.awayId, m.awayName, m.awayLogo);
    const lgName  = getLeagueName();
    const lgLogo  = _state.leagueLogoOverride || getLeague().logo || '';
    const tc      = TYPE_COLORS[type];
    const typeLabels  = { prematch:'بطاقة قبل المباراة', postmatch:'بطاقة النتيجة', mom:'رجل المباراة', qual:'بطاقة التأهل' };
    const typeIcons   = { prematch:'⚽', postmatch:'🏁', mom:'🌟', qual:'🏆' };

    let extraFields = '';
    if (type === 'prematch') {
      extraFields = `
        <div class="cs-form-row">
          <div class="cs-form-group"><label>📅 التاريخ</label><input id="cs-f-date" value="${m.date||''}" placeholder="مثال: 12/06/2026"></div>
          <div class="cs-form-group"><label>⏰ الوقت</label><input id="cs-f-time" value="${m.time||''}" placeholder="مثال: 21:00"></div>
        </div>
        <div class="cs-form-group"><label>🏟️ الملعب <span style="color:#444">(اختياري)</span></label><input id="cs-f-venue" value="${m.venue||''}" placeholder="اسم الملعب"></div>
        <div class="cs-form-row">
          <div class="cs-form-group"><label>🧑‍⚖️ الحكم <span style="color:#444">(اختياري)</span></label><input id="cs-f-referee" value="${m.referee||''}" placeholder="اسم الحكم"></div>
          <div class="cs-form-group"><label>🎙️ المعلق <span style="color:#444">(اختياري)</span></label><input id="cs-f-commentator" value="${m.commentator||''}" placeholder="اسم المعلق"></div>
        </div>
        <div class="cs-form-group"><label>🏆 المرحلة <span style="color:#444">(اختياري)</span></label><input id="cs-f-stage" value="${m.knockoutRoundName||(m.round?`الجولة ${m.round}`:'')}" placeholder="مثال: ربع النهائي"></div>`;
    } else if (type === 'postmatch') {
      extraFields = `
        <div class="cs-form-group"><label>🏆 المرحلة <span style="color:#444">(اختياري)</span></label><input id="cs-f-stage" value="${m.knockoutRoundName||(m.round?`الجولة ${m.round}`:'')}" placeholder="مثال: نصف النهائي"></div>
        <div class="cs-form-group"><label>🌟 رجل المباراة <span style="color:#444">(اختياري)</span></label><input id="cs-f-mom" value="${m.manOfMatch||''}" placeholder="اسم اللاعب"></div>`;
    } else if (type === 'mom') {
      const players = _getMatchPlayers(m);
      const picker  = players.length ? `
        <div style="font-size:10px;color:#555;font-weight:700;margin-bottom:8px;font-family:Tajawal,sans-serif">اختر اللاعب أو اكتب اسمه</div>
        <div class="cs-mom-grid">${players.map(p=>`<div class="cs-mom-player" onclick="window._csMomSelect(this,'${p.name}','${p.team}')"><div class="cs-mom-player-name">${p.name}</div><div class="cs-mom-player-team">${p.team}</div></div>`).join('')}</div>` : '';
      extraFields = `
        ${picker}
        <div class="cs-form-group"><label>🌟 اسم اللاعب</label><input id="cs-f-mom" placeholder="اكتب اسم رجل المباراة"></div>
        <div class="cs-form-group"><label>⚽ الفريق</label><input id="cs-f-mom-team" placeholder="${ht.name} أو ${at.name}"></div>
        <div class="cs-form-row">
          <div class="cs-form-group"><label>⚽ أهداف</label><input id="cs-f-goals" type="number" min="0" placeholder="0"></div>
          <div class="cs-form-group"><label>🎯 تمريرات</label><input id="cs-f-assists" type="number" min="0" placeholder="0"></div>
        </div>
        <div class="cs-form-group"><label>⭐ التقييم (اختياري)</label><input id="cs-f-rating" type="number" min="0" max="10" step="0.1" placeholder="مثال: 8.5"></div>`;
    } else if (type === 'qual') {
      const hs_ = m.homeScore??0, as__ = m.awayScore??0;
      const hasPens_ = m.penaltyScoreHome!=null && hs_===as__;
      const winner_  = hs_>as__ ? ht : hasPens_ ? (m.penaltyScoreHome>m.penaltyScoreAway?ht:at) : at;
      extraFields = `
        <div class="cs-form-group"><label>🏆 المتأهل</label><input id="cs-f-qual" value="${winner_.name}" placeholder="اسم الفريق المتأهل"></div>
        <div class="cs-form-group"><label>➡️ الدور القادم <span style="color:#444">(اختياري)</span></label><input id="cs-f-nextstage" placeholder="مثال: نصف النهائي"></div>`;
    }

    const modal = getModal();
    modal.querySelector('.cs-modal-inner').innerHTML = `
      <div class="cs-modal-top">
        <button class="cs-modal-back" onclick="window._csOpenMatch('${_state.matchId}')">‹</button>
        <div style="flex:1;min-width:0">
          <div class="cs-card-type-badge" style="background:${tc.bg};border-color:${tc.border};color:${tc.text}">${tc.label}</div>
          <div class="cs-modal-title">${typeIcons[type]} ${typeLabels[type]}</div>
          <div class="cs-modal-sub">${ht.name} × ${at.name}</div>
        </div>
        <div class="cs-modal-league-badge">
          ${lgLogo?`<img src="${lgLogo}" alt="">`:`<span style="font-size:14px">🏆</span>`}
          <span>${lgName}</span>
        </div>
      </div>

      <div class="cs-form">${extraFields}</div>

      <div id="cs-preview-wrap" class="cs-preview-wrap" style="display:none">
        <div class="cs-preview-label">معاينة البطاقة</div>
        <canvas id="cs-preview-canvas"></canvas>
      </div>

      <div class="cs-actions">
        <button class="cs-action-btn primary" onclick="window._csGenerate()"><span>✨</span> توليد البطاقة</button>
        <button class="cs-action-btn secondary" id="cs-btn-download" style="display:none" onclick="window._csDownload()"><span>💾</span> حفظ الصورة</button>
      </div>
      <div class="cs-actions" id="cs-share-btns" style="display:none">
        <button class="cs-action-btn share-wa" onclick="window._csShareWA()"><span>📲</span> واتساب</button>
        <button class="cs-action-btn share-tg" onclick="window._csShareTG()"><span>✈️</span> تيليجرام</button>
        <button class="cs-action-btn secondary" onclick="window._csShareNative()"><span>🔗</span> مشاركة</button>
      </div>`;
    openModal();
  }

  // ── توليد البطاقة ─────────────────────────────────────────────
  async function generateCard() {
    const m = getMatches().find(x => x.id === _state.matchId);
    if (!m) return;
    const pw = document.getElementById('cs-preview-wrap');
    const pc = document.getElementById('cs-preview-canvas');
    const bd = document.getElementById('cs-btn-download');
    const sb = document.getElementById('cs-share-btns');
    if (pw) pw.style.display = 'block';
    if (pc) pc.style.opacity = '.3';
    const extras = readFormExtras(_state.cardType);
    let canvas;
    try {
      switch (_state.cardType) {
        case 'prematch':  canvas = await genPreMatchCanvas(m, extras);  break;
        case 'postmatch': canvas = await genPostMatchCanvas(m, extras); break;
        case 'mom':       canvas = await genMOMCanvas(m, extras);       break;
        case 'qual':      canvas = await genQualCanvas(m, extras);      break;
      }
    } catch(e) {
      console.error(e);
      if (window.showToast) window.showToast('خطأ في توليد البطاقة', 'error');
      return;
    }
    if (!canvas) return;
    if (pc) { pc.width=canvas.width; pc.height=canvas.height; pc.getContext('2d').drawImage(canvas,0,0); pc.style.opacity='1'; }
    _state.canvasData = canvas.toDataURL('image/png');
    const typeLabels = { prematch:'⚽ قبل المباراة', postmatch:'🏁 النتيجة', mom:'🌟 رجل المباراة', qual:'🏆 التأهل' };
    if (!_state.history[_state.matchId]) _state.history[_state.matchId] = [];
    _state.history[_state.matchId].push({
      type: _state.cardType,
      label: typeLabels[_state.cardType],
      dataUrl: _state.canvasData,
      dateStr: new Date().toLocaleDateString('ar-SA',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
    });
    if (bd) bd.style.display = '';
    if (sb) sb.style.display = '';
    if (window.showToast) window.showToast('✅ تم توليد البطاقة', 'success');
  }

  function readFormExtras(type) {
    const v = id => (document.getElementById(id)||{}).value||'';
    const n = id => parseFloat(v(id));
    if (type==='prematch')  return { date:v('cs-f-date'), time:v('cs-f-time'), venue:v('cs-f-venue'), referee:v('cs-f-referee'), commentator:v('cs-f-commentator'), stage:v('cs-f-stage') };
    if (type==='postmatch') return { stage:v('cs-f-stage'), mom:v('cs-f-mom') };
    if (type==='mom')       return { mom:v('cs-f-mom'), momTeam:v('cs-f-mom-team'), goals:isNaN(n('cs-f-goals'))?null:n('cs-f-goals'), assists:isNaN(n('cs-f-assists'))?null:n('cs-f-assists'), rating:isNaN(n('cs-f-rating'))?null:n('cs-f-rating') };
    if (type==='qual')      return { qual:v('cs-f-qual'), nextStage:v('cs-f-nextstage') };
    return {};
  }

  function _getMatchPlayers(m) {
    const players = [];
    const ht = getTeam(m.homeId, m.homeName);
    const at = getTeam(m.awayId, m.awayName);
    const parse = (str, team) => {
      if (!str) return;
      str.split(',').forEach(p => { const n = p.trim().split('(')[0].trim(); if(n) players.push({name:n, team:team.name}); });
    };
    parse(m.homeScorers, ht); parse(m.awayScorers, at);
    if (m.liveData && m.liveData.events) {
      m.liveData.events.forEach(ev => { if(ev.player && !players.find(p=>p.name===ev.player)) players.push({name:ev.player, team:ev.team==='home'?ht.name:at.name}); });
    }
    return [...new Map(players.map(p=>[p.name,p])).values()].slice(0,12);
  }

  // ── المشاركة ─────────────────────────────────────────────────

  /* ── نص إعلان البطولة للمشاركة ── */
  function _buildShareText(name, url) {
    const S  = window.settings || {};

    // رسالة ترحيب بسيطة باسم البطولة فقط — بلا نوع البطولة ولا عدد الفرق
    const L = [];
    L.push('*' + name + '*' + (S.season ? ' · ' + S.season : ''));
    L.push('');
    L.push('تابع البطولة لحظة بلحظة');
    L.push('كل النتائج والترتيب والهدافون والبث المباشر في مكان واحد.');
    L.push('');
    L.push('اضغط للمتابعة:');
    L.push(url);
    L.push('');
    L.push('_منصة بطولات — تطوير عبدالله السكني_');
    return L.join('\n');
  }

  function shareCard(platform) {
    if (!_state.canvasData) return;
    const blob = dataURLtoBlob(_state.canvasData);
    const file = new File([blob], 'card.png', { type:'image/png' });
    const name = getLeagueName();
    // ✅ إصلاح: كانت الشرطة المزدوجة تُنتج رابطاً مكسوراً (//league-viewer.html)
    const url  = typeof window._getLeagueId==='function'
      ? `${location.origin}${location.pathname.replace(/\/[^/]*$/,'/')}league-viewer.html?id=${window._getLeagueId()}`
      : location.href;
    /* ✅ إعلان البطولة مع كل بطاقة تُشارَك.
       كل صورة تُنشر في مجموعة واتساب = إعلان مجاني لبطولتك.
       النص يتكيّف مع نوع البطولة وحالتها الحيّة، وينتهي بدعوة
       واضحة للمتابعة + رابط الجمهور. */
    const text = _buildShareText(name, url);
    if (platform==='native' && navigator.share && navigator.canShare && navigator.canShare({files:[file]})) { navigator.share({title:name,text,files:[file]}).catch(()=>{}); return; }
    if (platform==='wa') { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank'); return; }
    if (platform==='tg') { window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,'_blank'); return; }
    const a = document.createElement('a'); a.href=_state.canvasData; a.download='match-card.png'; a.click();
  }

  function dataURLtoBlob(dataURL) {
    const [header,data] = dataURL.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const bin  = atob(data);
    const arr  = new Uint8Array(bin.length);
    for (let i=0; i<bin.length; i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr],{type:mime});
  }

  // ── Modal helpers ────────────────────────────────────────────
  function getModal() {
    let m = document.getElementById('cs-modal');
    if (!m) { m=document.createElement('div'); m.id='cs-modal'; m.innerHTML=`<div class="cs-modal-inner"></div>`; document.body.appendChild(m); }
    return m;
  }
  function openModal() { getModal().classList.add('open'); document.body.style.overflow='hidden'; }

  // ─── بناء صفحة البطاقات (هيدر + لوحة الهوية + قائمة) ─────────
  function upgradeCardsPageHTML() {
    const page = document.getElementById('page-cards');
    if (!page) return;
    const lg   = getLeague();
    const name = getLeagueName();
    const logo = _state.leagueLogoOverride || lg.logo || '';
    const logoHtml = logo
      ? `<div class="cs-header-league-logo"><img src="${logo}" alt=""></div>`
      : `<div class="cs-header-league-logo">🏆</div>`;

    page.innerHTML = `
      ${buildIdentityPanel()}
      <div class="cs-header">
        ${logoHtml}
        <div class="cs-header-text">
          <div class="cs-header-title">${name}</div>
          <div class="cs-header-sub">🎴 اختر مباراة لإنشاء بطاقة احترافية</div>
        </div>
      </div>
      <div id="cardsList"><div class="cs-spinner"></div></div>
    `;
  }

  // ─── Public API ───────────────────────────────────────────────
  window._csOpenMatch   = id  => openMatchModal(id);
  window._csOpenForm    = t   => openFormModal(t);
  window._csCloseModal  = ()  => { getModal().classList.remove('open'); document.body.style.overflow=''; renderCardsPage(); };
  window._csGenerate    = ()  => generateCard();
  window._csDownload    = ()  => { if(_state.canvasData){const a=document.createElement('a');a.href=_state.canvasData;a.download='match-card.png';a.click();} };
  window._csShareWA     = ()  => shareCard('wa');
  window._csShareTG     = ()  => shareCard('tg');
  window._csShareNative = ()  => shareCard('native');

  /* ✅ انتقال لصفحة الإعدادات لتغيير الاسم/الشعار */
  window._csGoSettings = () => {
    const sb = document.querySelector('.sb-item[onclick*="\'settings\'"]');
    if (typeof window.showPage === 'function') window.showPage('settings', sb);
    if (typeof window.lgRefreshPreview === 'function') window.lgRefreshPreview();
    window.showToast && window.showToast('✏️ عدّل اسم البطولة أو شعارها من هنا', 'success');
  };

  window._csSetName = (val) => {
    _state.leagueNameOverride = val.trim() || null;
    const hTitle = document.querySelector('.cs-header-title');
    if (hTitle) hTitle.textContent = val.trim() || getLeague().name || 'البطولة';
  };

  window._csSetAccent = (color, swatchEl) => {
    _state.accentColor = color;
    document.querySelectorAll('.cs-id-swatch').forEach(s => s.classList.remove('active'));
    if (swatchEl && swatchEl.classList.contains('cs-id-swatch')) swatchEl.classList.add('active');
  };

  window._csUploadLogo = (input) => {
    const file = input.files[0];
    if (!file) return;
    const nameInput = document.getElementById('cs-id-name-input');
    if (nameInput && nameInput.value.trim()) _state.leagueNameOverride = nameInput.value.trim();
    const reader = new FileReader();
    reader.onload = e => {
      _state.leagueLogoOverride = e.target.result;
      upgradeCardsPageHTML();
      renderCardsPage();
    };
    reader.readAsDataURL(file);
  };

  window._csMomSelect = (el, name, team) => {
    document.querySelectorAll('.cs-mom-player').forEach(b=>b.classList.remove('selected'));
    el.classList.add('selected');
    const n=document.getElementById('cs-f-mom'); const t=document.getElementById('cs-f-mom-team');
    if(n) n.value=name; if(t) t.value=team;
  };

  window._csShowHistoryCard = (i, matchId) => {
    const h = (_state.history[matchId]||[])[i];
    if (!h) return;
    _state.canvasData = h.dataUrl;
    const m  = getMatches().find(x=>x.id===matchId);
    const ht = m ? getTeam(m.homeId,m.homeName) : {name:''};
    const at = m ? getTeam(m.awayId,m.awayName) : {name:''};
    const modal = getModal();
    modal.querySelector('.cs-modal-inner').innerHTML = `
      <div class="cs-modal-top">
        <button class="cs-modal-back" onclick="window._csOpenMatch('${matchId}')">‹</button>
        <div><div class="cs-modal-title">${h.label}</div><div class="cs-modal-sub">${ht.name} × ${at.name} · ${h.dateStr}</div></div>
      </div>
      <div class="cs-preview-wrap">
        <img src="${h.dataUrl}" style="width:100%;border-radius:10px;display:block">
      </div>
      <div class="cs-actions">
        <button class="cs-action-btn secondary" onclick="window._csDownload()"><span>💾</span> حفظ</button>
        <button class="cs-action-btn share-wa" onclick="window._csShareWA()"><span>📲</span> واتساب</button>
        <button class="cs-action-btn share-tg" onclick="window._csShareTG()"><span>✈️</span> تيليجرام</button>
        <button class="cs-action-btn secondary" onclick="window._csShareNative()"><span>🔗</span> مشاركة</button>
      </div>`;
    openModal();
  };

  // ─── Override renderCards ──────────────────────────────────────
  window._renderCardsNew    = renderCardsPage;
  window.renderCards        = renderCardsPage;
  window._cardsSystemLoaded = true;

  // ─── init ─────────────────────────────────────────────────────
  function init() {
    injectCSS();
    upgradeCardsPageHTML();

    const origShowPage = window.showPage;
    if (typeof origShowPage === 'function') {
      window.showPage = function(name, sb, mn) {
        origShowPage(name, sb, mn);
        if (name === 'cards') { upgradeCardsPageHTML(); renderCardsPage(); }
      };
    }
    window.renderCards = function() { upgradeCardsPageHTML(); renderCardsPage(); };
    // console.log('[cards-system] ✅ v4 — هوية موحدة جاهزة');
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }

})();
