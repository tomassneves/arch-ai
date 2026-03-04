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

  // Menu bar functionality
  const fileMenu = document.getElementById('file-menu')
  const fileDropdown = document.getElementById('file-dropdown')
  const menuSave = document.getElementById('menu-save')
  const menuImport = document.getElementById('menu-import')
  const menuExport = document.getElementById('menu-export')
  const importFile = document.getElementById('import-file')

  // Toggle file dropdown
  fileMenu?.addEventListener('click', (e) => {
    e.stopPropagation()
    fileDropdown.style.display = fileDropdown.style.display === 'none' ? 'block' : 'none'
  })

  // Close dropdown when clicking menu items
  const closeDropdown = () => {
    fileDropdown.style.display = 'none'
  }

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', () => {
    fileDropdown.style.display = 'none'
  })

  // File menu actions
  menuSave?.addEventListener('click', (e) => {
    e.stopPropagation()
    engine.exportGLB()
    closeDropdown()
  })

  menuImport?.addEventListener('click', (e) => {
    e.stopPropagation()
    importFile?.click()
    closeDropdown()
  })

  menuExport?.addEventListener('click', (e) => {
    e.stopPropagation()
    engine.exportGLB()
    closeDropdown()
  })

  // Handle file import
  importFile?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const arrayBuffer = ev.target?.result
        if (arrayBuffer instanceof ArrayBuffer) {
          engine.importGLB(arrayBuffer)
        }
      }
      reader.readAsArrayBuffer(file)
    }
    e.target.value = '' // Reset input
  })

  setActiveButton('translate')
}