import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { chooseComputerBid, chooseComputerMove } from '../computer.ts'
import type { GameState } from '../gameEngine.ts'

function card(face: Face, suit: Suit): Card {
  return { face, suit }
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    floor: [],
    hands: { player: [], opponent: [] },
    captures: { player: [], opponent: [] },
    sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 0, opponent: 0 },
    bidder: 'player',
    turn: 'opponent',
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

describe('chooseComputerBid', () => {
  it('returns a value the bidder can actually support', () => {
    const state = makeState({
      phase: 'bidding',
      bidder: 'opponent',
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.King, Suit.Hearts)],
    })
    expect(chooseComputerBid(state)).toBe(13)
  })
})

describe('chooseComputerMove', () => {
  it('captures the largest available combination when a capture exists', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Three, Suit.Diamonds) },
      ],
      hands: { opponent: [card(Face.Two, Suit.Clubs), card(Face.Seven, Suit.Clubs)], player: [] },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('capture')
    if (action.type === 'capture') expect(action.targetItemIds).toHaveLength(2)
  })

  it('builds a house when no capture is available but a build is possible — the reported bug', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) }],
      hands: { opponent: [card(Face.Five, Suit.Clubs), card(Face.Nine, Suit.Spades)], player: [] },
    })
    const action = chooseComputerMove(state)
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
        opponent: [card(Face.Seven, Suit.Clubs), card(Face.Five, Suit.Hearts), card(Face.Nine, Suit.Spades)],
        player: [],
      },
      // The other three Fours are already accounted for (captured earlier
      // in the hand), so the Four left on the floor after this capture is
      // deducibly safe — isolates this test to capture-vs-build priority.
      captures: { player: [card(Face.Four, Suit.Hearts)], opponent: [card(Face.Four, Suit.Diamonds), card(Face.Four, Suit.Spades)] },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('capture')
  })

  it('throws when neither a capture nor a build is available', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.King, Suit.Diamonds) }],
      hands: { opponent: [card(Face.Two, Suit.Spades)], player: [] },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('throw')
  })

  it('always carries a non-empty reason for narration, whatever the decision', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.King, Suit.Diamonds) }],
      hands: { opponent: [card(Face.Two, Suit.Spades)], player: [] },
    })
    const action = chooseComputerMove(state)
    expect(action.reason.length).toBeGreaterThan(0)
  })

  it('breaks a tie between equally-safe cards by scoring point value, not capture value', () => {
    // Both cards open zero capture opportunities for the opponent (floor has
    // nothing they could combine with either), so the tie-break decides.
    // King of Hearts is worth 0 scoring points; Two of Spades is worth 2 —
    // the old capture-value tie-break (13 vs 2) would have thrown the Two of
    // Spades and kept the King of Hearts, the wrong way around.
    const state = makeState({
      floor: [],
      hands: { opponent: [card(Face.King, Suit.Hearts), card(Face.Two, Suit.Spades)], player: [] },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('throw')
    if (action.type === 'throw') {
      expect(action.card).toEqual(card(Face.King, Suit.Hearts))
    }
  })
})

describe('the AI avoids a capture that would leave the opponent a free sweep, when a safer card exists', () => {
  it('throws instead of capturing a 9 that would leave a lone Queen exposed to the opponent', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Nine, Suit.Spades) },
        { kind: 'loose', id: 'f2', card: card(Face.Queen, Suit.Clubs) },
      ],
      hands: {
        opponent: [card(Face.Nine, Suit.Hearts), card(Face.Three, Suit.Diamonds)],
        player: [card(Face.Queen, Suit.Spades)],
      },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('throw')
    if (action.type === 'throw') {
      expect(action.card).toEqual(card(Face.Three, Suit.Diamonds))
    }
  })

  it('still captures normally when the leftover value is deducibly safe (all four copies accounted for)', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Nine, Suit.Spades) },
        { kind: 'loose', id: 'f2', card: card(Face.Queen, Suit.Clubs) },
      ],
      hands: {
        opponent: [card(Face.Nine, Suit.Hearts), card(Face.Three, Suit.Diamonds)],
        player: [card(Face.Four, Suit.Spades)],
      },
      // Three of the four Queens are already captured; the fourth (Q♣) is
      // the one that would be left on the floor — together that's all four
      // accounted for, so the human can't possibly hold a matching one.
      captures: {
        player: [card(Face.Queen, Suit.Hearts)],
        opponent: [card(Face.Queen, Suit.Spades), card(Face.Queen, Suit.Diamonds)],
      },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('capture')
    if (action.type === 'capture') {
      expect(action.targetItemIds).toEqual(['f1'])
    }
  })

  it('still captures despite the risk when no safer card exists in hand at all', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Nine, Suit.Spades) },
        { kind: 'loose', id: 'f2', card: card(Face.Queen, Suit.Clubs) },
      ],
      hands: { opponent: [card(Face.Nine, Suit.Hearts)], player: [card(Face.Queen, Suit.Spades)] },
    })
    const action = chooseComputerMove(state)
    expect(action.type).toBe('capture')
  })
})
