// ══ Service Worker — منصة بطولات ══
/* ⚠️ ارفع هذا الرقم مع كل نشر، وإلا خدم الـ SW نسخة قديمة من
   admin.js / TimerCore فتنكسر الاستبدالات وتعود أخطاء الساعة. */
const VERSION = 'batolat-v73';

// أهم ملفات صفحة الجمهور فقط (offline يخص الجمهور بشكل أساسي)
const SHELL = [
  './',
  './league-viewer.html',
  './viewer.css',
  './viewer.js',
  './all-fixes.js',
  './timer-hotfix.js',
  './clock-sync.js',
  './viewer-perf.js',
  './viewer-emoji-svg.js',
  './match-share-card.js',
  './date-groups.js',
  './tiebreak-rules.js',
  './matches-tabs.js',
  './admin-matches-tabs.js',
  './groups-gate.js',
  './league-logo.js',
  './lock-guard.js',
  './health-check.js',
  './pwa-install.js',
  './predictions.js',
  './viewport-lock.js',
  './manifest.json',
  './manifest-viewer.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './offline.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(async c => {
        // نضيف كل ملف لحاله بدل addAll الجماعي، حتى لو ملف واحد ناقص
        // (مثلاً أيقونة لسه ما انرفعت) ما يفشل تجهيز باقي الكاش كامل
        await Promise.allSettled(
          SHELL.map(url =>
            fetch(new Request(url, { cache: 'reload' }))
              .then(res => { if (res && res.ok) return c.put(url, res); })
              .catch(() => {})
          )
        );
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Install error:', err))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('fonts.google') ||
    url.protocol === 'chrome-extension:'
  ) return;
  if (e.request.method !== 'GET') return;
  if (e.request.destination === 'document') { e.respondWith(networkFirst(e.request)); return; }
  if (e.request.destination === 'script' || e.request.destination === 'style' ||
      url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(staleWhileRevalidate(e.request)); return;
  }
  if (e.request.destination === 'image') { e.respondWith(cacheFirst(e.request)); return; }
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.status === 200) { const cache = await caches.open(VERSION); cache.put(request, res.clone()); }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // مستند بمعاملات (?id=...) قد لا يطابق النسخة المخزّنة — جرّب المسار الأساسي
    if (request.destination === 'document') {
      const u = new URL(request.url);
      const base = u.pathname; // بلا query
      const byPath = await caches.match(base) || await caches.match('./league-viewer.html');
      if (byPath) return byPath;
      return caches.match('./offline.html');
    }
    return new Response('', { status: 408 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.status === 200) { const cache = await caches.open(VERSION); cache.put(request, res.clone()); }
    return res;
  } catch { return new Response('', { status: 408 }); }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || fetchPromise;
}

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => { e.source?.postMessage({ type: 'CACHE_CLEARED' }); });
  }
});

// ══════════════════════════════════════
//  PUSH NOTIFICATIONS HANDLER
// ══════════════════════════════════════
self.addEventListener('push', e => {
  if (!e.data) return;

  let payload = {};
  try { payload = e.data.json(); } catch { payload = { notification: { title: 'منصة بطولات', body: e.data.text() } }; }

  const { title, body, icon, badge, data } = payload.notification || payload;

  const options = {
    body: body || '',
    icon: icon || './icon-192.png',
    badge: badge || './icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [100, 50, 100],
    requireInteraction: false,
    data: data || {},
    actions: [
      { action: 'open', title: 'فتح التطبيق' },
      { action: 'close', title: 'إغلاق' }
    ]
  };

  const eventType = payload.eventType || data?.eventType || '';
  if (eventType === 'goal')       options.badge = './icon-192.png';
  if (eventType === 'match_start') options.vibrate = [200, 100, 200, 100, 200];
  if (eventType === 'match_end')   options.requireInteraction = true;

  e.waitUntil(
    self.registration.showNotification(title || 'منصة بطولات', options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'close') return;

  const leagueId = e.notification.data?.leagueId || '';
  const targetUrl = leagueId
    ? self.location.origin + '/league-viewer.html?id=' + leagueId
    : self.location.origin + '/league-viewer.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('league-viewer') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('notificationclose', e => {
  console.log('[SW] Notification closed:', e.notification.title);
});
