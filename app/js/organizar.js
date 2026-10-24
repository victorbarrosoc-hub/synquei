// Organizar (app de desktop): cada cartão que o SOBEDESCE termina de passar chega aqui (desktop/organizador.cjs).
// O Synquei abre o projeto daquela diária (ou cria), lê os arquivos novos pelo caminho, sincroniza e manda para o
// DaVinci (desktop/davinci.cjs): pastas por diária › câmeras/áudio › dono › cartão, cor por câmera, Cena/Take e as
// linhas do tempo da diária trocadas pelas novas. Um cartão por vez, na ordem em que chegaram.

import { S, openProject, createProject, closeProject, applyType, addEntries, runSync, save, religarPorCaminho } from './store.js'
import { PathFile } from './media/pathfile.js'
import { buildTimelines, safeName } from './export/model.js'
import { toXmeml } from './export/xmeml.js'
import { toast, plural } from './util.js'

const D = globalThis.synqueiDesktop
const API = D && D.organizar
// as mesmas cores de desktop/davinci.cjs (ordem das cores dos aparelhos do Synquei)
export const CORES_RESOLVE = ['Blue', 'Orange', 'Teal', 'Yellow', 'Pink', 'Green', 'Violet', 'Apricot', 'Navy', 'Lime', 'Purple', 'Olive', 'Tan', 'Beige', 'Brown', 'Chocolate']
export const corResolve = (i) => CORES_RESOLVE[(Number(i) || 0) % CORES_RESOLVE.length]
const SUFIXO = ' · Synquei'
const PREF = 'synquei:org:davinci'

export const O = {
  ativo: !!API,
  pastas: [],
  davinci: null,
  fila: [],
  atual: null,
  etapa: '',
  esperando: false,
}

let mudouT = 0
function mudou() {
  clearTimeout(mudouT)
  mudouT = setTimeout(() => document.dispatchEvent(new CustomEvent('synquei:organizar-mudou')), 60)
}

export const mandarParaDavinci = () => {
  try {
    return localStorage.getItem(PREF) !== '0'
  } catch {
    return true
  }
}
export function setMandarParaDavinci(v) {
  try {
    localStorage.setItem(PREF, v ? '1' : '0')
  } catch {}
  mudou()
}

export async function iniciarOrganizar() {
  if (!API) return
  API.onEstado((st) => {
    O.pastas = st
    mudou()
  })
  API.onCartao((ev) => enfileirar(ev))
  D.davinci.on((st) => {
    O.davinci = st
    mudou()
  })
  D.davinci.onResposta((r) => {
    if (r.ok === false) toast(`DaVinci: ${r.erro || 'não deu certo'}`, { icon: 'warn' })
    else if (r.importados || (r.linhas && r.linhas.length)) toast(`DaVinci: ${plural(r.importados, 'clipe novo', 'clipes novos')}${r.linhas && r.linhas.length ? ` e ${r.linhas.length} linhas do tempo` : ''} em “${r.projeto}”`, { icon: 'check' })
    atualizarDavinci()
  })
  O.pastas = await API.estado()
  await atualizarDavinci()
  // o que chegou com o app fechado (ou ficou pela metade) entra na fila
  for (const p of O.pastas) if (p.ligado) for (const ev of await API.pendentes(p.id)) enfileirar(ev)
  setInterval(atualizarDavinci, 10000)
  mudou()
}

export async function atualizarDavinci() {
  if (!D || !D.davinci) return
  try {
    O.davinci = await D.davinci.status()
  } catch {}
  mudou()
}

function enfileirar(ev) {
  const k = `${ev.pastaId}|${ev.id}`
  if ((O.atual && `${O.atual.pastaId}|${O.atual.id}` === k) || O.fila.some((x) => `${x.pastaId}|${x.id}` === k)) return
  O.fila.push(ev)
  mudou()
  andar()
}

