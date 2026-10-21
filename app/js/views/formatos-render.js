// Tabelas do catálogo de formatos (usado no app e na página /formatos/ do site).

import { CONTAINERS, RAW, VIDEO_CODECS, AUDIO_CODECS, CARD_LAYOUTS, SUPPORT_LABEL, formatCount } from '../media/formats.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const badge = (a) => {
  const cls = a === 'full' ? 'chip-ok' : a === 'codec' ? 'chip-blue' : a === 'external' ? 'chip-lav' : ''
  return `<span class="chip ${cls}">${esc(SUPPORT_LABEL[a] || a)}</span>`
}
const match = (q, ...xs) => !q || xs.join(' ').toLowerCase().includes(q)

export function renderFormats(q = '', filter = 'all') {
  q = q.trim().toLowerCase()
  const out = []
  const vid = CONTAINERS.filter((c) => c.kind === 'video' && (filter === 'all' || filter === 'video') && match(q, c.name, c.ext.join(' '), c.who, c.note))
  const aud = CONTAINERS.filter((c) => c.kind === 'audio' && (filter === 'all' || filter === 'audio') && match(q, c.name, c.ext.join(' '), c.who, c.note))
  const raw = RAW.filter((r) => (filter === 'all' || filter === 'raw') && match(q, r.name, r.ext.join(' '), r.who, r.brand, r.note))
  const vc = VIDEO_CODECS.filter((c) => (filter === 'all' || filter === 'codec') && match(q, c.name, c.family, c.fourcc.join(' ')))
  const ac = AUDIO_CODECS.filter((c) => (filter === 'all' || filter === 'codec' || filter === 'audio') && match(q, c.name, c.fourcc.join(' ')))
  const cards = CARD_LAYOUTS.filter(() => filter === 'all' || filter === 'card').filter((c) => match(q, c.label, c.brand, c.example))
  const table = (title, head, rows) => (rows.length ? `<section class="fmt-sec"><h2>${title}</h2><div class="card" style="overflow-x:auto"><table class="table fmt-table"><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>` : '')
  out.push(table('Contêineres de vídeo', ['Formato', 'Extensões', 'Quem grava', 'Som', 'Timecode', 'Observação'], vid.map((c) => `<tr><td>${esc(c.name)}</td><td class="ext">.${c.ext.join(' .')}</td><td>${esc(c.who)}</td><td>${badge(c.audio)}</td><td>${c.tc ? '<span class="chip chip-ok">lê</span>' : '<span class="muted">—</span>'}</td><td class="sub">${esc(c.note)}</td></tr>`)))
  out.push(table('RAW de câmera', ['Formato', 'Extensões', 'Câmeras', 'Som', 'Como entra'], raw.map((r) => `<tr><td>${esc(r.name)}</td><td class="ext">.${r.ext.join(' .')}</td><td>${esc(r.who)}</td><td>${badge(r.audio)}</td><td class="sub">${esc(r.note)}</td></tr>`)))
  out.push(table('Áudio', ['Formato', 'Extensões', 'Quem grava', 'Som', 'Timecode', 'Observação'], aud.map((c) => `<tr><td>${esc(c.name)}</td><td class="ext">.${c.ext.join(' .')}</td><td>${esc(c.who)}</td><td>${badge(c.audio)}</td><td>${c.tc ? '<span class="chip chip-ok">bext / iXML</span>' : '<span class="muted">—</span>'}</td><td class="sub">${esc(c.note)}</td></tr>`)))
  out.push(table('Codecs de vídeo reconhecidos', ['Codec', 'Família', 'Identificadores'], vc.map((c) => `<tr><td>${esc(c.name)}${c.raw ? ' <span class="chip chip-raw">RAW</span>' : ''}</td><td>${esc(c.family)}</td><td class="ext">${c.fourcc.map(esc).join(' · ')}</td></tr>`)))
  out.push(table('Codecs de áudio', ['Codec', 'Identificadores', 'Som'], ac.map((c) => `<tr><td>${esc(c.name)}</td><td class="ext">${c.fourcc.map((f) => esc(f.replace('\u0000', '·'))).join(' · ')}</td><td>${badge(c.support)}</td></tr>`)))
  out.push(table('Estruturas de cartão', ['Aparelho', 'Marca', 'Caminho típico'], cards.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.brand)}</td><td class="ext">${esc(c.example)}</td></tr>`)))
  const html = out.join('')
  return html || '<div class="empty"><h2>Nada encontrado</h2><p>Tente outro nome, extensão ou marca.</p></div>'
}

export { formatCount }
