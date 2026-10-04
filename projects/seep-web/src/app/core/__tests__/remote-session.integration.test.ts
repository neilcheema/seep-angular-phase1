import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FourPlayerGameState, GameState, Intent } from 'seep-engine'
import type { Db } from '../../../../../seep-api/src/lib/db'
import { HttpError } from '../../../../../seep-api/src/lib/errors'
import * as server from '../../../../../seep-api/src/lib/games'
import { aiIntent, findLeak, hiddenFrom } from '../../../../../seep-api/src/__tests__/helpers/play'
import { type TestDb, createTestDb, makeUser } from '../../../../../seep-api/src/__tests__/helpers/test-db'
import { ApiError, type GameApi } from '../game-api'
import { type Perspective, fourPlayerPerspective, twoPlayerPerspective } from '../perspective'
import { RemoteSession } from '../remote-session'

/**
 * Browser-side RemoteSessions against the real server logic (seep-api's own
 * service layer, on real Postgres), with the network replaced by a function
 * call that round-trips everything through JSON, as HTTP would, and turns
 * the server's HttpErrors into ApiErrors, as the HTTP client would.
 *
 * The sessions only ever learn about each other's moves by polling, on a fake
 * clock. This is the test that would notice the client and server drifting
 * apart on what a view, a version or a move list means.
 */

type AnyState = GameState | FourPlayerGameState

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.reset()
  // Only the timers the sessions use; the database's own async work keeps running on real time.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

const overTheWire = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return JSON.parse(JSON.stringify(await call())) as T
  } catch (err) {
    if (err instanceof HttpError) throw new ApiError(err.status, err.message, err.details)
    throw err
  }
}

function apiFor(db: Db, userId: string): GameApi {
  return {
    getGame: (id: string, since?: number) => overTheWire(() => server.getGame(db, userId, id, since)),
    submitMove: (id: string, intent: unknown, expectedVersion: number) =>
      overTheWire(() => server.submitMove(db, userId, id, JSON.parse(JSON.stringify(intent)), expectedVersion)),
    dealNext: (id: string, expectedVersion: number) => overTheWire(() => server.dealNext(db, userId, id, expectedVersion)),
  } as unknown as GameApi
}

const realTick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Lets fake time pass, and the database real time to answer, until `done()`. */
async function settle(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 60 && !done(); i++) {
    await vi.advanceTimersByTimeAsync(500)
    await realTick()
  }
  expect(done(), `timed out waiting for: ${what}`).toBe(true)
}

async function openTable(kind: 'two_player' | 'four_player', seatCount: number) {
  const users = await Promise.all(Array.from({ length: seatCount }, (_, i) => makeUser(t.db, `p${i}`)))
  const created = await server.createGame(t.db, users[0]!.id, kind)
  for (const user of users.slice(1)) await server.joinGame(t.db, user.id, created.inviteCode)
  const perspective = (kind === 'two_player' ? twoPlayerPerspective : fourPlayerPerspective) as Perspective<unknown, unknown>
  const sessions = await Promise.all(
    users.map((u) =>
      RemoteSession.open<unknown, unknown, unknown>({ api: apiFor(t.db, u.id), gameId: created.gameId, perspective }),
    ),
  )
  return { users, sessions, gameId: created.gameId, perspective }
}

async function serverRow(gameId: string) {
  return (await t.db.query<{ state: AnyState; status: string; version: number }>('SELECT state, status, version FROM games WHERE id = $1', [gameId])).rows[0]!
}

async function playMatch(kind: 'two_player' | 'four_player', seatCount: number, checkEvery: number) {
  const { users, sessions, gameId, perspective } = await openTable(kind, seatCount)
  let moves = 0
  let deals = 0

  for (let guard = 0; guard < 4000; guard++) {
    const row = await serverRow(gameId)
    if (row.status === 'finished') break

    if (row.state.phase === 'hand-over') {
      await sessions[deals % seatCount]!.dealNext()
      deals++
      await settle(() => sessions.every((s) => (s.view() as { phase: string }).phase !== 'hand-over'), 'everyone to see the new hand')
      continue
    }

    const moverSeat = row.state.turn
    const mover = sessions.find((s) => s.seat() === moverSeat)!
    const others = sessions.filter((s) => s !== mover)
    const intent: Intent = aiIntent(kind, row.state)
    const staleReveals = others.map((s) => s.lastMove())

    await mover.submit(intent)
    moves++

    // The mover is told straight away; everyone else finds out by polling.
    expect(mover.lastMove()?.intent).toEqual(intent)
    await settle(() => others.every((s, i) => s.lastMove() !== staleReveals[i]), 'the other seats to hear about the move')
    for (const other of others) {
      expect(other.lastMove()?.intent, `${other.seat()} told the wrong move`).toEqual(JSON.parse(JSON.stringify(intent)))
      expect(other.lastMove()?.actor).toBe(kind === 'two_player' ? 'opponent' : moverSeat)
    }

    if (moves % checkEvery === 0) {
      const after = (await serverRow(gameId)).state
      for (const [i, session] of sessions.entries()) {
        const truth = await server.getGame(t.db, users[i]!.id, gameId)
        const expected = perspective.view(JSON.parse(JSON.stringify((truth as { view: unknown }).view)), session.seat()!)
        expect(session.view(), `${session.seat()} drifted from the server after move ${moves}`).toEqual(expected)
        expect(findLeak(session.view(), hiddenFrom(after, session.seat()!)), `${session.seat()} holds a hidden card`).toBeNull()
      }
    }
  }
  await settle(() => sessions.every((s) => s.status() === 'finished'), 'every seat to see the match end')
  return { sessions, users, gameId, moves, deals, row: await serverRow(gameId) }
}