let andarT = 0
/** Próximo cartão, se der: nada rodando e o projeto aberto é do Organizar (ou nenhum). */
function andar() {
  clearTimeout(andarT)
  if (O.atual || !O.fila.length) return
  if (S.sync.running || S.probe.active) {
    andarT = setTimeout(andar, 2000)
    return
  }
  const p = S.project
  // a pessoa está mexendo em outro projeto: espera ela fechar (ou clicar em Organizar agora)
  O.esperando = !!(p && !p.org && !p.demo)
  if (O.esperando) {
    mudou()
    andarT = setTimeout(andar, 3000)
    return
  }
  const ev = O.fila.shift()
  processar(ev).finally(() => {
    O.atual = null
    O.etapa = ''
    mudou()
    andarT = setTimeout(andar, 300)
  })
}

/** "Organizar agora": fecha o projeto que estava aberto (ele fica salvo) e segue a fila. */
export function organizarAgora() {
  if (S.project && !S.project.org) closeProject()
  O.esperando = false
  andar()
}

const etapa = (t) => {
  O.etapa = t
  mudou()
}

// diária → projeto criado nesta sessão (dois cartões da mesma diária na fila não criam dois projetos)
const vinculos = new Map()

async function abrirProjetoDaDiaria(ev) {
  const nome = `${ev.projetoNome} · ${ev.diaria.nome}`
  const k = `${ev.pastaId}|${ev.diaria.n}`
  const pasta = O.pastas.find((x) => x.id === ev.pastaId)
  const id = vinculos.get(k) || (pasta && pasta.projetos && pasta.projetos[ev.diaria.n]) || ev.projetoId
  if (id && S.project && S.project.id === id) return S.project
  // o projeto que estava aberto fica gravado antes de trocar
  if (S.project && !S.project.demo) save(true)
  if (id && S.list.some((x) => x.id === id) && openProject(id)) {
    etapa('Religando os clipes que já estavam no projeto')
    await religarPorCaminho((c) => new PathFile({ abs: c.absPath, name: c.name, size: c.size, lastModified: c.lastModified }))
    return S.project
  }
  const p = createProject(nome)
  p.org = { pastaId: ev.pastaId, raiz: ev.raiz, diaria: ev.diaria.n, diariaNome: ev.diaria.nome, projetoNome: ev.projetoNome }
  if (ev.tipo) applyType({ type: ev.tipo })
  vinculos.set(k, p.id)
  await API.vincular(ev.pastaId, { diaria: ev.diaria.n, projetoId: p.id })
  save(true)
  return p
}

async function processar(ev) {
  O.atual = ev
  const rotulo = `${ev.diaria.nome} · ${ev.dono.pasta || ev.dono.nome} · ${ev.cartao.nome || `Cartão ${String(ev.cartao.n).padStart(2, '0')}`}`
  try {
    etapa(`${rotulo}: abrindo o projeto da diária`)
    const p = await abrirProjetoDaDiaria(ev)
    etapa(`${rotulo}: lendo ${ev.arquivos.length} arquivos`)
    const dono = ev.dono.pasta || [ev.dono.nome, ev.dono.camera].filter(Boolean).join(' - ')
    const cartaoNome = ev.pasta.split('/').pop()
    const entries = ev.arquivos.map((a) => ({
      file: new PathFile({ abs: a.abs, name: a.rel.split('/').pop(), size: a.size, lastModified: a.mtimeMs }),
      path: a.rel,
      org: { dono, camera: ev.dono.camera || '', diaria: ev.diaria.n, diariaNome: ev.diaria.nome, cartao: ev.cartao.n, cartaoNome, cor: ev.cor },
    }))
    await addEntries(entries)
    if (p.clips.some((c) => c.status === 'ready')) {
      etapa(`${rotulo}: sincronizando a diária`)
      await runSync()
      cenasDoSom(p)
      save(true)
    }
    if (mandarParaDavinci()) {
      etapa(`${rotulo}: mandando para o DaVinci`)
      await D.davinci.enviar(await pedidoDavinci(p, ev))
    }
    await API.marcar(ev.pastaId, ev.id, 'pronto')
    toast(`${rotulo} organizado`, { icon: 'check' })
  } catch (e) {
    console.error(e)
    await API.marcar(ev.pastaId, ev.id, 'erro', e.message || String(e)).catch(() => {})
    toast(`${rotulo}: ${e.message || e}`, { icon: 'warn' })
  }
}

