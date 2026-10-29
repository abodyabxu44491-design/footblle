/* ═══════════════════════════════════════════════════════════════════
 *  standings-core.js — v338.6
 *  مصدر الحقيقة الوحيد لحساب جدول الترتيب
 *  ───────────────────────────────────────────────────────────────────
 *  لماذا وُجد هذا الملف:
 *    كانت المنصة تحوي **أربع** نسخ مستقلة لحساب الترتيب:
 *      ① admin.js  → recalcStandings        (الجدول العام — الإدارة)
 *      ② viewer.js → renderStandings        (الجدول العام — الجمهور)
 *      ③ viewer.js → computeGroupStats      (المجموعات — الجمهور)
 *      ④ admin.js  → _computeGroupStats     (المجموعات — الإدارة)
 *    ولم تكن أيٌّ منها متفقة مع الأخرى: واحدة تشترط نتيجة رقمية
 *    وأخرى لا، وواحدة تستبعد الإقصاء وأخرى تحتسبه، وواحدة تطرح خصم
 *    النقاط وأخرى تتجاهله. فكان المنظّم يرى جدولاً والجمهور آخر.
 *    وُحِّدت نتائجها في مراجعة سابقة، لكن النسخ بقيت أربعاً — أي أن
 *    كل إصلاح لاحق يحتاج تطبيقاً أربع مرات، وكل نسيان يخلق تبايناً
 *    جديداً. هذا الملف يُنهي الدَّين: حسبة واحدة يستدعيها الجميع.
 *
 *  قاعدة السلامة:
 *    الملف **إضافة لا استبدال**. كل موضع استدعاء يُفوّض إلى هنا إن
 *    وُجد StandingsCore، وإلا يعمل بشيفرته القديمة كما هي. فلو تعذّر
 *    تحميل هذا الملف لأي سبب، لا ينكسر شيء إطلاقاً.
 *
 *  بلا أي اعتماد خارجي — لا Firebase ولا DOM. مدخلات ومخرجات فقط،
 *  وهذا ما يجعله قابلاً للاختبار المنطقي وحده.
 * ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── ما الذي يدخل الجدول؟ ─────────────────────────────────────
     شرط واحد مكتوب مرة واحدة. كان مكرّراً في أربعة مواضع باختلافات
     صامتة — وهو أصل التباين بين اللوحة والجمهور.
       • منتهية فقط
       • بلا مباريات الإقصاء (الجدول يخصّ الدور الدوري وحده)
       • بنتيجة **رقمية**: مباراة موسومة finished ونتيجتها null كانت
         تُقرأ (null||0) في بعض النسخ فتُحتسب تعادلاً 0-0 وتمنح نقطة
         لكل فريق، بينما تتجاهلها نسخ أخرى.
       • ركلات الترجيح لا تدخل: المباراة تعادل قانوناً، والفائز
         بالركلات يتأهّل ولا يأخذ نقاطاً. */
  function isCounted(m) {
    return !!m
      && m.status === 'finished'
      && !m.isKnockout
      && !m.knockoutRoundId
      && typeof m.homeScore === 'number'
      && typeof m.awayScore === 'number';
  }

  function blank(t) {
    return {
      id: t && t.id, name: (t && t.name) || '', logo: (t && t.logo) || '',
      p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, gd: 0
    };
  }

  /**
   * حساب الجدول.
   * @param {Object}   o
   * @param {Array}    o.teams      الفرق المشمولة
   * @param {Array}    o.matches    كل المباريات (نُصفّيها هنا)
   * @param {Object}   o.settings   { winPts, drawPts }
   * @param {Function} o.deduction  (teamId) => عدد النقاط المخصومة
   * @param {String}   o.groupId    اختياري: احسب مجموعة بعينها
   * @returns {Object} map: teamId -> سطر الجدول
   */
  function compute(o) {
    o = o || {};
    var teams    = o.teams || [];
    var matches  = o.matches || [];
    var st       = o.settings || {};
    var WP       = (typeof st.winPts  === 'number') ? st.winPts  : 3;
    var DP       = (typeof st.drawPts === 'number') ? st.drawPts : 1;
    var groupId  = o.groupId || null;
    var deduct   = (typeof o.deduction === 'function') ? o.deduction : null;

    var map = {}, ids = {};
    teams.forEach(function (t) { if (t && t.id) { map[t.id] = blank(t); ids[t.id] = true; } });

    matches.forEach(function (m) {
      if (!isCounted(m)) return;
      /* داخل المجموعات: نُفضّل المطابقة بـ groupId متى كان مسجّلاً،
         ونسقط إلى عضوية الفريقين حين لا يكون — كي لا تسقط مباريات
         قديمة أُنشئت قبل إضافة الحقل. */
      if (groupId && m.groupId && m.groupId !== groupId) return;
      if (!ids[m.homeId] || !ids[m.awayId]) return;

      var h = map[m.homeId], a = map[m.awayId];
      if (!h || !a) return;

      var hs = m.homeScore, as = m.awayScore;
      h.p++; a.p++;
      h.gf += hs; h.ga += as;
      a.gf += as; a.ga += hs;
      if (hs > as)      { h.w++; a.l++; h.pts += WP; }
      else if (hs < as) { a.w++; h.l++; a.pts += WP; }
      else              { h.d++; a.d++; h.pts += DP; a.pts += DP; }
    });

    /* خصم النقاط الإداري يُطرح **مرّة واحدة بعد** الحلقة لا داخلها —
       داخلها كان يُطرح مع كل مباراة فيتضاعف بعدد المباريات. */
    Object.keys(map).forEach(function (id) {
      var row = map[id];
      if (deduct) {
        var d = Number(deduct(id)) || 0;
        if (d) row.pts -= d;
      }
      row.gd = row.gf - row.ga;
    });

    return map;
  }

  /** نفس الحساب لكن مرتَّباً — يقبل دالّة كسر تعادل خارجية */
  function table(o) {
    var map = compute(o);
    var rows = (o.teams || [])
      .map(function (t) { return map[t && t.id]; })
      .filter(Boolean);

    var tie = (typeof (o || {}).tiebreak === 'function') ? o.tiebreak : null;
    rows.sort(function (a, b) {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (tie) { var r = tie(a, b); if (r) return r; }
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });
    return rows;
  }

  /* ═══ الترتيب الكامل مع كسر التعادل الجماعي — v339 ═══════════════
     🔴 كان الترتيب يُبنى بمقارن زوجي (applyTiebreak(a, b)). وهذا صحيح
        لفريقين فقط. أما مع ثلاثة متساوين في النقاط فالمواجهات المباشرة
        «الزوجية» قد تكون دائرية: أ فاز على ب، ب على ج، ج على أ —
        فالمقارن متناقض، وArray.sort يعطي ترتيباً اعتباطياً يتغيّر بتغيّر
        ترتيب المدخلات (أي قد يختلف بين لوحة المنظّم وصفحة الجمهور).
     الصحيح (FIFA/UEFA): **دوري مصغّر** بين كل الفرق المتساوية معاً،
     ثم يُعاد تطبيق القواعد على أي مجموعة فرعية بقيت متساوية.
     لفريقين متساويين النتيجة مطابقة حرفياً للمقارن القديم.

     @param rows  أسطر الجدول {id,name,pts,gf,ga,w,...}
     @param o     { matches, settings:{tiebreakOrder,tiebreakDisabled,winPts,drawPts},
                    cardCount:(teamId)=>عدد نقاط البطاقات }
     @returns     مصفوفة جديدة مرتّبة */
  function rank(rows, o) {
    o = o || {};
    var st = o.settings || {};
    var WP = (typeof st.winPts  === 'number') ? st.winPts  : 3;
    var DP = (typeof st.drawPts === 'number') ? st.drawPts : 1;
    var dis = st.tiebreakDisabled || [];
    var order = (st.tiebreakOrder || ['gd', 'gf', 'h2h', 'wins', 'cards', 'draw'])
      .filter(function (r) { return r !== 'draw' && dis.indexOf(r) === -1; });
    var counted = (o.matches || []).filter(isCounted);
    var cardCount = (typeof o.cardCount === 'function') ? o.cardCount : null;
    var cardMemo = {};

    /* مفتاح كل قاعدة — الأكبر يتقدّم دائماً (البطاقات بالسالب) */
    function keyFn(rule, block) {
      if (rule === 'gd')   return function (r) { return (r.gf || 0) - (r.ga || 0); };
      if (rule === 'gf')   return function (r) { return r.gf || 0; };
      if (rule === 'wins') return function (r) { return r.w || 0; };
      if (rule === 'cards') {
        if (!cardCount) return null;
        return function (r) {
          if (!(r.id in cardMemo)) cardMemo[r.id] = Number(cardCount(r.id)) || 0;
          return -cardMemo[r.id];
        };
      }
      if (rule === 'h2h') {
        var ids = {}, pts = {};
        block.forEach(function (r) { ids[r.id] = true; pts[r.id] = 0; });
        counted.forEach(function (m) {
          if (!ids[m.homeId] || !ids[m.awayId] || m.homeId === m.awayId) return;
          if (m.homeScore > m.awayScore)      pts[m.homeId] += WP;
          else if (m.homeScore < m.awayScore) pts[m.awayId] += WP;
          else { pts[m.homeId] += DP; pts[m.awayId] += DP; }
        });
        return function (r) { return pts[r.id]; };
      }
      return null;
    }

    function byName(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    }

    /* يرتّب كتلة متساوية بدءاً من القاعدة ri */
    function resolve(block, ri) {
      if (block.length < 2) return block;
      for (var i = ri; i < order.length; i++) {
        var k = keyFn(order[i], block);
        if (!k) continue;
        var buckets = {}, keys = [];
        block.forEach(function (r) {
          var v = k(r);
          if (!(v in buckets)) { buckets[v] = []; keys.push(v); }
          buckets[v].push(r);
        });
        if (keys.length < 2) continue;              // القاعدة لم تفرّق — التالية
        keys.sort(function (x, y) { return y - x; });
        var out = [];
        keys.forEach(function (v) {
          /* كتلة فرعية ما زالت متساوية: أعد القواعد من أولها عليها —
             فالمواجهات المباشرة تُحسب من جديد بين أفرادها وحدهم. */
          out = out.concat(resolve(buckets[v], 0));
        });
        return out;
      }
      return block.slice().sort(byName);            // «القرعة»: ثابتة بالاسم
    }

    var sorted = (rows || []).slice().sort(function (a, b) {
      return (b.pts || 0) - (a.pts || 0);
    });
    var res = [], i = 0;
    while (i < sorted.length) {
      var j = i;
      while (j < sorted.length && (sorted[j].pts || 0) === (sorted[i].pts || 0)) j++;
      res = res.concat(resolve(sorted.slice(i, j), 0));
      i = j;
    }
    return res;
  }

  root.StandingsCore = { compute: compute, table: table, rank: rank, isCounted: isCounted };

})(typeof window !== 'undefined' ? window : globalThis);
