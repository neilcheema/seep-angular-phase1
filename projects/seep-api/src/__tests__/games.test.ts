import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ENGINE_VERSION, type GameState, applyMove, legalBids } from 'seep-engine'
import type { Db } from '../lib/db'
import { BadRequestError, ConflictError, IllegalMoveError, NotFoundError } from '../lib/errors'
import {
  type GameSnapshot,
  createGame,
  dealNext,
  getGame,
  joinGame,
  listMyGames,
  submitMove,
} from '../lib/games'
import { aiIntent, findLeak, hiddenFrom } from './helpers/play'
import { type TestDb, type TestUser, createTestDb, makeUser } from './helpers/test-db'

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

async function rawGame(gameId: string) {
  const res = await t.db.query<{ state: GameState; version: number; status: string; engine_version: string }>(
    'SELECT state, version, status, engine_version FROM games WHERE id = $1',
    [gameId],
  )
  return res.rows[0]!
}

async function moveLog(gameId: string) {
  const res = await t.db.query<{ seat_key: string; intent: { type: string }; version: number }>(
    'SELECT seat_key, intent, version FROM move_log WHERE game_id = $1 ORDER BY version',
    [gameId],
  )
  return res.rows
}

/** A started two-player game: `a` created it (seat 'player'), `b` joined ('opponent'). */
async function startedGame() {
  const a = await makeUser(t.db, 'alice')
  const b = await makeUser(t.db, 'bob')
  const created = await createGame(t.db, a.id, 'two_player')
  await joinGame(t.db, b.id, created.inviteCode)
  const users: Record<string, TestUser> = { player: a, opponent: b }
  return { a, b, gameId: created.gameId, users }
}

/** Plays the AI's move for whichever seat holds the turn. */
async function playOneAiMove(gameId: string, users: Record<string, TestUser>) {
  const { state } = await rawGame(gameId)
  const result = await submitMove(t.db, users[state.turn]!.id, gameId, aiIntent('two_player', state))
  return result
}

