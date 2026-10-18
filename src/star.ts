// The star and the jar of night sky. A round's star has one arm per pair, outlined at the start
// and filled arm by arm; a full star goes into the jar, where the collected stars form a
// constellation that fills the glass from the bottom up.

const NS = 'http://www.w3.org/2000/svg'
const R = 46

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

const f = (n: number) => n.toFixed(1)

/** Gradients shared by every star and jar, defined once in the document. */
function ensureDefs() {
  if (document.getElementById('ls-defs')) return
  const svg = el('svg', { id: 'ls-defs', width: 0, height: 0, 'aria-hidden': 'true' })
  svg.style.position = 'absolute'
  svg.innerHTML = `<defs>
    <linearGradient id="ls-gold" gradientUnits="userSpaceOnUse" x1="-30" y1="-48" x2="30" y2="48">
      <stop offset="0" stop-color="#fff0a8"/><stop offset=".45" stop-color="#ffd347"/><stop offset="1" stop-color="#f5a21b"/></linearGradient>
    <linearGradient id="ls-gold-b" x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#ffd347"/><stop offset="1" stop-color="#f3a01c"/></linearGradient>
    <radialGradient id="ls-halo"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".9"/>
      <stop offset=".45" stop-color="#ffd76a" stop-opacity=".35"/><stop offset="1" stop-color="#ffd76a" stop-opacity="0"/></radialGradient>
    <linearGradient id="ls-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f7fb"/><stop offset=".5" stop-color="#b9c3d2"/><stop offset="1" stop-color="#8590a6"/></linearGradient>
    <radialGradient id="ls-night" cx=".45" cy=".5" r=".7">
      <stop offset="0" stop-color="#34479e"/><stop offset=".7" stop-color="#22266b"/><stop offset="1" stop-color="#1c1650"/></radialGradient>
  </defs>`
  document.body.append(svg)
}

/** Points of an `arms`-armed star around the origin, tip up: tips at even, notches at odd indices. */
function starPoints(arms: number, r = R) {
  const inner = r * (arms <= 4 ? 0.42 : arms === 5 ? 0.46 : 0.44)
  const pts: [number, number][] = []
  for (let i = 0; i < 2 * arms; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / arms
    const d = i % 2 ? inner : r
    pts.push([d * Math.cos(a), d * Math.sin(a)])
  }
  return pts
}

/** A viewBox that centres the star's outline, which for an odd number of arms sits off the origin. */
function starViewBox(arms: number) {
  const bottom = Math.max(...starPoints(arms).map((p) => p[1]))
  const shift = (R - bottom) / 2
  return `-50 ${f(-50 - shift)} 100 100`
}

const poly = (pts: [number, number][]) => pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')

export class Star {
  readonly svg: SVGSVGElement
  private arms = 0
  private layer: SVGGElement

  constructor() {
    ensureDefs()
    this.svg = el('svg', { class: 'star' })
    this.layer = el('g', {})
    this.svg.append(this.layer)
  }

