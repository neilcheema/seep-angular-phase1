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

/** A single side's (player's or team's) point breakdown for one hand. */
export interface HandSideTotals {
  readonly cardPoints: number
  readonly qualifyingCardPoints: number
  readonly sweepPoints: number
  readonly total: number
}

/**
 * Computes one side's HandSideTotals from its raw captured cards and
 * accumulated sweep bonus. Used identically for a two-player side or a
 * four-player team — team play (spec §8.8) just means the "cards" and
 * "sweepPoints" being summed already represent the whole team's pooled
 * total, not an individual seat's.
 */
export function computeHandTotals(cards: Card[], sweepPoints: number): HandSideTotals {
  const raw = cardPoints(cards)
  const qualifying = qualifyingCardPoints(raw)
  return { cardPoints: raw, qualifyingCardPoints: qualifying, sweepPoints, total: qualifying + sweepPoints }
}

/**
 * Given the leader's and trailer's cumulative match scores, returns the
 * leader's id if their lead has reached BAZZI_TARGET, otherwise null.
 * Generic over the id type so it works for both PlayerId and TeamId.
 */
export function checkBazziWinner<Id extends string>(
  scores: Record<Id, number>,
  ids: readonly Id[],
): Id | null {
  if (ids.length !== 2) throw new Error('checkBazziWinner expects exactly two sides')
  const [a, b] = ids as [Id, Id]
  const lead = Math.abs(scores[a] - scores[b])
  if (lead < BAZZI_TARGET) return null
  return scores[a] > scores[b] ? a : b
}

