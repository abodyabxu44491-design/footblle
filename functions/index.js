/* ═══════════════════════════════════════════════════════════════════
 *  معاينة روابط البطولات — /l/{leagueId}
 *  ───────────────────────────────────────────────────────────────────
 *  المشكلة: صفحة الجمهور ثابتة، فكل رابط بطولة يُشارَك في واتساب يظهر
 *  بعنوان «منصة بطولات» العام وصورة المنصة — لا اسم البطولة ولا شعارها.
 *  زاحفات المعاينة لا تنفّذ JavaScript، فلا حلّ من داخل الصفحة.
 *
 *  الحل: رابط مشاركة قصير  https://footblle2.web.app/l/abcd
 *    • الزاحف (واتساب/تيليجرام/تويتر/فيسبوك…) ← HTML صغير بوسوم og:
 *      تحمل اسم البطولة وموسمها وشعارها.
 *    • الإنسان ← تحويل فوري إلى league-viewer.html?id=abcd
 *  الروابط القديمة (league-viewer.html?id=) تبقى تعمل كما هي.
 *
 *  التفعيل: docs/تفعيل-معاينة-الروابط.md
 * ═══════════════════════════════════════════════════════════════════ */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const SITE = 'https://footblle2.web.app/';
const BOT = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|applebot|snapchat|pinterest|embedly|vkshare|redditbot/i;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

exports.leaguePreview = onRequest({ region: 'us-central1', memory: '256MiB', maxInstances: 10 }, async (req, res) => {
  const id = String(req.path.split('/').filter(Boolean)[1] || '');
  if (!/^[\w-]{2,64}$/.test(id)) { res.redirect(302, SITE); return; }
  const target = SITE + 'league-viewer.html?id=' + encodeURIComponent(id);

  if (!BOT.test(req.get('user-agent') || '')) {
    res.set('Cache-Control', 'public, max-age=300');
    res.redirect(302, target);
    return;
  }

  let title = 'منصة بطولات', desc = 'نتائج وترتيب وأحداث البطولة مباشرة', image = SITE + 'icon-512.png';
  try {
    const snap = await admin.firestore().doc('leagues/' + id).get();
    if (snap.exists) {
      const L = snap.data() || {};
      if (L.name) title = L.name + (L.season ? ' — ' + L.season : '');
      desc = 'تابع نتائج ' + (L.name || 'البطولة') + ' مباشرة: المباريات، الترتيب، الهدّافون والبث.';
      /* الشعار: رابط مطلق فقط — شعار data: لا تقرؤه الزاحفات */
      if (typeof L.logo === 'string' && /^https:\/\//.test(L.logo)) image = L.logo;
    }
  } catch (e) { /* نعرض المعاينة العامة بدل الفشل */ }

  res.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  res.status(200).send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(target)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_SA">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><a href="${esc(target)}">${esc(title)}</a></body></html>`);
});
