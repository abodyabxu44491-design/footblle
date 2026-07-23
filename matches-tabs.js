/* ═══════════════════════════════════════════════════════════════════
 *  matches-tabs.js — تبويبات قسم المباريات
 *  ───────────────────────────────────────────────────────────────────
 *  ثلاثة أزرار ثابتة أعلى القسم:
 *      🏆 مباريات الإقصاء  ·  👥 مباريات المجموعات  ·  🏁 المنتهية
 *
 *  التبويبات تتكيّف مع نوع البطولة:
 *    • نظام دوري فقط        → "المباريات" + "المنتهية"
 *    • نظام مجموعات فقط     → "المجموعات" + "المنتهية"
 *    • نظام إقصاء فقط       → "الإقصاء"  + "المنتهية"
 *    • مجموعات + إقصاء      → الثلاثة كاملة
 *  (لا نعرض تبويباً فارغاً لا معنى له.)
 *
 *  يُحمَّل بعد viewer.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STATE_KEY = '_mtActive';

  function isKO(m) {
    return !!(m && (m.isKnockout || m.knockoutRoundId != null));
  }
  function isFinished(m) {
    return m && (m.status === 'finished' || (m.liveData && m.liveData.matchStatus === 'ended'));
  }
  /* ✅ رجعنا للسلوك القديم: كل المباريات تظهر للجمهور فور إنشائها،
     بدون الحاجة لخطوة "نشر" يدوية من المنظّم. */
  function pub() {
    return (window.matches || []);
  }

  /* ── التبويبات المتاحة فعلياً حسب البيانات ── */
  function availableTabs() {
    var list = pub();
    var live = list.filter(function (m) { return !isFinished(m); });
    var hasKO = live.some(isKO);
    var hasGR = live.some(function (m) { return !isKO(m); });
    var tabs = [];
    if (hasKO) tabs.push({ id: 'ko', label: '🏆 الإقصاء' });
    if (hasGR) {
      var t = (window.settings && window.settings.type) || '';
      tabs.push({ id: 'gr', label: t === 'groups' ? '👥 المجموعات' : '⚽ المباريات' });
    }
    // ✅ تبويب «المنتهية» يظهر فقط لو فيه مباريات منتهية فعلاً
    if (list.some(isFinished)) tabs.push({ id: 'fin', label: '🏁 المنتهية' });
    return tabs;
  }

  function filterFor(tab) {
    var list = pub().slice();
    if (tab === 'fin') return list.filter(isFinished);
    if (tab === 'ko')  return list.filter(function (m) { return !isFinished(m) && isKO(m); });
    if (tab === 'gr')  return list.filter(function (m) { return !isFinished(m) && !isKO(m); });
    return list;
  }

  window.mtSwitch = function (tab) {
    window[STATE_KEY] = tab;
    render();
  };

  /* ── رسم شريط التبويبات + القائمة ── */
  function render() {
    var host = document.getElementById('matchesList');
    if (!host) return;

    var tabs = availableTabs();
    // لا توجد مباريات إطلاقاً — رسالة واضحة بدل قسم فارغ
    if (!tabs.length) {
      host.innerHTML = '<div class="mt-empty"><div class="mt-empty-ic">\u26BD</div>' +
                       '<div>\u0644\u0645 \u062a\u064f\u0636\u064e\u0641 \u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0628\u0639\u062f</div></div>';
      return;
    }

    var active = window[STATE_KEY];
    if (!active || !tabs.some(function (t) { return t.id === active; })) {
      active = tabs[0].id;
      window[STATE_KEY] = active;
    }

    var bar = '<div class="mt-tabs">' + tabs.map(function (t) {
      return '<button class="mt-tab' + (t.id === active ? ' on' : '') +
             '" onclick="mtSwitch(\'' + t.id + '\')">' + t.label + '</button>';
    }).join('') + '</div>';

    var list = filterFor(active);

    // بحث حي (لو كان مفعّلاً في viewer)
    var q = window.searchQuery || '';
    if (q) {
      list = list.filter(function (m) {
        var T = window.teams || [];
        var ht = T.find(function (t) { return t.id === m.homeId; });
        var at = T.find(function (t) { return t.id === m.awayId; });
        var h = ((ht && ht.name) || m.homeName || '').toLowerCase();
        var a = ((at && at.name) || m.awayName || '').toLowerCase();
        return h.indexOf(q) !== -1 || a.indexOf(q) !== -1;
      });
    }

    var body;
    if (!list.length) {
      var empty = { ko: 'لا توجد مباريات إقصاء قادمة',
                    gr: 'لا توجد مباريات قادمة',
                    fin: 'لا توجد مباريات منتهية' }[active];
      body = '<div class="mt-empty"><div class="mt-empty-ic">⚽</div><div>' + empty + '</div></div>';
    } else {
      body = groupAndRender(list, active);
    }

    host.innerHTML = bar + '<div class="mt-body">' + body + '</div>';

    // شغّل عدّادات المباريات المباشرة
    list.filter(function (m) { return m.status === 'live'; })
        .forEach(function (m) {
          if (typeof window._startCard2Clock === 'function') window._startCard2Clock(m);
        });
  }

  /* ── التجميع: الإقصاء حسب الدور · المجموعات حسب الجولة ── */
  function groupAndRender(list, tab) {
    var card = window._matchCard;
    if (typeof card !== 'function') return '';
    var DG = window.DateGroups;

    /* ✅ التجميع بالتاريخ: «اليوم · غداً · السبت · 26 يوليو».
       أهم ما يريده المتابع هو «ما الذي يُلعب اليوم؟» — لا رقم الجولة.
       المنتهية تُجمَّع بالتاريخ تنازلياً (الأحدث أولاً)،
       والإقصاء يبقى بالدور لأن الشجرة أوضح من التاريخ. */
    /* ✅ التجميع بالتاريخ يحتاج تواريخ فعلية. لو أغلب المباريات بلا تاريخ
       نعود للتجميع بالجولة حتى لا يختلّ الترتيب (الجولة ١ ثم ٢ ثم ٣...). */
    var withDate = list.filter(function (m) { return m && m.date; }).length;
    var byDate = DG && tab !== 'ko' && list.length > 0 && (withDate / list.length) >= 0.5;

    var buckets = {}, meta = {};
    list.forEach(function (m) {
      var key, sk;
      if (tab === 'ko' || (tab === 'fin' && isKO(m))) {
        key = m.knockoutRoundName || 'الإقصاء';
        /* ✅ الإقصاء يأتي بعد المجموعات زمنياً — لا يُدفع للأسفل بمفتاح 0.
           في «المنتهية» نستخدم تاريخ المباراة ليأخذ ترتيبه الزمني الصحيح،
           وفي تبويب «الإقصاء» يكفي ترتيب الأدوار. */
        sk = (tab === 'fin' && DG) ? (DG.sortKey(m.date) || 0) : (m.knockoutOrder || m.round || 0);
      } else if (byDate) {
        key = DG.label(m.date);
        sk  = DG.sortKey(m.date);
      } else {
        key = (m.round || 0) > 0 ? 'الجولة ' + m.round : 'مباريات';
        sk  = m.round || 0;
      }
      if (!buckets[key]) { buckets[key] = []; meta[key] = { sk: sk, d: m.date }; }
      buckets[key].push(m);
    });

    var order = Object.keys(buckets).sort(function (a, b) {
      var d = meta[a].sk - meta[b].sk;
      return tab === 'fin' ? -d : d;   // المنتهية: الأحدث أولاً
    });

    return order.map(function (k) {
      var tone = (byDate && DG) ? DG.tone(meta[k].d) : '';
      var n = buckets[k].length;
      return '<div class="mt-group' + (tone ? ' mt-g-' + tone : '') + '">' +
               '<span>' + k + '</span>' +
               '<span class="mt-g-n">' + n + '</span>' +
             '</div>' +
             buckets[k].map(function (m) { return card(m); }).join('');
    }).join('');
  }

  /* ── سجّل نفسك: renderMatches تُفوّض إلينا من داخلها ── */
  function hook() {
    if (typeof window.renderMatches !== 'function' || !document.getElementById('matchesList')) {
      setTimeout(hook, 120); return;
    }
    window._mtRender = render;   // renderMatches تستدعيها في أول سطر
    render();
    // console.log('[matches-tabs] ✅ التبويبات مفعّلة');
  }
  hook();
})();
