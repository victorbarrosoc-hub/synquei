// Linha do tempo: uma faixa por aparelho, cada clipe onde o som mandou. Arrastar ajusta na mão; o inspetor mostra
// a confiança, a deriva e as duas formas de onda sobrepostas para conferir no olho.

import { S, changed, peaksOf } from '../store.js'
import { h, icon, drawPeaks, confColor, plural, $, $$ } from '../util.js'
import { devColor } from '../media/devices.js'
import { nudge, methodLabel } from '../project.js'
import { sfx } from '../sfx.js'
import { duration, offsetLabel, rateFps, snapRate } from '../time.js'
import { go } from '../main.js'

const LANE = 54
let drag = null

function session() {
  const p = S.project
  if (!p.sessions.length) return null
  const i = Math.min(S.ui.session, p.sessions.length - 1)
  return p.sessions[i]
}

function seqRate(clips) {
  const m = new Map()
  for (const c of clips) if (c.video && c.video.rate && c.kind !== 'audio') m.set(`${c.video.rate.num}/${c.video.rate.den}`, [c.video.rate, (m.get(`${c.video.rate.num}/${c.video.rate.den}`) || [0, 0])[1] + (c.duration || 1)])
  let best = null
  for (const v of m.values()) if (!best || v[1] > best[1]) best = v
  return best ? best[0] : snapRate(25)
}

function layout(clips, devices) {
  const rows = []
  for (const d of devices) {
    const list = clips.filter((c) => c.deviceId === d.id).sort((a, b) => a.sync.pos - b.sync.pos)
    if (!list.length) continue
    const lanes = []
    const place = []
    for (const c of list) {
      let li = lanes.findIndex((end) => end <= c.sync.pos + 0.01)
      if (li < 0) {
        li = lanes.length
        lanes.push(0)
      }
      lanes[li] = c.sync.pos + (c.duration || 0)
      place.push({ c, lane: li })
    }
    rows.push({ d, lanes: Math.max(1, lanes.length), place })
  }
  return rows
}

function labelFn(s, clips) {
  const ref = clips.find((c) => c.timecode && c.sync && c.sync.method !== 'date' && !c.sync.method.includes('date'))
  const pad = (n) => String(Math.floor(n)).padStart(2, '0')
  const fmt = (sec) => {
    sec = ((sec % 86400) + 86400) % 86400
    return `${pad(sec / 3600)}:${pad((sec / 60) % 60)}:${pad(sec % 60)}`
  }
  if (ref) {
    const base = ref.timecode.seconds - (ref.sync.pos - s.start)
    return { tc: true, at: (t) => fmt(base + t) }
  }
  return { tc: false, at: (t) => fmt(t) }
}

function inspector(c, rate) {
  const p = S.project
  if (!c) {
    return `<section class="card insp"><div class="insp-body"><p class="eyebrow">Inspetor</p><p class="sub">Clique num clipe para ver a confiança, a deriva e as formas de onda. Arraste para ajustar; <span class="kbd">←</span> <span class="kbd">→</span> empurram um quadro.</p>
      <div class="legend" style="margin-top:0"><span><i class="dot" style="--c:#30d158"></i>alta</span><span><i class="dot" style="--c:#ffd60a"></i>média</span><span><i class="dot" style="--c:#ff9f0a"></i>conferir</span><span><i class="dot" style="--c:#8e8e93"></i>pela data</span></div></div></section>`
  }
  const s = c.sync
  const d = p.devices.find((x) => x.id === c.deviceId)
  const ref = s.refId ? p.clips.find((x) => x.id === s.refId) : null
  const pct = Math.round(s.conf * 100)
  const fd = 1 / rateFps(rate)
  const btn = (v, l) => `<button data-act="nudge" data-v="${v}" title="${offsetLabel(v)}">${l}</button>`
  return `<section class="card insp"><div class="insp-body">
    <div><p class="eyebrow">${h(d ? d.label : 'Clipe')}</p><h3 style="font-size:16px;font-weight:600;word-break:break-all">${h(c.name)}</h3></div>
    <div class="conf"><div class="conf-top"><b style="color:${confColor(s.conf, s.method)}">${pct}%</b><span class="sub" style="font-size:12.5px">${h(methodLabel(s.method))}</span></div><div class="meter" style="--cf:${confColor(s.conf, s.method)}"><i style="--p:${pct}%"></i></div></div>
    <dl class="kv">
      <dt>Começa em</dt><dd class="mono">${offsetLabel(s.pos - session().start).replace('+', '')}</dd>
      <dt>Duração</dt><dd>${duration(c.duration)}</dd>
      ${ref ? `<dt>Comparado com</dt><dd>${h(ref.name)}</dd>` : ''}
      ${s.drift ? `<dt>Deriva</dt><dd>${s.drift.ppm} ppm <span class="muted">(${Math.round(Math.abs(s.drift.endErr - s.drift.startErr) * 1000)} ms do começo ao fim, alinhado pelo meio)</span></dd>` : ''}
      ${s.r != null ? `<dt>Correlação</dt><dd>${s.r.toFixed(2)}${s.z ? ` · destaque ${s.z}` : ''}</dd>` : ''}
    </dl>
    ${ref && S.signals.has(c.id) && S.signals.has(ref.id) ? `<div><p class="eyebrow" style="margin-bottom:6px">Formas de onda sobrepostas</p><canvas class="compare" id="compare" data-a="${ref.id}" data-b="${c.id}"></canvas></div>` : ''}
    <div><p class="eyebrow" style="margin-bottom:6px">Ajuste fino</p><div class="nudge">${btn(-fd, '−1 qd')}${btn(-0.01, '−10ms')}${btn(-0.001, '−1ms')}${btn(0.001, '+1ms')}${btn(0.01, '+10ms')}${btn(fd, '+1 qd')}</div></div>
    ${s.original != null ? `<button class="btn btn-secondary btn-sm" data-act="reset">${icon('undo')}Voltar ao automático</button>` : ''}
  </div></section>`
}

