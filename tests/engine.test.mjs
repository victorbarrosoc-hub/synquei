import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scene, mic, cut } from '../app/js/sync/synth.js'
import { syncAll, SR, onset, refine } from '../app/js/sync/engine.js'

// Cena de 12 minutos: gravador ligado o tempo todo, duas câmeras com cortes, uma terceira que só se sobrepõe à câmera B.
const DUR = 12 * 60
const sc = scene(DUR, SR, 11)
const rec = mic(sc, SR, { gain: 0.9, noise: 0.004, seed: 1 })
const camA = mic(sc, SR, { gain: 0.5, lowpass: 0.6, echoMs: 23, echo: 0.35, noise: 0.02, seed: 2 })
const camB = mic(sc, SR, { gain: 1.3, lowpass: 0.3, echoMs: 41, echo: 0.25, noise: 0.03, seed: 3 })
const camC = mic(sc, SR, { gain: 0.7, lowpass: 0.75, noise: 0.025, seed: 4 })

const truth = {}
const items = []
// relógio de cada aparelho (data do arquivo) e o arredondamento de 1 s da data
const CLOCK = { REC: 3.2, A: -12, B: 7, C: 0 }
const add = (id, device, sig, start, dur, rate = 1) => {
  truth[id] = start
  const created = Math.round((1.7e9 + start + CLOCK[device]) * 1000 / 1000) * 1000
  items.push({ id, device, sig: cut(sig, SR, start, dur, rate), dur, created })
}
add('rec1', 'REC', rec, 10.0, 6 * 60)
add('rec2', 'REC', rec, 10.0 + 6 * 60 + 0.5, 5 * 60)
add('A1', 'A', camA, 35.237, 140)
add('A2', 'A', camA, 200.111, 95)
add('A3', 'A', camA, 400.9, 260, 1 + 60e-6) // relógio adiantado 60 ppm
add('B1', 'B', camB, 60.5, 300)
add('B2', 'B', camB, 500.0, 120)
// C só existe antes do gravador ligar, sobrepondo a câmera B? não: ela começa antes do gravador e se sobrepõe a B
add('C1', 'C', camC, 2.0, 70)

test('sincroniza todos os clipes com erro abaixo de 1 ms (ilha encaixada pela data)', () => {
  const res = syncAll(items, { minConf: 0.35, chronological: true })
  assert.equal(res.unplaced.length, 0, 'sem clipes de fora: ' + res.unplaced.join(','))
  assert.equal(res.islands.length, 0, 'ilha deveria encaixar pela data')
  const a = res.anchorId
  // a ilha (rec2, A3, B2) entra pela data: precisão de segundo em relação ao resto, de amostra entre si
  const isl = ['rec2', 'A3', 'B2']
  for (const id of isl) assert.equal(res.placed[id].join, 'date', id + ' encaixado pela data')
  const shift = res.placed.rec2.pos - (truth.rec2 - truth[a])
  assert.ok(Math.abs(shift) < 1.5, `ilha deslocada ${shift} s`)
  for (const it of items) {
    const p = res.placed[it.id]
    // A3 deriva 60 ppm: o motor alinha pelo meio do clipe, então o começo fica dur/2 × 60 ppm adiante
    const mid = it.id === 'A3' ? (it.dur / 2) * 60e-6 : 0
    const expect = truth[it.id] - truth[a] + (isl.includes(it.id) ? shift : 0) + mid
    const err = Math.abs(p.pos - expect)
    const tol = 0.001
    assert.ok(err < tol, `${it.id}: esperado ${expect.toFixed(4)}, veio ${p.pos.toFixed(4)} (erro ${(err * 1000).toFixed(2)} ms, conf ${p.conf})`)
    assert.ok(p.conf >= 0.5, `${it.id}: confiança ${p.conf}`)
  }
  const d = res.placed.A3.drift
  assert.ok(d && Math.abs(Math.abs(d.ppm) - 60) < 15, `deriva medida em A3: ${d && d.ppm}`)
})

test('clipe de outra cena fica de fora', () => {
  const other = scene(90, SR, 999)
  const res = syncAll([...items.slice(0, 3), { id: 'X', device: 'X', sig: mic(other, SR, { seed: 9 }), dur: 90 }], { minConf: 0.35 })
  assert.ok(res.unplaced.includes('X'), 'X não deveria entrar: ' + JSON.stringify(res.placed.X))
})

test('refinamento acha atraso de fração de amostra', () => {
  const s = rec.subarray(0, SR * 30)
  const u = cut(rec, SR, 5.00013, 15)
  const f = refine(u, s, 5.0, 0.06)
  assert.ok(Math.abs(f.d - 5.00013) < 0.00005, `d=${f.d}`)
})

test('curva de ataques tem a duração certa', () => {
  assert.equal(onset(new Float32Array(SR * 2)).length, 200)
})
