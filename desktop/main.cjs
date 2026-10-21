// Synquei · app de desktop (Mac e Windows). É o mesmo app do navegador, servido de dentro do pacote por um protocolo
// próprio (synquei://app/…), com duas vantagens: o caminho completo de cada arquivo vai para as exportações (o editor
// acha a mídia sem revincular) e o Chromium do Electron traz decodificador de AAC e H.264 (celulares, GoPro, miniaturas).
//
// `--smoke` (CI, depois do build): abre o app, monta o projeto de exemplo, sincroniza, exporta e escreve "SMOKE OK".

const { app, BrowserWindow, Menu, protocol, shell, session, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

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

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

// Um app só: abrir de novo traz a janela que já existe para a frente.
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit()

let win = null

function serve() {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url)
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
        { label: 'Projetos', accelerator: 'CmdOrCtrl+1', click: tab('projetos') },
        { label: 'Mídia', accelerator: 'CmdOrCtrl+2', click: tab('midia') },
        { label: 'Sincronizar', accelerator: 'CmdOrCtrl+3', click: tab('sincronizar') },
        { label: 'Linha do tempo', accelerator: 'CmdOrCtrl+4', click: tab('linha') },
        { label: 'Exportar', accelerator: 'CmdOrCtrl+5', click: tab('exportar') },
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit()
})

process.on('uncaughtException', (err) => {
  if (SMOKE) {
    console.error(err)
    app.exit(1)
  } else dialog.showErrorBox('Synquei', String(err && err.stack ? err.stack : err))
})
