// Mídia: o que foi reconhecido, separado por aparelho. Renomear grupo, mover clipe, ver todos os metadados.

import { S, changed, peaksOf, hasMedia } from '../store.js'
import { h, icon, bytes, plural, drawPeaks, $$, uiDark } from '../util.js'
import { duration, rateLabel } from '../time.js'
import { devColor, KIND_LABEL } from '../media/devices.js'
import { regroup, methodLabel } from '../project.js'
import { go } from '../main.js'
import { urlDe, soltarUrl } from '../media/pathfile.js'

const KIND_ICON = { camera: 'camera', recorder: 'mic', phone: 'phone', action: 'action', drone: 'drone' }
const thumbs = new Map()

function filterClips(clips) {
  const f = S.ui.filter
  const q = S.ui.query.trim().toLowerCase()
  return clips.filter((c) => {
    if (f === 'video' && c.kind === 'audio') return false
    if (f === 'audio' && c.kind !== 'audio') return false
    if (f === 'raw' && !c.raw) return false
    if (f === 'warn' && !(c.warnings && c.warnings.length) && c.status !== 'error' && c.audioStatus !== 'error') return false
    if (q && !`${c.name} ${c.relPath} ${c.video ? c.video.codec : ''} ${c.device ? c.device.model : ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

function statusCell(c) {
  if (c.status === 'pending' || c.status === 'probing') return `<span class="status is-busy"><i class="dot"></i>Lendo…</span>`
  if (c.status === 'error') return `<span class="status" title="${h(c.error)}"><i class="dot" style="--c:var(--err)"></i>Não abriu</span>`
  if (c.sync) {
    const m = c.sync.method
    const lbl = m.startsWith('audio') ? 'Sincronizado' : m === 'timecode' ? 'Pelo timecode' : m === 'date' ? 'Pela data' : m === 'linked' ? 'Com o WAV' : 'Ajustado'
    return `<span class="status"><i class="dot" style="--c:${c.sync.conf >= 0.5 ? 'var(--ok)' : 'var(--warn)'}"></i>${lbl}</span>`
  }
  if (c.audioStatus === 'error') return `<span class="status" title="${h(c.audioNote)}"><i class="dot" style="--c:var(--warn)"></i>Áudio ilegível</span>`
  if (c.audioStatus === 'none') return `<span class="status" title="${h(c.audioNote || '')}"><i class="dot" style="--c:var(--text-3)"></i>Sem áudio</span>`
  if (c.warnings && c.warnings.length) return `<span class="status" title="${h(c.warnings.join(' · '))}"><i class="dot" style="--c:var(--warn)"></i>Pronto, com aviso</span>`
  return `<span class="status"><i class="dot" style="--c:var(--blue)"></i>Pronto</span>`
}

function formatChips(c) {
  const out = []
  if (c.containerLabel) out.push(`<span class="chip">${h(c.containerLabel)}</span>`)
  if (c.raw) out.push(`<span class="chip chip-raw">RAW</span>`)
  if (c.video && c.video.codec && c.kind !== 'audio') out.push(`<span class="chip chip-blue">${h(c.video.codec)}</span>`)
  else if (c.audio && c.audio.codec) out.push(`<span class="chip chip-lav">${h(c.audio.codec)}${c.audio.bits ? ` ${c.audio.bits}${c.audio.float ? 'f' : ''}` : ''}</span>`)
  if (c.seq) out.push(`<span class="chip">${c.seq.count} quadros</span>`)
  if (c.spans) out.push(`<span class="chip">${c.spans} partes</span>`)
  if (c.linkAudio || c.linkedTo) out.push(`<span class="chip" title="Vídeo e áudio andam juntos">${icon('link')}par</span>`)
  if (c.demo) out.push(`<span class="chip">exemplo</span>`)
  return out.join('')
}

function audioCell(c) {
  if (!c.audio) return '<span class="muted">—</span>'
  const a = c.audio
  const parts = []
  if (a.sampleRate) parts.push(`${(a.sampleRate / 1000).toString().replace('.', ',')} kHz`)
  const ch = a.totalChannels || a.channels
  if (ch) parts.push(ch === 1 ? 'mono' : ch === 2 ? 'estéreo' : `${ch} canais`)
  return `<span class="sub">${parts.join(' · ') || h(a.codec)}</span>`
}

function row(c, i, color) {
  const p = peaksOf(c)
  const th = thumbs.get(c.id)
  const kindIc = c.kind === 'audio' ? 'wave' : c.kind === 'image' ? 'image' : c.raw ? 'raw' : 'film'
  return `<tr data-act="sel" data-id="${c.id}" class="${S.ui.selected === c.id ? 'is-sel' : ''}" style="--i:${Math.min(i, 20)}">
    <td><div class="clip-name"><span class="thumb" data-thumb="${c.id}">${th ? `<img src="${th}" alt="" style="width:100%;height:100%;object-fit:cover">` : p ? `<canvas data-peaks="${c.id}" data-color="${color}"></canvas>` : icon(kindIc)}</span><span><b title="${h(c.name)}">${h(c.name)}</b><small title="${h(c.relPath)}">${h(c.relPath)}</small></span></div></td>
    <td><div class="chips">${formatChips(c)}</div></td>
    <td class="hide-md num">${c.video && c.kind !== 'audio' ? `${c.video.width ? `${c.video.width}×${c.video.height}` : '—'}${c.video.rate ? ` · ${rateLabel(c.video.rate)}` : ''}` : '<span class="muted">—</span>'}</td>
    <td class="num">${duration(c.duration)}</td>
    <td class="hide-sm mono">${c.timecode ? h(c.timecode.string) : '<span class="muted">—</span>'}</td>
    <td class="hide-md">${audioCell(c)}</td>
    <td>${statusCell(c)}</td>
  </tr>`
}

function deviceCard(d, clips, i) {
  const color = devColor(d, uiDark())
  const total = clips.reduce((s, c) => s + (c.duration || 0), 0)
  const models = [...new Set(clips.map((c) => c.device && c.device.model).filter(Boolean))]
  return `<section class="card dev" style="--c:${color};animation:rise .5s var(--ease) both;animation-delay:${i * 50}ms">
    <header class="dev-head">
      <span class="dev-ic">${icon(KIND_ICON[d.kind] || 'camera')}</span>
      <div class="grow">
        <input class="dev-name" value="${h(d.label)}" data-change="dev-name" data-id="${d.id}" aria-label="Nome do aparelho" size="${Math.max(6, d.label.length + 1)}" />
        <div class="dev-meta">${KIND_LABEL[d.kind] || 'Aparelho'}${models.length ? ` · ${h(models.join(', '))}` : ''} · ${plural(clips.length, 'clipe', 'clipes')} · ${duration(total)}</div>
      </div>
      <select class="select" style="width:auto" data-change="dev-kind" data-id="${d.id}" aria-label="Tipo de aparelho">
        ${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${k === d.kind ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </header>
    <div style="overflow-x:auto"><table class="table">
      <thead><tr><th>Clipe</th><th>Formato</th><th class="hide-md">Imagem</th><th>Duração</th><th class="hide-sm">Timecode</th><th class="hide-md">Áudio</th><th>Situação</th></tr></thead>
      <tbody class="stagger">${clips.map((c, k) => row(c, k, color)).join('')}</tbody>
    </table></div>
  </section>`
}

function drawer(c) {
  const p = S.project
  const kv = (k, v) => (v == null || v === '' ? '' : `<dt>${k}</dt><dd>${v}</dd>`)
  const v = c.video
  const a = c.audio
  const tc = c.timecode
  const warn = [...(c.warnings || []), c.error, c.audioNote].filter(Boolean)
  return `<aside class="drawer" role="dialog" aria-label="Detalhes do clipe">
    <header class="drawer-head"><div style="flex:1;min-width:0"><p class="eyebrow">${c.kind === 'audio' ? 'Áudio' : c.kind === 'image' ? 'Sequência de quadros' : 'Vídeo'}</p><h2>${h(c.name)}</h2><p class="sub" style="font-size:12px;word-break:break-all">${h(c.relPath)}</p></div><button class="icon-btn" data-act="close-drawer" aria-label="Fechar">${icon('close')}</button></header>
    <div class="drawer-body">
      <div class="chips">${formatChips(c)}</div>
      ${warn.length ? `<div class="warn-box">${icon('warn')}<div>${warn.map(h).join('<br>')}</div></div>` : ''}
      <label class="field"><span>Aparelho</span><select class="select" data-change="move" data-id="${c.id}">${p.devices.map((d) => `<option value="${d.id}" ${d.id === c.deviceId ? 'selected' : ''}>${h(d.label)}</option>`).join('')}<option value="__new">Novo aparelho…</option></select></label>
      <dl class="kv">
        ${kv('Contêiner', h(c.containerLabel))}
        ${kv('Tamanho', bytes(c.size))}
        ${kv('Duração', duration(c.duration))}
        ${v && c.kind !== 'audio' ? kv('Vídeo', `${h(v.codec)}${v.fourcc ? ` <span class="muted mono">${h(v.fourcc)}</span>` : ''}`) : ''}
        ${v && v.width ? kv('Resolução', `${v.width}×${v.height}${v.interlaced ? ' entrelaçado' : ''}`) : ''}
        ${v && v.rate ? kv('Quadros/s', rateLabel(v.rate)) : ''}
        ${a ? kv('Áudio', `${h(a.codec)}${a.bits ? ` · ${a.bits} bits${a.float ? ' float' : ''}` : ''}`) : ''}
        ${a && a.sampleRate ? kv('Amostragem', `${a.sampleRate.toLocaleString('pt-BR')} Hz`) : ''}
        ${a ? kv('Canais', `${a.totalChannels || a.channels || '—'}${a.tracks > 1 ? ` em ${a.tracks} faixas` : ''}`) : ''}
        ${c.trackNames ? kv('Trilhas', h(c.trackNames.join(', '))) : ''}
        ${tc ? kv('Timecode', `<span class="mono">${h(tc.string)}</span> <span class="muted">${h(tc.source)}${tc.rateGuessed ? ' · taxa presumida' : ''}</span>`) : kv('Timecode', '<span class="muted">não tem</span>')}
        ${c.created ? kv('Gravado em', `${new Date(c.created).toLocaleString('pt-BR')} <span class="muted">(${c.createdSource === 'arquivo' ? 'data do arquivo' : c.createdSource || 'metadado'})</span>`) : ''}
        ${c.device && (c.device.make || c.device.model) ? kv('Câmera / gravador', h([c.device.make, c.device.model].filter(Boolean).join(' ')) + (c.device.serial ? ` <span class="muted">nº ${h(c.device.serial)}</span>` : '')) : ''}
        ${c.software ? kv('Software', h(c.software)) : ''}
        ${c.meta && c.meta.scene ? kv('Cena / take', h(`${c.meta.scene}${c.meta.take ? ` / ${c.meta.take}` : ''}`)) : ''}
        ${c.meta && c.meta.tape ? kv('Fita / rolo', h(c.meta.tape)) : ''}
        ${c.sync ? kv('Sincronia', `${h(methodLabel(c.sync.method))} · ${Math.round(c.sync.conf * 100)}%`) : ''}
      </dl>
      ${!hasMedia(c) ? `<div class="info-box">${icon('info')}<div>Mídia não conectada nesta sessão. Solte a mesma pasta para religar.</div></div>` : ''}
    </div>
  </aside>`
}

export default {
  title: 'Mídia',
  render() {
    const p = S.project
    if (!p || !p.clips.length) {
      return `<div class="page tela"><header class="page-head"><div><h1>Mídia</h1><p class="page-lead">Solte as pastas dos cartões. Cada arquivo é reconhecido pelo conteúdo, não só pela extensão.</p></div></header>
        <section class="drop" id="dropZone"><div class="drop-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div><h2>Arraste as pastas para cá</h2><p>Vale arrastar o cartão inteiro: miniaturas, proxies e arquivos do sistema ficam de fora sozinhos.</p><div class="row"><button class="btn btn-primary btn-lg" data-act="pick-folder">${icon('folder')}Escolher pasta</button><button class="btn btn-secondary btn-lg" data-act="pick-files">${icon('plus')}Arquivos soltos</button></div></section></div>`
    }
    const ready = p.clips
    const counts = { all: ready.length, video: ready.filter((c) => c.kind !== 'audio').length, audio: ready.filter((c) => c.kind === 'audio').length, raw: ready.filter((c) => c.raw).length, warn: ready.filter((c) => (c.warnings && c.warnings.length) || c.status === 'error' || c.audioStatus === 'error').length }
    const size = ready.reduce((s, c) => s + (c.size || 0), 0)
    const missing = ready.filter((c) => !hasMedia(c)).length
    const pr = S.probe
    const seg = [
      ['all', 'Todos'],
      ['video', 'Vídeo'],
      ['audio', 'Áudio'],
      ['raw', 'RAW'],
      ['warn', 'Avisos'],
    ]
      .map(([k, l]) => `<button data-act="filter" data-f="${k}" aria-pressed="${S.ui.filter === k}">${l}<span class="count">${counts[k]}</span></button>`)
      .join('')
    const groups = p.devices.map((d) => [d, filterClips(ready.filter((c) => c.deviceId === d.id))]).filter(([, cs]) => cs.length)
    const loose = filterClips(ready.filter((c) => !c.deviceId || !p.devices.some((d) => d.id === c.deviceId)))
    const sel = S.ui.selected && ready.find((c) => c.id === S.ui.selected)
    return `<div class="page tela">
      <header class="page-head">
        <div><h1>Mídia</h1><p class="page-lead">${plural(ready.length, 'clipe', 'clipes')} · ${plural(p.devices.length, 'aparelho', 'aparelhos')} · ${bytes(size)}</p></div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-act="pick-folder">${icon('folder')}Adicionar pasta</button>
          <button class="btn btn-secondary" data-act="pick-files">${icon('plus')}Arquivos</button>
          <button class="btn btn-primary" data-act="go-sync" ${pr.active ? 'disabled' : ''}>${icon('sync')}Sincronizar</button>
        </div>
      </header>
      <div id="probeBar">${pr.active ? probeBar() : ''}</div>
      ${missing && !pr.active ? `<div class="info-box" style="margin-bottom:16px">${icon('link')}<div><b>${plural(missing, 'clipe sem mídia', 'clipes sem mídia')} nesta sessão.</b> Solte as mesmas pastas para religar (o Synquei acha cada arquivo pelo caminho e pelo tamanho). A exportação funciona mesmo assim.</div></div>` : ''}
      <div class="toolbar"><div class="seg" role="group" aria-label="Filtro">${seg}</div><span class="grow"></span><label class="search">${icon('search')}<input class="input" type="search" placeholder="Buscar clipe, codec, câmera" value="${h(S.ui.query)}" data-input="query" /></label></div>
      ${groups.map(([d, cs], i) => deviceCard(d, cs, i)).join('')}
      ${loose.length ? deviceCard({ id: '', label: 'Sem aparelho', kind: 'camera', color: 8 }, loose, groups.length) : ''}
      ${!groups.length && !loose.length ? `<div class="empty"><h2>Nada com esse filtro</h2></div>` : ''}
      ${p.ignored.length ? `<details class="ignored"><summary>${plural(p.ignored.length, 'arquivo ficou de fora', 'arquivos ficaram de fora')} (miniaturas, metadados, sistema)</summary><ul>${p.ignored.slice(0, 400).map((i) => `<li>${h(i.relPath)} — <span>${h(i.why)}</span></li>`).join('')}</ul></details>` : ''}
    </div>${sel ? drawer(sel) : ''}`
  },
  live() {
    const bar = document.getElementById('probeBar')
    if (bar) bar.innerHTML = S.probe.active ? probeBar() : ''
  },
  after(root) {
    for (const cv of $$('canvas[data-peaks]', root)) {
      const c = S.project.clips.find((x) => x.id === cv.dataset.peaks)
      if (c) drawPeaks(cv, peaksOf(c), cv.dataset.color)
    }
    loadThumbs(root)
  },
  acts: {
    filter(el) {
      S.ui.filter = el.dataset.f
      changed()
    },
    sel(el) {
      S.ui.selected = S.ui.selected === el.dataset.id ? null : el.dataset.id
      changed()
    },
    'close-drawer'() {
      S.ui.selected = null
      changed()
    },
    'go-sync'() {
      go('sincronizar')
    },
  },
  inputs: {
    query(el) {
      S.ui.query = el.value
      changed()
      const i = document.querySelector('[data-input="query"]')
      if (i) {
        i.focus()
        i.setSelectionRange(i.value.length, i.value.length)
      }
    },
  },
  changes: {
    'dev-name'(el) {
      const d = S.project.devices.find((x) => x.id === el.dataset.id)
      if (d && el.value.trim()) {
        d.label = el.value.trim()
        d.renamed = true
        changed()
      }
    },
    'dev-kind'(el) {
      const d = S.project.devices.find((x) => x.id === el.dataset.id)
      if (d) {
        d.kind = el.value
        changed()
      }
    },
    move(el) {
      const p = S.project
      const c = p.clips.find((x) => x.id === el.dataset.id)
      if (!c) return
      let id = el.value
      if (id === '__new') {
        let n = 1
        while (p.devices.some((d) => d.id === 'd' + n)) n++
        id = 'd' + n
        p.devices.push({ id, label: `Aparelho ${p.devices.length + 1}`, kind: c.kind === 'audio' ? 'recorder' : 'camera', color: Math.min(n - 1, 8), manual: true })
      }
      c.deviceId = id
      c.deviceLocked = true
      regroup(p)
      changed()
    },
  },
}

function probeBar() {
  const pr = S.probe
  const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0
  return `<div class="card card-pad" style="margin-bottom:16px;display:grid;gap:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><span class="status is-busy"><i class="dot"></i>Reconhecendo arquivos…</span><span class="num sub">${pr.done} de ${pr.total}</span></div><div class="progress light"><i style="--p:${pct}%"></i></div></div>`
}

// Miniatura do primeiro segundo para vídeos que o navegador consegue abrir (H.264, HEVC; ProRes no Safari)
let thumbBusy = false
async function loadThumbs(root) {
  if (thumbBusy) return
  thumbBusy = true
  try {
    for (const el of $$('[data-thumb]', root)) {
      const id = el.dataset.thumb
      if (thumbs.has(id)) continue
      const c = S.project && S.project.clips.find((x) => x.id === id)
      const f = S.files.get(id)
      if (!c || !f || c.kind !== 'video' || c.demo || !['mov', 'mp4'].includes(c.container)) {
        thumbs.set(id, null)
        continue
      }
      thumbs.set(id, null)
      const url = await frame(f).catch(() => null)
      if (url) {
        thumbs.set(id, url)
        const live = document.querySelector(`[data-thumb="${id}"]`)
        if (live) live.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;animation:fade .4s both">`
      }
    }
  } finally {
    thumbBusy = false
  }
}

function frame(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    const url = urlDe(file)
    const done = (x) => {
      soltarUrl(url)
      v.removeAttribute('src')
      v.load()
      x ? resolve(x) : reject(new Error('sem quadro'))
    }
    const t = setTimeout(() => done(null), 4000)
    v.muted = true
    v.preload = 'metadata'
    v.src = url
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 3)
    }
    v.onseeked = () => {
      clearTimeout(t)
      try {
        const cv = document.createElement('canvas')
        cv.width = 96
        cv.height = 60
        cv.getContext('2d').drawImage(v, 0, 0, 96, 60)
        done(cv.toDataURL('image/jpeg', 0.7))
      } catch {
        done(null)
      }
    }
    v.onerror = () => {
      clearTimeout(t)
      done(null)
    }
  })
}
