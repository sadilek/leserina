// A lay round: one word at a time, its picture, an empty field per grapheme below it and a tile
// per grapheme scattered below that. The child drags each tile onto its field; a tile plays its
// sound as it lands, and one dropped on a wrong field springs back.
import wordList from '../words.json'
import { pictureFace } from './assets'
import { place, shuffle } from './layout'
import type { Word } from './scheduler'
import * as sound from './sound'
import type { Profile, SavedRound } from './store'

const words = wordList as Word[]
const wordById = new Map(words.map((w) => [w.id, w]))

export interface LayEnv {
  screen: HTMLElement
  mat: HTMLElement
  profile: Profile
  round: () => SavedRound
  commit: () => void
  /** Shortens a duration (ms) for reduced motion. */
  ms: (t: number) => number
  /** The word is laid: it joins its picture as a pair and goes to the shelf. Resolves true if
   * that was the round's last word. */
  pairUp: (word: Word, pic: HTMLElement, laid: HTMLElement) => Promise<boolean>
}

interface Tile {
  /** The grapheme it shows, by its index in the word. */
  k: number
  el: HTMLElement
  /** The field it lies in. */
  field: number | null
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: (Node | string)[]) {
  const e = document.createElement(tag)
  e.className = cls
  e.append(...children)
  return e
}

/** Height of a tile's solid edge in px: its first shadow in style.css. */
const EDGE = 4

/**
 * Whether a tile showing the word's k-th grapheme belongs in field j: the same letters fit, so
 * either a of "Mama" goes into either a's field.
 */
export function fits(word: Word, k: number, j: number) {
  return word.sounds[k][0] === word.sounds[j][0]
}

