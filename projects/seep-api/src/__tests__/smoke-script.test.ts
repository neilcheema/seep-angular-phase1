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
    // Stands in for Firebase: a JWT-shaped token whose middle segment is the person's name.
    verifyFirebaseToken: (header: string | null) => {
      const person = header?.startsWith('Bearer ') ? header.slice(7).split('.')[1] : undefined
      return person
        ? Promise.resolve({ uid: `firebase-${person}`, email: `${person}@example.test`, emailVerified: true })
        : Promise.reject(new actual.AuthError('Missing or malformed Authorization header'))
    },
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

/** Accounts known to the fake Firebase: email -> password. Persists across a test file, like the real thing. */
const fakeFirebaseAccounts = new Map<string, string>()
const VALID_API_KEY = 'valid-key'
const fakeToken = (email: string) => `header.${email.split('@')[0]}.signature`

function fakeIdentityToolkit(url: URL, body: string, res: ServerResponse): void {
  const reply = (status: number, json: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json))
  }
  if (url.searchParams.get('key') !== VALID_API_KEY) return reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })
  const { email, password } = JSON.parse(body) as { email: string; password: string }
  if (url.pathname.endsWith(':signInWithPassword')) {
    if (!fakeFirebaseAccounts.has(email)) return reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } })
    if (fakeFirebaseAccounts.get(email) !== password) return reply(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } })
    return reply(200, { idToken: fakeToken(email) })
  }
  if (fakeFirebaseAccounts.has(email)) return reply(400, { error: { message: 'EMAIL_EXISTS' } })
  fakeFirebaseAccounts.set(email, password)
  return reply(200, { idToken: fakeToken(email) })
}

async function serve(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const body = await new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString()))
    req.on('end', () => resolve(data))
  })
  if (url.pathname.startsWith('/identity/')) return fakeIdentityToolkit(new URL(url.href.replace('/identity', '')), body, res)
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
    // Start from the caller's environment minus every setting the script reads, so a developer's
    // leftover TOKEN_A or exported FIREBASE_API_KEY can never change what these tests mean.
    const clean: Record<string, string | undefined> = { ...process.env }
    for (const name of ['TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'TOKEN_D', 'FIREBASE_API_KEY', 'IDENTITY_TOOLKIT_URL', 'EMAIL_A', 'EMAIL_B', 'EMAIL_C', 'EMAIL_D', 'TEST_PASSWORD', 'APP_VERSION']) {
      delete clean[name]
    }
    const child = spawn('node', [join(__dirname, '..', '..', 'scripts', 'live-smoke.mjs'), baseUrl], { env: { ...clean, ...env } })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (out += d.toString()))
    child.on('close', (code) => resolve({ code, out }))
  })
}

const ALICE = 'header.alice.signature'
const BOB = 'header.bob.signature'
const CAROL = 'header.carol.signature'
const DAVE = 'header.dave.signature'

