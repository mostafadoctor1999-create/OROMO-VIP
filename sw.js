/* ==========================================================
   OROMO VIP — Service Worker
   يحفظ هيكل التطبيق ليعمل بسرعة وبدون إنترنت.
   ========================================================== */

const CACHE_NAME = 'oromo-vip-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

const RUNTIME_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);

    // الملفات الخارجية: نحاول حفظها ولا نوقف التثبيت لو فشلت
    const external = [
      'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js'
    ];
    await Promise.all(external.map((url) =>
      fetch(url, { mode: 'cors' })
        .then((res) => (res.ok ? cache.put(url, res) : null))
        .catch(() => null)
    ));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const trusted = RUNTIME_HOSTS.includes(url.hostname);
  if (!sameOrigin && !trusted) return;

  // التنقل بين الصفحات: الشبكة أولاً ثم الكاش (مع دعم ?view=staff)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // باقي الملفات: الكاش أولاً مع تحديث في الخلفية
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
