// Service worker de la web app: permite abrir nprojects sin conexión.
// - Páginas (navegación): primero la red, con 3 s de margen; si no hay, la copia guardada.
// - Recursos propios (css, js, iconos): la copia guardada al momento y se actualiza por detrás.
// - Supabase y cualquier otro dominio: no se tocan (pasan directos a la red).
// Los datos del usuario siguen en localStorage; aquí solo se guardan los ficheros de la app.
const CACHE = 'nprojects-app-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', '../config.js', '../favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Guarda también app.css y app.js con el ?v= que enlace la página en ese momento.
    const res = await cache.match('./');
    const html = res ? await res.text() : '';
    const assets = [...html.matchAll(/(?:href|src)="(app\.(?:css|js)\?v=[^"]+)"/g)].map(m => m[1]);
    if (assets.length) await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('nprojects-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 3000);
    if (res.ok) await cache.put('./', res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./')) || Response.error();
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req).then(async res => {
    if (res.ok && res.type === 'basic') {
      await prune(cache, req.url);
      await cache.put(req, res.clone());
    }
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

// Borra las versiones antiguas del mismo fichero (app.js?v=viejo) para que la caché no crezca.
async function prune(cache, href) {
  const u = new URL(href);
  if (!u.search) return;
  for (const old of await cache.keys()) {
    const o = new URL(old.url);
    if (o.pathname === u.pathname && o.search !== u.search) await cache.delete(old);
  }
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}
