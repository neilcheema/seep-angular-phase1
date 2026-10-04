import { releaseOrCloseWaiting } from './tables'
import { ENGINE_VERSION } from 'seep-engine'
import type { Db, Queryable } from './db'
import { type EngineAdapter, type GameKind, adapterFor } from './engines'
import { BadRequestError, ConflictError, IllegalMoveError, NotFoundError } from './errors'
import { parseIntent } from './intents'
import { generateInviteCode, normalizeInviteCode } from './invite-code'
import { CLOCK_PHASES, type ClockDto, PRESENCE_TOUCH_SECONDS, clockSettings } from './turn-clock'

/**
 * The game-hosting service: everything the API does to a game, as plain
 * functions over a Db. The HTTP layer (functions/*.ts) only parses a
 * request, calls one of these, and shapes the response.
 *
 * The rules live in seep-engine and are never reimplemented here — this
 * layer decides WHO may do WHAT and WHEN (seating, turn ownership comes
 * from the engine, versions, persistence), then asks the engine whether the
 * move itself is legal.
 */

export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned'

export interface PlayerInfo {
  readonly seat: string
  readonly displayName: string | null
  readonly isBot: boolean
  readonly isYou: boolean
  /** False for a seat still waiting for someone to take it. */
  readonly joined: boolean
}

export interface GameInfo {
  readonly gameId: string
  readonly kind: GameKind
  readonly status: GameStatus
  readonly version: number
  /** The caller's own seat. */
  readonly seat: string
  /** Only present while the game is still waiting for players. */
  readonly inviteCode: string | null
  readonly players: PlayerInfo[]
}

export interface MoveRecord {
  readonly version: number
  readonly seat: string
  readonly intent: unknown
}

export interface GameSnapshot extends GameInfo {
  readonly changed: true
  /** Redacted to what the caller's seat may see. */
  readonly view: unknown
  /** Moves after the `since` version the caller supplied (none if it supplied none). */
  readonly moves: MoveRecord[]
  readonly clock: ClockDto
  /** The table made for a rematch of this (finished) game, once either player has asked for one. */
  readonly rematchGameId: string | null
}

export interface GameUnchanged {
  readonly changed: false
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
  readonly clock: ClockDto
}

export interface MutationResult {
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
  readonly seat: string
  readonly view: unknown
  readonly clock: ClockDto
}

interface ListRow {
  id: string
  kind: GameKind
  status: GameStatus
  version: number
  state: unknown
  invite_code: string | null
  seat_key: string
}

