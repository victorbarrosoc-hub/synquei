// Projetos: começar um novo (soltando as pastas dos cartões), abrir o exemplo ou um projeto salvo.

import { S, changed, openProject, deleteProject, renameProject, importProjectJson } from '../store.js'
import { h, icon, ago, plural, modal, toast } from '../util.js'
import { devColor } from '../media/devices.js'
import { loadDemo } from '../demo.js'
import { go } from '../main.js'
import { TIPOS, tipoDe } from '../tipos.js'

function dropZone() {
  return `<section class="drop" id="dropZone">
    <div class="drop-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    <h2>Solte aqui as pastas dos cartões</h2>
    <p>Câmeras, gravadores e celulares, do jeito que saíram do cartão. O Synquei reconhece cada arquivo, separa por aparelho e sincroniza pelo som.</p>
    <div class="row">
      <button class="btn btn-primary btn-lg" data-act="pick-folder">${icon('folder')}Escolher pasta</button>
      <button class="btn btn-secondary btn-lg" data-act="pick-files">${icon('plus')}Arquivos soltos</button>
    </div>
    <div class="row">
      <button class="btn btn-ghost btn-sm" data-act="demo">${icon('sparkle')}Abrir o projeto de exemplo</button>
      <button class="btn btn-ghost btn-sm" data-act="open-json">${icon('upload')}Abrir arquivo .synquei</button>
    </div>
  </section>`
}

function projCard(e, i) {
  const total = e.devices.reduce((s, d) => s + d.n, 0) || 1
  const st = e.synced
  const status = st ? (st.unsynced ? `<span class="chip chip-warn">${st.total - st.unsynced}/${st.total} sincronizados</span>` : `<span class="chip chip-ok">${icon('check')}Sincronizado</span>`) : `<span class="chip">Falta sincronizar</span>`
  const lanes = e.devices
    .slice(0, 5)
    .map((d, k) => `<i style="--c:${devColor(d, true)};width:${Math.max(18, (d.n / total) * 100)}%;margin-left:${(k * 13) % 40}%"></i>`)
    .join('')
  const t = tipoDe(e.type)
  const tipo = `<span class="tipo-chip is-${t ? t.tom : 'none'}">${icon(t ? t.icon : 'dots')}${h(t ? t.label : 'Sem tipo')}</span>${e.multicam ? `<span class="tipo-chip is-mc" title="Multicâmera">${icon('multicam')}Multicâmera</span>` : ''}`
  return `<article class="proj" role="button" tabindex="0" data-act="open" data-id="${h(e.id)}" style="--i:${i}">
    <div class="proj-tipo">${tipo}</div>
    <div class="proj-top"><div><h3>${h(e.name)}</h3><p class="sub" style="font-size:12.5px">${ago(e.updatedAt)}</p></div><div style="display:flex;gap:4px;align-items:center">${status}<button class="icon-btn" data-act="del" data-id="${h(e.id)}" aria-label="Apagar projeto">${icon('trash')}</button></div></div>
    <div class="lanes" aria-hidden="true">${lanes || '<i style="--c:#444;width:40%"></i>'}</div>
    <div class="proj-meta"><span>${plural(e.clips, 'clipe', 'clipes')}</span><span>·</span><span>${plural(e.devices.length, 'aparelho', 'aparelhos')}</span>
      <span class="dots" style="margin-left:auto">${e.devices.map((d) => `<i class="dot" style="--c:${devColor(d, true)}" title="${h(d.label)}"></i>`).join('')}</span></div>
  </article>`
}

