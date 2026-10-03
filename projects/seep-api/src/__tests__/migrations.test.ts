import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type TestDb, createTestDb, makeUser, readMigration } from './helpers/test-db'

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

async function insertGame(overrides: { status?: string; code?: string | null; version?: number } = {}) {
  const user = await makeUser(t.db, 'u' + Math.random().toString(36).slice(2, 8))
  return t.db.query(
    `INSERT INTO games (kind, state, engine_version, status, invite_code, created_by, version)
     VALUES ('two_player', '{}'::jsonb, '1.0.0', $1, $2, $3, $4) RETURNING id`,
    [overrides.status ?? 'waiting', overrides.code === undefined ? null : overrides.code, user.id, overrides.version ?? 0],
  )
}

describe('phase 4 migration', () => {
  it('can be run a second time without error (it is applied by hand to every Neon branch)', async () => {
    await expect(t.raw.exec(readMigration('002_phase4_games.sql'))).resolves.toBeDefined()
  })

  it('refuses a status the application does not know', async () => {
    await expect(insertGame({ status: 'paused' })).rejects.toThrow(/games_status_check/)
  })

  it('refuses a negative version', async () => {
    await expect(insertGame({ version: -1 })).rejects.toThrow(/games_version_nonneg/)
  })

  it('refuses a duplicate invite code, with the Postgres unique-violation code the service relies on', async () => {
    await insertGame({ code: 'ABC234' })
    const err = await insertGame({ code: 'ABC234' }).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('23505')
  })

  it('allows any number of games without an invite code', async () => {
    await insertGame({ code: null })
    await expect(insertGame({ code: null })).resolves.toBeDefined()
  })

  it('distinguishes an open seat from a bot seat', async () => {
    const game = await insertGame()
    const gameId = (game.rows[0] as { id: string }).id
    await t.db.query("INSERT INTO seats (game_id, seat_key) VALUES ($1, 'player')", [gameId])
    await t.db.query("INSERT INTO seats (game_id, seat_key, is_bot) VALUES ($1, 'opponent', true)", [gameId])
    const seats = await t.db.query<{ seat_key: string; user_id: string | null; is_bot: boolean }>(
      'SELECT seat_key, user_id, is_bot FROM seats WHERE game_id = $1 ORDER BY seat_key',
      [gameId],
    )
    expect(seats.rows).toEqual([
      { seat_key: 'opponent', user_id: null, is_bot: true },
      { seat_key: 'player', user_id: null, is_bot: false },
    ])
  })

  it('allows a seat key only once per game', async () => {
    const game = await insertGame()
    const gameId = (game.rows[0] as { id: string }).id
    await t.db.query("INSERT INTO seats (game_id, seat_key) VALUES ($1, 'player')", [gameId])
    await expect(t.db.query("INSERT INTO seats (game_id, seat_key) VALUES ($1, 'player')", [gameId])).rejects.toThrow()
  })
})
