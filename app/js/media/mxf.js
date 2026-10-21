// MXF (SMPTE 377): pacote de partição, metadados do cabeçalho (descritores, timecode, identificação) e, na hora de
// ler o som, os elementos de áudio (BWF ou AES3) quadro a quadro. Cobre Sony XAVC/XDCAM/X-OCN, Canon XF-AVC,
// Panasonic P2 (OP-Atom, áudio em arquivos separados), ARRI e Avid.

import { u16be, u32be, i32be, u64be, utf16be, utf8, indexOf, strBytes } from './reader.js'
import { snapRate, framesToLabelSeconds, framesToTc } from '../time.js'
import { parseSonyXml } from './sidecar.js'

const isUL = (b, o) => b[o] === 0x06 && b[o + 1] === 0x0e && b[o + 2] === 0x2b && b[o + 3] === 0x34

function ber(b, o) {
  const f = b[o]
  if (f < 0x80) return { len: f, n: 1 }
  const n = f & 0x7f
  let len = 0
  for (let i = 0; i < n; i++) len = len * 256 + b[o + 1 + i]
  return { len, n: 1 + n }
}

/** Itera KLVs de um buffer em memória. */
function* klvs(b, start, end) {
  let p = start
  while (p + 17 <= end) {
    if (!isUL(b, p)) {
      p++
      continue
    }
    const { len, n } = ber(b, p + 16)
    const v = p + 16 + n
    yield { key: b.subarray(p, p + 16), pos: p, value: v, len, end: v + len }
    p = v + len
  }
}

function localSet(b, start, end) {
  const out = new Map()
  let p = start
  while (p + 4 <= end) {
    const tag = u16be(b, p)
    const len = u16be(b, p + 2)
    out.set(tag, { o: p + 4, len })
    p += 4 + len
  }
  return out
}

function codecFromUL(ul, company) {
  const at = (i) => ul[i]
  if (at(8) === 0x04 && at(9) === 0x01 && at(10) === 0x02) {
    if (at(11) === 0x01) return { name: 'Não comprimido', family: 'Não comprimido' }
    if (at(11) === 0x02) {
      if (at(12) === 0x01) {
        if (at(13) >= 0x01 && at(13) <= 0x04) return { name: company === 'Sony' ? 'Sony XDCAM (MPEG-2)' : 'MPEG-2', family: 'MPEG-2' }
        if (at(13) === 0x20) return { name: 'MPEG-4 Part 2', family: 'MPEG-4' }
        if (at(13) === 0x31) return { name: company === 'Sony' ? 'Sony XAVC (H.264)' : company === 'Canon' ? 'Canon XF-AVC (H.264)' : company === 'Panasonic' ? 'Panasonic AVC-Intra / AVC-Ultra' : 'H.264 / AVC', family: 'H.264' }
        if (at(13) === 0x32) return { name: company === 'Canon' ? 'Canon XF-HEVC (H.265)' : 'H.265 / HEVC', family: 'HEVC' }
      }
      if (at(12) === 0x02) return { name: 'DV / DVCPRO', family: 'DV' }
      if (at(12) === 0x03 && at(13) === 0x01) return { name: 'JPEG 2000', family: 'JPEG 2000' }
      if (at(12) === 0x03 && at(13) === 0x06) return { name: 'Apple ProRes', family: 'ProRes' }
      if (at(12) === 0x71) return { name: 'Avid DNxHD / DNxHR', family: 'DNx' }
    }
  }
  if (company === 'ARRI') return { name: 'ARRIRAW', family: 'ARRIRAW', raw: true }
  if (company === 'Sony') return { name: 'Sony X-OCN / RAW', family: 'X-OCN', raw: true }
  return null
}

function timestamp(b, o) {
  const y = u16be(b, o)
  if (!y) return null
  const d = new Date(y, b[o + 2] - 1, b[o + 3], b[o + 4], b[o + 5], b[o + 6])
  return isNaN(d) ? null : d.getTime()
}

