/**
 * The shapes the seep-api server sends and receives, as the browser sees
 * them over JSON. Mirrors projects/seep-api/src/lib/games.ts; the two
 * projects are separate packages, so this is kept in step by hand and by
 * the integration test, which runs this client against the real server code.
 */

export type GameKind = 'two_player' | 'four_player'
export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned'

/** The turn clock, as the server measured it. Optional because an older server does not send it yet. */
export interface ClockDto {
  /** The seat that is on the clock, or null when no clock is running (between hands, or before the game starts). */
  readonly seat: string | null
  /** How long that seat has been on the clock, as of this response. */
  readonly elapsedMs: number
  readonly warnAfterMs: number
  readonly forfeitAfterMs: number
}

export interface PlayerInfoDto {
  readonly seat: string
  readonly displayName: string | null
  readonly isBot: boolean
  readonly isYou: boolean
  /** False for a seat still waiting for someone to take it. */
  readonly joined: boolean
}

export interface GameInfoDto {
  readonly gameId: string
  readonly kind: GameKind
  readonly status: GameStatus
  readonly version: number
  /** The caller's own seat, in the server's absolute names ('player'/'opponent', or 'p1'..'p4'). */
  readonly seat: string
  /** Only present while the game is still waiting for players. */
  readonly inviteCode: string | null
  readonly players: PlayerInfoDto[]
}

export interface MoveRecordDto {
  readonly version: number
  readonly seat: string
  /** A game intent, or {"type":"deal-next"}. */
  readonly intent: unknown
}

export interface GameSnapshotDto<TView> extends GameInfoDto {
  /** The table made for a rematch of this (finished) game, once either player has asked for one. Absent from an older server. */
  readonly rematchGameId?: string | null
  readonly changed: true
  readonly view: TView
  /** Moves made after the `since` version the caller supplied. */
  readonly moves: MoveRecordDto[]
  readonly clock?: ClockDto
}

export interface GameUnchangedDto {
  readonly changed: false
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
  readonly clock?: ClockDto
}

export interface MutationDto<TView> {
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
  readonly seat: string
  readonly view: TView
  readonly clock?: ClockDto
}

/** What leaving a waiting table did: it was closed (nobody else was there) or the seat was freed for the others. */
export interface LeaveGameDto {
  readonly result: 'closed' | 'released'
}

/** What deleting an account did, in numbers. */
export interface DeleteAccountDto {
  readonly deleted: true
  readonly forfeited: number
  readonly closed: number
  readonly released: number
}

/** The table made for a rematch: the same shape as any table, plus whether this call made it or joined it. */
export interface RematchDto extends GameInfoDto {
  /** True for the first player to ask (a new table was made); false for the second (they joined it). */
  readonly created: boolean
}

export interface ProfileDto {
  readonly id: string
  readonly displayName: string | null
  readonly email: string | null
  readonly createdAt: string
}
