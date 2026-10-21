// Formatos: o catálogo do que o Synquei lê, com busca.

import { S } from '../store.js'
import { h, icon } from '../util.js'
import { renderFormats, formatCount } from './formatos-render.js'

export default {
  title: 'Formatos',
  render() {
    const n = formatCount()
    const f = S.ui.fmtFilter || 'all'
    const seg = [
      ['all', 'Tudo'],
      ['video', 'Vídeo'],
      ['raw', 'RAW'],
      ['audio', 'Áudio'],
      ['codec', 'Codecs'],
      ['card', 'Cartões'],
    ]
      .map(([k, l]) => `<button data-act="fmt" data-f="${k}" aria-pressed="${f === k}">${l}</button>`)
      .join('')
    return `<div class="page tela">
      <header class="page-head"><div><h1>Formatos</h1><p class="page-lead">${n.extensions} extensões, ${n.videoCodecs} codecs de vídeo e ${n.raw} famílias de RAW. O arquivo é reconhecido pelos primeiros bytes, então extensão trocada ou ausente não engana.</p></div></header>
      <div class="toolbar"><div class="seg" role="group">${seg}</div><span class="grow"></span><label class="search">${icon('search')}<input class="input" type="search" placeholder="Buscar formato, extensão ou câmera" value="${h(S.ui.fmtQuery || '')}" data-input="fmtq"/></label></div>
      <div id="fmtOut">${renderFormats(S.ui.fmtQuery || '', f)}</div>
    </div>`
  },
  acts: {
    fmt(el) {
      S.ui.fmtFilter = el.dataset.f
      for (const b of document.querySelectorAll('[data-act="fmt"]')) b.setAttribute('aria-pressed', b === el)
      document.getElementById('fmtOut').innerHTML = renderFormats(S.ui.fmtQuery || '', el.dataset.f)
    },
  },
  inputs: {
    fmtq(el) {
      S.ui.fmtQuery = el.value
      document.getElementById('fmtOut').innerHTML = renderFormats(el.value, S.ui.fmtFilter || 'all')
    },
  },
}
