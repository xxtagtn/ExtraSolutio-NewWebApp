const CACHE_NAME = 'extrasolutio-pwa-v6';
const PUSH_CACHE = 'extrasolutio-push-settings';
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
          .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== PUSH_CACHE)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

function pushPath(value) {
  return value === '/profile' || (typeof value === 'string' && /^\/services\/[1-9]\d*\?tab=team&day=\d{4}-\d{2}-\d{2}&push=1$/.test(value)) ? value : null;
}

async function pushOwnerMatches(cache, receiverId) {
  const owner = await cache.match('/__push-owner');
  return owner && await owner.text() === String(receiverId);
}

let pushQueue = Promise.resolve();
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || !pushPath(payload.url) || !/^[pt]-[A-Za-z0-9-]{1,28}$/.test(payload.tag)) return;
  // Serialize concurrent retries; persistent tags survive worker restarts.
  pushQueue = pushQueue.catch(() => {}).then(async () => {
    const cache = await caches.open(PUSH_CACHE);
    if (!await pushOwnerMatches(cache, payload.receiverId)) return;
    const seen = `/__push-seen/${payload.receiverId}/${payload.tag}`;
    if (await cache.match(seen)) return;
    await self.registration.showNotification(String(payload.title).slice(0, 100), {
      body: String(payload.body).slice(0, 800), tag: payload.tag, renotify: false,
      icon: '/pwa-icons/icon-192-v6.png',
      data: { url: payload.url, receiverId: payload.receiverId },
    });
    await cache.put(seen, new Response(String(Date.now())));
    const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname.startsWith('/__push-seen/'));
    for (const key of keys.slice(0, Math.max(0, keys.length - 200))) await cache.delete(key);
  });
  event.waitUntil(pushQueue);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = pushPath(event.notification.data?.url);
  if (!path) return;
  event.waitUntil((async () => {
    if (!await pushOwnerMatches(await caches.open(PUSH_CACHE), event.notification.data.receiverId)) return;
    const target = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) {
      const navigated = await client.navigate(target);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(target);
  })());
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
