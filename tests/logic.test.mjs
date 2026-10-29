/* ═══════════════════════════════════════════════════════════════════
 *  اختبارات المنطق الرياضي — بلا متصفح ولا Firebase
 *    cd tests && node logic.test.mjs
 *  الترتيب · كسر التعادل الجماعي · ركلات الترجيح · حسم الذهاب والإياب
 * ═══════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';
import vm from 'vm';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

/* بيئة متصفح دنيا تكفي لتحميل الملفات المستقلة */
function sandbox(extra = {}) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, querySelector() { return null }, getElementById() { return null },
                createElement() { return { style: {}, setAttribute() {}, appendChild() {} } }, head: { appendChild() {} } },
    ...extra,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, info !== undefined ? '— ' + JSON.stringify(info) : ''); }
}

/* ── StandingsCore ─────────────────────────────────────────────── */
console.log('\nStandingsCore');
const sc = sandbox();
vm.runInContext(read('standings-core.js'), sc);
const SC = sc.StandingsCore;
const T = (id) => ({ id, name: id });
const M = (h, a, hs, as, extra = {}) => ({ homeId: h, awayId: a, homeScore: hs, awayScore: as, status: 'finished', ...extra });

{
  const teams = ['A', 'B', 'C'].map(T);
  const matches = [
    M('A', 'B', 2, 1),
    M('B', 'C', 0, 0),
    M('A', 'C', null, null),                                   // منتهية بلا نتيجة → لا تُحتسب
    M('C', 'A', 5, 0, { isKnockout: true, knockoutRoundId: 'r' }), // إقصاء → لا تُحتسب
  ];
  const map = SC.compute({ teams, matches, deduction: (id) => (id === 'B' ? 1 : 0) });
  ok('فوز = 3 نقاط', map.A.pts === 3, map.A);
  ok('نتيجة null لا تمنح نقطة', map.C.p === 1 && map.C.pts === 1, map.C);
  ok('الإقصاء لا يدخل الجدول', map.C.gf === 0, map.C);
  ok('الخصم يُطرح مرة واحدة', map.B.pts === 0, map.B);
}

/* كسر تعادل ثلاثي دائري: أ>ب، ب>ج، ج>أ — كلّهم 3 نقاط وفارق صفر */
{
  const rows = [
    { id: 'A', name: 'أ', pts: 3, gf: 1, ga: 1, w: 1 },
    { id: 'B', name: 'ب', pts: 3, gf: 1, ga: 1, w: 1 },
    { id: 'C', name: 'ج', pts: 3, gf: 1, ga: 1, w: 1 },
  ];
  const matches = [M('A', 'B', 1, 0), M('B', 'C', 1, 0), M('C', 'A', 1, 0)];
  const settings = { tiebreakOrder: ['h2h', 'gd', 'gf'] };
  const r1 = SC.rank(rows, { matches, settings }).map((r) => r.id).join('');
  const r2 = SC.rank(rows.slice().reverse(), { matches, settings }).map((r) => r.id).join('');
  ok('الترتيب لا يتأثر بترتيب المدخلات (لا مقارن متناقض)', r1 === r2, [r1, r2]);
}

/* دوري مصغّر: أ وب وج بـ 4 نقاط. بين الثلاثة: أ هزم ب وج، ب تعادل مع ج */
{
  const rows = [
    { id: 'C', name: 'ج', pts: 4, gf: 9, ga: 2, w: 1 },
    { id: 'B', name: 'ب', pts: 4, gf: 5, ga: 4, w: 1 },
    { id: 'A', name: 'أ', pts: 4, gf: 2, ga: 2, w: 1 },
    { id: 'D', name: 'د', pts: 7, gf: 3, ga: 3, w: 2 },
  ];
  const matches = [M('A', 'B', 1, 0), M('A', 'C', 1, 0), M('B', 'C', 2, 2)];
  const out = SC.rank(rows, { matches, settings: { tiebreakOrder: ['h2h', 'gd', 'gf'] } }).map((r) => r.id).join('');
  ok('المتصدّر بالنقاط أولاً ثم الدوري المصغّر ثم الفارق', out === 'DACB', out);
  const out2 = SC.rank(rows, { matches, settings: { tiebreakOrder: ['gd', 'gf', 'h2h'] } }).map((r) => r.id).join('');
  ok('ترتيب القواعد يحترم اختيار المنظّم (الفارق أولاً)', out2 === 'DCBA', out2);
}

