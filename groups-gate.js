/* ═══════════════════════════════════════════════════════════════════
 *  groups-gate.js — بوابة إجبار توزيع المجموعات (الخطوة ٣)
 *  ───────────────────────────────────────────────────────────────────
 *  تسلسل الإعداد الكامل يصير:
 *      ① معالج البطولة  →  ② إنشاء الفرق (بوابة موجودة)
 *      →  ③ توزيع المجموعات (هذه البوابة)  →  ④ توليد المباريات تلقائياً
 *
 *  المشكلة التي تحلها:
 *    بوابة الفرق (_checkForceTeamsGate) موجودة وتعمل، لكن بعدها
 *    لا شيء يجبر المنظّم على توزيع الفرق على المجموعات. فيدخل اللوحة
 *    والمجموعات فارغة، ثم يحاول إنشاء مباريات يدوياً بين فرق من
 *    مجموعات مختلفة → جدول ترتيب فاسد.
 *    الحقل groupsSetupDone كان يُحفظ في الإعدادات ولا أحد يستخدمه.
 *
 *  عدد الجولات يُحسب رياضياً (round-robin) — لا يُختار:
 *      عدد فرق فردي  → جولات = n
 *      عدد فرق زوجي  → جولات = n − 1
 *      ذهاب وإياب     → × ٢
 *
 *  يُحمَّل بعد admin.js.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var GATE_ID = 'forceGroupsGate';

  function S()  { return window._amtGetSettings ? window._amtGetSettings() : (window.settings || {}); }
  function G()  { return window.adminGroups || []; }
  function TMS(){ return window.teams || []; }

  /* عدد جولات دور المجموعات — رياضياً بحتاً */
  function roundsFor(nTeams, legMode) {
    if (nTeams < 2) return 0;
    var r = nTeams % 2 === 0 ? nTeams - 1 : nTeams;
    return legMode === 'double' ? r * 2 : r;
  }
  window.gtRoundsFor = roundsFor;

  function assignedCount() {
    var seen = {};
    G().forEach(function (g) {
      (g.teamIds || []).forEach(function (id) { seen[id] = 1; });
    });
    return Object.keys(seen).length;
  }

  function hide() {
    var el = document.getElementById(GATE_ID);
    if (el) { el.style.opacity = '0'; setTimeout(function () { el.style.display = 'none'; }, 250); }
  }

  /* ── الفحص الرئيسي ── */
  window._checkForceGroupsGate = function () {
    var s = S();
    // تنطبق على نظام المجموعات فقط، وبعد اكتمال الفرق
    if (!s || s.type !== 'groups') { hide(); return; }
    if (s.teamsSetupDone !== true)  { hide(); return; }   // بوابة الفرق أولاً
    if (s.groupsSetupDone === true) { hide(); return; }

    var groups = G();
    var total  = TMS().length;
    if (!groups.length || !total) { hide(); return; }

    var done = assignedCount();
    if (done >= total) {
      // اكتمل التوزيع — أغلق البوابة وسجّلها
      s.groupsSetupDone = true;
      if (window._gtSave) window._gtSave();
      hide();
      /* ✅ إصلاح: كانت البوابة تعرض رسالة "تقدر تولّد المباريات الآن"
         بدون تنفيذ أي توليد فعلي — فتبقى صفحة المباريات فاضية إلى
         الأبد إذا اكتمل التوزيع من مسار غير السحب/الإفلات المباشر
         (كتحديث الصفحة بعد التوزيع). نستدعي التوليد هنا مباشرة،
         ودالة _dndAutoGenerateIfFull نفسها محمية من التكرار. */
      if (window._autoGenerateMatchesIfReady) {
        window._autoGenerateMatchesIfReady();
      } else if (window._dndAutoGenerateIfFull) {
        window._dndAutoGenerateIfFull();
      } else {
        window.showToast && window.showToast(
          '✅ اكتمل توزيع المجموعات — يمكنك توليد المباريات الآن', 'success');
      }
      return;
    }
    render(done, total, groups, s);
  };

  /* ── واجهة البوابة ── */
  function render(done, total, groups, s) {
    var gate = document.getElementById(GATE_ID);
    if (!gate) {
      gate = document.createElement('div');
      gate.id = GATE_ID;
      gate.style.cssText = 'position:fixed;inset:0;z-index:960;background:rgba(0,0,0,.94);' +
        'overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:20px;' +
        'transition:opacity .25s';
      document.body.appendChild(gate);
    }
    gate.style.display = 'flex';
    gate.style.opacity = '1';

    var legMode = s.legMode || 'single';
    var pct = total ? Math.round(done / total * 100) : 0;

    var rows = groups.map(function (g) {
      var n = (g.teamIds || []).length;
      var r = roundsFor(n, legMode);
      var names = (g.teamIds || []).map(function (id) {
        var t = TMS().find(function (x) { return x.id === id; });
        return t ? t.name : '';
      }).filter(Boolean);
      return '<div style="background:var(--card3,#16181e);border:1px solid var(--border2,#23262e);' +
        'border-radius:10px;padding:11px 13px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (names.length ? '7px' : '0') + '">' +
          '<span style="font-size:13px;font-weight:900;color:var(--gold,#C9A02B)">' +
            (g.icon || '👥') + ' المجموعة ' + g.name + '</span>' +
          '<span style="flex:1"></span>' +
          '<span style="font-size:10px;color:var(--muted,#666);font-weight:700">' + n + ' فرق</span>' +
          (n >= 2 ? '<span style="font-size:9px;font-weight:900;background:rgba(201,160,43,.14);' +
            'color:var(--gold,#C9A02B);border-radius:20px;padding:2px 8px">' + r + ' جولات</span>' : '') +
        '</div>' +
        (names.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
          names.map(function (nm) {
            return '<span style="font-size:10px;background:rgba(255,255,255,.04);' +
              'border:1px solid var(--border2,#23262e);border-radius:20px;padding:3px 9px;' +
              'color:var(--text,#eee)">' + nm + '</span>';
          }).join('') + '</div>' : '') +
      '</div>';
    }).join('');

    gate.innerHTML =
      '<div style="max-width:460px;width:100%;background:var(--card,#121419);' +
        'border:1px solid var(--border2,#23262e);border-radius:18px;padding:24px 20px">' +
        '<div style="text-align:center;margin-bottom:18px">' +
          '<div style="font-size:38px;margin-bottom:8px">👥</div>' +
          '<div style="font-size:17px;font-weight:900;color:var(--text,#eee)">وزّع الفرق على المجموعات</div>' +
          '<div style="font-size:11px;color:var(--muted2,#8b8f9a);margin-top:6px;line-height:1.7">' +
            'الخطوة الأخيرة — بعدها تتولّد كل المباريات تلقائياً بالجولات المرتّبة' +
          '</div>' +
        '</div>' +

        '<div style="background:rgba(201,160,43,.06);border:1px solid rgba(201,160,43,.18);' +
          'border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            '<span style="font-size:11px;font-weight:900;color:var(--gold,#C9A02B)">التقدّم</span>' +
            '<span style="flex:1"></span>' +
            '<span style="font-size:12px;font-weight:900;color:var(--text,#eee)">' + done + ' / ' + total + '</span>' +
          '</div>' +
          '<div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#C9A02B,#e0b84a);' +
              'transition:width .4s"></div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--muted,#666);margin-top:7px">' +
            'باقي ' + (total - done) + ' فريق بلا مجموعة' +
          '</div>' +
        '</div>' +

        rows +

        '<div style="background:rgba(255,255,255,.03);border-radius:10px;padding:11px 13px;' +
          'margin:14px 0;font-size:10px;color:var(--muted2,#8b8f9a);line-height:1.8">' +
          '💡 عدد الجولات يُحسب تلقائياً: كل فريق يلاقي كل فرق مجموعته' +
          (legMode === 'double' ? ' ذهاباً وإياباً' : '') + '.' +
        '</div>' +

        '<button class="btn btn-gold" style="width:100%;padding:14px;font-size:14px;' +
          'font-weight:900;border-radius:12px" onclick="gtOpenDistribute()">' +
          '📥 وزّع الفرق الآن</button>' +
      '</div>';
  }

  /* ── فتح صفحة المجموعات للتوزيع ── */
  window.gtOpenDistribute = function () {
    hide();
    var sb = document.querySelector('.sb-item[onclick*="\'groups\'"]');
    if (typeof window.showPage === 'function') window.showPage('groups', sb);
    window.showToast && window.showToast(
      '👆 اسحب الفرق إلى مجموعاتها — أو استخدم التوزيع التلقائي', 'success');
  };

  /* حفظ العلم في Firestore عبر دالة يوفّرها admin.js */
  window._gtMarkDone = function () {
    var s = S();
    if (s) s.groupsSetupDone = true;
    if (window._gtSave) window._gtSave();
    hide();
  };

  // console.log('[groups-gate] ✅ بوابة المجموعات جاهزة');
})();
