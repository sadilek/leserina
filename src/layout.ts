// Random, non-overlapping placement of the cards in the play area (rejection sampling).

export interface Size {
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

const overlaps = (a: Point & Size, b: Point & Size, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/**
 * Top-left corners for boxes of the given sizes inside area, none overlapping.
 * Tries with a generous gap first and shrinks it if the boxes do not fit; as a last resort the
 * boxes go into a grid, so the result never overlaps as long as they fit side by side at all.
 */
export function place(sizes: Size[], area: Size, rand: () => number = Math.random, gap = 24): Point[] {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].w * sizes[b].h - sizes[a].w * sizes[a].h)
  for (const g of [gap, gap / 2, 4]) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const placed: (Point & Size)[] = []
      const out: Point[] = new Array(sizes.length)
      let ok = true
      for (const i of order) {
        const s = sizes[i]
        let found: (Point & Size) | null = null
        for (let k = 0; k < 300 && !found; k++) {
          const c = { x: rand() * Math.max(0, area.w - s.w), y: rand() * Math.max(0, area.h - s.h), ...s }
          if (!placed.some((p) => overlaps(p, c, g))) found = c
        }
        if (!found) {
          ok = false
          break
        }
        placed.push(found)
        out[i] = { x: found.x, y: found.y }
      }
      if (ok) return out
    }
  }
  return grid(sizes, area)
}

function grid(sizes: Size[], area: Size): Point[] {
  const cols = Math.ceil(Math.sqrt(sizes.length * (area.w / area.h)))
  const rows = Math.ceil(sizes.length / cols)
  const cw = area.w / cols, ch = area.h / rows
  return sizes.map((s, i) => ({
    x: (i % cols) * cw + Math.max(0, (cw - s.w) / 2),
    y: Math.floor(i / cols) * ch + Math.max(0, (ch - s.h) / 2),
  }))
}