export async function probeMxf(r) {
  const info = { container: 'mxf', warnings: [] }
  const first = await r.bytes(0, 65536 + 32)
  let start = 0
  while (start < first.length - 16 && !isUL(first, start)) start++
  const ph = await r.bytes(start, 256)
  const pl = ber(ph, 16)
  const pv = 16 + pl.n
  const headerBytes = u64be(ph, pv + 32)
  const op = ph.subarray(pv + 64, pv + 80)
  if (op[12] === 0x10) info.opAtom = true
  info.op = op[12] === 0x10 ? 'OP-Atom' : `OP${op[12]}${'abc'[Math.max(0, op[13] - 1)] || ''}`
  const metaStart = start + pv + pl.len
  // a contagem de bytes do cabeçalho varia de gravador para gravador: lê com folga e filtra só os conjuntos de metadados
  const metaLen = Math.min((headerBytes || 4 << 20) + (1 << 20), 24 << 20, r.size - metaStart)
  const b = await r.bytes(metaStart, metaLen)

  const pics = []
  const sounds = []
  const tcs = []
  let ident = null
  let durationSeq = null
  for (const k of klvs(b, 0, b.length)) {
    const key = k.key
    if (!(key[4] === 0x02 && key[5] === 0x53 && key[8] === 0x0d && key[12] === 0x01 && key[13] === 0x01)) continue
    const set = u16be(key, 13 + 0) && (key[13] << 8) | key[14]
    const id = (key[13] << 8) | key[14]
    const t = localSet(b, k.value, k.end)
    const get32 = (tag) => (t.has(tag) ? u32be(b, t.get(tag).o) : null)
    const getRat = (tag) => (t.has(tag) ? { n: i32be(b, t.get(tag).o), d: i32be(b, t.get(tag).o + 4) } : null)
    void set
    if (id === 0x0130) {
      const s = (tag) => (t.has(tag) ? utf16be(b, t.get(tag).o, t.get(tag).len) : null)
      ident = { company: s(0x3c01), product: s(0x3c02), version: s(0x3c04), date: t.has(0x3c06) ? timestamp(b, t.get(0x3c06).o) : null }
    } else if (id === 0x0114) {
      tcs.push({ start: t.has(0x1501) ? u64be(b, t.get(0x1501).o) : 0, base: t.has(0x1502) ? u16be(b, t.get(0x1502).o) : 0, drop: t.has(0x1503) ? !!b[t.get(0x1503).o] : false })
    } else if (id === 0x0128 || id === 0x0129 || id === 0x0127 || id === 0x0151) {
      const layout = t.has(0x320c) ? b[t.get(0x320c).o] : 0
      pics.push({ rate: getRat(0x3001), dur: t.has(0x3002) ? u64be(b, t.get(0x3002).o) : null, w: get32(0x3203), h: get32(0x3202), layout, ul: t.has(0x3201) ? b.slice(t.get(0x3201).o, t.get(0x3201).o + 16) : null })
    } else if (id === 0x0148 || id === 0x0147 || id === 0x0142) {
      sounds.push({ kind: id === 0x0147 ? 'aes3' : 'wave', rate: getRat(0x3d03), editRate: getRat(0x3001), dur: t.has(0x3002) ? u64be(b, t.get(0x3002).o) : null, ch: get32(0x3d07), bits: get32(0x3d01) })
    } else if (id === 0x010f || id === 0x0111) {
      // Sequence / SourceClip: duração em unidades de edição
      if (t.has(0x0202) && durationSeq == null) durationSeq = u64be(b, t.get(0x0202).o)
    }
  }

  const company = ident && ident.company ? (/sony/i.test(ident.company) ? 'Sony' : /canon/i.test(ident.company) ? 'Canon' : /panasonic/i.test(ident.company) ? 'Panasonic' : /arri/i.test(ident.company) ? 'ARRI' : /avid/i.test(ident.company) ? 'Avid' : ident.company) : null
  const pic = pics.find((p) => p.w) || pics[0]
  if (pic) {
    const ul = pic.ul || (pics.find((x) => x.ul) || {}).ul
    const c = ul ? codecFromUL(ul, company) : null
    const rate = pic.rate && pic.rate.d ? snapRate(pic.rate.n / pic.rate.d) : null
    const interlaced = pic.layout === 1 || pic.layout === 3
    info.video = { codec: c ? c.name : 'Vídeo MXF', family: c ? c.family : null, raw: !!(c && c.raw), width: pic.w || 0, height: (pic.h || 0) * (interlaced ? 2 : 1), rate, interlaced }
    const d = pic.dur || durationSeq
    if (rate && d) info.duration = (d * rate.den) / rate.num
  }
  const snd = sounds[0]
  if (snd) {
    const sr = snd.rate && snd.rate.d ? Math.round(snd.rate.n / snd.rate.d) : 48000
    info.audio = { codec: snd.kind === 'aes3' ? 'PCM (AES3)' : 'PCM (BWF)', sampleRate: sr, channels: snd.ch || 1, bits: snd.bits || 24, tracks: sounds.length, totalChannels: sounds.reduce((n, s) => n + (s.ch || 1), 0) }
    if (!info.duration && snd.dur && snd.editRate && snd.editRate.d) info.duration = (snd.dur * snd.editRate.d) / snd.editRate.n
    info.audioPlan = { type: 'mxf', start: metaStart, fmt: { bits: snd.bits || 24, le: true, float: false, unsigned: false, channels: snd.ch || 1, sampleRate: sr, bytesPerFrame: (snd.ch || 1) * Math.ceil((snd.bits || 24) / 8) }, delay: 0, skip: 0 }
  }
  if (!info.duration && durationSeq && info.video && info.video.rate) info.duration = (durationSeq * info.video.rate.den) / info.video.rate.num

  const tc = tcs.filter((x) => x.base).sort((x, y) => y.start - x.start)[0]
  if (tc) {
    const fr = info.video && info.video.rate && Math.round(info.video.rate.num / info.video.rate.den) === tc.base ? info.video.rate : snapRate(tc.base)
    const drop = tc.drop && (tc.base === 30 || tc.base === 60)
    info.timecode = { frames: tc.start, rate: fr, drop, seconds: framesToLabelSeconds(tc.start, fr, drop), string: framesToTc(tc.start, fr, drop), source: 'MXF' }
  }
  if (ident) {
    if (ident.date) info.created = ident.date
    if (company || ident.product) info.device = { make: company, model: ident.product || null, serial: null }
    info.software = [ident.product, ident.version].filter(Boolean).join(' ')
  }
  const at = indexOf(b, strBytes('<NonRealTimeMeta'))
  if (at >= 0) {
    const sony = parseSonyXml(utf8(b, at, Math.min(65536, b.length - at)))
    if (sony) {
      if (sony.device) info.device = sony.device
      if (sony.created) info.created = sony.created
      if (sony.timecode && !info.timecode) info.timecode = sony.timecode
    }
  }
  return info
}

