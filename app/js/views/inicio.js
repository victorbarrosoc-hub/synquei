// Início: o painel do app. Como está o projeto aberto (sincronia, confiança, material por aparelho), o botão grande
// de soltar as pastas, os atalhos, os aparelhos e os projetos recentes. Tudo entra com movimento (e parado, para quem
// pediu menos movimento). Sem projeto, uma ilustração mostra o que o Synquei faz.

import { S, changed, openProject, hasMedia } from '../store.js'
import { h, icon, plural, bytes, ago, uiDark } from '../util.js'
import { devColor, KIND_LABEL } from '../media/devices.js'
import { duration } from '../time.js'
import { loadDemo } from '../demo.js'
import { go } from '../main.js'
import { tipoDe } from '../tipos.js'

const KIND_ICON = { camera: 'camera', recorder: 'mic', phone: 'phone', action: 'action', drone: 'drone' }
// categorias do gráfico de sincronia, na ordem fixa da paleta (azul, laranja, verde-água) + cinza para "fora"
const METODOS = [
  { id: 'som', label: 'Pelo som', c: ['#2a78d6', '#3987e5'] },
  { id: 'tc', label: 'Timecode', c: ['#eb6834', '#d95926'] },
  { id: 'data', label: 'Pela data', c: ['#1baf7a', '#199e70'] },
  { id: 'fora', label: 'Fora', c: ['#c7c7cc', '#48484a'] },
]

