/* Replaced with the complete, integrity-checked static file list by the Vite build. */
const BUILD_VERSION = __HELPMINTHS_BUILD_VERSION__;
const PRECACHE_ASSETS = __HELPMINTHS_PRECACHE__;
const CACHE_NAME = `helpminths-static-${BUILD_VERSION}`;
const ASSETS_BY_PATH = new Map(PRECACHE_ASSETS.map(asset => [asset.url, asset]));

function expectedContentType(url, contentType) {
  const extension = url.split('.').pop().toLowerCase();
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const known = {
    html: ['text/html'],
    js: ['application/javascript', 'text/javascript'],
    css: ['text/css'],
    json: ['application/json'],
    webmanifest: ['application/manifest+json', 'application/json'],
    svg: ['image/svg+xml'],
    png: ['image/png'],
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    webp: ['image/webp'],
    ico: ['image/vnd.microsoft.icon', 'image/x-icon'],
    woff2: ['font/woff2', 'application/font-woff2'],
    woff: ['font/woff', 'application/font-woff'],
    ttf: ['font/ttf', 'application/x-font-ttf'],
    otf: ['font/otf', 'application/x-font-opentype'],
  };
  return known[extension] ? known[extension].includes(type) : type !== 'text/html';
}

async function fetchAsset(asset) {
  const response = await fetch(new Request(asset.url, {
    cache: 'reload',
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    integrity: asset.integrity,
  }));
  if (response.status !== 200 || !expectedContentType(asset.url, response.headers.get('content-type'))) {
    throw new Error('Static asset failed validation');
  }
  return response;
}

async function installAssets() {
  const cache = await caches.open(CACHE_NAME);
  // Await every transfer before declaring readiness or deleting an incomplete cache.
  const outcomes = await Promise.allSettled(PRECACHE_ASSETS.map(async asset => {
    await cache.put(asset.url, await fetchAsset(asset));
  }));
  if (outcomes.some(outcome => outcome.status === 'rejected')) {
    await caches.delete(CACHE_NAME);
    throw new Error('The complete offline app could not be downloaded');
  }
}

self.addEventListener('install', event => {
  event.waitUntil(installAssets());
  // Updates wait for existing tabs to close. Never replace their active worker.
});

self.addEventListener('activate', event => {
  // Keep previous version caches: open tabs may still reference their lazy chunks.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'HELPMINTHS_OFFLINE_STATUS' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const complete = await Promise.all(PRECACHE_ASSETS.map(asset => cache.match(asset.url)));
    event.ports[0].postMessage({
      ready: complete.every(Boolean),
      version: BUILD_VERSION,
      total: PRECACHE_ASSETS.length,
    });
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.protocol !== self.location.protocol) return;
  // Medical images/results and every API request always bypass the static cache.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  const pathname = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')
    ? '/index.html'
    : url.pathname;
  const asset = ASSETS_BY_PATH.get(pathname);
  if (!asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(asset.url);
    if (cached) return cached;
    // Recover evicted static files only when their build integrity still matches.
    const response = await fetchAsset(asset);
    await cache.put(asset.url, response.clone());
    return response;
  })());
});
