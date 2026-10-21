// Aviso "Nova versão do Synquei" na barra lateral (só no app de desktop), no mesmo esquema do SOBEDESCE: o app
// confere o site, já baixa e confere a versão nova em segundo plano (desktop/atualizador.cjs) e, no fim, aparece
// "Atualizar agora" (o app fecha, troca e abre de novo). "Baixar" fica de alternativa; "Depois" esconde este build.

import { h, icon, bytes, toast } from './util.js'

const api = globalThis.synqueiDesktop && globalThis.synqueiDesktop.atualizacao
const BAIXANDO = new Set(['baixando', 'conferindo', 'preparando'])
let st = null

export const temAtualizador = () => !!api
export const estadoAtualizacao = () => st

/** "versão 12 · 21 de out. de 2026" (ou "versão de desenvolvimento"). */
export function buildLabel(info) {
  if (!info || !info.build) return 'versão de desenvolvimento'
  const d = info.data ? new Date(info.data) : null
  const quando = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return quando ? `versão ${info.build} · ${quando}` : `versão ${info.build}`
}

function progresso(a) {
  if (!a || !a.fase) return null
  if (a.fase === 'erro') return { label: a.erro || 'Algo deu errado ao atualizar. Use Baixar.', f: null, erro: true }
  if (a.fase === 'baixando') {
    const total = Number(a.total) || 0
    const got = Number(a.recebido) || 0
    if (!total) return { label: got ? `Baixando a versão nova… ${bytes(got)}` : 'Baixando a versão nova…', f: null }
    const f = Math.min(1, got / total)
    return { label: `Baixando… ${Math.floor(f * 100)}% · ${bytes(got)} de ${bytes(total)}`, f }
  }
  if (a.fase === 'conferindo') return { label: 'Conferindo o arquivo…', f: 1 }
  if (a.fase === 'preparando') return { label: 'Preparando a troca…', f: 1 }
  if (a.fase === 'pronto') return { label: 'Versão nova baixada e conferida.', f: 1 }
  if (a.fase === 'reiniciando') return { label: 'Abrindo a versão nova…', f: 1 }
  return null
}

const barra = (f) => `<div class="atu-barra ${typeof f === 'number' ? '' : 'is-indef'}" role="progressbar" aria-valuemin="0" aria-valuemax="100" ${typeof f === 'number' ? `aria-valuenow="${Math.round(f * 100)}"` : ''}><span ${typeof f === 'number' ? `style="width:${(f * 100).toFixed(1)}%"` : ''}></span></div>`

/** O cartão da barra lateral (vazio quando não há nada a mostrar). */
export function cartaoHtml(v = st) {
  if (!v) return ''
  const andando = v.fase === 'reiniciando' || (BAIXANDO.has(v.fase) && v.aplicar)
  const sozinho = BAIXANDO.has(v.fase) && !v.aplicar
  const pronto = v.fase === 'pronto'
  const erroAnterior = v.fase === 'erro' && !v.ultima
  if (!v.nova && !andando && !erroAnterior) return ''
  const p = progresso(v)
  const titulo = andando ? 'Atualizando o Synquei' : pronto ? 'Versão nova pronta' : 'Nova versão do Synquei'
  let corpo
  if (andando || sozinho) {
    corpo = `<div class="atu-prog" aria-live="polite">${barra(p && p.f)}<p>${h(p ? p.label : '')}</p>${sozinho ? '<p class="atu-sub">Quando terminar, é só tocar em Atualizar agora.</p>' : ''}</div>${sozinho ? '<div class="atu-acoes"><button class="btn btn-ghost btn-sm" data-act="atu-depois">Depois</button></div>' : ''}`
  } else {
    const dica = pronto ? 'O app fecha, troca pela versão nova e abre de novo.' : v.podeAtualizar ? 'O app baixa a versão nova, troca e abre de novo sozinho.' : v.plataforma === 'windows' ? 'Baixe e rode o instalador.' : 'Baixe e substitua o app em Aplicativos.'
    const principal = pronto
      ? '<button class="btn btn-primary btn-sm" data-act="atu-agora">Atualizar agora</button>'
      : v.podeAtualizar && p && p.erro
        ? '<button class="btn btn-primary btn-sm" data-act="atu-tentar">Tentar de novo</button>'
        : v.podeAtualizar
          ? '<button class="btn btn-primary btn-sm" data-act="atu-agora">Atualizar</button>'
          : `<button class="btn btn-primary btn-sm" data-act="atu-baixar">${icon('download')}Baixar</button>`
    corpo = `<p>${p && p.erro ? `<span class="atu-erro">${h(p.label)}</span>` : h(v.motivo && !v.podeAtualizar ? v.motivo : dica)}</p>
      <div class="atu-acoes">${principal}${v.nova ? '<button class="btn btn-ghost btn-sm" data-act="atu-depois">Depois</button>' : ''}</div>
      ${v.podeAtualizar || pronto ? '<button type="button" class="atu-alt" data-act="atu-baixar">Ou baixe o instalador</button>' : ''}`
  }
  return `<section class="atu" aria-labelledby="atuTitulo" ${andando || sozinho ? 'aria-busy="true"' : ''}>
    <div class="atu-topo"><span class="atu-marca" aria-hidden="true">${icon('download')}</span><b id="atuTitulo">${titulo}</b>${v.ultima ? `<span class="atu-build">versão ${v.ultima.build}</span>` : ''}</div>
    ${corpo}
  </section>`
}

function desenhar() {
  const box = document.getElementById('atuCard')
  if (box) {
    const html = cartaoHtml()
    if (box.innerHTML !== html) box.innerHTML = html
  }
  document.dispatchEvent(new CustomEvent('synquei:atualizacao-mudou'))
}

export function iniciarAtualizacao() {
  if (!api) return
  api.on((s) => {
    st = s
    desenhar()
  })
  api
    .status()
    .then((s) => {
      st = s
      desenhar()
    })
    .catch(() => {})
}

/** Ações dos botões (data-act="atu-…"), ligadas no main.js. */
export const acoesAtualizacao = {
  async 'atu-agora'() {
    try {
      st = await api.aplicar()
      desenhar()
    } catch (err) {
      toast((err && err.message ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { icon: 'warn' })
    }
  },
  async 'atu-depois'() {
    st = await api.depois()
    desenhar()
  },
  async 'atu-tentar'() {
    st = await api.tentar()
    desenhar()
  },
  'atu-baixar'() {
    api.baixar()
  },
  async 'atu-verificar'(el) {
    if (el) el.disabled = true
    st = await api.verificar()
    desenhar()
    if (el) el.disabled = false
    if (st && !st.nova && !(st.ultima && st.ultima.build > st.atual.build)) toast('Você já está com a versão mais nova')
  },
}
