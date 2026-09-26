import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { SeatId } from '../seats.ts'
import {
  type FourPlayerGameState,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
} from '../fourPlayerEngine.ts'
import { type FloorItem, type House } from '../floor.ts'

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

describe('building a house accepts a multiple of the target value, cementing it immediately', () => {
  it('reproduces the exact reported scenario: 4 + 9 + two loose Kings = 3x13, cemented on creation', () => {
    // Opening move, bid 13. Hand card 4 + loose 9 = 13 (one set), plus two
    // separate loose Kings (13 each, two more sets) = 39 total = 3x13.
    const state = makeState({
      phase: 'opening-move',
      bidValue: 13,
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Nine, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.King, Suit.Hearts) },
        { kind: 'loose', id: 'f3', card: card(Face.King, Suit.Spades) },
      ],
      hands: {
        p1: [card(Face.Four, Suit.Spades), card(Face.King, Suit.Diamonds)],
        p2: [], p3: [], p4: [],
      },
      turn: SeatId.P1,
    })
    const next = playFourPlayerBuildHouse(
      state, SeatId.P1, card(Face.Four, Suit.Spades), ['f1', 'f2', 'f3'], 13,
    )
    const house = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(house.captureValue).toBe(13)
    expect(house.cemented).toBe(true)
    expect(house.cards).toHaveLength(4) // 4, 9, K, K
    expect(house.owners).toEqual([SeatId.P1])
    expect(next.floor).toHaveLength(1) // all three loose items absorbed into the one house
  })

  it('still builds an ordinary uncemented house when the sum is exactly the target (1x)', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { p1: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Six, Suit.Clubs), ['f1'], 11)
    const house = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(house.cemented).toBe(false)
  })

  it('still rejects a selection whose total is not a multiple of the intended target', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { p1: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    // 5 + 6 = 11, not a multiple of a 13 target.
    expect(() => playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Six, Suit.Clubs), ['f1'], 13)).toThrow()
  })

  it('still enforces that the opening-move target must equal the bid, regardless of the multiple', () => {
    const state = makeState({
      phase: 'opening-move',
      bidValue: 13,
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { p1: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    // Building a clean 11 during an opening move bid for 13 is still illegal,
    // even though 11 alone (1x) would otherwise be a perfectly good house.
    expect(() => playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Six, Suit.Clubs), ['f1'], 11)).toThrow()
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
      floor: [house({ owners: [SeatId.P1] })],
      hands: { p3: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p1: [], p2: [], p4: [] },
      turn: SeatId.P3,
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
        p3: [card(Face.Nine, Suit.Clubs)],
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
      hands: { p1: [card(Face.Nine, Suit.Clubs)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Nine, Suit.Clubs), 'h1')).toThrow()
  })

  it('still requires a reserve card to cement an opponent\'s house', () => {
    const state = makeState({
      floor: [house({ owners: [SeatId.P1], captureValue: 9 })],
      hands: { p2: [card(Face.Nine, Suit.Clubs)], p1: [], p3: [], p4: [] },
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
        house({ id: 'h1', owners: [SeatId.P2], captureValue: 9 }),
        house({ id: 'h2', owners: [SeatId.P3], captureValue: 12, cards: [card(Face.Queen, Suit.Hearts)] }),
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

describe('cementing accepts any combination summing to a multiple of the house value', () => {
  it('cements via a card + loose-card combination summing to exactly the house value (1x) — the reported bug', () => {
    // The exact scenario reported: a 13-house already at the maximum legal
    // value, a hand card of 2 (can't cement alone, can't break higher —
    // nowhere higher to go), but combined with a loose Jack (11) on the
    // floor, 2 + 11 = 13 = 1x the house's value. Old code treated any combo
    // with loose cards as a "break" attempt, which would have illegally
    // tried to raise the value to 26.
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P1], captureValue: 13, cards: [card(Face.King, Suit.Hearts)] }),
        { kind: 'loose', id: 'f1', card: card(Face.Jack, Suit.Hearts) },
      ],
      hands: { p3: [card(Face.Two, Suit.Hearts), card(Face.King, Suit.Clubs)], p1: [], p2: [], p4: [] },
      turn: SeatId.P3,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P3, card(Face.Two, Suit.Hearts), 'h1', ['f1'])
    const houses = next.floor.filter((i): i is House<SeatId> => i.kind === 'house')
    expect(houses).toHaveLength(1)
    expect(houses[0]!.captureValue).toBe(13)
    expect(houses[0]!.cemented).toBe(true)
    expect(houses[0]!.cards).toHaveLength(3) // original King + Jack + the 2
    expect(next.floor.some((i) => i.id === 'f1')).toBe(false) // loose Jack consumed
  })

  it('cements via a combination summing to a full multiple (2x) of the house value', () => {
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P2], captureValue: 9, cards: [card(Face.Nine, Suit.Hearts)] }),
        { kind: 'loose', id: 'f1', card: card(Face.Six, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Three, Suit.Diamonds) },
      ],
      // 9 (played) + 6 + 3 = 18 = 2 x 9
      hands: { p1: [card(Face.Nine, Suit.Clubs), card(Face.Nine, Suit.Spades)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Nine, Suit.Clubs), 'h1', ['f1', 'f2'])
    const houses = next.floor.filter((i): i is House<SeatId> => i.kind === 'house')
    expect(houses).toHaveLength(1)
    expect(houses[0]!.captureValue).toBe(9) // value unchanged, unlike a break
    expect(houses[0]!.cemented).toBe(true)
    expect(houses[0]!.cards).toHaveLength(4)
  })

  it('still requires a reserve card for a multi-card cement on your own house', () => {
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P1], captureValue: 13, cards: [card(Face.King, Suit.Hearts)] }),
        { kind: 'loose', id: 'f1', card: card(Face.Jack, Suit.Hearts) },
      ],
      hands: { p1: [card(Face.Two, Suit.Hearts)], p2: [], p3: [], p4: [] }, // no reserve 13 left
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Two, Suit.Hearts), 'h1', ['f1'])).toThrow()
  })

  it('still cements freely on a partner\'s house without a reserve, even for a multi-card combination', () => {
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P1], captureValue: 13, cards: [card(Face.King, Suit.Hearts)] }),
        { kind: 'loose', id: 'f1', card: card(Face.Jack, Suit.Hearts) },
      ],
      hands: {
        p3: [card(Face.Two, Suit.Hearts)], // no reserve, but p1 is p3's partner
        p1: [card(Face.Four, Suit.Clubs)], p2: [card(Face.Five, Suit.Clubs)], p4: [card(Face.Six, Suit.Clubs)],
      },
      turn: SeatId.P3,
    })
    const next = playFourPlayerModifyHouse(state, SeatId.P3, card(Face.Two, Suit.Hearts), 'h1', ['f1'])
    const cemented = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(cemented.cemented).toBe(true)
  })

  it('a combination that is NOT a multiple of the house value still falls through to breaking it', () => {
    const state = makeState({
      floor: [house({ id: 'h1', owners: [SeatId.P2], captureValue: 9, cards: [card(Face.Nine, Suit.Hearts)] })],
      hands: { p1: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], p2: [], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    // 3 is not a multiple of 9, so this should break the house up to 12, not cement it.
    const next = playFourPlayerModifyHouse(state, SeatId.P1, card(Face.Three, Suit.Clubs), 'h1')
    const house2 = next.floor.find((i): i is House<SeatId> => i.kind === 'house')!
    expect(house2.captureValue).toBe(12)
    expect(house2.cemented).toBe(false)
  })
})

