// Extrai o som de um clipe como sinal mono a 4 kHz: o suficiente para sincronizar com precisão de amostra a 48 kHz
// (com interpolação) e leve o bastante para caber centenas de clipes na memória. Lê só os bytes de áudio.

import { Reader } from './reader.js'
import { mxfAudioRanges } from './mxf.js'
import { aviAudioRanges } from './riff.js'
import { eachPacket } from './ts.js'

export const SR = 4000

/** Média por intervalo: cada amostra de saída é a média das amostras de entrada que caem nela (filtro caixa). */
class Down {
  constructor(srIn, expectSec = 60) {
    this.step = SR / srIn
    this.phase = 0
    this.acc = 0
    this.n = 0
    this.out = new Float32Array(Math.max(1024, Math.ceil(expectSec * SR * 1.05) + 64))
    this.len = 0
  }
  push(x) {
    this.acc += x
    this.n++
    this.phase += this.step
    if (this.phase >= 1) {
      this.phase -= 1
      if (this.len >= this.out.length) {
        const bigger = new Float32Array(this.out.length * 2)
        bigger.set(this.out)
        this.out = bigger
      }
      this.out[this.len++] = this.acc / this.n
      this.acc = 0
      this.n = 0
    }
  }
  pushPlanar(planes, frames) {
    const ch = planes.length
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < ch; c++) s += planes[c][i]
      this.push(s / ch)
    }
  }
  result() {
    return this.out.subarray(0, this.len)
  }
}

/** Decodifica bytes PCM intercalados e empurra a média dos canais. Devolve quantos bytes usou (frames inteiros). */
function pushPcm(down, b, fmt, chMax = 8) {
  const bps = Math.ceil(fmt.bits / 8)
  const bpf = fmt.bytesPerFrame || bps * fmt.channels
  const ch = Math.min(fmt.channels, chMax)
  const frames = Math.floor(b.length / bpf)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const le = fmt.le
  for (let f = 0; f < frames; f++) {
    const base = f * bpf
    let s = 0
    for (let c = 0; c < ch; c++) {
      const o = base + c * bps
      let v
      if (fmt.float) v = bps === 8 ? dv.getFloat64(o, le) : dv.getFloat32(o, le)
      else if (bps === 2) v = dv.getInt16(o, le) / 32768
      else if (bps === 3) {
        const x = le ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) : (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
        v = ((x << 8) >> 8) / 8388608
      } else if (bps === 4) v = dv.getInt32(o, le) / 2147483648
      else v = fmt.unsigned ? (b[o] - 128) / 128 : ((b[o] << 24) >> 24) / 128
      s += v
    }
    down.push(s / ch)
  }
  return frames * bpf
}

/** AES3 de D-10 (SMPTE 331): cabeçalho de 4 bytes e palavras de 32 bits, 8 canais; usa o canal 1. */
function pushAes331(down, b) {
  const count = (b[1] | (b[2] << 8)) || Math.floor((b.length - 4) / 32)
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 32
    if (o + 4 > b.length) break
    const w = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    const x = (w >>> 4) & 0xffffff
    down.push(((x << 8) >> 8) / 8388608)
  }
}

