// Matroska / WebM: duração, data, faixas e codecs. O áudio vai pelo decodificador do navegador.

import { utf8 } from './reader.js'
import { snapRate } from '../time.js'

function vint(b, o, keepMarker) {
  const f = b[o]
  if (f === undefined) return null
  let len = 1
  let mask = 0x80
  while (len <= 8 && !(f & mask)) {
    len++
    mask >>= 1
  }
  if (len > 8) return null
  let v = keepMarker ? f : f & (mask - 1)
  let allOnes = (f & (mask - 1)) === mask - 1
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i]
    if (b[o + i] !== 0xff) allOnes = false
  }
  return { v, len, unknown: !keepMarker && allOnes }
}

const ID = { EBML: 0x1a45dfa3, DocType: 0x4282, Segment: 0x18538067, Info: 0x1549a966, Scale: 0x2ad7b1, Duration: 0x4489, DateUTC: 0x4461, Title: 0x7ba9, Writing: 0x5741, Tracks: 0x1654ae6b, Entry: 0xae, Type: 0x83, Codec: 0x86, DefDur: 0x23e383, Video: 0xe0, W: 0xb0, H: 0xba, Audio: 0xe1, SR: 0xb5, Ch: 0x9f, Depth: 0x6264, Cluster: 0x1f43b675 }

const uint = (b, o, n) => {
  let v = 0
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i]
  return v
}
const float = (b, o, n) => (n === 4 ? new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0) : new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0))

const VCODEC = { V_MPEG4: 'H.264 / AVC', 'V_MPEG4/ISO/AVC': 'H.264 / AVC', 'V_MPEGH/ISO/HEVC': 'H.265 / HEVC', V_AV1: 'AV1', V_VP8: 'VP8', V_VP9: 'VP9', V_PRORES: 'Apple ProRes', 'V_MPEG2': 'MPEG-2', V_MJPEG: 'Motion JPEG', 'V_MS/VFW/FOURCC': 'VfW' }
const ACODEC = { A_AAC: 'AAC', A_OPUS: 'Opus', A_VORBIS: 'Vorbis', A_FLAC: 'FLAC', 'A_PCM/INT/LIT': 'PCM', 'A_PCM/INT/BIG': 'PCM', 'A_PCM/FLOAT/IEEE': 'PCM float', A_AC3: 'AC-3', A_EAC3: 'E-AC-3', A_DTS: 'DTS', 'A_MPEG/L3': 'MP3', A_TRUEHD: 'TrueHD' }

export async function probeMkv(r) {
  const b = await r.bytes(0, Math.min(r.size, 4 << 20))
  const info = { container: 'mkv', warnings: [] }
  let scale = 1e6
  let durRaw = null
  const tracks = []
  const walk = (start, end, depth, cur) => {
    let p = start
    while (p < end && p < b.length) {
      const id = vint(b, p, true)
      if (!id) return
      const sz = vint(b, p + id.len, false)
      if (!sz) return
      const v = p + id.len + sz.len
      const e = sz.unknown ? end : Math.min(end, v + sz.v)
      switch (id.v) {
        case ID.EBML:
        case ID.Segment:
        case ID.Info:
        case ID.Tracks:
        case ID.Video:
        case ID.Audio:
          walk(v, e, depth + 1, cur)
          break
        case ID.Entry: {
          const t = {}
          tracks.push(t)
          walk(v, e, depth + 1, t)
          break
        }
        case ID.DocType:
          info.docType = utf8(b, v, sz.v)
          break
        case ID.Scale:
          scale = uint(b, v, sz.v)
          break
        case ID.Duration:
          durRaw = float(b, v, sz.v)
          break
        case ID.DateUTC: {
          // nanossegundos desde 2001-01-01 (inteiro de 8 bytes com sinal)
          const dv = new DataView(b.buffer, b.byteOffset + v, 8)
          const ns = Number(dv.getBigInt64(0))
          info.created = Date.UTC(2001, 0, 1) + ns / 1e6
          break
        }
        case ID.Writing:
          info.software = utf8(b, v, sz.v)
          break
        case ID.Type:
          if (cur) cur.type = b[v]
          break
        case ID.Codec:
          if (cur) cur.codec = utf8(b, v, sz.v)
          break
        case ID.DefDur:
          if (cur) cur.defDur = uint(b, v, sz.v)
          break
        case ID.W:
          if (cur) cur.w = uint(b, v, sz.v)
          break
        case ID.H:
          if (cur) cur.h = uint(b, v, sz.v)
          break
        case ID.SR:
          if (cur) cur.sr = float(b, v, sz.v)
          break
        case ID.Ch:
          if (cur) cur.ch = uint(b, v, sz.v)
          break
        case ID.Depth:
          if (cur) cur.bits = uint(b, v, sz.v)
          break
        case ID.Cluster:
          return
      }
      if (sz.unknown && id.v !== ID.Segment) return
      p = e
    }
  }
  walk(0, b.length, 0, null)
  if (info.docType === 'webm') info.container = 'webm'
  if (durRaw) info.duration = (durRaw * scale) / 1e9
  const v = tracks.find((t) => t.type === 1)
  const a = tracks.find((t) => t.type === 2)
  if (v) info.video = { codec: VCODEC[v.codec] || v.codec, width: v.w || 0, height: v.h || 0, rate: v.defDur ? snapRate(1e9 / v.defDur) : null }
  if (a) {
    info.audio = { codec: ACODEC[a.codec] || a.codec, sampleRate: Math.round(a.sr || 48000), channels: a.ch || 1, bits: a.bits || null }
    info.audioPlan = { type: 'decode' }
  }
  return info
}
