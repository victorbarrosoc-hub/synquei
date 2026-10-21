// OpenTimelineIO, EDL CMX 3600, ALE (Avid), relatório CSV e o projeto em JSON.

import { clipPath, fileUrl, safeName } from './model.js'
import { framesToTc, rateFps, rateLabel, nominal, duration as dur } from '../time.js'
import { methodLabel } from '../project.js'

// ───────── OTIO ─────────
const RT = (value, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value })
const TR = (start, d, rate) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(start, rate), duration: RT(d, rate) })

export function toOtio(tl, project) {
  const opts = project.export
  const fps = rateFps(tl.rate)
  const clipObj = (it, rate, startVal, durVal) => {
    const c = it.clip
    const srcStart = c.timecode ? (c.kind === 'audio' && c.timecode.exact != null ? Math.round(c.timecode.exact * rate) : Math.round((c.timecode.frames / rateFps(c.timecode.rate)) * rate)) : 0
    const full = Math.round((c.duration || 0) * rate)
    return {
      OTIO_SCHEMA: 'Clip.1',
      name: c.name,
      source_range: TR(srcStart + startVal, durVal, rate),
      media_reference: { OTIO_SCHEMA: 'ExternalReference.1', name: c.name, target_url: fileUrl(clipPath(c, opts)), available_range: TR(srcStart, full, rate), metadata: {} },
      effects: [],
      markers: [],
      enabled: true,
      metadata: { synquei: { device: c.deviceId, method: c.sync ? c.sync.method : null, confidence: c.sync ? c.sync.conf : null } },
    }
  }
  const gap = (d, rate) => ({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: TR(0, d, rate), effects: [], markers: [], enabled: true, metadata: {} })
  const track = (name, kind, items, rate, exact) => {
    const children = []
    let cursor = 0
    for (const it of items.slice().sort((a, b) => a.start - b.start)) {
      let st = exact ? Math.round(it.start * rate) : it.startF
      let trim = 0
      if (st < cursor) {
        trim = cursor - st
        st = cursor
      }
      const d = (exact ? Math.round(it.dur * rate) : it.durF) - trim
      if (d <= 0) continue
      if (st > cursor) children.push(gap(st - cursor, rate))
      children.push(clipObj(it, rate, trim, d))
      cursor = st + d
    }
    return { OTIO_SCHEMA: 'Track.1', name, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children }
  }
  const tracks = tl.video.map((t) => track(t.label, 'Video', t.items, fps, false))
  // áudio: uma faixa por aparelho (o OTIO não separa canais); a 48 kHz para manter a precisão de amostra
  const seen = new Set()
  for (const t of tl.audio) {
    const key = t.label.split(' · ')[0]
    if (seen.has(key)) continue
    seen.add(key)
    tracks.push(track(key, 'Audio', t.items, 48000, true))
  }
  return JSON.stringify(
    {
      OTIO_SCHEMA: 'Timeline.1',
      name: tl.name,
      global_start_time: RT(tl.startFrames, fps),
      tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', source_range: null, effects: [], markers: tl.markers.map((m) => ({ OTIO_SCHEMA: 'Marker.2', name: m.name, color: 'RED', comment: m.note, marked_range: TR(Math.round(m.start * fps), 0, fps), metadata: {} })), enabled: true, metadata: {}, children: tracks },
      metadata: { synquei: { project: project.name, exported: new Date().toISOString() } },
    },
    null,
    2,
  )
}

// ───────── EDL ─────────
const reel = (c) =>
  String((c.meta && c.meta.tape) || c.name.replace(/\.[^.]+$/, ''))
    .replace(/[^A-Za-z0-9_]/g, '')
    .toUpperCase()
    .slice(0, 32) || 'AX'