/** Lê uma lista de ranges juntando os vizinhos numa leitura só (áudio intercalado quadro a quadro). */
async function readRanges(r, ranges, onChunk, onProgress, signal) {
  const total = ranges.reduce((s, x) => s + x[1], 0) || 1
  let done = 0
  let i = 0
  const MAX = 8 << 20
  const GAP = 256 << 10
  let pending = null
  const group = () => {
    if (i >= ranges.length) return null
    const start = ranges[i][0]
    let end = start + ranges[i][1]
    const parts = [ranges[i]]
    i++
    while (i < ranges.length && ranges[i][0] - end < GAP && ranges[i][0] >= end && ranges[i][0] + ranges[i][1] - start < MAX) {
      end = ranges[i][0] + ranges[i][1]
      parts.push(ranges[i])
      i++
    }
    // um range enorme (WAV inteiro) vira pedaços de 8 MB
    if (parts.length === 1 && end - start > MAX) {
      const pieces = []
      for (let p = start; p < end; p += MAX) pieces.push([p, Math.min(MAX, end - p)])
      return { start, end, parts: pieces, split: true }
    }
    return { start, end, parts }
  }
  const fetchGroup = (g) => (g.split ? null : r.blob.slice(g.start, g.end).arrayBuffer())
  let g = group()
  pending = g && fetchGroup(g)
  while (g) {
    if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const next = group()
    if (g.split) {
      for (const [p, l] of g.parts) {
        const buf = new Uint8Array(await r.blob.slice(p, p + l).arrayBuffer())
        onChunk(buf, true)
        done += l
        if (onProgress) onProgress(done / total)
        if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      }
    } else {
      const buf = new Uint8Array(await pending)
      const nextPending = next && fetchGroup(next)
      for (const [p, l] of g.parts) {
        onChunk(buf.subarray(p - g.start, p - g.start + l), false)
        done += l
      }
      if (onProgress) onProgress(done / total)
      pending = nextPending
    }
    g = next
    await 0
  }
}

async function fromPcm(r, ranges, fmt, dur, onProgress, signal) {
  const down = new Down(fmt.sampleRate, dur)
  let carry = null
  await readRanges(
    r,
    ranges,
    (buf, continuous) => {
      let b = buf
      if (carry && continuous) {
        const m = new Uint8Array(carry.length + buf.length)
        m.set(carry)
        m.set(buf, carry.length)
        b = m
      }
      const used = pushPcm(down, b, fmt)
      carry = continuous && used < b.length ? b.slice(used) : null
    },
    onProgress,
    signal,
  )
  return down.result()
}

async function fromAac(r, plan, dur, onProgress, signal) {
  if (typeof AudioDecoder === 'undefined') throw new Error('Este navegador não decodifica AAC (use Chrome, Edge ou Safari 26)')
  const cfg = { codec: plan.codec, sampleRate: plan.sampleRate, numberOfChannels: plan.channels, description: plan.asc }
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }))
  if (!sup.supported) throw new Error('O navegador não tem decodificador AAC')
  let down = null
  let err = null
  const dec = new AudioDecoder({
    output: (ad) => {
      try {
        if (!down) down = new Down(ad.sampleRate, dur)
        const n = ad.numberOfFrames
        const chs = Math.min(2, ad.numberOfChannels)
        const planes = []
        for (let c = 0; c < chs; c++) {
          const p = new Float32Array(n)
          ad.copyTo(p, { planeIndex: c, format: 'f32-planar' })
          planes.push(p)
        }
        down.pushPlanar(planes, n)
      } finally {
        ad.close()
      }
    },
    error: (e) => (err = e),
  })
  dec.configure(cfg)
  const s = plan.samples
  const count = s.length / 2
  const ranges = []
  for (let k = 0; k < count; k++) ranges.push([s[k * 2], s[k * 2 + 1]])
  let ts = 0
  const usPer = (1024 / plan.sampleRate) * 1e6
  await readRanges(
    r,
    ranges,
    (buf) => {
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(ts), data: buf.slice() }))
      ts += usPer
    },
    onProgress,
    signal,
  )
  await dec.flush()
  dec.close()
  if (err) throw err
  return down ? down.result() : new Float32Array(0)
}

