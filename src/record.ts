// The recording page (record.html, only under `npm run dev`): the owner records each sound of the
// game once in their own voice. Hold the space bar (or the big button), speak, let go: the take is
// played back, saved as audio/sounds/raw/<file>.wav by the dev server (vite.config.ts) and the
// next sound comes up. scripts/prepare_sounds.py trims and levels the takes for the game.
import '@fontsource/andika/latin-400.css'
import '@fontsource/andika/latin-700.css'
import './record.css'
import wordList from '../words.json'
import type { Word } from './scheduler'
import soundList from './sound-list.json'

type Sound = (typeof soundList)[number]
const sounds: Sound[] = soundList
const words = wordList as Word[]

const API = `${import.meta.env.BASE_URL}__sounds`
const PRE = 0.3 // s kept from before the key went down, so a sound started early is not cut
const POST = 0.3 // s kept after the key came up, so a sound ended late is not cut
const SLIP = 0.12 // s; a shorter press is a slip, not a take
const PAUSE = 400 // ms after playback before the next sound comes up

const KINDS: Record<string, string> = { held: 'Haltbare Laute', vowel: 'Vokale', stop: 'Verschlusslaute' }
const KIND_ONE: Record<string, string> = { held: 'Haltbarer Laut', vowel: 'Vokal', stop: 'Verschlusslaut' }

/** The letters to show large, and a word on what sets the sound apart from others written alike. */
function label(s: Sound): [string, string] {
  const special: Record<string, [string, string]> = {
    s: ['s', 'scharf'], z: ['s', 'summend'], ch: ['ch', 'wie in ich'], x: ['ch', 'wie in ach'],
    'ə': ['e', 'schwach'], 'ɐ': ['er', 'wie ein schwaches a'], ts: ['z', ''],
  }
  if (special[s.code]) return special[s.code]
  if (s.code.endsWith(':')) return [s.code.slice(0, -1), 'lang']
  if (s.kind === 'vowel' && s.code.length === 1) return [s.code, 'kurz']
  return [s.code, '']
}

function hint(s: Sound): string {
  const [big] = label(s)
  if (s.kind === 'stop') return `Kurz und ohne Vokal danach: nur „${big}“, kein „${big}e“.`
  if (s.code === 'h') return 'Nur hauchen, etwa eine halbe Sekunde.'
  if (s.code === 'ə' || s.code === 'ɐ') return `Unbetont wie am Ende von „${s.word}“, etwa eine halbe Sekunde.`
  if (s.kind === 'vowel') return `So wie in „${s.word}“, und etwa 1 Sekunde lang halten.`
  return 'Gleichmäßig etwa 1 Sekunde lang halten.'
}

/** The example word, with the grapheme that stands for the sound marked. */
function example(s: Sound): string {
  const w = words.find((x) => x.id === s.id)!
  return w.sounds.map(([g], k) => (k === s.at ? `<mark>${g}</mark>` : g)).join('')
}

// --- The microphone ---------------------------------------------------------------------------

// Hands every block of samples from the microphone to the page.
const TAP = `registerProcessor('tap', class extends AudioWorkletProcessor {
  process(inputs) { if (inputs[0][0]) this.port.postMessage(inputs[0][0].slice()); return true }
})`

class Mic {
  ctx?: AudioContext
  private ready?: Promise<void>
  private before: Float32Array[] = []
  private take?: Float32Array[]
  /** The loudest sample of the latest block while recording, 0-1. */
  level = 0

  start(): Promise<void> {
    this.ready ??= (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      })
      const ctx = (this.ctx = new AudioContext())
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' })))
      const tap = new AudioWorkletNode(ctx, 'tap')
      tap.port.onmessage = (e) => this.feed(e.data as Float32Array)
      // Through a silent gain to the speakers, so the browser keeps pulling the tap.
      const mute = ctx.createGain()
      mute.gain.value = 0
      ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination)
    })()
    return this.ready.then(() => this.ctx!.resume())
  }

  private feed(block: Float32Array) {
    if (this.take) {
      this.take.push(block)
      this.level = block.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      return
    }
    this.before.push(block)
    let kept = this.before.reduce((n, b) => n + b.length, 0)
    while (kept - this.before[0].length > PRE * this.ctx!.sampleRate) kept -= this.before.shift()!.length
  }

  record() {
    this.take = [...this.before]
    this.before = []
  }

  /** The take so far, ended; the samples come back as one array. */
  stop(): Float32Array {
    const blocks = this.take ?? []
    this.take = undefined
    this.level = 0
    const out = new Float32Array(blocks.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of blocks) {
      out.set(b, at)
      at += b.length
    }
    return out
  }
}

