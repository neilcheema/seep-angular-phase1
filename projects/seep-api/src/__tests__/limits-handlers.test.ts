import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { createGameHandler, getGameHandler, joinGameHandler, leaveGameHandler, submitMoveHandler } from '../functions/games'
import { _setDbForTests } from '../lib/db'
import { call } from './helpers/http'
import { type TestDb, createTestDb } from './helpers/test-db'

/** The limits as callers meet them: through the real handlers, with the settings coming from the environment. */

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
  _setDbForTests(t.db)
})
afterEach(() => {
  verifyMock.mockReset()
  _setDbForTests(null)
  for (const name of Object.keys(process.env).filter((k) => k.startsWith('LIMIT'))) delete process.env[name]
})

const as = (uid: string) => verifyMock.mockResolvedValue({ uid, email: `${uid}@example.test`, emailVerified: true })
const create = (uid: string, kind = 'two_player') => (as(uid), call(createGameHandler, { as: 'x', body: { kind } }))
const join = (uid: string, code: unknown) => (as(uid), call(joinGameHandler, { as: 'x', body: { code } }))
const poll = (uid: string, id: string) => (as(uid), call(getGameHandler, { as: 'x', params: { id } }))
const leave = (uid: string, id: string) => (as(uid), call(leaveGameHandler, { as: 'x', params: { id } }))
const move = (uid: string, id: string, intent: unknown) => (as(uid), call(submitMoveHandler, { as: 'x', params: { id }, body: { intent } }))
const events = async () => (await t.db.query<{ n: number }>('SELECT count(*)::int AS n FROM rate_events')).rows[0]!.n
const set = (env: Record<string, string>) => Object.assign(process.env, env)

describe('starting tables', () => {
  it('lets ordinary use through, then says "too quickly" with how long to wait, in the body and the Retry-After header', async () => {
    set({ LIMIT_CREATE_PER_HOUR: '3', LIMIT_MAX_WAITING_TABLES: '99' })
    for (let i = 0; i < 3; i++) expect((await create('uid-a')).status).toBe(201)
    const refused = await create('uid-a')
    expect(refused.status).toBe(429)
    expect(refused.body['error']).toMatch(/starting tables too quickly/)
    expect(refused.body['retryAfterSeconds']).toBeGreaterThan(0)
    expect(refused.headers['Retry-After']).toBe(String(refused.body['retryAfterSeconds']))
    expect(refused.warn).toHaveBeenCalledWith('Rate limit reached: create_game') // for the alert, with no name in it
  })

  it('does not slow anyone else down', async () => {
    set({ LIMIT_CREATE_PER_HOUR: '1', LIMIT_MAX_WAITING_TABLES: '99' })
    expect((await create('uid-a')).status).toBe(201)
    expect((await create('uid-a')).status).toBe(429)
    expect((await create('uid-b')).status).toBe(201)
  })

  it('stops a person filling the service with waiting tables (409, with the way out), and Leave frees the cap', async () => {
    set({ LIMIT_MAX_WAITING_TABLES: '2' })
    const first = await create('uid-a')
    await create('uid-a')
    const blocked = await create('uid-a')
    expect(blocked.status).toBe(409)
    expect(blocked.body['error']).toMatch(/2 tables waiting.*Leave/)

    expect((await leave('uid-a', first.body['gameId'] as string)).status).toBe(200)
    expect((await create('uid-a')).status).toBe(201)
  })

  it('counts only the caller’s own waiting tables', async () => {
    set({ LIMIT_MAX_WAITING_TABLES: '1' })
    expect((await create('uid-a')).status).toBe(201)
    expect((await create('uid-b')).status).toBe(201)
  })
})

