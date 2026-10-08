// لوحة شمس الوطن: تشتغل بدون إنترنت بعد أول فتح
const CACHE = 'shams-math-board-v4';
const BASE = new URL('./', self.location).href;
const PAGES = [BASE, new URL('index.html', BASE).href];
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'icon-apple.png']
  .map((p) => new URL(p, BASE).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shams-math-board-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const clean = url.origin + url.pathname;
  const isPage = PAGES.includes(clean);
  const isOwn = CORE.includes(clean);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isOwn && !isFont) return;

  if (isPage) {
    // الصفحة من الشبكة أولًا حتى تصل التحديثات، ومن النسخة المحفوظة بدون إنترنت
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(clean, copy)); }
        return res;
      }).catch(() => caches.match(clean).then((hit) => hit || caches.match(BASE)))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
