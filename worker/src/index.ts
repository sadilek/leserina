// Leserina's sync backend. Each family is one Durable Object (in the EU), named by its family
// code, with one row per device: the JSON document that device last uploaded. The app merges
// the documents itself; the worker only stores and returns them.
import { DurableObject } from 'cloudflare:workers'
import { MAX_BODY, MAX_DEVICES } from './limits'

export interface Env {
  FAMILY: DurableObjectNamespace<Family>
  /** "eu" when deployed (wrangler.jsonc); empty in local runs (.dev.vars). */
  JURISDICTION: DurableObjectJurisdiction | ''
}

/** Five lowercase words joined by hyphens: the family code is the only access control. */
const CODE = /^[a-z]{4,8}(-[a-z]{4,8}){4}$/
const DEVICE = /^[a-z0-9]{6,16}$/
/** The published app, plus `npm run dev` and `npm run preview` on localhost or the LAN. */
const ORIGIN =
  /^(https:\/\/sadilek\.github\.io|http:\/\/(localhost|127\.0\.0\.1|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}):518[01])$/

export class Family extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS device (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated INTEGER NOT NULL)')
  }

  /** All documents as one JSON object, keyed by device id. */
  devices(): string {
    const rows = this.ctx.storage.sql.exec<{ id: string; doc: string }>('SELECT id, doc FROM device ORDER BY id').toArray()
    return `{${rows.map((r) => `${JSON.stringify(r.id)}:${r.doc}`).join(',')}}`
  }

  /** Stores a device's document; false if the family is full and the device is new. */
  put(id: string, doc: string): boolean {
    const sql = this.ctx.storage.sql
    const known = sql.exec('SELECT 1 FROM device WHERE id = ?', id).toArray().length > 0
    const count = sql.exec<{ n: number }>('SELECT count(*) AS n FROM device').one().n
    if (!known && count >= MAX_DEVICES) return false
    sql.exec('INSERT OR REPLACE INTO device (id, doc, updated) VALUES (?, ?, ?)', id, doc, Date.now())
    return true
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    // Browsers send Origin on cross-origin requests; tools like curl do not.
    if (origin && !ORIGIN.test(origin)) return new Response('forbidden origin', { status: 403 })
    const cors: Record<string, string> = origin
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}
    const reply = (status: number, body: string | null = null, type = 'text/plain') =>
      new Response(body, { status, headers: { ...cors, ...(body ? { 'Content-Type': type } : {}) } })

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, PUT',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const [, family, code, device, id, ...rest] = new URL(request.url).pathname.split('/')
    if (family !== 'family' || !CODE.test(code ?? '') || rest.length) return reply(404, 'not found')
    const ns = env.JURISDICTION ? env.FAMILY.jurisdiction(env.JURISDICTION) : env.FAMILY
    const stub = ns.get(ns.idFromName(code))

    if (request.method === 'GET' && device === undefined) {
      return reply(200, `{"devices":${await stub.devices()}}`, 'application/json')
    }
    if (request.method === 'PUT' && device === 'device' && id !== undefined) {
      if (!DEVICE.test(id)) return reply(400, 'bad device id')
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return reply(413, 'too large')
      const body = await request.text()
      if (body.length > MAX_BODY) return reply(413, 'too large')
      try {
        const doc: unknown = JSON.parse(body)
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return reply(400, 'not a JSON object')
      } catch {
        return reply(400, 'not JSON')
      }
      return (await stub.put(id, body)) ? reply(204) : reply(409, 'too many devices')
    }
    return request.method === 'GET' || request.method === 'PUT' ? reply(404, 'not found') : reply(405, 'method not allowed')
  },
} satisfies ExportedHandler<Env>
