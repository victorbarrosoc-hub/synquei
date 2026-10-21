// Ajustes: aparência, padrões de exportação, atalhos, privacidade e dados guardados no navegador.

import { S, changed } from '../store.js'
import { h, icon, toast, modal } from '../util.js'

const theme = () => {
  try {
    return localStorage.getItem('synquei:theme') || 'auto'
  } catch {
    return 'auto'
  }
}
const defaults = () => {
  try {
    return JSON.parse(localStorage.getItem('synquei:defaults') || '{}')
  } catch {
    return {}
  }
}

export default {
  title: 'Ajustes',
  render() {
    const t = theme()
    const d = defaults()
    return `<div class="page tela"><header class="page-head"><div><h1>Ajustes</h1><p class="page-lead">Valem para este navegador.</p></div></header>
    <div class="settings stagger">
      <section class="card"><header class="card-head"><h2>Aparência</h2></header><div class="card-pad"><div class="set-row"><div><b>Tema</b><small>Automático segue o sistema.</small></div><div class="seg">${[
        ['auto', 'Automático'],
        ['light', 'Claro'],
        ['dark', 'Escuro'],
      ]
        .map(([k, l]) => `<button data-act="theme" data-v="${k}" aria-pressed="${t === k}">${l}</button>`)
        .join('')}</div></div></div></section>
      <section class="card"><header class="card-head"><h2>Padrões para projetos novos</h2></header><div class="card-pad">
        <label class="set-row"><div><b>Pasta da mídia</b><small>Onde costumam ficar os projetos no seu disco.</small></div><input class="input" style="max-width:280px" data-change="def" data-k="root" value="${h(d.root || '')}" placeholder="/Volumes/SSD" spellcheck="false"/></label>
        <label class="set-row"><div><b>Timecode de início</b><small>Das sequências exportadas.</small></div><select class="select" style="width:auto" data-change="def" data-k="start">${[
          ['01:00:00:00', '01:00:00:00'],
          ['00:00:00:00', '00:00:00:00'],
          ['tc', 'Timecode real'],
        ]
          .map(([v, l]) => `<option value="${v}" ${(d.start || '01:00:00:00') === v ? 'selected' : ''}>${l}</option>`)
          .join('')}</select></label>
      </div></section>
      <section class="card"><header class="card-head"><h2>Atalhos</h2></header><div class="card-pad">
        <div class="set-row"><div><b>Adicionar pasta</b></div><span><span class="kbd">⌘</span> <span class="kbd">O</span></span></div>
        <div class="set-row"><div><b>Sincronizar</b></div><span><span class="kbd">⌘</span> <span class="kbd">↵</span></span></div>
        <div class="set-row"><div><b>Exportar tudo</b></div><span><span class="kbd">⌘</span> <span class="kbd">E</span></span></div>
        <div class="set-row"><div><b>Empurrar clipe um quadro</b><small>Na linha do tempo. Com Option/Alt, 1 ms.</small></div><span><span class="kbd">←</span> <span class="kbd">→</span></span></div>
        <div class="set-row"><div><b>Trocar de aba</b></div><span><span class="kbd">1</span> … <span class="kbd">5</span></span></div>
      </div></section>
      ${window.synqueiDesktop ? '' : `<section class="card"><header class="card-head"><h2>App de desktop</h2></header><div class="card-pad">
        <div class="set-row"><div><b>Synquei para Mac e Windows</b><small>No desktop, cada clipe vai com o caminho completo para o editor e o áudio de celular e GoPro funciona em qualquer máquina.</small></div><span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><a class="btn btn-secondary btn-sm" href="/baixar/mac">${icon('download')}Mac</a><a class="btn btn-secondary btn-sm" href="/baixar/windows">${icon('download')}Windows</a></span></div>
        <div class="set-row"><div><b>Como instalar</b><small>Passo a passo e instalação sem aviso pelo Terminal.</small></div><a class="btn btn-ghost btn-sm" href="/#baixar" target="_blank" rel="noopener">Ver no site</a></div>
      </div></section>`}
      <section class="card"><header class="card-head"><h2>Privacidade</h2></header><div class="card-pad" style="padding:16px 20px;display:grid;gap:10px">
        <div class="info-box">${icon('lock')}<div>O Synquei roda inteiro no seu computador. Os arquivos são lidos direto do disco e nunca são enviados para servidor nenhum. Não há conta, rastreador nem análise de uso.</div></div>
        <p class="sub">Os projetos (nomes dos arquivos, aparelhos e posições) ficam guardados neste navegador. Para levar a outro computador, exporte o arquivo .synquei em Exportar › Relatório.</p>
      </div></section>
      <section class="card"><header class="card-head"><h2>Dados</h2></header><div class="card-pad"><div class="set-row"><div><b>Projetos guardados</b><small>${S.list.length} neste navegador.</small></div><button class="btn btn-secondary btn-danger" data-act="wipe">${icon('trash')}Apagar todos</button></div></div></section>
      <p class="muted" style="font-size:12px">Synquei · versão 1.0 · feito para quem grava com mais de uma câmera.</p>
    </div></div>`
  },
  acts: {
    theme(el) {
      const v = el.dataset.v
      try {
        if (v === 'auto') localStorage.removeItem('synquei:theme')
        else localStorage.setItem('synquei:theme', v)
      } catch {}
      if (v === 'auto') delete document.documentElement.dataset.theme
      else document.documentElement.dataset.theme = v
      changed()
    },
    async wipe() {
      const ok = await modal({ title: 'Apagar todos os projetos?', body: 'Os arquivos de mídia não são tocados. Isso só limpa a lista deste navegador.', ok: 'Apagar tudo', danger: true })
      if (!ok) return
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('synquei:p:') || k === 'synquei:index') localStorage.removeItem(k)
      } catch {}
      S.list = []
      S.project = null
      toast('Projetos apagados')
      changed()
    },
  },
  changes: {
    def(el) {
      const d = defaults()
      d[el.dataset.k] = el.value
      try {
        localStorage.setItem('synquei:defaults', JSON.stringify(d))
      } catch {}
      toast('Padrão salvo')
    },
  },
}
