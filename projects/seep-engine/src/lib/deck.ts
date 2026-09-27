import { type Card, Face, Suit } from './card'
import { ALL_SEATS, type SeatId } from './seats'

const ALL_SUITS: Suit[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds]
const ALL_FACES: Face[] = [
  Face.Ace, Face.Two, Face.Three, Face.Four, Face.Five, Face.Six, Face.Seven,
  Face.Eight, Face.Nine, Face.Ten, Face.Jack, Face.Queen, Face.King,
]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of ALL_SUITS) {
    for (const face of ALL_FACES) {
      deck.push({ suit, face })
    }
  }
  return deck
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = tmp
  }
  return shuffled
}

export interface InitialDeal {
  floor: Card[]
  bidderFirstFour: Card[]
  bidderRest: Card[]
  otherHand: Card[]
}

/**
 * Deals in the same staged order as the physical game: only the floor (4
 * cards) and the bidder's first four cards are ever visible before the
 * opening move — the bidder's remaining cards and the other player's
 * entire hand stay held back (see GameState.pendingDeal) until the
 * opening move resolves, matching how bidding and the first move are
 * decided from a four-card hand and a four-card floor in the real game,
 * not from a fully-dealt hand.
 */
export function dealInitialHands(deck: Card[]): InitialDeal {
  if (deck.length !== 52) {
    throw new Error(`dealInitialHands requires a full 52-card deck, got ${deck.length}`)
  }
  const floor = deck.slice(0, 4)
  const bidderFirstFour = deck.slice(4, 8)
  const bidderRest = deck.slice(8, 28)
  const otherHand = deck.slice(28, 52)
  return { floor, bidderFirstFour, bidderRest, otherHand }
}

export interface FourPlayerInitialDeal {
  floor: Card[]
  bidderFirstFour: Card[]
  bidderRest: Card[]
  otherHands: Record<SeatId, Card[]>
}

/**
 * Deals in the same staged order as the physical game: only the floor and
 * the bidder's first four cards are visible before the opening move — the
 * bidder's remaining eight cards and the other three seats' entire hands
 * stay held back (see FourPlayerGameState.pendingDeal) until the opening
 * move resolves.
 */
export function dealFourPlayerHands(deck: Card[], bidder: SeatId): FourPlayerInitialDeal {
  if (deck.length !== 52) {
    throw new Error(`dealFourPlayerHands requires a full 52-card deck, got ${deck.length}`)
  }
  const floor = deck.slice(0, 4)
  const bidderFirstFour = deck.slice(4, 8)
  const bidderRest = deck.slice(8, 16)
  const others = ALL_SEATS.filter((s) => s !== bidder)
  const rest = deck.slice(16)
  const otherHands = {} as Record<SeatId, Card[]>
  others.forEach((seat, i) => {
    otherHands[seat] = rest.slice(i * 12, i * 12 + 12)
  })
  return { floor, bidderFirstFour, bidderRest, otherHands }
}
