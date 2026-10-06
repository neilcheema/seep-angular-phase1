import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpRequest, InvocationContext } from '@azure/functions'
import { REQUIRED_SCHEMA, _resetHealthThrottleForTests, healthHandler } from '../functions/health'
import { type Db, _setDbForTests } from '../lib/db'
import { type TestDb, createTestDb, readMigration } from './helpers/test-db'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(() => {
  _resetHealthThrottleForTests()
  _setDbForTests(t.db)
})
afterEach(() => _setDbForTests(null))

const request = (query = '') => ({ query: new URLSearchParams(query), headers: new Headers() }) as unknown as HttpRequest
const context = () => {
  const warn = vi.fn()
  const error = vi.fn()
  return { ctx: { warn, error, log: vi.fn() } as unknown as InvocationContext, warn, error }
}
/** A database that counts how often it is asked anything. */
function counting(): { db: Db; queries: () => number } {
  let n = 0
  return { db: { ...t.db, query: ((sql: string, params?: unknown[]) => (n++, t.db.query(sql, params))) as Db['query'] }, queries: () => n }
}

describe('the plain health check (what an uptime monitor pings)', () => {
  it('answers ok without ever touching the database, so a monitor cannot keep Neon awake', async () => {
    const { db, queries } = counting()
    _setDbForTests(db)
    const res = await healthHandler(request(), context().ctx)
    expect(res).toMatchObject({ status: 200, jsonBody: { status: 'ok' } })
    expect(queries()).toBe(0)
  })

  it('still answers ok when the database is completely down: that is what makes it a check of the app itself', async () => {
    _setDbForTests({ ...t.db, query: () => Promise.reject(new Error('down')) })
    expect((await healthHandler(request(), context().ctx)).status).toBe(200)
  })

  it('needs no sign-in, is never cached, and says nothing but ok', async () => {
    const res = await healthHandler(request(), context().ctx)
    expect(res.headers).toMatchObject({ 'Cache-Control': 'no-store' })
    expect(Object.keys(res.jsonBody as object)).toEqual(['status'])
  })
})

describe('the deep health check (for people, smoke tests and a look right after a deploy)', () => {
  it('confirms the database is reachable and every migration has been run', async () => {
    const res = await healthHandler(request('deep=1'), context().ctx)
    expect(res).toMatchObject({ status: 200, jsonBody: { status: 'ok', database: 'ok', schema: 'ok' } })
  })

  it('knows every table the code relies on', () => {
    expect(Object.keys(REQUIRED_SCHEMA).sort()).toEqual(['deleted_accounts', 'games', 'move_log', 'rate_events', 'reactions', 'seats', 'users'])
  })

  it('says "out-of-date" if a migration was skipped, tells the logs exactly what is missing, and tells the caller nothing more', async () => {
    await t.db.query('ALTER TABLE rate_events RENAME TO rate_events_hidden')
    try {
      const { ctx, warn } = context()
      const res = await healthHandler(request('deep=1'), ctx)
      expect(res).toMatchObject({ status: 503, jsonBody: { status: 'degraded', database: 'ok', schema: 'out-of-date' } })
      expect(JSON.stringify(res.jsonBody)).not.toContain('rate_events')
      expect(String(warn.mock.calls[0]![0])).toMatch(/missing rate_events\.kind.*migration/)
    } finally {
      await t.db.query('ALTER TABLE rate_events_hidden RENAME TO rate_events')
    }
  })

  it('notices a missing column too, not only a missing table', async () => {
    await t.db.query('ALTER TABLE games RENAME COLUMN turn_started_at TO turn_started_at_hidden')
    try {
      const { ctx, warn } = context()
      expect((await healthHandler(request('deep=1'), ctx)).status).toBe(503)
      expect(String(warn.mock.calls[0]![0])).toContain('games.turn_started_at')
    } finally {
      await t.db.query('ALTER TABLE games RENAME COLUMN turn_started_at_hidden TO turn_started_at')
    }
  })

  it('notices that the name-comparison function is missing, so a forgotten migration 010 is caught', async () => {
    await t.raw.exec('DROP INDEX users_display_name_key; DROP FUNCTION seep_name_key(text)')
    try {
      const { ctx, warn } = context()
      expect((await healthHandler(request('deep=1'), ctx)).status).toBe(503)
      expect(String(warn.mock.calls[0]![0])).toContain('function seep_name_key')
    } finally {
      await t.raw.exec(readMigration('010_phase6_unique_names.sql'))
    }
  })

  it('notices that the reaction recipient column is missing, so a forgotten migration 009 is caught', async () => {
    await t.db.query('ALTER TABLE reactions RENAME COLUMN to_seat TO to_seat_hidden')
    try {
      const { ctx, warn } = context()
      expect((await healthHandler(request('deep=1'), ctx)).status).toBe(503)
      expect(String(warn.mock.calls[0]![0])).toContain('reactions.to_seat')
    } finally {
      await t.db.query('ALTER TABLE reactions RENAME COLUMN to_seat_hidden TO to_seat')
    }
  })

  it('notices that the rematch column is missing, so a forgotten migration 007 is caught', async () => {
    await t.db.query('ALTER TABLE games RENAME COLUMN rematch_game_id TO rematch_game_id_hidden')
    try {
      const { ctx, warn } = context()
      expect((await healthHandler(request('deep=1'), ctx)).status).toBe(503)
      expect(String(warn.mock.calls[0]![0])).toContain('games.rematch_game_id')
    } finally {
      await t.db.query('ALTER TABLE games RENAME COLUMN rematch_game_id_hidden TO rematch_game_id')
    }
  })

  it('says "down" if the database cannot be reached, logging the kind of failure but never its message', async () => {
    _setDbForTests({ ...t.db, query: () => Promise.reject(new Error('password authentication failed for user secret-user')) })
    const { ctx, error } = context()
    const res = await healthHandler(request('deep=1'), ctx)
    expect(res).toMatchObject({ status: 503, jsonBody: { status: 'degraded', database: 'down' } })
    expect(String(error.mock.calls[0]![0])).not.toContain('secret-user')
  })

  it('repeats the last answer for 30 seconds instead of querying again, so it cannot be used to hammer the database', async () => {
    const { db, queries } = counting()
    _setDbForTests(db)
    let clock = 1_000_000
    await healthHandler(request('deep=1'), context().ctx, () => clock)
    const afterFirst = queries()
    expect(afterFirst).toBeGreaterThan(0)
    for (let i = 0; i < 20; i++) await healthHandler(request('deep=1'), context().ctx, () => (clock += 1000)) // 20 seconds
    expect(queries()).toBe(afterFirst)
    clock += 11_000 // now 31 seconds after the first
    await healthHandler(request('deep=1'), context().ctx, () => clock)
    expect(queries()).toBeGreaterThan(afterFirst)
  })

  it('repeats a FAILURE too, so a database that is down is not asked again and again', async () => {
    let asked = 0
    _setDbForTests({ ...t.db, query: () => (asked++, Promise.reject(new Error('down'))) })
    let clock = 5_000_000
    await healthHandler(request('deep=1'), context().ctx, () => clock)
    await healthHandler(request('deep=1'), context().ctx, () => (clock += 5000))
    expect(asked).toBe(1)
  })
})
