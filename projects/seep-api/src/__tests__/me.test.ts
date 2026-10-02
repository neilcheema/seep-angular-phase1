import { describe, expect, it, vi } from 'vitest'
import type { HttpRequest, InvocationContext } from '@azure/functions'

// Same hoisting note as auth.test.ts: vi.mock is hoisted above these
// imports automatically, so plain static imports are enough.
const verifyFirebaseTokenMock = vi.fn()
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>()
  return { ...actual, verifyFirebaseToken: (...args: unknown[]) => verifyFirebaseTokenMock(...args) }
})

const queryMock = vi.fn()
vi.mock('../lib/db', () => ({ getPool: () => ({ query: queryMock }) }))

import { AuthError } from '../lib/auth'
import { me } from '../functions/me'

function fakeRequest(authHeader: string | null): HttpRequest {
  const headers = new Headers()
  if (authHeader !== null) headers.set('authorization', authHeader)
  return { headers } as HttpRequest
}
const fakeContext = { log: vi.fn() } as unknown as InvocationContext

describe('me function handler', () => {
  it('returns 401 (not a thrown error) when the token fails verification, logs the reason, and never touches the database', async () => {
    verifyFirebaseTokenMock.mockRejectedValue(new AuthError('bad token'))
    const res = await me(fakeRequest('Bearer invalid'), fakeContext)
    expect(res.status).toBe(401)
    expect(res.jsonBody).toEqual({ error: 'bad token' })
    expect(queryMock).not.toHaveBeenCalled()
    expect(fakeContext.log).toHaveBeenCalledWith(expect.stringContaining('bad token'))
  })

  it('re-throws a non-AuthError from verification rather than masking it as a 401', async () => {
    verifyFirebaseTokenMock.mockRejectedValue(new Error('network failure talking to JWKS endpoint'))
    await expect(me(fakeRequest('Bearer x'), fakeContext)).rejects.toThrow('network failure')
  })

  it('on a valid token, upserts by firebase_uid and returns the profile the query returns', async () => {
    verifyFirebaseTokenMock.mockResolvedValue({ uid: 'uid-123', email: 'a@b.com', emailVerified: true })
    queryMock.mockResolvedValue({
      rows: [{ id: 'row-1', display_name: null, email: 'a@b.com', created_at: '2026-10-02T00:00:00Z' }],
    })

    const res = await me(fakeRequest('Bearer good-token'), fakeContext)

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (firebase_uid)'), ['uid-123', 'a@b.com'])
    expect(res.status).toBe(200)
    expect(res.jsonBody).toEqual({
      id: 'row-1',
      displayName: null,
      email: 'a@b.com',
      createdAt: '2026-10-02T00:00:00Z',
    })
  })

  it('passes the uid and email through to the query exactly as verification returned them, including a null email', async () => {
    verifyFirebaseTokenMock.mockResolvedValue({ uid: 'uid-456', email: null, emailVerified: false })
    queryMock.mockResolvedValue({
      rows: [{ id: 'row-2', display_name: null, email: null, created_at: '2026-10-02T00:00:00Z' }],
    })

    await me(fakeRequest('Bearer good-token'), fakeContext)

    expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['uid-456', null])
  })
})
