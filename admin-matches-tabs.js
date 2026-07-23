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
  function isFin(m) { return m && m.status === 'finished'; }

  function M() { return (window._amtGetMatches && window._amtGetMatches()) || []; }
  function S() { return (window._amtGetSettings && window._amtGetSettings()) || {}; }

  /* ── التبويبات المتاحة فعلياً (لا نعرض تبويباً فارغاً) ── */
  function tabs() {
    var all = M();
    var live = all.filter(function (m) { return !isFin(m); });
    var out = [];
    if (live.some(isKO)) out.push({ id: 'ko', label: '🏆 الإقصاء' });
    if (live.some(function (m) { return !isKO(m); })) {
      out.push({ id: 'gr', label: S().type === 'groups' ? '👥 المجموعات' : '⚽ المباريات' });
    }
    // ✅ «المنتهية» يظهر فقط لو فيه مباريات منتهية فعلاً
    if (all.some(isFin)) out.push({ id: 'fin', label: '🏁 المنتهية' });
    return out;
  }

  function pick(tab) {
    var all = M();
    if (tab === 'fin') return all.filter(isFin);
    if (tab === 'ko')  return all.filter(function (m) { return !isFin(m) && isKO(m); });
    return all.filter(function (m) { return !isFin(m) && !isKO(m); });
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
             '" onclick="amtSwitch(\'' + t.id + '\')">' + t.label + '</button>';
    }).join('') + '</div>';

    /* مبدّل العرض: بالجولة / بالتاريخ */
    var md = window._amtMode || 'round';
    if (active !== 'ko') {
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

    var buckets = {}, meta = {};
    list.forEach(function (m) {
      var k, sk;
      if (active === 'ko' || (active === 'fin' && isKO(m))) {
        k = m.knockoutRoundName || 'الإقصاء';
        /* ✅ الإقصاء يُلعب بعد المجموعات — نعطيه مفتاحه الزمني في «المنتهية»
           بدل -1 الذي كان يدفعه لأسفل القائمة. */
        sk = (active === 'fin' && byDate && DG) ? (DG.sortKey(m.date) || 0)
                                                : (m.knockoutOrder || m.round || 0);
      } else if (byDate) {
        k = DG.label(m.date); sk = DG.sortKey(m.date);
      } else {
        k = 'الجولة ' + (m.round || 1); sk = m.round || 1;
      }
      if (!buckets[k]) { buckets[k] = []; meta[k] = { sk: sk, d: m.date }; }
      buckets[k].push(m);
    });
    var order = Object.keys(buckets).sort(function (a, b) {
      var d = meta[a].sk - meta[b].sk;
      return (active === 'fin' && byDate) ? -d : d;
    });

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
