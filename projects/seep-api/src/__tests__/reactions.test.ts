import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { createGameHandler, getGameHandler, joinGameHandler, reactionHandler } from '../functions/games'
import { deleteAccount } from '../lib/account'
import { _setDbForTests } from '../lib/db'
import { type ReactionDto, createGame, getGame, joinGame, sendReaction, submitMove } from '../lib/games'
import { REACTION_CODES } from '../lib/reactions'
import { call } from './helpers/http'
import { aiIntent } from './helpers/play'
import { type TestDb, type TestUser, createTestDb, makeUser } from './helpers/test-db'

/** Quick reactions: preset only, their own counter, never the game's version, and who may send and hear them. */

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
  verifyMock.mockReset()
  _setDbForTests(null)
  for (const name of Object.keys(process.env).filter((k) => k.startsWith('LIMIT'))) delete process.env[name]
})

async function match() {
  const a = await makeUser(t.db, 'alice')
  const b = await makeUser(t.db, 'bob')
  const created = await createGame(t.db, a.id, 'two_player')
  await joinGame(t.db, b.id, created.inviteCode)
  return { a, b, gameId: created.gameId, code: created.inviteCode }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await t.db.query<T>(sql, params)).rows[0]!
/** What both kinds of answer (a changed game, or “nothing new”) have in common, which is all these tests look at. */
interface Polled {
  readonly changed: boolean
  readonly version: number
  readonly reactionSeq: number
  readonly reactions: ReactionDto[]
}
const poll = async (u: TestUser, id: string, since?: number, sinceReaction?: number) => (await getGame(t.db, u.id, id, since, sinceReaction)) as unknown as Polled

describe('what can be sent', () => {
  it.each(REACTION_CODES)('accepts the preset reaction %s', async (code) => {
    const { a, gameId } = await match()
    await expect(sendReaction(t.db, a.id, gameId, code)).resolves.toEqual({ seq: 1 })
  })

  it.each([['free text', 'you are terrible'], ['a link', 'http://evil.example'], ['markup', '<b>x</b>'], ['empty', ''], ['a number', 7], ['nothing', undefined], ['null', null], ['an object', { code: 'wow' }], ['the right word in the wrong case', 'WOW'], ['a near miss', 'wow '], ['a very long string', 'x'.repeat(5000)]])('refuses %s with a 400', async (_label, bad) => {
    const { a, gameId } = await match()
    await expect(sendReaction(t.db, a.id, gameId, bad)).rejects.toMatchObject({ status: 400 })
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM reactions')).n).toBe(0)
  })
})

describe('who may send, and when', () => {
  it('only someone sitting at the table; a stranger and a malformed id both get the same 404', async () => {
    const { gameId } = await match()
    const stranger = await makeUser(t.db, 'stranger')
    await expect(sendReaction(t.db, stranger.id, gameId, 'wow')).rejects.toMatchObject({ status: 404 })
    await expect(sendReaction(t.db, stranger.id, 'not-a-uuid', 'wow')).rejects.toMatchObject({ status: 404 })
  })

  it('while a match is on, and just after it ends, but not at a table still waiting or one that was closed', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    const created = await createGame(t.db, a.id, 'two_player')
    await expect(sendReaction(t.db, a.id, created.gameId, 'good_luck')).rejects.toMatchObject({ status: 409 }) // waiting
    await joinGame(t.db, b.id, created.inviteCode)
    await expect(sendReaction(t.db, a.id, created.gameId, 'good_luck')).resolves.toBeDefined() // active
    await t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [created.gameId])
    await expect(sendReaction(t.db, b.id, created.gameId, 'good_game')).resolves.toBeDefined() // finished: "Good game!"
    await t.db.query(`UPDATE games SET status = 'abandoned' WHERE id = $1`, [created.gameId])
    await expect(sendReaction(t.db, a.id, created.gameId, 'good_game')).rejects.toMatchObject({ status: 409 })
  })

  it('at a four-player table too', async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const table = await createGame(t.db, users[0]!.id, 'four_player')
    for (const u of users.slice(1)) await joinGame(t.db, u.id, table.inviteCode)
    await expect(sendReaction(t.db, users[2]!.id, table.gameId, 'nice_move')).resolves.toEqual({ seq: 1 })
  })
})

