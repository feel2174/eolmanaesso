// 얼마내쏘 서비스 워커 (PWA 오프라인 지원 & 네트워크 우선 최신 캐싱)
const CACHE_NAME = 'gyeongjosa-v3-pure-cloudflare';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './cloudSync.js',
  './manifest.webmanifest',
  './icon.svg',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('PWA 캐시 일부 실패:', err));
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // API 호출 및 비GET 요청은 서비스 워커 우회
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }
  // 항상 네트워크 우선(Network First): 최신 배포본 즉시 반영, 오프라인 시 캐시 사용
  event.respondWith(
    fetch(event.request).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
      }
      return networkResponse;
    }).catch(() => {
      return caches.match(event.request).then(cached => cached || caches.match('./index.html'));
    })
  );
});