/** 16-bit PCM WAV, mono. */
function wav(samples: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (at: number, s: string) => [...s].forEach((c, k) => view.setUint8(at + k, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((v, k) => view.setInt16(44 + k * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true))
  return new Blob([view], { type: 'audio/wav' })
}

// --- The page ---------------------------------------------------------------------------------

const mic = new Mic()
const recorded = new Set<string>()
const takes = new Map<string, AudioBuffer>() // this session's takes, and the ones played since
let index = 0
let last: number | undefined // the sound recorded last, for "Nochmal"
let recording = false
let pressed = 0
let playing: AudioBufferSourceNode | undefined
let advance: number | undefined
let status = ''

const root = document.getElementById('record')!
root.innerHTML = `
  <header>
    <h1>Laute aufnehmen</h1>
    <span class="count"></span>
  </header>
  <section class="stage">
    <button class="nav prev" title="Voriger Laut (←)">‹</button>
    <div class="card">
      <div class="kind"></div>
      <div class="big"></div>
      <div class="tag"></div>
      <div class="word"></div>
      <p class="hint"></p>
    </div>
    <button class="nav next" title="Nächster Laut (→)">›</button>
  </section>
  <div class="controls">
    <button class="again">Nochmal</button>
    <button class="hold"><span class="dot"></span><span>Gedrückt halten und sprechen</span><small>oder Leertaste</small></button>
    <button class="listen">Anhören</button>
  </div>
  <div class="meter"><div></div></div>
  <p class="status"></p>
  <nav class="overview"></nav>`

const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T
const hold = $('.hold')

function render() {
  const s = sounds[index]
  const [big, tag] = label(s)
  $('.count').textContent = `${recorded.size} von ${sounds.length} aufgenommen`
  $('.kind').textContent = `${KIND_ONE[s.kind]} · ${index + 1} von ${sounds.length}${recorded.has(s.file) ? ' · ✓ aufgenommen' : ''}`
  $('.big').textContent = big
  $('.tag').textContent = tag
  $('.word').innerHTML = example(s)
  $('.hint').textContent = hint(s)
  $('.status').textContent = status
  root.classList.toggle('recording', recording)
  root.classList.toggle('playing', !!playing)
  $<HTMLButtonElement>('.listen').disabled = !recorded.has(s.file) || recording
  $<HTMLButtonElement>('.again').disabled = last === undefined || recording
  $<HTMLButtonElement>('.prev').disabled = index === 0 || recording
  $<HTMLButtonElement>('.next').disabled = index === sounds.length - 1 || recording
  root.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip, k) => {
    chip.classList.toggle('done', recorded.has(sounds[k].file))
    chip.classList.toggle('current', k === index)
  })
}

function overview() {
  const nav = $('.overview')
  for (const kind of Object.keys(KINDS)) {
    const group = document.createElement('div')
    group.className = 'group'
    group.innerHTML = `<h2>${KINDS[kind]}</h2><div class="chips"></div>`
    nav.append(group)
    sounds.forEach((s, k) => {
      if (s.kind !== kind) return
      const [big, tag] = label(s)
      const chip = document.createElement('button')
      chip.className = 'chip'
      chip.title = `${big} ${tag} wie in ${s.word}`.replace('  ', ' ')
      chip.innerHTML = `${big}${tag ? `<small>${tag}</small>` : ''}`
      chip.addEventListener('click', () => go(k))
      group.querySelector('.chips')!.append(chip)
    })
  }
}

function quiet() {
  clearTimeout(advance)
  advance = undefined
  if (playing) {
    playing.onended = null
    playing.stop()
    playing = undefined
  }
}

