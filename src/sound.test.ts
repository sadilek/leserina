import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import type { Word } from './scheduler'
import { BLEND, blend, litAt, soundUrl, soundUrls } from './sound'
import soundList from './sound-list.json'

const words = wordList as Word[]
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

describe('the sound list', () => {
  it('has each sound of the words once, with an example word that has it', () => {
    // A failure here means: run npm run words.
    const used = new Set(words.flatMap((w) => w.sounds.map(([, c]) => c)))
    expect(soundList.map((s) => s.code).sort()).toEqual([...used].sort())
    expect(new Set(soundList.map((s) => s.file)).size).toBe(soundList.length)
    for (const s of soundList) {
      expect(s.file, s.code).toMatch(/^[a-z-]+$/)
      const w = words.find((x) => x.id === s.id)!
      expect(w.sounds[s.at], s.code).toEqual([s.grapheme, s.code])
    }
  })
})

describe('sound clips', () => {
  it('exist for every sound of the words', () => {
    // A failure here means: record the missing sounds and run scripts/prepare_sounds.py (README, "Recording the sounds").
    const used = [...new Set(words.flatMap((w) => w.sounds.map(([, c]) => c)))]
    expect(used.filter((c) => !soundUrl(c))).toEqual([])
    for (const w of words) expect(soundUrls(w), w.id).toBeDefined()
  })
})

describe('blend', () => {
  const near = (x: number) => expect.closeTo(x, 6)

  it('cuts held sounds and vowels to one length and fades each into the next', () => {
    // Mau: m and au recorded a second long.
    const [m, au] = blend(['m', 'au'], [1, 1])
    expect(m).toEqual({ at: 0, length: BLEND.held, fadeIn: expect.any(Number), fadeOut: near(BLEND.fade) })
    expect(au.at).toBeCloseTo(BLEND.held - BLEND.fade)
    expect(au.fadeIn).toBeCloseTo(BLEND.fade)
    expect(au.length).toBe(BLEND.held)
  })

  it('plays a stop whole and leaves a gap after it, but not before it', () => {
    // Hut: h, u:, t.
    const [h, u, t] = blend(['h', 'u:', 't'], [0.3, 1, 0.12])
    expect(h.length).toBeCloseTo(0.3)
    expect(t.at).toBeCloseTo(u.at + u.length - t.fadeIn)
    expect(t.length).toBeCloseTo(0.12)
    // Tor: after the t, the o: starts anew, after a gap.
    const [t2, o] = blend(['t', 'o:', 'r'], [0.12, 1, 1])
    expect(t2.fadeOut).toBeLessThan(BLEND.fade)
    expect(o.at).toBeCloseTo(0.12 + BLEND.gap)
    expect(o.fadeIn).toBeLessThan(BLEND.fade)
  })

  it('keeps a short sound whole, its fades within it', () => {
    const [a, h] = blend(['a', 'h', 'a'], [1, 0.05, 1])
    expect(h.length).toBeCloseTo(0.05)
    expect(h.fadeIn + h.fadeOut).toBeLessThanOrEqual(h.length)
    expect(a.fadeOut).toBeCloseTo(h.fadeIn)
  })

  it('plays the sounds apart as on their tiles, with a pause between them', () => {
    const [m, au, s] = blend(['m', 'au', 's'], [1, 0.5, 1], true)
    expect(m).toMatchObject({ at: 0, length: BLEND.tile })
    expect(au.at).toBeCloseTo(BLEND.tile + BLEND.apart)
    expect(au.length).toBe(0.5)
    expect(s.at).toBeCloseTo(au.at + 0.5 + BLEND.apart)
    expect(au.fadeIn).toBeLessThan(BLEND.fade)
  })

  it('starts each sound after the one before it', () => {
    for (const w of words.slice(0, 50)) {
      const pieces = blend(w.sounds.map(([, c]) => c), w.sounds.map(() => 0.7))
      expect(pieces[0].at).toBe(0)
      for (let i = 1; i < pieces.length; i++) expect(pieces[i].at, w.id).toBeGreaterThan(pieces[i - 1].at)
    }
  })
})

describe('litAt', () => {
  const marks = [0, 0.5, 1.2]
  it('lights each grapheme as its sound starts', () => {
    expect(litAt(marks, -0.05)).toBe(-1)
    expect(litAt(marks, 0)).toBe(0)
    expect(litAt(marks, 0.45)).toBe(0)
    expect(litAt(marks, 0.5)).toBe(1)
    expect(litAt(marks, 1.2)).toBe(2)
    expect(litAt(marks, 5)).toBe(2)
  })
})
