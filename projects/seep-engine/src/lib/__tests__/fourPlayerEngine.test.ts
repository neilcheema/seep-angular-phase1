import { describe, expect, it } from 'vitest'
import { Face, Suit, captureValue, type Card } from '../card.ts'
import { SeatId, TeamId, nextSeat } from '../seats.ts'
import {
  type FourPlayerGameState,
  computeNextDealer,
  dealFourPlayerHand,
  dealNextFourPlayerHand,
  finishFourPlayerHand,
  legalFourPlayerBids,
  placeFourPlayerBid,
  startFourPlayerMatch,
} from '../fourPlayerEngine.ts'
import { ENGINE_VERSION } from '../version.ts'
import type { FloorItem } from '../floor.ts'

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
    phase: 'bidding',
    bidValue: null,
    pendingDeal: null,
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: 47,
    nextItemId: 0,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
    engineVersion: ENGINE_VERSION,
  }
  return { ...base, ...overrides }
}

describe('dealFourPlayerHand', () => {
  it('always gives the bidder a house card (9-13) among their first four, across many deals', () => {
    for (let i = 0; i < 20; i++) {
      const state = dealFourPlayerHand(SeatId.P4)
      const values = state.hands[state.bidder].map(captureValue)
      expect(values.some((v: number) => v >= 9 && v <= 13)).toBe(true)
    }
  })

  it('deals 4 to the floor and 4 to the bidder up front, holding everyone else pending until the opening move', () => {
    const state = dealFourPlayerHand(SeatId.P4)
    expect(state.floor).toHaveLength(4)
    expect(state.hands[state.bidder]).toHaveLength(4)
    for (const seat of [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]) {
      if (seat !== state.bidder) expect(state.hands[seat]).toHaveLength(0)
    }
    expect(state.pendingDeal).not.toBeNull()
    expect(state.pendingDeal![state.bidder]).toHaveLength(8)
    for (const seat of [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]) {
      if (seat !== state.bidder) expect(state.pendingDeal![seat]).toHaveLength(12)
    }
    expect(state.engineVersion).toBe(ENGINE_VERSION)
  })

  it('makes the bidder the seat after the dealer in turn order', () => {
    expect(dealFourPlayerHand(SeatId.P1).bidder).toBe(SeatId.P2)
    expect(dealFourPlayerHand(SeatId.P4).bidder).toBe(SeatId.P1)
  })

  it('starts the bidder as both turn and phase "bidding"', () => {
    const state = dealFourPlayerHand(SeatId.P3)
    expect(state.turn).toBe(state.bidder)
    expect(state.phase).toBe('bidding')
  })
})

describe('startFourPlayerMatch', () => {
  it('uses the given dealer when provided', () => {
    const state = startFourPlayerMatch(SeatId.P2)
    expect(state.dealer).toBe(SeatId.P2)
    expect(state.bidder).toBe(nextSeat(SeatId.P2))
  })

  it('defaults to p4 as dealer (deterministically) when none is given, so p1 is always the first bidder', () => {
    const state = startFourPlayerMatch()
    expect(state.dealer).toBe(SeatId.P4)
    expect(state.bidder).toBe(SeatId.P1)
  })
})

describe('bidding', () => {
  it('rejects a bid the bidder cannot support from their first four cards', () => {
    const state = makeState({
      hands: { p1: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)], p2: [], p3: [], p4: [] },
    })
    expect(() => placeFourPlayerBid(state, SeatId.P1, 11)).toThrow()
  })

  it('rejects a bid from a seat that is not the bidder', () => {
    const state = makeState({
      bidder: SeatId.P1,
      turn: SeatId.P1,
      hands: { p1: [card(Face.Nine, Suit.Hearts)], p2: [], p3: [], p4: [] },
    })
    expect(() => placeFourPlayerBid(state, SeatId.P3, 9)).toThrow()
  })

  it('accepts a supported bid and moves to the opening move', () => {
    const state = makeState({
      bidder: SeatId.P2,
      turn: SeatId.P2,
      hands: { p1: [], p2: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)], p3: [], p4: [] },
    })
    const next = placeFourPlayerBid(state, SeatId.P2, 9)
    expect(next.phase).toBe('opening-move')
    expect(next.bidValue).toBe(9)
  })

  it('lists every distinct house value the bidder holds, sorted', () => {
    const state = makeState({
      hands: {
        p1: [card(Face.King, Suit.Clubs), card(Face.Nine, Suit.Hearts), card(Face.Queen, Suit.Spades)],
        p2: [], p3: [], p4: [],
      },
    })
    expect(legalFourPlayerBids(state)).toEqual([9, 12, 13])
  })
})

describe('dealNextFourPlayerHand', () => {
  it('refuses to deal when the current hand has not finished', () => {
    const state = makeState({ phase: 'playing' })
    expect(() => dealNextFourPlayerHand(state)).toThrow()
  })

  it('passes the deal to the next seat in turn order and carries match scores forward', () => {
    const state = makeState({
      phase: 'hand-over',
      dealer: SeatId.P1,
      matchScores: { teamA: 30, teamB: 12 },
    })
    const next = dealNextFourPlayerHand(state)
    expect(next.dealer).toBe(SeatId.P2)
    expect(next.matchScores).toEqual({ teamA: 30, teamB: 12 })
  })
})

