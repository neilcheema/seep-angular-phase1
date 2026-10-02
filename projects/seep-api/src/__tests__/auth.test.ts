import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock calls are hoisted by vitest to the top of the file automatically
// (same mechanism as Jest's jest.mock), so a plain static import below is
// enough to guarantee auth.ts sees the mocked jose, not the real one —
// no dynamic import or top-level await needed, which also keeps this
// file compiling cleanly under the CommonJS target the production code
// needs for Azure Functions.
const jwtVerifyMock = vi.fn()
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'fake-jwks-handle'),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}))

import { AuthError, verifyFirebaseToken, _resetVerifierCacheForTests } from '../lib/auth'

describe('verifyFirebaseToken', () => {
  beforeEach(() => {
    process.env['FIREBASE_PROJECT_ID'] = 'seep-quest-test'
    _resetVerifierCacheForTests()
    jwtVerifyMock.mockReset()
  })
  afterEach(() => {
    delete process.env['FIREBASE_PROJECT_ID']
  })

  it('rejects a missing Authorization header', async () => {
    await expect(verifyFirebaseToken(null)).rejects.toThrow(AuthError)
    await expect(verifyFirebaseToken(undefined)).rejects.toThrow(AuthError)
  })

  it('rejects a header that is not a Bearer token', async () => {
    await expect(verifyFirebaseToken('Basic abc123')).rejects.toThrow(AuthError)
  })

  it('rejects an empty Bearer token', async () => {
    await expect(verifyFirebaseToken('Bearer ')).rejects.toThrow(AuthError)
  })

  it('throws AuthError (not the raw jose error) when signature verification fails', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'))
    await expect(verifyFirebaseToken('Bearer some.jwt.token')).rejects.toThrow(AuthError)
  })

  it('verifies against the correct issuer and audience for the configured project', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-123', email: 'a@b.com', email_verified: true } })
    await verifyFirebaseToken('Bearer some.jwt.token')
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'some.jwt.token',
      'fake-jwks-handle',
      expect.objectContaining({
        issuer: 'https://securetoken.google.com/seep-quest-test',
        audience: 'seep-quest-test',
      }),
    )
  })

  it('returns uid, email, and emailVerified from a valid token', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-123', email: 'a@b.com', email_verified: true } })
    const user = await verifyFirebaseToken('Bearer some.jwt.token')
    expect(user).toEqual({ uid: 'uid-123', email: 'a@b.com', emailVerified: true })
  })

  it('treats a missing email as null and missing email_verified as false, rather than throwing', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'uid-456' } })
    const user = await verifyFirebaseToken('Bearer some.jwt.token')
    expect(user).toEqual({ uid: 'uid-456', email: null, emailVerified: false })
  })

  it('rejects a token with no subject claim, even if signature verification otherwise succeeded', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { email: 'a@b.com' } })
    await expect(verifyFirebaseToken('Bearer some.jwt.token')).rejects.toThrow(AuthError)
  })

  it('throws a clear, non-AuthError error when FIREBASE_PROJECT_ID is not configured', async () => {
    delete process.env['FIREBASE_PROJECT_ID']
    await expect(verifyFirebaseToken('Bearer some.jwt.token')).rejects.toThrow('FIREBASE_PROJECT_ID')
  })
})
