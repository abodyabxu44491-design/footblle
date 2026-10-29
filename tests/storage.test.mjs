/* اختبارات قواعد Storage — على المحاكي (Storage + Firestore معاً)
 *   cd tests && npm run test:storage */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadString, deleteObject, getBytes } from 'firebase/storage';

const env = await initializeTestEnvironment({
  projectId: 'demo-footballa',
  storage:   { rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9199 },
  firestore: { rules: 'service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if true; } } }', host: '127.0.0.1', port: 8085 },
});

await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'admins/sa'), { role: 'superadmin' });
  await setDoc(doc(db, 'leagueAdmins/orgA'), { leagueId: 'A', active: true });
  await setDoc(doc(db, 'leagueAdmins/orgB'), { leagueId: 'B', active: true });
  await setDoc(doc(db, 'leagues/A/teams/tA'), { name: 'فريق أ' });
  await setDoc(doc(db, 'leagues/B/teams/tB'), { name: 'فريق ب' });
  await uploadString(ref(c.storage(), 'players/tA/p1'), 'x', 'raw', { contentType: 'image/png' });
  await uploadString(ref(c.storage(), 'replays/A__m1/1.webm'), 'x', 'raw', { contentType: 'video/webm' });
});

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const img = { contentType: 'image/png' }, vid = { contentType: 'video/webm' };
const R = [];
async function t(n, p) { try { await p; R.push(['PASS', n]); } catch (e) { R.push(['FAIL', n, e.message.split('\n')[0]]); } }

await t('الزائر يقرأ صورة لاعب', assertSucceeds(getBytes(ref(st(null), 'players/tA/p1'))));
await t('المنظّم يرفع صورة لفريقه', assertSucceeds(uploadString(ref(st('orgA'), 'players/tA/p2'), 'x', 'raw', img)));
await t('منظّم آخر لا يستبدل صورة فريق غيره', assertFails(uploadString(ref(st('orgB'), 'players/tA/p1'), 'x', 'raw', img)));
await t('منظّم آخر لا يحذف صورة فريق غيره', assertFails(deleteObject(ref(st('orgB'), 'players/tA/p1'))));
await t('حساب بلا سجلّ لا يرفع', assertFails(uploadString(ref(st('nobody'), 'players/tA/p3'), 'x', 'raw', img)));
await t('ليس صورة = مرفوض', assertFails(uploadString(ref(st('orgA'), 'players/tA/p4'), 'x', 'raw', { contentType: 'text/html' })));
await t('السوبر أدمن يحذف أي صورة', assertSucceeds(deleteObject(ref(st('sa'), 'players/tA/p2'))));
await t('المذيع يرفع إعادة لبطولته', assertSucceeds(uploadString(ref(st('orgA'), 'replays/A__m1/2.webm'), 'x', 'raw', vid)));
await t('منظّم آخر لا يرفع إعادة لبطولة غيره', assertFails(uploadString(ref(st('orgB'), 'replays/A__m1/3.webm'), 'x', 'raw', vid)));
await t('منظّم آخر لا يحذف إعادات غيره', assertFails(deleteObject(ref(st('orgB'), 'replays/A__m1/1.webm'))));
await t('الزائر يشاهد الإعادة', assertSucceeds(getBytes(ref(st(null), 'replays/A__m1/1.webm'))));

await env.cleanup();
let fail = 0;
for (const [s, n, e] of R) { console.log(s === 'PASS' ? '  ✓' : '  ✗', n, e ? '— ' + e : ''); if (s !== 'PASS') fail++; }
console.log(`\n${R.length - fail}/${R.length} نجح`);
process.exit(fail ? 1 : 0);
