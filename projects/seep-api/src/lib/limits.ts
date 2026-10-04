import type { Queryable } from './db'
import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from './errors'

/**
 * Rate limits and table caps. They stop one account from flooding the service or from guessing other people's table
 * codes, without ever getting in the way of an ordinary game. Every number can be changed in the Function App's settings
 * without a redeploy, and LIMITS_ENABLED=false switches them all off.
 *
 * Only low-frequency actions are limited (starting a table, making a move, a wrong table code). Polling is never
 * limited and never touches this code.
 *
 * The counts live in the database, not in memory, so they hold when Azure runs several copies of the app.
 */

export interface LimitSettings {
  readonly enabled: boolean
  readonly createPerHour: number
  readonly movesPerMinute: number
  readonly failedJoinsPer10Min: number
  readonly maxWaitingTables: number
  readonly maxActiveTables: number
  readonly reactionsPerMinute: number
}

function positive(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return n >= 1 ? n : undefined // a 0 must never mean "allow nobody"
}

export function limitSettings(env: Record<string, string | undefined> = process.env): LimitSettings {
  return {
    enabled: !['false', '0', 'no'].includes((env['LIMITS_ENABLED'] ?? '').trim().toLowerCase()),
    createPerHour: positive(env['LIMIT_CREATE_PER_HOUR']) ?? 10,
    movesPerMinute: positive(env['LIMIT_MOVES_PER_MINUTE']) ?? 120,
    failedJoinsPer10Min: positive(env['LIMIT_FAILED_JOINS_PER_10_MIN']) ?? 10,
    maxWaitingTables: positive(env['LIMIT_MAX_WAITING_TABLES']) ?? 5,
    maxActiveTables: positive(env['LIMIT_MAX_ACTIVE_TABLES']) ?? 20,
    reactionsPerMinute: positive(env['LIMIT_REACTIONS_PER_MINUTE']) ?? 6,
  }
}

export type RateKind = 'create_game' | 'move' | 'join_fail' | 'reaction'
export type Log = (message: string) => void

const MESSAGES: Record<RateKind, string> = {
  create_game: 'You are starting tables too quickly. Please wait a few minutes.',
  move: 'You are making moves too quickly. Please slow down.',
  join_fail: 'Too many wrong table codes. Please wait a few minutes before trying again.',
  reaction: 'You are sending reactions too quickly. Please wait a moment.',
}

/**
 * How long to tell someone to wait: until the oldest counted action leaves the window, rounded UP to a whole second and
 * never less than one (a client told to retry after 0 seconds would simply hammer again).
 */
export function retryAfterSeconds(windowSeconds: number, oldestAgeSeconds: number | null): number {
  return Math.max(1, Math.ceil(windowSeconds - (oldestAgeSeconds ?? 0)))
}

function limited(kind: RateKind, waitSeconds: number, log?: Log): RateLimitError {
  // The log line names the limit, never the person: it is for spotting abuse, not for tracking anyone.
  log?.(`Rate limit reached: ${kind}`)
  return new RateLimitError(MESSAGES[kind], waitSeconds)
}

/**
 * Counts this action and refuses it if the person has already done `max` of this kind within `windowSeconds`.
 * One statement, so the count and the record happen together. (Two requests at the very same instant can both squeeze
 * through at the edge; these are soft limits against floods, not exact quotas.)
 */
export async function hit(db: Queryable, userId: string, kind: RateKind, max: number, windowSeconds: number, log?: Log): Promise<void> {
  const res = await db.query<{ inserted: number; oldest_age: number | null }>(
    `WITH recent AS (
       SELECT count(*)::int AS n, min(at) AS oldest
         FROM rate_events
        WHERE user_id = $1::uuid AND kind = $2::text AND at > now() - make_interval(secs => $3::float8)
     ), ins AS (
       INSERT INTO rate_events (user_id, kind) SELECT $1::uuid, $2::text FROM recent WHERE n < $4::int RETURNING 1
     )
     SELECT (SELECT count(*)::int FROM ins) AS inserted,
            EXTRACT(EPOCH FROM (now() - (SELECT oldest FROM recent)))::float8 AS oldest_age`,
    [userId, kind, windowSeconds, max],
  )
  const row = res.rows[0]!
  if (row.inserted === 0) throw limited(kind, retryAfterSeconds(windowSeconds, row.oldest_age), log)
}

