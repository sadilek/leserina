// The game: pictures and words scattered on the mat, drag one onto its partner to make a pair.
import wordList from '../words.json'
import { pictureFace } from './assets'
import { chestSvg, Coin, fullCoin, openChestSvgs } from './coin'
import { place } from './layout'
import { applyResult, composeRound, type Outcome, type RoundResult, type Word } from './scheduler'
import * as sound from './sound'
import { save, type Profile, type SavedRound } from './store'

const words = wordList as Word[]
const wordById = new Map(words.map((w) => [w.id, w]))

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const ms = (t: number) => (reducedMotion() ? Math.min(t, 120) : t)
const wait = (t: number) => new Promise((r) => setTimeout(r, ms(t)))

type Kind = 'p' | 'w'
interface Item {
  kind: Kind
  id: string
  el: HTMLElement
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: (Node | string)[]) {
  const e = document.createElement(tag)
  e.className = cls
  e.append(...children)
  return e
}

const HOME_ICON =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 24 L24 9 L40 24 M13 20 V40 H35 V20" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const PLAY_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 11 L37 24 L17 37 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>'

export function startGame(root: HTMLElement, profile: Profile, onHome: () => void) {
  const coin = new Coin()
  const home = h('button', 'round-btn home')
  home.innerHTML = HOME_ICON
  home.setAttribute('aria-label', 'Zurück zur Auswahl')
  const count = h('span', 'chest-count', String(profile.coins))
  const chest = h('button', 'chest', chestSvg(), count)
  chest.setAttribute('aria-label', 'Schatztruhe')
  const coinSlot = h('div', 'coin-slot', coin.svg)
  const bar = h('header', 'bar', home, coinSlot, h('div', 'spacer'), chest)
  const mat = h('main', 'mat')
  const shelfCards = h('div', 'shelf-cards')
  const shelf = h('footer', 'shelf', shelfCards)
  const fx = h('div', 'fx')
  const screen = h('div', 'screen game', bar, mat, shelf, fx)
  root.replaceChildren(screen)

  let round: SavedRound
  let items: Item[] = []
  let z = 10
  let finishing = false

  home.addEventListener('click', onHome)
  chest.addEventListener('click', () => showChest(screen, profile.coins))

  const commit = () => save()

  function newRound() {
    const ids = composeRound(profile.learning, words, profile.pairs, profile.startLevel)
    round = { ids, matched: [], wrong: [], help: [], pos: {} }
    profile.current = round
    commit()
    build()
  }

  function build() {
    finishing = false
    mat.replaceChildren()
    shelfCards.replaceChildren()
    sound.preload(round.ids)
    coin.set(round.matched.length, round.ids.length)
    for (const id of round.matched) shelfCards.append(shelfCard(id))
    const open = round.ids.filter((id) => !round.matched.includes(id))
    items = []
    // Pictures and words are shuffled independently; their order on the mat is random anyway.
    for (const id of shuffle([...open])) items.push(makeItem('p', id))
    for (const id of shuffle([...open])) items.push(makeItem('w', id))
    for (const it of shuffle([...items])) mat.append(it.el)
    layout(false)
  }

  /** Size the cards for the mat, then place them: saved positions if they still fit, else fresh. */
  function layout(fresh: boolean) {
    const r = mat.getBoundingClientRect()
    if (!r.width || !r.height) return
    const n = Math.max(round.ids.length, 4)
    const pic = Math.round(Math.max(96, Math.min(210, Math.sqrt((0.3 * r.width * r.height) / (1.55 * n)))))
    screen.style.setProperty('--pic', `${pic}px`)
    const sizes = items.map((it) => ({ w: it.el.offsetWidth, h: it.el.offsetHeight }))
    const saved = items.map((it) => round.pos[`${it.kind}:${it.id}`])
    if (!fresh && saved.every(Boolean)) {
      items.forEach((it, i) => setPos(it, saved[i][0] * r.width, saved[i][1] * r.height, false))
      return
    }
    const pts = place(sizes, { w: r.width, h: r.height })
    items.forEach((it, i) => setPos(it, pts[i].x, pts[i].y))
    commit()
  }

  function setPos(it: Item, x: number, y: number, remember = true) {
    const r = mat.getBoundingClientRect()
    x = Math.max(0, Math.min(x, r.width - it.el.offsetWidth))
    y = Math.max(0, Math.min(y, r.height - it.el.offsetHeight))
    it.el.style.left = `${x}px`
    it.el.style.top = `${y}px`
    if (remember) round.pos[`${it.kind}:${it.id}`] = [x / r.width, y / r.height]
  }

  function makeItem(kind: Kind, id: string): Item {
    const word = wordById.get(id)!
    const el =
      kind === 'p' ? h('div', 'item picture', pictureFace(word)) : h('div', 'item word', word.word)
    el.dataset.id = id
    const it: Item = { kind, id, el }
    el.addEventListener('pointerdown', (e) => grab(it, e))
    return it
  }

  function grab(it: Item, e: PointerEvent) {
    if (finishing || !it.el.isConnected) return
    e.preventDefault()
    sound.unlock()
    it.el.setPointerCapture(e.pointerId)
    const startX = e.clientX, startY = e.clientY
    const left = it.el.offsetLeft, top = it.el.offsetTop
    let dragging = false

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dx = ev.clientX - startX, dy = ev.clientY - startY
      if (!dragging && Math.hypot(dx, dy) > 10) {
        dragging = true
        it.el.classList.add('dragging')
        it.el.style.zIndex = String(++z)
      }
      if (dragging) setPos(it, left + dx, top + dy, false)
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      it.el.removeEventListener('pointermove', move)
      it.el.removeEventListener('pointerup', end)
      it.el.removeEventListener('pointercancel', end)
      it.el.classList.remove('dragging')
      if (!dragging) return tap(it)
      if (ev.type === 'pointercancel') return springBack(it, left, top)
      drop(it, ev, left, top)
    }
    it.el.addEventListener('pointermove', move)
    it.el.addEventListener('pointerup', end)
    it.el.addEventListener('pointercancel', end)
  }

  function tap(it: Item) {
    const w = wordById.get(it.id)!
    void sound.sayWord(w.id, w.word)
    // Hearing the written word takes away the reading; hearing the picture's word does not.
    if (it.kind === 'w' && !round.help.includes(it.id)) {
      round.help.push(it.id)
      commit()
    }
    it.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
      duration: ms(260),
    })
  }

  /** The partner card under the finger, or else the one the dragged card covers most. */
  function target(it: Item, ev: PointerEvent): Item | null {
    const others = items.filter((o) => o.kind !== it.kind && o.el.isConnected)
    const under = others.find((o) => {
      const r = o.el.getBoundingClientRect()
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
    })
    if (under) return under
    const a = it.el.getBoundingClientRect()
    let best: Item | null = null, bestArea = 0
    for (const o of others) {
      const b = o.el.getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      const area = w > 0 && hh > 0 ? w * hh : 0
      const smaller = Math.min(a.width * a.height, b.width * b.height)
      if (area > bestArea && area > 0.25 * smaller) {
        best = o
        bestArea = area
      }
    }
    return best
  }

  function drop(it: Item, ev: PointerEvent, left: number, top: number) {
    const t = target(it, ev)
    if (!t) {
      setPos(it, it.el.offsetLeft, it.el.offsetTop)
      commit()
      return
    }
    if (t.id === it.id) return match(it, t)
    // The dragged card's word is the one the child was trying to place.
    if (!round.wrong.includes(it.id)) round.wrong.push(it.id)
    commit()
    springBack(it, left, top)
  }

  function springBack(it: Item, left: number, top: number) {
    const from = { x: it.el.offsetLeft, y: it.el.offsetTop }
    setPos(it, left, top, false)
    it.el.animate(
      [{ transform: `translate(${from.x - left}px, ${from.y - top}px)` }, { transform: 'translate(0, 0)' }],
      { duration: ms(520), easing: 'cubic-bezier(.34,1.45,.55,1)' },
    )
  }

  async function match(dragged: Item, still: Item) {
    const id = dragged.id
    const word = wordById.get(id)!
    if (round.matched.length === round.ids.length - 1) round.forced = id
    round.matched.push(id)
    delete round.pos[`p:${id}`]
    delete round.pos[`w:${id}`]
    items = items.filter((i) => i.id !== id)
    const done = round.matched.length === round.ids.length
    if (done) finishRound()
    else commit()

    // The pair becomes one card where the partner lay, pops, and flies onto the shelf.
    const s = still.el.getBoundingClientRect()
    const card = pairCard(word, 'pair big')
    fx.append(card)
    const cw = card.offsetWidth, ch = card.offsetHeight
    const cx = Math.max(8, Math.min(innerWidth - cw - 8, s.left + s.width / 2 - cw / 2))
    const cy = Math.max(8, Math.min(innerHeight - ch - 8, s.top + s.height / 2 - ch / 2))
    card.style.left = `${cx}px`
    card.style.top = `${cy}px`
    dragged.el.remove()
    still.el.remove()
    sound.jingle()
    burst(fx, cx + cw / 2, cy + ch / 2, 14, ['#ffd84d', '#ffffff', '#ff9fb2', '#9fe3ff'])
    await card.animate([{ transform: 'scale(.55)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], {
      duration: ms(480), easing: 'ease-out',
    }).finished
    coin.set(round.matched.length, round.ids.length, true)
    void sound.sayWord(word.id, word.word)
    await wait(650)

    const slot = shelfCard(id)
    slot.style.visibility = 'hidden'
    shelfCards.append(slot)
    const to = slot.getBoundingClientRect()
    const scale = to.width / cw
    await card.animate(
      [{ transform: 'none' }, {
        transform: `translate(${to.left - cx + (to.width - cw) / 2}px, ${to.top - cy + (to.height - ch) / 2}px) scale(${scale})`,
      }],
      { duration: ms(650), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' },
    ).finished
    card.remove()
    slot.style.visibility = ''
    if (done) await celebrate()
  }

  function shelfCard(id: string) {
    const word = wordById.get(id)!
    const card = pairCard(word, 'pair small')
    card.addEventListener('pointerdown', () => {
      sound.unlock()
      void sound.sayWord(word.id, word.word)
      card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: ms(260) })
    })
    return card
  }

  /** The round is over: record it right away, so closing the app mid-celebration loses nothing. */
  function finishRound() {
    finishing = true
    const result: RoundResult = {}
    for (const id of round.ids) result[id] = outcome(round, id)
    profile.learning = applyResult(profile.learning, result)
    profile.coins += 1
    profile.current = null
    commit()
  }

  async function celebrate() {
    const from = coin.svg.getBoundingClientRect()
    const big = fullCoin()
    big.classList.add('flying-coin')
    fx.append(big)
    Object.assign(big.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
    coin.set(0, round.ids.length)
    // The coin scales from its top-left corner, so centre it by its scaled size.
    const k = Math.min(innerWidth, innerHeight) / 2.6 / from.width
    const cx = innerWidth / 2 - (k * from.width) / 2, cy = innerHeight / 2.4 - (k * from.height) / 2
    sound.fanfare()
    await big.animate(
      [
        { transform: 'translate(0,0) scale(1) rotateY(0)' },
        { transform: `translate(${cx - from.left}px, ${cy - from.top}px) scale(${k}) rotateY(720deg)` },
      ],
      { duration: ms(1100), easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' },
    ).finished
    burst(fx, innerWidth / 2, innerHeight / 2.4, 36, ['#ffd84d', '#ffe98a', '#ffffff', '#f5a623'], 1.8)
    await wait(900)

    const c = chest.getBoundingClientRect()
    const end = 0.35
    const tx = c.left + c.width / 2 - (end * from.width) / 2 - from.left
    const ty = c.top + c.height / 3 - (end * from.height) / 2 - from.top
    const lid = chest.querySelector<SVGGElement>('.lid')!
    lid.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-28deg)' }], { duration: ms(300), fill: 'forwards' })
    await big.animate(
      [
        { transform: `translate(${cx - from.left}px, ${cy - from.top}px) scale(${k})` },
        { transform: `translate(${tx}px, ${ty}px) scale(${end})`, opacity: 0.9 },
      ],
      { duration: ms(800), easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' },
    ).finished
    big.remove()
    lid.animate([{ transform: 'rotate(-28deg)' }, { transform: 'rotate(0)' }], { duration: ms(250), fill: 'forwards' })
    sound.clink()
    count.textContent = String(profile.coins)
    chest.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.25) rotate(-6deg)' }, { transform: 'scale(.95) rotate(4deg)' }, { transform: 'scale(1)' }],
      { duration: ms(600), easing: 'ease-out' },
    )
    await wait(500)
    const next = h('button', 'round-btn next')
    next.innerHTML = PLAY_ICON
    next.setAttribute('aria-label', 'Nächste Runde')
    mat.append(next)
    next.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: ms(450) })
    next.addEventListener('click', () => {
      sound.unlock()
      newRound()
    })
  }

  let resizeTimer = 0
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      if (!screen.isConnected) return removeEventListener('resize', onResize)
      if (!finishing) layout(true)
    }, 150)
  }
  addEventListener('resize', onResize)

  const valid = (r: SavedRound | null) => r && r.ids.length > 0 && r.ids.every((id) => wordById.has(id))
  if (valid(profile.current)) {
    round = profile.current!
    requestAnimationFrame(build)
  } else {
    requestAnimationFrame(newRound)
  }
}

