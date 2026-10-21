// Do que foi arrastado para a lista de clipes: tira o que não é mídia, junta sequências de quadros (DNG, ARRIRAW,
// EXR…) e pedaços de R3D num clipe só, e anota os XML da Sony que acompanham cada clipe.

import { ignoredReason, extInfo } from './formats.js'

const SEQ_EXT = new Set(['dng', 'ari', 'arx', 'exr', 'dpx', 'tif', 'tiff', 'cin'])

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseOf = (p) => p.split('/').pop()
const stemOf = (n) => (n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n)

/**
 * entries: [{ file, path }]
 * @returns {{ media: Array<{ file, relPath, name, size, lastModified, seq?, spans?, sidecar? }>, ignored: Array<{ relPath, why }> }}
 */
export function scanEntries(entries) {
  const media = []
  const ignored = []
  const xmls = new Map()
  const seqs = new Map()
  const r3d = new Map()
  for (const { file, path } of entries) {
    const rel = (path || file.name).replace(/^\/+/, '')
    const name = baseOf(rel)
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase()
    // XML da Sony ao lado do clipe (C0001M01.XML): guarda para ler timecode e modelo
    if (ext === 'xml' && /M01\.XML$/i.test(name) && !name.startsWith('._')) {
      xmls.set(`${dirOf(rel)}/${name.replace(/M01\.XML$/i, '').toLowerCase()}`, file)
      ignored.push({ relPath: rel, why: 'Metadado da Sony (lido junto com o clipe)' })
      continue
    }
    const why = ignoredReason(rel)
    if (why) {
      ignored.push({ relPath: rel, why })
      continue
    }
    if (SEQ_EXT.has(ext)) {
      const m = stemOf(name).match(/^(.*?)(\d{3,})$/)
      if (m) {
        const key = `${dirOf(rel)}|${m[1]}|${ext}|${m[2].length}`
        if (!seqs.has(key)) seqs.set(key, { prefix: m[1], ext, digits: m[2].length, frames: [] })
        seqs.get(key).frames.push({ n: +m[2], file, rel })
        continue
      }
    }
    if (ext === 'r3d') {
      const m = stemOf(name).match(/^(.*)_(\d{3})$/)
      if (m) {
        const key = `${dirOf(rel)}|${m[1]}`
        if (!r3d.has(key)) r3d.set(key, [])
        r3d.get(key).push({ n: +m[2], file, rel })
        continue
      }
    }
    if (!extInfo(ext) && ext && !/^[a-z0-9]{2,5}$/.test(ext)) {
      ignored.push({ relPath: rel, why: 'Não é mídia' })
      continue
    }
    media.push({ file, relPath: rel, name, size: file.size, lastModified: file.lastModified })
  }
  for (const s of seqs.values()) {
    s.frames.sort((a, b) => a.n - b.n)
    const first = s.frames[0]
    const last = s.frames[s.frames.length - 1]
    if (s.frames.length === 1) {
      media.push({ file: first.file, relPath: first.rel, name: baseOf(first.rel), size: first.file.size, lastModified: first.file.lastModified })
      continue
    }
    const pad = (n) => String(n).padStart(s.digits, '0')
    const name = `${s.prefix}[${pad(first.n)}-${pad(last.n)}].${s.ext}`
    media.push({
      file: first.file,
      relPath: first.rel,
      name,
      size: s.frames.reduce((t, f) => t + f.file.size, 0),
      lastModified: last.file.lastModified,
      seq: { count: s.frames.length, first: first.n, last: last.n, prefix: s.prefix, ext: s.ext, digits: s.digits, gaps: last.n - first.n + 1 - s.frames.length },
    })
  }
  for (const parts of r3d.values()) {
    parts.sort((a, b) => a.n - b.n)
    const f = parts[0]
    media.push({ file: f.file, relPath: f.rel, name: baseOf(f.rel), size: parts.reduce((t, p) => t + p.file.size, 0), lastModified: parts[parts.length - 1].file.lastModified, spans: parts.length })
  }
  for (const m of media) {
    const sc = xmls.get(`${dirOf(m.relPath)}/${stemOf(m.name).toLowerCase()}`)
    if (sc) m.sidecar = sc
  }
  media.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { numeric: true }))
  return { media, ignored }
}

/** Lê pastas arrastadas (DataTransferItem → FileSystemEntry), mantendo o caminho relativo. */
export async function entriesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])]
  const roots = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean)
  if (!roots.length) return [...(dataTransfer.files || [])].map((file) => ({ file, path: file.name }))
  const out = []
  const walk = async (entry) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej))
      out.push({ file, path: entry.fullPath.replace(/^\//, '') })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      let batch
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej))
        for (const e of batch) await walk(e)
      } while (batch.length)
    }
  }
  for (const r of roots) await walk(r)
  return out
}

/** Arquivos de um <input type=file> (com ou sem webkitdirectory). */
export function entriesFromInput(files) {
  return [...files].map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}
