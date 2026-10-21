// Worker da sincronização: o motor roda aqui para a interface continuar fluida. Os sinais chegam transferidos e
// voltam transferidos (sem cópia).

import { syncAll, onset } from './engine.js'

self.onmessage = (e) => {
  const { items, opts } = e.data
  try {
    for (const it of items) it.feat = onset(it.sig)
    self.postMessage({ type: 'progress', phase: 'features', done: items.length, total: items.length })
    const res = syncAll(items, { ...opts, onProgress: (p) => self.postMessage({ type: 'progress', ...p }) })
    const sigs = items.map((it) => ({ id: it.id, sig: it.sig }))
    self.postMessage({ type: 'done', res, sigs }, sigs.map((s) => s.sig.buffer))
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) })
  }
}
