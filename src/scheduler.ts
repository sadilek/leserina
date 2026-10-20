// Per-child learning state: a Leitner box system counted in rounds, not days.
// Pure functions only: state + word list -> next round; state + result -> new state.

export interface Word {
  id: string
  word: string
  emoji: string
  score: number
  level: number
  /** Its graphemes as written, each with the sound it stands for (`scripts/phonics.py`), as pairs:
   * Hund is [H, h], [u, u], [n, n], [d, t]. */
  sounds: string[][]
}

export interface WordState {
  /** 1-5. Box 5 counts as mastered. */
  box: number
  /** Round number in which the word is due next. */
  due: number
  seen: number
  wrong: number
}

export interface LearningState {
  /** Number of rounds completed. The next round is round + 1. */
  round: number
  words: Record<string, WordState>
}

/** How the child did with one word in a round. */
export type Outcome =
  /** Dropped on a wrong partner at least once. */
  | 'wrong'
  /** Matched, but the child tapped the word first and heard it. */
  | 'help'
  /** The last pair of the round, right by elimination. */
  | 'forced'
  /** Right on the first try, without help. */
  | 'right'

export type RoundResult = Record<string, Outcome>

/**
 * How the child did with a word in a round, from what happened in it: the words dropped wrong at
 * least once, those heard first and the forced last pair. A lay round knows only wrong tiles.
 */
export function outcome(round: { wrong: string[]; help: string[]; forced?: string }, id: string): Outcome {
  if (round.wrong.includes(id)) return 'wrong'
  if (round.help.includes(id)) return 'help'
  if (round.forced === id) return 'forced'
  return 'right'
}

/** Matching pictures and words, or laying each word from tiles, one per grapheme. */
export type RoundKind = 'match' | 'lay'

/**
 * What the next round is: with laying words on, every second one is a lay round. Counted by the
 * rounds played, so the devices of a family agree.
 */
export function roundKind(state: LearningState, layWords: boolean): RoundKind {
  return layWords && (state.round + 1) % 2 === 0 ? 'lay' : 'match'
}

/** Rounds until a word in box 1..5 is due again. */
export const INTERVALS = [1, 2, 4, 8, 16]
export const MAX_BOX = 5
/** At most this many words in boxes 1-2 before new words stop coming. */
export const MAX_WORKING_SET = 8
export const MAX_NEW_PER_ROUND = 2
/** Due words in this box or higher are reviews of nearly mastered words; new words go first. */
export const REVIEW_BOX = 4
/** From this many words in box 3 or higher, rounds look for two words with the same first letter. */
export const LOOK_ALIKE_FROM = 10

export function emptyState(): LearningState {
  return { round: 0, words: {} }
}

export function interval(box: number): number {
  return INTERVALS[Math.min(Math.max(box, 1), MAX_BOX) - 1]
}

/**
 * The words for the next round, n of them (fewer only if the list is shorter).
 * Due words first, most overdue first; then new words in difficulty order while the working
 * set is small; then not-yet-due words from the lowest boxes. If that still leaves gaps (at the
 * very start, when the child has seen nothing), more new words fill them.
 * Due words in boxes 4-5 wait behind the new words: otherwise a child who gets everything right
 * spends most rounds on reviews of words they know, and new words almost stop coming.
 * Once the child knows LOOK_ALIKE_FROM words fairly well (box 3+), the round gets two words with
 * the same first letter where it can, so that the first letter alone does not give the answer
 * away. To get them, a not-yet-due word gives way to another not-yet-due word, a due word to one
 * due in the same round from the same box, or a new word to a later new word of the same level;
 * due words are never pushed out, and new words still come level by level.
 */