export default {
  title: 'Linha do tempo',
  render() {
    const p = S.project
    if (!p || !p.result) {
      return `<div class="page tela"><header class="page-head"><div><h1>Linha do tempo</h1></div></header><div class="empty"><h2>Ainda não sincronizado</h2><p>Depois de sincronizar, cada aparelho vira uma faixa e cada clipe aparece onde o som mandou.</p><a class="btn btn-primary" href="#/sincronizar">Ir para Sincronizar</a></div></div>`
    }
    const s = session()
    const byId = new Map(p.clips.map((c) => [c.id, c]))
    const clips = s ? s.clipIds.map((id) => byId.get(id)).filter((c) => c && c.sync) : []
    const rate = seqRate(clips)
    const span = s ? Math.max(1, s.end - s.start) : 1
    const avail = Math.max(360, window.innerWidth - (innerWidth > 860 ? 232 : 0) - (innerWidth > 1180 ? 356 : 0) - 150 - (innerWidth > 860 ? 2 * Math.min(56, Math.max(24, innerWidth * 0.032)) : 32) - 4)
    const fit = avail / (span * 1.02)
    const pps = S.ui.zoom || fit
    const width = Math.ceil(span * pps * 1.02) + 40
    const rows = layout(clips, p.devices)
    const lab = s ? labelFn(s, clips) : null
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
    const step = steps.find((x) => x * pps >= 90) || 7200
    const ticks = []
    for (let t = 0; t <= span * 1.02; t += step) ticks.push(`<span style="left:${t * pps}px">${lab.at(t)}</span>`)
    const sel = S.ui.selected && byId.get(S.ui.selected)
    const loose = p.clips.filter((c) => c.status === 'ready' && !c.sync)
    const segs = p.sessions.length > 1 ? `<div class="seg" role="group" aria-label="Sessão">${p.sessions.map((x, i) => `<button data-act="session" data-i="${i}" aria-pressed="${i === Math.min(S.ui.session, p.sessions.length - 1)}">${h(x.name.split(' · ')[0])}${x.group > 0 ? ' *' : ''}</button>`).join('')}</div>` : ''
    return `<div class="page tela">
      <header class="page-head"><div><h1>Linha do tempo</h1><p class="page-lead">${s ? `${h(s.name)} · ${duration(span)} · ${plural(clips.length, 'clipe', 'clipes')}${lab.tc ? ' · régua no timecode real' : ''}` : 'Nenhuma sessão'}</p></div>
        <div class="page-actions">${segs}<button class="btn btn-primary" data-act="export">${icon('export')}Exportar</button></div></header>
      <div class="tl-wrap">
        <div>
          <section class="tl" style="--lane-h:${LANE}px">
            <div class="tl-bar"><button class="icon-btn" data-act="zoom" data-v="0.66" aria-label="Afastar">${icon('zoom-out')}</button><input type="range" min="0" max="100" value="${Math.round(Math.log(pps / fit) / Math.log(60) * 100)}" data-input="zoom" aria-label="Zoom" data-fit="${fit}"/><button class="icon-btn" data-act="zoom" data-v="1.5" aria-label="Aproximar">${icon('zoom-in')}</button><button class="icon-btn" data-act="fit" aria-label="Caber na tela">${icon('fit')}</button><span style="margin-left:auto" class="num">${lab.tc ? 'Timecode' : 'Tempo'} · ${h(String(Math.round(rateFps(rate) * 1000) / 1000))} qps</span></div>
            ${
              rows.length
                ? `<div class="tl-body"><div class="tl-heads">${rows.map((r) => `<div class="tl-head" style="height:${r.lanes * LANE}px"><i class="dot" style="--c:${devColor(r.d, true)}"></i><span title="${h(r.d.label)}">${h(r.d.label)}</span></div>`).join('')}</div>
              <div class="tl-scroll" id="tlScroll"><div style="width:${width}px;position:relative"><div class="tl-ruler">${ticks.join('')}</div>
              ${rows
                .map(
                  (r) =>
                    `<div class="tl-row" style="height:${r.lanes * LANE}px">${r.place
                      .map(({ c, lane }) => {
                        const color = devColor(r.d, true)
                        const cf = confColor(c.sync.conf, c.sync.method)
                        const low = c.sync.conf < 0.5 || c.sync.method === 'date'
                        return `<div class="tl-clip ${S.ui.selected === c.id ? 'is-sel' : ''} ${low ? 'low' : ''}" data-clip="${c.id}" style="--c:${color};--cf:${cf};left:${(c.sync.pos - s.start) * pps}px;width:${Math.max(4, (c.duration || 0) * pps)}px;top:${lane * LANE + 6}px" title="${h(c.name)} · ${Math.round(c.sync.conf * 100)}%"><span class="lbl">${h(c.name)}</span><i class="cf"></i>${peaksOf(c) ? `<canvas data-peaks="${c.id}"></canvas>` : ''}</div>`
                      })
                      .join('')}</div>`,
                )
                .join('')}</div></div></div>`
                : '<div class="tl-empty">Nenhum clipe nesta sessão.</div>'
            }
          </section>
          <div class="legend"><span><i class="dot" style="--c:#30d158"></i>confiança alta</span><span><i class="dot" style="--c:#ffd60a"></i>média</span><span><i class="dot" style="--c:#ff9f0a"></i>conferir</span><span><i class="dot" style="--c:#8e8e93"></i>pela data</span>${p.sessions.some((x) => x.group > 0) ? '<span>* grupo sem som em comum com o resto</span>' : ''}</div>
          ${loose.length ? `<section class="card loose"><header class="card-head"><h3>Fora da linha do tempo</h3><span class="sub" style="font-size:12.5px">Entram numa sequência "Sem sincronia" na exportação</span></header><div class="loose-list">${loose.map((c) => `<span class="chip" title="${h(c.audioNote || '')}">${icon(c.kind === 'audio' ? 'wave' : 'film')}${h(c.name)} · ${c.audioStatus === 'none' ? 'sem áudio' : c.audioStatus === 'error' ? 'áudio ilegível' : 'sem par'}</span>`).join('')}</div></section>` : ''}
        </div>
        ${inspector(sel && sel.sync ? sel : null, rate)}
      </div>
    </div>`
  },
  after(root) {
    const p = S.project
    for (const cv of $$('canvas[data-peaks]', root)) {
      const c = p.clips.find((x) => x.id === cv.dataset.peaks)
      if (c) drawPeaks(cv, peaksOf(c), 'rgba(255,255,255,0.78)')
    }
    const cmp = $('#compare', root)
    if (cmp) drawCompare(cmp)
    const sc = $('#tlScroll', root)
    if (sc) {
      if (S.ui.scroll != null) sc.scrollLeft = S.ui.scroll
      sc.addEventListener('scroll', () => (S.ui.scroll = sc.scrollLeft), { passive: true })
      sc.addEventListener('pointerdown', onDown)
    }
  },
  acts: {
    session(el) {
      S.ui.session = +el.dataset.i
      S.ui.zoom = null
      S.ui.scroll = 0
      changed()
    },
    zoom(el) {
      const r = $('[data-input="zoom"]')
      const fit = +r.dataset.fit
      S.ui.zoom = Math.max(fit * 0.5, Math.min(fit * 60, (S.ui.zoom || fit) * +el.dataset.v))
      changed()
    },
    fit() {
      S.ui.zoom = null
      S.ui.scroll = 0
      changed()
    },
    nudge(el) {
      nudge(S.project, S.ui.selected, +el.dataset.v)
      sfx.tick()
      changed()
    },
    reset() {
      const c = S.project.clips.find((x) => x.id === S.ui.selected)
      if (c && c.sync && c.sync.original != null) {
        nudge(S.project, c.id, c.sync.original - c.sync.pos)
        delete c.sync.original
        changed()
      }
    },
    export() {
      go('exportar')
    },
  },
  inputs: {
    zoom(el) {
      const fit = +el.dataset.fit
      S.ui.zoom = fit * Math.pow(60, +el.value / 100)
      changed()
    },
  },
  keys(e) {
    const c = S.ui.selected && S.project.clips.find((x) => x.id === S.ui.selected)
    if (!c || !c.sync) return false
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const s = session()
      const rate = seqRate(s.clipIds.map((id) => S.project.clips.find((x) => x.id === id)).filter(Boolean))
      const step = e.altKey ? 0.001 : 1 / rateFps(rate)
      nudge(S.project, c.id, e.key === 'ArrowLeft' ? -step : step)
      sfx.tick()
      changed()
      return true
    }
    if (e.key === 'Escape') {
      S.ui.selected = null
      changed()
      return true
    }
    return false
  },
}

