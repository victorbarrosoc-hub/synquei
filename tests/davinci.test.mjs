// Ponte com o DaVinci (desktop/davinci.cjs): o pedido vira código Lua, o script do Resolve roda no LuaJIT com um
// Resolve de mentira (Media Pool, linhas do tempo, projeto) e a resposta volta para o Synquei.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { Ponte, paraLua, scriptLua, pastaScripts, pastaTroca, corResolve } = require('../desktop/davinci.cjs')

const temLua = spawnSync('luajit', ['-v']).status === 0

test('pedido em Lua: aspas, barra, quebra de linha e acento', () => {
  assert.equal(paraLua('a"b\\c\nd'), '"a\\"b\\\\c\\010d"')
  assert.equal(paraLua('Diária'), '"Diária"')
  assert.equal(paraLua([1, true, null]), '{1, true, nil}')
  assert.equal(paraLua({ a: 1, 'Camera #': 'A', x: undefined }), '{["a"] = 1, ["Camera #"] = "A"}')
  assert.equal(paraLua(NaN), 'nil')
})

test('pastas do Resolve e da troca em cada sistema', () => {
  assert.equal(pastaScripts('darwin', '/Users/v'), '/Users/v/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility')
  assert.equal(pastaScripts('win32', 'C:\\Users\\v', { APPDATA: 'C:\\Users\\v\\AppData\\Roaming' }), 'C:\\Users\\v\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility')
  assert.equal(pastaScripts('linux', '/home/v'), '/home/v/.local/share/DaVinciResolve/Fusion/Scripts/Utility')
  assert.equal(pastaTroca('win32', 'C:\\Users\\João\\AppData\\Roaming\\Synquei', { PROGRAMDATA: 'C:\\ProgramData' }), 'C:\\ProgramData\\Synquei\\davinci')
  assert.equal(corResolve(0), 'Blue')
  assert.equal(corResolve(1), 'Orange')
  assert.equal(corResolve(17), 'Orange')
})

// Resolve de mentira: só o que o script usa
const MOCK = String.raw`
local function Pasta(nome)
  local f = { nome = nome, subs = {}, clips = {} }
  function f:GetName() return self.nome end
  function f:GetSubFolderList() local t = {}; for i, s in ipairs(self.subs) do t[i] = s end; return t end
  function f:GetClipList() local t = {}; for i, c in ipairs(self.clips) do t[i] = c end; return t end
  return f
end
local function Item(c)
  local it = { caminho = c, meta = {} }
  function it:GetClipProperty(k) if k == "File Path" then return self.caminho end end
  function it:SetClipColor(x) self.cor = x; return true end
  function it:SetMetadata(k, v) self.meta[k] = v; return true end
  return it
end
local timelines = {}
local function Timeline(nome, n)
  local tl = { nome = nome, n = n }
  function tl:GetName() return self.nome end
  function tl:SetName(x) self.nome = x; return true end
  function tl:GetTrackCount(tipo) return tipo == "video" and 1 or 0 end
  function tl:GetItemListInTrack(tipo, t) local r = {}; for i = 1, self.n do r[i] = {} end; return r end
  return tl
end
for _, s in ipairs(SEED or {}) do table.insert(timelines, Timeline(s[1], s[2])) end
local raiz = Pasta("Master")
local atual = raiz
local chamadas = { importMedia = 0 }
local pool = {}
function pool:GetRootFolder() return raiz end
function pool:AddSubFolder(pai, nome) local f = Pasta(nome); table.insert(pai.subs, f); return f end
function pool:SetCurrentFolder(f) atual = f; return true end
function pool:ImportMedia(lst)
  chamadas.importMedia = chamadas.importMedia + 1
  local out = {}
  for _, x in ipairs(lst) do
    local c = type(x) == "table" and x.FilePath or x
    if not c:find("FALHA", 1, true) then local it = Item(c); table.insert(atual.clips, it); out[#out + 1] = it end
  end
  return out
end
function pool:ImportTimelineFromFile(arq, o)
  local tl = Timeline(o.timelineName, 3); tl.pasta = atual.nome; tl.semFonte = (o.importSourceClips == false)
  table.insert(timelines, tl)
  return tl
end
function pool:DeleteTimelines(l)
  for _, x in ipairs(l) do for i, t in ipairs(timelines) do if t == x then table.remove(timelines, i); break end end end
  return true
end
local proj = { nome = PROJETO }
function proj:GetName() return self.nome end
function proj:GetMediaPool() return pool end
function proj:GetTimelineCount() return #timelines end
function proj:GetTimelineByIndex(i) return timelines[i] end
local pm = {}
function pm:GetCurrentProject() return proj end
function pm:LoadProject(n) if n == "nao existe" then return false end; proj.nome = n; return true end
function pm:CreateProject(n) proj.nome = n; return true end
resolve = {}
function resolve:GetProjectManager() return pm end
SYNQUEI_TESTE = true
local m = dofile(SCRIPT)
local feitos = {}
for _, acao in ipairs(ACOES or { "passada" }) do
  if acao == "passada" then feitos[#feitos + 1] = m.passada() else m[acao]() end
end
local clips = {}
local function varrer(f, pre)
  for _, c in ipairs(f.clips) do clips[#clips + 1] = { pasta = pre, caminho = c.caminho, cor = c.cor, meta = c.meta } end
  for _, s in ipairs(f.subs) do varrer(s, (pre == "" and "" or pre .. "/") .. s.nome) end
end
varrer(raiz, "")
local tls = {}
for _, t in ipairs(timelines) do tls[#tls + 1] = { nome = t.nome, pasta = t.pasta or "", semFonte = t.semFonte or false } end
print(m.json({ feitos = feitos, clips = clips, linhas = tls, estado = m.estado, importMedia = chamadas.importMedia, projeto = proj.nome }))
`

