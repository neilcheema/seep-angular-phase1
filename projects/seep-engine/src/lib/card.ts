export const Suit = {
  Spades: 'Spades',
  Hearts: 'Hearts',
  Clubs: 'Clubs',
  Diamonds: 'Diamonds',
} as const
export type Suit = (typeof Suit)[keyof typeof Suit]

export const Face = {
  Ace: 'Ace',
  Two: 'Two',
  Three: 'Three',
  Four: 'Four',
  Five: 'Five',
  Six: 'Six',
  Seven: 'Seven',
  Eight: 'Eight',
  Nine: 'Nine',
  Ten: 'Ten',
  Jack: 'Jack',
  Queen: 'Queen',
  King: 'King',
} as const
export type Face = (typeof Face)[keyof typeof Face]

export interface Card {
  readonly suit: Suit
  readonly face: Face
}

/**
 * Capture value per the Seep rules: Ace = 1, 2-10 = face value,
 * J = 11, Q = 12, K = 13. This is the value used for matching a
 * played card against loose cards, houses, and bids on the floor.
 */
const CAPTURE_VALUES: Record<Face, number> = {
  [Face.Ace]: 1,
  [Face.Two]: 2,
  [Face.Three]: 3,
  [Face.Four]: 4,
  [Face.Five]: 5,
  [Face.Six]: 6,
  [Face.Seven]: 7,
  [Face.Eight]: 8,
  [Face.Nine]: 9,
  [Face.Ten]: 10,
  [Face.Jack]: 11,
  [Face.Queen]: 12,
  [Face.King]: 13,
}

export function captureValue(card: Card): number {
  return CAPTURE_VALUES[card.face]
}

/** Lowest legal house/bid capture value. */
export const MIN_HOUSE_VALUE = 9
/** Highest legal house/bid capture value (King). */
export const MAX_HOUSE_VALUE = 13

export function isHouseValue(value: number): boolean {
  return value >= MIN_HOUSE_VALUE && value <= MAX_HOUSE_VALUE
}

/**
 * Point value of a single captured card at end-of-hand scoring:
 *  - Spades score their capture value.
 *  - Aces of the other three suits are worth 1 point each.
 *  - The Ten of Diamonds is worth 6 points.
 *  - Every other card is worth 0.
 * (100 points total in the deck.)
 */
export function pointValue(card: Card): number {
  if (card.suit === Suit.Spades) return captureValue(card)
  if (card.face === Face.Ace) return 1
  if (card.suit === Suit.Diamonds && card.face === Face.Ten) return 6
  return 0
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.face === b.face
}

const FACE_LABEL: Record<Face, string> = {
  [Face.Ace]: 'A',
  [Face.Two]: '2',
  [Face.Three]: '3',
  [Face.Four]: '4',
  [Face.Five]: '5',
  [Face.Six]: '6',
  [Face.Seven]: '7',
  [Face.Eight]: '8',
  [Face.Nine]: '9',
  [Face.Ten]: '10',
  [Face.Jack]: 'J',
  [Face.Queen]: 'Q',
  [Face.King]: 'K',
}

export function faceLabel(face: Face): string {
  return FACE_LABEL[face]
}

export function cardLabel(card: Card): string {
  return `${faceLabel(card.face)} of ${card.suit}`
}
