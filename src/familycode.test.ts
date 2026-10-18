import { describe, expect, it } from 'vitest'
import text from './family-words.txt?raw'
import { newCode, parseCode, codeWords } from './familycode'

const list = codeWords(text)

describe('family codes', () => {
  it('come from 2048 distinct words, each known by its first four letters', () => {
    expect(list).toHaveLength(2048)
    expect(new Set(list.map((w) => w.slice(0, 4))).size).toBe(2048)
    for (const w of list) expect(w).toMatch(/^[a-z]{4,8}$/)
  })

  it('are five random words that parse back to themselves', () => {
    const a = newCode(list), b = newCode(list)
    expect(a).toMatch(/^[a-z]{4,8}(-[a-z]{4,8}){4}$/)
    expect(a).not.toBe(b)
    expect(parseCode(a, list)).toBe(a)
  })

  it('accept capitals, spaces and four-letter beginnings', () => {
    const code = `${list[0]}-${list[100]}-${list[700]}-${list[1500]}-${list[2047]}`
    const typed = [list[0], list[100], list[700], list[1500], list[2047]].map((w, i) => (i % 2 ? w.slice(0, 4) : w.toUpperCase())).join('  ')
    expect(parseCode(` ${typed} `, list)).toBe(code)
  })

  it('reject the wrong number of words, unknown words and short beginnings', () => {
    const words = [list[1], list[2], list[3], list[4], list[5]]
    expect(parseCode(words.slice(0, 4).join(' '), list)).toBeNull()
    expect(parseCode([...words, list[6]].join(' '), list)).toBeNull()
    expect(parseCode([...words.slice(0, 4), 'xqzv'].join(' '), list)).toBeNull()
    expect(parseCode([...words.slice(0, 4), list[5].slice(0, 3)].join(' '), list)).toBeNull()
  })
})
