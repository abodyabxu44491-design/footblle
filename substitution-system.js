/* ═══════════════════════════════════════════════════════════════════
 *  substitution-system.js — نظام تبديل اللاعبين الاحترافي
 * ───────────────────────────────────────────────────────────────────
 *  • في صفحة البث: نافذة تبديل تعرض لاعبي التشكيلة الأساسية (للخروج)
 *    ولاعبي الدكة (للدخول) كأزرار قابلة للنقر — بدل الكتابة اليدوية.
 *  • يخزّن الحدث بشكل منظّم: playerOut / playerIn (+ توافق مع player/player2).
 *  • العرض للجمهور يُحسّن داخل viewer.js (إشارة تبديل بسهمين).
 *
 *  يعتمد على بنية التشكيلة المحفوظة:
 *    match.homeLineup.players[]  /  match.awayLineup.players[]
 *    كل لاعب: { name, number, position, isSub }
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── قراءة تشكيلة فريق من المباراة: يفصل الأساسي عن الدكة ──
  function getSideLineup(match, side) {
    if (!match) return { starters: [], bench: [] };
    const lu = side === 'home' ? match.homeLineup : match.awayLineup;
    const players = (lu && Array.isArray(lu.players)) ? lu.players : [];
    const named = players.filter(p => (p.name && String(p.name).trim()) || p.number);
    return {
      starters: named.filter(p => !p.isSub),
      bench:    named.filter(p => p.isSub),
    };
  }
  window._subGetSideLineup = getSideLineup;

  // ── لاعبون خرجوا بالفعل في هذه المباراة (لا يظهرون في قائمة الخروج) ──
  function alreadyOut(events, side) {
    const set = new Set();
    (events || []).forEach(e => {
      if ((e.type === 'sub') && (e.team === side || e.side === side)) {
        const out = e.playerOut || e.player;
        if (out) set.add(String(out).trim());
      }
      // مطرود ببطاقة حمراء = خارج الملعب أيضاً
      if (e.type === 'red' && (e.team === side || e.side === side)) {
        if (e.player) set.add(String(e.player).trim());
      }
    });
    return set;
  }

  // ── لاعبون دخلوا بالفعل (لا يظهرون في قائمة الدخول مرة أخرى) ──
  function alreadyIn(events, side) {
    const set = new Set();
    (events || []).forEach(e => {
      if ((e.type === 'sub') && (e.team === side || e.side === side)) {
        const inp = e.playerIn || e.player2;
        if (inp) set.add(String(inp).trim());
      }
    });
    return set;
  }

  // زر لاعب واحد في قائمة الاختيار
  function playerBtn(p, kind) {
    const num  = p.number ? `<span class="sub-pk-num">${p.number}</span>` : '';
    const nm   = (p.name && String(p.name).trim()) || ('لاعب ' + (p.number || ''));
    const pos  = p.position ? `<span class="sub-pk-pos">${p.position}</span>` : '';
    const safe = String(nm).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    return `<button type="button" class="sub-pk-btn sub-pk-${kind}" data-name="${safe}"
      onclick="window._subPick(this,'${kind}')">
      ${num}<span class="sub-pk-nm">${nm}</span>${pos}
    </button>`;
  }

  // ── يبني محتوى نافذة التبديل (قائمتان: خروج / دخول) ──
  // يُستدعى من صفحة البث عند اختيار نوع الحدث = تبديل، بعد معرفة الفريق.
  window._subBuildPickerHtml = function (matchId, side) {
    const match = (window.matches || []).find(m => m.id === matchId);
    const { starters, bench } = getSideLineup(match, side);
    const outSet = alreadyOut(match && match.events, side);
    const inSet  = alreadyIn(match && match.events, side);

    const outList = starters.filter(p => !outSet.has(String(p.name || '').trim()));
    const inList  = bench.filter(p => !inSet.has(String(p.name || '').trim()));

    const emptyHint = (msg) =>
      `<div class="sub-pk-empty">${msg}</div>`;

    const outHtml = outList.length
      ? outList.map(p => playerBtn(p, 'out')).join('')
      : emptyHint('لا يوجد لاعبون في التشكيلة الأساسية — احفظ التشكيلة أولاً من قسم «التشكيلات».');
    const inHtml = inList.length
      ? inList.map(p => playerBtn(p, 'in')).join('')
      : emptyHint('لا يوجد بدلاء في الدكة — أضِفهم في قسم «التشكيلات».');

    return `
      <div class="sub-pk-wrap">
        <div class="sub-pk-col">
          <div class="sub-pk-head sub-pk-head-out">${window.Icon?window.Icon('download',11):''} خارج (من الأساسي)</div>
          <div class="sub-pk-list">${outHtml}</div>
        </div>
        <div class="sub-pk-col">
          <div class="sub-pk-head sub-pk-head-in">${window.Icon?window.Icon('upload',11):''} داخل (من الدكة)</div>
          <div class="sub-pk-list">${inHtml}</div>
        </div>
      </div>
      <div class="sub-pk-preview" id="sub-pk-preview">
        اختر لاعباً خارجاً ولاعباً داخلاً
      </div>`;
  };

  // ── اختيار لاعب من إحدى القائمتين (يبرز المحدَّد + يحدّث المعاينة) ──
  window._subSelected = { out: '', in: '' };
  window._subPick = function (btn, kind) {
    const wrap = btn.closest('.sub-pk-wrap');
    if (wrap) {
      wrap.querySelectorAll('.sub-pk-' + kind).forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    window._subSelected[kind] = btn.getAttribute('data-name') || '';
    const pv = document.getElementById('sub-pk-preview');
    if (pv) {
      const o = window._subSelected.out, i = window._subSelected.in;
      pv.innerHTML = (o || i)
        ? `<span class="sub-pk-pv-out">${o || '—'}</span>
           <span class="sub-pk-pv-arrow">${window.Icon?window.Icon('refresh',12):'⇄'}</span>
           <span class="sub-pk-pv-in">${i || '—'}</span>`
        : 'اختر لاعباً خارجاً ولاعباً داخلاً';
    }
  };

  window._subResetSelection = function () {
    window._subSelected = { out: '', in: '' };
  };

  // ── الأنماط ──
  const css = `
    .sub-pk-wrap{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 2px}
    .sub-pk-col{min-width:0}
    .sub-pk-head{font-size:11px;font-weight:900;text-align:center;padding:6px;border-radius:8px;margin-bottom:7px;display:flex;align-items:center;justify-content:center;gap:5px}
    .sub-pk-head svg{flex:none}
    .sub-pk-pv-arrow{display:inline-flex;align-items:center;vertical-align:middle}
    .sub-pk-head-out{background:rgba(220,50,50,.10);color:#e05252;border:1px solid rgba(220,50,50,.25)}
    .sub-pk-head-in{background:rgba(39,174,96,.12);color:#2ecc71;border:1px solid rgba(39,174,96,.3)}
    .sub-pk-list{display:flex;flex-direction:column;gap:6px;max-height:210px;overflow-y:auto;padding:2px}
    .sub-pk-btn{display:flex;align-items:center;gap:7px;width:100%;padding:8px 9px;border-radius:9px;
      background:var(--card2,#1a1a1a);border:1px solid var(--border2,#2a2a2a);color:var(--text,#eee);
      font-family:Tajawal,sans-serif;font-size:12px;font-weight:700;cursor:pointer;text-align:right;
      transition:transform .1s ease,border-color .15s ease,background .15s ease}
    .sub-pk-btn:active{transform:scale(.97)}
    .sub-pk-num{flex:none;min-width:22px;height:22px;display:flex;align-items:center;justify-content:center;
      border-radius:6px;background:rgba(255,255,255,.06);font-size:11px;font-weight:900;color:var(--gold,#C9A02B)}
    .sub-pk-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sub-pk-pos{flex:none;font-size:9px;color:var(--muted,#888);font-weight:700}
    .sub-pk-out.active{border-color:#e05252;background:rgba(220,50,50,.14);box-shadow:0 0 0 1px rgba(220,50,50,.35) inset}
    .sub-pk-in.active{border-color:#2ecc71;background:rgba(39,174,96,.16);box-shadow:0 0 0 1px rgba(39,174,96,.4) inset}
    .sub-pk-empty{font-size:10.5px;color:var(--muted,#888);text-align:center;padding:14px 8px;line-height:1.6}
    .sub-pk-preview{margin-top:10px;padding:9px;border-radius:9px;background:rgba(52,152,219,.07);
      border:1px solid rgba(52,152,219,.22);text-align:center;font-size:12px;font-weight:800;color:#4aa3df}
    .sub-pk-pv-out{color:#e05252}.sub-pk-pv-in{color:#2ecc71}.sub-pk-pv-arrow{margin:0 8px;color:#4aa3df}
  `;
  const st = document.createElement('style');
  st.id = 'sub-system-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
