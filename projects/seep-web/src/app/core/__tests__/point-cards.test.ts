import { describe, expect, it } from 'vitest'
import { type Card, Face, Suit, cardPoints } from 'seep-engine'
import { describePointCards, pointCardsOf } from '../point-cards'

const c = (face: Face, suit: Suit): Card => ({ face, suit })
const label = (cards: Card[]) => cards.map((x) => `${x.face}${x.suit}`)

describe('which captured cards are shown', () => {
  it('only the cards that score: spades, the other aces and the Ten of Diamonds', () => {
    const captured = [c(Face.King, Suit.Hearts), c(Face.Two, Suit.Diamonds), c(Face.Nine, Suit.Spades), c(Face.Ace, Suit.Hearts), c(Face.Ten, Suit.Diamonds), c(Face.Ten, Suit.Clubs), c(Face.Queen, Suit.Diamonds), c(Face.Three, Suit.Spades), c(Face.Ace, Suit.Clubs)]
    expect(label(pointCardsOf(captured)).sort()).toEqual(label([c(Face.Nine, Suit.Spades), c(Face.Three, Suit.Spades), c(Face.Ace, Suit.Hearts), c(Face.Ace, Suit.Clubs), c(Face.Ten, Suit.Diamonds)]).sort())
  })
  it('the cards worth most first (13, 7, 6, 2, 1, 1), and equal ones in a fixed suit order', () => {
    const captured = [c(Face.Ace, Suit.Hearts), c(Face.Two, Suit.Spades), c(Face.King, Suit.Spades), c(Face.Ten, Suit.Diamonds), c(Face.Seven, Suit.Spades), c(Face.Ace, Suit.Clubs)]
    expect(label(pointCardsOf(captured))).toEqual(['KingSpades', 'SevenSpades', 'TenDiamonds', 'TwoSpades', 'AceClubs', 'AceHearts'])
  })
  it('does not change the list it is given, and gives an empty list when nothing scores', () => {
    const captured = [c(Face.Two, Suit.Hearts), c(Face.King, Suit.Diamonds)]
    const copy = [...captured]
    expect(pointCardsOf(captured)).toEqual([])
    expect(captured).toEqual(copy)
  })
  it('what is shown is worth exactly what the game scores for all the captured cards (nothing hidden, nothing extra)', () => {
    const captured = [c(Face.King, Suit.Spades), c(Face.Ten, Suit.Diamonds), c(Face.Ace, Suit.Hearts), c(Face.Four, Suit.Spades), c(Face.Queen, Suit.Hearts), c(Face.Nine, Suit.Clubs)]
    expect(cardPoints(pointCardsOf(captured))).toBe(cardPoints(captured))
    expect(cardPoints(captured)).toBe(13 + 6 + 1 + 4)
  })
})

describe('the one-line summary', () => {
  it('says what the cards came to and what that makes this hand', () => {
    expect(describePointCards({ cardPoints: 31, sweepPoints: 0, total: 31 })).toBe('31 card points = 31 this hand')
  })
  it('says when there are fewer than 9, which score nothing', () => {
    expect(describePointCards({ cardPoints: 7, sweepPoints: 0, total: 0 })).toBe('7 card points (under 9, so they score nothing) = 0 this hand')
    expect(describePointCards({ cardPoints: 9, sweepPoints: 0, total: 9 })).toBe('9 card points = 9 this hand')
  })
  it('adds the Seep bonus when there was one, and says "point" for exactly one', () => {
    expect(describePointCards({ cardPoints: 24, sweepPoints: 50, total: 74 })).toBe('24 card points + 50 for the Seep = 74 this hand')
    expect(describePointCards({ cardPoints: 1, sweepPoints: 0, total: 0 })).toBe('1 card point (under 9, so they score nothing) = 0 this hand')
  })
})
