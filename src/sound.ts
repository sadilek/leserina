// Spoken words come from pre-rendered clips; the jingles are synthesised with Web Audio.
import { clipUrl, nameClipUrl, soundClipUrl } from './assets'
import type { Word } from './scheduler'
import soundList from './sound-list.json'

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
/** What is playing now, stopped when something else starts. */
let playing: AudioBufferSourceNode[] = []
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

/** Stop what is playing and claim the speaker; the token tells whether something came after. */
function claim() {
  for (const src of playing) src.stop()
  playing = []
  speechSynthesis.cancel()
  return ++sounding
}

/** No clip for this text: the device's own German voice stands in. */
function speak(text: string) {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = 0.85
  speechSynthesis.speak(u)
}

/** Fetch and decode clips ahead of time, so a tap plays without delay: the words' and every sound's. */
export function preload(ids: string[]) {
  for (const id of ids) {
    const url = clipUrl(id)
    if (url) void load(url)
  }
  for (const s of soundList) {
    const url = soundClipUrl(s.file)
    if (url) void load(url)
  }
}

async function playClip(url: string | undefined, fallbackText: string) {
  const audio = unlock()
  const token = claim()
  const buffer = url ? await load(url) : null
  if (token !== sounding) return
  if (!buffer) return speak(fallbackText)
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  src.start()
  playing = [src]
}

export const sayWord = (id: string, text: string) => playClip(clipUrl(id), text)

/**
 * How a word is sounded out from the sound clips (audio/sounds/, recorded by the owner), in
 * seconds: run together ("Mmmaaauuusss"), or one by one with a pause between them, as each child's
 * settings say. Tune these by ear.
 */
export const BLEND = {
  /** A held sound or vowel (m, s, a) plays this long at most, so all of them last alike. */
  held: 0.45,
  /** Two sounds overlap this long, the first fading out as the next fades in. */
  fade: 0.06,
  /** The silence after a stop (b, d, g, p, t, k), which no sound runs into. */
  gap: 0.06,
  /** From the last sound to the whole word. */
  pause: 0.25,
  /** A tile, or a sound sounded out one by one, plays this much of its sound at most. */
  tile: 0.8,
  /** The pause between two sounds sounded out one by one. */
  apart: 0.3,
}
/** Fades at a sound's edges where it joins no other sound, so the cut makes no click. */
const EDGE_IN = 0.005
const EDGE_OUT = 0.025
/** The stops, after which the next sound starts anew rather than flowing out of them. */
const STOPS = new Set(['b', 'd', 'g', 'p', 't', 'k'])
const SOUNDS = new Map(soundList.map((s) => [s.code, s]))

/** The clip of a sound code (scripts/phonics.py); none if it has not been recorded. */
export const soundUrl = (code: string) => {
  const s = SOUNDS.get(code)
  return s && soundClipUrl(s.file)
}

/** The clips of a word's sounds, in order; none if one of them is missing. */
export function soundUrls(word: Word) {
  const urls = word.sounds.map(([, code]) => soundUrl(code))
  if (urls.every((u) => u)) return urls as string[]
}

/** One sound of a word sounded out: from when, for how long, and its fades (s). */
export interface Piece { at: number; length: number; fadeIn: number; fadeOut: number }

/**
 * Lay a word's sounds end to end, given each clip's length: held sounds and vowels cut to the same
 * length, each sound fading into the next, except after a stop, which keeps a short gap. Apart,
 * each sound plays as on its tile, with a pause after it.
 */
export function blend(codes: string[], durations: number[], apart = false): Piece[] {
  const pieces: Piece[] = []
  let end = 0
  if (apart) return durations.map((d, i) => {
    const length = Math.min(d, BLEND.tile)
    const at = i ? end + BLEND.apart : 0
    end = at + length
    return { at, length, fadeIn: Math.min(EDGE_IN, length / 2), fadeOut: Math.min(EDGE_OUT, length / 2) }
  })
  codes.forEach((code, i) => {
    const length = SOUNDS.get(code)?.kind === 'stop' ? durations[i] : Math.min(durations[i], BLEND.held)
    const prev = pieces[i - 1]
    const joined = prev !== undefined && !STOPS.has(codes[i - 1])
    const overlap = joined ? Math.min(BLEND.fade, prev.length / 2, length / 2) : 0
    if (joined) prev.fadeOut = overlap
    const at = !prev ? 0 : joined ? end - overlap : end + BLEND.gap
    pieces.push({ at, length, fadeIn: joined ? overlap : Math.min(EDGE_IN, length / 2), fadeOut: Math.min(EDGE_OUT, length / 2) })
    end = at + length
  })
  return pieces
}

