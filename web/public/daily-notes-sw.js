// تطبيق الملاحظات اليومية يعمل بدون إنترنت بعد أول فتح
const CACHE = 'shams-daily-notes-v2';
const BASE = new URL('./', self.location).href;
const PAGE = new URL('daily-notes.html', BASE).href;
const CORE = [
  'daily-notes.html',
  'daily-notes.webmanifest',
  'daily-notes-192.png',
  'daily-notes-512.png',
  'daily-notes-maskable.png',
  'daily-notes-apple.png'
].map((p) => new URL(p, BASE).href);

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
  const clean = url.origin + url.pathname;
  const isPage = clean === PAGE;
  const isOwn = CORE.includes(clean);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isOwn && !isFont) return; // باقي النظام لا يمر من هنا

  if (isPage) {
    // الصفحة: من الشبكة أولًا حتى تصل التحديثات، ومن النسخة المحفوظة عند انقطاع الإنترنت
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(PAGE, copy)); }
        return res;
      }).catch(() => caches.match(PAGE))
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
