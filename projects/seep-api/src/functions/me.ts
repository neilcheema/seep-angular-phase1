import { app } from '@azure/functions'
import { getDb } from '../lib/db'
import { cleanDisplayName } from '../lib/display-name'
import { BadRequestError } from '../lib/errors'
import { authed, readJsonBody } from '../lib/http'
import { AccountDeletedError } from '../lib/users'

/**
 * POST /api/v1/me — verifies the bearer token, then upserts a users row
 * keyed by the Firebase uid: an insert on first call, an update (bumping
 * last_seen_at, refreshing email) on every call after. A client calls this
 * once when it signs in. Version check, token verification and error
 * mapping all live in authed().
 *
 * The body is optional. If it carries a displayName, that is checked
 * (lib/display-name.ts) and saved; if it does not, whatever name the person
 * already chose is left alone, so the sign-in call can never erase it.
 */
export const me = authed(async ({ request, identity }) => {
  const body = await readJsonBody(request, { optional: true })
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Request body must be a JSON object.')
  }
  const given = (body as Record<string, unknown>)['displayName']
  const displayName = given === undefined ? null : cleanDisplayName(given)

  const result = await getDb().query<{
    id: string
    display_name: string | null
    email: string | null
    created_at: string
  }>(
    `INSERT INTO users (firebase_uid, email, display_name, last_seen_at)
     SELECT $1::text, $2::text, $3::text, now()
      WHERE NOT EXISTS (SELECT 1 FROM deleted_accounts WHERE firebase_uid = $1::text)
     ON CONFLICT (firebase_uid)
     DO UPDATE SET last_seen_at = now(), email = EXCLUDED.email,
                   display_name = COALESCE(EXCLUDED.display_name, users.display_name)
     RETURNING id, display_name, email, created_at`,
    [identity.uid, identity.email, displayName],
  )
  const profile = result.rows[0]
  if (!profile) throw new AccountDeletedError() // a deleted account is not quietly re-created by a stale sign-in
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
