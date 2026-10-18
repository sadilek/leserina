import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { MAX_BODY, MAX_DEVICES } from '../src/limits'

// Storage persists across tests in a file, so every test gets its own family.
let next = 0
const fresh = () => `abend-kiste-segel-wolke-hon${'abcdefghijklmnopqrstuvwxyz'[next++]}`
const APP = 'https://sadilek.github.io'

function call(path: string, init: RequestInit & { origin?: string | null } = {}) {
  const { origin = APP, ...rest } = init
  const headers = new Headers(rest.headers)
  if (origin) headers.set('Origin', origin)
  return exports.default.fetch(new Request(`https://sync.test${path}`, { ...rest, headers }))
}

const put = (code: string, device: string, body: string, origin?: string | null) =>
  call(`/family/${code}/device/${device}`, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' }, origin })

const devices = async (code: string) => ((await (await call(`/family/${code}`)).json()) as { devices: Record<string, unknown> }).devices

describe('family documents', () => {
  it('starts empty, then returns every device document', async () => {
    const CODE = fresh()
    expect(await devices(CODE)).toEqual({})
    expect((await put(CODE, 'ipad1234', '{"v":2,"a":1}')).status).toBe(204)
    expect((await put(CODE, 'pixel567', '{"v":2,"b":2}')).status).toBe(204)
    expect(await devices(CODE)).toEqual({ ipad1234: { v: 2, a: 1 }, pixel567: { v: 2, b: 2 } })
  })

  it('replaces a device document on the next PUT', async () => {
    const CODE = fresh()
    await put(CODE, 'ipad1234', '{"n":1}')
    await put(CODE, 'ipad1234', '{"n":2}')
    expect(await devices(CODE)).toEqual({ ipad1234: { n: 2 } })
  })

  it('keeps families apart', async () => {
    const CODE = fresh()
    await put(CODE, 'ipad1234', '{"n":1}')
    expect(await devices(fresh())).toEqual({})
  })

  it('takes at most a handful of devices, but lets known ones keep writing', async () => {
    const CODE = fresh()
    for (let i = 0; i < MAX_DEVICES; i++) expect((await put(CODE, `device${i}`, '{}')).status).toBe(204)
    expect((await put(CODE, 'onetoomany', '{}')).status).toBe(409)
    expect((await put(CODE, 'device0', '{"n":1}')).status).toBe(204)
    expect(Object.keys(await devices(CODE))).toHaveLength(MAX_DEVICES)
  })
})

describe('validation', () => {
  it('rejects malformed family codes', async () => {
    const CODE = fresh()
    for (const code of ['abend-kiste', 'Abend-kiste-segel-wolke-honig', 'abend-kiste-segel-wolke-honig-hafen', 'abc-kiste-segel-wolke-honig', 'x'.repeat(200)]) {
      expect((await call(`/family/${code}`)).status).toBe(404)
    }
  })

  it('rejects long or odd device ids', async () => {
    const CODE = fresh()
    expect((await put(CODE, 'x'.repeat(17), '{}')).status).toBe(400)
    expect((await put(CODE, 'ipad%2F..', '{}')).status).toBe(400)
  })

  it('takes only JSON objects below the size cap', async () => {
    const CODE = fresh()
    expect((await put(CODE, 'ipad1234', 'not json')).status).toBe(400)
    expect((await put(CODE, 'ipad1234', '[1,2]')).status).toBe(400)
    expect((await put(CODE, 'ipad1234', JSON.stringify({ pad: 'x'.repeat(MAX_BODY) }))).status).toBe(413)
    expect(await devices(CODE)).toEqual({})
  })

  it('answers unknown paths and methods with errors', async () => {
    const CODE = fresh()
    expect((await call('/')).status).toBe(404)
    expect((await call(`/family/${CODE}/device/ipad1234`)).status).toBe(404)
    expect((await call(`/family/${CODE}`, { method: 'DELETE' })).status).toBe(405)
  })
})

describe('CORS', () => {
  it('allows the published app and local dev servers', async () => {
    const CODE = fresh()
    for (const origin of [APP, 'http://localhost:5180', 'http://192.168.178.20:5180', 'http://10.0.0.5:5181']) {
      const res = await call(`/family/${CODE}`, { origin })
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    }
  })

  it('answers the preflight for PUT', async () => {
    const CODE = fresh()
    const res = await call(`/family/${CODE}/device/ipad1234`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
  })

  it('refuses other origins', async () => {
    const CODE = fresh()
    for (const origin of ['https://evil.example', 'https://sadilek.github.io.evil.example', 'http://localhost:3000']) {
      expect((await put(CODE, 'ipad1234', '{}', origin)).status).toBe(403)
    }
    expect(await devices(CODE)).toEqual({})
  })
})
