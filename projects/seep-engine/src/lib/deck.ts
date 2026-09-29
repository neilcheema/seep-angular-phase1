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

/**
 * Uses the Web Crypto API for a cryptographically random float in [0, 1) —
 * available globally in both browsers and Node 19+. Math.random() is not
 * suitable for anything where unpredictability actually matters, like a
 * card shuffle.
 */
function cryptoRandom(): number {
  const buf = new Uint32Array(1)
  // Typed narrowly rather than adding "DOM" to this package's tsconfig lib
  // — this needs to type-check the same way whether it ends up running in
  // a browser or, later, a Node backend, and only this one call needs it.
  const cryptoObj = (globalThis as unknown as { crypto: { getRandomValues(a: Uint32Array): Uint32Array } }).crypto
  cryptoObj.getRandomValues(buf)
  return buf[0]! / 0x100000000
}

/**
 * Deterministic PRNG (mulberry32), used only when an explicit seed is
 * given — for reproducible tests, or for replaying a specific reported
 * game exactly as it was dealt.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates shuffle. Pass `seed` for a reproducible shuffle (tests,
 * replay); omitted, it uses a cryptographically random source, not
 * Math.random().
 */
export function shuffleDeck(deck: Card[], seed?: number): Card[] {
  const random = seed === undefined ? cryptoRandom : seededRandom(seed)
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
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
