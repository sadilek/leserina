import { describe, expect, it } from 'vitest'
import wordList from '../words.json'
import {
  createProfile, deleteProfile, emptyDoc, fold, fromV1, merge, recordRound, resetProfile, setField,
  type DeviceDoc, type Fields, type ProfileView,
} from './merge'
import { applyResult, composeRound, emptyState, type Outcome, type RoundResult, type Word } from './scheduler'

const words = wordList as Word[]

/** Deterministic pseudo-random numbers, so the random child is reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}

let clock = 1_000_000

/** A device as the app runs it: its own document, the others' as last fetched, and a clock. */
class Device {
  own: DeviceDoc = emptyDoc()
  others: Record<string, DeviceDoc> = {}
  skew = 0
  constructor(readonly id: string) {}

  now() {
    return (clock += 1000) + this.skew
  }
  profiles(): ProfileView[] {
    return merge([this.own, ...Object.values(this.others)])
  }
  profile(name: string) {
    return this.profiles().find((p) => p.name === name)
  }
  add(id: string, name: string, fields: Partial<Fields> = {}) {
    createProfile(this.own, id, { name, avatar: 'fox', startLevel: 1, pairs: 4, pictures: 'watercolour', ...fields }, this.now())
  }
  set<K extends keyof Fields>(name: string, k: K, v: Fields[K]) {
    const p = this.profile(name)!
    setField(this.own, p, p.id, k, v, this.now())
  }
  /** Plays n rounds as the child: a random answer per word, the last pair forced. */
  play(name: string, n: number, random = rng(n * 31 + name.length)) {
    for (let i = 0; i < n; i++) {
      const p = this.profile(name)!
      const round = composeRound(p.learning, words, p.pairs, p.startLevel)
      const result: RoundResult = {}
      round.forEach((id, k) => {
        const a = (['wrong', 'help', 'right', 'right'] as Outcome[])[Math.floor(random() * 4)]
        result[id] = k === round.length - 1 && a !== 'wrong' ? 'forced' : a
      })
      recordRound(this.own, p, result, this.now())
    }
  }
  reset(name: string) {
    resetProfile(this.own, this.profile(name)!, this.now())
  }
  remove(name: string) {
    deleteProfile(this.own, this.profile(name)!.id, this.now())
  }
  /** GET then PUT, as the sync client does; documents go through JSON like on the wire. */
  sync(server: Server) {
    for (const [id, doc] of Object.entries(server)) if (id !== this.id) this.others[id] = JSON.parse(doc)
    server[this.id] = JSON.stringify(this.own)
  }
}
type Server = Record<string, string>

const coins = (d: Device, name: string) => d.profile(name)?.coins
const seen = (d: Device, name: string) => Object.keys(d.profile(name)?.learning.words ?? {}).length

