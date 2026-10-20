import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import { fits } from './lay'
import type { Word } from './scheduler'

const words = wordList as Word[]
const word = (id: string) => words.find((w) => w.id === id)!

describe('fields', () => {
  it('take the tile of their grapheme, or one with the same letters', () => {
    const mama = word('mama')
    expect(mama.sounds.map(([g]) => g)).toEqual(['M', 'a', 'm', 'a'])
    expect(fits(mama, 1, 1)).toBe(true)
    expect(fits(mama, 1, 3)).toBe(true)
    // The capital M only goes first.
    expect(fits(mama, 0, 2)).toBe(false)
    expect(fits(mama, 2, 0)).toBe(false)
  })

  it('take a tile of several letters as one: sch is one tile in Schaf', () => {
    const schaf = word('schaf')
    expect(schaf.sounds.map(([g]) => g)).toEqual(['Sch', 'a', 'f'])
    expect(fits(schaf, 0, 0)).toBe(true)
    expect(fits(schaf, 0, 1)).toBe(false)
  })
})
