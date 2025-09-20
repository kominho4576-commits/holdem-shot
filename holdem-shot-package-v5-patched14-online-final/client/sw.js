self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open('hs-v1').then(cache => cache.addAll([
    '/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'
  ])));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});