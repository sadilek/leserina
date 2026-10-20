// Profiles, stars and learning state, in localStorage of the installed home-screen app.
// This device's own document plus the other devices' documents as last fetched (`merge.ts`)
// make up the profiles the app shows. localStorage is the working copy; syncing (`sync.ts`)
// only exchanges documents, and the app works the same without it.
import * as merge from './merge'
import type { DeviceDoc, Field, Fields, ProfileView } from './merge'
import type { LearningState, RoundKind, RoundResult } from './scheduler'

/** A round in progress, kept when the app is closed so its slices are not lost. */
export interface SavedRound {
  /** A round of laying words from tiles (`src/lay.ts`); else one of matching pictures and words. */
  kind?: RoundKind
  ids: string[]
  /** Words matched, or in a lay round laid. */
  matched: string[]
  /** Words dropped on a wrong partner at least once; in a lay round, words with a tile dropped on a wrong field. */
  wrong: string[]
  /** Words the child tapped (and so heard) before matching them. */
  help: string[]
  /** The id of the pair that was forced, the last one, if matched. */
  forced?: string
  /** Positions of the cards as fractions of the play area, keyed "p:<id>" / "w:<id>". */
  pos: Record<string, [number, number]>
}

export interface Profile extends ProfileView {
  /** The unfinished round. Stays on this device. */
  current: SavedRound | null
}

interface Data {
  version: 2
  /** Names this device's document in the family. */
  device: string
  /** The family code while syncing, null otherwise. */
  family: string | null
  /** The family the other devices' documents came from; kept when this device disconnects. */
  othersFamily: string | null
  lastSync: number | null
  own: DeviceDoc
  others: Record<string, DeviceDoc>
  current: Record<string, SavedRound>
}

interface V1Profile extends Omit<Fields, 'pictures' | 'soundOut' | 'layWords'> {
  id: string
  coins: number
  learning: LearningState
  current: SavedRound | null
}

const KEY = 'leserina.v2'
/** Before syncing. Left in place after the migration, as a fallback. */
const V1_KEY = 'leserina.v1'

function randomId(length: number) {
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => digits[b % 36]).join('')
}

function fresh(): Data {
  return {
    version: 2, device: randomId(10), family: null, othersFamily: null, lastSync: null,
    own: merge.emptyDoc(), others: {}, current: {},
  }
}

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Data
      if (data.version === 2 && merge.readable(data.own)) return data
    }
    const v1 = localStorage.getItem(V1_KEY)
    if (v1) {
      const old = JSON.parse(v1) as { version: 1; profiles: V1Profile[] }
      const data = fresh()
      data.own = merge.fromV1(old.profiles, Date.now())
      for (const p of old.profiles) if (p.current) data.current[p.id] = p.current
      return data
    }
  } catch {
    // A broken entry must not lock the children out; start over rather than crash.
  }
  return fresh()
}

const data = load()

/** The children, oldest profile first. Objects stay the same across updates, keyed by id. */
export const profiles: Profile[] = []

const listeners = new Set<() => void>()
/** Runs `fn` after a sync changed the profiles, until the returned function is called. */
export function onSync(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

let shown = ''

/** Recomputes the profiles; true if they changed. */
function refresh() {
  const old = new Map(profiles.map((p) => [p.id, p]))
  const views = merge.merge([data.own, ...Object.values(data.others)])
  const before = shown
  shown = JSON.stringify(views)
  profiles.splice(0, profiles.length, ...views.map((v) =>
    Object.assign(old.get(v.id) ?? { current: data.current[v.id] ?? null }, v)))
  return shown !== before
}

/** Writes everything to localStorage, including the unfinished rounds of the profiles. */
export function save() {
  data.current = {}
  for (const p of profiles) if (p.current) data.current[p.id] = p.current
  localStorage.setItem(KEY, JSON.stringify(data))
}

function change() {
  const changed = refresh()
  save()
  return changed
}

refresh()
save()

export function addProfile(name: string, avatar: string): Profile {
  const id = randomId(8)
  merge.createProfile(data.own, id, { ...merge.DEFAULTS, name, avatar }, Date.now())
  change()
  return profiles.find((p) => p.id === id)!
}

export function setField<K extends Field>(p: Profile, k: K, v: Fields[K]) {
  merge.setField(data.own, p, p.id, k, v, Date.now())
  change()
}

/** A finished round: its word states, and one more star. */
export function recordRound(p: Profile, result: RoundResult) {
  merge.recordRound(data.own, p, result, Date.now())
  p.current = null
  change()
}

export function resetProfile(p: Profile) {
  merge.resetProfile(data.own, p, Date.now())
  p.current = null
  change()
}

export function deleteProfile(p: Profile) {
  merge.deleteProfile(data.own, p.id, Date.now())
  change()
}

// For the sync client.

export const device = () => data.device
export const family = () => data.family
export const lastSync = () => data.lastSync
export const ownDoc = () => data.own

/** Starts syncing with a family. Documents from another family are folded into this device's. */
export function join(code: string) {
  if (data.othersFamily !== code && Object.keys(data.others).length) {
    data.own = merge.fold([data.own, ...Object.values(data.others)])
    data.others = {}
  }
  data.family = code
  data.othersFamily = code
  change()
}

/** Stops syncing. What this device shows stays as it is. */
export function leave() {
  data.family = null
  data.lastSync = null
  save()
}

/** The family's documents as the server returned them. */
export function receive(code: string, docs: Record<string, unknown>) {
  if (code !== data.family) return
  data.others = {}
  for (const [id, doc] of Object.entries(docs)) if (id !== data.device && merge.readable(doc)) data.others[id] = doc
  if (change()) listeners.forEach((fn) => fn())
}

export function synced(at: number) {
  data.lastSync = at
  save()
}

/** Ask the browser not to evict our storage. Granted for home-screen apps on iOS. */
export function persist() {
  void navigator.storage?.persist?.()
}
