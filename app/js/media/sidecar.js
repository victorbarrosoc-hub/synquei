// Metadados em XML que vêm junto da mídia: Sony NonRealTimeMeta (no cartão ou dentro do MP4/MXF) e iXML dos gravadores.
// Expressões regulares em vez de DOMParser: roda igual no navegador, no Worker e no Node.

import { snapRate, framesToLabelSeconds, framesToTc } from '../time.js'

const attr = (xml, tag, name) => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i'))
  return m ? m[1] : null
}
const text = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

/** "23.98p", "29.97i", "25p", "59.94p" → rate. */
function sonyFps(s) {
  if (!s) return null
  const v = parseFloat(s)
  if (!v) return null
  if (/i$/i.test(s) && v < 40) return snapRate(v) // 29.97i = 29.97 quadros
  return snapRate(v === 23.98 ? 23.976 : v === 47.95 ? 47.952 : v === 119.88 ? 119.88 : v)
}

/** BCD "FFSSMMHH" do LtcChange → { h, m, s, f, drop }. */
function sonyLtc(v) {
  if (!v || v.length !== 8) return null
  const byte = (i) => parseInt(v.slice(i * 2, i * 2 + 2), 16)
  const bcd = (x) => (x >> 4) * 10 + (x & 15)
  const ff = byte(0)
  return { f: bcd(ff & 0x3f), s: bcd(byte(1) & 0x7f), m: bcd(byte(2) & 0x7f), h: bcd(byte(3) & 0x3f), drop: !!(ff & 0x40) }
}

export function parseSonyXml(xml) {
  if (!xml || !/NonRealTimeMeta/i.test(xml)) return null
  const out = {}
  const fps = sonyFps(attr(xml, 'VideoFrame', 'formatFps') || attr(xml, 'VideoFrame', 'captureFps') || attr(xml, 'LtcChangeTable', 'tcFps'))
  const dur = parseInt(attr(xml, 'Duration', 'value'), 10)
  if (fps) out.rate = fps
  if (dur && fps) out.duration = (dur * fps.den) / fps.num
  const ltc = sonyLtc(attr(xml, 'LtcChange', 'value'))
  if (ltc) {
    const r = snapRate(+(attr(xml, 'LtcChangeTable', 'tcFps') || 0)) || fps
    if (r) {
      const nom = Math.round(r.num / r.den)
      const drop = ltc.drop && (nom === 30 || nom === 60)
      let frames = ((ltc.h * 60 + ltc.m) * 60 + ltc.s) * nom + ltc.f
      if (drop) {
        const mins = ltc.h * 60 + ltc.m
        frames -= (nom === 30 ? 2 : 4) * (mins - Math.floor(mins / 10))
      }
      out.timecode = { frames, rate: r, drop, seconds: framesToLabelSeconds(frames, r, drop), string: framesToTc(frames, r, drop), source: 'XML Sony' }
    }
  }
  const created = attr(xml, 'CreationDate', 'value')
  if (created && !isNaN(Date.parse(created))) out.created = Date.parse(created)
  const model = attr(xml, 'Device', 'modelName')
  if (model) out.device = { make: attr(xml, 'Device', 'manufacturer') || 'Sony', model, serial: attr(xml, 'Device', 'serialNo') || null }
  const w = parseInt(attr(xml, 'VideoLayout', 'pixel'), 10)
  const h = parseInt(attr(xml, 'VideoLayout', 'numOfVerticalLine'), 10)
  if (w && h) out.size = { width: w, height: h }
  const vc = attr(xml, 'VideoFrame', 'videoCodec')
  if (vc) out.codec = vc
  const ch = parseInt(attr(xml, 'AudioFormat', 'numOfChannel'), 10)
  if (ch) out.audioChannels = ch
  return out
}

/** iXML de gravador (Sound Devices, Zoom, Tascam, Deity…). */
export function parseIxml(xml) {
  if (!xml) return null
  const out = { tracks: [] }
  for (const t of ['PROJECT', 'SCENE', 'TAKE', 'TAPE', 'NOTE']) {
    const v = text(xml, t)
    if (v) out[t.toLowerCase()] = v
  }
  const rate = text(xml, 'TIMECODE_RATE')
  if (rate) {
    const [n, d] = rate.split('/').map(Number)
    out.rate = snapRate(d ? n / d : n)
  }
  const flag = text(xml, 'TIMECODE_FLAG')
  if (flag) out.drop = /^DF$/i.test(flag)
  const hi = text(xml, 'TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI')
  const lo = text(xml, 'TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO')
  if (lo != null) out.samplesSinceMidnight = (+hi || 0) * 4294967296 + +lo
  const sr = text(xml, 'TIMESTAMP_SAMPLE_RATE') || text(xml, 'FILE_SAMPLE_RATE')
  if (sr) out.sampleRate = +sr
  const list = xml.match(/<TRACK>[\s\S]*?<\/TRACK>/gi) || []
  for (const t of list) out.tracks.push({ index: +(text(t, 'CHANNEL_INDEX') || 0), name: text(t, 'NAME') || '' })
  return out
}
