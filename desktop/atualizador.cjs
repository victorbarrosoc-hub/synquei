// Atualização do app de desktop pelo próprio app (Mac e Windows, só no app instalado), no mesmo esquema do SOBEDESCE.
//
//  1. Confere o site (~10 s depois de abrir e a cada 1 h): GET <site>/baixar/versao devolve o build mais novo e o
//     SHA-256 de cada instalador. O build deste app vem de desktop/build-info.json, gravado pelo GitHub Actions;
//     sem ele (npm run desktop, testes) o build é 0 e nada é conferido.
//  2. Saiu um build mais novo (e a pessoa não disse "Depois" para ele): baixa em segundo plano o instalador daquele
//     build (<site>/baixar/<plataforma>?build=N), confere o SHA-256 e prepara a troca:
//       Mac: monta o .dmg (hdiutil), copia o app novo para o lado do atual (ditto), desmonta e tira os atributos (xattr);
//       Windows: o próprio instalador NSIS, que roda em silêncio (/S).
//     Arquivo baixado pelo próprio app não ganha a marca de "veio da internet": sem o aviso do macOS ou do Windows.
//  3. Pronto: o aviso mostra "Atualizar agora". Um script pequeno espera o app fechar, troca o app (Mac) ou roda o
//     instalador (Windows) e abre o app de novo. Se a troca falhar, o app antigo volta e fica uma marca na pasta de
//     dados (atualizacao-falhou.json): na próxima abertura o aviso mostra o motivo e oferece o Baixar de sempre.
//
// Nada aqui importa o Electron: o processo principal (desktop/main.cjs) passa os caminhos e o "handoff". Os testes
// trocam o download, os comandos e o site por funções falsas.

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { execFile } = require('node:child_process')

const SITE = (process.env.SYNQUEI_SITE || 'https://synquei.vercel.app').replace(/\/+$/, '')
const MARK_FILE = 'atualizacao-falhou.json'
const PREFS_FILE = 'atualizacao.json'
const TMP_PREFIX = 'synquei-atualizacao-'
const MAX_BYTES = 2 * 1024 ** 3
const STALL_MS = 60_000
const PROGRESS_MS = 250
const SHA256 = /^[0-9a-f]{64}$/
const PLATAFORMAS = { darwin: 'mac', win32: 'windows' }
const BAIXANDO = new Set(['baixando', 'conferindo', 'preparando'])

function cleanInfo(raw) {
  const build = Number(raw && raw.build)
  if (!Number.isSafeInteger(build) || build < 0) return null
  const commit = raw && typeof raw.commit === 'string' && /^[0-9a-f]{4,40}$/i.test(raw.commit) ? raw.commit.slice(0, 12).toLowerCase() : ''
  const ms = raw && typeof raw.data === 'string' ? Date.parse(raw.data) : NaN
  return { build, commit, data: Number.isFinite(ms) ? new Date(ms).toISOString() : null }
}

/** O build deste app. Arquivo ausente ou estragado = versão de desenvolvimento (build 0). */
function readBuildInfo(file) {
  try {
    return cleanInfo(JSON.parse(fs.readFileSync(file, 'utf8'))) || { build: 0, commit: '', data: null }
  } catch {
    return { build: 0, commit: '', data: null }
  }
}

const hex64 = (v) => (typeof v === 'string' && SHA256.test(v.toLowerCase()) ? v.toLowerCase() : null)

/** Resposta de /baixar/versao → { build, commit, data, sha256: { mac, windows } }, ou null. */
function parseRemote(body) {
  const info = cleanInfo(body)
  if (!info || info.build <= 0) return null
  return { ...info, sha256: { mac: hex64(body.sha256Mac), windows: hex64(body.sha256Windows) } }
}

