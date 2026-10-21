// Animações do site: revelar ao rolar, números que contam, o palco do topo (as faixas se alinham), as duas
// demonstrações e as abas de exportação. Cada laço só roda enquanto está na tela; com "reduzir movimento", tudo para.

import { CONTAINERS, RAW, formatCount } from '/app/js/media/formats.js'
import { TIPOS, GRUPOS } from '/app/js/tipos.js'

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = (t) => 1 - Math.pow(1 - t, 3)

// ───────────── revelar ao rolar ─────────────
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      io.unobserve(e.target)
    }
  },
  { rootMargin: '0px 0px -10% 0px' },
)
$$('.reveal').forEach((el) => io.observe(el))

// ───────────── números ─────────────
const ext = $('#extCount')
if (ext) {
  const n = formatCount().extensions
  ext.dataset.count = n
  ext.textContent = n
}
const countIo = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      countIo.unobserve(e.target)
      const to = +e.target.dataset.count
      if (reduce || !to) continue
      const t0 = performance.now()
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 1600)
        e.target.textContent = Math.round(to * ease(k))
        if (k < 1) requestAnimationFrame(step)
      }
      e.target.textContent = '0'
      requestAnimationFrame(step)
    }
  },
  { rootMargin: '0px 0px -15% 0px' },
)
$$('[data-count]').forEach((el) => countIo.observe(el))

function loop(el, tick) {
  let raf = 0
  let last = 0
  let on = false
  const frame = (now) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
    last = now
    tick(dt, now)
    raf = requestAnimationFrame(frame)
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !on && !reduce) {
      on = true
      last = 0
      raf = requestAnimationFrame(frame)
    } else if (!e.isIntersecting && on) {
      on = false
      cancelAnimationFrame(raf)
    }
  }).observe(el)
}

// cena "falada": envelope de sílabas e pausas, com ataques nítidos
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function scenePeaks(n, seed) {
  const r = rng(seed)
  const out = new Float32Array(n)
  let i = 0
  while (i < n) {
    const talk = 20 + Math.floor(r() * 60)
    for (let k = 0; k < talk && i < n; ) {
      const syl = 3 + Math.floor(r() * 6)
      const amp = 0.35 + r() * 0.65
      for (let j = 0; j < syl && i < n; j++, i++, k++) out[i] = amp * Math.sin((Math.PI * (j + 0.5)) / syl) * (0.75 + r() * 0.25)
      i += Math.floor(r() * 2)
    }
    if (r() < 0.3 && i < n) out[i++] = 1
    i += 4 + Math.floor(r() * 14)
  }
  return out
}
function drawStrip(cv, peaks, from, to, color, seed, noise = 0.06) {
  const dpr = Math.min(2, devicePixelRatio || 1)
  const w = (cv.width = Math.max(1, cv.clientWidth * dpr))
  const h = (cv.height = Math.max(1, cv.clientHeight * dpr))
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  const r = rng(seed)
  const step = 3 * dpr
  for (let x = 0; x < w; x += step) {
    const i = Math.floor(from + (x / w) * (to - from))
    const v = Math.min(1, (peaks[i] || 0) * (0.85 + r() * 0.3) + r() * noise)
    const bh = Math.max(dpr, v * h * 0.92)
    ctx.fillRect(x, (h - bh) / 2, Math.max(1, step - dpr), bh)
  }
}