/** Varre a essência e devolve os ranges do primeiro canal de áudio (BWF) ou os elementos AES3 a decodificar. */
export async function mxfAudioRanges(r, plan, onProgress) {
  const ranges = []
  let chosen = null
  let p = plan.start
  let kind = 'bwf'
  let guard = 0
  while (p + 20 <= r.size && guard++ < 5e6) {
    const h = await r.bytes(p, 32)
    if (h.length < 17) break
    if (!isUL(h, 0)) {
      // fora de alinhamento (KAG/preenchimento): procura a próxima chave
      const w = await r.bytes(p, 65536)
      let i = 1
      while (i < w.length - 16 && !isUL(w, i)) i++
      if (i >= w.length - 16) break
      p += i
      continue
    }
    const { len, n } = ber(h, 16)
    const v = p + 16 + n
    const isEssence = h[4] === 0x01 && h[5] === 0x02 && h[6] === 0x01 && h[8] === 0x0d && h[9] === 0x01 && h[10] === 0x03 && h[11] === 0x01
    if (isEssence && (h[12] === 0x16 || h[12] === 0x06)) {
      const elem = (h[14] << 8) | h[15]
      if (chosen == null || elem < chosen) {
        if (chosen != null && elem < chosen) ranges.length = 0
        chosen = elem
        kind = h[12] === 0x06 ? 'aes331' : h[14] === 0x03 || h[14] === 0x04 ? 'aes382' : 'bwf'
      }
      if (elem === chosen) ranges.push([v, len])
    }
    p = v + len
    if (onProgress && guard % 512 === 0) onProgress(p / r.size)
  }
  return { ranges, kind }
}
