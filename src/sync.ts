// Syncing with the family's other devices through the worker in worker/: fetch every device's
// document, merge, upload this device's own. At app start, when the app comes back to the
// foreground, when the device goes online and after each finished round. Failures stay quiet:
// the app works the same offline, and the next sync catches up.
import * as store from './store'

/** The worker. While `npm run dev` runs, a local `npm run dev` in worker/ on the same host. */
const URL: string =
  import.meta.env.VITE_SYNC_URL ||
  (import.meta.env.DEV ? `http://${location.hostname}:8787` : 'https://leserina-sync.sadilek.workers.dev')
const TIMEOUT_MS = 6000

export type Problem = 'offline' | 'unknown' | 'full'

class SyncError extends Error {
  constructor(readonly problem: Problem) {
    super(problem)
  }
}

async function request(path: string, init: RequestInit = {}) {
  let res: Response
  try {
    res = await fetch(`${URL}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new SyncError('offline')
  }
  if (res.status === 409) throw new SyncError('full')
  if (!res.ok) throw new SyncError('offline')
  return res
}

async function download(code: string): Promise<Record<string, unknown>> {
  const body = (await (await request(`/family/${code}`)).json()) as { devices: Record<string, unknown> }
  return body.devices ?? {}
}

async function upload(code: string) {
  await request(`/family/${code}/device/${store.device()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(store.ownDoc()),
  })
}

async function once(code: string) {
  store.receive(code, await download(code))
  await upload(code)
  store.synced(Date.now())
}

let running: Promise<boolean> | null = null
let again = false

/** Syncs if this device belongs to a family; true if it worked. Calls during a sync queue one more. */
export function sync(): Promise<boolean> {
  if (running) {
    again = true
    return running
  }
  if (!store.family()) return Promise.resolve(false)
  const run = (async () => {
    // Settle only after `running` is set below, or `finally` would clear it before it is set.
    await Promise.resolve()
    try {
      do {
        again = false
        const code = store.family()
        if (!code) return false
        await once(code)
      } while (again)
      return true
    } catch (e) {
      console.warn('sync failed', e)
      return false
    } finally {
      running = null
    }
  })()
  running = run
  return run
}

/**
 * Starts syncing with a family: a new one (`create`, with a fresh code) or that of another
 * device, whose code the server must know already, or a typo would start a family of its own.
 */
export async function connect(code: string, create: boolean): Promise<Problem | null> {
  try {
    const docs = await download(code)
    if (!create && !Object.keys(docs).length) return 'unknown'
    // Upload first: a device that cannot join keeps its data as it was.
    await upload(code)
    store.join(code)
    store.receive(code, docs)
    store.synced(Date.now())
    return null
  } catch (e) {
    return e instanceof SyncError ? e.problem : 'offline'
  }
}

export function leaveFamily() {
  store.leave()
}

export function startAutoSync() {
  void sync()
  addEventListener('online', () => void sync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync()
  })
}