async function fromDecode(file, onProgress) {
  if (file.size > 1.5 * 1024 ** 3) throw new Error('Arquivo grande demais para o decodificador do navegador')
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (!Ctx) throw new Error('Sem decodificador de áudio neste ambiente')
  const ab = await file.arrayBuffer()
  if (onProgress) onProgress(0.5)
  let ctx
  try {
    ctx = new Ctx(1, 1, SR)
  } catch {
    ctx = new Ctx(1, 1, 44100)
  }
  const buf = await ctx.decodeAudioData(ab)
  const chs = Math.min(2, buf.numberOfChannels)
  const planes = []
  for (let c = 0; c < chs; c++) planes.push(buf.getChannelData(c))
  if (buf.sampleRate === SR) {
    const out = new Float32Array(buf.length)
    for (let i = 0; i < buf.length; i++) {
      let s = 0
      for (let c = 0; c < chs; c++) s += planes[c][i]
      out[i] = s / chs
    }
    return out
  }
  const down = new Down(buf.sampleRate, buf.duration)
  down.pushPlanar(planes, buf.length)
  return down.result()
}

const LPCM_CH = [0, 1, 0, 2, 3, 3, 4, 4, 5, 6, 7, 8]
const LPCM_SR = { 1: 48000, 4: 96000, 5: 192000 }

async function fromTs(r, plan, dur, onProgress, signal) {
  const ps = plan.ps
  let down = null
  let firstPts = null
  let pes = []
  let dec = null
  let adtsBuf = new Uint8Array(0)
  let ts = 0
  let err = null
  const flushPes = () => {
    if (!pes.length) return
    let n = 0
    for (const p of pes) n += p.length
    const b = new Uint8Array(n)
    let o = 0
    for (const p of pes) {
      b.set(p, o)
      o += p.length
    }
    pes = []
    if (b.length < 9 || b[0] !== 0 || b[1] !== 0 || b[2] !== 1) return
    const hl = b[8]
    if (firstPts == null && b[7] & 0x80) {
      const q = 9
      firstPts = ((b[q] >> 1) & 7) * 1073741824 + ((b[q + 1] << 7) | (b[q + 2] >> 1)) * 32768 + ((b[q + 3] << 7) | (b[q + 4] >> 1))
    }
    const payload = b.subarray(9 + hl)
    if (plan.kind === 'lpcm') {
      if (payload.length < 4) return
      const ch = LPCM_CH[payload[2] >> 4] || 2
      const sr = LPCM_SR[payload[2] & 15] || 48000
      const bits = [0, 16, 24, 24][payload[3] >> 6] || 16
      if (!down) down = new Down(sr, dur)
      const stored = ch + (ch & 1)
      pushPcm(down, payload.subarray(4), { bits, le: false, float: false, channels: Math.min(ch, 2), bytesPerFrame: stored * (bits / 8), sampleRate: sr })
    } else if (plan.kind === 'adts') {
      const m = new Uint8Array(adtsBuf.length + payload.length)
      m.set(adtsBuf)
      m.set(payload, adtsBuf.length)
      let p = 0
      while (p + 7 <= m.length) {
        if (m[p] !== 0xff || (m[p + 1] & 0xf0) !== 0xf0) {
          p++
          continue
        }
        const len = ((m[p + 3] & 3) << 11) | (m[p + 4] << 3) | (m[p + 5] >> 5)
        if (len < 7 || p + len > m.length) break
        if (!dec) {
          const sri = (m[p + 2] >> 2) & 15
          const sr = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000][sri] || 48000
          const ch = ((m[p + 2] & 1) << 2) | (m[p + 3] >> 6) || 2
          dec = new AudioDecoder({
            output: (ad) => {
              if (!down) down = new Down(ad.sampleRate, dur)
              const n = ad.numberOfFrames
              const planes = []
              for (let c = 0; c < Math.min(2, ad.numberOfChannels); c++) {
                const pl = new Float32Array(n)
                ad.copyTo(pl, { planeIndex: c, format: 'f32-planar' })
                planes.push(pl)
              }
              down.pushPlanar(planes, n)
              ad.close()
            },
            error: (e) => (err = e),
          })
          dec.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch })
        }
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(ts), data: m.slice(p, p + len) }))
        ts += 21333
        p += len
      }
      adtsBuf = m.slice(p)
    }
  }
  if (plan.kind === 'adts' && typeof AudioDecoder === 'undefined') throw new Error('Este navegador não decodifica AAC')
  if (plan.kind === 'ac3') throw new Error('Áudio AC-3 (Dolby Digital) não é decodificado pelo navegador: sincronize por timecode/data ou use o áudio do gravador')
  const STEP = ps.size * 21000
  const ranges = []
  for (let p = 0; p < r.size; p += STEP) ranges.push([p, Math.min(STEP, r.size - p)])
  await readRanges(
    r,
    ranges,
    (buf) => {
      eachPacket(buf, ps, (pid, pl, pusi) => {
        if (pid !== plan.pid) return
        if (pusi) flushPes()
        pes.push(pl.slice())
      })
    },
    onProgress,
    signal,
  )
  flushPes()
  if (dec) {
    await dec.flush()
    dec.close()
  }
  if (err) throw err
  if (firstPts != null && plan.refPts != null) plan.delay = Math.max(0, (firstPts - plan.refPts) / 90000)
  return down ? down.result() : new Float32Array(0)
}