function saudacao() {
  const hora = new Date().getHours()
  return hora < 5 ? 'Boa madrugada' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

function dados(p) {
  const ready = p.clips.filter((c) => c.status === 'ready')
  const m = { som: 0, tc: 0, data: 0, fora: 0 }
  const confs = []
  for (const c of ready) {
    if (!c.sync) m.fora++
    else if (/^(manual:)?audio/.test(c.sync.method)) {
      m.som++
      confs.push(c.sync.conf)
    } else if (/timecode|linked/.test(c.sync.method)) m.tc++
    else m.data++
  }
  const porAparelho = p.devices
    .map((d) => {
      const cs = ready.filter((c) => c.deviceId === d.id)
      return { d, n: cs.length, dur: cs.reduce((s, c) => s + (c.duration || 0), 0), models: [...new Set(cs.map((c) => c.device && c.device.model).filter(Boolean))] }
    })
    .filter((x) => x.n)
  const total = ready.reduce((s, c) => s + (c.duration || 0), 0)
  const size = ready.reduce((s, c) => s + (c.size || 0), 0)
  confs.sort((a, b) => a - b)
  const mediana = confs.length ? confs[Math.floor(confs.length / 2)] : null
  return { ready, m, confs, mediana, porAparelho, total, size, synced: ready.length - m.fora }
}

/** Rosca de sincronia: segmentos com 2px de folga, % no centro. */
function donut(m, totalN, dark) {
  const R = 42
  const C = 2 * Math.PI * R
  const gap = totalN > 1 ? 2.2 : 0
  let acc = 0
  const segs = METODOS.filter((x) => m[x.id] > 0).map((x) => {
    const frac = m[x.id] / totalN
    const len = Math.max(0, frac * C - gap)
    const seg = `<circle class="pn-seg" r="${R}" cx="50" cy="50" fill="none" stroke="${x.c[dark ? 1 : 0]}" stroke-width="12" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" style="--len:${len.toFixed(2)}" data-tip="${x.label}: ${m[x.id]} ${m[x.id] === 1 ? 'clipe' : 'clipes'} (${Math.round(frac * 100)}%)"/>`
    acc += frac * C
    return seg
  })
  const pct = totalN ? Math.round(((totalN - m.fora) / totalN) * 100) : 0
  return `<svg viewBox="0 0 100 100" class="pn-donut" role="img" aria-label="${pct}% dos clipes na linha do tempo"><g transform="rotate(-90 50 50)"><circle r="${R}" cx="50" cy="50" fill="none" stroke="var(--fill-2)" stroke-width="12"/>${segs.join('')}</g><text x="50" y="50" class="pn-donut-n" text-anchor="middle" dominant-baseline="central"><tspan data-count-to="${pct}">${pct}</tspan>%</text></svg>`
}

/** Histograma de confiança dos clipes sincronizados pelo som (10 faixas). */
function histograma(confs) {
  const bins = new Array(10).fill(0)
  for (const c of confs) bins[Math.min(9, Math.floor(c * 10))]++
  const max = Math.max(1, ...bins)
  return `<div class="pn-hist" role="img" aria-label="Distribuição da confiança">${bins
    .map((n, i) => `<i style="--h:${n ? Math.max(8, (n / max) * 100) : 3}%;--i:${i}" class="${n ? '' : 'zero'}" data-tip="${i * 10}–${i * 10 + 10}%: ${n} ${n === 1 ? 'clipe' : 'clipes'}"></i>`)
    .join('')}</div><div class="pn-hist-eixo"><span>0%</span><span>50%</span><span>100%</span></div>`
}

/** Barra empilhada: horas de material por aparelho. */
function material(lista, total, dark) {
  const segs = lista.map((x) => `<i style="--w:${((x.dur / Math.max(1, total)) * 100).toFixed(2)}%;--c:${devColor(x.d, dark)}" data-tip="${h(x.d.label)}: ${duration(x.dur)} em ${plural(x.n, 'clipe', 'clipes')}"></i>`).join('')
  const legenda = lista
    .slice(0, 4)
    .map((x) => `<span><i class="dot" style="--c:${devColor(x.d, dark)}"></i>${h(x.d.label)} <b class="num">${duration(x.dur)}</b></span>`)
    .join('')
  return `<div class="pn-stack">${segs}</div><div class="pn-legenda">${legenda}${lista.length > 4 ? `<span class="muted">+${lista.length - 4}</span>` : ''}</div>`
}

function cartoes(p, D, dark) {
  const st = p.result ? p.result.stats : null
  const lanes = D.porAparelho
    .slice(0, 5)
    .map((x, k) => `<i style="--c:${devColor(x.d, true)};--w:${Math.max(26, (x.dur / Math.max(1, D.total)) * 160)}%;--o:${(k * 11) % 34}%;--k:${k}"></i>`)
    .join('')
  return `<div class="pn-cartoes">
    <button class="pn-cartao is-blue" data-act="go" data-r="midia" style="--i:1">
      <div class="pn-cartao-topo"><span class="pn-cartao-icone">${icon('media')}</span><span class="pn-cartao-titulo">Projeto aberto</span>${icon('chev', 'icon pn-seta')}</div>
      <div class="pn-cartao-valor" title="${h(p.name)}">${h(p.name)}</div>
      <div class="pn-mini-lanes" aria-hidden="true">${lanes}</div>
      <div class="pn-cartao-pe"><span class="sub">${plural(D.ready.length, 'clipe', 'clipes')} · ${plural(D.porAparelho.length, 'aparelho', 'aparelhos')} · ${bytes(D.size)}</span></div>
    </button>
    <button class="pn-cartao is-green" data-act="go" data-r="${p.result ? 'linha' : 'sincronizar'}" style="--i:2">
      <div class="pn-cartao-topo"><span class="pn-cartao-icone">${icon('sync')}</span><span class="pn-cartao-titulo">Sincronia</span>${icon('chev', 'icon pn-seta')}</div>
      ${
        p.result
          ? `<div class="pn-donut-wrap">${donut(D.m, D.ready.length, dark)}<ul class="pn-donut-leg">${METODOS.map((x) => `<li><i class="dot" style="--c:${x.c[dark ? 1 : 0]}"></i>${x.label}<b class="num">${D.m[x.id]}</b></li>`).join('')}</ul></div>`
          : `<div class="pn-cartao-valor">Falta sincronizar</div><p class="sub" style="font-size:13px">${plural(D.ready.filter(hasMedia).length, 'clipe pronto', 'clipes prontos')} para comparar pelo som.</p><span class="btn btn-primary btn-sm" style="justify-self:start">${icon('sync')}Sincronizar</span>`
      }
    </button>
    <button class="pn-cartao is-violet" data-act="go" data-r="linha" style="--i:3" ${D.confs.length ? '' : 'disabled'}>
      <div class="pn-cartao-topo"><span class="pn-cartao-icone">${icon('sparkle')}</span><span class="pn-cartao-titulo">Confiança</span>${icon('chev', 'icon pn-seta')}</div>
      ${
        D.confs.length
          ? `<div class="pn-cartao-valor num"><span data-count-to="${Math.round(D.mediana * 100)}">${Math.round(D.mediana * 100)}</span>%<small> mediana</small></div>${histograma(D.confs)}<div class="pn-cartao-pe"><span class="sub">${st && st.low ? `${plural(st.low, 'clipe para conferir', 'clipes para conferir')}` : 'Nenhum clipe para conferir'}${st && st.drift ? ` · ${st.drift} com deriva corrigida` : ''}</span></div>`
          : `<div class="pn-cartao-valor">—</div><p class="sub" style="font-size:13px">Aparece depois da primeira sincronia.</p>`
      }
    </button>
    <button class="pn-cartao is-orange" data-act="go" data-r="midia" style="--i:4">
      <div class="pn-cartao-topo"><span class="pn-cartao-icone">${icon('clock')}</span><span class="pn-cartao-titulo">Material</span>${icon('chev', 'icon pn-seta')}</div>
      <div class="pn-cartao-valor num">${duration(D.total)}<small> gravados</small></div>
      ${D.porAparelho.length ? material(D.porAparelho, D.total, dark) : '<p class="sub" style="font-size:13px">Sem clipes ainda.</p>'}
    </button>
  </div>`
}

function atalhos(p) {
  const tiles = [
    { r: 'sincronizar', ic: 'sync', t: 'Sincronizar', s: p && p.result ? 'Rodar de novo' : 'Comparar pelo som', tom: 'blue' },
    { r: 'linha', ic: 'timeline', t: 'Linha do tempo', s: 'Conferir e ajustar', tom: 'green' },
    { r: 'exportar', ic: 'export', t: 'Exportar', s: 'Premiere, Resolve, FCP…', tom: 'violet' },
    { r: 'formatos', ic: 'formats', t: 'Formatos', s: 'O que o Synquei lê', tom: 'orange' },
  ]
  return `<div class="pn-atalhos">
    <button class="pn-soltar" data-act="pick-folder" id="dropZone" style="--i:5">
      <span class="pn-soltar-onda" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</span>
      <span class="pn-soltar-txt"><b>${p ? 'Adicionar pastas' : 'Solte as pastas dos cartões'}</b><span>Ou clique para escolher · câmeras, celulares e gravadores</span></span>
      <span class="pn-soltar-seta">${icon('plus')}</span>
    </button>
    ${tiles.map((a, i) => `<button class="pn-atalho is-${a.tom}" data-act="go" data-r="${a.r}" style="--i:${6 + i}" ${!p && a.r !== 'formatos' ? 'disabled' : ''}><span class="pn-atalho-icone">${icon(a.ic)}</span><span class="pn-atalho-txt"><b>${a.t}</b><span class="sub">${a.s}</span></span></button>`).join('')}
  </div>`
}

function aparelhos(D, dark) {
  const max = Math.max(1, ...D.porAparelho.map((x) => x.dur))
  return `<section class="pn-bloco" style="--i:10"><header class="pn-bloco-topo"><h2>Aparelhos <span class="pn-conta">${D.porAparelho.length}</span></h2><button class="pn-link" data-act="go" data-r="midia">Ver mídia ${icon('chev')}</button></header>
    ${
      D.porAparelho.length
        ? `<ul class="pn-lista">${D.porAparelho
            .map(
              (x) => `<li class="pn-item"><span class="pn-dev" style="--c:${devColor(x.d, dark)}">${icon(KIND_ICON[x.d.kind] || 'camera')}</span><div class="pn-item-txt"><b>${h(x.d.label)}</b><span class="sub">${KIND_LABEL[x.d.kind] || 'Aparelho'}${x.models.length ? ` · ${h(x.models[0])}` : ''} · ${plural(x.n, 'clipe', 'clipes')}</span><div class="pn-barra"><i style="--w:${((x.dur / max) * 100).toFixed(1)}%;--c:${devColor(x.d, dark)}"></i></div></div><span class="pn-pct num">${duration(x.dur)}</span></li>`,
            )
            .join('')}</ul>`
        : `<div class="pn-vazio">Os aparelhos aparecem aqui quando você soltar a mídia.</div>`
    }</section>`
}

function recentes() {
  const list = S.list.slice(0, 5)
  return `<section class="pn-bloco" style="--i:11"><header class="pn-bloco-topo"><h2>Projetos recentes</h2><button class="pn-link" data-act="go" data-r="projetos">Ver todos ${icon('chev')}</button></header>
    ${
      list.length
        ? `<ul class="pn-lista">${list
            .map((e) => {
              const st = e.synced
              const ok = st && !st.unsynced
              return `<li class="pn-item is-click" data-act="open" data-id="${h(e.id)}"><span class="pn-proj-lanes" aria-hidden="true">${e.devices
                .slice(0, 4)
                .map((d, k) => `<i style="--c:${devColor(d, true)};--w:${40 + ((k * 23) % 50)}%;--o:${(k * 17) % 30}%"></i>`)
                .join('')}</span><div class="pn-item-txt"><b>${h(e.name)}</b><span class="sub">${tipoDe(e.type) ? `${h(tipoDe(e.type).label)} · ` : ''}${plural(e.clips, 'clipe', 'clipes')} · ${ago(e.updatedAt)}</span></div>${st ? `<span class="chip ${ok ? 'chip-ok' : 'chip-warn'}">${ok ? icon('check') + 'Sincronizado' : `${st.total - st.unsynced}/${st.total}`}</span>` : '<span class="chip">Novo</span>'}</li>`
            })
            .join('')}</ul>`
        : `<div class="pn-vazio">Seus projetos ficam guardados neste computador.</div>`
    }</section>`
}

/** Tipo do projeto (clique para trocar) e se a exportação vai em multicâmera. */
function tipoLinha(p) {
  const t = tipoDe(p.type)
  const mc = p.export.multicam !== false
  return `<div class="pn-tipo">${
    t
      ? `<button class="tipo-chip is-${t.tom}" data-act="tipo" title="Trocar o tipo">${icon(t.icon)}${h(t.label)}<span class="tipo-trocar">Trocar</span></button>`
      : `<button class="tipo-chip is-alerta" data-act="tipo">${icon('sparkle')}Que projeto é esse? Escolher o tipo</button>`
  }<button class="tipo-chip ${mc ? 'is-mc' : 'is-none'}" data-act="mc" aria-pressed="${mc}" title="Ligar ou desligar o multicâmera nas exportações">${icon('multicam')}${mc ? 'Multicâmera ligado' : 'Multicâmera desligado'}</button></div>`
}

function dicasTipo(p) {
  const t = tipoDe(p.type)
  if (!t) return ''
  return `<section class="pn-dicas is-${t.tom}" style="--i:9"><span class="pn-cartao-icone">${icon(t.icon)}</span><div><p class="eyebrow">Dicas para ${h(t.label)}</p><ul>${t.dicas.map((d) => `<li>${h(d)}</li>`).join('')}</ul></div></section>`
}

/** Ilustração do vazio: três aparelhos mandam o som, as faixas se alinham e o check aparece. */
function ilustracao() {
  const wave = (n, seed) =>
    Array.from({ length: n }, (_, i) => {
      const v = Math.abs(Math.sin(i * 1.7 + seed) * Math.sin(i * 0.43 + seed * 2))
      return `<rect x="${i * 6}" y="${12 - v * 11}" width="3.2" height="${Math.max(1.5, v * 22)}" rx="1.6"/>`
    }).join('')
  return `<figure class="pn-ilustra" aria-hidden="true">
    <svg viewBox="0 0 520 220" class="pn-ilustra-svg">
      <defs><linearGradient id="ilg" x1="0" x2="1"><stop offset="0" stop-color="#3987e5"/><stop offset="1" stop-color="#9085e9"/></linearGradient></defs>
      <g class="il-dev" style="--k:0"><rect x="18" y="26" width="58" height="40" rx="9" class="il-box"/><circle cx="47" cy="46" r="11" class="il-lens"/><rect x="76" y="38" width="12" height="16" rx="3" class="il-box"/></g>
      <g class="il-dev" style="--k:1"><rect x="30" y="88" width="34" height="56" rx="8" class="il-box"/><rect x="41" y="135" width="12" height="3" rx="1.5" class="il-lens"/></g>
      <g class="il-dev" style="--k:2"><rect x="26" y="164" width="42" height="40" rx="8" class="il-box"/><circle cx="47" cy="178" r="7" class="il-lens"/><rect x="38" y="190" width="18" height="6" rx="3" class="il-lens"/></g>
      <g class="il-wave il-w0" fill="#3987e5" transform="translate(120 34)">${wave(46, 1)}</g>
      <g class="il-wave il-w1" fill="#d95926" transform="translate(120 104)">${wave(46, 1)}</g>
      <g class="il-wave il-w2" fill="#199e70" transform="translate(120 172)">${wave(46, 1)}</g>
      <line x1="300" y1="18" x2="300" y2="208" class="il-line"/>
      <g class="il-check" transform="translate(470 110)"><circle r="26" fill="url(#ilg)"/><path d="M-11 0l7 7 14-15" class="il-tick"/></g>
    </svg>
  </figure>`
}

export default {
  title: 'Início',
  render() {
    const p = S.project
    const dark = uiDark()
    if (!p) {
      return `<div class="page page-painel tela">
        <header class="pn-ola" style="--i:0"><h1>${saudacao()}.</h1><p class="page-lead">Solte as pastas da diária. O Synquei reconhece cada arquivo, separa por aparelho e sincroniza pelo som.</p></header>
        <section class="pn-hero" style="--i:1">${ilustracao()}<div class="pn-hero-txt"><h2>Todas as câmeras no mesmo segundo.</h2><p>Câmera, celular e gravador: o som de cada um acha o lugar certo na linha do tempo, com precisão de milissegundo.</p><div class="pn-hero-cta"><button class="btn btn-primary btn-lg" data-act="pick-folder">${icon('folder')}Escolher pasta</button><button class="btn btn-secondary btn-lg" data-act="demo">${icon('sparkle')}Ver o exemplo</button></div></div></section>
        ${atalhos(null)}
        <div class="pn-colunas">${aparelhos({ porAparelho: [] }, dark)}${recentes()}</div>
      </div>`
    }
    const D = dados(p)
    const st = p.result ? p.result.stats : null
    const lead = S.sync.running ? 'Sincronizando agora. Pode continuar usando o app.' : st ? (st.unsynced ? `${st.total - st.unsynced} de ${st.total} clipes na linha do tempo. ${plural(st.unsynced, 'ficou', 'ficaram')} de fora para você conferir.` : `${st.total} clipes no lugar, prontos para o editor.`) : `${plural(D.ready.length, 'clipe', 'clipes')} reconhecidos. Falta sincronizar.`
    return `<div class="page page-painel tela">
      <header class="pn-ola" style="--i:0"><h1>${saudacao()}.</h1><p class="page-lead">${lead}</p>${tipoLinha(p)}</header>
      ${cartoes(p, D, dark)}
      ${atalhos(p)}
      ${dicasTipo(p)}
      <div class="pn-colunas">${aparelhos(D, dark)}${recentes()}</div>
    </div>`
  },
  acts: {
    mc() {
      const e = S.project.export
      e.multicam = e.multicam === false
      e.fcp = e.multicam ? 'both' : 'timeline'
      changed()
    },
    go(el) {
      go(el.dataset.r)
    },
    async demo() {
      await loadDemo()
      go('inicio', true)
    },
    open(el) {
      const id = el.dataset.id
      if (S.project && S.project.id === id) return go('midia')
      if (openProject(id)) go('inicio', true)
    },
  },
}
