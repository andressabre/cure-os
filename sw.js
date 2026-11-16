// Cure OS — service worker leve: REDE PRIMEIRO só para arquivos do próprio site (telas, scripts, estilos, imagens).
// Guarda uma cópia para abrir a tela de login sem internet. Nunca toca em Supabase, fontes ou CDN (dados de paciente não passam por aqui).
const VERSAO = 'cureos-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // outro domínio: passa direto, sem cache
  ev.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp && resp.ok && resp.type === 'basic') {
        const copia = resp.clone();
        ev.waitUntil(caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {}));
      }
      return resp;
    } catch (e) {
      const guardada = await caches.match(req, { ignoreSearch: false })
        || (req.mode === 'navigate' ? await caches.match('./index.html') : undefined);
      if (guardada) return guardada;
      throw e;
    }
  })());
});
