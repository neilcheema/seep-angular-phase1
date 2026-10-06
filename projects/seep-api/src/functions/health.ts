import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { getDb } from '../lib/db'

/**
 * GET /api/v1/health — is the service up?
 *
 *   /v1/health          Answers at once and never touches the database. This is the one for an uptime monitor to ping
 *                       every minute: a ping that woke the database would keep Neon running all month and use up the
 *                       Free plan's compute hours.
 *   /v1/health?deep=1   Also checks the database is reachable AND that every migration has been run (the tables and
 *                       columns the code relies on exist). Meant for people, for smoke tests and for a check right after a
 *                       deploy, not for a monitor. It is also throttled: within 30 seconds of the last deep check the
 *                       same answer is repeated, so it cannot be used to hammer the database.
 *
 * Anonymous, and it says nothing beyond ok or degraded. What exactly is missing goes to the log, not to the caller.
 */

/** The tables and columns the code needs. If a migration was skipped, one of these is missing. */
export const REQUIRED_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  users: ['display_name'],
  games: ['version', 'invite_code', 'created_by', 'turn_started_at', 'rematch_game_id', 'reaction_seq'],
  seats: ['is_bot', 'last_seen_at'],
  move_log: ['version'],
  deleted_accounts: ['firebase_uid'],
  rate_events: ['kind'],
  reactions: ['code', 'to_seat'],
}

/** Functions the code relies on (migration 010 creates the one that compares display names). */
export const REQUIRED_FUNCTIONS: readonly string[] = ['seep_name_key']

const DEEP_REPEAT_MS = 30_000
let lastDeep: { at: number; status: number; body: Record<string, unknown> } | null = null

export function _resetHealthThrottleForTests(): void {
  lastDeep = null
}

export async function healthHandler(request: HttpRequest, context: InvocationContext, now: () => number = Date.now): Promise<HttpResponseInit> {
  const headers = { 'Cache-Control': 'no-store' }
  if (request.query.get('deep') !== '1') return { status: 200, headers, jsonBody: { status: 'ok' } }

  const t = now()
  if (lastDeep && t - lastDeep.at < DEEP_REPEAT_MS) return { status: lastDeep.status, headers, jsonBody: lastDeep.body }

  let status = 200
  let body: Record<string, unknown>
  try {
    const found = await getDb().query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [Object.keys(REQUIRED_SCHEMA)],
    )
    const have = new Set(found.rows.map((r) => `${r.table_name}.${r.column_name}`))
    const functions = await getDb().query<{ proname: string }>('SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])', [REQUIRED_FUNCTIONS])
    const haveFunctions = new Set(functions.rows.map((r) => r.proname))
    const missing = [
      ...Object.entries(REQUIRED_SCHEMA).flatMap(([table, columns]) => columns.filter((c) => !have.has(`${table}.${c}`)).map((c) => `${table}.${c}`)),
      ...REQUIRED_FUNCTIONS.filter((f) => !haveFunctions.has(f)).map((f) => `function ${f}`),
    ]
    if (missing.length > 0) {
      status = 503
      body = { status: 'degraded', database: 'ok', schema: 'out-of-date' }
      context.warn(`Health check: the database is missing ${missing.join(', ')}. A migration has not been run.`)
    } else {
      body = { status: 'ok', database: 'ok', schema: 'ok' }
    }
  } catch (err) {
    status = 503
    body = { status: 'degraded', database: 'down' }
    context.error(`Health check: the database could not be reached (${err instanceof Error ? err.name : 'error'}).`)
  }
  lastDeep = { at: t, status, body }
  return { status, headers, jsonBody: body }
}

app.http('health', { methods: ['GET'], authLevel: 'anonymous', route: 'v1/health', handler: (request, context) => healthHandler(request, context) })
