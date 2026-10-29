/* ═══════════════════════════════════════════════════════════════════
 *  اختبارات قواعد Firestore — تُشغَّل على المحاكي الرسمي قبل أي نشر
 *    cd tests && npm install && npm run test:rules
 *  كل سطر هنا يمثّل ثغرة أو عطلاً أُصلح سابقاً: إن فشل بعد تعديل
 *  القواعد فقد عادت الثغرة.
 * ═══════════════════════════════════════════════════════════════════ */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-footballa',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
});

const DAY = 24 * 3600 * 1000;
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'admins/sa'), { role: 'superadmin' });
  await setDoc(doc(db, 'admins/fake'), { role: 'viewer' });
  await setDoc(doc(db, 'leagueAdmins/orgA'), { leagueId: 'A', active: true });
  await setDoc(doc(db, 'leagueAdmins/orgB'), { leagueId: 'B', active: true });
  await setDoc(doc(db, 'leagueAdmins/orgOff'), { leagueId: 'C', active: false });
  await setDoc(doc(db, 'leagues/A'), { name: 'A', status: 'active', ownerUid: 'orgA', limits: { maxTeams: 8, maxPlayers: 100, photos: true } });
  await setDoc(doc(db, 'leagues/B'), { name: 'B', status: 'active' });                 // بطولة قديمة بلا ownerUid ولا limits
  await setDoc(doc(db, 'leagues/C'), { name: 'C', status: 'active' });
  await setDoc(doc(db, 'leagues/L'), { name: 'L', status: 'active', locked: true, ownerUid: 'orgL' });
  await setDoc(doc(db, 'leagueAdmins/orgL'), { leagueId: 'L', active: true });
  await setDoc(doc(db, 'leagues/A/matches/m1'), { status: 'upcoming' });
  await setDoc(doc(db, 'leagues/A/notifTokens/tok1'), { token: 'tok1' });
  await setDoc(doc(db, 'subscriptions/A'), { leagueId: 'A', endDate: '2027-01-01' });
  await setDoc(doc(db, 'subRequests/r1'), { name: 'xx', phone: '1', email: 'a@b', password: 'secret' });
  await setDoc(doc(db, 'handoverLinks/live'), { pass: 'p', expiresAt: Date.now() + DAY });
  await setDoc(doc(db, 'handoverLinks/expired'), { pass: 'p', expiresAt: Date.now() - DAY });
  await setDoc(doc(db, 'handoverLinks/legacy'), { pass: 'p' });
  await setDoc(doc(db, 'liveStreams/A__m1'), { leagueId: 'A' });
  await setDoc(doc(db, 'liveStreams/A__m1/viewers/v_secret'), { offer: { type: 'offer', sdp: 'x' }, at: 1 });
});

const anon = env.unauthenticatedContext().firestore();
const A = env.authenticatedContext('orgA').firestore();
const B = env.authenticatedContext('orgB').firestore();
const Off = env.authenticatedContext('orgOff').firestore();
const Lk = env.authenticatedContext('orgL').firestore();
const SA = env.authenticatedContext('sa').firestore();
const stranger = env.authenticatedContext('nobody').firestore();   // حساب جديد بلا أي سجلّ
const fake = env.authenticatedContext('fake').firestore();

