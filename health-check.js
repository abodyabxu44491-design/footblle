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
      return [{ lvl: 'ok', t: 'لا توجد مباريات بعد', d: 'ولّد المباريات من صفحة المجموعات' }];
    }

    // ① مباريات مكررة
    var pairs = {};
    ms.forEach(function (m) {
      var k = pairKey(m);
      (pairs[k] = pairs[k] || []).push(m);
    });
    var dups = Object.keys(pairs).filter(function (k) { return pairs[k].length > maxMeet; });
    if (dups.length) {
      var ex = dups.slice(0, 3).map(function (k) {
        var g = pairs[k];
        return nameOf(g[0].homeId) + ' ضد ' + nameOf(g[0].awayId) + ' (' + g.length + ' مرات)';
      });
      out.push({
        lvl: 'err',
        t: dups.length + ' مباراة مكررة',
        d: 'نظام «' + (dbl ? 'ذهاب وإياب' : 'ذهاب فقط') + '» يسمح بـ ' + maxMeet +
           ' لقاء بين كل فريقين. المكرر يُحسب مرتين في الترتيب.\n' + ex.join('\n'),
        fix: 'امسح كل المباريات من منطقة الخطر ثم ولّد من جديد'
      });
    }

    // ② + ③ لكل مجموعة: الجولات والمباريات مقابل الحساب الرياضي
    if (isGroups && gs.length) {
      gs.forEach(function (g) {
        var gt = (g.teamIds || []).length;
        if (gt < 2) return;
        var gm = ms.filter(function (m) { return m.groupId === g.id; });
        if (!gm.length) return;

        var expR = (gt % 2 === 0 ? gt - 1 : gt) * (dbl ? 2 : 1);
        var expM = (gt * (gt - 1) / 2) * (dbl ? 2 : 1);
        var actR = new Set(gm.map(function (m) { return m.round || 1; })).size;

        if (gm.length !== expM) {
          out.push({
            lvl: 'err',
            t: 'المجموعة ' + g.name + ': عدد المباريات خاطئ',
            d: gt + ' فرق × ' + (dbl ? 'ذهاب وإياب' : 'ذهاب فقط') +
               ' = ' + expM + ' مباراة متوقّعة، الموجود ' + gm.length + '.',
            fix: 'امسح كل المباريات ثم ولّد من جديد'
          });
        }
        if (actR !== expR) {
          out.push({
            lvl: 'warn',
            t: 'المجموعة ' + g.name + ': عدد الجولات خاطئ',
            d: gt + ' فرق = ' + expR + ' جولات متوقّعة، الموجود ' + actR + '.',
            fix: 'امسح كل المباريات ثم ولّد من جديد'
          });
        }
      });
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
          fix: 'احذف هذه المباريات يدوياً من قسم المباريات'
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
        d: clash.slice(0, 4).join('\n') + '\nكل فريق يلعب مباراة واحدة في كل جولة.',
        fix: 'امسح كل المباريات ثم ولّد من جديد'
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
        fix: 'احذف هذه المباريات من قسم المباريات'
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
          fix: 'اضغط «اعتماد ونشر» لكل مجموعة'
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
        fix: 'انشرها من صفحة الشجرة'
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
    return out;
  }

  window.hcRun = run;

  /* ── العرض ── */
  window.hcShow = function () {
    var res = run();
    var C = { err: '#e74c3c', warn: '#f39c12', info: '#3498db', ok: '#2ecc71' };
    var L = { err: 'خطأ', warn: 'تحذير', info: 'ملاحظة', ok: 'سليم' };

    var html = res.map(function (r) {
      return '<div style="background:var(--card3,#16181e);border:1px solid ' + C[r.lvl] + '33;' +
        'border-right:3px solid ' + C[r.lvl] + ';border-radius:10px;padding:12px 14px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
          '<span style="font-size:9px;font-weight:900;color:' + C[r.lvl] + ';background:' + C[r.lvl] +
          '1a;border-radius:20px;padding:2px 8px">' + L[r.lvl] + '</span>' +
          '<span style="font-size:12.5px;font-weight:800;color:var(--text,#eee)">' + r.t + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted2,#8b8f9a);line-height:1.7;white-space:pre-line">' + r.d + '</div>' +
        (r.fix ? '<div style="font-size:10px;color:' + C[r.lvl] + ';margin-top:7px;font-weight:700">← ' + r.fix + '</div>' : '') +
        /* زرّ يأخذ المنظّم إلى مكان الخلل مباشرةً: قراءة البند شيء
           والوصول إلى صفحته عبر القائمة الجانبية شيء آخر، وكان عليه أن
           يتذكّر البند بعد إغلاق اللوحة. */
        (r.go ? '<button onclick="hcGoto(\'' + r.go + '\')" style="margin-top:9px;padding:7px 13px;' +
          'border-radius:8px;cursor:pointer;font-family:Tajawal,sans-serif;font-size:10.5px;font-weight:800;' +
          'background:' + C[r.lvl] + '1a;border:1px solid ' + C[r.lvl] + '4d;color:' + C[r.lvl] + '">' +
          'الذهاب لإصلاحه ←</button>' : '') +
      '</div>';
    }).join('');

    var ov = document.getElementById('hcOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'hcOverlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.9);' +
        'overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:18px';
      ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
      document.body.appendChild(ov);
    }
    ov.innerHTML = '<div style="max-width:480px;width:100%;background:var(--card,#121419);' +
      'border:1px solid var(--border2,#23262e);border-radius:16px;padding:20px" onclick="event.stopPropagation()">' +
      '<div style="font-size:16px;font-weight:900;color:var(--gold,#C9A02B);margin-bottom:4px">فحص سلامة البطولة</div>' +
      '<div style="font-size:11px;color:var(--muted,#666);margin-bottom:16px">يكشف أخطاء البيانات قبل أن تفسد الترتيب</div>' +
      html +
      '<button class="btn btn-outline" style="width:100%;margin-top:8px;padding:11px" ' +
      'onclick="document.getElementById(\'hcOverlay\').remove()">إغلاق</button>' +
    '</div>';
  };

  window.hcGoto = function (page) {
    var ov = document.getElementById('hcOverlay');
    if (ov) ov.remove();
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
    var warns = res.filter(function (r) { return r.lvl === 'warn'; }).length;
    var clean = !errs && !warns;

    var col = errs ? '#e74c3c' : warns ? '#f39c12' : '#2ecc71';
    var txt = errs
      ? errs + ' خطأ يفسد البطولة' + (warns ? ' و' + warns + ' تحذير' : '')
      : warns ? warns + ' تحذير يستحق المراجعة'
              : 'البطولة سليمة';
    var sub = errs ? 'اضغط لمعرفة السبب والحل'
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
