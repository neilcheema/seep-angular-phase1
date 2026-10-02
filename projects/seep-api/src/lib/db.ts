import { Pool } from '@neondatabase/serverless'

/**
 * Uses Neon's own serverless driver, not the plain `pg` package — Azure
 * Functions on the Consumption plan can spin up many short-lived
 * instances under load, and this driver (used with Neon's pooled
 * connection string, not the direct one) is specifically built to avoid
 * exhausting a small database's connection limit in exactly that
 * environment. See the planning notes, section 4, for why this matters.
 */
let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL']
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set')
    }
    pool = new Pool({ connectionString })
  }
  return pool
}

/** Exposed for tests only, so a test can inject a fake pool instead of a real database connection. */
export function _setPoolForTests(fake: Pool | null): void {
  pool = fake
}