describe('the game itself is untouched', () => {
  it('a reaction never moves the version or the last-activity time', async () => {
    const { a, gameId } = await match()
    const before = await one<{ version: number; updated_at: string }>('SELECT version, updated_at::text FROM games WHERE id = $1', [gameId])
    for (let i = 0; i < 5; i++) await sendReaction(t.db, a.id, gameId, 'wow')
    const after = await one<{ version: number; updated_at: string; reaction_seq: number }>('SELECT version, updated_at::text, reaction_seq FROM games WHERE id = $1', [gameId])
    expect(after.version).toBe(before.version)
    expect(after.updated_at).toBe(before.updated_at)
    expect(after.reaction_seq).toBe(5)
  })

  it('a move sent with the version the player last saw still works after any number of reactions: the reason reactions have their own counter', async () => {
    const { gameId } = await match()
    const row = await one<{ state: Parameters<typeof aiIntent>[1]; version: number }>('SELECT state, version FROM games WHERE id = $1', [gameId])
    const moverSeat = (row.state as { turn: string }).turn
    const mover = (await one<{ user_id: string }>('SELECT user_id FROM seats WHERE game_id = $1 AND seat_key = $2', [gameId, moverSeat])).user_id
    const other = (await one<{ user_id: string }>('SELECT user_id FROM seats WHERE game_id = $1 AND seat_key <> $2', [gameId, moverSeat])).user_id
    for (let i = 0; i < 4; i++) await sendReaction(t.db, other, gameId, 'oops') // the other player chatters while the mover thinks
    const result = await submitMove(t.db, mover, gameId, aiIntent('two_player', row.state), row.version)
    expect(result.version).toBe(row.version + 1)
  })
})

describe('how the poll carries them', () => {
  it('a first load gets the counter but none of the old reactions, so nothing is replayed', async () => {
    const { a, b, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'nice_move')
    const first = await poll(b, gameId)
    expect(first.reactionSeq).toBe(1)
    expect(first.reactions).toEqual([])
  })

  it('hands over what is newer than the caller’s cursor, in order, with who sent it and how old it is', async () => {
    const { a, b, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'nice_move')
    await sendReaction(t.db, b.id, gameId, 'thanks')
    const heard = await poll(a, gameId, undefined, 0)
    expect(heard.reactions.map((r) => [r.seq, r.seat, r.code])).toEqual([[1, 'player', 'nice_move'], [2, 'opponent', 'thanks']])
    expect(heard.reactions.every((r) => r.ageMs >= 0 && r.ageMs < 10_000)).toBe(true)
    expect((await poll(a, gameId, undefined, 1)).reactions.map((r) => r.code)).toEqual(['thanks']) // only what is newer
    expect((await poll(a, gameId, undefined, 2)).reactions).toEqual([]) // nothing new
  })

  it('on a “nothing new” poll too: they travel even when the game itself has not changed', async () => {
    const { a, b, gameId } = await match()
    const version = (await poll(b, gameId)).version
    await sendReaction(t.db, a.id, gameId, 'wow')
    const res = await poll(b, gameId, version, 0)
    expect(res.changed).toBe(false)
    expect(res.reactions.map((r) => r.code)).toEqual(['wow'])
    expect(res.reactionSeq).toBe(1)
  })

  it('only recent ones: a reaction older than a minute is never handed out', async () => {
    const { a, b, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'oops')
    await t.db.query(`UPDATE reactions SET at = now() - interval '61 seconds'`)
    await sendReaction(t.db, a.id, gameId, 'thanks')
    expect((await poll(b, gameId, undefined, 0)).reactions.map((r) => r.code)).toEqual(['thanks'])
  })

  it('at most 20 in one poll, and the next poll picks up the rest', async () => {
    const { a, b, gameId } = await match()
    for (let i = 0; i < 25; i++) await t.db.query(`UPDATE games SET reaction_seq = reaction_seq + 1 WHERE id = $1`, [gameId]).then(() => t.db.query(`INSERT INTO reactions (game_id, seq, seat_key, code) VALUES ($1, $2, 'player', 'wow')`, [gameId, i + 1]))
    const first = await poll(b, gameId, undefined, 0)
    expect(first.reactions).toHaveLength(20)
    const second = await poll(b, gameId, undefined, first.reactions.at(-1)!.seq)
    expect(second.reactions.map((r) => r.seq)).toEqual([21, 22, 23, 24, 25])
    expect(a.id).toBeTruthy()
  })

  it('never leaks between tables, or to a stranger', async () => {
    const one1 = await match()
    const other = await (async () => {
      const c = await makeUser(t.db, 'carol')
      const d = await makeUser(t.db, 'dave')
      const g = await createGame(t.db, c.id, 'two_player')
      await joinGame(t.db, d.id, g.inviteCode)
      return { c, gameId: g.gameId }
    })()
    await sendReaction(t.db, one1.a.id, one1.gameId, 'good_game')
    expect((await poll(other.c, other.gameId, undefined, 0)).reactions).toEqual([])
    await expect(getGame(t.db, other.c.id, one1.gameId, undefined, 0)).rejects.toMatchObject({ status: 404 })
  })
})

