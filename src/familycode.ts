// Family codes: five words from a list of 2048 (55 bits), typed in on each device. Knowing the
// code is the only access to a family's progress, so it is random and never shown in a link.
// The list (src/family-words.txt) is de-2048 from https://codeberg.org/fossarchive/wordlists-de
// (CC0): lowercase German words without umlauts, each one known by its first four letters.

export const WORDS_PER_CODE = 5

export function codeWords(text: string): string[] {
  return text.split('\n').filter(Boolean)
}

export function newCode(list: string[]): string {
  // 65536 is a multiple of the list's length, so every word is equally likely.
  return Array.from(crypto.getRandomValues(new Uint16Array(WORDS_PER_CODE)), (n) => list[n % list.length]).join('-')
}

/** The code typed in, in any case and with any separators; a word's first four letters do. */
export function parseCode(input: string, list: string[]): string | null {
  const typed = input.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  if (typed.length !== WORDS_PER_CODE) return null
  const words = typed.map((t) => list.find((w) => w === t) ?? (t.length >= 4 ? list.find((w) => w.startsWith(t.slice(0, 4))) : undefined))
  return words.every(Boolean) ? words.join('-') : null
}
