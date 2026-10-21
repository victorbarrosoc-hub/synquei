// Leitura aleatória de um File/Blob sem carregar o arquivo inteiro: uma janela em cache e leituras sob demanda.
// Funciona igual no navegador e no Node (fs.openAsBlob), o que deixa os testes rodarem nos mesmos arquivos.

export class Reader {
  constructor(blob, win = 1 << 20) {
    this.blob = blob
    this.size = blob.size
    this.win = win
    this.cache = null
    this.cacheStart = 0
    this.reads = 0
  }

  /** Bytes [pos, pos+len). Pode devolver menos no fim do arquivo. */
  async bytes(pos, len) {
    pos = Math.max(0, Math.floor(pos))
    len = Math.max(0, Math.min(Math.floor(len), this.size - pos))
    const c = this.cache
    if (c && pos >= this.cacheStart && pos + len <= this.cacheStart + c.length) return c.subarray(pos - this.cacheStart, pos - this.cacheStart + len)
    this.reads++
    if (len > this.win) return new Uint8Array(await this.blob.slice(pos, pos + len).arrayBuffer())
    const end = Math.min(this.size, pos + this.win)
    this.cache = new Uint8Array(await this.blob.slice(pos, end).arrayBuffer())
    this.cacheStart = pos
    return this.cache.subarray(0, len)
  }

  async view(pos, len) {
    const b = await this.bytes(pos, len)
    return new DataView(b.buffer, b.byteOffset, b.byteLength)
  }
}

// ───────── ajudantes de bytes ─────────

export const ascii = (b, o, n) => {
  let s = ''
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i])
  return s
}
export const u16be = (b, o) => (b[o] << 8) | b[o + 1]
export const u16le = (b, o) => b[o] | (b[o + 1] << 8)
export const u24be = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]
export const u32be = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
export const u32le = (b, o) => ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o])
export const i32be = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]
export const u64be = (b, o) => u32be(b, o) * 4294967296 + u32be(b, o + 4)
export const u64le = (b, o) => u32le(b, o + 4) * 4294967296 + u32le(b, o)
export const f64be = (b, o) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, false)
export const f32be = (b, o) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false)

/** Texto UTF-8 de um pedaço de bytes, sem nulos no fim. */
export function utf8(b, o = 0, n = b.length - o) {
  const s = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(o, o + n))
  return s.replace(/\u0000+$/g, '').replace(/\u0000/g, '').trim()
}

/** Texto UTF-16BE (MXF). */
export function utf16be(b, o, n) {
  let s = ''
  for (let i = 0; i + 1 < n; i += 2) {
    const c = (b[o + i] << 8) | b[o + i + 1]
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}

/** Float de 80 bits (taxa de amostragem do AIFF). */
export function f80be(b, o) {
  const exp = ((b[o] & 0x7f) << 8) | b[o + 1]
  let mant = 0
  for (let i = 0; i < 8; i++) mant = mant * 256 + b[o + 2 + i]
  if (exp === 0 && mant === 0) return 0
  const v = mant * Math.pow(2, exp - 16383 - 63)
  return b[o] & 0x80 ? -v : v
}

/** Procura uma sequência de bytes. */
export function indexOf(b, needle, from = 0) {
  outer: for (let i = from; i <= b.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

export const strBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
