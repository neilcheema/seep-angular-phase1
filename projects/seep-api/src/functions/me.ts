import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { AuthError, verifyFirebaseToken } from '../lib/auth'
import { getPool } from '../lib/db'

/**
 * POST /api/v1/me — the whole functional surface phase 3 needs, per the
 * plan: "the API validates tokens and creates a profile on first
 * sign-in." Verifies the bearer token, then upserts a users row keyed by
 * the Firebase uid — an insert on first call, an update (bumping
 * last_seen_at, refreshing email) on every call after.
 */
export async function me(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  let user: Awaited<ReturnType<typeof verifyFirebaseToken>>
  try {
    user = await verifyFirebaseToken(request.headers.get('authorization'))
  } catch (err) {
    if (err instanceof AuthError) {
      // Logged via context.log, not console.log, so this reaches Azure's
      // own monitoring (Application Insights) rather than disappearing
      // into stdout. Logs the failure reason, never the token itself.
      context.log(`Auth failed on ${request.url}: ${err.message}`)
      return { status: 401, jsonBody: { error: err.message } }
    }
    throw err
  }

  const pool = getPool()
  const result = await pool.query(
    `INSERT INTO users (firebase_uid, email, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (firebase_uid)
     DO UPDATE SET last_seen_at = now(), email = EXCLUDED.email
     RETURNING id, display_name, email, created_at`,
    [user.uid, user.email],
  )

  const profile = result.rows[0] as {
    id: string
    display_name: string | null
    email: string | null
    created_at: string
  }

  return {
    status: 200,
    jsonBody: {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      createdAt: profile.created_at,
    },
  }
}

app.http('me', {
  methods: ['POST'],
  authLevel: 'anonymous', // we do our own auth via the Firebase token — not Azure Functions' own key-based auth
  route: 'v1/me',
  handler: me,
})
