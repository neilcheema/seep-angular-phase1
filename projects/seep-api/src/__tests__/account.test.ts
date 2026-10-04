import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { deleteMe } from '../functions/account'
import { listGamesHandler } from '../functions/games'
import { me } from '../functions/me'
import { AuthError } from '../lib/auth'
import { deleteAccount } from '../lib/account'
import { type Db, _setDbForTests } from '../lib/db'
import { type GameSnapshot, createGame, getGame, joinGame } from '../lib/games'
import { AccountDeletedError, resolveUserId } from '../lib/users'
import { call } from './helpers/http'
import { type TestDb, type TestUser, createTestDb, makeUser } from './helpers/test-db'

/**
 * Account deletion erases a person from the database in one transaction. These tests look at what every kind of
 * table does when one of its people leaves, and that nothing can quietly bring the person back.
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
  _setDbForTests(t.db)
})
afterEach(() => {
  verifyMock.mockReset()
  _setDbForTests(null)
})

const uidOf = async (user: TestUser) => (await t.db.query<{ firebase_uid: string }>('SELECT firebase_uid FROM users WHERE id = $1', [user.id])).rows[0]!.firebase_uid
const remove = async (user: TestUser) => deleteAccount(t.db, await uidOf(user))
const view = async (user: TestUser, gameId: string, since?: number) => (await getGame(t.db, user.id, gameId, since)) as GameSnapshot
const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0]!.n
const status = async (gameId: string) => (await t.db.query<{ status: string }>('SELECT status FROM games WHERE id = $1', [gameId])).rows[0]!.status

async function twoPlayerMatch() {
  const alice = await makeUser(t.db, 'alice')
  const bob = await makeUser(t.db, 'bob')
  const created = await createGame(t.db, alice.id, 'two_player')
  await joinGame(t.db, bob.id, created.inviteCode)
  return { alice, bob, gameId: created.gameId, code: created.inviteCode }
}

async function fourPlayerTable(joiners: number) {
  const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
  const created = await createGame(t.db, users[0]!.id, 'four_player')
  for (let i = 1; i <= joiners; i++) await joinGame(t.db, users[i]!.id, created.inviteCode)
  return { users, gameId: created.gameId, code: created.inviteCode }
}

describe('what is erased', () => {
  it('removes the person, their email, and every pointer to them', async () => {
    const { alice, gameId } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    await remove(alice)

    expect(await count('users WHERE firebase_uid = $1', [uid])).toBe(0)
    expect(await count('users WHERE email = $1', ['alice@example.test'])).toBe(0)
    expect(await count('seats WHERE user_id = $1', [alice.id])).toBe(0)
    expect(await count('games WHERE created_by = $1', [alice.id])).toBe(0)
    expect(await count('games WHERE id = $1', [gameId])).toBe(1) // the table itself stays for the other person
  })

  it('leaves everyone else, and their tables, exactly as they were', async () => {
    const { alice } = await twoPlayerMatch()
    const carol = await makeUser(t.db, 'carol')
    const dave = await makeUser(t.db, 'dave')
    const other = await createGame(t.db, carol.id, 'two_player')
    await joinGame(t.db, dave.id, other.inviteCode)
    const before = await view(carol, other.gameId)

    await remove(alice)

    const after = await view(carol, other.gameId)
    expect(after.status).toBe('active')
    expect(after.version).toBe(before.version)
    expect(await count('users')).toBe(3)
  })

  it('is harmless for someone who was never here, or who deletes twice', async () => {
    expect(await deleteAccount(t.db, 'never-seen')).toEqual({ deleted: true, forfeited: 0, closed: 0, released: 0 })
    const { alice } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    expect((await deleteAccount(t.db, uid)).forfeited).toBe(1)
    expect(await deleteAccount(t.db, uid)).toEqual({ deleted: true, forfeited: 0, closed: 0, released: 0 })
  })
})

describe('a match in progress', () => {
  it('is forfeited: the opponent wins, and the log says the person LEFT, not that time ran out', async () => {
    const { alice, bob, gameId } = await twoPlayerMatch()
    const result = await remove(alice)

    expect(result).toMatchObject({ forfeited: 1, closed: 0, released: 0 })
    const snap = await view(bob, gameId, 1)
    expect(snap.status).toBe('finished')
    expect(snap.version).toBe(2)
    expect(snap.view).toMatchObject({ phase: 'match-over', winner: 'opponent' })
    const log = (snap.view as unknown as { log: string[] }).log
    expect(log.at(-1)).toBe('Opponent left the game and forfeited the match.') // from Bob's side
    expect(JSON.stringify(snap.moves)).toContain('"reason":"left"')
  })

  it('works whichever seat the person held', async () => {
    const { alice, bob, gameId } = await twoPlayerMatch()
    await remove(bob)
    const snap = await view(alice, gameId)
    expect(snap.view).toMatchObject({ phase: 'match-over', winner: 'player' })
    expect((snap.view as unknown as { log: string[] }).log.at(-1)).toBe('Opponent left the game and forfeited the match.')
  })

  it('at a four-player table costs the person’s whole team the match', async () => {
    const { users, gameId } = await fourPlayerTable(3)
    await remove(users[1]!) // p2 is on team B
    for (const survivor of [users[0]!, users[2]!, users[3]!]) {
      const snap = await view(survivor, gameId)
      expect(snap.status).toBe('finished')
      expect(snap.view).toMatchObject({ phase: 'match-over', winner: 'teamA' })
      expect((snap.view as unknown as { log: string[] }).log.at(-1)).toBe('p2 left the game and forfeited the match.')
    }
  })

  it('does not leave the person linked to the finished match', async () => {
    const { alice, bob, gameId } = await twoPlayerMatch()
    await remove(alice)
    const snap = await view(bob, gameId)
    const departed = snap.players.find((p) => p.seat === 'player')!
    expect(departed).toMatchObject({ displayName: null, isYou: false })
  })
})

describe('a table still waiting for players', () => {
  it('is closed if nobody else is at it, and a latecomer is told so', async () => {
    const alice = await makeUser(t.db, 'alice')
    const created = await createGame(t.db, alice.id, 'two_player')
    const result = await remove(alice)

    expect(result).toMatchObject({ closed: 1, forfeited: 0 })
    expect(await status(created.gameId)).toBe('abandoned')
    const bob = await makeUser(t.db, 'bob')
    await expect(joinGame(t.db, bob.id, created.inviteCode)).rejects.toMatchObject({ status: 409, message: 'That game is no longer open.' })
  })

  it('stays open for the others when a joiner leaves: their seat is freed and the others are told', async () => {
    const { users, gameId, code } = await fourPlayerTable(2) // u1, u2, u3 are seated
    const before = await view(users[0]!, gameId)
    const result = await remove(users[1]!)

    expect(result).toMatchObject({ released: 1, closed: 0, forfeited: 0 })
    const snap = await view(users[0]!, gameId, before.version)
    expect(snap).toMatchObject({ changed: true, status: 'waiting' })
    expect(snap.players.filter((p) => p.joined)).toHaveLength(2)
    const newcomer = await joinGame(t.db, users[3]!.id, code)
    expect(newcomer.seat).toBe('p2') // the freed seat
  })

  it('also stays open when the one who made it leaves, as long as others are there', async () => {
    const { users, gameId } = await fourPlayerTable(2)
    const result = await remove(users[0]!)
    expect(result).toMatchObject({ released: 1, closed: 0 })
    expect(await status(gameId)).toBe('waiting')
    expect(await count('games WHERE id = $1 AND created_by IS NULL', [gameId])).toBe(1)
    expect((await view(users[1]!, gameId)).players.find((p) => p.seat === 'p1')?.joined).toBe(false)
  })

  it('is closed once the last person leaves it', async () => {
    const { users, gameId } = await fourPlayerTable(1)
    await remove(users[0]!)
    expect(await status(gameId)).toBe('waiting')
    await remove(users[1]!)
    expect(await status(gameId)).toBe('abandoned')
  })
})

describe('tables that are already over', () => {
  it('are kept for the others with the person unlinked, until the normal cleanup removes them', async () => {
    const { alice, bob, gameId } = await twoPlayerMatch()
    await t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [gameId])
    const result = await remove(alice)

    expect(result).toMatchObject({ forfeited: 0, closed: 0, released: 0 })
    expect(await status(gameId)).toBe('finished')
    expect((await view(bob, gameId)).players.find((p) => p.seat === 'player')?.displayName).toBeNull()
  })

  it('handles a mix: one match forfeited, one waiting table closed, one finished table unlinked', async () => {
    const { alice } = await twoPlayerMatch() // in progress
    await createGame(t.db, alice.id, 'two_player') // waiting, alone
    const bob = await makeUser(t.db, 'bob2')
    const old = await createGame(t.db, alice.id, 'two_player')
    await joinGame(t.db, bob.id, old.inviteCode)
    await t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [old.gameId])

    expect(await remove(alice)).toEqual({ deleted: true, forfeited: 1, closed: 1, released: 0 })
    expect(await count('seats WHERE user_id = $1', [alice.id])).toBe(0)
  })
})

describe('safety', () => {
  it('lets a person leave even when their match cannot be forfeited (it is closed instead)', async () => {
    const { alice, gameId } = await twoPlayerMatch()
    // Corrupt on purpose: the match is already over but the table still says "active", so the engine refuses to forfeit it.
    await t.db.query(`UPDATE games SET state = jsonb_set(state, '{phase}', '"match-over"') WHERE id = $1`, [gameId])
    const result = await remove(alice)
    expect(result).toMatchObject({ forfeited: 0, closed: 1 })
    expect(await status(gameId)).toBe('abandoned')
    expect(await count('users WHERE id = $1', [alice.id])).toBe(0)
  })

  it('is all or nothing: if the last step fails, the forfeit, the unlinking and the marker are all rolled back', async () => {
    const { alice, gameId } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    const failing: Db = {
      ...t.db,
      transaction: (fn) =>
        t.db.transaction((tx) =>
          fn({ ...tx, query: ((sql: string, params?: unknown[]) => (sql.startsWith('DELETE FROM users') ? Promise.reject(new Error('boom')) : tx.query(sql, params))) as typeof tx.query }),
        ),
    }
    await expect(deleteAccount(failing, uid)).rejects.toThrow('boom')

    expect(await count('users WHERE id = $1', [alice.id])).toBe(1)
    expect(await status(gameId)).toBe('active') // the forfeit was rolled back
    expect(await count('seats WHERE user_id = $1', [alice.id])).toBe(1)
    expect(await count('deleted_accounts')).toBe(0)
  })
})

describe('a deleted account cannot be quietly brought back', () => {
  const identity = (uid: string, email: string | null = 'a@b.test') => ({ uid, email, emailVerified: true })

  it('is refused by the user lookup every game endpoint uses (a stale tab still polling with a valid token)', async () => {
    const { alice } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    await remove(alice)
    await expect(resolveUserId(t.db, identity(uid))).rejects.toBeInstanceOf(AccountDeletedError)
    expect(await count('users WHERE firebase_uid = $1', [uid])).toBe(0)
  })

  it('shows up as a 403 from a real endpoint, and creates nothing', async () => {
    const { alice } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    await remove(alice)
    verifyMock.mockResolvedValue(identity(uid))

    const res = await call(listGamesHandler, { as: 'x' })
    expect(res.status).toBe(403)
    expect(res.body['error']).toBe('This account has been deleted.')
    expect(await count('users WHERE firebase_uid = $1', [uid])).toBe(0)
  })

  it('is also refused by the sign-in call, so the profile (and the email) is not re-created', async () => {
    const { alice } = await twoPlayerMatch()
    const uid = await uidOf(alice)
    await remove(alice)
    verifyMock.mockResolvedValue(identity(uid))
    expect((await call(me, { as: 'x' })).status).toBe(403)
    expect((await call(me, { as: 'x', body: { displayName: 'Alice' } })).status).toBe(403)
    expect(await count('users')).toBe(1) // only Bob
  })

  it('still lets a brand-new sign-in through, even with the same email (a new Firebase account has a new id)', async () => {
    const { alice } = await twoPlayerMatch()
    await remove(alice)
    verifyMock.mockResolvedValue(identity('a-brand-new-uid', 'alice@example.test'))
    const res = await call(me, { as: 'x' })
    expect(res.status).toBe(200)
    expect(res.body['displayName']).toBeNull()
    expect(res.body['id']).not.toBe(alice.id)
  })

  it('still creates ordinary new users the first time they are seen (the guard is not in the way)', async () => {
    const id = await resolveUserId(t.db, identity('fresh-uid'))
    expect(id).toBeTruthy()
    expect(await resolveUserId(t.db, identity('fresh-uid'))).toBe(id)
  })
})

describe('POST /v1/me/delete', () => {
  it('erases the signed-in person and reports what happened', async () => {
    verifyMock.mockResolvedValue({ uid: 'uid-1', email: 'x@y.test', emailVerified: true })
    await call(me, { as: 'x', body: { displayName: 'Xavier' } })
    const res = await call(deleteMe, { as: 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true, forfeited: 0, closed: 0, released: 0 })
    expect(await count('users')).toBe(0)
    expect(await count('deleted_accounts')).toBe(1)
  })

  it('answers success again if the call is repeated (so an interrupted deletion can be finished)', async () => {
    verifyMock.mockResolvedValue({ uid: 'uid-1', email: 'x@y.test', emailVerified: true })
    await call(me, { as: 'x' })
    expect((await call(deleteMe, { as: 'x' })).status).toBe(200)
    expect((await call(deleteMe, { as: 'x' })).status).toBe(200)
  })

  it('needs a valid sign-in: nobody can delete someone else’s account', async () => {
    verifyMock.mockRejectedValue(new AuthError('bad token'))
    const res = await call(deleteMe, { as: 'forged' })
    expect(res.status).toBe(401)
  })

  it('only ever deletes the person the token belongs to', async () => {
    verifyMock.mockResolvedValue({ uid: 'uid-1', email: 'x@y.test', emailVerified: true })
    await call(me, { as: 'x' })
    verifyMock.mockResolvedValue({ uid: 'uid-2', email: 'z@y.test', emailVerified: true })
    await call(me, { as: 'z' })
    await call(deleteMe, { as: 'z' })
    expect((await t.db.query<{ firebase_uid: string }>('SELECT firebase_uid FROM users')).rows.map((r) => r.firebase_uid)).toEqual(['uid-1'])
  })
})
