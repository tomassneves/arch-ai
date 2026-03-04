import { Engine } from '../engine/engine.js'

export function bootstrap(engine) {
  // If no engine is provided, create one
  if (!engine) {
    const app = document.getElementById('app')
    if (!app) throw new Error('Could not find #app')
    engine = new Engine(app)
    window.__engine = engine
  }

  
  // File menu setup (toolbar buttons handled in main.js)
  const fileMenu = document.getElementById('file-menu')
  const fileDropdown = document.getElementById('file-dropdown')
  const menuSave = document.getElementById('menu-save')
  const menuImport = document.getElementById('menu-import')
  const menuExport = document.getElementById('menu-export')
  const importFile = document.getElementById('import-file')

  console.log('fileMenu:', fileMenu)
  console.log('fileDropdown:', fileDropdown)

  // Toggle file dropdown
  fileMenu?.addEventListener('click', (e) => {
    console.log('File menu clicked!')
    e.stopPropagation()
    console.log('Current display:', fileDropdown?.style.display)
    fileDropdown.style.display = fileDropdown.style.display === 'none' ? 'block' : 'none'
    console.log('New display:', fileDropdown?.style.display)
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
}