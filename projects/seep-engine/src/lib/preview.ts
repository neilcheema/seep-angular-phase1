import { type Card, Face, Suit } from './card'
import { type FourPlayerGameState, type FourPlayerGameView, playFourPlayerBuildHouse, playFourPlayerModifyHouse } from './fourPlayerEngine'
import { type GameView, playBuildHouse, playModifyHouse } from './gameEngine'
import { standInState } from './advice'
import { ALL_SEATS, type SeatId } from './seats'

/**
 * "Would the rules allow this?", asked of the rules themselves, so a button on screen can never be enabled for a move the engine would refuse.
 *
 * A screen only holds the player's VIEW of the game, not the full state, so these build a stand-in state (the player's own hand and everything
 * on the floor and in the piles are real; every hidden card is a placeholder) and try the move on it. The engine never looks at the other
 * players' cards when a player moves, which is checked in preview.test.ts against real games. The answer is the engine's own sentence, ready to show,
 * or null when the move is allowed. Nothing is ever applied: it only asks.
 */
const UNKNOWN: Card = { face: Face.Two, suit: Suit.Diamonds }

function refusal(attempt: () => unknown): string | null {
  try {
    attempt()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'That move is not allowed.'
  }
}

/** Adding a card (and optionally loose floor cards) to a house, to cement it or to break it up to a new value: null if allowed, else why not. */
export function modifyHouseRefusal(view: GameView, card: Card, houseId: string, extraLooseItemIds: string[] = []): string | null {
  return refusal(() => playModifyHouse(standInState(view), view.viewer, card, houseId, extraLooseItemIds))
}

/** Building a new house of `targetValue` from this card and the chosen loose floor cards: null if allowed, else why not. */
export function buildHouseRefusal(view: GameView, card: Card, looseItemIds: string[], targetValue: number): string | null {
  return refusal(() => playBuildHouse(standInState(view), view.viewer, card, looseItemIds, targetValue))
}

/** The four-player version of standInState: the viewer's real hand, a placeholder for every card in the other three hands. */
export function standInFourPlayerState(view: FourPlayerGameView): FourPlayerGameState {
  const hands = {} as Record<SeatId, Card[]>
  for (const seat of ALL_SEATS) hands[seat] = seat === view.viewer ? view.myHand : Array.from({ length: view.handCounts[seat] }, () => UNKNOWN)
  return {
    floor: view.floor,
    hands,
    captures: view.captures,
    sweepPoints: view.sweepPoints,
    matchScores: view.matchScores,
    dealer: view.dealer,
    bidder: view.bidder,
    turn: view.turn,
    phase: view.phase,
    bidValue: view.bidValue,
    pendingDeal: null,
    lastCapturer: view.lastCapturer,
    cardsPlayedThisHand: view.cardsPlayedThisHand,
    totalPlayableThisHand: view.totalPlayableThisHand,
    nextItemId: 1_000_000,
    log: [],
    winner: view.winner,
    lastHandTotals: view.lastHandTotals,
    handHistory: view.handHistory ?? [],
    misdeals: view.misdeals,
    engineVersion: view.engineVersion,
  }
}

export function fourPlayerModifyHouseRefusal(view: FourPlayerGameView, card: Card, houseId: string, extraLooseItemIds: string[] = []): string | null {
  return refusal(() => playFourPlayerModifyHouse(standInFourPlayerState(view), view.viewer, card, houseId, extraLooseItemIds))
}

export function fourPlayerBuildHouseRefusal(view: FourPlayerGameView, card: Card, looseItemIds: string[], targetValue: number): string | null {
  return refusal(() => playFourPlayerBuildHouse(standInFourPlayerState(view), view.viewer, card, looseItemIds, targetValue))
}
