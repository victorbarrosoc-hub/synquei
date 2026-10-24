// Organizar (desktop/organizador.cjs): a pasta de um projeto do SOBEDESCE vira eventos de cartão, pelo resumo
// descargas.jsonl ou, sem ele, pelas pastas e o relatório .xxh64. Pastas temporárias, nada de Electron.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { Organizador, donoDaPasta, numeroDiaria, IGNORAR } = require('../desktop/organizador.cjs')

function arquivo(raiz, rel, conteudo = 'x') {
  const abs = join(raiz, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, conteudo)
  return abs
}

function montar() {
  const tmp = mkdtempSync(join(tmpdir(), 'org-teste-'))
  const raiz = join(tmp, 'HD', 'Filme X')
  mkdirSync(raiz, { recursive: true })
  const org = new Organizador({ stateDir: join(tmp, 'dados'), intervaloMs: 20 })
  const eventos = []
  org.on('cartao', (e) => eventos.push(e))
  return { tmp, raiz, org, eventos }
}

const linha = (o) => JSON.stringify({ v: 1, app: 'sobedesce', resultado: 'ok', ...o }) + '\n'

test('nomes das pastas do SOBEDESCE', () => {
  assert.deepEqual(donoDaPasta('Aladim - FX30'), { nome: 'Aladim', camera: 'FX30', pasta: 'Aladim - FX30' })
  assert.deepEqual(donoDaPasta('01_CAMERA_A'), { nome: '01_CAMERA_A', camera: '', pasta: '01_CAMERA_A' })
  assert.equal(numeroDiaria('Diária 03'), 3)
  assert.equal(numeroDiaria('Diaria 12'), 12)
  assert.equal(numeroDiaria('Cenas'), null)
  for (const r of ['a/.sobedesce-anteriores/x.xml', 'a/C0001.MP4.sobedesce-parcial', 'a/._C0001.MP4', 'a/.DS_Store', 'a/SOBEDESCE_copia_2026.xxh64', '.sobedesce/descargas.jsonl']) assert.ok(IGNORAR.test(r), r)
  assert.ok(!IGNORAR.test('Diária 01/Cenas/Aladim - FX30/Cartão 01/PRIVATE/M4ROOT/CLIP/C0001.MP4'))
})

test('recusa pasta que não é projeto do SOBEDESCE', async () => {
  const { tmp, org } = montar()
  mkdirSync(join(tmp, 'qualquer'))
  await assert.rejects(org.adicionar(join(tmp, 'qualquer')), /SOBEDESCE/)
  await assert.rejects(org.adicionar(join(tmp, 'nao-existe')), /não existe/)
})

test('resumo: cada linha nova vira um cartão; linha pela metade espera; cancelado e repetido ficam de fora', async () => {
  const { raiz, org, eventos } = montar()
  const pasta = 'Diária 01/Cenas/Aladim - FX30/Cartão 01'
  arquivo(raiz, `${pasta}/PRIVATE/M4ROOT/CLIP/C0001.MP4`, 'video1')
  arquivo(raiz, `${pasta}/PRIVATE/M4ROOT/CLIP/C0001M01.XML`, '<xml/>')
  arquivo(raiz, `${pasta}/SOBEDESCE_copia_2026-10-24.xxh64`, 'relatorio')
  mkdirSync(join(raiz, '.sobedesce'))
  const resumo = join(raiz, '.sobedesce', 'descargas.jsonl')
  writeFileSync(
    resumo,
    linha({
      id: 'c1',
      quando: '2026-10-24T10:00:00Z',
      data: '2026-10-24',
      diaria: { n: 1, nome: 'Diária 01' },
      dono: { nome: 'Aladim', camera: 'FX30', pasta: 'Aladim - FX30' },
      cartao: { n: 1, nome: 'SONY', pasta },
      arquivos: [{ rel: 'PRIVATE/M4ROOT/CLIP/C0001.MP4' }, { rel: 'PRIVATE/M4ROOT/CLIP/C0001M01.XML' }, { rel: 'SOBEDESCE_copia_2026-10-24.xxh64' }, { rel: '../../../../fora.txt' }],
    }),
  )
  await org.adicionar(raiz)
  await org.verificar()
  assert.equal(eventos.length, 1)
  const e = eventos[0]
  assert.equal(e.id, 'c1')
  assert.equal(e.diaria.n, 1)
  assert.equal(e.dono.camera, 'FX30')
  assert.equal(e.cor, 0)
  assert.equal(e.projetoId, null)
  assert.deepEqual(
    e.arquivos.map((a) => a.rel),
    [`${pasta}/PRIVATE/M4ROOT/CLIP/C0001.MP4`, `${pasta}/PRIVATE/M4ROOT/CLIP/C0001M01.XML`],
  )
  assert.equal(e.arquivos[0].size, 6)
  assert.ok(e.arquivos[0].abs.startsWith(raiz))
  // pastas de trabalho em volta (os originais ficam onde estão)
  for (const p of ['Assets', 'Exports', join('Synquei', 'Sequências')]) assert.ok(existsSync(join(raiz, p)), p)

  // a próxima linha chega em dois pedaços; o cancelado não entra; o repetido também não
  const pasta2 = 'Diária 01/Cenas/Som - F8/Cartão 01'
  arquivo(raiz, `${pasta2}/ZOOM0001.WAV`, 'audio')
  const l2 = linha({ id: 'c2', quando: '2026-10-24T11:00:00Z', diaria: { n: 1, nome: 'Diária 01' }, dono: { nome: 'Som', camera: 'F8', pasta: 'Som - F8' }, cartao: { n: 1, pasta: pasta2 }, arquivos: [{ rel: 'ZOOM0001.WAV' }] })
  appendFileSync(resumo, linha({ id: 'cx', resultado: 'cancelado', cartao: { n: 2, pasta: pasta2 }, arquivos: [] }))
  appendFileSync(resumo, l2.slice(0, 20))
  await org.verificar()
  assert.equal(eventos.length, 1)
  appendFileSync(resumo, l2.slice(20) + linha({ id: 'c1', cartao: { n: 1, pasta }, arquivos: [] }))
  await org.verificar()
  assert.equal(eventos.length, 2)
  assert.equal(eventos[1].id, 'c2')
  assert.equal(eventos[1].cor, 1)

  // o que foi lido fica guardado: outro Organizador (o app abriu de novo) não repete os cartões
  const org2 = new Organizador({ stateDir: org.stateDir })
  const ev2 = []
  org2.on('cartao', (x) => ev2.push(x))
  await org2.verificar()
  assert.equal(ev2.length, 0)
  const st = org2.estado()[0]
  assert.equal(st.cartoes.length, 2)
  assert.deepEqual(st.cores, { 'Aladim - FX30': 0, 'Som - F8': 1 })

  // cada diária ganha um projeto do Synquei; terminou → pronto; os que não terminaram voltam
  await org2.vincular(st.id, { diaria: 1, projetoId: 'p1' })
  await org2.marcar(st.id, 'c1', 'pronto')
  const pend = await org2.pendentes(st.id)
  assert.deepEqual(pend.map((x) => x.id), ['c2'])
  assert.equal(pend[0].projetoId, 'p1')
  assert.equal(pend[0].cor, 1)
  assert.equal((await org2.todos(st.id)).length, 2)
})

