// Ponte mínima entre o app e o sistema: o caminho completo de um arquivo escolhido ou arrastado (para as exportações)
// e a plataforma (para o visual da janela). Nada mais do Node chega à página.

const { contextBridge, webUtils } = require('electron')

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
})

addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-desktop', `platform-${process.platform}`)
})
