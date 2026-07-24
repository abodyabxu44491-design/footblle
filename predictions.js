/* ═══════════════════════════════════════════════════════════════════
 *  predictions.js — مسابقة توقّع المباريات (محلية بالكامل)
 * ───────────────────────────────────────────────────────────────────
 *  • المتابع يكتب اسمه مرة واحدة، ثم يتوقّع نتائج المباريات القادمة.
 *  • تُحفظ التوقعات على جهازه (localStorage) — بلا تسجيل ولا خادم.
 *  • بعد انتهاء المباراة تُقارَن تلقائياً وتُحتسب النقاط.
 *  • بطاقة مشاركة كصورة تحمل اسمه وتوقّعه — للجروبات.
 *
 *  النقاط: 3 للنتيجة بالضبط · 1 للاتجاه الصحيح · 0 للخطأ
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY  = 'predictions_v1';
  var NKEY = 'predictor_name_v1';

  function leagueKey() {
    return KEY + ':' + (window.LEAGUE_ID ||
      (new URLSearchParams(location.search)).get('id') || 'default');
  }
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(leagueKey()) || '{}'); }
    catch (e) { return {}; }
  }
  function saveAll(o) {
    try { localStorage.setItem(leagueKey(), JSON.stringify(o)); } catch (e) {}
  }
  function getPred(id) { return loadAll()[id] || null; }
  function setPred(id, h, a, pen) {
    var all = loadAll();
    all[id] = { h: h, a: a, pen: pen || '', at: Date.now() };
    saveAll(all);
  }

  /* اسم المتوقّع */
  function getName() {
    try { return (localStorage.getItem(NKEY) || '').trim(); } catch (e) { return ''; }
  }
  function setName(n) {
    try { localStorage.setItem(NKEY, String(n || '').trim().slice(0, 24)); } catch (e) {}
  }
  window._predName = getName;

  function outcome(h, a) { return h > a ? 'h' : (a > h ? 'a' : 'd'); }

  /* نتيجة ركلات الترجيح الفعلية (من أي مصدر) */
  function realPen(m) {
    if (!m) return null;
    if (m.penaltyScoreHome != null && m.penaltyScoreAway != null)
      return { h: m.penaltyScoreHome, a: m.penaltyScoreAway };
    var pd = m.penalties || (m.liveData && m.liveData.penalties);
    if (pd && ((pd.home || []).length || (pd.away || []).length)) {
      var g = function (r) { return (typeof r === 'string') ? r === 'goal' : !!(r && r.result === 'goal'); };
      return { h: (pd.home || []).filter(g).length, a: (pd.away || []).filter(g).length };
    }
    return null;
  }

  function evaluate(m, p) {
    if (!m || !p || m.status !== 'finished') return null;
    var mh = m.homeScore != null ? m.homeScore : 0;
    var ma = m.awayScore != null ? m.awayScore : 0;

    /* مباراة إقصاء انتهت بالتعادل وحُسمت بركلات الترجيح:
       نقارن الفائز المتوقّع بالفائز الفعلي. */
    var rp = (mh === ma) ? realPen(m) : null;
    if (rp && rp.h !== rp.a) {
      var realWin = rp.h > rp.a ? 'h' : 'a';
      var exactScore = (p.h === mh && p.a === ma);
      if (exactScore && p.pen === realWin) return { points: 3, exact: true, correct: true };
      if (p.pen === realWin) return { points: 1, exact: false, correct: true };
      return { points: 0, exact: false, correct: false };
    }

    if (p.h === mh && p.a === ma) return { points: 3, exact: true,  correct: true };
    if (outcome(p.h, p.a) === outcome(mh, ma)) return { points: 1, exact: false, correct: true };
    return { points: 0, exact: false, correct: false };
  }

  function stats() {
    var all = loadAll(), M = window.matches || [];
    var s = { total: 0, done: 0, exact: 0, correct: 0, points: 0, pending: 0 };
    Object.keys(all).forEach(function (id) {
      var m = M.find(function (x) { return x.id === id; });
      if (!m) return;
      s.total++;
      var r = evaluate(m, all[id]);
      if (!r) { s.pending++; return; }
      s.done++; s.points += r.points;
      if (r.exact) s.exact++;
      if (r.correct) s.correct++;
    });
    s.accuracy = s.done ? Math.round((s.correct / s.done) * 100) : 0;
    return s;
  }
  window._predStats = stats;

  function teamOf(m, side) {
    var T = window.teams || [];
    var id = side === 'home' ? m.homeId : m.awayId;
    var t = T.find(function (x) { return x.id === id; });
    return t || { name: (side === 'home' ? m.homeName : m.awayName) || '—', logo: '' };
  }
  function canPredict(m) {
    return m && m.status !== 'finished' && m.status !== 'live';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[<>]/g, ''); }

  /* ── شارة التوقّع على بطاقة المباراة ── */
  window.predBadge = function (matchId) {
    var M = window.matches || [];
    var m = M.find(function (x) { return x.id === matchId; });
    if (!m) return '';
    var p = getPred(matchId);
    if (!p) {
      return canPredict(m)
        ? '<button class="pr-badge pr-open" onclick="event.stopPropagation();openPredict(\'' + matchId + '\')">توقّع النتيجة</button>'
        : '';
    }
    var r = evaluate(m, p);
    var penTxt = '';
    if (p.h === p.a && p.pen) {
      var wt = p.pen === 'h' ? teamOf(m, 'home') : teamOf(m, 'away');
      penTxt = ' (ترجيح: ' + wt.name + ')';
    }
    if (!r) return '<span class="pr-badge pr-mine">توقّعك ' + p.h + '-' + p.a + penTxt + '</span>';
    var cls = r.exact ? 'pr-exact' : (r.correct ? 'pr-ok' : 'pr-bad');
    var lbl = r.exact ? 'إصابة كاملة' : (r.correct ? 'اتجاه صحيح' : 'توقّع خاطئ');
    return '<span class="pr-badge ' + cls + '">' + lbl + ' · ' + p.h + '-' + p.a + penTxt + '</span>';
  };

  /* ── نافذة التوقّع (تطلب الاسم أول مرة) ── */
  window.openPredict = function (matchId) {
    var M = window.matches || [];
    var m = M.find(function (x) { return x.id === matchId; });
    if (!m) return;
    if (!canPredict(m)) {
      if (window.showToast) window.showToast('انتهى وقت التوقّع لهذه المباراة', 'error');
      return;
    }
    var ht = teamOf(m, 'home'), at = teamOf(m, 'away');
    var prev = getPred(matchId) || { h: 0, a: 0 };
    var logo = window.logoHtml || function () { return ''; };
    var nm = getName();

    var ov = document.createElement('div');
    ov.id = 'predOverlay';
    ov.className = 'pr-ov';
    ov.innerHTML =
      '<div class="pr-modal">' +
        '<div class="pr-title">توقّع نتيجة المباراة</div>' +
        '<div class="pr-sub">توقّعك يُحفظ على جهازك — بلا تسجيل</div>' +

        '<div class="pr-namebox">' +
          '<label>اسمك (يظهر على بطاقة المشاركة)</label>' +
          '<input id="prName" maxlength="24" placeholder="اكتب اسمك" value="' + esc(nm) + '"/>' +
        '</div>' +

        '<div class="pr-teams">' +
          '<div class="pr-team">' +
            '<div class="pr-logo">' + logo(ht.logo, 40, 10) + '</div>' +
            '<div class="pr-name">' + esc(ht.name) + '</div>' +
            '<div class="pr-ctrl">' +
              '<button onclick="_predAdj(\'h\',-1)">−</button>' +
              '<span id="prH">' + prev.h + '</span>' +
              '<button onclick="_predAdj(\'h\',1)">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="pr-vs">VS</div>' +
          '<div class="pr-team">' +
            '<div class="pr-logo">' + logo(at.logo, 40, 10) + '</div>' +
            '<div class="pr-name">' + esc(at.name) + '</div>' +
            '<div class="pr-ctrl">' +
              '<button onclick="_predAdj(\'a\',-1)">−</button>' +
              '<span id="prA">' + prev.a + '</span>' +
              '<button onclick="_predAdj(\'a\',1)">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        (m.isKnockout ?
        '<div class="pr-penbox" id="prPenBox" style="display:none">' +
          '<div class="pr-penlbl">تعادل — من يفوز بركلات الترجيح؟</div>' +
          '<div class="pr-penrow">' +
            '<button id="prPenH" class="pr-penbtn" onclick="_predPen(\'h\')">' + esc(ht.name) + '</button>' +
            '<button id="prPenA" class="pr-penbtn" onclick="_predPen(\'a\')">' + esc(at.name) + '</button>' +
          '</div>' +
        '</div>' : '') +

        '<div class="pr-note">3 نقاط للنتيجة الصحيحة تماماً · نقطة واحدة إذا توقّعت الفائز فقط</div>' +
        '<div class="pr-actions">' +
          '<button class="pr-cancel" onclick="document.getElementById(\'predOverlay\').remove()">إلغاء</button>' +
          '<button class="pr-save" onclick="_predSave(\'' + matchId + '\')">حفظ ومشاركة</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    window._predIsKO = !!m.isKnockout;
    window._predPenPick = (prev && prev.pen) || '';
    _predSyncPen();
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    if (!nm) setTimeout(function () { var i = document.getElementById('prName'); if (i) i.focus(); }, 80);
  };

  /* يُظهر/يُخفي اختيار ركلات الترجيح حسب التعادل (للإقصاء فقط) */
  function _predSyncPen() {
    var box = document.getElementById('prPenBox');
    if (!box || !window._predIsKO) return;
    var eh = document.getElementById('prH'), ea = document.getElementById('prA');
    var h = parseInt(eh ? eh.textContent : '0', 10) || 0;
    var a = parseInt(ea ? ea.textContent : '0', 10) || 0;
    var tie = (h === a);
    box.style.display = tie ? 'block' : 'none';
    if (!tie) window._predPenPick = '';
    var bh = document.getElementById('prPenH'), ba = document.getElementById('prPenA');
    if (bh) bh.classList.toggle('pr-penon', window._predPenPick === 'h');
    if (ba) ba.classList.toggle('pr-penon', window._predPenPick === 'a');
  }
  window._predSyncPen = _predSyncPen;

  window._predPen = function (side) {
    window._predPenPick = (window._predPenPick === side) ? '' : side;
    _predSyncPen();
  };

  window._predAdj = function (which, delta) {
    var el = document.getElementById(which === 'h' ? 'prH' : 'prA');
    if (!el) return;
    var v = Math.max(0, Math.min(20, (parseInt(el.textContent, 10) || 0) + delta));
    el.textContent = v;
    _predSyncPen();
  };

  window._predSave = function (matchId) {
    var ni = document.getElementById('prName');
    var nm = ni ? String(ni.value || '').trim() : '';
    if (!nm) {
      if (window.showToast) window.showToast('اكتب اسمك أولاً', 'error');
      if (ni) ni.focus();
      return;
    }
    setName(nm);
    var eh = document.getElementById('prH'), ea = document.getElementById('prA');
    var h = parseInt(eh ? eh.textContent : '0', 10) || 0;
    var a = parseInt(ea ? ea.textContent : '0', 10) || 0;
    // في الإقصاء: التعادل يتطلّب تحديد الفائز بركلات الترجيح
    var pen = window._predPenPick || '';
    if (window._predIsKO && h === a && !pen) {
      if (window.showToast) window.showToast('حدّد من يفوز بركلات الترجيح', 'error');
      return;
    }
    setPred(matchId, h, a, pen);
    var ov = document.getElementById('predOverlay');
    if (ov) ov.remove();
    if (window.showToast) window.showToast('تم حفظ توقّعك ' + h + '-' + a, 'success');
    if (window.renderAll) window.renderAll();
    setTimeout(function () { window.sharePrediction(matchId); }, 350);
  };

  /* ── بطاقة المشاركة (Canvas) ── */
  function loadImg(src) {
    return new Promise(function (resolve) {
      if (!src || !/^data:image\//.test(String(src))) return resolve(null);
      var img = new Image(), done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 3000);
      img.onload  = function () { if (!done) { done = true; clearTimeout(t); resolve(img); } };
      img.onerror = function () { if (!done) { done = true; clearTimeout(t); resolve(null); } };
      img.src = src;
    });
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* إطار شعار أنيق يحافظ على نسبة الصورة (لا تشويه ولا قصّ) */
  function drawLogoBox(x, img, cx, cy, size) {
    var r = 24;
    // خلفية الإطار
    x.save();
    rr(x, cx - size / 2, cy, size, size, r);
    x.fillStyle = '#17171c';
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,.07)';
    x.lineWidth = 2;
    x.stroke();
    x.restore();

    if (!img) return;
    /* يملأ الإطار بالكامل مثل object-fit:cover في واجهة الجمهور —
       فتخرج كل الشعارات بنفس المقاس والشكل مهما اختلفت أبعادها
       (بدل أن يظهر الطويل ضيقاً والعريض مسطحاً). */
    var iw = img.width || 1, ih = img.height || 1;
    var sc = Math.max(size / iw, size / ih);
    var w = iw * sc, h = ih * sc;
    var dx = cx - w / 2, dy = cy + (size - h) / 2;
    x.save();
    rr(x, cx - size / 2, cy, size, size, r);
    x.clip();
    x.drawImage(img, dx, dy, w, h);
    x.restore();
  }

  /* تقصير النص ليناسب عرضاً محدداً */
  function fitText(x, text, maxW) {
    var t = String(text || '');
    if (x.measureText(t).width <= maxW) return t;
    while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /* اسم الدور/الجولة */
  function roundLabel(m) {
    if (m.isKnockout && m.knockoutRoundName) return m.knockoutRoundName;
    if (m.isKnockout) return 'دور إقصائي';
    if (m.round) return 'الجولة ' + m.round;
    return '';
  }

  async function drawCard(m) {
    var W = 1080, H = 1080;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');

    /* الخلفية */
    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0a0c');
    g.addColorStop(1, '#15151a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(201,160,43,.30)'; x.lineWidth = 3;
    rr(x, 28, 28, W - 56, H - 56, 36); x.stroke();

    var ht = teamOf(m, 'home'), at = teamOf(m, 'away');
    var p  = getPred(m.id) || { h: 0, a: 0 };
    var r  = evaluate(m, p);
    var L  = (window.league && window.league.name) || 'البطولة';
    var nm = getName();
    var rl = roundLabel(m);

    x.textAlign = 'center';

    /* ① العنوان: توقّعات */
    x.fillStyle = '#C9A02B';
    x.font = '900 46px Tajawal, sans-serif';
    x.fillText(r ? 'نتيجة التوقّع' : 'توقّعات', W / 2, 108);

    /* ② اسم البطولة */
    x.fillStyle = '#ffffff';
    x.font = '800 32px Tajawal, sans-serif';
    x.fillText(fitText(x, L, W - 200), W / 2, 158);

    /* ③ اسم الدور */
    if (rl) {
      var rw = x.measureText(rl).width;
      x.font = '700 24px Tajawal, sans-serif';
      rw = x.measureText(rl).width + 44;
      x.globalAlpha = 0.10; x.fillStyle = '#C9A02B';
      rr(x, W / 2 - rw / 2, 178, rw, 44, 22); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(201,160,43,.30)'; x.lineWidth = 1.5;
      rr(x, W / 2 - rw / 2, 178, rw, 44, 22); x.stroke();
      x.fillStyle = '#C9A02B';
      x.fillText(rl, W / 2, 208);
    }

    /* ④ اسم المتوقّع */
    var nameY = rl ? 282 : 250;
    if (nm) {
      x.fillStyle = '#7d7d85';
      x.font = '700 22px Tajawal, sans-serif';
      x.fillText('المتوقّع', W / 2, nameY);
      x.fillStyle = '#ffffff';
      x.font = '900 44px Tajawal, sans-serif';
      x.fillText(fitText(x, nm, W - 240), W / 2, nameY + 50);
    }

    /* ⑤ الفريقان والنتيجة — الشعارات على الأطراف والنتيجة في صندوق وسط */
    var LY = nameY + (nm ? 96 : 20);
    var LS = 140;
    var SIDE = 320;
    drawLogoBox(x, await loadImg(ht.logo), W / 2 - SIDE, LY, LS);
    drawLogoBox(x, await loadImg(at.logo), W / 2 + SIDE, LY, LS);

    x.fillStyle = '#e9e9ee';
    x.font = '800 27px Tajawal, sans-serif';
    x.fillText(fitText(x, ht.name, 230), W / 2 - SIDE, LY + LS + 44);
    x.fillText(fitText(x, at.name, 230), W / 2 + SIDE, LY + LS + 44);

    // صندوق النتيجة في المنتصف — واضح ومفصول
    var sbW = 320, sbH = LS, sbX = W / 2 - sbW / 2;
    x.globalAlpha = 0.5; x.fillStyle = '#0e0e12';
    rr(x, sbX, LY, sbW, sbH, 20); x.fill();
    x.globalAlpha = 1;
    x.strokeStyle = 'rgba(201,160,43,.28)'; x.lineWidth = 2;
    rr(x, sbX, LY, sbW, sbH, 20); x.stroke();

    // الأرقام كلٌّ في جهته والشرطة في المنتصف — لا تخرج عن الإطار
    var midY = LY + sbH / 2 + 26;
    x.save();
    x.direction = 'ltr';
    x.fillStyle = '#ffffff';
    x.font = '900 76px Tajawal, sans-serif';
    x.fillText(String(p.h), W / 2 - 82, midY);
    x.fillText(String(p.a), W / 2 + 82, midY);
    x.restore();
    x.fillStyle = 'rgba(201,160,43,.8)';
    x.font = '900 40px Tajawal, sans-serif';
    x.fillText('-', W / 2, midY - 10);

    // شارة الفائز بركلات الترجيح (للإقصاء المتعادل)
    if (p.h === p.a && p.pen) {
      var pw = p.pen === 'h' ? ht.name : at.name;
      x.fillStyle = '#C9A02B';
      x.font = '800 24px Tajawal, sans-serif';
      x.fillText(fitText(x, 'يفوز ' + pw + ' بركلات الترجيح', W - 340),
                 W / 2, LY + sbH + 96);
    }

    /* ⑥ الحالة */
    var boxY = LY + LS + ((p.h === p.a && p.pen) ? 130 : 96);
    var bw = W - 300;
    if (r) {
      var col = r.exact ? '#27ae60' : (r.correct ? '#C9A02B' : '#C0392B');
      var txt = r.exact ? 'إصابة كاملة' : (r.correct ? 'اتجاه صحيح' : 'توقّع خاطئ');
      x.globalAlpha = 0.13; x.fillStyle = col;
      rr(x, W / 2 - bw / 2, boxY, bw, 118, 22); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = col; x.lineWidth = 2;
      rr(x, W / 2 - bw / 2, boxY, bw, 118, 22); x.stroke();
      x.fillStyle = col;
      x.font = '900 42px Tajawal, sans-serif';
      x.fillText(txt + '  ·  ' + r.points + ' نقطة', W / 2, boxY + 74);

      x.fillStyle = '#8d8d95';
      x.font = '700 28px Tajawal, sans-serif';
      var fh = m.homeScore != null ? m.homeScore : 0;
      var fa = m.awayScore != null ? m.awayScore : 0;
      x.fillText('النتيجة الفعلية: ' + fh + ' - ' + fa, W / 2, boxY + 162);
    } else {
      x.globalAlpha = 0.09; x.fillStyle = '#C9A02B';
      rr(x, W / 2 - bw / 2, boxY, bw, 108, 22); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(201,160,43,.45)'; x.lineWidth = 2;
      rr(x, W / 2 - bw / 2, boxY, bw, 108, 22); x.stroke();
      x.fillStyle = '#C9A02B';
      x.font = '800 36px Tajawal, sans-serif';
      x.fillText('في انتظار المباراة', W / 2, boxY + 68);
    }

    /* ⑦ سجلّ المتوقّع */
    var s = stats();
    if (s.done > 0) {
      x.fillStyle = '#6f6f77';
      x.font = '700 26px Tajawal, sans-serif';
      x.fillText(s.points + ' نقطة  ·  دقة ' + s.accuracy + '%  ·  ' + s.done + ' مباراة',
                 W / 2, H - 168);
    }

    /* ⑧ التوقيع */
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(180, H - 132); x.lineTo(W - 180, H - 132); x.stroke();

    x.fillStyle = '#9a8437';
    x.font = '800 27px Tajawal, sans-serif';
    x.fillText(fitText(x, L, W - 260), W / 2, H - 92);

    x.fillStyle = '#54545c';
    x.font = '700 22px Tajawal, sans-serif';
    x.fillText('منصة بطولات — تطوير عبدالله السكني', W / 2, H - 56);

    return c;
  }

  function toBlob(canvas) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error('toBlob')); }, 'image/png', 0.95);
    });
  }

  window.sharePrediction = async function (matchId) {
    var M = window.matches || [];
    var m = M.find(function (x) { return x.id === matchId; });
    if (!m) return;
    var p = getPred(matchId);
    if (!p) { if (window.showToast) window.showToast('لا يوجد توقّع لهذه المباراة', 'error'); return; }

    if (window.showToast) window.showToast('جاري إنشاء البطاقة...', 'success');
    try {
      var canvas = await drawCard(m);
      var blob = await toBlob(canvas);
      var file = new File([blob], 'prediction.png', { type: 'image/png' });
      var ht = teamOf(m, 'home'), at = teamOf(m, 'away');
      var L  = (window.league && window.league.name) || 'البطولة';
      var nm = getName();
      var url = location.origin + location.pathname + '?id=' +
                encodeURIComponent(window.LEAGUE_ID || '');
      var text = (nm ? nm + ' يتوقّع: ' : 'توقّعي: ') +
                 ht.name + ' ' + p.h + ' - ' + p.a + ' ' + at.name +
                 '\n' + L + '\nتوقّع أنت أيضاً: ' + url;

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: L, text: text }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'prediction.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      if (window.showToast) window.showToast('تم تنزيل البطاقة — شاركها من معرض الصور', 'success');
    } catch (e) {
      console.error('[predictions]', e);
      if (window.showToast) window.showToast('تعذّر إنشاء البطاقة', 'error');
    }
  };

  /* ── لوحة سجلّي ── */
  window.openMyPredictions = function () {
    var s = stats(), M = window.matches || [], all = loadAll();
    var nm = getName();
    var ids = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });

    var rows = ids.map(function (id) {
      var m = M.find(function (x) { return x.id === id; });
      if (!m) return '';
      var ht = teamOf(m, 'home'), at = teamOf(m, 'away');
      var p = all[id], r = evaluate(m, p);
      var cls = !r ? 'pr-wait' : (r.exact ? 'pr-exact' : (r.correct ? 'pr-ok' : 'pr-bad'));
      var lbl = !r ? 'قادمة' : (r.exact ? '+3' : (r.correct ? '+1' : '0'));
      return '<div class="pr-row">' +
        '<span class="pr-row-t">' + esc(ht.name) + '</span>' +
        '<span class="pr-row-s">' + p.h + '-' + p.a + '</span>' +
        '<span class="pr-row-t pr-row-t2">' + esc(at.name) + '</span>' +
        '<span class="pr-pill ' + cls + '">' + lbl + '</span>' +
        '<button class="pr-share-mini" onclick="sharePrediction(\'' + id + '\')">مشاركة</button>' +
        '</div>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'predOverlay';
    ov.className = 'pr-ov';
    ov.innerHTML =
      '<div class="pr-modal pr-modal-wide">' +
        '<div class="pr-title">سجلّ توقّعاتي</div>' +
        (nm ? '<div class="pr-sub">' + esc(nm) + '</div>' : '') +
        '<div class="pr-statgrid">' +
          '<div class="pr-stat"><b>' + s.points + '</b><span>نقطة</span></div>' +
          '<div class="pr-stat"><b>' + s.accuracy + '%</b><span>الدقة</span></div>' +
          '<div class="pr-stat"><b>' + s.exact + '</b><span>إصابة كاملة</span></div>' +
          '<div class="pr-stat"><b>' + s.pending + '</b><span>بانتظار</span></div>' +
        '</div>' +
        (rows ? '<div class="pr-list">' + rows + '</div>'
              : '<div class="pr-empty">لم تتوقّع أي مباراة بعد — افتح أي مباراة قادمة وتوقّع نتيجتها</div>') +
        '<div class="pr-actions">' +
          '<button class="pr-cancel" onclick="document.getElementById(\'predOverlay\').remove()">إغلاق</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
  };

  /* ── الأنماط ── */
  var css =
  '.pr-ov{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.82);display:flex;' +
  'align-items:center;justify-content:center;padding:18px;font-family:Tajawal,sans-serif}' +
  '.pr-modal{width:100%;max-width:380px;background:var(--s1,#111);border:1px solid var(--b2,#2a2a2a);' +
  'border-radius:18px;padding:18px;max-height:86vh;overflow-y:auto}' +
  '.pr-modal-wide{max-width:440px}' +
  '.pr-title{font-size:16px;font-weight:900;color:var(--gold,#C9A02B);text-align:center}' +
  '.pr-sub{font-size:11px;color:var(--t3,#888);text-align:center;margin:4px 0 14px}' +
  '.pr-namebox{margin-bottom:14px}' +
  '.pr-namebox label{display:block;font-size:10px;color:var(--t3,#888);margin-bottom:5px}' +
  '.pr-namebox input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--b2,#2a2a2a);' +
  'background:var(--s2,#1a1a1a);color:var(--t1,#eee);font-family:Tajawal,sans-serif;font-size:13px;' +
  'font-weight:700;box-sizing:border-box;text-align:center}' +
  '.pr-teams{display:flex;align-items:flex-start;justify-content:center;gap:10px}' +
  '.pr-team{flex:1;text-align:center;min-width:0}' +
  '.pr-logo{display:flex;justify-content:center;margin-bottom:7px}' +
  '.pr-name{font-size:12px;font-weight:800;color:var(--t1,#eee);margin-bottom:10px;' +
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.pr-vs{font-size:12px;color:var(--t3,#888);font-weight:900;padding-top:52px}' +
  '.pr-ctrl{display:flex;align-items:center;justify-content:center;gap:8px}' +
  '.pr-ctrl button{width:32px;height:32px;border-radius:9px;border:1px solid var(--b2,#2a2a2a);' +
  'background:var(--s2,#1a1a1a);color:var(--gold,#C9A02B);font-size:17px;font-weight:900;cursor:pointer}' +
  '.pr-ctrl span{min-width:34px;font-size:24px;font-weight:900;color:#fff;text-align:center}' +
  '.pr-penbox{margin-top:14px;padding:12px;border-radius:12px;'+
  'background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.25)}'+
  '.pr-penlbl{font-size:11px;font-weight:800;color:#C9A02B;text-align:center;margin-bottom:9px}'+
  '.pr-penrow{display:grid;grid-template-columns:1fr 1fr;gap:8px}'+
  '.pr-penbtn{padding:10px 6px;border-radius:10px;border:1px solid var(--b2,#2a2a2a);'+
  'background:var(--s2,#1a1a1a);color:var(--t2,#bbb);font-family:Tajawal,sans-serif;'+
  'font-weight:800;font-size:11.5px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
  '.pr-penbtn.pr-penon{background:rgba(201,160,43,.16);border-color:#C9A02B;color:#C9A02B}'+
  '.pr-note{font-size:10px;color:var(--t3,#888);text-align:center;margin:16px 0 4px;line-height:1.8}' +
  '.pr-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}' +
  '.pr-modal-wide .pr-actions{grid-template-columns:1fr}' +
  '.pr-cancel{padding:11px;border-radius:10px;border:1px solid var(--b2,#2a2a2a);background:transparent;' +
  'color:var(--t3,#888);font-family:Tajawal,sans-serif;font-weight:700;font-size:12px;cursor:pointer}' +
  '.pr-save{padding:11px;border-radius:10px;border:none;background:var(--gold,#C9A02B);color:#000;' +
  'font-family:Tajawal,sans-serif;font-weight:900;font-size:12px;cursor:pointer}' +
  '.pr-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;' +
  'padding:4px 9px;border-radius:20px;border:1px solid;font-family:Tajawal,sans-serif;margin-top:6px}' +
  '.pr-open{background:rgba(201,160,43,.10);border-color:rgba(201,160,43,.35);color:#C9A02B;cursor:pointer}' +
  '.pr-mine{background:rgba(255,255,255,.05);border-color:var(--b2,#2a2a2a);color:var(--t2,#bbb)}' +
  '.pr-exact{background:rgba(39,174,96,.12);border-color:rgba(39,174,96,.4);color:#27ae60}' +
  '.pr-ok{background:rgba(201,160,43,.12);border-color:rgba(201,160,43,.4);color:#C9A02B}' +
  '.pr-bad{background:rgba(192,57,43,.10);border-color:rgba(192,57,43,.35);color:#C0392B}' +
  '.pr-wait{background:rgba(255,255,255,.05);border-color:var(--b2,#2a2a2a);color:var(--t3,#888)}' +
  '.pr-statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:14px 0}' +
  '.pr-stat{background:var(--s2,#1a1a1a);border:1px solid var(--b1,#222);border-radius:11px;' +
  'padding:10px 4px;text-align:center}' +
  '.pr-stat b{display:block;font-size:19px;color:var(--gold,#C9A02B);font-weight:900}' +
  '.pr-stat span{font-size:9px;color:var(--t3,#888)}' +
  '.pr-list{display:flex;flex-direction:column;gap:6px;max-height:44vh;overflow-y:auto}' +
  '.pr-row{display:flex;align-items:center;gap:7px;padding:8px;border-radius:10px;' +
  'background:var(--s2,#1a1a1a);border:1px solid var(--b1,#222);font-size:11px}' +
  '.pr-row-t{flex:1;font-weight:700;color:var(--t1,#eee);overflow:hidden;' +
  'text-overflow:ellipsis;white-space:nowrap;text-align:end}' +
  '.pr-row-t2{text-align:start}' +
  '.pr-row-s{font-weight:900;color:#fff;flex:0 0 auto}' +
  '.pr-pill{flex:0 0 auto;font-size:10px;font-weight:900;padding:3px 8px;border-radius:20px;border:1px solid}' +
  '.pr-share-mini{flex:0 0 auto;font-size:9px;font-weight:700;padding:4px 8px;border-radius:8px;' +
  'border:1px solid var(--b2,#2a2a2a);background:transparent;color:var(--t3,#888);cursor:pointer;' +
  'font-family:Tajawal,sans-serif}' +
  '.pr-empty{text-align:center;padding:26px 10px;color:var(--t3,#888);font-size:11.5px;line-height:1.9}';

  var st = document.createElement('style');
  st.id = 'predictions-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
