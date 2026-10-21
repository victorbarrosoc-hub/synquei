// Motor de sincronização do Synquei. Funções puras (rodam no Worker e no Node):
//
// 1. Cada clipe vira uma curva de "ataques" a 100 Hz (onde o som começa: palavras, palmas, batidas).
// 2. O clipe mais longo é a âncora. Os já posicionados formam uma trilha composta; cada clipe pendente é
//    comparado com ela por correlação cruzada (FFT por blocos). Os de maior confiança entram primeiro, a trilha
//    cresce e a rodada seguinte acha quem só se sobrepunha aos recém-chegados (câmera B que só pega a câmera A).
// 3. O pico é refinado na forma de onda a 4 kHz contra o clipe vizinho de maior sobreposição, com interpolação.
// 4. Clipes longos são medidos no começo e no fim: se o relógio deriva, a diferença vira ppm e o clipe é alinhado
//    pelo meio (o erro máximo cai pela metade).
// Timecode e data entram só como pista: estreitam a busca, nunca decidem sozinhos quando o áudio fala.

import { xcorr } from './fft.js'

export const SR = 4000
export const FR = 100
export const HOP = SR / FR

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Curva de ataques a 100 Hz, ponderada pelo volume e padronizada. */
export function onset(sig) {
  const n = Math.floor(sig.length / HOP)
  const e = new Float32Array(n)
  let prev = 0
  for (let t = 0; t < n; t++) {
    let s = 0
    const o = t * HOP
    for (let i = 0; i < HOP; i++) {
      const x = sig[o + i]
      const y = x - 0.97 * prev
      prev = x
      s += y * y
    }
    e[t] = Math.log(1e-9 + s / HOP)
  }
  if (n < 3) return new Float32Array(n)
  const sorted = Float32Array.from(e).sort()
  const p20 = sorted[Math.floor(n * 0.2)]
  const p97 = sorted[Math.floor(n * 0.97)]
  const span = Math.max(1e-3, p97 - p20)
  const d = new Float32Array(n)
  for (let t = 1; t < n; t++) {
    const w = clamp01((e[t] - p20) / span)
    d[t] = Math.max(0, e[t] - e[t - 1]) * w
  }
  // tira a média local (meio segundo) e padroniza
  const W = 25
  const pre = new Float64Array(n + 1)
  for (let t = 0; t < n; t++) pre[t + 1] = pre[t] + d[t]
  const out = new Float32Array(n)
  for (let t = 0; t < n; t++) {
    const a = Math.max(0, t - W)
    const b = Math.min(n, t + W + 1)
    out[t] = d[t] - (pre[b] - pre[a]) / (b - a)
  }
  let m2 = 0
  for (let t = 0; t < n; t++) m2 += out[t] * out[t]
  const sd = Math.sqrt(m2 / n) || 1
  for (let t = 0; t < n; t++) out[t] = Math.max(-4, Math.min(8, out[t] / sd))
  return out
}

/** Energia (RMS) do sinal em blocos de 1 s, para escolher a melhor janela de refinamento. */
function blockEnergy(sig, a, b) {
  const blocks = []
  for (let p = a; p < b; p += SR) {
    let s = 0
    const e = Math.min(b, p + SR)
    for (let i = p; i < e; i++) s += sig[i] * sig[i]
    blocks.push(s)
  }
  return blocks
}

/**
 * Refina o deslocamento d (segundos; u começa d depois de p) na forma de onda.
 * @returns {{ d:number, r:number } | null}
 */
