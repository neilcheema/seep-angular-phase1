import { type Card, cardEquals, captureValue } from './card'

export function hasCard(hand: Card[], card: Card): boolean {
  return hand.some(c => cardEquals(c, card))
}

/** Whether the hand holds any card with the given capture value (1, 9-13, etc). */
export function hasCaptureValue(hand: Card[], value: number): boolean {
  return hand.some(c => captureValue(c) === value)
}

/** Returns a new hand with the card removed. Throws if card is not present. */
export function removeCard(hand: Card[], card: Card): Card[] {
  const idx = hand.findIndex(c => cardEquals(c, card))
  if (idx === -1) {
    throw new Error(`Card ${card.face} of ${card.suit} is not in hand`)
  }
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)]
}

/** Returns a new hand with the given cards appended. */
export function addCards(hand: Card[], cards: Card[]): Card[] {
  return [...hand, ...cards]
}
