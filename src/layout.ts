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

/** True if no two boxes overlap or come closer than gap. */
export function apart(boxes: (Point & Size)[], gap = 0) {
  return boxes.every((a, i) => boxes.every((b, j) => j <= i || !overlaps(a, b, gap)))
}

export interface Placement {
  points: Point[]
  /** 1 if the boxes fit as they are; below 1 if they fit only scaled down by this factor. */
  scale: number
}

/**
 * Top-left corners for boxes of the given sizes inside area, none overlapping.
 * Tries with a generous gap first and shrinks it if the boxes do not fit; as a last resort the
 * boxes go into tidy rows, scaled down as far as needed: then the points are for the scaled boxes.
 */
export function place(sizes: Size[], area: Size, rand: () => number = Math.random, gap = 24): Placement {
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
      if (ok) return { points: out, scale: 1 }
    }
  }
  return rows(sizes, area, 8)
}

/** Rows of boxes in the given order, as many to a row as fit, spread evenly over the area. */
function rows(sizes: Size[], area: Size, gap: number): Placement {
  const split = (k: number) => {
    const lines: number[][] = []
    let line: number[] = [], width = 0
    sizes.forEach((s, i) => {
      if (line.length && width + gap + s.w * k > area.w) {
        lines.push(line)
        line = []
        width = 0
      }
      width += (line.length ? gap : 0) + s.w * k
      line.push(i)
    })
    if (line.length) lines.push(line)
    return lines
  }
  const height = (k: number) => {
    const lines = split(k)
    return lines.reduce((sum, line) => sum + Math.max(...line.map((i) => sizes[i].h * k)), 0) + gap * (lines.length - 1)
  }
  const widest = (k: number) => Math.max(...sizes.map((s) => s.w * k))
  // The largest scale (to 1%) at which every box fits in width and the rows fit in height.
  let k = 1
  while (k > 0.01 && (widest(k) > area.w || height(k) > area.h)) k = Math.round((k - 0.01) * 100) / 100
  const lines = split(k)
  const heights = lines.map((line) => Math.max(...line.map((i) => sizes[i].h * k)))
  const vgap = (area.h - heights.reduce((a, b) => a + b, 0)) / (lines.length + 1)
  const out: Point[] = new Array(sizes.length)
  let y = vgap
  lines.forEach((line, r) => {
    const used = line.reduce((sum, i) => sum + sizes[i].w * k, 0)
    const hgap = (area.w - used) / (line.length + 1)
    let x = hgap
    for (const i of line) {
      out[i] = { x, y: y + (heights[r] - sizes[i].h * k) / 2 }
      x += sizes[i].w * k + hgap
    }
    y += heights[r] + vgap
  })
  return { points: out, scale: k }
}