// ───────────── palco do topo ─────────────
const stage = $('#stage')
if (stage) {
  const N = 1000
  const peaks = scenePeaks(N, 7)
  const LANES = [
    { name: 'CAM A', c: '#0a84ff', a: 0.06, b: 0.52 },
    { name: 'CAM B', c: '#bf5af2', a: 0.18, b: 0.9 },
    { name: 'CAM C', c: '#30d158', a: 0.38, b: 0.97 },
    { name: 'CELULAR', c: '#ff9f0a', a: 0.58, b: 0.86 },
    { name: 'GRAVADOR', c: '#ff375f', a: 0.0, b: 1.0 },
  ]
  const host = $('#lanes')
  const offs = [-90, 70, -55, 110, 0]
  const clips = LANES.map((l, k) => {
    const lane = document.createElement('div')
    lane.className = 'lane'
    lane.innerHTML = `<span class="lane-name"><i style="--c:${l.c}"></i>${l.name}</span><div class="lane-track"><div class="lane-clip" style="--c:${l.c};left:${l.a * 100}%;width:${(l.b - l.a) * 100}%"><canvas></canvas><span class="lane-conf" style="--k:${k}">${k === 4 ? 'âncora' : 98 + (k % 2) + '%'}</span></div></div>`
    host.appendChild(lane)
    return { el: lane.querySelector('.lane-clip'), cv: lane.querySelector('canvas'), l, k }
  })
  const paint = () => clips.forEach(({ cv, l, k }) => drawStrip(cv, peaks, l.a * N, l.b * N, 'rgba(255,255,255,0.82)', k + 3))
  paint()
  addEventListener('resize', paint)
  // ataque forte comum a quase todas as faixas
  let T = 0.6
  for (let i = Math.floor(N * 0.58); i < N * 0.66; i++) if (peaks[i] > peaks[Math.floor(T * N)]) T = i / N
  const line = $('#syncLine')
  const tag = $('#syncTag')
  const state = $('#stState')
  const place = () => {
    const tr = clips[4].el.parentElement.getBoundingClientRect()
    const hr = host.getBoundingClientRect()
    const x = tr.left - hr.left + T * tr.width
    line.style.left = x + 'px'
    tag.style.left = x + 'px'
  }
  const set = (aligned) => clips.forEach(({ el, k }) => (el.style.transform = aligned ? 'none' : `translateX(${offs[k]}px)`))
  place()
  addEventListener('resize', place)
  if (reduce) {
    set(true)
    stage.classList.add('done')
    state.textContent = 'Sincronizado'
  } else set(false)
  let t = 0
  let phase = -1
  loop(stage, (dt) => {
    t = (t + dt) % 9
    const p = t < 0.3 ? 0 : t < 1.8 ? 1 : t < 3.2 ? 2 : t < 8.4 ? 3 : 4
    if (p === phase) return
    phase = p
    if (p === 0) {
      stage.classList.remove('done')
      set(false)
      state.textContent = 'Lendo o som'
    } else if (p === 1) {
      stage.classList.add('scanning')
      state.textContent = 'Comparando'
    } else if (p === 2) {
      stage.classList.remove('scanning')
      set(true)
      state.textContent = 'Encaixando'
    } else if (p === 3) {
      place()
      stage.classList.add('done')
      state.textContent = 'Sincronizado · 5 de 5'
    } else if (p === 4) {
      stage.classList.remove('done')
    }
  })
}

// ───────────── demonstração: reconhecimento ─────────────
const FILES = [
  { n: 'A001C003_240501_R2KJ.mov', t: [['QuickTime'], ['ProRes 4444 XQ', 'c'], ['ARRI ALEXA 35', 'd'], ['14:22:10:05', 't']] },
  { n: 'PRIVATE/M4ROOT/CLIP/C0042.MP4', t: [['MPEG-4'], ['XAVC S-I', 'c'], ['Sony FX3', 'd'], ['18:04:51:12', 't']] },
  { n: 'A003_C012_0501HV_001.R3D', t: [['R3D'], ['REDCODE', 'c'], ['RAW', 'r'], ['3 partes']] },
  { n: 'ZOOM0007/ZOOM0007_LR.WAV', t: [['BWF 32-bit float'], ['Zoom F6', 'd'], ['Cena 12A · take 3'], ['14:22:08:00', 't']] },
  { n: 'A001_05011422_C004.braw', t: [['Blackmagic RAW', 'r'], ['Pocket 6K', 'd'], ['23.976'], ['01:04:22:11', 't']] },
  { n: 'DCIM/100GOPRO/GX010231.MP4', t: [['MPEG-4'], ['HEVC', 'c'], ['GoPro HERO12', 'd'], ['5.3K · 50']] },
  { n: 'XDROOT/Clip/A002C007_240501XY.MXF', t: [['MXF OP1a'], ['XAVC Intra', 'c'], ['Sony FX6', 'd'], ['10:31:00:02', 't']] },
  { n: 'A001C001_[0000001-0000240].dng', t: [['CinemaDNG', 'r'], ['240 quadros'], ['+ WAV da pasta'], ['09:12:44:00', 't']] },
  { n: '._C0042.MP4', t: [['ignorado: sombra do macOS']] },
]
const filesBox = $('#files')
if (filesBox) {
  let i = 0
  let t = 0
  let typing = null
  const next = () => {
    const f = FILES[i++ % FILES.length]
    const el = document.createElement('div')
    el.className = 'file'
    el.innerHTML = `<div class="file-name"></div><div class="tags"></div>`
    filesBox.prepend(el)
    while (filesBox.children.length > 4) filesBox.lastChild.remove()
    typing = { el, f, k: 0 }
  }
  next()
  loop(filesBox, (dt) => {
    t += dt
    if (typing) {
      const want = Math.min(typing.f.n.length, Math.floor(t * 46))
      typing.el.firstChild.textContent = typing.f.n.slice(0, want)
      if (want >= typing.f.n.length) {
        typing.el.classList.add('typed')
        typing.el.lastChild.innerHTML = typing.f.t.map(([s, c], k) => `<span class="tag ${c || ''}" style="--k:${k}">${s}</span>`).join('')
        typing = null
        t = 0
      }
    } else if (t > 1.5) {
      t = 0
      next()
    }
  })
  if (reduce) for (let k = 0; k < 3; k++) {
    next()
    typing.el.firstChild.textContent = typing.f.n
    typing.el.classList.add('typed')
    typing.el.lastChild.innerHTML = typing.f.t.map(([s, c], j) => `<span class="tag ${c || ''}" style="--k:${j}">${s}</span>`).join('')
    typing = null
  }
}

