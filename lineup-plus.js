/* ═══════════════════════════════════════════════════════════════════
 *  lineup-plus.js — v338.2  (إعادة تصميم كاملة)
 *  تطوير نظام التشكيلات القائم في admin-lineup-dragdrop.js
 *  ───────────────────────────────────────────────────────────────────
 *  ما يبقى كما هو (لا نلمسه): الملعب، السحب والإفلات، الخطط، الدكة،
 *  والحفظ إلى matches/{id}.homeLineup / awayLineup.
 *
 *  ما يضيفه هذا الملف:
 *    ① لوحة كشف كاملة — مجمَّعة حسب المركز، ببحث فوري ومرشّحات وعدّاد تقدّم.
 *    ② اختصارات: ملء تلقائي · نسخ آخر تشكيلة · تفريغ.
 *    ③ تشكيلة متوقّعة تُنشر للجمهور بوسم، ثم تصير مؤكَّدة.
 *
 *  🔴 إصلاح v338.2 — «نسخ آخر تشكيلة» لم يكن يعمل إطلاقاً:
 *     كانت النسخة السابقة تستنتج المباراة بمطابقة عنوان النافذة مع
 *     m.homeName / m.awayName — **وهذان الحقلان غير موجودين** في مستند
 *     المباراة أصلاً. الأسماء تأتي من teams.find(id) وقت الرسم فقط.
 *     فكان البحث يفشل دائماً وتظهر «تعذّر تحديد الفريق».
 *     الآن: نغلّف window.openLineupDragDrop(matchId) ونلتقط المعرّف من
 *     مصدره مباشرة — لا تخمين ولا مطابقة نصوص.
 *     وأُضيف كذلك ضبط الخطة قبل النسخ، وإلا اختلف عدد الخانات عن عدد
 *     اللاعبين المنسوخين فسقط بعضهم بصمت.
 *
 *  ⚠️ قاعدة التصميم: admin-lineup-dragdrop.js يُحمَّل كـ type="module"،
 *     فمتغيّراته الداخلية غير مرئية لنا. نعمل حصراً عبر الواجهة العامة
 *     (openLineupDragDrop · _ddPickRosterPlayer · ddUpdatePlayer ·
 *     ddAddSub · ddChangeFormation · ddSaveToFirebase) وعبر ما يرسمه
 *     في الـ DOM. فلو حُذف هذا الملف عاد النظام الأصلي كما كان بالضبط.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GOLD = 'var(--gold,#C9A02B)', GOLD2 = 'var(--gold2,#E8BE45)';

  var _matchId = null;      // المباراة المفتوحة — يُلتقط من الغلاف
  var _predicted = false;
  var _query = '';
  var _posFilter = '';
  var _painting = false;   // حارس ضد إعادة الرسم المتداخلة
  var _captain  = { home: '', away: '' };   // اسم الكابتن لكل جهة

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(t, k) {
    if (typeof window.showToast === 'function') window.showToast(t, k || 'success');
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* ─── التقاط المباراة من مصدرها (بدل تخمينها من العنوان) ─── */
  function hookOpener() {
    var orig = window.openLineupDragDrop;
    if (typeof orig !== 'function' || orig.__lpHooked) return;
    var wrapped = function (matchId) {
      _matchId = matchId || null;
      _predicted = false;
      _query = ''; _posFilter = '';
      /* استرجع الكابتن والوسم المحفوظَين فلا يضيعان عند إعادة الفتح */
      var mm = (window.matches || []).filter(function (x) { return x && x.id === matchId; })[0];
      _captain = {
        home: (mm && mm.homeLineup && mm.homeLineup.captain) || '',
        away: (mm && mm.awayLineup && mm.awayLineup.captain) || ''
      };
      _predicted = !!(mm && ((mm.homeLineup && mm.homeLineup.predicted) ||
                             (mm.awayLineup && mm.awayLineup.predicted)));
      return orig.apply(this, arguments);
    };
    wrapped.__lpHooked = true;
    window.openLineupDragDrop = wrapped;
    window.openLineupModal = wrapped;   // الاسم المرادف في النظام الأصلي
  }

  function theMatch() {
    if (!_matchId) return null;
    return (window.matches || []).filter(function (m) { return m && m.id === _matchId; })[0] || null;
  }
  function currentSide() {
    var t = $('ddTabAway');
    return (t && t.classList.contains('active')) ? 'away' : 'home';
  }
  function currentTeamId() {
    var m = theMatch();
    if (!m) return null;
    return currentSide() === 'home' ? m.homeId : m.awayId;
  }

  /* ─── قراءة الكشف من القائمة التي يرسمها النظام الأصلي ───
     لا نعيد جلبه من Firestore: ذلك طلب مكرّر وقد يختلف عمّا يعرضه النظام. */
  function readRoster() {
    var sel = document.querySelector('#ddPlayersList .dd-roster-select');
    if (!sel) return [];
    var out = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (!o.value) return;
      var label = o.textContent || '', num = '', name = label, pos = '';
      var mNum = label.match(/^#(\d+)\s*—\s*/);
      if (mNum) { num = mNum[1]; name = label.slice(mNum[0].length); }
      var mPos = name.match(/\s·\s([^·]+)$/);
      if (mPos) { pos = mPos[1].trim(); name = name.slice(0, mPos.index); }
      out.push({ id: o.value, name: name.trim(), number: num, position: pos });
    });
    return out;
  }

  /* تصنيف المركز — يعتمد على النصّ العربي كما يعرضه النظام الأصلي */
  /* 🔴 كان يفحص نصّاً عربياً فقط، بينما النظام يخزّن **رموزاً**
     (GK, CB, ST…) — انظر قائمة المراكز في admin-lineup-dragdrop.js.
     فكان كل اللاعبين يسقطون في «بلا مركز»، وتصنيف اللوحة بلا معنى،
     واقتراح الخطة يرى صفر دفاع وصفر هجوم دائماً. (v338.4) */
  function groupOf(pos) {
    var p = String(pos || '').trim().toUpperCase();
    if (/^(GK)$/.test(p)) return 'GK';
    if (/^(CB|LB|RB|LWB|RWB|SW)$/.test(p)) return 'DF';
    if (/^(DM|CM|CAM|LM|RM|AM)$/.test(p)) return 'MF';
    if (/^(LW|RW|ST|CF|SS)$/.test(p)) return 'FW';
    // احتياط للنصّ العربي إن أُدخل يدوياً
    var a = String(pos || '');
    if (/حارس/.test(a)) return 'GK';
    if (/ظهير|قلب دفاع|مدافع|دفاع/.test(a)) return 'DF';
    if (/وسط|صانع/.test(a)) return 'MF';
    if (/مهاجم|رأس حربة|هداف|جناح/.test(a)) return 'FW';
    return 'OT';
  }

  /* اسم عربي مقروء للرمز — «CB» وحدها لا تعني شيئاً لأغلب المنظّمين */
  var POS_AR = {
    GK:'حارس', CB:'قلب دفاع', LB:'ظهير أيسر', RB:'ظهير أيمن',
    LWB:'ظهير جناح أيسر', RWB:'ظهير جناح أيمن', SW:'ليبرو',
    DM:'وسط مدافع', CM:'وسط', CAM:'صانع ألعاب', AM:'وسط مهاجم',
    LM:'وسط أيسر', RM:'وسط أيمن', LW:'جناح أيسر', RW:'جناح أيمن',
    ST:'مهاجم', CF:'رأس حربة', SS:'مهاجم ثانٍ'
  };
  function posLabel(p) {
    var k = String(p || '').trim().toUpperCase();
    return POS_AR[k] || String(p || '');
  }
  var GROUPS = [
    { k: 'GK', t: 'حرّاس المرمى' }, { k: 'DF', t: 'الدفاع' },
    { k: 'MF', t: 'الوسط' },       { k: 'FW', t: 'الهجوم' },
    { k: 'OT', t: 'بلا مركز' }
  ];

  function rows() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#ddPlayersList .dd-player-row'));
  }
  function rowName(r) {
    var i = r.querySelector('.dd-p-name input[type="text"]');
    return i ? (i.value || '').trim() : '';
  }
  function rowIdx(r) {
    var d = r.getAttribute('data-idx');
    return (d && d.indexOf('sub-') === 0) ? d : parseInt(d, 10);
  }
  function isSub(r) {
    return (r.getAttribute('data-idx') || '').indexOf('sub-') === 0;
  }
  function usedSet() {
    var s = {};
    rows().forEach(function (r) { var n = rowName(r); if (n) s[norm(n)] = true; });
    return s;
  }

  /* ─────────────────────────────────────────────────────────────
     اللوحة
     ───────────────────────────────────────────────────────────── */
  function render() {
    var host = $('ddPlayersList');
    if (!host) return;

    var panel = $('lpPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'lpPanel';
      host.parentNode.insertBefore(panel, host);
    }

    var roster = readRoster();
    /* حمّل الصور مرة واحدة ثم أعد الرسم — الرسم الأول بلا صور فوراً
       (لا انتظار)، والثاني بالصور حين تصل. */
    loadRosterDetails(currentTeamId(), function () {
      if ($('lpPanel') && !_painting) { _painting = true; try { render(); } finally { _painting = false; } }
    });
    if (!roster.length) {
      panel.innerHTML =
        '<div class="lp-w"><div class="lp-empty">لا يوجد كشف لاعبين لهذا الفريق.<br>' +
        'أضفه من «الفرق ← كشف اللاعبين» ليظهر هنا كاملاً.</div></div>';
      return;
    }

    var used = usedSet();
    var starters = rows().filter(function (r) { return !isSub(r); });
    var filled = starters.filter(function (r) { return !!rowName(r); }).length;
    var total = starters.length;
    var inCount = roster.filter(function (p) { return used[norm(p.name)]; }).length;

    var vis = roster.filter(function (p) {
      if (_posFilter && groupOf(p.position) !== _posFilter) return false;
      if (!_query) return true;
      return norm(p.name).indexOf(_query) > -1 ||
             String(p.number) === _query ||
             norm(p.position).indexOf(_query) > -1;
    });

    var byG = {};
    vis.forEach(function (p) { (byG[groupOf(p.position)] = byG[groupOf(p.position)] || []).push(p); });

    var body = GROUPS.map(function (g) {
      var list = byG[g.k];
      if (!list || !list.length) return '';
      return '<div class="lp-g">' +
        '<div class="lp-gt">' + g.t + ' <span>' + list.length + '</span></div>' +
        '<div class="lp-chips">' + list.map(function (p) { return chip(used, p); }).join('') + '</div>' +
      '</div>';
    }).join('');
    if (!body) body = '<div class="lp-empty">لا لاعب يطابق البحث.</div>';

    var counts = {};
    roster.forEach(function (p) {
      var g = groupOf(p.position); counts[g] = (counts[g] || 0) + 1;
    });
    var filters = '<button type="button" class="lp-f' + (_posFilter ? '' : ' on') +
      '" data-f="">الكل <span>' + roster.length + '</span></button>' +
      GROUPS.filter(function (g) { return counts[g.k]; }).map(function (g) {
        return '<button type="button" class="lp-f' + (_posFilter === g.k ? ' on' : '') +
          '" data-f="' + g.k + '">' + g.t + ' <span>' + counts[g.k] + '</span></button>';
      }).join('');

    panel.innerHTML =
      '<div class="lp-w">' +
        '<div class="lp-head">' +
          '<div class="lp-ttl">كشف الفريق</div>' +
          '<div class="lp-prog">' +
            '<span class="lp-pn' + (filled >= total ? ' ok' : '') + '">' + filled + '</span>' +
            '<span class="lp-ps">/ ' + total + ' أساسي</span>' +
          '</div>' +
        '</div>' +
        '<div class="lp-bar"><div class="lp-fill" style="width:' +
          (total ? Math.min(100, Math.round(filled / total * 100)) : 0) + '%"></div></div>' +
        '<input type="text" class="lp-search" id="lpQ" placeholder="🔎 بحث — اسم أو رقم أو مركز" value="' +
          esc(_query) + '"/>' +
        '<div class="lp-filters">' + filters + '</div>' +
        '<div class="lp-hint">اضغط اللاعب ليدخل أول خانة فاضية · اضغطه ثانيةً ليخرج · ' +
          'المُضاف حالياً: <b>' + inCount + '</b></div>' +
        '<div class="lp-list">' + body + '</div>' +
        '<div class="lp-acts">' +
          '<button type="button" class="lp-b lp-b1" id="lpFill">⚡ ملء الخانات</button>' +
          '<button type="button" class="lp-b" id="lpCopy">📋 نسخ آخر تشكيلة</button>' +
          '<button type="button" class="lp-b" id="lpSuggest">🎯 اقترح خطة</button>' +
          '<button type="button" class="lp-b lp-bd" id="lpClear">✕ تفريغ</button>' +
        '</div>' +
      '</div>';

    var q = $('lpQ');
    if (q) q.addEventListener('input', function () {
      _query = norm(this.value); render(); restoreFocus();
    });
    panel.querySelectorAll('.lp-f').forEach(function (b) {
      b.addEventListener('click', function () {
        _posFilter = b.getAttribute('data-f') || ''; render();
      });
    });
    panel.querySelectorAll('.lp-card').forEach(function (b) {
      b.addEventListener('click', function () {
        onChip(b.getAttribute('data-pid'), b.getAttribute('data-pname'));
      });
    });
    var a = $('lpFill'), c = $('lpCopy'), x = $('lpClear');
    if (a) a.addEventListener('click', fillAll);
    if (c) c.addEventListener('click', copyLast);
    if (x) x.addEventListener('click', clearAll);
    var sg = $('lpSuggest');
    if (sg) sg.addEventListener('click', function () {
      var r = suggestFormation();
      if (!r) { toast('لا مراكز مسجّلة في الكشف — أضفها من كشف اللاعبين'); return; }
      var msg = 'كشفك: ' + r.c.DF + ' دفاع · ' + r.c.MF + ' وسط · ' + r.c.FW + ' هجوم\n\n' +
                'الخطة الأنسب: ' + r.f + '\n\nتطبيقها الآن؟';
      if (!confirm(msg)) return;
      try { window.ddChangeFormation(r.f); } catch (e) {}
      refresh(); toast('طُبّقت خطة ' + r.f);
    });
  }

  function restoreFocus() {
    var q = $('lpQ');
    if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) {} }
  }

  /* بطاقة لاعب — صورة حقيقية + اسم + رقم + مركز.
     كانت سطراً نصّياً باهتاً؛ الآن تُقرأ بلمحة كبطاقة تطبيق رسمي. */
  function chip(used, p) {
    var on = !!used[norm(p.name)];
    var d = detailsOf(p.id);          // بالمعرّف لا بالاسم
    var pos = p.position || d.position || '';
    var inactive = d.status && d.status !== 'active';
    return '<button type="button" class="lp-card' + (on ? ' on' : '') +
      (inactive ? ' off' : '') + '" ' +
      'data-pid="' + esc(p.id) + '" data-pname="' + esc(p.name) + '">' +
      avatar(p.id, p.number, 34) +
      '<span class="lp-txt">' +
        '<span class="lp-nm">' + esc(p.name) + '</span>' +
        '<span class="lp-meta">' +
          (p.number !== '' ? '<b>#' + esc(p.number) + '</b>' : '') +
          (pos ? '<span>' + esc(posLabel(pos)) + '</span>' : '') +
          (inactive ? '<i class="lp-off">غير متاح</i>' : '') +
        '</span>' +
      '</span>' +
      '<span class="lp-tk">' +
        (norm(_captain[currentSide()]) === norm(p.name) ? '<b class="lp-cap">C</b>' : (on ? '✓' : '+')) +
      '</span></button>';
  }

  function onChip(pid, pname) {
    var key = norm(pname);
    var hit = rows().filter(function (r) { return norm(rowName(r)) === key; })[0];
    if (hit) {
      var i = rowIdx(hit);
      try { window.ddUpdatePlayer(i, 'name', ''); window.ddUpdatePlayer(i, 'number', ''); } catch (e) {}
      refresh(); return;
    }
    var empty = rows().filter(function (r) { return !isSub(r) && !rowName(r); })[0];
    if (!empty) {
      /* ④ سقف البدلاء: كان بلا حدّ فيمكن إضافة عشرات. الحدّ ١٢ يطابق
         أوسع لوائح المسابقات، ونحذّر بدل المنع المطلق. */
      if (rows().filter(isSub).length >= 12) {
        toast('بلغت ١٢ بديلاً — أزل أحدهم قبل الإضافة', 'error');
        return;
      }
      try { window.ddAddSub(); } catch (e) {}
      setTimeout(function () {
        var subs = rows().filter(isSub), last = subs[subs.length - 1];
        if (last && window._ddPickRosterPlayer) {
          try { window._ddPickRosterPlayer(rowIdx(last), pid); } catch (e) {}
        }
        refresh(); toast('أُضيف ' + pname + ' إلى البدلاء');
      }, 60);
      return;
    }
    try { window._ddPickRosterPlayer(rowIdx(empty), pid); } catch (e) {}
    refresh();
  }

  function fillAll() {
    var roster = readRoster(), used = usedSet(), i = 0;
    var empties = rows().filter(function (r) { return !isSub(r) && !rowName(r); });
    if (!empties.length) { toast('لا توجد خانات فاضية'); return; }
    empties.forEach(function (r) {
      while (i < roster.length && used[norm(roster[i].name)]) i++;
      if (i >= roster.length) return;
      var p = roster[i++];
      used[norm(p.name)] = true;
      try { window._ddPickRosterPlayer(rowIdx(r), p.id); } catch (e) {}
    });
    refresh(); toast('مُلئت الخانات من الكشف');
  }

  function clearAll() {
    rows().forEach(function (r) {
      if (isSub(r)) return;
      var i = rowIdx(r);
      try { window.ddUpdatePlayer(i, 'name', ''); window.ddUpdatePlayer(i, 'number', ''); } catch (e) {}
    });
    refresh(); toast('فُرّغت الخانات');
  }

  /* ─── نسخ آخر تشكيلة (مُصلَحة) ─── */
  function copyLast() {
    var tid = currentTeamId();
    if (!tid) { toast('تعذّر تحديد الفريق — أغلق النافذة وأعد فتحها', 'error'); return; }

    var cur = theMatch();
    var ms = (window.matches || []).filter(function (m) {
      return m && m.id !== (cur && cur.id) && (m.homeId === tid || m.awayId === tid);
    }).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) ||
             ((b.round || 0) - (a.round || 0));
    });

    var src = null;
    for (var i = 0; i < ms.length; i++) {
      var lu = (ms[i].homeId === tid) ? ms[i].homeLineup : ms[i].awayLineup;
      if (lu && lu.players && lu.players.length) { src = lu; break; }
    }
    if (!src) { toast('لا توجد تشكيلة سابقة محفوظة لهذا الفريق'); return; }

    /* الخطة أولاً — وإلا اختلف عدد الخانات عن عدد اللاعبين فسقط بعضهم بصمت */
    if (src.formation && typeof window.ddChangeFormation === 'function') {
      try { window.ddChangeFormation(src.formation); } catch (e) {}
    }

    setTimeout(function () {
      var st = src.players.filter(function (p) { return !p.isSub; });
      var tg = rows().filter(function (r) { return !isSub(r); });
      var n = 0;
      tg.forEach(function (r, i) {
        var p = st[i];
        if (!p) return;
        var idx = rowIdx(r);
        try {
          window.ddUpdatePlayer(idx, 'name', p.name || '');
          window.ddUpdatePlayer(idx, 'number', p.number || '');
          if (p.position) window.ddUpdatePlayer(idx, 'position', p.position);
          n++;
        } catch (e) {}
      });
      refresh();
      toast(n ? ('نُسخ ' + n + ' لاعباً — عدّل ما تغيّر فقط') : 'تعذّر النسخ',
            n ? 'success' : 'error');
    }, 140);
  }

  /* ═══════════════════════════════════════════════════════════════
     ترتيب التذييل — أُعيد بناؤه (v338.3)
     ─────────────────────────────────────────────────────────────
     ① **حُذف زرّ «إظهار البدلاء للجمهور»**: البدلاء جزء من التشكيلة،
        وإخفاؤهم خيار لا يطلبه أحد عملياً بينما يشغل عرض التذييل ويُربك.
        لا نحذفه من النظام الأصلي — نُثبّته على «مفعَّل» ثم نُخفيه، فتبقى
        بنية البيانات (showBench) كما هي ولا ينكسر شيء عند الجمهور.
     ② زرّا «حفظ» و«متوقّعة» صارا بنفس القياس والتنسيق جنباً إلى جنب،
        بدل زرّ ضخم وآخر صغير بشكل مختلف.
     ═══════════════════════════════════════════════════════════════ */
  function forceBenchOn() {
    var btn = $('ddBenchToggle');
    if (!btn || btn.dataset.lpDone) return;
    var txt = ($('ddBenchToggleTxt') || {}).textContent || '';
    // «إظهار البدلاء للجمهور: لا» ← فعّلها مرّة واحدة
    if (/\bلا\b/.test(txt) && typeof window.ddToggleBench === 'function') {
      try { window.ddToggleBench(); } catch (e) {}
    }
    btn.dataset.lpDone = '1';
    btn.style.display = 'none';
  }

  /* ─── التشكيلة المتوقّعة ─── */
  function predToggle() {
    var foot = document.querySelector('.dd-footer');
    if (!foot) return;
    forceBenchOn();
    if ($('lpPred')) return;
    foot.classList.add('lp-foot');
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'lpPred'; b.className = 'lp-pred';
    var save = foot.querySelector('.dd-save-btn');
    if (save) foot.insertBefore(b, save); else foot.insertBefore(b, foot.firstChild);
    b.addEventListener('click', function () {
      _predicted = !_predicted; paintPred();
      toast(_predicted
        ? 'ستُنشر كـ «تشكيلة متوقّعة» — يتغيّر اسم القسم عند الجمهور'
        : 'ستُنشر كتشكيلة رسمية مؤكَّدة');
    });
    paintPred();
  }
  function paintPred() {
    var b = $('lpPred');
    if (!b) return;
    b.classList.toggle('on', _predicted);
    b.innerHTML = '<span class="lp-pi">' + (_predicted ? '🔮' : '✅') + '</span>' +
                  '<span>' + (_predicted ? 'متوقّعة' : 'مؤكَّدة') + '</span>';
    var s = document.querySelector('.dd-save-btn');
    if (s && !s.disabled) {
      s.innerHTML = '<span class="lp-pi">💾</span><span>' +
        (_predicted ? 'نشر المتوقّعة' : 'حفظ للجمهور') + '</span>';
    }
  }

  function wrapSave() {
    var orig = window.ddSaveToFirebase;
    if (typeof orig !== 'function' || orig.__lpWrapped) return;
    var w = async function () {
      var side = currentSide(), mid = _matchId;

      /* ① تحقّق قبل النشر — تحذير لا منع. المنظّم قد يقصد تشكيلة ناقصة
         (إصابة لحظية مثلاً)، فنعرض ما وجدناه ونترك القرار له. */
      var warns = validate();
      if (warns.length) {
        var ok = confirm('⚠️ راجع التشكيلة قبل نشرها للجمهور:\n\n' +
                         warns.join('\n') +
                         '\n\nهل تريد النشر رغم ذلك؟');
        if (!ok) { 
          var btn = document.querySelector('.dd-save-btn');
          if (btn) { btn.disabled = false; paintPred(); }
          return;
        }
      }

      var r = await orig.apply(this, arguments);
      try {
        if (mid && window._db && window._firestoreDoc && window._firestoreUpdateDoc) {
          var lid = window._getLeagueId && window._getLeagueId();
          if (lid) {
            var patch = {};
            var pre = (side === 'home' ? 'homeLineup' : 'awayLineup');
            patch[pre + '.predicted'] = _predicted;
            /* 🅒 الكابتن — إكمال ميزة نصف مبنيّة (v338.3):
               صفحة الجمهور تقرأ lineup.captain وترسم شارة (C) منذ البداية
               (viewer.js:3133 و:8560)، لكن لوحة الإدارة لم تكن تملك أي
               طريقة لتعيينه — فبقي الحقل فارغاً أبداً والشارة لا تظهر قط.
               نكتبه هنا بنفس الاسم الذي يتوقّعه العارض تماماً. */
            patch[pre + '.captain'] = _captain[side] || '';
            /* ⑤ سياق التوقُّع — التطبيقات الرسمية تكتب مصدر توقّعها.
               نحسب عدد المباريات السابقة التي بُني عليها، فيعرف الجمهور
               أن الرقم ليس تخميناً من فراغ. يُكتب فقط حين تكون متوقّعة. */
            patch[pre + '.predictedNote'] = _predicted ? _predNote(side) : '';
            await window._firestoreUpdateDoc(
              window._firestoreDoc(window._db, 'leagues', lid, 'matches', mid), patch);
          }
        }
      } catch (e) { /* الوسم تجميلي — لا يُفشل الحفظ */ }
      return r;
    };
    w.__lpWrapped = true;
    window.ddSaveToFirebase = w;
  }

  /* ═══════════════════════════════════════════════════════════════
     منتقي تبديل اللاعب — أُضيف (v338.3)
     ─────────────────────────────────────────────────────────────
     الطلب: «لو عملت تشكيلة وأضغط على لاعب أغيّره بلاعب ثاني».
     سابقاً كان التبديل يتطلّب تفريغ الخانة يدوياً ثم البحث في اللوحة.
     الآن: ضغطة على خانة مشغولة تفتح قائمة الكشف بالصور، واللاعبون
     المستعملون أصلاً معلَّمون فلا يتكرّر أحد.
     نعمل عبر _ddPickRosterPlayer نفسها — لا مساس بالنظام الأصلي. */
  function openSwap(rowEl) {
    var cur = rowName(rowEl);
    var idx = rowIdx(rowEl);
    var roster = readRoster();
    if (!roster.length) { toast('لا يوجد كشف لهذا الفريق'); return; }
    var used = usedSet();

    var ov = document.createElement('div');
    ov.className = 'lp-ov';
    ov.innerHTML =
      '<div class="lp-sheet">' +
        '<div class="lp-sh-head">' +
          '<div><div class="lp-sh-t">' + (cur ? 'تبديل اللاعب' : 'اختيار لاعب') + '</div>' +
          (cur ? '<div class="lp-sh-s">الحالي: ' + esc(cur) + '</div>' : '') + '</div>' +
          '<button type="button" class="lp-sh-x">✕</button>' +
        '</div>' +
        '<input type="text" class="lp-search" id="lpSwapQ" placeholder="🔎 ابحث عن لاعب"/>' +
        '<div class="lp-sh-list" id="lpSwapList"></div>' +
        (cur ? '<div class="lp-sh-acts">' +
                 '<button type="button" class="lp-b lp-b1" id="lpSwapCap">🅒 ' +
                   (norm(_captain[currentSide()]) === norm(cur) ? 'إلغاء الكابتن' : 'تعيين كابتن') +
                 '</button>' +
                 '<button type="button" class="lp-b lp-bd" id="lpSwapClear">✕ إفراغ الخانة</button>' +
               '</div>' : '') +
      '</div>';
    document.body.appendChild(ov);

    function paint(q) {
      q = norm(q);
      var list = roster.filter(function (p) {
        if (!q) return true;
        return norm(p.name).indexOf(q) > -1 || String(p.number) === q ||
               norm(p.position).indexOf(q) > -1;
      });
      var el = ov.querySelector('#lpSwapList');
      if (!list.length) { el.innerHTML = '<div class="lp-empty">لا نتيجة</div>'; return; }
      el.innerHTML = list.map(function (p) {
        var isCur = norm(p.name) === norm(cur);
        var taken = !isCur && !!used[norm(p.name)];
        var d = detailsOf(p.id);
        var pos = p.position || d.position || '';
        return '<button type="button" class="lp-card' + (isCur ? ' on' : '') +
          (taken ? ' off' : '') + '" data-pid="' + esc(p.id) + '">' +
          avatar(p.id, p.number, 36) +
          '<span class="lp-txt"><span class="lp-nm">' + esc(p.name) + '</span>' +
          '<span class="lp-meta">' + (p.number !== '' ? '<b>#' + esc(p.number) + '</b>' : '') +
          (pos ? '<span>' + esc(posLabel(pos)) + '</span>' : '') +
          (taken ? '<i class="lp-off">مُستعمَل</i>' : '') + '</span></span>' +
          '<span class="lp-tk">' + (isCur ? '●' : taken ? '' : '+') + '</span></button>';
      }).join('');
      el.querySelectorAll('.lp-card').forEach(function (b) {
        b.addEventListener('click', function () {
          try { window._ddPickRosterPlayer(idx, b.getAttribute('data-pid')); } catch (e) {}
          close(); refresh();
        });
      });
    }
    function close() { try { ov.remove(); } catch (e) {} }

    ov.querySelector('.lp-sh-x').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    var cp = ov.querySelector('#lpSwapCap');
    if (cp) cp.addEventListener('click', function () {
      var sd = currentSide();
      _captain[sd] = (norm(_captain[sd]) === norm(cur)) ? '' : cur;
      toast(_captain[sd] ? ('🅒 ' + cur + ' كابتن الفريق') : 'أُلغي تعيين الكابتن');
      close(); refresh();
    });
    var cl = ov.querySelector('#lpSwapClear');
    if (cl) cl.addEventListener('click', function () {
      try {
        window.ddUpdatePlayer(idx, 'name', '');
        window.ddUpdatePlayer(idx, 'number', '');
      } catch (e) {}
      close(); refresh();
    });
    var q = ov.querySelector('#lpSwapQ');
    q.addEventListener('input', function () { paint(this.value); });
    paint('');
    setTimeout(function () { try { q.focus(); } catch (e) {} }, 80);
  }

  /* اجعل كل خانة قابلة للنقر لفتح المنتقي.
     نستهدف منطقة الاسم وحدها كي لا نبتلع نقرات أزرار النظام الأصلي
     (الحذف، السحب، تغيير الرقم) — فتبقى كلها تعمل كما هي. */
  function wireRows() {
    rows().forEach(function (r) {
      var cell = r.querySelector('.dd-p-name');
      if (!cell || cell.dataset.lpWired) return;
      cell.dataset.lpWired = '1';
      cell.style.cursor = 'pointer';
      cell.title = 'اضغط لاختيار أو تبديل اللاعب';
      var inp = cell.querySelector('input[type="text"]');
      if (inp) {
        inp.setAttribute('readonly', 'readonly');
        inp.style.cursor = 'pointer';
        inp.addEventListener('focus', function () { try { this.blur(); } catch (e) {} });
      }
      cell.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openSwap(r);
      });

      /* 🔴 ازدواج فعليّ — أُزيل (v338.5)
         الصفّ يحمل <select class="dd-roster-select"> وهي **نفس** وظيفة
         منتقي اللاعبين الذي صار يفتح بالضغط على الاسم أو على الملعب.
         فصار للمهمة الواحدة طريقتان: قائمة منسدلة داخل كل صفّ، ومنتقٍ
         بالصور. ومع ١١ لاعباً تعني ١١ قائمة زائدة تحت الملعب.
         نُخفيها ولا نحذفها — فلو عُطّل هذا الملف عادت وعمل النظام
         الأصلي كاملاً كما كان. */
      var dup = r.querySelector('.dd-roster-select');
      if (dup) dup.style.display = 'none';

      /* حقول المركز والحالة تبقى — لكنها ثانوية، نضغطها بصرياً
         عبر الصنف كي يتصدّر الاسم والرقم. */
      r.classList.add('lp-row');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     ② الملعب التفاعلي — أُضيف (v338.3)
     ─────────────────────────────────────────────────────────────
     كان التعديل في قائمة تحت الملعب، والملعب للعرض فقط. الآن الضغط
     على أي مركز في الملعب يفتح منتقي اللاعبين مباشرة — كالتطبيقات
     الرسمية. وبلا مساس بمحرّك الملعب: نقاطه تحمل data-idx أصلاً،
     فنربط النقر بها ونحوّله للصفّ المقابل في القائمة.

     ⚠️ السحب والإفلات يبقى يعمل: نميّز النقر عن السحب بالمسافة —
     تحرّك أكثر من ٦ بكسل = سحب فلا نفتح المنتقي. */
  /* ═══════════════════════════════════════════════════════════════
     السحب على الملعب: تبديل مراكز لا إفلات حرّ — (v338.6)
     ─────────────────────────────────────────────────────────────
     كان السحب يضع اللاعب في **أي إحداثية** يُفلَت عندها. النتيجة
     تشكيلة مشوّهة: مدافعان متلاصقان، ومهاجم في منطقة الجزاء، وفراغ
     في الوسط — وكل ذلك يُحفظ ويظهر للجمهور بلا أي حارس.

     السلوك الصحيح — وهو ما تفعله التطبيقات الرسمية:
       • أفلِت اللاعب **فوق لاعب آخر** → يتبادلان المركز بالكامل.
       • أفلِته في فراغ → يعود إلى موضعه الأصلي تلقائياً.
     فتبقى الخطة سليمة مهما عبث المستخدم، ولا يحتاج لضبط إحداثيات.

     ننفّذها فوق النظام الأصلي: نلتقط الموضع قبل السحب، وندع محرّك
     السحب يعمل كما هو، ثم نصحّح النتيجة في لحظة الإفلات. */
  function dotCenter(d) {
    var r = d.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* أقرب لاعب آخر إلى نقطة الإفلات — ضمن مدى معقول */
  function dropTarget(self, px, py) {
    var best = null, bestD = 1e9;
    Array.prototype.forEach.call(document.querySelectorAll('.dd-player-dot'), function (o) {
      if (o === self) return;
      var c = dotCenter(o);
      var dist = Math.hypot(c.x - px, c.y - py);
      if (dist < bestD) { bestD = dist; best = o; }
    });
    /* العتبة نسبية بحجم النقطة لا رقماً ثابتاً — فتصحّ على كل الشاشات */
    var thresh = Math.max(34, self.getBoundingClientRect().width * 1.15);
    return bestD <= thresh ? best : null;
  }

  /* ⚠️ حاسم: تغيير style وحده لا يكفي.
     محرّك السحب الأصلي يكتب في البيانات عند الإفلات
     (starters[idx].x = parseFloat(style.left))، فلو غيّرنا المظهر فقط
     لبقيت البيانات على الإحداثية الخاطئة — ويعود التشوّه فور أي إعادة
     رسم، ويُحفظ للجمهور كما هو.
     و ddCurrentData ليست مكشوفة على window (وحدة مغلقة)، لذا نكتب عبر
     ddUpdatePlayer وهي تقبل أي حقل — بما فيه x و y. */
  function setXY(idx, x, y) {
    try {
      window.ddUpdatePlayer(idx, 'x', x);
      window.ddUpdatePlayer(idx, 'y', y);
    } catch (e) {}
  }

  function applySwap(aIdx, bIdx) {
    /* التبديل = تبادل الإحداثيات فقط. لا نلمس الاسم ولا الرقم —
       فاللاعب هو هو، والمتغيّر مركزه على الملعب. */
    var A = document.querySelector('.dd-player-dot[data-idx="' + aIdx + '"]');
    var B = document.querySelector('.dd-player-dot[data-idx="' + bIdx + '"]');
    if (!A || !B) return false;

    var ax = parseFloat(A.style.left), ay = parseFloat(A.style.top);
    var bx = parseFloat(B.style.left), by = parseFloat(B.style.top);
    if (!isFinite(ax) || !isFinite(bx)) return false;

    A.style.left = bx + '%'; A.style.top = by + '%';
    B.style.left = ax + '%'; B.style.top = ay + '%';

    setXY(aIdx, bx, by);     // ← البيانات، لا المظهر وحده
    setXY(bIdx, ax, ay);
    return true;
  }

  function wirePitch() {
    var dots = document.querySelectorAll('.dd-player-dot');
    Array.prototype.forEach.call(dots, function (d) {
      if (d.dataset.lpWired) return;
      d.dataset.lpWired = '1';
      var sx = 0, sy = 0, moved = false, ox = '', oy = '';

      function down(e) {
        var t = (e.touches && e.touches[0]) || e;
        sx = t.clientX; sy = t.clientY; moved = false;
        ox = d.style.left; oy = d.style.top;      // الموضع الأصلي للرجوع
      }
      function move(e) {
        var t = (e.touches && e.touches[0]) || e;
        if (Math.abs(t.clientX - sx) > 6 || Math.abs(t.clientY - sy) > 6) moved = true;
      }
      function up(e) {
        // نقرة بلا سحب → منتقي اللاعبين (سلوك قائم)
        if (!moved) {
          var idx0 = d.getAttribute('data-idx');
          var row = rows().filter(function (r) {
            return String(r.getAttribute('data-idx')) === String(idx0);
          })[0];
          if (row) setTimeout(function () { openSwap(row); }, 10);
          return;
        }
        var t = (e.changedTouches && e.changedTouches[0]) || e;
        var tgt = dropTarget(d, t.clientX, t.clientY);

        setTimeout(function () {          // بعد أن ينهي المحرّك الأصلي عمله
          if (tgt) {
            var ok = applySwap(d.getAttribute('data-idx'), tgt.getAttribute('data-idx'));
            if (ok) {
              d.classList.add('lp-swapped'); tgt.classList.add('lp-swapped');
              setTimeout(function () {
                d.classList.remove('lp-swapped'); tgt.classList.remove('lp-swapped');
              }, 420);
              toast('تبادل المركزان');
              return;
            }
          }
          /* فراغ → رجوع تلقائي. الانتقال يجعل الرجوع مفهوماً لا مفاجئاً. */
          d.classList.add('lp-snap');
          d.style.left = ox; d.style.top = oy;
          var bx2 = parseFloat(ox), by2 = parseFloat(oy);
          if (isFinite(bx2) && isFinite(by2)) setXY(d.getAttribute('data-idx'), bx2, by2);
          setTimeout(function () { d.classList.remove('lp-snap'); }, 320);
        }, 30);
      }

      d.addEventListener('mousedown', down);
      d.addEventListener('mousemove', move);
      d.addEventListener('mouseup', up);
      d.addEventListener('touchstart', down, { passive: true });
      d.addEventListener('touchmove', move, { passive: true });
      d.addEventListener('touchend', up);
      d.style.cursor = 'pointer';
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     ① التحقّق قبل النشر — أُضيف (v338.3)
     ─────────────────────────────────────────────────────────────
     الحفظ الأصلي يفحص وجود المباراة والبطولة فقط. فكان يمكن نشر
     تشكيلة بسبعة لاعبين، أو بحارسَي مرمى، أو برقمَي قميص متكرّرين —
     وتظهر كذلك للجمهور مباشرة. وهذا أسوأ نوع خطأ في منصة بطولات:
     لا يُسقط شيئاً، بل ينشر معلومة غلط باسم البطولة.
     نفحص هنا ونُخيّر المنظّم — لا نمنعه، فقد يقصد تشكيلة ناقصة. */
  function validate() {
    var st = rows().filter(function (r) { return !isSub(r); });
    var names = [], nums = [], gk = 0, empty = 0, dup = [], dupNum = [];
    st.forEach(function (r) {
      var n = rowName(r);
      if (!n) { empty++; return; }
      if (names.indexOf(norm(n)) > -1) dup.push(n); else names.push(norm(n));
      var ni = r.querySelector('.dd-p-num input');
      var v = ni ? String(ni.value || '').trim() : '';
      if (v) { if (nums.indexOf(v) > -1) dupNum.push(v); else nums.push(v); }
      var d = detailsOf(n);
      var ps = r.querySelector('.dd-p-pos select, .dd-p-pos input');
      var pv = (ps ? ps.value : '') || d.position || '';
      if (/حارس|GK/i.test(pv)) gk++;
    });
    var w = [];
    if (empty) w.push('• ' + empty + ' خانة أساسية فاضية');
    if (dup.length) w.push('• لاعب مكرَّر: ' + dup.join('، '));
    if (dupNum.length) w.push('• رقم قميص مكرَّر: ' + dupNum.join('، '));
    if (gk === 0) w.push('• لا يوجد حارس مرمى في التشكيلة');
    if (gk > 1) w.push('• عدد حرّاس المرمى: ' + gk);
    var subs = rows().filter(isSub).length;
    if (subs > 12) w.push('• عدد البدلاء ' + subs + ' — أكثر من المعتاد (١٢)');
    return w;
  }

  /* ═══════════════════════════════════════════════════════════════
     ③ اقتراح الخطة من مراكز الكشف — أُضيف (v338.3)
     ─────────────────────────────────────────────────────────────
     بدل أن يخمّن المنظّم، نعدّ مدافعيه ووسطه ومهاجميه ونقترح الخطة
     التي تناسب كشفه فعلاً. اقتراح لا إلزام — زرّ واحد يطبّقه. */
  function suggestFormation() {
    var roster = readRoster();
    var c = { DF: 0, MF: 0, FW: 0 };
    roster.forEach(function (p) {
      var g = groupOf(p.position || (detailsOf(p.name).position || ''));
      if (c[g] != null) c[g]++;
    });
    if (!c.DF && !c.MF && !c.FW) return null;
    var opts = ['4-3-3', '4-4-2', '3-5-2', '5-3-2', '4-2-3-1'];
    var best = null, bestScore = -1;
    opts.forEach(function (f) {
      var parts = f.split('-').map(Number);
      var d = parts[0], fw = parts[parts.length - 1];
      var mf = parts.slice(1, -1).reduce(function (a, b) { return a + b; }, 0);
      // كلّما قلّ العجز عن المتاح كان أنسب
      var score = -(Math.max(0, d - c.DF) + Math.max(0, mf - c.MF) + Math.max(0, fw - c.FW));
      if (score > bestScore) { bestScore = score; best = f; }
    });
    return { f: best, c: c };
  }

  function _predNote(side) {
    var m = theMatch();
    if (!m) return 'تشكيلة متوقّعة';
    var tid = side === 'home' ? m.homeId : m.awayId;
    var n = (window.matches || []).filter(function (x) {
      if (!x || x.id === m.id) return false;
      if (x.homeId !== tid && x.awayId !== tid) return false;
      var lu = x.homeId === tid ? x.homeLineup : x.awayLineup;
      return !!(lu && lu.players && lu.players.length && lu.predicted !== true);
    }).length;
    return n ? ('متوقّعة بناءً على آخر ' + n + ' مباراة للفريق') : 'تشكيلة متوقّعة';
  }

  /* ═══════════════════════════════════════════════════════════════
     إعادة ترتيب بنية النافذة — (v338.5)
     ─────────────────────────────────────────────────────────────
     المشكلة: بعد تراكم الطبقات صار الترتيب عمودياً طويلاً —
     ملعب ← لوحة كشف ← ١١ صفّاً ← تذييل. فيختفي الملعب وأنت تعدّل
     القائمة، وهو مرجعك البصري الوحيد لمعرفة أين يقف كل لاعب.

     الحلّ بلا مساس بالنواة:
       ① الملعب يلتصق أعلى النافذة عند التمرير (sticky).
       ② صفوف اللاعبين تنطوي خلف زرّ — لم يعد لها دور إلا المركز
          والحالة بعد أن صار الاسم يفتح المنتقي والملعب تفاعلياً.
       ③ التلميح «اسحب اللاعبين» يُدمج في رأس مضغوط بدل سطر مستقل.
     كلّها DOM و CSS من هذا الملف — حذفه يُرجع كل شيء كما كان. */
  function restructure() {
    var body = $('ddBody');
    if (!body) return;
    var pitch = body.querySelector('.dd-pitch-wrap');
    var list  = $('ddPlayersList');
    if (!pitch || !list) return;
    /* ⚠️ الحارس على **وجود الزرّ في الصفحة** لا على علَم في dataset:
       تبديل تبويب الفريق يستبدل innerHTML لـ #ddBody فيمحو الزرّ،
       بينما يبقى العنصر نفسه ومعه dataset — فعلَم dataset كان سيمنع
       إعادة البناء إلى الأبد ويختفي الطيّ بعد أول تبديل. */
    if (body.querySelector('.lp-toggle')) return;

    /* ❌ أُلغي التصاق الملعب (v338.5-ب)
       جرّبناه فأكل جزءاً كبيراً من ارتفاع الشاشة على الجوال وبقي
       معلّقاً حتى عند التمرير بعيداً عنه. الطبيعي أن يمرّ مع المحتوى
       ويختفي حين يتجاوزه المستخدم. نُبقي الطيّ وحده — فهو ما يقصّر
       الصفحة فعلاً، بلا أن يسرق مساحة دائمة. */

    // ① التلميح الطويل → سطر مضغوط
    var hint = pitch.querySelector('div[style*="text-align:center"]');
    if (hint) { hint.classList.add('lp-tip'); hint.textContent = 'اسحب اللاعبين لتغيير مواضعهم · اضغط أي مركز لتبديله'; }

    // ② زرّ طيّ الصفوف
    var bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'lp-toggle';
    bar.setAttribute('aria-expanded', 'false');
    list.parentNode.insertBefore(bar, list);
    list.classList.add('lp-collapsed');

    function paint() {
      var open = !list.classList.contains('lp-collapsed');
      bar.setAttribute('aria-expanded', String(open));
      bar.innerHTML = '<span>تفاصيل اللاعبين — المركز والحالة</span>' +
                      '<b class="lp-cv">' + (open ? '▲' : '▼') + '</b>';
    }
    bar.addEventListener('click', function () {
      list.classList.toggle('lp-collapsed'); paint();
      if (!list.classList.contains('lp-collapsed')) { wireRows(); }
    });
    paint();
  }

  function refresh() { setTimeout(function () { render(); wireRows(); wirePitch(); }, 45); }

  function css() {
    if ($('lp-css')) return;
    var s = document.createElement('style');
    s.id = 'lp-css';
    s.textContent = [
      '#lpPanel{font-family:Tajawal,sans-serif}',
      '.lp-w{background:var(--card2,#202020);border:1px solid var(--border2,#383838);border-radius:15px;padding:13px;margin-bottom:12px}',
      '.lp-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}',
      '.lp-ttl{font-size:13px;font-weight:900;color:' + GOLD2 + '}',
      '.lp-prog{display:flex;align-items:baseline;gap:4px}',
      '.lp-pn{font-size:17px;font-weight:900;color:var(--muted2,#888)}',
      '.lp-pn.ok{color:var(--green,#27AE60)}',
      '.lp-ps{font-size:10px;font-weight:800;color:var(--muted,#5a5a5a)}',
      '.lp-bar{height:3px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden;margin-bottom:11px}',
      '.lp-fill{height:100%;background:' + GOLD + ';transition:width .25s}',
      '.lp-search{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;margin-bottom:8px;background:var(--dark,#121212);border:1px solid var(--border,#2c2c2c);color:var(--text,#efefef);font-family:Tajawal,sans-serif;font-size:12px}',
      '.lp-filters{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px}',
      '.lp-f{padding:5px 10px;border-radius:20px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:10.5px;font-weight:800;background:var(--card3,#262626);border:1px solid var(--border,#2c2c2c);color:var(--muted2,#888)}',
      '.lp-f.on{background:rgba(201,160,43,.13);border-color:rgba(201,160,43,.4);color:' + GOLD2 + '}',
      '.lp-f span{opacity:.6;font-size:9.5px}',
      '.lp-hint{font-size:10px;color:var(--muted,#5a5a5a);margin-bottom:9px;line-height:1.75}',
      '.lp-hint b{color:' + GOLD + '}',
      '.lp-list{max-height:230px;overflow-y:auto;margin:-2px -3px 0;padding:2px 3px}',
      '.lp-g{margin-bottom:9px}',
      '.lp-gt{font-size:9.5px;font-weight:900;color:var(--muted,#5a5a5a);margin-bottom:5px;letter-spacing:.4px}',
      '.lp-gt span{opacity:.55}',
      '.lp-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:5px}',
      /* بطاقة اللاعب */
      '.lp-card{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:11px;cursor:pointer;text-align:start;background:var(--card3,#262626);border:1px solid var(--border,#2c2c2c);color:var(--text,#efefef);font-family:Tajawal,sans-serif;transition:all .12s;overflow:hidden}',
      '.lp-card:active{transform:scale(.97)}',
      '.lp-card.on{background:rgba(201,160,43,.1);border-color:rgba(201,160,43,.45)}',
      '.lp-card.off{opacity:.5}',
      '.lp-av{flex-shrink:0;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--card2,#202020);border:1px solid var(--border2,#383838)}',
      '.lp-av img{width:100%;height:100%;object-fit:cover;display:block}',
      '.lp-av-t{font-size:11px;font-weight:900;color:var(--muted2,#888)}',
      '.lp-card.on .lp-av{border-color:rgba(201,160,43,.5)}',
      '.lp-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.lp-nm{font-size:11.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.lp-card.on .lp-nm{color:' + GOLD2 + '}',
      '.lp-meta{display:flex;align-items:center;gap:5px;font-size:9.5px;color:var(--muted,#5a5a5a);font-weight:700}',
      '.lp-meta b{color:var(--muted2,#888);font-weight:900}',
      '.lp-off{font-style:normal;color:var(--red,#C0392B)}',
      /* التذييل */
      '.dd-footer.lp-foot{display:flex;gap:7px;align-items:stretch;flex-wrap:wrap}',
      '.dd-footer.lp-foot .dd-save-btn,.dd-footer.lp-foot .lp-pred,.dd-footer.lp-foot .dd-cancel-btn{flex:1;min-width:104px;display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 10px;border-radius:12px;font-family:Tajawal,sans-serif;font-size:12px;font-weight:900;cursor:pointer;line-height:1;margin:0}',
      '.lp-pi{font-size:13px}',
      /* منتقي التبديل */
      '.lp-ov{position:fixed;inset:0;z-index:100020;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;padding:0;animation:lpIn .16s ease}',
      '@keyframes lpIn{from{opacity:0}to{opacity:1}}',
      '.lp-sheet{width:100%;max-width:520px;max-height:82vh;display:flex;flex-direction:column;gap:9px;background:var(--card,#1a1a1a);border:1px solid var(--border2,#383838);border-bottom:none;border-radius:20px 20px 0 0;padding:15px 15px calc(15px + env(safe-area-inset-bottom,0px));font-family:Tajawal,sans-serif}',
      '.lp-sh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
      '.lp-sh-t{font-size:14px;font-weight:900;color:' + GOLD2 + '}',
      '.lp-sh-s{font-size:10.5px;font-weight:700;color:var(--muted2,#888);margin-top:2px}',
      '.lp-sh-x{background:var(--card2,#202020);border:1px solid var(--border2,#383838);color:var(--text,#efefef);width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:14px;flex-shrink:0}',
      '.lp-sh-list{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;padding:2px}',
      '.lp-sh-list .lp-card.off{pointer-events:none}',
      /* ضغط صفّ اللاعب: الاسم والرقم يتصدّران، والمركز والحالة أصغر */
      '.dd-player-row.lp-row .dd-p-name input[readonly]{cursor:pointer;font-weight:800}',
      '.dd-player-row.lp-row .dd-p-pos select,.dd-player-row.lp-row .dd-p-status select{font-size:10.5px;opacity:.78}',
      '.dd-player-row.lp-row .dd-p-pos select:focus,.dd-player-row.lp-row .dd-p-status select:focus{opacity:1}',
      '.dd-player-row.lp-row{padding-block:7px}',
      /* ملعب ملتصق */
      '.lp-tip{font-size:9.5px!important;opacity:.62;margin-top:5px!important;line-height:1.6}',
      /* طيّ الصفوف */
      '.lp-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;',
      '  padding:11px 13px;margin:10px 0 0;border-radius:12px;cursor:pointer;',
      '  background:var(--card2,#202020);border:1px solid var(--border2,#383838);',
      '  color:var(--muted2,#888);font-family:Tajawal,sans-serif;font-size:11.5px;font-weight:800}',
      '.lp-toggle:active{background:var(--card3,#262626)}',
      '.lp-cv{color:' + GOLD + ';font-size:10px}',
      /* التبديل والرجوع */
      '.dd-player-dot.lp-snap{transition:left .28s cubic-bezier(.34,1.3,.64,1),top .28s cubic-bezier(.34,1.3,.64,1)}',
      '.dd-player-dot.lp-swapped{transition:left .3s ease,top .3s ease}',
      '.dd-player-dot.lp-swapped .dd-avatar{box-shadow:0 0 0 3px rgba(201,160,43,.55)}',
      '.dd-list-wrap.lp-collapsed{display:none}',
      '.lp-acts .lp-b{font-size:10.5px;padding:9px 6px}',
      '.lp-sh-acts{display:flex;gap:6px}',
      '.lp-cap{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;background:' + GOLD + ';color:#1a1200;font-size:9.5px;font-weight:900}',
      '.lp-n{min-width:18px;text-align:center;font-size:9.5px;font-weight:900;padding:1px 4px;border-radius:5px;background:rgba(255,255,255,.06);color:var(--muted2,#888)}',
      '.lp-n.z{opacity:.4}',
      '.lp-tk{font-size:11px;font-weight:900;opacity:.7}',
      '.lp-acts{display:flex;gap:5px;margin-top:11px;flex-wrap:wrap}',
      '.lp-b{flex:1;min-width:72px;padding:9px 8px;border-radius:10px;cursor:pointer;background:var(--card3,#262626);border:1px solid var(--border2,#383838);color:var(--text,#efefef);font-family:Tajawal,sans-serif;font-size:11px;font-weight:800}',
      '.lp-b:active{background:rgba(255,255,255,.05)}',
      '.lp-b1{background:rgba(201,160,43,.12);border-color:rgba(201,160,43,.4);color:' + GOLD2 + '}',
      '.lp-bd{color:var(--red,#C0392B);border-color:rgba(192,57,43,.3)}',
      '.lp-empty{text-align:center;padding:22px 12px;color:var(--muted2,#888);font-size:11.5px;line-height:1.9}',
      '.lp-pred{border:1px solid var(--border2,#383838);background:var(--card3,#262626);color:var(--muted2,#888);white-space:nowrap}',
      '.lp-pred.on{background:rgba(201,160,43,.12);border-color:rgba(201,160,43,.42);color:' + GOLD2 + '}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ═══ الكشف الكامل بالصور ═══
     القائمة المنسدلة التي يرسمها النظام الأصلي نصّ فقط — لا صور ولا
     تفاصيل. فنقرأ الكشف مرة واحدة لكل فريق ونحتفظ به، كي يظهر اللاعب
     بصورته ومركزه ورقمه في منتقي اللاعبين. (onSnapshot لأن getDocs غير
     مكشوف على window؛ ونلغيه فور وصول أول لقطة فلا يبقى مستمع مفتوح.) */
  /* 🔴 كانت الفهرسة بالاسم داخل خريطة لكل فريق — وهو سبب «يضيف صورة
     لاعب ويظهر اسم ثاني»:
       • تبديل تبويب الفريق يغيّر currentTeamId() فوراً، بينما قائمة
         الكشف في الـ DOM تظل لحظةً على الفريق السابق. فتُطابَق أسماء
         فريق (أ) على خريطة صور فريق (ب) → صورة لاعب باسم آخر.
       • واللاعبان المتشابها الاسم داخل الفريق يتبادلان الصور دائماً.
     الحلّ: فهرسة بمعرّف اللاعب — فريد عالمياً، ولا يتأثر بالتبويب ولا
     بتشابه الأسماء. (v338.4) */
  var _photoById = {};    // playerId -> {photo, position, number, status, name}
  var _loadedTeams = {};  // teamId -> true

  function loadRosterDetails(teamId, cb) {
    if (!teamId) { cb && cb(); return; }
    if (_loadedTeams[teamId]) { cb && cb(); return; }
    var w = window;
    if (!w._db || !w._firestoreCollection || !w._firestoreOnSnapshot || !w._getLeagueId) { cb && cb(); return; }
    var lid = w._getLeagueId && w._getLeagueId();
    if (!lid) { cb && cb(); return; }
    _loadedTeams[teamId] = true;   // احجز فلا يتكرّر الطلب
    try {
      var unsub = w._firestoreOnSnapshot(
        w._firestoreCollection(w._db, 'leagues', lid, 'teams', teamId, 'roster'),
        function (snap) {
          snap.forEach(function (d) {
            var v = d.data() || {};
            /* المفتاح = معرّف مستند اللاعب، وهو نفسه قيمة <option value>
               في قائمة الكشف — فالربط مضمون لا مُستنتَج. */
            _photoById[d.id] = {
              photo: v.photo || '', position: v.position || '',
              number: (v.number != null ? v.number : ''),
              status: v.status || 'active', name: v.name || ''
            };
          });
          try { unsub && unsub(); } catch (e) {}   // لقطة واحدة تكفي
          cb && cb();
        },
        function () { try { unsub && unsub(); } catch (e) {} cb && cb(); }
      );
    } catch (e) { cb && cb(); }
  }

  /* يقبل المعرّف (المضمون) ويسقط للاسم فقط حين لا معرّف — كصفوف
     التشكيلة المكتوبة يدوياً قبل وجود كشف. */
  function detailsOf(idOrName) {
    if (!idOrName) return {};
    if (_photoById[idOrName]) return _photoById[idOrName];
    var k = norm(idOrName), out = {};
    for (var id in _photoById) {
      if (norm(_photoById[id].name) === k) { out = _photoById[id]; break; }
    }
    return out;
  }

  function avatar(nameOrId, num, size) {
    var d = detailsOf(nameOrId), sz = size || 30;
    var name = d.name || nameOrId;
    if (d.photo) {
      return '<span class="lp-av" style="width:' + sz + 'px;height:' + sz + 'px">' +
             '<img src="' + esc(d.photo) + '" alt="" loading="lazy"/></span>';
    }
    var initial = String(name || '؟').trim().charAt(0) || '؟';
    return '<span class="lp-av lp-av-t" style="width:' + sz + 'px;height:' + sz + 'px">' +
           esc(num !== '' && num != null ? num : initial) + '</span>';
  }

  function boot() {
    css();
    hookOpener();
    new MutationObserver(function () {
      hookOpener();                       // النظام الأصلي وحدة مؤجَّلة — قد يتأخر تعريفه
      if (!$('ddPlayersList')) return;
      wrapSave();
      predToggle();
      restructure();
      if (!$('lpPanel')) render();
      wireRows();
      wirePitch();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window._lpRender = render;   // للتشخيص
})();
