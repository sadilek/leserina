// Spoken words come from pre-rendered clips; the jingles are synthesised with Web Audio.
import { clipUrl, nameClipUrl } from './assets'
import stretched from './stretched.json'

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()
let speaking: AudioBufferSourceNode | null = null

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
    const url = clipUrl(id)
    if (url) void load(url)
  }
}

async function playClip(url: string | undefined, fallbackText: string) {
  const audio = unlock()
  sounding++
  speaking?.stop()
  speaking = null
  const buffer = url ? await load(url) : null
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
// Prototype A2: a few words read stretched, sound by sound, in one clip, with the time each
// grapheme's sound starts (scripts/prototypes/stretched). `?dehnen=<variant>` picks another spelling.
type Stretch = { text: string; marks: [string, number][]; end: number }
const STRETCHED = stretched as unknown as Record<string, { default: string; variants: Record<string, Stretch> }>
const variantParam = new URLSearchParams(location.search).get('dehnen')
let sounding = 0
const EARLY = 0.08

function stretchOf(id: string) {
  const s = STRETCHED[id]
  if (!s) return
  const v = variantParam && s.variants[variantParam] ? variantParam : s.default
  return { url: clipUrl(`stretch-${id}.${v}`), ...s.variants[v] }
}

/** The word's graphemes ("M", "au", "s"), if it can be sounded out. */
export const graphemes = (id: string) => stretchOf(id)?.marks.map(([g]) => g)

/**
 * Sound a word out: its stretched clip, calling `light(i)` as the i-th grapheme's sound starts and
 * `light(-1)` when it is over, then the whole word. Resolves when the whole word starts.
 */
export async function soundOut(id: string, text: string, light: (i: number) => void) {
  const s = stretchOf(id)
  const wordUrl = clipUrl(id)
  if (!s?.url) return sayWord(id, text)
  const audio = unlock()
  speaking?.stop()
  speaking = null
  const token = ++sounding
  const [buffer] = await Promise.all([load(s.url), wordUrl && load(wordUrl)])
  if (token !== sounding || !buffer) return
  const src = audio.createBufferSource()
  src.buffer = buffer
  src.connect(audio.destination)
  const lead = 0.05
  src.start(audio.currentTime + lead)
  speaking = src
  // A letter lighting up after its sound starts reads as late, one lighting up a little before
  // it as in time: each lights up EARLY s before its timestamp (the first one with the clip).
  const delay = lead + (audio.outputLatency || 0)
  const timers = s.marks.map(([, t], i) => setTimeout(() => light(i), Math.max(0, delay + t - EARLY) * 1000))
  await new Promise((r) => (src.onended = r))
  timers.forEach(clearTimeout)
  light(-1)
  if (token !== sounding) return
  await new Promise((r) => setTimeout(r, 250))
  if (token !== sounding) return
  return sayWord(id, text)
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