// ───────────── demonstração: correlação ─────────────
const xc = $('#xcDemo')
if (xc) {
  const N = 600
  const peaks = scenePeaks(N, 31)
  const cvA = $('#xcA')
  const cvB = $('#xcB')
  const path = $('#xcPath')
  const dotPeak = $('#xcPeak')
  const off = $('#xcOff')
  const conf = $('#xcConf')
  const cap = $('#xcCap')
  // B é um trecho do gravador que começa em 0,38 do total
  const B0 = 0.38
  const BW = 0.42
  const size = () => {
    cvA.style.left = '8px'
    cvA.style.width = 'calc(100% - 16px)'
    cvB.style.width = `calc((100% - 16px) * ${BW})`
    cvB.style.left = '8px'
    drawStrip(cvA, peaks, 0, N, 'rgba(255,255,255,0.75)', 1)
    drawStrip(cvB, peaks, B0 * N, (B0 + BW) * N, '#bf5af2', 2, 0.1)
  }
  size()
  addEventListener('resize', size)
  // curva de correlação pré-calculada (com ruído) e pico em B0
  const M = 120
  const curve = new Float32Array(M)
  const r = rng(5)
  for (let k = 0; k < M; k++) {
    const x = (k / (M - 1)) * (1 - BW)
    const d = Math.abs(x - B0)
    curve[k] = 0.12 + r() * 0.18 + Math.exp(-(d * d) / 0.00018) * 0.75
  }
  let t = 0
  loop(xc, (dt) => {
    t = (t + dt) % 7
    const p = Math.min(1, t / 3.6)
    const k = Math.floor(p * (M - 1))
    const x = (k / (M - 1)) * (1 - BW)
    const track = cvA.clientWidth
    cvB.style.transform = `translateX(${x * track}px)`
    let d = ''
    for (let j = 0; j <= k; j++) d += `${j ? 'L' : 'M'}${((j / (M - 1)) * 400).toFixed(1)} ${(78 - curve[j] * 74).toFixed(1)}`
    path.setAttribute('d', d)
    if (p >= 1) {
      const pk = Math.round((B0 / (1 - BW)) * (M - 1))
      cvB.style.transform = `translateX(${B0 * track}px)`
      cvB.style.transition = 'transform .6s cubic-bezier(.32,.72,0,1)'
      dotPeak.setAttribute('cx', ((pk / (M - 1)) * 400).toFixed(1))
      dotPeak.setAttribute('cy', (78 - curve[pk] * 74).toFixed(1))
      dotPeak.setAttribute('opacity', 1)
      off.textContent = '+00:00:41.236'
      conf.textContent = '99%'
      cap.textContent = 'Achou: a câmera B entra 41,236 s depois do gravador.'
    } else {
      cvB.style.transition = 'none'
      dotPeak.setAttribute('opacity', 0)
      const sec = x * 108
      off.textContent = `+00:00:${sec.toFixed(3).padStart(6, '0')}`
      conf.textContent = '—'
      cap.textContent = 'Procurando o encaixe…'
    }
  })
}

