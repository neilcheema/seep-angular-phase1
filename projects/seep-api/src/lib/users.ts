import type { Queryable } from './db'
import { HttpError } from './errors'
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
  // Never re-create an account that was deleted: its token can outlive the deletion by up to an hour, and a tab
  // that is still polling would otherwise bring the record (and the email) straight back. One statement, so
  // there is no gap between checking for the marker and inserting.
  const created = await db.query<{ id: string }>(
    `INSERT INTO users (firebase_uid, email)
     SELECT $1::text, $2::text
      WHERE NOT EXISTS (SELECT 1 FROM deleted_accounts WHERE firebase_uid = $1::text)
     ON CONFLICT (firebase_uid) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [identity.uid, identity.email],
  )
  if (!created.rows[0]) throw new AccountDeletedError()
  return created.rows[0].id
}

/** 403: this sign-in belongs to an account that has been deleted. */
export class AccountDeletedError extends HttpError {
  constructor() {
    super(403, 'This account has been deleted.')
    this.name = 'AccountDeletedError'
  }
}
