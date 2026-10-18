import '@fontsource/andika/latin-400.css'
import '@fontsource/andika/latin-700.css'
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { startGame } from './game'
import { parentsCorner } from './parents'
import { startScreen } from './start'
import { persist } from './store'

const root = document.getElementById('app')!

function home() {
  startScreen(root, (p) => startGame(root, p, home), () => parentsCorner(root, home))
}

// No pinch zoom, no page bounce, no long-press menu: the whole screen is the game.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault())
document.addEventListener('contextmenu', (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
})

persist()
registerSW({ immediate: true })
home()
