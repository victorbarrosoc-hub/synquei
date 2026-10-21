// Ponte mínima entre o app e o sistema: o caminho completo de um arquivo escolhido ou arrastado (para as exportações),
// a plataforma (para o visual da janela) e o aviso de versão nova (desktop/atualizador.cjs). Nada mais do Node chega
// à página.

const { contextBridge, webUtils, ipcRenderer } = require('electron')

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
