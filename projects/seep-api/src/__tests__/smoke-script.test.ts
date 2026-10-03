import { spawn } from 'node:child_process'
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

interface Registered {
  methods: string[]
  route: string
  handler: (r: HttpRequest, c: InvocationContext) => Promise<HttpResponseInit>
}
const registered: Registered[] = []
vi.mock('@azure/functions', () => ({ app: { http: (_name: string, o: Registered) => registered.push(o) } }))
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return {
    ...actual,
    // Stands in for Firebase: the "token" is just the person's name.
    verifyFirebaseToken: (header: string | null) =>
      header?.startsWith('Bearer ')
        ? Promise.resolve({ uid: `firebase-${header.slice(7)}`, email: `${header.slice(7)}@example.test`, emailVerified: true })
        : Promise.reject(new actual.AuthError('Missing or malformed Authorization header')),
  }
})

import { _setDbForTests } from '../lib/db'
import { type TestDb, createTestDb } from './helpers/test-db'

/**
 * Runs the real scripts/live-smoke.mjs — the exact file you'll point at the
 * deployed API — against the real handlers over real HTTP, so the script
 * itself is tested rather than trusted. (The routing here is a small matcher
 * built from the registered route templates; it proves the URLs, bodies and
 * response shapes line up, not the Azure Functions host's own router.)
 */
let t: TestDb
let server: Server
let baseUrl = ''

function matchRoute(method: string, path: string): { route: Registered; params: Record<string, string> } | null {
  for (const route of registered) {
    if (!route.methods.includes(method)) continue
    const names: string[] = []
    const pattern = new RegExp('^' + route.route.replace(/\{([^}]+)\}/g, (_m, n: string) => (names.push(n), '([^/]+)')) + '$')
    const m = pattern.exec(path)
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]!])) }
  }
  return null
}

async function serve(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const body = await new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString()))
    req.on('end', () => resolve(data))
  })
  const hit = matchRoute(req.method ?? 'GET', url.pathname.replace(/^\/api\//, ''))
  if (!hit) {
    res.writeHead(404).end()
    return
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const request = { url: url.href, headers, params: hit.params, query: url.searchParams, text: () => Promise.resolve(body) }
  try {
    const out = await hit.route.handler(request as unknown as HttpRequest, { log: () => undefined } as unknown as InvocationContext)
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.jsonBody ?? {}))
  } catch (err) {
    res.writeHead(500).end(String(err))
  }
}

beforeAll(async () => {
  t = await createTestDb()
  _setDbForTests(t.db)
  await import('../index')
  server = createServer((req, res) => void serve(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  _setDbForTests(null)
  await t.close()
})

function runScript(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [join(__dirname, '..', '..', 'scripts', 'live-smoke.mjs'), baseUrl], { env: { ...process.env, ...env } })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    child.on('close', (code) => resolve({ code, out }))
  })
}

describe('scripts/live-smoke.mjs', () => {
  it('passes every check against the real handlers over HTTP', async () => {
    const { code, out } = await runScript({ TOKEN_A: 'alice', TOKEN_B: 'bob' })
    expect(out).toMatch(/PASS: \d+ of \d+ checks passed/)
    expect(out).not.toMatch(/FAIL/)
    expect(code).toBe(0)
  })

  it('actually fails, with a non-zero exit code, when the API misbehaves (it is not a rubber stamp)', async () => {
    // Two tokens that resolve to the SAME person: B can't "join" as a second player.
    const { code, out } = await runScript({ TOKEN_A: 'alice', TOKEN_B: 'alice' })
    expect(out).toMatch(/FAIL/)
    expect(code).toBe(1)
  })

  it('explains its usage and exits 2 when given no tokens', async () => {
    const { code, out } = await runScript({ TOKEN_A: '', TOKEN_B: '' })
    expect(code).toBe(2)
    expect(out).toMatch(/Usage/)
  })
})
