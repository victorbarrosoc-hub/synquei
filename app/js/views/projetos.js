// Projetos: começar um novo (soltando as pastas dos cartões), abrir o exemplo ou um projeto salvo.

import { S, openProject, deleteProject, renameProject, importProjectJson } from '../store.js'
import { h, icon, ago, plural, modal, toast } from '../util.js'
import { PALETTE } from '../media/devices.js'
import { loadDemo } from '../demo.js'
import { go } from '../main.js'

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
    .map((d, k) => `<i style="--c:${PALETTE[d.color % PALETTE.length]};width:${Math.max(18, (d.n / total) * 100)}%;margin-left:${(k * 13) % 40}%"></i>`)
    .join('')
  return `<article class="proj" role="button" tabindex="0" data-act="open" data-id="${h(e.id)}" style="--i:${i}">
    <div class="proj-top"><div><h3>${h(e.name)}</h3><p class="sub" style="font-size:12.5px">${ago(e.updatedAt)}</p></div><div style="display:flex;gap:4px;align-items:center">${status}<button class="icon-btn" data-act="del" data-id="${h(e.id)}" aria-label="Apagar projeto">${icon('trash')}</button></div></div>
    <div class="lanes" aria-hidden="true">${lanes || '<i style="--c:#444;width:40%"></i>'}</div>
    <div class="proj-meta"><span>${plural(e.clips, 'clipe', 'clipes')}</span><span>·</span><span>${plural(e.devices.length, 'aparelho', 'aparelhos')}</span>
      <span class="dots" style="margin-left:auto">${e.devices.map((d) => `<i class="dot" style="--c:${PALETTE[d.color % PALETTE.length]}" title="${h(d.label)}"></i>`).join('')}</span></div>
  </article>`
}

export default {
  title: 'Projetos',
  render() {
    const p = S.project
    const current = p
      ? `<div class="info-box" style="margin-bottom:18px">${icon('info')}<div><b>${h(p.name)}</b> está aberto${p.demo ? ' (exemplo)' : ''}. <a href="#/midia" style="text-decoration:underline">Ver a mídia</a> · <a href="#" data-act="rename" style="text-decoration:underline">Renomear</a> · <a href="#" data-act="close" style="text-decoration:underline">Fechar</a></div></div>`
      : ''
    const list = S.list
    return `<div class="page tela">
      <header class="page-head"><div><h1>Projetos</h1><p class="page-lead">Cada projeto guarda os aparelhos, a sincronia e as exportações. A mídia fica onde está: o Synquei só lê.</p></div></header>
      ${current}
      ${dropZone()}
      ${list.length ? `<h2 class="section-title">Recentes</h2><div class="projects stagger">${list.map(projCard).join('')}</div>` : ''}
    </div>`
  },
  acts: {
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
