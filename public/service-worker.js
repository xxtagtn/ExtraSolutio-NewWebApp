const CACHE_NAME = 'extrasolutio-pwa-v6';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/manifest-v6.webmanifest',
  '/pwa-icons/icon-192-v6.png',
  '/pwa-icons/icon-512-v6.png',
  '/pwa-icons/icon-512-maskable-v6.png',
  '/pwa-icons/apple-touch-icon-v6.png',
];

function isApiRequest(url) {
  return url.pathname.startsWith('/api')
    || url.pathname.startsWith('/uploads')
    || url.pathname.startsWith('/socket.io');
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedRoot = await caches.match('/');
    return cachedRoot || Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});
