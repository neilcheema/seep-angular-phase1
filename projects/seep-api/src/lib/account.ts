import type { Db } from './db'
import { adapterFor } from './engines'
import { releaseOrCloseWaiting } from './tables'

export interface DeleteAccountResult {
  readonly deleted: true
  /** Matches in progress that were ended as forfeits (the other player or team wins). */
  readonly forfeited: number
  /** Tables that were closed because nobody was left at them. */
  readonly closed: number
  /** Tables still waiting for players, which stay open with this person's seat freed. */
  readonly released: number
}

interface TableRow {
  id: string
  kind: 'two_player' | 'four_player'
  status: 'waiting' | 'active'
  state: unknown
  seat_key: string
}

/**
 * Erases a person from the database, in one transaction, so it either all happens or none of it does.
 *
 *  - A match in progress is forfeited: the opponent (or the other team) wins, and the log says the person left.
 *  - A table still waiting for players loses this person's seat and stays open for the others; if nobody
 *    is left at it, it is closed.
 *  - Finished and closed tables keep their record, with the person unlinked from their seat.
 *  - The users row (name, email) is deleted. games.created_by and seats.user_id are emptied first.
 *  - A marker is left so the account cannot be re-created by a token that is still valid (see
 *    005_phase5_account_deletion.sql). The daily cleanup removes it later.
 *
 * Calling it again, or for someone who was never here, is harmless and reports success: a deletion that
 * "fails" because it already worked would be a poor experience, and a person must always be able to finish it.
 */
export async function deleteAccount(db: Db, firebaseUid: string): Promise<DeleteAccountResult> {
  return db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO deleted_accounts (firebase_uid) VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET deleted_at = now()`,
      [firebaseUid],
    )
    const found = await tx.query<{ id: string }>('SELECT id FROM users WHERE firebase_uid = $1 FOR UPDATE', [firebaseUid])
    const userId = found.rows[0]?.id
    if (!userId) return { deleted: true, forfeited: 0, closed: 0, released: 0 } as const

    // Lock every unfinished table this person sits at, in a fixed order, so a deletion cannot deadlock with another.
    const tables = await tx.query<TableRow>(
      `SELECT g.id, g.kind, g.status, g.state, s.seat_key
         FROM games g
         JOIN seats s ON s.game_id = g.id AND s.user_id = $1
        WHERE g.status IN ('waiting', 'active')
        ORDER BY g.id
          FOR UPDATE OF g`,
      [userId],
    )

    let forfeited = 0
    let closed = 0
    let released = 0
    for (const table of tables.rows) {
      if (table.status === 'active') {
        // Defensive: if a match cannot be forfeited for some reason, the person must still be able to leave. Close it.
        let next: unknown = null
        try {
          next = adapterFor(table.kind).forfeit(table.state, table.seat_key, 'left')
        } catch {
          next = null
        }
        if (next === null) {
          await tx.query(`UPDATE games SET status = 'abandoned', version = version + 1, updated_at = now() WHERE id = $1`, [table.id])
          closed++
          continue
        }
        const updated = await tx.query<{ version: number }>(
          `UPDATE games SET state = $1::jsonb, status = 'finished', version = version + 1, updated_at = now(), turn_started_at = now()
            WHERE id = $2 RETURNING version`,
          [JSON.stringify(next), table.id],
        )
        await tx.query('INSERT INTO move_log (game_id, seat_key, intent, version) VALUES ($1, $2, $3::jsonb, $4)', [
          table.id,
          table.seat_key,
          JSON.stringify({ type: 'forfeit', reason: 'left' }),
          updated.rows[0]!.version,
        ])
        forfeited++
      } else {
        // Others waiting: the seat is freed and they are told. Nobody else: the table is closed.
        if ((await releaseOrCloseWaiting(tx, table.id, userId)) === 'closed') closed++
        else released++
      }
    }

    await tx.query('UPDATE seats SET user_id = NULL WHERE user_id = $1', [userId])
    await tx.query('UPDATE games SET created_by = NULL WHERE created_by = $1', [userId])
    await tx.query('DELETE FROM users WHERE id = $1', [userId])
    return { deleted: true, forfeited, closed, released } as const
  })
}
