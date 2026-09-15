/* ═══════════════════════════════════════════════════════════════════
 *  lineup-plus.js — v338
 *  تطوير نظام التشكيلات القائم (لا نظام جديد)
 *  ───────────────────────────────────────────────────────────────────
 *  ما كان موجوداً في admin-lineup-dragdrop.js ويبقى كما هو:
 *    • رسم الملعب والسحب والإفلات
 *    • الخطط (4-3-3 …) وعدد اللاعبين والدكة
 *    • الحفظ إلى matches/{id}.homeLineup / awayLineup
 *
 *  ما يضيفه هذا الملف فوقه:
 *    ① لوحة «كشف الفريق» كاملة — كل لاعبي الفريق أمامك دفعة واحدة،
 *       تضغط اللاعب فيدخل أول خانة فاضية. بدل فتح قائمة منسدلة داخل
 *       كل خانة على حدة (١١ فتحة × ١١ بحث في كل مباراة).
 *    ② «نسخ آخر تشكيلة» — أغلب الفرق تلعب بنفس التشكيلة تقريباً،
 *       فينسخها بضغطة ثم يعدّل ما تغيّر فقط.
 *    ③ «تشكيلة متوقّعة» — تُنشر قبل المباراة بوسم واضح للجمهور،
 *       وعند التأكيد يسقط الوسم وتصير التشكيلة الرسمية (كالتطبيقات
 *       الرسمية: Predicted → Confirmed).
 *
 *  ⚠️ قاعدة التصميم هنا: **لا يلمس هذا الملف أي متغيّر داخلي**.
 *     admin-lineup-dragdrop.js يُحمَّل كـ type="module"، فمتغيّراته
 *     (_ddSide, _ddRosterHome, _ddHomeData …) غير مرئية لنا أصلاً.
 *     لذلك نعمل حصراً عبر:
 *       • الواجهة العامة: window._ddPickRosterPlayer / ddUpdatePlayer /
 *         ddAddSub / ddSaveToFirebase
 *       • وما يرسمه هو في الـ DOM (صفوف .dd-player-row وقوائم
 *         .dd-roster-select التي تحوي الكشف كاملاً أصلاً)
 *     الفائدة: أي تعديل مستقبلي على النظام الأصلي لا يكسر هذا الملف،
 *     ولو غاب هذا الملف يعمل النظام الأصلي كما كان بالضبط.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GOLD = 'var(--gold,#C9A02B)', GOLD2 = 'var(--gold2,#E8BE45)';

  /* ─────────────────────────────────────────────────────────────
     أدوات
     ───────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }

  /* الكشف الكامل يُقرأ من القائمة المنسدلة التي يرسمها النظام الأصلي.
     لا نعيد جلبه من Firestore — فذلك تكرار لطلب موجود، وقد يختلف عنه. */
  function readRoster() {
    var sel = document.querySelector('#ddPlayersList .dd-roster-select');
    if (!sel) return [];
    var out = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (!o.value) return;                    // تخطّي «اختر من لاعبي الفريق…»
      var label = o.textContent || '';
      var num = '', name = label, pos = '';
      var mNum = label.match(/^#(\d+)\s*—\s*/);
      if (mNum) { num = mNum[1]; name = label.slice(mNum[0].length); }
      var mPos = name.match(/\s·\s([^·]+)$/);
      if (mPos) { pos = mPos[1].trim(); name = name.slice(0, mPos.index); }
      out.push({ id: o.value, name: name.trim(), number: num, position: pos });
    });
    return out;
  }

  /* صفوف التشكيلة الحالية كما هي في الـ DOM */
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
  function isSubRow(r) {
    var d = r.getAttribute('data-idx') || '';
    return d.indexOf('sub-') === 0;
  }

  /* الأسماء المستعملة حالياً — للمقارنة مع الكشف */
  function usedNames() {
    var s = {};
    rows().forEach(function (r) {
      var n = rowName(r);
      if (n) s[n.replace(/\s+/g, ' ').toLowerCase()] = true;
    });
    return s;
  }

  /* ─────────────────────────────────────────────────────────────
     ① لوحة كشف الفريق
     ───────────────────────────────────────────────────────────── */
  function renderPanel() {
    var host = $('ddPlayersList');
    if (!host) return;

    var roster = readRoster();
    var panel = $('lpRosterPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'lpRosterPanel';
      host.parentNode.insertBefore(panel, host);
    }

    if (!roster.length) {
      panel.innerHTML =
        '<div class="lp-panel"><div class="lp-empty">لا يوجد كشف لاعبين لهذا الفريق بعد — ' +
        'أضفه من «الفرق ← كشف اللاعبين» ليظهر هنا كاملاً.</div></div>';
      return;
    }

    var used = usedNames();
    var free = rows().filter(function (r) { return !isSubRow(r) && !rowName(r); }).length;

    var chips = roster.map(function (p) {
      var on = !!used[(p.name || '').replace(/\s+/g, ' ').toLowerCase()];
      return '<button type="button" class="lp-chip' + (on ? ' on' : '') + '" ' +
        'data-pid="' + esc(p.id) + '" data-pname="' + esc(p.name) + '" ' +
        'title="' + (on ? 'مُضاف — اضغط للإزالة' : 'اضغط للإضافة') + '">' +
        (p.number !== '' ? '<span class="lp-n">' + esc(p.number) + '</span>' : '<span class="lp-n lp-n0">—</span>') +
        '<span class="lp-nm">' + esc(p.name) + '</span>' +
        (p.position ? '<span class="lp-ps">' + esc(p.position) + '</span>' : '') +
        '<span class="lp-tick">' + (on ? '✓' : '+') + '</span></button>';
    }).join('');

    panel.innerHTML =
      '<div class="lp-panel">' +
        '<div class="lp-head">' +
          '<div class="lp-title">كشف الفريق <span class="lp-cnt">' + roster.length + '</span></div>' +
          '<div class="lp-free">' + (free ? free + ' خانة فاضية' : 'اكتملت الخانات') + '</div>' +
        '</div>' +
        '<div class="lp-hint">اضغط اللاعب ليدخل أول خانة فاضية · اضغطه ثانيةً ليخرج</div>' +
        '<div class="lp-chips">' + chips + '</div>' +
        '<div class="lp-tools">' +
          '<button type="button" class="lp-btn" id="lpFillAll">ملء الخانات بالترتيب</button>' +
          '<button type="button" class="lp-btn" id="lpCopyLast">نسخ آخر تشكيلة</button>' +
          '<button type="button" class="lp-btn lp-btn-d" id="lpClearAll">تفريغ الكل</button>' +
        '</div>' +
      '</div>';

    panel.querySelectorAll('.lp-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        onChip(b.getAttribute('data-pid'), b.getAttribute('data-pname'));
      });
    });
    var f = $('lpFillAll'), c = $('lpCopyLast'), x = $('lpClearAll');
    if (f) f.addEventListener('click', fillAll);
    if (c) c.addEventListener('click', copyLast);
    if (x) x.addEventListener('click', clearAll);
  }

  /* إضافة/إزالة لاعب */
  function onChip(pid, pname) {
    var key = (pname || '').replace(/\s+/g, ' ').toLowerCase();
    var match = rows().filter(function (r) {
      return rowName(r).replace(/\s+/g, ' ').toLowerCase() === key;
    })[0];

    if (match) {                       // موجود → أزِله
      var idx = rowIdx(match);
      try {
        window.ddUpdatePlayer(idx, 'name', '');
        window.ddUpdatePlayer(idx, 'number', '');
      } catch (e) {}
      refresh();
      return;
    }

    var empty = rows().filter(function (r) { return !isSubRow(r) && !rowName(r); })[0];
    if (!empty) {                      // لا خانة أساسية → أضِفه بديلاً
      try { window.ddAddSub(); } catch (e) {}
      setTimeout(function () {
        var subs = rows().filter(isSubRow);
        var last = subs[subs.length - 1];
        if (last && window._ddPickRosterPlayer) {
          try { window._ddPickRosterPlayer(rowIdx(last), pid); } catch (e) {}
        }
        refresh();
        toast('أُضيف ' + pname + ' إلى البدلاء');
      }, 60);
      return;
    }
    try { window._ddPickRosterPlayer(rowIdx(empty), pid); } catch (e) {}
    refresh();
  }

  /* ملء كل الخانات الفاضية بالترتيب من الكشف */
  function fillAll() {
    var roster = readRoster(), used = usedNames(), i = 0;
    var empties = rows().filter(function (r) { return !isSubRow(r) && !rowName(r); });
    if (!empties.length) { toast('لا توجد خانات فاضية'); return; }

    empties.forEach(function (r) {
      while (i < roster.length &&
             used[(roster[i].name || '').replace(/\s+/g, ' ').toLowerCase()]) i++;
      if (i >= roster.length) return;
      var p = roster[i++];
      used[(p.name || '').replace(/\s+/g, ' ').toLowerCase()] = true;
      try { window._ddPickRosterPlayer(rowIdx(r), p.id); } catch (e) {}
    });
    refresh();
    toast('مُلئت الخانات من الكشف');
  }

  function clearAll() {
    rows().forEach(function (r) {
      if (isSubRow(r)) return;
      var idx = rowIdx(r);
      try {
        window.ddUpdatePlayer(idx, 'name', '');
        window.ddUpdatePlayer(idx, 'number', '');
      } catch (e) {}
    });
    refresh();
    toast('فُرّغت الخانات');
  }

  /* ─────────────────────────────────────────────────────────────
     ② نسخ آخر تشكيلة لنفس الفريق
     ───────────────────────────────────────────────────────────── */
  function currentSide() {
    var t = $('ddTabAway');
    return (t && t.classList.contains('active')) ? 'away' : 'home';
  }
  /* معرّف الفريق الحالي — نستنتجه من المباراة المفتوحة في window.matches */
  function currentTeamId() {
    var ms = window.matches || [];
    var open = ms.filter(function (m) { return m && m.__ddOpen; })[0];
    // النظام الأصلي لا يضع علامة، فنعتمد على عنوان النافذة كحلّ أخير
    if (!open) {
      var ttl = document.querySelector('.dd-title');
      var txt = ttl ? ttl.textContent : '';
      var mm = ms.filter(function (m) {
        return txt.indexOf(m.homeName || '~') > -1 && txt.indexOf(m.awayName || '~') > -1;
      })[0];
      open = mm || null;
    }
    if (!open) return null;
    return currentSide() === 'home' ? open.homeId : open.awayId;
    }

  function copyLast() {
    var tid = currentTeamId();
    if (!tid) { toast('تعذّر تحديد الفريق — احفظ ثم أعد الفتح'); return; }

    var ms = (window.matches || []).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) ||
             ((b.round || 0) - (a.round || 0));
    });
    var src = null;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var lu = (m.homeId === tid) ? m.homeLineup : (m.awayId === tid) ? m.awayLineup : null;
      if (lu && lu.players && lu.players.length) { src = lu; break; }
    }
    if (!src) { toast('لا توجد تشكيلة سابقة لهذا الفريق'); return; }

    var starters = src.players.filter(function (p) { return !p.isSub; });
    var target = rows().filter(function (r) { return !isSubRow(r); });
    target.forEach(function (r, i) {
      var p = starters[i];
      if (!p) return;
      var idx = rowIdx(r);
      try {
        window.ddUpdatePlayer(idx, 'name', p.name || '');
        window.ddUpdatePlayer(idx, 'number', p.number || '');
        if (p.position) window.ddUpdatePlayer(idx, 'position', p.position);
      } catch (e) {}
    });
    refresh();
    toast('نُسخت آخر تشكيلة — عدّل ما تغيّر فقط');
  }

  /* ─────────────────────────────────────────────────────────────
     ③ التشكيلة المتوقّعة
     ───────────────────────────────────────────────────────────── */
  var _predicted = false;

  function renderPredictedToggle() {
    var foot = document.querySelector('.dd-footer');
    if (!foot || $('lpPredWrap')) return;
    var w = document.createElement('button');
    w.type = 'button';
    w.id = 'lpPredWrap';
    w.className = 'lp-pred';
    foot.insertBefore(w, foot.firstChild);
    w.addEventListener('click', function () {
      _predicted = !_predicted;
      paintPred();
      toast(_predicted
        ? 'ستُنشر كـ «تشكيلة متوقّعة» — يظهر الوسم للجمهور'
        : 'ستُنشر كتشكيلة رسمية مؤكَّدة');
    });
    paintPred();
  }
  function paintPred() {
    var w = $('lpPredWrap');
    if (!w) return;
    w.classList.toggle('on', _predicted);
    w.innerHTML = (_predicted ? '🔮 ' : '✅ ') +
      (_predicted ? 'تُنشر كمتوقّعة' : 'تُنشر كمؤكَّدة');
    var b = document.querySelector('.dd-save-btn');
    if (b && !b.disabled) {
      b.textContent = _predicted ? '💾 نشر التشكيلة المتوقّعة' : '💾 حفظ للجمهور';
    }
  }

  /* نغلّف الحفظ: نترك النظام الأصلي يكتب كل شيء، ثم نلحق الوسم فقط.
     لا نعيد بناء cleanPlayers ولا نلمس بنية البيانات — فأي تطوير
     لاحق على الحفظ الأصلي يبقى ساري المفعول تلقائياً. */
  function wrapSave() {
    var orig = window.ddSaveToFirebase;
    if (typeof orig !== 'function' || orig.__lpWrapped) return;
    var wrapped = async function () {
      var mid = null, side = currentSide();
      var ttl = document.querySelector('.dd-title');
      var txt = ttl ? ttl.textContent : '';
      var mm = (window.matches || []).filter(function (m) {
        return txt.indexOf(m.homeName || '~') > -1 && txt.indexOf(m.awayName || '~') > -1;
      })[0];
      if (mm) mid = mm.id;

      var r = await orig.apply(this, arguments);

      // إلحاق الوسم بعد نجاح الحفظ الأصلي — لا يعطّله لو فشل
      try {
        if (mid && window._db && window._firestoreDoc && window._firestoreUpdateDoc) {
          var lid = window._getLeagueId && window._getLeagueId();
          if (lid) {
            var patch = {};
            patch[(side === 'home' ? 'homeLineup' : 'awayLineup') + '.predicted'] = _predicted;
            patch['lineupPredicted'] = _predicted;
            await window._firestoreUpdateDoc(
              window._firestoreDoc(window._db, 'leagues', lid, 'matches', mid), patch);
          }
        }
      } catch (e) { /* الوسم إضافة تجميلية — لا نُفشل الحفظ لأجله */ }
      return r;
    };
    wrapped.__lpWrapped = true;
    window.ddSaveToFirebase = wrapped;
  }

  /* ─────────────────────────────────────────────────────────────
     تشغيل
     ───────────────────────────────────────────────────────────── */
  function toast(t) {
    if (typeof window.showToast === 'function') window.showToast(t, 'success');
  }
  function refresh() {
    // النظام الأصلي يعيد رسم القائمة بعد كل تعديل — ننتظر دورة ثم نعيد اللوحة
    setTimeout(renderPanel, 40);
  }

  function css() {
    if ($('lp-css')) return;
    var s = document.createElement('style');
    s.id = 'lp-css';
    s.textContent = [
      '.lp-panel{background:var(--card2,#202020);border:1px solid var(--border2,#383838);border-radius:14px;padding:12px;margin-bottom:12px;font-family:Tajawal,sans-serif}',
      '.lp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}',
      '.lp-title{font-size:12.5px;font-weight:900;color:' + GOLD2 + '}',
      '.lp-cnt{display:inline-block;min-width:20px;text-align:center;font-size:10px;padding:1px 6px;border-radius:20px;background:rgba(201,160,43,.12);color:' + GOLD + ';margin-inline-start:5px}',
      '.lp-free{font-size:10.5px;font-weight:800;color:var(--muted2,#888)}',
      '.lp-hint{font-size:10px;color:var(--muted,#5a5a5a);margin-bottom:9px;line-height:1.7}',
      '.lp-chips{display:flex;flex-wrap:wrap;gap:6px;max-height:190px;overflow-y:auto}',
      '.lp-chip{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:10px;cursor:pointer;',
      '  background:var(--card3,#262626);border:1px solid var(--border,#2c2c2c);color:var(--text,#efefef);',
      '  font-family:Tajawal,sans-serif;font-size:11.5px;font-weight:700;transition:all .13s}',
      '.lp-chip:active{transform:scale(.97)}',
      '.lp-chip.on{background:rgba(201,160,43,.10);border-color:rgba(201,160,43,.42);color:' + GOLD2 + '}',
      '.lp-n{min-width:19px;text-align:center;font-size:10px;font-weight:900;padding:1px 4px;border-radius:5px;background:rgba(255,255,255,.06);color:var(--muted2,#888)}',
      '.lp-chip.on .lp-n{background:rgba(201,160,43,.18);color:' + GOLD + '}',
      '.lp-n0{opacity:.45}',
      '.lp-ps{font-size:9.5px;font-weight:800;color:var(--muted,#5a5a5a)}',
      '.lp-tick{font-size:11px;font-weight:900;opacity:.75}',
      '.lp-tools{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}',
      '.lp-btn{flex:1;min-width:104px;padding:8px 10px;border-radius:9px;cursor:pointer;',
      '  background:var(--card3,#262626);border:1px solid var(--border2,#383838);color:var(--text,#efefef);',
      '  font-family:Tajawal,sans-serif;font-size:11px;font-weight:800}',
      '.lp-btn:active{background:rgba(255,255,255,.05)}',
      '.lp-btn-d{color:var(--red,#C0392B);border-color:rgba(192,57,43,.32)}',
      '.lp-pred{padding:9px 13px;border-radius:10px;cursor:pointer;font-family:Tajawal,sans-serif;',
      '  font-size:11.5px;font-weight:900;border:1px solid var(--border2,#383838);',
      '  background:var(--card3,#262626);color:var(--muted2,#888)}',
      '.lp-pred.on{background:rgba(201,160,43,.12);border-color:rgba(201,160,43,.42);color:' + GOLD2 + '}'
    ].join('');
    document.head.appendChild(s);
  }

  /* نراقب فتح نافذة التشكيلة بدل الاستقصاء الدائم */
  function boot() {
    css();
    new MutationObserver(function () {
      if (!$('ddPlayersList')) return;
      wrapSave();
      renderPredictedToggle();
      if (!$('lpRosterPanel')) renderPanel();
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window._lpRenderRosterPanel = renderPanel;   // للتشخيص عند الحاجة
})();