/** The index of the grapheme lit at time t (s) of the sounds: each lights up as its clip starts; -1 before the first. */
export function litAt(marks: number[], t: number) {
  let i = -1
  while (i + 1 < marks.length && marks[i + 1] <= t) i++
  return i
}

/** Play part of a clip at a time on the audio clock, faded in and out. */
function schedule(audio: AudioContext, buffer: AudioBuffer, at: number, p: Omit<Piece, 'at'>) {
  const length = Math.min(p.length, buffer.duration)
  const gain = audio.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(1, at + p.fadeIn)
  gain.gain.setValueAtTime(1, at + Math.max(p.fadeIn, length - p.fadeOut))
  gain.gain.linearRampToValueAtTime(0, at + length)
  gain.connect(audio.destination)
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(gain)
  src.start(at, 0, length)
  playing.push(src)
  return new Promise((r) => (src.onended = r))
}

/** From scheduling the sounds to their start (s), so they do not start late. */
const LEAD = 0.05

/**
 * Sound a word out: its sound clips one after the other, run together or apart, calling `light(i)` as the i-th
 * grapheme's sound starts and `light(-1)` when the sounds are over, then the whole word. Resolves
 * when the whole word starts, or when something else is played instead. Without a clip for each
 * of its sounds, says the whole word.
 */
export async function soundOut(word: Word, light: (i: number) => void, apart = false) {
  const urls = soundUrls(word)
  if (!urls) return sayWord(word.id, word.word)
  const audio = unlock()
  const token = claim()
  const wordUrl = clipUrl(word.id)
  const [sounds] = await Promise.all([Promise.all(urls.map(load)), wordUrl ? load(wordUrl) : null])
  if (token !== sounding) return
  if (sounds.some((b) => !b)) return sayWord(word.id, word.word)
  const pieces = blend(word.sounds.map(([, c]) => c), sounds.map((b) => b!.duration), apart)
  const at = audio.currentTime + LEAD
  const ended = pieces.map((p, i) => schedule(audio, sounds[i]!, at + p.at, p))
  const marks = pieces.map((p) => p.at)
  // Follows the audio clock, so the letters keep up with the sound even if it starts late.
  let shown = -1
  let over = false
  const frame = () => {
    if (over || token !== sounding) return
    const i = litAt(marks, audio.currentTime - at - (audio.outputLatency || audio.baseLatency || 0))
    if (i !== shown) light((shown = i))
    requestAnimationFrame(frame)
  }
  frame()
  await Promise.all(ended)
  over = true
  light(-1)
  if (token !== sounding) return
  await new Promise((r) => setTimeout(r, BLEND.pause * 1000))
  if (token !== sounding) return
  return sayWord(word.id, word.word)
}

/**
 * Play the sound of a word's k-th grapheme, as a tile: the clip of the sound it has in the word
 * (the d of Hund plays a t). Resolves when it has played. Without a clip, the device's voice reads
 * the grapheme.
 */
export async function playTile(word: Word, k: number) {
  const url = soundUrl(word.sounds[k][1])
  const audio = unlock()
  const token = claim()
  const buffer = url ? await load(url) : null
  if (token !== sounding) return
  if (!buffer) return speak(word.sounds[k][0].toLowerCase())
  await schedule(audio, buffer, audio.currentTime + 0.01, { length: BLEND.tile, fadeIn: EDGE_IN, fadeOut: EDGE_OUT })
}

/**
 * Play a word's tiles one after the other, calling `light(i)` as the i-th starts and `light(-1)`
 * at the end, to listen through them (parents' corner).
 */
export async function playTiles(word: Word, light: (i: number) => void) {
  for (let k = 0; k < word.sounds.length; k++) {
    light(k)
    const played = playTile(word, k)
    const mine = sounding
    await played
    await new Promise((r) => setTimeout(r, 300))
    // Something else was played meanwhile.
    if (sounding !== mine) break
  }
  light(-1)
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
