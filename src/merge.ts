// Progress shared between a family's devices. Each device writes only its own document and
// reads everyone else's; merging all documents gives the profiles every device shows.
// No write ever conflicts, so the server only stores and returns documents.
//
// - Name, avatar, start level and pairs: the most recent write wins, per field.
// - Stars (`coins`) and rounds: each device counts its own since the last reset; the total is the sum.
//   A reset starts a new epoch (its time), and counts from older epochs drop out.
// - Word states: the most recently written state wins; states older than the reset drop out.
// - A deleted profile leaves a tombstone, which wins over everything.
import { applyResult, interval, type LearningState, type RoundResult, type WordState } from './scheduler'

export interface Stamped<T> {
  v: T
  t: number
}

export type Field = 'name' | 'avatar' | 'startLevel' | 'pairs'
export interface Fields {
  name: string
  avatar: string
  startLevel: number
  pairs: number
}

/** One profile as one device knows it: its own writes, and its own counts. */
export interface ProfileDoc {
  /** When the profile was made; orders the profiles. */
  created?: number
  name?: Stamped<string>
  avatar?: Stamped<string>
  startLevel?: Stamped<number>
  pairs?: Stamped<number>
  /** When the profile was deleted. */
  deleted?: number
  /** The reset this device's counts belong to: its time, 0 before the first reset. */
  epoch: number
  coins: number
  rounds: number
  words: Record<string, WordState & { t: number }>
}

export interface DeviceDoc {
  v: 2
  profiles: Record<string, ProfileDoc>
}

/** A profile as the app shows it. */
export interface ProfileView extends Fields {
  id: string
  created: number
  /** Stars collected. Called coins since the app's first design; renaming it would empty installed apps' jars. */
  coins: number
  learning: LearningState
  /** The latest reset. */
  epoch: number
  /** The latest time stamped on anything of this profile; writes from now on come later. */
  latest: number
}

export const FIELDS: Field[] = ['name', 'avatar', 'startLevel', 'pairs']
const DEFAULTS: Fields = { name: '', avatar: '', startLevel: 1, pairs: 4 }

export function emptyDoc(): DeviceDoc {
  return { v: 2, profiles: {} }
}

function emptyProfile(): ProfileDoc {
  return { epoch: 0, coins: 0, rounds: 0, words: {} }
}

const later = <T>(a: Stamped<T> | undefined, b: Stamped<T> | undefined) => {
  if (!a || !b) return a ?? b
  // Same time on two devices: any fixed order will do, as long as every device picks the same.
  return b.t > a.t || (b.t === a.t && String(b.v) > String(a.v)) ? b : a
}

/** Everything several documents know about one profile, as one document. */
export function combine(docs: ProfileDoc[]): ProfileDoc {
  const out = emptyProfile()
  out.epoch = Math.max(0, ...docs.map((d) => d.epoch))
  for (const d of docs) {
    if (d.created !== undefined) out.created = Math.min(out.created ?? Infinity, d.created)
    if (d.deleted !== undefined) out.deleted = Math.min(out.deleted ?? Infinity, d.deleted)
    out.name = later(out.name, d.name)
    out.avatar = later(out.avatar, d.avatar)
    out.startLevel = later(out.startLevel, d.startLevel)
    out.pairs = later(out.pairs, d.pairs)
    if (d.epoch === out.epoch) {
      out.coins += d.coins
      out.rounds += d.rounds
    }
    for (const [id, s] of Object.entries(d.words)) {
      if (s.t > out.epoch && s.t > (out.words[id]?.t ?? 0)) out.words[id] = s
    }
  }
  return out
}

function byProfile(docs: DeviceDoc[]) {
  const all = new Map<string, ProfileDoc[]>()
  for (const doc of docs) {
    for (const [id, p] of Object.entries(doc.profiles)) all.set(id, [...(all.get(id) ?? []), p])
  }
  return all
}

