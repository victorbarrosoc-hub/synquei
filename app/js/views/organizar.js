// Organizar: a pasta do projeto no Backup Automático do SOBEDESCE ligada ao Synquei e ao DaVinci. Cada cartão que
// termina de passar entra sozinho (app/js/organizar.js); aqui ficam as pastas, as diárias com seus cartões e a ponte
// com o Resolve.

import { S, openProject } from '../store.js'
import { h, icon, ago, plural, modal, uiDark } from '../util.js'
import { devColor } from '../media/devices.js'
import { go } from '../main.js'
import { O, api, adicionarPasta, reorganizarTudo, organizarAgora, atualizarDavinci, mandarParaDavinci, setMandarParaDavinci } from '../organizar.js'

const ESTADO = {
  novo: ['chip', 'Na fila'],
  pronto: ['chip chip-ok', 'Organizado'],
  erro: ['chip chip-err', 'Erro'],
}

function fluxo() {
  const dv = O.davinci
  const passo = (ic, t, s, ok) => `<div class="org-passo${ok ? ' is-ok' : ''}"><span class="org-passo-ic">${icon(ic)}</span><b>${t}</b><small>${s}</small></div>`
  const ligadas = O.pastas.filter((p) => p.ligado).length
  return `<div class="org-fluxo">
    ${passo('download', 'SOBEDESCE', ligadas ? `${plural(ligadas, 'pasta vigiada', 'pastas vigiadas')}` : 'Ligue a pasta do projeto', ligadas > 0)}
    <span class="org-seta">${icon('arrow')}</span>
    ${passo('sync', 'Synquei', O.atual ? 'Organizando agora' : O.fila.length ? `${plural(O.fila.length, 'cartão', 'cartões')} na fila` : 'Esperando cartões', true)}
    <span class="org-seta">${icon('arrow')}</span>
    ${passo('film', 'DaVinci Resolve', !mandarParaDavinci() ? 'Desligado' : !dv || !dv.instalado ? 'Instale a ponte' : dv.conectado ? `Ligado${dv.projeto ? ` · ${h(dv.projeto)}` : ''}` : 'Abra Workspace › Scripts › Synquei', !!(dv && dv.conectado && mandarParaDavinci()))}
  </div>`
}

function agora() {
  if (O.esperando && O.fila.length)
    return `<div class="info-box org-agora">${icon('info')}<div><b>${plural(O.fila.length, 'cartão novo esperando', 'cartões novos esperando')}.</b> O projeto “${h(S.project ? S.project.name : '')}” está aberto: o Synquei espera você fechar para não mexer nele. <a href="#" data-act="org-agora" style="text-decoration:underline">Organizar agora</a></div></div>`
  if (!O.atual) return ''
  return `<div class="info-box org-agora is-live">${icon('sync')}<div><b>${h(O.etapa || 'Organizando')}</b>${O.fila.length ? ` · mais ${plural(O.fila.length, 'cartão', 'cartões')} na fila` : ''}${S.sync.running ? ` · ${S.sync.done}/${S.sync.total}` : ''}</div></div>`
}