const results = [];
async function t(name, p) {
  try { await p; results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}

/* ── السوبر أدمن وتصعيد الصلاحيات ── */
await t('السوبر أدمن يقرأ سجلّه', assertSucceeds(getDoc(doc(SA, 'admins/sa'))));
await t('حساب جديد بلا سجلّ ليس سوبر أدمن', assertFails(getDocs(collection(stranger, 'subRequests'))));
await t('role غير superadmin ليس سوبر أدمن', assertFails(getDocs(collection(fake, 'subRequests'))));
await t('منظّم لا يقرأ طلبات الاشتراك', assertFails(getDocs(collection(A, 'subRequests'))));
await t('السوبر أدمن يقرأ طلبات الاشتراك', assertSucceeds(getDocs(collection(SA, 'subRequests'))));
await t('السوبر أدمن ينشئ بطولة', assertSucceeds(setDoc(doc(SA, 'leagues/N'), { name: 'N', status: 'active' })));
await t('منظّم لا ينشئ بطولة', assertFails(setDoc(doc(A, 'leagues/N2'), { name: 'N2', status: 'active' })));

/* ── تعديل مستند البطولة ── */
await t('المنظّم يعدّل اسم بطولته', assertSucceeds(updateDoc(doc(A, 'leagues/A'), { name: 'X' })));
await t('المنظّم لا يعدّل بطولة غيره', assertFails(updateDoc(doc(B, 'leagues/A'), { name: 'Z' })));
await t('بطولة قديمة بلا ownerUid تبقى قابلة للتعديل', assertSucceeds(updateDoc(doc(B, 'leagues/B'), { name: 'Y' })));
await t('المنظّم لا يغيّر حدود اشتراكه', assertFails(updateDoc(doc(A, 'leagues/A'), { limits: { maxTeams: 0, maxPlayers: 0, photos: true } })));
await t('المنظّم لا يغيّر limits.maxTeams', assertFails(updateDoc(doc(A, 'leagues/A'), { 'limits.maxTeams': 0 })));
await t('المنظّم لا يضيف حدوداً لبطولة قديمة', assertFails(updateDoc(doc(B, 'leagues/B'), { limits: { maxTeams: 0 } })));
await t('المنظّم لا يفكّ إيقاف بطولته', assertFails(updateDoc(doc(A, 'leagues/A'), { status: 'suspended' })));
await t('المنظّم يؤرشف بطولته', assertSucceeds(updateDoc(doc(B, 'leagues/B'), { status: 'archived' })));
await t('المنظّم المقفول لا يفكّ القفل', assertFails(updateDoc(doc(Lk, 'leagues/L'), { locked: false })));
await t('السوبر أدمن يغيّر الحدود', assertSucceeds(updateDoc(doc(SA, 'leagues/A'), { limits: { maxTeams: 9, maxPlayers: 150, photos: true } })));

/* ── المباريات والبيانات الفرعية ── */
await t('الزائر يقرأ المباريات', assertSucceeds(getDoc(doc(anon, 'leagues/A/matches/m1'))));
await t('المنظّم يكتب مباريات بطولته', assertSucceeds(updateDoc(doc(A, 'leagues/A/matches/m1'), { status: 'live' })));
await t('منظّم آخر لا يكتب فيها', assertFails(updateDoc(doc(B, 'leagues/A/matches/m1'), { status: 'live' })));
await t('المنظّم الموقوف لا يكتب', assertFails(setDoc(doc(Off, 'leagues/C/matches/x'), { status: 'live' })));
await t('البطولة المقفولة لا تُكتب', assertFails(setDoc(doc(Lk, 'leagues/L/matches/x'), { status: 'live' })));
await t('الزائر لا يكتب مباريات', assertFails(updateDoc(doc(anon, 'leagues/A/matches/m1'), { status: 'live' })));

/* ── توكنات الإشعارات ── */
await t('الزائر يسجّل توكن', assertSucceeds(setDoc(doc(anon, 'leagues/A/notifTokens/tok2'), { token: 'tok2' })));
await t('الزائر يعيد تسجيل نفس التوكن', assertSucceeds(setDoc(doc(anon, 'leagues/A/notifTokens/tok1'), { token: 'tok1' })));
await t('التوكنات غير مقروءة للعالم', assertFails(getDocs(collection(anon, 'leagues/A/notifTokens'))));

/* ── الاشتراكات ── */
await t('المنظّم يقرأ اشتراكه', assertSucceeds(getDoc(doc(A, 'subscriptions/A'))));
await t('منظّم آخر لا يقرأ اشتراك غيره', assertFails(getDoc(doc(B, 'subscriptions/A'))));

/* ── طلبات الاشتراك العامة ── */
await t('الزائر يرسل طلب اشتراك', assertSucceeds(addDoc(collection(anon, 'subRequests'), { name: 'Ali', phone: '0500', email: 'a@b.c', password: 'x' })));
await t('الزائر لا يقرأ الطلبات', assertFails(getDoc(doc(anon, 'subRequests/r1'))));

/* ── روابط التسليم ── */
await t('رابط تسليم ساري يُقرأ', assertSucceeds(getDoc(doc(anon, 'handoverLinks/live'))));
await t('رابط تسليم منتهٍ يُرفض من الخادم', assertFails(getDoc(doc(anon, 'handoverLinks/expired'))));
await t('رابط قديم بلا expiresAt يبقى صالحاً', assertSucceeds(getDoc(doc(anon, 'handoverLinks/legacy'))));
await t('السوبر أدمن يقرأ الرابط المنتهي', assertSucceeds(getDoc(doc(SA, 'handoverLinks/expired'))));
await t('روابط التسليم لا تُسرد', assertFails(getDocs(collection(anon, 'handoverLinks'))));

/* ── مقاعد مشاهدي البث ── */
await t('الزائر يقرأ مقعده بمعرّفه', assertSucceeds(getDoc(doc(anon, 'liveStreams/A__m1/viewers/v_secret'))));
await t('الزائر لا يسرد المقاعد', assertFails(getDocs(collection(anon, 'liveStreams/A__m1/viewers'))));
await t('منظّم آخر لا يسرد المقاعد', assertFails(getDocs(collection(B, 'liveStreams/A__m1/viewers'))));
await t('المذيع يسرد المقاعد', assertSucceeds(getDocs(collection(A, 'liveStreams/A__m1/viewers'))));
await t('الزائر ينشئ مقعداً بعرض offer', assertSucceeds(setDoc(doc(anon, 'liveStreams/A__m1/viewers/v2'), { offer: { type: 'offer', sdp: 'abc' }, at: Date.now() })));
await t('الزائر لا يزوّر answer عند الإنشاء', assertFails(setDoc(doc(anon, 'liveStreams/A__m1/viewers/v3'), { offer: { type: 'offer', sdp: 'a' }, answer: { sdp: 'x' } })));
await t('الزائر لا يكتب answer', assertFails(updateDoc(doc(anon, 'liveStreams/A__m1/viewers/v_secret'), { answer: { type: 'answer', sdp: 'x' } })));
await t('المذيع يكتب answer', assertSucceeds(updateDoc(doc(A, 'liveStreams/A__m1/viewers/v_secret'), { answer: { type: 'answer', sdp: 'x' } })));
await t('المشاهد يحذف مقعده', assertSucceeds(deleteDoc(doc(anon, 'liveStreams/A__m1/viewers/v2'))));
await t('تبادل ICE للمشاهد', assertSucceeds(setDoc(doc(anon, 'liveStreams/A__m1/viewers/v_secret/vcandidates/c1'), { candidate: 'x' })));

await env.cleanup();

let fail = 0;
for (const [s, n, e] of results) { console.log(s === 'PASS' ? '  ✓' : '  ✗', n, e ? '— ' + e : ''); if (s !== 'PASS') fail++; }
console.log(`\n${results.length - fail}/${results.length} نجح`);
process.exit(fail ? 1 : 0);
