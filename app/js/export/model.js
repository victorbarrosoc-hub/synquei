// Modelo neutro das linhas do tempo exportadas: uma por sessão, com faixas de vídeo por aparelho e faixas de áudio
// por canal. Cada formato (XML, FCPXML, OTIO, EDL, ALE) só traduz este modelo.

import { snapRate, rateFps, nominal, tcToFrames, labelSecondsToFrames, secToFrames } from '../time.js'
import { PALETTE } from '../media/devices.js'

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
}

/** Estilo de caminho: Windows se a raiz parece "D:\…" ou "\\servidor". */
export function pathStyle(opts) {
  if (opts.pathStyle === 'mac' || opts.pathStyle === 'win') return opts.pathStyle
  const r = opts.root || ''
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(r)) return 'win'
  if (r.startsWith('/')) return 'mac'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return /Windows/.test(ua) ? 'win' : 'mac'
}

/** Caminho absoluto do arquivo no disco de quem edita. */
export function clipPath(clip, opts) {
  if (clip.absPath) return clip.absPath
  const style = pathStyle(opts)
  let root = (opts.root || '').trim()
  const rel = clip.relPath
  if (!root) return style === 'win' ? rel.replace(/\//g, '\\') : '/' + rel
  if (style === 'win') {
    root = root.replace(/\//g, '\\').replace(/\\+$/, '')
    return `${root}\\${rel.replace(/\//g, '\\')}`
  }
  root = root.replace(/\/+$/, '')
  return `${root}/${rel}`
}

const encSeg = (s) => encodeURIComponent(s).replace(/%2C/g, ',').replace(/%40/g, '@').replace(/%2B/g, '+').replace(/%3D/g, '=').replace(/%26/g, '&')

/** file:// para FCPXML e OTIO. */
export function fileUrl(path) {
  const p = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(p)) return 'file:///' + p.slice(0, 2) + p.slice(2).split('/').map(encSeg).join('/')
  if (p.startsWith('//')) return 'file:' + p.split('/').map((s, i) => (i < 2 ? s : encSeg(s))).join('/')
  return 'file://' + (p.startsWith('/') ? '' : '/') + p.split('/').map((s, i) => (i === 0 && s === '' ? '' : encSeg(s))).join('/')
}

/** file://localhost/ do XML do Final Cut 7 (Premiere, Resolve, Vegas): o ":" do drive vira %3a. */
export function pathUrl(path) {
  const p = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(p)) return 'file://localhost/' + p[0] + '%3a' + p.slice(2).split('/').map(encSeg).join('/')
  return 'file://localhost' + (p.startsWith('/') ? '' : '/') + p.split('/').map((s, i) => (i === 0 && s === '' ? '' : encSeg(s))).join('/')
}

const mostCommon = (pairs) => {
  const m = new Map()
  for (const [k, w, v] of pairs) {
    const e = m.get(k) || { w: 0, v }
    e.w += w
    m.set(k, e)
  }
  let best = null
  for (const e of m.values()) if (!best || e.w > best.w) best = e
  return best ? best.v : null
}

const PREMIERE_LABELS = ['Cerulean', 'Violet', 'Forest', 'Mango', 'Rose', 'Caribbean', 'Yellow', 'Iris', 'Magenta', 'Teal', 'Tan', 'Lavender']
export const deviceColor = (d) => PALETTE[(d && d.color) || 0]
export const premiereLabel = (d) => PREMIERE_LABELS[(d && d.color) || 0]

function channelsOf(clip) {
  if (!clip.audio) return 0
  return clip.audio.totalChannels || clip.audio.channels || 2
}

/**
 * @returns {Array<{ name, rate, drop, width, height, sampleRate, startFrames, duration, video, audio, markers, unsynced }>}
 */
export function buildTimelines(project, opts = project.export) {
  const byId = new Map(project.clips.map((c) => [c.id, c]))
  const devIndex = new Map(project.devices.map((d, i) => [d.id, i]))
  const devOf = (c) => project.devices.find((d) => d.id === c.deviceId) || { id: 'x', label: 'Outros', kind: 'camera', color: 11 }
  const sessions = opts.splitSessions === false ? mergeGroups(project.sessions) : project.sessions
  const out = []
  for (const s of sessions) {
    const clips = s.clipIds.map((id) => byId.get(id)).filter((c) => c && c.sync)
    if (!clips.length) continue
    out.push(timeline(s.name, clips, s.start, opts, devOf, devIndex, project))
  }
  if (opts.includeUnsynced !== false) {
    const loose = project.clips.filter((c) => c.status === 'ready' && !c.sync && c.duration)
    if (loose.length) {
      // em fila, 2 s entre um e outro, na faixa do aparelho de cada um
      const cursor = new Map()
      const fake = loose.map((c) => {
        const t = cursor.get(c.deviceId) || 0
        cursor.set(c.deviceId, t + c.duration + 2)
        return { ...c, sync: { pos: t, conf: 0, method: 'none' } }
      })
      const tl = timeline('Sem sincronia (conferir)', fake, 0, opts, devOf, devIndex, project)
      tl.unsynced = true
      out.push(tl)
    }
  }
  return out
}

function mergeGroups(sessions) {
  const by = new Map()
  for (const s of sessions) {
    if (!by.has(s.group)) by.set(s.group, { ...s, clipIds: [...s.clipIds], name: s.group > 0 ? s.name : 'Linha do tempo completa' })
    else {
      const m = by.get(s.group)
      m.clipIds.push(...s.clipIds)
      m.start = Math.min(m.start, s.start)
      m.end = Math.max(m.end, s.end)
    }
  }
  return [...by.values()]
}

