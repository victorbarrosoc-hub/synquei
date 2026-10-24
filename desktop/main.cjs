// Synquei · app de desktop (Mac e Windows). É o mesmo app do navegador, servido de dentro do pacote por um protocolo
// próprio (synquei://app/…), com duas vantagens: o caminho completo de cada arquivo vai para as exportações (o editor
// acha a mídia sem revincular) e o Chromium do Electron traz decodificador de AAC e H.264 (celulares, GoPro, miniaturas).
//
// `--smoke` (CI, depois do build): abre o app, monta o projeto de exemplo, sincroniza, exporta e escreve "SMOKE OK".

const { app, BrowserWindow, Menu, protocol, shell, session, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { Atualizador, readBuildInfo, handoffCommand, isHandoffScript } = require('./atualizador.cjs')
const { Organizador } = require('./organizador.cjs')
const { Ponte, pastaTroca } = require('./davinci.cjs')

const SCHEME = 'synquei'
const ROOT = path.join(__dirname, '..')
const SMOKE = process.argv.includes('--smoke')
const SMOKE_OUT = process.env.SYNQUEI_SMOKE_SAIDA || null

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// clipes servidos para a página (Organizar): o <video> pede pedaços (Range) e a leitura dos formatos também
const MIME_MIDIA = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac' }

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

// Um app só: abrir de novo traz a janela que já existe para a frente.
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit()

let win = null
let org = null
let ponte = null

/** synquei://app/__midia?c=<caminho>: um arquivo de uma pasta vigiada pelo Organizar, com Range. */
async function midia(req, u) {
  const abs = u.searchParams.get('c') || ''
  if (!org || !path.isAbsolute(abs) || !org.permitido(abs)) return new Response('Fora das pastas vigiadas', { status: 403 })
  let st
  try {
    st = await fsp.stat(abs)
    if (!st.isFile()) throw new Error('não é arquivo')
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
  const type = MIME_MIDIA[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '')
  if (!m) {
    const body = st.size ? Readable.toWeb(fs.createReadStream(abs)) : null
    return new Response(body, { status: 200, headers: { ...base, 'content-length': String(st.size) } })
  }
  let a = m[1] === '' ? Math.max(0, st.size - Number(m[2] || 0)) : Number(m[1])
  let b = m[1] === '' || m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1)
  if (a >= st.size || b < a) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${st.size}` } })
  return new Response(Readable.toWeb(fs.createReadStream(abs, { start: a, end: b })), { status: 206, headers: { ...base, 'content-length': String(b - a + 1), 'content-range': `bytes ${a}-${b}/${st.size}` } })
}

function serve() {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url)
    if (u.pathname === '/__midia') return midia(req, u)
    let rel = decodeURIComponent(u.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = path.normalize(path.join(ROOT, rel))
    // nada fora da pasta do app
    if (!file.startsWith(ROOT + path.sep)) return new Response('Fora do app', { status: 403 })
    try {
      const body = await fsp.readFile(file)
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } })
    } catch {
      return new Response('Não encontrado', { status: 404 })
    }
  })
}

function createWindow() {
  const mac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Synquei',
    backgroundColor: '#fbfbfd',
    titleBarStyle: mac ? 'hiddenInset' : 'default',
    trafficLightPosition: mac ? { x: 18, y: 18 } : undefined,
    autoHideMenuBar: !mac,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => !SMOKE && win.show())
  // links para fora (site, documentação) abrem no navegador; dentro do app, só synquei://
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })
  win.loadURL(`${SCHEME}://app/app/index.html`)
  return win
}

function run(js) {
  return win && win.webContents.executeJavaScript(js, true)
}

function menu() {
  const mac = process.platform === 'darwin'
  const tab = (r) => () => run(`location.hash = '#/${r}'`)
  const template = [
    ...(mac ? [{ label: 'Synquei', submenu: [{ role: 'about', label: 'Sobre o Synquei' }, { type: 'separator' }, { role: 'hide', label: 'Ocultar o Synquei' }, { role: 'hideOthers', label: 'Ocultar outros' }, { role: 'unhide', label: 'Mostrar todos' }, { type: 'separator' }, { role: 'quit', label: 'Sair do Synquei' }] }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Novo projeto…', accelerator: 'CmdOrCtrl+N', click: () => run(`document.dispatchEvent(new CustomEvent('synquei:acao', { detail: 'novo' }))`) },
        { label: 'Fechar projeto', accelerator: 'CmdOrCtrl+Shift+W', click: () => run(`document.dispatchEvent(new CustomEvent('synquei:acao', { detail: 'fechar' }))`) },
        { type: 'separator' },
        { label: 'Adicionar pasta…', accelerator: 'CmdOrCtrl+O', click: () => run(`document.getElementById('pickFolder').click()`) },
        { label: 'Adicionar arquivos…', accelerator: 'CmdOrCtrl+Shift+O', click: () => run(`document.getElementById('pickFiles').click()`) },
        { type: 'separator' },
        { label: 'Abrir o projeto de exemplo', click: () => run(`location.hash = '#/exemplo'`) },
        { type: 'separator' },
        mac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' },
      ],
    },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    {
      label: 'Ir',
      submenu: [
        { label: 'Início', accelerator: 'CmdOrCtrl+1', click: tab('inicio') },
        { label: 'Mídia', accelerator: 'CmdOrCtrl+2', click: tab('midia') },
        { label: 'Sincronizar', accelerator: 'CmdOrCtrl+3', click: tab('sincronizar') },
        { label: 'Linha do tempo', accelerator: 'CmdOrCtrl+4', click: tab('linha') },
        { label: 'Exportar', accelerator: 'CmdOrCtrl+5', click: tab('exportar') },
        { type: 'separator' },
        { label: 'Projetos', accelerator: 'CmdOrCtrl+6', click: tab('projetos') },
        { label: 'Organizar (SOBEDESCE › DaVinci)', accelerator: 'CmdOrCtrl+7', click: tab('organizar') },
        { type: 'separator' },
        { label: 'Formatos', click: tab('formatos') },
        { label: 'Ajustes', accelerator: 'CmdOrCtrl+,', click: tab('ajustes') },
      ],
    },
    { label: 'Visualizar', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Janela', role: 'window', submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom', label: 'Zoom' }, ...(mac ? [{ role: 'front', label: 'Trazer tudo para a frente' }] : [])] },
    { label: 'Ajuda', role: 'help', submenu: [{ label: 'Site do Synquei', click: () => shell.openExternal('https://synquei.vercel.app') }, { label: 'Formatos aceitos', click: () => shell.openExternal('https://synquei.vercel.app/formatos/') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// só a página do app (synquei://) fala com o processo principal
const daPagina = (e) => {
  try {
    return new URL(e.senderFrame.url).protocol === `${SCHEME}:`
  } catch {
    return false
  }
}
const handle = (canal, fn) =>
  ipcMain.handle(canal, async (e, ...a) => {
    if (!daPagina(e)) throw new Error('não permitido')
    return fn(...a)
  })
const enviar = (canal, dado) => {
  if (win && !win.isDestroyed()) win.webContents.send(canal, dado)
}

// ───────── Organizar: pasta do SOBEDESCE → Synquei → DaVinci (desktop/organizador.cjs e davinci.cjs) ─────────
function iniciarOrganizar() {
  const userData = app.getPath('userData')
  org = new Organizador({ stateDir: userData, log: (...a) => console.log('[organizar]', ...a) })
  ponte = new Ponte({ troca: pastaTroca(process.platform, userData), log: (...a) => console.log('[davinci]', ...a) })
  org.on('cartao', (ev) => enviar('synquei:org-cartao', ev))
  org.on('mudou', (st) => enviar('synquei:org-estado', st))
  ponte.on('mudou', (st) => enviar('synquei:davinci', st))
  ponte.on('resposta', (r) => enviar('synquei:davinci-resposta', r))
  handle('org:estado', () => org.estado())
  handle('org:escolher', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pasta do projeto no SOBEDESCE', buttonLabel: 'Organizar esta pasta', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const p = await org.adicionar(r.filePaths[0])
    return p.id
  })
  handle('org:remover', (id) => org.remover(String(id)))
  handle('org:ligar', (id, ligado) => org.ligar(String(id), !!ligado))
  handle('org:vincular', (id, dados) => org.vincular(String(id), dados || {}))
  handle('org:marcar', (pastaId, cartaoId, estado, erro) => org.marcar(String(pastaId), String(cartaoId), String(estado), erro ? String(erro) : null))
  handle('org:pendentes', (pastaId) => org.pendentes(String(pastaId)))
  handle('org:todos', (pastaId) => org.todos(String(pastaId)))
  handle('org:assets', (pastaId) => org.assets(String(pastaId)))
  handle('org:escrever', (pastaId, rel, texto) => org.escrever(String(pastaId), String(rel), String(texto)))
  handle('org:abrir', (pastaId) => {
    const raiz = org.raizDe(String(pastaId))
    return raiz ? shell.openPath(raiz) : null
  })
  handle('davinci:status', () => ponte.status())
  handle('davinci:instalar', () => ponte.instalar())
  handle('davinci:enviar', (pedido) => ponte.enviar(pedido))
  org.start()
  ponte.start()
}

// ───────── atualização pelo próprio app (desktop/atualizador.cjs) ─────────
let atu = null

/** O atualizador preparou a troca: roda o script solto (ele espera o app fechar, troca e abre de novo) e fecha. */
function runUpdateHandoff({ script }) {
  return new Promise((resolve, reject) => {
    const command = isHandoffScript(script) ? handoffCommand(process.platform, script) : null
    if (!command) return reject(new Error('script de atualização inválido'))
    let child
    try {
      child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (err) {
      return reject(err)
    }
    child.once('error', reject)
    // só fecha depois que o script de fato começou (senão o app fecharia sem ninguém para abrir de novo)
    child.once('spawn', () => {
      child.unref()
      resolve()
      setTimeout(() => app.quit(), 150)
    })
  })
}

function iniciarAtualizador() {
  atu = new Atualizador({
    // só para testar o aviso fora do Mac/Windows (nunca no app empacotado)
    platform: (!app.isPackaged && process.env.SYNQUEI_ATU_PLATAFORMA) || process.platform,
    appExe: app.isPackaged ? process.execPath : '',
    appPid: app.isPackaged ? process.pid : 0,
    stateDir: app.getPath('userData'),
    buildInfo: readBuildInfo(path.join(__dirname, 'build-info.json')),
    handoff: runUpdateHandoff,
    log: (...a) => console.log('[atualização]', ...a),
  })
  atu.on('change', (st) => {
    if (win && !win.isDestroyed()) win.webContents.send('synquei:atualizacao', st)
  })
  handle('atu:status', () => atu.status())
  handle('atu:verificar', () => atu.check())
  handle('atu:aplicar', () => atu.aplicarAgora())
  handle('atu:depois', () => atu.depois())
  handle('atu:tentar', () => atu.tentar())
  handle('atu:baixar', () => shell.openExternal(atu.status().baixarUrl))
  atu.start()
}

// ───────── teste de fumaça ─────────
async function smoke() {
  const lines = []
  const log = (s) => {
    lines.push(s)
    console.log(s)
  }
  const done = (ok) => {
    log(ok ? 'SMOKE OK' : 'SMOKE FALHOU')
    if (SMOKE_OUT) fs.writeFileSync(SMOKE_OUT, lines.join('\n') + '\n')
    app.exit(ok ? 0 : 1)
  }
  const timer = setTimeout(() => {
    log('tempo esgotado (3 min)')
    done(false)
  }, 180000)
  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
    log(`Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · ${process.platform}-${process.arch}`)
    const r = await run(`(async () => {
      const wait = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('esperou demais'); await new Promise((r) => setTimeout(r, 100)) } }
      await wait(() => window.__synquei, 15000)
      const aac = typeof AudioDecoder !== 'undefined' && (await AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })).supported
      const desk = !!(window.synqueiDesktop && window.synqueiDesktop.isDesktop)
      location.hash = '#/exemplo'
      await wait(() => { const s = window.__synquei.S; return s.project && s.project.clips.length === 6 && !s.probe.active }, 60000)
      const st = await (await import('/app/js/store.js')).runSync()
      const { zipAll } = await import('/app/js/export/index.js')
      const zip = zipAll(window.__synquei.S.project)
      return { aac, desk, total: st.total, audio: st.audio, unsynced: st.unsynced, zip: zip.length }
    })()`)
    log(`desktop: ${r.desk} · AAC no navegador do app: ${r.aac}`)
    log(`exemplo: ${r.audio}/${r.total} sincronizados pelo som, ${r.unsynced} de fora, zip com ${r.zip} bytes`)
    clearTimeout(timer)
    done(r.desk && r.total === 6 && r.audio === 6 && r.unsynced === 0 && r.zip > 1000)
  } catch (err) {
    clearTimeout(timer)
    log(`erro: ${err && err.message ? err.message : err}`)
    done(false)
  }
}

app.whenReady().then(() => {
  serve()
  // nada de câmera, microfone ou localização: o app só lê arquivos que você escolhe
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'))
  menu()
  createWindow()
  if (SMOKE) smoke()
  else {
    iniciarAtualizador()
    iniciarOrganizar()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('before-quit', () => {
  if (atu) atu.stop()
  if (org) org.stop()
  if (ponte) ponte.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit()
})

process.on('uncaughtException', (err) => {
  if (SMOKE) {
    console.error(err)
    app.exit(1)
  } else dialog.showErrorBox('Synquei', String(err && err.stack ? err.stack : err))
})