// ───────────── abas de exportação ─────────────
const E = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xml = (s) =>
  E(s).replace(/&lt;(\/?)([\w:-]+)([^]*?)(\/?)&gt;/g, (m, slash, name, attrs, close) => `&lt;${slash}<span class="k">${name}</span>${attrs.replace(/([\w:-]+)="([^"]*)"/g, '<span class="a">$1</span>=<span class="s">"$2"</span>')}${close}&gt;`)
const USES = {
  premiere: {
    title: 'Adobe Premiere Pro',
    text: 'Um XML com uma sequência por sessão, cada câmera numa faixa de vídeo e cada canal do gravador numa faixa de áudio. Com multicâmera ligado, os ângulos chegam aninhados numa sequência de edição.',
    specs: [['Arquivo', '.xml (Final Cut 7)'], ['Multicâmera', 'sequência aninhada'], ['Cores', 'uma por aparelho']],
    steps: ['Arquivo › Importar…', 'Escolha o .xml do Synquei', 'Multicâmera: clique com o direito no clipe › Multicâmera › Ativar'],
    code: xml(`<clipitem id="clipitem-4">
  <name>C0042.MP4</name>
  <start>1031</start>
  <end>3981</end>
  <file id="file-3">
    <pathurl>file://localhost/Volumes/SSD/CAM%20B/C0042.MP4</pathurl>
    <timecode><string>18:04:51:12</string></timecode>
  </file>
  <labels><label2>Violet</label2></labels>
</clipitem>`),
  },
  resolve: {
    title: 'DaVinci Resolve',
    text: 'Um XML por sessão (e um OTIO, se preferir). O Resolve monta a linha do tempo e já traz os clipes para o Media Pool. Com multicâmera, vai junto um .fcpxml com o clipe multicâmera.',
    specs: [['Arquivos', '.xml + .otio + .fcpxml'], ['Multicâmera', 'Resolve 18 ou mais novo'], ['Início', 'TC real ou 01:00']],
    steps: ['File › Import › Timeline…', 'Escolha o .xml da sessão', 'Marque "import source clips into media pool"'],
    code: xml(`<sequence id="sequence-1">
  <name>Sessão 1 · 01 de mai, 14:22</name>
  <rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate>
  <timecode><string>14:22:08:00</string></timecode>
  <media>
    <video><track>…CAM A…</track><track>…CAM B…</track></video>
    <audio><track>…Boom…</track><track>…Lapela…</track></audio>
  </media>
</sequence>`),
  },
  fcp: {
    title: 'Final Cut Pro',
    text: 'FCPXML com um projeto em camadas e um clipe multicâmera por sessão. O áudio do gravador entra com precisão de amostra.',
    specs: [['Arquivo', '.fcpxml 1.10'], ['Multicâmera', 'um ângulo por aparelho'], ['Áudio da câmera', 'manter, mudo ou fora']],
    steps: ['Arquivo › Importar › XML…', 'Escolha o .fcpxml', 'Abra o projeto ou o clipe multicâmera'],
    code: xml(`<multicam format="r1" tcStart="0s" tcFormat="NDF">
  <mc-angle name="CAM A" angleID="m1-a1">
    <gap offset="0s" duration="1001/240s"/>
    <asset-clip ref="a1" offset="1001/240s" duration="1801800/24000s"/>
  </mc-angle>
  <mc-angle name="GRAVADOR" angleID="m1-a4">
    <asset-clip ref="a5" offset="0s" start="51728237/1000s"/>
  </mc-angle>
</multicam>`),
  },
  avid: {
    title: 'Avid Media Composer',
    text: 'Um ALE com o tempo sincronizado no Auxiliary TC1, mais uma EDL por câmera. No Avid, junte o ALE aos clipes e agrupe pelo Aux TC.',
    specs: [['Arquivos', '.ale + .edl'], ['Agrupar', 'Auxiliary TC1'], ['Metadados', 'cena, take, câmera']],
    steps: ['Vincule a mídia (Source Browser › Link)', 'Input › Shot Log, com Merge events', 'Group Clips ou Multigroup › Auxiliary TC1'],
    code: E(`Heading
FIELD_DELIM\tTABS
FPS\t23.976

Column
Name\tTape\tStart\tTracks\tAuxiliary TC1\tCamera

Data
C0042\tC0042\t18:04:51:12\tVA1A2\t14:22:51:00\tCAM B
ZOOM0007\tZOOM0007\t14:22:08:00\tA1A2\t14:22:08:00\tGRAVADOR`),
  },
  vegas: {
    title: 'Vegas Pro e Lightworks',
    text: 'O mesmo XML do Final Cut 7, um arquivo por sessão. O Vegas importa pelo menu de projetos do Final Cut/Resolve.',
    specs: [['Arquivo', '.xml por sessão'], ['Faixas', 'uma por aparelho']],
    steps: ['Arquivo › Importar › Final Cut Pro 7 / DaVinci Resolve', 'Escolha o .xml da sessão', 'Pronto para cortar'],
    code: xml(`<xmeml version="4">
  <sequence id="sequence-1">
    <name>Sessão 2 · 01 de mai, 16:40</name>
    <duration>86520</duration>
    …
  </sequence>
</xmeml>`),
  },
  otio: {
    title: 'OpenTimelineIO, EDL e relatório',
    text: 'OTIO para pipelines e ferramentas abertas, EDL CMX 3600 para finalização e um CSV com cada clipe, método e confiança.',
    specs: [['OTIO', 'Resolve, Kdenlive, Nuke'], ['EDL', 'uma por faixa'], ['CSV', 'Excel, Numbers']],
    steps: ['Baixe o .zip com tudo', 'Uma pasta por editor', 'O .synquei reabre o projeto depois'],
    code: E(`001  C0042    V     C        18:04:51:12 18:06:54:02 14:22:51:00 14:24:53:14
* FROM CLIP NAME: C0042.MP4
* SOURCE FILE: CAM B/PRIVATE/M4ROOT/CLIP/C0042.MP4

002  C0043    V     C        18:11:02:00 18:12:40:21 14:29:01:12 14:30:40:09
* FROM CLIP NAME: C0043.MP4`),
  },
}
const panel = $('#usePanel')
if (panel) {
  const tabs = $$('.uses-tabs [data-use]')
  let current = 'premiere'
  let auto = true
  const render = (key) => {
    const u = USES[key]
    $('#useTitle').textContent = u.title
    $('#useText').textContent = u.text
    $('#useSpecs').innerHTML = u.specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')
    $('#useSteps').innerHTML = u.steps.map((s) => `<li>${E(s)}</li>`).join('')
    $('#useCode').innerHTML = u.code
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.use === key)))
  }
  const show = (key) => {
    if (key === current) return
    current = key
    if (reduce) return render(key)
    panel.classList.add('swap')
    setTimeout(() => {
      render(key)
      panel.classList.remove('swap')
    }, 260)
  }
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      auto = false
      show(t.dataset.use)
    }),
  )
  render(current)
  let t = 0
  const keys = Object.keys(USES)
  loop(panel, (dt) => {
    if (!auto) return
    t += dt
    if (t > 7) {
      t = 0
      show(keys[(keys.indexOf(current) + 1) % keys.length])
    }
  })
}

