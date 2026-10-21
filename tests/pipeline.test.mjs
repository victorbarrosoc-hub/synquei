// De ponta a ponta com arquivos de verdade (gerados no ffmpeg): pasta de projeto → leitura → grupos → áudio →
// sincronia → exportações válidas. Pulado se não houver ffmpeg na máquina.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, openAsBlob, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { scene, mic, cut, wav } from '../app/js/sync/synth.js'
import { scanEntries } from '../app/js/media/scan.js'
import { probeWithSidecar } from '../app/js/media/probe.js'
import { extractAudio } from '../app/js/media/extract.js'
import { aplicarTipo } from '../app/js/tipos.js'
import { newProject, clipFromScan, applyProbe, regroup, engineItems, applySync } from '../app/js/project.js'
import { syncAll } from '../app/js/sync/engine.js'
import { filesFor, zipAll, TARGETS } from '../app/js/export/index.js'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const SRATE = 48000

test('projeto real: lê, agrupa, sincroniza e exporta', { skip: !hasFfmpeg && 'sem ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'synquei-'))
  const root = join(dir, 'Projeto')
  const sc = scene(170, SRATE, 21)
  const tmp = join(dir, 'tmp')
  mkdirSync(tmp)
  const seg = (name, sig, start, len) => {
    const p = join(tmp, name + '.wav')
    writeFileSync(p, wav(cut(sig, SRATE, start, len), SRATE))
    return p
  }
  const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args])
  // gravador: TC 14:00:00:00 a 25 fps no bext + iXML
  mkdirSync(join(root, 'AUDIO'), { recursive: true })
  const ix = '<?xml version="1.0"?><BWFXML><SCENE>12A</SCENE><TAKE>3</TAKE><SPEED><TIMECODE_RATE>25/1</TIMECODE_RATE><TIMECODE_FLAG>NDF</TIMECODE_FLAG></SPEED><TRACK_LIST><TRACK><CHANNEL_INDEX>1</CHANNEL_INDEX><NAME>Boom</NAME></TRACK></TRACK_LIST></BWFXML>'
  writeFileSync(join(root, 'AUDIO', 'ZOOM0001.WAV'), wav(mic(sc, SRATE, { noise: 0.003, seed: 1 }), SRATE, { timeRef: 14 * 3600 * SRATE, originator: 'ZOOM F6', ixml: ix }))
  // câmera A: dois clipes ProRes com PCM
  const camA = mic(sc, SRATE, { gain: 0.6, lowpass: 0.5, echoMs: 19, echo: 0.3, noise: 0.015, seed: 2 })
  mkdirSync(join(root, 'CAM A'), { recursive: true })
  ff('-i', seg('a1', camA, 12.36, 60), '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-map', '1:v', '-map', '0:a', '-shortest', '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s24le', '-timecode', '14:00:12:09', join(root, 'CAM A', 'A001C001_240501_R1AB.mov'))
  ff('-i', seg('a2', camA, 90.2, 50), '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-map', '1:v', '-map', '0:a', '-shortest', '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s24le', '-timecode', '14:01:30:05', join(root, 'CAM A', 'A001C002_240501_R1AB.mov'))
  writeFileSync(join(root, 'CAM A', '._A001C001_240501_R1AB.mov'), 'lixo do macOS')
  // câmera B: estrutura de cartão Sony com XML ao lado
  const camB = mic(sc, SRATE, { gain: 1.2, lowpass: 0.2, echoMs: 33, echo: 0.2, noise: 0.02, seed: 3 })
  const clipDir = join(root, 'CAM B', 'PRIVATE', 'M4ROOT', 'CLIP')
  mkdirSync(clipDir, { recursive: true })
  ff('-i', seg('b1', camB, 30.5, 80), '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-map', '1:v', '-map', '0:a', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16be', join(clipDir, 'C0001.MP4'))
  writeFileSync(join(clipDir, 'C0001M01.XML'), '<?xml version="1.0"?><NonRealTimeMeta><Duration value="2000"/><LtcChangeTable tcFps="25" halfStep="false"><LtcChange frameCount="0" value="12303014" status="increment"/></LtcChangeTable><CreationDate value="2024-05-01T14:00:30+00:00"/><VideoFormat><VideoFrame videoCodec="AVC_1920_1080_HP@L41" captureFps="25p" formatFps="25p"/><VideoLayout pixel="1920" numOfVerticalLine="1080" aspectRatio="16:9"/></VideoFormat><Device manufacturer="Sony" modelName="ILME-FX3" serialNo="5012345"/></NonRealTimeMeta>')
  // câmera C: MXF XDCAM
  const camC = mic(sc, SRATE, { gain: 0.8, lowpass: 0.7, noise: 0.02, seed: 4 })
  mkdirSync(join(root, 'CAM C'), { recursive: true })
  ff('-i', seg('c1', camC, 100.0, 40), '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25', '-map', '1:v', '-map', '0:a', '-shortest', '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p', '-b:v', '10M', '-c:a', 'pcm_s24le', join(root, 'CAM C', 'C0042.MXF'))

  // ── leitura como o navegador faria ──
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
  const entries = []
  for (const f of walk(root)) {
    const blob = await openAsBlob(f)
    const file = new File([blob], f.split('/').pop(), { lastModified: statSync(f).mtimeMs })
    entries.push({ file, path: relative(dir, f) })
  }
  const { media, ignored } = scanEntries(entries)
  assert.ok(ignored.some((i) => i.relPath.includes('._A001')), 'sombra do macOS ignorada')
  assert.equal(media.length, 5)
  const project = newProject('Teste')
  const files = new Map()
  const plans = new Map()
  for (const m of media) {
    const c = clipFromScan(m)
    project.clips.push(c)
    files.set(c.id, m.file)
    const info = await probeWithSidecar(m.file, m.relPath, m.sidecar)
    plans.set(c.id, info)
    applyProbe(c, info, project)
  }
  regroup(project)
  const labels = project.devices.map((d) => d.label).sort()
  assert.deepEqual(labels, ['AUDIO', 'CAM A', 'CAM B', 'CAM C'])
  const b = project.clips.find((c) => c.name === 'C0001.MP4')
  assert.equal(b.device.model, 'ILME-FX3', 'modelo pelo XML da Sony')
  assert.equal(b.timecode.string, '14:30:30:12', 'timecode pelo XML da Sony')
  const z = project.clips.find((c) => c.name === 'ZOOM0001.WAV')
  assert.equal(z.timecode.string, '14:00:00:00')
  assert.equal(z.meta.scene, '12A')

  const signals = new Map()
  for (const c of project.clips) {
    const { sig } = await extractAudio(files.get(c.id), plans.get(c.id))
    signals.set(c.id, sig)
  }
  const res = syncAll(engineItems(project, signals), { minConf: 0.4, chronological: true })
  const st = applySync(project, res)
  assert.equal(st.unsynced, 0)
  assert.equal(st.audio, 5)
  const pos = (n) => project.clips.find((c) => c.name === n).sync.pos - z.sync.pos
  for (const [n, t] of [['A001C001_240501_R1AB.mov', 12.36], ['A001C002_240501_R1AB.mov', 90.2], ['C0001.MP4', 30.5], ['C0042.MXF', 100.0]]) {
    assert.ok(Math.abs(pos(n) - t) < 0.001, `${n}: ${pos(n)} ≠ ${t}`)
  }

  // ── exportações ──
  project.export.root = '/Volumes/SSD'
  project.export.start = 'tc'
  const out = join(dir, 'export')
  mkdirSync(out)
  for (const t of TARGETS) {
    for (const f of filesFor(t.id, project)) {
      const p = join(out, f.name.replace(/\//g, '_'))
      writeFileSync(p, f.data)
      if (/\.(xml|fcpxml)$/.test(p)) execFileSync('xmllint', ['--noout', p])
      if (/\.(otio|synquei)$/.test(p)) JSON.parse(readFileSync(p, 'utf8'))
    }
  }
  const prem = filesFor('premiere', project)[0].data
  // a câmera B começa 30,5 s depois do gravador: 762,5 quadros a 25 fps, então 762 ou 763 conforme o arredondamento
  const startB = prem.match(/<name>C0001\.MP4<\/name>[\s\S]*?<start>(\d+)<\/start>/)
  const startZ = prem.match(/<name>ZOOM0001\.WAV<\/name>[\s\S]*?<start>(\d+)<\/start>/)
  assert.ok(Math.abs(+startB[1] - +startZ[1] - 30.5 * 25) <= 0.5, `${+startB[1] - +startZ[1]} quadros`)
  assert.ok(prem.includes('file://localhost/Volumes/SSD/Projeto/CAM%20B/PRIVATE/M4ROOT/CLIP/C0001.MP4'))
  assert.ok(prem.includes('<string>14:00:00:00</string>'), 'sequência começa no TC real do gravador')
  const fcp = filesFor('fcp', project)[0].data
  assert.ok(fcp.includes('<mc-angle name="CAM A"'))
  assert.ok(fcp.includes('src="file:///Volumes/SSD/Projeto/AUDIO/ZOOM0001.WAV"'))
  // multicâmera no Premiere: a sequência de ângulos vai aninhada na de edição (vídeo e os dois canais de som)
  assert.ok(prem.includes('· multicâmera</name>'))
  assert.equal(prem.match(/<sequence id="sequence-1"\/>/g).length, 2)
  assert.ok(filesFor('resolve', project).some((f) => f.name.endsWith('Resolve multicâmera.fcpxml')))
  // tipo sem multicâmera: camadas só
  aplicarTipo(project, 'ficcao')
  assert.equal(project.export.multicam, false)
  assert.equal(project.sync.chronological, true)
  assert.ok(!filesFor('premiere', project)[0].data.includes('multicâmera'))
  assert.ok(!filesFor('fcp', project)[0].data.includes('<mc-angle'))
  assert.ok(!filesFor('resolve', project).some((f) => f.name.endsWith('.fcpxml')))
  aplicarTipo(project, 'videoclipe')
  assert.equal(project.export.multicam, true)
  assert.equal(project.sync.chronological, false)
  assert.equal(project.sync.mode, 'audio')
  if (process.env.SYNQUEI_KEEP) console.log('EXPORT_DIR', out)
  const z2 = join(out, 'tudo.zip')
  writeFileSync(z2, zipAll(project))
  execFileSync('unzip', ['-tq', z2])
})
