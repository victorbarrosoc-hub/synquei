// Reconhecimento de arquivo: assinatura nos primeiros bytes (não confia só na extensão) → leitor certo → ficha
// padronizada do clipe. Um .MP4 que é MOV, um WAV que é RF64 ou um arquivo sem extensão caem no leitor certo.

import { Reader, ascii, u32be } from './reader.js'
import { extInfo } from './formats.js'
import { probeMp4 } from './mp4.js'
import { probeWav, probeAiff, probeAvi } from './riff.js'
import { probeMxf } from './mxf.js'
import { probeMkv } from './ebml.js'
import { probeTs, packetSize } from './ts.js'
import { probeTiff, probeR3d, probeCine } from './raw.js'

export const CONTAINER_LABEL = {
  mov: 'QuickTime',
  mp4: 'MPEG-4',
  mxf: 'MXF',
  wav: 'WAV',
  rf64: 'RF64',
  w64: 'Wave64',
  aiff: 'AIFF',
  avi: 'AVI',
  mkv: 'Matroska',
  webm: 'WebM',
  ts: 'MPEG-TS',
  m2ts: 'AVCHD',
  ps: 'MPEG-PS',
  tiff: 'Quadro',
  r3d: 'R3D',
  cine: 'Cine',
  mp3: 'MP3',
  flac: 'FLAC',
  ogg: 'Ogg',
  caf: 'CAF',
  asf: 'ASF',
  flv: 'FLV',
  aac: 'AAC',
  ac3: 'AC-3',
  amr: 'AMR',
  au: 'AU',
  ari: 'ARRIRAW',
  dpx: 'DPX',
  exr: 'OpenEXR',
  braw: 'Blackmagic RAW',
  crm: 'Canon RAW',
  nev: 'N-RAW',
}

/** Assinatura → contêiner. */
export function sniff(b, ext) {
  const a = (o, n) => ascii(b, o, n)
  if (b.length < 12) return null
  const t4 = a(4, 4)
  if (t4 === 'ftyp') {
    const brand = a(8, 4)
    if (brand === 'qt  ' || brand === 'crx ') return 'mov'
    return 'mp4'
  }
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'junk'].includes(t4) && u32be(b, 0) >= 8) return 'mov'
  const t0 = a(0, 4)
  if (t0 === 'RIFF' && a(8, 4) === 'WAVE') return 'wav'
  if ((t0 === 'RF64' || t0 === 'BW64') && a(8, 4) === 'WAVE') return 'rf64'
  if (t0 === 'RIFF' && a(8, 4) === 'AVI ') return 'avi'
  if (t0 === 'riff' && b[4] === 0x2e && b[5] === 0x91) return 'w64'
  if (t0 === 'FORM' && (a(8, 4) === 'AIFF' || a(8, 4) === 'AIFC')) return 'aiff'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv'
  if (b[0] === 0x06 && b[1] === 0x0e && b[2] === 0x2b && b[3] === 0x34) return 'mxf'
  if (b.length >= 400 && packetSize(b)) return 'ts'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xba) return 'ps'
  if (t0 === 'fLaC') return 'flac'
  if (t0 === 'OggS') return 'ogg'
  if (t0 === 'caff') return 'caf'
  if (t0 === '.snd') return 'au'
  if (a(0, 3) === 'FLV') return 'flv'
  if (a(0, 5) === '#!AMR') return 'amr'
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return 'asf'
  if (a(0, 3) === 'ID3') return 'mp3'
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac'
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'
  if (b[0] === 0x0b && b[1] === 0x77) return 'ac3'
  if (t4 === 'RED1' || t4 === 'RED2') return 'r3d'
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42)) return 'tiff'
  if (t0 === 'SDPX' || t0 === 'XPDS') return 'dpx'
  if (b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01) return 'exr'
  if (a(0, 2) === 'CI' && ext === 'cine') return 'cine'
  if (t0 === 'ARRI') return 'ari'
  return null
}