describe('finishFourPlayerHand', () => {
  it('sends leftover floor cards to the last-capturing team', () => {
    const floor: FloorItem<SeatId>[] = [
      { kind: 'loose', id: 'f1', card: card(Face.King, Suit.Spades) },
    ]
    const state = makeState({
      captures: { teamA: [card(Face.Ace, Suit.Hearts)], teamB: [] },
    })
    const next = finishFourPlayerHand(state, floor, TeamId.TeamA)
    expect(next.captures.teamA).toHaveLength(2)
    expect(next.floor).toHaveLength(0)
  })

  it('zeroes a team\'s card points when under the 9-point qualifying minimum', () => {
    const state = makeState({
      captures: { teamA: [card(Face.Two, Suit.Clubs)], teamB: [card(Face.King, Suit.Spades)] },
    })
    const next = finishFourPlayerHand(state, [], null)
    expect(next.lastHandTotals!.teamA.qualifyingCardPoints).toBe(0)
    expect(next.lastHandTotals!.teamB.qualifyingCardPoints).toBe(13)
  })

  it('adds sweep points on top of qualifying card points for match score accumulation', () => {
    const state = makeState({
      captures: { teamA: [card(Face.King, Suit.Spades)], teamB: [] },
      sweepPoints: { teamA: 50, teamB: 0 },
      matchScores: { teamA: 10, teamB: 5 },
    })
    const next = finishFourPlayerHand(state, [], null)
    expect(next.lastHandTotals!.teamA.total).toBe(63)
    expect(next.matchScores.teamA).toBe(73)
    expect(next.phase).toBe('hand-over')
    expect(next.winner).toBeNull()
  })

  it('declares a bazzi winner once a team\'s cumulative lead reaches 100', () => {
    const state = makeState({
      captures: { teamA: [card(Face.King, Suit.Spades)], teamB: [] },
      matchScores: { teamA: 90, teamB: 0 },
    })
    const next = finishFourPlayerHand(state, [], null)
    expect(next.matchScores.teamA).toBe(103)
    expect(next.phase).toBe('match-over')
    expect(next.winner).toBe(TeamId.TeamA)
  })
})

describe('dealer rotation follows who is winning, not simple round-robin', () => {
  // These reproduce the exact worked examples from the authoritative rules
  // (pagat.com): the dealer's team deals again if behind or tied after the
  // hand, and the deal passes to the next seat only once the dealer's team
  // is actually ahead. P1/P3 are teamA; P2/P4 are teamB.
  it('keeps the same dealer when their team is behind after the hand', () => {
    const scores = { teamA: 20, teamB: 56 } // dealer P1 is teamA, and teamA is behind
    expect(computeNextDealer(SeatId.P1, scores, null)).toBe(SeatId.P1)
  })

  it('keeps the same dealer when the two teams are exactly tied', () => {
    const scores = { teamA: 40, teamB: 40 }
    expect(computeNextDealer(SeatId.P1, scores, null)).toBe(SeatId.P1)
  })

  it('passes the deal to the next seat once the dealer\'s team is ahead', () => {
    const scores = { teamA: 56, teamB: 20 } // dealer P1 is teamA, and teamA is now ahead
    expect(computeNextDealer(SeatId.P1, scores, null)).toBe(nextSeat(SeatId.P1))
  })

  it('a baazi sends the deal to the partner of who would have dealt, not that player directly', () => {
    // Dealer P1 (teamA) is behind, so the normal rule says P1 deals again —
    // but teamB just won a baazi, so the deal instead goes to P1's partner
    // (P3), not back to P1.
    const scores = { teamA: 0, teamB: 106 }
    expect(computeNextDealer(SeatId.P1, scores, TeamId.TeamB)).toBe(SeatId.P3)
  })

  it('a baazi combined with the dealer\'s team taking the lead sends the deal to that next seat\'s partner', () => {
    // Dealer P2 (teamB) is now ahead and teamB is the one who won the
    // baazi (a team can only win a baazi by being the one in the lead) — so
    // the normal rule would pass to nextSeat(P2) = P3, but the baazi sends
    // it instead to P3's partner (P1).
    const scores = { teamA: 0, teamB: 106 }
    expect(computeNextDealer(SeatId.P2, scores, TeamId.TeamB)).toBe(SeatId.P1)
  })

  it('dealNextFourPlayerHand actually uses this rule for the ongoing match', () => {
    // startFourPlayerMatch(P4) deals with dealer = P4 (teamB). Give teamB
    // the lead, so the deal should move on to the next seat rather than
    // staying with P4.
    const state = { ...startFourPlayerMatch(SeatId.P4), phase: 'hand-over' as const, matchScores: { teamA: 10, teamB: 30 } }
    const next = dealNextFourPlayerHand(state)
    expect(next.dealer).toBe(nextSeat(SeatId.P4))
  })
})

describe('seeded dealing is reproducible', () => {
  it('the same seed deals the exact same floor and hands every time', () => {
    const a = dealFourPlayerHand(SeatId.P4, undefined, 42)
    const b = dealFourPlayerHand(SeatId.P4, undefined, 42)
    expect(a.floor).toEqual(b.floor)
    expect(a.hands).toEqual(b.hands)
    expect(a.pendingDeal).toEqual(b.pendingDeal)
  })

  it('different seeds deal different hands', () => {
    const a = dealFourPlayerHand(SeatId.P4, undefined, 1)
    const b = dealFourPlayerHand(SeatId.P4, undefined, 2)
    expect(a.hands).not.toEqual(b.hands)
  })

  it('omitting the seed still deals a full, valid hand (unseeded default path still works)', () => {
    const state = dealFourPlayerHand(SeatId.P4)
    expect(state.hands[state.bidder]).toHaveLength(4)
    expect(state.floor).toHaveLength(4)
  })
})
