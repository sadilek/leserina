// The game: pictures and words scattered on the mat, drag one onto its partner to make a pair.
import wordList from '../words.json'
import { pictureFace } from './assets'
import { fullStar, Jar, openJar, Star } from './star'
import { apart, place } from './layout'
import { composeRound, type Outcome, type RoundResult, type Word } from './scheduler'
import * as sound from './sound'
import { onSync, recordRound, save, type Profile, type SavedRound } from './store'
import { sync } from './sync'

const words = wordList as Word[]
const wordById = new Map(words.map((w) => [w.id, w]))

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const ms = (t: number) => (reducedMotion() ? Math.min(t, 120) : t)
const wait = (t: number) => new Promise((r) => setTimeout(r, ms(t)))
/** Height of a card's solid edge in px: the first shadow of `.item` in style.css. */
const EDGE = 5

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
  const star = new Star()
  const jar = new Jar(profile.coins)
  const home = h('button', 'round-btn home')
  home.innerHTML = HOME_ICON
  home.setAttribute('aria-label', 'Zurück zur Auswahl')
  const count = h('span', 'jar-count', String(profile.coins))
  const jarBtn = h('button', 'jar', jar.svg, count)
  jarBtn.setAttribute('aria-label', 'Sternenglas')
  const starSlot = h('div', 'star-slot', star.svg)
  const bar = h('header', 'bar', home, starSlot, h('div', 'spacer'), jarBtn)
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
  /** While the star flies, the jar still shows the count without it. */
  let celebrating = false

  // Android's back gesture (a swipe in from the screen edge, easily made while dragging) would
  // close the full-screen app. An extra history entry turns it into a way back to the start screen.
  history.pushState({ round: true }, '')
  const leave = () => {
    removeEventListener('popstate', leave)
    onHome()
  }
  addEventListener('popstate', leave)
  home.addEventListener('click', () => {
    removeEventListener('popstate', leave)
    if (history.state?.round) history.back()
    onHome()
  })
  jarBtn.addEventListener('click', () => showJar(screen, profile.coins))
  // Stars from another device count as soon as a sync brings them; the celebration sets its own.
  const off = onSync(() => {
    if (!screen.isConnected) return off()
    if (celebrating) return
    jar.set(profile.coins)
    count.textContent = String(profile.coins)
  })

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
    star.set(round.matched.length, round.ids.length)
    for (const id of round.matched) shelfCards.append(shelfCard(id))
    const open = round.ids.filter((id) => !round.matched.includes(id))
    items = []
    // Pictures and words are shuffled independently; their order on the mat is random anyway.
    for (const id of shuffle([...open])) items.push(makeItem('p', id))
    for (const id of shuffle([...open])) items.push(makeItem('w', id))
    for (const it of shuffle([...items])) mat.append(it.el)
    layout(false)
  }

  /**
   * Size the cards for the mat, then place them: saved positions if the cards still lie apart
   * there (the mat may have another size than when they were saved), else fresh.
   */
  function layout(fresh: boolean) {
    const r = mat.getBoundingClientRect()
    if (!r.width || !r.height) return
    const n = Math.max(round.ids.length, 4)
    let pic = Math.round(Math.max(96, Math.min(210, Math.sqrt((0.3 * r.width * r.height) / (1.55 * n)))))
    screen.style.setProperty('--pic', `${pic}px`)
    // A card's solid edge (its first shadow) shows below it, so it counts to its height.
    const sizes = () => items.map((it) => ({ w: it.el.offsetWidth, h: it.el.offsetHeight + EDGE }))
    const saved = items.map((it) => round.pos[`${it.kind}:${it.id}`])
    if (!fresh && saved.every(Boolean)) {
      items.forEach((it, i) => setPos(it, saved[i][0] * r.width, saved[i][1] * r.height, false))
      const s = sizes()
      if (apart(items.map((it, i) => ({ x: it.el.offsetLeft, y: it.el.offsetTop, ...s[i] })))) return
    }
    const area = { w: r.width, h: r.height }
    let placed = place(sizes(), area)
    while (placed.scale < 1 && pic > 24) {
      // Too little room (a phone on its side): smaller cards, laid out again at their real size.
      pic = Math.min(pic - 1, Math.floor(pic * placed.scale))
      screen.style.setProperty('--pic', `${pic}px`)
      placed = place(sizes(), area)
    }
    items.forEach((it, i) => setPos(it, placed.points[i].x, placed.points[i].y))
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
      kind === 'p' ? h('div', 'item picture', pictureFace(word, profile.pictures)) : h('div', 'item word', word.word)
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

    // The pair forms around the picture, which stays where it is (where it lay, or where it was
    // dropped): the word glides over from where it is, and the card fades in around both.
    const [pic, wrd] = dragged.kind === 'p' ? [dragged, still] : [still, dragged]
    pic.el.style.pointerEvents = wrd.el.style.pointerEvents = 'none'
    sound.jingle()
    // Centres only: a card just let go still shrinks back from its lift, about its centre.
    const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    // A word's letters sit off its centre by half the difference of its top and bottom padding.
    const lift = (el: Element) => {
      const cs = getComputedStyle(el)
      return (parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / 2
    }
    const card = pairCard(word, profile.pictures, 'pair big')
    card.style.opacity = '0'
    fx.append(card)
    const cardPic = card.querySelector<HTMLElement>('.pair-pic')!
    const cardWord = card.querySelector<HTMLElement>('.pair-word')!
    const p = centre(pic.el.getBoundingClientRect()), q = centre(cardPic.getBoundingClientRect())
    const cw = card.offsetWidth, ch = card.offsetHeight
    const cx = Math.max(8, Math.min(innerWidth - cw - 8, p.x - q.x))
    const cy = Math.max(8, Math.min(innerHeight - ch - 8, p.y - q.y))
    card.style.left = `${cx}px`
    card.style.top = `${cy}px`
    const from = centre(wrd.el.getBoundingClientRect()), to = centre(cardWord.getBoundingClientRect())
    const dx = to.x - from.x
    const dy = to.y + lift(cardWord) - from.y - lift(wrd.el)
    // Above the other cards, the dropped one still on top: a word slides out from under a picture.
    still.el.style.zIndex = String(++z)
    dragged.el.style.zIndex = String(++z)
    wrd.el.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px)` }], {
      duration: ms(560), easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards',
    })
    const fade = { duration: ms(200), delay: ms(450), easing: 'ease-in-out', fill: 'forwards' } as const
    wrd.el.animate([{ opacity: 1 }, { opacity: 0 }], fade)
    await card.animate([{ opacity: 0 }, { opacity: 1 }], fade).finished
    card.style.opacity = ''
    pic.el.remove()
    wrd.el.remove()
    // From around the card's middle out past its edges, as big as the card is.
    const r = Math.hypot(cw, ch) / 2
    burst(fx, cx + cw / 2, cy + ch / 2, 24, ['#ffd84d', '#ffffff', '#ff9fb2', '#9fe3ff'], Math.max(1.6, r / 100), r * 0.4)
    star.set(round.matched.length, round.ids.length, true)
    void sound.sayWord(word.id, word.word)
    await wait(650)

    // It flies onto the shelf and takes on the shape of the shelf's card on the way.
    const slot = shelfCard(id)
    slot.style.visibility = 'hidden'
    shelfCards.append(slot)
    const at = slot.getBoundingClientRect()
    const flight = { duration: ms(650), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' } as const
    morph(card, slot, ['width', 'padding', 'borderRadius', 'boxShadow'], flight, { left: `${at.left}px`, top: `${at.top}px` })
    morph(cardPic, slot.querySelector('.pair-pic')!, ['width', 'height'], flight)
    morph(cardPic.firstElementChild as HTMLElement, slot.querySelector('.face')!, ['borderRadius', 'fontSize'], flight)
    await morph(cardWord, slot.querySelector('.pair-word')!, ['fontSize', 'lineHeight', 'letterSpacing', 'padding'], flight).finished
    slot.style.visibility = ''
    card.remove()
    if (done) await celebrate()
  }

  function shelfCard(id: string) {
    const word = wordById.get(id)!
    const card = pairCard(word, profile.pictures, 'pair small')
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
    celebrating = true
    const result: RoundResult = {}
    for (const id of round.ids) result[id] = outcome(round, id)
    recordRound(profile, result)
    void sync()
  }

  async function celebrate() {
    const from = star.svg.getBoundingClientRect()
    const big = fullStar(round.ids.length)
    big.classList.add('flying-star')
    fx.append(big)
    // The star is drawn at its size in the middle of the screen and scaled down from there:
    // scaled up, the browser would stretch the small star's pixels.
    const k = Math.min(innerWidth, innerHeight) / 2.4 / from.width
    const size = k * from.width
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2
    Object.assign(big.style, { left: `${x0 - size / 2}px`, top: `${y0 - size / 2}px`, width: `${size}px`, height: `${size}px` })
    big.style.setProperty('--k', String(k))
    star.set(0, round.ids.length)
    // The star scales and turns about its centre; these move that centre.
    const cx = innerWidth / 2, cy = innerHeight / 2.4
    const at = (x: number, y: number) => `translate(${x - x0}px, ${y - y0}px)`
    const glow = h('div', 'star-glow')
    const d = size * 2
    Object.assign(glow.style, { left: `${cx - d / 2}px`, top: `${cy - d / 2}px`, width: `${d}px`, height: `${d}px` })
    fx.prepend(glow)
    glow.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], { duration: ms(1100), easing: 'ease-out', fill: 'forwards' })
    sound.fanfare()
    await big.animate(
      [
        { transform: `translate(0,0) scale(${1 / k}) rotate(0)` },
        { transform: `${at(cx, cy)} scale(1) rotate(360deg)` },
      ],
      { duration: ms(1100), easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' },
    ).finished
    burst(fx, cx, cy, 36, ['#ffd84d', '#ffe98a', '#ffffff', '#f5a623'], 1.8)
    await wait(900)

    // Up to the jar's mouth while its lid lifts, then down into the glass.
    const c = jar.svg.getBoundingClientRect()
    const mouth = { x: c.left + c.width / 2, y: c.top + c.height * 0.12 }
    const end = (0.32 * c.width) / size
    const lid = jar.lid
    glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(500), fill: 'forwards' })
    lid.animate([{ transform: 'none' }, { transform: 'translate(-6px, -70px) rotate(-24deg)' }], {
      duration: ms(350), easing: 'ease-out', fill: 'forwards',
    })
    await big.animate(
      [
        { transform: `${at(cx, cy)} scale(1) rotate(360deg)` },
        { transform: `${at(mouth.x, mouth.y - c.height * 0.25)} scale(${end}) rotate(720deg)` },
      ],
      { duration: ms(800), easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' },
    ).finished
    await big.animate(
      [
        { transform: `${at(mouth.x, mouth.y - c.height * 0.25)} scale(${end}) rotate(720deg)` },
        { transform: `${at(mouth.x, mouth.y + c.height * 0.2)} scale(${end * 0.7}) rotate(720deg)`, opacity: 0 },
      ],
      { duration: ms(300), easing: 'ease-in', fill: 'forwards' },
    ).finished
    big.remove()
    glow.remove()
    lid.animate([{ transform: 'translate(-6px, -70px) rotate(-24deg)' }, { transform: 'none' }], {
      duration: ms(250), easing: 'cubic-bezier(.5,0,.6,1.4)', fill: 'forwards',
    })
    sound.clink()
    jar.set(profile.coins, true)
    count.textContent = String(profile.coins)
    celebrating = false
    jarBtn.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.2) rotate(-6deg)' }, { transform: 'scale(.96) rotate(4deg)' }, { transform: 'scale(1)' }],
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
  // Words are measured for the layout: in the fallback font they would come out narrower.
  const fontReady = document.fonts.load('1em Andika').catch(() => {})
  if (valid(profile.current)) {
    round = profile.current!
    void fontReady.then(() => requestAnimationFrame(build))
  } else {
    void fontReady.then(() => requestAnimationFrame(newRound))
  }
}

export function outcome(round: SavedRound, id: string): Outcome {
  if (round.wrong.includes(id)) return 'wrong'
  if (round.help.includes(id)) return 'help'
  if (round.forced === id) return 'forced'
  return 'right'
}

function pairCard(word: Word, style: string, cls: string) {
  return h('div', cls, h('div', 'pair-pic', pictureFace(word, style)), h('div', 'pair-word', word.word))
}

/** Animates the given CSS properties of an element from their values now to those of another element. */
function morph(el: HTMLElement, like: Element, props: string[], timing: KeyframeAnimationOptions, extra: Keyframe = {}) {
  const from = getComputedStyle(el), to = getComputedStyle(like)
  const css = (p: string) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  const a: Keyframe = {}, b: Keyframe = { ...extra }
  for (const p of props) {
    a[p] = from.getPropertyValue(css(p))
    b[p] = to.getPropertyValue(css(p))
  }
  for (const p of Object.keys(extra)) a[p] = from.getPropertyValue(css(p))
  return el.animate([a, b], timing)
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Little stars flying out from a point, or from a ring of radius `from` around it. */
function burst(layer: HTMLElement, x: number, y: number, n: number, colors: string[], spread = 1, from = 0) {
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
    const d = from + (90 + Math.random() * 90) * spread
    const move = (d: number) => `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px))`
    s.animate(
      [
        { transform: `${move(from)} scale(.3)`, opacity: 1 },
        { opacity: 1, offset: 0.5 },
        { transform: `${move(d)} scale(1) rotate(${Math.random() * 180}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 500 * spread, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    ).finished.then(() => s.remove())
  }
}

/** The jar opened: every star collected so far, as a constellation, with the number on its shoulder. */
export function showJar(screen: HTMLElement, stars: number) {
  const [glass, lid] = openJar(stars)
  const panel = h('div', 'jar-panel', glass, lid, h('div', 'jar-number', String(stars)))
  const overlay = h('div', 'overlay', panel)
  overlay.addEventListener('click', () => overlay.remove())
  screen.append(overlay)
  panel.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
    duration: ms(350), easing: 'cubic-bezier(.3,1.3,.5,1)',
  })
}
