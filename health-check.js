/* ═══════════════════════════════════════════════════════════════════
 *  health-check.js — فحص سلامة البطولة
 *  ───────────────────────────────────────────────────────────────────
 *  الفكرة: بدل أن يكتشف المنظّم «الخبص» بعد أسبوع من جدول ترتيب خاطئ،
 *  نعرض له لوحة تشخيص فورية تقول بالضبط ما الخطأ وكيف يُصلح.
 *
 *  يفحص:
 *    ① مباريات مكررة (نفس الفريقين أكثر من المسموح)
 *    ② عدد الجولات ≠ الحساب الرياضي
 *    ③ عدد المباريات ≠ n×(n-1)/2
 *    ④ فرق بلا مجموعة
 *    ⑤ مباريات بين مجموعتين مختلفتين
 *    ⑥ فريق يلعب مرتين في نفس الجولة
 *    ⑦ مباريات بلا تاريخ
 *
 *  كل تحذير معه سببه وحلّه — لا رسائل غامضة.
 *  يُحمَّل بعد admin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function S()  { return window.settings || {}; }
  function M()  { return (window.matches || []).filter(function (m) { return !m.isKnockout; }); }
  function T()  { return window.teams || []; }
  function G()  { return window.adminGroups || []; }

  function nameOf(id) {
    var t = T().find(function (x) { return x.id === id; });
    return (t && t.name) || '؟';
  }
  function pairKey(m) {
    return [m.homeId, m.awayId].sort().join('|');
  }

  /* ── الفحص ── */
  function run() {
    var s = S(), ms = M(), ts = T(), gs = G();
    var dbl = (s.legMode || 'single') === 'double';
    var maxMeet = dbl ? 2 : 1;
    var isGroups = s.type === 'groups';
    var out = [];

    if (!ms.length) {
      return [{ lvl: 'todo', go: 'matches', t: 'لم تُضَف أي مباراة بعد',
                d: 'الفحص يقارن الجدول بالنظام المختار، ولا شيء ليقارنه الآن.',
                fix: 'ابدأ من «إضافة مباراة» أو ولّد الجدول من صفحة المجموعات' }];
    }

    // ① مباريات مكررة
    var pairs = {};
    ms.forEach(function (m) {
      var k = pairKey(m);
      (pairs[k] = pairs[k] || []).push(m);
    });
    var dups = Object.keys(pairs).filter(function (k) { return pairs[k].length > maxMeet; });
    /* 🔴 مباراة واحدة زائدة كانت تُنتج ثلاثة بنود: «مواجهة مكررة» و«مباراة
       زائدة عن الجدول» و«جولات أكثر من اللازم» — ثلاث رسائل لسبب واحد،
       فيظنّ المنظّم أن عنده ثلاث مشكلات ويفقد الثقة في القائمة.
       البند الأول هو الأدقّ (يسمّي الفريقين)، فنكتفي به ونُسقط تابعيه. */
    var hasDup = dups.length > 0;
    if (dups.length) {
      var ex = dups.slice(0, 3).map(function (k) {
        var g = pairs[k];
        return nameOf(g[0].homeId) + ' ضد ' + nameOf(g[0].awayId) + ' (' + g.length + ' مرات)';
      });
      out.push({
        lvl: 'err', go: 'matches',
        t: dups.length + ' مواجهة مكررة',
        d: 'نظام «' + (dbl ? 'ذهاب وإياب' : 'ذهاب فقط') + '» يسمح بـ ' + maxMeet +
           ' لقاء بين كل فريقين، والزائد يُحتسب في الترتيب فيقلب النتيجة.\n' + ex.join('\n'),
        /* 🔴 كان الحلّ المقترح «امسح كل المباريات ثم ولّد من جديد» — وهو
           يمحو نتائج مسجّلة ومواعيد وطواقم لإصلاح مباراة واحدة زائدة. */
        fix: 'افتح المباراة الزائدة واحذفها وحدها — أبقِ الأولى بنتيجتها',
        /* الإصلاح التلقائي يحتفظ بالأقدم وبما له نتيجة، ويحذف الفائض وحده */
        auto: { kind: 'dupMatches', keys: dups }
      });
    }

    /* ② + ③ لكل مجموعة: مقارنة بالجدول الكامل
       🔴 كان الفرق عن العدد المتوقّع يُعلَن «خطأ» في الحالتين — نقصاً
       وزيادةً. والنقص ليس خطأً: منظّم أنشأ جولتين من ثلاث لم يُخطئ، بل لم
       يُكمل. أسوأ من ذلك أن الحلّ المقترح كان «امسح كل المباريات ثم ولّد من
       جديد» — يمحو نتائج مسجّلة لإصلاح نقصٍ يُسدّ بإضافة مباراة.
       الآن: النقص «لم يكتمل» مع **تسمية المواجهات الناقصة بالاسم**،
       والزيادة «يجب إصلاحه» مع تسمية الزائد ليُحذف وحده. */
    if (isGroups && gs.length) {
      gs.forEach(function (g) {
        var gt = (g.teamIds || []).length;
        if (gt < 2) return;
        var gm = ms.filter(function (m) { return m.groupId === g.id; });
        if (!gm.length) return;

        var expR = (gt % 2 === 0 ? gt - 1 : gt) * (dbl ? 2 : 1);
        var expM = (gt * (gt - 1) / 2) * (dbl ? 2 : 1);
        var actR = new Set(gm.map(function (m) { return m.round || 1; })).size;

        if (gm.length < expM) {
          // أي مواجهات لم تُجدوَل بعد؟ الإجابة أنفع من رقم مجرّد
          var played = {};
          gm.forEach(function (m) { played[pairKey(m)] = (played[pairKey(m)] || 0) + 1; });
          var ids = g.teamIds || [], miss = [];
          for (var i = 0; i < ids.length; i++) {
            for (var j = i + 1; j < ids.length; j++) {
              var k = [ids[i], ids[j]].sort().join('|');
              var have = played[k] || 0;
              for (var c = have; c < maxMeet; c++) miss.push(nameOf(ids[i]) + ' × ' + nameOf(ids[j]));
            }
          }
          out.push({
            lvl: 'todo', go: 'matches',
            t: 'المجموعة ' + g.name + ': باقي ' + (expM - gm.length) + ' مباراة',
            d: 'الجدول الكامل ' + expM + ' مباراة (' + gt + ' فرق · ' +
               (dbl ? 'ذهاب وإياب' : 'ذهاب فقط') + ')، والمُضاف ' + gm.length + '.' +
               (miss.length ? '\nالمواجهات المتبقّية: ' + miss.slice(0, 6).join(' · ') +
                 (miss.length > 6 ? ' +' + (miss.length - 6) : '') : ''),
            fix: 'أضِفها من «إضافة مباراة» — لا حاجة لمسح شيء'
          });
        } else if (gm.length > expM && !hasDup) {
          out.push({
            lvl: 'err', go: 'matches',
            t: 'المجموعة ' + g.name + ': ' + (gm.length - expM) + ' مباراة زائدة',
            d: 'الجدول الكامل ' + expM + ' مباراة والموجود ' + gm.length +
               '.\nالزائد يُحتسب في الترتيب فيقلب النتيجة النهائية.',
            fix: 'احذف الزائدة وحدها من قسم المباريات — راجع بند «مباراة مكررة» أعلاه'
          });
        }

        // الجولات: نقصها تقدّم، وزيادتها خلل في التوزيع
        if (actR < expR && gm.length >= expM) {
          out.push({
            lvl: 'warn', go: 'matches',
            t: 'المجموعة ' + g.name + ': المباريات مكتملة والجولات أقل',
            d: 'الجدول الكامل ' + expR + ' جولة والموجود ' + actR +
               '.\nبعض المباريات وُضعت في الجولة نفسها، فيلعب فريق أكثر من مرة في جولة.',
            fix: 'عدّل «رقم الجولة» للمباريات المتزاحمة من «تعديل المعلومات»'
          });
        } else if (actR > expR && !hasDup) {
          out.push({
            lvl: 'err', go: 'matches',
            t: 'المجموعة ' + g.name + ': جولات أكثر من اللازم',
            d: gt + ' فرق تعني ' + expR + ' جولة، والموجود ' + actR + ' جولة.',
            fix: 'أعد المباريات الزائدة إلى جولاتها الصحيحة من «تعديل المعلومات»'
          });
        }
      });
    }

    /* ②ب نظام الدوري: لم يكن له فحص اكتمال إطلاقاً — الفحصان أعلاه
       مشروطان بنظام المجموعات. فبطولة دوري ناقصة نصف جدولها تمرّ سليمة،
       ولا يعرف المنظّم كم بقي ولا ما بقي. */
    if (!isGroups && ts.length >= 2) {
      var expML = (ts.length * (ts.length - 1) / 2) * maxMeet;
      var expRL = (ts.length % 2 === 0 ? ts.length - 1 : ts.length) * maxMeet;
      var actRL = new Set(ms.map(function (m) { return m.round || 1; })).size;

      if (ms.length < expML) {
        var playedL = {};
        ms.forEach(function (m) { playedL[pairKey(m)] = (playedL[pairKey(m)] || 0) + 1; });
        var missL = [];
        for (var a = 0; a < ts.length; a++) {
          for (var b = a + 1; b < ts.length; b++) {
            var kk = [ts[a].id, ts[b].id].sort().join('|');
            for (var c2 = (playedL[kk] || 0); c2 < maxMeet; c2++) missL.push(ts[a].name + ' × ' + ts[b].name);
          }
        }
        out.push({
          lvl: 'todo', go: 'matches',
          t: 'باقي ' + (expML - ms.length) + ' مباراة لإكمال الجدول',
          d: 'الجدول الكامل ' + expML + ' مباراة في ' + expRL + ' جولة (' + ts.length + ' فريقاً · ' +
             (dbl ? 'ذهاب وإياب' : 'ذهاب فقط') + ')، والمُضاف ' + ms.length +
             ' مباراة في ' + actRL + ' جولة.' +
             (missL.length ? '\nالمواجهات المتبقّية: ' + missL.slice(0, 6).join(' · ') +
               (missL.length > 6 ? ' +' + (missL.length - 6) : '') : ''),
          fix: 'أضِفها من «إضافة مباراة» — الاختيار السريع يختصرها إلى ضغطتين'
        });
      } else if (ms.length > expML && !hasDup) {
        out.push({
          lvl: 'err', go: 'matches',
          t: (ms.length - expML) + ' مباراة زائدة عن الجدول',
          d: 'الجدول الكامل ' + expML + ' مباراة والموجود ' + ms.length +
             '.\nالزائد يُحتسب في الترتيب فيقلب النتيجة النهائية.',
          fix: 'احذف الزائدة وحدها — راجع بند «مواجهة مكررة» أعلاه'
        });
      }
      if (actRL > expRL && !hasDup) {
        out.push({
          lvl: 'err', go: 'matches',
          t: 'عدد الجولات أكثر من اللازم',
          d: ts.length + ' فريقاً تعني ' + expRL + ' جولة، والموجود ' + actRL + ' جولة.',
          fix: 'أعد المباريات الزائدة إلى جولاتها الصحيحة من «تعديل المعلومات»'
        });
      }
    }

    // ④ فرق بلا مجموعة
    if (isGroups && gs.length) {
      var assigned = {};
      gs.forEach(function (g) { (g.teamIds || []).forEach(function (i) { assigned[i] = 1; }); });
      var orphan = ts.filter(function (t) { return !assigned[t.id]; });
      if (orphan.length) {
        out.push({
          lvl: 'warn',
          go: 'groups', t: orphan.length + ' فريق بلا مجموعة',
          d: orphan.map(function (t) { return t.name; }).join('، '),
          fix: 'وزّعها من صفحة المجموعات'
        });
      }
    }

    // ⑤ مباريات بين مجموعتين مختلفتين
    if (isGroups && gs.length) {
      var gOf = function (id) {
        return gs.find(function (g) { return (g.teamIds || []).includes(id); });
      };
      var cross = ms.filter(function (m) {
        var a = gOf(m.homeId), b = gOf(m.awayId);
        return a && b && a.id !== b.id;
      });
      if (cross.length) {
        out.push({
          lvl: 'err',
          go: 'matches', t: cross.length + ' مباراة بين مجموعتين مختلفتين',
          d: cross.slice(0, 3).map(function (m) {
            return nameOf(m.homeId) + ' ضد ' + nameOf(m.awayId);
          }).join('\n') + '\nفرق المجموعات لا تلتقي إلا في الإقصاء.',
          fix: 'احذف هذه المباريات، أو حوّلها إلى «مباراة فاصلة بين مجموعتين» إن كانت مقصودة',
          auto: { kind: 'crossGroup', ids: cross.map(function (x) { return x.id; }) }
        });
      }
    }

    // ⑥ فريق يلعب مرتين في نفس الجولة
    var perRound = {};
    ms.forEach(function (m) {
      var r = m.round || 1;
      perRound[r] = perRound[r] || {};
      [m.homeId, m.awayId].forEach(function (id) {
        perRound[r][id] = (perRound[r][id] || 0) + 1;
      });
    });
    var clash = [];
    Object.keys(perRound).forEach(function (r) {
      Object.keys(perRound[r]).forEach(function (id) {
        if (perRound[r][id] > 1) clash.push('الجولة ' + r + ': ' + nameOf(id));
      });
    });
    if (clash.length) {
      out.push({
        lvl: 'err',
        go: 'matches', t: clash.length + ' فريق يلعب أكثر من مرة في جولة واحدة',
        d: clash.slice(0, 4).join('\n') +
           (clash.length > 4 ? '\n+' + (clash.length - 4) + ' غيرها' : '') +
           '\nالجولة تعني أن كل فريق يلعب مرة واحدة، فيختلّ توازن الجدول.',
        // الإصلاح نقلٌ لا مسح: المباراة صحيحة ورقم جولتها هو الخطأ
        fix: 'افتح إحدى المباراتين ← تعديل المعلومات ← غيّر «رقم الجولة»',
        auto: { kind: 'roundClash' }
      });
    }

    // ⑦ مباريات بلا تاريخ
    var noDate = ms.filter(function (m) { return !m.date; });
    if (noDate.length) {
      out.push({
        lvl: 'info',
        go: 'matches', t: noDate.length + ' مباراة بلا تاريخ',
        d: 'لن تظهر في فواصل التواريخ عند الجمهور.',
        fix: 'أضف التاريخ من قسم المباريات'
      });
    }

    /* ⑧ مباريات يتيمة — تشير إلى فريق محذوف
       أخطر خلل صامت: النتيجة محفوظة والفريق غير موجود، فجدول الترتيب
       ينقص نقاطاً بلا سبب ظاهر، وخانة الشجرة لا تُفتح. */
    var allMs = window.matches || [];
    var teamIds = {};
    ts.forEach(function (t) { teamIds[t.id] = 1; });
    var orphan = allMs.filter(function (m) {
      return (m.homeId && !teamIds[m.homeId]) || (m.awayId && !teamIds[m.awayId]);
    });
    if (orphan.length) {
      out.push({
        lvl: 'err',
        go: 'matches', t: orphan.length + ' مباراة تشير إلى فريق محذوف',
        d: 'الفريق حُذف والمباراة بقيت. النتائج تُحتسب لفريق غير موجود —\n' +
           'الترتيب والإحصائيات ستكون خاطئة بلا سبب ظاهر.',
        fix: 'احذف هذه المباريات من قسم المباريات',
        auto: { kind: 'orphanMatches', ids: orphan.map(function (m) { return m.id; }) }
      });
    }

    /* ⑨ الدوري الموحّد: المتأهلون مقابل سعة الشجرة */
    if (s.type === 'swiss') {
      var qn = (s.swissQualifiedIds || []).length;
      var rounds = window.adminKnockoutRounds || [];
      var firstR = rounds.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })[0];
      var cap = firstR ? (firstR.slots || 0) * 2 : 0;
      if (!qn) {
        out.push({
          lvl: 'warn', t: 'لم يُحدَّد أي متأهل لدور الإقصاء',
          d: 'شجرة الإقصاء لن تمتلئ بلا متأهلين محدَّدين.',
          fix: 'حدّدهم من لوحة المتأهلين أعلى صفحة الترتيب'
        });
      } else if (cap && qn !== cap) {
        out.push({
          lvl: qn < cap ? 'warn' : 'info',
          t: 'المتأهلون ' + qn + ' وسعة «' + firstR.name + '» ' + cap,
          d: qn < cap
            ? 'ستبقى خانات فارغة في الدور الأول.'
            : 'العدد الزائد لن يجد خانة — سيُقصّ عند التوزيع التلقائي.',
          fix: qn < cap ? 'حدّد ' + (cap - qn) + ' فريقاً إضافياً' : 'ألغِ تحديد ' + (qn - cap) + ' فريق'
        });
      }
    }

    /* ⑩ ذهاب وإياب: مواجهة ناقصة الدور */
    if (dbl) {
      var byPair = {};
      ms.forEach(function (m) {
        var k = pairKey(m);
        (byPair[k] = byPair[k] || []).push(m);
      });
      var halfPairs = Object.keys(byPair).filter(function (k) { return byPair[k].length === 1; });
      if (halfPairs.length) {
        out.push({
          lvl: 'warn',
          t: halfPairs.length + ' مواجهة بلا مباراة إياب',
          d: 'نظام البطولة «ذهاب وإياب» لكن هذه المواجهات لها مباراة واحدة فقط.\n' +
             'كل فريق سيلعب عدداً مختلفاً من المباريات — والترتيب يصير غير عادل.',
          fix: 'ولّد الجدول من جديد أو أضف مباريات الإياب الناقصة'
        });
      }
    }

    /* ⑫ تعارض الملعب والوقت — خطأ صامت لا يكشفه شيء آخر
       مباراتان في نفس الملعب واللحظة تمرّان بلا اعتراض: كل واحدة صحيحة
       وحدها، والتناقض بينهما فقط. لا يُكتشف إلا يوم المباراة. */
    var slots = {}, vClash = [];
    ms.forEach(function (m) {
      if (!m.date || !m.time || !(m.venue || '').trim()) return;
      var k = m.date + '|' + m.time + '|' + m.venue.trim();
      if (slots[k]) {
        vClash.push(m.date + ' ' + m.time + ' · ' + m.venue.trim() + ' — ' +
          nameOf(slots[k].homeId) + '×' + nameOf(slots[k].awayId) + ' و' +
          nameOf(m.homeId) + '×' + nameOf(m.awayId));
      } else slots[k] = m;
    });
    if (vClash.length) {
      out.push({
        lvl: 'err', go: 'matches',
        t: vClash.length + ' تعارض في الملعب والوقت',
        d: vClash.slice(0, 3).join('\n') + '\nمباراتان في نفس المكان واللحظة — إحداهما لن تُلعب في موعدها.',
        fix: 'غيّر وقت إحداهما أو ملعبها'
      });
    }

    /* ⑬ مباريات فات موعدها بلا نتيجة — الترتيب يبقى قديماً بصمت */
    var today = new Date().toISOString().slice(0, 10);
    var overdue = ms.filter(function (m) {
      return m.date && m.date < today && m.status !== 'finished' &&
             (m.homeScore == null || m.awayScore == null);
    });
    if (overdue.length) {
      out.push({
        lvl: 'warn', go: 'matches',
        t: overdue.length + ' مباراة مرّ موعدها بلا نتيجة',
        d: 'جدول الترتيب والهدّافون لن يعكسوا الواقع حتى تُسجَّل نتائجها.',
        fix: 'سجّل النتائج من قسم المباريات'
      });
    }

    /* ⑭ مباريات بلا ملعب */
    var noVenue = ms.filter(function (m) { return !(m.venue || '').trim(); });
    if (noVenue.length) {
      out.push({
        lvl: 'info', go: 'matches',
        t: noVenue.length + ' مباراة بلا ملعب',
        d: 'حقل الملعب فارغ — لن يعرف الجمهور أين تُقام.',
        fix: 'أضف الملعب من قسم المباريات'
      });
    }

    /* ⑮ فرق بلا شعار — تظهر بحرفها الأول في كل مكان */
    var noLogo = ts.filter(function (t) { return !t.logo; });
    if (noLogo.length) {
      out.push({
        lvl: 'info', go: 'teams',
        t: noLogo.length + ' فريق بلا شعار',
        d: noLogo.slice(0, 5).map(function (t) { return t.name; }).join('، ') +
           (noLogo.length > 5 ? ' +' + (noLogo.length - 5) : '') +
           '\nتظهر بحرفها الأول في البطاقات والشجرة وبطاقات المشاركة.',
        fix: 'أضف الشعارات من قسم الفرق'
      });
    }

    /* ⑯ نظام المجموعات: متأهلون محدَّدون بلا اعتماد ونشر
       التحديد وحده لا يُخرج الفريق إلى الشجرة — الشرط هو النشر. */
    if (isGroups) {
      var unpub = gs.filter(function (g) {
        return (g.qualifiedTeamIds || []).length && !g.qualificationPublished;
      });
      if (unpub.length) {
        out.push({
          lvl: 'warn', go: 'groups',
          t: unpub.length + ' مجموعة بمتأهلين غير معتمدين',
          d: 'المجموعة ' + unpub.map(function (g) { return g.name; }).join('، ') +
             '\nحُدِّد متأهلوها ولم تُضغط «اعتماد ونشر» — فلا يظهرون في الشجرة ولا للجمهور.',
          fix: 'اضغط «اعتماد ونشر» لكل مجموعة',
          auto: { kind: 'publishGroups', ids: unpub.map(function (g) { return g.id; }) }
        });
      }
    }

    /* ⑰ متأهلون جاهزون بلا خانة في الشجرة */
    var rds = window.adminKnockoutRounds || [];
    if (rds.length && typeof window._getQualifiedPool === 'function') {
      try {
        var pool = window._getQualifiedPool() || [];
        var placed = (typeof window._getPlacedKnockoutTeamIds === 'function')
          ? window._getPlacedKnockoutTeamIds() : new Set();
        var freeQ = pool.filter(function (t) { return !placed.has(t.id); });
        if (freeQ.length) {
          out.push({
            lvl: 'warn', go: 'knockout',
            t: freeQ.length + ' متأهل بلا خانة في الشجرة',
            d: freeQ.slice(0, 5).map(function (t) { return t.name; }).join('، ') +
               (freeQ.length > 5 ? ' +' + (freeQ.length - 5) : '') +
               '\nمؤهَّلون فعلاً ولم يوضعوا في أي خانة.',
            fix: 'ضعهم من صفحة الشجرة'
          });
        }
      } catch (e) {}
    }

    /* ⑱ الشجرة جاهزة وغير منشورة */
    if (rds.length && !s.bracketPublished) {
      out.push({
        lvl: 'info', go: 'knockout',
        t: 'شجرة الإقصاء غير منشورة',
        d: 'موجودة في الإدارة ولا تظهر للجمهور بعد.',
        fix: 'انشرها من صفحة الشجرة',
        auto: { kind: 'publishBracket' }
      });
    }

    /* ⑪ نتائج مسجّلة لمباريات لم تُفعَّل بعد */
    var pendingScored = allMs.filter(function (m) {
      return m.status === 'pending' &&
             (typeof m.homeScore === 'number' || typeof m.awayScore === 'number');
    });
    if (pendingScored.length) {
      out.push({
        lvl: 'warn',
        t: pendingScored.length + ' مباراة «لم تُفعّل» لها نتيجة',
        d: 'النتيجة مسجّلة لكن حالة المباراة معلّقة — فلا تُحتسب في الترتيب\nولا تظهر للجمهور.',
        fix: 'افتح المباراة وغيّر حالتها إلى «منتهية»'
      });
    }

    /* ⑫ خصومات النقاط النشطة — تذكير للمنظّم بأنها تؤثّر على الترتيب */
    var ded = ts.filter(function (t) { return (parseInt(t.deduction, 10) || 0) > 0; });
    if (ded.length) {
      out.push({
        lvl: 'info',
        t: ded.length + ' فريق عليه خصم نقاط',
        d: ded.map(function (t) {
          return t.name + ': -' + t.deduction + (t.deductionReason ? ' (' + t.deductionReason + ')' : '');
        }).join('\n'),
        fix: 'راجعها من ملف الفريق إن لم تعد سارية'
      });
    }

    if (!out.length) {
      out.push({ lvl: 'ok', t: 'كل شيء سليم', d: ms.length + ' مباراة · لا أخطاء' });
    }
    /* ترتيب حسب الأهمية: ما يفسد النتائج أولاً، ثم ما لم يكتمل، ثم
       المراجعات، ثم الاقتراحات — فأول ما تقع عليه العين أخطرُه. */
    var _rank = { err: 0, todo: 1, warn: 2, info: 3, ok: 4 };
    out.sort(function (a, b) { return (_rank[a.lvl] ?? 9) - (_rank[b.lvl] ?? 9); });
    return out;
  }

  window.hcRun = run;

  /* ── العرض ── */
  window.hcShow = function () {
    var res = run();
    /* 🔴 كان المستوى «خطأ» يُطلَق على النقص أيضاً: منظّم أنشأ جولتين من
       ثلاث يرى «عدد المباريات خاطئ» بالأحمر — وهو لم يخطئ، بل لم يُكمل
       بعد. أُضيف مستوى «لم يكتمل» ليفصل التقدّم الطبيعي عن الخلل الفعلي،
       فلا يفزع المنظّم من عمل سليم ولا يتجاهل خطأً حقيقياً بين تنبيهات
       لا تعنيه. */
    var C = { err: '#e74c3c', todo: '#C9A02B', warn: '#f39c12', info: '#3498db', ok: '#2ecc71' };
    var L = { err: 'يجب إصلاحه', todo: 'لم يكتمل بعد', warn: 'يستحق المراجعة',
              info: 'اقتراح', ok: 'سليم' };

    // نحتفظ بالنتائج ليقرأها الإصلاح التلقائي بالفهرس
    window._hcLast = res;

    var html = res.map(function (r, idx) {
      var canFix = !!r.auto && typeof window.hcAutoFix === 'function';
      return '<div class="hc-i" style="--hc:' + C[r.lvl] + '">' +
        '<div class="hc-i-h">' +
          '<span class="hc-lvl">' + L[r.lvl] + '</span>' +
          '<span class="hc-t">' + r.t + '</span>' +
        '</div>' +
        '<div class="hc-d">' + r.d + '</div>' +
        (r.fix ? '<div class="hc-fix">← ' + r.fix + '</div>' : '') +
        '<div class="hc-acts">' +
          (canFix ? '<button class="hc-b fix" onclick="hcAutoFix(' + idx + ')">⚡ إصلاح تلقائي</button>' : '') +
          (r.go ? '<button class="hc-b go" onclick="hcGoto(\'' + r.go + '\')">إصلاح يدوي ←</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    var ov = document.getElementById('hcOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'hcOverlay';
      ov.onclick = function (e) { if (e.target === ov) window.hcClose(); };
      document.body.appendChild(ov);
    }
    /* 🔴 كانت اللوحة `display:flex; align-items:center` مع `overflow-y:auto`
       على الحاوية نفسها — وهو تركيب يقصّ أعلى المحتوى الطويل ويجعل التمرير
       يتعلّق على الجوال، فلا يصل المنظّم إلى آخر البنود ولا إلى زرّ الإغلاق.
       الآن: رأس ثابت، ومنطقة تمرير واحدة للبنود، وتذييل ثابت — فالإغلاق
       في متناول اليد دائماً والتمرير داخل القائمة وحدها. */
    var errs2  = res.filter(function (x) { return x.lvl === 'err'; }).length;
    var todos2 = res.filter(function (x) { return x.lvl === 'todo'; }).length;
    var fixable = res.filter(function (x) { return x.auto; }).length;

    ov.innerHTML =
      '<div class="hc-box" onclick="event.stopPropagation()">' +
        '<div class="hc-head">' +
          '<div>' +
            '<div class="hc-title">فحص سلامة البطولة</div>' +
            '<div class="hc-sub">' + (res.length
                ? res.length + ' بند · ' + errs2 + ' يجب إصلاحه · ' + todos2 + ' لم يكتمل'
                : 'لا ملاحظات — كل شيء سليم') + '</div>' +
          '</div>' +
          '<button class="hc-x" onclick="hcClose()">✕</button>' +
        '</div>' +
        (fixable > 1 ? '<div class="hc-bar"><button class="hc-b fix wide" onclick="hcAutoFixAll()">' +
          '⚡ إصلاح كل ما يمكن إصلاحه تلقائياً (' + fixable + ')</button></div>' : '') +
        '<div class="hc-list">' + (html || '<div class="hc-ok">✓ لم يُعثر على أي ملاحظة</div>') + '</div>' +
        '<div class="hc-foot"><button class="hc-close" onclick="hcClose()">إغلاق</button></div>' +
      '</div>';

    // امنع تمرير الصفحة خلف اللوحة حتى لا يتنازع التمريران
    document.body.style.overflow = 'hidden';
  };

  window.hcClose = function () {
    var ov = document.getElementById('hcOverlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
  };

  /* ══════════════════════════════════════════════════════════════════
   *  ⚡ الإصلاح التلقائي
   *  كل بند مستقلّ بزرّه، ولا يُنفَّذ شيء قبل نافذة تشرح **بالضبط** ما
   *  سيحدث: ماذا سيُحذف أو يُعدَّل، وكم عنصراً، وما الذي لن يُمسّ.
   *  ولا يُقدَّم إصلاح تلقائي إلا حين يكون له جواب واحد لا لبس فيه —
   *  ما عداه يبقى «إصلاح يدوي» لأن التخمين هنا يفسد بطولة.
   * ══════════════════════════════════════════════════════════════════ */
  function _F() { return window; }
  function _ok() {
    var w = _F();
    return w._db && w._firestoreDoc && w._firestoreUpdateDoc && w._firestoreSetDoc && w._getLeagueId;
  }
  function _ref() {
    var w = _F(), L = w._getLeagueId();
    return { w: w, db: w._db, L: L, d: w._firestoreDoc, u: w._firestoreUpdateDoc,
             sd: w._firestoreSetDoc, ts: w._serverTimestamp };
  }
  async function _delMatches(ids) {
    var r = _ref(), n = 0;
    for (var i = 0; i < ids.length; i++) {
      try { await r.w._firestoreDeleteDoc(r.d(r.db, 'leagues', r.L, 'matches', ids[i])); n++; } catch (e) {}
    }
    return n;
  }

  /* يبني وصف العملية ثم ينفّذها بعد موافقة صريحة */
  window.hcAutoFix = async function (idx, silent) {
    var res = window._hcLast || [];
    var item = res[idx];
    if (!item || !item.auto) return 0;
    if (!_ok()) { window.showToast && window.showToast('تعذّر الإصلاح التلقائي — حدّث الصفحة', 'error'); return 0; }
    var a = item.auto, r = _ref(), plan = null;

    var ms = window.matches || [], gs = window.adminGroups || [];

    if (a.kind === 'dupMatches') {
      /* نحتفظ بالمسموح به (الأقدم، ومَن له نتيجة أولاً) ونحذف الفائض */
      var toDel = [];
      var dbl = (window.settings || {}).legMode === 'double';
      var maxMeet = dbl ? 2 : 1;
      (a.keys || []).forEach(function (k) {
        var list = ms.filter(function (m) {
          return !m.isKnockout && [m.homeId, m.awayId].sort().join('|') === k;
        }).sort(function (x, y) {
          var xs = (x.homeScore != null) ? 0 : 1, ys = (y.homeScore != null) ? 0 : 1;
          return xs - ys || String(x.date || '').localeCompare(String(y.date || ''));
        });
        toDel = toDel.concat(list.slice(maxMeet).map(function (m) { return m.id; }));
      });
      plan = {
        title: '⚡ حذف المباريات المكررة',
        body: 'سيُحذف ' + toDel.length + ' مباراة زائدة.\n\n' +
              'يُحتفظ دائماً بالمباراة التي لها نتيجة، وإن تساوت فبالأقدم تاريخاً.\n' +
              'لن تُمسّ أي مباراة أخرى ولا الفرق ولا المجموعات.',
        run: async function () { return await _delMatches(toDel); },
        count: toDel.length
      };
    }

    else if (a.kind === 'orphanMatches') {
      plan = {
        title: '⚡ حذف مباريات الفرق المحذوفة',
        body: 'سيُحذف ' + (a.ids || []).length + ' مباراة تشير إلى فريق لم يعد موجوداً.\n\n' +
              'هذه المباريات تُفسد الترتيب والإحصائيات ولا يمكن إصلاحها بغير الحذف،\n' +
              'لأن أحد طرفيها غير موجود أصلاً.',
        run: async function () { return await _delMatches(a.ids || []); },
        count: (a.ids || []).length
      };
    }

    else if (a.kind === 'crossGroup') {
      plan = {
        title: '⚡ تحويلها إلى مباريات فاصلة',
        body: 'سيُعلَّم ' + (a.ids || []).length + ' مباراة كـ«مباراة فاصلة بين مجموعتين».\n\n' +
              'بذلك تخرج من حساب ترتيب المجموعات وتظهر للجمهور بوصفها الصحيح.\n' +
              '**لا تُحذف أي مباراة** — إن كانت خطأً فاحذفها يدوياً بدل ذلك.',
        run: async function () {
          var n = 0;
          for (var i = 0; i < a.ids.length; i++) {
            try {
              await r.u(r.d(r.db, 'leagues', r.L, 'matches', a.ids[i]),
                { isKnockout: true, knockoutRoundName: '⚔️ مباراة فاصلة بين مجموعتين',
                  groupId: null, updatedAt: r.ts() });
              n++;
            } catch (e) {}
          }
          return n;
        },
        count: (a.ids || []).length
      };
    }

    else if (a.kind === 'publishGroups') {
      plan = {
        title: '⚡ اعتماد ونشر المتأهلين',
        body: 'سيُعتمد متأهلو ' + (a.ids || []).length + ' مجموعة ويظهرون للجمهور وفي شجرة الإقصاء.\n\n' +
              'لن يتغيّر أي اختيار — الاعتماد يُظهر ما اخترته أنت فقط.',
        run: async function () {
          var n = 0;
          for (var i = 0; i < a.ids.length; i++) {
            try {
              await r.u(r.d(r.db, 'leagues', r.L, 'groups', a.ids[i]),
                { qualificationPublished: true, updatedAt: r.ts() });
              n++;
            } catch (e) {}
          }
          return n;
        },
        count: (a.ids || []).length
      };
    }

    else if (a.kind === 'publishBracket') {
      plan = {
        title: '⚡ إظهار الشجرة للجمهور',
        body: 'ستظهر شجرة الإقصاء في صفحة الجمهور فوراً.\n\n' +
              'يمكنك إخفاؤها متى شئت من صفحة الشجرة. لا تتغيّر أي بيانات.',
        run: async function () {
          await r.sd(r.d(r.db, 'leagues', r.L, 'config', 'settings'),
            { bracketPublished: true, updatedAt: r.ts() }, { merge: true });
          if (window.settings) window.settings.bracketPublished = true;
          return 1;
        },
        count: 1
      };
    }

    else if (a.kind === 'roundClash') {
      /* ننقل المباراة الأحدث إلى أول جولة يخلو فيها طرفاها — لا حذف */
      var moves = [];
      var byRound = {};
      ms.filter(function (m) { return !m.isKnockout; }).forEach(function (m) {
        var rd = m.round || 1; (byRound[rd] = byRound[rd] || []).push(m);
      });
      Object.keys(byRound).forEach(function (rd) {
        var seen = {};
        byRound[rd].slice().sort(function (x, y) {
          return String(x.date || '').localeCompare(String(y.date || ''));
        }).forEach(function (m) {
          var clash = seen[m.homeId] || seen[m.awayId];
          if (clash) {
            var target = Number(rd) + 1;
            while (true) {
              var busy = (byRound[target] || []).some(function (x) {
                return x.homeId === m.homeId || x.awayId === m.homeId ||
                       x.homeId === m.awayId || x.awayId === m.awayId;
              });
              if (!busy) break;
              target++;
              if (target > Number(rd) + 40) break;
            }
            moves.push({ id: m.id, from: Number(rd), to: target,
                         label: (m.homeName || '') + ' × ' + (m.awayName || '') });
            (byRound[target] = byRound[target] || []).push(m);
          } else { seen[m.homeId] = 1; seen[m.awayId] = 1; }
        });
      });
      plan = {
        title: '⚡ توزيع المباريات المتزاحمة على جولات',
        body: 'ستُنقل ' + moves.length + ' مباراة إلى أول جولة يخلو فيها فريقاها:\n\n' +
              moves.slice(0, 5).map(function (x) {
                return '· ' + x.label + ' — من الجولة ' + x.from + ' إلى ' + x.to;
              }).join('\n') + (moves.length > 5 ? '\n· +' + (moves.length - 5) + ' غيرها' : '') +
              '\n\n**لا تُحذف أي مباراة** — يتغيّر رقم الجولة فقط، والنتائج والمواعيد كما هي.',
        run: async function () {
          var n = 0;
          for (var i = 0; i < moves.length; i++) {
            try {
              await r.u(r.d(r.db, 'leagues', r.L, 'matches', moves[i].id),
                { round: moves[i].to, updatedAt: r.ts() });
              n++;
            } catch (e) {}
          }
          return n;
        },
        count: moves.length
      };
    }

    if (!plan || !plan.count) {
      if (!silent) window.showToast && window.showToast('لا شيء لإصلاحه في هذا البند', 'success');
      return 0;
    }

    if (!silent) {
      var ok = window.confirmDialog
        ? await window.confirmDialog({ title: plan.title, message: plan.body,
                                       confirmText: 'نفّذ الإصلاح', danger: a.kind !== 'publishBracket' })
        : confirm(plan.title + '\n\n' + plan.body);
      if (!ok) return 0;
    }

    var done = 0;
    try { done = await plan.run(); }
    catch (e) {
      window.showToast && window.showToast('تعذّر الإصلاح: ' +
        (window._trErr ? window._trErr(e) : 'خطأ غير متوقّع'), 'error');
      return 0;
    }
    if (!silent) {
      window.showToast && window.showToast('✓ اكتمل الإصلاح (' + done + ')', 'success');
      setTimeout(function () { window.hcShow(); }, 700);   // أعِد الفحص ليرى الأثر
    }
    return done;
  };

  /* إصلاح كل ما له جواب واحد — بموافقة واحدة تشرح المجموع */
  window.hcAutoFixAll = async function () {
    var res = window._hcLast || [];
    var idxs = res.map(function (r, i) { return r.auto ? i : -1; })
                  .filter(function (i) { return i >= 0; });
    if (!idxs.length) return;
    var ok = window.confirmDialog
      ? await window.confirmDialog({
          title: '⚡ إصلاح كل ما يمكن إصلاحه',
          message: 'سيُنفَّذ ' + idxs.length + ' إصلاحاً تلقائياً:\n\n' +
                   idxs.map(function (i) { return '· ' + res[i].t; }).join('\n') +
                   '\n\nلن يُمسّ أي بند يحتاج قراراً منك — تلك تبقى للإصلاح اليدوي.',
          confirmText: 'نفّذ الكل', danger: true })
      : true;
    if (!ok) return;
    var total = 0;
    for (var i = 0; i < idxs.length; i++) total += await window.hcAutoFix(idxs[i], true);
    window.showToast && window.showToast('✓ اكتمل ' + total + ' إصلاحاً', 'success');
    setTimeout(function () { window.hcShow(); }, 700);
  };

  window.hcGoto = function (page) {
    window.hcClose();
    try { window.showPage(page, null); } catch (e) {}
  };

  /* ── شريط الصحة في لوحة التحكم ──
     الفاحص كان مكتوباً بالكامل لكن **لا زر يفتحه إطلاقاً** — hcShow
     معرّفة ولا يستدعيها أحد. فبقي مهجوراً بلا فائدة. الآن يظهر شريط
     يلخّص الحالة ويُحدَّث تلقائياً مع كل تغيّر في البيانات. */
  window.hcRenderBar = function () {
    var bar = document.getElementById('hcBar');
    if (!bar) return;
    // لا نُزعج المنظّم قبل أن توجد بيانات أصلاً
    if (!(window.teams || []).length) { bar.style.display = 'none'; return; }

    var res = run();
    var errs  = res.filter(function (r) { return r.lvl === 'err'; }).length;
    var todos = res.filter(function (r) { return r.lvl === 'todo'; }).length;
    var warns = res.filter(function (r) { return r.lvl === 'warn'; }).length;
    var clean = !errs && !warns && !todos;

    var col = errs ? '#e74c3c' : todos ? '#C9A02B' : warns ? '#f39c12' : '#2ecc71';
    var txt = errs
      ? errs + ' بند يجب إصلاحه' + (warns + todos ? ' و' + (warns + todos) + ' بند آخر' : '')
      : todos ? todos + ' بند لم يكتمل بعد' + (warns ? ' و' + warns + ' للمراجعة' : '')
      : warns ? warns + ' بند يستحق المراجعة'
              : 'البطولة سليمة';
    var sub = errs ? 'اضغط لمعرفة السبب وخطوات الإصلاح'
            : todos ? 'تقدّم طبيعي — اضغط لمعرفة المتبقّي'
            : warns ? 'اضغط للتفاصيل'
                    : 'لا أخطاء في البيانات';

    bar.style.display = '';
    bar.innerHTML =
      '<div onclick="hcShow()" style="margin-bottom:12px;padding:11px 14px;cursor:pointer;' +
        'background:' + col + '0f;border:1px solid ' + col + '3d;border-radius:12px;' +
        'display:flex;align-items:center;gap:10px">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + col + ';flex-shrink:0' +
          (clean ? '' : ';animation:hcPulse 1.6s infinite') + '"></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;font-weight:800;color:' + col + '">' + txt + '</div>' +
          '<div style="font-size:10px;color:var(--muted,#888);margin-top:2px">' + sub + '</div>' +
        '</div>' +
        '<span style="font-size:11px;color:' + col + ';flex-shrink:0">فحص ›</span>' +
      '</div>';
  };

  // نبضة الخطر
  if (!document.getElementById('hcPulseStyle')) {
    var st = document.createElement('style');
    st.id = 'hcPulseStyle';
    st.textContent = '@keyframes hcPulse{0%,100%{opacity:1}50%{opacity:.35}}';
    document.head.appendChild(st);
  }

  /* تحديث تلقائي: نراقب تغيّر البيانات بلا ربط بدوالّ داخلية
     (تفادياً لفخّ الاستبدال الموثّق في OVERRIDES.md). */
  var _lastSig = '';
  setInterval(function () {
    if (!document.getElementById('hcBar')) return;
    var sig = (window.teams || []).length + '|' + (window.matches || []).length + '|' +
              (window.adminGroups || []).length + '|' +
              ((window.settings || {}).swissQualifiedIds || []).length + '|' +
              (window.matches || []).filter(function (m) { return m.status === 'finished'; }).length;
    if (sig !== _lastSig) { _lastSig = sig; try { window.hcRenderBar(); } catch (e) {} }
  }, 1500);

  // console.log('[health-check] جاهز');
})();