/** O vídeo que ficou em cima de um áudio com Cena/Take (iXML do gravador) herda a cena e o take. */
export function cenasDoSom(p) {
  const sons = p.clips.filter((c) => c.kind === 'audio' && c.sync && c.meta && (c.meta.scene || c.meta.take))
  for (const v of p.clips) {
    if (v.kind === 'audio' || !v.sync) continue
    let melhor = null
    let mais = 0
    for (const a of sons) {
      if (a.sync.group !== v.sync.group) continue
      const ov = Math.min(v.sync.pos + (v.duration || 0), a.sync.pos + (a.duration || 0)) - Math.max(v.sync.pos, a.sync.pos)
      if (ov > mais) {
        mais = ov
        melhor = a
      }
    }
    v.cena = melhor ? { scene: melhor.meta.scene || '', take: melhor.meta.take || '' } : null
  }
}

const dirDe = (abs) => abs.slice(0, Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\')) + 1)

/** O pedido para o script do Resolve: todos os clipes da diária (o que já está lá só ganha cor e metadados). */
export async function pedidoDavinci(p, ev) {
  const diaria = (p.org && p.org.diariaNome) || ev.diaria.nome
  const devOf = (c) => p.devices.find((d) => d.id === c.deviceId)
  const itens = []
  for (const c of p.clips) {
    if (c.status !== 'ready' || !c.absPath) continue
    const dev = devOf(c)
    const audio = c.kind === 'audio'
    const dono = (c.org && c.org.dono) || (dev && dev.label) || 'Outros'
    const cartao = (c.org && c.org.cartaoNome) || 'Cartão'
    const cena = audio ? (c.meta ? { scene: c.meta.scene, take: c.meta.take } : null) : c.cena
    const meta = { 'Camera #': dono, 'Roll Card #': cartao, Keywords: [diaria, dono, cartao].join(', ') }
    if (cena && cena.scene) meta.Scene = String(cena.scene)
    if (cena && cena.take) meta.Take = String(cena.take)
    const it = { caminho: c.absPath, pasta: [diaria, audio ? 'Áudio' : 'Câmeras', dono, cartao], cor: corResolve(c.org && c.org.cor != null ? c.org.cor : dev ? dev.color : 0), meta }
    if (c.seq) it.seq = { padrao: `${dirDe(c.absPath)}${c.seq.prefix}%0${c.seq.digits}d.${c.seq.ext}`, ini: c.seq.first, fim: c.seq.last }
    itens.push(it)
  }
  // Assets do projeto (trilha, logos, artes), com as subpastas como estão
  for (const a of await API.assets(ev.pastaId)) itens.push({ caminho: a.abs, pasta: ['Assets', ...a.rel.split('/').slice(0, -1)] })
  // as linhas do tempo da diária, uma por sessão, gravadas em <projeto>/Synquei/Sequências/<diária>/
  const importar = []
  if (p.result) {
    for (const tl of buildTimelines(p)) {
      const nome = `${diaria} · ${tl.name}${SUFIXO}`
      const arquivo = await API.escrever(ev.pastaId, `Synquei/Sequências/${safeName(diaria)}/${safeName(nome)}.xml`, toXmeml([tl], p, { wrap: false }))
      importar.push({ nome, arquivo, pasta: [diaria, 'Sequências'] })
    }
  }
  return { projeto: ev.projetoNome, pastaId: ev.pastaId, diaria, itens, linhas: { prefixo: `${diaria} · `, sufixo: SUFIXO, importar } }
}

// ───────── ações da tela ─────────
export async function adicionarPasta() {
  try {
    const id = await API.escolher()
    if (id) toast('Pasta ligada. Cada cartão que terminar entra sozinho.', { icon: 'check' })
    O.pastas = await API.estado()
    for (const ev of id ? await API.pendentes(id) : []) enfileirar(ev)
  } catch (e) {
    toast(e.message || String(e), { icon: 'warn' })
  }
  mudou()
}

export async function reorganizarTudo(pastaId) {
  for (const ev of await API.todos(pastaId)) enfileirar(ev)
}

export const api = API
