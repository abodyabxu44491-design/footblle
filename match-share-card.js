/* ═══════════════════════════════════════════════════════════════════
 *  match-share-card.js — بطاقة مشاركة المباراة (تصميم موحّد مع الإدارة)
 *  ───────────────────────────────────────────────────────────────────
 *  يبني نفس هوية بطاقات لوحة التحكم (cards-system.js) بالضبط:
 *  خلفية داكنة متدرّجة + شريط هوية البطولة + شعارات مؤطّرة دائرية +
 *  خانات تفاصيل + شريط سفلي موحّد — بدل التصميم القديم المختلف.
 *  محتوى البطاقة يختلف حسب حالة المباراة:
 *    • قادمة   → الفريقان، الموعد، الملعب، الحكم/المعلق
 *    • مباشرة  → النتيجة الحية، الشوط/الوقت، الهدافون، البث
 *    • منتهية  → النتيجة النهائية، الهدافون، رجل المباراة، الحكم/المعلق/الملعب
 *
 *  يُحمَّل بعد viewer.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── هوية بصرية موحّدة (مطابقة لِـ cards-system.js) ─────────────────
  var GOLD  = '#C9A02B';
  var GOLD2 = '#F0C84A';
  var STEEL = '#3A4A5E';
  var LIVE  = '#D64541';
  var GREEN = '#2E9E5B';
  var CREDIT_1 = 'منصة بطولات';
  var CREDIT_2 = 'تطوير وبرمجة عبدالله السكني';

  function siteUrl() {
    return location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  }

  // ── بيانات المباراة ──────────────────────────────────────────────
  function team(m, side) {
    var T = window.teams || [];
    var id = side === 'home' ? m.homeId : m.awayId;
    var t = T.find(function (x) { return x.id === id; });
    return {
      name: (t && t.name) || (side === 'home' ? m.homeName : m.awayName) || 'فريق',
      logo: (t && t.logo) || (side === 'home' ? m.homeLogo : m.awayLogo) || ''
    };
  }

  function getLeague() { return window.league || {}; }
  function getLeagueName() { return getLeague().name || (window.settings && window.settings.leagueName) || 'البطولة'; }

  function fmt12(t) {
    if (!t) return '';
    if (typeof window.formatTimeTo12H === 'function') return window.formatTimeTo12H(t);
    return t;
  }
  function dateLabel(d) {
    if (!d) return '';
    return (window.DateGroups && window.DateGroups.label) ? window.DateGroups.label(d) : d;
  }

  function stageOf(m) {
    if (m.isKnockout && m.knockoutRoundName) return m.knockoutRoundName;
    if (m.groupName && m.round) return m.groupName + ' · الجولة ' + m.round;
    if (m.groupName) return m.groupName;
    if (m.round) return 'الجولة ' + m.round;
    return '';
  }

  function periodLabel(d) {
    if (!d) return '';
    return {
      live: d.currentHalf === 2 ? 'الشوط الثاني' : 'الشوط الأول',
      halftime: 'استراحة بين الشوطين', halftime_et: 'استراحة الإضافي',
      extratime1: 'الشوط الإضافي الأول', extratime2: 'الشوط الإضافي الثاني',
      penalties: 'ركلات الترجيح', ended: 'انتهت'
    }[d.matchStatus] || '';
  }

  function liveClock(d) {
    try {
      if (window.TimerCore && window.TimerCore.compute) {
        var c = window.TimerCore.compute(d, window.settings);
        if (c && c.clock) return c.clock;
      }
    } catch (e) {}
    return '';
  }

  // أهداف المباراة المباشرة من liveData.events → نفس صيغة "الاسم دقيقة'"
  function liveScorerStrings(m) {
    var d = m.liveData || {};
    var evs = (d.events || []).filter(function (e) { return e && e.type === 'goal'; });
    var home = [], away = [];
    evs.forEach(function (e) {
      var who = (e.player || e.playerName || '').trim();
      if (!who) return;
      var mn = e.extraMinute > 0 ? (e.minute + '+' + e.extraMinute) : e.minute;
      var row = who + ' ' + mn + "'";
      (e.team === 'away' || e.side === 'away' ? away : home).push(row);
    });
    return { home: home, away: away };
  }

  // ── تحميل الصور: نفس أسلوب لوحة التحكم (يدعم روابط خارجية أيضاً) ──
  function loadImg(src) {
    return new Promise(function (resolve) {
      if (!src || src.length < 5) { resolve(null); return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4000);
      img.onload = function () { if (done) return; done = true; clearTimeout(timer); resolve(img); };
      img.onerror = function () { if (done) return; done = true; clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }
  function loadLeagueLogo() { return loadImg(getLeague().logo); }

  // ── أيقونات SVG-vector (نفس مسارات لوحة التحكم) ──────────────────
  var ICON_PATHS = {
    ball:   'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7.5l3.3 2.4-1.3 3.9h-4l-1.3-3.9z M12 3v4.5M4.6 9.8l4.1 1.5M19.4 9.8l-4.1 1.5M8 19.6l2-4.3M16 19.6l-2-4.3',
    trophy: 'M7 4h10v5a5 5 0 0 1-10 0z M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3 M10 14h4M9 20h6M12 14v6',
    calendar:'M3 5h18v16H3z M3 10h18M8 3v4M16 3v4',
    clock:  'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3.5 2',
    stadium:'M12 9m-9 -4.5a9 4.5 0 1 0 18 0a9 4.5 0 1 0 -18 0 M3 9v5c0 2.5 4 4.5 9 4.5s9-2 9-4.5V9',
    whistle:'M8 13m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M13 13h8V8l-8 3 M8 13h.01',
    mic:    'M9 3h6v10a3 3 0 0 1-6 0z M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
    star:   'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    live:   'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M12 5v0M5 12v0M12 19v0M19 12v0'
  };
  var _iconCache = {};
  function _iconImg(name, color) {
    var key = name + '|' + color;
    if (_iconCache[key]) return _iconCache[key];
    var d = ICON_PATHS[name];
    if (!d) return null;
    var SCALE = 3, PX = 24 * SCALE;
    var c = document.createElement('canvas');
    c.width = PX; c.height = PX;
    var cx = c.getContext('2d');
    cx.scale(SCALE, SCALE);
    cx.strokeStyle = color; cx.lineWidth = 1.9;
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.stroke(new Path2D(d));
    _iconCache[key] = c;
    return c;
  }
  function drawIcon(ctx, name, cx, cy, size, color) {
    var img = _iconImg(name, color || '#eee');
    if (!img) return;
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  }
  function drawIconText(ctx, name, text, x, y, font, color, align, iconColor, gap) {
    gap = gap == null ? 8 : gap;
    ctx.font = font; ctx.textAlign = 'left';
    var tw = ctx.measureText(text).width;
    var iconSize = parseInt(font.match(/(\d+)px/)[1], 10) * 0.9;
    var total = iconSize + gap + tw;
    var startX;
    if (align === 'left') startX = x;
    else if (align === 'right') startX = x - total;
    else startX = x - total / 2;
    drawIcon(ctx, name, startX + iconSize / 2, y - iconSize * 0.33, iconSize, iconColor || color);
    ctx.textAlign = 'left'; ctx.fillStyle = color;
    ctx.fillText(text, startX + iconSize + gap, y);
    ctx.textAlign = 'center';
    return total;
  }

  function hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return r + ',' + g + ',' + b;
  }
  function fitName(ctx, text, maxW) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
    else {
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
  }
  function drawText(ctx, text, x, y, font, color, align) {
    ctx.font = font; ctx.textAlign = align || 'center';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  function drawDivider(ctx, W, y) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, y + 0.5); ctx.lineTo(W - 80, y + 0.5); ctx.stroke();
    ctx.restore();
  }
  function _drawImgCover(ctx, img, dx, dy, dSize) {
    var iw = img.naturalWidth || img.width || dSize, ih = img.naturalHeight || img.height || dSize;
    if (!iw || !ih) { ctx.drawImage(img, dx, dy, dSize, dSize); return; }
    var scale = Math.max(dSize / iw, dSize / ih);
    var sw = dSize / scale, sh = dSize / scale;
    var sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dSize, dSize);
  }

  // ── شعار داخل قرص دائري مؤطّر (مطابق للإدارة) ──────────────────────
  function drawLogoFramed(ctx, img, cx, cy, size, accent, highlight) {
    var rgb = hexToRgb(accent || GOLD);
    var R = size / 2;
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.fillStyle = highlight ? 'rgba(' + rgb + ',0.08)' : 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
    ctx.strokeStyle = highlight ? 'rgba(' + rgb + ',0.55)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = highlight ? 2.5 : 1.5;
    ctx.stroke();
    if (img) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      _drawImgCover(ctx, img, cx - R, cy - R, size); ctx.restore();
    } else {
      drawIcon(ctx, 'ball', cx, cy, size * 0.55, '#888');
    }
    if (highlight) {
      var by = cy - R - 14;
      var t = 'الفائز';
      ctx.font = '700 15px Tajawal,Arial';
      var tw = ctx.measureText(t).width + 42;
      roundRect(ctx, cx - tw / 2, by - 14, tw, 28, 14);
      ctx.fillStyle = accent || GOLD; ctx.fill();
      drawIconText(ctx, 'star', t, cx, by + 5, '700 15px Tajawal,Arial', '#0c0c0d', 'center', '#0c0c0d', 6);
    }
  }

  // ── خلفية البطاقة الموحّدة ──────────────────────────────────────
  function drawBackground(ctx, W, H, accent) {
    var ac = accent || GOLD;
    var rgb = hexToRgb(ac);
    var st = hexToRgb(STEEL);

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#14161c'); bg.addColorStop(0.45, '#0d0f13'); bg.addColorStop(1, '#070809');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = -2; i < 8; i++) {
      var x = i * (W / 6);
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.28, 0);
      ctx.lineTo(x + W * 0.28 - H * 0.5, H); ctx.lineTo(x - H * 0.5, H);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? 'rgba(' + rgb + ',0.020)' : 'rgba(' + st + ',0.020)';
      ctx.fill();
    }
    ctx.restore();

    var cg = ctx.createRadialGradient(W * 0.82, H * 0.08, 0, W * 0.82, H * 0.08, W * 0.85);
    cg.addColorStop(0, 'rgba(' + rgb + ',0.18)'); cg.addColorStop(0.5, 'rgba(' + rgb + ',0.04)'); cg.addColorStop(1, 'transparent');
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);

    var bgl = ctx.createRadialGradient(W * 0.2, H * 0.95, 0, W * 0.2, H * 0.95, W * 0.7);
    bgl.addColorStop(0, 'rgba(' + st + ',0.10)'); bgl.addColorStop(1, 'transparent');
    ctx.fillStyle = bgl; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = ac; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = 'rgba(' + st + ',0.6)'; ctx.fillRect(0, 8, W, 3);
    ctx.fillStyle = ac; ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = 'rgba(' + st + ',0.6)'; ctx.fillRect(0, H - 11, W, 3);

    var pad = 26;
    ctx.strokeStyle = 'rgba(' + rgb + ',0.26)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 22);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(' + rgb + ',0.05)';
    ctx.lineWidth = 2;
    var wmY = H * 0.72, wmR = W * 0.34;
    ctx.beginPath(); ctx.arc(W / 2, wmY, wmR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, wmY, wmR * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 - wmR, wmY); ctx.lineTo(W / 2 + wmR, wmY); ctx.stroke();
    ctx.restore();
  }

  // ── شريط هوية البطولة العلوي ──────────────────────────────────────
  async function drawTopIdentityBar(ctx, W, topY, lgImg, accent) {
    var name = getLeagueName();
    var rgb = hexToRgb(accent || GOLD);
    var BH = 72;

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, topY, W, BH);

    ctx.strokeStyle = 'rgba(' + rgb + ',0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, topY + BH + 0.5); ctx.lineTo(W - 80, topY + BH + 0.5); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + hexToRgb(STEEL) + ',0.4)';
    ctx.beginPath(); ctx.moveTo(120, topY + BH + 2.5); ctx.lineTo(W - 120, topY + BH + 2.5); ctx.stroke();

    var cy = topY + BH / 2;
    var logoSz = 48;

    if (lgImg) {
      ctx.font = 'bold 28px Tajawal,Arial';
      var tw = ctx.measureText(name).width;
      var gap = 14;
      var total = logoSz + gap + tw;
      var startX = (W - total) / 2;

      ctx.fillStyle = 'rgba(' + rgb + ',0.15)';
      ctx.beginPath(); ctx.arc(startX + logoSz / 2, cy, logoSz / 2 + 7, 0, Math.PI * 2); ctx.fill();

      ctx.save(); ctx.beginPath();
      ctx.arc(startX + logoSz / 2, cy, logoSz / 2, 0, Math.PI * 2); ctx.clip();
      _drawImgCover(ctx, lgImg, startX, cy - logoSz / 2, logoSz); ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(startX + logoSz / 2, cy, logoSz / 2 + 1.5, 0, Math.PI * 2); ctx.stroke();

      ctx.font = 'bold 28px Tajawal,Arial';
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      ctx.fillText(name, startX + logoSz + gap, cy + 10);
      ctx.textAlign = 'center';
    } else {
      drawIcon(ctx, 'trophy', W / 2 - 100, cy + 2, 34, accent || GOLD);
      ctx.font = 'bold 28px Tajawal,Arial'; ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(name, W / 2 + 20, cy + 11);
      ctx.textAlign = 'center';
    }
    return BH;
  }

  // ── شريط شارة (مرحلة / حالة) ──────────────────────────────────────
  function drawBadgeBar(ctx, W, y, label, color, withDot) {
    if (!label) return 0;
    var rgb = hexToRgb(color);
    var BH = 48;

    ctx.font = '700 20px Tajawal,Arial';
    var tw = ctx.measureText(label).width + (withDot ? 76 : 56);
    var bx = W / 2 - tw / 2;

    ctx.fillStyle = 'rgba(' + rgb + ',0.10)';
    ctx.strokeStyle = 'rgba(' + rgb + ',0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx, y + 2, tw, BH - 6, 20); ctx.fill(); ctx.stroke();

    var dotX = withDot ? bx + 26 : bx + 18;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(dotX, y + BH / 2 - 1, withDot ? 6 : 4, 0, Math.PI * 2); ctx.fill();
    if (withDot) {
      ctx.beginPath(); ctx.arc(dotX, y + BH / 2 - 1, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(' + rgb + ',0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    drawText(ctx, label, W / 2 + (withDot ? 10 : 8), y + BH / 2 + 6, '700 20px Tajawal,Arial', color, 'center');
    return BH;
  }

  // ── شريط سفلي موحّد ──────────────────────────────────────────────
  function drawBottomBar(ctx, W, H, url) {
    var BH = url ? 104 : 66;
    var by = H - BH;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, by + 0.5); ctx.lineTo(W - 80, by + 0.5); ctx.stroke();

    ctx.textAlign = 'center';
    var y0 = by + (url ? 24 : 30);
    if (url) {
      ctx.font = '700 19px Tajawal,Arial'; ctx.fillStyle = GOLD;
      ctx.fillText('تابع البطولة لحظة بلحظة', W / 2, y0);
      y0 += 24;
      ctx.font = '600 17px Tajawal,Arial'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(fitName(ctx, url, W - 160), W / 2, y0);
      y0 += 22;
    }
    ctx.font = '700 15px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(CREDIT_1, W / 2, y0);
    ctx.font = '400 12px Tajawal,Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fillText(CREDIT_2, W / 2, y0 + 18);
  }

  // ── خانات تفاصيل (تاريخ/وقت/ملعب/حكم/معلق) ────────────────────────
  function drawDetailCells(ctx, W, items, startY, accent) {
    if (!items.length) return 0;
    var rgb = hexToRgb(accent);
    var SIDE = 38, GAP = 12, H_CELL = 80;
    var totalW = W - SIDE * 2;
    var cols = items.length;
    var cw = (totalW - GAP * (cols - 1)) / cols;

    items.forEach(function (d, i) {
      var cx = SIDE + i * (cw + GAP);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      roundRect(ctx, cx, startY, cw, H_CELL, 14); ctx.fill(); ctx.stroke();

      ctx.strokeStyle = 'rgba(' + rgb + ',0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + 18, startY + 1); ctx.lineTo(cx + cw - 18, startY + 1); ctx.stroke();

      drawText(ctx, d.label, cx + cw / 2, startY + 22, '600 14px Tajawal,Arial', '#666', 'center');

      var val = String(d.val);
      ctx.font = '700 19px Tajawal,Arial';
      var iconGap = 22;
      var vtw = ctx.measureText(val).width + iconGap;
      var fs = vtw > cw - 24 ? Math.max(13, 19 * (cw - 24) / vtw) : 19;
      drawIconText(ctx, d.icon, fitName(ctx, val, cw + 40), cx + cw / 2, startY + 56, '700 ' + fs + 'px Tajawal,Arial', '#eeeeee', 'center', '#888', 8);
    });
    return H_CELL;
  }

  // ── قسم الفرق (الشعارات + النتيجة/VS + الأسماء) ───────────────────
  function drawTeamsSection(ctx, W, topY, hImg, aImg, htName, atName, centerText, accent, logoSize) {
    var rgb = hexToRgb(accent);
    var LS = logoSize || 210;
    var HCX = W / 2 - 272, ACX = W / 2 + 272;
    var LCY = topY + LS / 2;
    var isScore = typeof centerText === 'string' && centerText.indexOf('–') > -1;

    drawLogoFramed(ctx, hImg, HCX, LCY, LS, accent, false);
    drawLogoFramed(ctx, aImg, ACX, LCY, LS, accent, false);

    ctx.save();
    ctx.direction = 'ltr';
    if (isScore) {
      var parts = centerText.split('–').map(function (s) { return s.trim(); });
      var gap = 70, discR = 52;
      var cxL = W / 2 - gap, cxR = W / 2 + gap, cyc = LCY - 4;
      [[cxL, parts[0]], [cxR, parts[1]]].forEach(function (p) {
        var cx = p[0], num = p[1];
        ctx.beginPath(); ctx.arc(cx, cyc, discR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ',0.28)'; ctx.lineWidth = 1.5; ctx.stroke();
        drawText(ctx, num, cx, cyc + 32, 'bold 90px Tajawal,Arial', '#ffffff', 'center');
      });
      drawText(ctx, '–', W / 2, cyc + 26, 'bold 60px Tajawal,Arial', 'rgba(' + rgb + ',0.9)', 'center');
    } else {
      drawText(ctx, centerText, W / 2, LCY + 20, 'bold 58px Tajawal,Arial', accent, 'center');
    }
    ctx.restore();

    var NY = topY + LS + 40;
    function drawName(name, cx) {
      ctx.font = 'bold 27px Tajawal,Arial';
      var tw = ctx.measureText(name).width;
      var bw = tw + 44, bh = 44;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      roundRect(ctx, cx - bw / 2, NY - 28, bw, bh, 12); ctx.fill(); ctx.stroke();
      drawText(ctx, name, cx, NY + 1, 'bold 27px Tajawal,Arial', '#dddddd', 'center');
    }
    drawName(fitName(ctx, htName, 280), HCX);
    drawName(fitName(ctx, atName, 280), ACX);

    return NY + 26;
  }

  // ── أعمدة الهدّافين (اسم + كرات لعدد الأهداف) ─────────────────────
  function drawScorerCols(ctx, W, hSc, aSc, htName, atName, startY, accent) {
    drawIconText(ctx, 'ball', 'الهدّافون', W / 2, startY, '700 16px Tajawal,Arial', accent, 'center');
    var y = startY + 34;

    var colHomeX = W * 0.27, colAwayX = W * 0.73;
    var headY = y;
    drawText(ctx, fitName(ctx, htName, 360), colHomeX, headY, '800 19px Tajawal,Arial', '#ccc', 'center');
    drawText(ctx, fitName(ctx, atName, 360), colAwayX, headY, '800 19px Tajawal,Arial', '#ccc', 'center');
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    [colHomeX, colAwayX].forEach(function (cx0) {
      ctx.beginPath(); ctx.moveTo(cx0 - 130, headY + 14); ctx.lineTo(cx0 + 130, headY + 14); ctx.stroke();
    });

    var listY = headY + 44, lh = 34;
    function drawCol(list, cx0) {
      var yy = listY;
      if (!list.length) { drawText(ctx, '—', cx0, yy, '400 17px Tajawal,Arial', '#666', 'center'); return yy + lh; }
      var grouped = [];
      list.forEach(function (s) {
        var mt = s.match(/^(.*?)[\s\u00A0]*(\d+\+?\d*)'?\s*$/);
        var nm = (mt ? mt[1] : s).trim();
        if (!nm) return;
        var found = grouped.find(function (g) { return g.name === nm; });
        if (found) found.count++; else grouped.push({ name: nm, count: 1 });
      });
      grouped.slice(0, 8).forEach(function (g) {
        var ballCount = Math.min(g.count, 6);
        ctx.font = '700 19px Tajawal,Arial'; ctx.fillStyle = '#eee';
        var nmFit = fitName(ctx, g.name, 200);
        var nmW = ctx.measureText(nmFit).width;
        if (ballCount) {
          var BALL = 15, BALL_GAP = 3;
          var ballsW = ballCount * BALL + (ballCount - 1) * BALL_GAP;
          var total = nmW + 8 + ballsW;
          var startX = cx0 + total / 2;
          ctx.textAlign = 'right'; ctx.font = '700 19px Tajawal,Arial'; ctx.fillStyle = '#eee';
          ctx.fillText(nmFit, startX, yy);
          var ballCy = yy - 7;
          var bx = startX - nmW - 8 - BALL / 2;
          for (var k = 0; k < ballCount; k++) { drawIcon(ctx, 'ball', bx, ballCy, BALL, GOLD2); bx -= (BALL + BALL_GAP); }
        } else {
          ctx.textAlign = 'center';
          ctx.fillText(nmFit, cx0, yy);
        }
        yy += lh;
      });
      return yy;
    }
    var endH = drawCol(hSc, colHomeX);
    var endA = drawCol(aSc, colAwayX);
    ctx.textAlign = 'center';
    return Math.max(endH, endA);
  }

  // ═══════════════════════ بطاقة قادمة ═══════════════════════════
  async function genUpcomingCanvas(m) {
    var ht = team(m, 'home'), at = team(m, 'away');
    var W = 1080, H = 1080;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';

    var imgs = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    var hImg = imgs[0], aImg = imgs[1], lgImg = imgs[2];

    drawBackground(ctx, W, H, GOLD);
    var ID_TOP = 16;
    var idH = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg, GOLD);
    var curY = ID_TOP + idH + 16;

    var stage = stageOf(m);
    var stH = drawBadgeBar(ctx, W, curY, 'مباراة قادمة' + (stage ? '  ·  ' + stage : ''), GOLD, false);
    curY += stH + 22;

    var afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, 'VS', GOLD, 210);
    curY = afterTeams + 10;
    drawDivider(ctx, W, curY); curY += 26;

    var lines = [];
    if (m.date) lines.push(dateLabel(m.date));
    if (m.time) lines.push(fmt12(m.time));
    if (lines.length) { drawText(ctx, lines.join('   —   '), W / 2, curY, '800 30px Tajawal,Arial', GOLD, 'center'); curY += 44; }

    var cells = [
      { icon: 'stadium', label: 'الملعب', val: m.venue || '' },
      { icon: 'whistle', label: 'الحكم', val: m.referee || '' },
      { icon: 'mic', label: 'المعلق', val: m.commentator || '' }
    ].filter(function (d) { return d.val; });
    var row1 = cells.slice(0, 2), row2 = cells.slice(2, 4);
    curY += 8;
    if (row1.length) { drawDetailCells(ctx, W, row1, curY, GOLD); curY += 92; }
    if (row2.length) { drawDetailCells(ctx, W, row2, curY, GOLD); curY += 92; }

    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '') + '&match=' + encodeURIComponent(m.id || '');
    drawBottomBar(ctx, W, H, url);
    return canvas;
  }

  // ═══════════════════════ بطاقة مباشرة ═══════════════════════════
  async function genLiveCanvas(m) {
    var ht = team(m, 'home'), at = team(m, 'away');
    var d = m.liveData || {};
    var W = 1080, H = 1080;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';

    var imgs = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    var hImg = imgs[0], aImg = imgs[1], lgImg = imgs[2];

    drawBackground(ctx, W, H, LIVE);
    var ID_TOP = 16;
    var idH = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg, LIVE);
    var curY = ID_TOP + idH + 16;

    var badgeH = drawBadgeBar(ctx, W, curY, 'مباشر الآن', LIVE, true);
    curY += badgeH + 6;
    var stage = stageOf(m);
    if (stage) { drawText(ctx, stage, W / 2, curY + 16, '600 17px Tajawal,Arial', '#777', 'center'); curY += 34; }
    curY += 14;

    var hs = d.homeScore ?? 0, as_ = d.awayScore ?? 0;
    var afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, hs + ' – ' + as_, LIVE, 192);
    curY = afterTeams;

    var per = periodLabel(d), clk = liveClock(d);
    var timeBit = [per, clk ? ('الدقيقة ' + clk) : ''].filter(Boolean).join('  ·  ');
    if (timeBit) { drawText(ctx, timeBit, W / 2, curY + 8, '700 22px Tajawal,Arial', LIVE, 'center'); curY += 34; }

    curY += 10;
    drawDivider(ctx, W, curY); curY += 24;

    var sc = liveScorerStrings(m);
    if (sc.home.length || sc.away.length) {
      var endY = drawScorerCols(ctx, W, sc.home, sc.away, ht.name, at.name, curY, LIVE);
      curY = endY + 10;
    }

    if (m.videoUrl || d.videoUrl) {
      drawIconText(ctx, 'live', 'البث المباشر متاح الآن', W / 2, curY + 12, '700 20px Tajawal,Arial', LIVE, 'center');
    }

    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '') + '&match=' + encodeURIComponent(m.id || '');
    drawBottomBar(ctx, W, H, url);
    return canvas;
  }

  // ═══════════════════════ بطاقة منتهية ═══════════════════════════
  async function genFinishedCanvas(m) {
    var ht = team(m, 'home'), at = team(m, 'away');
    var W = 1080, H = 1200;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';

    var imgs = await Promise.all([loadImg(ht.logo), loadImg(at.logo), loadLeagueLogo()]);
    var hImg = imgs[0], aImg = imgs[1], lgImg = imgs[2];

    var hs = m.homeScore ?? 0, as_ = m.awayScore ?? 0;
    var hw = hs > as_, aw = as_ > hs, isDraw = hs === as_;
    var hasPens = m.penaltyScoreHome != null && isDraw;

    drawBackground(ctx, W, H, GREEN);
    var ID_TOP = 16;
    var idH = await drawTopIdentityBar(ctx, W, ID_TOP, lgImg, GREEN);
    var curY = ID_TOP + idH + 14;

    var stage = stageOf(m);
    var endLabel = stage ? ('نهاية المباراة  ·  ' + stage) : 'نهاية المباراة';
    drawText(ctx, endLabel, W / 2, curY + 16, '700 18px Tajawal,Arial', '#888', 'center');
    curY += 40;

    var afterTeams = drawTeamsSection(ctx, W, curY, hImg, aImg, ht.name, at.name, hs + ' – ' + as_, GREEN, 192);
    curY = afterTeams;

    if (hasPens) {
      drawText(ctx, '(ركلات الترجيح: ' + m.penaltyScoreHome + ' – ' + m.penaltyScoreAway + ')', W / 2, curY + 2, '700 17px Tajawal,Arial', '#9b59b6', 'center');
      curY += 30;
    }

    curY += 8;
    if (!isDraw || hasPens) {
      var winnerName = hw ? ht.name : hasPens ? (m.penaltyScoreHome > m.penaltyScoreAway ? ht.name : at.name) : at.name;
      var isKO = !!(m.isKnockout || m.knockoutRoundId != null || m.knockoutRoundName);
      var verb = isKO ? 'يتأهل' : 'الفائز';
      var label = isKO ? (winnerName + '  ' + verb) : (verb + ':  ' + winnerName);
      ctx.font = 'bold 24px Tajawal,Arial'; ctx.textAlign = 'center';
      var tw = ctx.measureText(label).width + 78;
      var rgbG = hexToRgb(GOLD);
      ctx.fillStyle = 'rgba(' + rgbG + ',0.1)';
      ctx.strokeStyle = 'rgba(' + rgbG + ',0.3)'; ctx.lineWidth = 1;
      roundRect(ctx, W / 2 - tw / 2, curY, tw, 38, 19); ctx.fill(); ctx.stroke();
      drawIconText(ctx, 'trophy', label, W / 2, curY + 25, 'bold 22px Tajawal,Arial', GOLD, 'center');
      curY += 54;
    } else {
      drawText(ctx, 'تعادل', W / 2, curY + 20, 'bold 22px Tajawal,Arial', '#888', 'center');
      curY += 48;
    }

    drawDivider(ctx, W, curY); curY += 24;

    var hSc = (m.homeScorers || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var aSc = (m.awayScorers || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (hSc.length || aSc.length) {
      var endY = drawScorerCols(ctx, W, hSc, aSc, ht.name, at.name, curY, GREEN);
      curY = endY + 8;
    }

    var mom = m.manOfMatch;
    if (mom) {
      curY += 6;
      drawDivider(ctx, W, curY); curY += 30;
      drawIconText(ctx, 'star', 'رجل المباراة:  ' + mom, W / 2, curY, 'bold 21px Tajawal,Arial', GOLD, 'center', GOLD2, 8);
      curY += 38;
    }

    var cells = [
      { icon: 'stadium', label: 'الملعب', val: m.venue || '' },
      { icon: 'whistle', label: 'الحكم', val: m.referee || '' },
      { icon: 'mic', label: 'المعلق', val: m.commentator || '' }
    ].filter(function (d) { return d.val; });
    if (cells.length) {
      curY += 14;
      drawDetailCells(ctx, W, cells.slice(0, 3), curY, GREEN);
      curY += 92;
    }

    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '') + '&match=' + encodeURIComponent(m.id || '');
    drawBottomBar(ctx, W, H, url);
    return canvas;
  }

  async function draw(m) {
    try { await document.fonts.load('900 44px Tajawal'); } catch (e) {}
    try { await document.fonts.load('700 30px Tajawal'); } catch (e) {}
    try { await document.fonts.load('400 26px Tajawal'); } catch (e) {}
    if (m.status === 'live') return genLiveCanvas(m);
    if (m.status === 'finished') return genFinishedCanvas(m);
    return genUpcomingCanvas(m);
  }

  // ── نص المشاركة (بلا تغيير في المضمون) ────────────────────────────
  function buildShareText(m) {
    var league = window.league || {};
    var ht = team(m, 'home'), at = team(m, 'away');
    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '') + '&match=' + encodeURIComponent(m.id || '');
    var L = [];
    var head = league.name || 'البطولة';
    var stage = stageOf(m);
    if (stage) head += ' — ' + stage;

    function scoreLine(hsv, asv) { return ht.name + '  ' + hsv + ' - ' + asv + '  ' + at.name; }

    if (m.status === 'live') {
      var d = m.liveData || {};
      var hs = d.homeScore ?? 0, as = d.awayScore ?? 0;
      var per = periodLabel(d), clk = liveClock(d);
      var timeBit = [per, clk ? ('الدقيقة ' + clk) : ''].filter(Boolean).join(' · ');
      L.push('🔴 مباشر الآن'); L.push(head); L.push('⚽ ' + scoreLine(hs, as));
      if (timeBit) L.push('⏱️ ' + timeBit);
      var sc = liveScorerStrings(m);
      var allSc = [].concat(sc.home, sc.away);
      if (allSc.length) L.push('🥅 ' + allSc.join('، '));
      L.push(''); L.push('▶️ تابع البث والتفاصيل لحظة بلحظة:'); L.push(url);
    } else if (m.status === 'finished') {
      var hs2 = m.homeScore ?? 0, as2 = m.awayScore ?? 0;
      L.push('✅ انتهت المباراة'); L.push(head); L.push('⚽ ' + scoreLine(hs2, as2));
      if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) L.push('🥅 ركلات الترجيح: ' + m.penaltyScoreHome + ' - ' + m.penaltyScoreAway);
      if (m.manOfMatch) L.push('🌟 رجل المباراة: ' + m.manOfMatch);
      L.push(''); L.push('📊 كل التفاصيل والهدّافين:'); L.push(url);
    } else {
      var when = [];
      if (m.date) when.push(dateLabel(m.date));
      if (m.time) when.push(fmt12(m.time));
      L.push('📅 مباراة قادمة'); L.push(head); L.push('⚔️ ' + ht.name + '  ضد  ' + at.name);
      if (when.length) L.push('🕐 ' + when.join(' — '));
      if (m.venue) L.push('🏟️ ' + m.venue);
      L.push(''); L.push('🔔 لا تفوّت المباراة — تابعها هنا:'); L.push(url);
    }
    L.push(''); L.push('━━━━━━━━━━━━━━'); L.push('🏆 ' + CREDIT_1 + ' — ' + CREDIT_2);
    return L.join('\n');
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('toBlob failed')); }, 'image/png', 0.95); }
      catch (e) { reject(e); }
    });
  }

  function showPreview(blob, matchTitle, shareText) {
    var url = URL.createObjectURL(blob);
    var el = document.createElement('div');
    el.id = '_cardPreviewModal';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(6,7,8,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:14px;overflow-y:auto';
    el.innerHTML =
      '<img src="' + url + '" style="max-width:100%;max-height:56vh;border-radius:14px;border:1px solid #2A2F35"/>' +
      '<div style="width:100%;max-width:360px;background:#171A1D;border:1px solid #2A2F35;border-radius:10px;padding:11px 13px;' +
        'font-family:Tajawal,sans-serif;font-size:12px;color:#9BA3AD;white-space:pre-wrap;line-height:1.7;max-height:110px;overflow-y:auto">' +
        (shareText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</div>' +
      '<div style="display:flex;gap:10px;width:100%;max-width:360px">' +
        '<a href="' + url + '" download="' + (matchTitle || 'match-card') + '.png" ' +
          'style="flex:1;text-align:center;padding:13px;border-radius:10px;background:#C9A02B;color:#12131a;' +
          'font-family:Tajawal,sans-serif;font-size:14px;font-weight:800;text-decoration:none">تنزيل الصورة</a>' +
        '<button id="_copyCardTextBtn" ' +
          'style="flex:1;padding:13px;border-radius:10px;background:transparent;border:1px solid #363C43;color:#EDEFF2;' +
          'font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;cursor:pointer">نسخ النص</button>' +
      '</div>' +
      '<button onclick="document.getElementById(\'_cardPreviewModal\').remove()" ' +
        'style="width:100%;max-width:360px;padding:12px;border-radius:10px;background:transparent;border:1px solid #2A2F35;color:#666E78;' +
        'font-family:Tajawal,sans-serif;font-size:13px;font-weight:700;cursor:pointer">إغلاق</button>';
    document.body.appendChild(el);
    var copyBtn = el.querySelector('#_copyCardTextBtn');
    if (copyBtn) {
      copyBtn.onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(shareText || '') : Promise.reject())
          .then(function () { copyBtn.textContent = 'تم النسخ'; setTimeout(function () { copyBtn.textContent = 'نسخ النص'; }, 1800); })
          .catch(function () { if (window.showToast) window.showToast('تعذّر نسخ النص', 'error'); });
      };
    }
  }

  window.shareMatchCard = async function (matchId) {
    var M = window.matches || [];
    var m = M.find(function (x) { return x.id === matchId; });
    if (!m) return;

    if (window.showToast) window.showToast('جاري إنشاء البطاقة...', 'success');

    try {
      var canvas = await draw(m);
      var blob = await canvasToBlob(canvas);
      var file = new File([blob], 'match-card.png', { type: 'image/png' });
      var title = (window.league && window.league.name) || 'بطاقة المباراة';
      var shareText = buildShareText(m);

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: title, text: shareText }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      showPreview(blob, title, shareText);
    } catch (e) {
      console.error('[match-share-card]', e);
      if (window.showToast) window.showToast('تعذّر إنشاء البطاقة، حاول مجدداً', 'error');
    }
  };

  // console.log('[match-share-card] جاهز — تصميم موحّد مع الإدارة');
})();
