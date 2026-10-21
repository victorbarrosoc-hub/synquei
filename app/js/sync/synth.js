// Cena sonora sintética: fala (sílabas com formantes), pausas e palmas. Serve para o projeto de exemplo do app e para
// os testes do motor: cada "microfone" ouve a mesma cena com ganho, filtro, eco, ruído e relógio próprios.

export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function scene(seconds, sr, seed = 7) {
  const rand = rng(seed)
  const n = Math.floor(seconds * sr)
  const out = new Float32Array(n)
  const nyq = sr / 2
  let t = 0
  while (t < n) {
    // trecho de fala
    const talk = Math.floor((2 + rand() * 6) * sr)
    const end = Math.min(n, t + talk)
    while (t < end) {
      const syl = Math.floor((0.09 + rand() * 0.17) * sr)
      const f = Math.min(nyq * 0.8, 250 + rand() * 1500)
      const r = 0.985
      const w = (2 * Math.PI * f) / sr
      const c1 = 2 * r * Math.cos(w)
      const c2 = -r * r
      const amp = 0.15 + rand() * 0.45
      let y1 = 0
      let y2 = 0
      for (let i = 0; i < syl && t + i < n; i++) {
        const x = rand() * 2 - 1
        const y = x + c1 * y1 + c2 * y2
        y2 = y1
        y1 = y
        const env = Math.sin((Math.PI * i) / syl) ** 2
        out[t + i] += y * env * amp * 0.08
      }
      t += syl + Math.floor((0.03 + rand() * 0.09) * sr)
    }
    // palma de vez em quando
    if (rand() < 0.25 && t < n) {
      const len = Math.floor(0.012 * sr)
      for (let i = 0; i < len && t + i < n; i++) out[t + i] += (rand() * 2 - 1) * 0.9 * Math.exp((-i / len) * 4)
    }
    t += Math.floor((0.3 + rand() * 1.7) * sr)
  }
  return out
}

/** O que um microfone ouve: ganho, passa-baixa simples, eco curto e ruído próprio. */
export function mic(src, sr, { gain = 1, lowpass = 0, echoMs = 0, echo = 0, noise = 0.005, seed = 3 } = {}) {
  const rand = rng(seed)
  const out = new Float32Array(src.length)
  const ed = Math.round((echoMs / 1000) * sr)
  let lp = 0
  for (let i = 0; i < src.length; i++) {
    let x = src[i]
    if (ed && i >= ed) x += echo * src[i - ed]
    lp = lowpass ? lp + (1 - lowpass) * (x - lp) : x
    out[i] = lp * gain + (rand() * 2 - 1) * noise
  }
  return out
}

/** Trecho [start, start+dur) do sinal, com relógio que corre `rate` vezes (deriva) e interpolação linear. */
export function cut(sig, sr, start, dur, rate = 1) {
  const n = Math.floor(dur * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = start * sr + i * rate
    const k = Math.floor(x)
    const f = x - k
    const a = sig[k] || 0
    const b = sig[k + 1] || 0
    out[i] = a + (b - a) * f
  }
  return out
}

/** WAV PCM 16 bits mono (para o projeto de exemplo), com bext opcional (timecode) e iXML. */
export function wav(sig, sr, { timeRef = 0, originator = '', ixml = '' } = {}) {
  const data = sig.length * 2
  const bextLen = originator || timeRef ? 602 : 0
  const ix = ixml ? new TextEncoder().encode(ixml) : null
  const ixLen = ix ? ix.length + (ix.length & 1) : 0
  const size = 12 + 24 + (bextLen ? 8 + bextLen : 0) + (ix ? 8 + ixLen : 0) + 8 + data
  const b = new Uint8Array(size)
  const dv = new DataView(b.buffer)
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i)
  }
  str(0, 'RIFF')
  dv.setUint32(4, size - 8, true)
  str(8, 'WAVE')
  let o = 12
  str(o, 'fmt ')
  dv.setUint32(o + 4, 16, true)
  dv.setUint16(o + 8, 1, true)
  dv.setUint16(o + 10, 1, true)
  dv.setUint32(o + 12, sr, true)
  dv.setUint32(o + 16, sr * 2, true)
  dv.setUint16(o + 20, 2, true)
  dv.setUint16(o + 22, 16, true)
  o += 24
  if (bextLen) {
    str(o, 'bext')
    dv.setUint32(o + 4, bextLen, true)
    str(o + 8 + 256, originator.slice(0, 32))
    dv.setUint32(o + 8 + 338, timeRef % 4294967296, true)
    dv.setUint32(o + 8 + 342, Math.floor(timeRef / 4294967296), true)
    dv.setUint16(o + 8 + 346, 1, true)
    o += 8 + bextLen
  }
  if (ix) {
    str(o, 'iXML')
    dv.setUint32(o + 4, ix.length, true)
    b.set(ix, o + 8)
    o += 8 + ixLen
  }
  str(o, 'data')
  dv.setUint32(o + 4, data, true)
  o += 8
  for (let i = 0; i < sig.length; i++) {
    const v = Math.max(-1, Math.min(1, sig[i]))
    dv.setInt16(o + i * 2, Math.round(v * 32767), true)
  }
  return b
}
