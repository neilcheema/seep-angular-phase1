import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { createGameHandler, joinGameHandler, rematchHandler } from '../functions/games'
import { deleteAccount } from '../lib/account'
import { _setDbForTests } from '../lib/db'
import { type GameSnapshot, createGame, getGame, joinGame, leaveWaitingTable, requestRematch } from '../lib/games'
import { call } from './helpers/http'
import { type TestDb, type TestUser, createTestDb, makeUser } from './helpers/test-db'

/** Asking for a rematch of a finished two-player match: who creates, who joins, and everything that can go wrong. */

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

const count = async (sql = 'games') => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).rows[0]!.n
const finish = (gameId: string) => t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [gameId])
const view = async (u: TestUser, id: string, since?: number) => (await getGame(t.db, u.id, id, since)) as GameSnapshot
const pointerOf = async (gameId: string) => (await t.db.query<{ rematch_game_id: string | null }>('SELECT rematch_game_id FROM games WHERE id = $1', [gameId])).rows[0]!.rematch_game_id

/** A finished two-player match between two fresh people. */
async function finishedMatch() {
  const a = await makeUser(t.db, 'alice')
  const b = await makeUser(t.db, 'bob')
  const created = await createGame(t.db, a.id, 'two_player')
  await joinGame(t.db, b.id, created.inviteCode)
  await finish(created.gameId)
  return { a, b, gameId: created.gameId }
}

describe('who can ask, and when', () => {
  it('only once the match is over', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    const waiting = await createGame(t.db, a.id, 'two_player')
    await expect(requestRematch(t.db, a.id, waiting.gameId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/once the match is over/) })
    await joinGame(t.db, b.id, waiting.inviteCode)
    await expect(requestRematch(t.db, a.id, waiting.gameId)).rejects.toMatchObject({ status: 409 }) // active
    expect(await count()).toBe(1)
  })

  it('not for a four-player match, which would need seats reserved for the same partners', async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const table = await createGame(t.db, users[0]!.id, 'four_player')
    for (const u of users.slice(1)) await joinGame(t.db, u.id, table.inviteCode)
    await finish(table.gameId)
    await expect(requestRematch(t.db, users[0]!.id, table.gameId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/only available for two-player/) })
  })

  it('not for a stranger, who learns nothing about the match', async () => {
    const { gameId } = await finishedMatch()
    const stranger = await makeUser(t.db, 'stranger')
    await expect(requestRematch(t.db, stranger.id, gameId)).rejects.toMatchObject({ status: 404 })
    await expect(requestRematch(t.db, stranger.id, 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
    expect(await count()).toBe(1)
  })
})

describe('the first player to ask', () => {
  it('gets a new table waiting for the other player, with themselves in the first seat and a code to share', async () => {
    const { a, gameId } = await finishedMatch()
    const result = await requestRematch(t.db, a.id, gameId)
    expect(result).toMatchObject({ created: true, kind: 'two_player', status: 'waiting', seat: 'player' })
    expect(result.inviteCode).toMatch(/^[A-Z2-9]{6}$/)
    expect(result.gameId).not.toBe(gameId)
    expect(result.players.filter((p) => p.joined)).toHaveLength(1)
  })

  it('makes the finished game remember it, and tells the other player the next time they look', async () => {
    const { a, b, gameId } = await finishedMatch()
    const before = await view(b, gameId)
    expect(before.rematchGameId).toBeNull()

    const result = await requestRematch(t.db, a.id, gameId)
    expect(await pointerOf(gameId)).toBe(result.gameId)
    const after = await view(b, gameId, before.version)
    expect(after).toMatchObject({ changed: true, rematchGameId: result.gameId })
    expect(after.version).toBe(before.version + 1)
  })

  it('asking again changes nothing: the same table comes back and no second one is made', async () => {
    const { a, gameId } = await finishedMatch()
    const first = await requestRematch(t.db, a.id, gameId)
    const again = await requestRematch(t.db, a.id, gameId)
    expect(again).toMatchObject({ created: false, gameId: first.gameId })
    expect(await count()).toBe(2)
  })
})

