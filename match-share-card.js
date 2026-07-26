/* ═══════════════════════════════════════════════════════════════════
 *  match-share-card.js — بطاقة مشاركة المباراة (تصميم احترافي)
 *  ───────────────────────────────────────────────────────────────────
 *  يستبدل زرَّي "مشاركة النتيجة / نسخ" القديمين بزر واحد يُنشئ صورة
 *  بطاقة أنيقة عبر Canvas — بدون أي تأثيرات أو ظلال (تصميم مسطّح)،
 *  وتختلف محتوياتها حسب حالة المباراة:
 *    • قادمة   → الفريقان، الموعد، الملعب، الجولة
 *    • مباشرة  → النتيجة الحية، الشوط/الوقت، الهدافون، معلومات البث
 *    • منتهية  → النتيجة النهائية، الهدافون، الحكم/المعلق/رجل المباراة
 *
 *  يُحمَّل بعد viewer.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── هوية بصرية موحّدة مع بقية التطبيق (بلا تدرّجات ولا ظلال) ──
  var BG     = '#0F1113';
  var S1     = '#171A1D';
  var S2     = '#1E2226';
  var LINE   = '#2A2F35';
  var T1     = '#EDEFF2';
  var T2     = '#9BA3AD';
  var T3     = '#666E78';
  var GOLD   = '#C9A02B';
  var GOLD2  = '#F0C84A';
  var STEEL  = '#3A4A5E';
  var LIVE   = '#D64541';
  var GREEN  = '#2E9E5B';
  var BLUE   = '#3B7DBF';

  // حقوق المنصة والمبرمج — نفس النص المستخدم في مشاركة البطولة العامة
  var CREDIT = 'منصة بطولات — تطوير وبرمجة عبدالله السكني';

  var W = 1080, H = 1350;

  function siteUrl() {
    return location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  }

  function team(m, side) {
    var T = window.teams || [];
    var id = side === 'home' ? m.homeId : m.awayId;
    var t = T.find(function (x) { return x.id === id; });
    return {
      name: (t && t.name) || (side === 'home' ? m.homeName : m.awayName) || 'فريق',
      logo: (t && t.logo) || (side === 'home' ? m.homeLogo : m.awayLogo) || ''
    };
  }

  function scorers(m) {
    var d = m.liveData || {};
    var evs = (d.events || []).filter(function (e) { return e && e.type === 'goal'; });
    var home = [], away = [];
    evs.forEach(function (e) {
      var who = (e.player || e.playerName || '').trim();
      if (!who) return;
      var mn = e.extraMinute > 0 ? (e.minute + '+' + e.extraMinute) : e.minute;
      var row = { name: who, min: mn };
      (e.team === 'away' || e.side === 'away' ? away : home).push(row);
    });
    return { home: home, away: away };
  }

  // ── تحميل الصور بأمان: نتجنّب الصور الخارجية التي قد "تلوّث" الكانفاس ──
  function isSafeImage(src) {
    if (!src) return false;
    return src.indexOf('data:') === 0 || src.indexOf(location.origin) === 0 || src.indexOf('/') === 0;
  }
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!isSafeImage(src)) { resolve(null); return; }
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 3500);
      img.onload = function () { if (done) return; done = true; clearTimeout(timer); resolve(img); };
      img.onerror = function () { if (done) return; done = true; clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  // ── أدوات رسم مسطّحة (بدون ظل/تدرّج) ──
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawDot(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawLogoCircle(ctx, img, name, cx, cy, r, ring) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = S2;
    ctx.fill();
    if (ring) { ctx.lineWidth = 3; ctx.strokeStyle = ring; ctx.stroke(); }
    ctx.clip();
    if (img) {
      // object-fit: cover ضمن الدائرة
      var s = Math.max((r * 2) / img.width, (r * 2) / img.height);
      var iw = img.width * s, ih = img.height * s;
      ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
    } else {
      ctx.fillStyle = T1;
      ctx.font = '800 ' + Math.round(r * 0.85) + 'px Tajawal, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((name || '؟').trim().charAt(0), cx, cy + r * 0.05);
    }
    ctx.restore();
  }

  // يقصّ نصاً طويلاً على سطر واحد بحد أقصى للعرض
  function fitText(ctx, text, maxWidth) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) {
      text = text.slice(0, -1);
    }
    return text + '…';
  }

  function statusMeta(m) {
    if (m.status === 'live') return { label: 'مباشرة الآن', color: LIVE };
    if (m.status === 'finished') return { label: 'انتهت المباراة', color: GREEN };
    return { label: 'مباراة قادمة', color: BLUE };
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

  async function draw(m) {
    var league = window.league || {};
    var ht = team(m, 'home'), at = team(m, 'away');
    var d = m.liveData || {};
    var meta = statusMeta(m);
    var isLive = m.status === 'live';
    var isFin  = m.status === 'finished';

    try { await document.fonts.load('900 44px Tajawal'); } catch (e) {}
    try { await document.fonts.load('700 30px Tajawal'); } catch (e) {}
    try { await document.fonts.load('400 26px Tajawal'); } catch (e) {}

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';

    // خلفية مسطّحة مع لمسة عمق علوية هادئة (فولاذي)
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    var vg = ctx.createRadialGradient(W/2, -H*0.12, 0, W/2, -H*0.12, W*0.95);
    vg.addColorStop(0, 'rgba(58,74,94,0.16)');
    vg.addColorStop(0.6, 'rgba(58,74,94,0.04)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // ── خلفية ملعب شفّافة أنيقة (مرسومة بالكانفس، بلا صور خارجية) ──
    (function drawPitch(){
      ctx.save();
      ctx.globalAlpha = 1;
      // مسحة خضراء خفيفة جداً في وسط البطاقة (شعور العشب)
      var pg = ctx.createLinearGradient(0, H*0.18, 0, H*0.92);
      pg.addColorStop(0,   'rgba(30,70,45,0.10)');
      pg.addColorStop(0.5, 'rgba(24,58,38,0.06)');
      pg.addColorStop(1,   'rgba(18,44,30,0.10)');
      ctx.fillStyle = pg;
      ctx.fillRect(40, H*0.16, W-80, H*0.76);

      // أشرطة العشب (خطوط أفقية متناوبة خفيفة)
      ctx.fillStyle = 'rgba(255,255,255,0.012)';
      var bandH = 84, top = H*0.16, bot = H*0.92;
      for (var by = top; by < bot; by += bandH*2) {
        ctx.fillRect(40, by, W-80, bandH);
      }

      // خطوط الملعب البيضاء الشفّافة
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 2;
      var mx = 60, mw = W - 120;                 // حدود الملعب الأفقية
      var pTop = H*0.20, pBot = H*0.88, pMidY = (pTop+pBot)/2;
      // الإطار الخارجي
      roundRect(ctx, mx, pTop, mw, pBot-pTop, 10); ctx.stroke();
      // خط المنتصف
      ctx.beginPath(); ctx.moveTo(mx, pMidY); ctx.lineTo(mx+mw, pMidY); ctx.stroke();
      // دائرة المنتصف
      ctx.beginPath(); ctx.arc(W/2, pMidY, 90, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W/2, pMidY, 4, 0, Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fill();
      // منطقتا الجزاء (أعلى وأسفل)
      var boxW = mw*0.44, boxH = 90, boxX = W/2 - boxW/2;
      ctx.strokeRect(boxX, pTop, boxW, boxH);
      ctx.strokeRect(boxX, pBot-boxH, boxW, boxH);
      ctx.restore();
    })();

    // شريط علوي مزدوج: لون الحالة العريض فوق خيط فولاذي
    ctx.fillStyle = meta.color;
    ctx.fillRect(0, 0, W, 6);
    ctx.fillStyle = 'rgba(58,74,94,0.55)';
    ctx.fillRect(0, 6, W, 2);

    // إطار خارجي رفيع (طبقتان) — هيبة هادئة
    (function(){
      var pad = 26;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(201,160,43,0.20)';
      roundRect(ctx, pad, pad, W - pad*2, H - pad*2, 28); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, pad+7, pad+7, W - (pad+7)*2, H - (pad+7)*2, 24); ctx.stroke();
    })();

    var cx = W / 2;
    var y = 78;

    // ── ترويسة البطولة: شعار داخل قرص + اسم + عنوان فرعي (مرتّبة ومتمركزة) ──
    var leagueLogoImg = league.logo ? await loadImage(league.logo) : null;
    if (leagueLogoImg) {
      // قرص خلفي + حلقة ذهبية رفيعة
      ctx.beginPath(); ctx.arc(cx, y + 52, 60, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(201,160,43,0.45)'; ctx.stroke();
      drawLogoCircle(ctx, leagueLogoImg, league.name, cx, y + 52, 48, null);
      y += 132;
    } else {
      // بلا شعار: أيقونة كأس أنيقة
      ctx.font = '54px Arial'; ctx.textAlign = 'center';
      ctx.fillText('🏆', cx, y + 52); y += 96;
    }
    ctx.fillStyle = T1;
    ctx.font = '900 42px Tajawal, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, league.name || 'بطولة', W - 200), cx, y);
    y += 18;
    // خط ذهبي رفيع قصير تحت الاسم (فاصل أنيق)
    ctx.strokeStyle = 'rgba(201,160,43,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 60, y); ctx.lineTo(cx + 60, y); ctx.stroke();
    y += 30;

    var typeMap = { league: 'دوري نقاط', groups: 'مجموعات', knockout: 'كأس إقصائي' };
    var sub = [];
    if (league.season) sub.push(String(league.season));
    if (league.type) sub.push(typeMap[league.type] || 'دوري نقاط');
    if (m.round && !m.isKnockout) sub.push('الجولة ' + m.round);
    if (m.isKnockout && m.knockoutRoundName) sub.push(m.knockoutRoundName);
    if (sub.length) {
      ctx.fillStyle = T2;
      ctx.font = '700 24px Tajawal, Arial, sans-serif';
      ctx.fillText(sub.join('   ·   '), cx, y);
    }
    y += 46;

    // ── شارة الحالة ──
    ctx.font = '800 24px Tajawal, Arial, sans-serif';
    var badgeText = meta.label;
    var badgeW = ctx.measureText(badgeText).width + 70;
    var badgeH = 52;
    roundRect(ctx, cx - badgeW / 2, y, badgeW, badgeH, badgeH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = meta.color; ctx.stroke();
    if (isLive) drawDot(ctx, cx - badgeW / 2 + 30, y + badgeH / 2, 7, LIVE);
    ctx.fillStyle = isLive ? LIVE : (isFin ? GREEN : BLUE);
    ctx.fillText(badgeText, cx + (isLive ? 12 : 0), y + badgeH / 2 + 8);
    y += badgeH + 56;

    // ── صف الفريقين ──
    var teamsY = y + 90;
    var logoR = 90;
    var leftX = W * 0.24, rightX = W * 0.76;
    var homeImg = await loadImage(ht.logo);
    var awayImg = await loadImage(at.logo);
    drawLogoCircle(ctx, homeImg, ht.name, leftX, teamsY, logoR, LINE);
    drawLogoCircle(ctx, awayImg, at.name, rightX, teamsY, logoR, LINE);

    ctx.font = '800 30px Tajawal, Arial, sans-serif';
    ctx.fillStyle = T1;
    ctx.fillText(fitText(ctx, ht.name, 300), leftX, teamsY + logoR + 48);
    ctx.fillText(fitText(ctx, at.name, 300), rightX, teamsY + logoR + 48);

    // ── منتصف: النتيجة أو VS ──
    ctx.textAlign = 'center';
    if (isLive || isFin) {
      var hs = isLive ? (d.homeScore ?? 0) : (m.homeScore ?? 0);
      var as = isLive ? (d.awayScore ?? 0) : (m.awayScore ?? 0);
      /* ✅ إصلاح انعكاس النتيجة: ctx.direction='rtl' يعكس ترتيب النص
         فتظهر "2 : 1" كأنها "1 : 2". نرسم كل رقم في موضعه المستقل
         بعد تحييد الاتجاه، فيبقى المضيف يميناً والضيف يساراً. */
      ctx.save();
      ctx.direction = 'ltr';
      // قرصان خفيفان خلف الرقمين (لمسة فخامة بلا ظل)
      [cx - 78, cx + 78].forEach(function(dx){
        ctx.beginPath(); ctx.arc(dx, teamsY + (-8), 56, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(201,160,43,0.28)'; ctx.stroke();
      });
      ctx.font = '900 92px Tajawal, Arial, sans-serif';
      ctx.fillStyle = T1;
      ctx.textAlign = 'center';
      ctx.fillText(String(hs), cx - 78, teamsY + 22);
      ctx.fillText(String(as), cx + 78, teamsY + 22);
      ctx.font = '900 62px Tajawal, Arial, sans-serif';
      ctx.fillStyle = GOLD;
      ctx.fillText(':', cx, teamsY + 14);
      ctx.restore();

      if (isLive) {
        ctx.font = '700 26px Tajawal, Arial, sans-serif';
        ctx.fillStyle = LIVE;
        var pl = periodLabel(d);
        var clk = liveClock(d);
        ctx.fillText([pl, clk].filter(Boolean).join('  ·  '), cx, teamsY + 70);
      } else if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) {
        ctx.font = '700 26px Tajawal, Arial, sans-serif';
        ctx.fillStyle = T2;
        /* نفس إصلاح الانعكاس: النص العربي rtl والأرقام ltr */
        ctx.fillText('ركلات الترجيح', cx, teamsY + 70);
        ctx.save();
        ctx.direction = 'ltr';
        ctx.fillText(m.penaltyScoreHome + ' : ' + m.penaltyScoreAway, cx, teamsY + 104);
        ctx.restore();
      }
    } else {
      ctx.font = '900 40px Tajawal, Arial, sans-serif';
      ctx.fillStyle = T3;
      ctx.fillText('VS', cx, teamsY + 14);
    }
    y = teamsY + logoR + 100;

    // ── معلومات إضافية حسب الحالة ──
    ctx.font = '600 26px Tajawal, Arial, sans-serif';
    if (!isLive && !isFin) {
      var lines = [];
      if (m.date) lines.push((window.DateGroups && window.DateGroups.label) ? window.DateGroups.label(m.date) : m.date);
      if (m.time) lines.push((window.formatTimeTo12H ? window.formatTimeTo12H(m.time) : m.time));
      if (lines.length) {
        ctx.fillStyle = GOLD;
        ctx.font = '800 34px Tajawal, Arial, sans-serif';
        ctx.fillText(lines.join('  —  '), cx, y);
        y += 46;
      }
      if (m.venue) {
        ctx.fillStyle = T2;
        ctx.font = '600 26px Tajawal, Arial, sans-serif';
        ctx.fillText(fitText(ctx, m.venue, W - 160), cx, y);
        y += 40;
      }
      y += 10;

      // ── الحكم والمعلق — تظهر فقط لو مسجّلة من لوحة التحكم ──
      var upcomingExtra = [];
      if (m.referee) upcomingExtra.push({ l: 'الحكم', v: m.referee });
      if (m.commentator) upcomingExtra.push({ l: 'المعلق', v: m.commentator });
      if (upcomingExtra.length) {
        drawDivider(ctx, cx, y, W - 140); y += 40;
        upcomingExtra.forEach(function (row) {
          ctx.font = '600 22px Tajawal, Arial, sans-serif';
          ctx.fillStyle = T3;
          ctx.textAlign = 'right';
          ctx.fillText(row.l, W - 90, y);
          ctx.font = '700 26px Tajawal, Arial, sans-serif';
          ctx.fillStyle = T1;
          ctx.textAlign = 'left';
          ctx.fillText(fitText(ctx, row.v, 560), 90, y);
          y += 42;
        });
        ctx.textAlign = 'center';
      }
      y += 14;
    } else {
      if (isLive && (m.videoUrl || (d && d.videoUrl))) {
        ctx.fillStyle = LIVE;
        ctx.font = '700 26px Tajawal, Arial, sans-serif';
        ctx.fillText('🔴 البث المباشر متاح الآن', cx, y);
        y += 50;
      }

      // ── الهدافون: عمودان (مضيف | ضيف) ──
      var sc = scorers(m);
      if (sc.home.length || sc.away.length) {
        y += 10;
        drawDivider(ctx, cx, y, W - 140); y += 44;
        ctx.font = '700 24px Tajawal, Arial, sans-serif';
        ctx.fillStyle = T3;
        ctx.fillText('الهدافون', cx, y);
        y += 44;

        var rows = Math.max(sc.home.length, sc.away.length, 1);
        var lh = 40;
        var colLeftX = W * 0.28, colRightX = W * 0.72;
        for (var i = 0; i < rows; i++) {
          var hRow = sc.home[i], aRow = sc.away[i];
          if (hRow) {
            ctx.font = '700 26px Tajawal, Arial, sans-serif';
            ctx.fillStyle = T1;
            ctx.textAlign = 'center';
            ctx.fillText(fitText(ctx, hRow.name, 260) + '  ' + hRow.min + "'", colLeftX, y);
          }
          if (aRow) {
            ctx.font = '700 26px Tajawal, Arial, sans-serif';
            ctx.fillStyle = T1;
            ctx.textAlign = 'center';
            ctx.fillText(fitText(ctx, aRow.name, 260) + '  ' + aRow.min + "'", colRightX, y);
          }
          y += lh;
        }
        y += 16;
      }

      // ── تفاصيل إضافية للمباراة المنتهية ──
      if (isFin) {
        var extra = [];
        if (m.manOfMatch) extra.push({ l: 'رجل المباراة', v: m.manOfMatch });
        if (m.referee) extra.push({ l: 'الحكم', v: m.referee });
        if (m.commentator) extra.push({ l: 'المعلق', v: m.commentator });
        if (m.venue) extra.push({ l: 'الملعب', v: m.venue });
        if (extra.length) {
          drawDivider(ctx, cx, y, W - 140); y += 44;
          extra.slice(0, 4).forEach(function (row) {
            ctx.font = '600 22px Tajawal, Arial, sans-serif';
            ctx.fillStyle = T3;
            ctx.textAlign = 'right';
            ctx.fillText(row.l, W - 90, y);
            ctx.font = '700 26px Tajawal, Arial, sans-serif';
            ctx.fillStyle = T1;
            ctx.textAlign = 'left';
            ctx.fillText(fitText(ctx, row.v, 560), 90, y);
            y += 42;
          });
        }
      }
    }

    // ── تذييل ──
    var footerY = H - 100;
    drawDivider(ctx, cx, footerY - 34, W - 140);
    ctx.textAlign = 'center';
    ctx.font = '800 26px Tajawal, Arial, sans-serif';
    ctx.fillStyle = GOLD;
    ctx.fillText('تابع البطولة لحظة بلحظة', cx, footerY);
    ctx.font = '600 22px Tajawal, Arial, sans-serif';
    ctx.fillStyle = T3;
    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '');
    ctx.fillText(fitText(ctx, url, W - 160), cx, footerY + 34);

    // حقوق المنصة والمبرمج — تظهر في كل بطاقة تُشارَك
    ctx.font = '600 20px Tajawal, Arial, sans-serif';
    ctx.fillStyle = T3;
    ctx.fillText(CREDIT, cx, footerY + 64);

    return canvas;
  }

  function drawDivider(ctx, cx, y, w) {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, y);
    ctx.lineTo(cx + w / 2, y);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function buildShareText(m) {
    var league = window.league || {};
    var ht = team(m, 'home'), at = team(m, 'away');
    var url = siteUrl() + 'league-viewer.html?id=' + (window.LEAGUE_ID || '') + '&match=' + encodeURIComponent(m.id || '');
    var L = [];

    // سطر البطولة + الجولة/الدور
    var head = league.name || 'البطولة';
    if (m.isKnockout && m.knockoutRoundName) head += ' — ' + m.knockoutRoundName;
    else if (m.round) head += ' — الجولة ' + m.round;

    // سطر النتيجة المرتّب: «المضيف  ٢ - ١  الضيف» (يُقرأ يميناً لليسار)
    function scoreLine(hs, as) {
      return ht.name + '  ' + hs + ' - ' + as + '  ' + at.name;
    }

    if (m.status === 'live') {
      var d = m.liveData || {};
      var hs = d.homeScore ?? 0, as = d.awayScore ?? 0;
      var per = periodLabel(d);
      var clk = liveClock(d);
      var timeBit = [per, clk ? ('الدقيقة ' + clk) : ''].filter(Boolean).join(' · ');
      L.push('🔴 مباشر الآن');
      L.push(head);
      L.push('⚽ ' + scoreLine(hs, as));
      if (timeBit) L.push('⏱️ ' + timeBit);
      // الهدّافون إن وُجدوا
      var sc = scorers(m);
      var allSc = []
        .concat(sc.home.map(function(x){ return x.name + ' ' + x.min + "'"; }))
        .concat(sc.away.map(function(x){ return x.name + ' ' + x.min + "'"; }));
      if (allSc.length) L.push('🥅 ' + allSc.join('، '));
      L.push('');
      L.push('▶️ تابع البث والتفاصيل لحظة بلحظة:');
      L.push(url);

    } else if (m.status === 'finished') {
      var hs2 = m.homeScore ?? 0, as2 = m.awayScore ?? 0;
      L.push('✅ انتهت المباراة');
      L.push(head);
      L.push('⚽ ' + scoreLine(hs2, as2));
      if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) {
        L.push('🥅 ركلات الترجيح: ' + m.penaltyScoreHome + ' - ' + m.penaltyScoreAway);
      }
      var mom = (m.liveData && m.liveData.manOfMatch) || m.manOfMatch;
      if (mom) L.push('🌟 رجل المباراة: ' + mom);
      L.push('');
      L.push('📊 كل التفاصيل والهدّافين:');
      L.push(url);

    } else {
      var when = [];
      if (m.date) when.push((window.DateGroups && window.DateGroups.label) ? window.DateGroups.label(m.date) : m.date);
      if (m.time) when.push((window.formatTimeTo12H ? window.formatTimeTo12H(m.time) : m.time));
      L.push('📅 مباراة قادمة');
      L.push(head);
      L.push('⚔️ ' + ht.name + '  ضد  ' + at.name);
      if (when.length) L.push('🕐 ' + when.join(' — '));
      if (m.stadium) L.push('🏟️ ' + m.stadium);
      L.push('');
      L.push('🔔 لا تفوّت المباراة — تابعها هنا:');
      L.push(url);
    }

    // إعلان المنصة (فاصل أنيق)
    L.push('');
    L.push('━━━━━━━━━━━━━━');
    L.push('🏆 ' + CREDIT);
    return L.join('\n');
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('toBlob failed'));
        }, 'image/png', 0.95);
      } catch (e) { reject(e); }
    });
  }

  // ── معاينة/تنزيل عند تعذّر المشاركة المباشرة ──
  function showPreview(blob, matchTitle, shareText) {
    var url = URL.createObjectURL(blob);
    var el = document.createElement('div');
    el.id = '_cardPreviewModal';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(6,7,8,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:14px;overflow-y:auto';
    el.innerHTML =
      '<img src="' + url + '" style="max-width:100%;max-height:56vh;border-radius:14px;border:1px solid #2A2F35"/>' +
      '<div style="width:100%;max-width:360px;background:#171A1D;border:1px solid #2A2F35;border-radius:10px;padding:11px 13px;' +
        'font-family:Tajawal,sans-serif;font-size:12px;color:#9BA3AD;white-space:pre-wrap;line-height:1.7;max-height:110px;overflow-y:auto">' +
        (shareText || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
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
          .then(function () {
            copyBtn.textContent = 'تم النسخ';
            setTimeout(function () { copyBtn.textContent = 'نسخ النص'; }, 1800);
          })
          .catch(function () {
            if (window.showToast) window.showToast('تعذّر نسخ النص', 'error');
          });
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
        try {
          await navigator.share({ files: [file], title: title, text: shareText });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; // ألغى المستخدم
        }
      }
      showPreview(blob, title, shareText);
    } catch (e) {
      console.error('[match-share-card]', e);
      if (window.showToast) window.showToast('تعذّر إنشاء البطاقة، حاول مجدداً', 'error');
    }
  };

  // console.log('[match-share-card] جاهز');
})();
