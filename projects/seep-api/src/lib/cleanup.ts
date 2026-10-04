import type { Db } from './db'

/**
 * Keeps the database small by retiring tables nobody is using. Two stages, so
 * nobody is ever surprised by a table vanishing:
 *
 *   1. ABANDON: a table that is still "waiting" or "active" but that nobody has
 *      moved at, or even looked at, for ABANDON days is marked abandoned. Its
 *      players see "this table was closed" rather than a frozen board.
 *   2. DELETE: a finished or abandoned table is deleted DELETE days after it
 *      ended (or was closed), taking its seats and move log with it. Those
 *      foreign keys cascade, so a delete cannot leave anything behind.
 *
 * It is safe to run at any time and as often as you like: each stage is a
 * single conditional statement, so a table that is moved at while the cleanup
 * runs is simply left alone, and running it twice does nothing the second time.
 *
 * Why this runs in the Function App and not inside Neon: Neon's pg_cron runs
 * inside the database, and a Free-plan database suspends itself after five
 * idle minutes (and that cannot be switched off), so a scheduler in there
 * would mostly not fire. A timer in the Function App wakes the database for
 * the moment it needs it.
 */

export interface CleanupSettings {
  /** CLEANUP_ENABLED=false switches it off without a redeploy. */
  readonly enabled: boolean
  /** CLEANUP_DRY_RUN=true reports what it WOULD do and changes nothing. */
  readonly dryRun: boolean
  readonly abandonAfterDays: number
  readonly deleteAfterDays: number
  readonly batchSize: number
  /** Log a warning if the database is larger than this after the cleanup. */
  readonly sizeWarnMb: number
}

export interface CleanupResult {
  readonly skipped: boolean
  readonly dryRun: boolean
  readonly abandoned: number
  readonly deleted: number
  /** Expired account-deletion markers removed (see 005_phase5_account_deletion.sql). */
  readonly markersPurged: number
  readonly batches: number
  readonly sizeBytesBefore: number | null
  readonly sizeBytesAfter: number | null
  readonly sizeWarning: boolean
}

const MAX_BATCH_SIZE = 1000
/**
 * How long an account-deletion marker is kept. Its only job is to stop a still-valid sign-in token (good for an hour)
 * from re-creating a deleted account, so 48 hours is generous. Not a setting: shortening it only invites trouble.
 */
export const DELETED_MARKER_HOURS = 48
/** Upper bound on delete batches per run, so one run can never loop for long. */
const MAX_BATCHES = 100

function wholeNumber(raw: string | undefined, min: number): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return n >= min ? n : undefined
}

const isTrue = (raw: string | undefined): boolean => ['true', '1', 'yes'].includes((raw ?? '').trim().toLowerCase())

export function cleanupSettings(env: Record<string, string | undefined> = process.env): CleanupSettings {
  const enabledRaw = (env['CLEANUP_ENABLED'] ?? '').trim().toLowerCase()
  return {
    enabled: !['false', '0', 'no'].includes(enabledRaw),
    dryRun: isTrue(env['CLEANUP_DRY_RUN']),
    // A mistyped 0 must never mean "abandon everything now": anything below one day falls back to the default.
    abandonAfterDays: wholeNumber(env['CLEANUP_ABANDON_DAYS'], 1) ?? 7,
    deleteAfterDays: wholeNumber(env['CLEANUP_DELETE_DAYS'], 1) ?? 30,
    batchSize: Math.min(wholeNumber(env['CLEANUP_BATCH_SIZE'], 1) ?? 200, MAX_BATCH_SIZE),
    sizeWarnMb: wholeNumber(env['CLEANUP_SIZE_WARN_MB'], 1) ?? 300,
  }
}

const ABANDON_WHERE = `
  g.status IN ('waiting', 'active')
  AND g.updated_at < now() - make_interval(days => $1::int)
  AND NOT EXISTS (
        SELECT 1 FROM seats s
         WHERE s.game_id = g.id AND s.last_seen_at > now() - make_interval(days => $1::int))`

const DELETE_WHERE = `
  g.status IN ('finished', 'abandoned')
  AND g.updated_at < now() - make_interval(days => $1::int)`

async function databaseSize(db: Db): Promise<number | null> {
  try {
    const res = await db.query<{ bytes: number }>('SELECT pg_database_size(current_database())::float8 AS bytes')
    return res.rows[0] ? Number(res.rows[0].bytes) : null
  } catch {
    return null // the size is for information; never let it stop a cleanup
  }
}

export async function runCleanup(db: Db, settings: CleanupSettings = cleanupSettings()): Promise<CleanupResult> {
  const empty = { abandoned: 0, deleted: 0, markersPurged: 0, batches: 0, sizeBytesBefore: null, sizeBytesAfter: null, sizeWarning: false }
  if (!settings.enabled) return { ...empty, skipped: true, dryRun: settings.dryRun }

  const sizeBytesBefore = await databaseSize(db)
  let abandoned = 0
  let deleted = 0
  let markersPurged = 0
  let batches = 0

  if (settings.dryRun) {
    abandoned = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM games g WHERE ${ABANDON_WHERE}`, [settings.abandonAfterDays])).rows[0]!.n
    deleted = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM games g WHERE ${DELETE_WHERE}`, [settings.deleteAfterDays])).rows[0]!.n
    markersPurged = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM deleted_accounts WHERE deleted_at < now() - make_interval(hours => $1::int)`, [DELETED_MARKER_HOURS])).rows[0]!.n
  } else {
    // Stage 1. Bumping the version tells anyone polling that the table changed; resetting updated_at starts stage 2's clock now.
    const closed = await db.query<{ id: string }>(
      `UPDATE games g SET status = 'abandoned', version = g.version + 1, updated_at = now()
        WHERE ${ABANDON_WHERE}
        RETURNING g.id`,
      [settings.abandonAfterDays],
    )
    abandoned = closed.rows.length

    // Stage 2, in batches so no single statement gets large. SKIP LOCKED leaves alone a table somebody is touching right now.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const gone = await db.query<{ id: string }>(
        `DELETE FROM games WHERE id IN (
            SELECT g.id FROM games g
             WHERE ${DELETE_WHERE}
             ORDER BY g.updated_at
             LIMIT $2
               FOR UPDATE SKIP LOCKED)
          RETURNING id`,
        [settings.deleteAfterDays, settings.batchSize],
      )
      batches++
      deleted += gone.rows.length
      if (gone.rows.length < settings.batchSize) break
    }

    // Stage 3: account-deletion markers that have outlived any token they could have blocked.
    const markers = await db.query<{ firebase_uid: string }>(
      `DELETE FROM deleted_accounts WHERE deleted_at < now() - make_interval(hours => $1::int) RETURNING firebase_uid`,
      [DELETED_MARKER_HOURS],
    )
    markersPurged = markers.rows.length
  }

  const sizeBytesAfter = await databaseSize(db)
  const sizeWarning = sizeBytesAfter !== null && sizeBytesAfter > settings.sizeWarnMb * 1024 * 1024
  return { skipped: false, dryRun: settings.dryRun, abandoned, deleted, markersPurged, batches, sizeBytesBefore, sizeBytesAfter, sizeWarning }
}

/** "12.3 MB", or "unknown" if the size could not be read. */
export function formatSize(bytes: number | null): string {
  return bytes === null ? 'unknown' : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