// ───────────── tipos de projeto ─────────────
const lista = $('#tiposLista')
const painel = $('#tipoPainel')
if (lista && painel) {
  const H = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const ic = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`
  // o que o tipo muda, dito em português
  const ajustes = (t) => {
    const s = t.sync
    const out = []
    if (s.mode === 'audio') out.push('Só pelo som: timecode e data não interferem')
    if (s.chronological === false) out.push('Takes do mesmo aparelho podem se sobrepor')
    if (s.drift) out.push('Correção de deriva para gravações longas')
    if (s.sessionGap === 0) out.push('Tudo numa sequência só')
    else if (s.sessionGap) out.push(`Nova sequência depois de ${s.sessionGap} min de pausa`)
    if (s.useDate) out.push('Clipes sem som entram pela data e hora')
    if (s.minConf != null && s.minConf < 0.4) out.push('Aceita mais clipes em ambiente barulhento')
    if (s.minConf != null && s.minConf > 0.4) out.push('Mais rigor para evitar encaixe errado')
    if (!out.length) out.push('Ajustes equilibrados para qualquer gravação')
    return out
  }
  lista.innerHTML = GRUPOS.map((g) => `<div class="tg"><p>${H(g.label)}</p><div>${TIPOS.filter((t) => t.grupo === g.id).map((t) => `<button role="tab" class="tp is-${t.tom}" data-t="${t.id}" aria-selected="false">${ic(t.icon)}${H(t.label)}</button>`).join('')}</div></div>`).join('')
  const btns = $$('[data-t]', lista)
  let atual = null
  let auto = true
  const render = (id) => {
    const t = TIPOS.find((x) => x.id === id)
    atual = id
    btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === id)))
    painel.className = `tipo-painel is-${t.tom}`
    painel.innerHTML = `<div class="tpp-topo"><span class="tpp-ic">${ic(t.icon)}</span><div><h3>${H(t.label)}</h3><p>${H(t.resumo)}</p></div><span class="tpp-mc ${t.multicam ? 'on' : ''}">${ic('multicam')}${t.multicam ? 'Multicâmera ligado' : 'Multicâmera opcional'}</span></div>
      <div class="tpp-cols"><div><p class="tpp-eb">O que o Synquei ajusta</p><ul class="tpp-aj">${ajustes(t).map((a) => `<li>${ic('check')}${H(a)}</li>`).join('')}</ul></div><div><p class="tpp-eb">Dicas de gravação</p><ol class="tpp-dicas">${t.dicas.map((d) => `<li>${H(d)}</li>`).join('')}</ol></div></div>`
  }
  const show = (id) => {
    if (id === atual) return
    if (reduce) return render(id)
    painel.classList.add('swap')
    setTimeout(() => {
      render(id)
      painel.classList.remove('swap')
    }, 220)
  }
  lista.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]')
    if (!b) return
    auto = false
    show(b.dataset.t)
  })
  render('videoclipe')
  const ordem = ['videoclipe', 'show', 'dvd', 'entrevista', 'casamento', 'conteudo', 'podcast', 'culto', 'ficcao']
  let tt = 0
  loop(painel, (dt) => {
    if (!auto) return
    tt += dt
    if (tt > 4.5) {
      tt = 0
      show(ordem[(ordem.indexOf(atual) + 1) % ordem.length] || 'videoclipe')
    }
  })
}

// ───────────── nuvem de formatos ─────────────
const cloud = $('#cloud')
if (cloud) {
  const seen = new Set()
  const items = []
  const add = (e, raw) => {
    if (seen.has(e)) return
    seen.add(e)
    items.push(`<span${raw ? ' class="raw"' : ''}>.${e}</span>`)
  }
  for (const r of RAW) for (const e of r.ext) add(e, r.id !== 'seq' && e !== 'mov' && e !== 'mxf')
  for (const c of CONTAINERS) for (const e of c.ext) add(e, false)
  cloud.innerHTML = items.slice(0, 64).join('')
}

// ───────────── baixar: copiar o comando e aviso de instalador ainda sendo gerado ─────────────
for (const b of $$('[data-copy]')) {
  b.addEventListener('click', async () => {
    const txt = document.getElementById(b.dataset.copy).textContent
    try {
      await navigator.clipboard.writeText(txt)
    } catch {
      const r = document.createRange()
      r.selectNodeContents(document.getElementById(b.dataset.copy))
      getSelection().removeAllRanges()
      getSelection().addRange(r)
      document.execCommand('copy')
    }
    b.classList.add('ok')
    b.lastChild.textContent = 'Copiado'
    setTimeout(() => {
      b.classList.remove('ok')
      b.lastChild.textContent = 'Copiar'
    }, 1800)
  })
}
if (new URLSearchParams(location.search).get('baixar') === 'indisponivel') {
  const a = $('#baixarAviso')
  if (a) a.hidden = false
}
