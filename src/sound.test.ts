import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import type { Word } from './scheduler'
import { litAt, stretch, tileCut } from './sound'
import stretched from './stretched.json'
import tiles from './tiles.json'

const words = wordList as Word[]
const times = stretched as Record<string, { graphemes: string; text: string; marks: number[] }>
// The sound codes of scripts/phonics.py.
const CODES = new Set([
  ...'aeiouäöü', ...[...'aeiouäöü'].map((v) => `${v}:`), 'au', 'ei', 'eu', 'ə', 'ɐ',
  ...'bdgptkmnlrfwhjsz', 'sch', 'ch', 'x', 'ng', 'ts', 'pf', 'ks', 'kw',
])

describe('sounds of the words', () => {
  it('spell each word, grapheme by grapheme, with known sounds', () => {
    for (const w of words) {
      expect(w.sounds.map(([g]) => g).join(''), w.id).toBe(w.word)
      for (const [g, code] of w.sounds) {
        expect(g, w.id).not.toBe('')
        expect(CODES.has(code), `${w.id}: ${code}`).toBe(true)
      }
    }
  })

  it('end words in a spoken t where they are written with d, and keep their sounds apart', () => {
    const show = (id: string) => words.find((w) => w.id === id)!.sounds.map(([g, c]) => (g.toLowerCase() === c ? g : `${g}=${c}`)).join('|')
    expect(show('hund')).toBe('H|u|n|d=t')
    expect(show('maus')).toBe('M|au|s')
    expect(show('hase')).toBe('H|a=a:|s=z|e=ə')
    expect(show('schaf')).toBe('Sch|a=a:|f')
    expect(show('stern')).toBe('S=sch|t|e|r|n')
    expect(show('tiger')).toBe('T|i=i:|g|er=ɐ')
  })
})

describe('stretched clips', () => {
  it('exist for every word, rendered for the graphemes it has now', () => {
    // A failure here means: run scripts/render_stretched.py (see its docstring).
    for (const w of words) {
      const s = times[w.id]
      expect(s, w.id).toBeDefined()
      expect(s.graphemes, w.id).toBe(w.sounds.map(([g]) => g).join('|'))
      // Also needs audio/stretched/<id>.mp3.
      expect(stretch(w), w.id).toBeDefined()
    }
  })

  it('light up each grapheme once, in order, the first as the clip starts', () => {
    for (const [id, s] of Object.entries(times)) {
      expect(s.marks.length, id).toBe(s.graphemes.split('|').length)
      expect(s.marks[0], id).toBe(0)
      for (let i = 1; i < s.marks.length; i++) expect(s.marks[i], id).toBeGreaterThan(s.marks[i - 1])
    }
  })

  it('have no clip for a word whose graphemes changed since', () => {
    const hund = words.find((w) => w.id === 'hund')!
    expect(stretch({ ...hund, sounds: [['Hu', 'hu'], ['n', 'n'], ['d', 't']] })).toBeUndefined()
  })
})

describe('tile sounds', () => {
  const entries = tiles as unknown as Record<string, { graphemes: string; text: string; clip: string; cuts: (number | string)[][] }>
  // The clips as data URLs, to hash them as scripts/cut_tiles.py does.
  const clips = import.meta.glob('../audio/stretched/*.mp3', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>
  const hash = async (id: string) => {
    const data = clips[`../audio/stretched/${id}.mp3`].split(',')[1]
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
    return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10)
  }

  it('are cut from the clips as they are now', async () => {
    // A failure here means: run scripts/cut_tiles.py (see its docstring).
    for (const w of words) {
      const t = entries[w.id]
      expect(t, w.id).toBeDefined()
      expect(t.graphemes, w.id).toBe(times[w.id].graphemes)
      expect(t.text, w.id).toBe(times[w.id].text)
      expect(t.clip, w.id).toBe(await hash(w.id))
    }
  })

  it('give every grapheme a piece of a clip, borrowed only from another word', () => {
    for (const w of words) {
      expect(entries[w.id].cuts.length, w.id).toBe(w.sounds.length)
      w.sounds.forEach((_, k) => {
        const [from, to, other] = entries[w.id].cuts[k]
        expect(to as number, `${w.id} ${k}`).toBeGreaterThan(from as number)
        expect(from as number, `${w.id} ${k}`).toBeGreaterThanOrEqual(0)
        if (other !== undefined) expect(entries[other as string], `${w.id} ${k}`).toBeDefined()
        expect(tileCut(w, k), `${w.id} ${k}`).toBeDefined()
      })
    }
  })

  it('play the sound a grapheme has in its word: the d of Hund as its t', () => {
    const hund = words.find((w) => w.id === 'hund')!
    const d = tileCut(hund, 3)!
    expect(d.url).toContain('hund')
    expect(d.from).toBeGreaterThan(tileCut(hund, 2)!.from)
  })

  it('have no piece for a word whose graphemes changed since', () => {
    const hund = words.find((w) => w.id === 'hund')!
    expect(tileCut({ ...hund, sounds: [['Hu', 'hu'], ['n', 'n'], ['d', 't']] }, 0)).toBeUndefined()
  })
})

describe('litAt', () => {
  const marks = [0, 0.5, 1.2]
  it('lights each grapheme a little before its sound starts', () => {
    expect(litAt(marks, -0.2)).toBe(-1)
    expect(litAt(marks, -0.05)).toBe(0)
    expect(litAt(marks, 0.4)).toBe(0)
    expect(litAt(marks, 0.45)).toBe(1)
    expect(litAt(marks, 1.15)).toBe(2)
    expect(litAt(marks, 5)).toBe(2)
  })
})
