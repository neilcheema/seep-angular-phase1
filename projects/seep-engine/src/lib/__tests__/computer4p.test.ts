import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card'
import { SeatId } from '../seats'
import {
  type FourPlayerGameState,
  dealNextFourPlayerHand,
  placeFourPlayerBid,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
  startFourPlayerMatch,
} from '../fourPlayerEngine'
import { chooseFourPlayerBid, chooseFourPlayerMove, chooseFourPlayerOpeningMove } from '../computer4p'

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

function applyAction(
  state: FourPlayerGameState,
  seat: SeatId,
  action: ReturnType<typeof chooseFourPlayerMove>,
): FourPlayerGameState {
  if (action.type === 'capture') return playFourPlayerCapture(state, seat, action.card, action.targetItemIds)
  if (action.type === 'build') {
    return playFourPlayerBuildHouse(state, seat, action.card, action.looseItemIds, action.targetValue)
  }
  if (action.type === 'modify') {
    return playFourPlayerModifyHouse(state, seat, action.card, action.houseId, action.extraLooseItemIds)
  }
  return playFourPlayerThrow(state, seat, action.card)
}

describe('chooseFourPlayerBid', () => {
  it('always returns a value the bidder can actually support', () => {
    const state = makeState({
      phase: 'bidding',
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.King, Suit.Hearts)],
    })
    expect(chooseFourPlayerBid(state)).toBe(13)
  })
})

describe('chooseFourPlayerMove', () => {
  it('captures the largest available combination when a capture exists', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Three, Suit.Diamonds) },
      ],
      hands: { p3: [card(Face.Two, Suit.Clubs), card(Face.Seven, Suit.Clubs)], p1: [], p2: [], p4: [] },
      turn: SeatId.P3,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('capture')
    // Prefers capturing both loose cards (value 7, via the 7) over the lone 2.
    if (action.type === 'capture') expect(action.targetItemIds).toHaveLength(2)
  })

  it('throws when no capture is available', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.King, Suit.Diamonds) }],
      hands: { p2: [card(Face.Two, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('throw')
  })

  it('always carries a non-empty reason for narration, whatever the decision', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.King, Suit.Diamonds) }],
      hands: { p2: [card(Face.Two, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.reason.length).toBeGreaterThan(0)
  })
})

describe('AI-driven full match fuzzing', () => {
  it('plays complete matches purely via the AI decision functions without any illegal move', () => {
    for (let match = 0; match < 6; match++) {
      let state = startFourPlayerMatch()
      let guard = 0
      while (state.phase !== 'match-over') {
        guard++
        if (guard > 8000) throw new Error('Game did not terminate')

        if (state.phase === 'hand-over') {
          state = dealNextFourPlayerHand(state)
          continue
        }
        if (state.phase === 'bidding') {
          state = placeFourPlayerBid(state, state.turn, chooseFourPlayerBid(state))
          continue
        }
        if (state.phase === 'opening-move') {
          const action = chooseFourPlayerOpeningMove(state)
          state = applyAction(state, state.turn, action)
          continue
        }
        // 'playing'
        const action = chooseFourPlayerMove(state)
        state = applyAction(state, state.turn, action)
      }
      expect(state.winner).not.toBeNull()
    }
  })
})
