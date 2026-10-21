// MPEG-TS e M2TS (AVCHD, HDV, broadcast): tabelas PAT/PMT, codecs, duração pelo PTS e o plano para ler o som
// (LPCM de Blu-ray e AAC ADTS; AC-3 quando o navegador decodifica).

import { u16be } from './reader.js'

const STREAM = {
  0x01: ['video', 'MPEG-1'],
  0x02: ['video', 'MPEG-2'],
  0x10: ['video', 'MPEG-4 Part 2'],
  0x1b: ['video', 'H.264 / AVC'],
  0x24: ['video', 'H.265 / HEVC'],
  0xea: ['video', 'VC-1'],
  0x03: ['audio', 'MP2'],
  0x04: ['audio', 'MP2'],
  0x0f: ['audio', 'AAC'],
  0x11: ['audio', 'AAC LATM'],
  0x80: ['audio', 'LPCM'],
  0x81: ['audio', 'AC-3'],
  0x83: ['audio', 'TrueHD'],
  0x84: ['audio', 'E-AC-3'],
  0x85: ['audio', 'DTS-HD'],
  0x86: ['audio', 'DTS-HD MA'],
  0x82: ['audio', 'DTS'],
  0x87: ['audio', 'E-AC-3'],
}

export function packetSize(b) {
  if (b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47) return { size: 188, off: 0 }
  if (b[4] === 0x47 && b[196] === 0x47 && b[388] === 0x47) return { size: 192, off: 4 }
  return null
}

/** Percorre pacotes de um buffer: cb(pid, payloadStart, payload, pusi). */
export function eachPacket(b, ps, cb) {
  for (let p = 0; p + ps.size <= b.length; p += ps.size) {
    const o = p + ps.off
    if (b[o] !== 0x47) continue
    const pusi = !!(b[o + 1] & 0x40)
    const pid = ((b[o + 1] & 0x1f) << 8) | b[o + 2]
    const afc = (b[o + 3] >> 4) & 3
    let q = o + 4
    if (afc === 2) continue
    if (afc === 3) q += 1 + b[q]
    if (q >= o + 188) continue
    if (cb(pid, b.subarray(q, o + 188), pusi) === false) return
  }
}

function pesPts(pl) {
  if (pl.length < 14 || pl[0] !== 0 || pl[1] !== 0 || pl[2] !== 1) return null
  if (!(pl[7] & 0x80)) return null
  const p = 9
  return ((pl[p] >> 1) & 7) * 1073741824 + ((pl[p + 1] << 7) | (pl[p + 2] >> 1)) * 32768 + ((pl[p + 3] << 7) | (pl[p + 4] >> 1))
}

export async function probeTs(r) {
  const head = await r.bytes(0, Math.min(r.size, 2 << 20))
  const ps = packetSize(head)
  if (!ps) throw new Error('Pacotes MPEG-TS não encontrados')
  const info = { container: ps.size === 192 ? 'm2ts' : 'ts', warnings: [] }
  let pmtPid = null
  const streams = []
  eachPacket(head, ps, (pid, pl, pusi) => {
    if (pid === 0 && pusi && pmtPid == null) {
      const s = 1 + pl[0]
      const len = ((pl[s + 1] & 0x0f) << 8) | pl[s + 2]
      for (let o = s + 8; o + 4 <= s + 3 + len - 4; o += 4) {
        const prog = u16be(pl, o)
        if (prog) {
          pmtPid = u16be(pl, o + 2) & 0x1fff
          break
        }
      }
    } else if (pid === pmtPid && pusi && !streams.length) {
      const s = 1 + pl[0]
      const len = ((pl[s + 1] & 0x0f) << 8) | pl[s + 2]
      const pil = ((pl[s + 10] & 0x0f) << 8) | pl[s + 11]
      let o = s + 12 + pil
      const end = s + 3 + len - 4
      while (o + 5 <= end) {
        const type = pl[o]
        const epid = u16be(pl, o + 1) & 0x1fff
        const esl = u16be(pl, o + 3) & 0x0fff
        let t = STREAM[type]
        // 0x06 com descritor AC-3 (0x6a) ou E-AC-3 (0x7a)
        if (!t && type === 0x06) {
          for (let d = o + 5; d < o + 5 + esl; d += 2 + pl[d + 1]) {
            if (pl[d] === 0x6a) t = ['audio', 'AC-3']
            if (pl[d] === 0x7a) t = ['audio', 'E-AC-3']
          }
        }
        if (t) streams.push({ pid: epid, type, kind: t[0], codec: t[1] })
        o += 5 + esl
      }
      return false
    }
  })
  const v = streams.find((s) => s.kind === 'video')
  const a = streams.find((s) => s.kind === 'audio')
  const ref = v || a
  let first = null
  if (ref) {
    eachPacket(head, ps, (pid, pl, pusi) => {
      if (pid === ref.pid && pusi) {
        const t = pesPts(pl)
        if (t != null) {
          first = t
          return false
        }
      }
    })
    const tail = await r.bytes(Math.max(0, r.size - (2 << 20)), Math.min(r.size, 2 << 20))
    // alinha no primeiro sync byte do pedaço final
    let k = 0
    while (k < ps.size * 2 && !(tail[k + ps.off] === 0x47 && tail[k + ps.off + ps.size] === 0x47)) k++
    let last = null
    eachPacket(tail.subarray(k), ps, (pid, pl, pusi) => {
      if (pid === ref.pid && pusi) {
        const t = pesPts(pl)
        if (t != null) last = t
      }
    })
    if (first != null && last != null) {
      let d = last - first
      if (d < 0) d += 8589934592
      info.duration = d / 90000 + (v ? 1 / 30 : 0)
    }
  }
  if (v) info.video = { codec: v.codec, width: 0, height: 0, rate: null }
  if (a) {
    info.audio = { codec: a.codec, sampleRate: 48000, channels: 2, bits: a.codec === 'LPCM' ? 16 : null }
    const kind = a.codec === 'LPCM' ? 'lpcm' : a.codec === 'AAC' ? 'adts' : a.codec === 'AC-3' ? 'ac3' : null
    info.audioPlan = kind ? { type: 'ts', kind, pid: a.pid, ps, refPts: v ? first : null, delay: 0, skip: 0 } : { type: 'none', why: `Áudio ${a.codec} em MPEG-TS não é lido no navegador` }
  }
  return info
}
