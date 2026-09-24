import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card'
import { SeatId } from '../seats'
import {
  type FourPlayerGameState,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
} from '../fourPlayerEngine'
import { type FloorItem, type House } from '../floor'

function card(face: Face, suit: Suit): Card {
  return { face, suit }
}

function makeState(overrides: Partial<FourPlayerGameState> = {}): FourPlayerGameState {
  const base: FourPlayerGameState = {
    floor: [],
    hands: { p1: [], p2: [], p3: [], p4: [] },
    captures: { teamA: [], teamB: [] },
    sweepPoints: { teamA: 0, teamB: 0 },
    matchScores: { teamA: 0, teamB: 0 },
    dealer: SeatId.P4,
    bidder: SeatId.P1,
    turn: SeatId.P1,
    phase: 'playing',
    bidValue: null,
    bidderInitialCards: [],
    lastCapturer: null,
    cardsPlayedThisHand: 10,
    totalPlayableThisHand: 48,
    nextItemId: 0,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
  }
  return { ...base, ...overrides }
}

function house(overrides: Partial<House<SeatId>> = {}): House<SeatId> {
  return {
    kind: 'house',
    id: 'h1',
    cards: [card(Face.Nine, Suit.Hearts)],
    captureValue: 9,
    cemented: false,
    owners: [SeatId.P2],
    ...overrides,
  }
}

describe('captured cards are pooled by team (spec §8.5)', () => {
  it('credits a capture to the acting seat\'s team pile, not a per-seat pile', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        p1: [card(Face.Seven, Suit.Clubs)],
        p2: [], p3: [], p4: [],
      },
      turn: SeatId.P1,
    })
    const next = playFourPlayerCapture(state, SeatId.P1, card(Face.Seven, Suit.Clubs), ['f1'])
    // p1 is on teamA — the capture lands in captures.teamA, not a per-seat bucket.
    expect(next.captures.teamA).toHaveLength(2)
    expect(next.captures.teamB).toHaveLength(0)
  })
})

describe('a player can only found a house for themselves (spec §8.5)', () => {
  it('always sets the builder as sole owner, even though their partner could benefit', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: {
        p1: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)],
        p2: [], p3: [], p4: [],
      },
      turn: SeatId.P1,
    })
    const next = playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Six, Suit.Clubs), ['f1'], 11)
    const built = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(built.owners).toEqual([SeatId.P1])
  })
})

describe('breaking an owned house is restricted (spec §8.5)', () => {
  it('refuses to let the owner break their own house', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1] })],
      hands: { p1: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Three, Suit.Clubs), 'h1')).toThrow()
  })

  it('lets a teammate break a house they do not own themselves', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1] })], // owned by p1
      hands: { p3: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p1: [], p2: [], p4: [] },
      turn: SeatId.P3, // p3 is p1's partner
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P3, card(Face.Three, Suit.Clubs), 'h1')
    const broken = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(broken.captureValue).toBe(12)
  })

  it('lets an opponent break a house too', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1] })],
      hands: { p2: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P2, card(Face.Three, Suit.Clubs), 'h1')
    const broken = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(broken.captureValue).toBe(12)
  })
})

describe('partners may freely add to each other\'s cemented houses (spec §8.5)', () => {
  it('lets a partner cement a house without holding a reserve matching card', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: {
        p3: [card(Face.Nine, Suit.Clubs)], // only ONE 9 — no reserve
        p1: [card(Face.Two, Suit.Clubs)], p2: [card(Face.Three, Suit.Clubs)], p4: [card(Face.Four, Suit.Clubs)],
      },
      turn: SeatId.P3,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P3, card(Face.Nine, Suit.Clubs), 'h1')
    const cemented = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(cemented.cemented).toBe(true)
    expect(cemented.owners).toContain(SeatId.P3)
  })

  it('still requires a reserve card to cement your own house', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: { p1: [card(Face.Nine, Suit.Clubs)], p2: [], p3: [], p4: [] }, // only one 9, no reserve
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Nine, Suit.Clubs), 'h1')).toThrow()
  })

  it('still requires a reserve card to cement an opponent\'s house', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: { p2: [card(Face.Nine, Suit.Clubs)], p1: [], p3: [], p4: [] }, // p2 is opponent of p1
      turn: SeatId.P2,
    })
    expect(() => playFourPlayerModifyHouse(state, SeatId.P2, card(Face.Nine, Suit.Clubs), 'h1')).toThrow()
  })

  it('succeeds cementing an opponent\'s house when a reserve card is held', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: { p2: [card(Face.Nine, Suit.Clubs), card(Face.Nine, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P2, card(Face.Nine, Suit.Clubs), 'h1')
    const cemented = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(cemented.cemented).toBe(true)
  })
})

