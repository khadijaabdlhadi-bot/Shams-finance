// تطبيق الملاحظات اليومية يعمل بدون إنترنت بعد أول فتح
const CACHE = 'shams-daily-notes-v1';
const CORE = [
  '/daily-notes.html',
  '/daily-notes.webmanifest',
  '/daily-notes-192.png',
  '/daily-notes-512.png',
  '/daily-notes-maskable.png',
  '/daily-notes-apple.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shams-daily-notes-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPage = url.origin === location.origin && url.pathname === '/daily-notes.html';
  const isOwn = url.origin === location.origin && CORE.includes(url.pathname);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isOwn && !isFont) return;

  if (isPage) {
    // الصفحة: من الشبكة أولًا حتى تصل التحديثات، ومن النسخة المحفوظة عند انقطاع الإنترنت
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put('/daily-notes.html', res.clone()));
        return res;
      }).catch(() => caches.match('/daily-notes.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }))
  );
});
