// A agulha da linha do tempo: arrastar pela régua (ou clicar numa faixa vazia) passa pelo material; o monitor mostra
// a câmera escolhida em grande e os outros ângulos ao lado, todos no mesmo ponto; o play anda com a agulha tocando o
// som do gravador. Tela cheia leva o app inteiro para a tela e deixa só monitor e linha do tempo.
//
// A agulha anda sem redesenhar a tela (mexe direto no DOM); os <video> ficam guardados aqui e voltam para os seus
// lugares a cada desenho, então não piscam nem recarregam.

import { S, changed } from '../store.js'
import { $, h, icon } from '../util.js'
import { devColor } from '../media/devices.js'
import { rateFps } from '../time.js'

const P = {
  ctx: null,
  projId: null,
  playing: false,
  raf: 0,
  t0: 0,
  n0: 0,
  prog: null,
  manual: false, // a pessoa escolheu o ângulo do monitor
  videos: new Map(), // deviceId -> { el, clipId, pending }
  urls: new Map(), // clipId -> object URL
  bad: new Set(), // clipIds que o navegador não decodifica
  audio: null, // { el, clipId }
  wa: null, // { ctx, src, clipId } — som de 4 kHz quando o arquivo não toca
  emTelaCheia: false,
}

const MSG = {
  vazio: 'Sem imagem neste ponto',
  'sem-midia': 'Solte as pastas de novo para ver a imagem',
  'sem-previa': 'Este formato não abre no navegador (ProRes, RAW…). A sincronia e a exportação não mudam.',
  carregando: '',
  ok: '',
}

const isRec = (row) => row.d.kind === 'recorder' || row.place.every(({ c }) => c.kind === 'audio' || !c.video)

/** Chamado a cada desenho da linha do tempo. */
export function setCtx(ctx) {
  const p = S.project
  if (!p || p.id !== P.projId) reset(p ? p.id : null)
  P.ctx = ctx
  const angs = angles()
  if (!angs.find((r) => r.d.id === P.prog)) P.prog = angs.length ? angs[0].d.id : null
}

function reset(id) {
  pause()
  for (const u of P.urls.values()) URL.revokeObjectURL(u)
  for (const v of P.videos.values()) {
    v.el.removeAttribute('src')
    v.el.load()
  }
  P.urls.clear()
  P.videos.clear()
  P.bad.clear()
  if (P.audio) P.audio.el.pause()
  P.audio = null
  P.projId = id
  P.prog = null
  P.manual = false
}

const angles = () => (P.ctx ? P.ctx.rows.filter((r) => !isRec(r)) : [])
const span = () => (P.ctx ? P.ctx.span : 0)
export const needle = () => Math.max(0, Math.min(span(), S.ui.needle || 0))

