// Spoken words come from pre-rendered clips; the jingles are synthesised with Web Audio.
import { clipUrl, nameClipUrl, stretchedClipUrl } from './assets'
import type { Word } from './scheduler'
import stretched from './stretched.json'

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
let speaking: AudioBufferSourceNode | null = null
/** Counts what is played; a word being sounded out stops when another one starts. */
let sounding = 0

/** iOS starts audio only inside a user gesture: call this from every pointerdown. */
export function unlock(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state !== 'running') void ctx.resume()
  return ctx
}

function load(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => unlock().decodeAudioData(data))
      .catch(() => null)
    buffers.set(url, p)
  }
  return p
}

/** Fetch and decode clips ahead of time, so a tap plays without delay. */
export function preload(ids: string[]) {
  for (const id of ids) {
    for (const url of [clipUrl(id), stretchedClipUrl(id)]) if (url) void load(url)
  }
}

async function playClip(url: string | undefined, fallbackText: string) {
  const audio = unlock()
  const token = ++sounding
  speaking?.stop()
  speaking = null
  const buffer = url ? await load(url) : null
  if (token !== sounding) return
  if (!buffer) {
    // No clip rendered for this text: the device's own German voice stands in.
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(fallbackText)
    u.lang = 'de-DE'
    u.rate = 0.85
    speechSynthesis.speak(u)
    return
  }
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  src.start()
  speaking = src
}

export const sayWord = (id: string, text: string) => playClip(clipUrl(id), text)

type Stretch = { graphemes: string; text: string; marks: number[] }
const STRETCHED = stretched as Record<string, Stretch>
/** Each grapheme lights up this long (s) before its sound: lit as it starts, it looks late. */
const EARLY = 0.08
/** From scheduling the stretched clip to its start (s), so the first grapheme can light up early. */
const LEAD = 0.05
/** The pause (ms) between the sounds and the whole word. */
const PAUSE = 250

/** When each of the word's graphemes starts in its stretched clip; none if it has no clip for them. */
export function stretch(word: Word) {
  const s = STRETCHED[word.id]
  const url = stretchedClipUrl(word.id)
  // A clip rendered for other graphemes than the word has now would light up the wrong letters.
  if (!s || !url || s.graphemes !== word.sounds.map(([g]) => g).join('|')) return
  return { url, marks: s.marks }
}

/** The index of the grapheme lit at time t (s) of the clip; -1 before the first. */
export function litAt(marks: number[], t: number) {
  let i = -1
  while (i + 1 < marks.length && marks[i + 1] - EARLY <= t) i++
  return i
}

/**
 * Sound a word out: its stretched clip, calling `light(i)` as the i-th grapheme's sound starts and
 * `light(-1)` when the sounds are over, then the whole word. Resolves when the whole word starts,
 * or when something else is played instead. Without a stretched clip, says the whole word.
 */
export async function soundOut(word: Word, light: (i: number) => void) {
  const s = stretch(word)
  if (!s) return sayWord(word.id, word.word)
  const audio = unlock()
  const token = ++sounding
  speaking?.stop()
  speaking = null
  const wordUrl = clipUrl(word.id)
  const [buffer] = await Promise.all([load(s.url), wordUrl ? load(wordUrl) : null])
  if (token !== sounding) return
  if (!buffer) return sayWord(word.id, word.word)
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  const at = audio.currentTime + LEAD
  src.start(at)
  speaking = src
  const ended = new Promise((r) => (src.onended = r))
  // Follows the audio clock, so the letters keep up with the sound even if it starts late.
  let shown = -1
  let over = false
  const frame = () => {
    if (over) return
    const i = litAt(s.marks, audio.currentTime - at - (audio.outputLatency || audio.baseLatency || 0))
    if (i !== shown) light((shown = i))
    requestAnimationFrame(frame)
  }
  frame()
  await ended
  over = true
  light(-1)
  if (token !== sounding) return
  await new Promise((r) => setTimeout(r, PAUSE))
  if (token !== sounding) return
  return sayWord(word.id, word.word)
}

export const sayName = (nameSlug: string, text: string) => playClip(nameClipUrl(nameSlug), text)

/** One bell-like note: a sine with a few decaying partials. */
function bell(at: number, freq: number, length: number, gain = 0.18) {
  const audio = unlock()
  const out = audio.createGain()
  out.gain.setValueAtTime(0.0001, at)
  out.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  out.gain.exponentialRampToValueAtTime(0.0001, at + length)
  out.connect(audio.destination)
  for (const [ratio, level] of [[1, 1], [2, 0.35], [3.01, 0.12], [4.2, 0.06]]) {
    const osc = audio.createOscillator()
    const g = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq * ratio
    g.gain.value = level
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }
}

const NOTE = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)
const C5 = NOTE(3), E5 = NOTE(7), G5 = NOTE(10), C6 = NOTE(15), E6 = NOTE(19), G6 = NOTE(22), C7 = NOTE(27)

/** A matched pair: a quick rising arpeggio. */
export function jingle() {
  const t = unlock().currentTime + 0.02
  ;[C6, E6, G6, C7].forEach((f, i) => bell(t + i * 0.075, f, 0.55, 0.14))
}

/** The star is full: a short fanfare and a shimmer. */
export function fanfare() {
  const t = unlock().currentTime + 0.02
  const melody: [number, number, number][] = [
    [0, C5, 0.25], [0.16, E5, 0.25], [0.32, G5, 0.25], [0.48, C6, 0.9],
    [0.48, E5, 0.9], [0.48, G5, 0.9],
  ]
  for (const [dt, f, len] of melody) bell(t + dt, f, len, 0.16)
  for (let i = 0; i < 10; i++) bell(t + 0.7 + i * 0.07, [C7, G6, E6][i % 3] * 1.0, 0.4, 0.05)
}

/** The star lands in the jar. */
export function clink() {
  const t = unlock().currentTime + 0.01
  bell(t, NOTE(31), 0.35, 0.12)
  bell(t + 0.06, NOTE(36), 0.3, 0.08)
}