export function layMat(env: LayEnv) {
  const { mat } = env
  let word: Word | undefined
  let pic: HTMLElement
  let strip: HTMLElement
  let fields: HTMLElement[] = []
  let tiles: Tile[] = []
  let busy = false
  let z = 10

  /** The next word to lay, with its tiles shuffled below its fields. */
  function build() {
    const round = env.round()
    const id = round.ids.find((i) => !round.matched.includes(i))
    word = id ? wordById.get(id) : undefined
    if (!word) return
    const w = word
    busy = false
    pic = h('div', 'item picture lay-pic', pictureFace(w, env.profile.pictures))
    pic.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      sound.unlock()
      void sound.sayWord(w.id, w.word)
      bounce(pic)
    })
    fields = w.sounds.map(() => h('div', 'lay-field'))
    strip = h('div', 'lay-strip', ...fields)
    tiles = shuffle(w.sounds.map(([g], k) => ({ k, el: h('div', 'item tile', g), field: null })))
    for (const t of tiles) t.el.addEventListener('pointerdown', (e) => grab(t, e))
    mat.replaceChildren(pic, strip, ...tiles.map((t) => t.el))
    layout()
    for (const el of [pic, strip, ...tiles.map((t) => t.el)]) {
      el.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], {
        duration: env.ms(350), easing: 'cubic-bezier(.3,1.3,.5,1)',
      })
    }
  }

  /**
   * Sizes for the mat: the picture on top, the fields below it, the loose tiles in the rest. On a
   * mat too low for that (a phone on its side), the picture goes to the left of the others.
   */
  function layout() {
    const r = mat.getBoundingClientRect()
    if (!word || !r.width || !r.height) return
    const loose = tiles.filter((t) => t.field === null)
    const side = r.height < 320
    let size = side
      ? Math.max(70, Math.min(200, r.height * 0.7, r.width * 0.28))
      : Math.max(80, Math.min(230, r.height * 0.36, r.width * 0.42))
    let font = Math.min(size * 0.4, side ? r.height * 0.2 : Infinity)
    for (;;) {
      env.screen.style.setProperty('--pic', `${Math.round(size)}px`)
      mat.style.setProperty('--tile', `${font.toFixed(1)}px`)
      const picW = pic.offsetWidth, picH = pic.offsetHeight + EDGE
      const gapY = Math.max(10, r.height * 0.04)
      // The region of the fields and loose tiles.
      const x0 = side ? picW + gapY * 2 : 0
      const y0 = side ? gapY : picH + gapY
      const width = r.width - x0
      // A field is as wide as its tile; every tile is as tall as the tallest.
      const widths = word.sounds.map((_, k) => tiles.find((t) => t.k === k)!.el.offsetWidth)
      const gap = font * 0.16
      const row = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)
      if (row > width * 0.96 && font > 14) {
        // A little below the width's share, so that rounding cannot keep the row a pixel too wide.
        font = Math.max(14, (font * (width * 0.96)) / row - 0.5)
        continue
      }
      const tileH = tiles[0].el.offsetHeight + EDGE
      fields.forEach((f, k) => {
        f.style.width = `${widths[k]}px`
        f.style.height = `${tileH - EDGE}px`
      })
      pic.style.left = side ? '0px' : `${(r.width - picW) / 2}px`
      pic.style.top = side ? `${(r.height - picH) / 2}px` : '0px'
      strip.style.left = `${x0 + (width - row) / 2}px`
      strip.style.top = `${y0}px`
      const top = y0 + tileH + gapY * 1.5
      const area = { w: width, h: r.height - top }
      const placed = place(loose.map((t) => ({ w: t.el.offsetWidth, h: t.el.offsetHeight + EDGE })), area, Math.random, font * 0.6)
      if ((placed.scale < 1 || area.h < tileH) && size > 60) {
        // Too little room for the loose tiles: a smaller picture, and smaller tiles.
        size *= 0.85
        font = Math.min(font * 0.92, size * 0.4)
        continue
      }
      loose.forEach((t, i) => {
        t.el.style.left = `${x0 + placed.points[i].x}px`
        t.el.style.top = `${top + placed.points[i].y}px`
      })
      return
    }
  }

  function grab(t: Tile, e: PointerEvent) {
    const w = word
    if (!w || busy) return
    e.preventDefault()
    sound.unlock()
    if (t.field !== null) {
      // A tile in its field only plays its sound again.
      void sound.playTile(w, t.field)
      return bounce(t.el)
    }
    const el = t.el
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX, startY = e.clientY
    const left = el.offsetLeft, top = el.offsetTop
    let dragging = false
    let over: HTMLElement | null = null
    const hover = (f: HTMLElement | null) => {
      over?.classList.remove('over')
      over = f
      over?.classList.add('over')
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dx = ev.clientX - startX, dy = ev.clientY - startY
      if (!dragging && Math.hypot(dx, dy) > 10) {
        dragging = true
        el.classList.add('dragging')
        el.style.zIndex = String(++z)
      }
      if (!dragging) return
      const m = mat.getBoundingClientRect()
      el.style.left = `${Math.max(0, Math.min(left + dx, m.width - el.offsetWidth))}px`
      el.style.top = `${Math.max(0, Math.min(top + dy, m.height - el.offsetHeight))}px`
      const j = target(el, ev)
      hover(j === null ? null : fields[j])
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.classList.remove('dragging')
      hover(null)
      if (!dragging) {
        void sound.playTile(w, t.k)
        return bounce(el)
      }
      if (ev.type === 'pointercancel') return springBack(el, left, top)
      drop(t, ev, left, top)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  /** The field under the finger, or else the one the tile covers most. */
  function target(el: HTMLElement, ev: PointerEvent): number | null {
    const under = fields.findIndex((f) => {
      const r = f.getBoundingClientRect()
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
    })
    if (under >= 0) return under
    const a = el.getBoundingClientRect()
    let best: number | null = null, bestArea = 0
    fields.forEach((f, j) => {
      const b = f.getBoundingClientRect()
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      const area = w > 0 && hh > 0 ? w * hh : 0
      if (area > bestArea && area > 0.3 * a.width * a.height) {
        best = j
        bestArea = area
      }
    })
    return best
  }

  function drop(t: Tile, ev: PointerEvent, left: number, top: number) {
    const w = word!
    const j = target(t.el, ev)
    // Dropped beside the fields: it stays where it was let go.
    if (j === null) return
    const taken = tiles.some((o) => o.field === j)
    if (fits(w, t.k, j) && !taken) return land(t, j)
    if (!fits(w, t.k, j)) {
      const round = env.round()
      if (!round.wrong.includes(w.id)) round.wrong.push(w.id)
      env.commit()
    }
    springBack(t.el, left, top)
  }

  /** The tile goes into its field and plays the sound it has there. */
  function land(t: Tile, j: number) {
    const w = word!
    t.field = j
    void sound.playTile(w, j)
    const from = t.el.getBoundingClientRect()
    t.el.style.left = t.el.style.top = t.el.style.zIndex = ''
    fields[j].append(t.el)
    fields[j].classList.add('filled')
    const to = t.el.getBoundingClientRect()
    t.el.animate(
      [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.07)` }, { transform: 'none' }],
      { duration: env.ms(220), easing: 'cubic-bezier(.3,1.2,.5,1)' },
    )
    if (tiles.every((o) => o.field !== null)) void laid(w)
  }

  async function laid(w: Word) {
    busy = true
    await new Promise((r) => setTimeout(r, env.ms(450)))
    strip.classList.add('laid')
    if (!(await env.pairUp(w, pic, strip))) build()
  }

  function springBack(el: HTMLElement, left: number, top: number) {
    const from = { x: el.offsetLeft, y: el.offsetTop }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.animate(
      [{ transform: `translate(${from.x - left}px, ${from.y - top}px)` }, { transform: 'translate(0, 0)' }],
      { duration: env.ms(520), easing: 'cubic-bezier(.34,1.45,.55,1)' },
    )
  }

  function bounce(el: HTMLElement) {
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], {
      duration: env.ms(260),
    })
  }

  return { build, layout }
}