describe('createGame', () => {
  it('creates a waiting two-player game with the creator seated first and the other seat open', async () => {
    const a = await makeUser(t.db, 'alice')
    const info = await createGame(t.db, a.id, 'two_player')

    expect(info).toMatchObject({ kind: 'two_player', status: 'waiting', version: 0, seat: 'player' })
    expect(info.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    expect(info.players).toEqual([
      { seat: 'player', displayName: null, isBot: false, isYou: true, joined: true },
      { seat: 'opponent', displayName: null, isBot: false, isYou: false, joined: false },
    ])
  })

  it('persists a freshly dealt state stamped with the engine version', async () => {
    const a = await makeUser(t.db, 'alice')
    const info = await createGame(t.db, a.id, 'two_player')
    const row = await rawGame(info.gameId)
    expect(row.engine_version).toBe(ENGINE_VERSION)
    expect(row.state.engineVersion).toBe(ENGINE_VERSION)
    expect(row.state.phase).toBe('bidding')
    expect(row.version).toBe(0)
  })

  it('creates a four-player game with the creator at p1 and three open seats', async () => {
    const a = await makeUser(t.db, 'alice')
    const info = await createGame(t.db, a.id, 'four_player')
    expect(info.seat).toBe('p1')
    expect(info.players.map((p) => [p.seat, p.joined])).toEqual([
      ['p1', true],
      ['p2', false],
      ['p3', false],
      ['p4', false],
    ])
  })

  it('retries with a fresh invite code when the first one is already taken', async () => {
    const a = await makeUser(t.db, 'alice')
    await createGame(t.db, a.id, 'two_player', { generateCode: () => 'AAAAAA' })
    const codes = ['AAAAAA', 'AAAAAA', 'BBBBBB']
    const second = await createGame(t.db, a.id, 'two_player', { generateCode: () => codes.shift()! })
    expect(second.inviteCode).toBe('BBBBBB')
  })

  it('gives up with a clear error rather than looping forever if codes keep colliding', async () => {
    const a = await makeUser(t.db, 'alice')
    await createGame(t.db, a.id, 'two_player', { generateCode: () => 'AAAAAA' })
    await expect(createGame(t.db, a.id, 'two_player', { generateCode: () => 'AAAAAA' })).rejects.toThrow(
      /unique invite code/,
    )
    // ...and the failed attempts left nothing behind.
    const count = await t.db.query<{ n: number }>('SELECT count(*)::int AS n FROM games')
    expect(count.rows[0]!.n).toBe(1)
  })
})

describe('joinGame', () => {
  it('seats the joiner at the open seat and starts the game', async () => {
    const a = await makeUser(t.db, 'alice')
    const b = await makeUser(t.db, 'bob')
    const created = await createGame(t.db, a.id, 'two_player')

    const joined = await joinGame(t.db, b.id, created.inviteCode)

    expect(joined).toMatchObject({ gameId: created.gameId, seat: 'opponent', status: 'active', version: 1 })
    expect(joined.inviteCode).toBeNull() // no reason to keep sharing it once the game is full
    expect(joined.players.every((p) => p.joined)).toBe(true)
    expect(joined.players.find((p) => p.isYou)!.seat).toBe('opponent')
  })

  it('accepts a code in any case with stray spaces', async () => {
    const a = await makeUser(t.db, 'alice')
    const b = await makeUser(t.db, 'bob')
    const created = await createGame(t.db, a.id, 'two_player')
    const joined = await joinGame(t.db, b.id, `  ${created.inviteCode!.toLowerCase()} `)
    expect(joined.seat).toBe('opponent')
  })

  it('is idempotent: joining again just returns the existing seat without bumping the version', async () => {
    const { b, gameId } = await startedGame()
    const code = (await t.db.query<{ invite_code: string }>('SELECT invite_code FROM games WHERE id = $1', [gameId])).rows[0]!
      .invite_code
    const again = await joinGame(t.db, b.id, code)
    expect(again).toMatchObject({ seat: 'opponent', version: 1, status: 'active' })
  })

  it("lets the creator 'join' their own game and simply returns their own seat", async () => {
    const a = await makeUser(t.db, 'alice')
    const created = await createGame(t.db, a.id, 'two_player')
    const again = await joinGame(t.db, a.id, created.inviteCode)
    expect(again).toMatchObject({ seat: 'player', status: 'waiting', version: 0 })
  })

  it('refuses a third player with a 409', async () => {
    const { gameId } = await startedGame()
    const c = await makeUser(t.db, 'carol')
    const code = (await t.db.query<{ invite_code: string }>('SELECT invite_code FROM games WHERE id = $1', [gameId])).rows[0]!
      .invite_code
    await expect(joinGame(t.db, c.id, code)).rejects.toMatchObject({ status: 409 })
    await expect(joinGame(t.db, c.id, code)).rejects.toBeInstanceOf(ConflictError)
  })

  it('answers 404 for a well-formed code nobody has, 400 for a malformed one', async () => {
    const a = await makeUser(t.db, 'alice')
    await expect(joinGame(t.db, a.id, 'ZZZZZZ')).rejects.toBeInstanceOf(NotFoundError)
    await expect(joinGame(t.db, a.id, 'nope')).rejects.toBeInstanceOf(BadRequestError)
    await expect(joinGame(t.db, a.id, undefined)).rejects.toBeInstanceOf(BadRequestError)
  })

  it('fills four-player seats in order and only starts once the fourth player arrives', async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const created = await createGame(t.db, users[0]!.id, 'four_player')

    const j2 = await joinGame(t.db, users[1]!.id, created.inviteCode)
    const j3 = await joinGame(t.db, users[2]!.id, created.inviteCode)
    expect([j2.seat, j2.status, j2.version]).toEqual(['p2', 'waiting', 1])
    expect([j3.seat, j3.status, j3.version]).toEqual(['p3', 'waiting', 2])

    const j4 = await joinGame(t.db, users[3]!.id, created.inviteCode)
    expect([j4.seat, j4.status, j4.version]).toEqual(['p4', 'active', 3])
  })

  it('makes every arrival visible to those already waiting, so a waiting screen can show the seats filling', async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const created = await createGame(t.db, users[0]!.id, 'four_player')
    const joinedSeats = async (since: number) => {
      const snap = (await getGame(t.db, users[0]!.id, created.gameId, since)) as GameSnapshot
      return { changed: snap.changed, version: snap.version, joined: snap.changed ? snap.players.filter((p) => p.joined).length : null }
    }
    expect(await joinedSeats(0)).toMatchObject({ changed: false })
    await joinGame(t.db, users[1]!.id, created.inviteCode)
    expect(await joinedSeats(0)).toEqual({ changed: true, version: 1, joined: 2 }) // the creator is told, though the game has not started
    await joinGame(t.db, users[2]!.id, created.inviteCode)
    expect(await joinedSeats(1)).toEqual({ changed: true, version: 2, joined: 3 })
    await joinGame(t.db, users[3]!.id, created.inviteCode)
    expect(await joinedSeats(2)).toEqual({ changed: true, version: 3, joined: 4 })
  })

  it('cannot be joined after the game has finished or been abandoned', async () => {
    const a = await makeUser(t.db, 'alice')
    const c = await makeUser(t.db, 'carol')
    const created = await createGame(t.db, a.id, 'two_player')
    await t.db.query("UPDATE games SET status = 'abandoned' WHERE id = $1", [created.gameId])
    await expect(joinGame(t.db, c.id, created.inviteCode)).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('getGame', () => {
  it("is invisible to anyone who isn't seated in it (404, not 403, so ids can't be probed)", async () => {
    const { gameId } = await startedGame()
    const stranger = await makeUser(t.db, 'mallory')
    await expect(getGame(t.db, stranger.id, gameId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(getGame(t.db, stranger.id, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError)
    await expect(getGame(t.db, stranger.id, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('gives each seat its own view of the same game', async () => {
    const { a, b, gameId } = await startedGame()
    const va = (await getGame(t.db, a.id, gameId)) as GameSnapshot
    const vb = (await getGame(t.db, b.id, gameId)) as GameSnapshot
    expect(va.changed).toBe(true)
    expect((va.view as { viewer: string }).viewer).toBe('player')
    expect((vb.view as { viewer: string }).viewer).toBe('opponent')
    expect(va.seat).toBe('player')
    expect(vb.seat).toBe('opponent')
    expect(va.moves).toEqual([])
  })

  it('never leaks a hidden card — not the other hand, not the undealt cards — to either seat', async () => {
    const { a, b, gameId, users } = await startedGame()
    for (let move = 0; move < 12; move++) {
      const { state } = await rawGame(gameId)
      for (const [seat, user] of [['player', a], ['opponent', b]] as const) {
        const snap = (await getGame(t.db, user.id, gameId)) as GameSnapshot
        expect(findLeak(snap.view, hiddenFrom(state, seat)), `${seat} view after ${move} moves`).toBeNull()
      }
      await playOneAiMove(gameId, users)
    }
  })

  it("answers a poll that is already current with a cheap 'unchanged'", async () => {
    const { a, gameId } = await startedGame()
    const res = await getGame(t.db, a.id, gameId, 1)
    expect(res).toMatchObject({ changed: false, gameId, version: 1, status: 'active' })
    // ...which still carries the clock, so a restart (which changes no move) reaches the mover's screen.
    expect((res as { clock: unknown }).clock).toMatchObject({ warnAfterMs: 60_000, forfeitAfterMs: 120_000 })
  })

  it('returns the moves made since the version the caller last saw', async () => {
    const { a, b, gameId, users } = await startedGame()
    const before = ((await getGame(t.db, a.id, gameId)) as GameSnapshot).version
    await playOneAiMove(gameId, users)
    await playOneAiMove(gameId, users)

    const snap = (await getGame(t.db, b.id, gameId, before)) as GameSnapshot
    expect(snap.changed).toBe(true)
    expect(snap.moves.map((m) => m.version)).toEqual([before + 1, before + 2])
    // The bidder bids and then also makes the opening move, so both are theirs.
    const bidder = (await rawGame(gameId)).state.bidder
    expect(snap.moves.map((m) => m.seat)).toEqual([bidder, bidder])
    expect((snap.moves[0]!.intent as { type: string }).type).toBe('bid')
    // Asking from the latest version returns nothing new.
    expect(await getGame(t.db, b.id, gameId, snap.version)).toMatchObject({ changed: false })
  })
})

describe('submitMove', () => {
  it('applies a legal move: new state, version +1, one log row, and the mover\'s own view back', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!
    const bid = legalBids(state)[0]!

    const result = await submitMove(t.db, mover.id, gameId, { type: 'bid', value: bid })

    expect(result).toMatchObject({ gameId, version: 2, status: 'active', seat: state.turn })
    expect((result.view as { viewer: string; phase: string; bidValue: number }).viewer).toBe(state.turn)
    expect((result.view as { phase: string }).phase).toBe('opening-move')
    const stored = await rawGame(gameId)
    expect(stored.version).toBe(2)
    expect(stored.state.bidValue).toBe(bid)
    expect(await moveLog(gameId)).toEqual([{ seat_key: state.turn, intent: { type: 'bid', value: bid }, version: 2 }])
  })

  it('refuses a move out of turn with the engine\'s own reason, and changes nothing', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const wrongSeat = state.turn === 'player' ? 'opponent' : 'player'
    const error = await submitMove(t.db, users[wrongSeat]!.id, gameId, { type: 'bid', value: 9 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IllegalMoveError)
    expect((error as IllegalMoveError).status).toBe(422)
    // The reason passed through is the engine's own, word for word.
    const engineReason = (() => {
      try {
        applyMove(state, wrongSeat, { type: 'bid', value: 9 })
      } catch (e) {
        return (e as Error).message
      }
      return null
    })()
    expect(engineReason).not.toBeNull()
    expect((error as IllegalMoveError).message).toBe(engineReason)
    expect((await rawGame(gameId)).version).toBe(1)
    expect(await moveLog(gameId)).toEqual([])
  })

  it('reports a rules violation as 422 carrying the engine message', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!
    const notInHand = [9, 10, 11, 12, 13].find((v) => !legalBids(state).includes(v))
    // A bidding hand is only four cards, so at most four of the five house values (9-13) can be in it.
    expect(notInHand).toBeDefined()
    const error = await submitMove(t.db, mover.id, gameId, { type: 'bid', value: notInHand! }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(IllegalMoveError)
    expect((error as Error).message).toMatch(/not a legal bid/)
  })

  it("won't let you move in a game you're not seated in, or in one that hasn't started", async () => {
    const { gameId } = await startedGame()
    const stranger = await makeUser(t.db, 'mallory')
    await expect(submitMove(t.db, stranger.id, gameId, { type: 'bid', value: 9 })).rejects.toBeInstanceOf(NotFoundError)

    const a = await makeUser(t.db, 'alice2')
    const waiting = await createGame(t.db, a.id, 'two_player')
    await expect(submitMove(t.db, a.id, waiting.gameId, { type: 'bid', value: 9 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/waiting/i),
    })
  })

  it('refuses moves in a finished game', async () => {
    const { gameId, users } = await startedGame()
    await t.db.query("UPDATE games SET status = 'finished' WHERE id = $1", [gameId])
    const { state } = await rawGame(gameId)
    await expect(submitMove(t.db, users[state.turn]!.id, gameId, { type: 'bid', value: 9 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/over/i),
    })
  })

  it('rejects a stale client with 409 and the current version, and accepts one that is current', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!
    const bid = legalBids(state)[0]!

    const stale = await submitMove(t.db, mover.id, gameId, { type: 'bid', value: bid }, 0).catch((e: unknown) => e)
    expect(stale).toBeInstanceOf(ConflictError)
    expect((stale as ConflictError).details).toEqual({ currentVersion: 1 })
    expect(await moveLog(gameId)).toEqual([])

    await expect(submitMove(t.db, mover.id, gameId, { type: 'bid', value: bid }, 1)).resolves.toMatchObject({ version: 2 })
  })

  it('rejects a malformed intent with 400 before touching the game', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!
    await expect(submitMove(t.db, mover.id, gameId, { type: 'capture' })).rejects.toBeInstanceOf(BadRequestError)
    await expect(submitMove(t.db, mover.id, gameId, 'bid')).rejects.toBeInstanceOf(BadRequestError)
    expect((await rawGame(gameId)).version).toBe(1)
  })

  it('stores only the validated intent in the move log, never extra fields from the request', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const bid = legalBids(state)[0]!
    await submitMove(t.db, users[state.turn]!.id, gameId, { type: 'bid', value: bid, isAdmin: true, note: 'x' })
    expect((await moveLog(gameId))[0]!.intent).toEqual({ type: 'bid', value: bid })
  })

  it('when two identical requests arrive together, exactly one is applied', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!
    const intent = { type: 'bid', value: legalBids(state)[0]! }

    const outcomes = await Promise.allSettled([
      submitMove(t.db, mover.id, gameId, intent, 1),
      submitMove(t.db, mover.id, gameId, intent, 1),
    ])

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(ConflictError)
    expect((await rawGame(gameId)).version).toBe(2)
    expect(await moveLog(gameId)).toHaveLength(1)
  })

  it('refuses, and rolls back completely, when the game changes underneath a move (a lost race)', async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const mover = users[state.turn]!

    // Make the transaction read a stale version, as it would if another
    // writer had slipped in between its SELECT and its UPDATE.
    const racy: Db = {
      ...t.db,
      transaction: (fn) =>
        t.db.transaction((tx) =>
          fn({
            async query<T>(text: string, params?: unknown[]) {
              const res = await tx.query<T>(text, params)
              if (text.includes('FOR UPDATE OF g')) {
                const row = res.rows[0] as { version: number }
                return { rows: [{ ...row, version: row.version - 1 }] as unknown as T[] }
              }
              return res
            },
          }),
        ),
    }

    const error = await submitMove(racy, mover.id, gameId, { type: 'bid', value: legalBids(state)[0]! }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/changed while/)
    expect((await rawGame(gameId)).version).toBe(1)
    expect(await moveLog(gameId)).toEqual([])
  })

  it("rolls the whole move back if writing the log fails, so state and log can't disagree", async () => {
    const { gameId, users } = await startedGame()
    const { state } = await rawGame(gameId)
    const broken: Db = {
      ...t.db,
      transaction: (fn) =>
        t.db.transaction((tx) =>
          fn({
            query<T>(text: string, params?: unknown[]) {
              if (text.includes('INSERT INTO move_log')) return Promise.reject(new Error('disk full'))
              return tx.query<T>(text, params)
            },
          }),
        ),
    }
    await expect(
      submitMove(broken, users[state.turn]!.id, gameId, { type: 'bid', value: legalBids(state)[0]! }),
    ).rejects.toThrow('disk full')
    const stored = await rawGame(gameId)
    expect(stored.version).toBe(1)
    expect(stored.state.phase).toBe('bidding')
  })
})

describe('dealNext', () => {
  it('refuses while the hand is still being played', async () => {
    const { gameId, users } = await startedGame()
    await expect(dealNext(t.db, users['player']!.id, gameId)).rejects.toBeInstanceOf(IllegalMoveError)
    expect(await moveLog(gameId)).toEqual([])
  })

  it('deals the next hand once one is over, logs it, and works for either player', async () => {
    // About a third of AI-vs-AI matches end after one hand, leaving no "next hand" to deal;
    // keep starting fresh games until one has a hand that ends without ending the match.
    let game: Awaited<ReturnType<typeof startedGame>> | null = null
    for (let attempt = 0; attempt < 20 && game === null; attempt++) {
      await t.reset()
      const candidate = await startedGame()
      for (let guard = 0; guard < 200; guard++) {
        const phase = (await rawGame(candidate.gameId)).state.phase
        if (phase === 'hand-over') {
          game = candidate
          break
        }
        if (phase === 'match-over') break
        await playOneAiMove(candidate.gameId, candidate.users)
      }
    }
    expect(game, 'twenty matches in a row ended after one hand').not.toBeNull()
    const { gameId, users } = game!

    const over = await rawGame(gameId)
    expect(over.state.phase).toBe('hand-over')

    const result = await dealNext(t.db, users['opponent']!.id, gameId, over.version)

    expect(result.version).toBe(over.version + 1)
    expect((await rawGame(gameId)).state.phase).toBe('bidding')
    const log = await moveLog(gameId)
    expect(log.at(-1)).toMatchObject({ seat_key: 'opponent', intent: { type: 'deal-next' }, version: over.version + 1 })
    // Asking again straight away is refused: the new hand is already dealt.
    await expect(dealNext(t.db, users['player']!.id, gameId)).rejects.toBeInstanceOf(IllegalMoveError)
  })
})

describe('listMyGames', () => {
  it("lists the caller's unfinished games, newest activity first, and nobody else's", async () => {
    const a = await makeUser(t.db, 'alice')
    const b = await makeUser(t.db, 'bob')
    const first = await createGame(t.db, a.id, 'two_player')
    const second = await createGame(t.db, a.id, 'two_player')
    await joinGame(t.db, b.id, first.inviteCode) // touches `first`, making it the most recent
    const finished = await createGame(t.db, a.id, 'two_player')
    await t.db.query("UPDATE games SET status = 'finished' WHERE id = $1", [finished.gameId])

    const mine = await listMyGames(t.db, a.id)
    expect(mine.map((g) => g.gameId)).toEqual([first.gameId, second.gameId])
    expect((await listMyGames(t.db, b.id)).map((g) => g.gameId)).toEqual([first.gameId])
    expect(await listMyGames(t.db, (await makeUser(t.db, 'carol')).id)).toEqual([])
  })
})
