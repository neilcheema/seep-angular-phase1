import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type GameSnapshot, createGame, getGame, joinGame, leaveWaitingTable, listMyGames } from '../lib/games'
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

const status = async (id: string) => (await t.db.query<{ status: string }>('SELECT status FROM games WHERE id = $1', [id])).rows[0]!.status
const seatUser = async (id: string, seat: string) => (await t.db.query<{ user_id: string | null }>('SELECT user_id FROM seats WHERE game_id = $1 AND seat_key = $2', [id, seat])).rows[0]!.user_id
const view = async (u: TestUser, id: string, since?: number) => (await getGame(t.db, u.id, id, since)) as GameSnapshot

describe('leaving a table that is still waiting', () => {
  it('closes it if the person is alone at it, and it disappears from their tables', async () => {
    const a = await makeUser(t.db, 'a')
    const table = await createGame(t.db, a.id, 'two_player')
    expect(await leaveWaitingTable(t.db, a.id, table.gameId)).toEqual({ result: 'closed' })
    expect(await status(table.gameId)).toBe('abandoned')
    expect(await seatUser(table.gameId, 'player')).toBeNull()
    expect(await listMyGames(t.db, a.id)).toEqual([])
  })

  it('keeps it open for the others at a four-player table, frees the seat, and tells them', async () => {
    const users = await Promise.all(['u1', 'u2', 'u3', 'u4'].map((n) => makeUser(t.db, n)))
    const table = await createGame(t.db, users[0]!.id, 'four_player')
    await joinGame(t.db, users[1]!.id, table.inviteCode)
    await joinGame(t.db, users[2]!.id, table.inviteCode)
    const before = await view(users[1]!, table.gameId)

    expect(await leaveWaitingTable(t.db, users[1]!.id, table.gameId)).toEqual({ result: 'released' })

    const after = await view(users[0]!, table.gameId, before.version)
    expect(after).toMatchObject({ changed: true, status: 'waiting' })
    expect(after.players.filter((p) => p.joined)).toHaveLength(2)
    const newcomer = await joinGame(t.db, users[3]!.id, table.inviteCode)
    expect(newcomer.seat).toBe('p2') // the seat that was freed
  })

  it('lets the person come back later with the code, if the table is still open', async () => {
    const users = await Promise.all(['u1', 'u2'].map((n) => makeUser(t.db, n)))
    const table = await createGame(t.db, users[0]!.id, 'four_player')
    await joinGame(t.db, users[1]!.id, table.inviteCode)
    await leaveWaitingTable(t.db, users[1]!.id, table.gameId)
    await expect(joinGame(t.db, users[1]!.id, table.inviteCode)).resolves.toMatchObject({ status: 'waiting' })
  })

  it('refuses to "leave" a match under way: that would be a forfeit, which is a different thing', async () => {
    const a = await makeUser(t.db, 'a')
    const b = await makeUser(t.db, 'b')
    const table = await createGame(t.db, a.id, 'two_player')
    await joinGame(t.db, b.id, table.inviteCode)
    await expect(leaveWaitingTable(t.db, a.id, table.gameId)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/still waiting/) })
    expect(await status(table.gameId)).toBe('active')
  })

  it('refuses a finished table too', async () => {
    const a = await makeUser(t.db, 'a')
    const table = await createGame(t.db, a.id, 'two_player')
    await t.db.query(`UPDATE games SET status = 'finished' WHERE id = $1`, [table.gameId])
    await expect(leaveWaitingTable(t.db, a.id, table.gameId)).rejects.toMatchObject({ status: 409 })
  })

  it('does not let a stranger leave someone else’s table, or reveal that it exists', async () => {
    const a = await makeUser(t.db, 'a')
    const stranger = await makeUser(t.db, 'stranger')
    const table = await createGame(t.db, a.id, 'two_player')
    await expect(leaveWaitingTable(t.db, stranger.id, table.gameId)).rejects.toMatchObject({ status: 404 })
    expect(await status(table.gameId)).toBe('waiting')
  })

  it('answers 404 the second time, since the person is no longer seated; a malformed id is a 404 too, so ids cannot be probed', async () => {
    const a = await makeUser(t.db, 'a')
    const table = await createGame(t.db, a.id, 'two_player')
    await leaveWaitingTable(t.db, a.id, table.gameId)
    await expect(leaveWaitingTable(t.db, a.id, table.gameId)).rejects.toMatchObject({ status: 404 })
    await expect(leaveWaitingTable(t.db, a.id, 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
  })
})
