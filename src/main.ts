import '@fontsource/andika/latin-400.css'
import '@fontsource/andika/latin-700.css'
import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { startGame } from './game'
import { parentsCorner } from './parents'
import { startScreen } from './start'
import { unlock } from './sound'
import { onSync, persist } from './store'
import { startAutoSync } from './sync'

const root = document.getElementById('app')!

let onStart = false
// A new version that arrives during a round or in the parents' corner waits for the start screen.
let reloadPending = false

function home() {
  if (reloadPending) return location.reload()
  onStart = true
  startScreen(root, (p) => {
    onStart = false
    startGame(root, p, home)
  }, () => {
    onStart = false
    parentsCorner(root, home)
  })
}

// Profiles a sync brought along show up on the start screen right away.
onSync(() => {
  if (onStart) home()
})

// No pinch zoom, no page bounce, no long-press menu: the whole screen is the game.
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault())
document.addEventListener('contextmenu', (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
})

// iOS lets audio start only from certain gestures (which ones differs between versions): try all.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click']) {
  document.addEventListener(type, () => unlock(), { capture: true, passive: true })
}

persist()
registerSW({
  immediate: true,
  // The new version takes over at once (autoUpdate); the page reloads into it on the start
  // screen, never in the middle of a round.
  onNeedReload() {
    if (onStart) location.reload()
    else reloadPending = true
  },
  // A home-screen app mostly comes back from the background instead of starting anew, and the
  // browser looks for a new version only when the page loads. So look whenever the app comes to
  // the foreground, and every hour while it stays there.
  onRegisteredSW(_url, r) {
    if (!r) return
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) r.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    setInterval(check, 60 * 60 * 1000)
  },
})
home()
startAutoSync()
