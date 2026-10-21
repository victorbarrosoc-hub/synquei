// Sincronizar: ajustes do método, o botão e o andamento ao vivo (áudio lido, comparação, resultado).

import { S, changed, runSync, hasMedia, peaksOf, stopSync, skipClip } from '../store.js'
import { h, icon, plural, toast, drawPeaks, $, $$, uiDark } from '../util.js'
import { devColor } from '../media/devices.js'
import { buildSessions, stats } from '../project.js'
import { go } from '../main.js'

const sw = (key, label, hint) => `<label class="set-row"><div><b>${label}</b><small>${hint}</small></div><span class="switch"><input type="checkbox" data-change="opt" data-k="${key}" ${S.project.sync[key] ? 'checked' : ''}/><i></i></span></label>`

function settings() {
  const s = S.project.sync
  const sel = (key, opts) => `<select class="select" style="width:auto" data-change="opt" data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  return `<section class="card">
    <header class="card-head"><h2>Como sincronizar</h2></header>
    <div class="card-pad" style="padding-top:8px;padding-bottom:8px">
      <div class="set-row" style="display:grid;gap:10px;justify-content:stretch"><div><b>Método</b><small>O som decide; timecode e data só ajudam a procurar mais rápido.</small></div>
        <div class="seg" role="group">${[
          ['auto', 'Som + timecode'],
          ['audio', 'Só o som'],
          ['timecode', 'Só timecode'],
        ]
          .map(([k, l]) => `<button data-act="mode" data-v="${k}" aria-pressed="${s.mode === k}">${l}</button>`)
          .join('')}</div></div>
      ${sw('sharedTC', 'Timecode batido entre aparelhos', 'Ligue se as câmeras e o gravador usaram o mesmo timecode (Tentacle, jam sync).')}
      ${sw('useDate', 'Usar a data dos arquivos', 'Ajuda a encaixar grupos sem som em comum e clipes mudos.')}
      ${sw('chronological', 'Clipes de cada aparelho em ordem', 'Um clipe não passa na frente do anterior da mesma câmera.')}
      ${sw('drift', 'Medir deriva de relógio', 'Em clipes longos, mede o começo e o fim e alinha pelo meio.')}
      <div class="set-row"><div><b>Rigor</b><small>Quanto de certeza para aceitar um clipe.</small></div>${sel('minConf', [
        [0.3, 'Aceitar mais'],
        [0.4, 'Equilibrado'],
        [0.55, 'Só com certeza'],
      ])}</div>
      <div class="set-row"><div><b>Separar em sessões</b><small>Um intervalo maior que isso vira outra sequência.</small></div>${sel('sessionGap', [
        [0, 'Não separar'],
        [10, '10 min'],
        [20, '20 min'],
        [30, '30 min'],
        [60, '1 hora'],
        [240, '4 horas'],
      ])}</div>
      <div class="set-row"><div><b>Sequências de quadros</b><small>Frame rate de DNG/EXR sem a informação.</small></div>${sel('seqFps', [
        [23.976, '23.976'],
        [24, '24'],
        [25, '25'],
        [29.97, '29.97'],
        [30, '30'],
      ])}</div>
    </div>
  </section>`
}

function lanes() {
  const p = S.project
  const done = !!p.result && !S.sync.running
  return p.devices
    .slice(0, 6)
    .map((d, i) => {
      const clip = p.clips.find((c) => c.deviceId === d.id && peaksOf(c))
      const shift = done ? 0 : ((i * 37) % 23) - 11
      return `<div class="lane-live"><span>${h(d.label)}</span><canvas data-lane="${clip ? clip.id : ''}" data-color="${devColor(d, true)}" style="transform:translateX(${shift}%)"></canvas></div>`
    })
    .join('')
}

function phases() {
  const s = S.sync
  const ph = s.phase
  const order = ['audio', 'match', 'done']
  const idx = s.running ? order.indexOf(ph) : S.project.result ? 3 : -1
  const item = (i, label, val) => `<div class="phase ${idx === i ? 'is-on' : idx > i ? 'is-done' : ''}"><span class="pi">${idx > i ? icon('check') : idx === i ? '<span class="spinner" style="width:12px;height:12px"></span>' : ''}</span>${label}<span class="val">${val || ''}</span></div>`
  return item(0, 'Ler o áudio de cada clipe', ph === 'audio' && s.running ? `${s.done}/${s.total}` : '') + item(1, 'Comparar pelo som', ph === 'match' && s.running ? `${s.done}/${s.total}` : '') + item(2, 'Medir deriva e montar as sessões', '')
}

function clipList() {
  const p = S.project
  const st = S.sync.clip
  const rows = p.clips
    .filter((c) => c.status === 'ready')
    .map((c) => {
      const s = st[c.id]
      const d = p.devices.find((x) => x.id === c.deviceId)
      const color = devColor(d, uiDark())
      let label = ''
      let pct = 0
      if (s) {
        pct = Math.round(s.p * 100)
        label = estadoClipe(s)
      } else if (c.sync) {
        pct = 100
        label = c.sync.method.startsWith('audio') ? `${Math.round(c.sync.conf * 100)}%` : c.sync.method === 'timecode' ? 'timecode' : c.sync.method === 'date' ? 'data' : c.sync.method === 'linked' ? 'par' : 'manual'
      } else if (c.audioStatus === 'none') label = 'sem áudio'
      else if (S.signals.has(c.id)) {
        pct = 100
        label = 'áudio lido'
      } else if (!hasMedia(c)) label = 'sem mídia'
      const lendo = s && s.st === 'lendo' && S.sync.running
      return `<div class="cp" data-cp="${c.id}"><i class="dot" style="--c:${color}"></i><div><div class="name">${h(c.name)}</div><div class="bar"><i style="--p:${pct}%"></i></div></div><span class="st">${h(label)}</span><button class="cp-pular" data-act="pular" data-id="${c.id}" title="Pular a leitura deste clipe: ele entra pelo timecode ou pela data, ou fica de fora para conferir" ${lendo ? '' : 'hidden'}>Pular</button></div>`
    })
  return rows.join('')
}

const estadoClipe = (s) => (s.st === 'lendo' ? `${Math.round(s.p * 100)}%` : s.st === 'ok' ? 'áudio lido' : s.st === 'pulado' ? 'pulado' : 'sem áudio')

/** "2:07" desde que começou. */
function decorrido() {
  const t0 = S.sync.startedAt
  if (!t0) return ''
  const s = Math.max(0, Math.round((Date.now() - t0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const leadRodando = () => `Rodando há ${decorrido()}. Pode continuar usando o app; se precisar, pare a qualquer momento: o áudio já lido fica guardado.`

function results() {
  const p = S.project
  if (!p.result || S.sync.running) return ''
  const st = p.result.stats
  const card = (n, l, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${l}</span></div>`
  return `<section style="margin-top:18px;display:grid;gap:14px">
    <div class="stats stagger">
      ${card(`${st.total - st.unsynced}/${st.total}`, 'clipes na linha do tempo', st.unsynced ? 'warn' : 'ok')}
      ${card(st.audio, 'pelo som')}
      ${card(st.timecode + st.linked, 'por timecode ou par')}
      ${card(st.date, 'pela data', st.date ? 'warn' : '')}
      ${card(st.drift, 'com deriva corrigida')}
      ${card(st.sessions, st.sessions === 1 ? 'sessão' : 'sessões')}
    </div>
    ${st.low ? `<div class="warn-box">${icon('warn')}<div>${plural(st.low, 'clipe merece', 'clipes merecem')} uma conferida: estão marcados em laranja na linha do tempo e ganham um marcador no editor.</div></div>` : ''}
    ${st.islands ? `<div class="info-box">${icon('info')}<div>${plural(st.islands, 'grupo ficou', 'grupos ficaram')} sem som em comum com o resto e sem timecode ou data para encaixar: viram sessões à parte.</div></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-lg" data-act="see">${icon('timeline')}Ver a linha do tempo</button><button class="btn btn-secondary btn-lg" data-act="export">${icon('export')}Exportar</button></div>
  </section>`
}

export default {
  title: 'Sincronizar',
  render() {
    const p = S.project
    if (!p || !p.clips.length) return `<div class="page tela"><header class="page-head"><div><h1>Sincronizar</h1></div></header><div class="empty"><h2>Nenhuma mídia ainda</h2><p>Solte as pastas dos cartões na aba Mídia.</p><a class="btn btn-primary" href="#/midia">Ir para Mídia</a></div></div>`
    const ready = p.clips.filter((c) => c.status === 'ready')
    const withMedia = ready.filter(hasMedia).length
    const run = S.sync.running
    const can = withMedia > 0 && !S.probe.active
    const title = run ? 'Sincronizando…' : p.result ? 'Sincronizado.' : S.sync.parada ? 'Sincronização parada.' : 'Tudo pronto para sincronizar.'
    const lead = run ? leadRodando() : S.sync.parada && !p.result ? 'Sincronização parada. Rode de novo quando quiser: o áudio já lido não é lido outra vez.' : p.result ? `Rodou ${new Date(p.result.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Mudou algum ajuste? Rode de novo: o áudio já lido não é lido outra vez.` : `${plural(ready.length, 'clipe', 'clipes')} em ${plural(p.devices.length, 'aparelho', 'aparelhos')}.`
    return `<div class="page tela">
      <header class="page-head"><div><h1>Sincronizar</h1><p class="page-lead">O Synquei compara o som de cada clipe com os outros e acha onde ele se encaixa, com precisão de amostra.</p></div></header>
      <div class="sync-layout">
        <div>
          <section class="hero-sync">
            <div><h2 id="syncTitle">${title}</h2><p id="syncLead" style="margin-top:8px">${lead}</p></div>
            <div class="lanes-live">${lanes()}</div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-xl" style="background:#fff;color:#0b0b0c" data-act="run" ${run || !can ? 'disabled' : ''} id="runBtn">${run ? '<span class="spinner"></span>Sincronizando' : `${icon('sync')}${p.result ? 'Sincronizar de novo' : `Sincronizar ${plural(withMedia, 'clipe', 'clipes')}`}`}</button>
              ${run ? `<button class="btn btn-lg btn-parar" data-act="parar" title="Parar a sincronização">${icon('stop')}Parar</button>` : ''}
              ${!withMedia ? '<span style="color:rgba(255,255,255,.6);font-size:13px">Solte a mídia de novo na aba Mídia para sincronizar.</span>' : ''}
            </div>
            <div class="phases" id="phases">${phases()}</div>
            <div class="progress"><i id="syncBar" style="--p:${progressPct()}%"></i></div>
          </section>
          <div id="results">${results()}</div>
          <section class="card" style="margin-top:18px"><header class="card-head"><h3>Clipes</h3><span class="sub" style="font-size:12.5px">${S.sync.error ? `<span style="color:var(--err-text)">${h(S.sync.error)}</span>` : ''}</span></header><div class="clip-progress" id="clipList" style="padding:8px 16px">${clipList()}</div></section>
        </div>
        <div>${settings()}</div>
      </div>
    </div>`
  },
  live() {
    const ph = $('#phases')
    if (!ph) return
    ph.innerHTML = phases()
    const bar = $('#syncBar')
    if (bar) bar.style.setProperty('--p', progressPct() + '%')
    const st = S.sync.clip
    for (const [id, s] of Object.entries(st)) {
      const el = document.querySelector(`[data-cp="${id}"]`)
      if (!el) continue
      el.querySelector('.bar i').style.setProperty('--p', Math.round(s.p * 100) + '%')
      el.querySelector('.st').textContent = estadoClipe(s)
      const pular = el.querySelector('.cp-pular')
      if (pular) pular.hidden = !(s.st === 'lendo' && S.sync.running)
    }
    const lead = $('#syncLead')
    if (lead && S.sync.running) lead.textContent = leadRodando()
  },
  after(root) {
    for (const cv of $$('canvas[data-lane]', root)) {
      const c = S.project.clips.find((x) => x.id === cv.dataset.lane)
      if (c) drawPeaks(cv, peaksOf(c), cv.dataset.color)
      else drawFake(cv, cv.dataset.color)
    }
  },
  acts: {
    async run() {
      try {
        const st = await runSync()
        if (st) toast(st.unsynced ? `${st.total - st.unsynced} de ${st.total} clipes sincronizados` : `${st.total} clipes sincronizados`)
      } catch (e) {
        toast(e.message || 'Algo deu errado', { icon: 'warn' })
      }
    },
    parar() {
      if (stopSync()) toast('Sincronização parada. O áudio já lido fica guardado.', { icon: 'info' })
    },
    pular(el) {
      if (skipClip(el.dataset.id)) {
        el.hidden = true
        toast('Clipe pulado: ele entra pelo timecode ou pela data, ou fica de fora para conferir', { icon: 'info' })
      }
    },
    mode(el) {
      S.project.sync.mode = el.dataset.v
      changed()
    },
    see() {
      go('linha')
    },
    export() {
      go('exportar')
    },
  },
  changes: {
    opt(el) {
      const p = S.project
      const k = el.dataset.k
      p.sync[k] = el.type === 'checkbox' ? el.checked : isNaN(+el.value) ? el.value : +el.value
      if (k === 'sessionGap' && p.result) {
        p.sessions = buildSessions(p)
        p.result.stats = stats(p)
      }
      changed()
    },
  },
}

function progressPct() {
  const s = S.sync
  if (!s.running) return S.project && S.project.result ? 100 : 0
  const part = s.total ? s.done / s.total : 0
  return Math.round(s.phase === 'audio' ? part * 60 : s.phase === 'match' ? 60 + part * 35 : 98)
}

function drawFake(cv, color) {
  const n = 300
  const pk = new Uint8Array(n)
  let seed = color.charCodeAt(1) * 7
  for (let i = 0; i < n; i++) {
    seed = (seed * 9301 + 49297) % 233280
    const talk = Math.sin(i / 9) > -0.3
    pk[i] = talk ? 60 + (seed / 233280) * 180 : 10
  }
  drawPeaks(cv, pk, color)
}
