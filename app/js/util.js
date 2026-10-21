// Ajudantes da interface.

import { sfx } from './sfx.js'

export const $ = (s, r = document) => r.querySelector(s)
export const $$ = (s, r = document) => [...r.querySelectorAll(s)]

export function h(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`

export function bytes(n) {
  if (n == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${u[i]}`
}

export const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

export function dateLabel(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, '')
}

export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  if (s < 86400 * 30) return `há ${Math.round(s / 86400)} dias`
  return dateLabel(ms)
}

export function toast(msg, { icon: ic = 'check', ms = 3200 } = {}) {
  const box = document.getElementById('toasts')
  if (!box) return
  if (ic === 'warn') sfx.error()
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `${icon(ic)}<span>${h(msg)}</span>`
  box.appendChild(el)
  setTimeout(() => {
    el.classList.add('is-out')
    setTimeout(() => el.remove(), 300)
  }, ms)
}

export function download(data, name, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  sfx.export()
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Modal simples: devolve uma Promise com o valor do botão (ou do campo). */
export function modal({ title, body = '', input = null, ok = 'OK', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const layer = document.getElementById('layer')
    const back = document.createElement('div')
    back.className = 'modal-back'
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${h(title)}">
      <h2>${h(title)}</h2>
      ${body ? `<p class="sub">${body}</p>` : ''}
      ${input != null ? `<input class="input" name="v" value="${h(input)}" autocomplete="off" />` : ''}
      <div class="row">${cancel ? `<button type="button" class="btn btn-ghost" data-v="0">${h(cancel)}</button>` : ''}<button class="btn ${danger ? 'btn-danger btn-secondary' : 'btn-primary'}" type="submit">${h(ok)}</button></div>
    </form>`
    const close = (v) => {
      back.remove()
      resolve(v)
    }
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.dataset.v === '0') close(null)
    })
    back.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault()
      close(input != null ? back.querySelector('input').value.trim() : true)
    })
    back.addEventListener('keydown', (e) => e.key === 'Escape' && close(null))
    layer.appendChild(back)
    const f = back.querySelector('input') || back.querySelector('[type=submit]')
    f.focus()
    if (f.select) f.select()
  })
}

/** Desenha picos (Uint8Array) num canvas, com a cor dada. */
export function drawPeaks(canvas, peaks, color, { from = 0, to = 1, mirror = true } = {}) {
  if (!canvas || !peaks || !peaks.length) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== hgt) canvas.height = hgt
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, hgt)
  ctx.fillStyle = color
  const a = Math.floor(from * peaks.length)
  const b = Math.max(a + 1, Math.ceil(to * peaks.length))
  const n = b - a
  const step = Math.max(1, Math.floor(dpr * 2))
  for (let x = 0; x < w; x += step) {
    const i0 = a + Math.floor((x / w) * n)
    const i1 = Math.max(i0 + 1, a + Math.floor(((x + step) / w) * n))
    let m = 0
    for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
    const v = (m / 255) * (hgt * 0.95)
    if (mirror) ctx.fillRect(x, (hgt - v) / 2, Math.max(1, step - 1), Math.max(1, v))
    else ctx.fillRect(x, hgt - v, Math.max(1, step - 1), Math.max(1, v))
  }
}

export const b64 = {
  enc(u8) {
    let s = ''
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
    return btoa(s)
  },
  dec(str) {
    const s = atob(str)
    const u = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
    return u
  },
}

export function confColor(c, method) {
  if (method === 'date') return '#8e8e93'
  if (c >= 0.75) return '#30d158'
  if (c >= 0.5) return '#ffd60a'
  return '#ff9f0a'
}

/** O app está no tema escuro agora? (escolha do usuário ou do sistema) */
export function uiDark() {
  const t = document.documentElement.dataset.theme
  if (t) return t === 'dark'
  return matchMedia('(prefers-color-scheme: dark)').matches
}
