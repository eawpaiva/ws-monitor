/* Service worker do WS Monitor: guarda o app em cache para abrir mesmo com o servidor local parado.
   Estratégia "rede primeiro" para os arquivos do app (atualiza quando o servidor está ativo).
   A versão vem do registro (sw.js?v=<APP_VERSION> em js/app.js): trocar a versão do app renova o cache.
   Ao criar um arquivo novo do app, adicione-o em SHELL. */
const CACHE = 'ws-monitor-' + (new URL(self.location.href).searchParams.get('v') || 'dev');
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/format.js',
  'js/logsink.js',
  'js/recorder.js',
  'js/serial.js',
  'js/ui.js',
  'js/util.js',
  'js/views.js',
  'js/wh24c.js',
  'assets/icons/app-icon.svg',
  'assets/icons/favicon.ico',
  'assets/icons/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/fonts/Montserrat-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ws-monitor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
