// Ponte com o DaVinci Resolve Studio. O Resolve só deixa mexer no projeto por script; o jeito que funciona sem
// instalar Python é um script Lua dentro dele (Workspace › Scripts › Synquei). Esse script abre uma janelinha, olha uma
// pasta de troca a cada 3 s e faz o que o Synquei pediu: cria as pastas na Media Pool (Diária › Câmeras › Dono ›
// Cartão, Áudio, Sequências, Assets), importa só o que ainda não está lá, pinta cada câmera com uma cor, preenche
// Cena/Take/Câmera/Cartão e troca as linhas do tempo da diária pelas novas.
//
// Pasta de troca:
//   indice.lua            return { ultimo = N }           (o Synquei grava)
//   pedidos/000012.lua    return { ...pedido... }         (o Synquei grava; Lua lê com dofile)
//   respostas/000012.json o que foi feito                 (o Lua grava; o Synquei lê e apaga os dois)
//   vivo.json             { quando, projeto, esperando }  (o Lua grava a cada passada)
//   feito.txt, ligado.txt, importados/, linhas/           (memória do Lua)
//
// No Windows a pasta fica em C:\ProgramData\Synquei\davinci: o Lua do Resolve abre arquivos pela página de código do
// sistema e um nome de usuário com acento quebraria o caminho dentro de AppData.

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { EventEmitter } = require('node:events')

// cores de clipe do Resolve, na ordem das cores dos aparelhos do Synquei (azul, laranja, verde-água, amarelo, rosa…)
const CORES_RESOLVE = ['Blue', 'Orange', 'Teal', 'Yellow', 'Pink', 'Green', 'Violet', 'Apricot', 'Navy', 'Lime', 'Purple', 'Olive', 'Tan', 'Beige', 'Brown', 'Chocolate']
const corResolve = (i) => CORES_RESOLVE[(Number(i) || 0) % CORES_RESOLVE.length]
const VERSAO = 1

