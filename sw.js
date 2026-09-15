// 얼마내쏘 서비스 워커 (PWA 오프라인 캐싱)
const CACHE_NAME = 'gyeongjosa-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './cloudSync.js',
  './manifest.webmanifest',
  './icon.svg',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('PWA 캐시 일부 실패:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // API 호출 등은 네트워크 우선
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
