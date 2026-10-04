import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { AuthError } from '../lib/auth'
import { _setDbForTests } from '../lib/db'
import { me } from '../functions/me'
import { type GameSnapshot, createGame, getGame, joinGame } from '../lib/games'
import { call } from './helpers/http'
import { type TestDb, createTestDb, makeUser } from './helpers/test-db'

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
  delete process.env['MIN_CLIENT_VERSION']
  verifyMock.mockReset()
  _setDbForTests(null)
})

const identity = (uid: string, email: string | null) => ({ uid, email, emailVerified: true })

describe('POST /v1/me', () => {
  it('creates a profile the first time someone signs in, and returns it', async () => {
    verifyMock.mockResolvedValue(identity('uid-123', 'a@b.com'))

    const res = await call(me, { as: 'whatever' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ displayName: null, email: 'a@b.com' })
    expect(res.body['id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.body['createdAt']).toBeTruthy()
    const rows = await t.db.query('SELECT firebase_uid, email FROM users')
    expect(rows.rows).toEqual([{ firebase_uid: 'uid-123', email: 'a@b.com' }])
  })

  it('returns the same profile on every later sign-in, moving last_seen_at forward and refreshing the email', async () => {
    verifyMock.mockResolvedValue(identity('uid-123', 'old@b.com'))
    const first = await call(me, { as: 'x' })
    const firstSeen = (await t.db.query<{ last_seen_at: Date }>('SELECT last_seen_at FROM users')).rows[0]!.last_seen_at

    await new Promise((resolve) => setTimeout(resolve, 15))
    verifyMock.mockResolvedValue(identity('uid-123', 'new@b.com'))
    const second = await call(me, { as: 'x' })

    expect(second.body['id']).toBe(first.body['id'])
    expect(second.body['createdAt']).toEqual(first.body['createdAt'])
    expect(second.body['email']).toBe('new@b.com')
    const rows = await t.db.query<{ last_seen_at: Date; email: string }>('SELECT last_seen_at, email FROM users')
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]!.last_seen_at.getTime()).toBeGreaterThan(firstSeen.getTime())
    expect(rows.rows[0]!.email).toBe('new@b.com')
  })

  it('stores a missing email as null rather than failing', async () => {
    verifyMock.mockResolvedValue(identity('uid-no-email', null))
    const res = await call(me, { as: 'x' })
    expect(res.status).toBe(200)
    expect(res.body['email']).toBeNull()
  })

  it('answers 401 for a bad token, logs why (not the token), and never touches the database', async () => {
    verifyMock.mockRejectedValue(new AuthError('bad token'))
    const res = await call(me, { as: 'secret-token-value' })
    expect(res).toMatchObject({ status: 401, body: { error: 'bad token' } })
    expect(res.log).toHaveBeenCalledWith(expect.stringContaining('bad token'))
    expect(res.log).not.toHaveBeenCalledWith(expect.stringContaining('secret-token-value'))
    expect((await t.db.query('SELECT 1 FROM users')).rows).toHaveLength(0)
  })

  it('answers 426 for an app version below MIN_CLIENT_VERSION, logging it, without verifying or writing anything', async () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    const res = await call(me, { as: 'x', appVersion: '1.0.0' })
    expect(res.status).toBe(426)
    expect(res.body['error']).toBe('This app version (1.0.0) is no longer supported. Minimum required: 2.0.0.')
    expect(res.log).toHaveBeenCalledWith(expect.stringContaining('1.0.0'))
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it('proceeds normally when a minimum is set but the client sends no version header', async () => {
    process.env['MIN_CLIENT_VERSION'] = '2.0.0'
    verifyMock.mockResolvedValue(identity('uid-9', null))
    expect((await call(me, { as: 'x' })).status).toBe(200)
  })
})

describe('POST /v1/me: the name a person plays under', () => {
  const stored = async () => (await t.db.query<{ display_name: string | null }>('SELECT display_name FROM users')).rows[0]?.display_name ?? null

  it('has no name until the person chooses one', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    expect((await call(me, { as: 'x' })).body['displayName']).toBeNull()
  })

  it('saves a name sent with the call, tidied, and returns it', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    const res = await call(me, { as: 'x', body: { displayName: '  Mary   Ann ' } })
    expect(res.status).toBe(200)
    expect(res.body['displayName']).toBe('Mary Ann')
    expect(await stored()).toBe('Mary Ann')
  })

  it('keeps the name when a later sign-in call carries none, so signing in can never erase it', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    await call(me, { as: 'x', body: { displayName: 'Alice' } })
    expect((await call(me, { as: 'x' })).body['displayName']).toBe('Alice')
    expect((await call(me, { as: 'x', body: {} })).body['displayName']).toBe('Alice')
    expect(await stored()).toBe('Alice')
  })

  it('lets the person change it', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    await call(me, { as: 'x', body: { displayName: 'Alice' } })
    expect((await call(me, { as: 'x', body: { displayName: 'Alicia' } })).body['displayName']).toBe('Alicia')
  })

  it.each([
    ['too short', 'A'],
    ['too long', 'A'.repeat(21)],
    ['markup', '<b>Bob</b>'],
    ['a link', 'http://evil.example'],
    ['not text', 42],
  ])('refuses a name that is %s, and leaves the existing name alone', async (_label, bad) => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    await call(me, { as: 'x', body: { displayName: 'Alice' } })
    const res = await call(me, { as: 'x', body: { displayName: bad } })
    expect(res.status).toBe(400)
    expect(typeof res.body['error']).toBe('string')
    expect(await stored()).toBe('Alice')
  })

  it.each(['[]', '"Alice"', '42', 'null'])('refuses a body that is not a JSON object (%s)', async (raw) => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    expect((await call(me, { as: 'x', body: raw })).status).toBe(400)
  })

  it('refuses a body that is not valid JSON', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    expect((await call(me, { as: 'x', body: '{oops' })).status).toBe(400)
  })

  it('accepts names in other scripts', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    expect((await call(me, { as: 'x', body: { displayName: 'ਨਰਿੰਦਰ' } })).body['displayName']).toBe('ਨਰਿੰਦਰ')
  })

  it('does not touch the email or the sign-in time handling', async () => {
    verifyMock.mockResolvedValue(identity('uid-1', 'a@b.com'))
    const first = await call(me, { as: 'x', body: { displayName: 'Alice' } })
    verifyMock.mockResolvedValue(identity('uid-1', 'new@b.com'))
    const second = await call(me, { as: 'x' })
    expect(second.body['id']).toBe(first.body['id'])
    expect(second.body['email']).toBe('new@b.com')
  })

  it('shows up for the other player in the table’s player list', async () => {
    verifyMock.mockResolvedValue(identity('uid-alice', 'alice@b.com'))
    const aliceId = (await call(me, { as: 'x', body: { displayName: 'Alice' } })).body['id'] as string
    const bob = await makeUser(t.db, 'bob')
    const created = await createGame(t.db, aliceId, 'two_player')
    await joinGame(t.db, bob.id, created.inviteCode)

    const seenByBob = (await getGame(t.db, bob.id, created.gameId)) as GameSnapshot
    expect(seenByBob.players.map((p) => [p.seat, p.displayName, p.isYou])).toEqual([
      ['player', 'Alice', false],
      ['opponent', null, true], // Bob has not chosen a name
    ])
  })
})
