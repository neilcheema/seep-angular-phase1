import { type Card, pointValue } from './card'

/** Sum of point values (spades, aces, ten of diamonds) in a capture pile. */
export function cardPoints(cards: Card[]): number {
  return cards.reduce((total, c) => total + pointValue(c), 0)
}

/** Minimum card-point total a player needs to keep any points for the hand. */
export const MIN_QUALIFYING_POINTS = 9

export const SWEEP_BONUS = 50
export const OPENING_SWEEP_BONUS = 25

/** A lead of this many cumulative points ends the match (a "bazzi"). */
export const BAZZI_TARGET = 100

/**
 * A player who ends a hand under 9 card-points loses all of it for that
 * hand — their sweep bonuses still count, but the raw card points don't.
 */
export function qualifyingCardPoints(rawCardPoints: number): number {
  return rawCardPoints >= MIN_QUALIFYING_POINTS ? rawCardPoints : 0
}