/* إعادة تطبيق المواجهات على المجموعة الفرعية */
{
  const rows = ['A', 'B', 'C'].map((id) => ({ id, name: id, pts: 4, gf: 3, ga: 3, w: 1 }));
  // بين الثلاثة: A تعادل B، A فاز على C، C فاز على B ← A=4، B=1، C=3 — يفرّق كاملاً
  // نجعل B وC متساويين في المصغّر: A فاز على الاثنين، B وC تعادلا
  const matches = [M('A', 'B', 1, 0), M('A', 'C', 1, 0), M('B', 'C', 1, 1)];
  const out = SC.rank(rows, { matches, settings: { tiebreakOrder: ['h2h', 'cards'] }, cardCount: (id) => ({ B: 5, C: 2 }[id] || 0) })
    .map((r) => r.id).join('');
  ok('بعد المصغّر: الأقل بطاقات يتقدّم', out === 'ACB', out);
}

/* القاعدة المعطّلة لا تُطبَّق */
{
  const rows = [{ id: 'X', name: 'ب', pts: 1, gf: 5, ga: 0 }, { id: 'Y', name: 'أ', pts: 1, gf: 0, ga: 0 }];
  const out = SC.rank(rows, { matches: [], settings: { tiebreakOrder: ['gd'], tiebreakDisabled: ['gd'] } }).map((r) => r.id).join('');
  ok('القاعدة المعطّلة تُتجاوز إلى القرعة بالاسم', out === 'YX', out);
}

/* ── ركلات الترجيح ─────────────────────────────────────────────── */
console.log('\nPK (ركلات الترجيح)');
const pc = sandbox({ matches: [] });
vm.runInContext(read('penalties-core.js'), pc);
const PK = pc.PK;
const G = 'goal', X = 'miss';
const pk = (H, A) => { const s = PK.state({ home: H, away: A }, 'home'); return s.decided ? s.winner : 'open:' + s.nextSide; };
ok('3-0 بعد ثلاث لكلٍّ = حُسمت', pk([G, G, G], [X, X, X]) === 'home');
ok('3-0 والخصم سدّد اثنتين = مستمرة', pk([G, G, G], [X, X]) === 'open:away');
ok('5-4 بعد الخمس', pk([G, G, G, G, G], [G, G, G, G, X]) === 'home');
ok('4-4 بعد الخمس = موت مفاجئ', pk([G, G, G, G, X], [G, G, G, G, X]) === 'open:home');
ok('الموت المفاجئ لا يُحسم قبل ركلة الخصم', pk([G, G, G, G, X, G], [G, G, G, G, X]) === 'open:away');
ok('الموت المفاجئ يُحسم بعد تساوي العدد', pk([G, G, G, G, X, G], [G, G, G, G, X, X]) === 'home');

/* ── حسم الذهاب والإياب (admin.js → _koNeedsDecider) ───────────── */
console.log('\n_koNeedsDecider (الذهاب والإياب)');
{
  const src = read('admin.js').match(/window\._koNeedsDecider = function[\s\S]*?\n};\n/);
  ok('الدالّة موجودة في admin.js', !!src);
  if (src) {
    const kc = sandbox({ _liveMatches: {}, matches: [] });
    vm.runInContext(src[0], kc);
    const f = (id) => kc._koNeedsDecider(id);
    const L = kc._liveMatches;
    L.g = { homeScore: 1, awayScore: 1 };
    ok('تعادل مجموعات لا يحتاج حسماً', f('g') === false);
    L.s = { isKnockout: true, homeScore: 1, awayScore: 1 };
    ok('تعادل إقصاء بمباراة واحدة يحتاج حسماً', f('s') === true);
    L.l1 = { isKnockout: true, knockoutRoundId: 'r', knockoutSlot: 0, legNo: 1, homeScore: 1, awayScore: 1 };
    ok('تعادل الذهاب نتيجة مشروعة', f('l1') === false);
    kc.matches = [{ id: 'l1', isKnockout: true, knockoutRoundId: 'r', knockoutSlot: 0, legNo: 1, status: 'finished', homeId: 'A', awayId: 'B', homeScore: 2, awayScore: 0 }];
    L.l2 = { isKnockout: true, knockoutRoundId: 'r', knockoutSlot: 0, legNo: 2, homeId: 'B', awayId: 'A', homeScore: 1, awayScore: 1 };
    ok('إياب 1-1 بعد ذهاب 2-0: محسوم بالمجموع', f('l2') === false);
    L.l2.homeScore = 2; L.l2.awayScore = 0;
    ok('إياب 2-0 بعد ذهاب 2-0: مجموع متعادل يحتاج حسماً', f('l2') === true);
  }
}

console.log(`\n${pass}/${pass + fail} نجح`);
process.exit(fail ? 1 : 0);
