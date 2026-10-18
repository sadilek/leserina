import { describe, expect, it } from 'vitest'
import { insideJar, jarSpots } from './star'

describe('jarSpots', () => {
  const spots = jarSpots(50)

  it('puts every star inside the glass, apart from the others', () => {
    for (const s of spots) expect(insideJar(s.x, s.y)).toBe(true)
    let closest = Infinity
    spots.forEach((a, i) => spots.slice(i + 1).forEach((b) => (closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y)))))
    expect(closest).toBeGreaterThan(18)
  })

  it('puts the stars in the same places every time the app starts', () => {
    expect(jarSpots(50)).toEqual(spots)
  })

  it('joins each star to one that came before it', () => {
    expect(spots[0].link).toBe(-1)
    spots.slice(1).forEach((s, i) => expect(s.link).toBeLessThanOrEqual(i))
  })

  it('fills the jar from the bottom up', () => {
    const meanY = (a: typeof spots) => a.reduce((t, s) => t + s.y, 0) / a.length
    expect(meanY(spots.slice(0, 10))).toBeGreaterThan(meanY(spots.slice(40)))
  })
})