export default {
  title: 'Projetos',
  render() {
    const p = S.project
    const tp = p && tipoDe(p.type)
    const current = p
      ? `<div class="info-box" style="margin-bottom:18px">${icon('info')}<div><b>${h(p.name)}</b> está aberto${p.demo ? ' (exemplo)' : ''}${tp ? ` · ${h(tp.label)}` : ''}. <a href="#/inicio" style="text-decoration:underline">Ir para o início</a> · <a href="#" data-act="tipo" style="text-decoration:underline">${tp ? 'Trocar o tipo' : 'Definir o tipo'}</a> · <a href="#" data-act="rename" style="text-decoration:underline">Renomear</a> · <a href="#" data-act="close" style="text-decoration:underline">Fechar</a></div></div>`
      : ''
    const list = S.list
    const filtro = S.ui.tipo || 'todos'
    // tipos que existem na lista, na ordem do catálogo; "Sem tipo" no fim
    const usados = TIPOS.filter((t) => list.some((e) => e.type === t.id))
    const semTipo = list.filter((e) => !tipoDe(e.type)).length
    const chips = list.length
      ? `<div class="tipo-filtro" role="tablist" aria-label="Filtrar por tipo">${[
          `<button role="tab" data-act="filtro" data-v="todos" aria-selected="${filtro === 'todos'}">Todos <b>${list.length}</b></button>`,
          ...usados.map((t) => `<button role="tab" class="is-${t.tom}" data-act="filtro" data-v="${t.id}" aria-selected="${filtro === t.id}">${icon(t.icon)}${h(t.label)} <b>${list.filter((e) => e.type === t.id).length}</b></button>`),
          semTipo ? `<button role="tab" data-act="filtro" data-v="sem" aria-selected="${filtro === 'sem'}">Sem tipo <b>${semTipo}</b></button>` : '',
        ].join('')}</div>`
      : ''
    let blocos = ''
    if (filtro === 'todos') {
      const secoes = [...usados.map((t) => ({ t, itens: list.filter((e) => e.type === t.id) })), { t: null, itens: list.filter((e) => !tipoDe(e.type)) }].filter((x) => x.itens.length)
      // a seção do projeto mais recente vem primeiro
      secoes.sort((a, b) => b.itens[0].updatedAt - a.itens[0].updatedAt)
      blocos = secoes
        .map(({ t, itens }) => `<section class="tipo-secao"><h2 class="section-title tipo-titulo">${t ? `<span class="tipo-ic is-${t.tom}">${icon(t.icon)}</span>${h(t.label)}` : `<span class="tipo-ic">${icon('dots')}</span>Sem tipo`}<span class="pn-conta">${itens.length}</span></h2><div class="projects stagger">${itens.map(projCard).join('')}</div></section>`)
        .join('')
    } else {
      const itens = list.filter((e) => (filtro === 'sem' ? !tipoDe(e.type) : e.type === filtro))
      blocos = `<div class="projects stagger" style="margin-top:14px">${itens.map(projCard).join('')}</div>`
    }
    return `<div class="page tela">
      <header class="page-head"><div><h1>Projetos</h1><p class="page-lead">Separados pelo tipo de gravação. Cada projeto guarda os aparelhos, a sincronia e as exportações; a mídia fica onde está.</p></div><div class="page-actions"><button class="btn btn-primary" data-act="novo">${icon('plus')}Novo projeto</button></div></header>
      ${current}
      ${list.length ? '' : dropZone()}
      ${chips}
      ${blocos}
      ${list.length ? `<details class="proj-mais"><summary>${icon('folder')}Começar soltando as pastas, abrir o exemplo ou um arquivo .synquei</summary>${dropZone()}</details>` : ''}
    </div>`
  },
  acts: {
    filtro(el) {
      S.ui.tipo = el.dataset.v
      changed()
    },
    async demo() {
      toast('Montando o exemplo: 6 arquivos de 5 aparelhos…', { icon: 'sparkle' })
      await loadDemo()
      go('midia')
    },
    async del(el) {
      const ok = await modal({ title: 'Apagar projeto?', body: 'Só o projeto some. Seus arquivos de mídia não são tocados.', ok: 'Apagar', danger: true })
      if (ok) deleteProject(el.dataset.id)
    },
    open(el) {
      const id = el.dataset.id
      if (S.project && S.project.id === id) return go('midia')
      if (openProject(id)) go('midia')
    },
    async rename(el, e) {
      e.preventDefault()
      const v = await modal({ title: 'Nome do projeto', input: S.project.name, ok: 'Salvar' })
      if (v) renameProject(v)
    },
    close(el, e) {
      e.preventDefault()
      S.project = null
      go('projetos', true)
    },
    'open-json'() {
      const inp = document.getElementById('pickProject')
      inp.onchange = async () => {
        const f = inp.files[0]
        inp.value = ''
        if (!f) return
        try {
          importProjectJson(await f.text())
          toast('Projeto aberto. Para sincronizar de novo, solte as pastas da mídia.')
          go('linha')
        } catch (err) {
          toast(err.message, { icon: 'warn' })
        }
      }
      inp.click()
    },
  },
}