function timeline(name, clips, base, opts, devOf, devIndex, project) {
  const vids = clips.filter((c) => c.video && c.kind !== 'audio')
  let rate = opts.fps && opts.fps !== 'auto' ? snapRate(parseFloat(opts.fps)) : mostCommon(vids.filter((c) => c.video.rate).map((c) => [`${c.video.rate.num}/${c.video.rate.den}`, c.duration || 1, c.video.rate]))
  if (!rate) rate = snapRate(project.sync.seqFps || 24)
  const nom = nominal(rate)
  const dfVotes = clips.filter((c) => c.timecode && c.timecode.drop).length
  const drop = (nom === 30 || nom === 60) && rate.den === 1001 && dfVotes > clips.filter((c) => c.timecode && !c.timecode.drop).length
  let width = 1920
  let height = 1080
  if (opts.size && opts.size !== 'auto') [width, height] = opts.size.split('x').map(Number)
  else {
    const sz = mostCommon(vids.filter((c) => c.video.width).map((c) => [`${c.video.width}x${c.video.height}`, c.duration || 1, [c.video.width, c.video.height]]))
    if (sz) [width, height] = sz
  }
  // timecode de início da sequência
  let startFrames = 0
  if (opts.start === 'tc') {
    const ref = clips.find((c) => c.timecode && c.sync && c.sync.method !== 'date')
    if (ref) startFrames = Math.max(0, labelSecondsToFrames(ref.timecode.seconds - (ref.sync.pos - base), rate, drop))
    else startFrames = tcToFrames('01:00:00:00', rate, false)
  } else startFrames = Math.max(0, tcToFrames(opts.start || '01:00:00:00', rate, drop) || 0)

  const fps = rateFps(rate)
  const items = clips.map((c) => {
    const start = c.sync.pos - base
    return { clip: c, start, dur: c.duration || 0, startF: secToFrames(start, rate), durF: Math.max(1, secToFrames(c.duration || 0, rate)) }
  })
  let duration = 0
  for (const it of items) duration = Math.max(duration, it.start + it.dur)

  // faixas: aparelhos na ordem da lista; dentro do aparelho, camadas quando há sobreposição
  const byDev = new Map()
  for (const it of items) {
    const d = it.clip.deviceId || 'x'
    if (!byDev.has(d)) byDev.set(d, [])
    byDev.get(d).push(it)
  }
  const devs = [...byDev.keys()].sort((a, b) => (devIndex.get(a) ?? 99) - (devIndex.get(b) ?? 99))
  const video = []
  const audio = []
  const lanesOf = (list) => {
    const lanes = []
    for (const it of list.slice().sort((a, b) => a.startF - b.startF)) {
      let lane = lanes.find((l) => l.end <= it.startF)
      if (!lane) {
        lane = { end: -Infinity, items: [] }
        lanes.push(lane)
      }
      lane.items.push(it)
      lane.end = it.startF + it.durF
    }
    return lanes
  }
  for (const d of devs) {
    const dev = devOf(byDev.get(d)[0].clip)
    const list = byDev.get(d)
    const vlist = list.filter((it) => it.clip.kind !== 'audio')
    const vl = lanesOf(vlist)
    vl.forEach((l, i) => video.push({ label: vl.length > 1 ? `${dev.label} ${i + 1}` : dev.label, device: dev, items: l.items }))
    const alist = list.filter((it) => channelsOf(it.clip) > 0 && it.clip.audioStatus !== 'none')
    if (!alist.length) continue
    const isRec = dev.kind === 'recorder' || dev.kind === 'phone'
    const maxCh = Math.max(...alist.map((it) => channelsOf(it.clip)))
    const chs = isRec ? (opts.recChannels === '2' ? Math.min(2, maxCh) : Math.min(8, maxCh)) : Math.min(2, maxCh)
    const al = lanesOf(alist)
    al.forEach((l, li) => {
      for (let ch = 1; ch <= chs; ch++) {
        const its = l.items.filter((it) => channelsOf(it.clip) >= ch)
        if (!its.length) continue
        const names = its[0].clip.trackNames
        const chName = names && names[ch - 1] ? names[ch - 1] : `Canal ${ch}`
        audio.push({ label: `${dev.label}${al.length > 1 ? ` ${li + 1}` : ''} · ${chName}`, device: dev, channel: ch, camera: !isRec, items: its, enabled: isRec || opts.camAudio !== 'mute', dropped: !isRec && opts.camAudio === 'off' })
      }
    })
  }
  const markers = []
  for (const it of items) {
    const s = it.clip.sync
    if (s.method === 'none') continue
    if (s.conf < 0.5 || s.method === 'date' || s.method === 'timecode' || (s.method || '').includes('+')) {
      const why = s.method === 'date' ? 'posicionado pela data' : s.method === 'timecode' ? 'posicionado pelo timecode' : (s.method || '').includes('+') ? 'grupo encaixado sem áudio em comum' : `confiança ${Math.round(s.conf * 100)}%`
      markers.push({ start: it.start, name: `Conferir ${it.clip.name}`, note: why })
    }
    if (s.drift) markers.push({ start: it.start, name: `Deriva ${it.clip.name}`, note: `${s.drift.ppm} ppm: alinhado pelo meio` })
  }
  return { name, rate, drop, fps, width, height, sampleRate: 48000, startFrames, duration, durationF: Math.max(1, secToFrames(duration, rate)), video, audio: audio.filter((t) => !t.dropped), markers, items }
}

export function safeName(s) {
  return String(s || 'Synquei').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)
}
