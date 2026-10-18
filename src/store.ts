// Profiles, stars and learning state, in localStorage of the installed home-screen app.
import { emptyState, type LearningState } from './scheduler'

/** A round in progress, kept when the app is closed so its slices are not lost. */
export interface SavedRound {
  ids: string[]
  matched: string[]
  /** Words dropped on a wrong partner at least once. */
  wrong: string[]
  /** Words the child tapped (and so heard) before matching them. */
  help: string[]
  /** The id of the pair that was forced, the last one, if matched. */
  forced?: string
  /** Positions of the cards as fractions of the play area, keyed "p:<id>" / "w:<id>". */
  pos: Record<string, [number, number]>
}

export interface Profile {
  id: string
  name: string
  avatar: string
  /** 1-5. Words below it are never introduced. */
  startLevel: number
  /** Pairs per round, 4-6. */
  pairs: number
  /** Stars collected. Called coins since the app's first design; renaming it would empty installed apps' jars. */
  coins: number
  learning: LearningState
  current: SavedRound | null
}

interface Data {
  version: 1
  profiles: Profile[]
}

const KEY = 'leserina.v1'

export function load(): Data {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as Data
      if (data.version === 1 && Array.isArray(data.profiles)) return data
    }
  } catch {
    // A broken entry must not lock the children out; start over rather than crash.
  }
  return { version: 1, profiles: [] }
}

export const data = load()

export function save() {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function newProfile(name: string, avatar: string): Profile {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    avatar,
    startLevel: 1,
    pairs: 4,
    coins: 0,
    learning: emptyState(),
    current: null,
  }
}

/** Ask the browser not to evict our storage. Granted for home-screen apps on iOS. */
export function persist() {
  void navigator.storage?.persist?.()
}
