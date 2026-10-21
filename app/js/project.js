// Projeto do Synquei: clipes, aparelhos, ajustes e o resultado da sincronia. Tudo aqui é dado puro (vai para o
// localStorage e para o arquivo .synquei); arquivos, planos de leitura e sinais ficam só na memória da sessão.

import { groupDevices } from './media/devices.js'
import { snapRate } from './time.js'

export const DEFAULT_SYNC = { mode: 'auto', sharedTC: false, useDate: true, chronological: true, drift: true, minConf: 0.4, sessionGap: 20, seqFps: 24 }
export const DEFAULT_EXPORT = { root: '', pathStyle: 'auto', fps: 'auto', size: 'auto', start: '01:00:00:00', camAudio: 'keep', recChannels: 'all', fcp: 'both', includeUnsynced: true, splitSessions: true }

const uid = () => Math.random().toString(36).slice(2, 10)

export function newProject(name = 'Projeto sem nome') {
  const now = Date.now()
  return { v: 1, id: 'p' + uid(), name, createdAt: now, updatedAt: now, clips: [], devices: [], ignored: [], sync: { ...DEFAULT_SYNC }, export: { ...DEFAULT_EXPORT }, result: null, sessions: [] }
}

export function clipFromScan(m) {
  const ext = (m.name.includes('.') ? m.name.split('.').pop() : '').toLowerCase()
  return { id: 'c' + uid(), name: m.name, relPath: m.relPath, size: m.size, lastModified: m.lastModified, ext, seq: m.seq || null, spans: m.spans || null, status: 'pending', audioStatus: 'pending', warnings: [] }
}

/** Mesmo arquivo (para religar a mídia de um projeto salvo): caminho + tamanho. */
export const fileKey = (relPath, size) => `${relPath}::${size}`

export function applyProbe(clip, info, project) {
  Object.assign(clip, {
    kind: info.kind,
    container: info.container,
    containerLabel: info.containerLabel,
    raw: info.raw,
    video: info.video,
    audio: info.audio,
    duration: info.duration,
    timecode: info.timecode,
    created: info.created,
    createdSource: info.createdSource,
    device: info.device,
    meta: info.meta,
    software: info.software,
    trackNames: info.trackNames,
    opAtom: info.opAtom,
    warnings: [...(info.warnings || [])],
    error: info.error,
  })
  // sequência de quadros: a duração sai da contagem
  if (clip.seq) {
    const rate = (clip.video && clip.video.rate) || snapRate(project.sync.seqFps || 24)
    if (clip.video) clip.video.rate = rate
    clip.duration = (clip.seq.count * rate.den) / rate.num
    if (!(info.video && info.video.rate)) clip.warnings.push(`Frame rate da sequência não informado: usando ${project.sync.seqFps || 24} fps`)
    if (clip.seq.gaps) clip.warnings.push(`${clip.seq.gaps} quadros faltando na sequência`)
  }
  if (clip.video && clip.video.frames && clip.video.rate && !clip.duration) clip.duration = (clip.video.frames * clip.video.rate.den) / clip.video.rate.num
  const plan = info.audioPlan
  clip.audioStatus = !plan || plan.type === 'none' ? 'none' : 'pending'
  if (plan && plan.type === 'none' && plan.why) clip.audioNote = plan.why
  if (clip.raw && !plan) clip.audioNote = 'RAW sem áudio legível: entra pelo timecode, pela data ou pelo WAV da mesma pasta'
  clip.status = info.error && !info.video && !info.audio ? 'error' : 'ready'
}

/** Refaz os grupos de aparelhos, preservando nomes e escolhas manuais. */
export function regroup(project) {
  const ready = project.clips.filter((c) => c.status === 'ready' || c.status === 'error')
  const auto = ready.filter((c) => !c.deviceLocked)
  const { devices, assign } = groupDevices(auto)
  const old = new Map(project.devices.map((d) => [d.key, d]))
  const keep = project.devices.filter((d) => d.manual || ready.some((c) => c.deviceLocked && c.deviceId === d.id))
  const used = new Set(keep.map((d) => d.id))
  const remap = {}
  for (const d of devices) {
    const prev = old.get(d.key)
    if (prev) {
      remap[d.id] = prev.id
      used.add(prev.id)
      keep.push({ ...d, id: prev.id, label: prev.renamed ? prev.label : d.label, color: prev.color, renamed: prev.renamed })
    } else {
      let n = 1
      while (used.has('d' + n)) n++
      const id = 'd' + n
      used.add(id)
      remap[d.id] = id
      keep.push({ ...d, id, color: (n - 1) % 12 })
    }
  }
  for (const c of auto) c.deviceId = remap[assign[c.id]]
  project.devices = keep.filter((d) => project.clips.some((c) => c.deviceId === d.id) || d.manual)
  linkPairs(project)
  orderWithinDevices(project)
}

