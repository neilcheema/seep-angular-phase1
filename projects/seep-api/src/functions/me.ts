import { app } from '@azure/functions'
import { getDb } from '../lib/db'
import { authed } from '../lib/http'

/**
 * POST /api/v1/me — verifies the bearer token, then upserts a users row
 * keyed by the Firebase uid: an insert on first call, an update (bumping
 * last_seen_at, refreshing email) on every call after. A client calls this
 * once when it signs in. Version check, token verification and error
 * mapping all live in authed().
 */
export const me = authed(async ({ identity }) => {
  const result = await getDb().query<{
    id: string
    display_name: string | null
    email: string | null
    created_at: string
  }>(
    `INSERT INTO users (firebase_uid, email, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (firebase_uid)
     DO UPDATE SET last_seen_at = now(), email = EXCLUDED.email
     RETURNING id, display_name, email, created_at`,
    [identity.uid, identity.email],
  )
  const profile = result.rows[0]!
  return {
    status: 200,
    jsonBody: {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      createdAt: profile.created_at,
    },
  }
})

app.http('me', {
  methods: ['POST'],
  authLevel: 'anonymous', // we do our own auth via the Firebase token — not Azure Functions' own key-based auth
  route: 'v1/me',
  handler: me,
})