/** Timecode com quadros no ponto da agulha. */
export function tcAt(t) {
  const c = P.ctx
  if (!c) return '00:00:00:00'
  const fps = Math.round(rateFps(c.rate))
  const total = (((c.lab.base || 0) + t) % 86400 + 86400) % 86400
  const s = Math.floor(total)
  const f = Math.min(fps - 1, Math.floor((total - s) * fps))
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}:${p2(f)}`
}

function clipAt(row, t) {
  const s = P.ctx.s
  return (row.place.find(({ c }) => t >= c.sync.pos - s.start - 1e-6 && t < c.sync.pos - s.start + (c.duration || 0)) || {}).c || null
}

function url(c) {
  if (!P.urls.has(c.id)) P.urls.set(c.id, URL.createObjectURL(S.files.get(c.id)))
  return P.urls.get(c.id)
}

function video(devId) {
  let v = P.videos.get(devId)
  if (!v) {
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    el.className = 'mon-video'
    v = { el, clipId: null, pending: null }
    el.addEventListener('error', () => {
      if (v.clipId) P.bad.add(v.clipId)
      paint()
    })
    el.addEventListener('seeked', () => {
      if (v.pending != null && !P.playing) {
        const t = v.pending
        v.pending = null
        el.currentTime = t
      }
    })
    for (const ev of ['loadeddata', 'seeked', 'canplay']) el.addEventListener(ev, () => paint())
    P.videos.set(devId, v)
  }
  return v
}

// ───────── desenho ─────────

/** Monitor (câmera em grande + ângulos) e controles. */
export function monitorHtml() {
  const angs = angles()
  const t = needle()
  const pgm = angs.find((r) => r.d.id === P.prog)
  return `<section class="mon" id="mon">
    <div class="mon-main ${angs.length > 1 ? '' : 'is-solo'}">
      <div class="mon-pgm" data-estado="vazio">
        ${pgm ? `<span class="mon-tag" style="--c:${devColor(pgm.d, true)}"><i></i>${h(pgm.d.label)}</span>` : ''}
        <div class="mon-slot" data-slot="pgm"></div>
        <p class="mon-msg">${angs.length ? '' : 'Só áudio nesta sessão: o play toca o som do gravador.'}</p>
      </div>
      ${
        angs.length > 1
          ? `<div class="mon-angs">${angs
              .map((r) => `<button class="mon-ang ${r.d.id === P.prog ? 'is-pgm' : ''}" data-act="angulo" data-dev="${r.d.id}" style="--c:${devColor(r.d, true)}" title="Ver ${h(r.d.label)} em grande"><div class="mon-slot" data-slot="${r.d.id}"></div><p class="mon-msg"></p><span><i></i>${h(r.d.label)}</span></button>`)
              .join('')}</div>`
          : ''
      }
    </div>
    <div class="mon-bar">
      <b class="mon-tc num" id="monTc">${tcAt(t)}</b>
      <div class="mon-tp">
        <button class="icon-btn" data-act="tp" data-v="inicio" title="Começo (Home)">${icon('skip-back')}</button>
        <button class="icon-btn" data-act="tp" data-v="-1" title="Um quadro para trás (←)">${icon('step-back')}</button>
        <button class="mon-play" data-act="tp" data-v="play" id="monPlay" title="Tocar ou pausar (espaço)">${icon(P.playing ? 'pause' : 'play')}</button>
        <button class="icon-btn" data-act="tp" data-v="1" title="Um quadro para frente (→)">${icon('step-fwd')}</button>
        <button class="icon-btn" data-act="tp" data-v="fim" title="Fim (End)">${icon('skip-fwd')}</button>
      </div>
      <button class="btn btn-sm mon-cheia" data-act="cheia" title="Tela cheia (F)">${icon(document.body.classList.contains('tl-cheia') ? 'shrink' : 'expand')}${document.body.classList.contains('tl-cheia') ? 'Sair da tela cheia' : 'Tela cheia'}</button>
    </div>
  </section>`
}

/** Agulha dentro da área rolável (a mesma largura das faixas). */
export function needleHtml(pps) {
  return `<div class="tl-needle" id="tlNeedle" style="left:${needle() * pps}px"><b class="tl-needle-tc">${tcAt(needle())}</b><i class="tl-needle-head" aria-hidden="true"></i></div>`
}

/** Depois de desenhar: põe os vídeos de volta, liga a agulha e acerta a imagem no ponto. */
export function mount(root) {
  if (!P.ctx) return
  const inner = $('#tlInner', root)
  const grab = (e) => {
    if (e.button !== 0 || e.target.closest('.tl-clip')) return
    // no toque, arrastar as faixas rola a linha do tempo; a agulha anda pela régua
    const alvo = e.pointerType === 'mouse' ? '.tl-ruler, .tl-row, .tl-needle' : '.tl-ruler, .tl-needle'
    if (!e.target.closest(alvo)) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const at = (ev) => setNeedle((ev.clientX - inner.getBoundingClientRect().left) / P.ctx.pps)
    at(e)
    const move = (ev) => at(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  if (inner) inner.addEventListener('pointerdown', grab)
  place()
  paint()
  syncMedia(P.playing)
}

function place() {
  for (const r of angles()) {
    const v = video(r.d.id)
    const slot = $(`.mon-slot[data-slot="${r.d.id === P.prog ? 'pgm' : r.d.id}"]`)
    if (slot && v.el.parentNode !== slot) slot.appendChild(v.el)
  }
}

/** Mensagens de cada quadro (sem imagem aqui, formato que não abre, mídia faltando). */
function paint() {
  if (!P.ctx) return
  const t = needle()
  autoPrograma(t)
  for (const r of angles()) {
    const c = clipAt(r, t)
    const v = P.videos.get(r.d.id)
    const estado = !c ? 'vazio' : !S.files.has(c.id) ? 'sem-midia' : P.bad.has(c.id) ? 'sem-previa' : v && v.el.readyState >= 2 && v.clipId === c.id ? 'ok' : 'carregando'
    const box = r.d.id === P.prog ? $('.mon-pgm') : $(`.mon-ang[data-dev="${r.d.id}"]`)
    if (!box) continue
    box.dataset.estado = estado
    const m = box.querySelector('.mon-msg')
    if (m) m.textContent = MSG[estado]
    if (r.d.id === P.prog) {
      const tile = $(`.mon-ang[data-dev="${r.d.id}"] .mon-msg`)
      if (tile) tile.textContent = 'No monitor'
    }
  }
}

/** Sem escolha da pessoa, o monitor vai para uma câmera que tem imagem neste ponto. */
function autoPrograma(t) {
  if (P.manual) return
  const angs = angles()
  const atual = angs.find((r) => r.d.id === P.prog)
  if (atual && clipAt(atual, t)) return
  const com = angs.find((r) => clipAt(r, t) && S.files.has(clipAt(r, t).id))
  if (!com || com.d.id === P.prog) return
  P.prog = com.d.id
  place()
  for (const b of document.querySelectorAll('.mon-ang')) b.classList.toggle('is-pgm', b.dataset.dev === P.prog)
  const tag = $('.mon-tag')
  if (tag) {
    tag.style.setProperty('--c', devColor(com.d, true))
    tag.innerHTML = `<i></i>${h(com.d.label)}`
  }
}

// ───────── agulha ─────────

export function setNeedle(t, { seek = true } = {}) {
  S.ui.needle = Math.max(0, Math.min(span(), t))
  const n = needle()
  const el = $('#tlNeedle')
  if (el && P.ctx) {
    el.style.left = `${n * P.ctx.pps}px`
    el.querySelector('.tl-needle-tc').textContent = tcAt(n)
  }
  const tc = $('#monTc')
  if (tc) tc.textContent = tcAt(n)
  if (seek) {
    syncMedia(false)
    paint()
  }
}

export function step(frames) {
  if (P.playing) pause()
  const fd = 1 / rateFps(P.ctx.rate)
  setNeedle(Math.round((needle() + frames * fd) / fd) * fd)
}

export function toStart() {
  if (P.playing) pause()
  setNeedle(0)
  const sc = $('#tlScroll')
  if (sc) sc.scrollLeft = 0
}

export function toEnd() {
  if (P.playing) pause()
  setNeedle(span())
}

export function setProgram(devId) {
  P.prog = devId
  P.manual = true
  changed()
}

// ───────── play ─────────

export function toggle() {
  if (P.playing) pause()
  else play()
}

function play() {
  if (!P.ctx || span() <= 0) return
  if (needle() >= span() - 0.05) setNeedle(0, { seek: false })
  P.playing = true
  P.t0 = performance.now()
  P.n0 = needle()
  setPlayIcon()
  const tick = () => {
    if (!P.playing) return
    if (S.route !== 'linha') return pause()
    const t = P.n0 + (performance.now() - P.t0) / 1000
    if (t >= span()) {
      setNeedle(span(), { seek: false })
      return pause()
    }
    setNeedle(t, { seek: false })
    syncMedia(true)
    follow(t)
    P.raf = requestAnimationFrame(tick)
  }
  syncMedia(true)
  P.raf = requestAnimationFrame(tick)
}

export function pause() {
  if (!P.playing) return
  P.playing = false
  cancelAnimationFrame(P.raf)
  syncMedia(false)
  setPlayIcon()
}

function setPlayIcon() {
  const b = $('#monPlay')
  if (b) b.innerHTML = icon(P.playing ? 'pause' : 'play')
}

/** A rolagem acompanha a agulha quando ela sai da tela. */
function follow(t) {
  const sc = $('#tlScroll')
  if (!sc || !P.ctx) return
  const x = t * P.ctx.pps
  if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60)
}

/** Cada vídeo no ponto da agulha; o som do gravador junto quando está tocando. */
function syncMedia(playing) {
  if (!P.ctx) return
  const t = needle()
  const s = P.ctx.s
  for (const r of angles()) {
    const v = video(r.d.id)
    const c = clipAt(r, t)
    if (!c || !S.files.has(c.id) || P.bad.has(c.id)) {
      if (!v.el.paused) v.el.pause()
      continue
    }
    if (v.clipId !== c.id) {
      v.clipId = c.id
      v.el.src = url(c)
    }
    const local = t - (c.sync.pos - s.start)
    if (playing) {
      if (v.el.paused) {
        v.el.currentTime = local
        v.el.play().catch(() => {})
      } else if (Math.abs(v.el.currentTime - local) > 0.25) v.el.currentTime = local
    } else {
      if (!v.el.paused) v.el.pause()
      if (v.el.seeking) v.pending = local
      else if (Math.abs(v.el.currentTime - local) > 0.01) v.el.currentTime = local
    }
  }
  syncAudio(playing, t)
}

function audioClip(t) {
  const rows = P.ctx.rows
  for (const r of rows.filter(isRec).concat(rows.filter((r) => r.d.id === P.prog), rows)) {
    const c = clipAt(r, t)
    if (c && (S.files.has(c.id) || S.signals.has(c.id)) && c.audioStatus !== 'none') return c
  }
  return null
}

function syncAudio(playing, t) {
  const c = playing ? audioClip(t) : null
  if (!c) {
    if (P.audio && !P.audio.el.paused) P.audio.el.pause()
    stopWa()
    return
  }
  const local = t - (c.sync.pos - P.ctx.s.start)
  const ok = S.files.has(c.id) && !P.bad.has('a:' + c.id)
  if (ok) {
    stopWa()
    if (!P.audio) {
      const el = new Audio()
      P.audio = { el, clipId: null }
      el.addEventListener('error', () => {
        if (P.audio.clipId) P.bad.add('a:' + P.audio.clipId)
      })
    }
    const a = P.audio
    if (a.clipId !== c.id) {
      a.clipId = c.id
      a.el.src = url(c)
      a.el.currentTime = local
    }
    if (a.el.paused) {
      a.el.currentTime = local
      a.el.play().catch(() => P.bad.add('a:' + c.id))
    } else if (Math.abs(a.el.currentTime - local) > 0.15) a.el.currentTime = local
    return
  }
  // o arquivo não toca aqui: o som de 4 kHz que a sincronia já leu
  if (P.audio && !P.audio.el.paused) P.audio.el.pause()
  const sig = S.signals.get(c.id)
  if (!sig) return stopWa()
  if (P.wa && P.wa.clipId === c.id) return
  stopWa()
  try {
    const C = globalThis.AudioContext || globalThis.webkitAudioContext
    const ctx = (P.waCtx = P.waCtx || new C())
    const buf = ctx.createBuffer(1, sig.length, 4000)
    buf.copyToChannel(sig, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0, Math.max(0, local))
    P.wa = { src, clipId: c.id }
  } catch {}
}

function stopWa() {
  if (!P.wa) return
  try {
    P.wa.src.stop()
  } catch {}
  P.wa = null
}

// ───────── tela cheia ─────────

const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement

export function telaCheia(on = !document.body.classList.contains('tl-cheia')) {
  document.body.classList.toggle('tl-cheia', on)
  const d = document.documentElement
  if (on) {
    const req = d.requestFullscreen || d.webkitRequestFullscreen
    if (req) {
      try {
        const r = req.call(d)
        P.emTelaCheia = true
        if (r && r.catch) r.catch(() => (P.emTelaCheia = false))
      } catch {
        P.emTelaCheia = false
      }
    }
  } else if (fsEl()) {
    const ex = document.exitFullscreen || document.webkitExitFullscreen
    if (ex) ex.call(document)
  }
  changed()
}

// Esc (ou o botão do sistema) sai da tela cheia: a linha do tempo volta ao normal junto
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => {
    if (!fsEl() && P.emTelaCheia) {
      P.emTelaCheia = false
      if (document.body.classList.contains('tl-cheia')) {
        document.body.classList.remove('tl-cheia')
        changed()
      }
    }
  })
}

addEventListener('hashchange', () => {
  pause()
  if (!location.hash.startsWith('#/linha') && document.body.classList.contains('tl-cheia')) telaCheia(false)
})

// para testes automatizados
export const _estado = () => ({ playing: P.playing, prog: P.prog, needle: needle(), videos: P.videos.size, bad: [...P.bad] })
