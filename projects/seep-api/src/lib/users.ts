import type { Queryable } from './db'
import type { VerifiedUser } from './auth'

/**
 * Finds the users row for an authenticated identity, creating it the first
 * time. Deliberately a plain SELECT on the common path: the game endpoints
 * are polled every couple of seconds, and a write per poll would be pure
 * waste. (last_seen_at and email are refreshed by POST /v1/me, which a
 * client calls once when it signs in.)
 */
export async function resolveUserId(db: Queryable, identity: VerifiedUser): Promise<string> {
  const found = await db.query<{ id: string }>('SELECT id FROM users WHERE firebase_uid = $1', [identity.uid])
  if (found.rows[0]) return found.rows[0].id
  const created = await db.query<{ id: string }>(
    `INSERT INTO users (firebase_uid, email) VALUES ($1, $2)
     ON CONFLICT (firebase_uid) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [identity.uid, identity.email],
  )
  return created.rows[0]!.id
}
