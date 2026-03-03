import { Engine } from '../engine/engine.js'

export function bootstrap() {
  const app = document.getElementById('app')
  if (!app) throw new Error('Could not find #app')

  const engine = new Engine(app)
  window.__engine = engine

  const btnSelect = document.getElementById('tool-select')
  const btnMove = document.getElementById('tool-move')
  const btnRotate = document.getElementById('tool-rotate')
  const btnScale = document.getElementById('tool-scale')
  const btnNew = document.getElementById('btn-new')
  const btnExport = document.getElementById('btn-export')

  const toolButtons = {
    select: btnSelect,
    translate: btnMove,
    rotate: btnRotate,
    scale: btnScale,
  }

  function setActiveButton(mode) {
    Object.values(toolButtons).forEach((b) => b?.classList.remove('active'))
    toolButtons[mode]?.classList.add('active')
  }

  engine.onToolChange = (mode) => setActiveButton(mode)

  btnSelect?.addEventListener('click', () => engine.setTool('select'))
  btnMove?.addEventListener('click', () => engine.setTool('translate'))
  btnRotate?.addEventListener('click', () => engine.setTool('rotate'))
  btnScale?.addEventListener('click', () => engine.setTool('scale'))

  btnNew?.addEventListener('click', () => {
    engine.addCube({
      x: (Math.random() - 0.5) * 10,
      z: (Math.random() - 0.5) * 10,
    })
    engine.setTool('translate')
  })

  btnExport?.addEventListener('click', () => engine.exportGLB())
  setActiveButton('translate')
}