import { beforeAll, describe, expect, it, vi } from 'vitest'

// The sync client against an in-memory server, with the browser globals it needs.
const server: Record<string, Record<string, string>> = {}
let online = true

async function fakeFetch(url: string, init: RequestInit = {}) {
  if (!online) throw new TypeError('Failed to fetch')
  await new Promise((r) => setTimeout(r, 20))
  const [, , code, , device] = new URL(url).pathname.split('/')
  const family = (server[code] ??= {})
  if (init.method === 'PUT') {
    family[device] = init.body as string
    return new Response(null, { status: 204 })
  }
  const devices = Object.fromEntries(Object.entries(family).map(([id, doc]) => [id, JSON.parse(doc)]))
  return new Response(JSON.stringify({ devices }), { status: 200 })
}

let store: typeof import('./store')
let sync: typeof import('./sync')

beforeAll(async () => {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  })
  vi.stubGlobal('location', { hostname: 'localhost' })
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  store = await import('./store')
  sync = await import('./sync')
})

const CODE = 'abend-kiste-segel-wolke-honig'
const coins = () => store.profiles[0]?.coins

describe('sync', () => {
  it('does nothing before the device joins a family, and does not get stuck on it', async () => {
    expect(await sync.sync()).toBe(false)
    // Another device of the family, with Lena's three coins.
    server[CODE] = {
      other1: JSON.stringify({ v: 2, profiles: { lena: { created: 1, name: { v: 'Lena', t: 1 }, epoch: 0, coins: 3, rounds: 3, words: {} } } }),
    }
    expect(await sync.connect(CODE, false)).toBeNull()
    expect(coins()).toBe(3)
    expect(await sync.sync()).toBe(true)
  })

  it('stays quiet offline and catches up once online', async () => {
    online = false
    store.recordRound(store.profiles[0], { oma: 'right' })
    expect(await sync.sync()).toBe(false)
    expect(coins()).toBe(4)
    online = true
    expect(await sync.sync()).toBe(true)
    const mine = JSON.parse(server[CODE][store.device()])
    expect(mine.profiles.lena.coins).toBe(1)
  })

  it('runs once more for calls that come during a sync', async () => {
    const calls = () => vi.mocked(fetch).mock.calls.length
    const before = calls()
    const first = sync.sync()
    await vi.waitFor(() => expect(calls()).toBeGreaterThan(before), { interval: 2 })
    await Promise.all([first, sync.sync(), sync.sync()])
    // Two syncs of a GET and a PUT each, not three.
    expect(calls() - before).toBe(4)
  })

  it('refuses a code the server does not know', async () => {
    expect(await sync.connect('abend-kiste-segel-wolke-hafen', false)).toBe('unknown')
    expect(store.family()).toBe(CODE)
  })
})
