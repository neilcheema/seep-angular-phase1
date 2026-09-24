import { describe, expect, it } from 'vitest'
import { Face, Suit, captureValue, type Card } from '../card'
import { SeatId, TeamId, nextSeat } from '../seats'
import {
  type FourPlayerGameState,
  dealFourPlayerHand,
  dealNextFourPlayerHand,
  finishFourPlayerHand,
  legalFourPlayerBids,
  placeFourPlayerBid,
  startFourPlayerMatch,
} from '../fourPlayerEngine'
import type { FloorItem } from '../floor'

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
    bidderInitialCards: [],
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: 47,
    nextItemId: 0,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
  }
  return { ...base, ...overrides }
}

describe('dealFourPlayerHand', () => {
  it('always gives the bidder a house card (9-13) among their first four, across many deals', () => {
    for (let i = 0; i < 20; i++) {
      const state = dealFourPlayerHand(SeatId.P4)
      const values = state.bidderInitialCards.map(captureValue)
      expect(values.some((v) => v >= 9 && v <= 13)).toBe(true)
    }
  })

  it('deals 4 to the floor and 12 to each of the four seats from a 52-card deck', () => {
    const state = dealFourPlayerHand(SeatId.P4)
    expect(state.floor).toHaveLength(4)
    for (const seat of [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]) {
      expect(state.hands[seat]).toHaveLength(12)
    }
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

  it('picks some valid seat as dealer when none is given', () => {
    const state = startFourPlayerMatch()
    expect([SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]).toContain(state.dealer)
  })
})

describe('bidding', () => {
  it('rejects a bid the bidder cannot support from their first four cards', () => {
    const state = makeState({
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)],
    })
    expect(() => placeFourPlayerBid(state, SeatId.P1, 11)).toThrow()
  })

  it('rejects a bid from a seat that is not the bidder', () => {
    const state = makeState({
      bidder: SeatId.P1,
      turn: SeatId.P1,
      bidderInitialCards: [card(Face.Nine, Suit.Hearts)],
    })
    expect(() => placeFourPlayerBid(state, SeatId.P3, 9)).toThrow()
  })

  it('accepts a supported bid and moves to the opening move', () => {
    const state = makeState({
      bidder: SeatId.P2,
      turn: SeatId.P2,
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)],
    })
    const next = placeFourPlayerBid(state, SeatId.P2, 9)
    expect(next.phase).toBe('opening-move')
    expect(next.bidValue).toBe(9)
  })

  it('lists every distinct house value the bidder holds, sorted', () => {
    const state = makeState({
      bidderInitialCards: [
        card(Face.King, Suit.Clubs),
        card(Face.Nine, Suit.Hearts),
        card(Face.Queen, Suit.Spades),
      ],
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
    expect(next.lastHandTotals!.teamA.total).toBe(63) // 13 card points + 50 sweep
    expect(next.matchScores.teamA).toBe(73) // 10 prior + 63
    expect(next.phase).toBe('hand-over')
    expect(next.winner).toBeNull()
  })

  it('declares a bazzi winner once a team\'s cumulative lead reaches 100', () => {
    const state = makeState({
      captures: { teamA: [card(Face.King, Suit.Spades)], teamB: [] },
      matchScores: { teamA: 90, teamB: 0 },
    })
    const next = finishFourPlayerHand(state, [], null)
    expect(next.matchScores.teamA).toBe(103) // 90 + 13
    expect(next.phase).toBe('match-over')
    expect(next.winner).toBe(TeamId.TeamA)
  })
})