/** Refuses if the person has already used up their allowance, WITHOUT counting this call. */
export async function assertUnderLimit(db: Queryable, userId: string, kind: RateKind, max: number, windowSeconds: number, log?: Log): Promise<void> {
  const res = await db.query<{ n: number; oldest_age: number | null }>(
    `SELECT count(*)::int AS n, EXTRACT(EPOCH FROM (now() - min(at)))::float8 AS oldest_age
       FROM rate_events
      WHERE user_id = $1::uuid AND kind = $2::text AND at > now() - make_interval(secs => $3::float8)`,
    [userId, kind, windowSeconds],
  )
  const row = res.rows[0]!
  if (row.n >= max) throw limited(kind, retryAfterSeconds(windowSeconds, row.oldest_age), log)
}

export async function record(db: Queryable, userId: string, kind: RateKind): Promise<void> {
  await db.query('INSERT INTO rate_events (user_id, kind) VALUES ($1, $2)', [userId, kind])
}

/** Caps on how many tables one person can have open at once, so nobody can fill the database with abandoned tables. */
export async function assertTableCaps(db: Queryable, userId: string, settings: LimitSettings, action: 'create' | 'join'): Promise<void> {
  const res = await db.query<{ status: string; n: number }>(
    `SELECT g.status, count(*)::int AS n
       FROM seats s JOIN games g ON g.id = s.game_id
      WHERE s.user_id = $1 AND g.status IN ('waiting', 'active')
      GROUP BY g.status`,
    [userId],
  )
  const count = (status: string) => res.rows.find((r) => r.status === status)?.n ?? 0
  if (action === 'create' && count('waiting') >= settings.maxWaitingTables) {
    throw new ConflictError(
      `You already have ${count('waiting')} tables waiting for players. Use Leave on one in Your tables, or wait for someone to join, before starting another.`,
    )
  }
  if (action === 'join' && count('active') >= settings.maxActiveTables) {
    throw new ConflictError(`You are already playing ${count('active')} matches. Finish one before joining another.`)
  }
}

export async function guardCreate(db: Queryable, userId: string, settings: LimitSettings, log?: Log): Promise<void> {
  if (!settings.enabled) return
  await assertTableCaps(db, userId, settings, 'create')
  await hit(db, userId, 'create_game', settings.createPerHour, 3600, log)
}

export async function guardMove(db: Queryable, userId: string, settings: LimitSettings, log?: Log): Promise<void> {
  if (!settings.enabled) return
  await hit(db, userId, 'move', settings.movesPerMinute, 60, log)
}

/**
 * Runs a join attempt under the limits: the open-matches cap, and a budget of WRONG codes (an unknown or malformed
 * code), which is how someone would try to guess their way to another person's table. A right code, even a full table,
 * does not use the budget.
 */
export async function guardJoin<T>(db: Queryable, userId: string, settings: LimitSettings, attempt: () => Promise<T>, log?: Log): Promise<T> {
  if (!settings.enabled) return attempt()
  await assertTableCaps(db, userId, settings, 'join')
  await assertUnderLimit(db, userId, 'join_fail', settings.failedJoinsPer10Min, 600, log)
  try {
    return await attempt()
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof BadRequestError) await record(db, userId, 'join_fail')
    throw err
  }
}

/** Quick reactions are limited per person, so they cannot be used to flood a table. */
export async function guardReaction(db: Queryable, userId: string, settings: LimitSettings, log?: Log): Promise<void> {
  if (!settings.enabled) return
  await hit(db, userId, 'reaction', settings.reactionsPerMinute, 60, log)
}

