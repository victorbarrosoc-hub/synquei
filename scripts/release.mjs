// Ajudantes do Release do app de desktop, usados pelo GitHub Actions (.github/workflows/desktop.yml).
//
//   node scripts/release.mjs nomear <mac|windows> <dist> <saida>
//       põe o número do build no nome do instalador (Synquei-1.0.0-b42-mac-universal.dmg) e grava o SHA-256 em
//       <dist>/Synquei-sha256-b42-<plataforma>.json (vai para o Release junto do instalador). Com o build no nome, o
//       build seguinte não troca o arquivo que o site está entregando.
//   node scripts/release.mjs versao <pasta-dos-sha> <versao.json>
//       (a pasta vem do Release: gh release download app-desktop -p 'Synquei-sha256-b42-*') junta os dois SHA-256 no versao.json que o site serve em /baixar/versao (os instaladores de uma linha conferem).
//   node scripts/release.mjs limpar <build>
//       tira do Release os instaladores de builds antigos (fica o atual e os dois anteriores).

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const REPO = process.env.GITHUB_REPOSITORY || 'victorbarrosoc-hub/synquei'
export const TAG = 'app-desktop'
const build = () => Number(process.env.GITHUB_RUN_NUMBER || 0)

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })

async function nomear(plataforma, dist, saida) {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
  const files = await fs.readdir(dist)
  const achado = plataforma === 'mac' ? files.find((f) => f.endsWith('.dmg')) : files.find((f) => f.endsWith('-windows-setup.exe'))
  if (!achado) throw new Error(`instalador de ${plataforma} não encontrado em ${dist}`)
  const nome = plataforma === 'mac' ? `Synquei-${pkg.version}-b${build()}-mac-universal.dmg` : `Synquei-${pkg.version}-b${build()}-windows-setup.exe`
  await fs.rename(path.join(dist, achado), path.join(dist, nome))
  const hash = await sha256(path.join(dist, nome))
  await fs.mkdir(saida, { recursive: true })
  await fs.writeFile(path.join(saida, `Synquei-sha256-b${build()}-${plataforma}.json`), JSON.stringify({ arquivo: nome, sha256: hash }))
  console.log(`${nome} ${hash}`)
}

async function versao(pasta, out) {
  const files = await fs.readdir(pasta)
  const ler = async (p) => {
    const f = files.find((x) => x.endsWith(`-b${build()}-${p}.json`))
    if (!f) throw new Error(`SHA-256 de ${p} do build ${build()} não está em ${pasta}`)
    return JSON.parse(await fs.readFile(path.join(pasta, f), 'utf8'))
  }
  const mac = await ler('mac')
  const win = await ler('windows')
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
  const v = { build: build(), versao: pkg.version, commit: process.env.GITHUB_SHA || '', data: new Date().toISOString(), arquivoMac: mac.arquivo, sha256Mac: mac.sha256, arquivoWindows: win.arquivo, sha256Windows: win.sha256 }
  await fs.writeFile(out, JSON.stringify(v, null, 2))
  console.log(JSON.stringify(v))
}

async function limpar(atual) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('sem GITHUB_TOKEN')
  const api = (u, init = {}) => fetch(`https://api.github.com/repos/${REPO}${u}`, { ...init, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, ...(init.headers || {}) } })
  const r = await api(`/releases/tags/${TAG}`)
  if (!r.ok) throw new Error(`release ${r.status}`)
  const rel = await r.json()
  for (const a of rel.assets || []) {
    const m = /-b(\d+)-/.exec(a.name)
    if (m && Number(m[1]) < atual - 2) {
      const d = await api(`/releases/assets/${a.id}`, { method: 'DELETE' })
      console.log(`apagado ${a.name} (${d.status})`)
    }
  }
}

const [cmd, ...args] = process.argv.slice(2)
const run = { nomear: () => nomear(...args), versao: () => versao(...args), limpar: () => limpar(Number(args[0])) }[cmd]
if (!run) {
  console.error('uso: release.mjs nomear|versao|limpar …')
  process.exit(2)
}
run().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
