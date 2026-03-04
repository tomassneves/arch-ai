import './style.css'
import '../chatbox/style.css'
import '../chatbox/history.css'
import '../chatbox/script.js' // executes chat logic on DOMContentLoaded
import { Engine } from './engine.js'
import { bootstrap } from '../app/bootstrap.js'

const app = document.getElementById('app')
const engine = new Engine(app)
// expose for external scripts (chatbox etc.)
window.engine = engine

// Initialize the UI
bootstrap(engine)

// Hide loading screen
setTimeout(() => {
  document.getElementById('loading-screen')?.classList.add('hidden')
}, 500)

// Toolbar sync
const btn = {
  select: document.getElementById('tool-select'),
  translate: document.getElementById('tool-move'),
  rotate: document.getElementById('tool-rotate'),
  scale: document.getElementById('tool-scale'),
}

const setActive = (mode) => {
  for (const k in btn) btn[k]?.classList.remove('active')
  if (mode === 'select') btn.select?.classList.add('active')
  if (mode === 'translate') btn.translate?.classList.add('active')
  if (mode === 'rotate') btn.rotate?.classList.add('active')
  if (mode === 'scale') btn.scale?.classList.add('active')
}

btn.select?.addEventListener('click', () => engine.setTool('select'))
btn.translate?.addEventListener('click', () => engine.setTool('translate'))
btn.rotate?.addEventListener('click', () => engine.setTool('rotate'))
btn.scale?.addEventListener('click', () => engine.setTool('scale'))

document.getElementById('btn-import')?.addEventListener('click', () => {
  document.getElementById('import-file')?.click()
})

document.getElementById('import-file')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0]
  if (file) {
    engine.importGLB(file)
    e.target.value = '' // reset for next import
  }
})

document.getElementById('btn-export')?.addEventListener('click', () => engine.exportGLB())

engine.on('toolchange', ({ mode }) => setActive(mode))
setActive(engine.toolMode)