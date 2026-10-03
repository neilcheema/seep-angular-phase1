import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvocationContext, Timer } from '@azure/functions'
import { cleanupHandler } from '../functions/cleanup'
import { cleanupSettings, formatSize, runCleanup } from '../lib/cleanup'
import { type Db, _setDbForTests } from '../lib/db'
import { ConflictError } from '../lib/errors'
import { createGame, getGame, joinGame, submitMove } from '../lib/games'
import { aiIntent } from './helpers/play'
import { type TestDb, createTestDb, makeUser } from './helpers/test-db'

/**
 * The daily cleanup. Postgres owns the time (now()), so a test makes a table "N days old"
 * with one statement and checks exactly what each stage does at each boundary.
 */

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
afterEach(() => {
  _setDbForTests(null)
  for (const name of Object.keys(process.env).filter((k) => k.startsWith('CLEANUP_'))) delete process.env[name]
})

const settings = (over: Record<string, string> = {}) => cleanupSettings(over)

interface TableOptions {
  status: 'waiting' | 'active' | 'finished' | 'abandoned'
  /** How long since anything changed at the table (fractions allowed). */
  idleDays: number
  /** Per seat: how many days ago it was last seen (null: never). */
  seen?: (number | null)[]
  moves?: number
  code?: string | null
}

let counter = 0
async function makeTable(opts: TableOptions): Promise<string> {
  counter++
  const user = await makeUser(t.db, `u${counter}`)
  const game = await t.db.query<{ id: string }>(
    `INSERT INTO games (kind, state, engine_version, status, invite_code, created_by, version, updated_at)
     VALUES ('two_player', '{}'::jsonb, '1.0.0', $1, $2, $3, 5, now() - make_interval(secs => $4::float8 * 86400))
     RETURNING id`,
    [opts.status, opts.code === undefined ? `CODE${counter}`.slice(0, 6).padEnd(6, 'X') : opts.code, user.id, opts.idleDays],
  )
  const id = game.rows[0]!.id
  const seen = opts.seen ?? [null, null]
  for (const [i, seatKey] of ['player', 'opponent'].entries()) {
    await t.db.query(
      `INSERT INTO seats (game_id, seat_key, user_id, last_seen_at)
       VALUES ($1, $2, $3, CASE WHEN $4::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $4::float8 * 86400) END)`,
      [id, seatKey, user.id, seen[i] ?? null],
    )
  }
  for (let m = 0; m < (opts.moves ?? 0); m++) {
    await t.db.query(`INSERT INTO move_log (game_id, seat_key, intent, version) VALUES ($1, 'player', '{"type":"throw"}'::jsonb, $2)`, [id, m + 1])
  }
  return id
}

const statusOf = async (id: string) => (await t.db.query<{ status: string }>('SELECT status FROM games WHERE id = $1', [id])).rows[0]?.status ?? null
const count = async (table: string, where = 'true') => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0]!.n

describe('cleanupSettings', () => {
  it('closes idle tables after a week and deletes them a month later, by default', () => {
    expect(settings()).toMatchObject({ enabled: true, dryRun: false, abandonAfterDays: 7, deleteAfterDays: 30, batchSize: 200, sizeWarnMb: 300 })
  })

  it('can be tuned, or switched off, or run as a dry run, without a redeploy', () => {
    expect(settings({ CLEANUP_ABANDON_DAYS: '3', CLEANUP_DELETE_DAYS: '14', CLEANUP_BATCH_SIZE: '50', CLEANUP_SIZE_WARN_MB: '100' })).toMatchObject({
      abandonAfterDays: 3,
      deleteAfterDays: 14,
      batchSize: 50,
      sizeWarnMb: 100,
    })
    expect(settings({ CLEANUP_ENABLED: 'false' }).enabled).toBe(false)
    expect(settings({ CLEANUP_ENABLED: 'FALSE' }).enabled).toBe(false)
    expect(settings({ CLEANUP_DRY_RUN: 'true' }).dryRun).toBe(true)
  })

  it.each(['0', '-3', 'soon', '', '1.5', ' '])('treats %j as a mistake and falls back to the default (a typo must never mean "close everything now")', (bad) => {
    expect(settings({ CLEANUP_ABANDON_DAYS: bad, CLEANUP_DELETE_DAYS: bad })).toMatchObject({ abandonAfterDays: 7, deleteAfterDays: 30 })
  })

  it('caps the batch size', () => {
    expect(settings({ CLEANUP_BATCH_SIZE: '999999' }).batchSize).toBe(1000)
  })
})