/** The profiles all these documents add up to, oldest first; deleted ones are left out. */
export function merge(docs: DeviceDoc[]): ProfileView[] {
  const out: ProfileView[] = []
  for (const [id, list] of byProfile(docs)) {
    const p = combine(list)
    if (p.deleted !== undefined) continue
    const round = p.rounds
    const words: LearningState['words'] = {}
    let latest = Math.max(p.epoch, p.created ?? 0, ...FIELDS.map((k) => p[k]?.t ?? 0))
    for (const [w, { t, ...s }] of Object.entries(p.words)) {
      latest = Math.max(latest, t)
      // Devices that played apart count rounds apart: a word may come up early, never late.
      words[w] = { ...s, due: Math.min(s.due, round + interval(s.box)) }
    }
    out.push({
      id,
      created: p.created ?? 0,
      name: p.name?.v ?? DEFAULTS.name,
      avatar: p.avatar?.v ?? DEFAULTS.avatar,
      startLevel: p.startLevel?.v ?? DEFAULTS.startLevel,
      pairs: p.pairs?.v ?? DEFAULTS.pairs,
      coins: p.coins,
      learning: { round, words },
      epoch: p.epoch,
      latest,
    })
  }
  return out.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1))
}

/** All documents folded into one, for a device that leaves one family's documents behind. */
export function fold(docs: DeviceDoc[]): DeviceDoc {
  const out = emptyDoc()
  for (const [id, list] of byProfile(docs)) out.profiles[id] = combine(list)
  return out
}

// What a device does to its own document. `view` is the merged profile the device shows; `now`
// is the device's clock. A write is stamped later than anything the device has seen of the
// profile, even when its clock runs behind another device's: what it does last wins.

function own(doc: DeviceDoc, view: ProfileView | undefined, id: string): ProfileDoc {
  const p = (doc.profiles[id] ??= emptyProfile())
  const epoch = view?.epoch ?? 0
  if (p.epoch < epoch) {
    // Another device reset this profile: this device's counts start over.
    Object.assign(p, { epoch, coins: 0, rounds: 0 })
    for (const [w, s] of Object.entries(p.words)) if (s.t <= epoch) delete p.words[w]
  }
  return p
}

const stamp = (view: ProfileView | undefined, now: number) => Math.max(now, (view?.latest ?? 0) + 1)

export function createProfile(doc: DeviceDoc, id: string, fields: Fields, now: number) {
  const p = own(doc, undefined, id)
  p.created = now
  for (const k of FIELDS) setField(doc, undefined, id, k, fields[k], now)
}

export function setField<K extends Field>(doc: DeviceDoc, view: ProfileView | undefined, id: string, k: K, v: Fields[K], now: number) {
  const p = own(doc, view, id)
  ;(p[k] as Stamped<Fields[K]>) = { v, t: stamp(view, now) }
}

/** A finished round: its word states, one more round and one more star. */
export function recordRound(doc: DeviceDoc, view: ProfileView, result: RoundResult, now: number) {
  const p = own(doc, view, view.id)
  const next = applyResult(view.learning, result)
  const t = stamp(view, now)
  for (const id of Object.keys(result)) p.words[id] = { ...next.words[id], t }
  p.rounds++
  p.coins++
}

/** Stars and learning state back to zero on every device; name and settings stay. */
export function resetProfile(doc: DeviceDoc, view: ProfileView, now: number) {
  const p = own(doc, view, view.id)
  Object.assign(p, { epoch: stamp(view, now), coins: 0, rounds: 0, words: {} })
}

export function deleteProfile(doc: DeviceDoc, id: string, now: number) {
  doc.profiles[id] = { ...emptyProfile(), deleted: now }
}

/** A device's progress from before syncing (store v1) as its own document: all of it its share. */
export function fromV1(profiles: (Fields & { id: string; coins: number; learning: LearningState })[], now: number): DeviceDoc {
  const doc = emptyDoc()
  profiles.forEach((p, i) => {
    createProfile(doc, p.id, p, now + i)
    const words: ProfileDoc['words'] = {}
    for (const [id, s] of Object.entries(p.learning.words)) words[id] = { ...s, t: now + i }
    Object.assign(doc.profiles[p.id], { coins: p.coins, rounds: p.learning.round, words })
  })
  return doc
}

/** Whether a document from the server has the shape this version reads; others are skipped. */
export function readable(doc: unknown): doc is DeviceDoc {
  const d = doc as DeviceDoc | null
  return !!d && d.v === 2 && !!d.profiles && typeof d.profiles === 'object' &&
    Object.values(d.profiles).every((p) =>
      !!p && typeof p.epoch === 'number' && typeof p.coins === 'number' && typeof p.rounds === 'number' &&
      !!p.words && typeof p.words === 'object')
}
