// Synquei — app. Módulos ES sem build: rotas por hash, uma tela por aba, eventos delegados.

import { S, on, changed, loadIndex, addEntries, runSync, save } from './store.js'
import { entriesFromDrop, entriesFromInput } from './media/scan.js'
import { $, $$, h, icon, toast, plural, download, uiDark } from './util.js'
import { sfx } from './sfx.js'
import { devColor } from './media/devices.js'
import { zipAll } from './export/index.js'
import { safeName } from './export/model.js'
import inicio from './views/inicio.js'
import projetos from './views/projetos.js'
import midia from './views/midia.js'
import sincronizar from './views/sincronizar.js'
import linha from './views/linha.js'
import exportar from './views/exportar.js'
import formatos from './views/formatos.js'
import ajustes from './views/ajustes.js'

const VIEWS = { inicio, projetos, midia, sincronizar, linha, exportar, formatos, ajustes }
const ORDER = ['inicio', 'midia', 'sincronizar', 'linha', 'exportar']
// ordem da barra lateral: decide se a tela entra pela direita ou pela esquerda
const SEQ = ['inicio', 'midia', 'sincronizar', 'linha', 'exportar', 'projetos', 'formatos', 'ajustes']
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function go(route, force) {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`
  else if (force) render()
}

function routeFromHash() {
  const r = (location.hash.replace(/^#\/?/, '') || '').split('/')[0]
  if (r === 'exemplo') {
    if (!demoLoading) {
      demoLoading = true
      history.replaceState(null, '', '#/inicio')
      import('./demo.js')
        .then((m) => m.loadDemo())
        .then(() => go('inicio', true))
        .finally(() => (demoLoading = false))
    }
    return 'inicio'
  }
  return VIEWS[r] ? r : 'inicio'
}

let lastRoute = null
let demoLoading = false
let enterT = 0
function render() {
  const route = routeFromHash()
  S.route = route
  const view = VIEWS[route]
  const root = $('#view')
  const entering = lastRoute !== route
  const keepScroll = entering ? 0 : scrollY
  // a tela só anima ao chegar; quando ela se redesenha (progresso, um clique), fica parada
  if (entering) {
    clearTimeout(enterT)
    const a = SEQ.indexOf(lastRoute)
    const b = SEQ.indexOf(route)
    root.dataset.dir = a < 0 || a === b ? '' : b > a ? 'fwd' : 'back'
    root.classList.remove('is-still')
    enterT = setTimeout(() => root.classList.add('is-still'), 1400)
  } else root.classList.add('is-still')
  root.innerHTML = view.render()
  if (view.after) view.after(root)
  if (entering) {
    scrollTo(0, 0)
    document.title = `${view.title} · Synquei`
    countUp(root)
  } else scrollTo(0, keepScroll)
  lastRoute = route
  hideTip()
  chrome()
}

/** Números que sobem até o valor ao entrar na tela. */
function countUp(root) {
  const els = $$('[data-count-to]', root)
  if (!els.length || calm()) return
  const t0 = performance.now()
  const dur = 750
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    for (const el of els) if (el.isConnected) el.textContent = Math.round(+el.dataset.countTo * e).toLocaleString('pt-BR')
    if (k < 1) requestAnimationFrame(step)
  }
  for (const el of els) el.textContent = '0'
  requestAnimationFrame(step)
}

/** Barra lateral e de abas: aba ativa (com a pílula que desliza), contadores, atividade e o cartão do projeto. */
function chrome() {
  for (const a of $$('[data-r]')) a.classList.toggle('is-on', a.dataset.r === S.route && !!a.closest('.sidebar, .tabbar'))
  movePill()
  activity()
  const p = S.project
  const mb = $('[data-badge="midia"]')
  const sb = $('[data-badge="sincronizar"]')
  if (mb) {
    const n = p ? p.clips.length : 0
    mb.hidden = !n
    mb.textContent = S.probe.active ? `${S.probe.done}/${S.probe.total}` : n
    mb.classList.toggle('is-live', S.probe.active)
  }
  if (sb) {
    sb.hidden = !(S.sync.running || (p && p.result))
    sb.textContent = S.sync.running ? '…' : p && p.result ? '✓' : ''
    sb.className = `badge ${S.sync.running ? 'is-live' : 'is-ok'}`
  }
  const card = $('#projCard')
  if (card) {
    const html = p
      ? `<a class="proj-card" href="#/inicio"><b>${h(p.name)}</b><span class="sub">${plural(p.clips.length, 'clipe', 'clipes')}${p.result ? ` · ${p.result.stats.total - p.result.stats.unsynced} na linha` : ''}</span><span class="dots">${p.devices.map((d) => `<i class="dot" style="--c:${devColor(d, uiDark())}" title="${h(d.label)}"></i>`).join('')}</span></a>`
      : ''
    if (card.innerHTML !== html) card.innerHTML = html
  }
}

function movePill() {
  const wrap = $('#navWrap')
  if (!wrap) return
  const pill = $('.nav-pill', wrap)
  const on = $('.nav-item.is-on', wrap)
  if (!on) return pill.classList.remove('is-on')
  const first = !pill.classList.contains('is-on') && !pill.style.transform
  pill.style.transition = first ? 'none' : ''
  // posição relativa ao bloco todo (cada grupo .nav tem o próprio contexto)
  const y = on.getBoundingClientRect().top - wrap.getBoundingClientRect().top
  pill.style.transform = `translateY(${y}px)`
  pill.style.height = `${on.offsetHeight}px`
  pill.classList.add('is-on')
}

/** O medidor da barra lateral: cinco LEDs que dançam enquanto o app lê arquivos ou sincroniza. */
function activity() {
  const box = $('#atividade')
  if (!box) return
  let txt = 'Pronto'
  let live = false
  let pct = null
  if (S.sync.running) {
    live = true
    pct = S.sync.total ? Math.round((S.sync.done / S.sync.total) * 100) : 0
    txt = S.sync.phase === 'match' ? `Comparando · ${pct}%` : `Lendo o áudio · ${S.sync.done}/${S.sync.total}`
  } else if (S.probe.active) {
    live = true
    txt = `Reconhecendo · ${S.probe.done}/${S.probe.total}`
  } else if (S.project && S.project.result) txt = 'Sincronizado'
  else if (S.project) txt = 'Falta sincronizar'
  box.classList.toggle('is-live', live)
  box.classList.toggle('is-ok', !live && !!(S.project && S.project.result))
  const t = $('.atividade-txt', box)
  if (t.textContent !== txt) t.textContent = txt
}

// dica flutuante para [data-tip] (gráficos, barras, segmentos)
const tipEl = () => $('#tip')
function hideTip() {
  const t = tipEl()
  if (t) t.hidden = true
}
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]')
  const t = tipEl()
  if (!t) return
  if (!el) return hideTip()
  t.textContent = el.dataset.tip
  t.hidden = false
})
document.addEventListener('pointermove', (e) => {
  const t = tipEl()
  if (t && !t.hidden) {
    const w = t.offsetWidth
    const x = Math.min(innerWidth - w - 8, Math.max(8, e.clientX - w / 2))
    const y = e.clientY - t.offsetHeight - 14
    t.style.transform = `translate(${x}px, ${y < 8 ? e.clientY + 18 : y}px)`
  }
  // luz que segue o ponteiro nos cartões do painel
  const card = e.target.closest && e.target.closest('.pn-cartao, .pn-atalho, .pn-soltar')
  if (card) {
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${e.clientX - r.left}px`)
    card.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
})
addEventListener('scroll', hideTip, { passive: true })