function rodar(troca, { projeto = 'Filme X', seed = [], acoes = ['passada'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'))
  const script = join(dir, 'Synquei.lua')
  writeFileSync(script, scriptLua({ troca }))
  const mock = join(dir, 'mock.lua')
  writeFileSync(mock, `PROJETO = ${paraLua(projeto)}\nSCRIPT = ${paraLua(script)}\nSEED = ${paraLua(seed)}\nACOES = ${paraLua(acoes)}\n${MOCK}`)
  const r = spawnSync('luajit', [mock], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const item = (caminho, pasta, cor, meta = {}) => ({ caminho, pasta, cor, meta })
const CAM = ['Diária 01', 'Câmeras', 'Aladim - FX30', 'Cartão 01']
const SOM = ['Diária 01', 'Áudio', 'Som - F8', 'Cartão 01']

test('Resolve: pastas, cores, Cena/Take, sem importar duas vezes, linhas do tempo trocadas', { skip: !temLua && 'sem luajit' }, async () => {
  const troca = mkdtempSync(join(tmpdir(), 'troca-'))
  const ponte = new Ponte({ troca })
  const linhas = (nomes) => ({ prefixo: 'Diária 01 · ', sufixo: ' · Synquei', importar: nomes.map((n) => ({ nome: n, arquivo: `/hd/Filme X/Synquei/Sequências/${n}.xml`, pasta: ['Diária 01', 'Sequências'] })) })
  await ponte.enviar({
    projeto: 'Filme X',
    pastaId: 'abc',
    itens: [item('/hd/Filme X/Diária 01/C0001.MP4', CAM, 'Blue', { 'Camera #': 'Aladim - FX30', 'Roll Card #': 'Cartão 01' }), item('/hd/Filme X/Diária 01/C0002.MP4', CAM, 'Blue')],
    linhas: linhas(['Diária 01 · Sessão 1 · Synquei']),
  })
  // segundo cartão: o C0001 já está lá (ganha a Cena que veio do gravador), chega o áudio e um que falha
  await ponte.enviar({
    projeto: 'Filme X',
    pastaId: 'abc',
    itens: [
      item('/hd/Filme X/Diária 01/C0001.MP4', CAM, 'Blue', { Scene: '12', Take: '3' }),
      item('/hd/Filme X/Diária 01/ZOOM0001.WAV', SOM, 'Orange', { Scene: '12', Take: '3' }),
      item('/hd/Filme X/Diária 01/FALHA.MP4', CAM, 'Blue'),
      { ...item('/hd/Filme X/Diária 01/A001_0001.dng', CAM, 'Blue'), seq: { padrao: '/hd/Filme X/Diária 01/A001_%04d.dng', ini: 1, fim: 48 } },
    ],
    linhas: linhas(['Diária 01 · Sessão 1 · Synquei', 'Diária 01 · Sessão 2 · Synquei']),
  })
  // linhas que já existiam: uma igual a quando entrou (sai), uma editada (fica com outro nome), uma de outra diária
  mkdirSync(join(troca, 'linhas'), { recursive: true })
  writeFileSync(join(troca, 'linhas', 'Filme X.txt'), 'Diária 01 · Sessão 8 · Synquei\t5\nDiária 01 · Sessão 9 · Synquei\t2\n')
  const r = rodar(troca, { seed: [['Diária 01 · Sessão 8 · Synquei', 5], ['Diária 01 · Sessão 9 · Synquei', 5], ['Diária 02 · Sessão 1 · Synquei', 3], ['Meu corte', 7]] })
  assert.deepEqual(r.feitos, [2])
  const por = Object.fromEntries(r.clips.map((c) => [c.caminho.split('/').pop(), c]))
  assert.deepEqual(Object.keys(por).sort(), ['A001_%04d.dng', 'C0001.MP4', 'C0002.MP4', 'ZOOM0001.WAV'])
  assert.equal(por['C0001.MP4'].pasta, CAM.join('/'))
  assert.equal(por['ZOOM0001.WAV'].pasta, SOM.join('/'))
  assert.equal(por['C0001.MP4'].cor, 'Blue')
  assert.equal(por['ZOOM0001.WAV'].cor, 'Orange')
  assert.deepEqual(por['C0001.MP4'].meta, { 'Camera #': 'Aladim - FX30', 'Roll Card #': 'Cartão 01', Scene: '12', Take: '3' })
  const nomes = r.linhas.map((t) => t.nome)
  assert.ok(nomes.includes('Diária 02 · Sessão 1 · Synquei'), 'outra diária não é mexida')
  assert.ok(nomes.includes('Meu corte'))
  assert.ok(!nomes.includes('Diária 01 · Sessão 8 · Synquei'), 'a antiga sem edição sai')
  assert.ok(nomes.some((n) => n.startsWith('Diária 01 · Sessão 9 · Synquei (editada')), 'a editada fica com outro nome')
  assert.equal(nomes.filter((n) => n === 'Diária 01 · Sessão 1 · Synquei').length, 1)
  assert.equal(nomes.filter((n) => n === 'Diária 01 · Sessão 2 · Synquei').length, 1)
  const s2 = r.linhas.find((t) => t.nome === 'Diária 01 · Sessão 2 · Synquei')
  assert.equal(s2.pasta, 'Sequências')
  assert.equal(s2.semFonte, true)

  const resp = await ponte.verificar()
  assert.equal(resp.length, 2)
  assert.equal(resp[0].importados, 2)
  assert.equal(resp[1].importados, 2)
  assert.equal(resp[1].jaEstavam, 1)
  assert.deepEqual(resp[1].falhas, ['/hd/Filme X/Diária 01/FALHA.MP4'])
  assert.deepEqual(resp[0].guardadas, ['Diária 01 · Sessão 9 · Synquei'])
  assert.equal(resp[0].trocadas, 1)
  assert.equal(resp[1].trocadas, 1)
  assert.ok(!existsSync(join(troca, 'pedidos', '000001.lua')), 'pedido respondido sai da fila')
  const st = await ponte.status({ platform: 'linux', home: troca })
  assert.equal(st.conectado, true)
  assert.equal(st.projeto, 'Filme X')
  assert.equal(st.fila, 0)
  // o que já foi importado não volta, mesmo se tirarem da Media Pool
  assert.match(readFileSync(join(troca, 'importados', 'Filme X.txt'), 'utf8'), /C0002\.MP4/)
})

test('Resolve: outro projeto aberto espera; "Usar o projeto aberto" liga e organiza', { skip: !temLua && 'sem luajit' }, async () => {
  const troca = mkdtempSync(join(tmpdir(), 'troca-'))
  const ponte = new Ponte({ troca })
  await ponte.enviar({ projeto: 'Filme X', pastaId: 'abc', itens: [item('/hd/a.mov', CAM, 'Blue')] })
  let r = rodar(troca, { projeto: 'Outro' })
  assert.deepEqual(r.feitos, [0])
  assert.equal(r.estado.esperando, 'Filme X')
  assert.equal(r.clips.length, 0)
  assert.equal((await ponte.status()).fila, 1)
  assert.equal((await ponte.status()).esperando, 'Filme X')
  r = rodar(troca, { projeto: 'Outro', acoes: ['passada', 'usarAberto', 'passada'] })
  assert.deepEqual(r.feitos, [0, 1])
  assert.equal(r.clips.length, 1)
  assert.match(readFileSync(join(troca, 'ligado.txt'), 'utf8'), /^abc\tOutro/)
  // "Abrir o projeto esperado"
  await ponte.enviar({ projeto: 'Filme Y', pastaId: 'xyz', itens: [item('/hd/b.mov', CAM, 'Blue')] })
  r = rodar(troca, { projeto: 'Outro', acoes: ['passada', 'abrirEsperado', 'passada'] })
  assert.deepEqual(r.feitos, [0, 1])
  assert.equal(r.projeto, 'Filme Y')
})

test('instalar põe o script no menu do Resolve com a pasta de troca', async () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'))
  const troca = join(home, 'troca')
  const ponte = new Ponte({ troca })
  const f = await ponte.instalar({ platform: 'linux', home })
  assert.ok(f.endsWith(join('Fusion', 'Scripts', 'Utility', 'Synquei.lua')))
  assert.match(readFileSync(f, 'utf8'), new RegExp(`local TROCA = "${troca.replace(/\\/g, '/')}"`))
  const st = await ponte.status({ platform: 'linux', home })
  assert.equal(st.instalado, true)
  assert.equal(st.conectado, false)
})
