// Organizar: o Synquei vigia a pasta de um projeto do SOBEDESCE (Backup Automático) e, a cada cartão que termina de
// passar, entrega os arquivos novos à página, que reconhece, sincroniza e manda para o DaVinci (desktop/davinci.cjs).
//
// De onde vem cada cartão:
//  1. <projeto>/.sobedesce/descargas.jsonl (o SOBEDESCE grava uma linha por cartão): diária, dono, câmera, a pasta do
//     cartão e os arquivos. Lido do ponto onde parou (offset guardado), só as linhas inteiras.
//  2. Sem esse arquivo (SOBEDESCE antigo ou pasta copiada à mão): a estrutura Diária NN/Cenas/<Dono>/Cartão NN com o
//     relatório SOBEDESCE_copia_*.xxh64, que só aparece quando o cartão termina e foi conferido.
//
// Os arquivos nunca são movidos nem renomeados: o SOBEDESCE compara pelo caminho na segunda leva do mesmo cartão. O
// Synquei só cria em volta as pastas de trabalho (Assets, Exports e Synquei/Sequências).
//
// Nada aqui importa o Electron: desktop/main.cjs liga os eventos e a página. Os testes usam pastas temporárias.

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')

const RESUMO = path.join('.sobedesce', 'descargas.jsonl')
const PASTAS_DE_TRABALHO = ['Assets', 'Exports', path.join('Synquei', 'Sequências')]
const IGNORAR = /(^|\/)(\.sobedesce-anteriores|\.sobedesce|\.Spotlight-V100|\.Trashes|\.fseventsd)(\/|$)|\.sobedesce-parcial$|(^|\/)\._|(^|\/)\.DS_Store$|(^|\/)SOBEDESCE_copia_[^/]*\.xxh64$/
const CONFIG = 'organizador.json'

const idDe = (raiz) => crypto.createHash('sha1').update(path.resolve(raiz)).digest('hex').slice(0, 12)
const dentro = (pai, filho) => {
  const r = path.relative(pai, filho)
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r))
}
const barra = (p) => p.split(path.sep).join('/')