/** Texto entre aspas simples para sh: 'a'\''b'. */
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
/** Texto entre aspas simples para PowerShell: 'a''b'. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** /Applications/Synquei.app/Contents/MacOS/Synquei → /Applications/Synquei.app (null se não for um .app). */
function macBundle(appExe) {
  if (!appExe) return null
  let p = path.posix.normalize(String(appExe))
  for (let i = 0; i < 4 && p !== '/'; i++) {
    if (p.endsWith('.app')) return p
    p = path.posix.dirname(p)
  }
  return null
}

/** Como o processo principal roda o script da troca. */
function handoffCommand(platform, script) {
  if (platform === 'darwin') return { cmd: '/bin/sh', args: [script] }
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script] }
  return null
}

/** O script está numa pasta de atualização dentro da pasta temporária do sistema? (o processo principal confere) */
function isHandoffScript(script, tmpRoot = os.tmpdir()) {
  if (typeof script !== 'string' || !path.isAbsolute(script) || script.includes('\0')) return false
  const name = path.basename(script)
  if (name !== 'trocar.sh' && name !== 'trocar.ps1') return false
  let real, root
  try {
    real = fs.realpathSync(script)
    root = fs.realpathSync(tmpRoot)
  } catch {
    return false
  }
  const rel = path.relative(root, real)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep)[0].startsWith(TMP_PREFIX)
}

/** Script do Mac: espera o app fechar, troca o .app (o antigo volta se algo falhar) e abre de novo. */
function macScript({ pid, app, novo, velho, marca, tmp, build }) {
  const falha = (motivo) => `printf '%s' ${shQuote(JSON.stringify({ build, motivo }))} > "$MARCA"`
  return `#!/bin/sh
# Synquei: troca o app pela versão nova depois que ele fechar (gerado por desktop/atualizador.cjs).
PID=${Number(pid)}
APP=${shQuote(app)}
NOVO=${shQuote(novo)}
VELHO=${shQuote(velho)}
MARCA=${shQuote(marca)}
TMP=${shQuote(tmp)}
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 240 ] && break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  ${falha('O app não fechou a tempo para trocar.')}
  rm -rf "$NOVO" "$TMP"
  exit 1
fi
rm -rf "$VELHO"
if mv "$APP" "$VELHO"; then
  if mv "$NOVO" "$APP"; then
    xattr -cr "$APP" 2>/dev/null
    rm -rf "$VELHO"
  else
    mv "$VELHO" "$APP"
    rm -rf "$NOVO"
    ${falha('O macOS não deixou pôr o app novo no lugar.')}
  fi
else
  rm -rf "$NOVO"
  ${falha('O macOS não deixou trocar o app.')}
fi
open "$APP"
rm -rf "$TMP"
`
}

/** Script do Windows: espera o app fechar, roda o instalador em silêncio e abre o app (se o instalador não abriu). */
function winScript({ pid, setup, exe, marca, tmp, build }) {
  const falha = (motivo) => `Set-Content -LiteralPath $marca -Value ${psQuote(JSON.stringify({ build, motivo }))} -Encoding UTF8`
  return `# Synquei: instala a versão nova depois que o app fechar (gerado por desktop/atualizador.cjs).
$ErrorActionPreference = 'Continue'
$appPid = ${Number(pid)}
$setup = ${psQuote(setup)}
$exe = ${psQuote(exe)}
$marca = ${psQuote(marca)}
$tmp = ${psQuote(tmp)}
try { Wait-Process -Id $appPid -Timeout 120 -ErrorAction Stop } catch {}
if (Get-Process -Id $appPid -ErrorAction SilentlyContinue) {
  ${falha('O app não fechou a tempo para atualizar.')}
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}
Unblock-File -LiteralPath $setup -ErrorAction SilentlyContinue
$ok = $false
try {
  # Espera só o instalador (Start-Process -Wait esperaria também o app que ele abre com --force-run).
  $p = Start-Process -FilePath $setup -ArgumentList '/S', '--updated', '--force-run' -PassThru -ErrorAction Stop
  $null = $p.Handle
  $p.WaitForExit()
  $ok = ($p.ExitCode -eq 0)
} catch {}
if (-not $ok) { ${falha('O instalador do Windows não terminou.')} }
Start-Sleep -Seconds 3
if (-not (Get-Process -Name 'Synquei' -ErrorAction SilentlyContinue)) {
  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }
}
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
`
}

