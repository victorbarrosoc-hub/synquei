// Agrupa os clipes por aparelho (câmera, gravador, celular). A organização de pastas de quem arrastou vale mais:
// "CAM A", "CAM B", "AUDIO" viram os grupos. Sem isso, entram modelo e número de série, estrutura do cartão,
// letra de câmera no nome (A001C001 → câmera A) e, por último, o padrão do nome do arquivo.

import { CARD_LAYOUTS, NAME_PATTERNS } from './formats.js'

const GENERIC_DIRS = /^(DCIM|PRIVATE|M4ROOT|CLIP|CLIPS\d*|XDROOT|CONTENTS|AVCHD|BDMV|STREAM|\d{3}[A-Z_]+|DJI_\d+|\d{3}MEDIA|FOLDER\d+|MISC|Camera\d+|\d{8})$/i

// Cor de cada aparelho: paleta categórica validada para daltonismo (ordem fixa, nunca reciclada). Do 9º aparelho em
// diante, todos ficam no cinza "outros". Versão clara para superfícies claras; escura para os palcos e o tema escuro.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8e8e93']
export const PALETTE_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#8e8e93']
export const devColor = (d, dark = false) => (dark ? PALETTE_DARK : PALETTE)[Math.min(8, d && d.color != null ? d.color : 8)]

function hint(relPath, name) {
  for (const c of CARD_LAYOUTS) if (c.re.test(relPath)) return c
  for (const p of NAME_PATTERNS) if (p.re.test(name)) return p
  return null
}

function camLetter(name) {
  const m = name.match(/^([A-Z])\d{3}[_]?C\d{3}/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * clips: [{ id, relPath, name, kind, device?, video?, audio? }]
 * @returns {{ devices: Array<{ id, label, kind, brand, model, color }>, assign: Object<string, string> }}
 */
export function groupDevices(clips) {
  const dirs = clips.map((c) => c.relPath.split('/').slice(0, -1))
  // tira o prefixo comum (a pasta do projeto que envolve tudo)
  let common = 0
  if (dirs.length) {
    const minLen = Math.min(...dirs.map((d) => d.length))
    while (common < minLen && dirs.every((d) => d[common] === dirs[0][common])) common++
  }
  const tops = clips.map((c, i) => {
    const t = dirs[i][common]
    return t && !GENERIC_DIRS.test(t) ? t : null
  })
  const distinctTops = new Set(tops.filter(Boolean))
  const useTops = distinctTops.size >= 2

  const groups = new Map()
  clips.forEach((c, i) => {
    const h = hint(c.relPath, c.name)
    const isAudio = c.kind === 'audio'
    const model = c.device && (c.device.model || c.device.make) ? [c.device.make, c.device.model].filter(Boolean).join(' ').replace(/^(\S+) \1\b/i, '$1') : null
    const serial = c.device && c.device.serial
    const letter = camLetter(c.name)
    let key
    let label
    if (c.org && c.org.dono) {
      // Organizar: o dono que o SOBEDESCE gravou ("Aladim - FX30") é o aparelho, em todas as diárias
      key = `org:${c.org.dono}|${isAudio ? 'a' : 'v'}`
      label = c.org.dono
    } else if (useTops && tops[i]) {
      key = `top:${tops[i]}|${isAudio ? 'a' : 'v'}`
      label = tops[i]
    } else if (model) {
      key = `m:${model}|${serial || ''}|${letter || ''}`
      label = letter ? `Câmera ${letter} · ${model}` : model
    } else if (letter) {
      key = `l:${letter}|${h ? h.brand : ''}`
      label = `Câmera ${letter}${h ? ` · ${h.brand}` : ''}`
    } else if (h) {
      key = `h:${h.label}|${isAudio ? 'a' : 'v'}`
      label = h.label
    } else {
      key = isAudio ? 'k:audio' : 'k:video'
      label = isAudio ? 'Áudio' : 'Vídeo'
    }
    if (!groups.has(key)) groups.set(key, { key, label, clips: [], brand: (c.device && c.device.make) || (h && h.brand) || null, model, kindHint: h ? h.kind : null, cor: c.org && c.org.cor != null ? c.org.cor : null })
    groups.get(key).clips.push(c)
  })

  // mesmo rótulo em grupos diferentes (pasta com câmera e gravador): diferencia
  const byLabel = new Map()
  for (const g of groups.values()) byLabel.set(g.label, (byLabel.get(g.label) || 0) + 1)
  for (const g of groups.values()) {
    if (byLabel.get(g.label) > 1) g.label = `${g.label} · ${g.clips.every((c) => c.kind === 'audio') ? 'áudio' : g.model || 'vídeo'}`
  }

  const list = [...groups.values()].map((g) => {
    const allAudio = g.clips.every((c) => c.kind === 'audio')
    return { g, kind: allAudio ? (g.kindHint === 'phone' ? 'phone' : 'recorder') : g.kindHint && g.kindHint !== 'recorder' ? g.kindHint : 'camera' }
  })
  list.sort((a, b) => (a.kind === 'recorder') - (b.kind === 'recorder') || a.g.label.localeCompare(b.g.label, undefined, { numeric: true }))
  const devices = []
  const assign = {}
  list.forEach(({ g, kind }, i) => {
    const id = 'd' + (i + 1)
    // a cor do dono no Organizar vale em todas as diárias (a mesma câmera, a mesma cor no Synquei e no DaVinci)
    devices.push({ id, label: g.label, kind, brand: g.brand, model: g.model, color: Math.min(g.cor != null ? g.cor : i, 8), fixa: g.cor != null, key: g.key })
    for (const c of g.clips) assign[c.id] = id
  })
  return { devices, assign }
}

export const KIND_LABEL = { camera: 'Câmera', recorder: 'Gravador de áudio', phone: 'Celular', action: 'Câmera de ação', drone: 'Drone' }
