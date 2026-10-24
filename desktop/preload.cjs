// Ponte mínima entre o app e o sistema: o caminho completo de um arquivo escolhido ou arrastado (para as exportações),
// a plataforma (para o visual da janela), o aviso de versão nova (desktop/atualizador.cjs) e o Organizar
// (desktop/organizador.cjs e davinci.cjs). Nada mais do Node chega à página.

const { contextBridge, webUtils, ipcRenderer } = require('electron')

const ouvir = (canal, cb) => {
  const f = (_e, x) => cb(x)
  ipcRenderer.on(canal, f)
  return () => ipcRenderer.removeListener(canal, f)
}

contextBridge.exposeInMainWorld('synqueiDesktop', {
  isDesktop: true,
  platform: process.platform,
  pathFor(file) {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  // Organizar: pastas do SOBEDESCE vigiadas, cartões que chegam e a ponte com o DaVinci
  organizar: {
    estado: () => ipcRenderer.invoke('org:estado'),
    escolher: () => ipcRenderer.invoke('org:escolher'),
    remover: (id) => ipcRenderer.invoke('org:remover', id),
    ligar: (id, ligado) => ipcRenderer.invoke('org:ligar', id, ligado),
    vincular: (id, dados) => ipcRenderer.invoke('org:vincular', id, dados),
    marcar: (pastaId, cartaoId, estado, erro) => ipcRenderer.invoke('org:marcar', pastaId, cartaoId, estado, erro),
    pendentes: (pastaId) => ipcRenderer.invoke('org:pendentes', pastaId),
    todos: (pastaId) => ipcRenderer.invoke('org:todos', pastaId),
    escrever: (pastaId, rel, texto) => ipcRenderer.invoke('org:escrever', pastaId, rel, texto),
    assets: (pastaId) => ipcRenderer.invoke('org:assets', pastaId),
    abrir: (pastaId) => ipcRenderer.invoke('org:abrir', pastaId),
    onCartao: (cb) => ouvir('synquei:org-cartao', cb),
    onEstado: (cb) => ouvir('synquei:org-estado', cb),
  },
  davinci: {
    status: () => ipcRenderer.invoke('davinci:status'),
    instalar: () => ipcRenderer.invoke('davinci:instalar'),
    enviar: (pedido) => ipcRenderer.invoke('davinci:enviar', pedido),
    on: (cb) => ouvir('synquei:davinci', cb),
    onResposta: (cb) => ouvir('synquei:davinci-resposta', cb),
  },
  atualizacao: {
    status: () => ipcRenderer.invoke('atu:status'),
    verificar: () => ipcRenderer.invoke('atu:verificar'),
    aplicar: () => ipcRenderer.invoke('atu:aplicar'),
    depois: () => ipcRenderer.invoke('atu:depois'),
    tentar: () => ipcRenderer.invoke('atu:tentar'),
    baixar: () => ipcRenderer.invoke('atu:baixar'),
    on(cb) {
      const f = (_e, st) => cb(st)
      ipcRenderer.on('synquei:atualizacao', f)
      return () => ipcRenderer.removeListener('synquei:atualizacao', f)
    },
  },
})

addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`)
})
