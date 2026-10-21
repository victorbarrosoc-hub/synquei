// FFT complexa radix-2 in-place, com tabelas em cache por tamanho.

const cache = new Map()

function tables(n) {
  let t = cache.get(n)
  if (t) return t
  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let x = i
    let y = 0
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = y
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = Math.sin((2 * Math.PI * i) / n)
  }
  t = { rev, cos, sin }
  if (cache.size > 8) cache.clear()
  cache.set(n, t)
  return t
}

export const nextPow2 = (x) => 2 ** Math.ceil(Math.log2(Math.max(2, x)))

/** Transformada in-place. inverse=true divide por n. */
export function fft(re, im, inverse = false) {
  const n = re.length
  const { rev, cos, sin } = tables(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const sg = inverse ? 1 : -1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const c = cos[w]
        const s = sg * sin[w]
        const a = start + k
        const b = a + half
        const xr = re[b] * c - im[b] * s
        const xi = re[b] * s + im[b] * c
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

/**
 * Correlação cruzada linear r[j] = Σ a[j - (lb-1) + n]·b[n], j = 0 … la+lb-2, por blocos (overlap-save),
 * processando dois blocos por FFT (parte real e imaginária).
 */
export function xcorr(a, b) {
  const la = a.length
  const lb = b.length
  const outLen = la + lb - 1
  const out = new Float32Array(outLen)
  const N = Math.max(1 << 14, nextPow2(lb * 4))
  const step = N - lb + 1
  // espectro conjugado de b
  const br = new Float64Array(N)
  const bi = new Float64Array(N)
  for (let i = 0; i < lb; i++) br[i] = b[i]
  fft(br, bi)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const starts = []
  for (let s = -(lb - 1); s < la; s += step) starts.push(s)
  for (let q = 0; q < starts.length; q += 2) {
    const s1 = starts[q]
    const s2 = q + 1 < starts.length ? starts[q + 1] : null
    for (let i = 0; i < N; i++) {
      const i1 = s1 + i
      re[i] = i1 >= 0 && i1 < la ? a[i1] : 0
      const i2 = s2 == null ? -1 : s2 + i
      im[i] = i2 >= 0 && i2 < la ? a[i2] : 0
    }
    fft(re, im)
    for (let i = 0; i < N; i++) {
      // (re + i·im) · conj(br + i·bi)
      const xr = re[i] * br[i] + im[i] * bi[i]
      const xi = im[i] * br[i] - re[i] * bi[i]
      re[i] = xr
      im[i] = xi
    }
    fft(re, im, true)
    for (let k = 0; k < step; k++) {
      const j1 = s1 + k + (lb - 1)
      if (j1 >= 0 && j1 < outLen) out[j1] = re[k]
      if (s2 != null) {
        const j2 = s2 + k + (lb - 1)
        if (j2 >= 0 && j2 < outLen) out[j2] = im[k]
      }
    }
  }
  return out
}