test('sem resumo: o relatório .xxh64 diz que o cartão terminou; segunda leva vira outro cartão', async () => {
  const { raiz, org, eventos } = montar()
  const pasta = 'Diária 02/Cenas/Bia - A7SIII/Cartão 01'
  arquivo(raiz, `${pasta}/DCIM/100MSDCF/C0001.MP4`)
  arquivo(raiz, `${pasta}/DCIM/100MSDCF/C0002.MP4.sobedesce-parcial`)
  await org.adicionar(raiz)
  await org.verificar()
  assert.equal(eventos.length, 0, 'sem relatório o cartão ainda está passando')
  arquivo(raiz, `${pasta}/SOBEDESCE_copia_2026-10-24_1000.xxh64`)
  await org.verificar()
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].diaria.n, 2)
  assert.deepEqual(eventos[0].dono, { nome: 'Bia', camera: 'A7SIII', pasta: 'Bia - A7SIII' })
  assert.deepEqual(eventos[0].arquivos.map((a) => a.rel), [`${pasta}/DCIM/100MSDCF/C0001.MP4`])
  await org.verificar()
  assert.equal(eventos.length, 1)
  arquivo(raiz, `${pasta}/DCIM/100MSDCF/C0003.MP4`)
  arquivo(raiz, `${pasta}/SOBEDESCE_copia_2026-10-24_1400.xxh64`)
  await org.verificar()
  assert.equal(eventos.length, 2)
  assert.equal(eventos[1].arquivos.length, 2)
})

test('a página só lê dentro das pastas vigiadas e só grava dentro de Synquei/', async () => {
  const { tmp, raiz, org } = montar()
  const abs = arquivo(raiz, 'Diária 01/Cenas/A - B/Cartão 01/clip.mov', '0123456789')
  const fora = arquivo(tmp, 'segredo.txt', 'nao')
  const p = await org.adicionar(raiz)
  assert.equal((await org.ler(abs, 2, 5)).toString(), '234')
  assert.equal((await org.ler(abs, 8)).toString(), '89')
  assert.equal((await org.ler(abs, 50, 60)).length, 0)
  await assert.rejects(org.ler(fora, 0, 2), /fora/)
  await assert.rejects(org.ler(join(raiz, '..', 'segredo.txt'), 0, 2), /fora/)
  const out = await org.escrever(p.id, 'Synquei/Sequências/Diária 01/x.xml', '<xml/>')
  assert.equal(readFileSync(out, 'utf8'), '<xml/>')
  await assert.rejects(org.escrever(p.id, 'Diária 01/x.xml', 'x'), /Synquei/)
  await assert.rejects(org.escrever(p.id, 'Synquei/../../x.xml', 'x'), /Synquei/)
})

test('vigia ligado: start/stop entrega o cartão sem chamar verificar', async () => {
  const { raiz, org, eventos } = montar()
  mkdirSync(join(raiz, 'Diária 01'))
  await org.adicionar(raiz)
  org.start()
  try {
    const pasta = 'Diária 01/Cenas/A - B/Cartão 01'
    arquivo(raiz, `${pasta}/x.wav`)
    arquivo(raiz, `${pasta}/SOBEDESCE_copia_1.xxh64`)
    const t0 = Date.now()
    while (!eventos.length && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20))
    assert.equal(eventos.length, 1)
  } finally {
    org.stop()
  }
})

test('Assets: o que a pessoa pôs na pasta vai junto, com as subpastas', async () => {
  const { raiz, org } = montar()
  mkdirSync(join(raiz, 'Diária 01'))
  const p = await org.adicionar(raiz)
  arquivo(raiz, 'Assets/Trilha/musica.wav')
  arquivo(raiz, 'Assets/logo.png')
  arquivo(raiz, 'Assets/.DS_Store')
  const a = await org.assets(p.id)
  assert.deepEqual(a.map((x) => x.rel).sort(), ['Trilha/musica.wav', 'logo.png'])
  assert.ok(a.every((x) => x.abs.startsWith(join(raiz, 'Assets'))))
})
