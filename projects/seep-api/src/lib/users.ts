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
  // A NEW account must have a confirmed email address (an account that already has a row never reaches this line).
  if (!identity.emailVerified && verifiedEmailRequired()) throw new EmailNotVerifiedError()
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

/**
 * 403: a NEW account has to confirm its email address before it can play. The extra field `code` lets the website show the
 * "check your email" step instead of a plain error. Nobody who already has an account is ever refused with this.
 */
export class EmailNotVerifiedError extends HttpError {
  constructor() {
    super(403, 'Please confirm your email address to continue. We sent you a link.', { code: 'email_not_verified' })
    this.name = 'EmailNotVerifiedError'
  }
}

/**
 * Whether a new account has to confirm its email address first. On unless the Function App setting REQUIRE_VERIFIED_EMAIL is
 * exactly "false", which turns the rule off at once, without a deploy, if the verification emails ever misbehave.
 */
export function verifiedEmailRequired(): boolean {
  return process.env['REQUIRE_VERIFIED_EMAIL'] !== 'false'
}

/**
 * The rule, for the second place an account can be created (POST /v1/me has its own insert; resolveUserId is the first):
 * a new account needs a confirmed email address, and an account that already has a row is never refused, so nobody who signed up
 * before this rule existed is locked out. A verified identity costs no query at all.
 */
export async function assertMayCreateAccount(db: Queryable, identity: VerifiedUser): Promise<void> {
  if (identity.emailVerified || !verifiedEmailRequired()) return
  const found = await db.query('SELECT 1 FROM users WHERE firebase_uid = $1', [identity.uid])
  if (found.rows.length === 0) throw new EmailNotVerifiedError()
}

/** 403: this sign-in belongs to an account that has been deleted. */
export class AccountDeletedError extends HttpError {
  constructor() {
    super(403, 'This account has been deleted.')
    this.name = 'AccountDeletedError'
  }
}
