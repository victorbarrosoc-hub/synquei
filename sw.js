// Modo offline do Synquei: guarda o site e o app na primeira visita. HTML vem da rede quando dá (para pegar
// versões novas); o resto vem do cache e é atualizado em segundo plano.
const CACHE = 'synquei-v5'
const CORE = [
  '/',
  '/site.css',
  '/site.js',
  '/formatos/',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/app/',
  '/app/app.css',
  '/app/js/atualizacao.js',
  '/app/js/demo.js',
  '/app/js/export/fcpxml.js',
  '/app/js/export/index.js',
  '/app/js/export/model.js',
  '/app/js/export/others.js',
  '/app/js/export/xmeml.js',
  '/app/js/export/zip.js',
  '/app/js/main.js',
  '/app/js/media/devices.js',
  '/app/js/media/ebml.js',
  '/app/js/media/extract.js',
  '/app/js/media/formats.js',
  '/app/js/media/mp4.js',
  '/app/js/media/mxf.js',
  '/app/js/media/probe.js',
  '/app/js/media/raw.js',
  '/app/js/media/reader.js',
  '/app/js/media/riff.js',
  '/app/js/media/scan.js',
  '/app/js/media/sidecar.js',
  '/app/js/media/ts.js',
  '/app/js/project.js',
  '/app/js/sfx.js',
  '/app/js/store.js',
  '/app/js/sync/engine.js',
  '/app/js/sync/fft.js',
  '/app/js/sync/synth.js',
  '/app/js/sync/worker.js',
  '/app/js/time.js',
  '/app/js/tipo-picker.js',
  '/app/js/tipos.js',
  '/app/js/util.js',
  '/app/js/views/ajustes.js',
  '/app/js/views/exportar.js',
  '/app/js/views/formatos-render.js',
  '/app/js/views/formatos.js',
  '/app/js/views/inicio.js',
  '/app/js/views/linha-player.js',
  '/app/js/views/linha.js',
  '/app/js/views/midia.js',
  '/app/js/views/projetos.js',
  '/app/js/views/sincronizar.js',
  '/app/manifest.webmanifest',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  const html = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')
  if (html) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/app/'))),
    )
    return
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit || net
    }),
  )
})
