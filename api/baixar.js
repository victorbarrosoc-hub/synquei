// /baixar/mac, /baixar/windows e /baixar/versao (vercel.json reescreve para cá).
// Lê o Release "app-desktop" do GitHub e manda o visitante direto para o instalador: nada passa pela Vercel.
// Repositório privado: com GITHUB_TOKEN (só leitura de conteúdo) nas variáveis da Vercel, o GitHub devolve um endereço
// assinado e temporário do arquivo. Repositório público: funciona sem token, pelo link normal.
// `?build=N` (instaladores de uma linha): o instalador exatamente daquele build, o mesmo do SHA-256 que eles conferem.
// /baixar/diag: diz por que o download não sai (sem token, token recusado, sem acesso), sem mostrar o token.

const REPO = process.env.SYNQUEI_REPO || 'victorbarrosoc-hub/synquei'
const TAG = 'app-desktop'
const CACHE_MS = 2 * 60_000
let cache = null

// colado no painel da Vercel às vezes vem com espaço ou quebra de linha no fim
const token = () => (process.env.GITHUB_TOKEN || '').trim()
const auth = () => (token() ? { authorization: `Bearer ${token()}` } : {})

async function assets() {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.assets
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: { accept: 'application/vnd.github+json', ...auth() }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`release ${r.status}`)
  const j = await r.json()
  cache = { em: Date.now(), assets: Array.isArray(j.assets) ? j.assets : [] }
  return cache.assets
}

async function link(asset) {
  if (!token()) return asset.browser_download_url
  const r = await fetch(asset.url, { headers: { accept: 'application/octet-stream', ...auth() }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  const loc = r.headers.get('location')
  await r.body?.cancel().catch(() => {})
  return loc
}

async function versao() {
  const a = (await assets()).find((x) => x.name === 'versao.json')
  if (!a) return null
  const url = await link(a)
  if (!url) return null
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!r.ok) return null
  const v = await r.json()
  const sha = (s) => (typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s) ? s.toLowerCase() : null)
  return { build: Number(v.build) || null, versao: v.versao || null, data: v.data || null, arquivoMac: v.arquivoMac || null, sha256Mac: sha(v.sha256Mac), arquivoWindows: v.arquivoWindows || null, sha256Windows: sha(v.sha256Windows) }
}

const buildDe = (nome) => {
  const m = /-b(\d{1,9})-/.exec(nome)
  return m ? Number(m[1]) : -1
}
const QUAL = { mac: (n) => n.endsWith('-mac-universal.dmg'), windows: (n) => n.endsWith('-windows-setup.exe') }

/** Diagnóstico sem segredos: tem token? de que tipo? o GitHub aceita? o Release tem os instaladores? */
async function diag() {
  const bruto = process.env.GITHUB_TOKEN || ''
  const t = token()
  const out = {
    token: !!t,
    tipoToken: !t ? null : t.startsWith('github_pat_') ? 'fino' : t.startsWith('ghp_') ? 'clássico' : 'outro formato',
    espacoNasPontas: !!t && bruto !== t,
    repositorio: REPO,
  }
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: { accept: 'application/vnd.github+json', ...auth() }, signal: AbortSignal.timeout(10_000) }).catch((e) => ({ ok: false, status: String(e && e.message) }))
  out.githubRelease = r.status
  out.motivo = r.ok ? null : r.status === 401 ? 'token recusado pelo GitHub (inválido, incompleto ou expirado)' : r.status === 404 ? (t ? 'token sem acesso ao repositório (ou Release inexistente)' : 'repositório privado e sem token') : r.status === 403 ? 'token sem permissão (Contents: Read-only) ou limite de uso' : 'falha ao falar com o GitHub'
  if (r.ok) {
    const j = await r.json()
    const a = Array.isArray(j.assets) ? j.assets : []
    out.mac = a.filter((x) => QUAL.mac(x.name)).length
    out.windows = a.filter((x) => QUAL.windows(x.name)).length
    const v = a.find((x) => x.name === 'versao.json')
    out.versaoJson = !!v
    if (v) out.linkAssinado = !!(await link(v).catch(() => null))
  }
  return out
}

export default async function handler(req, res) {
  const p = String((req.query && req.query.p) || '')
  try {
    if (p === 'diag') {
      res.setHeader('cache-control', 'no-store')
      return res.status(200).json(await diag())
    }
    if (p === 'versao') {
      const v = await versao()
      res.setHeader('cache-control', 'public, max-age=60, s-maxage=120')
      if (!v) return res.status(503).json({ ok: false })
      return res.status(200).json({ ok: true, ...v, mac: '/baixar/mac', windows: '/baixar/windows' })
    }
    if (!QUAL[p]) return res.redirect(302, '/#baixar')
    const pedido = req.query.build && /^\d{1,9}$/.test(String(req.query.build)) ? Number(req.query.build) : null
    let lista = (await assets()).filter((a) => QUAL[p](a.name))
    let alvo
    if (pedido != null) alvo = lista.find((a) => buildDe(a.name) === pedido)
    else {
      // o que o versao.json aponta (conferido); sem ele, o de maior build
      let nome = null
      try {
        const v = await versao()
        nome = v ? (p === 'mac' ? v.arquivoMac : v.arquivoWindows) : null
      } catch {}
      alvo = (nome && lista.find((a) => a.name === nome)) || lista.sort((a, b) => buildDe(b.name) - buildDe(a.name))[0]
    }
    if (!alvo) {
      if (pedido != null) return res.status(404).send('Instalador deste build não está mais no ar.')
      return res.redirect(302, '/?baixar=indisponivel#baixar')
    }
    const destino = await link(alvo)
    if (!destino) return res.redirect(302, '/?baixar=indisponivel#baixar')
    res.setHeader('cache-control', 'no-store')
    return res.redirect(302, destino)
  } catch (e) {
    console.error('[baixar]', p, e && e.message)
    if (p === 'versao') return res.status(503).json({ ok: false })
    return res.redirect(302, '/?baixar=indisponivel#baixar')
  }
}