/**
 * Sinal mono a 4 kHz do clipe, alinhado ao começo do vídeo (edit list, priming do AAC, PTS do TS).
 * @returns {Promise<{ sig: Float32Array, duration: number }>}
 */
export async function extractAudio(file, info, { onProgress, signal } = {}) {
  const plan = info.audioPlan
  if (!plan || plan.type === 'none') throw new Error(plan && plan.why ? plan.why : 'Arquivo sem áudio')
  const r = new Reader(file)
  const dur = info.duration || 60
  let sig
  switch (plan.type) {
    case 'pcm':
      sig = await fromPcm(r, plan.ranges, plan.fmt, dur, onProgress, signal)
      break
    case 'avi': {
      const ranges = await aviAudioRanges(r, plan)
      sig = await fromPcm(r, ranges, plan.fmt, dur, onProgress, signal)
      break
    }
    case 'mxf': {
      const { ranges, kind } = await mxfAudioRanges(r, plan, (p) => onProgress && onProgress(p * 0.3))
      if (!ranges.length) throw new Error('Nenhum elemento de áudio encontrado no MXF')
      const prog = (p) => onProgress && onProgress(0.3 + p * 0.7)
      if (kind === 'aes331') {
        const down = new Down(plan.fmt.sampleRate, dur)
        await readRanges(r, ranges, (b) => pushAes331(down, b), prog, signal)
        sig = down.result()
      } else sig = await fromPcm(r, ranges, plan.fmt, dur, prog, signal)
      break
    }
    case 'aac':
      sig = await fromAac(r, plan, dur, onProgress, signal)
      break
    case 'ts':
      sig = await fromTs(r, plan, dur, onProgress, signal)
      break
    default:
      sig = await fromDecode(file, onProgress)
  }
  // começo do áudio em relação ao vídeo
  const skip = Math.round((plan.skip || 0) * SR)
  const delay = Math.round((plan.delay || 0) * SR)
  if (skip > 0) sig = sig.subarray(Math.min(skip, sig.length))
  if (delay > 0) {
    const out = new Float32Array(sig.length + delay)
    out.set(sig, delay)
    sig = out
  }
  return { sig: sig.slice(), duration: sig.length / SR }
}

/** Picos para desenhar a forma de onda: n colunas de 0 a 255 (escala que realça falas baixas). */
export function peaks(sig, n = 2000) {
  const cols = Math.max(1, Math.min(n, sig.length))
  const out = new Uint8Array(cols)
  const step = sig.length / cols
  let max = 1e-6
  const raw = new Float32Array(cols)
  for (let c = 0; c < cols; c++) {
    let m = 0
    const a = Math.floor(c * step)
    const b = Math.min(sig.length, Math.floor((c + 1) * step))
    for (let i = a; i < b; i++) {
      const v = Math.abs(sig[i])
      if (v > m) m = v
    }
    raw[c] = m
    if (m > max) max = m
  }
  for (let c = 0; c < cols; c++) out[c] = Math.round(255 * Math.sqrt(raw[c] / max))
  return out
}
