import { randomInt } from 'node:crypto'
import {
  type FourPlayerGameState,
  type GameState,
  type Intent,
  type PlayerId,
  SeatId,
  applyFourPlayerMove,
  applyMove,
  dealNextFourPlayerHand,
  dealNextHand,
  type ForfeitReason,
  forfeitFourPlayerMatch,
  forfeitMatch,
  startFourPlayerMatch,
  startMatch,
  viewFor,
  viewForSeat,
} from 'seep-engine'

export type GameKind = 'two_player' | 'four_player'

export const GAME_KINDS: readonly GameKind[] = ['two_player', 'four_player']

export function isGameKind(value: unknown): value is GameKind {
  return typeof value === 'string' && (GAME_KINDS as readonly string[]).includes(value)
}

/**
 * Everything the service layer needs to know about a particular game type,
 * in one place, so games.ts never branches on `kind` itself. Methods (not
 * function-valued properties) on purpose: it lets a typed adapter be used
 * where the loosely-typed one is expected.
 */
export interface EngineAdapter {
  /** Seat keys in the order they're handed out: the creator takes the first. */
  readonly seatKeys: readonly string[]
  newMatch(): unknown
  applyMove(state: unknown, seat: string, intent: Intent): unknown
  dealNext(state: unknown): unknown
  viewFor(state: unknown, seat: string): unknown
  phase(state: unknown): string
  /** The seat that has to act next. */
  turn(state: unknown): string
  /** Ends the match because `loserSeat` ran out of time (the default) or left. */
  forfeit(state: unknown, loserSeat: string, reason?: ForfeitReason): unknown
  isMatchOver(state: unknown): boolean
}

/**
 * The 2P engine writes its log from the 'player' seat's point of view
 * ("You played...", "Opponent threw..."). Seen by the OTHER seat that reads
 * backwards, so for them the three perspective words trade places. Done in
 * one pass so a word isn't swapped twice. Safe because those are the only
 * perspective-dependent tokens the 2P engine ever writes, and the match
 * simulation test checks it against every entry of a real game.
 */
export function swapLogPerspective(entry: string): string {
  return entry.replace(/\b(You|you|Opponent|opponent)\b/g, (word) => {
    switch (word) {
      case 'You':
        return 'Opponent'
      case 'Opponent':
        return 'You'
      case 'opponent':
        return 'you'
      default:
        return 'opponent'
    }
  })
}

const twoPlayer: EngineAdapter = {
  seatKeys: ['player', 'opponent'],
  newMatch() {
    // Either seat may bid first; flipping a coin avoids always favouring the creator.
    const firstBidder: PlayerId = randomInt(2) === 0 ? 'player' : 'opponent'
    return startMatch(firstBidder)
  },
  applyMove(state, seat, intent) {
    return applyMove(state as GameState, seat as PlayerId, intent)
  },
  dealNext(state) {
    return dealNextHand(state as GameState)
  },
  viewFor(state, seat) {
    const view = viewFor(state as GameState, seat as PlayerId)
    return seat === 'opponent' ? { ...view, log: view.log.map(swapLogPerspective) } : view
  },
  phase(state) {
    return (state as GameState).phase
  },
  turn(state) {
    return (state as GameState).turn
  },
  forfeit(state, loserSeat, reason) {
    return forfeitMatch(state as GameState, loserSeat as PlayerId, reason)
  },
  isMatchOver(state) {
    return (state as GameState).phase === 'match-over'
  },
}

const SEATS: readonly SeatId[] = [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]

const fourPlayer: EngineAdapter = {
  seatKeys: SEATS,
  newMatch() {
    return startFourPlayerMatch(SEATS[randomInt(SEATS.length)])
  },
  applyMove(state, seat, intent) {
    return applyFourPlayerMove(state as FourPlayerGameState, seat as SeatId, intent)
  },
  dealNext(state) {
    return dealNextFourPlayerHand(state as FourPlayerGameState)
  },
  // The 4P engine's log names seats absolutely ("p2 played..."), which reads the same to everyone.
  viewFor(state, seat) {
    return viewForSeat(state as FourPlayerGameState, seat as SeatId)
  },
  phase(state) {
    return (state as FourPlayerGameState).phase
  },
  turn(state) {
    return (state as FourPlayerGameState).turn
  },
  forfeit(state, loserSeat, reason) {
    return forfeitFourPlayerMatch(state as FourPlayerGameState, loserSeat as SeatId, reason)
  },
  isMatchOver(state) {
    return (state as FourPlayerGameState).phase === 'match-over'
  },
}

export function adapterFor(kind: GameKind): EngineAdapter {
  return kind === 'two_player' ? twoPlayer : fourPlayer
}
