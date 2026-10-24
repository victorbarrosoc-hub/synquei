// Arquivo de uma pasta vigiada pelo Organizar (app de desktop): faz o papel de um File, mas lê pelo protocolo do app
// (synquei://app/__midia, com Range) em vez de o arquivo ter sido escolhido ou arrastado. A leitura dos formatos
// (Reader), a extração de áudio, as miniaturas e o monitor usam do mesmo jeito que usam um File.

export const midiaUrl = (abs) => `/__midia?c=${encodeURIComponent(abs)}`

class Fatia {
  constructor(file, a, b) {
    this.file = file
    this.a = a
    this.b = b
  }

  get size() {
    return this.b - this.a
  }

  slice(a = 0, b = this.size) {
    return new Fatia(this.file, Math.min(this.b, this.a + a), Math.min(this.b, this.a + b))
  }

  async arrayBuffer() {
    if (this.b <= this.a) return new ArrayBuffer(0)
    const r = await fetch(this.file.url, { headers: { Range: `bytes=${this.a}-${this.b - 1}` } })
    if (!r.ok) throw new Error(r.status === 403 ? 'Arquivo fora das pastas vigiadas' : `Não consegui ler ${this.file.name} (${r.status})`)
    return r.arrayBuffer()
  }

  async text() {
    return new TextDecoder().decode(await this.arrayBuffer())
  }
}

export class PathFile {
  constructor({ abs, name, size, lastModified }) {
    this.caminho = abs
    this.name = name || abs.split(/[\\/]/).pop()
    this.size = size || 0
    this.lastModified = lastModified || Date.now()
    this.type = ''
  }

  get url() {
    return midiaUrl(this.caminho)
  }

  slice(a = 0, b = this.size) {
    const n = this.size
    const ini = Math.max(0, Math.min(n, a < 0 ? n + a : a))
    const fim = Math.max(ini, Math.min(n, b < 0 ? n + b : b))
    return new Fatia(this, ini, fim)
  }

  arrayBuffer() {
    return this.slice().arrayBuffer()
  }

  text() {
    return this.slice().text()
  }
}

/** URL para <video>/<audio>: o protocolo do app para arquivo vigiado, blob: para o resto. */
export const urlDe = (file) => (file && file.caminho ? midiaUrl(file.caminho) : URL.createObjectURL(file))
export const soltarUrl = (url) => {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
}