export function refine(uSig, pSig, d, search = 0.06, maxWin = 20, region = null) {
  const lu = uSig.length
  const lp = pSig.length
  const D = Math.round(d * SR)
  const S = Math.round(search * SR)
  // sobreposição em amostras de u
  let a = Math.max(0, -D + S)
  let b = Math.min(lu, lp - D - S)
  if (region) {
    a = Math.max(a, Math.round(region[0] * SR))
    b = Math.min(b, Math.round(region[1] * SR))
  }
  if (b - a < SR * 0.8) return null
  const W = Math.min(b - a, Math.round(maxWin * SR))
  // janela de W com mais energia dentro de [a, b)
  const blocks = blockEnergy(uSig, a, b)
  const nb = Math.max(1, Math.round(W / SR))
  let best = 0
  let bestE = -1
  let acc = 0
  for (let i = 0; i < blocks.length; i++) {
    acc += blocks[i]
    if (i >= nb) acc -= blocks[i - nb]
    if (i >= nb - 1 && acc > bestE) {
      bestE = acc
      best = i - nb + 1
    }
  }
  const a0 = Math.min(a + best * SR, b - W)
  // cópias com pré-ênfase
  const uu = new Float32Array(W)
  for (let i = 0; i < W; i++) uu[i] = uSig[a0 + i] - 0.97 * (a0 + i > 0 ? uSig[a0 + i - 1] : 0)
  const pa = a0 + D - S
  const pl = W + 2 * S
  const pp = new Float32Array(pl)
  for (let i = 0; i < pl; i++) {
    const k = pa + i
    pp[i] = k >= 1 && k < lp ? pSig[k] - 0.97 * pSig[k - 1] : 0
  }
  let eu = 0
  for (let i = 0; i < W; i++) eu += uu[i] * uu[i]
  // energia deslizante de p
  const pre = new Float64Array(pl + 1)
  for (let i = 0; i < pl; i++) pre[i + 1] = pre[i] + pp[i] * pp[i]
  const rs = new Float32Array(2 * S + 1)
  for (let l = 0; l <= 2 * S; l++) {
    let s = 0
    for (let i = 0; i < W; i++) s += uu[i] * pp[i + l]
    const ep = pre[l + W] - pre[l]
    rs[l] = s / Math.sqrt(eu * ep + 1e-12)
  }
  let li = 0
  for (let l = 1; l <= 2 * S; l++) if (rs[l] > rs[li]) li = l
  let frac = 0
  if (li > 0 && li < 2 * S) {
    const y0 = rs[li - 1]
    const y1 = rs[li]
    const y2 = rs[li + 1]
    const den = y0 - 2 * y1 + y2
    if (den < 0) frac = (0.5 * (y0 - y2)) / den
  }
  const edge = li === 0 || li === 2 * S
  return { d: (D - S + li + frac) / SR, r: rs[li], edge }
}

/** Trilha composta dos clipes posicionados (ataques somados, normalizados pela quantidade). */
function composite(placed, byId) {
  let start = Infinity
  let end = -Infinity
  for (const [id, p] of placed) {
    const it = byId.get(id)
    if (!it.feat) continue
    const s = Math.round(p.pos * FR)
    start = Math.min(start, s)
    end = Math.max(end, s + it.feat.length)
  }
  if (!isFinite(start)) return null
  const len = end - start
  const data = new Float32Array(len)
  const count = new Uint16Array(len)
  for (const [id, p] of placed) {
    const it = byId.get(id)
    if (!it.feat) continue
    const s = Math.round(p.pos * FR) - start
    const f = it.feat
    for (let i = 0; i < f.length; i++) {
      data[s + i] += f[i]
      count[s + i]++
    }
  }
  for (let i = 0; i < len; i++) if (count[i] > 1) data[i] /= Math.sqrt(count[i])
  return { start, data }
}

