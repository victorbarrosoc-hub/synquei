// Estado do app, gravação no navegador e as ações longas (ler arquivos, extrair áudio, sincronizar).

import { newProject, clipFromScan, applyProbe, regroup, engineItems, applySync, fileKey, DEFAULT_SYNC, DEFAULT_EXPORT, buildSessions, stats } from './project.js'
import { scanEntries } from './media/scan.js'
import { probeWithSidecar } from './media/probe.js'
import { extractAudio, peaks as mkPeaks } from './media/extract.js'
import { b64 } from './util.js'
import { sfx } from './sfx.js'
import { aplicarTipo } from './tipos.js'

const IDX = 'synquei:index'
const KEY = (id) => `synquei:p:${id}`

export const S = {
  route: 'projetos',
  project: null,
  list: [],
  files: new Map(),
  plans: new Map(),
  signals: new Map(),
  probe: { active: false, done: 0, total: 0 },
  sync: { running: false, phase: '', done: 0, total: 0, clip: {}, error: null, finishedAt: null },
  ui: { filter: 'all', query: '', selected: null, session: 0, zoom: null },
}

// ───────── eventos ─────────
const subs = { change: new Set(), progress: new Set() }
export const on = (ev, fn) => (subs[ev].add(fn), () => subs[ev].delete(fn))
export function changed() {
  for (const f of subs.change) f()
  save()
}
let progT = 0
export function progress() {
  const now = performance.now()
  if (now - progT < 80) return
  progT = now
  for (const f of subs.progress) f()
}

// ───────── gravação ─────────
const ls = {
  get(k) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v)
      return true
    } catch {
      return false
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k)
    } catch {}
  },
}

export function loadIndex() {
  try {
    S.list = JSON.parse(ls.get(IDX) || '[]')
  } catch {
    S.list = []
  }
}

let saveT = 0
export function save(now = false) {
  clearTimeout(saveT)
  const run = () => {
    const p = S.project
    if (!p || p.demo) return
    const ok = ls.set(KEY(p.id), JSON.stringify(p))
    const entry = summaryOf(p)
    S.list = [entry, ...S.list.filter((x) => x.id !== p.id)]
    ls.set(IDX, JSON.stringify(S.list))
    if (!ok) console.warn('Sem espaço para gravar o projeto no navegador')
  }
  if (now) run()
  else saveT = setTimeout(run, 400)
}

function summaryOf(p) {
  const ready = p.clips.filter((c) => c.status === 'ready')
  const devs = p.devices.map((d) => ({ label: d.label, color: d.color, n: p.clips.filter((c) => c.deviceId === d.id).length }))
  return { id: p.id, name: p.name, type: p.type || null, multicam: p.export.multicam !== false, updatedAt: p.updatedAt, createdAt: p.createdAt, clips: ready.length, devices: devs, synced: p.result ? p.result.stats : null }
}

export function openProject(id) {
  const raw = ls.get(KEY(id))
  if (!raw) return false
  const p = JSON.parse(raw)
  setProject(p)
  return true
}

export function setProject(p) {
  const hadMc = !!(p.export && 'multicam' in p.export)
  p.sync = { ...DEFAULT_SYNC, ...(p.sync || {}) }
  p.export = { ...DEFAULT_EXPORT, ...(p.export || {}) }
  // projetos de antes do multicâmera: vale o que estava escolhido para o Final Cut
  if (!hadMc) p.export.multicam = p.export.fcp !== 'timeline'
  S.project = p
  S.files.clear()
  S.plans.clear()
  S.signals.clear()
  S.ui.selected = null
  S.ui.session = 0
  S.sync = { running: false, phase: '', done: 0, total: 0, clip: {}, error: null, finishedAt: null }
  changed()
}

export function createProject(name) {
  const p = newProject(name)
  const def = ls.get('synquei:defaults')
  if (def) {
    try {
      Object.assign(p.export, JSON.parse(def))
    } catch {}
  }
  setProject(p)
  return p
}

