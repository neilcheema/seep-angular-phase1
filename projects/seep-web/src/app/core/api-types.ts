/**
 * The shapes the seep-api server sends and receives, as the browser sees
 * them over JSON. Mirrors projects/seep-api/src/lib/games.ts; the two
 * projects are separate packages, so this is kept in step by hand and by
 * the integration test, which runs this client against the real server code.
 */

export type GameKind = 'two_player' | 'four_player'
export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned'

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
  readonly changed: true
  readonly view: TView
  /** Moves made after the `since` version the caller supplied. */
  readonly moves: MoveRecordDto[]
}

export interface GameUnchangedDto {
  readonly changed: false
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
}

export interface MutationDto<TView> {
  readonly gameId: string
  readonly version: number
  readonly status: GameStatus
  readonly seat: string
  readonly view: TView
}

export interface ProfileDto {
  readonly id: string
  readonly displayName: string | null
  readonly email: string | null
  readonly createdAt: string
}