function go(k: number) {
  if (recording) return
  quiet()
  index = Math.max(0, Math.min(sounds.length - 1, k))
  status = ''
  render()
}

/** The next sound without a take, after this one (or from the start); none left: stay. */
function next() {
  const order = [...sounds.keys()].map((k) => (index + 1 + k) % sounds.length)
  const k = order.find((j) => !recorded.has(sounds[j].file))
  if (k === undefined) {
    status = 'Alle Laute sind aufgenommen. Weiter mit: uv run scripts/prepare_sounds.py'
    render()
  } else go(k)
}

async function down() {
  if (recording) return
  quiet()
  try {
    await mic.start()
  } catch (e) {
    status = `Kein Mikrofon: ${(e as Error).message}`
    return render()
  }
  recording = true
  pressed = performance.now()
  mic.record()
  status = 'Aufnahme läuft …'
  render()
  meter()
}

function up() {
  if (!recording) return
  if (performance.now() - pressed < SLIP * 1000) {
    recording = false
    mic.stop()
    status = 'Zu kurz gedrückt. Halten, sprechen, dann loslassen.'
    return render()
  }
  const s = sounds[index]
  const k = index
  setTimeout(async () => {
    const samples = mic.stop()
    recording = false
    const ctx = mic.ctx!
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    takes.set(s.file, buffer)
    last = k
    const saved = fetch(`${API}/${s.file}.wav`, { method: 'PUT', body: wav(samples, ctx.sampleRate) })
    status = 'Wird abgespielt …'
    play(buffer, () => {
      advance = window.setTimeout(next, PAUSE)
    })
    const res = await saved.catch(() => undefined)
    if (res?.ok) recorded.add(s.file)
    else status = `Nicht gespeichert (${res?.status ?? 'keine Verbindung'}). Läuft npm run dev?`
    render()
  }, POST * 1000)
}

function play(buffer: AudioBuffer, then?: () => void) {
  quiet()
  const ctx = mic.ctx!
  const src = (playing = ctx.createBufferSource())
  src.buffer = buffer
  src.connect(ctx.destination)
  src.onended = () => {
    playing = undefined
    status = ''
    render()
    then?.()
  }
  src.start()
  render()
}

async function listen() {
  const s = sounds[index]
  await mic.start().catch(() => undefined)
  if (!mic.ctx) return
  let buffer = takes.get(s.file)
  if (!buffer) {
    const res = await fetch(`${API}/${s.file}.wav`)
    if (!res.ok) return
    buffer = await mic.ctx.decodeAudioData(await res.arrayBuffer())
    takes.set(s.file, buffer)
  }
  play(buffer)
}

function again() {
  if (last === undefined) return
  go(last)
  status = 'Nochmal: Leertaste halten und sprechen.'
  render()
}

function meter() {
  const bar = $('.meter > div')
  const step = () => {
    bar.style.width = recording ? `${Math.min(100, mic.level * 140)}%` : '0'
    if (recording) requestAnimationFrame(step)
  }
  step()
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    if (!e.repeat) down()
  } else if (e.key === 'ArrowLeft') go(index - 1)
  else if (e.key === 'ArrowRight') go(index + 1)
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    up()
  }
})
window.addEventListener('blur', up)
hold.addEventListener('pointerdown', (e) => {
  hold.setPointerCapture(e.pointerId)
  down()
})
hold.addEventListener('pointerup', up)
hold.addEventListener('pointercancel', up)
$('.prev').addEventListener('click', () => go(index - 1))
$('.next').addEventListener('click', () => go(index + 1))
$('.listen').addEventListener('click', listen)
$('.again').addEventListener('click', again)

overview()
render()
fetch(API)
  .then((res) => res.json() as Promise<string[]>)
  .then((files) => {
    for (const f of files) recorded.add(f)
    const first = sounds.findIndex((s) => !recorded.has(s.file))
    go(first < 0 ? 0 : first)
  })
  .catch(() => {
    status = 'Der Dev-Server antwortet nicht: Diese Seite läuft nur unter npm run dev.'
    render()
  })
