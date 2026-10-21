// ZIP sem compressão (armazenado), com nomes em UTF-8: junta todas as exportações num download só.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** files: [{ name, data: string | Uint8Array }] → Uint8Array do .zip */
export function zip(files) {
  const enc = new TextEncoder()
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const lh = new Uint8Array(30 + name.length)
    const v = new DataView(lh.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x0800, true)
    v.setUint16(8, 0, true)
    v.setUint16(10, dosTime, true)
    v.setUint16(12, dosDate, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true)
    v.setUint32(22, data.length, true)
    v.setUint16(26, name.length, true)
    lh.set(name, 30)
    parts.push(lh, data)
    const ch = new Uint8Array(46 + name.length)
    const w = new DataView(ch.buffer)
    w.setUint32(0, 0x02014b50, true)
    w.setUint16(4, 20, true)
    w.setUint16(6, 20, true)
    w.setUint16(8, 0x0800, true)
    w.setUint16(12, dosTime, true)
    w.setUint16(14, dosDate, true)
    w.setUint32(16, crc, true)
    w.setUint32(20, data.length, true)
    w.setUint32(24, data.length, true)
    w.setUint16(28, name.length, true)
    w.setUint32(42, offset, true)
    ch.set(name, 46)
    central.push(ch)
    offset += lh.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, cdSize, true)
  e.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}
