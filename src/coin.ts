// The gold coin: an outline at the start of a round, filled slice by slice like a pie.

const NS = 'http://www.w3.org/2000/svg'
const R = 44

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

function slicePath(i: number, n: number, r = R) {
  const a0 = -Math.PI / 2 + (i / n) * 2 * Math.PI
  const a1 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI
  const p = (a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`
  return `M0 0 L${p(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`
}

const STAR = 'M0 -22 L6.5 -7 L22 -6.8 L10 3.5 L13.6 19 L0 10.6 L-13.6 19 L-10 3.5 L-22 -6.8 L-6.5 -7 Z'

/** A finished coin, for the celebration and the chest. */
export function fullCoin(): SVGSVGElement {
  const svg = el('svg', { viewBox: '-50 -50 100 100', class: 'coin full' })
  svg.append(
    el('circle', { r: R + 2, fill: '#e0a91f', stroke: '#9c7012', 'stroke-width': 3 }),
    el('circle', { r: R - 6, fill: '#f7cd4a', stroke: '#c8961c', 'stroke-width': 2.5 }),
    el('path', { d: STAR, fill: '#fff0b0', stroke: '#b8851a', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M-30 -22 A36 36 0 0 1 -6 -36', fill: 'none', stroke: '#fff7d6', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8 }),
  )
  return svg
}

export class Coin {
  readonly svg: SVGSVGElement
  private slices: SVGGElement

  constructor() {
    this.svg = el('svg', { viewBox: '-50 -50 100 100', class: 'coin' })
    this.slices = el('g', {})
    this.svg.append(
      el('circle', { r: R, fill: 'rgba(255,255,255,0.10)', stroke: '#f2c94c', 'stroke-width': 3, 'stroke-dasharray': '6 5' }),
      this.slices,
    )
  }

  /** Show `filled` of `total` slices; the newest one grows in when `animate` is set. */
  set(filled: number, total: number, animate = false) {
    this.slices.replaceChildren()
    for (let i = 0; i < filled; i++) {
      const d = total === 1 ? `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z` : slicePath(i, total)
      const path = el('path', { d, fill: '#f5c542', stroke: '#b8891a', 'stroke-width': 2, 'stroke-linejoin': 'round' })
      this.slices.append(path)
      if (animate && i === filled - 1) {
        path.animate(
          [{ transform: 'scale(0.2)', opacity: 0.2 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)' }],
          { duration: 450, easing: 'cubic-bezier(.3,1.4,.5,1)' },
        )
      }
    }
  }
}

/** The treasure chest, drawn as a small wooden box with gold bands. */
export function chestSvg(): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 120 100', class: 'chest-svg' })
  const lid = el('g', { class: 'lid' })
  lid.append(
    el('path', { d: 'M10 44 L10 30 Q10 8 60 8 Q110 8 110 30 L110 44 Z', fill: '#a8642e', stroke: '#5e3416', 'stroke-width': 4, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M24 44 L24 14 M96 44 L96 14', stroke: '#e8b83a', 'stroke-width': 7 }),
  )
  svg.append(
    el('rect', { x: 10, y: 44, width: 100, height: 48, rx: 5, fill: '#8f5122', stroke: '#5e3416', 'stroke-width': 4 }),
    el('path', { d: 'M24 44 L24 92 M96 44 L96 92', stroke: '#e8b83a', 'stroke-width': 7 }),
    lid,
    el('rect', { x: 50, y: 38, width: 20, height: 22, rx: 3, fill: '#f2c94c', stroke: '#8a6210', 'stroke-width': 3 }),
    el('circle', { cx: 60, cy: 48, r: 3, fill: '#5e3416' }),
  )
  return svg
}

/** The chest opened, in two layers so a pile of coins can sit between its back and its front. */
export function openChestSvgs(): [SVGSVGElement, SVGSVGElement] {
  const back = el('svg', { viewBox: '0 0 120 100', class: 'chest-back' })
  back.append(
    el('path', { d: 'M14 46 L8 6 Q60 -6 112 6 L106 46 Z', fill: '#a8642e', stroke: '#5e3416', 'stroke-width': 4, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M26 46 L22 4 M94 46 L98 4', stroke: '#e8b83a', 'stroke-width': 6 }),
    el('rect', { x: 12, y: 38, width: 96, height: 14, rx: 4, fill: '#3b200c' }),
  )
  const front = el('svg', { viewBox: '0 0 120 100', class: 'chest-front' })
  front.append(
    el('rect', { x: 10, y: 44, width: 100, height: 48, rx: 5, fill: '#8f5122', stroke: '#5e3416', 'stroke-width': 4 }),
    el('path', { d: 'M24 44 L24 92 M96 44 L96 92', stroke: '#e8b83a', 'stroke-width': 7 }),
    el('rect', { x: 50, y: 40, width: 20, height: 22, rx: 3, fill: '#f2c94c', stroke: '#8a6210', 'stroke-width': 3 }),
    el('circle', { cx: 60, cy: 50, r: 3, fill: '#5e3416' }),
  )
  return [back, front]
}
