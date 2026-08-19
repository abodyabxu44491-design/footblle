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
  const STEEL  = '#3A4A5E'; // لون ثانوي هادئ للعمق والتفاصيل الثانوية
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
  // قصّ الاسم ليتناسب مع عرض معيّن (يحافظ على شكل مرتّب)
  function fitName(ctx, text, maxW) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

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
    // ✅︎ إعادة تصميم: بلا ظلال أو توهج — نص نظيف حاد فقط
    ctx.font = font; ctx.textAlign = align || 'center';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // ── فاصل أفقي نظيف (خط رفيع ثابت) ────────────────────────────────
  function drawDivider(ctx, W, y, opacity, accent) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, y + 0.5); ctx.lineTo(W - 80, y + 0.5); ctx.stroke();
    ctx.restore();
  }

  // ── رسم شعار فريق ────────────────────────────────────────────────
  // رسم صورة داخل مربّع بنظام cover (تملأ المساحة بنسبتها الصحيحة بلا تشويه)
  function _drawImgCover(ctx, img, dx, dy, dSize) {
    const iw = img.naturalWidth || img.width || dSize;
    const ih = img.naturalHeight || img.height || dSize;
    if (!iw || !ih) { ctx.drawImage(img, dx, dy, dSize, dSize); return; }
    const scale = Math.max(dSize / iw, dSize / ih);
    const sw = dSize / scale, sh = dSize / scale;      // منطقة المصدر المقصوصة (مربّعة)
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;      // توسيط القصّ
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dSize, dSize);
  }

  function drawLogo(ctx, img, emoji, x, y, size) {
    if (img) {
      ctx.save(); ctx.beginPath();
      const r = size * 0.18;
      ctx.roundRect(x, y, size, size, r); ctx.clip();
      _drawImgCover(ctx, img, x, y, size); ctx.restore();
    } else if (emoji && emoji.length <= 4) {
      ctx.font = `${size*0.75}px Arial`; ctx.textAlign = 'center';
      ctx.fillText(emoji, x+size/2, y+size*0.78);
    }
  }

  // ── شعار داخل قرص دائري نظيف بحلقة موحّدة (مظهر أفخم) ──────────────
  function drawLogoFramed(ctx, img, emoji, cx, cy, size, accent, highlight) {
    const rgb = hexToRgb(accent || GOLD);
    const R   = size/2;
    // قرص خلفي
    ctx.beginPath(); ctx.arc(cx, cy, R+14, 0, Math.PI*2);
    ctx.fillStyle = highlight ? `rgba(${rgb},0.08)` : 'rgba(255,255,255,0.03)';
    ctx.fill();
    // حلقة خارجية
    ctx.beginPath(); ctx.arc(cx, cy, R+14, 0, Math.PI*2);
    ctx.strokeStyle = highlight ? `rgba(${rgb},0.55)` : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = highlight ? 2.5 : 1.5;
    ctx.stroke();
    // الشعار داخل قصّ دائري (يملأ الدائرة كاملة بلا تشويه)
    if (img) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.clip();
      _drawImgCover(ctx, img, cx-R, cy-R, size); ctx.restore();
    } else {
      ctx.font = `${size*0.62}px Arial`; ctx.textAlign = 'center';
      ctx.fillText(emoji || '⚽', cx, cy+size*0.22);
    }
    // شارة "الفائز" صغيرة أعلى الشعار
    if (highlight) {
      const by = cy - R - 14;
      ctx.font = '700 15px Tajawal,Arial';
      const t = '★ الفائز';
      const tw = ctx.measureText(t).width + 22;
      roundRect(ctx, cx-tw/2, by-14, tw, 28, 14);
      ctx.fillStyle = accent || GOLD; ctx.fill();
      drawText(ctx, t, cx, by+5, '700 15px Tajawal,Arial', '#0c0c0d', 'center');
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  رسم خلفية البطاقة الموحدة
  // ════════════════════════════════════════════════════════════════
  function drawBackground(ctx, W, H, accent) {
    const ac  = accent || _state.accentColor || GOLD;
    const rgb = hexToRgb(ac);
    const st  = hexToRgb(STEEL);

    // تدرّج عمودي غنيّ — عمق رياضي
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#14161c');
    bg.addColorStop(0.45,'#0d0f13');
    bg.addColorStop(1,   '#070809');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // ── أشرطة قطرية ديناميكية (إحساس الحركة كخلفيات الأندية) ──
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
      ctx.fillStyle = i % 2 === 0 ? `rgba(${rgb},0.020)` : `rgba(${st},0.020)`;
      ctx.fill();
    }
    ctx.restore();

    // توهّج قطري علوي من الزاوية (طاقة)
    const cg = ctx.createRadialGradient(W*0.82, H*0.08, 0, W*0.82, H*0.08, W*0.85);
    cg.addColorStop(0, `rgba(${rgb},0.18)`);
    cg.addColorStop(0.5, `rgba(${rgb},0.04)`);
    cg.addColorStop(1, 'transparent');
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);

    // إضاءة سفلية خافتة (توازن)
    const bgl = ctx.createRadialGradient(W*0.2, H*0.95, 0, W*0.2, H*0.95, W*0.7);
    bgl.addColorStop(0, `rgba(${st},0.10)`);
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
    roundRect(ctx, pad, pad, W - pad*2, H - pad*2, 22);
    ctx.stroke();

    // ── watermark رياضي خفيف: دائرة تكتيكية كبيرة أسفل-وسط (كلوحة المدرّب) ──
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(${rgb},0.05)`;
    ctx.lineWidth = 2;
    const wmY = H * 0.72, wmR = W * 0.34;
    ctx.beginPath(); ctx.arc(W/2, wmY, wmR, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2, wmY, wmR*0.6, 0, Math.PI*2); ctx.stroke();
    // خط أفقي عبر المركز
    ctx.beginPath(); ctx.moveTo(W/2-wmR, wmY); ctx.lineTo(W/2+wmR, wmY); ctx.stroke();
    ctx.restore();
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
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, topY, W, BH);

    // خط سفلي فاصل — ذهبي رفيع فوق ظل فولاذي
    ctx.strokeStyle = `rgba(${hexToRgb(_state.accentColor||GOLD)},0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, topY+BH+0.5); ctx.lineTo(W-80, topY+BH+0.5); ctx.stroke();
    ctx.strokeStyle = `rgba(${hexToRgb(STEEL)},0.4)`;
    ctx.beginPath(); ctx.moveTo(120, topY+BH+2.5); ctx.lineTo(W-120, topY+BH+2.5); ctx.stroke();

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
      _drawImgCover(ctx, lgImg, startX, cy-logoSz/2, logoSz); ctx.restore();

      // حلقة رفيعة هادئة
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(startX+logoSz/2, cy, logoSz/2+1.5, 0, Math.PI*2); ctx.stroke();

      // اسم البطولة
      ctx.font = 'bold 28px Tajawal,Arial';
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      ctx.fillText(name, startX+logoSz+gap, cy+10);
      ctx.textAlign = 'center';

    } else {
      // بدون شعار
      ctx.font = '32px Arial'; ctx.textAlign = 'center'; ctx.fillText('🏆', W/2-100, cy+11);
      ctx.font = 'bold 28px Tajawal,Arial'; ctx.fillStyle = '#ffffff';
      ctx.fillText(name, W/2+20, cy+11);
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
    ctx.fillStyle = `rgba(${rgb},0.10)`;
    ctx.strokeStyle = `rgba(${rgb},0.35)`;
    ctx.lineWidth = 1;
    roundRect(ctx, bx, y+4, tw, BH-8, 18); ctx.fill(); ctx.stroke();

    // نقطة يمين النص
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(bx+18, y+BH/2, 4, 0, Math.PI*2); ctx.fill();

    drawText(ctx, stageLabel, W/2+8, y+BH/2+7, '700 20px Tajawal,Arial', accent, 'center');
    return BH;
  }

  // ════════════════════════════════════════════════════════════════
  //  شريط فوتر موحد أسفل البطاقة
  // ════════════════════════════════════════════════════════════════
  function drawBottomBar(ctx, W, H) {
    const BH = 66;
    const by = H - BH;

    // خط علوي رفيع فقط
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, by+0.5); ctx.lineTo(W-80, by+0.5); ctx.stroke();

    // حقوق المنصة — سطران
    ctx.textAlign = 'center';
    ctx.font = '700 15px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('منصة بطولات', W/2, by + 30);
    ctx.font = '400 12px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fillText('تطوير وبرمجة عبدالله السكني', W/2, by + 49);
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
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      roundRect(ctx, cx, startY, cw, H_CELL, 14); ctx.fill(); ctx.stroke();

      // خط علوي ملون رفيع
      ctx.strokeStyle = `rgba(${rgb},0.5)`; ctx.lineWidth = 2;
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
  function drawTeamsSection(ctx, W, topY, hImg, aImg, htName, atName, centerText, centerColor, accent, logoSize, hEmoji, aEmoji, winnerSide) {
    const rgb    = hexToRgb(accent);
    const LS     = logoSize || 210;
    const HCX    = W/2 - 272;
    const ACX    = W/2 + 272;
    const LTY    = topY;
    const LCY    = LTY + LS/2;
    const isScore = typeof centerText === 'string' && centerText.includes('–');

    // الشعارات داخل أقراص مؤطّرة (بلا تمييز فائز)
    drawLogoFramed(ctx, hImg, hEmoji || '⚽', HCX, LCY, LS, accent, false);
    drawLogoFramed(ctx, aImg, aEmoji || '⚽', ACX, LCY, LS, accent, false);

    // النتيجة — أضخم مع قرص خلف كل رقم (للنتيجة فقط)
    ctx.save();
    ctx.direction = 'ltr';
    if (isScore) {
      const parts = centerText.split('–').map(s => s.trim());
      const gap = 70, discR = 52;
      const cxL = W/2 - gap, cxR = W/2 + gap, cyc = LCY - 4;
      [[cxL, parts[0]], [cxR, parts[1]]].forEach(([cx, num]) => {
        ctx.beginPath(); ctx.arc(cx, cyc, discR, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},0.28)`; ctx.lineWidth = 1.5; ctx.stroke();
        drawText(ctx, num, cx, cyc + 32, 'bold 90px Tajawal,Arial', '#ffffff', 'center');
      });
      drawText(ctx, '–', W/2, cyc + 26, 'bold 60px Tajawal,Arial', `rgba(${rgb},0.9)`, 'center');
    } else {
      drawText(ctx, centerText, W/2, LCY + 20, 'bold 58px Tajawal,Arial', centerColor || accent, 'center');
    }
    ctx.restore();

    // أسماء الفرق — بلا تمييز فائز (كلاهما بنفس النمط)
    const NY = LTY + LS + 40;
    const drawName = (name, cx) => {
      ctx.font = 'bold 27px Tajawal,Arial';
      const tw = ctx.measureText(name).width;
      const bw = tw + 44, bh = 44;
      ctx.fillStyle   = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      roundRect(ctx, cx-bw/2, NY-28, bw, bh, 12); ctx.fill(); ctx.stroke();
      drawText(ctx, name, cx, NY+1, 'bold 27px Tajawal,Arial', '#dddddd', 'center');
    };
    drawName(htName, HCX);
    drawName(atName, ACX);

    return NY + 26;
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
    const stage = extras.stage || m.knockoutRoundName || (m.groupName ? (m.groupName + (m.round ? ' · الجولة ' + m.round : '')) : (m.round ? `الجولة ${m.round}` : ''));
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
    const stage    = extras.stage || m.knockoutRoundName || (m.groupName ? (m.groupName + (m.round ? ' · الجولة ' + m.round : '')) : (m.round ? `الجولة ${m.round}` : ''));
    const endLabel = stage ? `🏁  نهاية المباراة  ·  ${stage}` : '🏁  نهاية المباراة';
    drawText(ctx, endLabel, W/2, curY+16, '700 17px Tajawal,Arial', '#666', 'center');
    curY += 38;

    // ─ 3) قسم الفرق + النتيجة
    const scoreStr  = `${hs}  –  ${as_}`;
    const _winSide = hasPens
      ? (m.penaltyScoreHome > m.penaltyScoreAway ? 'home' : 'away')
      : (hw ? 'home' : aw ? 'away' : null);
    const afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, scoreStr, '#ffffff', accent, 192, ht.logo, at.logo, _winSide);
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

    // الهدافون — عمودان: كل فريق هدّافوه تحته بالدقائق (مطابقٌ لجهة الشعار)
    const hSc = (m.homeScorers||'').split(',').map(s=>s.trim()).filter(Boolean);
    const aSc = (m.awayScorers||'').split(',').map(s=>s.trim()).filter(Boolean);
    if (hSc.length || aSc.length) {
      drawText(ctx, '⚽  الهدافون', W/2, curY, '700 16px Tajawal,Arial', accent, 'center');
      curY += 34;

      const colHomeX = W * 0.27;   // المضيف يسار — مطابقٌ لجهة شعاره
      const colAwayX = W * 0.73;   // الضيف يمين
      const headY = curY;

      // رؤوس الأعمدة: اسم كل فريق
      drawText(ctx, fitName(ctx, ht.name, 360), colHomeX, headY, '800 19px Tajawal,Arial', '#ccc', 'center');
      drawText(ctx, fitName(ctx, at.name, 360), colAwayX, headY, '800 19px Tajawal,Arial', '#ccc', 'center');
      // خط رفيع تحت كل رأس
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      [colHomeX, colAwayX].forEach(cx0 => {
        ctx.beginPath(); ctx.moveTo(cx0-130, headY+14); ctx.lineTo(cx0+130, headY+14); ctx.stroke();
      });

      const listY = headY + 44;
      const lh = 34;
      const drawScorerCol = (list, cx0) => {
        let yy = listY;
        if (!list.length) { drawText(ctx, '—', cx0, yy, '400 17px Tajawal,Arial', '#666', 'center'); return yy + lh; }
        // ✅ تجميع الأهداف حسب اسم اللاعب — الاسم يظهر مرة واحدة فقط، وبجانبه
        //    كرة ⚽ لكل هدف سجّله (ثنائية = كرتان، هاتريك = ثلاث...) بدل تكرار
        //    اسمه مرة لكل هدف مع دقيقته
        const grouped = [];
        list.forEach(s => {
          const mt = s.match(/^(.*?)[\s\u00A0]*(\d+\+?\d*)'?\s*$/);
          const nm = (mt ? mt[1] : s).trim();
          if (!nm) return;
          const found = grouped.find(g => g.name === nm);
          if (found) found.count++; else grouped.push({ name: nm, count: 1 });
        });
        grouped.slice(0,8).forEach(g => {
          const balls = '⚽'.repeat(Math.min(g.count, 6)); // سقف بصري احترازي
          // الاسم
          ctx.font = '700 19px Tajawal,Arial'; ctx.fillStyle = '#eee';
          const nmFit = fitName(ctx, g.name, 200);
          const nmW = ctx.measureText(nmFit).width;
          if (balls) {
            ctx.font = '15px Arial';
            const ballsW = ctx.measureText(balls).width;
            const total = nmW + 8 + ballsW;
            const startX = cx0 + total/2;
            ctx.textAlign = 'right'; ctx.font = '700 19px Tajawal,Arial'; ctx.fillStyle = '#eee';
            ctx.fillText(nmFit, startX, yy);
            ctx.textAlign = 'left'; ctx.font = '15px Arial'; ctx.fillStyle = '#eee';
            ctx.fillText(balls, startX - nmW - 8, yy+1);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(nmFit, cx0, yy);
          }
          yy += lh;
        });
        return yy;
      };
      const endH = drawScorerCol(hSc, colHomeX);
      const endA = drawScorerCol(aSc, colAwayX);
      curY = Math.max(endH, endA) + 6;
      ctx.textAlign = 'center';
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

    // خلفية نظيفة موحّدة (بلا شبكة/توهج/زوايا)
    drawBackground(ctx, W, H, accent);

    // 1) هوية
    const ID_TOP = 16;
    const idH    = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg);
    let curY     = ID_TOP + idH + 40;

    // 2) أيقونة نجمة رياضية مرسومة (بدل emoji) + توهّج
    const starCy = curY + 44;
    ctx.save();
    // توهّج خلف النجمة
    const sg = ctx.createRadialGradient(W/2, starCy, 0, W/2, starCy, 90);
    sg.addColorStop(0, `rgba(${rgb},0.35)`); sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(W/2, starCy, 90, 0, Math.PI*2); ctx.fill();
    _drawStar(ctx, W/2, starCy, 42, 20, accent);
    ctx.restore();
    curY += 108;
    drawText(ctx, 'رجل المباراة', W/2, curY, 'bold 38px Tajawal,Arial', accent, 'center');
    curY += 34;
    drawText(ctx, `${ht.name}  ×  ${at.name}`, W/2, curY+4, '700 18px Tajawal,Arial', '#888', 'center');
    curY += 40;
    drawDivider(ctx, W, curY); curY += 52;

    // 3) اسم اللاعب — كبير مع توهّج ذهبي خفيف (طاقة)
    ctx.save();
    ctx.shadowColor = `rgba(${rgb},0.5)`; ctx.shadowBlur = 24;
    drawText(ctx, mom, W/2, curY + 24, 'bold 80px Tajawal,Arial', '#ffffff', 'center');
    ctx.restore();
    curY += 66;

    if (momTeam) {
      ctx.font = '700 19px Tajawal,Arial';
      const tw = ctx.measureText(momTeam).width + 48;
      ctx.fillStyle = `rgba(${rgb},0.12)`;
      ctx.strokeStyle = `rgba(${rgb},0.4)`; ctx.lineWidth = 1.5;
      roundRect(ctx, W/2-tw/2, curY, tw, 40, 20); ctx.fill(); ctx.stroke();
      drawText(ctx, momTeam, W/2, curY+26, '700 18px Tajawal,Arial', accent, 'center');
      curY += 58;
    }

    curY += 14;

    // 4) إحصائيات — بطاقات رياضية أكبر بأرقام ضخمة
    const stats = [
      extras.goals   != null ? { label:'أهداف',   val: extras.goals,   ic:'⚽' } : null,
      extras.assists != null ? { label:'صناعة',   val: extras.assists, ic:'👟' } : null,
      extras.rating  != null ? { label:'التقييم', val: extras.rating,  ic:'⭐' } : null,
    ].filter(Boolean);

    if (stats.length) {
      const cw = Math.min(250, (W-120)/stats.length);
      const gap = 16;
      const totalW = cw*stats.length + gap*(stats.length-1);
      const sx = W/2 - totalW/2;
      const cardH = 150;
      stats.forEach((s,i) => {
        const cx = sx + i*(cw+gap);
        // خلفية بطاقة بتدرّج خفيف
        const cardG = ctx.createLinearGradient(cx, curY, cx, curY+cardH);
        cardG.addColorStop(0, `rgba(${rgb},0.08)`);
        cardG.addColorStop(1, 'rgba(255,255,255,0.02)');
        ctx.fillStyle = cardG;
        ctx.strokeStyle = `rgba(${rgb},0.28)`; ctx.lineWidth = 1.5;
        roundRect(ctx, cx, curY, cw, cardH, 18); ctx.fill(); ctx.stroke();
        // شريط علوي ذهبي سميك
        ctx.fillStyle = accent;
        roundRect(ctx, cx+cw/2-28, curY, 56, 5, 3); ctx.fill();
        // الرقم الضخم
        drawText(ctx, String(s.val), cx+cw/2, curY+82, 'bold 62px Tajawal,Arial', GOLD2, 'center');
        // التسمية
        drawText(ctx, s.label, cx+cw/2, curY+120, '700 19px Tajawal,Arial', '#c8ccd4', 'center');
      });
      curY += cardH + 40;
    }

    drawDivider(ctx, W, curY); curY += 48;

    // 5) النتيجة والمباراة — كبيرة
    ctx.save(); ctx.direction = 'ltr';
    drawText(ctx, `${m.homeScore??0}  –  ${m.awayScore??0}`, W/2, curY+14, 'bold 62px Tajawal,Arial', '#fff', 'center');
    ctx.restore();
    curY += 62;
    drawText(ctx, `${ht.name}  ×  ${at.name}`, W/2, curY+6, '600 19px Tajawal,Arial', '#777', 'center');

    drawBottomBar(ctx, W, H);
    return canvas;
  }

  // نجمة رياضية مرسومة (5 رؤوس) بتدرّج ذهبي
  function _drawStar(ctx, cx, cy, outer, inner, color) {
    const rgb = hexToRgb(color);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - outer, cx, cy + outer);
    g.addColorStop(0, '#F5D976'); g.addColorStop(1, color);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},0.6)`; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
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

    // خلفية نظيفة موحّدة
    drawBackground(ctx, W, H, accent);

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
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(W/2, curY+ls/2, ls/2+6, 0, Math.PI*2); ctx.stroke();
      ctx.save(); ctx.beginPath(); ctx.arc(W/2, curY+ls/2, ls/2, 0, Math.PI*2); ctx.clip();
      _drawImgCover(ctx, wImg, W/2-ls/2, curY, ls); ctx.restore();
    } else {
      ctx.font = '110px Arial'; ctx.textAlign = 'center'; ctx.fillText('⚽', W/2, curY+110);
    }
    curY += ls + 22;

    // 4) اسم المتأهل (بلا توهج)
    drawText(ctx, qualName, W/2, curY, 'bold 54px Tajawal,Arial', '#ffffff', 'center');
    curY += 28;
    drawDivider(ctx, W, curY); curY += 24;

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
          <div class="cs-form-group"><label>👟 صناعة</label><input id="cs-f-assists" type="number" min="0" placeholder="0"></div>
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
        <button class="cs-action-btn primary" onclick="window._csShareNative()" style="flex:2"><span>🔗</span> مشاركة البطاقة والمنشور</button>
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
    // خزّن السياق لبناء منشور المشاركة المناسب
    _state.currentMatch  = m;
    _state.currentExtras = extras;
    _state.currentType   = _state.cardType;

    // 👑 احفظ رجل المباراة في المباراة تلقائياً (ليظهر في إحصائيات اللاعب من كل مكان)
    const _momName = (extras.mom || '').trim();
    if (_momName && _momName !== (m.manOfMatch || '').trim()) {
      m.manOfMatch = _momName; // تحديث فوري محلي
      if (typeof window._saveMatchField === 'function') {
        try { window._saveMatchField(m.id, { manOfMatch: _momName }); } catch(e) {}
      }
    }

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
    const m  = _state.currentMatch || {};
    const ex = _state.currentExtras || {};
    const type = _state.currentType || 'postmatch';
    const ht = getTeam(m.homeId, m.homeName, m.homeLogo) || {};
    const at = getTeam(m.awayId, m.awayName, m.awayLogo) || {};
    const L = [];
    const line = '━━━━━━━━━━━━━━';

    const head = () => {
      let h = '🏆 *' + name + '*' + (S.season ? ' · ' + S.season : '');
      const stage = ex.stage || m.knockoutRoundName || (m.groupName ? (m.groupName + (m.round ? ' · الجولة ' + m.round : '')) : (m.round ? 'الجولة ' + m.round : ''));
      if (stage) h += '\n' + stage;
      return h;
    };

    if (type === 'postmatch') {
      const hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
      L.push('🏁 *انتهت المباراة*');
      L.push(head());
      L.push('');
      L.push('⚽ ' + (ht.name||'') + '  ' + hs + ' - ' + as_ + '  ' + (at.name||''));
      if (m.penaltyScoreHome != null && m.homeScore === m.awayScore)
        L.push('🥅 ركلات الترجيح: ' + m.penaltyScoreHome + ' - ' + m.penaltyScoreAway);
      // الهدّافون مرتّبون تحت كل فريق — كل اسم مفصول بوضوح عن دقيقته
      const _parseScorerLine = (s) => {
        const mt = String(s||'').trim().match(/^(.*?)[\s\u00A0]*(\d+\+?\d*)'?\s*$/);
        return mt ? { name: mt[1].trim(), min: mt[2] } : { name: String(s||'').trim(), min: '' };
      };
      const hSc = (m.homeScorers||'').split(',').map(s=>s.trim()).filter(Boolean).map(_parseScorerLine);
      const aSc = (m.awayScorers||'').split(',').map(s=>s.trim()).filter(Boolean).map(_parseScorerLine);
      if (hSc.length) { L.push(''); L.push('⚽ ' + (ht.name||'') + ':'); hSc.forEach(s => L.push('  • ' + s.name + (s.min ? '  —  ' + s.min + "'" : ''))); }
      if (aSc.length) { L.push(''); L.push('⚽ ' + (at.name||'') + ':'); aSc.forEach(s => L.push('  • ' + s.name + (s.min ? '  —  ' + s.min + "'" : ''))); }
      const mom = ex.mom || m.manOfMatch;
      if (mom) { L.push(''); L.push('🌟 رجل المباراة: ' + mom); }
    } else if (type === 'mom') {
      const mom = ex.mom || m.manOfMatch || '';
      L.push('🌟 *رجل المباراة*');
      L.push(head());
      L.push('');
      L.push('⭐ ' + mom);
      L.push((ht.name||'') + ' ضد ' + (at.name||''));
      const hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
      if (m.status === 'finished') L.push('النتيجة: ' + hs + ' - ' + as_);
    } else if (type === 'prematch') {
      L.push('⚽ *مباراة قادمة*');
      L.push(head());
      L.push('');
      L.push('⚔️ ' + (ht.name||'') + '  ضد  ' + (at.name||''));
      if (m.date) L.push('🗓️ ' + m.date + (m.time ? ' · ' + m.time : ''));
      if (m.stadium) L.push('🏟️ ' + m.stadium);
    } else if (type === 'qual') {
      L.push('🏆 *بطاقة التأهل*');
      L.push(head());
      L.push('');
      if (ex.qualText) L.push(ex.qualText);
    } else {
      L.push(head());
    }

    L.push('');
    L.push(line);
    L.push('📲 تابع كل التفاصيل والبث المباشر:');
    L.push(url);
    L.push('');
    L.push('_منصة بطولات — تطوير وبرمجة عبدالله السكني_');
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
    if (platform==='native' || platform==='share') {
      if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
        navigator.share({title:name, text, files:[file]}).catch(()=>{});
        return;
      }
      // بديل: احفظ الصورة وانسخ المنشور (للأجهزة التي لا تدعم المشاركة المباشرة)
      try {
        const a = document.createElement('a'); a.href=_state.canvasData; a.download='match-card.png'; a.click();
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        if (window.showToast) window.showToast('تم حفظ الصورة ونسخ المنشور — الصقه عند النشر', 'success');
      } catch(e) {}
      return;
    }
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
    // البطاقات أُدمجت داخل صفحة الإحصائيات — نبني داخل الحاوية المخصّصة
    // (cs-host) بدل صفحة page-cards المحذوفة.
    const page = document.getElementById('cs-host') || document.getElementById('page-cards');
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
        <button class="cs-action-btn primary" onclick="window._csShareNative()" style="flex:2"><span>🔗</span> مشاركة</button>
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
