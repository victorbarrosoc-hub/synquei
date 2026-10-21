// Destinos de exportação: o que cada editor recebe e como importar.

import { buildTimelines, safeName } from './model.js'
import { toXmeml } from './xmeml.js'
import { toFcpxml } from './fcpxml.js'
import { toOtio, toEdl, toAle, toCsv, toProjectJson } from './others.js'
import { zip } from './zip.js'

export const TARGETS = [
  {
    id: 'premiere',
    name: 'Adobe Premiere Pro',
    short: 'Premiere',
    file: 'XML (Final Cut 7)',
    steps: ['Arquivo › Importar…', 'Escolha o .xml do Synquei', 'Cada sessão vira uma sequência dentro de uma pasta', 'Mídia offline? Clique com o direito › Vincular mídia'],
  },
  {
    id: 'resolve',
    name: 'DaVinci Resolve',
    short: 'Resolve',
    file: 'XML por sessão + OTIO',
    steps: ['File › Import › Timeline…', 'Escolha o .xml (ou o .otio) da sessão', 'Marque "Automatically import source clips into media pool"', 'Se pedir, aponte a pasta da mídia'],
  },
  {
    id: 'fcp',
    name: 'Final Cut Pro',
    short: 'Final Cut',
    file: 'FCPXML 1.10',
    steps: ['Arquivo › Importar › XML…', 'Escolha o .fcpxml', 'Cada sessão vira um projeto com camadas e um clipe multicâmera', 'Mídia faltando? Arquivo › Revincular arquivos'],
  },
  {
    id: 'avid',
    name: 'Avid Media Composer',
    short: 'Avid',
    file: 'ALE + EDL',
    steps: ['Vincule a mídia (Source Browser › Link)', 'Clique com o direito no bin › Input › Shot Log (.ale) com Merge events', 'O Auxiliary TC1 traz o tempo sincronizado', 'Selecione tudo › Group Clips › Auxiliary TC1'],
  },
  {
    id: 'vegas',
    name: 'Vegas Pro · Lightworks',
    short: 'Vegas',
    file: 'XML (Final Cut 7)',
    steps: ['Vegas: Arquivo › Importar › Final Cut Pro 7 / DaVinci Resolve (.xml)', 'Lightworks: Importar › XML', 'Uma sessão por arquivo'],
  },
  {
    id: 'otio',
    name: 'OpenTimelineIO',
    short: 'OTIO',
    file: '.otio por sessão',
    steps: ['Resolve 18.5+: File › Import › Timeline', 'Kdenlive, Nuke Studio, Hiero e ferramentas de pipeline', 'Áudio com precisão de amostra'],
  },
  {
    id: 'edl',
    name: 'EDL CMX 3600',
    short: 'EDL',
    file: 'Uma EDL por faixa',
    steps: ['Para qualquer editor antigo ou de finalização', 'Uma faixa de vídeo por arquivo (limite do formato)', 'Nome do clipe nos comentários'],
  },
  {
    id: 'report',
    name: 'Relatório e projeto',
    short: 'Relatório',
    file: 'CSV + .synquei',
    steps: ['CSV abre no Excel, Numbers e Planilhas', 'O .synquei reabre o projeto no Synquei', 'Bom para mandar ao assistente ou ao cliente'],
  },
]

/** Arquivos de um destino: [{ name, data }] */
export function filesFor(target, project) {
  const base = safeName(project.name)
  const tls = buildTimelines(project)
  if (!tls.length) return []
  switch (target) {
    case 'premiere':
      return [{ name: `${base} · Premiere Pro.xml`, data: toXmeml(tls, project, { wrap: true }) }]
    case 'resolve':
      return tls.flatMap((tl) => [
        { name: `${base} · ${safeName(tl.name)} · Resolve.xml`, data: toXmeml([tl], project, { wrap: false }) },
        { name: `${base} · ${safeName(tl.name)} · Resolve.otio`, data: toOtio(tl, project) },
      ])
    case 'fcp':
      return [{ name: `${base} · Final Cut Pro.fcpxml`, data: toFcpxml(tls, project) }]
    case 'avid':
      return tls.flatMap((tl) => [{ name: `${base} · ${safeName(tl.name)} · Avid.ale`, data: toAle(tl, project) }, ...tl.video.map((t, i) => ({ name: `${base} · ${safeName(tl.name)} · V${i + 1} ${safeName(t.label)}.edl`, data: toEdl(tl, t, 'V') }))])
    case 'vegas':
      return tls.map((tl) => ({ name: `${base} · ${safeName(tl.name)} · Vegas.xml`, data: toXmeml([tl], project, { wrap: false }) }))
    case 'otio':
      return tls.map((tl) => ({ name: `${base} · ${safeName(tl.name)}.otio`, data: toOtio(tl, project) }))
    case 'edl':
      return tls.flatMap((tl) => [
        ...tl.video.map((t, i) => ({ name: `${base} · ${safeName(tl.name)} · V${i + 1} ${safeName(t.label)}.edl`, data: toEdl(tl, t, 'V') })),
        ...uniqueAudio(tl).map((t) => ({ name: `${base} · ${safeName(tl.name)} · ${safeName(t.label.split(' · ')[0])} áudio.edl`, data: toEdl(tl, t, 'A') })),
      ])
    case 'report':
      return [
        { name: `${base} · relatório.csv`, data: toCsv(project) },
        { name: `${base}.synquei`, data: toProjectJson(project) },
      ]
    default:
      return []
  }
}

function uniqueAudio(tl) {
  const seen = new Set()
  return tl.audio.filter((t) => {
    if (t.camera) return false
    const k = t.label.split(' · ')[0]
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Tudo num .zip, uma pasta por editor. */
export function zipAll(project) {
  const files = []
  const folder = { premiere: 'Premiere Pro', resolve: 'DaVinci Resolve', fcp: 'Final Cut Pro', avid: 'Avid Media Composer', vegas: 'Vegas Pro', otio: 'OpenTimelineIO', edl: 'EDL', report: 'Relatório' }
  for (const t of TARGETS) for (const f of filesFor(t.id, project)) files.push({ name: `${folder[t.id]}/${f.name}`, data: f.data })
  return zip(files)
}