describe('two devices', () => {
  it('add up coins and rounds played offline on both', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.sync(server)
    pixel.sync(server)
    expect(pixel.profile('Lena')).toBeDefined()

    ipad.play('Lena', 7)
    pixel.play('Lena', 5)
    expect(coins(ipad, 'Lena')).toBe(7)
    expect(coins(pixel, 'Lena')).toBe(5)

    ipad.sync(server)
    pixel.sync(server)
    ipad.sync(server)
    for (const d of [ipad, pixel]) {
      expect(coins(d, 'Lena')).toBe(12)
      expect(d.profile('Lena')!.learning.round).toBe(12)
    }
    expect(ipad.profiles()).toEqual(pixel.profiles())
  })

  it('lose no word state: each word keeps its most recent state', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.play('Lena', 3)
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 4)
    ipad.play('Lena', 2)
    const fromIpad = ipad.profile('Lena')!.learning.words
    const fromPixel = pixel.profile('Lena')!.learning.words
    ipad.sync(server)
    pixel.sync(server)

    const merged = pixel.profile('Lena')!.learning
    expect(Object.keys(merged.words).sort()).toEqual([...new Set([...Object.keys(fromIpad), ...Object.keys(fromPixel)])].sort())
    // The pixel played last, so its states win wherever both played a word.
    for (const [id, s] of Object.entries(fromPixel)) expect(merged.words[id].box).toBe(s.box)
    // No word is pushed later than its box allows in the merged round count.
    for (const s of Object.values(merged.words)) expect(s.due).toBeLessThanOrEqual(merged.round + 16)
  })

  it('keep children side by side, each with their own progress', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    pixel.add('max', 'Max')
    ipad.play('Lena', 4)
    pixel.play('Max', 6)
    ipad.sync(server)
    pixel.sync(server)
    ipad.sync(server)
    expect(ipad.profiles().map((p) => [p.name, p.coins])).toEqual([['Lena', 4], ['Max', 6]])
    expect(pixel.profiles()).toEqual(ipad.profiles())
  })

  it('take the most recent name and settings, field by field', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.sync(server)
    pixel.sync(server)
    ipad.set('Lena', 'pairs', 6)
    pixel.set('Lena', 'avatar', 'owl')
    pixel.set('Lena', 'pictures', 'clay')
    pixel.set('Lena', 'name', 'Lena B.')
    ipad.set('Lena', 'startLevel', 2)
    ipad.sync(server)
    pixel.sync(server)
    ipad.sync(server)
    for (const d of [ipad, pixel]) {
      expect(d.profiles()).toMatchObject([{ name: 'Lena B.', avatar: 'owl', pairs: 6, startLevel: 2, pictures: 'clay' }])
    }
  })

  it('show watercolour pictures for profiles from apps before the picture style', () => {
    const server: Server = {}
    const old = new Device('old'), ipad = new Device('ipad')
    old.add('lena', 'Lena')
    delete old.own.profiles.lena.pictures
    old.sync(server)
    ipad.sync(server)
    expect(ipad.profile('Lena')!.pictures).toBe('watercolour')
  })

  it('hold a reset against coins and words from before it', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.play('Lena', 5)
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 3)
    pixel.sync(server)
    ipad.sync(server)
    expect(coins(ipad, 'Lena')).toBe(8)

    ipad.reset('Lena')
    expect(coins(ipad, 'Lena')).toBe(0)
    ipad.sync(server)
    pixel.sync(server)
    expect(coins(pixel, 'Lena')).toBe(0)
    expect(seen(pixel, 'Lena')).toBe(0)

    // Play goes on after the reset on both devices, and counts again.
    pixel.play('Lena', 2)
    ipad.play('Lena', 1)
    pixel.sync(server)
    ipad.sync(server)
    pixel.sync(server)
    expect(coins(ipad, 'Lena')).toBe(3)
    expect(coins(pixel, 'Lena')).toBe(3)
    expect(ipad.profile('Lena')!.learning.round).toBe(3)
  })

  it('hold a reset even when the resetting device runs behind', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    pixel.skew = 3_600_000
    ipad.add('lena', 'Lena')
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 4)
    pixel.sync(server)
    ipad.sync(server)
    ipad.reset('Lena')
    ipad.sync(server)
    pixel.sync(server)
    expect(coins(pixel, 'Lena')).toBe(0)
    expect(seen(pixel, 'Lena')).toBe(0)
  })

  it('hold a deletion, even against play on the other device', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.add('max', 'Max')
    ipad.sync(server)
    pixel.sync(server)
    ipad.remove('Max')
    pixel.play('Max', 3)
    pixel.set('Max', 'pairs', 5)
    ipad.sync(server)
    pixel.sync(server)
    ipad.sync(server)
    for (const d of [ipad, pixel]) expect(d.profiles().map((p) => p.name)).toEqual(['Lena'])
  })

  it('give everything back to a device whose data was wiped', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.add('max', 'Max')
    ipad.play('Lena', 6)
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 4)
    pixel.play('Max', 2)
    pixel.sync(server)
    const before = pixel.profiles()

    // Chrome's site data cleared: the app starts with a new device id and nothing else.
    const wiped = new Device('pixel2')
    expect(wiped.profiles()).toEqual([])
    wiped.sync(server)
    expect(wiped.profiles()).toEqual(before)
    wiped.play('Max', 1)
    wiped.sync(server)
    ipad.sync(server)
    expect(coins(ipad, 'Lena')).toBe(10)
    expect(coins(ipad, 'Max')).toBe(3)
  })
})

describe('fold', () => {
  it('keeps what a device showed when it leaves one family for another', () => {
    const server: Server = {}
    const ipad = new Device('ipad'), pixel = new Device('pixel')
    ipad.add('lena', 'Lena')
    ipad.play('Lena', 3)
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 2)
    const before = pixel.profiles()
    pixel.own = fold([pixel.own, ...Object.values(pixel.others)])
    pixel.others = {}
    expect(pixel.profiles()).toEqual(before)
    expect(coins(pixel, 'Lena')).toBe(5)
  })
})

describe('fromV1', () => {
  it('turns progress from before syncing into this device\'s share, and loses none of it', () => {
    let learning = emptyState()
    for (let i = 0; i < 9; i++) {
      const round = composeRound(learning, words, 4)
      learning = applyResult(learning, Object.fromEntries(round.map((id, k) => [id, k % 3 ? 'right' : 'wrong'])))
    }
    const v1 = [
      { id: 'lena', name: 'Lena', avatar: 'fox', startLevel: 2, pairs: 5, coins: 9, learning },
      { id: 'max', name: 'Max', avatar: 'owl', startLevel: 1, pairs: 4, coins: 0, learning: emptyState() },
    ]
    const ipad = new Device('ipad')
    ipad.own = JSON.parse(JSON.stringify(fromV1(v1, clock)))
    expect(ipad.profiles()).toMatchObject(v1.map((p) => ({ ...p, pictures: 'watercolour' })))

    // The pixel had its own children before; joining keeps both, and Lena's coins carry on.
    const server: Server = {}
    const pixel = new Device('pixel')
    pixel.add('ida', 'Ida')
    pixel.play('Ida', 2)
    ipad.sync(server)
    pixel.sync(server)
    pixel.play('Lena', 1)
    pixel.sync(server)
    ipad.sync(server)
    expect(ipad.profiles().map((p) => [p.name, p.coins])).toEqual([['Lena', 10], ['Max', 0], ['Ida', 2]])
    expect(ipad.profile('Lena')!.learning.round).toBe(10)
  })
})