/** Vídeo sem áudio + WAV da mesma pasta (CinemaDNG, ARRIRAW) ou pasta AUDIO irmã (Panasonic P2) viram um par. */
export function linkPairs(project) {
  const dir = (p) => p.split('/').slice(0, -1).join('/')
  const stem = (n) => n.replace(/\.[^.]+$/, '').replace(/\[.*\]$/, '').replace(/[_\-.]+$/, '').toLowerCase()
  const audio = project.clips.filter((c) => c.kind === 'audio')
  for (const v of project.clips) {
    if (v.kind === 'audio' || v.linkLocked) continue
    v.linkAudio = null
    const hasAudio = v.audio && v.audioStatus !== 'none'
    if (hasAudio) continue
    const d = dir(v.relPath)
    const s = stem(v.name)
    let a = audio.find((x) => dir(x.relPath) === d && stem(x.name) === s)
    if (!a && v.seq) {
      const inDir = audio.filter((x) => dir(x.relPath) === d)
      if (inDir.length === 1) a = inDir[0]
    }
    if (!a && /\/VIDEO$/i.test(d)) {
      const ad = d.replace(/VIDEO$/i, 'AUDIO')
      a = audio.find((x) => dir(x.relPath).toLowerCase() === ad.toLowerCase() && x.name.toLowerCase().startsWith(s))
    }
    if (a) {
      v.linkAudio = a.id
      a.linkedTo = v.id
      a.deviceId = v.deviceId
    }
  }
}

