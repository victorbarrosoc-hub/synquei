// Sons da interface, sintetizados na hora (Web Audio, sem arquivos): curtos, baixos e com sentido. Soltar arquivos,
// clipe encaixando, sincronia pronta, exportação baixada, erro. Desliga nos Ajustes; volume também.

const KEY = 'synquei:sons'
let ctx = null
let master = null
let last = {}

function prefs() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && typeof v === 'object') return { on: v.on !== false, vol: typeof v.vol === 'number' ? v.vol : 0.6 }
  } catch {}
  return { on: true, vol: 0.6 }
}
let P = prefs()

export function soundPrefs() {
  return { ...P }
}
export function setSoundPrefs(next) {
  P = { ...P, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify(P))
  } catch {}
  if (master) master.gain.value = P.vol * 0.5
}

function ac() {
  if (!P.on) return null
  const C = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!C) return null
  if (!ctx) {
    try {
      ctx = new C()
      master = ctx.createGain()
      master.gain.value = P.vol * 0.5
      master.connect(ctx.destination)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Não repetir o mesmo som em menos de `ms` (ticks em rajada viram um só). */
function gate(name, ms) {
  const now = performance.now()
  if (last[name] && now - last[name] < ms) return false
  last[name] = now
  return true
}

function tone(c, { f, f2 = f, at = 0, dur = 0.12, type = 'sine', gain = 0.2, attack = 0.004 }) {
  const t = c.currentTime + at
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}

function noise(c, { at = 0, dur = 0.08, gain = 0.12, freq = 2000, q = 1.2, sweep = null }) {
  const t = c.currentTime + at
  const len = Math.ceil(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(freq, t)
  if (sweep) bp.frequency.exponentialRampToValueAtTime(sweep, t + dur)
  bp.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(g).connect(master)
  src.start(t)
}

export const sfx = {
  /** arquivos soltos / adicionados */
  pop() {
    const c = ac()
    if (!c || !gate('pop', 200)) return
    tone(c, { f: 420, f2: 880, dur: 0.14, gain: 0.16 })
    noise(c, { dur: 0.03, gain: 0.05, freq: 4000 })
  },
  /** clique discreto (ajuste fino, áudio de um clipe lido) */
  tick() {
    const c = ac()
    if (!c || !gate('tick', 45)) return
    tone(c, { f: 1900, dur: 0.035, type: 'triangle', gain: 0.05 })
  },
  /** um clipe encaixou na linha do tempo */
  snap() {
    const c = ac()
    if (!c || !gate('snap', 110)) return
    tone(c, { f: 660, dur: 0.06, gain: 0.07 })
    tone(c, { f: 990, at: 0.035, dur: 0.08, gain: 0.06 })
  },
  /** começou a sincronizar */
  start() {
    const c = ac()
    if (!c || !gate('start', 500)) return
    noise(c, { dur: 0.45, gain: 0.05, freq: 300, sweep: 3200, q: 0.8 })
    tone(c, { f: 220, f2: 440, dur: 0.4, gain: 0.06, type: 'sine', attack: 0.08 })
  },
  /** sincronia pronta: arpejo maior, suave */
  done() {
    const c = ac()
    if (!c || !gate('done', 800)) return
    ;[659.25, 830.61, 987.77, 1318.5].forEach((f, i) => tone(c, { f, at: i * 0.075, dur: 0.55 - i * 0.05, gain: 0.11 - i * 0.015 }))
  },
  /** exportação baixada */
  export() {
    const c = ac()
    if (!c || !gate('export', 400)) return
    noise(c, { dur: 0.05, gain: 0.12, freq: 2400, q: 2 })
    tone(c, { f: 140, f2: 90, dur: 0.12, gain: 0.14 })
    tone(c, { f: 1320, at: 0.06, dur: 0.18, gain: 0.05 })
  },
  /** algo não deu certo */
  error() {
    const c = ac()
    if (!c || !gate('error', 600)) return
    tone(c, { f: 280, dur: 0.12, type: 'triangle', gain: 0.12 })
    tone(c, { f: 210, at: 0.13, dur: 0.18, type: 'triangle', gain: 0.12 })
  },
}
