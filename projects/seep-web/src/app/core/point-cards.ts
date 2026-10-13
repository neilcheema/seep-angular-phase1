import { type Card, MIN_QUALIFYING_POINTS, Suit, pointValue } from 'seep-engine'

/**
 * What the board shows once a hand is over: the cards each side captured THAT SCORE (spades, the other aces and the Ten of Diamonds), so players can see
 * what they won. Kept free of Angular so the rules for it can be tested on their own.
 */

const SUIT_ORDER: Record<Suit, number> = { [Suit.Spades]: 0, [Suit.Clubs]: 1, [Suit.Hearts]: 2, [Suit.Diamonds]: 3 }

/**
 * The cards among `cards` that score points, the ones worth most first: so the King of Spades (13) leads, a Seven of Spades (7) comes before the Ten of
 * Diamonds (6), and the single-point aces come last. Cards worth the same keep a fixed suit order (spades, clubs, hearts, diamonds).
 */
export function pointCardsOf(cards: Card[]): Card[] {
  return cards
    .filter((card) => pointValue(card) > 0)
    .sort((a, b) => pointValue(b) - pointValue(a) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit])
}

/** The figures for one side of a finished hand (the same shape the game reports, so it can be passed straight in). */
export interface SideTotals {
  readonly cardPoints: number
  readonly sweepPoints: number
  readonly total: number
}

/** One plain sentence: what the point cards come to, whether it reached the 9 needed, any Seep bonus, and what it makes this hand. */
export function describePointCards(totals: SideTotals): string {
  const points = `${totals.cardPoints} card point${totals.cardPoints === 1 ? '' : 's'}`
  const under = totals.cardPoints < MIN_QUALIFYING_POINTS ? ` (under ${MIN_QUALIFYING_POINTS}, so they score nothing)` : ''
  const seep = totals.sweepPoints > 0 ? ` + ${totals.sweepPoints} for the Seep` : ''
  return `${points}${under}${seep} = ${totals.total} this hand`
}