describe('housekeeping and privacy', () => {
  it('old reactions are pruned as new ones arrive, so the table stays small', async () => {
    const { a, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'oops')
    await t.db.query(`UPDATE reactions SET at = now() - interval '11 minutes'`)
    await sendReaction(t.db, a.id, gameId, 'thanks')
    expect((await t.db.query<{ code: string }>('SELECT code FROM reactions')).rows.map((r) => r.code)).toEqual(['thanks'])
  })

  it('they vanish with the game', async () => {
    const { a, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'wow')
    await t.db.query('DELETE FROM games WHERE id = $1', [gameId])
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM reactions')).n).toBe(0)
  })

  it('a reaction is stored by seat only, never by person, so deleting an account leaves nothing personal behind', async () => {
    const { a, b, gameId } = await match()
    await sendReaction(t.db, a.id, gameId, 'nice_move')
    const columns = (await t.db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'reactions' ORDER BY column_name`)).rows.map((r) => r.column_name)
    expect(columns).toEqual(['at', 'code', 'game_id', 'seat_key', 'seq']) // no user id, no name
    const uid = (await one<{ firebase_uid: string }>('SELECT firebase_uid FROM users WHERE id = $1', [a.id])).firebase_uid
    await deleteAccount(t.db, uid)
    expect((await poll(b, gameId, undefined, 0)).reactions).toHaveLength(1) // still just “a reaction from seat player”
  })
})

describe('through the real handlers, with the limits', () => {
  const as = (uid: string) => verifyMock.mockResolvedValue({ uid, email: `${uid}@example.test`, emailVerified: true })
  const create = (uid: string) => (as(uid), call(createGameHandler, { as: 'x', body: { kind: 'two_player' } }))
  const join = (uid: string, code: unknown) => (as(uid), call(joinGameHandler, { as: 'x', body: { code } }))
  const react = (uid: string, id: string, code: unknown) => (as(uid), call(reactionHandler, { as: 'x', params: { id }, body: { code } }))
  const get = (uid: string, id: string, query = '') => (as(uid), call(getGameHandler, { as: 'x', params: { id }, query }))
  async function started() {
    const made = await create('uid-a')
    await join('uid-b', made.body['inviteCode'])
    return made.body['gameId'] as string
  }

  it('answers 200 with the new counter; a free-text “reaction” is a 400; a table still waiting is a 409', async () => {
    const id = await started()
    expect(await react('uid-a', id, 'good_luck')).toMatchObject({ status: 200, body: { seq: 1 } })
    expect((await react('uid-a', id, 'you stink')).status).toBe(400)
    const waiting = await create('uid-c')
    expect((await react('uid-c', waiting.body['gameId'] as string, 'wow')).status).toBe(409)
  })

  it('limits how fast one person can send, with the wait in the answer, and does not slow the other player', async () => {
    process.env['LIMIT_REACTIONS_PER_MINUTE'] = '3'
    const id = await started()
    for (let i = 0; i < 3; i++) expect((await react('uid-a', id, 'wow')).status).toBe(200)
    const refused = await react('uid-a', id, 'wow')
    expect(refused.status).toBe(429)
    expect(refused.body['error']).toMatch(/reactions too quickly/)
    expect(refused.headers['Retry-After']).toBeDefined()
    expect((await react('uid-b', id, 'thanks')).status).toBe(200)
  })

  it('can be switched off with the other limits', async () => {
    process.env['LIMITS_ENABLED'] = 'false'
    process.env['LIMIT_REACTIONS_PER_MINUTE'] = '1'
    const id = await started()
    for (let i = 0; i < 4; i++) expect((await react('uid-a', id, 'wow')).status).toBe(200)
  })

  it('the poll handler passes the reaction cursor through, and refuses a nonsense one', async () => {
    const id = await started()
    await react('uid-a', id, 'nice_move')
    const heard = await get('uid-b', id, 'sinceReaction=0')
    expect(heard.status).toBe(200)
    expect((heard.body['reactions'] as { code: string }[]).map((r) => r.code)).toEqual(['nice_move'])
    expect((await get('uid-b', id, 'sinceReaction=-1')).status).toBe(400)
    expect((await get('uid-b', id, 'sinceReaction=abc')).status).toBe(400)
  })
})