describe('breaking transfers ownership; breaking to match a partner\'s house merges them (spec §8.5)', () => {
  it('makes the breaker the sole new owner when there is no house to merge with', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P2], captureValue: 9 })],
      hands: { p1: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Three, Suit.Clubs), 'h1')
    const broken = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(broken.owners).toEqual([SeatId.P1])
  })

  it('merges into a cemented, multi-owner house when the new value matches a partner\'s house', () => {
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P2], captureValue: 9 }), // being broken by p1
        house({ id: 'h2', owners: [SeatId.P3], captureValue: 12, cards: [card(Face.Queen, Suit.Hearts)] }), // p1's partner's house
      ],
      hands: { p1: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Three, Suit.Clubs), 'h1')
    const houses = next.floor.filter((i): i is House<SeatId> => i.kind === 'house')
    expect(houses).toHaveLength(1)
    expect(houses[0]!.cemented).toBe(true)
    expect(houses[0]!.captureValue).toBe(12)
    expect(houses[0]!.owners).toEqual(expect.arrayContaining([SeatId.P1, SeatId.P3]))
  })
})

describe('multiple owners on a cemented house (spec §8.5)', () => {
  it('adds the cementer as a second owner alongside the original owner', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: { p2: [card(Face.Nine, Suit.Clubs), card(Face.Nine, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P2, card(Face.Nine, Suit.Clubs), 'h1')
    const cemented = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(cemented.owners).toEqual(expect.arrayContaining([SeatId.P1, SeatId.P2]))
    expect(cemented.owners).toHaveLength(2)
  })
})

describe('mandatory capture applies per-seat regardless of team (spec §8.6)', () => {
  it('refuses to throw a card that could capture something', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { p1: [card(Face.Seven, Suit.Clubs)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerThrow(state, SeatId.P1, card(Face.Seven, Suit.Clubs))).toThrow()
  })

  it('allows throwing when no legal capture exists', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        p1: [card(Face.Two, Suit.Clubs), card(Face.Three, Suit.Hearts)],
        p2: [card(Face.Four, Suit.Spades)], p3: [], p4: [],
      },
      turn: SeatId.P1,
    })
    const next = playFourPlayerThrow(state, SeatId.P1, card(Face.Two, Suit.Clubs))
    expect(next.floor).toHaveLength(2)
  })
})

describe('turn advances to the next seat in rotation after any move', () => {
  it('moves from p1 to p2 after p1 plays', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        p1: [card(Face.Two, Suit.Clubs)],
        p2: [card(Face.Four, Suit.Spades)], p3: [card(Face.Five, Suit.Spades)], p4: [card(Face.Six, Suit.Spades)],
      },
      turn: SeatId.P1,
    })
    const next = playFourPlayerThrow(state, SeatId.P1, card(Face.Two, Suit.Clubs))
    expect(next.turn).toBe(SeatId.P2)
  })
})

describe('hand-over detection waits for all four hands to empty', () => {
  it('does not end the hand while any seat still holds cards', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { p1: [card(Face.Two, Suit.Clubs)], p2: [card(Face.Four, Suit.Spades)], p3: [], p4: [] },
      turn: SeatId.P1,
      cardsPlayedThisHand: 46,
      totalPlayableThisHand: 48,
    })
    const next = playFourPlayerThrow(state, SeatId.P1, card(Face.Two, Suit.Clubs))
    expect(next.phase).toBe('playing')
  })

  it('ends the hand once the very last seat empties its hand', () => {
    const state = makeState({
      floor: [] as FloorItem<SeatId>[],
      hands: { p1: [], p2: [], p3: [], p4: [card(Face.Two, Suit.Clubs)] },
      turn: SeatId.P4,
      cardsPlayedThisHand: 47,
      totalPlayableThisHand: 48,
    })
    const next = playFourPlayerThrow(state, SeatId.P4, card(Face.Two, Suit.Clubs))
    expect(next.phase).toBe('hand-over')
    expect(next.lastHandTotals).not.toBeNull()
  })
})