async function eDiretorio(p) {
  try {
    return (await fsp.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function listar(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Todos os arquivos de uma pasta (caminho relativo com "/"), sem o que o SOBEDESCE guarda para si. */
async function arquivosDe(raiz, rel = '') {
  const out = []
  for (const e of await listar(path.join(raiz, rel))) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (IGNORAR.test(r)) continue
    if (e.isDirectory()) out.push(...(await arquivosDe(raiz, r)))
    else if (e.isFile()) out.push(r)
  }
  return out
}

/** "Diária 03" → 3 (null se não for uma diária). */
const numeroDiaria = (nome) => {
  const m = /^Di[aá]ria\s*(\d+)/i.exec(nome || '')
  return m ? Number(m[1]) : null
}
const numeroCartao = (nome) => {
  const m = /^Cart[aã]o\s*(\d+)/i.exec(nome || '')
  return m ? Number(m[1]) : null
}

/** "Aladim - FX30" → { nome: 'Aladim', camera: 'FX30' } (a pasta é o que o SOBEDESCE gravou). */
function donoDaPasta(pasta) {
  const i = pasta.lastIndexOf(' - ')
  return i > 0 ? { nome: pasta.slice(0, i), camera: pasta.slice(i + 3), pasta } : { nome: pasta, camera: '', pasta }
}

class Organizador extends EventEmitter {
  constructor({ stateDir, intervaloMs = 4000, log = () => {} } = {}) {
    super()
    this.stateDir = stateDir
    this.intervaloMs = intervaloMs
    this.log = log
    this.timer = null
    this.rodando = null
    this.cfg = this.#ler()
  }

  #ler() {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(this.stateDir, CONFIG), 'utf8'))
      if (c && typeof c === 'object' && c.pastas) return c
    } catch {}
    return { pastas: {} }
  }

  async #gravar() {
    if (!this.stateDir) return
    await fsp.mkdir(this.stateDir, { recursive: true })
    const f = path.join(this.stateDir, CONFIG)
    await fsp.writeFile(f + '.tmp', JSON.stringify(this.cfg, null, 2))
    await fsp.rename(f + '.tmp', f)
  }

  /** O que a página mostra. */
  estado() {
    return Object.values(this.cfg.pastas).map((p) => ({
      id: p.id,
      raiz: p.raiz,
      nome: p.nome,
      ligado: p.ligado,
      projetos: p.projetos || {},
      tipo: p.tipo || null,
      cores: p.cores || {},
      origem: p.origem,
      cartoes: Object.values(p.cartoes)
        .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
        .slice(0, 200)
        .map((c) => ({ id: c.id, pasta: c.pasta, diaria: c.diaria, dono: c.dono, cartao: c.cartao, quando: c.quando, resultado: c.resultado, arquivos: c.arquivos, estado: c.estado, erro: c.erro || null })),
    }))
  }

  /** Pasta do projeto (a que o SOBEDESCE cria dentro do destino: <destino>/<Projeto>). */
  async adicionar(raiz, { tipo = null } = {}) {
    raiz = path.resolve(String(raiz || ''))
    if (!(await eDiretorio(raiz))) throw new Error('Essa pasta não existe ou não abre.')
    const id = idDe(raiz)
    if (!this.cfg.pastas[id]) {
      const temResumo = fs.existsSync(path.join(raiz, RESUMO))
      const temDiaria = (await listar(raiz)).some((e) => e.isDirectory() && numeroDiaria(e.name) != null)
      if (!temResumo && !temDiaria) throw new Error('Não achei um projeto do SOBEDESCE aqui. Escolha a pasta do projeto, a que tem as pastas "Diária 01", "Diária 02"…')
      this.cfg.pastas[id] = { id, raiz, nome: path.basename(raiz), ligado: true, tipo, projetos: {}, cores: {}, origem: temResumo ? 'resumo' : 'pastas', offset: 0, resto: '', cartoes: {}, criadoEm: new Date().toISOString() }
    } else this.cfg.pastas[id].ligado = true
    await this.#pastasDeTrabalho(raiz)
    await this.#gravar()
    this.emit('mudou', this.estado())
    this.verificar().catch(() => {})
    return this.cfg.pastas[id]
  }

  async remover(id) {
    delete this.cfg.pastas[id]
    await this.#gravar()
    this.emit('mudou', this.estado())
  }

  async ligar(id, ligado) {
    const p = this.cfg.pastas[id]
    if (!p) return
    p.ligado = !!ligado
    await this.#gravar()
    this.emit('mudou', this.estado())
    if (p.ligado) this.verificar().catch(() => {})
  }

  /** Cada diária vira um projeto do Synquei (a sincronia fica do tamanho de um dia): guarda qual é qual. */
  async vincular(id, { diaria, projetoId, tipo } = {}) {
    const p = this.cfg.pastas[id]
    if (!p) return
    if (diaria != null) {
      p.projetos = p.projetos || {}
      if (projetoId) p.projetos[diaria] = projetoId
      else delete p.projetos[diaria]
    }
    if (tipo !== undefined) p.tipo = tipo
    await this.#gravar()
    this.emit('mudou', this.estado())
  }

  async #pastasDeTrabalho(raiz) {
    for (const rel of PASTAS_DE_TRABALHO) await fsp.mkdir(path.join(raiz, rel), { recursive: true }).catch(() => {})
  }

  start() {
    if (this.timer) return
    const tick = async () => {
      await this.verificar().catch((err) => this.log('vigia:', err && err.message))
      if (this.timer !== null) this.timer = setTimeout(tick, this.intervaloMs)
    }
    this.timer = setTimeout(tick, 500)
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = null
  }

  /** Uma passada em todas as pastas ligadas: cartões novos viram evento 'cartao'. */
  async verificar() {
    // uma passada por vez; quem chega no meio espera a atual e roda outra (pode ter chegado coisa nova)
    while (this.rodando) await this.rodando
    let fim
    this.rodando = new Promise((r) => (fim = r))
    try {
      for (const p of Object.values(this.cfg.pastas)) {
        if (!p.ligado || !(await eDiretorio(p.raiz))) continue
        const novos = fs.existsSync(path.join(p.raiz, RESUMO)) ? await this.#doResumo(p) : await this.#dasPastas(p)
        for (const c of novos) {
          p.cartoes[c.id] = { ...c, arquivos: c.lista.length, estado: 'novo', lista: undefined }
          const ev = this.#evento(p, c)
          await this.#gravar()
          this.emit('cartao', ev)
          this.emit('mudou', this.estado())
        }
      }
    } finally {
      this.rodando = null
      fim()
    }
  }

  /** Cor fixa de cada dono no projeto todo (a mesma câmera tem a mesma cor em todas as diárias). */
  #cor(p, dono) {
    p.cores = p.cores || {}
    const k = (dono && (dono.pasta || dono.nome)) || '?'
    if (p.cores[k] == null) p.cores[k] = Object.keys(p.cores).length
    return p.cores[k]
  }

  #evento(p, c) {
    return {
      pastaId: p.id,
      raiz: p.raiz,
      projetoNome: p.nome,
      projetoId: (p.projetos || {})[c.diaria.n] || null,
      tipo: p.tipo,
      cor: this.#cor(p, c.dono),
      id: c.id,
      quando: c.quando,
      diaria: c.diaria,
      dono: c.dono,
      cartao: c.cartao,
      pasta: c.pasta,
      resultado: c.resultado,
      arquivos: c.lista.map((r) => ({ rel: `${c.pasta}/${r.rel}`, abs: path.join(p.raiz, ...c.pasta.split('/'), ...r.rel.split('/')), size: r.size, mtimeMs: r.mtimeMs })),
    }
  }

  /** Linhas novas do descargas.jsonl (só as inteiras; a última pela metade espera a próxima passada). */
  async #doResumo(p) {
    const f = path.join(p.raiz, RESUMO)
    let st
    try {
      st = await fsp.stat(f)
    } catch {
      return []
    }
    if (st.size < p.offset) {
      // o arquivo foi recriado: lê do começo (os cartões já vistos não voltam, pelo id)
      p.offset = 0
      p.resto = ''
    }
    if (st.size === p.offset) return []
    const fh = await fsp.open(f, 'r')
    let texto
    try {
      const len = st.size - p.offset
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, p.offset)
      texto = (p.resto || '') + buf.toString('utf8')
    } finally {
      await fh.close()
    }
    const linhas = texto.split('\n')
    p.resto = linhas.pop()
    p.offset = st.size
    const novos = []
    for (const l of linhas) {
      if (!l.trim()) continue
      let d
      try {
        d = JSON.parse(l)
      } catch {
        this.log('linha estragada no resumo do SOBEDESCE')
        continue
      }
      if (!d || d.v !== 1 || !d.cartao || !d.cartao.pasta || d.resultado === 'cancelado') continue
      const id = String(d.id || `${d.cartao.pasta}|${d.quando}`)
      if (p.cartoes[id]) continue
      const base = path.join(p.raiz, ...d.cartao.pasta.split('/'))
      const lista = []
      for (const a of Array.isArray(d.arquivos) ? d.arquivos : []) {
        if (!a || typeof a.rel !== 'string' || IGNORAR.test(a.rel)) continue
        const abs = path.join(base, ...a.rel.split('/'))
        if (!dentro(p.raiz, abs)) continue
        try {
          const s = await fsp.stat(abs)
          if (s.isFile()) lista.push({ rel: a.rel, size: s.size, mtimeMs: s.mtimeMs })
        } catch {}
      }
      novos.push({
        id,
        quando: d.quando || null,
        diaria: { n: Number(d.diaria && d.diaria.n) || numeroDiaria(d.cartao.pasta.split('/')[0]) || 1, nome: (d.diaria && d.diaria.nome) || d.cartao.pasta.split('/')[0], data: d.data || null },
        dono: { nome: (d.dono && d.dono.nome) || '', camera: (d.dono && d.dono.camera) || '', pasta: (d.dono && d.dono.pasta) || d.cartao.pasta.split('/')[2] || '' },
        cartao: { n: Number(d.cartao.n) || numeroCartao(d.cartao.pasta.split('/').pop()) || 1, nome: d.cartao.nome || '' },
        pasta: d.cartao.pasta,
        resultado: d.resultado || 'ok',
        lista,
      })
    }
    return novos
  }

  /** Sem resumo: cada Cartão NN com o relatório .xxh64 do SOBEDESCE (o cartão terminou e foi conferido). */
  async #dasPastas(p) {
    const novos = []
    for (const d of await listar(p.raiz)) {
      const nd = d.isDirectory() ? numeroDiaria(d.name) : null
      if (nd == null) continue
      const cenas = path.join(p.raiz, d.name, 'Cenas')
      for (const o of await listar(cenas)) {
        if (!o.isDirectory()) continue
        for (const c of await listar(path.join(cenas, o.name))) {
          if (!c.isDirectory() || numeroCartao(c.name) == null) continue
          const dir = path.join(cenas, o.name, c.name)
          const relatorios = (await listar(dir)).filter((e) => e.isFile() && /^SOBEDESCE_copia_.*\.xxh64$/.test(e.name)).map((e) => e.name).sort()
          if (!relatorios.length) continue
          const pasta = [d.name, 'Cenas', o.name, c.name].join('/')
          // uma "leva" por relatório: a segunda leva do mesmo cartão grava outro relatório
          const id = `${pasta}|${relatorios.at(-1)}`
          if (p.cartoes[id]) continue
          const lista = []
          for (const rel of await arquivosDe(dir)) {
            try {
              const s = await fsp.stat(path.join(dir, ...rel.split('/')))
              lista.push({ rel, size: s.size, mtimeMs: s.mtimeMs })
            } catch {}
          }
          let quando = null
          try {
            quando = (await fsp.stat(path.join(dir, relatorios.at(-1)))).mtime.toISOString()
          } catch {}
          novos.push({ id, quando, diaria: { n: nd, nome: d.name, data: null }, dono: donoDaPasta(o.name), cartao: { n: numeroCartao(c.name), nome: c.name }, pasta, resultado: 'ok', lista })
        }
      }
    }
    return novos.sort((a, b) => String(a.quando).localeCompare(String(b.quando)))
  }

  /** A página terminou (ou falhou) com um cartão. */
  async marcar(pastaId, cartaoId, estado, erro = null) {
    const p = this.cfg.pastas[pastaId]
    const c = p && p.cartoes[cartaoId]
    if (!c) return
    c.estado = estado
    c.erro = erro
    if (estado === 'pronto') c.prontoEm = new Date().toISOString()
    await this.#gravar()
    this.emit('mudou', this.estado())
  }

  /** Cartões que chegaram e a página ainda não terminou (o app fechou no meio): voltam como evento. */
  async pendentes(pastaId) {
    const p = this.cfg.pastas[pastaId]
    if (!p) return []
    const out = []
    for (const c of Object.values(p.cartoes)) {
      if (c.estado === 'pronto') continue
      const dir = path.join(p.raiz, ...c.pasta.split('/'))
      const lista = []
      for (const rel of await arquivosDe(dir)) {
        try {
          const s = await fsp.stat(path.join(dir, ...rel.split('/')))
          lista.push({ rel, size: s.size, mtimeMs: s.mtimeMs })
        } catch {}
      }
      out.push(this.#evento(p, { ...c, lista }))
    }
    return out.sort((a, b) => String(a.quando).localeCompare(String(b.quando)))
  }

  /** Todos os cartões de uma pasta como eventos (reorganizar tudo de novo). */
  async todos(pastaId) {
    const p = this.cfg.pastas[pastaId]
    if (!p) return []
    for (const c of Object.values(p.cartoes)) c.estado = 'novo'
    await this.#gravar()
    return this.pendentes(pastaId)
  }

  /** A página só lê arquivos de dentro das pastas vigiadas. */
  permitido(abs) {
    const a = path.resolve(String(abs || ''))
    return Object.values(this.cfg.pastas).some((p) => dentro(p.raiz, a))
  }

  /** Bytes [inicio, fim) de um arquivo de uma pasta vigiada (a página lê os clipes por aqui). */
  async ler(abs, inicio, fim) {
    if (!this.permitido(abs)) throw new Error('fora das pastas vigiadas')
    const fh = await fsp.open(abs, 'r')
    try {
      const st = await fh.stat()
      const a = Math.max(0, Math.min(Number(inicio) || 0, st.size))
      const b = Math.max(a, Math.min(fim == null ? st.size : Number(fim), st.size))
      const buf = Buffer.alloc(b - a)
      if (b > a) await fh.read(buf, 0, b - a, a)
      return buf
    } finally {
      await fh.close()
    }
  }

  /** Grava um arquivo do Synquei dentro da pasta do projeto (sequências por diária, relatórios). */
  async escrever(pastaId, rel, conteudo) {
    const p = this.cfg.pastas[pastaId]
    if (!p) throw new Error('pasta não vigiada')
    const abs = path.join(p.raiz, ...String(rel).split('/'))
    if (!dentro(path.join(p.raiz, 'Synquei'), abs)) throw new Error('só dentro da pasta Synquei do projeto')
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs + '.tmp', conteudo)
    await fsp.rename(abs + '.tmp', abs)
    return abs
  }

  /** O que a pessoa pôs em <projeto>/Assets (trilha, logos, artes): vai para a pasta Assets do DaVinci. */
  async assets(pastaId) {
    const p = this.cfg.pastas[pastaId]
    if (!p) return []
    return (await arquivosDe(path.join(p.raiz, 'Assets'))).map((rel) => ({ rel, abs: path.join(p.raiz, 'Assets', ...rel.split('/')) }))
  }

  raizDe(pastaId) {
    const p = this.cfg.pastas[pastaId]
    return p ? p.raiz : null
  }
}

module.exports = { Organizador, idDe, donoDaPasta, numeroDiaria, numeroCartao, IGNORAR, RESUMO, PASTAS_DE_TRABALHO }