function canWriteSync(p) {
  try {
    fs.accessSync(p, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr: String(stderr || '').trim() }))
      resolve(String(stdout || ''))
    })
  })
}

/** Baixa `url` para `file` calculando o SHA-256 no caminho (segue o redirecionamento do site para o GitHub). */
async function downloadTo(url, file, { fetchFn = globalThis.fetch, onProgress = () => {}, stallMs = STALL_MS, maxBytes = MAX_BYTES } = {}) {
  const ac = new AbortController()
  let stall = setTimeout(() => ac.abort(new Error('o download parou de andar')), stallMs)
  const poke = () => {
    clearTimeout(stall)
    stall = setTimeout(() => ac.abort(new Error('o download parou de andar')), stallMs)
  }
  const out = fs.createWriteStream(file, { mode: 0o600 })
  const closed = new Promise((resolve, reject) => {
    out.on('close', resolve)
    out.on('error', reject)
  })
  try {
    const res = await fetchFn(url, { redirect: 'follow', signal: ac.signal, headers: { accept: 'application/octet-stream' } })
    if (!res.ok || !res.body) throw new Error(`o site respondeu ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    if (total > maxBytes) throw new Error('o instalador é grande demais')
    const hash = crypto.createHash('sha256')
    let got = 0
    onProgress(0, total)
    for await (const chunk of res.body) {
      poke()
      got += chunk.length
      if (got > maxBytes) throw new Error('o instalador é grande demais')
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise((r, j) => (out.once('drain', r), out.once('error', j)))
      onProgress(got, total)
    }
    if (total && got !== total) throw new Error('o download veio incompleto')
    out.end()
    await closed
    return hash.digest('hex')
  } catch (err) {
    out.destroy()
    await closed.catch(() => {})
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : err
  } finally {
    clearTimeout(stall)
  }
}

const definitivo = (message) => Object.assign(new Error(message), { definitivo: true })
const deNovo = (message) => Object.assign(new Error(message), { deNovo: true })

/**
 * @fires Atualizador#change com status() a cada mudança (o progresso no máximo a cada 250 ms)
 *
 * status() = { atual, ultima, nova (build mais novo e não dispensado), dispensada, plataforma, podeAtualizar,
 *   motivo (por que não se atualiza sozinho), fase: null|'baixando'|'conferindo'|'preparando'|'pronto'|'reiniciando'|'erro',
 *   build, recebido, total, erro, deNovo, aplicar, verificando, verificadaEm, baixarUrl }
 */
class Atualizador extends EventEmitter {
  constructor({
    platform = process.platform,
    appExe = '',
    appPid = 0,
    stateDir = null,
    buildInfo = null,
    site = SITE,
    handoff = null,
    fetchJSON = null,
    download = null,
    run = execFileP,
    canWrite = canWriteSync,
    tmpRoot = os.tmpdir(),
    log = () => {},
    firstDelayMs = 10_000,
    everyMs = 60 * 60_000,
    retryBaseMs = 2 * 60_000,
    retryMaxMs = 30 * 60_000,
    progressMs = PROGRESS_MS,
  } = {}) {
    super()
    this.platform = platform
    this.plataforma = PLATAFORMAS[platform] || null
    this.appExe = String(appExe || '')
    this.appPid = Number(appPid) || 0
    this.stateDir = stateDir
    this.atual = cleanInfo(buildInfo) || { build: 0, commit: '', data: null }
    this.site = String(site).replace(/\/+$/, '')
    this.handoff = handoff
    this.fetchJSON =
      fetchJSON ||
      (async (url, opts) => {
        const r = await fetch(url, { ...opts, headers: { 'cache-control': 'no-cache' } })
        if (!r.ok) throw new Error(`o site respondeu ${r.status}`)
        return r.json()
      })
    this.download = download || ((url, file, onProgress) => downloadTo(url, file, { onProgress }))
    this.run = run
    this.canWrite = canWrite
    this.tmpRoot = tmpRoot
    this.log = log
    this.firstDelayMs = firstDelayMs
    this.everyMs = everyMs
    this.retryBaseMs = retryBaseMs
    this.retryMaxMs = retryMaxMs
    this.progressMs = progressMs
    // estado
    this.ultima = null
    this.verificando = false
    this.verificadaEm = null
    this.fase = null
    this.build = null
    this.recebido = 0
    this.total = 0
    this.erro = null
    this.deNovoFlag = false
    this.bloqueado = 0
    this.aplicar = false
    this.pronto = null
    this.job = null
    this.timer = null
    this.retryTimer = null
    this.tentativas = 0
    this.lastProgress = 0
    this.stopped = false
    this.prefs = this.#lerPrefs()
    this.motivo = this.#check()
    this.#lerMarca()
  }

  get enabled() {
    return this.atual.build > 0 && !!this.plataforma
  }

  get disponivel() {
    return !this.motivo
  }

  /** Por que este app não consegue se trocar sozinho (null = consegue). */
  #check() {
    if (!this.plataforma) return 'Neste sistema o app não se atualiza sozinho.'
    if (!this.handoff || !this.appExe || !this.appPid) return 'Só o app instalado se atualiza sozinho.'
    if (this.plataforma === 'mac') {
      const bundle = macBundle(this.appExe)
      if (!bundle) return 'Não encontrei o app para trocar.'
      if (bundle.includes('/AppTranslocation/')) return 'Mova o Synquei para Aplicativos e abra de novo para ele se atualizar sozinho.'
      if (bundle.startsWith('/Volumes/')) return 'O Synquei está aberto direto do disco de instalação. Arraste para Aplicativos e abra de lá.'
      if (!this.canWrite(path.posix.dirname(bundle)) || !this.canWrite(bundle)) return 'Sem permissão para trocar o app nesta pasta. Use Baixar.'
      this.bundle = bundle
    } else if (!this.canWrite(path.win32.dirname(this.appExe))) {
      return 'Sem permissão para trocar o app nesta pasta. Use Baixar.'
    }
    return null
  }

  #lerPrefs() {
    if (!this.stateDir) return {}
    try {
      const p = JSON.parse(fs.readFileSync(path.join(this.stateDir, PREFS_FILE), 'utf8'))
      return p && typeof p === 'object' ? p : {}
    } catch {
      return {}
    }
  }

  #gravarPrefs() {
    if (!this.stateDir) return
    try {
      fs.mkdirSync(this.stateDir, { recursive: true })
      fs.writeFileSync(path.join(this.stateDir, PREFS_FILE), JSON.stringify(this.prefs))
    } catch (err) {
      this.log('não consegui gravar as preferências da atualização:', err && err.message)
    }
  }

  /** A troca anterior falhou (o script deixou a marca): desliga o Atualizar daquele build e mostra o motivo. */
  #lerMarca() {
    if (!this.stateDir) return
    const file = path.join(this.stateDir, MARK_FILE)
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    try {
      fs.rmSync(file, { force: true })
    } catch {}
    try {
      const m = JSON.parse(raw.replace(/^﻿/, ''))
      const build = Number(m && m.build)
      this.bloqueado = Number.isSafeInteger(build) && build > 0 ? build : 0
      this.fase = 'erro'
      this.build = this.bloqueado || null
      this.erro = `A atualização anterior não terminou: ${m && typeof m.motivo === 'string' ? m.motivo.slice(0, 200) : 'algo deu errado.'} Use Baixar.`
    } catch {}
  }

  podeInstalar(build) {
    return this.disponivel && !(this.bloqueado && build <= this.bloqueado)
  }

  status() {
    const ultima = this.ultima
    const tem = !!(ultima && ultima.build > this.atual.build)
    const dispensada = tem && Number(this.prefs.dispensada) >= ultima.build
    const sha = ultima && ultima.sha256 ? ultima.sha256[this.plataforma] : null
    return {
      atual: this.atual,
      ultima: ultima ? { build: ultima.build, commit: ultima.commit, data: ultima.data } : null,
      nova: tem && !dispensada,
      dispensada,
      plataforma: this.plataforma,
      podeAtualizar: tem && !!sha && this.podeInstalar(ultima.build),
      motivo: this.motivo,
      fase: this.fase,
      build: this.build,
      recebido: this.recebido,
      total: this.total,
      erro: this.erro,
      deNovo: this.fase === 'erro' && this.deNovoFlag,
      aplicar: this.aplicar,
      verificando: this.verificando,
      verificadaEm: this.verificadaEm,
      baixarUrl: this.plataforma ? `${this.site}/baixar/${this.plataforma}` : `${this.site}/#baixar`,
    }
  }

  #emit() {
    const st = this.status()
    this.emit('change', st)
    return st
  }

  #set(patch, { progress = false } = {}) {
    Object.assign(this, patch)
    if (progress) {
      const now = Date.now()
      if (now - this.lastProgress < this.progressMs) return
      this.lastProgress = now
    }
    this.#emit()
  }

  // ───────── conferir o site ─────────

  start() {
    if (!this.enabled || this.stopped || this.timer) return
    this.#agendar(this.firstDelayMs)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    this.timer = this.retryTimer = null
  }

  #agendar(ms) {
    clearTimeout(this.timer)
    if (this.stopped) return
    this.timer = setTimeout(async () => {
      this.timer = null
      await this.check().catch(() => {})
      if (!this.stopped && !this.timer) this.#agendar(this.everyMs)
    }, ms)
    if (this.timer.unref) this.timer.unref()
  }

  /** Pergunta ao site agora. Nunca lança. */
  async check() {
    if (!this.enabled) return this.status()
    if (this.inflight) return this.inflight
    this.inflight = (async () => {
      this.#set({ verificando: true })
      try {
        const remote = parseRemote(await this.fetchJSON(`${this.site}/baixar/versao`, { signal: AbortSignal.timeout(15_000) }))
        if (!remote) throw new Error('resposta sem versão')
        this.ultima = remote
        this.verificadaEm = new Date().toISOString()
      } catch (err) {
        this.log('não consegui ver se há versão nova:', err && (err.code || err.message))
      } finally {
        this.inflight = null
      }
      this.#set({ verificando: false })
      this.#baixarSozinho()
      return this.status()
    })()
    return this.inflight
  }

  #pedido() {
    const build = this.ultima.build
    return { build, url: `${this.site}/baixar/${this.plataforma}?build=${build}`, sha256: this.ultima.sha256[this.plataforma] }
  }

  /** Build novo e não dispensado: baixa, confere e prepara já, em segundo plano. */
  #baixarSozinho(forcar = false) {
    if (this.stopped) return
    const st = this.status()
    if (!st.podeAtualizar || !st.nova) return
    const build = this.ultima.build
    if (this.job || (this.pronto && this.pronto.build >= build) || this.fase === 'reiniciando') return
    if (this.fase === 'erro' && this.build === build && !forcar) return
    if (this.build !== build) this.tentativas = 0
    this.#preparar(this.#pedido())
  }

  #tentarDeNovo() {
    if (this.stopped || this.retryTimer) return
    const ms = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** this.tentativas)
    this.tentativas++
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null
      await this.check()
      this.#baixarSozinho(true)
    }, ms)
    if (this.retryTimer.unref) this.retryTimer.unref()
  }

  // ───────── ações da interface ─────────

  /** "Depois": esconde este build até sair um mais novo. */
  depois() {
    if (this.ultima) {
      this.prefs.dispensada = this.ultima.build
      this.#gravarPrefs()
    }
    return this.#emit()
  }

  /** "Tentar de novo" depois de um erro. */
  async tentar() {
    if (this.fase === 'erro') this.#set({ fase: null, erro: null })
    await this.check()
    this.#baixarSozinho(true)
    return this.status()
  }

  /** "Atualizar agora": troca se estiver pronto; senão baixa e troca no fim. */
  async aplicarAgora() {
    if (this.pronto && this.ultima && this.pronto.build >= this.ultima.build) return this.#trocar()
    const st = this.status()
    if (!st.podeAtualizar) throw new Error(this.motivo || 'Esta versão não dá para instalar pelo app. Use Baixar.')
    this.#set({ aplicar: true })
    if (!this.job) this.#preparar(this.#pedido())
    return this.status()
  }

  // ───────── baixar, conferir e preparar ─────────

  #preparar({ build, url, sha256 }) {
    const hash = String(sha256 || '').toLowerCase()
    if (!SHA256.test(hash)) {
      this.bloqueado = Math.max(this.bloqueado, build)
      this.#set({ fase: 'erro', build, erro: 'O site não publicou a conferência (SHA-256) desta versão. Use Baixar.' })
      return Promise.resolve(this.status())
    }
    this.#set({ fase: 'baixando', build, recebido: 0, total: 0, erro: null })
    this.job = this.#prepararJob({ build, url, sha256: hash }).finally(() => {
      this.job = null
    })
    this.job.then((st) => {
      if (st.fase === 'pronto') {
        this.tentativas = 0
        if (this.aplicar) this.#trocar()
      } else if (st.fase === 'erro' && st.deNovo) this.#tentarDeNovo()
    })
    return this.job
  }

  async #prepararJob({ build, url, sha256 }) {
    await this.#descartar()
    await this.#limparSobras()
    const tmp = await fsp.mkdtemp(path.join(this.tmpRoot, TMP_PREFIX))
    let guardado = false
    try {
      const file = path.join(tmp, this.plataforma === 'mac' ? 'Synquei.dmg' : 'Synquei-setup.exe')
      let got
      try {
        got = await this.download(url, file, (recebido, total) => this.#set({ recebido, total }, { progress: true }))
      } catch (err) {
        this.log('não consegui baixar a versão nova:', err && err.message)
        throw deNovo('Não consegui baixar a versão nova. Confira a internet: tento de novo daqui a pouco.')
      }
      this.#set({ fase: 'conferindo', recebido: this.total || this.recebido })
      if (String(got).toLowerCase() !== sha256) throw deNovo('A versão nova ainda está sendo publicada. Tento de novo em alguns minutos.')
      this.#set({ fase: 'preparando' })
      const script = this.plataforma === 'mac' ? await this.#prepararMac({ file, tmp, build }) : await this.#prepararWin({ file, tmp, build })
      this.pronto = { build, script, tmp, novo: this.plataforma === 'mac' ? this.novoApp : null }
      guardado = true
      this.deNovoFlag = false
      this.#set({ fase: 'pronto', build })
      return this.status()
    } catch (err) {
      if (err && err.definitivo) this.bloqueado = Math.max(this.bloqueado, build)
      this.deNovoFlag = !!(err && err.deNovo)
      this.#set({ fase: 'erro', aplicar: false, erro: (err && err.message) || 'Algo deu errado ao atualizar. Use Baixar.' })
      return this.status()
    } finally {
      if (!guardado) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  async #trocar() {
    const p = this.pronto
    if (this.fase === 'reiniciando') return this.status()
    if (!p) throw new Error('A versão nova ainda não está pronta.')
    if (!fs.existsSync(p.script)) {
      this.pronto = null
      this.#set({ fase: 'erro', aplicar: false, erro: 'A versão baixada sumiu da pasta temporária. Tente de novo.' })
      return this.status()
    }
    this.#set({ fase: 'reiniciando' })
    try {
      await this.handoff({ script: p.script })
    } catch (err) {
      this.log('não consegui entregar a troca:', err && err.message)
      this.#set({ fase: 'erro', aplicar: false, erro: 'Não consegui reiniciar o app para atualizar. Use Baixar.' })
    }
    return this.status()
  }

  async #descartar() {
    const p = this.pronto
    this.pronto = null
    if (p && p.tmp) await fsp.rm(p.tmp, { recursive: true, force: true }).catch(() => {})
    if (p && p.novo) await this.run('/bin/rm', ['-rf', p.novo]).catch(() => {})
  }

  /** Pastas de atualizações antigas que ficaram para trás (o app fechou com uma versão pronta e não trocou). */
  async #limparSobras() {
    let nomes = []
    try {
      nomes = await fsp.readdir(this.tmpRoot)
    } catch {
      return
    }
    const limite = Date.now() - 60 * 60_000
    for (const n of nomes) {
      if (!n.startsWith(TMP_PREFIX)) continue
      const p = path.join(this.tmpRoot, n)
      try {
        if ((await fsp.stat(p)).mtimeMs < limite) await fsp.rm(p, { recursive: true, force: true })
      } catch {}
    }
  }

  async #prepararMac({ file, tmp, build }) {
    const bundle = this.bundle
    const parent = path.posix.dirname(bundle)
    const base = path.posix.basename(bundle, '.app')
    const novo = path.posix.join(parent, `.${base}-atualizacao.app`)
    const velho = path.posix.join(parent, `.${base}-antigo.app`)
    this.novoApp = novo
    const mount = path.join(tmp, 'montagem')
    await fsp.mkdir(mount)
    try {
      await this.run('hdiutil', ['attach', file, '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mount, '-quiet'])
    } catch (err) {
      this.log('hdiutil attach falhou:', err && (err.stderr || err.message))
      throw definitivo('Não consegui abrir o instalador baixado. Use Baixar.')
    }
    try {
      const apps = (await fsp.readdir(mount)).filter((n) => n.endsWith('.app'))
      const src = apps.includes(`${base}.app`) ? `${base}.app` : apps.find((n) => /^Synquei.*\.app$/.test(n))
      if (!src) throw definitivo('O instalador baixado não tem o app dentro. Use Baixar.')
      await this.run('/bin/rm', ['-rf', novo]).catch(() => {
        throw definitivo('Uma atualização antiga ficou presa na pasta de Aplicativos. Use Baixar.')
      })
      try {
        await this.run('ditto', [path.join(mount, src), novo])
      } catch (err) {
        this.log('ditto falhou:', err && (err.stderr || err.message))
        await this.run('/bin/rm', ['-rf', novo]).catch(() => {})
        throw definitivo('Não consegui copiar o app novo para a pasta de Aplicativos. Use Baixar.')
      }
    } finally {
      await this.run('hdiutil', ['detach', mount, '-quiet']).catch(() => this.run('hdiutil', ['detach', mount, '-force', '-quiet']).catch(() => {}))
    }
    await this.run('xattr', ['-cr', novo]).catch(() => {})
    const script = path.join(tmp, 'trocar.sh')
    const marca = path.join(this.stateDir || tmp, MARK_FILE)
    await fsp.writeFile(script, macScript({ pid: this.appPid, app: bundle, novo, velho, marca, tmp, build }), { mode: 0o700 })
    return script
  }

  async #prepararWin({ file, tmp, build }) {
    const script = path.join(tmp, 'trocar.ps1')
    const marca = path.join(this.stateDir || tmp, MARK_FILE)
    // BOM: o PowerShell 5 lê o script como UTF-8 (acentos nos caminhos e nas mensagens).
    await fsp.writeFile(script, '﻿' + winScript({ pid: this.appPid, setup: file, exe: this.appExe, marca, tmp, build }), { mode: 0o700 })
    return script
  }
}

module.exports = { Atualizador, readBuildInfo, parseRemote, macBundle, handoffCommand, isHandoffScript, macScript, winScript, shQuote, psQuote, downloadTo, BAIXANDO, SITE }
