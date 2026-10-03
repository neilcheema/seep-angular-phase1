import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FourPlayerGameState, GameState } from 'seep-engine'
import { ConflictError } from '../lib/errors'
import { type GameSnapshot, createGame, dealNext, getGame, joinGame, submitMove } from '../lib/games'
import { aiIntent, findLeak, hiddenFrom } from './helpers/play'
import { type TestDb, createTestDb, makeUser } from './helpers/test-db'

/**
 * The strongest check on the server layer: play whole matches, start to
 * finish, the way real clients would — every move submitted by the user who
 * holds that seat, through the real service, against real Postgres — and
 * check the invariants that matter at every step.
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

type AnyState = GameState | FourPlayerGameState

async function playFullMatch(kind: 'two_player' | 'four_player', seatCount: number, redactionEvery: number) {
  const users = await Promise.all(Array.from({ length: seatCount }, (_, i) => makeUser(t.db, `player${i}`)))
  const created = await createGame(t.db, users[0]!.id, kind)
  for (const user of users.slice(1)) await joinGame(t.db, user.id, created.inviteCode)
  const gameId = created.gameId

  const seatRows = await t.db.query<{ seat_key: string; user_id: string }>(
    'SELECT seat_key, user_id FROM seats WHERE game_id = $1',
    [gameId],
  )
  const userBySeat = new Map(seatRows.rows.map((r) => [r.seat_key, r.user_id]))
  expect(userBySeat.size).toBe(seatCount)

  let moves = 0
  let deals = 0
  let leakChecks = 0
  const rawEngineLogs: string[] = []

  for (let guard = 0; guard < 5000; guard++) {
    const row = (
      await t.db.query<{ state: AnyState; version: number; status: string }>(
        'SELECT state, version, status FROM games WHERE id = $1',
        [gameId],
      )
    ).rows[0]!
    if (row.status === 'finished') break
    const state = row.state
    rawEngineLogs.splice(0, rawEngineLogs.length, ...state.log)

    if (state.phase === 'hand-over') {
      const result = await dealNext(t.db, userBySeat.get([...userBySeat.keys()][deals % seatCount]!)!, gameId, row.version)
      expect(result.version).toBe(row.version + 1)
      deals++
      if (kind === 'two_player') await expectNewHandMessage(gameId, userBySeat, (await rawState(gameId)) as GameState)
      continue
    }

    const mover = state.turn
    const result = await submitMove(t.db, userBySeat.get(mover)!, gameId, aiIntent(kind, state), row.version)
    expect(result.version).toBe(row.version + 1)
    expect(result.seat).toBe(mover)
    moves++

    if (moves % redactionEvery === 0) {
      leakChecks++
      const after = await rawState(gameId)
      for (const [seat, userId] of userBySeat) {
        const snap = (await getGame(t.db, userId, gameId)) as GameSnapshot
        expect(findLeak(snap.view, hiddenFrom(after, seat)), `${seat} leaked after move ${moves}`).toBeNull()
      }
    }
    if (kind === 'two_player') await expectMoveWording(gameId, userBySeat, mover)
  }

  const final = (
    await t.db.query<{ state: AnyState; version: number; status: string }>(
      'SELECT state, version, status FROM games WHERE id = $1',
      [gameId],
    )
  ).rows[0]!
  return { final, gameId, userBySeat, moves, deals, leakChecks, rawEngineLogs, users }
}

async function rawState(gameId: string): Promise<AnyState> {
  return (await t.db.query<{ state: AnyState }>('SELECT state FROM games WHERE id = $1', [gameId])).rows[0]!.state
}

/** After a 2P move, the last log line must read "You ..." to the mover and "Opponent ..." to the other player. */
async function expectMoveWording(gameId: string, userBySeat: Map<string, string>, mover: string) {
  const other = mover === 'player' ? 'opponent' : 'player'
  const last = async (seat: string) =>
    ((await getGame(t.db, userBySeat.get(seat)!, gameId)) as GameSnapshot & { view: { log: string[] } }).view.log.at(-1)!
  const moverLine = await last(mover)
  const otherLine = await last(other)
  if (/^Hand over/.test(moverLine)) {
    // The scoring line names both players, so it must differ between the two viewers.
    expect(moverLine).not.toBe(otherLine)
    return
  }
  expect(moverLine).toMatch(/^You /)
  expect(otherLine).toMatch(/^Opponent /)
}

