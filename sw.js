'use strict';

const VERSION = 'game-rotator-firebase-v1.0.5';
const CACHE_NAME = `grcc-${VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './firebase/firebase.config.js',
  './firebase/auth.service.js',
  './firebase/firestore.service.js',
  './services/consoles.service.js',
  './services/games.service.js',
  './services/sessions.service.js',
  './services/stats.service.js',
  './services/rotation.service.js',
  './services/migration.service.js',
  './ui/modals.js',
  './ui/navigation.js',
  './ui/charts.js',
  './utils/constants.js',
  './utils/dates.js',
  './utils/formatters.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('grcc-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return caches.match('./index.html');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then((fresh) => {
      const cache = caches.open(CACHE_NAME);
      cache.then((c) => c.put(req, fresh.clone()));
      return fresh;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