export function composeRound(state: LearningState, words: Word[], n: number, startLevel = 1): string[] {
  const r = state.round + 1
  const order = new Map(words.map((w, i) => [w.id, i]))
  const known = Object.keys(state.words).filter((id) => order.has(id))
  const picked: string[] = []
  const take = (id: string) => {
    if (picked.length < n && !picked.includes(id)) picked.push(id)
  }

  const byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!
  const due = known
    .filter((id) => state.words[id].due <= r)
    .sort((a, b) => {
      const sa = state.words[a], sb = state.words[b]
      return sa.due - sb.due || sa.box - sb.box || byOrder(a, b)
    })
  due.filter((id) => state.words[id].box < REVIEW_BOX).forEach(take)

  const fresh = words
    .filter((w) => !(w.id in state.words) && w.level >= startLevel)
    .map((w) => w.id)
  let working = known.filter((id) => state.words[id].box <= 2).length
  let added = 0
  for (const id of fresh) {
    if (picked.length >= n || added >= MAX_NEW_PER_ROUND || working >= MAX_WORKING_SET) break
    take(id)
    added++
    working++
  }
  due.forEach(take)

  const notDue = known
    .filter((id) => state.words[id].due > r)
    .sort((a, b) => {
      const sa = state.words[a], sb = state.words[b]
      return sa.box - sb.box || sa.due - sb.due || byOrder(a, b)
    })
  notDue.forEach(take)

  fresh.forEach(take)
  // A start level above the list's last level, or a tiny list: fall back to anything.
  words.forEach((w) => take(w.id))

  const solid = known.filter((id) => state.words[id].box >= 3).length
  if (solid >= LOOK_ALIKE_FROM) {
    const byId = new Map(words.map((w) => [w.id, w]))
    const alike = (a: string, b: string) => looksAlike(byId.get(a)!, byId.get(b)!)
    const hasPair = picked.some((a, i) => picked.slice(i + 1).some((b) => alike(a, b)))
    // Words that may take a picked word's place without changing what the round is for.
    const standIns = (id: string): string[] => {
      const s = state.words[id]
      if (!s) return fresh.filter((f) => byId.get(f)!.level === byId.get(id)!.level)
      if (s.due > r) return notDue
      return due.filter((d) => state.words[d].due === s.due && state.words[d].box === s.box)
    }
    // The least urgent words give way first.
    for (let i = picked.length - 1; i >= 0 && !hasPair; i--) {
      const others = picked.filter((_, j) => j !== i)
      const partner = standIns(picked[i]).find(
        (c) => !picked.includes(c) && others.some((o) => alike(c, o)),
      )
      if (partner) {
        picked[i] = partner
        break
      }
    }
  }
  return picked
}

/** Whether two words start with the same letter, the cue children most like to guess from. */
export function looksAlike(a: Word, b: Word): boolean {
  return [...a.word.toLowerCase()][0] === [...b.word.toLowerCase()][0]
}

/**
 * Whether to go on with a saved round rather than deal `next`, the words a new round would get
 * now. A round without a pair made yet gives way when those are other words: a sync brought
 * rounds played on another device, or the parents changed the settings. Wrong drops and words
 * heard so far go with it. A round with a pair made is always finished.
 */
export function goOn(saved: { ids: string[]; matched: string[] }, next: string[]): boolean {
  return saved.matched.length > 0 || [...saved.ids].sort().join() === [...next].sort().join()
}

/** The learning state after a round with these outcomes. */
export function applyResult(state: LearningState, result: RoundResult): LearningState {
  const r = state.round + 1
  const words = { ...state.words }
  for (const [id, outcome] of Object.entries(result)) {
    const before = words[id]
    const box = before?.box ?? 1
    const nextBox =
      outcome === 'wrong' ? 1 : outcome === 'right' ? Math.min(box + 1, MAX_BOX) : box
    words[id] = {
      box: nextBox,
      due: r + interval(nextBox),
      seen: (before?.seen ?? 0) + 1,
      wrong: (before?.wrong ?? 0) + (outcome === 'wrong' ? 1 : 0),
    }
  }
  return { round: r, words }
}

/** Words per box 1..5, for the parents' corner. */
export function boxes(state: LearningState): string[][] {
  const out: string[][] = [[], [], [], [], []]
  for (const [id, s] of Object.entries(state.words)) out[s.box - 1].push(id)
  return out
}
