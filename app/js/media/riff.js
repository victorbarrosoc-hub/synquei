// WAV / Broadcast WAV / RF64 / BW64 / Wave64, AIFF / AIFF-C e AVI. Tudo por chunks, pulando os dados de áudio e vídeo.

import { ascii, u16be, u16le, u32be, u32le, u64le, utf8, f80be } from './reader.js'
import { WAV_FORMAT_TAGS, videoCodec } from './formats.js'
import { parseIxml } from './sidecar.js'
import { snapRate, framesToTc, labelSecondsToFrames, framesToLabelSeconds } from '../time.js'

function fmtChunk(b, o, n) {
  let tag = u16le(b, o)
  const f = { tag, channels: u16le(b, o + 2), sampleRate: u32le(b, o + 4), blockAlign: u16le(b, o + 12), bits: u16le(b, o + 14) }
  if (tag === 0xfffe && n >= 40) {
    f.validBits = u16le(b, o + 18)
    f.channelMask = u32le(b, o + 20)
    tag = u16le(b, o + 24) // os 2 primeiros bytes do GUID do subformato são o formato real
    f.tag = tag
    f.extensible = true
  }
  f.name = WAV_FORMAT_TAGS[tag] || `Formato 0x${tag.toString(16)}`
  return f
}

function bextChunk(b, o, n) {
  const desc = utf8(b, o, 256)
  const originator = utf8(b, o + 256, 32)
  const ref = utf8(b, o + 288, 32)
  const date = ascii(b, o + 320, 10)
  const time = ascii(b, o + 330, 8)
  const timeRef = u32le(b, o + 338) + u32le(b, o + 342) * 4294967296
  return { desc, originator, ref, date, time, timeRef, n }
}

/** "2024-05-01" + "14:22:10" (ou com '-', ':', '.') → ms locais. */
function bextDate(date, time) {
  const d = (date || '').match(/(\d{4})\D(\d{2})\D(\d{2})/)
  if (!d) return null
  const t = (time || '').match(/(\d{2})\D(\d{2})\D(\d{2})/)
  const dt = new Date(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0, t ? +t[3] : 0)
  return isNaN(dt) ? null : dt.getTime()
}

/** Modelo do gravador a partir do Originator / descrição do bext. */
function recorderFrom(bext, ixmlText) {
  const s = `${bext?.originator || ''} ${bext?.desc || ''} ${ixmlText || ''}`
  const known = [
    [/Sound Devices|MixPre|\b(633|664|688|788T|833|888|Scorpio)\b/i, 'Sound Devices'],
    [/ZOOM|\bF[3-8]n?\b|\bH[1-8]n?\b|PodTrak/i, 'Zoom'],
    [/TASCAM|DR-\d+/i, 'Tascam'],
    [/Deity/i, 'Deity'],
    [/RODE|Wireless (GO|PRO|ME)/i, 'Rode'],
    [/DJI/i, 'DJI'],
    [/Sennheiser/i, 'Sennheiser'],
    [/Nagra/i, 'Nagra'],
    [/Aaton|Cantar/i, 'Aaton'],
    [/Zaxcom|Nova|Deva/i, 'Zaxcom'],
    [/Lectrosonics/i, 'Lectrosonics'],
    [/Tentacle/i, 'Tentacle'],
  ]
  for (const [re, make] of known) if (re.test(s)) return { make, model: (bext?.originator || make).trim() || make, serial: null }
  if (bext?.originator) return { make: null, model: bext.originator, serial: null }
  return null
}

