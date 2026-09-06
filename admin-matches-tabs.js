/* ═══════════════════════════════════════════════════════════════════
 *  admin-matches-tabs.js — تبويبات قسم المباريات في الإدارة
 *  ───────────────────────────────────────────────────────────────────
 *  ثلاثة أزرار ثابتة أعلى القسم (نفس تبويبات الجمهور):
 *      🏆 الإقصاء  ·  👥 المجموعات  ·  🏁 المنتهية
 *
 *  وداخل تبويب المجموعات: الجولات مرتّبة بوضوح مع شريط تقدّم لكل جولة
 *  حتى يعرف المنظّم أين وصل — «الجولة ١ اكتملت ← انتقل للجولة ٢».
 *  الجولة الحالية (أول جولة غير مكتملة) تُفتح تلقائياً والباقي مطوي.
 *
 *  عدد الجولات يُحسب رياضياً من عدد الفرق (round-robin) — لا يُختار.
 *
 *  يُحمَّل بعد admin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function isKO(m) { return !!(m && (m.isKnockout || m.knockoutRoundId != null)); }
  /* 🔴 مباريات الملحق كانت تسقط في تبويب «المباريات» العام مختلطةً بمباريات
     الدور الأول — فلا يميّزها المنظّم ولا يجدها حين يبحث عنها. لها تبويبها
     الآن، ويظهر فقط إن وُجدت. */
  function isPO(m) { return !!(m && m.isPlayoff === true); }
  function isFin(m) { return m && m.status === 'finished'; }

  /* ترتيب المنتهية: الأحدث أوّلاً. المعيار التاريخ ثم الوقت، ثم رقم
     الجولة، ثم المعرّف — فالنتيجة ثابتة ولا تتأرجح بين إعادتَي رسم. */
  function _finKey(m) {
    return (m && m.date ? String(m.date) : '0000-00-00') + 'T' +
           (m && m.time ? String(m.time) : '00:00');
  }
  function _finDesc(a, b) {
    // مفوَّضة إلى النواة المشتركة (match-core.js)
    return window.MatchCore ? window.MatchCore.newestFirst(a, b) : 0;
  }

  window._amtFinDesc = _finDesc;

  function M() { return (window._amtGetMatches && window._amtGetMatches()) || []; }
  function S() { return (window._amtGetSettings && window._amtGetSettings()) || {}; }

  /* ══ التبويبات ══
     🔴 كانت مبنيّة على **نوع المباراة** (إقصاء · ملحق · مجموعات) ثم
     «المنتهية» في آخرها. فالمنظّم الباحث عن مباراة جارية الآن لا يدري في
     أي تبويب يجدها: أهي في «الإقصاء» أم «المجموعات»؟ والحالة — وهي أول
     ما يسأل عنه — مبعثرة على التبويبات كلها.
     الترتيب الجديد بالحالة أوّلاً (الكل · مباشرة · منتهية · قادمة)، ثم
     تبويبا النوع للقادمة فقط: الإقصاء والملحق لهما مواعيدهما وطبيعتهما.
     ولكل تبويب عدّاده فيُعرف ما فيه قبل فتحه. */
  function isLive(m) { return m && m.status === 'live'; }
  function isUp(m)   { return m && m.status === 'upcoming'; }
  function isPend(m) { return m && m.status === 'pending'; }
  /* ✅ مباراة إقصاء تولّدت تلقائياً من تقدّم الشجرة تُحفظ بحالة «pending»
     حتى يعبّئها المنظّم وينشرها — فهي ليست «قادمة» بعد ولا «منتهية»، وكانت
     تختفي من هذا القسم بالكامل ولا تظهر إلا داخل الشجرة نفسها. تبويب
     «الإقصاء» يحتاج يعرضها فوراً كبطاقة مستقلة تنتظر التفعيل. */
  function isKoActionable(m) { return isKO(m) && (isUp(m) || isPend(m)); }

  function tabs() {
    var all  = M();
    var live = all.filter(isLive);
    var fin  = all.filter(isFin);
    var up   = all.filter(isUp);
    var upKO = all.filter(isKoActionable);
    var upPO = up.filter(isPO);

    var out = [{ id: 'all', label: 'الكل', n: all.length }];
    if (live.length) out.push({ id: 'live', label: 'مباشرة',  n: live.length });
    if (fin.length)  out.push({ id: 'fin',  label: 'منتهية',  n: fin.length });
    if (up.length)   out.push({ id: 'up',   label: 'قادمة',   n: up.length });
    // القادمة من الإقصاء والملحق: تبويب مستقلّ لكلٍّ حين توجد
    if (upKO.length) out.push({ id: 'ko',   label: 'الإقصاء', n: upKO.length });
    if (upPO.length) out.push({ id: 'po',   label: 'الملحق',  n: upPO.length });
    return out;
  }

  function pick(tab) {
    var all = M();
    if (tab === 'all')  return all.slice();
    if (tab === 'live') return all.filter(isLive);
    if (tab === 'fin')  return all.filter(isFin);
    if (tab === 'up')   return all.filter(isUp);
    if (tab === 'ko')   return all.filter(isKoActionable);
    if (tab === 'po')   return all.filter(function (m) { return isUp(m) && isPO(m); });
    return all.slice();
  }

  window.amtSwitch = function (t) { window._amtTab = t; render(); };
  window.amtMode = function (m) { window._amtMode = m; window._amtCollapsed = {}; render(); };
  window.amtToggleRound = function (key) {
    window._amtCollapsed = window._amtCollapsed || {};
    window._amtCollapsed[key] = !window._amtCollapsed[key];
    render();
  };

  /* ── رسم مجموعة جولة واحدة مع شريط تقدّمها ── */
  function roundBlock(key, list, collapsed, isCurrent) {
    var card = window.renderMatchCard;
    var done = list.filter(isFin).length;
    var live = list.filter(function (m) { return m.status === 'live'; }).length;
    var pending = list.filter(function (m) { return m.status === 'pending'; }).length;
    var total = list.length;
    var pct = total ? Math.round(done / total * 100) : 0;
    var complete = done === total && total > 0;

    /* رقم الجولة لزر النشر (بالوضع «بالجولة» فقط) */
    var rnd = (window._amtMode !== 'date') ? (parseInt(String(key).replace(/\D+/g, '')) || null) : null;
    var pubBtn = (pending > 0 && rnd != null)
      ? '<button class="amt-pub" onclick="event.stopPropagation();publishPendingMatches(' + rnd + ')">نشر ' + pending + ' للجمهور</button>'
      : '';

    var badge = complete
      ? '<span class="amt-chip amt-chip-done">اكتملت</span>'
      : (live ? '<span class="amt-chip amt-chip-live">' + live + ' مباشر</span>'
              : (pending === total && total > 0 ? '<span class="amt-chip amt-chip-pend">غير منشورة</span>'
              : (isCurrent ? '<span class="amt-chip amt-chip-now">' + (window._amtMode === 'date' ? 'التالية' : 'الجولة الحالية') + '</span>' : '')));

    return '<div class="amt-round' + (complete ? ' done' : '') + (isCurrent ? ' current' : '') + '">' +
      '<div class="amt-round-head" onclick="amtToggleRound(\'' + key.replace(/'/g, "\\'") + '\')">' +
        '<span class="amt-caret">' + (collapsed ? '▸' : '▾') + '</span>' +
        '<span class="amt-round-name">' + key + '</span>' +
        badge +
        pubBtn +
        '<span class="amt-spacer"></span>' +
        '<span class="amt-count">' + done + '/' + total + '</span>' +
      '</div>' +
      '<div class="amt-bar"><div class="amt-bar-fill" style="width:' + pct + '%"></div></div>' +
      (collapsed ? '' : '<div class="amt-round-body">' +
        list.map(function (m) { return card(m); }).join('') + '</div>') +
    '</div>';
  }

  function render() {
    var host = document.getElementById('matchesList');
    if (!host || typeof window.renderMatchCard !== 'function') return;

    var all = M();
    if (!all.length) {
      host.innerHTML = '<div class="empty-state">' +
        '<div>لا توجد مباريات — أضف مباراة أو استخدم التوليد التلقائي</div></div>';
      return;
    }

    var T = tabs();
    var active = window._amtTab;
    if (!active || !T.some(function (t) { return t.id === active; })) {
      active = T[0].id; window._amtTab = active;
    }

    var bar = '<div class="amt-tabs">' + T.map(function (t) {
      return '<button class="amt-tab' + (t.id === active ? ' on' : '') +
             '" onclick="amtSwitch(\'' + t.id + '\')">' + t.label +
             '<span class="amt-tab-n">' + (t.n || 0) + '</span></button>';
    }).join('') + '</div>';

    /* مبدّل العرض: بالجولة / بالتاريخ */
    var md = window._amtMode || 'round';
    if (active !== 'ko' && active !== 'po') {
      bar += '<div class="amt-mode">' +
        '<button class="amt-m' + (md === 'round' ? ' on' : '') + '" onclick="amtMode(\'round\')">بالجولة</button>' +
        '<button class="amt-m' + (md === 'date'  ? ' on' : '') + '" onclick="amtMode(\'date\')">بالتاريخ</button>' +
      '</div>';
    }

    var list = pick(active);
    if (!list.length) {
      var e = { ko: 'لا توجد مباريات إقصاء', gr: 'لا توجد مباريات قادمة', fin: 'لا توجد مباريات منتهية' }[active];
      host.innerHTML = bar + '<div class="empty-state" style="padding:36px 20px">' +
        '<div>' + e + '</div></div>';
      return;
    }

    /* ✅ التجميع: بالجولة (افتراضي — يُظهر تقدّم المنظّم)
       أو بالتاريخ (اليوم · غداً · السبت) بضغطة زر.
       الإقصاء يبقى بالدور دائماً — الشجرة أوضح من التاريخ. */
    var DG = window.DateGroups;
    var mode = window._amtMode || 'round';
    var byDate = DG && mode === 'date' && active !== 'ko';

    /* ══ المنتهية: قاعدة واحدة قاطعة ══
       🔴 كان الترتيب يتفرّع: التاريخ إن وُجد، وإلا ترتيب الدور، ومفتاح
       المجموعة من أحدث مباراة… وكل فرع يتعثّر في حالة: الإقصاء بلا
       تواريخ، أو جولات بلا تواريخ، أو خليط منهما — فيختلف الناتج بلا
       قاعدة يفهمها المستخدم.
       الآن: تُرتَّب **كل** المباريات المنتهية تنازلياً أوّلاً (آخر ما
       لُعب أوّلاً)، ثم تُكوَّن المجموعات **بترتيب ظهورها** في تلك القائمة.
       فالمجموعة التي تضمّ آخر مباراة تعلو حتماً، وداخلها الأحدث أوّلاً —
       بلا فروع ولا استثناءات. */
    /* 🔴 «الكل» كان يرتّب بالتاريخ تنازلياً فتتصدّره **المباريات القادمة**
       لأن تواريخها أبعد — والقادمة لم تُلعب بعد، فتصدّرها بلا معنى.
       ترتيب «الكل» بالحالة أوّلاً: الجارية الآن، ثم آخر ما انتهى، ثم
       الأقرب موعداً. وداخل كل حالة الترتيب المناسب لها. */
    var _isAll = (active === 'all');
    var _finSorted = (active === 'fin' || _isAll);
    if (_isAll) {
      /* ترتيب «الكل»: الجارية الآن، ثم **القادمة** (الأقرب موعداً أوّلاً)،
         ثم المنتهية (الأحدث أوّلاً). القادمة تسبق المنتهية لأنها ما يعنيه
         المتابع الآن: ما الذي سيُلعب؟ والمنتهية مرجع يُرجع إليه بعدها. */
      list = list.slice().sort(function (x, y) {
        return window.MatchCore ? window.MatchCore.allOrder(x, y) : 0;
      });
    } else if (_finSorted) {
      list = list.slice().sort(_finDesc);
    }
    var _seq = 0;

    var buckets = {}, meta = {};
    list.forEach(function (m) {
      var k, sk;
      if (active === 'po' || (active === 'fin' && isPO(m))) {
        var _pg = (m.poGroup != null) ? ('مجموعة الملحق ' + String.fromCharCode(65 + m.poGroup)) : 'مباريات الملحق';
        k = _pg; sk = 0;
      } else if (active === 'ko' || (active === 'fin' && isKO(m))) {
        k = m.knockoutRoundName || 'الإقصاء';
        /* ✅ الإقصاء يُلعب بعد المجموعات — نعطيه مفتاحه الزمني في «المنتهية»
           بدل -1 الذي كان يدفعه لأسفل القائمة. */
        /* في «المنتهية» تُطرح إزاحة كبيرة من مفتاح أدوار الإقصاء فتقع
           دائماً **بعد** جولات المجموعات مهما كان تاريخها — لأن الإقصاء
           خاتمة البطولة فمكانه الأسفل. ويبقى ترتيبها بينها زمنياً صحيحاً. */
        /* 🔴 مباريات الإقصاء كثيراً ما تُسجَّل **بلا تاريخ** — فيسقط مفتاح
           الترتيب إلى صفر لكل أدوارها، ويعود الترتيب إلى ترتيب الإنشاء:
           ربع النهائي أولاً والنهائي أخيراً. أي عكس المطلوب تماماً.
           البديل عند غياب التاريخ: ترتيب الدور نفسه (النهائي أكبر). */
        var _dk = DG ? (DG.sortKey(m.date) || 0) : 0;
        sk = _finSorted
             ? (_dk || (m.knockoutOrder || m.round || 0))
             : (m.knockoutOrder || m.round || 0);
      } else if (byDate) {
        k = DG.label(m.date); sk = DG.sortKey(m.date);
      } else {
        k = 'الجولة ' + (m.round || 1); sk = m.round || 1;
      }
      if (!buckets[k]) { buckets[k] = []; meta[k] = { sk: _finSorted ? (-(_seq++)) : sk, d: m.date }; }
      // أحدث مباراة في المجموعة هي مفتاح ترتيبها — فآخر ما لُعب يعلو القائمة
      else if (!_finSorted && sk > meta[k].sk) { meta[k].sk = sk; meta[k].d = m.date; }
      buckets[k].push(m);
    });
    /* 🔴 المنتهية كانت مرتّبة تصاعدياً (الأقدم فوق) إلا حين التجميع
       بالتاريخ. والمنظّم يبحث دائماً عن **آخر** مباراة انتهت لا أوّلها —
       فيضطر للتمرير إلى الأسفل في كل مرة.
       المنتهية تنازلياً دائماً: الأحدث أوّلاً، في ترتيب المجموعات
       وداخل كل مجموعة معاً. وغير المنتهية تبقى تصاعدياً لأن القادم
       الأقرب هو المقصود. */
    var order = Object.keys(buckets).sort(function (a, b) {
      var d = meta[a].sk - meta[b].sk;
      return (active === 'fin' || active === 'all') ? -d : d;
    });
    if (_finSorted) {
      order.forEach(function (k) { buckets[k] = buckets[k].slice().sort(_finDesc); });
    }

    /* الجولة الحالية = أول جولة غير مكتملة */
    var currentKey = null;
    for (var i = 0; i < order.length; i++) {
      var b = buckets[order[i]];
      if (b.filter(isFin).length < b.length) { currentKey = order[i]; break; }
    }

    var col = window._amtCollapsed = window._amtCollapsed || {};
    var body = order.map(function (k) {
      // الافتراضي: الجولة الحالية مفتوحة، والمكتملة مطوية
      if (col[k] === undefined) col[k] = (k !== currentKey && active !== 'fin');
      return roundBlock(k, buckets[k], col[k], k === currentKey);
    }).join('');

    host.innerHTML = bar + body;
  }

  function hook() {
    if (typeof window.renderMatchCard !== 'function' || !document.getElementById('matchesList')) {
      setTimeout(hook, 150); return;
    }
    window._amtRender = render;
    render();
    // console.log('[admin-matches-tabs] ✅ تبويبات الإدارة مفعّلة');
  }
  hook();
})();
