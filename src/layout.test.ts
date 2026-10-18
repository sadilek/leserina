import { describe, expect, it } from 'vitest'
import { place } from './layout'

function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}

describe('place', () => {
  const area = { w: 1100, h: 560 }
  const sizes = [
    ...Array.from({ length: 6 }, () => ({ w: 160, h: 160 })),
    ...[180, 220, 140, 300, 200, 160].map((w) => ({ w, h: 80 })),
  ]

  it('keeps every box inside the area and apart from the others', () => {
    for (let seed = 1; seed < 50; seed++) {
      const pts = place(sizes, area, rng(seed))
      pts.forEach((p, i) => {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.x + sizes[i].w).toBeLessThanOrEqual(area.w)
        expect(p.y + sizes[i].h).toBeLessThanOrEqual(area.h)
        pts.forEach((q, j) => {
          if (i >= j) return
          const apart =
            p.x + sizes[i].w <= q.x || q.x + sizes[j].w <= p.x ||
            p.y + sizes[i].h <= q.y || q.y + sizes[j].h <= p.y
          expect(apart).toBe(true)
        })
      })
    }
  })

  it('falls back to a grid when boxes barely fit', () => {
    const big = Array.from({ length: 8 }, () => ({ w: 270, h: 270 }))
    const pts = place(big, area, rng(3))
    expect(pts).toHaveLength(8)
  })
})
