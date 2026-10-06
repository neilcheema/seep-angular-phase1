import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card, captureValue } from '../card.ts'
import { type FloorItem, type House, hasAnyLegalCapture, requiredCaptureIds } from '../floor.ts'
import { ENGINE_VERSION } from '../version.ts'
import { type GameState, playCapture, playThrow } from '../gameEngine.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number): House => ({ kind: 'house', id, cards: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], captureValue: value, cemented: false, owners: ['player'] })
const sorted = (ids: string[]) => [...ids].sort()

function makeState(floor: FloorItem[], hand: Card[]): GameState {
  return {
    floor,
    hands: { player: hand, opponent: [card(Face.Two, Suit.Diamonds)] },
    captures: { player: [], opponent: [] },
    sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 0, opponent: 0 },
    bidder: 'player',
    turn: 'player',
    phase: 'playing',
    bidValue: null,
    pendingDeal: null,
    lastCapturer: null,
    cardsPlayedThisHand: 10,
    totalPlayableThisHand: 48,
    nextItemId: 100,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
    engineVersion: ENGINE_VERSION,
  }
}

describe('requiredCaptureIds: what a capture must take', () => {
  it('is the one matching loose card', () => {
    expect(requiredCaptureIds([loose('a', Face.Six, Suit.Hearts), loose('b', Face.Nine, Suit.Spades)], card(Face.Six, Suit.Clubs))).toEqual(['a'])
  })

  it('is a set of loose cards that add up to the card (3 + 6 + Ace = 10, an Ace counting 1)', () => {
    const floor = [loose('a', Face.Three, Suit.Spades), loose('b', Face.Six, Suit.Hearts), loose('c', Face.Ace, Suit.Spades), loose('d', Face.King, Suit.Clubs)]
    expect(sorted(requiredCaptureIds(floor, card(Face.Ten, Suit.Hearts)))).toEqual(['a', 'b', 'c'])
  })

  it('is EVERY matching group at once, not just one of them', () => {
    const floor = [loose('a', Face.Ten, Suit.Diamonds), loose('b', Face.Three, Suit.Spades), loose('c', Face.Seven, Suit.Clubs), loose('d', Face.King, Suit.Hearts)]
    expect(sorted(requiredCaptureIds(floor, card(Face.Ten, Suit.Hearts)))).toEqual(['a', 'b', 'c'])
  })

  it('is a house of the card’s value together with any loose group at that value', () => {
    const floor = [house('h', 9), loose('a', Face.Nine, Suit.Spades), loose('b', Face.Two, Suit.Clubs)]
    expect(sorted(requiredCaptureIds(floor, card(Face.Nine, Suit.Hearts)))).toEqual(['a', 'h'])
  })

  it('never combines a house with other cards to reach a total: a 9-house and a loose 3 do not make a Queen', () => {
    expect(requiredCaptureIds([house('h', 9), loose('a', Face.Three, Suit.Spades)], card(Face.Queen, Suit.Hearts))).toEqual([])
  })

  it('is empty when nothing can be captured (the card may be thrown)', () => {
    expect(requiredCaptureIds([loose('a', Face.Two, Suit.Spades), loose('b', Face.Four, Suit.Clubs)], card(Face.Queen, Suit.Hearts))).toEqual([])
    expect(requiredCaptureIds([], card(Face.Queen, Suit.Hearts))).toEqual([])
  })
})

/** A small deterministic random generator, so a failure can be replayed. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('requiredCaptureIds agrees with the engine itself, over many random positions', () => {
  const faces = Object.values(Face)
  const suits = Object.values(Suit)

  it('is non-empty exactly when a capture exists, playCapture accepts exactly that set (all or nothing), and a throw is refused exactly then', () => {
    const rand = mulberry32(20261006)
    let withCapture = 0
    let withHouse = 0
    for (let n = 0; n < 400; n++) {
      const deck = suits.flatMap((s) => faces.map((f) => card(f, s)))
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
      }
      const k = 2 + Math.floor(rand() * 8)
      const floor: FloorItem[] = deck.slice(0, k).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
      if (rand() < 0.3) {
        floor.push(house('H', 9 + Math.floor(rand() * 5)))
        withHouse++
      }
      const mine = deck[k]!
      const state = makeState(floor, [mine, deck[k + 1]!])
      const ids = requiredCaptureIds(floor, mine)
      const label = `sample ${n}: ${captureValue(mine)} on [${floor.map((i) => (i.kind === 'house' ? `house${i.captureValue}` : captureValue(i.card))).join(',')}]`

      expect(ids.length > 0, label).toBe(hasAnyLegalCapture(floor, mine))
      if (ids.length > 0) {
        withCapture++
        expect(() => playCapture(state, 'player', mine, ids), label).not.toThrow()
        for (const id of ids) expect(() => playCapture(state, 'player', mine, ids.filter((x) => x !== id)), `${label}, without ${id}`).toThrow()
        for (const item of floor.filter((i) => !ids.includes(i.id))) expect(() => playCapture(state, 'player', mine, [...ids, item.id]), `${label}, plus ${item.id}`).toThrow()
        expect(() => playThrow(state, 'player', mine), label).toThrow(/must capture/)
      } else {
        expect(() => playThrow(state, 'player', mine), label).not.toThrow()
      }
    }
    // The test only means something if it really met both kinds of position, and houses.
    expect(withCapture).toBeGreaterThan(80)
    expect(400 - withCapture).toBeGreaterThan(80)
    expect(withHouse).toBeGreaterThan(60)
  })
})
