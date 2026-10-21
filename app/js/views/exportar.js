// Exportar: onde a mídia está no disco, como montar a sequência e um botão por editor (ou tudo num .zip).

import { S, changed } from '../store.js'
import { h, icon, download, toast, plural } from '../util.js'
import { TARGETS, filesFor, zipAll } from '../export/index.js'
import { zip } from '../export/zip.js'
import { buildTimelines, safeName, pathStyle, clipPath } from '../export/model.js'
import { rateLabel } from '../time.js'

const MONO = { premiere: 'Pr', resolve: 'Re', fcp: 'FC', avid: 'MC', vegas: 'Ve', otio: 'OT', edl: 'EDL', report: 'CSV' }

function opts() {
  const e = S.project.export
  const sel = (key, list) => `<select class="select" data-change="exp" data-k="${key}">${list.map(([v, l]) => `<option value="${v}" ${String(e[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  const sample = S.project.clips.find((c) => c.status === 'ready')
  const ex = sample ? clipPath(sample, e) : ''
  return `<section class="card">
    <header class="card-head"><h2>Ajustes da exportação</h2></header>
    <div class="opts">
      <label class="field"><span>Pasta onde a mídia está no seu disco</span><input class="input" data-change="exp" data-k="root" value="${h(e.root)}" placeholder="${pathStyle(e) === 'win' ? 'D:\\Projetos\\Entrevista' : '/Volumes/SSD/Entrevista'}" spellcheck="false"/></label>
      <p class="sub" style="font-size:12px;margin-top:-6px">A pasta que contém <b>${h(sample ? sample.relPath.split('/')[0] : 'a pasta arrastada')}</b>. ${ex ? `Exemplo: <span class="mono" style="word-break:break-all">${h(ex)}</span>` : ''}</p>
      <label class="field"><span>Frame rate da sequência</span>${sel('fps', [['auto', 'Automático (o mais comum)'], ['23.976', '23.976'], ['24', '24'], ['25', '25'], ['29.97', '29.97'], ['30', '30'], ['50', '50'], ['59.94', '59.94'], ['60', '60']])}</label>
      <label class="field"><span>Resolução</span>${sel('size', [['auto', 'Automática (a mais comum)'], ['1920x1080', 'Full HD 1920×1080'], ['3840x2160', '4K UHD 3840×2160'], ['4096x2160', '4K DCI 4096×2160'], ['1080x1920', 'Vertical 1080×1920']])}</label>
      <label class="field"><span>Timecode de início</span>${sel('start', [['01:00:00:00', '01:00:00:00'], ['00:00:00:00', '00:00:00:00'], ['tc', 'O timecode real das câmeras']])}</label>
      <label class="field"><span>Áudio das câmeras</span>${sel('camAudio', [['keep', 'Manter'], ['mute', 'Manter desligado (mudo)'], ['off', 'Não levar']])}</label>
      <label class="field"><span>Canais do gravador</span>${sel('recChannels', [['all', 'Todos (até 8)'], ['2', 'Só os dois primeiros']])}</label>
      <label class="field"><span>Final Cut Pro</span>${sel('fcp', [['both', 'Camadas e multicâmera'], ['timeline', 'Só camadas'], ['multicam', 'Só multicâmera']])}</label>
      <label class="set-row" style="padding:4px 0"><div><b>Uma sequência por sessão</b><small>Desligado: uma sequência só com tudo.</small></div><span class="switch"><input type="checkbox" data-change="exp" data-k="splitSessions" ${e.splitSessions ? 'checked' : ''}/><i></i></span></label>
      <label class="set-row" style="padding:4px 0"><div><b>Levar os clipes sem sincronia</b><small>Numa sequência à parte, para conferir.</small></div><span class="switch"><input type="checkbox" data-change="exp" data-k="includeUnsynced" ${e.includeUnsynced ? 'checked' : ''}/><i></i></span></label>
    </div>
  </section>`
}

export default {
  title: 'Exportar',
  render() {
    const p = S.project
    if (!p || !p.result) return `<div class="page tela"><header class="page-head"><div><h1>Exportar</h1></div></header><div class="empty"><h2>Sincronize primeiro</h2><p>A exportação leva a linha do tempo para o seu editor: Premiere, Resolve, Final Cut, Avid, Vegas e outros.</p><a class="btn btn-primary" href="#/sincronizar">Ir para Sincronizar</a></div></div>`
    const tls = buildTimelines(p)
    const t0 = tls[0]
    const summary = t0 ? `${plural(tls.length, 'sequência', 'sequências')} · ${t0.width}×${t0.height} · ${rateLabel(t0.rate)} qps · ${plural(t0.video.length, 'faixa', 'faixas')} de vídeo e ${t0.audio.length} de áudio na primeira` : 'Nada para exportar'
    return `<div class="page tela">
      <header class="page-head"><div><h1>Exportar</h1><p class="page-lead">Um arquivo de projeto para cada editor. Os clipes entram com o caminho original: nada é copiado nem convertido.</p></div></header>
      <section class="exp-hero"><div><h2>Tudo de uma vez</h2><p>${h(summary)}</p></div><button class="btn btn-xl" style="background:#fff;color:#0b0b0c" data-act="all" ${tls.length ? '' : 'disabled'}>${icon('download')}Baixar tudo (.zip)</button></section>
      ${!p.export.root ? `<div class="warn-box" style="margin-bottom:18px">${icon('warn')}<div>Diga onde a mídia está no seu disco (ao lado). Sem isso o editor abre a sequência com a mídia offline e pede para revincular: funciona, só dá mais um passo.</div></div>` : ''}
      <div class="exp-layout">
        <div class="grid grid-2 stagger">${TARGETS.map((t, i) => `<article class="target" style="--i:${i}"><div class="target-top"><span class="target-ic">${MONO[t.id]}</span><div><h3>${h(t.name)}</h3><span class="chip">${h(t.file)}</span></div></div><ol>${t.steps.map((s) => `<li>${h(s)}</li>`).join('')}</ol><button class="btn btn-primary btn-sm" data-act="one" data-t="${t.id}" ${tls.length ? '' : 'disabled'}>${icon('download')}Baixar para ${h(t.short)}</button></article>`).join('')}</div>
        <div>${opts()}</div>
      </div>
    </div>`
  },
  acts: {
    all() {
      const data = zipAll(S.project)
      download(data, `${safeName(S.project.name)} · Synquei.zip`, 'application/zip')
      toast('Exportações prontas: uma pasta por editor dentro do .zip', { icon: 'download' })
    },
    one(el) {
      const files = filesFor(el.dataset.t, S.project)
      if (!files.length) return toast('Nada para exportar', { icon: 'warn' })
      if (files.length === 1) download(files[0].data, files[0].name, 'application/xml')
      else download(zip(files), `${safeName(S.project.name)} · ${el.dataset.t}.zip`, 'application/zip')
      toast(files.length === 1 ? `Baixado: ${files[0].name}` : `${files.length} arquivos num .zip`, { icon: 'download' })
    },
  },
  changes: {
    exp(el) {
      const e = S.project.export
      e[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value
      changed()
    },
  },
}
