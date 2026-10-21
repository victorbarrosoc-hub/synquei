// Escolher o tipo de projeto: grade de tipos por grupo, nome, multicâmera e as dicas do tipo escolhido.
// Devolve uma Promise com { name, type, multicam } (ou null se fechar).

import { TIPOS, GRUPOS, tipoDe } from './tipos.js'
import { h, icon } from './util.js'
import { sfx } from './sfx.js'

export function escolherTipo({ name = '', type = null, multicam = null, novo = true } = {}) {
  return new Promise((resolve) => {
    const layer = document.getElementById('layer')
    const back = document.createElement('div')
    back.className = 'modal-back'
    let sel = type
    let mc = multicam
    let mcTocado = multicam != null && !novo
    const dicas = () => {
      const t = tipoDe(sel)
      return t ? `<p class="eyebrow">Dicas para ${h(t.label)}</p><ul>${t.dicas.map((d) => `<li>${h(d)}</li>`).join('')}</ul>` : '<p class="sub">Escolha o que você está gravando: o Synquei ajusta a sincronia e a exportação para esse tipo de material.</p>'
    }
    back.innerHTML = `<form class="modal modal-tipos" role="dialog" aria-modal="true" aria-label="Tipo de projeto">
      <header class="tp-topo"><div><h2>${novo ? 'Que projeto é esse?' : 'Tipo do projeto'}</h2><p class="sub">Cada tipo já chega com a sincronia e a exportação ajustadas. Dá para mudar tudo depois.</p></div><button type="button" class="icon-btn" data-v="0" aria-label="Fechar">${icon('close')}</button></header>
      <label class="field tp-nome"><span>Nome do projeto</span><input class="input" name="nome" value="${h(name)}" placeholder="Ex.: Show no Circo Voador · 12/10" autocomplete="off"/></label>
      <div class="tp-grupos">${GRUPOS.map(
        (g) => `<section><p class="eyebrow">${h(g.label)}</p><div class="tp-grade">${TIPOS.filter((t) => t.grupo === g.id)
          .map((t) => `<button type="button" class="tp-tipo is-${t.tom}" data-tipo="${t.id}" aria-pressed="${t.id === sel}"><span class="tp-icone">${icon(t.icon)}</span><span class="tp-txt"><b>${h(t.label)}</b><span>${h(t.resumo)}</span></span>${t.multicam ? `<span class="tp-mc" title="Multicâmera ligado">${icon('multicam')}</span>` : ''}</button>`)
          .join('')}</div></section>`,
      ).join('')}</div>
      <div class="tp-pe">
        <div class="tp-dicas">${dicas()}</div>
        <label class="tp-mc-row"><span class="tp-mc-ic">${icon('multicam')}</span><span><b>Multicâmera</b><small>Cada aparelho (ou take) vira um ângulo para cortar ao vivo no editor.</small></span><span class="switch"><input type="checkbox" name="mc" ${mc ? 'checked' : ''}/><i></i></span></label>
        <div class="row"><button type="button" class="btn btn-ghost" data-v="0">${novo ? 'Depois' : 'Cancelar'}</button><button class="btn btn-primary" type="submit" ${sel ? '' : 'disabled'}>${novo ? 'Criar projeto' : 'Salvar'}</button></div>
      </div>
    </form>`
    const form = back.querySelector('form')
    const ok = form.querySelector('[type=submit]')
    const chk = form.querySelector('[name=mc]')
    const close = (v) => {
      back.classList.add('is-out')
      setTimeout(() => back.remove(), 180)
      resolve(v)
    }
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-v="0"]')) return close(null)
      const b = e.target.closest('[data-tipo]')
      if (!b) return
      sel = b.dataset.tipo
      for (const x of form.querySelectorAll('[data-tipo]')) x.setAttribute('aria-pressed', String(x === b))
      if (!mcTocado) chk.checked = !!tipoDe(sel).multicam
      form.querySelector('.tp-dicas').innerHTML = dicas()
      ok.disabled = false
      sfx.tick()
    })
    chk.addEventListener('change', () => {
      mcTocado = true
      sfx.tick()
    })
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!sel) return
      mc = chk.checked
      sfx.snap()
      close({ name: form.nome.value.trim() || name || tipoDe(sel).label, type: sel, multicam: mc })
    })
    back.addEventListener('keydown', (e) => e.key === 'Escape' && close(null))
    layer.appendChild(back)
    const first = form.querySelector('[aria-pressed="true"]') || form.nome
    first.focus()
  })
}