/** Correlaciona o clipe com a trilha composta e devolve os melhores picos (posição em segundos). */
export function coarse(feat, comp, hint) {
  const lc = comp.data.length
  const lu = feat.length
  if (lu < FR * 1.5 || lc < FR * 1.5) return null
  const r = xcorr(comp.data, feat)
  // energias para normalizar: prefixos de comp² e de feat²
  const pc = new Float64Array(lc + 1)
  for (let i = 0; i < lc; i++) pc[i + 1] = pc[i] + comp.data[i] * comp.data[i]
  let eu = 0
  for (let i = 0; i < lu; i++) eu += feat[i] * feat[i]
  const minOv = Math.max(FR * 2, Math.min(lu * 0.25, FR * 5))
  // faixa válida de k (posição do começo do clipe dentro da composta)
  let kLo = -(lu - 1)
  let kHi = lc - 1
  if (hint) {
    kLo = Math.max(kLo, Math.round((hint.pos - hint.window) * FR) - comp.start)
    kHi = Math.min(kHi, Math.round((hint.pos + hint.window) * FR) - comp.start)
  }
  if (kHi < kLo) return null
  const meanE = pc[lc] / lc
  const score = new Float32Array(kHi - kLo + 1)
  for (let k = kLo; k <= kHi; k++) {
    const a = Math.max(0, k)
    const b = Math.min(lc, k + lu)
    const ov = b - a
    let v = 0
    if (ov >= minOv) {
      const ec = pc[b] - pc[a] + meanE * FR * 2
      v = r[k + lu - 1] / Math.sqrt(ec * eu + 1e-9)
    }
    score[k - kLo] = v
  }
  // estatística robusta do "chão" de correlação
  const sample = []
  const st = Math.max(1, Math.floor(score.length / 20000))
  for (let i = 0; i < score.length; i += st) if (score[i] !== 0) sample.push(score[i])
  if (sample.length < 10) {
    for (let i = 0; i < score.length; i += st) sample.push(score[i])
  }
  sample.sort((x, y) => x - y)
  const med = sample[Math.floor(sample.length / 2)] || 0
  const dev = sample.map((x) => Math.abs(x - med)).sort((x, y) => x - y)
  const mad = (dev[Math.floor(dev.length / 2)] || 1e-6) * 1.4826 + 1e-6
  // picos separados por pelo menos 1 s
  const peaks = []
  const used = new Uint8Array(score.length)
  for (let q = 0; q < 6; q++) {
    let bi = -1
    for (let i = 0; i < score.length; i++) if (!used[i] && (bi < 0 || score[i] > score[bi])) bi = i
    if (bi < 0 || score[bi] <= med) break
    peaks.push({ pos: (comp.start + kLo + bi) / FR, score: score[bi], z: (score[bi] - med) / mad })
    for (let i = Math.max(0, bi - FR); i <= Math.min(score.length - 1, bi + FR); i++) used[i] = 1
  }
  if (!peaks.length) return null
  const ratio = peaks.length > 1 ? Math.max(0, peaks[1].score) / Math.max(1e-9, peaks[0].score) : 0
  return { peaks, ratio, med, mad }
}

/** Confiança de 0 a 1 a partir do destaque do pico, da distância para o segundo pico e da correlação fina. */
export function confidence(z, ratio, r) {
  const a = clamp01((z - 5) / 10)
  const b = clamp01((0.92 - ratio) / 0.45)
  const c = r == null ? 0.35 : clamp01(r / 0.35)
  return Math.round((0.55 * a + 0.25 * b + 0.2 * c) * 100) / 100
}

