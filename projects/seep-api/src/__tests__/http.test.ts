import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from 'seep-engine'
import { legalBids } from 'seep-engine'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { AuthError } from '../lib/auth'
import { type Db, _setDbForTests } from '../lib/db'
import { ConflictError, NotFoundError } from '../lib/errors'
import {
  createGameHandler,
  dealNextHandler,
  getGameHandler,
  joinGameHandler,
  listGamesHandler,
  submitMoveHandler,
} from '../functions/games'
import { authed } from '../lib/http'
import { call } from './helpers/http'
import { type TestDb, createTestDb } from './helpers/test-db'

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
  verifyMock.mockImplementation((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return Promise.reject(new AuthError('Missing or malformed Authorization header'))
    const name = header.slice('Bearer '.length)
    if (name === 'forged') return Promise.reject(new AuthError('Token verification failed: bad signature'))
    return Promise.resolve({ uid: `firebase-${name}`, email: `${name}@example.test`, emailVerified: true })
  })
})
afterEach(() => {
  delete process.env['MIN_CLIENT_VERSION']
  verifyMock.mockReset()
  _setDbForTests(null)
})

async function userRowCount(): Promise<number> {
  return (await t.db.query<{ n: number }>('SELECT count(*)::int AS n FROM users')).rows[0]!.n
}