describe('guessing table codes', () => {
  it('allows a few wrong codes, then refuses further tries, even with the right code, until the window passes', async () => {
    set({ LIMIT_FAILED_JOINS_PER_10_MIN: '3' })
    const table = await create('uid-a')
    const code = table.body['inviteCode'] as string
    for (let i = 0; i < 3; i++) expect((await join('uid-b', 'ZZZZZZ')).status).toBe(404)
    const refused = await join('uid-b', 'ZZZZZZ')
    expect(refused.status).toBe(429)
    expect(refused.body['error']).toMatch(/wrong table codes/)
    expect((await join('uid-b', code)).status).toBe(429) // a guesser who got lucky is still held back
    expect(refused.warn).toHaveBeenCalledWith('Rate limit reached: join_fail')
  })

  it('does not hold back anyone else, who can use a right code at once', async () => {
    set({ LIMIT_FAILED_JOINS_PER_10_MIN: '2' })
    const code = (await create('uid-a')).body['inviteCode'] as string
    for (let i = 0; i < 3; i++) await join('uid-b', 'ZZZZZZ')
    expect((await join('uid-c', code)).status).toBe(200)
  })

  it('counts a malformed code as a wrong code too', async () => {
    set({ LIMIT_FAILED_JOINS_PER_10_MIN: '2' })
    expect((await join('uid-b', 'abc')).status).toBe(400)
    expect((await join('uid-b', 'abc')).status).toBe(400)
    expect((await join('uid-b', 'abc')).status).toBe(429)
  })

  it('does NOT count a right code: a successful join, or a right code for a full table, uses none of the wrong-code budget', async () => {
    set({ LIMIT_FAILED_JOINS_PER_10_MIN: '3' })
    const code = (await create('uid-a')).body['inviteCode'] as string
    expect((await join('uid-c', code)).status).toBe(200) // the table is now full
    const statuses: number[] = []
    for (const guess of ['ZZZZZZ', 'YYYYYY', code, code, 'XXXXXX', 'WWWWWW']) statuses.push((await join('uid-b', guess)).status)
    // wrong, wrong, full, full (right codes: not failures), wrong (the third failure), then refused
    expect(statuses).toEqual([404, 404, 409, 409, 404, 429])
  })

  it('refuses joining another match when the person is already playing too many', async () => {
    set({ LIMIT_MAX_ACTIVE_TABLES: '1' })
    const first = (await create('uid-a')).body['inviteCode'] as string
    expect((await join('uid-b', first)).status).toBe(200)
    const second = (await create('uid-c')).body['inviteCode'] as string
    const blocked = await join('uid-b', second)
    expect(blocked.status).toBe(409)
    expect(blocked.body['error']).toMatch(/already playing 1 matches/)
  })
})

describe('moves', () => {
  async function activeMatch() {
    const created = await create('uid-a')
    await join('uid-b', created.body['inviteCode'])
    return created.body['gameId'] as string
  }

  it('stops a flood of moves (right or wrong) with a 429, but not the other player', async () => {
    set({ LIMIT_MOVES_PER_MINUTE: '3' })
    const id = await activeMatch()
    for (let i = 0; i < 3; i++) expect([400, 409, 422]).toContain((await move('uid-a', id, { type: 'nonsense' })).status)
    const refused = await move('uid-a', id, { type: 'nonsense' })
    expect(refused.status).toBe(429)
    expect(refused.body['error']).toMatch(/moves too quickly/)
    expect([400, 409, 422]).toContain((await move('uid-b', id, { type: 'nonsense' })).status) // B has their own allowance
  })

  it('is far above what a real game needs at the defaults', async () => {
    const id = await activeMatch()
    for (let i = 0; i < 60; i++) expect((await move('uid-a', id, { type: 'nonsense' })).status).not.toBe(429)
  })
})

describe('what is never limited, and the off switch', () => {
  it('never limits or even counts polling, however tight everything else is set', async () => {
    set({ LIMIT_CREATE_PER_HOUR: '1', LIMIT_MOVES_PER_MINUTE: '1', LIMIT_FAILED_JOINS_PER_10_MIN: '1', LIMIT_MAX_WAITING_TABLES: '1', LIMIT_MAX_ACTIVE_TABLES: '1' })
    const id = (await create('uid-a')).body['gameId'] as string
    const before = await events()
    for (let i = 0; i < 40; i++) expect((await poll('uid-a', id)).status).toBe(200)
    expect(await events()).toBe(before)
  })

  it('can all be switched off without a redeploy', async () => {
    set({ LIMITS_ENABLED: 'false', LIMIT_CREATE_PER_HOUR: '1', LIMIT_MAX_WAITING_TABLES: '1', LIMIT_FAILED_JOINS_PER_10_MIN: '1', LIMIT_MOVES_PER_MINUTE: '1' })
    for (let i = 0; i < 4; i++) expect((await create('uid-a')).status).toBe(201)
    for (let i = 0; i < 4; i++) expect((await join('uid-b', 'ZZZZZZ')).status).toBe(404)
    expect(await events()).toBe(0)
  })
})
