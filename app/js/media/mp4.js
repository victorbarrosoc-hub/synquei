// QuickTime / ISO BMFF (MOV, MP4, M4A, BRAW, CRM, NEV, INSV…): faixas, codecs, tamanho, fps, timecode (tmcd),
// data, aparelho e o plano para ler o áudio sem carregar o vídeo (PCM direto do arquivo; AAC pelo WebCodecs).

import { ascii, u16be, u32be, i32be, u64be, f64be, utf8, indexOf, strBytes } from './reader.js'
import { videoCodec, audioCodec } from './formats.js'
import { snapRate, framesToLabelSeconds, framesToTc } from '../time.js'
import { parseSonyXml } from './sidecar.js'

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf', 'mvex', 'tref', 'gmhd'])

function* boxes(b, start, end) {
  let p = start
  while (p + 8 <= end) {
    let size = u32be(b, p)
    const type = ascii(b, p + 4, 4)
    let hdr = 8
    if (size === 1) {
      size = u64be(b, p + 8)
      hdr = 16
    } else if (size === 0) size = end - p
    if (size < hdr || p + size > end + 8) return
    yield { type, start: p, body: p + hdr, end: Math.min(end, p + size) }
    p += size
  }
}
const child = (b, box, type) => {
  for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c
  return null
}
const path = (b, box, ...types) => {
  let cur = box
  for (const t of types) {
    cur = cur && child(b, cur, t)
    if (!cur) return null
  }
  return cur
}

/** Lê os boxes do topo até achar o moov (que pode estar no fim, depois de um mdat enorme). */
async function topLevel(r) {
  const out = { brand: null, compat: [], moov: null, extras: [] }
  let pos = 0
  let guard = 0
  while (pos + 8 <= r.size && guard++ < 100000) {
    const h = await r.bytes(pos, 16)
    if (h.length < 8) break
    let size = u32be(h, 0)
    const type = ascii(h, 4, 4)
    let hdr = 8
    if (size === 1) {
      size = u64be(h, 8)
      hdr = 16
    } else if (size === 0) size = r.size - pos
    if (size < hdr || !/^[\x20-\x7e©]{4}$/.test(type)) break
    if (type === 'ftyp') {
      const b = await r.bytes(pos, Math.min(size, 128))
      out.brand = ascii(b, 8, 4)
      for (let o = 16; o + 4 <= b.length; o += 4) out.compat.push(ascii(b, o, 4))
    } else if (type === 'moov') out.moov = { pos, size }
    else if ((type === 'uuid' || type === 'meta' || type === 'udta') && size < 4 << 20) out.extras.push({ pos, size })
    pos += size
  }
  return out
}

function parseElst(b, box) {
  const v = b[box.body]
  const n = u32be(b, box.body + 4)
  const list = []
  let o = box.body + 8
  for (let i = 0; i < n && o < box.end; i++) {
    const dur = v === 1 ? u64be(b, o) : u32be(b, o)
    const mt = v === 1 ? i32be(b, o + 8) * 4294967296 + u32be(b, o + 12) : i32be(b, o + 4)
    list.push({ dur, mediaTime: mt })
    o += v === 1 ? 20 : 12
  }
  return list
}

