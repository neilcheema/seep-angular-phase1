import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Db, Queryable } from '../../lib/db'

/**
 * A real Postgres (PGlite: Postgres compiled to WASM) with the project's
 * actual migration files applied in order. Tests that use this exercise the
 * real SQL and the real schema — constraints, indexes, JSONB, RETURNING,
 * transactions and rollback — not a mock of them.
 *
 * What it cannot do: PGlite serves one connection, so two transactions never
 * truly overlap the way they can against a networked Postgres. Race
 * *handling* is covered by tests that simulate a lost race; genuine lock
 * contention is a property of Postgres itself, not of this code.
 */

export const MIGRATIONS = ['001_phase3_schema.sql', '002_phase4_games.sql', '003_phase4_turn_clock.sql', '004_phase4_cleanup_index.sql', '005_phase5_account_deletion.sql', '006_phase5_rate_limits.sql'] as const
const MIGRATION_DIR = join(__dirname, '..', '..', '..', 'db')

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATION_DIR, name), 'utf8')
}

type RawQuery = Pick<PGlite, 'query'>

function toQueryable(target: RawQuery): Queryable {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await target.query(text, params)
      return { rows: res.rows as T[] }
    },
  }
}

export interface TestDb {
  readonly db: Db
  readonly raw: PGlite
  /** Empties every table, much faster than starting a new database per test. */
  reset(): Promise<void>
  close(): Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const raw = new PGlite()
  for (const migration of MIGRATIONS) await raw.exec(readMigration(migration))
  const db: Db = {
    ...toQueryable(raw),
    transaction: (fn) => raw.transaction((tx) => fn(toQueryable(tx))),
  }
  return {
    db,
    raw,
    reset: async () => {
      await raw.exec('TRUNCATE users, games, seats, move_log, deleted_accounts, rate_events RESTART IDENTITY CASCADE')
    },
    close: () => raw.close(),
  }
}

export interface TestUser {
  readonly id: string
  readonly uid: string
}

export async function makeUser(db: Db, label: string): Promise<TestUser> {
  const uid = `firebase-${label}`
  const res = await db.query<{ id: string }>(
    'INSERT INTO users (firebase_uid, email) VALUES ($1, $2) RETURNING id',
    [uid, `${label}@example.test`],
  )
  return { id: res.rows[0]!.id, uid }
}
