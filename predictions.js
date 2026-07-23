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
  function setPred(id, h, a) {
    var all = loadAll();
    all[id] = { h: h, a: a, at: Date.now() };
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

  function evaluate(m, p) {
    if (!m || !p || m.status !== 'finished') return null;
    var mh = m.homeScore != null ? m.homeScore : 0;
    var ma = m.awayScore != null ? m.awayScore : 0;
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
    if (!r) return '<span class="pr-badge pr-mine">توقّعك ' + p.h + '-' + p.a + '</span>';
    var cls = r.exact ? 'pr-exact' : (r.correct ? 'pr-ok' : 'pr-bad');
    var lbl = r.exact ? 'إصابة كاملة' : (r.correct ? 'اتجاه صحيح' : 'توقّع خاطئ');
    return '<span class="pr-badge ' + cls + '">' + lbl + ' · ' + p.h + '-' + p.a + '</span>';
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

        '<div class="pr-note">3 نقاط للنتيجة الصحيحة تماماً · نقطة واحدة إذا توقّعت الفائز فقط</div>' +
        '<div class="pr-actions">' +
          '<button class="pr-cancel" onclick="document.getElementById(\'predOverlay\').remove()">إلغاء</button>' +
          '<button class="pr-save" onclick="_predSave(\'' + matchId + '\')">حفظ ومشاركة</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    if (!nm) setTimeout(function () { var i = document.getElementById('prName'); if (i) i.focus(); }, 80);
  };

  window._predAdj = function (which, delta) {
    var el = document.getElementById(which === 'h' ? 'prH' : 'prA');
    if (!el) return;
    var v = Math.max(0, Math.min(20, (parseInt(el.textContent, 10) || 0) + delta));
    el.textContent = v;
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
    setPred(matchId, h, a);
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

  async function drawCard(m) {
    var W = 1080, H = 1080;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');

    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0b0d'); g.addColorStop(1, '#141418');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(201,160,43,.35)'; x.lineWidth = 3;
    rr(x, 30, 30, W - 60, H - 60, 34); x.stroke();

    var ht = teamOf(m, 'home'), at = teamOf(m, 'away');
    var p  = getPred(m.id) || { h: 0, a: 0 };
    var r  = evaluate(m, p);
    var L  = (window.league && window.league.name) || 'البطولة';
    var nm = getName();

    x.textAlign = 'center';
    x.fillStyle = '#C9A02B';
    x.font = '800 34px Tajawal, sans-serif';
    x.fillText(L, W / 2, 104);

    // اسم المتوقّع
    if (nm) {
      x.fillStyle = '#fff';
      x.font = '900 42px Tajawal, sans-serif';
      x.fillText(nm, W / 2, 164);
      x.fillStyle = '#8a8a8a';
      x.font = '700 24px Tajawal, sans-serif';
      x.fillText(r ? 'نتيجة توقّعه' : 'توقّعه للمباراة', W / 2, 202);
    } else {
      x.fillStyle = '#8a8a8a';
      x.font = '700 26px Tajawal, sans-serif';
      x.fillText(r ? 'نتيجة التوقّع' : 'التوقّع', W / 2, 168);
    }

    var hi = await loadImg(ht.logo), ai = await loadImg(at.logo);
    var LY = 262, LS = 146;
    function badge(img, cx, name) {
      x.save();
      rr(x, cx - LS / 2, LY, LS, LS, 26); x.clip();
      x.fillStyle = '#1c1c22'; x.fillRect(cx - LS / 2, LY, LS, LS);
      if (img) x.drawImage(img, cx - LS / 2, LY, LS, LS);
      x.restore();
      x.fillStyle = '#fff';
      x.font = '800 29px Tajawal, sans-serif';
      var t = name.length > 14 ? name.slice(0, 13) + '…' : name;
      x.fillText(t, cx, LY + LS + 46);
    }
    badge(hi, W / 2 - 232, ht.name);
    badge(ai, W / 2 + 232, at.name);

    x.fillStyle = '#fff';
    x.font = '900 126px Tajawal, sans-serif';
    x.fillText(p.h + '  -  ' + p.a, W / 2, LY + 126);

    var boxY = 600;
    if (r) {
      var col = r.exact ? '#27ae60' : (r.correct ? '#C9A02B' : '#C0392B');
      var txt = r.exact ? 'إصابة كاملة' : (r.correct ? 'اتجاه صحيح' : 'توقّع خاطئ');
      x.globalAlpha = 0.14; x.fillStyle = col;
      rr(x, 140, boxY, W - 280, 126, 22); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = col; x.lineWidth = 2;
      rr(x, 140, boxY, W - 280, 126, 22); x.stroke();
      x.fillStyle = col;
      x.font = '900 44px Tajawal, sans-serif';
      x.fillText(txt + '  ·  ' + r.points + ' نقطة', W / 2, boxY + 80);

      x.fillStyle = '#9a9a9a';
      x.font = '700 30px Tajawal, sans-serif';
      var fh = m.homeScore != null ? m.homeScore : 0;
      var fa = m.awayScore != null ? m.awayScore : 0;
      x.fillText('النتيجة الفعلية: ' + fh + ' - ' + fa, W / 2, boxY + 176);
    } else {
      x.globalAlpha = 0.10; x.fillStyle = '#C9A02B';
      rr(x, 140, boxY, W - 280, 118, 22); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(201,160,43,.5)'; x.lineWidth = 2;
      rr(x, 140, boxY, W - 280, 118, 22); x.stroke();
      x.fillStyle = '#C9A02B';
      x.font = '800 38px Tajawal, sans-serif';
      x.fillText('في انتظار المباراة', W / 2, boxY + 74);
    }

    var s = stats();
    if (s.done > 0) {
      x.fillStyle = '#7a7a7a';
      x.font = '700 27px Tajawal, sans-serif';
      x.fillText('سجلّه: ' + s.points + ' نقطة · دقة ' + s.accuracy + '% من ' + s.done + ' مباراة',
                 W / 2, 862);
    }

    x.fillStyle = '#5a5a5a';
    x.font = '700 26px Tajawal, sans-serif';
    x.fillText('توقّع أنت أيضاً — ' + L, W / 2, 985);

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
