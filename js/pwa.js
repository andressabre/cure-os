// Registra o service worker (instalável + abre o login offline). Silencioso: nunca mostra aviso.
export function registrarPWA() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const { protocol, hostname } = location;
    const local = hostname === 'localhost' || hostname === '127.0.0.1';
    if (protocol !== 'https:' && !local) return;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch { /* sem PWA, o sistema funciona igual */ }
}