function onDown(e) {
  const el = e.target.closest('.tl-clip')
  if (!el) return
  const id = el.dataset.clip
  const r = $('[data-input="zoom"]')
  const pps = S.ui.zoom || +r.dataset.fit
  drag = { id, el, x0: e.clientX, left0: parseFloat(el.style.left), moved: false, pps }
  el.setPointerCapture(e.pointerId)
  const tip = document.createElement('div')
  tip.className = 'tl-tip'
  el.parentElement.parentElement.appendChild(tip)
  drag.tip = tip
  const move = (ev) => {
    const dx = ev.clientX - drag.x0
    if (Math.abs(dx) > 3) drag.moved = true
    if (!drag.moved) return
    el.classList.add('is-drag')
    el.style.left = drag.left0 + dx + 'px'
    tip.style.left = drag.left0 + dx + 'px'
    tip.textContent = offsetLabel(dx / drag.pps)
  }
  const up = (ev) => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    tip.remove()
    const dx = ev.clientX - drag.x0
    const moved = drag.moved
    drag = null
    if (moved) {
      nudge(S.project, id, dx / pps)
      sfx.snap()
      S.ui.selected = id
    } else S.ui.selected = S.ui.selected === id ? null : id
    changed()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** As duas formas de onda (referência em cinza, clipe em cor) no trecho mais alto da sobreposição. */
function drawCompare(cv) {
  const p = S.project
  const a = p.clips.find((x) => x.id === cv.dataset.a)
  const b = p.clips.find((x) => x.id === cv.dataset.b)
  const sa = S.signals.get(a.id)
  const sb = S.signals.get(b.id)
  const SR = 4000
  const d = b.sync.pos - a.sync.pos
  const t0 = Math.max(0, -d)
  const t1 = Math.min(sb.length / SR, sa.length / SR - d)
  if (t1 - t0 < 0.5) return
  // trecho de 0,6 s com o maior ataque dentro da sobreposição
  let best = t0
  let bv = -1
  for (let t = t0; t < t1 - 0.6; t += 0.05) {
    const i = Math.floor(t * SR)
    let m = 0
    for (let k = i; k < i + 200; k++) m = Math.max(m, Math.abs(sb[k] || 0))
    let pre = 0
    for (let k = Math.max(0, i - 400); k < i; k++) pre = Math.max(pre, Math.abs(sb[k] || 0))
    const v = m - pre
    if (v > bv) {
      bv = v
      best = t
    }
  }
  const win = 0.6
  const from = Math.max(t0, best - 0.15)
  const dpr = Math.min(2, devicePixelRatio || 1)
  const w = (cv.width = cv.clientWidth * dpr)
  const hh = (cv.height = cv.clientHeight * dpr)
  const ctx = cv.getContext('2d')
  // espelho: referência para cima, clipe para baixo; os ataques batem na mesma vertical quando está certo
  const draw = (sig, off, color, gain, up) => {
    ctx.fillStyle = color
    for (let x = 0; x < w; x += 2) {
      const ta = from + (x / w) * win
      const tb = from + ((x + 2) / w) * win
      let m = 0
      for (let i = Math.floor((ta + off) * SR); i < Math.floor((tb + off) * SR); i++) m = Math.max(m, Math.abs(sig[i] || 0))
      const v = Math.min(1, m * gain) * (hh / 2 - 4)
      ctx.fillRect(x, up ? hh / 2 - v : hh / 2, 1.6, Math.max(1, v))
    }
  }
  const peak = (sig, off) => {
    let m = 1e-6
    for (let x = 0; x < 2400; x++) m = Math.max(m, Math.abs(sig[Math.floor((from + off) * SR) + x] || 0))
    return 1 / m
  }
  const dev = p.devices.find((x) => x.id === b.deviceId)
  draw(sa, d, 'rgba(255,255,255,0.7)', peak(sa, d), true)
  draw(sb, 0, dev ? devColor(dev, true) : '#0a84ff', peak(sb, 0), false)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(0, hh / 2, w, 1)
}