function davinci() {
  const dv = O.davinci || {}
  const on = mandarParaDavinci()
  const ultima = (dv.respostas || [])[0]
  const status = !dv.instalado
    ? '<span class="chip">Ponte não instalada</span>'
    : dv.conectado
      ? `<span class="chip chip-ok">${icon('check')}Janela do Synquei aberta no DaVinci</span>`
      : '<span class="chip chip-warn">DaVinci fechado ou janela do Synquei fechada</span>'
  return `<section class="card"><header class="card-head"><h2>DaVinci Resolve Studio</h2>${status}</header><div class="card-pad">
    <div class="set-row"><div><b>Mandar cada cartão para o DaVinci</b><small>Pastas na Media Pool por diária › Câmeras ou Áudio › dono › cartão, uma cor por câmera, Cena, Take, Câmera e Cartão nos metadados e as linhas do tempo sincronizadas da diária em Sequências.</small></div><label class="switch"><input type="checkbox" data-change="org-davinci" ${on ? 'checked' : ''} aria-label="Mandar para o DaVinci"/><i></i></label></div>
    <div class="set-row"><div><b>1. Instalar a ponte</b><small>Põe o script “Synquei” no menu do DaVinci. ${dv.instalado ? 'Já instalado.' : ''}</small></div><button class="btn ${dv.instalado ? 'btn-secondary' : 'btn-primary'} btn-sm" data-act="org-instalar">${icon('download')}${dv.instalado ? 'Instalar de novo' : 'Instalar no DaVinci'}</button></div>
    <div class="set-row"><div><b>2. No DaVinci: Workspace › Scripts › Synquei</b><small>Abre uma janelinha; deixe aberta enquanto grava. Ela pega os cartões no projeto do DaVinci com o mesmo nome do projeto do SOBEDESCE (ou clique em “Usar o projeto aberto”). Precisa do DaVinci Resolve Studio: a versão grátis não aceita scripts.</small></div></div>
    ${dv.esperando ? `<div class="warn-box">${icon('warn')}<div>O DaVinci está esperando o projeto <b>${h(dv.esperando)}</b>. Abra esse projeto ou clique em “Usar o projeto aberto” na janelinha do Synquei.</div></div>` : ''}
    <div class="set-row"><div><b>Fila do DaVinci</b><small>${dv.fila ? `${plural(dv.fila, 'pedido esperando', 'pedidos esperando')} a janelinha` : 'Nada esperando'}${ultima ? ` · último: ${plural(ultima.importados, 'clipe novo', 'clipes novos')}${ultima.linhas && ultima.linhas.length ? `, ${plural(ultima.linhas.length, 'linha do tempo', 'linhas do tempo')}` : ''}${ultima.guardadas && ultima.guardadas.length ? ` (${plural(ultima.guardadas.length, 'editada ficou guardada', 'editadas ficaram guardadas')})` : ''}` : ''}</small></div><button class="btn btn-ghost btn-sm" data-act="org-dv-status">${icon('sync')}Conferir</button></div>
  </div></section>`
}

function cartao(c, cores) {
  const [cls, txt] = ESTADO[c.estado] || ESTADO.novo
  const atual = O.atual && O.atual.id === c.id
  return `<li class="org-cartao"><span class="dot" style="--c:${devColor({ color: Math.min(8, (cores || {})[c.dono.pasta || c.dono.nome] ?? 8) }, uiDark())}"></span><div><b>${h(c.dono.pasta || c.dono.nome)}</b> · ${h(c.pasta.split('/').pop())}<small>${plural(c.arquivos, 'arquivo', 'arquivos')}${c.quando ? ` · ${ago(Date.parse(c.quando))}` : ''}${c.erro ? ` · ${h(c.erro)}` : ''}</small></div><span class="${atual ? 'chip chip-blue' : cls}">${atual ? 'Organizando' : txt}</span></li>`
}

function pasta(p) {
  const porDiaria = new Map()
  for (const c of p.cartoes) {
    const n = c.diaria.n
    if (!porDiaria.has(n)) porDiaria.set(n, { nome: c.diaria.nome, cartoes: [] })
    porDiaria.get(n).cartoes.push(c)
  }
  const diarias = [...porDiaria.entries()].sort((a, b) => b[0] - a[0])
  return `<section class="card org-pasta"><header class="card-head"><div><h2>${h(p.nome)}</h2><p class="sub mono" style="font-size:12px">${h(p.raiz)}</p></div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><label class="switch" title="Vigiar esta pasta"><input type="checkbox" data-change="org-ligar" data-id="${h(p.id)}" ${p.ligado ? 'checked' : ''} aria-label="Vigiar esta pasta"/><i></i></label>
    <button class="btn btn-ghost btn-sm" data-act="org-abrir" data-id="${h(p.id)}">${icon('folder')}Abrir pasta</button>
    <button class="btn btn-ghost btn-sm" data-act="org-tudo" data-id="${h(p.id)}">${icon('sync')}Organizar tudo de novo</button>
    <button class="icon-btn" data-act="org-tirar" data-id="${h(p.id)}" aria-label="Parar de vigiar e tirar da lista">${icon('trash')}</button></div></header>
    <div class="card-pad">${
      diarias.length
        ? diarias
            .map(([n, d]) => {
              const pid = p.projetos && p.projetos[n]
              return `<div class="org-diaria"><div class="org-diaria-topo"><h3>${h(d.nome)}</h3><span class="sub">${plural(d.cartoes.length, 'cartão', 'cartões')}</span>${pid && S.list.some((x) => x.id === pid) ? `<button class="btn btn-secondary btn-sm" data-act="org-proj" data-id="${h(pid)}">${icon('timeline')}Abrir no Synquei</button>` : ''}</div><ul class="org-cartoes">${d.cartoes.map((c) => cartao(c, p.cores)).join('')}</ul></div>`
            })
            .join('')
        : `<p class="sub">Nenhum cartão terminou ainda. Quando o SOBEDESCE terminar o próximo, ele aparece aqui e vai sozinho para o projeto.</p>`
    }
    <p class="sub org-pastas-trabalho">${icon('folder')}<span>Criadas em volta da mídia (nada é movido): <b>Assets</b>, <b>Exports</b> e <b>Synquei/Sequências</b>.</span></p></div></section>`
}

