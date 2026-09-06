/* ════════════════════════════════════════════════════════════════════
 *  ⚽ match-core.js — النواة المشتركة لبطاقة المباراة
 *  ──────────────────────────────────────────────────────────────────
 *  المنصة فيها ثلاث بطاقات مباراة مستقلّة:
 *    · `renderMatchCard` في admin.js        (١٨٤ سطراً)
 *    · `_matchCard` في viewer.js            (٢٢٤ سطراً)
 *    · `row()` في cards-system.js           (واجهة اختيار المباراة)
 *
 *  ولكلٍّ احتياجاته: الإدارة فيها أزرار تحرير وبثّ، والجمهور فيه توقّعات
 *  وشارات، والبطاقات فيها سجلّ ما وُلّد. فدمجها في بطاقة واحدة يخنق
 *  الثلاثة.
 *
 *  🔴 لكن **الحقائق** المشتركة بينها كانت مكرّرة ثلاث مرات: ما اسم دور
 *  هذه المباراة؟ كم طرداً على كل فريق؟ ما حالتها؟ وكل نسخة تنحرف عن
 *  أختها مع أول تعديل — وهو مصدر أخطاء متكرّرة في هذه الجلسة:
 *  «الجولة 1» على مباريات الإقصاء ظهرت في ثلاثة ملفات، وعُولجت في كلٍّ
 *  على حدة ثم عادت من ملف رابع.
 *
 *  هذا الملف يحمل تلك الحقائق **مرة واحدة**. البطاقات تبقى ثلاثاً في
 *  شكلها، وتقرأ من مصدر واحد في معناها.
 * ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── اسم دور المباراة ──
     الأولوية: اسم الدور المحفوظ ← إقصاء بلا اسم ← الملحق ← المجموعة
     ← الجولة. وأي شرط يطلب `isKnockout` **و** الاسم معاً يُسقط مباريات
     تحمل أحدهما فقط — وهو الخطأ الذي تكرّر. */
  function stageLabel(m) {
    if (!m) return '';
    if (m.knockoutRoundName) return String(m.knockoutRoundName);
    if (m.isKnockout || m.knockoutRoundId != null) return 'دور إقصائي';
    if (m.isPlayoff) {
      return (m.poGroup != null)
        ? 'الملحق · مجموعة ' + String.fromCharCode(65 + m.poGroup)
        : 'الملحق';
    }
    if (m.groupName) return m.groupName + (m.round ? ' · الجولة ' + m.round : '');
    return m.round ? 'الجولة ' + m.round : '';
  }

  /* ── أحداث المباراة من مصدرها الصحيح ──
     أثناء البثّ تُكتب في `liveData.events`، وبعد الانتهاء في `events`.
     قراءة أحدهما وحده تعطي عدداً مختلفاً باختلاف الحالة. */
  function events(m) {
    if (!m) return [];
    if (m.liveData && Array.isArray(m.liveData.events) && m.liveData.events.length) {
      return m.liveData.events;
    }
    return Array.isArray(m.events) ? m.events : [];
  }

  /* ── عدّ المطرودين لكل فريق ──
     يجمع **اللاعبين** لا الأحداث: من نال صفراوين ومن نال حمراء مباشرة
     في مجموعة واحدة، فتسقط الحمراء المسجَّلة فوق صفراوين تلقائياً.
     والطرد بلا اسم يُعدّ كما هو — لا يمكن دمجه بلا هوية. */
  function redCount(m) {
    var out = { home: 0, away: 0 };
    if (!m) return out;
    var evs = events(m);
    var norm = function (v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); };
    var key = function (e) { return (e.team || e.side || '') + '::' + norm(e.player || e.playerNumber || ''); };

    var yc = {}, sy = {};
    evs.forEach(function (e) {
      if (!e || String(e.type || '').toLowerCase() !== 'yellow') return;
      var k = key(e);
      yc[k] = (yc[k] || 0) + 1;
      if (yc[k] === 2) sy[k] = true;
    });

    var sent = { home: {}, away: {} }, anon = { home: 0, away: 0 };
    Object.keys(sy).forEach(function (k) {
      var sd = k.split('::')[0];
      if (sent[sd]) sent[sd][k] = true;
    });
    evs.forEach(function (e) {
      if (!e) return;
      var t = String(e.type || '').toLowerCase();
      if (t !== 'red' && t !== 'redcard' && t !== 'secondyellow') return;
      var sd = e.team || e.side;
      if (sd !== 'home' && sd !== 'away') return;
      var nm = norm(e.player || e.playerNumber || '');
      if (!nm) { anon[sd]++; return; }
      sent[sd][key(e)] = true;
    });
    out.home = Object.keys(sent.home).length + anon.home;
    out.away = Object.keys(sent.away).length + anon.away;
    return out;
  }

  /* ── حالة المباراة بنصّها ولونها ── */
  function status(m) {
    var s = m && m.status;
    if (s === 'live')     return { id: 'live',     label: 'مباشر',  color: '#D64541' };
    if (s === 'upcoming') return { id: 'upcoming', label: 'قادمة',  color: '#3B7DBF' };
    return { id: 'finished', label: 'انتهت', color: '#8a8a8a' };
  }

  /* ── مفتاح الترتيب وقاعدته ──
     التاريخ ← الوقت ← ترتيب الدور ← الجولة ← المعرّف.
     ترتيب الدور ضروري: مباريات الإقصاء تُولَّد كثيراً **بلا تاريخ**،
     فبدونه يعود الترتيب إلى ترتيب الإنشاء (ربع النهائي قبل النهائي). */
  function sortKey(m) {
    return (m && m.date ? String(m.date) : '0000-00-00') + 'T' +
           (m && m.time ? String(m.time) : '00:00');
  }
  function newestFirst(a, b) {
    var d = sortKey(b).localeCompare(sortKey(a));
    if (d) return d;
    var k = (b.knockoutOrder || 0) - (a.knockoutOrder || 0);
    if (k) return k;
    var r = (b.round || 0) - (a.round || 0);
    if (r) return r;
    return String(b.id || '').localeCompare(String(a.id || ''));
  }
  function soonestFirst(a, b) {
    return sortKey(a).localeCompare(sortKey(b))
        || (a.knockoutOrder || 0) - (b.knockoutOrder || 0)
        || (a.round || 0) - (b.round || 0)
        || String(a.id || '').localeCompare(String(b.id || ''));
  }

  /* ترتيب «الكل»: الجارية ← القادمة (الأقرب) ← المنتهية (الأحدث) */
  function allOrder(a, b) {
    var rank = function (m) {
      return m.status === 'live' ? 0 : (m.status === 'upcoming' ? 1 : 2);
    };
    var d = rank(a) - rank(b);
    if (d) return d;
    return rank(a) === 1 ? soonestFirst(a, b) : newestFirst(a, b);
  }

  window.MatchCore = {
    stageLabel: stageLabel,
    events: events,
    redCount: redCount,
    status: status,
    sortKey: sortKey,
    newestFirst: newestFirst,
    soonestFirst: soonestFirst,
    allOrder: allOrder,
  };
})();