/** Um grupo: a partir do clipe mais longo, junta todos que se ligam pelo áudio (direta ou indiretamente). */
function solveGroup(audible, byId, opts, report, doneBefore, totalAll) {
  const minConf = opts.minConf ?? 0.4
  const anchor = audible.slice().sort((a, b) => b.dur - a.dur)[0]
  const placed = new Map([[anchor.id, { pos: 0, conf: 1, z: null, ratio: 0, r: 1, refId: null, method: 'audio' }]])
  let pending = audible.filter((it) => it !== anchor)

  const overlapsDevice = (u, pos) => {
    for (const [id, p] of placed) {
      const q = byId.get(id)
      if (q.device !== u.device || id === u.id) continue
      const ov = Math.min(pos + u.dur, p.pos + q.dur) - Math.max(pos, p.pos)
      if (ov > 1) return true
      if (opts.chronological && u.order != null && q.order != null) {
        if (u.order > q.order && pos < p.pos) return true
        if (u.order < q.order && pos > p.pos) return true
      }
    }
    return false
  }

  const hintFor = (u) => {
    const offs = []
    let near = Infinity
    if (u.tc != null) {
      for (const [id, p] of placed) {
        const q = byId.get(id)
        if (q.tc == null || (!opts.sharedTC && q.device !== u.device)) continue
        offs.push(p.pos - q.tc)
        near = Math.min(near, Math.abs(u.tc - q.tc))
      }
      if (offs.length) {
        offs.sort((a, b) => a - b)
        return { pos: u.tc + offs[Math.floor(offs.length / 2)], window: 3 + 0.002 * near, kind: 'tc' }
      }
    }
    if (opts.useDate !== false && u.created != null) {
      for (const [id, p] of placed) {
        const q = byId.get(id)
        if (q.created == null || q.device !== u.device) continue
        offs.push(p.pos - q.created / 1000)
        near = Math.min(near, Math.abs(u.created - q.created) / 1000)
      }
      if (offs.length) {
        offs.sort((a, b) => a - b)
        return { pos: u.created / 1000 + offs[Math.floor(offs.length / 2)], window: 30 + 0.002 * near, kind: 'date' }
      }
    }
    return null
  }

  /** Clipe posicionado com mais sobreposição com u (com áudio), para o refinamento. */
  const bestRef = (u, pos) => {
    let best = null
    let bo = 0
    for (const [id, p] of placed) {
      const q = byId.get(id)
      if (!q.sig || id === u.id) continue
      const ov = Math.min(pos + u.dur, p.pos + q.dur) - Math.max(pos, p.pos)
      if (ov > bo) {
        bo = ov
        best = { q, p }
      }
    }
    return best
  }

  let round = 0
  while (pending.length && round < 10) {
    round++
    const comp = composite(placed, byId)
    const cands = []
    for (const u of pending) {
      const hint = hintFor(u)
      let res = coarse(u.feat, comp, hint)
      // pista errada (timecode não batido, relógio torto): tenta a busca completa
      if (hint && (!res || res.peaks[0].z < 8)) {
        const full = coarse(u.feat, comp, null)
        if (full && (!res || full.peaks[0].z > res.peaks[0].z + 2)) res = full
      }
      if (!res) continue
      const pk = res.peaks.find((p) => !overlapsDevice(u, p.pos))
      if (!pk) continue
      cands.push({ u, pos: pk.pos, z: pk.z, ratio: res.peaks[0] === pk ? res.ratio : 1, hint })
    }
    cands.sort((a, b) => b.z - a.z)
    let gained = 0
    for (const pass of [Math.max(minConf, 0.6), minConf]) {
      for (const c of cands) {
        if (placed.has(c.u.id)) continue
        if (overlapsDevice(c.u, c.pos)) continue
        const ref = bestRef(c.u, c.pos)
        let pos = c.pos
        let r = null
        let refId = null
        if (ref && c.u.sig) {
          const f = refine(c.u.sig, ref.q.sig, c.pos - ref.p.pos, 0.06)
          if (f && !f.edge && f.r > 0.03) {
            pos = ref.p.pos + f.d
            r = f.r
          }
          refId = ref.q.id
        }
        const conf = confidence(c.z, c.ratio, r)
        if (conf < pass) continue
        placed.set(c.u.id, { pos, conf, z: Math.round(c.z * 10) / 10, ratio: Math.round(c.ratio * 100) / 100, r: r == null ? null : Math.round(r * 1000) / 1000, refId, method: 'audio', hint: c.hint ? c.hint.kind : null })
        gained++
      }
      if (gained) break
    }
    pending = pending.filter((u) => !placed.has(u.id))
    report({ phase: 'match', done: doneBefore + audible.length - pending.length, total: totalAll, round })
    if (!gained) break
  }
  return { placed, anchorId: anchor.id }
}

/**
 * Sincroniza todos os itens.
 * items: [{ id, device, dur, sig?, feat?, tc?, created?, order? }]
 * opts: { sharedTC, useDate, chronological, minConf, drift, onProgress }
 * @returns {{ placed: Object<string, {pos, conf, z, ratio, r, refId, method, drift?, join?}>, anchorId, islands: Array<{ anchorId, placed }>, unplaced: string[] }}
 */