export default {
  title: 'Organizar',
  render() {
    if (!O.ativo)
      return `<div class="page tela"><header class="page-head"><div><h1>Organizar</h1><p class="page-lead">SOBEDESCE › Synquei › DaVinci, sozinho a cada cartão.</p></div></header>
        <div class="info-box">${icon('info')}<div>O Organizar vigia pastas do seu computador e fala com o DaVinci: só funciona no <b>app de desktop</b> do Synquei. <a href="/#baixar" target="_blank" rel="noopener" style="text-decoration:underline">Baixar para Mac ou Windows</a></div></div></div>`
    return `<div class="page tela"><header class="page-head"><div><h1>Organizar</h1><p class="page-lead">Ligue a pasta de um projeto do Backup Automático do SOBEDESCE. Cada cartão que termina de passar entra sozinho: o Synquei sincroniza a diária e organiza tudo no DaVinci.</p></div><div class="page-actions"><button class="btn btn-primary" data-act="org-add">${icon('plus')}Ligar pasta do SOBEDESCE</button></div></header>
      ${fluxo()}
      ${agora()}
      <div class="settings stagger">
        ${O.pastas.length ? O.pastas.map(pasta).join('') : `<section class="card"><div class="card-pad org-vazio">${icon('folder')}<div><b>Escolha a pasta do projeto no HD</b><p class="sub">A que o SOBEDESCE criou dentro do destino, com as pastas “Diária 01”, “Diária 02”… Os cartões que já passaram entram agora; os próximos, assim que terminarem.</p></div><button class="btn btn-primary" data-act="org-add">${icon('folder')}Escolher pasta</button></div></section>`}
        ${davinci()}
      </div></div>`
  },
  acts: {
    'org-add': () => adicionarPasta(),
    'org-agora': (el, e) => {
      e.preventDefault()
      organizarAgora()
    },
    'org-abrir': (el) => api.abrir(el.dataset.id),
    'org-tudo': async (el) => {
      if (await modal({ title: 'Organizar tudo de novo?', body: 'Todos os cartões desta pasta passam outra vez pelo Synquei e pelo DaVinci. O que já está no DaVinci não é importado de novo; as linhas do tempo da diária são trocadas (as que você editou ficam guardadas com outro nome).', ok: 'Organizar de novo' })) reorganizarTudo(el.dataset.id)
    },
    'org-tirar': async (el) => {
      if (await modal({ title: 'Parar de vigiar esta pasta?', body: 'Ela sai da lista. Os arquivos, os projetos do Synquei e o que está no DaVinci continuam onde estão.', ok: 'Parar de vigiar', danger: true })) api.remover(el.dataset.id)
    },
    'org-proj': (el) => {
      if (openProject(el.dataset.id)) go('linha')
    },
    'org-instalar': async () => {
      try {
        await globalThis.synqueiDesktop.davinci.instalar()
        await modal({ title: 'Ponte instalada', body: 'Agora, no DaVinci Resolve Studio: Workspace › Scripts › Synquei. Deixe a janelinha aberta. Se o DaVinci já estava aberto, feche e abra de novo para o script aparecer no menu.', ok: 'Entendi', cancel: false })
      } catch (e) {
        await modal({ title: 'Não consegui instalar', body: h(e.message || String(e)), ok: 'Ok', cancel: false })
      }
      atualizarDavinci()
    },
    'org-dv-status': () => atualizarDavinci(),
  },
  changes: {
    'org-davinci': (el) => setMandarParaDavinci(el.checked),
    'org-ligar': (el) => api.ligar(el.dataset.id, el.checked),
  },
}