/** Tipo do projeto (e nome e multicâmera), vindo do seletor. */
export function applyType({ name, type, multicam }) {
  const p = S.project
  if (!p) return
  if (name) p.name = name
  aplicarTipo(p, type, multicam)
  if (p.result) {
    p.sessions = buildSessions(p)
    p.result.stats = stats(p)
  }
  changed()
}

/** Fecha o projeto aberto (ele continua salvo em Projetos) para começar outro. */
export function closeProject() {
  if (!S.project) return
  save(true)
  S.project = null
  S.files.clear()
  S.plans.clear()
  S.signals.clear()
  Object.assign(S.ui, { selected: null, session: 0, zoom: null, scroll: 0, needle: 0 })
  S.sync = { running: false, phase: '', done: 0, total: 0, clip: {}, error: null, finishedAt: null }
  changed()
}

export function deleteProject(id) {
  ls.del(KEY(id))
  S.list = S.list.filter((x) => x.id !== id)
  ls.set(IDX, JSON.stringify(S.list))
  if (S.project && S.project.id === id) S.project = null
  changed()
}

export function renameProject(name) {
  if (!S.project) return
  S.project.name = name
  S.project.updatedAt = Date.now()
  changed()
}

export function importProjectJson(text) {
  const data = JSON.parse(text)
  if (!data || !Array.isArray(data.clips)) throw new Error('Arquivo de projeto inválido')
  delete data.synquei
  data.id = 'p' + Math.random().toString(36).slice(2, 10)
  data.updatedAt = Date.now()
  setProject(data)
}

const peakCache = new WeakMap()
export const peaksOf = (clip) => {
  if (!clip.peaks64) return null
  const hit = peakCache.get(clip)
  if (hit && hit.src === clip.peaks64) return hit.u8
  const u8 = b64.dec(clip.peaks64)
  peakCache.set(clip, { src: clip.peaks64, u8 })
  return u8
}

// ───────── importar e ler arquivos ─────────
export async function addEntries(entries, { name } = {}) {
  if (!entries.length) return
  if (!S.project) {
    const top = entries[0].path && entries[0].path.includes('/') ? entries[0].path.split('/')[0] : null
    createProject(name || top || 'Projeto sem nome')
  }
  const p = S.project
  const { media, ignored } = scanEntries(entries)
  // Organizar: de que diária, dono e cartão veio cada arquivo (vem junto da entrada)
  const orgDe = new Map(entries.filter((e) => e.org).map((e) => [(e.path || e.file.name).replace(/^\/+/, ''), e.org]))
  const known = new Map(p.clips.map((c) => [fileKey(c.relPath, c.size), c]))
  const byName = new Map(p.clips.map((c) => [`${c.name}::${c.size}`, c]))
  const queue = []
  let relinked = 0
  for (const m of media) {
    const old = known.get(fileKey(m.relPath, m.size)) || byName.get(`${m.name}::${m.size}`)
    if (old) {
      if (!S.files.has(old.id)) {
        S.files.set(old.id, m.file)
        const abs = absDe(m.file)
        if (abs) old.absPath = abs
        queue.push({ clip: old, m, relink: true })
        relinked++
      }
      continue
    }
    const c = clipFromScan(m)
    // app de desktop: caminho completo do arquivo (as exportações não precisam da pasta da mídia)
    const abs = absDe(m.file)
    if (abs) c.absPath = abs
    const o = orgDe.get(m.relPath)
    if (o) c.org = o
    p.clips.push(c)
    S.files.set(c.id, m.file)
    queue.push({ clip: c, m })
  }
  const seen = new Set(p.ignored.map((i) => i.relPath))
  for (const i of ignored) if (!seen.has(i.relPath)) p.ignored.push(i)
  p.updatedAt = Date.now()
  changed()
  await probeQueue(queue)
  return { added: queue.length - relinked, relinked, ignored: ignored.length }
}

