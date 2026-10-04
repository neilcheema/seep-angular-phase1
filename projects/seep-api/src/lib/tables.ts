import type { Queryable } from './db'

/**
 * A person leaves a table that is still waiting for players (they chose to, or their account is being deleted).
 *
 *  - If other people are at it, the seat is freed and the table stays open for them; the version moves so they hear of it.
 *  - If nobody else is, the table is closed.
 *
 * The caller must already hold the game row's lock (SELECT ... FOR UPDATE).
 */
export async function releaseOrCloseWaiting(tx: Queryable, gameId: string, userId: string): Promise<'closed' | 'released'> {
  const others = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM seats WHERE game_id = $1 AND user_id IS NOT NULL AND user_id <> $2',
    [gameId, userId],
  )
  await tx.query('UPDATE seats SET user_id = NULL WHERE game_id = $1 AND user_id = $2', [gameId, userId])
  if (others.rows[0]!.n === 0) {
    await tx.query(`UPDATE games SET status = 'abandoned', version = version + 1, updated_at = now() WHERE id = $1`, [gameId])
    return 'closed'
  }
  await tx.query('UPDATE games SET version = version + 1, updated_at = now() WHERE id = $1', [gameId])
  return 'released'
}