export function toEdl(tl, track, kind) {
  const r = tl.rate
  const tc = (f) => framesToTc(f, r, tl.drop)
  const ascii = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '-')
  const lines = [`TITLE: ${ascii(safeName(`${tl.name} ${track.label}`)).toUpperCase().slice(0, 70)}`, `FCM: ${tl.drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`, '']
  let n = 0
  for (const it of track.items.slice().sort((a, b) => a.startF - b.startF)) {
    const c = it.clip
    const srcIn = c.timecode ? Math.round(c.timecode.seconds * nominal(r)) : 0
    const ch = kind === 'V' ? 'V    ' : (c.audio && (c.audio.totalChannels || c.audio.channels) >= 2 ? 'AA   ' : 'A    ')
    const num = String(++n).padStart(3, '0')
    lines.push(`${num}  ${reel(c).padEnd(8)} ${ch} C        ${tc(srcIn)} ${tc(srcIn + it.durF)} ${tc(tl.startFrames + it.startF)} ${tc(tl.startFrames + it.startF + it.durF)}`)
    lines.push(`* FROM CLIP NAME: ${ascii(c.name)}`)
    lines.push(`* SOURCE FILE: ${ascii(c.relPath)}`)
    if (c.sync && c.sync.conf < 0.5 && c.sync.method !== 'none') lines.push(`* SYNQUEI: CONFERIR (${Math.round(c.sync.conf * 100)}%)`)
    lines.push('')
  }
  return lines.join('\r\n')
}

// ───────── ALE (Avid Media Composer) ─────────
export function toAle(tl, project) {
  const r = tl.rate
  const tc = (f) => framesToTc(f, r, tl.drop)
  const cols = ['Name', 'Tape', 'Source File', 'Start', 'End', 'Duration', 'Tracks', 'Auxiliary TC1', 'Camera', 'Scene', 'Take', 'Synquei Metodo', 'Synquei Confianca']
  const devs = new Map(project.devices.map((d) => [d.id, d]))
  const rows = tl.items.map((it) => {
    const c = it.clip
    const srcIn = c.timecode ? Math.round(c.timecode.seconds * nominal(r)) : 0
    const ch = c.audio && c.audioStatus !== 'none' ? Math.min(8, c.audio.totalChannels || c.audio.channels || 2) : 0
    const tracks = (c.kind !== 'audio' && c.video ? 'V' : '') + Array.from({ length: ch }, (_, i) => `A${i + 1}`).join('')
    return [c.name.replace(/\.[^.]+$/, ''), reel(c), c.name, tc(srcIn), tc(srcIn + it.durF), tc(it.durF), tracks || 'V', tc(tl.startFrames + it.startF), (devs.get(c.deviceId) || {}).label || '', (c.meta && c.meta.scene) || '', (c.meta && c.meta.take) || '', c.sync ? methodLabel(c.sync.method) : '', c.sync ? Math.round(c.sync.conf * 100) + '%' : '']
  })
  const fmt = tl.height >= 2160 ? 'CUSTOM' : tl.height >= 1080 ? '1080' : tl.height >= 720 ? '720' : 'NTSC'
  return ['Heading', 'FIELD_DELIM\tTABS', `VIDEO_FORMAT\t${fmt}`, 'AUDIO_FORMAT\t48khz', `FPS\t${rateLabel(r)}`, '', 'Column', cols.join('\t'), '', 'Data', ...rows.map((r) => r.join('\t')), ''].join('\r\n')
}

// ───────── relatório ─────────
export function toCsv(project) {
  const devs = new Map(project.devices.map((d) => [d.id, d]))
  const head = ['arquivo', 'caminho', 'aparelho', 'tipo', 'inicio_s', 'duracao', 'metodo', 'confianca', 'deriva_ppm', 'timecode_origem', 'codec_video', 'resolucao', 'fps', 'codec_audio', 'sessao']
  const sess = new Map()
  project.sessions.forEach((s) => s.clipIds.forEach((id) => sess.set(id, s.name)))
  const q = (v) => {
    const s = String(v ?? '')
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = project.clips
    .filter((c) => c.status === 'ready')
    .map((c) => [c.name, c.relPath, (devs.get(c.deviceId) || {}).label || '', c.kind, c.sync ? c.sync.pos.toFixed(4) : '', dur(c.duration), c.sync ? methodLabel(c.sync.method) : 'Sem sincronia', c.sync ? Math.round(c.sync.conf * 100) + '%' : '', c.sync && c.sync.drift ? c.sync.drift.ppm : '', c.timecode ? c.timecode.string : '', c.video ? c.video.codec : '', c.video && c.video.width ? `${c.video.width}x${c.video.height}` : '', c.video && c.video.rate ? rateLabel(c.video.rate) : '', c.audio ? c.audio.codec : '', sess.get(c.id) || ''])
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
}

/** O projeto inteiro (sem os arquivos) para reabrir depois ou mandar para alguém. */
export function toProjectJson(project) {
  return JSON.stringify({ synquei: 1, ...project }, null, 2)
}