async function playMultiHandMatch(kind: 'two_player' | 'four_player', seatCount: number, checkEvery: number) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    await t.reset()
    const result = await playMatch(kind, seatCount, checkEvery)
    if (result.deals >= 1) return result
    result.sessions.forEach((s) => s.dispose())
  }
  throw new Error('Fifteen matches in a row ended after one hand; deal-next was never exercised.')
}

describe.each([
  { kind: 'two_player' as const, seats: 2, checkEvery: 1 },
  { kind: 'four_player' as const, seats: 4, checkEvery: 3 },
])('browser sessions playing a complete $kind match through the real server', ({ kind, seats, checkEvery }) => {
  it('stays in step with the server, move by move, and stops polling when the match ends', { timeout: 280_000 }, async () => {
    const { sessions, moves, deals, row } = await playMultiHandMatch(kind, seats, checkEvery)

    expect(row.status).toBe('finished')
    expect(moves).toBeGreaterThan(49)
    expect(deals).toBeGreaterThanOrEqual(1)
    for (const s of sessions) {
      expect(s.status()).toBe('finished')
      expect(s.connection()).toBe('online')
    }
    // Nothing is polling a finished game quickly. A four-player session holds no timer at all; a two-player one holds
    // exactly one, the slow listen for a rematch. Asked of the sessions themselves: the global fake-timer count also
    // includes timers belonging to the database driver, which can still be draining a last query.
    const holdingATimer = sessions.filter((s) => (s as unknown as { timer: unknown }).timer !== null)
    expect(holdingATimer.map((s) => s.seat())).toEqual(kind === 'two_player' ? sessions.map((s) => s.seat()) : [])
    sessions.forEach((s) => s.dispose())
  })
})

