import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FourPlayerGameState, GameState } from 'seep-engine'
import { teamOf } from 'seep-engine'
import type { Db } from '../lib/db'
import { ConflictError } from '../lib/errors'
import { type GameSnapshot, type GameUnchanged, createGame, getGame, joinGame, submitMove } from '../lib/games'
import { aiIntent } from './helpers/play'
import { type TestDb, type TestUser, createTestDb, makeUser } from './helpers/test-db'

/**
 * The turn clock. Postgres keeps the time (now()), so a test ages a game with one UPDATE and then
 * checks exactly what each kind of request does at each boundary.
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
  delete process.env['TURN_WARN_SECONDS']
  delete process.env['TURN_FORFEIT_SECONDS']
})

async function table() {
  const a = await makeUser(t.db, 'alice')
  const b = await makeUser(t.db, 'bob')
  const created = await createGame(t.db, a.id, 'two_player')
  await joinGame(t.db, b.id, created.inviteCode)
  const users: Record<string, TestUser> = { player: a, opponent: b }
  const row = await raw(created.gameId)
  const mover = row.state.turn as string
  const waiter = mover === 'player' ? 'opponent' : 'player'
  return { gameId: created.gameId, users, mover, waiter, moverUser: users[mover]!, waiterUser: users[waiter]! }
}

async function raw(gameId: string) {
  return (await t.db.query<{ state: GameState; status: string; version: number }>('SELECT state, status, version FROM games WHERE id = $1', [gameId])).rows[0]!
}
const age = (gameId: string, seconds: number) =>
  t.db.query('UPDATE games SET turn_started_at = now() - make_interval(secs => $2::float8) WHERE id = $1', [gameId, seconds])
/** Pretend a player was last at the table `secondsAgo` ago (null: never). */
const seenAgo = (gameId: string, seat: string, secondsAgo: number | null) =>
  t.db.query(
    'UPDATE seats SET last_seen_at = CASE WHEN $3::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $3::float8) END WHERE game_id = $1 AND seat_key = $2',
    [gameId, seat, secondsAgo],
  )
