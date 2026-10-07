// Offline support for field use: app shell + data are cached on first visit (network-first so new
// deployments win); map tiles are cached as they are viewed (cache-first, capped).
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const TILES = "tiles-v1";
const MAX_TILES = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    const base = self.registration.scope;
    const files = ["", "index.html", "manifest.webmanifest", "icon.svg", ...[
      "locais.json", "resultados.json", "candidatos.json", "cadeiras.json", "regioes.json", "insights.json", "sobreposicao.json",
      "geografia.json", "extras.json", "perfil_disputa.json", "modelo.json", "transferencias.json", "osm.json", "meta.json",
      "regioes.geojson", "bairros.geojson", "setores.geojson", "distritos.geojson", "areas.geojson",
    ].map((f) => `data/${f}`)];
    await Promise.allSettled(files.map((f) => c.add(new Request(base + f, { cache: "reload" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname.includes("arcgisonline.com") || url.hostname.includes("demotiles.maplibre.org")) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok || res.type === "opaque") { c.put(e.request, res.clone()); trimTiles(); }
        return res;
      } catch { return hit ?? Response.error(); }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      } catch {
        return (await c.match(e.request)) ?? (await c.match(self.registration.scope + "index.html")) ?? Response.error();
      }
    })());
  }
});
