import { describe, expect, it } from 'vitest'
import { apart, place, type Size } from './layout'

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}

/** Every box, scaled by the placement's factor, lies inside the area and apart from the others. */
function expectApart(sizes: Size[], area: Size, seed: number) {
  const { points, scale } = place(sizes, area, rng(seed))
  expect(points).toHaveLength(sizes.length)
  const boxes = sizes.map((s, i) => ({ ...points[i], w: s.w * scale, h: s.h * scale }))
  boxes.forEach((p, i) => {
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.x + p.w).toBeLessThanOrEqual(area.w + 1e-6)
    expect(p.y + p.h).toBeLessThanOrEqual(area.h + 1e-6)
    boxes.forEach((q, j) => {
      if (i >= j) return
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
      expect(apart).toBe(true)
    })
  })
  return scale
}

/** Six pictures and six words as the game sizes them for a card edge of pic pixels. */
const round = (pic: number) => [
  ...Array.from({ length: 6 }, () => ({ w: pic, h: pic })),
  ...[3, 5, 2, 13, 6, 8].map((letters) => ({ w: pic * (0.32 + 0.16 * letters), h: pic * 0.48 })),
]

describe('place', () => {
  it('keeps every box inside the area and apart from the others', () => {
    const area = { w: 1100, h: 560 }
    for (let seed = 1; seed < 50; seed++) expect(expectApart(round(160), area, seed)).toBe(1)
  })

  it('scales the boxes down into rows when they do not fit at all', () => {
    const area = { w: 1100, h: 560 }
    const big = Array.from({ length: 8 }, () => ({ w: 270, h: 270 }))
    const scale = expectApart(big, area, 3)
    expect(scale).toBeLessThan(1)
    expect(scale).toBeGreaterThan(0.8)
  })

  it('fits a round of 6 pairs on a phone in landscape', () => {
    // Pixel, 915×412 CSS px, with the small top bar and shelf: the mat is about 880×260.
    const area = { w: 880, h: 260 }
    for (let seed = 1; seed < 30; seed++) expectApart(round(96), area, seed)
    // Even cards far too big for it end up apart, just smaller.
    for (let seed = 1; seed < 5; seed++) expect(expectApart(round(180), area, seed)).toBeLessThan(1)
  })
})

describe('apart', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }
  it('lets boxes touch but not overlap', () => {
    expect(apart([a, { x: 100, y: 0, w: 100, h: 50 }, { x: 0, y: 50, w: 100, h: 50 }])).toBe(true)
    expect(apart([a, { x: 60, y: 45, w: 100, h: 100 }])).toBe(false)
  })

  it('keeps the gap if asked to', () => {
    expect(apart([a, { x: 110, y: 0, w: 10, h: 10 }], 8)).toBe(true)
    expect(apart([a, { x: 105, y: 0, w: 10, h: 10 }], 8)).toBe(false)
  })
})
