// Atualização pelo próprio app (desktop/atualizador.cjs): confere o site, baixa, confere o SHA-256, prepara a troca e
// entrega o script ao processo principal. Download, comandos e site são falsos.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const { Atualizador, parseRemote, macBundle, macScript, winScript, isHandoffScript, shQuote, psQuote } = require('../desktop/atualizador.cjs')

const CONTEUDO = Buffer.from('instalador de mentira')
const SHA = createHash('sha256').update(CONTEUDO).digest('hex')
const espera = (fn, ms = 3000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => (fn() ? resolve() : Date.now() - t0 > ms ? reject(new Error('esperou demais')) : setTimeout(tick, 10))
    tick()
  })

function montar({ platform = 'win32', build = 5, remoto = 7, sha = SHA, conteudo = CONTEUDO, ...rest } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'atu-teste-'))
  const state = join(tmp, 'dados')
  mkdirSync(state)
  const runs = []
  const handoffs = []
  const a = new Atualizador({
    platform,
    appExe: platform === 'darwin' ? '/Applications/Synquei.app/Contents/MacOS/Synquei' : 'C:\\Users\\v\\AppData\\Local\\Programs\\Synquei\\Synquei.exe',
    appPid: 4242,
    stateDir: state,
    buildInfo: { build, data: '2026-10-21T10:00:00Z' },
    handoff: async (job) => handoffs.push(job),
    fetchJSON: async () => ({ build: remoto, data: '2026-10-22T10:00:00Z', sha256Mac: sha, sha256Windows: sha }),
    download: async (url, file, onProgress) => {
      onProgress(conteudo.length, conteudo.length)
      writeFileSync(file, conteudo)
      a.ultimaUrl = url
      return createHash('sha256').update(conteudo).digest('hex')
    },
    run: async (cmd, args) => {
      runs.push([cmd, ...args])
      if (cmd === 'hdiutil' && args[0] === 'attach') mkdirSync(join(args[args.indexOf('-mountpoint') + 1], 'Synquei.app'), { recursive: true })
      return ''
    },
    canWrite: () => true,
    tmpRoot: tmp,
    firstDelayMs: 1,
    retryBaseMs: 60_000,
    ...rest,
  })
  return { a, runs, handoffs, state, tmp }
}

test('versão do site: só com build de verdade; SHA-256 conferido', () => {
  assert.equal(parseRemote({ build: 0 }), null)
  const r = parseRemote({ build: 9, sha256Mac: 'A'.repeat(64), sha256Windows: 'x' })
  assert.equal(r.build, 9)
  assert.equal(r.sha256.mac, 'a'.repeat(64))
  assert.equal(r.sha256.windows, null)
  assert.equal(macBundle('/Applications/Synquei.app/Contents/MacOS/Synquei'), '/Applications/Synquei.app')
  assert.equal(shQuote("a'b"), `'a'\\''b'`)
  assert.equal(psQuote("a'b"), "'a''b'")
})

test('Windows: vê o build novo, baixa sozinho, confere e no "Atualizar agora" entrega o script', async () => {
  const { a, handoffs } = montar()
  await a.check()
  await espera(() => a.status().fase === 'pronto')
  const st = a.status()
  assert.equal(st.nova, true)
  assert.equal(st.podeAtualizar, true)
  assert.match(a.ultimaUrl, /\/baixar\/windows\?build=7$/)
  await a.aplicarAgora()
  assert.equal(handoffs.length, 1)
  assert.ok(handoffs[0].script.endsWith('trocar.ps1'))
  const ps = readFileSync(handoffs[0].script, 'utf8')
  assert.match(ps, /'\/S', '--updated', '--force-run'/)
  assert.match(ps, /\$appPid = 4242/)
  assert.ok(isHandoffScript(handoffs[0].script, a.tmpRoot))
  assert.equal(a.status().fase, 'reiniciando')
})

test('Mac: monta o .dmg, copia o app para o lado e o script troca e abre de novo', async () => {
  const { a, runs, handoffs } = montar({ platform: 'darwin' })
  await a.check()
  await espera(() => a.status().fase === 'pronto')
  assert.ok(runs.some((r) => r[0] === 'hdiutil' && r[1] === 'attach'))
  assert.ok(runs.some((r) => r[0] === 'ditto' && r[2] === '/Applications/.Synquei-atualizacao.app'))
  assert.ok(runs.some((r) => r[0] === 'xattr'))
  await a.aplicarAgora()
  const sh = readFileSync(handoffs[0].script, 'utf8')
  assert.match(sh, /APP='\/Applications\/Synquei.app'/)
  assert.match(sh, /open "\$APP"/)
})

test('arquivo que não bate com o SHA-256 não é instalado', async () => {
  const { a, handoffs } = montar({ conteudo: Buffer.from('outra coisa') })
  await a.check()
  await espera(() => a.status().fase === 'erro')
  assert.equal(a.status().deNovo, true)
  await assert.rejects(a.aplicarAgora().then(() => (handoffs.length ? null : Promise.reject(new Error('sem troca')))))
  assert.equal(handoffs.length, 0)
  a.stop()
})

test('"Depois" esconde este build até sair um mais novo; mesma versão ou dev não avisa', async () => {
  const m = montar()
  await m.a.check()
  m.a.depois()
  assert.equal(m.a.status().nova, false)
  assert.equal(JSON.parse(readFileSync(join(m.state, 'atualizacao.json'), 'utf8')).dispensada, 7)
  const igual = montar({ build: 7, remoto: 7 })
  await igual.a.check()
  assert.equal(igual.a.status().nova, false)
  const dev = montar({ build: 0 })
  assert.equal(dev.a.enabled, false)
  await dev.a.check()
  assert.equal(dev.a.status().ultima, null)
})

test('troca que falhou deixa marca: o aviso mostra o motivo e oferece Baixar para aquele build', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'atu-marca-'))
  writeFileSync(join(tmp, 'atualizacao-falhou.json'), JSON.stringify({ build: 7, motivo: 'O macOS não deixou trocar o app.' }))
  const { a } = montar({ stateDir: tmp })
  assert.match(a.status().erro, /não deixou trocar/)
  assert.equal(existsSync(join(tmp, 'atualizacao-falhou.json')), false)
  await a.check()
  assert.equal(a.status().podeAtualizar, false)
})

test('app aberto do disco de instalação ou sem permissão não se troca sozinho', () => {
  const vol = montar({ platform: 'darwin', appExe: '/Volumes/Synquei/Synquei.app/Contents/MacOS/Synquei' })
  assert.match(vol.a.motivo, /disco de instalação/)
  const sem = montar({ canWrite: () => false })
  assert.match(sem.a.motivo, /permissão/)
  const dev = montar({ appExe: '' })
  assert.match(dev.a.motivo, /instalado/)
})

test('scripts gerados escapam caminhos com aspas', () => {
  const sh = macScript({ pid: 1, app: "/Applications/Syn'quei.app", novo: '/a', velho: '/b', marca: '/m', tmp: '/t', build: 3 })
  assert.match(sh, /APP='\/Applications\/Syn'\\''quei.app'/)
  const ps = winScript({ pid: 1, setup: "C:\\it's\\s.exe", exe: 'C:\\x.exe', marca: 'C:\\m', tmp: 'C:\\t', build: 3 })
  assert.match(ps, /\$setup = 'C:\\it''s\\s.exe'/)
})
