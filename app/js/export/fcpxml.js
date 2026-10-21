// FCPXML 1.10 (Final Cut Pro 10.6+, também abre no DaVinci Resolve). Para cada sessão: um projeto com camadas
// (uma por câmera, gravador embaixo) e um clipe multicâmera com um ângulo por aparelho. O áudio que não tem vídeo
// entra com precisão de amostra: o início fica num quadro inteiro e o resto do ajuste vai no corte de entrada.

import { esc, clipPath, fileUrl } from './model.js'
import { Rat, frameDur } from '../time.js'

export function toFcpxml(timelines, project) {
  const opts = project.export
  const mode = opts.fcp || 'both'
  const formats = new Map()
  const assets = new Map()
  const res = []
  const fmtId = (w, h, rate) => {
    const k = `${w}x${h}@${rate.num}/${rate.den}`
    if (!formats.has(k)) {
      const id = `r${formats.size + 1}`
      formats.set(k, id)
      res.push(`    <format id="${id}" frameDuration="${frameDur(rate).fcp()}" width="${w}" height="${h}"/>`)
    }
    return formats.get(k)
  }
  const assetStart = (c) => {
    if (!c.timecode) return new Rat(0)
    if (c.kind === 'audio' && c.timecode.exact != null) return Rat.of(c.timecode.exact, c.audio && c.audio.sampleRate ? c.audio.sampleRate : 48000)
    const r = c.timecode.rate
    return new Rat(c.timecode.frames * r.den, r.num)
  }
  const assetDur = (c, seqRate) => {
    if (c.kind !== 'audio' && c.video) {
      const r = c.video.rate || seqRate
      return new Rat(Math.max(1, Math.round(((c.duration || 0) * r.num) / r.den)) * r.den, r.num)
    }
    const sr = (c.audio && c.audio.sampleRate) || 48000
    return Rat.of(c.duration || 0, sr)
  }
  const assetOf = (c, tl) => {
    if (assets.has(c.id)) return assets.get(c.id)
    const id = `a${assets.size + 1}`
    const start = assetStart(c)
    const dur = assetDur(c, tl.rate)
    const hasV = c.kind !== 'audio' && !!c.video
    const hasA = !!(c.audio && c.audioStatus !== 'none')
    const attrs = [`id="${id}"`, `name="${esc(c.name.replace(/\.[^.]+$/, ''))}"`, `start="${start.fcp()}"`, `duration="${dur.fcp()}"`]
    if (hasV) attrs.push('hasVideo="1"', `format="${fmtId(c.video.width || tl.width, c.video.height || tl.height, c.video.rate || tl.rate)}"`, 'videoSources="1"')
    if (hasA) attrs.push('hasAudio="1"', 'audioSources="1"', `audioChannels="${c.audio.totalChannels || c.audio.channels || 2}"`, `audioRate="${c.audio.sampleRate || 48000}"`)
    res.push(`    <asset ${attrs.join(' ')}>\n      <media-rep kind="original-media" src="${esc(fileUrl(clipPath(c, opts)))}"/>\n    </asset>`)
    const a = { id, start, dur, hasV, hasA }
    assets.set(c.id, a)
    return a
  }

  /** Posição, duração e corte de entrada de um item na grade de quadros da sequência. */
  const place = (it, tl) => {
    const fd = frameDur(tl.rate)
    const a = assetOf(it.clip, tl)
    const fps = tl.rate.num / tl.rate.den
    if (a.hasV) {
      const offF = it.startF
      const maxF = Math.floor(a.dur.value * fps + 1e-6)
      const durF = Math.max(1, Math.min(it.durF, maxF))
      return { a, offset: fd.mul(offF), duration: fd.mul(durF), start: a.start }
    }
    const sr = (it.clip.audio && it.clip.audio.sampleRate) || 48000
    const offF = Math.ceil(it.start * fps - 1e-9)
    const trim = Math.max(0, offF / fps - it.start)
    const trimR = Rat.of(trim, sr)
    const durF = Math.max(1, Math.floor((a.dur.value - trimR.value) * fps + 1e-6))
    return { a, offset: fd.mul(offF), duration: fd.mul(durF), start: a.start.add(trimR) }
  }

  const clipTag = (it, tl, lane, ind) => {
    const p = place(it, tl)
    const c = it.clip
    const isCamAudio = p.a.hasV && p.a.hasA
    const attrs = [`ref="${p.a.id}"`]
    if (lane != null) attrs.push(`lane="${lane}"`)
    attrs.push(`offset="${p.offset.fcp()}"`, `name="${esc(c.name)}"`, `start="${p.start.fcp()}"`, `duration="${p.duration.fcp()}"`)
    if (p.a.hasV) attrs.push(`tcFormat="${tl.drop ? 'DF' : 'NDF'}"`)
    if (isCamAudio && opts.camAudio === 'off') attrs.push('srcEnable="video"')
    const inner = isCamAudio && opts.camAudio === 'mute' ? `\n${ind}  <adjust-volume amount="-96dB"/>\n${ind}` : ''
    return { xml: inner ? `${ind}<asset-clip ${attrs.join(' ')}>${inner}</asset-clip>` : `${ind}<asset-clip ${attrs.join(' ')}/>`, p }
  }

  const projects = []
  const medias = []
  timelines.forEach((tl, ti) => {
    const fd = frameDur(tl.rate)
    const seqFmt = fmtId(tl.width, tl.height, tl.rate)
    const tcStart = fd.mul(tl.startFrames)
    const tcFormat = tl.drop ? 'DF' : 'NDF'
    // itens: vídeo nas camadas de cima (1, 2…), áudio sem vídeo embaixo (-1, -2…)
    const placed = new Set()
    const lanes = []
    tl.video.forEach((t, i) => {
      lanes.push({ lane: i + 1, label: t.label, items: t.items })
      t.items.forEach((it) => placed.add(it))
    })
    let neg = 0
    const audioDevLanes = new Map()
    for (const t of tl.audio) {
      const its = t.items.filter((it) => !placed.has(it) && it.clip.kind === 'audio')
      if (!its.length) continue
      const key = t.label.split(' · ')[0]
      if (!audioDevLanes.has(key)) {
        audioDevLanes.set(key, { lane: --neg, label: key, items: [] })
        lanes.push(audioDevLanes.get(key))
      }
      const l = audioDevLanes.get(key)
      for (const it of its) if (!l.items.includes(it)) l.items.push(it)
    }
    let total = new Rat(tl.durationF * tl.rate.den, tl.rate.num)
    const children = []
    for (const l of lanes) {
      for (const it of l.items.slice().sort((a, b) => a.start - b.start)) {
        const { xml, p } = clipTag(it, tl, l.lane, '              ')
        children.push(xml)
        const end = p.offset.add(p.duration)
        if (end.value > total.value) total = end
      }
    }
    const markers = tl.markers.map((m) => `              <marker start="${fd.mul(Math.round(m.start * tl.fps)).fcp()}" duration="${fd.fcp()}" value="${esc(m.name)}" note="${esc(m.note)}"/>`)
    const seqAttrs = `format="${seqFmt}" duration="${total.fcp()}" tcStart="${tcStart.fcp()}" tcFormat="${tcFormat}" audioLayout="stereo" audioRate="48k"`
    if (mode !== 'multicam') {
      projects.push(`      <project name="${esc(tl.name)}">\n        <sequence ${seqAttrs}>\n          <spine>\n            <gap name="Gap" offset="0s" start="0s" duration="${total.fcp()}">\n${[...children, ...markers].join('\n')}\n            </gap>\n          </spine>\n        </sequence>\n      </project>`)
    }
    if (mode !== 'timeline') {
      const mid = `m${ti + 1}`
      const angles = lanes.map((l, ai) => {
        let cursor = new Rat(0)
        const els = []
        for (const it of l.items.slice().sort((a, b) => a.start - b.start)) {
          const { xml, p } = clipTag(it, tl, null, '            ')
          if (p.offset.value < cursor.value - 1e-9) continue
          if (p.offset.value > cursor.value + 1e-9) els.push(`            <gap name="Gap" offset="${cursor.fcp()}" start="0s" duration="${p.offset.sub(cursor).fcp()}"/>`)
          els.push(xml)
          cursor = p.offset.add(p.duration)
        }
        if (cursor.value < total.value) els.push(`            <gap name="Gap" offset="${cursor.fcp()}" start="0s" duration="${total.sub(cursor).fcp()}"/>`)
        return { id: `${mid}-a${ai + 1}`, label: l.label, video: l.lane > 0, xml: `          <mc-angle name="${esc(l.label)}" angleID="${mid}-a${ai + 1}">\n${els.join('\n')}\n          </mc-angle>` }
      })
      medias.push(`    <media id="${mid}" name="${esc(`${tl.name} · multicâmera`)}">\n      <multicam format="${seqFmt}" tcStart="0s" tcFormat="${tcFormat}">\n${angles.map((a) => a.xml).join('\n')}\n      </multicam>\n    </media>`)
      const v = angles.find((a) => a.video) || angles[0]
      const au = angles.find((a) => !a.video) || v
      const sources = v === au ? `<mc-source angleID="${v.id}" srcEnable="all"/>` : `<mc-source angleID="${v.id}" srcEnable="video"/>\n              <mc-source angleID="${au.id}" srcEnable="audio"/>`
      projects.push(`      <project name="${esc(`${tl.name} · multicâmera`)}">\n        <sequence ${seqAttrs}>\n          <spine>\n            <mc-clip ref="${mid}" offset="0s" name="${esc(tl.name)}" start="0s" duration="${total.fcp()}">\n              ${sources}\n            </mc-clip>\n          </spine>\n        </sequence>\n      </project>`)
    }
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n${[...res, ...medias].join('\n')}\n  </resources>\n  <library>\n    <event name="${esc(`Synquei · ${project.name}`)}">\n${projects.join('\n')}\n    </event>\n  </library>\n</fcpxml>\n`
}
