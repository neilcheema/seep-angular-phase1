import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { _setDbForTests } from '../lib/db'
import { me } from '../functions/me'
import { deleteAccount } from '../lib/account'
import { cleanDisplayName, freeNameSuggestions, isNameTaken } from '../lib/display-name'
import { call } from './helpers/http'
import { type TestDb, createTestDb, readMigration } from './helpers/test-db'

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

const choose = async (uid: string, name?: string) => {
  verifyMock.mockResolvedValue({ uid, email: `${uid}@example.test`, emailVerified: true })
  return call(me, { as: 'x', ...(name === undefined ? {} : { body: { displayName: name } }) })
}
const nameOf = async (uid: string) => (await t.db.query<{ display_name: string | null }>('SELECT display_name FROM users WHERE firebase_uid = $1', [uid])).rows[0]?.display_name
const key = async (name: string) => (await t.db.query<{ k: string }>('SELECT seep_name_key($1) AS k', [name])).rows[0]!.k

describe('what counts as "the same name"', () => {
  it('ignores case, spaces, . - _ \' and compatibility forms (so these are all one name)', async () => {
    const same = ['Alex', 'alex', 'ALEX', 'A.lex', 'Alex_', 'a l-e_x', "A'lex", 'Ａｌｅｘ']
    expect(new Set(await Promise.all(same.map(key)))).toEqual(new Set(['alex']))
  })

  it('still tells genuinely different names apart', async () => {
    const different = ['Alex2', 'Alexx', 'Alex J', 'Álex', 'Alec']
    const keys = await Promise.all(different.map(key))
    expect(keys).not.toContain('alex') // none of them is "Alex"
    expect(new Set(keys).size).toBe(different.length) // and none of them is any other either
  })
})

describe('choosing a name that is already taken (POST /v1/me)', () => {
  it('is refused with a 409, a machine-readable code and free alternatives, and changes nothing', async () => {
    expect((await choose('u1', 'Alex')).status).toBe(200)
    await choose('u2') // the website signs in first, without a name, and only then asks for one
    const second = await choose('u2', 'a.LEX')
    expect(second.status).toBe(409)
    expect(second.body['code']).toBe('name_taken')
    expect(second.body['suggestions']).toEqual(['a.LEX 2', 'a.LEX 3', 'a.LEX 4'])
    expect(await nameOf('u1')).toBe('Alex') // the first owner is untouched
    expect(await nameOf('u2')).toBeNull() // and the second person keeps their account, with no name yet
  })

  it('stores nothing at all when a brand-new account asks for a taken name in its very first call', async () => {
    await choose('u1', 'Alex')
    const direct = await choose('u2', 'alex')
    expect(direct.status).toBe(409)
    expect(direct.body['suggestions']).toEqual(['alex 2', 'alex 3', 'alex 4'])
    expect(await nameOf('u2')).toBeUndefined() // no account row was created
  })

  it('says nothing about who has the name', async () => {
    await choose('u1', 'Alex')
    const second = await choose('u2', 'alex')
    expect(JSON.stringify(second.body)).not.toMatch(/u1|example\.test|firebase/)
  })

  it('skips numbers that are already taken, counting "Alex2" and "Alex 2" as the same', async () => {
    await choose('u1', 'Alex')
    await choose('u2', 'Alex 2')
    await choose('u3', 'alex3')
    const fourth = await choose('u4', 'ALEX')
    expect(fourth.body['suggestions']).toEqual(['ALEX 4', 'ALEX 5', 'ALEX 6'])
  })

  it('offers alternatives that always fit the 20 characters and pass the same rules as any name', async () => {
    const long = 'A'.repeat(20)
    await choose('u1', long)
    const second = await choose('u2', long.toLowerCase())
    const suggestions = second.body['suggestions'] as string[]
    expect(suggestions).toHaveLength(3)
    for (const s of suggestions) expect(() => cleanDisplayName(s), s).not.toThrow()
    for (const s of suggestions) expect(Array.from(s).length).toBeLessThanOrEqual(20)
  })

  it('lets a person keep their own name: saving it again, or changing only its capitals, is fine', async () => {
    await choose('u1', 'alex')
    expect((await choose('u1', 'alex')).status).toBe(200)
    expect((await choose('u1', 'Alex')).status).toBe(200)
    expect(await nameOf('u1')).toBe('Alex')
  })

  it('frees the old name when someone changes to a different one', async () => {
    await choose('u1', 'Alex')
    await choose('u1', 'Alexander')
    expect((await choose('u2', 'Alex')).status).toBe(200)
  })

  it('frees the name when the account is deleted', async () => {
    await choose('u1', 'Alex')
    expect((await choose('u2', 'alex')).status).toBe(409)
    await deleteAccount(t.db, 'u1')
    expect((await choose('u2', 'alex')).status).toBe(200)
  })

  it('never makes people who have not chosen a name collide with each other', async () => {
    for (const uid of ['n1', 'n2', 'n3']) expect((await choose(uid)).status).toBe(200)
    expect((await t.db.query('SELECT 1 FROM users WHERE display_name IS NULL')).rows).toHaveLength(3)
  })

  it('still refuses a bad name with a 400 (the old rules are unchanged), before any question of who has it', async () => {
    await choose('u1', 'Alex')
    expect((await choose('u2', '<b>x</b>')).status).toBe(400)
    expect((await choose('u2', 'x')).status).toBe(400)
  })
})

