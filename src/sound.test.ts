import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import type { Word } from './scheduler'
import { litAt, stretch } from './sound'
import stretched from './stretched.json'

const words = wordList as Word[]
const times = stretched as Record<string, { graphemes: string; text: string; marks: number[] }>
// The sound codes of scripts/phonics.py.
const CODES = new Set([
  ...'aeiouäöü', ...[...'aeiouäöü'].map((v) => `${v}:`), 'au', 'ei', 'eu', 'ə', 'ɐ',
  ...'bdgptkmnlrfwhjsz', 'sch', 'ch', 'ng', 'ts', 'pf', 'ks', 'kw',
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
