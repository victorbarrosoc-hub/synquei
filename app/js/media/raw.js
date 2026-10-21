// Cabeçalhos de RAW e quadros soltos: TIFF/DNG (CinemaDNG traz timecode e frame rate), RED (R3D), Phantom (.cine).

import { ascii, u16le, u16be, u32le, u32be, i32be, utf8 } from './reader.js'
import { snapRate, framesToLabelSeconds, framesToTc } from '../time.js'

/** IFD0 de um TIFF/DNG: tamanho, câmera, timecode SMPTE (0xC763) e frame rate (0xC764). */
export async function probeTiff(r) {
  const b = await r.bytes(0, Math.min(r.size, 256 << 10))
  const le = b[0] === 0x49
  const u16 = (o) => (le ? u16le(b, o) : u16be(b, o))
  const u32 = (o) => (le ? u32le(b, o) : u32be(b, o))
  const s32 = (o) => (le ? u32le(b, o) | 0 : i32be(b, o))
  const info = { container: 'tiff', warnings: [] }
  const ifd = u32(4)
  if (ifd + 2 > b.length) return info
  const n = u16(ifd)
  const tags = {}
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > b.length) break
    const tag = u16(e)
    const type = u16(e + 2)
    const count = u32(e + 4)
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] * count
    const vo = size <= 4 ? e + 8 : u32(e + 8)
    tags[tag] = { type, count, vo }
  }
  const num = (t) => (t ? (t.type === 3 ? u16(t.vo) : u32(t.vo)) : null)
  const str = (t) => (t && t.vo + t.count <= b.length ? utf8(b, t.vo, t.count) : null)
  info.video = { codec: tags[0xc612] ? 'CinemaDNG' : 'TIFF', width: num(tags[0x100]) || 0, height: num(tags[0x101]) || 0, rate: null, raw: !!tags[0xc612] }
  const make = str(tags[0x10f])
  const model = str(tags[0x110]) || str(tags[0xc614])
  if (make || model) info.device = { make, model, serial: str(tags[0xc62f]) }
  const fr = tags[0xc764]
  if (fr && fr.vo + 8 <= b.length) {
    const d = s32(fr.vo + 4)
    if (d) info.video.rate = snapRate(s32(fr.vo) / d)
  }
  const tc = tags[0xc763]
  if (tc && tc.vo + 4 <= b.length) {
    const bcd = (x) => (x >> 4) * 10 + (x & 15)
    const f = b[tc.vo]
    const rate = info.video.rate || snapRate(24)
    const nom = Math.round(rate.num / rate.den)
    const drop = !!(f & 0x40) && (nom === 30 || nom === 60)
    const frames = ((bcd(b[tc.vo + 3] & 0x3f) * 60 + bcd(b[tc.vo + 2] & 0x7f)) * 60 + bcd(b[tc.vo + 1] & 0x7f)) * nom + bcd(f & 0x3f)
    info.timecode = { frames, rate, drop, seconds: framesToLabelSeconds(frames, rate, drop), string: framesToTc(frames, rate, drop), source: 'DNG' }
  }
  return info
}

/** R3D: o cabeçalho RED1 (RED ONE) traz tamanho e fps; RED2 (câmeras atuais) é fechado. */
export async function probeR3d(r) {
  const b = await r.bytes(0, 512)
  const info = { container: 'r3d', warnings: [] }
  const tag = ascii(b, 4, 4)
  info.video = { codec: 'REDCODE RAW', family: 'REDCODE', raw: true, width: 0, height: 0, rate: null }
  if (tag === 'RED1') {
    info.video.width = u32be(b, 8 + 8 + 4 + 32 + 4)
    info.video.height = u32be(b, 8 + 8 + 4 + 32 + 8)
    const num = u16be(b, 8 + 8 + 4 + 32 + 14)
    const den = u16be(b, 8 + 8 + 4 + 32 + 16)
    if (num && den) info.video.rate = snapRate(num / den)
  }
  info.device = { make: 'RED', model: null, serial: null }
  return info
}

/** Phantom .cine: contagem de quadros no cabeçalho. */
export async function probeCine(r) {
  const b = await r.bytes(0, 64)
  const info = { container: 'cine', warnings: [] }
  info.video = { codec: 'Phantom Cine', family: 'Cine', raw: true, width: 0, height: 0, rate: null, frames: u32le(b, 20) }
  info.device = { make: 'Vision Research', model: 'Phantom', serial: null }
  return info
}