export function syncAll(items, opts = {}) {
  const report = opts.onProgress || (() => {})
  const byId = new Map(items.map((it) => [it.id, it]))
  for (const it of items) if (it.sig && !it.feat) it.feat = onset(it.sig)
  let remaining = items.filter((it) => it.feat && it.feat.length > FR * 1.5)
  const out = { placed: {}, anchorId: null, islands: [], unplaced: [] }
  if (!remaining.length) {
    out.unplaced = items.map((i) => i.id)
    return out
  }
  const totalAll = remaining.length
  // grupos ligados pelo áudio; um clipe sozinho não é grupo
  const groups = []
  let done = 0
  while (remaining.length > 1) {
    const g = solveGroup(remaining, byId, opts, report, done, totalAll)
    if (g.placed.size < 2) {
      // a âncora não casou com ninguém: sai da fila e tenta o próximo mais longo
      remaining = remaining.filter((it) => it.id !== g.anchorId)
      continue
    }
    groups.push(g)
    done += g.placed.size
    remaining = remaining.filter((it) => !g.placed.has(it.id))
  }
  if (!groups.length) {
    out.unplaced = items.map((i) => i.id)
    return out
  }
  groups.sort((a, b) => groupDur(b, byId) - groupDur(a, byId))
  const main = groups[0]
  out.anchorId = main.anchorId
  // ilhas: encaixa pelo timecode (ou pela data) de um mesmo aparelho presente nos dois grupos
  for (const g of groups.slice(1)) {
    const j = joinOffset(main.placed, g.placed, byId, opts)
    if (j) {
      for (const [id, p] of g.placed) main.placed.set(id, { ...p, pos: p.pos + j.offset, join: j.kind, island: true })
    } else out.islands.push({ anchorId: g.anchorId, placed: g.placed })
  }
  const placed = main.placed
  // deriva: compara começo e fim da sobreposição com a referência
  if (opts.drift !== false) {
    for (const [id, p] of placed) {
      if (!p.refId) continue
      const u = byId.get(id)
      const q = byId.get(p.refId)
      const rp = placed.get(p.refId)
      if (!u.sig || !q.sig || !rp) continue
      const d0 = p.pos - rp.pos
      const a = Math.max(0, -d0)
      const b = Math.min(u.dur, q.dur - d0)
      if (b - a < 150) continue
      const w = 20
      const f1 = refine(u.sig, q.sig, d0, 0.25, w, [a, a + w + 1])
      const f2 = refine(u.sig, q.sig, d0, 0.25, w, [b - w - 1, b])
      if (!f1 || !f2 || f1.edge || f2.edge || f1.r < 0.08 || f2.r < 0.08) continue
      const t1 = a + w / 2
      const t2 = b - w / 2
      const ppm = ((f2.d - f1.d) / (t2 - t1)) * 1e6
      if (Math.abs(ppm) < 4) continue
      const mid = u.dur / 2
      const dMid = f1.d + ((f2.d - f1.d) * (mid - t1)) / (t2 - t1)
      p.drift = { ppm: Math.round(ppm * 10) / 10, startErr: Math.round((f1.d - d0) * 1e4) / 1e4, endErr: Math.round((f2.d - d0) * 1e4) / 1e4 }
      p.pos = rp.pos + dMid
    }
  }

  for (const [id, p] of placed) out.placed[id] = p
  const inIsland = new Set(out.islands.flatMap((g) => [...g.placed.keys()]))
  out.islands = out.islands.map((g) => ({ anchorId: g.anchorId, placed: Object.fromEntries(g.placed) }))
  out.unplaced = items.filter((it) => !placed.has(it.id) && !inIsland.has(it.id)).map((it) => it.id)
  return out
}

function groupDur(g, byId) {
  let s = 0
  for (const id of g.placed.keys()) s += byId.get(id).dur
  return s
}

/** Deslocamento que leva o grupo g para a linha do tempo principal, por timecode ou data do mesmo aparelho. */
function joinOffset(mainPlaced, gPlaced, byId, opts) {
  for (const kind of ['tc', 'date']) {
    if (kind === 'date' && opts.useDate === false) continue
    const offs = []
    for (const [gid, gp] of gPlaced) {
      const u = byId.get(gid)
      const ut = kind === 'tc' ? u.tc : u.created != null ? u.created / 1000 : null
      if (ut == null) continue
      for (const [mid, mp] of mainPlaced) {
        const q = byId.get(mid)
        const qt = kind === 'tc' ? q.tc : q.created != null ? q.created / 1000 : null
        if (qt == null) continue
        if (q.device !== u.device && !(kind === 'tc' && opts.sharedTC)) continue
        offs.push(mp.pos - qt - (gp.pos - ut))
      }
    }
    if (offs.length) {
      offs.sort((a, b) => a - b)
      return { offset: offs[Math.floor(offs.length / 2)], kind }
    }
  }
  return null
}