const KIND_BY = { wav: 'audio', rf64: 'audio', w64: 'audio', aiff: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', caf: 'audio', au: 'audio', aac: 'audio', ac3: 'audio', amr: 'audio', tiff: 'image', dpx: 'image', exr: 'image', ari: 'image' }

/** Lê um arquivo e devolve a ficha do clipe. */
export async function probe(file, relPath = file.name) {
  const name = relPath.split('/').pop()
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase()
  const r = new Reader(file)
  const head = await r.bytes(0, Math.min(file.size, 1024))
  const sniffed = sniff(head, ext)
  const byExt = extInfo(ext)
  let container = sniffed || (byExt ? byExt.id : null)
  // BRAW, CRM e N-RAW: família QuickTime/ISO mesmo quando a assinatura não bate
  if (!sniffed && ['braw', 'crm', 'nev', 'insv', 'lrv', '360', 'm4a', 'm4v', '3gp', '3g2'].includes(ext)) container = 'mp4'
  let info
  try {
    switch (container) {
      case 'mov':
      case 'mp4':
        info = await probeMp4(r, { ext })
        break
      case 'wav':
      case 'rf64':
      case 'w64':
        info = await probeWav(r, container === 'w64' ? 'w64' : null)
        break
      case 'aiff':
        info = await probeAiff(r)
        break
      case 'avi':
        info = await probeAvi(r)
        break
      case 'mxf':
        info = await probeMxf(r)
        break
      case 'mkv':
        info = await probeMkv(r)
        break
      case 'ts':
      case 'mts':
        info = await probeTs(r)
        break
      case 'tiff':
      case 'cdng':
        info = await probeTiff(r)
        break
      case 'r3d':
        info = await probeR3d(r)
        break
      case 'cine':
        info = await probeCine(r)
        break
      default:
        info = { container: container || ext || 'desconhecido', warnings: [] }
        if (KIND_BY[container] === 'audio' || (byExt && byExt.kind === 'audio')) info.audioPlan = { type: 'decode' }
    }
  } catch (e) {
    info = { container: container || ext, warnings: [e.message || String(e)], error: e.message || String(e) }
  }

  // ── ficha padronizada ──
  const isRawExt = byExt && byExt.raw
  const out = {
    ext,
    container: info.container,
    containerLabel: CONTAINER_LABEL[ext === 'braw' ? 'braw' : ext === 'crm' ? 'crm' : ext === 'nev' ? 'nev' : info.container] || (byExt ? byExt.name : (info.container || '').toUpperCase()),
    kind: info.video ? (KIND_BY[info.container] === 'image' ? 'image' : 'video') : info.audio || info.audioPlan ? 'audio' : KIND_BY[container] || (byExt ? byExt.kind : 'unknown'),
    raw: !!((info.video && info.video.raw) || isRawExt),
    video: info.video || null,
    audio: info.audio || null,
    duration: info.duration || null,
    timecode: info.timecode || null,
    created: info.created || null,
    createdSource: info.created ? 'metadado' : null,
    device: info.device || null,
    meta: info.meta || null,
    software: info.software || null,
    trackNames: info.trackNames || null,
    opAtom: !!info.opAtom,
    warnings: info.warnings || [],
    error: info.error || null,
    audioPlan: info.audioPlan || null,
  }
  // gravado por software (conversão, exportação): não é o aparelho que filmou
  if (out.device && /ffmpeg|lavf|handbrake|opatom|op1a muxer|compressor|davinci|media composer|premiere|final cut/i.test(`${out.device.make} ${out.device.model}`)) {
    out.software = out.software || [out.device.make, out.device.model].filter(Boolean).join(' ')
    out.device = null
  }
  if (out.video && out.video.raw && out.kind === 'video' && out.container === 'mov' && /ProRes RAW/.test(out.video.codec)) out.containerLabel = 'QuickTime (ProRes RAW)'
  // sem data no arquivo: cartões gravam a hora de modificação no fim da gravação
  if (!out.created && file.lastModified) {
    out.created = file.lastModified - (out.duration || 0) * 1000
    out.createdSource = 'arquivo'
  }
  if (out.audio === null && out.audioPlan && out.audioPlan.type === 'decode') out.audio = { codec: (CONTAINER_LABEL[info.container] || ext).toUpperCase(), sampleRate: null, channels: null }
  return out
}
