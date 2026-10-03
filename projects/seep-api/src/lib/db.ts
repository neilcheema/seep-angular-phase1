import { Pool } from '@neondatabase/serverless'

/**
 * A deliberately tiny database interface. Production implements it on
 * Neon's serverless driver; tests implement it on PGlite, a real Postgres
 * engine compiled to WASM — so the actual SQL in this project (the
 * migrations, the upserts, the version-guarded updates, the
 * transactions) runs against real Postgres in tests, not a mock.
 *
 * Deliberately no `rowCount`: it means different things across drivers for
 * SELECT vs UPDATE. Anything that needs to know whether a statement
 * matched uses RETURNING and checks `rows.length`, which means the same
 * thing everywhere.
 */
export interface QueryResult<T> {
  readonly rows: T[]
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
}

export function createNeonDb(connectionString: string): Db {
  const pool = new Pool({ connectionString })
  return {
    async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      const res = await pool.query(text, params)
      return { rows: res.rows as T[] }
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tx: Queryable = {
          async query<R>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
            const res = await client.query(text, params)
            return { rows: res.rows as R[] }
          },
        }
        const result = await fn(tx)
        await client.query('COMMIT')
        return result
      } catch (err) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // The connection may already be gone; the original error is the one that matters.
        }
        throw err
      } finally {
        client.release()
      }
    },
  }
}

let db: Db | null = null

export function getDb(): Db {
  if (!db) {
    const connectionString = process.env['DATABASE_URL']
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    db = createNeonDb(connectionString)
  }
  return db
}

/** Exposed for tests only, so a test can inject a Db backed by an in-memory Postgres. */
export function _setDbForTests(fake: Db | null): void {
  db = fake
}
