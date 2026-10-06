import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyMock(...args) }
})

import { _setDbForTests } from '../lib/db'
import { createGameHandler } from '../functions/games'
import { me } from '../functions/me'
import { EmailNotVerifiedError, assertMayCreateAccount, resolveUserId, verifiedEmailRequired } from '../lib/users'
import { call } from './helpers/http'
import { type TestDb, createTestDb } from './helpers/test-db'

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
  delete process.env['REQUIRE_VERIFIED_EMAIL']
  verifyMock.mockReset()
  _setDbForTests(null)
})

const id = (uid: string, emailVerified: boolean) => ({ uid, email: `${uid}@example.test`, emailVerified })
const users = async () => (await t.db.query<{ firebase_uid: string }>('SELECT firebase_uid FROM users ORDER BY firebase_uid')).rows.map((r) => r.firebase_uid)

describe('a NEW account must confirm its email address (POST /v1/me)', () => {
  it('is refused with a 403 and a machine-readable code, and nothing is stored', async () => {
    verifyMock.mockResolvedValue(id('new-1', false))
    const res = await call(me, { as: 'x' })
    expect(res.status).toBe(403)
    expect(res.body['code']).toBe('email_not_verified')
    expect(String(res.body['error'])).toContain('confirm your email')
    expect(await users()).toEqual([]) // no row, so no email address kept either
    expect((await t.db.query('SELECT 1 FROM deleted_accounts')).rows).toHaveLength(0) // and it did not look like a deletion
  })

  it('is accepted once the same account has confirmed (a new token that says so)', async () => {
    verifyMock.mockResolvedValue(id('new-1', false))
    expect((await call(me, { as: 'x' })).status).toBe(403)
    verifyMock.mockResolvedValue(id('new-1', true))
    const res = await call(me, { as: 'x' })
    expect(res.status).toBe(200)
    expect(await users()).toEqual(['new-1'])
  })

  it('lets a verified new account in at once (a Google sign-in, for example)', async () => {
    verifyMock.mockResolvedValue(id('google-1', true))
    expect((await call(me, { as: 'x' })).status).toBe(200)
    expect(await users()).toEqual(['google-1'])
  })

  it('NEVER refuses an account that already exists, even if its email was never confirmed (nobody is locked out)', async () => {
    verifyMock.mockResolvedValue(id('old-1', true))
    expect((await call(me, { as: 'x' })).status).toBe(200) // created back when the rule did not exist
    verifyMock.mockResolvedValue(id('old-1', false))
    const res = await call(me, { as: 'x' })
    expect(res.status).toBe(200)
    expect(await users()).toEqual(['old-1'])
  })
})

describe('the other door: any other request that would create an account', () => {
  it('refuses to create a table for an unverified new account, and creates no user either', async () => {
    verifyMock.mockResolvedValue(id('new-2', false))
    const res = await call(createGameHandler, { as: 'x', body: { kind: 'two_player' } })
    expect(res.status).toBe(403)
    expect(res.body['code']).toBe('email_not_verified')
    expect(await users()).toEqual([])
    expect((await t.db.query('SELECT 1 FROM games')).rows).toHaveLength(0)
  })

  it('resolveUserId refuses an unverified newcomer, accepts a verified one, and accepts an existing one whatever its flag', async () => {
    await expect(resolveUserId(t.db, id('new-3', false))).rejects.toBeInstanceOf(EmailNotVerifiedError)
    expect(await users()).toEqual([])
    const made = await resolveUserId(t.db, id('new-3', true))
    expect(made).toMatch(/^[0-9a-f-]{36}$/)
    await expect(resolveUserId(t.db, id('new-3', false))).resolves.toBe(made)
  })

  it('assertMayCreateAccount costs no query at all for a verified identity', async () => {
    const query = vi.fn()
    await assertMayCreateAccount({ query } as never, id('x', true))
    expect(query).not.toHaveBeenCalled()
  })
})

describe('the kill switch (REQUIRE_VERIFIED_EMAIL)', () => {
  it('is on by default, and for anything other than exactly "false"', () => {
    expect(verifiedEmailRequired()).toBe(true)
    for (const v of ['true', '', 'FALSE', '0', 'no', ' false']) {
      process.env['REQUIRE_VERIFIED_EMAIL'] = v
      expect(verifiedEmailRequired(), `"${v}"`).toBe(true)
    }
  })

  it('"false" lets unverified newcomers in through BOTH doors, at once, without a deploy', async () => {
    process.env['REQUIRE_VERIFIED_EMAIL'] = 'false'
    expect(verifiedEmailRequired()).toBe(false)
    verifyMock.mockResolvedValue(id('new-4', false))
    expect((await call(me, { as: 'x' })).status).toBe(200)
    verifyMock.mockResolvedValue(id('new-5', false))
    expect((await call(createGameHandler, { as: 'x', body: { kind: 'two_player' } })).status).toBe(201)
    expect(await users()).toEqual(['new-4', 'new-5'])
  })

  it('and turning it back on refuses the next unverified newcomer again', async () => {
    process.env['REQUIRE_VERIFIED_EMAIL'] = 'false'
    delete process.env['REQUIRE_VERIFIED_EMAIL']
    verifyMock.mockResolvedValue(id('new-6', false))
    expect((await call(me, { as: 'x' })).status).toBe(403)
  })
})