export async function probeWav(r, kind) {
  const info = { container: 'wav', warnings: [] }
  const head = await r.bytes(0, 64)
  let fmt = null
  let data = null
  let bext = null
  let ixmlText = null
  let ds64 = null
  const list = {}

  if (kind === 'w64') {
    info.container = 'w64'
    let pos = 40
    while (pos + 24 <= r.size) {
      const h = await r.bytes(pos, 24)
      const id = ascii(h, 0, 4)
      const size = u64le(h, 16)
      if (size < 24) break
      if (id === 'fmt ') {
        const b = await r.bytes(pos + 24, Math.min(64, size - 24))
        fmt = fmtChunk(b, 0, size - 24)
      } else if (id === 'data') data = { pos: pos + 24, len: Math.min(size - 24, r.size - pos - 24) }
      pos += Math.ceil(size / 8) * 8
    }
  } else {
    const riffId = ascii(head, 0, 4)
    if (riffId === 'RF64' || riffId === 'BW64') info.container = 'rf64'
    let pos = 12
    let guard = 0
    while (pos + 8 <= r.size && guard++ < 10000) {
      const h = await r.bytes(pos, 8)
      const id = ascii(h, 0, 4)
      let size = u32le(h, 4)
      if (id === 'ds64') {
        const b = await r.bytes(pos + 8, 28)
        ds64 = { dataSize: u64le(b, 8), sampleCount: u64le(b, 16) }
      }
      if (id === 'data') {
        if ((size === 0xffffffff || info.container === 'rf64') && ds64) size = ds64.dataSize
        const len = Math.min(size, r.size - pos - 8)
        data = { pos: pos + 8, len }
        if (size > r.size - pos - 8) info.warnings.push('Arquivo menor do que o cabeçalho diz (gravação interrompida?)')
      } else if (id === 'fmt ') {
        const b = await r.bytes(pos + 8, Math.min(size, 64))
        fmt = fmtChunk(b, 0, size)
      } else if (id === 'bext' && size >= 346) {
        const b = await r.bytes(pos + 8, Math.min(size, 1024))
        bext = bextChunk(b, 0, size)
      } else if ((id === 'iXML' || id === 'ixml') && size < 4 << 20) {
        ixmlText = utf8(await r.bytes(pos + 8, size))
      } else if (id === 'LIST' && size < 1 << 20) {
        const b = await r.bytes(pos + 8, size)
        if (ascii(b, 0, 4) === 'INFO') {
          let o = 4
          while (o + 8 <= b.length) {
            const k = ascii(b, o, 4)
            const n = u32le(b, o + 4)
            list[k] = utf8(b, o + 8, n)
            o += 8 + n + (n & 1)
          }
        }
      }
      if (size === 0xffffffff && id !== 'data') break
      pos += 8 + size + (size & 1)
    }
  }

  if (!fmt) throw new Error('WAV sem cabeçalho de formato')
  if (!data) throw new Error('WAV sem dados de áudio')
  const bpf = fmt.blockAlign || (fmt.channels * fmt.bits) / 8
  const frames = Math.floor(data.len / bpf)
  info.duration = frames / fmt.sampleRate
  info.audio = { codec: fmt.name, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.validBits || fmt.bits, float: fmt.tag === 3 }
  if (fmt.tag === 1 || fmt.tag === 3) {
    info.audioPlan = { type: 'pcm', fmt: { bits: fmt.bits, le: true, float: fmt.tag === 3, unsigned: fmt.bits === 8, channels: fmt.channels, sampleRate: fmt.sampleRate, bytesPerFrame: bpf }, ranges: [[data.pos, frames * bpf]], delay: 0, skip: 0 }
  } else info.audioPlan = { type: 'decode' }

  const ix = parseIxml(ixmlText)
  if (bext) {
    info.bext = { description: bext.desc, originator: bext.originator }
    const created = bextDate(bext.date, bext.time)
    if (created) info.created = created
  }
  const sr = fmt.sampleRate
  const ref = bext && bext.timeRef ? bext.timeRef : ix && ix.samplesSinceMidnight ? ix.samplesSinceMidnight : null
  if (ref != null && ref > 0) {
    const rate = (ix && ix.rate) || snapRate(25)
    const drop = !!(ix && ix.drop)
    const seconds = ref / sr // amostras desde a meia-noite, no relógio do timecode
    const frames = labelSecondsToFrames(seconds, rate, drop)
    info.timecode = { frames, rate, drop, seconds: framesToLabelSeconds(frames, rate, drop), exact: seconds, string: framesToTc(frames, rate, drop), source: ix && ix.rate ? 'BWF + iXML' : 'BWF', rateGuessed: !(ix && ix.rate) }
  }
  if (ix) {
    info.meta = { scene: ix.scene || null, take: ix.take || null, tape: ix.tape || null, note: ix.note || null, project: ix.project || null }
    if (ix.tracks.length) info.trackNames = ix.tracks.sort((a, b) => a.index - b.index).map((t) => t.name)
  }
  const dev = recorderFrom(bext, ixmlText)
  if (dev) info.device = dev
  if (list.ISFT) info.software = list.ISFT
  return info
}

export async function probeAiff(r) {
  const head = await r.bytes(0, 12)
  const aifc = ascii(head, 8, 4) === 'AIFC'
  const info = { container: 'aiff', warnings: [] }
  let comm = null
  let ssnd = null
  let pos = 12
  while (pos + 8 <= r.size) {
    const h = await r.bytes(pos, 8)
    const id = ascii(h, 0, 4)
    const size = u32be(h, 4)
    if (id === 'COMM') {
      const b = await r.bytes(pos + 8, Math.min(size, 64))
      comm = { channels: u16be(b, 0), frames: u32be(b, 2), bits: u16be(b, 6), sampleRate: f80be(b, 8), comp: aifc ? ascii(b, 18, 4) : 'NONE' }
    } else if (id === 'SSND') {
      const b = await r.bytes(pos + 8, 8)
      ssnd = { pos: pos + 16 + u32be(b, 0), len: size - 8 - u32be(b, 0) }
    }
    pos += 8 + size + (size & 1)
  }
  if (!comm || !ssnd) throw new Error('AIFF incompleto')
  const sr = Math.round(comm.sampleRate)
  info.duration = comm.frames / sr
  const c = comm.comp
  const float = /^fl(32|64)$/i.test(c)
  const bits = c.toLowerCase() === 'fl64' ? 64 : float ? 32 : comm.bits
  info.audio = { codec: c === 'NONE' || c === 'twos' || c === 'sowt' || float ? 'PCM' : c, sampleRate: sr, channels: comm.channels, bits }
  const bpf = comm.channels * Math.ceil(bits / 8)
  if (c === 'NONE' || c === 'twos' || c === 'sowt' || float) {
    info.audioPlan = { type: 'pcm', fmt: { bits, le: c === 'sowt', float, unsigned: false, channels: comm.channels, sampleRate: sr, bytesPerFrame: bpf }, ranges: [[ssnd.pos, Math.min(ssnd.len, comm.frames * bpf)]], delay: 0, skip: 0 }
  } else info.audioPlan = { type: 'decode' }
  return info
}