describe('joining a table already in progress', () => {
  it('shows the current game to a session opened later, with no replay of old moves, and stays in step from there', { timeout: 120_000 }, async () => {
    const { users, sessions, gameId } = await openTable('two_player', 2)
    for (let i = 0; i < 8; i++) {
      const row = await serverRow(gameId)
      const mover = sessions.find((s) => s.seat() === row.state.turn)!
      const other = sessions.find((s) => s !== mover)!
      const stale = other.lastMove()
      await mover.submit(aiIntent('two_player', row.state))
      await settle(() => other.lastMove() !== stale, 'the other seat to hear about the move') // a real player's client has always caught up before it can act
    }

    // The second player closes their tab and later opens the game again.
    sessions[1]!.dispose()
    const latecomer = await RemoteSession.open<unknown, unknown, unknown>({
      api: apiFor(t.db, users[1]!.id),
      gameId,
      perspective: twoPlayerPerspective as Perspective<unknown, unknown>,
    })
    const truth = await server.getGame(t.db, users[1]!.id, gameId)
    expect(latecomer.view()).toEqual(twoPlayerPerspective.view(JSON.parse(JSON.stringify((truth as { view: GameState }).view)), 'opponent'))
    expect(latecomer.lastMove()).toBeNull() // old moves are not replayed as if they had just happened

    // From here on the two stay in step as usual.
    const row = await serverRow(gameId)
    const players = [sessions[0]!, latecomer]
    const mover = players.find((s) => s.seat() === row.state.turn)!
    const other = players.find((s) => s !== mover)!
    const stale = other.lastMove()
    await mover.submit(aiIntent('two_player', row.state))
    await settle(() => other.lastMove() !== stale, 'the other seat to hear about the next move')
    players.forEach((s) => s.dispose())
  })

  it('refuses a session acting on an out-of-date view with the server\'s own 409, tells the player, and catches it up', async () => {
    const { sessions, gameId } = await openTable('two_player', 2)
    const row = await serverRow(gameId)
    const mover = sessions.find((s) => s.seat() === row.state.turn)!
    const behind = sessions.find((s) => s !== mover)!
    const intent = aiIntent('two_player', row.state)

    await mover.submit(intent) // the world moves on; `behind` has not polled yet
    const staleView = behind.view()

    await expect(behind.submit({ type: 'throw', card: { face: 'Two', suit: 'Clubs' } })).rejects.toThrow(/game changed.*try again/i)

    expect(behind.view()).not.toBe(staleView) // it caught up as part of the refusal...
    expect(behind.lastMove()?.intent).toEqual(JSON.parse(JSON.stringify(intent))) // ...and now shows what it missed
    expect((await serverRow(gameId)).version).toBe(2) // and nothing it tried got applied
    sessions.forEach((s) => s.dispose())
  })

  it("refuses someone who isn't seated at the table, with the server's own 404", async () => {
    const { gameId } = await openTable('two_player', 2)
    const stranger = await makeUser(t.db, 'stranger')
    await expect(
      RemoteSession.open<unknown, unknown, unknown>({
        api: apiFor(t.db, stranger.id),
        gameId,
        perspective: twoPlayerPerspective as Perspective<unknown, unknown>,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('the turn clock, through the real server', () => {
  const age = (gameId: string, seconds: number) =>
    t.db.query('UPDATE games SET turn_started_at = now() - make_interval(secs => $2::float8) WHERE id = $1', [gameId, seconds])

  async function startedTable() {
    const { sessions, gameId, users } = await openTable('two_player', 2)
    const row = await serverRow(gameId)
    const mover = sessions.find((s) => s.seat() === row.state.turn)!
    const waiter = sessions.find((s) => s !== mover)!
    return { sessions, gameId, users, mover, waiter }
  }

  it('hands both screens the clock from the start, naming the player on it', async () => {
    const { sessions, mover } = await startedTable()
    for (const s of sessions) {
      expect(s.clock()).toMatchObject({ seat: mover.seat(), warnAfterMs: 60_000, forfeitAfterMs: 120_000 })
      expect(s.clock()!.elapsedMs).toBeLessThan(10_000)
    }
    sessions.forEach((s) => s.dispose())
  })

  it('ends the match for a player who ran out of time, as both screens see it, with no phantom "move" and no more polling', { timeout: 60_000 }, async () => {
    const { sessions, gameId, mover, waiter } = await startedTable()
    await age(gameId, 130) // the waiting player has been polling all along, so they are present

    await settle(() => waiter.status() === 'finished' && mover.status() === 'finished', 'both screens to learn the match was forfeited')

    expect((waiter.view() as { phase: string }).phase).toBe('match-over')
    expect((waiter.view() as { winner: string }).winner).toBe('player') // each screen sees itself as 'player': the waiter won
    expect((mover.view() as { winner: string }).winner).toBe('opponent') // ...and the one who timed out lost
    expect((mover.view() as { log: string[] }).log.at(-1)).toBe('You ran out of time and forfeited the match.')
    expect(waiter.lastMove()).toBeNull()
    expect(mover.lastMove()).toBeNull()
    // No fast polling: just each screen's own slow listen for a rematch. Asked of the sessions themselves, because the global
    // fake-timer count also includes timers belonging to the database driver, which can still be draining a last query.
    const holdingATimer = sessions.filter((x) => (x as unknown as { timer: unknown }).timer !== null)
    expect(holdingATimer).toHaveLength(2)
    await expect(mover.submit({ type: 'bid', value: 9 })).rejects.toThrow(/over/i)
    sessions.forEach((s) => s.dispose())
  })

  it('does not hand a win to a player who had simply been away: the mover gets a fresh clock, and hears of it', { timeout: 60_000 }, async () => {
    const { sessions, gameId, mover, waiter } = await startedTable()
    // The waiting player's last sighting is ten minutes old, and the clock is long past its limit.
    await t.db.query(
      "UPDATE seats SET last_seen_at = now() - interval '10 minutes' WHERE game_id = $1 AND seat_key = $2",
      [gameId, waiter.seat()],
    )
    await age(gameId, 400)

    await settle(() => waiter.clock() !== null && waiter.clock()!.elapsedMs < 10_000, 'the returning player to get a fresh clock')
    expect(waiter.status()).toBe('active')
    // The mover's screen finds out through an ordinary poll, though no move was made.
    await settle(() => mover.clock() !== null && mover.clock()!.elapsedMs < 30_000, "the mover's screen to hear the clock restarted")
    expect(mover.status()).toBe('active')
    expect((await serverRow(gameId)).status).toBe('active')
    sessions.forEach((s) => s.dispose())
  })
})
