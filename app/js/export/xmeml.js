// XML do Final Cut 7 (xmeml v4): o formato de troca que Premiere Pro, DaVinci Resolve, Vegas Pro e Lightworks importam.

import { esc, clipPath, pathUrl, premiereLabel } from './model.js'
import { framesToTc, nominal, isNtsc } from '../time.js'

const rateXml = (r, ind) => `${ind}<rate>\n${ind}  <timebase>${nominal(r)}</timebase>\n${ind}  <ntsc>${isNtsc(r) ? 'TRUE' : 'FALSE'}</ntsc>\n${ind}</rate>`

function tcXml(frames, rate, drop, ind) {
  return `${ind}<timecode>\n${rateXml(rate, ind + '  ')}\n${ind}  <string>${framesToTc(frames, rate, drop)}</string>\n${ind}  <frame>${frames}</frame>\n${ind}  <displayformat>${drop ? 'DF' : 'NDF'}</displayformat>\n${ind}</timecode>`
}

function sequenceXml(tl, opts, ids, n) {
  const I = '    '
  const r = tl.rate
  // ids e posições de cada clipitem, para os links vídeo↔áudio
  const vt = tl.video.map((t, ti) => t.items.map((it, ci) => ({ it, id: `clipitem-${++ids.clip}`, track: ti + 1, index: ci + 1, type: 'video' })))
  const at = tl.audio.map((t, ti) => t.items.map((it, ci) => ({ it, id: `clipitem-${++ids.clip}`, track: ti + 1, index: ci + 1, type: 'audio', ch: t.channel, enabled: t.enabled })))
  const groups = new Map()
  for (const e of [...vt.flat(), ...at.flat()]) {
    const k = e.it
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(e)
  }
  const fileXml = (c, ind) => {
    if (ids.files.has(c.id)) return `${ind}<file id="${ids.files.get(c.id)}"/>`
    const fid = `file-${ids.files.size + 1}`
    ids.files.set(c.id, fid)
    const durF = Math.max(1, Math.round(((c.duration || 0) * r.num) / r.den))
    const parts = [`${ind}<file id="${fid}">`, `${ind}  <name>${esc(c.name)}</name>`, `${ind}  <pathurl>${esc(pathUrl(clipPath(c, opts)))}</pathurl>`, rateXml(r, ind + '  '), `${ind}  <duration>${durF}</duration>`]
    if (c.timecode) parts.push(tcXml(c.timecode.frames, c.timecode.rate, c.timecode.drop, ind + '  '))
    parts.push(`${ind}  <media>`)
    if (c.video && c.kind !== 'audio') {
      parts.push(`${ind}    <video>\n${ind}      <samplecharacteristics>\n${rateXml(c.video.rate || r, ind + '        ')}\n${ind}        <width>${c.video.width || tl.width}</width>\n${ind}        <height>${c.video.height || tl.height}</height>\n${ind}        <anamorphic>FALSE</anamorphic>\n${ind}        <pixelaspectratio>square</pixelaspectratio>\n${ind}        <fielddominance>none</fielddominance>\n${ind}      </samplecharacteristics>\n${ind}    </video>`)
    }
    if (c.audio && c.audioStatus !== 'none') {
      const ch = c.audio.totalChannels || c.audio.channels || 2
      parts.push(`${ind}    <audio>\n${ind}      <samplecharacteristics>\n${ind}        <depth>${c.audio.bits || 16}</depth>\n${ind}        <samplerate>${c.audio.sampleRate || 48000}</samplerate>\n${ind}      </samplecharacteristics>\n${ind}      <channelcount>${ch}</channelcount>\n${ind}    </audio>`)
    }
    parts.push(`${ind}  </media>`, `${ind}</file>`)
    return parts.join('\n')
  }
  const clipXml = (e, ind) => {
    const { it } = e
    const c = it.clip
    if (!ids.master.has(c.id)) ids.master.set(c.id, `masterclip-${ids.master.size + 1}`)
    const lines = [
      `${ind}<clipitem id="${e.id}">`,
      `${ind}  <masterclipid>${ids.master.get(c.id)}</masterclipid>`,
      `${ind}  <name>${esc(c.name)}</name>`,
      `${ind}  <enabled>${e.type === 'audio' && !e.enabled ? 'FALSE' : 'TRUE'}</enabled>`,
      `${ind}  <duration>${it.durF}</duration>`,
      rateXml(r, ind + '  '),
      `${ind}  <start>${it.startF}</start>`,
      `${ind}  <end>${it.startF + it.durF}</end>`,
      `${ind}  <in>0</in>`,
      `${ind}  <out>${it.durF}</out>`,
      fileXml(c, ind + '  '),
    ]
    if (e.type === 'audio') lines.push(`${ind}  <sourcetrack>\n${ind}    <mediatype>audio</mediatype>\n${ind}    <trackindex>${e.ch}</trackindex>\n${ind}  </sourcetrack>`)
    const g = groups.get(it)
    if (g && g.length > 1) for (const l of g) lines.push(`${ind}  <link>\n${ind}    <linkclipref>${l.id}</linkclipref>\n${ind}    <mediatype>${l.type}</mediatype>\n${ind}    <trackindex>${l.track}</trackindex>\n${ind}    <clipindex>${l.index}</clipindex>${l.type === 'audio' ? `\n${ind}    <groupindex>1</groupindex>` : ''}\n${ind}  </link>`)
    const dev = c.deviceId ? opts.__devices.get(c.deviceId) : null
    lines.push(`${ind}  <labels>\n${ind}    <label2>${premiereLabel(dev)}</label2>\n${ind}  </labels>`)
    lines.push(`${ind}</clipitem>`)
    return lines.join('\n')
  }
  const J = I + '      '
  const video = vt.map((list) => `${I}      <track>\n${list.map((e) => clipXml(e, J + '  ')).join('\n')}\n${J}<enabled>TRUE</enabled>\n${J}<locked>FALSE</locked>\n${I}      </track>`).join('\n')
  const audio = at.map((list, i) => `${I}      <track>\n${list.map((e) => clipXml(e, J + '  ')).join('\n')}\n${J}<enabled>TRUE</enabled>\n${J}<locked>FALSE</locked>\n${J}<outputchannelindex>${(i % 2) + 1}</outputchannelindex>\n${I}      </track>`).join('\n')
  const markers = tl.markers.map((m) => `${I}  <marker>\n${I}    <comment>${esc(m.note)}</comment>\n${I}    <name>${esc(m.name)}</name>\n${I}    <in>${Math.round((m.start * r.num) / r.den)}</in>\n${I}    <out>-1</out>\n${I}  </marker>`).join('\n')
  return [
    `${I}<sequence id="sequence-${n}">`,
    `${I}  <name>${esc(tl.name)}</name>`,
    `${I}  <duration>${tl.durationF}</duration>`,
    rateXml(r, I + '  '),
    `${I}  <media>`,
    `${I}    <video>`,
    `${I}      <format>\n${I}        <samplecharacteristics>\n${rateXml(r, I + '          ')}\n${I}          <width>${tl.width}</width>\n${I}          <height>${tl.height}</height>\n${I}          <anamorphic>FALSE</anamorphic>\n${I}          <pixelaspectratio>square</pixelaspectratio>\n${I}          <fielddominance>none</fielddominance>\n${I}        </samplecharacteristics>\n${I}      </format>`,
    video,
    `${I}    </video>`,
    `${I}    <audio>`,
    `${I}      <numOutputChannels>2</numOutputChannels>`,
    `${I}      <format>\n${I}        <samplecharacteristics>\n${I}          <depth>16</depth>\n${I}          <samplerate>48000</samplerate>\n${I}        </samplecharacteristics>\n${I}      </format>`,
    audio,
    `${I}    </audio>`,
    `${I}  </media>`,
    tcXml(tl.startFrames, r, tl.drop, I + '  '),
    markers,
    `${I}</sequence>`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Um arquivo com várias sequências dentro de um projeto (Premiere) ou uma sequência solta (Resolve, Vegas). */
export function toXmeml(timelines, project, { wrap = true } = {}) {
  const opts = { ...project.export, __devices: new Map(project.devices.map((d) => [d.id, d])) }
  const ids = { clip: 0, files: new Map(), master: new Map() }
  const seqs = timelines.map((tl, i) => sequenceXml(tl, opts, ids, i + 1))
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">'
  if (!wrap && seqs.length === 1) return `${head}\n${seqs[0].replace(/^ {4}/gm, '  ')}\n</xmeml>\n`
  return `${head}\n  <project>\n    <name>${esc(project.name)}</name>\n    <children>\n${seqs.map((s) => s.replace(/^/gm, '    ')).join('\n')}\n    </children>\n  </project>\n</xmeml>\n`
}