describe('stage 1: closing tables nobody is using', () => {
  it('closes a table still waiting for an opponent after a week, but not a day earlier', async () => {
    const stale = await makeTable({ status: 'waiting', idleDays: 7.1 })
    const fresh = await makeTable({ status: 'waiting', idleDays: 6.9 })
    const result = await runCleanup(t.db, settings())
    expect(result.abandoned).toBe(1)
    expect(await statusOf(stale)).toBe('abandoned')
    expect(await statusOf(fresh)).toBe('waiting')
  })

  it('closes an idle game in progress, and leaves one that was played at recently', async () => {
    const idle = await makeTable({ status: 'active', idleDays: 20 })
    const live = await makeTable({ status: 'active', idleDays: 0.01 })
    await runCleanup(t.db, settings())
    expect(await statusOf(idle)).toBe('abandoned')
    expect(await statusOf(live)).toBe('active')
  })

  it('leaves a table alone if either player has looked at it within the week, even if nobody has moved', async () => {
    const watched = await makeTable({ status: 'active', idleDays: 30, seen: [null, 2] })
    const forgotten = await makeTable({ status: 'active', idleDays: 30, seen: [20, null] })
    await runCleanup(t.db, settings())
    expect(await statusOf(watched)).toBe('active')
    expect(await statusOf(forgotten)).toBe('abandoned')
  })

  it('does not touch tables that are already over', async () => {
    const finished = await makeTable({ status: 'finished', idleDays: 20 })
    const closed = await makeTable({ status: 'abandoned', idleDays: 20 })
    const result = await runCleanup(t.db, settings())
    expect(result.abandoned).toBe(0)
    expect(await statusOf(finished)).toBe('finished')
    expect(await statusOf(closed)).toBe('abandoned')
  })

  it('moves the version, so anyone polling the table hears that it changed', async () => {
    const id = await makeTable({ status: 'waiting', idleDays: 10 })
    await runCleanup(t.db, settings())
    expect((await t.db.query<{ version: number }>('SELECT version FROM games WHERE id = $1', [id])).rows[0]!.version).toBe(6)
  })
})

describe('stage 2: deleting old tables', () => {
  it('deletes a finished table after a month, with its seats and move log, and keeps a younger one', async () => {
    const old = await makeTable({ status: 'finished', idleDays: 31, moves: 5 })
    const young = await makeTable({ status: 'finished', idleDays: 29, moves: 5 })
    const result = await runCleanup(t.db, settings())

    expect(result.deleted).toBe(1)
    expect(await statusOf(old)).toBeNull()
    expect(await statusOf(young)).toBe('finished')
    expect(await count('seats', `game_id = '${old}'`)).toBe(0)
    expect(await count('move_log', `game_id = '${old}'`)).toBe(0)
    expect(await count('seats', `game_id = '${young}'`)).toBe(2)
    expect(await count('move_log', `game_id = '${young}'`)).toBe(5)
  })

  it('never deletes a table that is still in play, however old it is, as long as somebody has looked at it', async () => {
    const live = await makeTable({ status: 'active', idleDays: 200, seen: [1, null], moves: 4 })
    const waiting = await makeTable({ status: 'waiting', idleDays: 200, seen: [null, 3] })
    const result = await runCleanup(t.db, settings())
    expect(result).toMatchObject({ abandoned: 0, deleted: 0 })
    expect(await statusOf(live)).toBe('active')
    expect(await statusOf(waiting)).toBe('waiting')
    expect(await count('move_log', `game_id = '${live}'`)).toBe(4)
  })

  it('leaves no orphaned seats or moves behind, and does not touch any user', async () => {
    for (let i = 0; i < 4; i++) await makeTable({ status: 'finished', idleDays: 40 + i, moves: 3 })
    const users = await count('users')
    await runCleanup(t.db, settings())
    expect(await count('games')).toBe(0)
    expect(await count('seats')).toBe(0)
    expect(await count('move_log')).toBe(0)
    expect(await count('users')).toBe(users)
  })

  it('counts a month from when a table was closed, not from when it was made: idle tables get two stages, never one', async () => {
    const id = await makeTable({ status: 'active', idleDays: 100 })
    const first = await runCleanup(t.db, settings())
    expect(first).toMatchObject({ abandoned: 1, deleted: 0 })
    expect(await statusOf(id)).toBe('abandoned') // closed now, with a month's notice before it goes

    expect((await runCleanup(t.db, settings())).deleted).toBe(0) // still there on the next run

    await t.db.query(`UPDATE games SET updated_at = now() - interval '31 days' WHERE id = $1`, [id]) // a month passes
    expect((await runCleanup(t.db, settings())).deleted).toBe(1)
    expect(await statusOf(id)).toBeNull()
  })

  it('frees the invite code of a deleted table', async () => {
    await makeTable({ status: 'finished', idleDays: 45, code: 'ZZZZZZ' })
    await runCleanup(t.db, settings())
    await expect(makeTable({ status: 'waiting', idleDays: 0, code: 'ZZZZZZ' })).resolves.toBeDefined()
  })

  it('works through a large backlog in batches', async () => {
    for (let i = 0; i < 25; i++) await makeTable({ status: 'finished', idleDays: 60, code: null })
    const result = await runCleanup(t.db, settings({ CLEANUP_BATCH_SIZE: '10' }))
    expect(result.deleted).toBe(25)
    expect(result.batches).toBe(3) // 10 + 10 + 5
    expect(await count('games')).toBe(0)
  })

  it('stops at a full batch boundary without looping forever', async () => {
    for (let i = 0; i < 20; i++) await makeTable({ status: 'finished', idleDays: 60, code: null })
    const result = await runCleanup(t.db, settings({ CLEANUP_BATCH_SIZE: '10' }))
    expect(result).toMatchObject({ deleted: 20, batches: 3 }) // 10 + 10 + an empty check
  })
})