export function outcome(round: SavedRound, id: string): Outcome {
  if (round.wrong.includes(id)) return 'wrong'
  if (round.help.includes(id)) return 'help'
  if (round.forced === id) return 'forced'
  return 'right'
}

function pairCard(word: Word, cls: string) {
  return h('div', cls, h('div', 'pair-pic', pictureFace(word)), h('div', 'pair-word', word.word))
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Little stars flying out from a point. */
function burst(layer: HTMLElement, x: number, y: number, n: number, colors: string[], spread = 1) {
  if (reducedMotion()) return
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div')
    s.className = 'spark'
    s.textContent = i % 3 ? '★' : '✦'
    s.style.color = colors[i % colors.length]
    s.style.left = `${x}px`
    s.style.top = `${y}px`
    s.style.fontSize = `${14 + Math.random() * 18 * spread}px`
    layer.append(s)
    const a = (i / n) * 2 * Math.PI + Math.random() * 0.5
    const d = (90 + Math.random() * 90) * spread
    s.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1) rotate(${Math.random() * 180}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 500 * spread, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    ).finished.then(() => s.remove())
  }
}

/** The chest opened: every coin collected so far, heaped inside it, with the number written large. */
export function showChest(screen: HTMLElement, coins: number) {
  const shown = Math.min(coins, 45)
  // Rows from the bottom up, each one coin shorter, like a heap.
  const rows: number[] = []
  let left = shown
  let w = Math.max(1, Math.ceil((Math.sqrt(8 * shown + 1) - 1) / 2))
  while (left > 0) {
    const k = Math.min(w, left)
    rows.push(k)
    left -= k
    w = Math.max(1, w - 1)
  }
  const size = Math.min(70, 300 / Math.max(1, rows[0] ?? 1) + 8)
  const pile = h('div', 'pile')
  pile.style.setProperty('--coin', `${size}px`)
  for (const k of rows) {
    const r = h('div', 'pile-row')
    for (let i = 0; i < k; i++) r.append(fullCoin())
    pile.prepend(r)
  }
  const [back, front] = openChestSvgs()
  const panel = h('div', 'chest-panel', h('div', 'chest-open', back, pile, front), h('div', 'chest-number', String(coins)))
  const overlay = h('div', 'overlay', panel)
  overlay.addEventListener('click', () => overlay.remove())
  screen.append(overlay)
  panel.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
    duration: ms(350), easing: 'cubic-bezier(.3,1.3,.5,1)',
  })
}