const lastSeen = async (gameId: string, seat: string) =>
  (await t.db.query<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM seats WHERE game_id = $1 AND seat_key = $2', [gameId, seat])).rows[0]!.last_seen_at
const moveLog = async (gameId: string) =>
  (await t.db.query<{ seat_key: string; intent: { type: string }; version: number }>('SELECT seat_key, intent, version FROM move_log WHERE game_id = $1 ORDER BY version', [gameId])).rows

describe('the clock is reported to every poll', () => {
  it("starts the first mover's clock when the opponent joins", async () => {
    const { gameId, moverUser, mover } = await table()
    const snap = (await getGame(t.db, moverUser.id, gameId)) as GameSnapshot
    expect(snap.clock).toMatchObject({ seat: mover, warnAfterMs: 60_000, forfeitAfterMs: 120_000 })
    expect(snap.clock.elapsedMs).toBeLessThan(5_000)
  })

  it('shows no clock while a table is still waiting for an opponent', async () => {
    const a = await makeUser(t.db, 'alice')
    const created = await createGame(t.db, a.id, 'two_player')
    await age(created.gameId, 600)
    const snap = (await getGame(t.db, a.id, created.gameId)) as GameSnapshot
    expect(snap.clock.seat).toBeNull()
    expect(snap.clock.elapsedMs).toBe(0)
  })

  it('does not start the clock until the opponent actually joins, however long the table waited', async () => {
    const a = await makeUser(t.db, 'alice')
    const b = await makeUser(t.db, 'bob')
    const created = await createGame(t.db, a.id, 'two_player')
    await age(created.gameId, 3 * 3600) // waited three hours for a friend
    await joinGame(t.db, b.id, created.inviteCode)
    const snap = (await getGame(t.db, a.id, created.gameId)) as GameSnapshot
    expect(snap.clock.elapsedMs).toBeLessThan(5_000)
  })

  it('reports the running time as measured by the server', async () => {
    const { gameId, moverUser } = await table()
    await age(gameId, 42)
    const snap = (await getGame(t.db, moverUser.id, gameId)) as GameSnapshot
    expect(snap.clock.elapsedMs).toBeGreaterThanOrEqual(42_000)
    expect(snap.clock.elapsedMs).toBeLessThan(47_000)
  })

  it('stops the clock between hands: nobody is on it at "hand over"', async () => {
    const { gameId, waiterUser } = await table()
    await t.db.query(`UPDATE games SET state = jsonb_set(state, '{phase}', '"hand-over"') WHERE id = $1`, [gameId])
    await age(gameId, 3600)
    await seenAgo(gameId, 'player', 1)
    await seenAgo(gameId, 'opponent', 1)
    const snap = (await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot
    expect(snap.clock.seat).toBeNull()
    expect(snap.status).toBe('active') // an hour at the "deal next hand" screen forfeits nobody
  })

  it("restarts with every move, and the move's reply already carries the next mover's fresh clock", async () => {
    const { gameId, moverUser, mover, state } = await (async () => {
      const x = await table()
      return { ...x, state: (await raw(x.gameId)).state }
    })()
    await age(gameId, 55)
    const reply = await submitMove(t.db, moverUser.id, gameId, aiIntent('two_player', state))
    expect(reply.clock).toMatchObject({ elapsedMs: 0, warnAfterMs: 60_000, forfeitAfterMs: 120_000 })
    expect(reply.clock.seat).toBe(mover) // the bidder bids, then also makes the opening move
    const snap = (await getGame(t.db, moverUser.id, gameId)) as GameSnapshot
    expect(snap.clock.elapsedMs).toBeLessThan(5_000)
  })
})

describe('forfeit: only in front of a witness', () => {
  it('forfeits the mover when time is up and the waiting player is there to see it', async () => {
    const { gameId, mover, waiter, moverUser, waiterUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 121)
    const before = (await raw(gameId)).version

    const snap = (await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot

    expect(snap.status).toBe('finished')
    expect(snap.version).toBe(before + 1)
    expect((snap.view as { phase: string; winner: string }).phase).toBe('match-over')
    expect((snap.view as { winner: string }).winner).toBe(waiter) // the waiting player wins
    expect(snap.clock.seat).toBeNull()
    expect(await moveLog(gameId)).toEqual([{ seat_key: mover, intent: { type: 'forfeit', reason: 'timeout' }, version: before + 1 }])

    // The loser finds out on their next look, in their own words, and can no longer move.
    const loserSnap = (await getGame(t.db, moverUser.id, gameId)) as GameSnapshot
    expect(loserSnap.status).toBe('finished')
    expect((loserSnap.view as { log: string[] }).log.at(-1)).toMatch(/ran out of time and forfeited the match/)
    await expect(submitMove(t.db, moverUser.id, gameId, { type: 'bid', value: 9 })).rejects.toBeInstanceOf(ConflictError)
  })

  it('says "You ran out of time" to the player who did, and "Opponent ran out of time" to the other', async () => {
    const { gameId, mover, waiter, moverUser, waiterUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 130)
    const winnerView = ((await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot).view as { log: string[] }
    const loserView = ((await getGame(t.db, moverUser.id, gameId)) as GameSnapshot).view as { log: string[] }
    expect(loserView.log.at(-1)).toBe('You ran out of time and forfeited the match.')
    expect(winnerView.log.at(-1)).toBe('Opponent ran out of time and forfeited the match.')
    expect(mover).not.toBe(waiter)
  })

  it('does nothing one second before the limit', async () => {
    const { gameId, waiter, waiterUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 119)
    const snap = (await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot
    expect(snap.status).toBe('active')
    expect(await moveLog(gameId)).toEqual([])
  })

  it('uses the limits from application settings when they are set', async () => {
    process.env['TURN_WARN_SECONDS'] = '5'
    process.env['TURN_FORFEIT_SECONDS'] = '10'
    const { gameId, waiter, waiterUser } = await table()
    await seenAgo(gameId, waiter, 1)
    await age(gameId, 11)
    expect(((await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot).status).toBe('finished')
  })

  it("does NOT forfeit anyone when the waiting player had been away: the mover's clock restarts instead", async () => {
    const { gameId, waiter, mover, waiterUser, moverUser } = await table()
    await seenAgo(gameId, waiter, 600) // the waiting player left ten minutes ago
    await age(gameId, 900)
    const before = (await raw(gameId)).version

    const snap = (await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot

    expect(snap.status).toBe('active')
    expect(snap.version).toBe(before) // no move, no version change...
    expect(snap.clock.elapsedMs).toBeLessThan(5_000) // ...but a fresh clock
    expect(await moveLog(gameId)).toEqual([])
    // The mover hears about the restart through an ordinary "nothing new" poll.
    const moverPoll = (await getGame(t.db, moverUser.id, gameId, before)) as GameUnchanged
    expect(moverPoll.changed).toBe(false)
    expect(moverPoll.clock.elapsedMs).toBeLessThan(10_000)
    expect(moverPoll.clock.seat).toBe(mover)
  })

  it('treats a player who has never been seen the same way as one who was away', async () => {
    const { gameId, waiter, waiterUser } = await table()
    await seenAgo(gameId, waiter, null)
    await age(gameId, 500)
    expect(((await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot).status).toBe('active')
  })

  it('then forfeits normally once the returning player has stayed and the clock runs out again', async () => {
    const { gameId, waiter, waiterUser } = await table()
    await seenAgo(gameId, waiter, 600)
    await age(gameId, 900)
    await getGame(t.db, waiterUser.id, gameId) // returns: clock restarts, and they are now seen
    expect(await lastSeen(gameId, waiter)).not.toBeNull()
    await age(gameId, 125) // they watched the whole of the fresh two minutes
    expect(((await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot).status).toBe('finished')
  })

  it("never forfeits the mover on the mover's own request, however late they are", async () => {
    const { gameId, waiter, moverUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 3600)
    const snap = (await getGame(t.db, moverUser.id, gameId)) as GameSnapshot
    expect(snap.status).toBe('active')
    expect(snap.clock.elapsedMs).toBeGreaterThan(3_000_000) // the clock honestly shows how late they are
  })

  it("lets a late mover play if their move arrives before the waiting player's next look", async () => {
    const { gameId, waiter, moverUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 130)
    const state = (await raw(gameId)).state
    const reply = await submitMove(t.db, moverUser.id, gameId, aiIntent('two_player', state))
    expect(reply.status).toBe('active')
    expect(reply.clock.elapsedMs).toBe(0)
  })

  it('does not forfeit if a move lands while the decision is being made (the lock re-checks)', async () => {
    const { gameId, waiter, moverUser, waiterUser } = await table()
    await seenAgo(gameId, waiter, 5)
    await age(gameId, 130)
    const state = (await raw(gameId)).state
    // Make the mover's move land just before the forfeit's transaction takes its lock.
    const racing: Db = {
      ...t.db,
      transaction: async (fn) => {
        await submitMove(t.db, moverUser.id, gameId, aiIntent('two_player', state))
        return t.db.transaction(fn)
      },
    }
    const snap = (await getGame(racing, waiterUser.id, gameId)) as GameSnapshot
    expect(snap.status).toBe('active')
    expect(await moveLog(gameId)).toHaveLength(1)
    expect((await moveLog(gameId))[0]!.intent.type).toBe('bid')
  })

  it('never decides anything for a game that is finished or has no move to make', async () => {
    const { gameId, waiter, waiterUser } = await table()
    await seenAgo(gameId, waiter, 1)
    await t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [gameId])
    await age(gameId, 3600)
    const snap = (await getGame(t.db, waiterUser.id, gameId)) as GameSnapshot
    expect(snap.status).toBe('finished')
    expect(await moveLog(gameId)).toEqual([])
  })
})

describe('noticing that a player is here', () => {
  it('records a player as seen on their first look, and does not rewrite it on every poll', async () => {
    const { gameId, waiterUser, waiter } = await table()
    expect(await lastSeen(gameId, waiter)).toBeNull()
    await getGame(t.db, waiterUser.id, gameId)
    const first = await lastSeen(gameId, waiter)
    expect(first).not.toBeNull()
    for (let i = 0; i < 5; i++) await getGame(t.db, waiterUser.id, gameId)
    expect((await lastSeen(gameId, waiter))!.getTime()).toBe(first!.getTime()) // throttled: polling is not a write per request
  })

  it('refreshes the record once it is stale', async () => {
    const { gameId, waiterUser, waiter } = await table()
    await seenAgo(gameId, waiter, 45)
    await getGame(t.db, waiterUser.id, gameId)
    const refreshed = await lastSeen(gameId, waiter)
    expect(Date.now() - refreshed!.getTime()).toBeLessThan(10_000)
  })

  it('counts a player who has just moved as present', async () => {
    const { gameId, moverUser, mover } = await table()
    await submitMove(t.db, moverUser.id, gameId, aiIntent('two_player', (await raw(gameId)).state))
    expect(await lastSeen(gameId, mover)).not.toBeNull()
  })
})

describe('four-player tables use the same clock', () => {
  it("forfeits the mover's whole team when a present player is waiting", async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const created = await createGame(t.db, users[0]!.id, 'four_player')
    for (const u of users.slice(1)) await joinGame(t.db, u.id, created.inviteCode)
    const seats = (await t.db.query<{ seat_key: string; user_id: string }>('SELECT seat_key, user_id FROM seats WHERE game_id = $1', [created.gameId])).rows
    const state = (await t.db.query<{ state: FourPlayerGameState }>('SELECT state FROM games WHERE id = $1', [created.gameId])).rows[0]!.state
    const waiting = seats.find((s) => s.seat_key !== state.turn)!
    await seenAgo(created.gameId, waiting.seat_key, 2)
    await age(created.gameId, 125)

    const snap = (await getGame(t.db, waiting.user_id, created.gameId)) as GameSnapshot

    expect(snap.status).toBe('finished')
    const final = (await t.db.query<{ state: FourPlayerGameState }>('SELECT state FROM games WHERE id = $1', [created.gameId])).rows[0]!.state
    expect(final.phase).toBe('match-over')
    expect(final.winner).not.toBe(teamOf(state.turn))
    expect(final.winner).not.toBeNull()
  })
})
