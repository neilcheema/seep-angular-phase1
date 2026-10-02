import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Verifies Firebase Auth ID tokens — no Firebase Admin SDK needed, since
 * Firebase ID tokens are standard RS256 JWTs. Confirmed against Firebase's
 * own "Verify ID Tokens" documentation: the aud claim must be the project
 * ID, the iss claim must be https://securetoken.google.com/<project-id>,
 * and the signature must validate against Firebase's own public keys.
 *
 * Two JWKS-shaped endpoints exist for this key set: Firebase's docs lead
 * with the X.509 certificate endpoint (for libraries that consume raw
 * certs directly), but jose's createRemoteJWKSet expects standard JWKS
 * format, which is this dedicated endpoint instead — confirmed current
 * via Firebase/Apigee integration documentation, not assumed.
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface VerifiedUser {
  readonly uid: string
  readonly email: string | null
  readonly emailVerified: boolean
}

/**
 * Lazily built so a missing FIREBASE_PROJECT_ID fails the first real
 * request with a clear error, rather than crashing the whole function
 * app at cold-start before any request has even arrived.
 */
let cached: { projectId: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null

function getVerifier(): { projectId: string; jwks: ReturnType<typeof createRemoteJWKSet> } {
  const projectId = process.env['FIREBASE_PROJECT_ID']
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID environment variable is not set')
  }
  if (!cached || cached.projectId !== projectId) {
    cached = { projectId, jwks: createRemoteJWKSet(new URL(JWKS_URL)) }
  }
  return cached
}

/** Extracts and verifies the bearer token from an Authorization header value. Throws AuthError for anything invalid — never returns a result for a token that didn't actually verify. */
export async function verifyFirebaseToken(authHeader: string | null | undefined): Promise<VerifiedUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header')
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    throw new AuthError('Missing or malformed Authorization header')
  }

  const { projectId, jwks } = getVerifier()

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    })
    payload = result.payload
  } catch (err) {
    throw new AuthError(`Token verification failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new AuthError('Token has no subject (uid)')
  }

  return {
    uid: payload.sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : null,
    emailVerified: payload['email_verified'] === true,
  }
}

/** Exposed for tests only, so a test can force getVerifier() to rebuild against a fresh FIREBASE_PROJECT_ID instead of an earlier test's cached verifier. */
export function _resetVerifierCacheForTests(): void {
  cached = null
}