/** Valor JS → código Lua (só dados: string, número, booleano, lista e objeto). */
function paraLua(v) {
  if (v == null) return 'nil'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'nil'
  if (typeof v === 'string') {
    // \ddd decimal: vale no Lua 5.1 (LuaJIT do Resolve); bytes UTF-8 passam como estão
    return '"' + v.replace(/[\\"\x00-\x1f\x7f]/g, (c) => (c === '\\' ? '\\\\' : c === '"' ? '\\"' : '\\' + String(c.charCodeAt(0)).padStart(3, '0'))) + '"'
  }
  if (Array.isArray(v)) return '{' + v.map(paraLua).join(', ') + '}'
  if (typeof v === 'object') {
    return '{' + Object.entries(v).filter(([, x]) => x !== undefined && x !== null).map(([k, x]) => `[${paraLua(String(k))}] = ${paraLua(x)}`).join(', ') + '}'
  }
  return 'nil'
}

/** Onde o Resolve procura os scripts do menu Workspace › Scripts. */
function pastaScripts(platform = process.platform, home = require('node:os').homedir(), env = process.env) {
  if (platform === 'darwin') return path.posix.join(home, 'Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility')
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Utility')
  return path.posix.join(home, '.local/share/DaVinciResolve/Fusion/Scripts/Utility')
}

function pastaTroca(platform = process.platform, userData = '', env = process.env) {
  if (platform === 'win32') return path.win32.join(env.PROGRAMDATA || 'C:\\ProgramData', 'Synquei', 'davinci')
  return path.join(userData, 'davinci')
}

/** O script que vai para o Resolve, com a pasta de troca escrita dentro. */
function scriptLua({ troca }) {
  return `-- Synquei: organiza os cartões do SOBEDESCE neste projeto do DaVinci Resolve Studio.
-- Abra por Workspace > Scripts > Synquei e deixe a janelinha aberta. Instalado pelo app do Synquei; não edite.
local TROCA = ${paraLua(String(troca).replace(/\\/g, '/'))}
local VERSAO = ${VERSAO}
${LUA_CORPO}`
}

const LUA_CORPO = String.raw`
local WIN = package.config:sub(1, 1) == "\\"
local R = resolve or (Resolve and Resolve())

local function ler(c)
  local f = io.open(c, "rb")
  if not f then return nil end
  local s = f:read("*a")
  f:close()
  return s
end

local function gravar(c, s)
  local tmp = c .. ".tmp"
  local f = io.open(tmp, "wb")
  if not f then return false end
  f:write(s)
  f:close()
  os.remove(c)
  return os.rename(tmp, c)
end

local function carregar(c)
  local ok, v = pcall(dofile, c)
  if ok then return v end
  return nil
end

-- listas do Resolve chegam como tabela com chaves 1..n (às vezes como números com casa decimal)
local function lista(t)
  local out, ks = {}, {}
  if type(t) ~= "table" then return out end
  for k in pairs(t) do ks[#ks + 1] = k end
  table.sort(ks, function(a, b)
    if type(a) == "number" and type(b) == "number" then return a < b end
    return tostring(a) < tostring(b)
  end)
  for _, k in ipairs(ks) do out[#out + 1] = t[k] end
  return out
end

local function json(v)
  local t = type(v)
  if t == "nil" then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    return string.format("%.14g", v)
  end
  if t == "string" then
    local s = v:gsub('[%c"\\]', function(c)
      local m = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
      return m[c] or string.format("\\u%04x", c:byte())
    end)
    return '"' .. s .. '"'
  end
  if t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 end
    if n == 0 then return "[]" end
    if n == #v then
      local p = {}
      for i = 1, #v do p[i] = json(v[i]) end
      return "[" .. table.concat(p, ",") .. "]"
    end
    local p = {}
    for k, x in pairs(v) do p[#p + 1] = json(tostring(k)) .. ":" .. json(x) end
    table.sort(p)
    return "{" .. table.concat(p, ",") .. "}"
  end
  return "null"
end

local function normal(p)
  p = tostring(p or ""):gsub("\\", "/")
  if WIN then p = p:lower() end
  return p
end

local function arquivoSeguro(s)
  return (tostring(s):gsub('[^%w%-_. ]', "_"))
end

-- memória de linhas "chave<TAB>valor"
local function lerMapa(c)
  local m = {}
  local s = ler(c)
  if s then
    for linha in s:gmatch("[^\n]+") do
      local k, v = linha:match("^(.-)\t(.*)$")
      if k then m[k] = v end
    end
  end
  return m
end

local function gravarMapa(c, m)
  local p = {}
  for k, v in pairs(m) do p[#p + 1] = k .. "\t" .. tostring(v) end
  table.sort(p)
  gravar(c, table.concat(p, "\n") .. "\n")
end

-- ───────── Media Pool ─────────
local function subpasta(pool, pai, nome)
  for _, f in ipairs(lista(pai:GetSubFolderList())) do
    if f:GetName() == nome then return f end
  end
  return pool:AddSubFolder(pai, nome)
end

local function pastaDe(pool, caminho)
  local f = pool:GetRootFolder()
  for _, n in ipairs(caminho or {}) do
    local s = subpasta(pool, f, n)
    if not s then error("não consegui criar a pasta " .. n .. " na Media Pool") end
    f = s
  end
  return f
end

local function porCaminho(pasta)
  local m = {}
  for _, it in ipairs(lista(pasta:GetClipList())) do
    local p = it:GetClipProperty("File Path")
    if type(p) == "string" and p ~= "" then m[normal(p)] = it end
  end
  return m
end

local function aplicar(it, item, resp)
  if item.cor then
    if not pcall(function() it:SetClipColor(item.cor) end) then resp.avisos[#resp.avisos + 1] = "cor: " .. item.caminho end
  end
  for k, v in pairs(item.meta or {}) do
    pcall(function() it:SetMetadata(k, tostring(v)) end)
  end
end

local function importarItens(pool, pedido, resp, memoria)
  -- agrupa por pasta da Media Pool (o ImportMedia importa na pasta atual)
  local grupos, ordem = {}, {}
  for _, item in ipairs(pedido.itens or {}) do
    local k = table.concat(item.pasta or {}, "/")
    if not grupos[k] then grupos[k] = {}; ordem[#ordem + 1] = k end
    table.insert(grupos[k], item)
  end
  for _, k in ipairs(ordem) do
    local itens = grupos[k]
    local pasta = pastaDe(pool, itens[1].pasta)
    local ja = porCaminho(pasta)
    local novos, seqs = {}, {}
    for _, item in ipairs(itens) do
      local chave = normal(item.caminho)
      if ja[chave] then
        aplicar(ja[chave], item, resp)
        resp.jaEstavam = resp.jaEstavam + 1
      elseif memoria[chave] then
        -- já foi importado antes e alguém tirou da Media Pool: não volta
        resp.pulados = resp.pulados + 1
      elseif item.seq then
        seqs[#seqs + 1] = item
      else
        novos[#novos + 1] = item
      end
    end
    pool:SetCurrentFolder(pasta)
    if #novos > 0 then
      local caminhos = {}
      for i, item in ipairs(novos) do caminhos[i] = item.caminho end
      local vieram = lista(pool:ImportMedia(caminhos))
      local porC = {}
      for _, it in ipairs(vieram) do
        local p = it:GetClipProperty("File Path")
        if type(p) == "string" then porC[normal(p)] = it end
      end
      for _, item in ipairs(novos) do
        local it = porC[normal(item.caminho)]
        if it then
          aplicar(it, item, resp)
          memoria[normal(item.caminho)] = "1"
          resp.importados = resp.importados + 1
        else
          resp.falhas[#resp.falhas + 1] = item.caminho
        end
      end
    end
    for _, item in ipairs(seqs) do
      local vieram = lista(pool:ImportMedia({ { FilePath = item.seq.padrao, StartIndex = item.seq.ini, EndIndex = item.seq.fim } }))
      if vieram[1] then
        aplicar(vieram[1], item, resp)
        memoria[normal(item.caminho)] = "1"
        resp.importados = resp.importados + 1
      else
        resp.falhas[#resp.falhas + 1] = item.caminho
      end
    end
  end
end

-- ───────── linhas do tempo ─────────
local function contar(tl)
  local n = 0
  for _, tipo in ipairs({ "video", "audio" }) do
    local tracks = tonumber(tl:GetTrackCount(tipo)) or 0
    for t = 1, tracks do n = n + #lista(tl:GetItemListInTrack(tipo, t)) end
  end
  return n
end

local function linhas(proj)
  local out = {}
  local n = tonumber(proj:GetTimelineCount()) or 0
  for i = 1, n do
    local tl = proj:GetTimelineByIndex(i)
    if tl then out[#out + 1] = tl end
  end
  return out
end

local function comeca(s, p) return p ~= "" and s:sub(1, #p) == p end
local function termina(s, p) return p ~= "" and s:sub(-#p) == p end

-- a linha do tempo antiga sai só se ninguém mexeu nela (mesmo número de clipes de quando entrou); editada, fica com
-- outro nome
local function tirar(pool, tl, registro, resp)
  local nome = tl:GetName()
  if registro[nome] and tonumber(registro[nome]) == contar(tl) then
    pool:DeleteTimelines({ tl })
    resp.trocadas = resp.trocadas + 1
  else
    tl:SetName(nome .. " (editada " .. os.date("%d/%m %H:%M") .. ")")
    resp.guardadas[#resp.guardadas + 1] = nome
  end
  registro[nome] = nil
end

local function trocarLinhas(proj, pool, pedido, resp, registro)
  local L = pedido.linhas
  if not L then return end
  local novas = {}
  for _, x in ipairs(L.importar or {}) do novas[x.nome] = x end
  for _, tl in ipairs(linhas(proj)) do
    local nome = tl:GetName()
    if novas[nome] or (comeca(nome, L.prefixo or "") and termina(nome, L.sufixo or "")) then tirar(pool, tl, registro, resp) end
  end
  for _, x in ipairs(L.importar or {}) do
    pool:SetCurrentFolder(pastaDe(pool, x.pasta))
    local tl = pool:ImportTimelineFromFile(x.arquivo, { timelineName = x.nome, importSourceClips = false })
    if tl then
      registro[x.nome] = tostring(contar(tl))
      resp.linhas[#resp.linhas + 1] = x.nome
    else
      resp.falhas[#resp.falhas + 1] = x.arquivo
    end
  end
end

-- ───────── pedidos ─────────
local function projetoAberto()
  if not R then return nil, nil, nil end
  local pm = R:GetProjectManager()
  local proj = pm and pm:GetCurrentProject()
  return proj, proj and proj:GetName() or nil, pm
end

local function aceita(pedido, nome)
  if not nome then return false end
  if nome == pedido.projeto then return true end
  return lerMapa(TROCA .. "/ligado.txt")[pedido.pastaId or ""] == nome
end

local function processar(pedido, proj, nome)
  local pool = proj:GetMediaPool()
  local resp = { seq = pedido.seq, ok = true, projeto = nome, importados = 0, jaEstavam = 0, pulados = 0, trocadas = 0, linhas = {}, guardadas = {}, falhas = {}, avisos = {} }
  local base = arquivoSeguro(nome)
  local memF = TROCA .. "/importados/" .. base .. ".txt"
  local regF = TROCA .. "/linhas/" .. base .. ".txt"
  local memoria = lerMapa(memF)
  local registro = lerMapa(regF)
  local ok, err = pcall(function()
    importarItens(pool, pedido, resp, memoria)
    trocarLinhas(proj, pool, pedido, resp, registro)
  end)
  gravarMapa(memF, memoria)
  gravarMapa(regF, registro)
  pcall(function() pool:SetCurrentFolder(pool:GetRootFolder()) end)
  if not ok then resp.ok = false; resp.erro = tostring(err) end
  return resp
end

local estado = { texto = "Procurando pedidos do Synquei…", esperando = nil, pastaId = nil }

local function passada()
  local idx = carregar(TROCA .. "/indice.lua") or { ultimo = 0 }
  local feito = tonumber(ler(TROCA .. "/feito.txt") or "0") or 0
  local proj, nome, pm = projetoAberto()
  estado.esperando, estado.pastaId = nil, nil
  local feitos = 0
  for seq = feito + 1, tonumber(idx.ultimo) or 0 do
    local arq = string.format("%s/pedidos/%06d.lua", TROCA, seq)
    local pedido = carregar(arq)
    if pedido then
      pedido.seq = seq
      if not proj or not aceita(pedido, nome) then
        estado.esperando, estado.pastaId = pedido.projeto, pedido.pastaId
        break
      end
      local resp = processar(pedido, proj, nome)
      resp.quando = os.time()
      gravar(string.format("%s/respostas/%06d.json", TROCA, seq), json(resp))
      feitos = feitos + 1
    end
    feito = seq
    gravar(TROCA .. "/feito.txt", tostring(feito))
  end
  if estado.esperando then
    estado.texto = "Cartões esperando o projeto “" .. estado.esperando .. "”.\nAbra esse projeto ou clique em Usar o projeto aberto" .. (nome and (" (“" .. nome .. "”)") or "") .. "."
  elseif feitos > 0 then
    estado.texto = "Organizado às " .. os.date("%H:%M") .. " em “" .. tostring(nome) .. "”."
  elseif nome then
    estado.texto = "Ligado ao projeto “" .. nome .. "”. Esperando cartões…"
  else
    estado.texto = "Abra um projeto no DaVinci."
  end
  gravar(TROCA .. "/vivo.json", json({ quando = os.time(), projeto = nome, esperando = estado.esperando, versao = VERSAO, feito = feito }))
  return feitos
end

local function usarAberto()
  local _, nome = projetoAberto()
  if not (nome and estado.pastaId) then return end
  local m = lerMapa(TROCA .. "/ligado.txt")
  m[estado.pastaId] = nome
  gravarMapa(TROCA .. "/ligado.txt", m)
end

local function abrirEsperado()
  local _, _, pm = projetoAberto()
  if not (pm and estado.esperando) then return end
  if not pm:LoadProject(estado.esperando) then pm:CreateProject(estado.esperando) end
end

if SYNQUEI_TESTE then
  return { passada = passada, json = json, usarAberto = usarAberto, abrirEsperado = abrirEsperado, estado = estado }
end

-- ───────── janela ─────────
local ui = fu.UIManager
local disp = bmd.UIDispatcher(ui)
local win = disp:AddWindow({ ID = "SynqueiJanela", WindowTitle = "Synquei", Geometry = { 120, 120, 440, 190 } }, ui:VGroup({
  ui:Label({ ID = "Status", Text = estado.texto, WordWrap = true, Alignment = { AlignHCenter = true, AlignVCenter = true } }),
  ui:HGroup({ Weight = 0,
    ui:Button({ ID = "Agora", Text = "Organizar agora" }),
    ui:Button({ ID = "Usar", Text = "Usar o projeto aberto" }),
    ui:Button({ ID = "Abrir", Text = "Abrir o projeto esperado" }),
  }),
}))
local itm = win:GetItems()
local ultimo = 0
local function tick()
  if os.clock() - ultimo < 0.5 then return end
  ultimo = os.clock()
  local ok, err = pcall(passada)
  itm.Status.Text = ok and estado.texto or ("Erro: " .. tostring(err))
end
function win.On.SynqueiJanela.Close(ev) disp:ExitLoop() end
function win.On.Agora.Clicked(ev) tick() end
function win.On.Usar.Clicked(ev) usarAberto(); ultimo = 0; tick() end
function win.On.Abrir.Clicked(ev) abrirEsperado(); ultimo = 0; tick() end
local timer = ui:Timer({ ID = "SynqueiRelogio", Interval = 3000 })
pcall(function() disp.On.Timeout = function(ev) tick() end end)
pcall(function() win.On.SynqueiRelogio.Timeout = function(ev) tick() end end)
tick()
timer:Start()
win:Show()
disp:RunLoop()
timer:Stop()
win:Hide()
`

class Ponte extends EventEmitter {
  constructor({ troca, intervaloMs = 3000, log = () => {} } = {}) {
    super()
    this.troca = troca
    this.intervaloMs = intervaloMs
    this.log = log
    this.timer = null
    this.respostas = []
  }

  async #pastas() {
    for (const d of ['pedidos', 'respostas', 'importados', 'linhas']) await fsp.mkdir(path.join(this.troca, d), { recursive: true })
  }

  async #ultimo() {
    try {
      const m = /ultimo\s*=\s*(\d+)/.exec(await fsp.readFile(path.join(this.troca, 'indice.lua'), 'utf8'))
      return m ? Number(m[1]) : 0
    } catch {
      return 0
    }
  }

  async #gravar(f, s) {
    await fsp.writeFile(f + '.tmp', s)
    await fsp.rename(f + '.tmp', f)
  }

  /** Põe um pedido na fila do Resolve. O pedido fica inteiro no disco antes de o índice apontar para ele. */
  async enviar(pedido) {
    await this.#pastas()
    const seq = (await this.#ultimo()) + 1
    const nome = String(seq).padStart(6, '0')
    await this.#gravar(path.join(this.troca, 'pedidos', `${nome}.lua`), `return ${paraLua({ ...pedido, v: VERSAO })}\n`)
    await this.#gravar(path.join(this.troca, 'indice.lua'), `return { ultimo = ${seq} }\n`)
    this.emit('mudou', await this.status())
    return seq
  }

  /** Respostas novas do Resolve: emite e apaga o pedido e a resposta. */
  async verificar() {
    let nomes = []
    try {
      nomes = (await fsp.readdir(path.join(this.troca, 'respostas'))).filter((n) => /^\d{6}\.json$/.test(n)).sort()
    } catch {
      return []
    }
    const out = []
    for (const n of nomes) {
      const f = path.join(this.troca, 'respostas', n)
      let r
      try {
        r = JSON.parse(await fsp.readFile(f, 'utf8'))
      } catch {
        continue
      }
      out.push(r)
      this.respostas.unshift(r)
      this.respostas.length = Math.min(this.respostas.length, 30)
      await fsp.rm(f, { force: true })
      await fsp.rm(path.join(this.troca, 'pedidos', n.replace('.json', '.lua')), { force: true })
      this.emit('resposta', r)
    }
    if (out.length) this.emit('mudou', await this.status())
    return out
  }

  async status({ platform = process.platform, home = require('node:os').homedir(), env = process.env } = {}) {
    let vivo = null
    try {
      vivo = JSON.parse(await fsp.readFile(path.join(this.troca, 'vivo.json'), 'utf8'))
    } catch {}
    const ultimo = await this.#ultimo()
    const feito = vivo && Number(vivo.feito) >= 0 ? Number(vivo.feito) : Number(String(await fsp.readFile(path.join(this.troca, 'feito.txt'), 'utf8').catch(() => '0')).trim()) || 0
    const script = path.join(pastaScripts(platform, home, env), 'Synquei.lua')
    return {
      instalado: fs.existsSync(script),
      script,
      // a janelinha grava vivo.json a cada 3 s
      conectado: !!(vivo && Date.now() / 1000 - Number(vivo.quando) < 20),
      projeto: (vivo && vivo.projeto) || null,
      esperando: (vivo && vivo.esperando) || null,
      fila: Math.max(0, ultimo - feito),
      respostas: this.respostas.slice(0, 10),
    }
  }

  /** Copia o script para o menu do Resolve (Workspace › Scripts › Synquei). */
  async instalar({ platform = process.platform, home = require('node:os').homedir(), env = process.env } = {}) {
    await this.#pastas()
    const dir = pastaScripts(platform, home, env)
    await fsp.mkdir(dir, { recursive: true })
    const f = path.join(dir, 'Synquei.lua')
    await this.#gravar(f, scriptLua({ troca: this.troca }))
    this.emit('mudou', await this.status({ platform, home, env }))
    return f
  }

  start() {
    if (this.timer) return
    const tick = async () => {
      await this.verificar().catch((err) => this.log('davinci:', err && err.message))
      if (this.timer !== null) this.timer = setTimeout(tick, this.intervaloMs)
    }
    this.timer = setTimeout(tick, 1000)
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = null
  }
}

module.exports = { Ponte, paraLua, scriptLua, pastaScripts, pastaTroca, corResolve, CORES_RESOLVE, VERSAO }