  /** Show `filled` of `total` arms; the newest one grows in when `animate` is set. */
  set(filled: number, total: number, animate = false) {
    total = Math.max(3, total)
    if (total !== this.arms) {
      this.arms = total
      this.svg.setAttribute('viewBox', starViewBox(total))
    }
    const pts = starPoints(total)
    const notch = (k: number) => pts[(2 * k + 2 * total - 1) % (2 * total)]
    this.layer.replaceChildren(
      el('polygon', {
        points: poly(pts), fill: 'rgba(255,255,255,.13)', stroke: '#ffe39a', 'stroke-opacity': 0.75,
        'stroke-width': 3.2, 'stroke-linejoin': 'round',
      }),
    )
    const arm = (k: number) => poly([[0, 0], notch(k), pts[2 * k], notch(k + 1)])
    for (let k = filled; k < total; k++) {
      this.layer.append(el('polygon', {
        points: arm(k), fill: 'none', stroke: '#ffe39a', 'stroke-opacity': 0.62, 'stroke-width': 1.8,
        'stroke-dasharray': '3 3', 'stroke-linejoin': 'round',
      }))
    }
    for (let k = 0; k < filled; k++) {
      const g = el('g', {})
      const [tx, ty] = pts[2 * k]
      g.append(
        el('polygon', { points: arm(k), fill: 'url(#ls-gold)', stroke: 'url(#ls-gold)', 'stroke-width': 3.2, 'stroke-linejoin': 'round' }),
        // The seams between arms, and a glint along the arm.
        el('line', { x1: 0, y1: 0, x2: f(notch(k)[0]), y2: f(notch(k)[1]), stroke: '#b86a10', 'stroke-opacity': 0.55, 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
        el('line', { x1: f(tx * 0.41), y1: f(ty * 0.41), x2: f(tx * 0.78), y2: f(ty * 0.78), stroke: '#fff6d0', 'stroke-opacity': 0.7, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
      )
      this.layer.append(g)
      if (animate && k === filled - 1) {
        g.animate(
          [{ transform: 'scale(0.2)', opacity: 0.2 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }],
          { duration: 450, easing: 'cubic-bezier(.3,1.4,.5,1)' },
        )
      }
    }
  }
}

/** A finished star, for the celebration. */
export function fullStar(arms: number): SVGSVGElement {
  const star = new Star()
  star.set(arms, arms)
  star.svg.classList.add('full')
  return star.svg
}

// ---------- The jar ----------

const JAR = 'M95 52 h130 v12 q72 20 72 92 v146 q0 46 -46 46 h-182 q-46 0 -46 -46 v-146 q0 -72 72 -92 z'
const JAR_TOP = 118
const JAR_BOTTOM = 322

/** Room for a star's centre inside the glass: below the shoulders, clear of the walls. */
export function insideJar(x: number, y: number) {
  if (y < JAR_TOP || y > JAR_BOTTOM || x < 54 || x > 266) return false
  // The shoulders curve in towards the neck.
  const half = y >= 170 ? 106 : 70 + ((y - JAR_TOP) / (170 - JAR_TOP)) * 36
  return Math.abs(x - 160) <= half
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Spot {
  x: number
  y: number
  /** Index of the earlier star this one is joined to in the constellation, or -1. */
  link: number
  /** Tilt in degrees, so the stars don't all stand to attention. */
  tilt: number
}

/**
 * Where the stars sit in a jar that holds `cap`: each new star goes as far from the others as it
 * can within a band that rises from the bottom as the jar fills, and joins the nearest one. Star
 * `i` sits at the same place whatever comes after it, so a new star never moves the old ones.
 */
export function jarSpots(cap: number, seed = 7): Spot[] {
  const rnd = mulberry(seed)
  const spots: Spot[] = []
  for (let i = 0; i < cap; i++) {
    const level = Math.min(1, 0.4 + i / (0.75 * cap))
    const top = JAR_BOTTOM - level * (JAR_BOTTOM - JAR_TOP)
    let best: [number, number] = [160, JAR_BOTTOM - 20]
    let bestD = -1
    for (let tries = 0, found = 0; tries < 400 && found < 24; tries++) {
      const x = 54 + rnd() * 212, y = top + rnd() * (JAR_BOTTOM - top)
      if (!insideJar(x, y)) continue
      found++
      const d = spots.reduce((m, s) => Math.min(m, Math.hypot(s.x - x, s.y - y)), Infinity)
      if (d > bestD) [best, bestD] = [[x, y], d]
    }
    let link = -1
    let near = Infinity
    spots.forEach((s, j) => {
      const d = Math.hypot(s.x - best[0], s.y - best[1])
      if (d < near) [link, near] = [j, d]
    })
    spots.push({ x: best[0], y: best[1], link, tilt: Math.round((rnd() - 0.5) * 40) })
  }
  return spots
}

/** The small jar in the bar holds this many stars; the big one shows up to BIG_CAP. */
const SMALL_CAP = 12
const BIG_CAP = 50
const smallSpots = jarSpots(SMALL_CAP, 3)
const bigSpots = jarSpots(BIG_CAP)

function dust(g: SVGGElement) {
  const rnd = mulberry(11)
  for (let i = 0; i < 46; i++) {
    const x = 40 + rnd() * 240, y = 90 + rnd() * 250
    if (!insideJar(x, y) && rnd() < 0.7) continue
    g.append(el('circle', { cx: f(x), cy: f(y), r: [0.8, 1, 1.3][i % 3], fill: '#fff', opacity: f(0.3 + rnd() * 0.45) }))
  }
}

function jarStar(s: Spot, r: number, halo: number, cls = '') {
  const g = el('g', { class: `jar-star ${cls}`, transform: `translate(${f(s.x)} ${f(s.y)}) rotate(${s.tilt})` })
  if (halo) g.append(el('circle', { r: f(r * halo), fill: 'url(#ls-halo)', opacity: halo > 1.6 ? 1 : 0.55 }))
  g.append(el('polygon', {
    points: poly(starPoints(5, r)), fill: 'url(#ls-gold-b)', stroke: 'url(#ls-gold-b)',
    'stroke-width': f(r / 6.5), 'stroke-linejoin': 'round',
  }))
  return g
}

/** The glass, with `stars` collected; `big` adds the constellation's lines and leaves the jar open. */
function jarSvg(stars: number, big: boolean): SVGSVGElement {
  ensureDefs()
  const svg = el('svg', { viewBox: big ? '0 30 320 330' : '0 6 320 354', class: big ? 'jar-big' : 'jar-svg' })
  const sky = el('g', {})
  sky.append(el('path', { d: JAR, fill: 'url(#ls-night)' }))
  dust(sky)
  const field = el('g', { class: 'field' })
  sky.append(field)
  svg.append(sky)
  fillJar(svg, stars, big)
  svg.append(
    el('path', { d: JAR, fill: 'none', stroke: '#dff0ff', 'stroke-width': big ? 6 : 9, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M44 150 q4 -40 40 -62', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.55, 'stroke-width': big ? 9 : 13, 'stroke-linecap': 'round' }),
    el('path', { d: 'M38 180 v90', stroke: '#fff', 'stroke-opacity': 0.28, 'stroke-width': big ? 9 : 13, 'stroke-linecap': 'round' }),
    el('path', { d: 'M280 200 v70', stroke: '#fff', 'stroke-opacity': 0.18, 'stroke-width': 6, 'stroke-linecap': 'round' }),
  )
  if (big) {
    svg.append(el('ellipse', { cx: 160, cy: 50, rx: 68, ry: 11, fill: '#0d1238', stroke: '#e6f3ff', 'stroke-width': 5 }))
  } else {
    const lid = el('g', { class: 'lid' })
    lid.append(lidShape(80, 12))
    svg.append(lid)
  }
  return svg
}

/** The screw lid, 160 wide and 48 high, with its top-left corner at (x, y). */
function lidShape(x: number, y: number) {
  const g = el('g', { transform: `translate(${x} ${y})` })
  const ridges = Array.from({ length: 8 }, (_, i) => `M${19 + i * 16} 8 v32`).join(' ')
  g.append(
    el('rect', { x: 0, y: 0, width: 160, height: 48, rx: 14, fill: 'url(#ls-metal)', stroke: '#6d7891', 'stroke-width': 4 }),
    el('path', { d: ridges, stroke: '#6d7891', 'stroke-opacity': 0.45, 'stroke-width': 4, 'stroke-linecap': 'round' }),
    el('rect', { x: 7, y: 5, width: 146, height: 7, rx: 3.5, fill: '#fff', opacity: 0.6 }),
  )
  return g
}

/** Put `stars` stars into a jar drawn by jarSvg; the newest one glows when `fresh` is set. */
function fillJar(svg: SVGSVGElement, stars: number, big: boolean, fresh = false) {
  const field = svg.querySelector<SVGGElement>('.field')!
  const spots = big ? bigSpots : smallSpots
  const n = Math.min(stars, spots.length)
  field.replaceChildren()
  if (big) {
    const lines = el('g', { stroke: '#bfe4ff', 'stroke-opacity': 0.55, 'stroke-width': 2, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round' })
    for (let i = 1; i < n; i++) {
      const a = spots[i], b = spots[a.link]
      lines.append(el('line', { x1: f(a.x), y1: f(a.y), x2: f(b.x), y2: f(b.y) }))
    }
    field.append(lines)
  }
  // Fewer stars are drawn larger; a jar near full makes room by shrinking them all a little.
  const r = big ? Math.max(10, Math.min(22, 22 - (n - 8) * 0.3)) : 27
  for (let i = 0; i < n; i++) {
    const newest = i === n - 1 && n === stars && (big || fresh)
    field.append(jarStar(spots[i], newest && big ? r * 1.3 : r, big ? (newest ? 2 : 1.15) : 0, newest ? 'newest' : ''))
  }
}

/** The closed jar in the bar. */
export class Jar {
  readonly svg: SVGSVGElement

  constructor(stars: number) {
    this.svg = jarSvg(stars, false)
  }

  /** Show `stars` stars; the newest one twinkles in. */
  set(stars: number, animate = false) {
    fillJar(this.svg, stars, false, animate)
    const star = this.svg.querySelector<SVGGElement>('.jar-star.newest polygon')
    if (animate && star && stars <= SMALL_CAP) {
      star.animate(
        [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }],
        { duration: 600, easing: 'ease-out' },
      )
    }
  }

  get lid() {
    return this.svg.querySelector<SVGGElement>('.lid')!
  }
}

/** The jar opened, its lid beside it, with every star collected so far. */
export function openJar(stars: number): [SVGSVGElement, SVGSVGElement] {
  const glass = jarSvg(stars, true)
  ensureDefs()
  const lid = el('svg', { viewBox: '-4 -4 168 56', class: 'jar-lid' })
  lid.append(lidShape(0, 0))
  return [glass, lid]
}
