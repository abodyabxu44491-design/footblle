/* icon-svg.js — نظام الأيقونات الموحّد؛ نفس نظام صفحتي الإدارة والجمهور بملف مستقل لمشاركته مع السوبر أدمن وصفحة الاشتراك. يُحمَّل قبل viewer-emoji-svg.js */
/* ═══════════════════════════════════════════════════════════════════
 *  icons.js — نظام أيقونات SVG موحّد (بأسلوب Lucide)
 *  ───────────────────────────────────────────────────────────────────
 *  يستبدل الإيموجي بأيقونات خطية نظيفة بنفس الأسلوب البصري.
 *
 *  الاستخدام:
 *    Icon('trophy')             → <svg …>
 *    Icon('trophy', 18)         → بحجم 18px
 *    Icon('trophy', 18, '#C9A02B')
 *    window.emojiToIcon('🏆')   → يحوّل إيموجي إلى أيقونة تلقائياً
 *
 *  كل الأيقونات: stroke currentColor، 24×24 viewBox، بدون تعبئة.
 *  ترث لون النص تلقائياً ⇒ تعمل مع الوضع الليلي/النهاري بلا كود إضافي.
 * ═══════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── مسارات الأيقونات (24×24) ── */
  var P = {
    /* رياضة */
    ball:      '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.3 2.4-1.3 3.9h-4l-1.3-3.9z"/><path d="M12 3v4.5M4.6 9.8l4.1 1.5M19.4 9.8l-4.1 1.5M8 19.6l2-4.3M16 19.6l-2-4.3"/>',
    trophy:    '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/><path d="M10 14h4M9 20h6M12 14v6"/>',
    goal:      '<rect x="3" y="7" width="18" height="12" rx="1"/><path d="M3 11h18M3 15h18M9 7v12M15 7v12"/>',
    whistle:   '<circle cx="8" cy="13" r="5"/><path d="M13 13h8V8l-8 3"/><path d="M8 13h.01"/>',
    flag:      '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    field:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 10h3v4H3M21 10h-3v4h3"/><circle cx="12" cy="12" r="2.2"/>',
    shirt:     '<path d="M8 3l4 2 4-2 5 3-2 4h-2v11H7V10H5L3 6z"/>',
    /* حذاء كرة القدم — أيقونة الصناعة (كانت مفقودة فكان Icon('boots') يرجع فراغاً) */
    boots:     '<path d="M4 6h4l1.5 3.2 5.2 1.4A4.4 4.4 0 0 1 18 14.8V17H4z"/><path d="M6.5 17v2.4M10 17v2.4M13.5 17v2.4M17 17v2.4"/>',

    /* حالة */
    check:     '<path d="M4 12.5l5 5L20 6.5"/>',
    close:     '<path d="M6 6l12 12M18 6L6 18"/>',
    alert:     '<path d="M12 3l9.5 17H2.5z"/><path d="M12 9v5M12 17.5v.5"/>',
    info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    live:      '<circle cx="12" cy="12" r="3.2"/><path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>',
    clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    pause:     '<path d="M9 5v14M15 5v14"/>',
    play:      '<path d="M7 4.5l12 7.5-12 7.5z"/>',
    finish:    '<path d="M5 21V4M5 5h13l-2.5 4L18 13H5"/>',
    lock:      '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock:    '<rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    bolt:      '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',

    /* بيانات */
    list:      '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chart:     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    trend:     '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    calendar:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    users:     '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 20a6 6 0 0 0-2-4.4"/>',
    user:      '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    tree:      '<rect x="3" y="4" width="6" height="4" rx="1"/><rect x="3" y="16" width="6" height="4" rx="1"/><rect x="15" y="10" width="6" height="4" rx="1"/><path d="M9 6h3v6h3M9 18h3v-6"/>',
    medal:     '<circle cx="12" cy="15" r="5"/><path d="M8.5 10.5L6 3h12l-2.5 7.5"/><path d="M12 13.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2L9 15.3l2-.3z"/>',
    star:      '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    target:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',

    /* أدوات */
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.6 2.4 2.8-.6.4 2.9 2.6 1.2-1.4 2.5 1.4 2.5-2.6 1.2-.4 2.9-2.8-.6L12 21.5l-1.6-2.4-2.8.6-.4-2.9-2.6-1.2 1.4-2.5-1.4-2.5 2.6-1.2.4-2.9 2.8.6z"/>',
    edit:      '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    trash:     '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    save:      '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-6h8v6"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    minus:     '<path d="M5 12h14"/>',
    search:    '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
    share:     '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.3M8.2 13.2l7.6 4.3"/>',
    bell:      '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
    bellOff:   '<path d="M18 8a6 6 0 0 0-9.3-5M5.5 5.5A6 6 0 0 0 6 8c0 6-2 7-2 7h12"/><path d="M10.5 20a2 2 0 0 0 3 0M3 3l18 18"/>',
    refresh:   '<path d="M20 11a8 8 0 0 0-14-4L3 10"/><path d="M4 13a8 8 0 0 0 14 4l3-3"/><path d="M3 5v5h5M21 19v-5h-5"/>',
    image:     '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
    camera:    '<path d="M3 8h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13" r="3.5"/>',
    tag:       '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    card:      '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/>',
    home:      '<path d="M3 11l9-8 9 8"/><path d="M5.5 9.5V20h13V9.5"/>',
    globe:     '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
    phone:     '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    mail:      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
    signal:    '<path d="M12 20v-6"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5.5 13a9 9 0 0 1 13 0M2.5 9.5a13 13 0 0 1 19 0"/>',
    tv:        '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 3l4 3 4-3"/>',
    eye:       '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeOff:    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 6 10 6a17 17 0 0 1-2.2 3.1M6.5 6.6C3.4 8.5 2 11 2 11s3.5 6 10 6c1.2 0 2.3-.2 3.3-.5"/><path d="M9.5 10a3 3 0 0 0 4.2 4.2"/>',
    key:       '<circle cx="7.5" cy="12" r="4"/><path d="M11.5 12H21l-2 2.5M17 12v3"/>',
    sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon:      '<path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10z"/>',
    upload:    '<path d="M12 16V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download:  '<path d="M12 4v12M7.5 11.5L12 16l4.5-4.5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    chevronL:  '<path d="M15 5l-7 7 7 7"/>',
    chevronR:  '<path d="M9 5l7 7-7 7"/>',
    chevronD:  '<path d="M5 9l7 7 7-7"/>',
    menu:      '<path d="M4 7h16M4 12h16M4 17h16"/>',
    dot:       '<circle cx="12" cy="12" r="4"/>',
    money:     '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 12h.01M18 12h.01"/>',
    shield:    '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    crown:     '<path d="M3 8l3.5 3L12 5l5.5 6L21 8l-2 10H5z"/>',
    swords:    '<path d="M4 4l9 9M20 4l-9 9"/><path d="M13 13l3 3 4-4-3-3M11 13l-3 3-4-4 3-3"/>',
    dice:      '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M9 15h.01M15 9h.01"/>',
    palette:   '<path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H19a3 3 0 0 0 3-3 9 9 0 0 0-10-8.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    bulb:      '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    rocket:    '<path d="M12 2s5 2 5 9c0 4-2 7-5 10-3-3-5-6-5-10 0-7 5-9 5-9z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M7 14l-3 2 2 3M17 14l3 2-2 3"/>',
    handshake: '<path d="M2 11l4-4 4 2 2-1 2 1 4-2 4 4"/><path d="M6 13l3 3 2-2 2 2 3-3"/><path d="M2 11v4l4 4M22 11v4l-4 4"/>',
    stadium:   '<ellipse cx="12" cy="9" rx="9" ry="4.5"/><path d="M3 9v5c0 2.5 4 4.5 9 4.5s9-2 9-4.5V9"/>',
    injury:    '<path d="M12 3a6 6 0 0 0-6 6v3l-1.5 4.5h15L18 12V9a6 6 0 0 0-6-6z"/><path d="M9.5 20a2.5 2.5 0 0 0 5 0"/>',
    mic:       '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/>',
    plane:     '<path d="M2 13l20-7-7 20-3-8z"/>',
    coffee:    '<path d="M4 8h13v6a5 5 0 0 1-10 0z"/><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2M4 21h13"/>',
    board:     '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3M7 12l3-3 3 3 4-4"/>',
    doc:       '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    package:   '<path d="M12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
    chat:      '<path d="M4 5h16v10H9l-4 3.5V15H4z"/>',
    externalArrow: '<path d="M7 17L17 7"/><path d="M9 7h8v8"/>'
  };

  /* ── خريطة الإيموجي → الأيقونة ── */
  var MAP = {
    '🌊':'shield', '🏔':'shield', '🌹':'shield', '🦄':'shield', '🐉':'shield', '🎭':'shield', '🌴':'shield', '🍀':'shield', '🌺':'shield', '📥':'download', '📍':'target', '🏔️':'shield', '🥶':'shield', '🧊':'shield',

    // ── توسعة: رموز كانت تظهر نصّاً خاماً (✅ وحده في 415 موضعاً) ──
    '✅':'check', '✔':'check', '❌':'close', '✘':'close', '🚫':'close', '✏':'edit', '➕':'plus', '➖':'minus', '⚙':'settings', '⬇':'download', '⬆':'upload', '☀':'sun', '☁':'cloudRain', '🧹':'refresh', '✈':'plane', '⭐':'star', '👔':'user', '📖':'doc', '🎥':'camera', '🩹':'injury', '⚷':'key', '🦅':'shield', '🦁':'shield', '🐯':'shield', '🐻':'shield', '🦊':'shield', '🐺':'shield', '🦈':'shield', '🐬':'shield', '🦉':'shield', '🦋':'shield',

    '✅︎':'check','✓':'check','☑️':'check','❌︎':'close','✕':'close','✖️':'close',
    '⚽':'ball','🥅':'goal','🏆':'trophy','🏅':'medal','🥇':'medal','🥈':'medal','🥉':'medal',
    '👥':'users','👤':'user','🧑':'user','👨':'user','🔴':'live','🟢':'dot','🟡':'dot','🟠':'dot',
    '⚪':'dot','⚫':'dot','🔵':'dot','🟣':'dot','🔷':'dot','🔶':'dot','🟦':'dot','🟩':'dot',
    '🟪':'dot','🟫':'dot','🟨':'card','🟥':'card','🎴':'card','💳':'money','💼':'money',
    '📋':'list','☰':'menu','📊':'chart','📈':'trend','📉':'trend','📅':'calendar','🗓':'calendar',
    '📆':'calendar','⏰':'clock','⏱':'clock','⏲':'clock','🕐':'clock','⏸':'pause','⏸️':'pause',
    '▶︎':'play','▶︎️':'play','🏁':'finish','⚡':'bolt','🔒':'lock','🔐':'lock','🔓':'unlock',
    '🔑':'key','⚠️':'alert','⚠':'alert','💡':'bulb','ℹ️':'info','❓':'info','❔':'info',
    '⚙︎️':'settings','⚙︎':'settings','🔧':'settings','🎛':'settings','✏︎️':'edit','📝':'edit','✍️':'edit',
    '🗑':'trash','🗑️':'trash','💾':'save','➕︎':'plus','➖︎':'minus','🔍':'search','🔗':'link',
    '📤':'share','📲':'share','🔔':'bell','🔕':'bellOff','🔄':'refresh','🔁':'refresh',
    '🖼':'image','🖼️':'image','📸':'camera','📷':'camera','🏷️':'tag','🏷':'tag',
    '🏠':'home','🌐':'globe','🌍':'globe','🌎':'globe','🌏':'globe','📱':'phone','📧':'mail',
    '📡':'signal','📺':'tv','👁':'eye','👁️':'eye','☀︎️':'sun','🌙':'moon','⬆︎️':'upload','⬇︎️':'download','⬇︎':'download',
    '🌳':'tree','🎯':'target','⭐︎':'star','🌟':'star','✨':'star','✦':'star','👑':'crown',
    '🛡️':'shield','🛡':'shield','⚔️':'swords','⚔':'swords','🎲':'dice','🎨':'palette',
    '🚀':'rocket','🤝':'handshake','🏟':'stadium','🏟️':'stadium','⛳':'flag','🚩':'flag',
    '🤕':'injury','🎙':'mic','🎙️':'mic','🎤':'mic','✈︎️':'plane','☕':'coffee','📘':'doc','📄':'doc',
    '📦':'package','👕':'shirt','⚖️':'whistle','👨‍⚖️':'whistle','🦵':'ball','🥊':'swords',
    '👟':'boots','🥾':'boots',
    '📢':'signal','🎉':'star','🧠':'bulb','💎':'star','🔥':'bolt','⭕':'dot','🔽':'chevronD',
    '➡️':'chevronL','⬅️':'chevronR','👆':'chevronD','👇':'chevronD','😔':'info','🎪':'star',
    '🎮':'dice','🧤':'shield','🚦':'dot','💪':'shield','🎖️':'medal','🔮':'star','🌈':'star',
    '🛈':'info','⛔':'close','📌':'tag','ℹ':'info',
    '⚖':'whistle','🎖':'medal','✖':'close','☀︎':'sun','⬅':'chevronR','☑':'check',
    '⬆︎':'upload','✍':'edit','✈︎':'plane','➡':'chevronL','⏳':'clock','✏︎':'edit',

    /* ── إضافات: رموز مستخدمة بالسوبر أدمن وصفحة الاشتراك ── */
    '💬':'chat','💭':'chat','🗨️':'chat','🗨':'chat',
    '✉':'mail','✉️':'mail','📭':'mail','📬':'mail','📪':'mail',
    '🧍':'user','🧍‍♂️':'user','🧍‍♀️':'user',
    '💰':'money','💵':'money','💸':'money','🏦':'money',
    '↗':'externalArrow','↗️':'externalArrow','↗︎':'externalArrow','↗︎️':'externalArrow',
    '📎':'link','✎':'edit','✎︎':'edit',
    '🤔':'bulb','↩':'refresh','↩︎':'refresh','↪':'refresh','🙈':'eyeOff'
  };

  function svg(name, size, color) {
    var d = P[name];
    if (!d) return '';
    size = size || 16;
    var c = color ? ' style="color:' + color + '"' : '';
    return '<svg class="ic ic-' + name + '"' + c + ' width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  function fromEmoji(e, size, color) {
    var n = MAP[e];
    return n ? svg(n, size, color) : '';
  }

  root.Icon = svg;
  root.IconFromEmoji = fromEmoji;
  root.ICON_MAP = MAP;
  root.ICON_PATHS = P;

})(typeof window !== 'undefined' ? window : globalThis);