function orderWithinDevices(project) {
  const by = new Map()
  for (const c of project.clips) {
    if (!c.deviceId) continue
    if (!by.has(c.deviceId)) by.set(c.deviceId, [])
    by.get(c.deviceId).push(c)
  }
  for (const list of by.values()) {
    list.sort((a, b) => {
      const ta = a.timecode ? a.timecode.seconds : null
      const tb = b.timecode ? b.timecode.seconds : null
      if (ta != null && tb != null && Math.abs(ta - tb) > 1) return ta - tb
      if (a.created && b.created && Math.abs(a.created - b.created) > 1000) return a.created - b.created
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    list.forEach((c, i) => (c.order = i))
  }
}

/** Itens para o motor: só quem tem sinal de áudio. */
export function engineItems(project, signals) {
  return project.clips
    .filter((c) => c.status === 'ready' && signals.has(c.id))
    .map((c) => ({ id: c.id, device: c.deviceId, dur: signals.get(c.id).length / 4000, sig: signals.get(c.id), tc: c.timecode ? c.timecode.seconds : null, created: c.created || null, order: c.order }))
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}

/**
 * Aplica o resultado do motor e completa quem ficou de fora: vínculo (vídeo ↔ WAV), timecode, data.
 * Depois separa em sessões.
 */
export function applySync(project, res) {
  const S = project.sync
  const byId = new Map(project.clips.map((c) => [c.id, c]))
  for (const c of project.clips) c.sync = null
  const groupOf = new Map()
  if (res) {
    for (const [id, p] of Object.entries(res.placed)) {
      const c = byId.get(id)
      if (!c) continue
      c.sync = { pos: p.pos, group: 0, conf: p.conf, method: p.join ? `audio+${p.join}` : 'audio', refId: p.refId, z: p.z, r: p.r, drift: p.drift || null, hint: p.hint || null }
      groupOf.set(id, 0)
    }
    ;(res.islands || []).forEach((isl, gi) => {
      for (const [id, p] of Object.entries(isl.placed)) {
        const c = byId.get(id)
        if (!c) continue
        c.sync = { pos: p.pos, group: gi + 1, conf: p.conf, method: 'audio', refId: p.refId, z: p.z, r: p.r, drift: p.drift || null, island: true }
      }
    })
  }
  // modo só timecode: todos com TC entram pelo rótulo
  if (S.mode === 'timecode') {
    for (const c of project.clips) if (c.timecode && c.status === 'ready') c.sync = { pos: c.timecode.seconds, group: 0, conf: 0.7, method: 'timecode' }
  }
  const ready = project.clips.filter((c) => c.status === 'ready')
  for (let pass = 0; pass < 3; pass++) {
    // vínculos: o vídeo segue o WAV dele (e vice-versa)
    for (const c of ready) {
      if (c.sync) continue
      const partner = c.linkAudio ? byId.get(c.linkAudio) : c.linkedTo ? byId.get(c.linkedTo) : null
      if (partner && partner.sync) c.sync = { pos: partner.sync.pos, group: partner.sync.group, conf: partner.sync.conf, method: 'linked', refId: partner.id }
    }
    // timecode: deslocamento do mesmo aparelho (ou de qualquer um, com TC batido entre aparelhos)
    for (const c of ready) {
      if (c.sync || !c.timecode) continue
      const refs = ready.filter((q) => q.sync && q.sync.group === 0 && q.timecode && (q.deviceId === c.deviceId || S.sharedTC) && q.sync.method !== 'date')
      if (refs.length) c.sync = { pos: c.timecode.seconds + median(refs.map((q) => q.sync.pos - q.timecode.seconds)), group: 0, conf: 0.6, method: 'timecode', refId: refs[0].id }
    }
    // data do arquivo: só dentro do mesmo aparelho (relógios diferentes não se comparam)
    if (S.useDate) {
      for (const c of ready) {
        if (c.sync || !c.created) continue
        const refs = ready.filter((q) => q.sync && q.sync.group === 0 && q.created && q.deviceId === c.deviceId && q.sync.method !== 'date')
        if (refs.length) c.sync = { pos: c.created / 1000 + median(refs.map((q) => q.sync.pos - q.created / 1000)), group: 0, conf: 0.25, method: 'date', refId: refs[0].id }
      }
    }
  }
  // sem nenhum áudio casado e sem referência: TC puro, se houver
  if (!ready.some((c) => c.sync)) {
    for (const c of ready) if (c.timecode) c.sync = { pos: c.timecode.seconds, group: 0, conf: 0.5, method: 'timecode' }
  }
  project.sessions = buildSessions(project)
  const st = stats(project)
  project.result = { at: Date.now(), anchorId: res ? res.anchorId : null, stats: st }
  project.updatedAt = Date.now()
  return st
}

/** Sessões: grupos separados por um intervalo maior que sessionGap minutos (e cada ilha à parte). */
export function buildSessions(project) {
  const gap = (project.sync.sessionGap || 0) * 60
  const placed = project.clips.filter((c) => c.sync)
  const groups = new Map()
  for (const c of placed) {
    if (!groups.has(c.sync.group)) groups.set(c.sync.group, [])
    groups.get(c.sync.group).push(c)
  }
  const sessions = []
  for (const [g, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.sync.pos - b.sync.pos)
    let cur = null
    for (const c of list) {
      const end = c.sync.pos + (c.duration || 0)
      if (!cur || (gap > 0 && c.sync.pos > cur.end + gap)) {
        cur = { id: 's' + (sessions.length + 1), group: g, start: c.sync.pos, end, clipIds: [] }
        sessions.push(cur)
      }
      cur.clipIds.push(c.id)
      cur.end = Math.max(cur.end, end)
    }
  }
  const byId = new Map(project.clips.map((c) => [c.id, c]))
  sessions.forEach((s, i) => {
    const first = s.clipIds.map((id) => byId.get(id)).filter((c) => c.created).sort((a, b) => a.created - b.created)[0]
    const when = first ? new Date(first.created) : null
    const label = when ? when.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '') : ''
    s.name = `Sessão ${i + 1}${label ? ` · ${label}` : ''}${s.group > 0 ? ' (grupo à parte)' : ''}`
  })
  return sessions
}

export function stats(project) {
  const ready = project.clips.filter((c) => c.status === 'ready')
  const by = (m) => ready.filter((c) => c.sync && c.sync.method.startsWith(m)).length
  return {
    total: ready.length,
    audio: by('audio'),
    timecode: by('timecode'),
    date: by('date'),
    linked: by('linked'),
    manual: by('manual'),
    unsynced: ready.filter((c) => !c.sync).length,
    low: ready.filter((c) => c.sync && c.sync.conf < 0.5).length,
    drift: ready.filter((c) => c.sync && c.sync.drift).length,
    islands: new Set(ready.filter((c) => c.sync && c.sync.group > 0).map((c) => c.sync.group)).size,
    sessions: project.sessions.length,
  }
}

/** Ajuste manual (empurrar quadros ou arrastar na linha do tempo). */
export function nudge(project, clipId, delta) {
  const c = project.clips.find((x) => x.id === clipId)
  if (!c || !c.sync) return
  if (c.sync.original == null) c.sync.original = c.sync.pos
  c.sync.pos += delta
  c.sync.method = Math.abs(c.sync.pos - c.sync.original) < 1e-6 ? c.sync.method.replace(/^manual:/, '') : c.sync.method.startsWith('manual') ? c.sync.method : 'manual:' + c.sync.method
  // o par vinculado vai junto
  for (const o of project.clips) if (o.sync && o.sync.method === 'linked' && o.sync.refId === c.id) o.sync.pos = c.sync.pos
  project.sessions = buildSessions(project)
  project.updatedAt = Date.now()
}

export const METHOD_LABEL = {
  audio: 'Pelo áudio',
  'audio+tc': 'Pelo áudio (grupo encaixado pelo timecode)',
  'audio+date': 'Pelo áudio (grupo encaixado pela data)',
  timecode: 'Pelo timecode',
  date: 'Pela data do arquivo',
  linked: 'Junto com o WAV da câmera',
  manual: 'Ajuste manual',
}
export const methodLabel = (m) => (m && m.startsWith('manual:') ? `Ajuste manual (${METHOD_LABEL[m.slice(7)] || m.slice(7)})` : METHOD_LABEL[m] || m)
