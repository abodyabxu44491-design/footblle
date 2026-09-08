/* ═══════════════════════════════════════════════════════════════════
 *  penalties-core.js — v337
 *  ركلات الترجيح: مصدر واحد · لوحة واحدة · نتيجة رسمية لا تُدهس
 *  ───────────────────────────────────────────────────────────────────
 *  ما كان مكسوراً:
 *
 *  ① **النتيجة الرسمية كانت تُمحى.** في طور ركلات الترجيح كانت بطاقة
 *     المباراة عند الجمهور تعرض نتيجة **الترجيح** بالخطّ الكبير، وتُنزل
 *     نتيجة المباراة (٢-٢) إلى سطر رمادي صغير. وهذا مقلوب: الترجيح
 *     ليس نتيجة مباراة — هو وسيلة حسم. المباراة انتهت بالتعادل، ولذلك
 *     لا يدخل الترجيح جدول الترتيب ولا جدول الهدّافين.
 *
 *  ② **مصادر متعدّدة للرقم نفسه.** نتيجة الترجيح كانت تُقرأ من ثلاثة
 *     أماكن مختلفة حسب الملف: `penaltyScoreHome` في البطاقات،
 *     و`liveData.penalties` في الجمهور، و`penalties` في الإدارة. فمباراة
 *     أُدخل ترجيحها من الإدخال السريع تظهر في مكان وتغيب عن آخر.
 *
 *  ③ **العدّ لا يعرف قانون اللعبة.** لا «أفضل خمس»، ولا موت مفاجئ،
 *     ولا كشف للحسم الرياضي: ٣-٠ بعد ثلاث ركلات لكلٍّ يعني انتهت —
 *     ومع ذلك كانت اللوحة تدعوك لمواصلة التسجيل. ولا شيء يمنع أن
 *     يُسجَّل لفريق سبع ركلات وللآخر ثلاث.
 *
 *  ④ **تكرار في البطاقات.** سطر الترجيح يُرسم تحت النتيجة، ويتكرّر في
 *     النصّ المرافق، وأحياناً بصياغتين مختلفتين («ركلات الترجيح» /
 *     «ركلات»)، وأحياناً بلا ذكر من فاز بها أصلاً.
 *
 *  الحلّ: قارئ واحد (`PK.read`) ومحرّك قانون واحد (`PK.state`) ولوحة
 *  واحدة (`PK.board`) يستعملها البثّ والإدخال السريع معاً، وصياغة
 *  واحدة (`PK.verdict`) تستعملها البطاقات وصفحة الجمهور.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GOLD = '#C9A02B', GOLD2 = '#F0C84A', PUR = '#9b59b6';
  var GREEN = '#2ecc71', RED = '#e5533d';

  function ready(fn, tries) {
    tries = tries || 0;
    if (window.matches !== undefined) return fn();
    if (tries > 400) return;
    setTimeout(function () { ready(fn, tries + 1); }, 60);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isGoal(r) {
    return (typeof r === 'string') ? (r === 'goal') : !!(r && r.result === 'goal');
  }
  function kickName(r) {
    return (typeof r === 'object' && r && r.player) ? String(r.player) : '';
  }

  /* ─────────────────────────────────────────────────────────────
     ① القارئ الواحد — كل من يريد نتيجة الترجيح يسألها من هنا
     ───────────────────────────────────────────────────────────── */
  function normKicks(p) {
    if (!p) return null;
    var h = Array.isArray(p.home) ? p.home : [];
    var a = Array.isArray(p.away) ? p.away : [];
    if (!h.length && !a.length) return null;
    return { home: h, away: a };
  }

  /* الترتيب مقصود: الركلات المفصّلة أَولى من الرقم المجمّع، لأنها تحمل
     التسلسل والأسماء. والرقم المجمّع يبقى شبكة أمان للبيانات القديمة. */
  function read(m) {
    var out = { exists: false, h: 0, a: 0, kicks: null, source: '' };
    if (!m) return out;

    var k = normKicks(m.penalties)
         || normKicks(m.liveData && m.liveData.penalties);

    /* آخر ملاذ: أحداث النوع penalty المحفوظة في سجلّ المباراة المنتهية */
    if (!k && Array.isArray(m.events)) {
      var evs = m.events.filter(function (e) { return e && e.type === 'penalty'; });
      if (evs.length) {
        k = { home: [], away: [] };
        evs.forEach(function (e) {
          var side = (e.team === 'away' || e.side === 'away') ? 'away' : 'home';
          k[side].push({ result: isGoal(e.result) || e.result === 'goal' ? 'goal' : 'miss',
                         player: e.player || '' });
        });
        if (!k.home.length && !k.away.length) k = null;
      }
    }

    if (k) {
      out.exists = true;
      out.kicks = k;
      out.h = k.home.filter(isGoal).length;
      out.a = k.away.filter(isGoal).length;
      out.source = 'kicks';
      return out;
    }
    if (m.penaltyScoreHome != null && m.penaltyScoreAway != null) {
      out.exists = true;
      out.h = m.penaltyScoreHome;
      out.a = m.penaltyScoreAway;
      out.source = 'score';
      return out;
    }
    return out;
  }

  /* ─────────────────────────────────────────────────────────────
     ② محرّك القانون — أفضل خمس ثم موت مفاجئ، مع كشف الحسم
     ───────────────────────────────────────────────────────────── */
  var BEST_OF = 5;

  function state(kicks, firstSide) {
    var H = (kicks && kicks.home) || [], A = (kicks && kicks.away) || [];
    var first = (firstSide === 'away') ? 'away' : 'home';
    var h = H.filter(isGoal).length, a = A.filter(isGoal).length;
    var ht = H.length, at = A.length;

    var s = {
      h: h, a: a, hTaken: ht, aTaken: at, first: first,
      phase: (ht > BEST_OF || at > BEST_OF) ? 'sudden' : 'best5',
      decided: false, winner: null, why: '',
      nextSide: null, nextNo: 0, total: ht + at
    };

    /* ── الحسم الرياضي داخل الخمس: فارق أكبر ممّا تبقّى للخصم ──
       ٣-٠ بعد ثلاث لكلٍّ = انتهت، ولا معنى لركلتين باقيتين. */
    if (s.phase === 'best5') {
      var hRem = Math.max(0, BEST_OF - ht), aRem = Math.max(0, BEST_OF - at);
      /* ترتيب الفحص مقصود: «اكتمل الخمس» يُفحص أولاً، وإلا وُصف الحسم
         بعد اكتمالهما بأنه «قبل اكتمال الخمس» — وهو وصف خاطئ للمنظّم. */
      if (ht >= BEST_OF && at >= BEST_OF) {
        if (h !== a) { s.decided = true; s.winner = h > a ? 'home' : 'away'; s.why = 'بعد الخمس ركلات'; }
        else s.phase = 'sudden';
      }
      else if (h > a + aRem) { s.decided = true; s.winner = 'home'; s.why = 'حُسمت قبل اكتمال الخمس'; }
      else if (a > h + hRem) { s.decided = true; s.winner = 'away'; s.why = 'حُسمت قبل اكتمال الخمس'; }
    }
    /* ── الموت المفاجئ: لا يُحسم إلا بعد أن يسدّد الفريقان بالعدد نفسه ── */
    if (!s.decided && s.phase === 'sudden' && ht === at && ht > 0 && h !== a) {
      s.decided = true; s.winner = h > a ? 'home' : 'away'; s.why = 'بالموت المفاجئ';
    }

    /* ── الدور على من؟ التناوب الصارم يمنع أن يُسجَّل لفريق سبع
          ركلات وللآخر ثلاث، وهو أكثر خطأ يقع فعلاً أثناء البثّ. ── */
    if (!s.decided) {
      var f = first, o = first === 'home' ? 'away' : 'home';
      var fT = f === 'home' ? ht : at, oT = o === 'home' ? ht : at;
      s.nextSide = (fT <= oT) ? f : o;
      s.nextNo = (s.nextSide === 'home' ? ht : at) + 1;
    }
    return s;
  }

  function verdict(m) {
    var p = read(m);
    var hs = m && m.homeScore, as = m && m.awayScore;
    var draw = (hs != null && as != null && hs === as);
    var out = {
      hasPens: p.exists, penH: p.h, penA: p.a,
      officialText: (hs == null ? '—' : hs) + ' - ' + (as == null ? '—' : as),
      decidedByPens: false, winnerSide: null, winnerName: '', text: '', short: ''
    };
    if (!p.exists || !draw || p.h === p.a) return out;
    out.decidedByPens = true;
    out.winnerSide = p.h > p.a ? 'home' : 'away';
    out.winnerName = out.winnerSide === 'home'
      ? (teamName(m.homeId) || m.homeName || '')
      : (teamName(m.awayId) || m.awayName || '');
    /* صياغة واحدة في كل مكان — لا «ركلات» هنا و«ركلات الترجيح» هناك */
    out.short = 'ركلات الترجيح ' + p.h + ' - ' + p.a;
    out.text = out.winnerName + ' فاز بركلات الترجيح ' + p.h + ' - ' + p.a;
    return out;
  }

  function teamName(id) {
    var t = (window.teams || []).filter(function (x) { return x.id === id; })[0];
    return (t && t.name) || '';
  }
  function M(id) { return (window.matches || []).filter(function (x) { return x.id === id; })[0] || null; }

  window.PK = { read: read, state: state, verdict: verdict, isGoal: isGoal, BEST_OF: BEST_OF };

  /* ─────────────────────────────────────────────────────────────
     ②ب إصلاح المباريات التي دُهست نتيجتها قبل هذا الإصدار
     ─────────────────────────────────────────────────────────────
     الحفظ القديم كان يكتب نتيجة الترجيح في homeScore/awayScore. فمباراة
     2-2 حُسمت 4-3 صارت محفوظة 4-3، والنتيجة الحقيقية ضاعت من الحقل.

     الكشف: ركلات ترجيح موجودة **والنتيجة ليست تعادلاً**. وهذا مستحيل
     قانونياً — لا تُضرب ركلات ترجيح إلا بعد تعادل.

     الاستعادة: من سجلّ الأحداث. الأهداف محفوظة حدثاً حدثاً، فيُعاد
     بناء النتيجة الأصلية منها بلا تخمين. */
  function officialFromEvents(m) {
    var evs = (m && Array.isArray(m.events)) ? m.events : [];
    if (!evs.length) return null;
    var count = function (side) {
      return evs.filter(function (e) {
        if (!e) return false;
        if (e.type !== 'goal' && e.type !== 'own') return false;   // الملغى مستثنى تلقائياً
        if (e.isShootout || e.shootout) return false;
        var sd = (e.team === 'away' || e.side === 'away') ? 'away' : 'home';
        return sd === side;
      }).length;
    };
    return { h: count('home'), a: count('away') };
  }

  function scanCorrupt() {
    return (window.matches || []).filter(function (m) {
      if (!m || m.status !== 'finished') return false;
      var p = read(m);
      if (!p.exists) return false;
      if (m.homeScore == null || m.awayScore == null) return false;
      return m.homeScore !== m.awayScore;      // ترجيح بلا تعادل = مدهوسة
    }).map(function (m) {
      var fix = officialFromEvents(m);
      return { m: m, was: m.homeScore + '-' + m.awayScore, fix: fix, pens: read(m) };
    });
  }

  async function repairAll() {
    var list = scanCorrupt().filter(function (x) { return x.fix; });
    if (!list.length) return 0;
    var lid = window._getLeagueId ? window._getLeagueId() : '';
    if (!lid || !window._firestoreWriteBatch) return 0;
    var batch = window._firestoreWriteBatch(window._db);
    list.forEach(function (x) {
      batch.update(window._firestoreDoc(window._db, 'leagues', lid, 'matches', x.m.id),
        { homeScore: x.fix.h, awayScore: x.fix.a });
      x.m.homeScore = x.fix.h;
      x.m.awayScore = x.fix.a;
    });
    await batch.commit();
    return list.length;
  }
  window.PK.scanCorrupt = scanCorrupt;
  window.PK.repairAll = repairAll;
  window.PK.officialFromEvents = officialFromEvents;

  /* ─────────────────────────────────────────────────────────────
     ③ CSS
     ───────────────────────────────────────────────────────────── */
  function css() {
    if (document.getElementById('pk-css')) return;
    var s = document.createElement('style');
    s.id = 'pk-css';
    s.textContent = [
      '.pk{font-family:Tajawal,sans-serif;direction:rtl}',
      '.pk-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}',
      '.pk-hd b{font-size:13px;font-weight:900;color:' + PUR + '}',
      '.pk-undo{padding:6px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#9aa0aa;font-size:10.5px;font-weight:800;cursor:pointer;font-family:Tajawal,sans-serif}',
      '.pk-undo:disabled{opacity:.35;cursor:default}',
      '.pk-sc{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:4px}',
      '.pk-sc-t{font-size:11px;color:#8a8a8a;font-weight:700;max-width:30vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pk-sc-n{font-size:30px;font-weight:900;line-height:1;color:' + PUR + '}',
      '.pk-sc-n.win{color:' + GOLD2 + '}',
      '.pk-sep{font-size:16px;color:#5a5a5a}',
      '.pk-official{text-align:center;font-size:10.5px;color:#7a7a7a;font-weight:700;margin-bottom:12px}',
      '.pk-official b{color:#c9ccd2}',
      '.pk-phase{text-align:center;font-size:10px;font-weight:900;letter-spacing:.4px;margin-bottom:11px}',
      '.pk-phase.best5{color:' + PUR + '}.pk-phase.sudden{color:#e67e22}',
      '.pk-grid{margin-bottom:12px}',
      '.pk-line{display:flex;align-items:center;gap:8px;padding:5px 0}',
      '.pk-line-t{flex:0 0 66px;font-size:10.5px;font-weight:800;color:#9aa0aa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pk-line.turn .pk-line-t{color:' + GOLD2 + '}',
      '.pk-kicks{flex:1;display:flex;gap:4px;flex-wrap:wrap}',
      '.pk-k{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;border:2px solid;background:rgba(0,0,0,.2)}',
      '.pk-k.in{border-color:' + GREEN + ';color:' + GREEN + '}',
      '.pk-k.out{border-color:' + RED + ';color:' + RED + '}',
      '.pk-k.pend{border-color:rgba(255,255,255,.1);color:transparent;border-style:dashed}',
      '.pk-k.next{border-color:' + GOLD + ';color:' + GOLD + ';animation:pkPulse 1.4s ease-in-out infinite}',
      '@keyframes pkPulse{0%,100%{opacity:1}50%{opacity:.4}}',
      '.pk-turn{text-align:center;font-size:11.5px;font-weight:900;color:#e6e8ec;margin-bottom:9px}',
      '.pk-turn span{color:' + GOLD2 + '}',
      '.pk-btns{display:grid;grid-template-columns:1fr 1fr;gap:9px}',
      '.pk-b{padding:13px 6px;border-radius:11px;border:1px solid;font-size:13px;font-weight:900;cursor:pointer;font-family:Tajawal,sans-serif}',
      '.pk-b-in{border-color:rgba(46,204,113,.4);background:rgba(46,204,113,.13);color:' + GREEN + '}',
      '.pk-b-out{border-color:rgba(229,83,61,.4);background:rgba(229,83,61,.11);color:' + RED + '}',
      '.pk-b:active{transform:scale(.97)}',
      '.pk-done{text-align:center;padding:14px 12px;border-radius:13px;background:rgba(201,160,43,.09);border:1px solid rgba(201,160,43,.28)}',
      '.pk-done .pk-tr{font-size:23px;margin-bottom:4px}',
      '.pk-done .pk-w{font-size:14.5px;font-weight:900;color:' + GOLD2 + '}',
      '.pk-done .pk-why{font-size:10.5px;color:#818794;margin-top:3px}',
      '.pk-first{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:11px;font-size:10px;color:#6a7080}',
      '.pk-first button{padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#8a8a8a;font-size:10px;font-weight:800;cursor:pointer;font-family:Tajawal,sans-serif}',
      '.pk-first button.on{border-color:' + PUR + ';background:rgba(155,89,182,.14);color:#c39bd3}',
      '.pk-empty{text-align:center;padding:16px;font-size:11px;color:#6a7080;line-height:1.9}',
      /* شارة الحسم — تُستعمل في الجمهور والإدارة بصياغة واحدة */
      '.pk-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:10.5px;font-weight:900;background:rgba(201,160,43,.12);border:1px solid rgba(201,160,43,.3);color:' + GOLD2 + '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ─────────────────────────────────────────────────────────────
     ④ اللوحة — واحدة تخدم البثّ والإدخال السريع
     ───────────────────────────────────────────────────────────── */
  function getKicks(host, matchId) {
    if (host === 'live') {
      var st = window._liveMatches && window._liveMatches[matchId];
      if (!st) return { home: [], away: [] };
      if (!st.penalties) st.penalties = { home: [], away: [] };
      if (!Array.isArray(st.penalties.home)) st.penalties.home = [];
      if (!Array.isArray(st.penalties.away)) st.penalties.away = [];
      return st.penalties;
    }
    var m = M(matchId);
    if (!m) return { home: [], away: [] };
    if (!m.penalties) m.penalties = { home: [], away: [] };
    if (!Array.isArray(m.penalties.home)) m.penalties.home = [];
    if (!Array.isArray(m.penalties.away)) m.penalties.away = [];
    return m.penalties;
  }
  function getFirst(host, matchId) {
    var o = (host === 'live')
      ? (window._liveMatches && window._liveMatches[matchId])
      : M(matchId);
    return (o && o.penaltiesFirst === 'away') ? 'away' : 'home';
  }
  function setFirst(host, matchId, side) {
    var o = (host === 'live')
      ? (window._liveMatches && window._liveMatches[matchId])
      : M(matchId);
    if (o) o.penaltiesFirst = side;
  }
  function officialOf(host, matchId) {
    var m = M(matchId);
    if (host === 'live') {
      var st = window._liveMatches && window._liveMatches[matchId];
      if (st) return { h: st.homeScore || 0, a: st.awayScore || 0 };
    }
    return { h: (m && m.homeScore) || 0, a: (m && m.awayScore) || 0 };
  }

  /* التزامن: الرقم المجمّع يتبع الركلات دائماً — فلا يتناقض المصدران */
  function sync(host, matchId) {
    var k = getKicks(host, matchId);
    var h = k.home.filter(isGoal).length, a = k.away.filter(isGoal).length;
    var live = (host === 'live') ? (window._liveMatches && window._liveMatches[matchId]) : null;
    if (live) { live.penHomeScore = h; live.penAwayScore = a; }
    var m = M(matchId);
    if (m) {
      m.penalties = k;
      m.penaltyScoreHome = h;
      m.penaltyScoreAway = a;
    }
  }
  function repaint(host, matchId) {
    if (host === 'live') {
      var box = document.getElementById('lp-pen-section-' + matchId);
      if (box) box.innerHTML = board('live', matchId);
      if (window._lpUpdateScoreUI) { try { window._lpUpdateScoreUI(matchId); } catch (e) {} }
    } else {
      var l = document.getElementById('qr-pen-list-' + matchId);
      if (l) l.innerHTML = board('qr', matchId);
      var sh = document.getElementById('qr-pen-sc-home-' + matchId);
      var sa = document.getElementById('qr-pen-sc-away-' + matchId);
      var k = getKicks('qr', matchId);
      if (sh) sh.textContent = k.home.filter(isGoal).length;
      if (sa) sa.textContent = k.away.filter(isGoal).length;
    }
  }
  async function persist(host, matchId) {
    if (host !== 'live') return;
    try { if (window._lpSaveV2) await window._lpSaveV2(matchId); } catch (e) {}
  }

  function board(host, matchId) {
    css();
    var m = M(matchId) || {};
    var k = getKicks(host, matchId);
    var first = getFirst(host, matchId);
    var s = state(k, first);
    var off = officialOf(host, matchId);
    var hn = teamName(m.homeId) || m.homeName || 'المضيف';
    var an = teamName(m.awayId) || m.awayName || 'الضيف';

    /* صفّ الركلات: المسجَّلة، ثم الركلة القادمة مميّزة، ثم خانات فارغة
       حتى الخمس — فيُرى كم بقي بلا حساب ذهني. */
    function lineHtml(side, name) {
      var arr = k[side] || [];
      var cells = arr.map(function (r, i) {
        var g = isGoal(r), nm = kickName(r);
        return '<span class="pk-k ' + (g ? 'in' : 'out') + '" title="' +
          esc((nm ? nm + ' — ' : '') + 'الركلة ' + (i + 1)) + '">' + (g ? '✓' : '✗') + '</span>';
      });
      var isNext = (!s.decided && s.nextSide === side);
      if (isNext) cells.push('<span class="pk-k next" title="الركلة القادمة">' + (arr.length + 1) + '</span>');
      var pad = Math.max(0, BEST_OF - cells.length);
      for (var i = 0; i < pad; i++) cells.push('<span class="pk-k pend">·</span>');
      return '<div class="pk-line' + (isNext ? ' turn' : '') + '">' +
        '<span class="pk-line-t">' + esc(name) + '</span>' +
        '<span class="pk-kicks">' + cells.join('') + '</span></div>';
    }

    var hWin = s.decided && s.winner === 'home';
    var aWin = s.decided && s.winner === 'away';

    var head =
      '<div class="pk-hd"><b>🥅 ركلات الترجيح</b>' +
        '<button class="pk-undo" onclick="pkUndo(\'' + host + '\',\'' + matchId + '\')"' +
          (s.total ? '' : ' disabled') + '>↩ تراجع عن آخر ركلة</button></div>' +
      '<div class="pk-sc">' +
        '<span class="pk-sc-t">' + esc(hn) + '</span>' +
        '<span class="pk-sc-n' + (hWin ? ' win' : '') + '">' + s.h + '</span>' +
        '<span class="pk-sep">—</span>' +
        '<span class="pk-sc-n' + (aWin ? ' win' : '') + '">' + s.a + '</span>' +
        '<span class="pk-sc-t">' + esc(an) + '</span>' +
      '</div>' +
      /* النتيجة الرسمية حاضرة دائماً فوق اللوحة: الترجيح وسيلة حسم
         لا نتيجة، ولا يجوز أن تختفي المباراة من الشاشة. */
      '<div class="pk-official">نتيجة المباراة <b>' + off.h + ' - ' + off.a + '</b> · الترجيح لتحديد المتأهّل فقط</div>' +
      '<div class="pk-phase ' + s.phase + '">' +
        (s.phase === 'sudden' ? '⚡ الموت المفاجئ — ركلة بركلة' : '● أفضل خمس ركلات') +
      '</div>';

    var grid = '<div class="pk-grid">' + lineHtml('home', hn) + lineHtml('away', an) + '</div>';

    var foot;
    if (s.decided) {
      foot = '<div class="pk-done">' +
        '<div class="pk-tr">🏆</div>' +
        '<div class="pk-w">' + esc(s.winner === 'home' ? hn : an) + ' يتأهّل</div>' +
        '<div class="pk-why">' + esc(s.why) + ' · ' + s.h + ' - ' + s.a + '</div>' +
        '</div>';
    } else {
      var nSide = s.nextSide, nName = nSide === 'home' ? hn : an;
      foot =
        '<div class="pk-turn">الدور على <span>' + esc(nName) + '</span> — الركلة ' + s.nextNo + '</div>' +
        '<div class="pk-btns">' +
          '<button class="pk-b pk-b-in" onclick="pkShot(\'' + host + '\',\'' + matchId + '\',\'' + nSide + '\',\'goal\')">✓ سجّل</button>' +
          '<button class="pk-b pk-b-out" onclick="pkShot(\'' + host + '\',\'' + matchId + '\',\'' + nSide + '\',\'miss\')">✗ ضيّع</button>' +
        '</div>';
    }

    /* من بدأ؟ يُضبط مرة، ويُقفل بعد أول ركلة كي لا ينقلب التسلسل */
    var firstRow = '<div class="pk-first"><span>بدأ:</span>' +
      ['home', 'away'].map(function (sd) {
        return '<button class="' + (first === sd ? 'on' : '') + '"' +
          (s.total ? ' disabled style="opacity:.5;cursor:default"' : '') +
          ' onclick="pkSetFirst(\'' + host + '\',\'' + matchId + '\',\'' + sd + '\')">' +
          esc(sd === 'home' ? hn : an) + '</button>';
      }).join('') + '</div>';

    return '<div class="pk">' + head + grid + foot + firstRow + '</div>';
  }

  window.pkShot = async function (host, matchId, side, result) {
    var k = getKicks(host, matchId);
    var s = state(k, getFirst(host, matchId));
    if (s.decided) {
      window.showToast && window.showToast('انتهت ركلات الترجيح — استعمل «تراجع» للتصحيح', 'error');
      return;
    }
    if (side !== s.nextSide) side = s.nextSide;   // التناوب لا يُكسر
    k[side].push({ result: result === 'goal' ? 'goal' : 'miss', player: '' });
    sync(host, matchId);
    repaint(host, matchId);
    await persist(host, matchId);

    var s2 = state(k, getFirst(host, matchId));
    if (s2.decided && window.showToast) {
      var m = M(matchId) || {};
      var wn = s2.winner === 'home' ? (teamName(m.homeId) || m.homeName) : (teamName(m.awayId) || m.awayName);
      window.showToast('🏆 ' + wn + ' يتأهّل بركلات الترجيح ' + s2.h + ' - ' + s2.a, 'success');
    }
  };

  window.pkUndo = async function (host, matchId) {
    var k = getKicks(host, matchId);
    var first = getFirst(host, matchId);
    /* التراجع يُزيل **آخر ركلة زمنياً** لا آخر ركلة للفريق الأطول قائمة:
       الأولى تعيد الحالة كما كانت، والثانية تخلط التسلسل. */
    var f = first, o = first === 'home' ? 'away' : 'home';
    var fT = k[f].length, oT = k[o].length;
    var target = (fT > oT) ? f : o;
    if (!k[target].length) target = (target === f) ? o : f;
    if (!k[target].length) return;
    k[target].pop();
    sync(host, matchId);
    repaint(host, matchId);
    await persist(host, matchId);
  };

  window.pkSetFirst = async function (host, matchId, side) {
    var k = getKicks(host, matchId);
    if (k.home.length || k.away.length) return;
    setFirst(host, matchId, side);
    repaint(host, matchId);
    await persist(host, matchId);
  };

  /* ─────────────────────────────────────────────────────────────
     ⑤ ربط اللوحة بالمكانين
     ───────────────────────────────────────────────────────────── */
  ready(function () {
    /* أ) صفحة البثّ — نستبدل محتوى القسم كاملاً باللوحة الجديدة */
    var origDots = window._lpRenderPenDots;
    window._lpRenderPenDots = function (matchId) {
      var box = document.getElementById('lp-pen-section-' + matchId);
      if (!box) { if (typeof origDots === 'function') return origDots(matchId); return; }
      box.innerHTML = board('live', matchId);
    };
    /* الأزرار القديمة (lpPenScore / lpPenUndo) قد تُستدعى من مسارات
       أخرى — نوجّهها للوحة الجديدة بدل تركها تكتب بقواعد مختلفة. */
    window.lpPenScore = function (matchId, side, result) { return window.pkShot('live', matchId, side, result); };
    window.lpPenUndo = function (matchId) { return window.pkUndo('live', matchId); };

    /* ب) الإدخال السريع */
    window._qrPenListHtml = function (m) { return m ? board('qr', m.id) : ''; };
    window.qrPenShot = function (matchId, side, result) { return window.pkShot('qr', matchId, side, result); };
    window.qrPenUndo = function (matchId) { return window.pkUndo('qr', matchId); };

    /* ج) عند فتح صفحة البثّ ارسم اللوحة فوراً */
    var origOpen = window.openLivePage;
    if (typeof origOpen === 'function') {
      window.openLivePage = function (matchId) {
        var r = origOpen.apply(this, arguments);
        setTimeout(function () {
          try {
            var box = document.getElementById('lp-pen-section-' + matchId);
            if (box) box.innerHTML = board('live', matchId);
          } catch (e) {}
        }, 150);
        return r;
      };
    }

    /* د) شريط إصلاح النتائج المدهوسة — يظهر فقط إن وُجدت */
    function repairBanner() {
      var host = document.getElementById('page-matches');
      if (!host) return;
      var old = document.getElementById('pk-repair');
      var list = scanCorrupt();
      if (!list.length) { if (old) old.remove(); return; }
      var fixable = list.filter(function (x) { return x.fix; }).length;
      if (old) old.remove();
      css();
      var d = document.createElement('div');
      d.id = 'pk-repair';
      d.style.cssText = 'margin:0 0 14px;padding:13px 15px;border-radius:14px;' +
        'background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.3);font-family:Tajawal,sans-serif';
      d.innerHTML =
        '<div style="font-size:12.5px;font-weight:900;color:#e07070;margin-bottom:4px">' +
          '⚠️ ' + list.length + ' مباراة نتيجتها الرسمية مدهوسة بنتيجة الترجيح</div>' +
        '<div style="font-size:11px;color:#9aa0aa;line-height:1.85;margin-bottom:9px">' +
          'إصدار سابق كان يحفظ نتيجة الترجيح مكان نتيجة المباراة، فظهر الرقم نفسه مرتين في البطاقات ' +
          'واختفى التعادل. الأهداف محفوظة في سجلّ الأحداث، فتُستعاد النتيجة الأصلية منها.' +
          (fixable < list.length
            ? '<br><b style="color:#D9A21B">' + (list.length - fixable) + ' منها بلا أحداث محفوظة — تحتاج تصحيحاً يدوياً.</b>'
            : '') +
        '</div>' +
        (fixable ? '<button id="pk-repair-btn" style="padding:10px 18px;border-radius:11px;border:none;' +
          'background:linear-gradient(145deg,#F0C84A,#C9A02B);color:#1a1200;font-family:Tajawal,sans-serif;' +
          'font-size:12.5px;font-weight:900;cursor:pointer">↺ استعادة نتائج ' + fixable + ' مباراة</button>' : '');
      host.insertBefore(d, host.firstChild);
      var btn = document.getElementById('pk-repair-btn');
      if (btn) btn.onclick = async function () {
        var preview = scanCorrupt().filter(function (x) { return x.fix; })
          .slice(0, 6).map(function (x) {
            return '• ' + (teamName(x.m.homeId) || '؟') + ' × ' + (teamName(x.m.awayId) || '؟') +
                   ': ' + x.was + ' ← ' + x.fix.h + '-' + x.fix.a;
          }).join('\n');
        var ok = window.confirmDialog
          ? await window.confirmDialog({
              title: '↺ استعادة النتائج الرسمية',
              message: 'ستُعاد النتيجة من سجلّ أهداف كل مباراة:\n\n' + preview +
                       '\n\nنتيجة الترجيح تبقى محفوظة كما هي — تنتقل إلى مكانها الصحيح فقط.',
              confirmText: 'استعادة' })
          : confirm('استعادة النتائج؟');
        if (!ok) return;
        btn.disabled = true; btn.textContent = 'جارٍ الاستعادة…';
        try {
          var n = await repairAll();
          window.showToast && window.showToast('✅ استُعيدت نتيجة ' + n + ' مباراة', 'success');
          if (window.recalcStandings) { try { await window.recalcStandings(); } catch (e) {} }
          if (window.renderMatches) window.renderMatches();
          repairBanner();
        } catch (e) {
          window.showToast && window.showToast('تعذّرت الاستعادة', 'error');
          btn.disabled = false;
        }
      };
    }
    var origShowPk = window.showPage;
    if (typeof origShowPk === 'function') {
      window.showPage = function (name) {
        var r = origShowPk.apply(this, arguments);
        if (name === 'matches') setTimeout(repairBanner, 200);
        return r;
      };
    }
    setTimeout(repairBanner, 2500);
  });

  /* ─────────────────────────────────────────────────────────────
     ⑥ صفحة الجمهور — أيقونة الكرة وتحتها ✓ أو ✗
        الخطّ الزمني كان يعرض دائرة فيها ✓/✗ فقط، فلا يُعرف أنها ركلة.
        نجعلها كرة ومعها شارة صغيرة، كما في تطبيقات المباريات الكبرى.
     ───────────────────────────────────────────────────────────── */
  function viewerCss() {
    if (document.getElementById('pk-vt-css')) return;
    var s = document.createElement('style');
    s.id = 'pk-vt-css';
    s.textContent = [
      /* الكرة نفسها التي تُرسم للهدف: نفس المقاس ونفس اللون الذهبي —
         فلا تبدو ركلة الترجيح من عائلة أيقونات أخرى. */
      '.vt-dot-pen{width:26px;height:26px;margin-top:-13px;position:relative;overflow:visible;',
      '  display:flex;align-items:center;justify-content:center;background:transparent;border:none;',
      '  box-shadow:none;color:var(--gold,#C9A02B)}',
      '.vt-dot-pen.vt-pen-no{opacity:.72}',
      '.vt-pen-mark{position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);',
      '  width:13px;height:13px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
      '  border:1.5px solid var(--bg,#0d0f13);color:#fff;font-size:8px;font-weight:900;line-height:1}',
      '.vt-pen-ok .vt-pen-mark{background:#2ecc71}',
      '.vt-pen-no .vt-pen-mark{background:#e5533d}',
      '.vt-pen-mark svg{width:8px;height:8px;stroke:#fff;fill:none}',
      /* توافق مع أي نسخة ما زالت ترسم الأصناف القديمة */
      '.vt-dot-penin{border-color:#2ecc71;color:#2ecc71}',
      '.vt-dot-penout{border-color:#e5533d;color:#e5533d}'
    ].join('\n');
    document.head.appendChild(s);
  }
  window.PK.viewerCss = viewerCss;
  if (document.getElementById('matchDetailOverlay') ||
      document.querySelector('link[href*="viewer.css"]')) {
    viewerCss();
  } else {
    setTimeout(function () {
      if (document.getElementById('matchDetailOverlay')) viewerCss();
    }, 1200);
  }

  console.log('[penalties-core] v337 — ركلات الترجيح: مصدر ولوحة وصياغة واحدة ✅');
})();
