import { type Card, legalHouseBids } from './card'
import { createDeck, dealFourPlayerHands, shuffleDeck } from './deck'
import { ALL_SEATS, ALL_TEAMS, type SeatId, type TeamId, nextSeat } from './seats'
import { type FloorItem, isHouse } from './floor'
import { type HandSideTotals, checkBazziWinner, computeHandTotals } from './scoring'

export type FourPlayerPhase = 'bidding' | 'opening-move' | 'playing' | 'hand-over' | 'match-over'

export interface FourPlayerGameState {
  readonly floor: FloorItem<SeatId>[]
  readonly hands: Record<SeatId, Card[]>
  readonly captures: Record<TeamId, Card[]>
  readonly sweepPoints: Record<TeamId, number>
  readonly matchScores: Record<TeamId, number>
  readonly dealer: SeatId
  readonly bidder: SeatId
  readonly turn: SeatId
  readonly phase: FourPlayerPhase
  readonly bidValue: number | null
  /** The bidder's first four dealt cards — the only cards a bid may be called from (spec §8.3). */
  readonly bidderInitialCards: Card[]
  readonly lastCapturer: TeamId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly nextItemId: number
  readonly log: string[]
  readonly winner: TeamId | null
  readonly lastHandTotals: Record<TeamId, HandSideTotals> | null
  readonly misdeals: number
}

const MAX_MISDEAL_ATTEMPTS = 25

function emptyRecord<Id extends string, V>(ids: readonly Id[], factory: () => V): Record<Id, V> {
  const out = {} as Record<Id, V>
  for (const id of ids) out[id] = factory()
  return out
}

function pushLog(state: FourPlayerGameState, message: string): FourPlayerGameState {
  return { ...state, log: [...state.log, message] }
}

// ---------------------------------------------------------------------------
// Dealing (spec §8.3)
// ---------------------------------------------------------------------------

/**
 * Deals a fresh four-player hand. The bidder is always the seat after the
 * dealer in turn order. As in the two-player engine, if the bidder's
 * first four cards hold no house-value (9-13) card, it's a misdeal and
 * the whole hand is reshuffled and redealt.
 */
export function dealFourPlayerHand(
  dealer: SeatId,
  matchScores: Record<TeamId, number> = emptyRecord(ALL_TEAMS, () => 0),
): FourPlayerGameState {
  const bidder = nextSeat(dealer)
  let attempt = 0
  let floor: Card[] = []
  let hands: Record<SeatId, Card[]> = emptyRecord(ALL_SEATS, () => [])

  do {
    const deck = shuffleDeck(createDeck())
    const dealt = dealFourPlayerHands(deck, bidder)
    floor = dealt.floor
    hands = dealt.hands
    attempt++
  } while (legalHouseBids(hands[bidder].slice(0, 4)).length === 0 && attempt < MAX_MISDEAL_ATTEMPTS)

  const totalPlayable = ALL_SEATS.reduce((t, s) => t + hands[s].length, 0)

  const state: FourPlayerGameState = {
    floor: floor.map((card, i) => ({ kind: 'loose', id: `f${i}`, card }) as const),
    hands,
    captures: emptyRecord(ALL_TEAMS, () => [] as Card[]),
    sweepPoints: emptyRecord(ALL_TEAMS, () => 0),
    matchScores,
    dealer,
    bidder,
    turn: bidder,
    phase: 'bidding',
    bidValue: null,
    bidderInitialCards: hands[bidder].slice(0, 4),
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: totalPlayable,
    nextItemId: floor.length,
    log:
      attempt > 1 ? [`Misdealt ${attempt - 1} time(s) — no house card in the bidder's first four.`] : [],
    winner: null,
    lastHandTotals: null,
    misdeals: attempt - 1,
  }
  return pushLog(state, `New hand dealt. Dealer: ${dealer}. ${bidder} must bid.`)
}

/** Starts a brand-new match. With no explicit dealer, one is chosen at random (spec §8.3). */
export function startFourPlayerMatch(dealer?: SeatId): FourPlayerGameState {
  const firstDealer = dealer ?? ALL_SEATS[Math.floor(Math.random() * ALL_SEATS.length)]!
  return dealFourPlayerHand(firstDealer)
}

/**
 * Deals the next hand once the current one is over. Deal passes to the
 * next seat in turn order (spec §8.3) — the common case for this digital
 * engine, since hands always run to completion rather than ending early.
 */
export function dealNextFourPlayerHand(state: FourPlayerGameState): FourPlayerGameState {
  if (state.phase !== 'hand-over') throw new Error('The current hand has not finished.')
  return dealFourPlayerHand(nextSeat(state.dealer), state.matchScores)
}

// ---------------------------------------------------------------------------
// Bidding (spec §8.4)
// ---------------------------------------------------------------------------

export function legalFourPlayerBids(state: FourPlayerGameState): number[] {
  if (state.phase !== 'bidding') return []
  return legalHouseBids(state.bidderInitialCards)
}

export function placeFourPlayerBid(state: FourPlayerGameState, seat: SeatId, value: number): FourPlayerGameState {
  if (state.phase !== 'bidding') throw new Error('Not currently bidding.')
  if (state.turn !== seat || state.bidder !== seat) throw new Error('Not your bid.')
  if (!legalFourPlayerBids(state).includes(value)) {
    throw new Error(`${value} is not a legal bid from your first four cards.`)
  }
  return pushLog({ ...state, bidValue: value, phase: 'opening-move' }, `${seat} bid ${value}.`)
}

// ---------------------------------------------------------------------------
// Scoring & hand resolution (spec §8.8)
// ---------------------------------------------------------------------------

/**
 * Resolves the end of a hand: leftover floor cards go to the last
 * capturing team, each team's hand totals are computed, match scores
 * accumulate, and a bazzi winner (a 100-point lead) is checked for.
 *
 * This is deliberately decoupled from the turn-by-turn play actions that
 * drive `finalFloor`/`lastCapturer` — those are added in Phase 3 once
 * the team house-ownership rules (spec §8.5) exist, and will call this
 * function once both hands are empty, the same way the two-player
 * engine's finishMove does internally.
 */
export function finishFourPlayerHand(
  state: FourPlayerGameState,
  finalFloor: FloorItem<SeatId>[],
  lastCapturer: TeamId | null,
): FourPlayerGameState {
  let finalCaptures = state.captures
  if (finalFloor.length > 0 && lastCapturer) {
    const leftover = finalFloor.flatMap((item) => (isHouse(item) ? item.cards : [item.card]))
    finalCaptures = {
      ...finalCaptures,
      [lastCapturer]: [...finalCaptures[lastCapturer], ...leftover],
    }
  }

  const totals = {} as Record<TeamId, HandSideTotals>
  for (const team of ALL_TEAMS) {
    totals[team] = computeHandTotals(finalCaptures[team], state.sweepPoints[team])
  }

  const matchScores = {} as Record<TeamId, number>
  for (const team of ALL_TEAMS) {
    matchScores[team] = state.matchScores[team] + totals[team].total
  }

  const winner = checkBazziWinner(matchScores, ALL_TEAMS)

  return pushLog(
    {
      ...state,
      floor: [],
      captures: finalCaptures,
      matchScores,
      lastHandTotals: totals,
      phase: winner ? 'match-over' : 'hand-over',
      winner,
    },
    `Hand over. Team A scored ${totals.teamA.total}, Team B scored ${totals.teamB.total}.`,
  )
}