function parseTables(b, stbl) {
  const t = {}
  const stts = child(b, stbl, 'stts')
  if (stts) {
    const n = u32be(b, stts.body + 4)
    t.stts = []
    for (let i = 0; i < n; i++) t.stts.push([u32be(b, stts.body + 8 + i * 8), u32be(b, stts.body + 12 + i * 8)])
  }
  const stsc = child(b, stbl, 'stsc')
  if (stsc) {
    const n = u32be(b, stsc.body + 4)
    t.stsc = []
    for (let i = 0; i < n; i++) t.stsc.push([u32be(b, stsc.body + 8 + i * 12), u32be(b, stsc.body + 12 + i * 12)])
  }
  const stsz = child(b, stbl, 'stsz')
  if (stsz) {
    t.sampleSize = u32be(b, stsz.body + 4)
    t.sampleCount = u32be(b, stsz.body + 8)
    if (t.sampleSize === 0) {
      t.sizes = new Uint32Array(t.sampleCount)
      for (let i = 0; i < t.sampleCount; i++) t.sizes[i] = u32be(b, stsz.body + 12 + i * 4)
    }
  }
  const stz2 = child(b, stbl, 'stz2')
  if (stz2) {
    const fs = b[stz2.body + 7]
    t.sampleSize = 0
    t.sampleCount = u32be(b, stz2.body + 8)
    t.sizes = new Uint32Array(t.sampleCount)
    for (let i = 0; i < t.sampleCount; i++) {
      const o = stz2.body + 12
      t.sizes[i] = fs === 16 ? u16be(b, o + i * 2) : fs === 8 ? b[o + i] : (b[o + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15
    }
  }
  const stco = child(b, stbl, 'stco')
  const co64 = child(b, stbl, 'co64')
  if (stco || co64) {
    const box = stco || co64
    const n = u32be(b, box.body + 4)
    t.chunks = new Float64Array(n)
    for (let i = 0; i < n; i++) t.chunks[i] = co64 ? u64be(b, box.body + 8 + i * 8) : u32be(b, box.body + 8 + i * 4)
  }
  return t
}

/** Amostras por chunk, chunk a chunk. */
function samplesPerChunk(t) {
  const n = t.chunks ? t.chunks.length : 0
  const spc = new Uint32Array(n)
  const runs = t.stsc || []
  for (let r = 0; r < runs.length; r++) {
    const from = runs[r][0] - 1
    const to = r + 1 < runs.length ? runs[r + 1][0] - 1 : n
    for (let c = Math.max(0, from); c < Math.min(to, n); c++) spc[c] = runs[r][1]
  }
  return spc
}

function parseEsds(b, box) {
  // descritores MPEG-4: 0x03 ES, 0x04 DecoderConfig, 0x05 DecoderSpecificInfo (AudioSpecificConfig)
  let o = box.body + 4
  const readLen = () => {
    let len = 0
    for (let i = 0; i < 4; i++) {
      const c = b[o++]
      len = (len << 7) | (c & 0x7f)
      if (!(c & 0x80)) break
    }
    return len
  }
  const out = {}
  while (o < box.end) {
    const tag = b[o++]
    const len = readLen()
    if (tag === 0x03) {
      const flags = b[o + 2]
      o += 3
      if (flags & 0x80) o += 2
      if (flags & 0x40) o += 1 + b[o]
      if (flags & 0x20) o += 2
      continue
    }
    if (tag === 0x04) {
      out.oti = b[o]
      o += 13
      continue
    }
    if (tag === 0x05) {
      out.asc = b.slice(o, o + len)
      break
    }
    o += len
  }
  return out
}

function parseSound(b, entry, isQt, mdhdScale) {
  const o = entry.body
  const fourcc = entry.type
  const version = u16be(b, o + 8)
  const a = { fourcc, channels: u16be(b, o + 16), bits: u16be(b, o + 18), sampleRate: u32be(b, o + 24) / 65536 }
  let kids = o + 28
  if (isQt && version === 1) {
    a.bytesPerFrame = u32be(b, o + 36)
    kids = o + 44
  } else if (isQt && version === 2) {
    a.sampleRate = f64be(b, o + 32)
    a.channels = u32be(b, o + 40)
    a.bits = u32be(b, o + 48)
    a.lpcmFlags = u32be(b, o + 52)
    a.bytesPerFrame = u32be(b, o + 56)
    kids = o + 64
  }
  if (!a.sampleRate || a.sampleRate < 1000) a.sampleRate = mdhdScale
  // filhos: esds direto (MP4) ou dentro de 'wave' (QuickTime)
  const scan = (start, end) => {
    for (const c of boxes(b, start, end)) {
      if (c.type === 'esds') Object.assign(a, parseEsds(b, c))
      else if (c.type === 'wave') scan(c.body, c.end)
      else if (c.type === 'enda') a.littleEndian = u16be(b, c.body) === 1
      else if (c.type === 'pcmC') {
        a.littleEndian = !!(b[c.body + 4] & 1)
        a.bits = b[c.body + 5]
      } else if (c.type === 'frma') a.frma = ascii(b, c.body, 4)
    }
  }
  scan(kids, entry.end)
  return a
}

/** Como interpretar as amostras PCM desta faixa, ou null se não for PCM. */
function pcmFormat(a) {
  const f = a.frma && a.fourcc === 'mp4a' ? a.frma : a.fourcc
  let bits = a.bits
  let le = false
  let float = false
  let unsigned = false
  switch (f) {
    case 'sowt':
      le = true
      break
    case 'twos':
      break
    case 'raw ':
      bits = 8
      unsigned = true
      break
    case 'in24':
      bits = 24
      le = !!a.littleEndian
      break
    case 'in32':
      bits = 32
      le = !!a.littleEndian
      break
    case 'fl32':
      bits = 32
      float = true
      le = !!a.littleEndian
      break
    case 'fl64':
      bits = 64
      float = true
      le = !!a.littleEndian
      break
    case 'ipcm':
      le = !!a.littleEndian
      break
    case 'fpcm':
      le = !!a.littleEndian
      float = true
      break
    case 'lpcm':
      float = !!(a.lpcmFlags & 1)
      le = !(a.lpcmFlags & 2)
      break
    default:
      return null
  }
  if (!bits) bits = 16
  return { bits, le, float, unsigned, channels: a.channels || 1, sampleRate: a.sampleRate, bytesPerFrame: a.bytesPerFrame || (a.channels || 1) * Math.ceil(bits / 8) }
}

/** Textos do udta: ©mak, ©mod… (QuickTime) e ilst/keys (MP4, iPhone). */
function readUdta(b, box, out) {
  for (const c of boxes(b, box.body, box.end)) {
    if (c.type.charCodeAt(0) === 0xa9) {
      // QuickTime: [tam 2][idioma 2][texto]
      const n = u16be(b, c.body)
      const v = n && n < c.end - c.body ? utf8(b, c.body + 4, n) : utf8(b, c.body, c.end - c.body)
      out[c.type.slice(1)] = v
    } else if (c.type === 'meta') readMeta(b, c, out)
    else if (c.type === 'FIRM' || c.type === 'CAME') out[c.type] = utf8(b, c.body, Math.min(64, c.end - c.body))
  }
}
function readMeta(b, box, out) {
  // ISO: FullBox (4 bytes de versão) antes dos filhos; QuickTime: filhos direto
  const start = ascii(b, box.body + 4, 4) === 'hdlr' ? box.body : box.body + 4
  const fake = { body: start, end: box.end }
  const keys = []
  const k = child(b, fake, 'keys')
  if (k) {
    const n = u32be(b, k.body + 4)
    let o = k.body + 8
    for (let i = 0; i < n && o < k.end; i++) {
      const sz = u32be(b, o)
      keys.push(utf8(b, o + 8, sz - 8))
      o += sz
    }
  }
  const ilst = child(b, fake, 'ilst')
  if (ilst) {
    for (const item of boxes(b, ilst.body, ilst.end)) {
      const data = child(b, item, 'data')
      if (!data) continue
      const v = utf8(b, data.body + 8, data.end - data.body - 8)
      const idx = u32be(b, item.start + 4)
      const key = keys.length && idx >= 1 && idx <= keys.length ? keys[idx - 1] : item.type.replace('©', '')
      out[key] = v
    }
  }
  const xml = child(b, fake, 'xml ')
  if (xml) out.__xml = utf8(b, xml.body + 4, xml.end - xml.body - 4)
}

const GOPRO = { HD7: 'HERO7', HD8: 'HERO8', HD9: 'HERO9', H21: 'HERO10', H22: 'HERO11', H23: 'HERO12', H24: 'HERO13', H25: 'HERO14' }

export async function probeMp4(r, hint = {}) {
  const top = await topLevel(r)
  if (!top.moov) throw new Error('Arquivo sem índice (moov): gravação interrompida ou incompleta')
  if (top.moov.size > 512 << 20) throw new Error('Índice do arquivo grande demais')
  const b = await r.bytes(top.moov.pos, top.moov.size)
  const moov = { body: 8, end: b.length }
  const isQt = top.brand === 'qt  ' || (!top.brand && true) || hint.ext === 'braw' || hint.ext === 'crm'
  const info = { container: isQt ? 'mov' : 'mp4', brand: top.brand, tracks: [], warnings: [] }

  const mvhd = child(b, moov, 'mvhd')
  let movieScale = 600
  if (mvhd) {
    const v = b[mvhd.body]
    const created = v === 1 ? u64be(b, mvhd.body + 4) : u32be(b, mvhd.body + 4)
    movieScale = u32be(b, mvhd.body + (v === 1 ? 20 : 12))
    const dur = v === 1 ? u64be(b, mvhd.body + 24) : u32be(b, mvhd.body + 16)
    if (movieScale) info.duration = dur / movieScale
    // segundos desde 1904; muitas câmeras gravam hora local, outras UTC (fica como "data aproximada")
    if (created > 2082844800 + 86400 * 365 * 10) info.created = (created - 2082844800) * 1000
  }

  const meta = {}
  const udta = child(b, moov, 'udta')
  if (udta) readUdta(b, udta, meta)
  const mmeta = child(b, moov, 'meta')
  if (mmeta) readMeta(b, mmeta, meta)

  for (const trak of boxes(b, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue
    const mdia = child(b, trak, 'mdia')
    if (!mdia) continue
    const mdhd = child(b, mdia, 'mdhd')
    const hdlr = child(b, mdia, 'hdlr')
    const stbl = path(b, mdia, 'minf', 'stbl')
    if (!mdhd || !hdlr || !stbl) continue
    const mv = b[mdhd.body]
    const scale = u32be(b, mdhd.body + (mv === 1 ? 20 : 12))
    const mdur = mv === 1 ? u64be(b, mdhd.body + 24) : u32be(b, mdhd.body + 16)
    const handler = ascii(b, hdlr.body + 8, 4)
    const stsd = child(b, stbl, 'stsd')
    const entry = stsd ? [...boxes(b, stsd.body + 8, stsd.end)][0] : null
    const t = { handler, scale, duration: scale ? mdur / scale : 0, fourcc: entry ? entry.type : null }
    const tkhd = child(b, trak, 'tkhd')
    if (tkhd) {
      t.width = u32be(b, tkhd.end - 8) / 65536
      t.height = u32be(b, tkhd.end - 4) / 65536
    }
    const elst = path(b, trak, 'edts', 'elst')
    t.edits = elst ? parseElst(b, elst) : []
    t.tables = parseTables(b, stbl)
    if (handler === 'vide' && entry) {
      t.width = u16be(b, entry.body + 24) || t.width
      t.height = u16be(b, entry.body + 26) || t.height
      const cn = b[entry.body + 42]
      t.compressor = cn > 0 && cn < 32 ? utf8(b, entry.body + 43, cn) : ''
      for (const c of boxes(b, entry.body + 78, entry.end)) {
        if (c.type === 'fiel') t.interlaced = b[c.body] === 2
        if (c.type === 'avcC') t.profile = b[c.body + 1]
      }
    } else if (handler === 'soun' && entry) {
      t.sound = parseSound(b, entry, isQt, scale)
    } else if (handler === 'tmcd' && entry && entry.type === 'tmcd') {
      t.tmcd = { flags: u32be(b, entry.body + 12), timescale: u32be(b, entry.body + 16), frameDuration: u32be(b, entry.body + 20), nFrames: b[entry.body + 24] }
    }
    info.tracks.push(t)
  }

  // ── vídeo ──
  const vt = info.tracks.find((t) => t.handler === 'vide' && t.fourcc && t.fourcc !== 'jpeg' && t.width >= 64) || info.tracks.find((t) => t.handler === 'vide')
  if (vt) {
    const c = videoCodec(vt.fourcc)
    let fps = null
    const stts = vt.tables.stts || []
    const total = stts.reduce((s, e) => s + e[0], 0)
    const main = stts.slice().sort((x, y) => y[0] - x[0])[0]
    if (main && main[1] && main[0] >= total * 0.9) fps = vt.scale / main[1]
    else if (vt.duration && total) fps = total / vt.duration
    info.video = { fourcc: vt.fourcc, codec: c ? c.name : vt.compressor || vt.fourcc, family: c ? c.family : null, raw: !!(c && c.raw), width: Math.round(vt.width), height: Math.round(vt.height), rate: snapRate(fps), interlaced: !!vt.interlaced, frames: total }
    if (!info.duration && vt.duration) info.duration = vt.duration
  }

  // ── áudio ── (a primeira faixa de som; câmeras de cinema gravam uma faixa mono por canal)
  const sts = info.tracks.filter((t) => t.handler === 'soun' && t.sound)
  if (sts.length) {
    const at = sts[0]
    const s = at.sound
    const ac = audioCodec(s.frma && s.fourcc === 'mp4a' ? s.frma : s.fourcc)
    const pcm = pcmFormat(s)
    info.audio = { fourcc: s.fourcc, codec: ac ? ac.name : s.fourcc, sampleRate: Math.round(s.sampleRate), channels: s.channels, bits: pcm ? pcm.bits : null, tracks: sts.length, totalChannels: sts.reduce((n, t) => n + (t.sound.channels || 1), 0) }
    info.audioPlan = audioPlan(at, pcm, movieScale)
    if (!info.audioPlan) info.audioPlan = { type: 'decode' }
  }

  // ── timecode (faixa tmcd) ──
  const tt = info.tracks.find((t) => t.tmcd && t.tables.chunks && t.tables.chunks.length)
  if (tt && tt.tmcd.timescale && tt.tmcd.frameDuration) {
    const first = await r.bytes(tt.tables.chunks[0], 4)
    if (first.length === 4) {
      const frames = u32be(first, 0)
      const rate = snapRate(tt.tmcd.timescale / tt.tmcd.frameDuration)
      const nom = tt.tmcd.nFrames || Math.round(rate.num / rate.den)
      const drop = !!(tt.tmcd.flags & 1) && (nom === 30 || nom === 60)
      info.timecode = { frames, rate, drop, seconds: framesToLabelSeconds(frames, rate, drop), string: framesToTc(frames, rate, drop), source: 'Faixa de timecode' }
    }
  }

  // ── aparelho e metadados ──
  const make = meta['com.apple.quicktime.make'] || meta.mak || meta.make
  const model = meta['com.apple.quicktime.model'] || meta.mod || meta.model
  if (make || model) info.device = { make: make || null, model: model || null, serial: null }
  if (!info.device && meta.FIRM) {
    const g = GOPRO[meta.FIRM.slice(0, 3)]
    if (g) info.device = { make: 'GoPro', model: g, serial: null }
  }
  const sw = meta['com.apple.quicktime.software'] || meta.swr || meta.too
  if (sw) info.software = sw
  const cd = meta['com.apple.quicktime.creationdate']
  if (cd && !isNaN(Date.parse(cd))) info.created = Date.parse(cd)

  // XML Sony dentro do arquivo (XAVC S/HS): timecode, modelo e número de série
  let xml = meta.__xml || null
  if (!xml) {
    const at = indexOf(b, strBytes('<NonRealTimeMeta'))
    if (at >= 0) xml = utf8(b, Math.max(0, at - 64), Math.min(b.length - at + 64, 64 * 1024))
  }
  if (!xml) {
    for (const e of top.extras) {
      const eb = await r.bytes(e.pos, e.size)
      const at = indexOf(eb, strBytes('<NonRealTimeMeta'))
      if (at >= 0) {
        xml = utf8(eb, at, eb.length - at)
        break
      }
    }
  }
  const sony = parseSonyXml(xml)
  if (sony) {
    if (sony.timecode && !info.timecode) info.timecode = sony.timecode
    if (sony.device) info.device = sony.device
    if (sony.created) info.created = sony.created
  }
  return info
}

/** Plano de leitura do áudio da faixa: ranges PCM ou amostras AAC, com o deslocamento do edit list. */
function audioPlan(t, pcm, movieScale) {
  const tb = t.tables
  if (!tb.chunks || !tb.chunks.length) return null
  const spc = samplesPerChunk(tb)
  // edit list: começo vazio atrasa o áudio; media_time > 0 pula o "priming" do AAC
  let delay = 0
  let skip = 0
  for (const e of t.edits) {
    if (e.mediaTime === -1) delay += e.dur / (movieScale || 600)
    else {
      skip = e.mediaTime / (t.scale || 1)
      break
    }
  }
  if (pcm) {
    const ranges = []
    let si = 0
    for (let c = 0; c < tb.chunks.length; c++) {
      const n = spc[c]
      let len
      if (tb.sizes) {
        len = 0
        for (let k = 0; k < n; k++) len += tb.sizes[si + k] || 0
      } else len = n * (tb.sampleSize > 1 ? tb.sampleSize : pcm.bytesPerFrame)
      si += n
      if (len > 0) ranges.push([tb.chunks[c], len])
    }
    return { type: 'pcm', fmt: pcm, ranges: mergeRanges(ranges), delay, skip }
  }
  const s = t.sound
  const isAac = (s.fourcc === 'mp4a' || s.frma === 'mp4a') && (s.oti === 0x40 || s.oti === 0x66 || s.oti === 0x67 || s.oti === 0x68 || !s.oti)
  const sizes = tb.sizes || (tb.sampleSize && tb.sampleCount ? new Uint32Array(tb.sampleCount).fill(tb.sampleSize) : null)
  if (isAac && s.asc && sizes) {
    tb.sizes = sizes
    const aot = s.asc[0] >> 3
    const samples = new Float64Array(tb.sizes.length * 2)
    let si = 0
    for (let c = 0; c < tb.chunks.length; c++) {
      let off = tb.chunks[c]
      for (let k = 0; k < spc[c] && si < tb.sizes.length; k++, si++) {
        samples[si * 2] = off
        samples[si * 2 + 1] = tb.sizes[si]
        off += tb.sizes[si]
      }
    }
    return { type: 'aac', codec: `mp4a.40.${aot === 31 ? 2 : aot}`, asc: s.asc, sampleRate: Math.round(s.sampleRate), channels: s.channels || 2, samples: samples.subarray(0, si * 2), delay, skip }
  }
  return { type: 'decode', delay, skip }
}

/** Junta ranges colados (PCM de chunks consecutivos) para menos leituras. */
function mergeRanges(ranges) {
  const out = []
  for (const [p, l] of ranges) {
    const last = out[out.length - 1]
    if (last && last[0] + last[1] === p) last[1] += l
    else out.push([p, l])
  }
  return out
}
