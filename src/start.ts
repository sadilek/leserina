// The start screen: one big avatar per child. The parents' corner hides behind a long press.
import { avatarFace } from './assets'
import { slug } from './slug'
import * as sound from './sound'
import { data, type Profile } from './store'

const HOLD_MS = 1500

export function startScreen(root: HTMLElement, onPick: (p: Profile) => void, onParents: () => void) {
  const screen = document.createElement('div')
  screen.className = 'screen start'
  const title = document.createElement('h1')
  title.className = 'title'
  title.textContent = 'Leserina'
  const kids = document.createElement('div')
  kids.className = 'kids'

  for (const p of data.profiles) {
    const b = document.createElement('button')
    b.className = 'kid'
    const name = document.createElement('span')
    name.className = 'kid-name'
    name.textContent = p.name
    b.append(avatarFace(p.avatar), name)
    let picked = false
    b.addEventListener('click', () => {
      if (picked) return
      picked = true
      sound.unlock()
      void sound.sayName(slug(p.name), p.name)
      b.classList.add('picked')
      setTimeout(() => onPick(p), 900)
    })
    kids.append(b)
  }

  if (!data.profiles.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    const text = document.createElement('p')
    text.textContent = 'Noch kein Kind angelegt. Im Elternbereich legst du für jedes Kind ein Profil an.'
    const add = document.createElement('button')
    add.className = 'pill'
    add.textContent = 'Elternbereich öffnen'
    add.addEventListener('click', onParents)
    empty.append(text, add)
    kids.append(empty)
  }

  screen.append(title, kids, parentsButton(onParents))
  root.replaceChildren(screen)
}

/** A small lock that opens the parents' corner only when held down, so children pass it by. */
function parentsButton(onParents: () => void) {
  const b = document.createElement('button')
  b.className = 'parents-btn'
  b.setAttribute('aria-label', 'Elternbereich (gedrückt halten)')
  b.innerHTML =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring" cx="24" cy="24" r="21" pathLength="100"/>' +
    '<rect x="15" y="22" width="18" height="14" rx="3" fill="currentColor"/>' +
    '<path d="M18 22 V17 a6 6 0 0 1 12 0 V22" fill="none" stroke="currentColor" stroke-width="3.5"/></svg>'
  let timer = 0
  const cancel = () => {
    clearTimeout(timer)
    b.classList.remove('holding')
  }
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    b.classList.add('holding')
    timer = window.setTimeout(() => {
      b.classList.remove('holding')
      onParents()
    }, HOLD_MS)
  })
  b.addEventListener('pointerup', cancel)
  b.addEventListener('pointerleave', cancel)
  b.addEventListener('pointercancel', cancel)
  b.addEventListener('contextmenu', (e) => e.preventDefault())
  return b
}