describe('running it safely', () => {
  it('does nothing the second time', async () => {
    await makeTable({ status: 'waiting', idleDays: 9 })
    await makeTable({ status: 'finished', idleDays: 50 })
    expect(await runCleanup(t.db, settings())).toMatchObject({ abandoned: 1, deleted: 1 })
    expect(await runCleanup(t.db, settings())).toMatchObject({ abandoned: 0, deleted: 0 })
  })

  it('reports what it would do in a dry run, and changes nothing', async () => {
    const idle = await makeTable({ status: 'waiting', idleDays: 9 })
    const old = await makeTable({ status: 'finished', idleDays: 50, moves: 2 })
    const result = await runCleanup(t.db, settings({ CLEANUP_DRY_RUN: 'true' }))
    expect(result).toMatchObject({ dryRun: true, abandoned: 1, deleted: 1, skipped: false })
    expect(await statusOf(idle)).toBe('waiting')
    expect(await statusOf(old)).toBe('finished')
    expect(await count('move_log')).toBe(2)
  })

  it('does nothing at all when switched off', async () => {
    const old = await makeTable({ status: 'finished', idleDays: 50 })
    const result = await runCleanup(t.db, settings({ CLEANUP_ENABLED: 'false' }))
    expect(result).toMatchObject({ skipped: true, abandoned: 0, deleted: 0 })
    expect(await statusOf(old)).toBe('finished')
  })

  it('never lets a table that was just played at be closed: a move bumps its age back to zero', async () => {
    const id = await makeTable({ status: 'active', idleDays: 30 })
    await t.db.query(`UPDATE games SET updated_at = now() WHERE id = $1`, [id]) // a move lands before the cleanup runs
    await runCleanup(t.db, settings())
    expect(await statusOf(id)).toBe('active')
  })

  it('reports the database size before and after, and warns when it is above the level you set', async () => {
    const result = await runCleanup(t.db, settings({ CLEANUP_SIZE_WARN_MB: '1' }))
    expect(result.sizeBytesBefore).toBeGreaterThan(0)
    expect(result.sizeBytesAfter).toBeGreaterThan(0)
    expect(result.sizeWarning).toBe(true) // a real Postgres is several MB even when empty
    expect((await runCleanup(t.db, settings({ CLEANUP_SIZE_WARN_MB: '100000' }))).sizeWarning).toBe(false)
  })

  it('formats sizes for the log', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatSize(null)).toBe('unknown')
  })
})

