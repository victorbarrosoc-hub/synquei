// Projeto de exemplo: uma entrevista com três câmeras, um celular e um gravador. Os arquivos são sintetizados aqui
// mesmo (o som de cada aparelho com microfone, eco, ruído e relógio próprios) e o motor sincroniza de verdade.

import { scene, mic, cut, wav } from './sync/synth.js'
import { S, createProject, addEntries, changed } from './store.js'
import { regroup } from './project.js'
import { aplicarTipo } from './tipos.js'
import { snapRate, framesToTc, labelSecondsToFrames } from './time.js'

const SR = 16000

const CLIPS = [
  { path: 'AUDIO/ZOOM0001.WAV', start: 0, len: 175, mic: { gain: 0.9, noise: 0.003, seed: 1 }, audioOnly: true },
  { path: 'CAM A/A001C001_240501_R1AB.mov', start: 6.42, len: 72, mic: { gain: 0.55, lowpass: 0.55, echoMs: 21, echo: 0.3, noise: 0.012, seed: 2 }, video: ['Apple ProRes 4444 XQ', 'ProRes', 3840, 2160, 25], device: ['ARRI', 'ALEXA Mini LF'], label: 'QuickTime', tc: 10 * 3600 + 6.4 },
  { path: 'CAM A/A001C002_240501_R1AB.mov', start: 92.3, len: 66, mic: { gain: 0.55, lowpass: 0.55, echoMs: 21, echo: 0.3, noise: 0.012, seed: 2 }, video: ['Apple ProRes 4444 XQ', 'ProRes', 3840, 2160, 25], device: ['ARRI', 'ALEXA Mini LF'], label: 'QuickTime', tc: 10 * 3600 + 92.28 },
  { path: 'CAM B/PRIVATE/M4ROOT/CLIP/C0001.MP4', start: 18.84, len: 118, mic: { gain: 1.2, lowpass: 0.25, echoMs: 37, echo: 0.22, noise: 0.02, seed: 3 }, video: ['Sony XAVC S-I (H.264)', 'H.264', 3840, 2160, 25], device: ['Sony', 'ILME-FX3'], label: 'MPEG-4', tc: 18 * 3600 + 22 * 60 + 40.12, clock: 2.1 },
  { path: 'CAM C/DCIM/100GOPRO/GX010231.MP4', start: 55.6, len: 95, rate: 1 + 45e-6, mic: { gain: 0.8, lowpass: 0.7, noise: 0.03, seed: 4 }, video: ['H.265 / HEVC', 'HEVC', 3840, 2160, 50], device: ['GoPro', 'HERO12 Black'], label: 'MPEG-4', clock: -37 },
  { path: 'CELULAR/IMG_0042.MOV', start: 128.2, len: 40, mic: { gain: 0.7, lowpass: 0.4, noise: 0.02, seed: 5 }, video: ['H.265 / HEVC', 'HEVC', 3840, 2160, 30], device: ['Apple', 'iPhone 15 Pro'], label: 'QuickTime', clock: 11 },
]

export async function loadDemo() {
  const p = createProject('Exemplo · Entrevista com 3 câmeras')
  p.demo = true
  aplicarTipo(p, 'entrevista', true)
  const sc = scene(180, SR, 42)
  const base = new Date(2024, 4, 1, 10, 0, 0).getTime()
  const entries = CLIPS.map((c) => {
    const sig = cut(mic(sc, SR, c.mic), SR, c.start, c.len, c.rate || 1)
    const name = c.path.split('/').pop()
    const isRec = c.audioOnly
    const ix = isRec ? '<?xml version="1.0"?><BWFXML><PROJECT>Entrevista</PROJECT><SCENE>7</SCENE><TAKE>2</TAKE><SPEED><TIMECODE_RATE>25/1</TIMECODE_RATE><TIMECODE_FLAG>NDF</TIMECODE_FLAG></SPEED><TRACK_LIST><TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK></TRACK_LIST></BWFXML>' : ''
    const data = wav(sig, SR, isRec ? { timeRef: 10 * 3600 * SR, originator: 'ZOOM F6', ixml: ix } : {})
    const file = new File([data], name, { type: 'audio/wav', lastModified: base + (c.start + c.len + (c.clock || 0)) * 1000 })
    return { file, path: `Exemplo/${c.path}` }
  })
  await addEntries(entries)
  // o que cada "câmera" seria de verdade (o arquivo é só o som dela)
  const rate25 = snapRate(25)
  for (const def of CLIPS) {
    const clip = p.clips.find((c) => c.relPath === `Exemplo/${def.path}`)
    if (!clip) continue
    clip.demo = true
    clip.created = base + (def.start + (def.clock || 0)) * 1000
    clip.createdSource = 'metadado'
    if (def.audioOnly) continue
    const [codec, family, width, height, fps] = def.video
    clip.kind = 'video'
    clip.containerLabel = def.label
    clip.container = def.label === 'QuickTime' ? 'mov' : 'mp4'
    clip.video = { codec, family, width, height, rate: snapRate(fps), raw: false }
    clip.device = { make: def.device[0], model: def.device[1], serial: null }
    clip.audio = { ...clip.audio, codec: 'PCM', channels: 2, totalChannels: 2, sampleRate: 48000, bits: 24 }
    if (def.tc != null) {
      const frames = labelSecondsToFrames(def.tc, rate25, false)
      clip.timecode = { frames, rate: rate25, drop: false, seconds: def.tc, string: framesToTc(frames, rate25, false), source: 'Faixa de timecode' }
    }
  }
  for (const d of p.devices) delete d.key
  p.devices = []
  regroup(p)
  p.export.root = '/Volumes/SSD/Entrevista'
  changed()
  return p
}

export const isDemo = () => !!(S.project && S.project.demo)