describe('a capture must take every matching group at once, not just one', () => {
  it('reproduces the exact reported scenario: a 10 must capture 2+8 AND the loose 10 together', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Clubs) },
        { kind: 'loose', id: 'f3', card: card(Face.Ten, Suit.Hearts) },
      ],
      hands: { p1: [card(Face.Ten, Suit.Diamonds)], p2: [card(Face.Four, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerCapture(state, SeatId.P1, card(Face.Ten, Suit.Diamonds), ['f1', 'f2', 'f3'])
    expect(next.floor).toHaveLength(0)
    expect(next.captures.teamA).toHaveLength(4) // 2, 8, 10, plus the played 10
  })

  it('rejects capturing just the single loose Ten when the combined 2+8 group is also available', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Clubs) },
        { kind: 'loose', id: 'f3', card: card(Face.Ten, Suit.Hearts) },
      ],
      hands: { p1: [card(Face.Ten, Suit.Diamonds)], p2: [card(Face.Four, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerCapture(state, SeatId.P1, card(Face.Ten, Suit.Diamonds), ['f3'])).toThrow()
  })

  it('rejects capturing just the 2+8 pair when the loose Ten is also available separately', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Clubs) },
        { kind: 'loose', id: 'f3', card: card(Face.Ten, Suit.Hearts) },
      ],
      hands: { p1: [card(Face.Ten, Suit.Diamonds)], p2: [card(Face.Four, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerCapture(state, SeatId.P1, card(Face.Ten, Suit.Diamonds), ['f1', 'f2'])).toThrow()
  })

  it('still allows an ordinary single-group capture when no second group exists', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { p1: [card(Face.Seven, Suit.Clubs)], p2: [card(Face.Four, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    const next = playFourPlayerCapture(state, SeatId.P1, card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.floor).toHaveLength(0)
  })

  it('rejects a selection whose total happens to be a multiple but does not cleanly decompose', () => {
    // 3 + 4 + 13 = 20 = 2x10, but no subset of these three sums to exactly
    // 10 — there is no clean way to split this into two tens, so it must
    // be rejected even though the raw total matches.
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Three, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Four, Suit.Diamonds) },
        { kind: 'loose', id: 'f3', card: card(Face.King, Suit.Hearts) },
      ],
      hands: { p1: [card(Face.Ten, Suit.Diamonds)], p2: [card(Face.Five, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    expect(() => playFourPlayerCapture(state, SeatId.P1, card(Face.Ten, Suit.Diamonds), ['f1', 'f2', 'f3'])).toThrow()
  })

  it('a house is still captured alone, unaffected by an unrelated matching loose group elsewhere', () => {
    const state = makeState({
      floor: [
        house({ id: 'h1', owners: [SeatId.P2], captureValue: 10, cards: [card(Face.Ten, Suit.Spades)] }),
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Diamonds) },
      ],
      hands: { p1: [card(Face.Ten, Suit.Diamonds)], p2: [card(Face.Four, Suit.Clubs)], p3: [], p4: [] },
      turn: SeatId.P1,
    })
    // Capturing the house alone is still legal on its own, even though a
    // second "ten" (2+8) also exists loose on the floor — houses are never
    // combined with anything else.
    const next = playFourPlayerCapture(state, SeatId.P1, card(Face.Ten, Suit.Diamonds), ['h1'])
    const remaining = next.floor.filter((i) => i.kind === 'loose')
    expect(remaining).toHaveLength(2) // the loose 2 and 8 are untouched
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
