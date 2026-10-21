// Frame rates, timecode e frações de segundo. Usado pela leitura dos arquivos e por todas as exportações.

export const STD_RATES = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 48000, den: 1001 },
  { num: 48, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
  { num: 100, den: 1 },
  { num: 120000, den: 1001 },
  { num: 120, den: 1 },
  { num: 15, den: 1 },
  { num: 12, den: 1 },
]

/** Aproxima um fps qualquer (23.98, 29.970029…) do padrão mais perto. */
export function snapRate(fps) {
  if (!fps || !isFinite(fps) || fps <= 0) return null
  let best = null
  let err = Infinity
  for (const r of STD_RATES) {
    const e = Math.abs(r.num / r.den - fps) / fps
    if (e < err) {
      err = e
      best = r
    }
  }
  if (err < 0.002) return { ...best }
  return { num: Math.round(fps * 1000), den: 1000 }
}

export const rateFps = (r) => r.num / r.den
export const nominal = (r) => Math.round(r.num / r.den)
export const isNtsc = (r) => r.den === 1001

/** Nome curto: 23.976, 25, 29.97… */
export function rateLabel(r) {
  if (!r) return '—'
  const f = r.num / r.den
  if (r.den === 1001) return { 24: '23.976', 30: '29.97', 48: '47.952', 60: '59.94', 120: '119.88' }[Math.round(f)] || f.toFixed(3)
  return Number.isInteger(f) ? String(f) : f.toFixed(3).replace(/0+$/, '')
}

/** Rate a partir do texto da interface ("23.976", "29.97"…). */
export function parseRate(s) {
  const v = parseFloat(String(s).replace(',', '.'))
  return snapRate(v)
}

// ───────── timecode ─────────

/** Número de quadro (contagem real) → rótulo de timecode. Drop frame só em 29.97/59.94. */
export function framesToTc(frames, rate, drop = false) {
  const fps = nominal(rate)
  let f = Math.round(frames)
  const neg = f < 0
  if (neg) f = -f
  const dayFrames = fps * 86400
  if (drop && (fps === 30 || fps === 60)) {
    const d = fps === 30 ? 2 : 4
    const per10 = fps * 600 - d * 9
    const per1 = fps * 60 - d
    const tens = Math.floor(f / per10)
    let rem = f % per10
    f += d * 9 * tens
    if (rem > d) f += d * Math.floor((rem - d) / per1)
  }
  f = f % dayFrames
  const ff = f % fps
  const s = Math.floor(f / fps)
  const sep = drop && (fps === 30 || fps === 60) ? ';' : ':'
  const p = (n) => String(n).padStart(2, '0')
  return `${neg ? '-' : ''}${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}${sep}${p(ff)}`
}

/** Rótulo de timecode → número de quadro (contagem real). */
export function tcToFrames(tc, rate, drop = false) {
  const m = String(tc).trim().match(/^(-)?(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.,](\d{2,3})$/)
  if (!m) return null
  const fps = nominal(rate)
  const [h, mi, s, f] = [+m[2], +m[3], +m[4], +m[5]]
  let total = ((h * 60 + mi) * 60 + s) * fps + f
  if (drop && (fps === 30 || fps === 60)) {
    const d = fps === 30 ? 2 : 4
    const mins = h * 60 + mi
    total -= d * (mins - Math.floor(mins / 10))
  }
  return m[1] ? -total : total
}

/** Segundos do "relógio" do timecode (o rótulo, não o tempo real) → texto. */
export function secondsToTc(sec, rate, drop = false) {
  return framesToTc(labelSecondsToFrames(sec, rate, drop), rate, drop)
}

/** Segundos do rótulo (HH:MM:SS + quadros/fps nominal) ↔ quadros. É como os aparelhos com TC batido se entendem. */
export function labelSecondsToFrames(sec, rate, drop = false) {
  const fps = nominal(rate)
  if (!drop) return Math.round(sec * fps)
  // drop frame: o rótulo segue o relógio de parede; a contagem real é tempo × 29.97
  return Math.round(sec * rateFps(rate))
}
export function framesToLabelSeconds(frames, rate, drop = false) {
  return drop ? frames / rateFps(rate) : frames / nominal(rate)
}

/** Duração legível: 1:02:03, 4:05, 0:12. */
export function duration(sec) {
  if (sec == null || !isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Deslocamento com sinal e precisão: +12,345 s ou −0,042 s. */
export function offsetLabel(sec) {
  if (sec == null || !isFinite(sec)) return '—'
  const sign = sec < 0 ? '−' : '+'
  return `${sign}${Math.abs(sec).toFixed(3).replace('.', ',')} s`
}

// ───────── frações (FCPXML e OTIO) ─────────

const gcd = (a, b) => {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

export class Rat {
  constructor(n, d = 1) {
    if (d < 0) {
      n = -n
      d = -d
    }
    const g = gcd(n, d)
    this.n = n / g
    this.d = d / g
  }
  static of(sec, den) {
    return new Rat(Math.round(sec * den), den)
  }
  add(o) {
    return new Rat(this.n * o.d + o.n * this.d, this.d * o.d)
  }
  sub(o) {
    return new Rat(this.n * o.d - o.n * this.d, this.d * o.d)
  }
  mul(k) {
    return new Rat(this.n * k, this.d)
  }
  get value() {
    return this.n / this.d
  }
  /** Formato do FCPXML: "1001/24000s", "0s", "5s". */
  fcp() {
    if (this.n === 0) return '0s'
    return this.d === 1 ? `${this.n}s` : `${this.n}/${this.d}s`
  }
}

/** Duração de quadro como fração. */
export const frameDur = (rate) => new Rat(rate.den, rate.num)

/** Segundos → quadros inteiros dessa rate (arredonda). */
export const secToFrames = (sec, rate) => Math.round((sec * rate.num) / rate.den)
export const framesToSec = (frames, rate) => (frames * rate.den) / rate.num