describe('what players experience around a closed table', () => {
  async function realTable() {
    const a = await makeUser(t.db, 'alice')
    const b = await makeUser(t.db, 'bob')
    const created = await createGame(t.db, a.id, 'two_player')
    await joinGame(t.db, b.id, created.inviteCode)
    return { a, b, gameId: created.gameId }
  }

  it('still lets a player open a table that was closed, and shows it as closed, with the version moved on', async () => {
    const { a, gameId } = await realTable()
    await t.db.query(`UPDATE games SET updated_at = now() - interval '9 days' WHERE id = $1`, [gameId])
    await t.db.query(`UPDATE seats SET last_seen_at = NULL WHERE game_id = $1`, [gameId])
    await runCleanup(t.db, settings())

    const snap = await getGame(t.db, a.id, gameId, 1)
    expect(snap).toMatchObject({ changed: true, status: 'abandoned', version: 2 })
  })

  it('refuses moves at a closed table, and refuses a late arrival with a clear reason', async () => {
    const { a, gameId } = await realTable()
    const state = (await t.db.query<{ state: Parameters<typeof aiIntent>[1] }>('SELECT state FROM games WHERE id = $1', [gameId])).rows[0]!.state
    await t.db.query(`UPDATE games SET updated_at = now() - interval '9 days' WHERE id = $1`, [gameId])
    await t.db.query(`UPDATE seats SET last_seen_at = NULL WHERE game_id = $1`, [gameId])
    await runCleanup(t.db, settings())

    await expect(submitMove(t.db, a.id, gameId, aiIntent('two_player', state))).rejects.toBeInstanceOf(ConflictError)

    const code = (await t.db.query<{ invite_code: string }>('SELECT invite_code FROM games WHERE id = $1', [gameId])).rows[0]!.invite_code
    const carol = await makeUser(t.db, 'carol')
    await expect(joinGame(t.db, carol.id, code)).rejects.toMatchObject({ status: 409, message: 'That game is no longer open.' })
  })

  it('a table someone has open (so they are being seen) is never closed from under them', async () => {
    const { a, gameId } = await realTable()
    await t.db.query(`UPDATE games SET updated_at = now() - interval '30 days' WHERE id = $1`, [gameId])
    await getGame(t.db, a.id, gameId) // a poll from the player's open screen records that they are here
    await runCleanup(t.db, settings())
    expect((await getGame(t.db, a.id, gameId)) as { status: string }).toMatchObject({ status: 'active' })
  })
})

describe('the daily timer', () => {
  const context = () => ({ log: vi.fn(), warn: vi.fn() })
  const asContext = (c: ReturnType<typeof context>) => c as unknown as InvocationContext
  const timer = (isPastDue = false) => ({ isPastDue }) as unknown as Timer

  it('runs the cleanup and logs what it did, in words, with the database size', async () => {
    _setDbForTests(t.db)
    await makeTable({ status: 'waiting', idleDays: 9 })
    await makeTable({ status: 'finished', idleDays: 50 })
    const c = context()
    await cleanupHandler(timer(), asContext(c))
    const text = c.log.mock.calls.map((x) => String(x[0])).join('\n')
    expect(text).toMatch(/Cleanup closed 1 idle table\(s\) and deleted 1 old table\(s\) in 1 batch\(es\)/)
    expect(text).toMatch(/Database size: [\d.]+ MB before, [\d.]+ MB after/)
    expect(c.warn).not.toHaveBeenCalled()
  })

  it('says so when it runs late, because the app was asleep at the scheduled time', async () => {
    _setDbForTests(t.db)
    const c = context()
    await cleanupHandler(timer(true), asContext(c))
    expect(c.log.mock.calls.map((x) => String(x[0])).join('\n')).toMatch(/running late/)
  })

  it('labels a dry run clearly, and says when it is switched off', async () => {
    _setDbForTests(t.db)
    process.env['CLEANUP_DRY_RUN'] = 'true'
    const dry = context()
    await cleanupHandler(timer(), asContext(dry))
    expect(dry.log.mock.calls.map((x) => String(x[0])).join('\n')).toMatch(/DRY RUN, would have closed/)
    process.env['CLEANUP_ENABLED'] = 'false'
    const off = context()
    await cleanupHandler(timer(), asContext(off))
    expect(off.log.mock.calls.map((x) => String(x[0])).join('\n')).toMatch(/switched off/)
  })

  it('warns when the database is above the level you set, mentioning the 0.5 GB limit', async () => {
    _setDbForTests(t.db)
    process.env['CLEANUP_SIZE_WARN_MB'] = '1'
    const c = context()
    await cleanupHandler(timer(), asContext(c))
    expect(String(c.warn.mock.calls[0]?.[0])).toMatch(/above the 1 MB warning level.*0\.5 GB/)
  })

  it('lets a database failure fail the run, so it shows up in Application Insights', async () => {
    const broken: Db = { ...t.db, query: () => Promise.reject(new Error('connection reset')), transaction: t.db.transaction }
    _setDbForTests(broken)
    // The size probe swallows its own failure, but the cleanup statements themselves must not be swallowed.
    await expect(cleanupHandler(timer(), asContext(context()))).rejects.toThrow('connection reset')
  })
})
