// STKEYCLUB Photo Booth – service worker.
// Caches every file of the app so it starts with no internet after the first visit.
//
// >>> Bump VERSION on every deploy (and whenever frame.png changes). <<<
// A new VERSION makes browsers download a fresh copy of every file below and
// delete the old cache; the booth reloads itself the next time it is idle.
const VERSION = '2026-11-19.4';
const CACHE = `stkeyclub-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'frame.png',
  'manifest.webmanifest',
  'js/app.js',
  'js/boot-guard.js',
  'js/camera.js',
  'js/compose.js',
  'js/filters.js',
  'js/frame.js',
  'js/operator.js',
  'js/print.js',
  'js/settings.js',
  'js/sound.js',
  'js/store.js',
  'js/testprint.js',
  'js/util.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' skips the HTTP cache so a new version never stores stale files.
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('stkeyclub-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        if (req.mode === 'navigate') {
          const page = (await cache.match('./')) || (await cache.match('index.html'));
          if (page) return page;
        } else {
          const hit = await cache.match(req, { ignoreSearch: true });
          if (hit) return hit;
        }
      } catch {
        /* fall through to the network */
      }
      return fetch(req);
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});