describe('authed() — the front door', () => {
  const ok = authed(() => Promise.resolve({ status: 200, jsonBody: { reached: true } }))

  it('lets a verified caller through to the handler', async () => {
    expect(await call(ok, { as: 'alice' })).toMatchObject({ status: 200, body: { reached: true } })
  })

  it('answers 401 and never runs the handler for a missing or forged token, logging the reason but not the token', async () => {
    const handler = vi.fn(() => Promise.resolve({ status: 200 }))
    const guarded = authed(handler)
    const missing = await call(guarded)
    const forged = await call(guarded, { as: 'forged' })
    expect(missing.status).toBe(401)
    expect(forged).toMatchObject({ status: 401, body: { error: 'Token verification failed: bad signature' } })
    expect(forged.log).toHaveBeenCalledWith(expect.stringContaining('bad signature'))
    expect(forged.log).not.toHaveBeenCalledWith(expect.stringContaining('forged'))
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 426 to a declared app version below the minimum — before even looking at the token', async () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    const res = await call(ok, { as: 'forged', appVersion: '1.0.0' })
    expect(res.status).toBe(426)
    expect(res.body['error']).toMatch(/1\.0\.0.*2\.0\.0/)
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('turns an HttpError into its status code, merging its details into the body', async () => {
    const notFound = authed(() => Promise.reject(new NotFoundError('Game not found.')))
    const stale = authed(() => Promise.reject(new ConflictError('Stale.', { currentVersion: 7 })))
    expect(await call(notFound, { as: 'alice' })).toMatchObject({ status: 404, body: { error: 'Game not found.' } })
    expect(await call(stale, { as: 'alice' })).toMatchObject({ status: 409, body: { error: 'Stale.', currentVersion: 7 } })
  })

  it('does NOT swallow an unexpected error as a client error — it must surface as a 500', async () => {
    const broken = authed(() => Promise.reject(new Error('database is down')))
    await expect(call(broken, { as: 'alice' })).rejects.toThrow('database is down')
  })
})

describe('the game endpoints, end to end', () => {
  it('walks a game from creation through a first move, as two different people', async () => {
    // Alice creates a game.
    const created = await call(createGameHandler, { as: 'alice', body: { kind: 'two_player' } })
    expect(created.status).toBe(201)
    const code = created.body['inviteCode'] as string
    const gameId = created.body['gameId'] as string
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(created.body['seat']).toBe('player')

    // Bob joins with the code.
    const joined = await call(joinGameHandler, { as: 'bob', body: { code } })
    expect(joined).toMatchObject({ status: 200, body: { gameId, seat: 'opponent', status: 'active', version: 1 } })

    // Each sees the game in their list.
    expect(((await call(listGamesHandler, { as: 'alice' })).body['games'] as unknown[]).length).toBe(1)
    expect(((await call(listGamesHandler, { as: 'bob' })).body['games'] as unknown[]).length).toBe(1)

    // The first poll is the full view; it carries no move history.
    const first = await call(getGameHandler, { as: 'bob', params: { id: gameId } })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ changed: true, version: 1, seat: 'opponent' })
    expect((first.body['view'] as { viewer: string }).viewer).toBe('opponent')
    expect(first.body['moves']).toEqual([])

    // Whoever bids first makes a move.
    const { state } = (await t.db.query<{ state: GameState }>('SELECT state FROM games WHERE id = $1', [gameId])).rows[0]!
    const mover = state.turn === 'player' ? 'alice' : 'bob'
    const watcher = mover === 'alice' ? 'bob' : 'alice'
    const moved = await call(submitMoveHandler, {
      as: mover,
      params: { id: gameId },
      body: { intent: { type: 'bid', value: legalBids(state)[0] }, expectedVersion: 1 },
    })
    expect(moved).toMatchObject({ status: 200, body: { version: 2, seat: state.turn } })

    // The other player's next poll (from the version they last saw) shows exactly that move.
    const poll = await call(getGameHandler, { as: watcher, params: { id: gameId }, query: 'since=1' })
    expect(poll.body).toMatchObject({ changed: true, version: 2 })
    expect(poll.body['moves']).toEqual([{ version: 2, seat: state.turn, intent: { type: 'bid', value: legalBids(state)[0] } }])

    // ...and once they're caught up, polling is the cheap "nothing new".
    expect((await call(getGameHandler, { as: watcher, params: { id: gameId }, query: 'since=2' })).body).toEqual({
      changed: false,
      gameId,
      version: 2,
      status: 'active',
    })
  })

  it('tells a stale client the current version so it can recover', async () => {
    const created = await call(createGameHandler, { as: 'alice', body: { kind: 'two_player' } })
    await call(joinGameHandler, { as: 'bob', body: { code: created.body['inviteCode'] } })
    const res = await call(submitMoveHandler, {
      as: 'alice',
      params: { id: created.body['gameId'] as string },
      body: { intent: { type: 'bid', value: 9 }, expectedVersion: 0 },
    })
    expect(res).toMatchObject({ status: 409, body: { currentVersion: 1 } })
  })

  it('treats deal-next as bodyless: an empty body is fine, and it is refused (422) before a hand has finished', async () => {
    const created = await call(createGameHandler, { as: 'alice', body: { kind: 'two_player' } })
    await call(joinGameHandler, { as: 'bob', body: { code: created.body['inviteCode'] } })
    const res = await call(dealNextHandler, { as: 'alice', params: { id: created.body['gameId'] as string } })
    expect(res.status).toBe(422)
    expect(res.body['error']).toMatch(/not finished/i)
  })

  it.each([
    ['a body that is not JSON', 'kind=two_player', 400],
    ['no body at all', undefined, 400],
    ['an unknown kind', { kind: 'solitaire' }, 400],
    ['no kind', {}, 400],
  ])('rejects creating a game with %s', async (_label, body, status) => {
    const res = await call(createGameHandler, { as: 'alice', body })
    expect(res.status).toBe(status)
    expect((await t.db.query('SELECT 1 FROM games')).rows).toHaveLength(0)
  })

  it('rejects a bad poll parameter and an unknown game', async () => {
    expect((await call(getGameHandler, { as: 'alice', params: { id: 'x' }, query: 'since=abc' })).status).toBe(400)
    expect((await call(getGameHandler, { as: 'alice', params: { id: 'not-a-uuid' } })).status).toBe(404)
    expect((await call(getGameHandler, { as: 'alice', params: {} })).status).toBe(404)
  })

  it('is closed to anyone without a verified identity', async () => {
    expect((await call(createGameHandler, { body: { kind: 'two_player' } })).status).toBe(401)
    expect((await call(listGamesHandler, { as: 'forged' })).status).toBe(401)
    expect((await t.db.query('SELECT 1 FROM games')).rows).toHaveLength(0)
  })

  it('refuses every endpoint to an app version below the minimum, creating nothing', async () => {
    process.env['MIN_CLIENT_VERSION'] = '3.0.0'
    const res = await call(createGameHandler, { as: 'alice', body: { kind: 'two_player' }, appVersion: '2.9.9' })
    expect(res.status).toBe(426)
    expect((await t.db.query('SELECT 1 FROM games')).rows).toHaveLength(0)
  })

  it('creates a users row the first time someone is seen, but polling never writes to it afterwards', async () => {
    expect(await userRowCount()).toBe(0)
    await call(listGamesHandler, { as: 'dana' })
    expect(await userRowCount()).toBe(1)
    const seenAt = async () =>
      (await t.db.query<{ last_seen_at: Date }>("SELECT last_seen_at FROM users WHERE firebase_uid = 'firebase-dana'")).rows[0]!
        .last_seen_at.getTime()
    const before = await seenAt()
    await new Promise((resolve) => setTimeout(resolve, 15))
    for (let i = 0; i < 5; i++) await call(listGamesHandler, { as: 'dana' })
    expect(await userRowCount()).toBe(1)
    expect(await seenAt()).toBe(before)
  })

  it('lets a real database failure surface as an error instead of dressing it up as a client mistake', async () => {
    const down: Db = { ...t.db, query: () => Promise.reject(new Error('connection reset')) }
    _setDbForTests(down)
    await expect(call(listGamesHandler, { as: 'alice' })).rejects.toThrow('connection reset')
  })
})