// caminho completo: o arquivo vigiado (Organizar) já sabe o dele; o escolhido ou arrastado pergunta ao app de desktop
const absDe = (file) => file.caminho || (globalThis.synqueiDesktop ? globalThis.synqueiDesktop.pathFor(file) : null)

/** Religa a mídia de um projeto do Organizar pelo caminho de cada clipe (a pasta vigiada não muda de lugar). */
export async function religarPorCaminho(fazerArquivo) {
  const p = S.project
  if (!p) return 0
  const queue = []
  for (const c of p.clips) {
    if (S.files.has(c.id) || !c.absPath) continue
    const file = fazerArquivo(c)
    if (!file) continue
    S.files.set(c.id, file)
    // religar só refaz o plano de leitura; o que o clipe já sabe (timecode do XML da Sony) continua no projeto
    queue.push({ clip: c, m: { file, relPath: c.relPath }, relink: true })
  }
  await probeQueue(queue)
  return queue.length
}

async function probeQueue(queue) {
  if (!queue.length) return
  const p = S.project
  S.probe = { active: true, done: 0, total: queue.length }
  progress()
  let i = 0
  const worker = async () => {
    while (i < queue.length) {
      const job = queue[i++]
      const { clip, m } = job
      if (!job.relink) clip.status = 'probing'
      try {
        const info = await probeWithSidecar(m.file, m.relPath, m.sidecar)
        S.plans.set(clip.id, info)
        if (!job.relink) applyProbe(clip, info, p)
      } catch (e) {
        // religar que falhou (arquivo sumiu) não estraga o que já se sabia do clipe
        if (job.relink) S.files.delete(clip.id)
        else {
          clip.status = 'error'
          clip.error = e.message || String(e)
        }
      }
      S.probe.done++
      progress()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  regroup(p)
  S.probe.active = false
  if (p.result) {
    p.sessions = buildSessions(p)
    p.result.stats = stats(p)
  }
  changed()
}

export function hasMedia(clip) {
  return S.files.has(clip.id) && S.plans.has(clip.id)
}

// ───────── sincronizar ─────────
let worker = null
function getWorker() {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./sync/worker.js', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  return worker
}

// a sincronia em andamento (Parar) e a leitura de cada clipe (Pular)
let syncCtrl = null
const clipCtrls = new Map()
const cancelado = () => new DOMException('Sincronização parada', 'AbortError')

/** Para a sincronização. O áudio que já foi lido fica guardado: rodar de novo continua de onde parou. */
export function stopSync() {
  if (!S.sync.running || !syncCtrl) return false
  syncCtrl.abort()
  return true
}

/** Pula a leitura de um clipe (ele entra pelo timecode ou pela data, ou fica de fora para conferir). */
export function skipClip(id) {
  const c = clipCtrls.get(id)
  if (!c) return false
  c.abort()
  return true
}

export async function runSync() {
  const p = S.project
  if (!p || S.sync.running) return
  const ready = p.clips.filter((c) => c.status === 'ready')
  const ctrl = (syncCtrl = new AbortController())
  const signal = ctrl.signal
  S.sync = { running: true, phase: 'audio', done: 0, total: 0, clip: {}, error: null, finishedAt: null, startedAt: Date.now() }
  sfx.start()
  changed()
  try {
    // 1. áudio de cada clipe (o que ainda não foi lido nesta sessão)
    const todo = ready.filter((c) => !S.signals.has(c.id) && c.audioStatus !== 'none' && hasMedia(c) && S.plans.get(c.id).audioPlan)
    S.sync.total = todo.length
    let k = 0
    const run = async () => {
      while (k < todo.length && !signal.aborted) {
        const c = todo[k++]
        const cc = new AbortController()
        const parar = () => cc.abort()
        signal.addEventListener('abort', parar)
        clipCtrls.set(c.id, cc)
        S.sync.clip[c.id] = { p: 0, st: 'lendo' }
        progress()
        try {
          const { sig } = await extractAudio(S.files.get(c.id), S.plans.get(c.id), {
            signal: cc.signal,
            onProgress: (x) => {
              S.sync.clip[c.id].p = x
              progress()
            },
          })
          if (sig.length < 4000) throw new Error('Áudio curto demais')
          S.signals.set(c.id, sig)
          c.peaks64 = b64.enc(mkPeaks(sig, 2400))
          c.audioStatus = 'ok'
          c.audioNote = null
          if (!c.duration) c.duration = sig.length / 4000
          S.sync.clip[c.id] = { p: 1, st: 'ok' }
          sfx.tick()
        } catch (e) {
          if (signal.aborted) break
          if (cc.signal.aborted) {
            // pulado: não marca o áudio como ruim; na próxima sincronia ele é lido de novo
            S.sync.clip[c.id] = { p: 1, st: 'pulado' }
          } else {
            c.audioStatus = 'error'
            c.audioNote = e.message || String(e)
            S.sync.clip[c.id] = { p: 1, st: 'erro', msg: c.audioNote }
          }
        } finally {
          signal.removeEventListener('abort', parar)
          clipCtrls.delete(c.id)
        }
        S.sync.done++
        progress()
      }
    }
    await Promise.all([run(), run()])
    if (signal.aborted) throw cancelado()
    // 2. motor
    S.sync.phase = 'match'
    S.sync.done = 0
    const items = engineItems(p, S.signals)
    // "só o som": nenhuma pista de timecode ou data
    if (p.sync.mode === 'audio') for (const it of items) it.tc = it.created = null
    S.sync.total = items.length
    progress()
    const opts = { sharedTC: p.sync.sharedTC, useDate: p.sync.mode !== 'audio' && p.sync.useDate, chronological: p.sync.chronological, drift: p.sync.drift, minConf: p.sync.minConf }
    let res = null
    if (p.sync.mode !== 'timecode' && items.length) res = await engine(items, opts, signal)
    if (signal.aborted) throw cancelado()
    // 3. resultado
    S.sync.phase = 'done'
    const st = applySync(p, res)
    S.sync.running = false
    S.sync.finishedAt = Date.now()
    S.ui.session = 0
    sfx.done()
    changed()
    return st
  } catch (e) {
    if (signal.aborted || (e && e.name === 'AbortError')) {
      // parado pela pessoa: o resultado anterior (se houver) continua valendo
      S.sync = { running: false, phase: '', done: 0, total: 0, clip: S.sync.clip, error: null, finishedAt: null, parada: Date.now() }
      changed()
      return null
    }
    S.sync.running = false
    S.sync.error = e.message || String(e)
    changed()
    throw e
  } finally {
    if (syncCtrl === ctrl) syncCtrl = null
  }
}

function engine(items, opts, signal) {
  const w = getWorker()
  if (!w) {
    return import('./sync/engine.js').then((m) => m.syncAll(items, { ...opts, onProgress: (x) => Object.assign(S.sync, { done: x.done, total: x.total }) }))
  }
  return new Promise((resolve, reject) => {
    // Parar no meio da comparação: o worker é encerrado na hora (os sinais que estavam com ele são lidos de novo)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          w.terminate()
          worker = null
          reject(cancelado())
        },
        { once: true },
      )
    }
    w.onmessage = (e) => {
      const d = e.data
      if (d.type === 'progress') {
        if (d.phase === 'match') {
          S.sync.done = d.done
          S.sync.total = d.total
        }
        progress()
      } else if (d.type === 'done') {
        for (const s of d.sigs) S.signals.set(s.id, s.sig)
        resolve(d.res)
      } else if (d.type === 'error') reject(new Error(d.message))
    }
    w.onerror = (e) => {
      // Worker de módulo indisponível (navegador antigo): roda aqui mesmo
      worker = null
      reject(e)
    }
    w.postMessage({ items, opts }, items.map((it) => it.sig.buffer))
    // os sinais foram transferidos: some da memória daqui até voltarem
    for (const it of items) S.signals.delete(it.id)
  })
}