describe('the database itself decides (so two people choosing at the same moment cannot both win)', () => {
  it('refuses a clashing name even when the application is bypassed, and the error is recognised as a taken name', async () => {
    await choose('u1', 'Alex')
    await choose('u2')
    const err = await t.db.query("UPDATE users SET display_name = 'ALEX' WHERE firebase_uid = 'u2'").then(() => null, (e: unknown) => e)
    expect(isNameTaken(err)).toBe(true)
  })

  it('does not mistake some other unique violation (an invite code, say) for a taken name', () => {
    expect(isNameTaken({ code: '23505', message: 'duplicate key value violates unique constraint "games_invite_code_key"' })).toBe(false)
    expect(isNameTaken({ code: '42P01', message: 'users_display_name_key' })).toBe(false)
    expect(isNameTaken(null)).toBe(false)
    expect(isNameTaken('users_display_name_key')).toBe(false)
  })

  it('freeNameSuggestions asks the same question as the index: a name that differs only in spaces or punctuation is taken', async () => {
    await choose('u1', 'Alex 2')
    expect(await freeNameSuggestions(t.db, 'Alex', 2)).toEqual(['Alex 3', 'Alex 4'])
  })
})

describe('migration 010, for names that were already shared', () => {
  const insert = (uid: string, name: string | null, daysAgo: number) =>
    t.db.query("INSERT INTO users (firebase_uid, email, display_name, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4::int))", [uid, `${uid}@example.test`, name, daysAgo])
  const names = async () => Object.fromEntries((await t.db.query<{ firebase_uid: string; display_name: string | null }>('SELECT firebase_uid, display_name FROM users')).rows.map((r) => [r.firebase_uid, r.display_name]))
  const rerun = () => t.raw.exec(readMigration('010_phase6_unique_names.sql'))

  it('keeps the earliest account\'s name and gives each later one a number', async () => {
    await t.raw.exec('DROP INDEX users_display_name_key')
    await insert('a', 'Narender', 3)
    await insert('b', 'narender', 2)
    await insert('c', 'NARENDER', 1)
    await insert('d', 'Sam', 0)
    await insert('e', null, 0)
    await rerun()
    expect(await names()).toEqual({ a: 'Narender', b: 'narender 2', c: 'NARENDER 3', d: 'Sam', e: null })
  })

  it('is safe to run again: the second run changes nothing', async () => {
    await t.raw.exec('DROP INDEX users_display_name_key')
    await insert('a', 'Narender', 3)
    await insert('b', 'narender', 2)
    await rerun()
    const once = await names()
    await rerun()
    expect(await names()).toEqual(once)
  })

  it('keeps going when a numbered name collides with a name somebody already has', async () => {
    await t.raw.exec('DROP INDEX users_display_name_key')
    await insert('a', 'Bob', 5)
    await insert('b', 'bob', 4)
    await insert('c', 'Bob 2', 3)
    await rerun()
    const all = Object.values(await names()) as string[]
    expect(new Set(await Promise.all(all.map(key))).size).toBe(all.length) // every name is now unique under the real comparison
    for (const n of all) expect(Array.from(n).length).toBeLessThanOrEqual(20)
    expect((await t.db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'users_display_name_key'")).rows).toHaveLength(1)
  })

  it('leaves the unique index in place afterwards, so a duplicate can no longer get in', async () => {
    await t.raw.exec('DROP INDEX users_display_name_key')
    await rerun()
    await insert('a', 'Sam', 1)
    await expect(insert('b', 'SAM', 0)).rejects.toThrow(/users_display_name_key/)
  })
})
