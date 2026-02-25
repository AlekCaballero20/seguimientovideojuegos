/* =============================================================================
  sw.js — Game Rotator (PWA) — improved
  -----------------------------------------------------------------------------
  Goals:
  - Updates from GitHub Pages should propagate reliably (especially index.html).
  - Keep LocalStorage intact (SW never touches it).
  - Better caching strategy:
      * index.html: Network-first (so UI updates show up ASAP)
      * versioned assets: Stale-while-revalidate (fast + updates in background)
      * others: Cache-first fallback
  - Safe cache cleanup + skipWaiting support
============================================================================= */

const VERSION = "rotator-2026-01-18-v2"; // <-- CAMBIA esto en cada release
const CACHE = `rotator-cache-${VERSION}`;

// Assets “core” (los que más te importa que se actualicen rápido)
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Qué tratamos como “navegación” (HTML principal)
function isNavigationRequest(req) {
  return req.mode === "navigate" ||
    (req.destination === "document") ||
    (req.headers.get("accept") || "").includes("text/html");
}

// Para distinguir assets estáticos típicos
function isStaticAssetRequest(req) {
  const dest = req.destination; // script, style, image, manifest, font, etc.
  if (["script", "style", "image", "manifest", "font"].includes(dest)) return true;

  // Fallback por extensión (por si destination viene vacío)
  const url = new URL(req.url);
  return /\.(js|css|png|jpg|jpeg|webp|svg|ico|json|woff2?|ttf|otf)$/i.test(url.pathname);
}

// Limpia el parámetro v (para matchear consistente)
function normalizeUrl(requestUrl) {
  const u = new URL(requestUrl);
  u.searchParams.delete("v");
  return u.toString();
}

// Helpers de cache
async function cachePutSafe(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Silencio diplomático. No somos un SW dramático.
  }
}

/* ---------------------------
   Install
--------------------------- */
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // Precarga con “cache busting” por versión para evitar assets viejos
    const toCache = CORE_ASSETS.map((url) => `${url}?v=${encodeURIComponent(VERSION)}`);
    await cache.addAll(toCache);

    // Activa inmediatamente (la app ya manda SKIP_WAITING también)
    await self.skipWaiting();
  })());
});

/* ---------------------------
   Activate
--------------------------- */
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("rotator-cache-") && k !== CACHE)
        .map((k) => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

/* ---------------------------
   Messages
--------------------------- */
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ---------------------------
   Strategies
--------------------------- */

// 1) Network-first para navegación (index.html)
async function networkFirst(req) {
  const cacheKey = normalizeUrl(req.url);

  try {
    const fresh = await fetch(req);

    // Guarda copia si es OK (o opaque)
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      await cachePutSafe(CACHE, cacheKey, fresh.clone());
    }
    return fresh;
  } catch {
    // Si no hay red, cae al cache
    const cached = await caches.match(cacheKey);
    if (cached) return cached;

    // Último recurso: intentar con request original
    return caches.match(req);
  }
}

// 2) Stale-while-revalidate para assets estáticos
async function staleWhileRevalidate(req) {
  const cacheKey = normalizeUrl(req.url);
  const cached = await caches.match(cacheKey);

  const fetchPromise = fetch(req)
    .then(async (res) => {
      if (res && (res.ok || res.type === "opaque")) {
        await cachePutSafe(CACHE, cacheKey, res.clone());
      }
      return res;
    })
    .catch(() => null);

  // Responde rápido con cache si existe; si no, espera red
  return cached || (await fetchPromise) || cached;
}

// 3) Cache-first para lo demás
async function cacheFirst(req) {
  const cacheKey = normalizeUrl(req.url);
  const cached = await caches.match(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      await cachePutSafe(CACHE, cacheKey, res.clone());
    }
    return res;
  } catch {
    return cached;
  }
}

/* ---------------------------
   Fetch
--------------------------- */
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // Solo GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // No tocar requests a otros origins (analytics, apis externas, etc.)
  if (url.origin !== self.location.origin) return;

  // Estrategia:
  // - HTML principal: network-first (para que GitHub updates aparezcan rápido)
  // - Assets estáticos: stale-while-revalidate
  // - Lo demás: cache-first
  if (isNavigationRequest(req)) {
    e.respondWith(networkFirst(req));
    return;
  }

  if (isStaticAssetRequest(req)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  e.respondWith(cacheFirst(req));
});