/** A game as seen by one of its players, with the timing facts the turn clock needs (measured by Postgres). */
interface MemberRow extends ListRow {
  /** How long the current mover's clock has been running. */
  elapsed_ms: number
  /** How long ago this player was last seen at the table; null if never. */
  seen_ago_ms: number | null
  /** The table made for a rematch of this game, if one has been asked for. */
  rematch_game_id: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_MOVES_PER_POLL = 200
const MAX_CODE_ATTEMPTS = 5

function assertGameId(gameId: string): void {
  // Postgres would reject a malformed uuid with an error we'd report as a 500.
  if (!UUID_PATTERN.test(gameId)) throw new NotFoundError('Game not found.')
}

export function parseVersion(raw: unknown, name: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new BadRequestError(`${name} must be a whole number.`)
  }
  return n
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

/** Loads a game only if `userId` has a seat in it. Anyone else gets "not found". */
async function loadMember(tx: Queryable, gameId: string, userId: string, lock: boolean): Promise<MemberRow> {
  const res = await tx.query<MemberRow>(
    `SELECT g.id, g.kind, g.status, g.version, g.state, g.invite_code, g.rematch_game_id, s.seat_key,
            (EXTRACT(EPOCH FROM (now() - g.turn_started_at)) * 1000)::float8 AS elapsed_ms,
            (EXTRACT(EPOCH FROM (now() - s.last_seen_at)) * 1000)::float8 AS seen_ago_ms
       FROM games g
       JOIN seats s ON s.game_id = g.id AND s.user_id = $2
      WHERE g.id = $1
      ${lock ? 'FOR UPDATE OF g' : ''}`,
    [gameId, userId],
  )
  const row = res.rows[0]
  if (!row) throw new NotFoundError('Game not found.')
  return row
}

async function loadPlayers(tx: Queryable, gameId: string, userId: string, adapter: EngineAdapter): Promise<PlayerInfo[]> {
  const res = await tx.query<{ seat_key: string; user_id: string | null; is_bot: boolean; display_name: string | null }>(
    `SELECT s.seat_key, s.user_id, s.is_bot, u.display_name
       FROM seats s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.game_id = $1`,
    [gameId],
  )
  return res.rows
    .map((r) => ({
      seat: r.seat_key,
      displayName: r.display_name,
      isBot: r.is_bot,
      isYou: r.user_id === userId,
      joined: r.user_id !== null || r.is_bot,
    }))
    .sort((a, b) => adapter.seatKeys.indexOf(a.seat) - adapter.seatKeys.indexOf(b.seat))
}

async function buildInfo(tx: Queryable, row: ListRow, userId: string): Promise<GameInfo> {
  const adapter = adapterFor(row.kind)
  return {
    gameId: row.id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    seat: row.seat_key,
    inviteCode: row.status === 'waiting' ? row.invite_code : null,
    players: await loadPlayers(tx, row.id, userId, adapter),
  }
}

const isClockRunning = (row: Pick<MemberRow, 'status' | 'state'>, adapter: EngineAdapter): boolean =>
  row.status === 'active' && CLOCK_PHASES.has(adapter.phase(row.state))

/** What the viewer's screen needs to draw the clock, as of this response. */
function clockOf(row: MemberRow): ClockDto {
  const adapter = adapterFor(row.kind)
  const settings = clockSettings()
  const running = isClockRunning(row, adapter)
  return {
    seat: running ? adapter.turn(row.state) : null,
    elapsedMs: running ? Math.max(0, Math.round(row.elapsed_ms)) : 0,
    warnAfterMs: settings.warnAfterMs,
    forfeitAfterMs: settings.forfeitAfterMs,
  }
}

/** Records that this player has the table open, at most every PRESENCE_TOUCH_SECONDS so polling is not a write per request. */
async function touchPresence(q: Queryable, gameId: string, userId: string): Promise<void> {
  await q.query(
    `UPDATE seats SET last_seen_at = now()
      WHERE game_id = $1 AND user_id = $2
        AND (last_seen_at IS NULL OR last_seen_at < now() - interval '${PRESENCE_TOUCH_SECONDS} seconds')`,
    [gameId, userId],
  )
}

/**
 * Applies the turn clock, if it has run out, on behalf of a player who is waiting for the mover.
 *
 * Only the waiting player's own requests can trigger it, and only when they were seen recently: so a
 * forfeit always has a witness. If the waiting player has just come back after being away, the mover
 * is not punished for it: their clock restarts instead. The mover's own requests never forfeit them.
 * Returns true if anything changed (so the caller should re-read the game).
 */
async function settleClock(db: Db, row: MemberRow, userId: string): Promise<boolean> {
  const adapter = adapterFor(row.kind)
  const settings = clockSettings()
  const mayBeDue = (r: MemberRow) =>
    isClockRunning(r, adapter) && adapter.turn(r.state) !== r.seat_key && r.elapsed_ms >= settings.forfeitAfterMs
  if (!mayBeDue(row)) return false

  return db.transaction(async (tx) => {
    const locked = await loadMember(tx, row.id, userId, true)
    // Re-check under the lock: a move may have landed while we were deciding.
    if (locked.version !== row.version || !mayBeDue(locked)) return false

    const present = locked.seen_ago_ms !== null && locked.seen_ago_ms <= settings.presenceWindowMs
    if (!present) {
      await tx.query('UPDATE games SET turn_started_at = now() WHERE id = $1 AND version = $2', [locked.id, locked.version])
      return true
    }

    const mover = adapter.turn(locked.state)
    const next = adapter.forfeit(locked.state, mover)
    const updated = await tx.query<{ version: number }>(
      `UPDATE games SET state = $1::jsonb, status = 'finished', version = version + 1, updated_at = now(), turn_started_at = now()
        WHERE id = $2 AND version = $3
        RETURNING version`,
      [JSON.stringify(next), locked.id, locked.version],
    )
    if (updated.rows.length === 0) return false
    await tx.query('INSERT INTO move_log (game_id, seat_key, intent, version) VALUES ($1, $2, $3::jsonb, $4)', [
      locked.id,
      mover,
      JSON.stringify({ type: 'forfeit', reason: 'timeout' }),
      updated.rows[0]!.version,
    ])
    return true
  })
}

export interface CreateOptions {
  /** Injectable so a test can force a code collision. */
  readonly generateCode?: () => string
}

/** Inserts a table waiting for players, with the creator in the first seat and the rest open. Returns its id. */
async function insertWaitingGame(tx: Queryable, userId: string, kind: GameKind, state: unknown, code: string): Promise<string> {
  const adapter = adapterFor(kind)
  const game = await tx.query<{ id: string }>(
    `INSERT INTO games (kind, state, engine_version, status, invite_code, created_by, version)
     VALUES ($1, $2::jsonb, $3, 'waiting', $4, $5, 0)
     RETURNING id`,
    [kind, JSON.stringify(state), ENGINE_VERSION, code, userId],
  )
  const gameId = game.rows[0]!.id
  for (const [i, seatKey] of adapter.seatKeys.entries()) {
    await tx.query('INSERT INTO seats (game_id, seat_key, user_id) VALUES ($1, $2, $3)', [gameId, seatKey, i === 0 ? userId : null])
  }
  return gameId
}

/**
 * Gives the person the first open seat at a waiting table. EVERY arrival is a change somebody already at the table
 * must be able to see (the seats filling up on a waiting screen), so every arrival moves the version. Only the last
 * one also starts the game and its clock.
 */
async function claimSeat(tx: Queryable, gameId: string, userId: string): Promise<void> {
  const claimed = await tx.query<{ seat_key: string }>(
    `UPDATE seats SET user_id = $1
      WHERE id = (SELECT id FROM seats
                   WHERE game_id = $2 AND user_id IS NULL AND NOT is_bot
                   ORDER BY seat_key LIMIT 1)
        AND user_id IS NULL
      RETURNING seat_key`,
    [userId, gameId],
  )
  if (claimed.rows.length === 0) throw new ConflictError('That game is full.')

  const stillOpen = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM seats WHERE game_id = $1 AND user_id IS NULL AND NOT is_bot',
    [gameId],
  )
  const full = stillOpen.rows[0]!.n === 0
  await tx.query(
    `UPDATE games SET version = version + 1, updated_at = now(),
            status = CASE WHEN $2::boolean THEN 'active' ELSE status END,
            turn_started_at = CASE WHEN $2::boolean THEN now() ELSE turn_started_at END
      WHERE id = $1`,
    [gameId, full],
  )
}

