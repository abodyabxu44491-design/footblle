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
          t: orphan.length + ' فريق بلا مجموعة',
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
          t: cross.length + ' مباراة بين مجموعتين مختلفتين',
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
        t: clash.length + ' فريق يلعب أكثر من مرة في جولة واحدة',
        d: clash.slice(0, 4).join('\n') + '\nكل فريق يلعب مباراة واحدة في كل جولة.',
        fix: 'امسح كل المباريات ثم ولّد من جديد'
      });
    }

    // ⑦ مباريات بلا تاريخ
    var noDate = ms.filter(function (m) { return !m.date; });
    if (noDate.length) {
      out.push({
        lvl: 'info',
        t: noDate.length + ' مباراة بلا تاريخ',
        d: 'لن تظهر في فواصل التواريخ عند الجمهور.',
        fix: 'أضف التاريخ من قسم المباريات'
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

  // console.log('[health-check] جاهز');
})();