describe('scripts/live-smoke.mjs', () => {
  it('passes every check against the real handlers over HTTP, given two tokens', async () => {
    const { code, out } = await runScript({ TOKEN_A: ALICE, TOKEN_B: BOB })
    expect(out).toMatch(/PASS: \d+ of \d+ checks passed/)
    expect(out).not.toMatch(/FAIL/)
    expect(out).toMatch(/four-player section skipped/) // two tokens cannot fill a four-player table
    expect(code).toBe(0)
  })

  it('also plays a four-player table when given four tokens, including the creator being told about each arrival', async () => {
    const { code, out } = await runScript({ TOKEN_A: ALICE, TOKEN_B: BOB, TOKEN_C: CAROL, TOKEN_D: DAVE })
    expect(out).toMatch(/four-player table:/)
    expect(out).toMatch(/the creator is told about that arrival \(2 of 4 seats filled\)/)
    expect(out).toMatch(/the creator is told about that arrival \(3 of 4 seats filled\)/)
    expect(out).toMatch(/the game started when the fourth seat was taken/)
    expect(out).toMatch(/PASS: \d+ of \d+ checks passed/)
    expect(out).not.toMatch(/FAIL/)
    expect(code).toBe(0)
  })

  it('fails the four-player section when two of the four tokens are secretly the same person', async () => {
    const { code, out } = await runScript({ TOKEN_A: ALICE, TOKEN_B: BOB, TOKEN_C: ALICE, TOKEN_D: DAVE })
    expect(out).toMatch(/FAIL/)
    expect(code).toBe(1)
  })

  it('actually fails, with a non-zero exit code, when the API misbehaves (it is not a rubber stamp)', async () => {
    // Two tokens that resolve to the SAME person: B can't "join" as a second player.
    const { code, out } = await runScript({ TOKEN_A: ALICE, TOKEN_B: ALICE })
    expect(out).toMatch(/FAIL/)
    expect(code).toBe(1)
  })

  describe('fetching its own tokens from just an API key', () => {
    const viaFirebase = (extra: Record<string, string> = {}) =>
      runScript({ TOKEN_A: '', TOKEN_B: '', FIREBASE_API_KEY: VALID_API_KEY, IDENTITY_TOOLKIT_URL: `${baseUrl}/identity`, ...extra })

    it('creates the four test accounts on the first run and passes', async () => {
      fakeFirebaseAccounts.clear()
      const { code, out } = await viaFirebase()
      expect(out).toMatch(/PASS/)
      expect(code).toBe(0)
      expect([...fakeFirebaseAccounts.keys()].sort()).toEqual(['phase3-test@seep.quest', 'phase4-test-b@seep.quest', 'phase4-test-c@seep.quest', 'phase4-test-d@seep.quest'])
    })

    it('signs in to the accounts that already exist on later runs, creating nothing new', async () => {
      const before = [...fakeFirebaseAccounts.entries()]
      const { code, out } = await viaFirebase()
      expect(out).toMatch(/PASS/)
      expect(code).toBe(0)
      expect([...fakeFirebaseAccounts.entries()]).toEqual(before)
    })

    it('says plainly what is wrong when an existing test account has a different password (exit 2)', async () => {
      const { code, out } = await viaFirebase({ TEST_PASSWORD: 'SomethingElse9' })
      expect(code).toBe(2)
      expect(out).toMatch(/already exists with a different password/)
      expect(out).toMatch(/TEST_PASSWORD/)
    })

    it("surfaces Firebase's own message when the API key is wrong (exit 2)", async () => {
      const { code, out } = await viaFirebase({ FIREBASE_API_KEY: 'not-the-key' })
      expect(code).toBe(2)
      expect(out).toMatch(/API key not valid/)
    })

    it('ignores stale TOKEN_A / TOKEN_B left in the environment, and says so (the reused-terminal trap)', async () => {
      const { code, out } = await viaFirebase({ TOKEN_A: 'undefined', TOKEN_B: 'undefined' })
      expect(out).toMatch(/ignoring TOKEN_A \/ TOKEN_B/)
      expect(out).toMatch(/PASS/)
      expect(code).toBe(0)
    })

    it('can use its own email addresses', async () => {
      const { code } = await viaFirebase({ EMAIL_A: 'zoe@example.test', EMAIL_B: 'yan@example.test' })
      expect(code).toBe(0)
      expect(fakeFirebaseAccounts.has('zoe@example.test')).toBe(true)
    })
  })

  it("catches the mistake of passing something that isn't a token — the literal text 'undefined' — before bothering the API (exit 2)", async () => {
    const { code, out } = await runScript({ TOKEN_A: 'undefined', TOKEN_B: BOB })
    expect(code).toBe(2)
    expect(out).toMatch(/TOKEN_A is not a Firebase ID token/)
    expect(out).toMatch(/"undefined"/)
  })

  it('explains its usage and exits 2 when given neither tokens nor an API key', async () => {
    const { code, out } = await runScript({ TOKEN_A: '', TOKEN_B: '', FIREBASE_API_KEY: '' })
    expect(code).toBe(2)
    expect(out).toMatch(/Usage/)
    expect(out).toMatch(/FIREBASE_API_KEY/)
  })
})
