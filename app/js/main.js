// Synquei — app. Módulos ES sem build: rotas por hash, uma tela por aba, eventos delegados.

import { S, on, changed, loadIndex, addEntries, runSync, save } from './store.js'
import { entriesFromDrop, entriesFromInput } from './media/scan.js'
import { $, $$, h, icon, toast, plural, download } from './util.js'
import { PALETTE } from './media/devices.js'
import { zipAll } from './export/index.js'
import { safeName } from './export/model.js'
import projetos from './views/projetos.js'
import midia from './views/midia.js'
import sincronizar from './views/sincronizar.js'
import linha from './views/linha.js'
import exportar from './views/exportar.js'
import formatos from './views/formatos.js'
import ajustes from './views/ajustes.js'

const VIEWS = { projetos, midia, sincronizar, linha, exportar, formatos, ajustes }
const ORDER = ['projetos', 'midia', 'sincronizar', 'linha', 'exportar']

export function go(route, force) {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`
  else if (force) render()
}

function routeFromHash() {
  const r = (location.hash.replace(/^#\/?/, '') || '').split('/')[0]
  if (r === 'exemplo') {
    if (!demoLoading) {
      demoLoading = true
      history.replaceState(null, '', '#/projetos')
      import('./demo.js')
        .then((m) => m.loadDemo())
        .then(() => go('midia'))
        .finally(() => (demoLoading = false))
    }
    return 'projetos'
  }
  return VIEWS[r] ? r : S.project ? 'midia' : 'projetos'
}

let lastRoute = null
let demoLoading = false
function render() {
  const route = routeFromHash()
  S.route = route
  const view = VIEWS[route]
  const root = $('#view')
  const keepScroll = lastRoute === route ? scrollY : 0
  root.innerHTML = view.render()
  if (view.after) view.after(root)
  if (lastRoute !== route) {
    scrollTo(0, 0)
    document.title = `${view.title} · Synquei`
  } else scrollTo(0, keepScroll)
  lastRoute = route
  chrome()
}

/** Barra lateral e de abas: aba ativa, contadores e o cartão do projeto. */
function chrome() {
  for (const a of $$('[data-r]')) a.classList.toggle('is-on', a.dataset.r === S.route)
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
    card.innerHTML = p
      ? `<a class="proj-card" href="#/projetos"><b>${h(p.name)}</b><span class="sub">${plural(p.clips.length, 'clipe', 'clipes')}${p.result ? ` · ${p.result.stats.total - p.result.stats.unsynced} na linha` : ''}</span><span class="dots">${p.devices.map((d) => `<i class="dot" style="--c:${PALETTE[d.color % PALETTE.length]}" title="${h(d.label)}"></i>`).join('')}</span></a>`
      : ''
  }
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
  if (S.route === 'projetos' || !S.project) go('midia')
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
on('change', () => render())
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
  resizeT = setTimeout(() => S.route === 'linha' && render(), 200)
})
addEventListener('beforeunload', () => save(true))
loadIndex()
render()

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// para testes automatizados
window.__synquei = { S, changed }
