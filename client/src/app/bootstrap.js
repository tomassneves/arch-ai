import { Engine } from '../engine/engine.js'

export function bootstrap(engine) {
  // If no engine is provided, create one
  if (!engine) {
    const app = document.getElementById('app')
    if (!app) throw new Error('Could not find #app')
    engine = new Engine(app)
    window.__engine = engine
  }

  // Get all menu elements
  const fileMenu = document.getElementById('file-menu')
  const fileDropdown = document.getElementById('file-dropdown')
  const addMenu = document.getElementById('add-menu')
  const addDropdown = document.getElementById('add-dropdown')
  const menubar = document.getElementById('menubar')

  // Get file menu items
  const menuSave = document.getElementById('menu-save')
  const menuImport = document.getElementById('menu-import')
  const menuExport = document.getElementById('menu-export')
  const importFile = document.getElementById('import-file')

  // Objects tracking by category
  const objectsPanel = document.getElementById('objects-panel-content')
  const objects = {
    'Basic Shapes': [],
    'Structural Elements': [],
    'Architectural': [],
    'Assembly': []
  }

  // Mapping of menu IDs to their categories and methods
  const objectMappings = {
    'menu-cube': { category: 'Basic Shapes', method: 'addCube', label: 'Cube' },
    'menu-sphere': { category: 'Basic Shapes', method: 'addSphere', label: 'Sphere' },
    'menu-cylinder': { category: 'Basic Shapes', method: 'addCylinder', label: 'Cylinder' },
    'menu-cone': { category: 'Basic Shapes', method: 'addCone', label: 'Cone' },
    'menu-torus': { category: 'Basic Shapes', method: 'addTorus', label: 'Torus' },
    'menu-box': { category: 'Basic Shapes', method: 'addBox', label: 'Box' },
    'menu-capsule': { category: 'Basic Shapes', method: 'addCapsule', label: 'Capsule' },
    'menu-triangle': { category: 'Basic Shapes', method: 'addTriangle', label: 'Triangle' },
    'menu-wall': { category: 'Structural Elements', method: 'addWall', label: 'Wall' },
    'menu-column': { category: 'Structural Elements', method: 'addColumn', label: 'Column' },
    'menu-column-with-capital': { category: 'Structural Elements', method: 'addColumnWithCapital', label: 'Column with Capital' },
    'menu-beam': { category: 'Structural Elements', method: 'addBeam', label: 'Beam' },
    'menu-arch': { category: 'Structural Elements', method: 'addArch', label: 'Arch' },
    'menu-roof': { category: 'Structural Elements', method: 'addRoof', label: 'Roof' },
    'menu-dome': { category: 'Structural Elements', method: 'addDome', label: 'Dome' },
    'menu-stair': { category: 'Structural Elements', method: 'addStair', label: 'Stair' },
    'menu-arch-wall': { category: 'Architectural', method: 'addArchitectureWall', label: 'Architecture Wall' },
    'menu-arch-door': { category: 'Architectural', method: 'addArchitectureDoor', label: 'Architecture Door' },
    'menu-arch-window': { category: 'Architectural', method: 'addArchitectureWindow', label: 'Architecture Window' },
    'menu-arch-room': { category: 'Architectural', method: 'addArchitectureRoom', label: 'Architecture Room' },
    'menu-composite': { category: 'Assembly', method: 'addComposite', label: 'Composite' }
  }

  // Function to update the objects panel
  const updateObjectsPanel = () => {
    objectsPanel.innerHTML = ''
    for (const category in objects) {
      if (objects[category].length > 0) {
        const categoryDiv = document.createElement('div')
        categoryDiv.className = 'objects-category'
        
        const titleDiv = document.createElement('div')
        titleDiv.className = 'objects-category-title'
        titleDiv.textContent = category
        categoryDiv.appendChild(titleDiv)
        
        objects[category].forEach((obj, idx) => {
          const itemDiv = document.createElement('div')
          itemDiv.className = 'object-item'
          itemDiv.innerHTML = `${obj.label} <span class="object-item-delete">✕</span>`
          
          itemDiv.addEventListener('click', (e) => {
            if (e.target.classList.contains('object-item-delete')) {
              // Remove object
              engine.scene.remove(obj.mesh)
              objects[category].splice(idx, 1)
              updateObjectsPanel()
            } else {
              // Select object
              engine._deselAll()
              engine._sel(obj.mesh)
              engine._renScene()
            }
          })
          
          categoryDiv.appendChild(itemDiv)
        })
        
        objectsPanel.appendChild(categoryDiv)
      }
    }
  }

  // Create menu item listeners
  Object.entries(objectMappings).forEach(([menuId, mapping]) => {
    const menuItem = document.getElementById(menuId)
    if (menuItem) {
      menuItem.addEventListener('click', (e) => {
        e.stopPropagation()
        
        // Call the appropriate engine method
        const mesh = engine[mapping.method]()
        
        // Track the object
        objects[mapping.category].push({
          mesh: mesh,
          label: mapping.label + ' #' + (objects[mapping.category].length + 1)
        })
        
        // Update panel
        updateObjectsPanel()
        
        // Switch to translate tool
        engine.setTool('translate')
        
        // Close menus
        fileDropdown.style.display = 'none'
        addDropdown.style.display = 'none'
      })
    }
  })

  // Toggle file dropdown
  fileMenu?.addEventListener('click', (e) => {
    e.stopPropagation()
    addDropdown.style.display = 'none'
    fileDropdown.style.display = fileDropdown.style.display === 'none' ? 'block' : 'none'
  })

  // Toggle add dropdown
  addMenu?.addEventListener('click', (e) => {
    e.stopPropagation()
    fileDropdown.style.display = 'none'
    addDropdown.style.display = addDropdown.style.display === 'none' ? 'block' : 'none'
  })

  // Close all dropdowns when clicking outside menubar
  document.addEventListener('click', (e) => {
    if (menubar && !menubar.contains(e.target)) {
      fileDropdown.style.display = 'none'
      addDropdown.style.display = 'none'
    }
  })

  // File menu actions
  menuSave?.addEventListener('click', (e) => {
    e.stopPropagation()
    engine.exportGLB()
    fileDropdown.style.display = 'none'
    addDropdown.style.display = 'none'
  })

  menuImport?.addEventListener('click', (e) => {
    e.stopPropagation()
    importFile?.click()
    fileDropdown.style.display = 'none'
    addDropdown.style.display = 'none'
  })

  menuExport?.addEventListener('click', (e) => {
    e.stopPropagation()
    engine.exportGLB()
    fileDropdown.style.display = 'none'
    addDropdown.style.display = 'none'
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