describe('the second player to ask', () => {
  it('joins the first player’s table, which starts the match: both seated, no third table', async () => {
    const { a, b, gameId } = await finishedMatch()
    const made = await requestRematch(t.db, a.id, gameId)
    const joined = await requestRematch(t.db, b.id, gameId)

    expect(joined).toMatchObject({ created: false, gameId: made.gameId, status: 'active', seat: 'opponent' })
    expect(joined.players.every((p) => p.joined)).toBe(true)
    expect(await count()).toBe(2)
    expect((await view(a, made.gameId)).status).toBe('active')
  })

  it('works whichever of the two asks first', async () => {
    const { b, a, gameId } = await finishedMatch()
    const made = await requestRematch(t.db, b.id, gameId)
    expect(made).toMatchObject({ created: true, seat: 'player' })
    expect(await requestRematch(t.db, a.id, gameId)).toMatchObject({ created: false, gameId: made.gameId, status: 'active' })
  })

  it('both asking at the very same moment still ends with ONE table that both are at', async () => {
    const { a, b, gameId } = await finishedMatch()
    const [first, second] = await Promise.all([requestRematch(t.db, a.id, gameId), requestRematch(t.db, b.id, gameId)])
    expect(first.gameId).toBe(second.gameId)
    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(await count()).toBe(2)
    expect((await view(a, first.gameId)).status).toBe('active')
  })

  it('is refused if the rematch table has already been taken by someone else (it started without them)', async () => {
    const { a, b, gameId } = await finishedMatch()
    const made = await requestRematch(t.db, a.id, gameId)
    const stranger = await makeUser(t.db, 'stranger')
    await joinGame(t.db, stranger.id, made.inviteCode) // the code was shared on
    await expect(requestRematch(t.db, b.id, gameId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already under way/) })
  })
})

describe('when the rematch table is no longer there', () => {
  it('a fresh table is made if the first one was closed before the other player asked', async () => {
    const { a, b, gameId } = await finishedMatch()
    const first = await requestRematch(t.db, a.id, gameId)
    await leaveWaitingTable(t.db, a.id, first.gameId) // changed their mind: the table closes
    const second = await requestRematch(t.db, b.id, gameId)
    expect(second).toMatchObject({ created: true, seat: 'player' })
    expect(second.gameId).not.toBe(first.gameId)
    expect(await pointerOf(gameId)).toBe(second.gameId)
  })

  it('the pointer simply clears if the rematch table is deleted, leaving the finished match as it was', async () => {
    const { a, gameId } = await finishedMatch()
    const made = await requestRematch(t.db, a.id, gameId)
    await t.db.query('DELETE FROM games WHERE id = $1', [made.gameId])
    expect(await pointerOf(gameId)).toBeNull()
    expect(await count()).toBe(1)
  })

  it('still works if the other player has deleted their account: the table just waits', async () => {
    const { a, b, gameId } = await finishedMatch()
    const uid = (await t.db.query<{ firebase_uid: string }>('SELECT firebase_uid FROM users WHERE id = $1', [b.id])).rows[0]!.firebase_uid
    await deleteAccount(t.db, uid)
    expect(await requestRematch(t.db, a.id, gameId)).toMatchObject({ created: true, status: 'waiting' })
  })

  it('a rematch of a rematch works, so a long series can go on', async () => {
    const { a, b, gameId } = await finishedMatch()
    const second = await requestRematch(t.db, a.id, gameId)
    await requestRematch(t.db, b.id, gameId)
    await finish(second.gameId)
    const third = await requestRematch(t.db, b.id, second.gameId)
    expect(third).toMatchObject({ created: true })
    expect(third.gameId).not.toBe(second.gameId)
  })
})

