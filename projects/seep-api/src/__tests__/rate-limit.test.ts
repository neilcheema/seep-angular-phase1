import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteAccount } from '../lib/account'
import { RateLimitError } from '../lib/errors'
import { createGame, joinGame } from '../lib/games'
import { assertTableCaps, assertUnderLimit, hit, limitSettings, record, retryAfterSeconds } from '../lib/limits'
import { type TestDb, createTestDb, makeUser } from './helpers/test-db'

/** The limiter itself: counting, windows, fairness between people, and what it says when it refuses. */

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
})

const events = async (userId?: string) =>
  (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM rate_events ${userId ? 'WHERE user_id = $1' : ''}`, userId ? [userId] : [])).rows[0]!.n
const backdate = (userId: string, kind: string, secondsAgo: number) =>
  t.db.query(`INSERT INTO rate_events (user_id, kind, at) VALUES ($1, $2, now() - make_interval(secs => $3::float8))`, [userId, kind, secondsAgo])

describe('limitSettings', () => {
  it('has sensible defaults: generous for real play, tight for floods', () => {
    expect(limitSettings({})).toEqual({ enabled: true, createPerHour: 10, movesPerMinute: 120, failedJoinsPer10Min: 10, maxWaitingTables: 5, maxActiveTables: 20 })
  })
  it('can be tuned, or switched off, without a redeploy', () => {
    expect(limitSettings({ LIMIT_CREATE_PER_HOUR: '3', LIMIT_MOVES_PER_MINUTE: '30', LIMIT_FAILED_JOINS_PER_10_MIN: '4', LIMIT_MAX_WAITING_TABLES: '2', LIMIT_MAX_ACTIVE_TABLES: '7' })).toMatchObject({
      createPerHour: 3, movesPerMinute: 30, failedJoinsPer10Min: 4, maxWaitingTables: 2, maxActiveTables: 7,
    })
    expect(limitSettings({ LIMITS_ENABLED: 'false' }).enabled).toBe(false)
    expect(limitSettings({ LIMITS_ENABLED: 'FALSE' }).enabled).toBe(false)
  })
  it.each(['0', '-1', 'lots', '', '2.5'])('treats %j as a mistake and uses the default (a 0 must never mean "allow nobody")', (bad) => {
    expect(limitSettings({ LIMIT_CREATE_PER_HOUR: bad, LIMIT_MOVES_PER_MINUTE: bad })).toMatchObject({ createPerHour: 10, movesPerMinute: 120 })
  })
})

describe('hit', () => {
  it('lets a person do exactly `max` things in the window, then refuses the next with a 429', async () => {
    const a = await makeUser(t.db, 'a')
    for (let i = 0; i < 3; i++) await hit(t.db, a.id, 'create_game', 3, 3600)
    await expect(hit(t.db, a.id, 'create_game', 3, 3600)).rejects.toBeInstanceOf(RateLimitError)
    await expect(hit(t.db, a.id, 'create_game', 3, 3600)).rejects.toMatchObject({ status: 429 })
  })

  it('does not count a refused attempt, so being refused never makes the wait longer', async () => {
    const a = await makeUser(t.db, 'a')
    for (let i = 0; i < 2; i++) await hit(t.db, a.id, 'move', 2, 60)
    for (let i = 0; i < 5; i++) await expect(hit(t.db, a.id, 'move', 2, 60)).rejects.toBeInstanceOf(RateLimitError)
    expect(await events(a.id)).toBe(2)
  })

  it('stops counting an action once it is older than the window', async () => {
    const a = await makeUser(t.db, 'a')
    await backdate(a.id, 'move', 61)
    await backdate(a.id, 'move', 90)
    for (let i = 0; i < 2; i++) await hit(t.db, a.id, 'move', 2, 60) // the two old ones do not count
    await expect(hit(t.db, a.id, 'move', 2, 60)).rejects.toBeInstanceOf(RateLimitError)
  })

  it('says how long to wait: until the oldest counted action leaves the window', async () => {
    const a = await makeUser(t.db, 'a')
    await backdate(a.id, 'move', 50)
    await backdate(a.id, 'move', 20)
    const err = (await hit(t.db, a.id, 'move', 2, 60).catch((e: unknown) => e)) as RateLimitError
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.details['retryAfterSeconds']).toBeGreaterThanOrEqual(9)
    expect(err.details['retryAfterSeconds']).toBeLessThanOrEqual(11) // 60 - 50 = 10
    expect(err.message).toMatch(/too quickly/)
  })

  it('never tells someone to wait less than a second', async () => {
    const a = await makeUser(t.db, 'a')
    await backdate(a.id, 'move', 59.5) // half a second left in the window
    const err = (await hit(t.db, a.id, 'move', 1, 60).catch((e: unknown) => e)) as RateLimitError
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.details['retryAfterSeconds']).toBe(1) // about 0.5s left, rounded UP to a whole second, and never 0
  })

  it('keeps people apart: one person’s flood does not slow another', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    for (let i = 0; i < 2; i++) await hit(t.db, a.id, 'create_game', 2, 3600)
    await expect(hit(t.db, a.id, 'create_game', 2, 3600)).rejects.toBeInstanceOf(RateLimitError)
    await expect(hit(t.db, b.id, 'create_game', 2, 3600)).resolves.toBeUndefined()
  })

  it('keeps the kinds apart: creating tables does not use up the allowance for moves', async () => {
    const a = await makeUser(t.db, 'a')
    await hit(t.db, a.id, 'create_game', 1, 3600)
    await expect(hit(t.db, a.id, 'create_game', 1, 3600)).rejects.toBeInstanceOf(RateLimitError)
    await expect(hit(t.db, a.id, 'move', 1, 60)).resolves.toBeUndefined()
  })

  it('logs WHICH limit was reached but never who reached it', async () => {
    const a = await makeUser(t.db, 'a')
    const log = vi.fn()
    await hit(t.db, a.id, 'create_game', 1, 3600, log)
    await expect(hit(t.db, a.id, 'create_game', 1, 3600, log)).rejects.toBeInstanceOf(RateLimitError)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('Rate limit reached: create_game')
    expect(String(log.mock.calls[0]![0])).not.toContain(a.id)
  })
})

describe('assertUnderLimit and record (used for wrong table codes, which count only when they fail)', () => {
  it('does not count the check itself', async () => {
    const a = await makeUser(t.db, 'a')
    for (let i = 0; i < 10; i++) await assertUnderLimit(t.db, a.id, 'join_fail', 2, 600)
    expect(await events(a.id)).toBe(0)
  })

  it('refuses once enough have been recorded', async () => {
    const a = await makeUser(t.db, 'a')
    await record(t.db, a.id, 'join_fail')
    await assertUnderLimit(t.db, a.id, 'join_fail', 2, 600)
    await record(t.db, a.id, 'join_fail')
    await expect(assertUnderLimit(t.db, a.id, 'join_fail', 2, 600)).rejects.toMatchObject({ status: 429 })
  })

  it('lets them back in when the old attempts age out', async () => {
    const a = await makeUser(t.db, 'a')
    await backdate(a.id, 'join_fail', 601)
    await backdate(a.id, 'join_fail', 700)
    await expect(assertUnderLimit(t.db, a.id, 'join_fail', 2, 600)).resolves.toBeUndefined()
  })
})

describe('table caps', () => {
  const settings = limitSettings({ LIMIT_MAX_WAITING_TABLES: '2', LIMIT_MAX_ACTIVE_TABLES: '1' })

  it('refuses a new table once the person has too many waiting, naming the way out', async () => {
    const a = await makeUser(t.db, 'a')
    await createGame(t.db, a.id, 'two_player')
    await assertTableCaps(t.db, a.id, settings, 'create')
    await createGame(t.db, a.id, 'two_player')
    const err = (await assertTableCaps(t.db, a.id, settings, 'create').catch((e: unknown) => e)) as Error
    expect(err).toMatchObject({ status: 409 })
    expect(err.message).toMatch(/2 tables waiting.*Leave/)
  })

  it('counts only tables still waiting: a table in play or finished does not block a new one', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    const first = await createGame(t.db, a.id, 'two_player')
    await joinGame(t.db, b.id, first.inviteCode) // now active
    await createGame(t.db, a.id, 'two_player') // 1 waiting
    await expect(assertTableCaps(t.db, a.id, settings, 'create')).resolves.toBeUndefined()
  })

  it('refuses joining another match once the person is playing too many', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    const first = await createGame(t.db, a.id, 'two_player')
    await joinGame(t.db, b.id, first.inviteCode)
    await expect(assertTableCaps(t.db, b.id, settings, 'join')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already playing 1 matches/) })
  })

  it('does not look at other people’s tables', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    for (let i = 0; i < 3; i++) await createGame(t.db, a.id, 'two_player')
    await expect(assertTableCaps(t.db, b.id, settings, 'create')).resolves.toBeUndefined()
  })
})

describe('housekeeping', () => {
  it('rate-limit rows go with the person when their account is deleted', async () => {
    const a = await makeUser(t.db, 'a')
    await hit(t.db, a.id, 'create_game', 5, 3600)
    const uid = (await t.db.query<{ firebase_uid: string }>('SELECT firebase_uid FROM users WHERE id = $1', [a.id])).rows[0]!.firebase_uid
    expect(await events()).toBe(1)
    await deleteAccount(t.db, uid)
    expect(await events()).toBe(0)
  })
})

describe('retryAfterSeconds', () => {
  it('is the time until the oldest counted action leaves the window, rounded UP to a whole second', () => {
    expect(retryAfterSeconds(60, 10)).toBe(50)
    expect(retryAfterSeconds(60, 10.2)).toBe(50) // 49.8 seconds left: tell them 50, not 49
    expect(retryAfterSeconds(600, null)).toBe(600)
  })
  it('is never less than one second, even if the action has already aged out (a client told 0 would just hammer again)', () => {
    expect(retryAfterSeconds(60, 59.5)).toBe(1)
    expect(retryAfterSeconds(60, 60)).toBe(1)
    expect(retryAfterSeconds(60, 75)).toBe(1)
  })
})