/** AVI e OpenDML (RIFF AVIX encadeados acima de 1 GB). O índice de chunks de áudio só é montado na hora de ler o som. */
export async function probeAvi(r) {
  const info = { container: 'avi', warnings: [] }
  const streams = []
  let avih = null
  let pos = 12
  const movi = []
  let guard = 0
  // cabeçalho: LIST hdrl
  const walk = async (start, end, depth) => {
    let p = start
    while (p + 8 <= end && guard++ < 20000) {
      const h = await r.bytes(p, 12)
      const id = ascii(h, 0, 4)
      const size = u32le(h, 4)
      if (id === 'LIST' || id === 'RIFF') {
        const type = ascii(h, 8, 4)
        if (type === 'movi') movi.push({ pos: p + 12, end: p + 8 + size })
        else if (depth < 4 && size < 64 << 20) await walk(p + 12, p + 8 + size, depth + 1)
      } else if (id === 'avih') {
        const b = await r.bytes(p + 8, 56)
        avih = { usPerFrame: u32le(b, 0), totalFrames: u32le(b, 16), width: u32le(b, 32), height: u32le(b, 36) }
      } else if (id === 'strh') {
        const b = await r.bytes(p + 8, 48)
        streams.push({ type: ascii(b, 0, 4), handler: ascii(b, 4, 4), scale: u32le(b, 20), rate: u32le(b, 24), length: u32le(b, 32) })
      } else if (id === 'strf' && streams.length) {
        const b = await r.bytes(p + 8, Math.min(size, 64))
        const s = streams[streams.length - 1]
        if (s.type === 'vids') s.compression = ascii(b, 16, 4)
        if (s.type === 'auds') s.fmt = fmtChunk(b, 0, size)
      } else if (id === 'IDIT') {
        const t = utf8(await r.bytes(p + 8, Math.min(size, 64)))
        if (!isNaN(Date.parse(t))) info.created = Date.parse(t)
      }
      p += 8 + size + (size & 1)
    }
  }
  await walk(pos, r.size, 0)
  const vs = streams.find((s) => s.type === 'vids')
  const as = streams.find((s) => s.type === 'auds')
  if (vs) {
    const fps = vs.scale ? vs.rate / vs.scale : avih && avih.usPerFrame ? 1e6 / avih.usPerFrame : null
    const c = videoCodec(vs.compression) || videoCodec(vs.handler)
    info.video = { fourcc: vs.compression || vs.handler, codec: c ? c.name : vs.compression || vs.handler, family: c ? c.family : null, width: avih ? avih.width : 0, height: avih ? avih.height : 0, rate: snapRate(fps), frames: vs.length || (avih && avih.totalFrames) }
    if (fps && info.video.frames) info.duration = info.video.frames / fps
  }
  if (as && as.fmt) {
    const f = as.fmt
    info.audio = { codec: f.name, sampleRate: f.sampleRate, channels: f.channels, bits: f.bits }
    const index = streams.indexOf(as)
    info.audioPlan = f.tag === 1 ? { type: 'avi', stream: index, movi, fmt: { bits: f.bits, le: true, float: false, unsigned: f.bits === 8, channels: f.channels, sampleRate: f.sampleRate, bytesPerFrame: f.blockAlign || (f.channels * f.bits) / 8 }, delay: 0, skip: 0 } : { type: 'decode' }
  }
  return info
}

/** Ranges do áudio dentro do 'movi' do AVI (chunks "01wb"). */
export async function aviAudioRanges(r, plan) {
  const tag = String(plan.stream).padStart(2, '0') + 'wb'
  const ranges = []
  for (const m of plan.movi) {
    let p = m.pos
    while (p + 8 <= m.end) {
      const h = await r.bytes(p, 12)
      const id = ascii(h, 0, 4)
      const size = u32le(h, 4)
      if (id === 'LIST') {
        p += 12
        continue
      }
      if (id === tag && size) ranges.push([p + 8, size])
      p += 8 + size + (size & 1)
    }
  }
  return ranges
}
