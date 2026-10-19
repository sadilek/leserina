import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import {
  applyResult, boxes, composeRound, emptyState, goOn, LearningState, MAX_NEW_PER_ROUND,
  MAX_WORKING_SET, Outcome, RoundResult, Word,
} from './scheduler'

const words = wordList as Word[]
const N = 5

/** A child who answers each word as `answer` says; the last pair of a round is forced. */
function play(rounds: number, answer: (id: string, round: number) => Outcome, n = N, startLevel = 1) {
  let state: LearningState = emptyState()
  const history: string[][] = []
  for (let i = 0; i < rounds; i++) {
    const round = composeRound(state, words, n, startLevel)
    history.push(round)
    const result: RoundResult = {}
    round.forEach((id, k) => {
      const a = answer(id, state.round + 1)
      // Pairs are matched in some order; take the last one as the forced pair unless it was wrong.
      result[id] = k === round.length - 1 && a !== 'wrong' ? 'forced' : a
    })
    state = applyResult(state, result)
  }
  return { state, history }
}

/** Deterministic pseudo-random numbers, so the random child is reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}

const lowBoxes = (s: LearningState) => Object.values(s.words).filter((w) => w.box <= 2).length
const levelOf = (id: string) => words.find((w) => w.id === id)!.level

describe('word list', () => {
  it('has unique ids and words, sorted by level', () => {
    expect(new Set(words.map((w) => w.id)).size).toBe(words.length)
    expect(new Set(words.map((w) => w.word)).size).toBe(words.length)
    const levels = words.map((w) => w.level)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
  })
})

describe('composeRound', () => {
  it('starts with the easiest words and no duplicates', () => {
    const round = composeRound(emptyState(), words, N)
    expect(round).toEqual(words.slice(0, N).map((w) => w.id))
  })

  it('always returns n distinct words', () => {
    const r = rng(7)
    const { history } = play(60, () => (['wrong', 'help', 'right'] as Outcome[])[Math.floor(r() * 3)])
    for (const round of history) {
      expect(round).toHaveLength(N)
      expect(new Set(round).size).toBe(N)
    }
  })

  it('puts due words first, most overdue first', () => {
    const state: LearningState = {
      round: 10,
      words: {
        ball: { box: 3, due: 9, seen: 3, wrong: 0 },
        oma: { box: 2, due: 5, seen: 3, wrong: 0 },
        auto: { box: 4, due: 30, seen: 3, wrong: 0 },
      },
    }
    expect(composeRound(state, words, 2)).toEqual(['oma', 'ball'])
  })

  it('respects the start level', () => {
    const round = composeRound(emptyState(), words, N, 3)
    expect(round.every((id) => levelOf(id) >= 3)).toBe(true)
  })
})

describe('simulated children', () => {
  it('always right: moves through the list, two new words per round, words reach box 5', () => {
    const { state, history } = play(80, () => 'right')
    for (const round of history.slice(1)) {
      const isNew = (id: string, i: number) => !history.slice(0, i).flat().includes(id)
      const i = history.indexOf(round)
      expect(round.filter((id) => isNew(id, i)).length).toBeLessThanOrEqual(MAX_NEW_PER_ROUND)
    }
    expect(Object.keys(state.words).length).toBeGreaterThan(60)
    expect(boxes(state)[4].length).toBeGreaterThan(10)
    // Later rounds reach harder words.
    expect(Math.max(...history[79].map(levelOf))).toBeGreaterThanOrEqual(4)
  })

  it('always wrong on some words: those come back every round and block new words', () => {
    const hard = new Set(['ball', 'maus', 'hase'])
    const seenHard = (round: string[]) => round.filter((id) => hard.has(id))
    const { state, history } = play(40, (id) => (hard.has(id) ? 'wrong' : 'right'))
    for (const id of hard) expect(state.words[id]?.box ?? 1).toBe(1)
    // Once a hard word has shown up, it is in every following round.
    for (const id of hard) {
      const first = history.findIndex((r) => r.includes(id))
      if (first < 0) continue
      for (const round of history.slice(first + 1)) expect(round).toContain(id)
    }
    expect(seenHard(history[39]).length).toBeGreaterThan(0)
  })

  it('always wrong: the working set stays small, no flood of new words', () => {
    const { state } = play(40, () => 'wrong')
    expect(lowBoxes(state)).toBeLessThanOrEqual(MAX_WORKING_SET + N)
    expect(Object.keys(state.words).length).toBeLessThanOrEqual(MAX_WORKING_SET + N)
  })

  it('always tapping the word first: nothing moves up a box', () => {
    const { state } = play(30, () => 'help')
    expect(Object.values(state.words).every((w) => w.box === 1)).toBe(true)
  })

  it('random child: boxes stay in range and wrong words drop to box 1', () => {
    const r = rng(42)
    let state = emptyState()
    for (let i = 0; i < 100; i++) {
      const round = composeRound(state, words, N)
      const result: RoundResult = {}
      for (const id of round) result[id] = (['wrong', 'help', 'right', 'right'] as Outcome[])[Math.floor(r() * 4)]
      const next = applyResult(state, result)
      for (const [id, o] of Object.entries(result)) {
        const before = state.words[id]?.box ?? 1
        const after = next.words[id].box
        if (o === 'wrong') expect(after).toBe(1)
        if (o === 'right') expect(after).toBe(Math.min(before + 1, 5))
        if (o === 'help' || o === 'forced') expect(after).toBe(before)
        expect(next.words[id].due).toBeGreaterThan(next.round)
      }
      state = next
    }
    expect(state.round).toBe(100)
  })
})

describe('applyResult', () => {
  it('schedules by box: 1, 2, 4, 8, 16 rounds', () => {
    let s = emptyState()
    const dues: number[] = []
    for (let i = 0; i < 6; i++) {
      s = applyResult(s, { ball: 'right' })
      dues.push(s.words.ball.due - s.round)
    }
    expect(dues).toEqual([2, 4, 8, 16, 16, 16])
  })

  it('a wrong word is due in the next round', () => {
    let s = applyResult(emptyState(), { ball: 'right' })
    s = applyResult(s, { ball: 'right' })
    s = applyResult(s, { ball: 'wrong' })
    expect(s.words.ball).toMatchObject({ box: 1, due: s.round + 1, wrong: 1, seen: 3 })
  })
})

describe('goOn', () => {
  const saved = (ids: string[], more: { matched?: string[]; wrong?: string[]; help?: string[] } = {}) =>
    ({ ids, matched: [], wrong: [], help: [], ...more })
  const first = composeRound(emptyState(), words, 4)
  // Another device played that round, all right: the next round has other words.
  const right: RoundResult = Object.fromEntries(first.map((id) => [id, 'right']))
  const later = composeRound(applyResult(emptyState(), right), words, 4)

  it('goes on with an untouched round whose words are still the next ones, in any order', () => {
    expect(goOn(saved(first), [...first].reverse())).toBe(true)
  })

  it('deals anew when an untouched round no longer has the next words', () => {
    expect(later).not.toEqual(first)
    expect(goOn(saved(first), later)).toBe(false)
  })

  it('deals anew when the child only heard a word or dropped one wrong', () => {
    expect(goOn(saved(first, { wrong: [first[1]], help: [first[2]] }), later)).toBe(false)
  })

  it('goes on once a pair is made, whatever the next words are', () => {
    expect(goOn(saved(first, { matched: [first[0]] }), later)).toBe(true)
  })
})