/** Sincronia pronta: um anel de faixas coloridas que se abre no meio da tela. */
let lastFinish = null
function celebrate() {
  if (calm()) return
  const el = document.createElement('div')
  el.className = 'festa'
  el.setAttribute('aria-hidden', 'true')
  const cores = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9']
  el.innerHTML = `<div class="festa-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>${Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--c:${cores[i % cores.length]};--d:${(i % 3) * 40}ms"></i>`).join('')}`
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 1600)
}

// ───────── eventos delegados ─────────
const root = () => $('#view')
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (act === 'pick-folder') return pick('#pickFolder')
  if (act === 'pick-files') return pick('#pickFiles')
  const v = VIEWS[S.route]
  if (v.acts && v.acts[act]) v.acts[act](el, e)
})
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]')
  if (!el) return
  const v = VIEWS[S.route]
  if (v.changes && v.changes[el.dataset.change]) v.changes[el.dataset.change](el, e)
})
let inputT = 0
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]')
  if (!el) return
  const v = VIEWS[S.route]
  clearTimeout(inputT)
  inputT = setTimeout(() => v.inputs && v.inputs[el.dataset.input] && v.inputs[el.dataset.input](el, e), el.type === 'range' ? 0 : 120)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[role="button"][data-act]')) e.target.click()
})

function pick(sel) {
  $(sel).click()
}
for (const sel of ['#pickFolder', '#pickFiles']) {
  const inp = $(sel)
  inp.addEventListener('change', async () => {
    const list = entriesFromInput(inp.files)
    inp.value = ''
    await importEntries(list)
  })
}

async function importEntries(list) {
  if (!list.length) return
  sfx.pop()
  if (S.route === 'projetos' || S.route === 'inicio' || !S.project) go('midia')
  const r = await addEntries(list)
  if (!r) return
  const parts = []
  if (r.added) parts.push(plural(r.added, 'clipe novo', 'clipes novos'))
  if (r.relinked) parts.push(plural(r.relinked, 'religado', 'religados'))
  if (r.ignored) parts.push(`${r.ignored} ignorados`)
  toast(parts.join(' · ') || 'Nada novo nessa pasta')
}

// arrastar e soltar em qualquer lugar
let dragDepth = 0
let overlay = null
const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
addEventListener('dragenter', (e) => {
  if (!isFiles(e)) return
  e.preventDefault()
  dragDepth++
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'drop-overlay'
    overlay.innerHTML = `<div><svg class="brand-mark" style="width:44px;height:44px"><use href="#logo"/></svg>Solte para ${S.project ? 'adicionar ao projeto' : 'começar um projeto'}</div>`
    document.body.appendChild(overlay)
  }
  const z = $('#dropZone')
  if (z) z.classList.add('is-over')
})
addEventListener('dragover', (e) => isFiles(e) && e.preventDefault())
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) clearDrag()
})
function clearDrag() {
  dragDepth = 0
  if (overlay) overlay.remove()
  overlay = null
  const z = $('#dropZone')
  if (z) z.classList.remove('is-over')
}
addEventListener('drop', async (e) => {
  if (!isFiles(e)) return
  e.preventDefault()
  clearDrag()
  const list = await entriesFromDrop(e.dataTransfer)
  await importEntries(list)
})

// atalhos
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    return pick('#pickFolder')
  }
  if (mod && e.key === 'Enter' && S.project) {
    e.preventDefault()
    go('sincronizar')
    runSync().catch((err) => toast(err.message, { icon: 'warn' }))
    return
  }
  if (mod && e.key.toLowerCase() === 'e' && S.project && S.project.result) {
    e.preventDefault()
    download(zipAll(S.project), `${safeName(S.project.name)} · Synquei.zip`, 'application/zip')
    return
  }
  if (typing || mod) return
  const v = VIEWS[S.route]
  if (v.keys && v.keys(e)) return e.preventDefault()
  if (/^[1-5]$/.test(e.key)) go(ORDER[+e.key - 1])
})

// ───────── início ─────────
let liveRaf = 0
on('change', () => {
  if (S.sync.finishedAt && S.sync.finishedAt !== lastFinish) {
    lastFinish = S.sync.finishedAt
    celebrate()
  }
  render()
})
on('progress', () => {
  cancelAnimationFrame(liveRaf)
  liveRaf = requestAnimationFrame(() => {
    const v = VIEWS[S.route]
    if (v.live) v.live()
    else render()
    chrome()
  })
})
addEventListener('hashchange', render)
let resizeT = 0
addEventListener('resize', () => {
  clearTimeout(resizeT)
  resizeT = setTimeout(() => {
    movePill()
    if (S.route === 'linha') render()
  }, 200)
})
addEventListener('beforeunload', () => save(true))
// no app de desktop a marca leva ao início (não ao site)
if (window.synqueiDesktop) {
  const b = $('.brand')
  if (b) b.setAttribute('href', '#/inicio')
}
loadIndex()
render()

if ('serviceWorker' in navigator && !window.synqueiDesktop && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// para testes automatizados
window.__synquei = { S, changed }
