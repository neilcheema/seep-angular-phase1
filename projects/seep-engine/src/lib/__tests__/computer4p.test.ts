import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { SeatId } from '../seats.ts'
import {
  type FourPlayerGameState,
  dealNextFourPlayerHand,
  placeFourPlayerBid,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
  startFourPlayerMatch,
} from '../fourPlayerEngine.ts'
import { chooseFourPlayerBid, chooseFourPlayerMove, chooseFourPlayerOpeningMove } from '../computer4p.ts'

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
    if (action.type === 'capture') expect(action.targetItemIds).toHaveLength(2)
  })

  it('builds a house when no capture is available but a build is possible — the reported bug', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) }],
      hands: { p2: [card(Face.Five, Suit.Clubs), card(Face.Nine, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('build')
    if (action.type === 'build') {
      expect(action.targetValue).toBe(9)
      expect(action.looseItemIds).toEqual(['f1'])
    }
  })

  it('still prefers capturing over building when both are available', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Four, Suit.Clubs) },
      ],
      hands: {
        p2: [card(Face.Seven, Suit.Clubs), card(Face.Five, Suit.Hearts), card(Face.Nine, Suit.Spades)],
        p1: [], p3: [], p4: [],
      },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('capture')
  })

  it('throws when neither a capture nor a build is available', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.King, Suit.Diamonds) }],
      hands: { p2: [card(Face.Two, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('throw')
  })

  it('breaks a tie between equally-safe cards by scoring point value, not capture value', () => {
    const state = makeState({
      floor: [],
      hands: { p2: [card(Face.King, Suit.Hearts), card(Face.Two, Suit.Spades)], p1: [], p3: [], p4: [] },
      turn: SeatId.P2,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('throw')
    if (action.type === 'throw') {
      expect(action.card).toEqual(card(Face.King, Suit.Hearts))
    }
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

  it('prefers freely cementing a partner\'s house over capturing it outright — the reported cooperation bug', () => {
    // p1's house is on the floor alongside an unrelated loose card. p3 (p1's
    // partner) holds a card that could capture p1's house directly *or* a
    // different card that captures the unrelated loose card — with neither
    // option clearing the whole floor. The old capture-first priority would
    // have grabbed p1's own house the instant a matching card showed up,
    // rather than ever growing it. Now it should cement instead.
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: [SeatId.P1] },
        { kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) },
      ],
      hands: {
        p3: [card(Face.Nine, Suit.Clubs), card(Face.Four, Suit.Clubs)],
        p1: [], p2: [], p4: [],
      },
      turn: SeatId.P3,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('modify')
    if (action.type === 'modify') {
      expect(action.houseId).toBe('h1')
      expect(action.card).toEqual(card(Face.Nine, Suit.Clubs))
    }
  })

  it('still takes a sweep over cementing a partner\'s house when both are available', () => {
    // Here capturing p1's house *would* clear the whole floor (it's the only
    // item) — a guaranteed sweep bonus beats growing it for later.
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: [SeatId.P1] },
      ],
      hands: { p3: [card(Face.Nine, Suit.Clubs)], p1: [], p2: [], p4: [] },
      turn: SeatId.P3,
    })
    const action = chooseFourPlayerMove(state)
    expect(action.type).toBe('capture')
    if (action.type === 'capture') expect(action.reason).toContain('sweep')
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
        const action = chooseFourPlayerMove(state)
        state = applyAction(state, state.turn, action)
      }
      expect(state.winner).not.toBeNull()
    }
  })

  it('actually forms houses during AI-driven play (regression guard for the reported bug)', () => {
    let sawABuildOrModify = false
    for (let match = 0; match < 4 && !sawABuildOrModify; match++) {
      let state = startFourPlayerMatch()
      let guard = 0
      while (state.phase !== 'match-over' && guard < 8000) {
        guard++
        if (state.phase === 'hand-over') { state = dealNextFourPlayerHand(state); continue }
        if (state.phase === 'bidding') { state = placeFourPlayerBid(state, state.turn, chooseFourPlayerBid(state)); continue }
        if (state.phase === 'opening-move') {
          const action = chooseFourPlayerOpeningMove(state)
          if (action.type === 'build') sawABuildOrModify = true
          state = applyAction(state, state.turn, action)
          continue
        }
        const action = chooseFourPlayerMove(state)
        if (action.type === 'build' || action.type === 'modify') sawABuildOrModify = true
        state = applyAction(state, state.turn, action)
      }
    }
    expect(sawABuildOrModify).toBe(true)
  })
})