export async function createGame(db: Db, userId: string, kind: GameKind, options: CreateOptions = {}): Promise<GameInfo> {
  const adapter = adapterFor(kind)
  const generateCode = options.generateCode ?? generateInviteCode
  const state = adapter.newMatch()

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode()
    try {
      return await db.transaction(async (tx) => {
        const gameId = await insertWaitingGame(tx, userId, kind, state, code)
        const row = await loadMember(tx, gameId, userId, false)
        return buildInfo(tx, row, userId)
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // That invite code was already taken; loop and try another.
    }
  }
  throw new Error('Could not allocate a unique invite code.')
}

export async function joinGame(db: Db, userId: string, rawCode: unknown): Promise<GameInfo> {
  const code = normalizeInviteCode(rawCode)
  return db.transaction(async (tx) => {
    const found = await tx.query<{ id: string; status: GameStatus }>(
      'SELECT id, status FROM games WHERE invite_code = $1 FOR UPDATE',
      [code],
    )
    const game = found.rows[0]
    if (!game) throw new NotFoundError('No game found for that code.')

    // Joining twice is harmless: you just get your existing seat back.
    const mine = await tx.query<{ seat_key: string }>('SELECT seat_key FROM seats WHERE game_id = $1 AND user_id = $2', [
      game.id,
      userId,
    ])
    if (mine.rows.length === 0) {
      if (game.status !== 'waiting') throw new ConflictError('That game is no longer open.')
      await claimSeat(tx, game.id, userId)
    }
    const row = await loadMember(tx, game.id, userId, false)
    return buildInfo(tx, row, userId)
  })
}

export async function listMyGames(db: Db, userId: string): Promise<GameInfo[]> {
  const res = await db.query<ListRow>(
    `SELECT g.id, g.kind, g.status, g.version, g.state, g.invite_code, s.seat_key
       FROM games g
       JOIN seats s ON s.game_id = g.id AND s.user_id = $1
      WHERE g.status IN ('waiting', 'active')
      ORDER BY g.updated_at DESC
      LIMIT 20`,
    [userId],
  )
  const out: GameInfo[] = []
  for (const row of res.rows) out.push(await buildInfo(db, row, userId))
  return out
}

/**
 * The poll. If the caller already has `since === version` this is a cheap
 * "nothing new"; otherwise it returns the caller's redacted view plus the
 * moves made after `since`, so a client can show what the others just did.
 */
export async function getGame(
  db: Db,
  userId: string,
  gameId: string,
  since?: number,
): Promise<GameSnapshot | GameUnchanged> {
  assertGameId(gameId)
  let row = await loadMember(db, gameId, userId, false)
  if (await settleClock(db, row, userId)) row = await loadMember(db, gameId, userId, false)
  await touchPresence(db, row.id, userId)
  if (since !== undefined && since === row.version) {
    // Even "nothing new" carries the clock: a restart changes no move, but the movers' screens must hear of it.
    return { changed: false, gameId: row.id, version: row.version, status: row.status, clock: clockOf(row) }
  }

  const adapter = adapterFor(row.kind)
  let moves: MoveRecord[] = []
  if (since !== undefined) {
    const res = await db.query<{ version: number; seat_key: string; intent: unknown }>(
      `SELECT version, seat_key, intent FROM move_log
        WHERE game_id = $1 AND version > $2
        ORDER BY version ASC LIMIT ${MAX_MOVES_PER_POLL}`,
      [row.id, since],
    )
    moves = res.rows.map((m) => ({ version: m.version, seat: m.seat_key, intent: m.intent }))
  }
  return {
    changed: true,
    ...(await buildInfo(db, row, userId)),
    view: adapter.viewFor(row.state, row.seat_key),
    moves,
    clock: clockOf(row),
    rematchGameId: row.rematch_game_id ?? null,
  }
}

interface Step {
  /** The state to persist. */
  readonly next: unknown
  /** What goes in the append-only move log. */
  readonly logged: unknown
}

/**
 * The one place a game's state ever changes after it starts. Every mutation
 * is: lock the row, check the caller may act and hasn't gone stale, let the
 * engine decide, then a version-guarded UPDATE plus a move_log row —
 * together, in one transaction.
 *
 * Two layers stop two simultaneous moves both applying: `FOR UPDATE` makes
 * the second wait for the first, and the UPDATE's `AND version = $4` means
 * that even if something slipped past the lock, a write based on a stale
 * read matches zero rows and is refused rather than silently overwriting.
 */
async function mutateGame(
  db: Db,
  userId: string,
  gameId: string,
  expectedVersion: number | undefined,
  step: (ctx: { adapter: EngineAdapter; state: unknown; seat: string }) => Step,
): Promise<MutationResult> {
  assertGameId(gameId)
  return db.transaction(async (tx) => {
    const game = await loadMember(tx, gameId, userId, true)
    if (game.status === 'waiting') throw new ConflictError('Waiting for the other players to join.')
    if (game.status !== 'active') throw new ConflictError('This game is over.')
    if (expectedVersion !== undefined && expectedVersion !== game.version) {
      throw new ConflictError('The game has changed since you last looked.', { currentVersion: game.version })
    }

    const adapter = adapterFor(game.kind)
    let result: Step
    try {
      result = step({ adapter, state: game.state, seat: game.seat_key })
    } catch (err) {
      throw new IllegalMoveError(err instanceof Error ? err.message : 'That move is not allowed.')
    }

    const status: GameStatus = adapter.isMatchOver(result.next) ? 'finished' : 'active'
    const updated = await tx.query<{ version: number }>(
      `UPDATE games SET state = $1::jsonb, status = $2, version = version + 1, updated_at = now(), turn_started_at = now()
        WHERE id = $3 AND version = $4
        RETURNING version`,
      [JSON.stringify(result.next), status, game.id, game.version],
    )
    if (updated.rows.length === 0) {
      throw new ConflictError('The game changed while your move was being applied. Please try again.', {
        currentVersion: game.version,
      })
    }
    const version = updated.rows[0]!.version
    await tx.query('INSERT INTO move_log (game_id, seat_key, intent, version) VALUES ($1, $2, $3::jsonb, $4)', [
      game.id,
      game.seat_key,
      JSON.stringify(result.logged),
      version,
    ])
    await touchPresence(tx, game.id, userId)
    const settings = clockSettings()
    const nowRunning = status === 'active' && CLOCK_PHASES.has(adapter.phase(result.next))
    return {
      gameId: game.id,
      version,
      status,
      seat: game.seat_key,
      view: adapter.viewFor(result.next, game.seat_key),
      clock: {
        seat: nowRunning ? adapter.turn(result.next) : null,
        elapsedMs: 0,
        warnAfterMs: settings.warnAfterMs,
        forfeitAfterMs: settings.forfeitAfterMs,
      },
    }
  })
}

export async function submitMove(
  db: Db,
  userId: string,
  gameId: string,
  rawIntent: unknown,
  expectedVersion?: number,
): Promise<MutationResult> {
  // Shape-check before touching the database at all.
  const intent = parseIntent(rawIntent)
  return mutateGame(db, userId, gameId, expectedVersion, ({ adapter, state, seat }) => ({
    next: adapter.applyMove(state, seat, intent),
    logged: intent,
  }))
}

/** Deals the next hand once one has finished. Any seated player may ask for it. */
export async function dealNext(db: Db, userId: string, gameId: string, expectedVersion?: number): Promise<MutationResult> {
  return mutateGame(db, userId, gameId, expectedVersion, ({ adapter, state }) => ({
    next: adapter.dealNext(state),
    logged: { type: 'deal-next' },
  }))
}

/**
 * Leaves a table that is still waiting for players: the seat is freed and the table stays open for anyone else
 * there, or is closed if nobody else is. A match under way cannot be left this way (that would be a forfeit).
 */
export async function leaveWaitingTable(db: Db, userId: string, gameId: string): Promise<{ result: 'closed' | 'released' }> {
  assertGameId(gameId)
  return db.transaction(async (tx) => {
    const row = await loadMember(tx, gameId, userId, true)
    if (row.status !== 'waiting') throw new ConflictError('You can only leave a table that is still waiting for players.')
    return { result: await releaseOrCloseWaiting(tx, gameId, userId) }
  })
}

export interface RematchGuards {
  /** Runs inside the transaction just before a NEW table is made (for the person who asks first). */
  readonly beforeCreate?: (tx: Queryable) => Promise<void>
  /** Runs inside the transaction just before the person joins a table the other player already made. */
  readonly beforeJoin?: (tx: Queryable) => Promise<void>
}

export interface RematchResult extends GameInfo {
  /** True for the first player to ask (a new table was made); false for the second (they joined it). */
  readonly created: boolean
}

/**
 * A rematch of a finished two-player match. The first player to ask gets a new table with them in the first seat, and
 * the finished game remembers it. The second player's request finds that table and joins it, which starts the match.
 * Asking again is harmless (you get the same table back). Both asking at once is safe: the finished game's row is
 * locked, so one of them is first.
 *
 * Four-player rematches are not offered: keeping the same partners would need seats reserved for specific people.
 */
export async function requestRematch(
  db: Db,
  userId: string,
  gameId: string,
  guards: RematchGuards = {},
  options: CreateOptions = {},
): Promise<RematchResult> {
  assertGameId(gameId)
  const generateCode = options.generateCode ?? generateInviteCode
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode()
    try {
      return await db.transaction(async (tx) => {
        const old = await loadMember(tx, gameId, userId, true)
        if (old.status !== 'finished') throw new ConflictError('You can only ask for a rematch once the match is over.')
        if (old.kind !== 'two_player') throw new ConflictError('Rematches are only available for two-player matches.')

        if (old.rematch_game_id) {
          const existing = await tx.query<{ status: GameStatus }>('SELECT status FROM games WHERE id = $1 FOR UPDATE', [old.rematch_game_id])
          const status = existing.rows[0]?.status
          if (status && status !== 'abandoned') {
            const mine = await tx.query('SELECT 1 FROM seats WHERE game_id = $1 AND user_id = $2', [old.rematch_game_id, userId])
            if (mine.rows.length === 0) {
              if (status !== 'waiting') throw new ConflictError('That rematch is already under way.')
              await guards.beforeJoin?.(tx)
              await claimSeat(tx, old.rematch_game_id, userId)
            }
            const row = await loadMember(tx, old.rematch_game_id, userId, false)
            return { ...(await buildInfo(tx, row, userId)), created: false }
          }
          // The earlier rematch table was closed or is gone: fall through and make a fresh one.
        }

        await guards.beforeCreate?.(tx)
        const newId = await insertWaitingGame(tx, userId, 'two_player', adapterFor('two_player').newMatch(), code)
        await tx.query('UPDATE games SET rematch_game_id = $1, version = version + 1, updated_at = now() WHERE id = $2', [newId, old.id])
        const row = await loadMember(tx, newId, userId, false)
        return { ...(await buildInfo(tx, row, userId)), created: true }
      })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // That invite code was already taken; loop and try another.
    }
  }
  throw new Error('Could not allocate a unique invite code.')
}