describe('invite codes and rolling back', () => {
  it('tries another code if the first is already taken', async () => {
    const { a, gameId } = await finishedMatch()
    const taken = (await t.db.query<{ invite_code: string }>('SELECT invite_code FROM games WHERE id = $1', [gameId])).rows[0]!.invite_code
    const codes = [taken, 'ZZZZZ2']
    const made = await requestRematch(t.db, a.id, gameId, {}, { generateCode: () => codes.shift()! })
    expect(made.inviteCode).toBe('ZZZZZ2')
    expect(await count()).toBe(2)
  })

  it('runs the creating guard only when creating, and the joining guard only when joining', async () => {
    const { a, b, gameId } = await finishedMatch()
    const beforeCreate = vi.fn(() => Promise.resolve())
    const beforeJoin = vi.fn(() => Promise.resolve())
    await requestRematch(t.db, a.id, gameId, { beforeCreate, beforeJoin })
    expect([beforeCreate.mock.calls.length, beforeJoin.mock.calls.length]).toEqual([1, 0])
    await requestRematch(t.db, b.id, gameId, { beforeCreate, beforeJoin })
    expect([beforeCreate.mock.calls.length, beforeJoin.mock.calls.length]).toEqual([1, 1])
    await requestRematch(t.db, b.id, gameId, { beforeCreate, beforeJoin }) // asking again runs neither
    expect([beforeCreate.mock.calls.length, beforeJoin.mock.calls.length]).toEqual([1, 1])
  })

  it('leaves nothing behind if a guard refuses: no table, no pointer, no seat taken', async () => {
    const { a, b, gameId } = await finishedMatch()
    await expect(requestRematch(t.db, a.id, gameId, { beforeCreate: () => Promise.reject(new Error('no')) })).rejects.toThrow('no')
    expect(await count()).toBe(1)
    expect(await pointerOf(gameId)).toBeNull()

    const made = await requestRematch(t.db, a.id, gameId)
    await expect(requestRematch(t.db, b.id, gameId, { beforeJoin: () => Promise.reject(new Error('no')) })).rejects.toThrow('no')
    expect((await view(a, made.gameId)).status).toBe('waiting') // B was not seated
  })
})

describe('through the real handler, with the limits', () => {
  const as = (uid: string) => verifyMock.mockResolvedValue({ uid, email: `${uid}@example.test`, emailVerified: true })
  const create = (uid: string) => (as(uid), call(createGameHandler, { as: 'x', body: { kind: 'two_player' } }))
  const join = (uid: string, code: unknown) => (as(uid), call(joinGameHandler, { as: 'x', body: { code } }))
  const rematch = (uid: string, id: string) => (as(uid), call(rematchHandler, { as: 'x', params: { id } }))
  async function finishedViaHandlers() {
    const made = await create('uid-a')
    await join('uid-b', made.body['inviteCode'])
    await finish(made.body['gameId'] as string)
    return made.body['gameId'] as string
  }

  it('answers 201 to the first player (a table was made) and 200 to the second (they joined it)', async () => {
    const id = await finishedViaHandlers()
    const first = await rematch('uid-a', id)
    expect(first.status).toBe(201)
    const second = await rematch('uid-b', id)
    expect(second.status).toBe(200)
    expect(second.body['gameId']).toBe(first.body['gameId'])
    expect(second.body['status']).toBe('active')
  })

  it('counts the new table as starting one: the creation limit applies to whoever makes it', async () => {
    process.env['LIMIT_CREATE_PER_HOUR'] = '1'
    const id = await finishedViaHandlers() // that was uid-a’s one table this hour
    const refused = await rematch('uid-a', id)
    expect(refused.status).toBe(429)
    expect(await count()).toBe(1) // nothing was made
  })

  it('keeps the cap on tables waiting for players', async () => {
    process.env['LIMIT_MAX_WAITING_TABLES'] = '1'
    const id = await finishedViaHandlers()
    await create('uid-a') // uid-a now has one table waiting
    const refused = await rematch('uid-a', id)
    expect(refused.status).toBe(409)
    expect(refused.body['error']).toMatch(/tables waiting/)
  })

  it('keeps the cap on matches in play for the player who joins', async () => {
    const id = await finishedViaHandlers()
    await rematch('uid-a', id)
    process.env['LIMIT_MAX_ACTIVE_TABLES'] = '1'
    const other = await create('uid-c')
    await join('uid-b', other.body['inviteCode']) // uid-b is now in a match under way
    const refused = await rematch('uid-b', id)
    expect(refused.status).toBe(409)
    expect(refused.body['error']).toMatch(/already playing/)
  })
})
