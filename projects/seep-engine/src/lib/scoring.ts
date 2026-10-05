import { type Card, pointValue } from './card'

export function cardPoints(cards: Card[]): number {
  return cards.reduce((total, c) => total + pointValue(c), 0)
}

export const MIN_QUALIFYING_POINTS = 9
export const SWEEP_BONUS = 50
export const OPENING_SWEEP_BONUS = 25
export const BAZZI_TARGET = 100

export function qualifyingCardPoints(rawCardPoints: number): number {
  return rawCardPoints >= MIN_QUALIFYING_POINTS ? rawCardPoints : 0
}

export interface HandSideTotals {
  readonly cardPoints: number
  readonly qualifyingCardPoints: number
  readonly sweepPoints: number
  readonly total: number
}

/**
 * One finished hand: what each side scored in it. The engine keeps these from hand to hand (GameState.handHistory) so a
 * finished match can be itemised. It only RECORDS what happened; it changes no rule, so it needs no engine version bump.
 */
export interface HandRecord<Id extends string> {
  readonly totals: Record<Id, HandSideTotals>
}

export function computeHandTotals(cards: Card[], sweepPoints: number): HandSideTotals {
  const raw = cardPoints(cards)
  const qualifying = qualifyingCardPoints(raw)
  return { cardPoints: raw, qualifyingCardPoints: qualifying, sweepPoints, total: qualifying + sweepPoints }
}

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