async function expectNewHandMessage(gameId: string, userBySeat: Map<string, string>, state: GameState) {
  const bidder = state.bidder
  const other = bidder === 'player' ? 'opponent' : 'player'
  const last = async (seat: string) =>
    ((await getGame(t.db, userBySeat.get(seat)!, gameId)) as GameSnapshot & { view: { log: string[] } }).view.log.at(-1)!
  expect(await last(bidder)).toBe('New hand dealt. You must bid.')
  expect(await last(other)).toBe('New hand dealt. Opponent must bid.')
}

/**
 * About a third of AI-vs-AI matches end after a single hand (a sweep alone
 * is worth 50), and such a match never exercises dealing the next hand. So
 * play fresh matches until one lasts longer, and assert on that one — the
 * hand-over -> deal-next path through the server must always be covered.
 */
async function playMultiHandMatch(kind: 'two_player' | 'four_player', seatCount: number, redactionEvery: number) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    await t.reset()
    const result = await playFullMatch(kind, seatCount, redactionEvery)
    if (result.deals >= 1) return result
  }
  throw new Error('Fifteen consecutive matches ended after a single hand; the simulation is not exercising deal-next.')
}

describe.each([
  { kind: 'two_player' as const, seats: 2, redactionEvery: 1 },
  { kind: 'four_player' as const, seats: 4, redactionEvery: 4 },
])('a complete $kind match played through the server', ({ kind, seats, redactionEvery }) => {
  it('runs from creation to a declared winner, with every invariant holding along the way', { timeout: 240_000 }, async () => {
    const { final, gameId, userBySeat, moves, deals, leakChecks, rawEngineLogs, users } = await playMultiHandMatch(
      kind,
      seats,
      redactionEvery,
    )

    // It finished properly.
    expect(final.status).toBe('finished')
    expect(final.state.phase).toBe('match-over')
    expect(final.state.winner).not.toBeNull()
    expect(moves).toBeGreaterThan(49) // more than one hand's worth
    expect(deals).toBeGreaterThanOrEqual(1)
    expect(leakChecks).toBeGreaterThan(5)

    // The version counter and the append-only log account for every single change, with no gaps or repeats.
    expect(final.version).toBe(1 + moves + deals) // 1 = the join that started the game
    const log = await t.db.query<{ version: number; intent: { type: string } }>(
      'SELECT version, intent FROM move_log WHERE game_id = $1 ORDER BY version',
      [gameId],
    )
    expect(log.rows).toHaveLength(moves + deals)
    expect(log.rows.map((r) => r.version)).toEqual(Array.from({ length: moves + deals }, (_, i) => i + 2))
    expect(log.rows.filter((r) => r.intent.type === 'deal-next')).toHaveLength(deals)

    // A finished game is closed to further moves.
    const anyUser = [...userBySeat.values()][0]!
    await expect(submitMove(t.db, anyUser, gameId, { type: 'bid', value: 9 })).rejects.toBeInstanceOf(ConflictError)
    await expect(dealNext(t.db, anyUser, gameId)).rejects.toBeInstanceOf(ConflictError)

    // Every player can still read the finished game, and it no longer lists as unfinished.
    for (const user of users) {
      const snap = (await getGame(t.db, user.id, gameId)) as GameSnapshot
      expect(snap.status).toBe('finished')
      expect((snap.view as { phase: string }).phase).toBe('match-over')
    }

    // Tripwire for the 2P log-perspective rewrite: it only knows how to swap the words
    // You/Opponent/opponent. If the engine ever starts writing "Your ..." into the log, this
    // fails, and swapLogPerspective needs to learn about it.
    if (kind === 'two_player') {
      expect(rawEngineLogs.filter((line) => /\byour\b/i.test(line))).toEqual([])
    }
  })
})
