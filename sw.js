/* =============================================================================
  sw.js — Game Rotator (PWA) — v3 (GitHub Pages friendly)
  -----------------------------------------------------------------------------
  Goals:
  - Updates propagate reliably (especially index.html on GitHub Pages).
  - Keep LocalStorage intact (SW never touches it).
  - Caching strategy:
      * Navigations (HTML): network-first + offline fallback to cached index.html
      * Static assets (js/css/img/fonts/manifest): stale-while-revalidate
      * Other same-origin GET: cache-first
  - Safe cache cleanup + skipWaiting support
============================================================================= */

'use strict';

/** Bump this on every release */
const VERSION = "rotator-2026-03-04-v3";
const CACHE_PREFIX = "rotator-cache-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;

/** Set true if you want to effectively disable caching (useful in dev) */
const DEV_BYPASS = false;

/** Files you want available offline ASAP */
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png" // ok if missing, we handle gracefully
];

/* ---------------------------------
   Helpers
--------------------------------- */

function isGet(req) {
  return req && req.method === "GET";
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNavigationRequest(req) {
  return req.mode === "navigate" ||
    req.destination === "document" ||
    (req.headers.get("accept") || "").includes("text/html");
}

function isStaticAssetRequest(req) {
  const dest = req.destination;
  if (["script", "style", "image", "manifest", "font"].includes(dest)) return true;

  // fallback by extension (sometimes destination is empty)
  const url = new URL(req.url);
  return /\.(js|css|png|jpg|jpeg|webp|svg|ico|json|webmanifest|woff2?|ttf|otf)$/i.test(url.pathname);
}

/**
 * Normalize URL so cache doesn't explode with utm/fbclid/etc.
 * We keep essential params, remove common trackers and SW version param.
 */
function normalizeUrl(input) {
  const url = new URL(input, self.location.origin);

  // remove SW cache-busting param + common tracking params
  const DROP = [
    "v", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid"
  ];
  DROP.forEach(k => url.searchParams.delete(k));

  // Normalize hash away for cache key (hash doesn't affect network anyway)
  url.hash = "";

  return url.toString();
}

async function cachePutSafe(cacheName, requestOrUrl, response) {
  try {
    const cache = await caches.open(cacheName);
    const req = (requestOrUrl instanceof Request)
      ? requestOrUrl
      : new Request(String(requestOrUrl), { method: "GET" });

    await cache.put(req, response);
  } catch {
    // SWs should be calm creatures. This one tries.
  }
}

async function matchCache(requestOrUrl) {
  const req = (requestOrUrl instanceof Request)
    ? requestOrUrl
    : new Request(String(requestOrUrl), { method: "GET" });

  return caches.match(req, { ignoreVary: true });
}

/* ---------------------------------
   Install
--------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (DEV_BYPASS) return self.skipWaiting();

    const cache = await caches.open(CACHE_NAME);

    // Cache-bust core assets during install so we don't grab stale files.
    // But we still SERVE them via normalized URLs later.
    const toCache = CORE_ASSETS.map((u) => `${u}?v=${encodeURIComponent(VERSION)}`);

    // Some assets might not exist (maskable icon, screenshots, etc.)
    // So we cache with "allSettled" semantics.
    await Promise.allSettled(
      toCache.map(async (u) => {
        try {
          const res = await fetch(u, { cache: "no-store" });
          if (res && (res.ok || res.type === "opaque")) {
            await cachePutSafe(CACHE_NAME, normalizeUrl(u), res.clone());
          }
        } catch {
          // ignore missing during install
        }
      })
    );

    await self.skipWaiting();
  })());
});

/* ---------------------------------
   Activate
--------------------------------- */

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (DEV_BYPASS) return self.clients.claim();

    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

/* ---------------------------------
   Messages
--------------------------------- */

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ---------------------------------
   Strategies
--------------------------------- */

/** HTML / navigation: network-first with offline fallback to cached index.html */
async function networkFirstNav(req) {
  const url = new URL(req.url);
  const key = normalizeUrl(url.toString());

  try {
    // For GH Pages, "no-store" helps reduce stale CDN behavior
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      await cachePutSafe(CACHE_NAME, key, fresh.clone());
      return fresh;
    }
    throw new Error("Bad response");
  } catch {
    // Offline fallback: cached navigation response
    const cached = await matchCache(key);
    if (cached) return cached;

    // If we can't match the exact navigation URL, fallback to cached index.html
    const cachedIndex = await matchCache(normalizeUrl(`${self.location.origin}${self.registration.scope}index.html`));
    if (cachedIndex) return cachedIndex;

    // Last resort: try cache match of "./index.html" relative
    const cachedIndex2 = await matchCache(normalizeUrl("./index.html"));
    if (cachedIndex2) return cachedIndex2;

    // Nothing cached: give a minimal offline response
    return new Response(
      `<!doctype html>
      <html lang="es">
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Offline</title>
      <body style="font-family:system-ui;background:#0b1020;color:#e5e7eb;padding:24px;">
        <h1 style="margin:0 0 10px;">Estás offline 😶</h1>
        <p style="opacity:.8;line-height:1.4;margin:0 0 10px;">
          No hay versión en caché disponible todavía. Abre la app una vez con internet y luego sí.
        </p>
      </body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
}

/** Static assets: stale-while-revalidate */
async function staleWhileRevalidate(req) {
  const key = normalizeUrl(req.url);

  const cached = await matchCache(key);

  const fetchPromise = (async () => {
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) {
        await cachePutSafe(CACHE_NAME, key, res.clone());
      }
      return res;
    } catch {
      return null;
    }
  })();

  return cached || (await fetchPromise) || cached;
}

/** Other GET: cache-first with network fill */
async function cacheFirst(req) {
  const key = normalizeUrl(req.url);

  const cached = await matchCache(key);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      await cachePutSafe(CACHE_NAME, key, res.clone());
    }
    return res;
  } catch {
    return cached || Response.error();
  }
}

/* ---------------------------------
   Fetch
--------------------------------- */

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!isGet(req)) return;

  if (DEV_BYPASS) return;

  const url = new URL(req.url);

  // Only same-origin; don't mess with external APIs/analytics/CDNs.
  if (!isSameOrigin(url)) return;

  // Strategy routing
  if (isNavigationRequest(req)) {
    event.respondWith(networkFirstNav(req));
    return;
  }

  if (isStaticAssetRequest(req)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});