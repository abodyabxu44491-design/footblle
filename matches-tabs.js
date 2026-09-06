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
  /* ترتيب المنتهية: الأحدث أوّلاً — نفس معيار صفحة الإدارة حرفياً
     (تاريخ ثم وقت ثم جولة ثم معرّف) فلا يختلف ما يراه المنظّم عمّا يراه
     الجمهور. */
  function _finKey(m) {
    return (m && m.date ? String(m.date) : '0000-00-00') + 'T' +
           (m && m.time ? String(m.time) : '00:00');
  }
  function _finDesc(a, b) {
    // مفوَّضة إلى النواة المشتركة (match-core.js)
    return window.MatchCore ? window.MatchCore.newestFirst(a, b) : 0;
  }


  function isFinished(m) {
    return m && (m.status === 'finished' || (m.liveData && m.liveData.matchStatus === 'ended'));
  }
  /* ✅ رجعنا للسلوك القديم: كل المباريات تظهر للجمهور فور إنشائها،
     بدون الحاجة لخطوة "نشر" يدوية من المنظّم. */
  function pub() {
    return (window.matches || []);
  }

  /* ── دور المواجهة (ذهاب/إياب) ──
     نقرأ عبر _legOf الموحّد لأن المنصة كتبت الحقل باسمين: `leg` في
     الدوري/المجموعات و`legNo` في الإقصاء. */
  function legOf(m) {
    if (typeof window._legOf === 'function') return window._legOf(m);
    var v = (m && m.legNo != null) ? m.legNo : (m && m.leg);
    var n = parseInt(v, 10);
    return (n === 1 || n === 2) ? n : 0;
  }
  /* هل تحتوي هذه القائمة على ذهاب **وإياب** معاً؟ عندها فقط يظهر
     المبدّل — لا معنى لزرّي تنقل والبطولة ذهاب فقط. */
  function hasBothLegs(list) {
    var a = false, b = false;
    for (var i = 0; i < list.length; i++) {
      var L = legOf(list[i]);
      if (L === 1) a = true; else if (L === 2) b = true;
      if (a && b) return true;
    }
    return false;
  }
  var LEG_KEY = '_mtLeg';        // 0 = الكل · 1 = ذهاب · 2 = إياب

  /* ── التبويبات المتاحة فعلياً حسب البيانات ── */
  /* مباراة ملحق — لها تبويبها المستقلّ كي لا تختلط بمباريات الدور الأول
     ولا بالإقصاء، فالملحق دور قائم بذاته بقواعده ومقاعده. */
  function isPO(m) { return m && m.isPlayoff === true; }

  /* ══ التبويبات ══
     🔴 كانت مبنيّة على **نوع المباراة** (إقصاء · ملحق · مجموعات) ثم
     «المنتهية» في آخرها. والجمهور يسأل عن **الحالة** أوّلاً: ما الجاري
     الآن؟ وما آخر ما انتهى؟ — وهي مبعثرة على التبويبات كلها.
     الترتيب الجديد بالحالة، ثم النوع للقادمة وحدها. ولكل تبويب عدّاده
     فيُعرف ما فيه قبل فتحه — نفس نسق قسم بطاقات المشاركة. */
  function isLiveM(m) { return m && m.status === 'live'; }
  function isUpM(m)   { return m && m.status === 'upcoming'; }

  function availableTabs() {
    var list = pub();
    var live = list.filter(isLiveM);
    var fin  = list.filter(isFinished);
    var up   = list.filter(isUpM);
    var upKO = up.filter(function (m) { return !isPO(m) && isKO(m); });
    var upPO = up.filter(isPO);

    var tabs = [{ id: 'all', label: 'الكل', n: list.length }];
    if (live.length) tabs.push({ id: 'live', label: 'مباشرة', n: live.length });
    if (fin.length)  tabs.push({ id: 'fin',  label: 'منتهية', n: fin.length });
    if (up.length)   tabs.push({ id: 'up',   label: 'قادمة',  n: up.length });
    if (upKO.length) tabs.push({ id: 'ko',   label: 'الإقصاء', n: upKO.length });
    if (upPO.length) {
      var pn = (window.settings && window.settings.playoff && window.settings.playoff.name) || 'الملحق';
      tabs.push({ id: 'po', label: pn, n: upPO.length });
    }
    return tabs;
  }

  function filterFor(tab) {
    var list = pub().slice();
    if (tab === 'all')  return list;
    if (tab === 'live') return list.filter(isLiveM);
    if (tab === 'fin')  return list.filter(isFinished);
    if (tab === 'up')   return list.filter(isUpM);
    if (tab === 'ko')   return list.filter(function (m) { return isUpM(m) && !isPO(m) && isKO(m); });
    if (tab === 'po')   return list.filter(function (m) { return isUpM(m) && isPO(m); });
    return list;
  }

  window.mtSwitch = function (tab) {
    window[STATE_KEY] = tab;
    render();
  };

  window.mtSwitchLeg = function (leg) {
    window[LEG_KEY] = leg;
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
             '" onclick="mtSwitch(\'' + t.id + '\')">' + t.label +
             '<span class="mt-tab-n">' + (t.n || 0) + '</span></button>';
    }).join('') + '</div>';

    var list = filterFor(active);

    /* ── مبدّل الذهاب/الإياب ──
       يظهر فقط إذا كان التبويب الحالي يحوي الدورين معاً. الفلترة تُطبَّق
       بعد تحديد التبويب مباشرة كي يبقى العدّ في العناوين صحيحاً. */
    var legBar = '';
    if (hasBothLegs(list)) {
      var curLeg = window[LEG_KEY] || 0;
      var LEGS = [{ v: 0, t: 'الكل' }, { v: 1, t: 'الذهاب' }, { v: 2, t: 'الإياب' }];
      legBar = '<div class="mt-legs">' + LEGS.map(function (L) {
        return '<button class="mt-leg' + (L.v === curLeg ? ' on' : '') +
               '" onclick="mtSwitchLeg(' + L.v + ')">' + L.t + '</button>';
      }).join('') + '</div>';
      if (curLeg) list = list.filter(function (m) { return legOf(m) === curLeg; });
    } else if (window[LEG_KEY]) {
      window[LEG_KEY] = 0;      // لا دورين هنا — صفّر الاختيار كي لا يفرغ التبويب
    }

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

    host.innerHTML = bar + legBar + '<div class="mt-body">' + body + '</div>';

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
    var _isAll = (tab === 'all');
    var _finSorted = (tab === 'fin' || _isAll);
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
      var key, sk;
      if (tab === 'ko' || (tab === 'fin' && isKO(m))) {
        key = m.knockoutRoundName || 'الإقصاء';
        /* ✅ الإقصاء يأتي بعد المجموعات زمنياً — لا يُدفع للأسفل بمفتاح 0.
           في «المنتهية» نستخدم تاريخ المباراة ليأخذ ترتيبه الزمني الصحيح،
           وفي تبويب «الإقصاء» يكفي ترتيب الأدوار. */
        /* 🔴 في «المنتهية» كانت أدوار الإقصاء تُرتَّب بتاريخها فتتداخل مع
           جولات المجموعات. والقارئ يتوقّع بنية البطولة: دور المجموعات
           أولاً ثم الإقصاء — والإقصاء خاتمة البطولة فمكانه الأسفل.
           نطرح إزاحة كبيرة من مفتاح ترتيبها فتقع دائماً بعد الجولات مهما
           كان تاريخها، ويبقى ترتيبها بينها زمنياً صحيحاً. */
        /* 🔴 مباريات الإقصاء كثيراً ما تُسجَّل **بلا تاريخ** — فيسقط مفتاح
           الترتيب إلى صفر لكل أدوارها، ويعود الترتيب إلى ترتيب الإنشاء:
           ربع النهائي أولاً والنهائي أخيراً. أي عكس المطلوب تماماً.
           البديل عند غياب التاريخ: ترتيب الدور نفسه (النهائي أكبر). */
        var _dk = DG ? (DG.sortKey(m.date) || 0) : 0;
        sk = _finSorted
             ? (_dk || (m.knockoutOrder || m.round || 0))
             : (m.knockoutOrder || m.round || 0);
      } else if (byDate) {
        key = DG.label(m.date);
        sk  = DG.sortKey(m.date);
      } else {
        /* عند عرض الدورين معاً نُلحق «ذهاب/إياب» بعنوان الجولة، وإلا
           ظهرت «الجولة ٣» مرتين بلا ما يميّزهما. */
        var _lg = legOf(m);
        var _lgTxt = (!window[LEG_KEY] && _lg) ? ' · ' + (_lg === 1 ? 'ذهاب' : 'إياب') : '';
        key = (m.round || 0) > 0 ? 'الجولة ' + m.round + _lgTxt : 'مباريات';
        sk  = m.round || 0;
      }
      if (!buckets[key]) { buckets[key] = []; meta[key] = { sk: _finSorted ? (-(_seq++)) : sk, d: m.date }; }
      /* 🔴 مفتاح ترتيب المجموعة كان يُؤخذ من **أول** مباراة تدخلها. فمجموعة
         فيها مباراة قديمة وأخرى حديثة تُرتَّب بالقديمة — فتظهر آخر مباراة
         لُعبت في أسفل القائمة رغم أنها الأحدث.
         نأخذ **أحدث** مباراة في المجموعة مفتاحاً لها، فيصير أعلى القائمة
         دائماً آخر ما لُعب فعلاً. */
      else if (!_finSorted && sk > meta[key].sk) { meta[key].sk = sk; meta[key].d = m.date; }
      buckets[key].push(m);
    });

    var order = Object.keys(buckets).sort(function (a, b) {
      var d = meta[a].sk - meta[b].sk;
      return _finSorted ? -d : d;   // المنتهية: الأحدث أولاً
    });
    /* 🔴 ترتيب المجموعات كان معكوساً للمنتهية، لكن المباريات **داخل** كل
       مجموعة تبقى تصاعدية — فآخر مباراة انتهت في يومها تظهر أسفل يومها.
       نعكس الداخل أيضاً ليكون الأحدث أوّلاً في كل المستويات. */
    if (_finSorted) {
      order.forEach(function (k) { buckets[k] = buckets[k].slice().sort(_finDesc); });
    }

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
