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

/** Fisher-Yates shuffle — returns a new shuffled array, does not mutate input. */
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
  /** The 4 cards revealed on the floor to open play. */
  floor: Card[]
  /** The bidder's full hand for the hand (24 cards from a 52-card deck). */
  bidderHand: Card[]
  /** The other player's full hand for the hand (24 cards). */
  otherHand: Card[]
}

/**
 * Deals a fresh hand: 4 cards to the floor, and the remaining 48 split
 * evenly (24/24) between the bidder (the player who calls the opening
 * bid) and the other player. A real table deals this out in batches of
 * four for fairness; since there's nothing to hide from in a digital
 * game, it's dealt in one pass here — the resulting hands are identical
 * either way.
 */
export function dealInitialHands(deck: Card[]): InitialDeal {
  if (deck.length !== 52) {
    throw new Error(`dealInitialHands requires a full 52-card deck, got ${deck.length}`)
  }
  const floor = deck.slice(0, 4)
  const bidderHand = deck.slice(4, 28)
  const otherHand = deck.slice(28, 52)
  return { floor, bidderHand, otherHand }
}

export interface FourPlayerInitialDeal {
  /** The 4 cards revealed on the floor to open play. */
  floor: Card[]
  /**
   * Every seat's full 12-card hand for the hand, keyed by seat. The
   * bidder's hand is dealt in full up front like everyone else's — the
   * "first four cards" used for the bid-eligibility check (spec §8.3) is
   * simply the first four cards of the bidder's dealt hand, not a
   * separately-dealt batch.
   */
  hands: Record<SeatId, Card[]>
}

/**
 * Deals a fresh four-player hand: 4 cards to the floor, and the
 * remaining 48 split into four 12-card hands, one per seat (spec §8.3).
 * As with the two-player dealer, everything is dealt in one pass rather
 * than the physical table's batches-of-four ritual — the resulting
 * hands are identical either way, and only the bidder's hand order
 * matters (its first four cards decide bid eligibility).
 */
export function dealFourPlayerHands(deck: Card[], bidder: SeatId): FourPlayerInitialDeal {
  if (deck.length !== 52) {
    throw new Error(`dealFourPlayerHands requires a full 52-card deck, got ${deck.length}`)
  }
  const floor = deck.slice(0, 4)
  const rest = deck.slice(4)
  const dealOrder = [bidder, ...ALL_SEATS.filter((s) => s !== bidder)]
  const hands = {} as Record<SeatId, Card[]>
  dealOrder.forEach((seat, i) => {
    hands[seat] = rest.slice(i * 12, i * 12 + 12)
  })
  return { floor, hands }
}

