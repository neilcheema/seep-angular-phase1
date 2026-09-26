import { describe, expect, it } from 'vitest'
import { Face, Suit, captureValue, pointValue } from '../card.ts'
import {
  type GameState,
  dealHand, placeBid, playBuildHouse, playCapture, playModifyHouse, playThrow,
} from '../gameEngine.ts'
import { isHouse } from '../floor.ts'

function card(face: Face, suit: Suit) {
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
    turn: 'player',
    phase: 'playing',
    bidValue: null,
    bidderInitialCards: [],
    lastCapturer: null,
    cardsPlayedThisHand: 5,
    totalPlayableThisHand: 48,
    nextItemId: 0,
    log: [],
    winner: null,
    lastHandTotals: null,
    misdeals: 0,
  }
  return { ...base, ...overrides }
}

describe('card values', () => {
  it('assigns capture values per the rules (Ace=1, face cards 11-13)', () => {
    expect(captureValue(card(Face.Ace, Suit.Spades))).toBe(1)
    expect(captureValue(card(Face.Ten, Suit.Hearts))).toBe(10)
    expect(captureValue(card(Face.King, Suit.Clubs))).toBe(13)
  })

  it('scores spades at capture value, aces at 1, ten of diamonds at 6, others at 0', () => {
    expect(pointValue(card(Face.King, Suit.Spades))).toBe(13)
    expect(pointValue(card(Face.Ace, Suit.Hearts))).toBe(1)
    expect(pointValue(card(Face.Ten, Suit.Diamonds))).toBe(6)
    expect(pointValue(card(Face.Seven, Suit.Clubs))).toBe(0)
  })
})

describe('dealHand', () => {
  it('always gives the bidder a house card (9-13) among their first four', () => {
    for (let i = 0; i < 20; i++) {
      const state = dealHand('player')
      const values = state.bidderInitialCards.map(captureValue)
      expect(values.some(v => v >= 9 && v <= 13)).toBe(true)
    }
  })

  it('deals 4 to the floor and 24 to each player from a 52-card deck', () => {
    const state = dealHand('player')
    expect(state.floor).toHaveLength(4)
    expect(state.hands.player).toHaveLength(24)
    expect(state.hands.opponent).toHaveLength(24)
  })
})

describe('bidding', () => {
  it('rejects a bid the bidder cannot support from their first four cards', () => {
    const state = makeState({
      phase: 'bidding',
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)],
    })
    expect(() => placeBid(state, 'player', 11)).toThrow()
  })

  it('accepts a supported bid and moves to the opening move', () => {
    const state = makeState({
      phase: 'bidding',
      bidderInitialCards: [card(Face.Two, Suit.Clubs), card(Face.Nine, Suit.Hearts)],
    })
    const next = placeBid(state, 'player', 9)
    expect(next.phase).toBe('opening-move')
    expect(next.bidValue).toBe(9)
  })
})

describe('playCapture', () => {
  it('captures a single loose card of matching value', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { player: [card(Face.Seven, Suit.Clubs)], opponent: [card(Face.Two, Suit.Hearts)] },
    })
    const next = playCapture(state, 'player', card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.floor).toHaveLength(0)
    expect(next.captures.player).toHaveLength(2)
    expect(next.turn).toBe('opponent')
  })

  it('captures multiple loose cards that sum to the played card value', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Six, Suit.Clubs) },
      ],
      hands: { player: [card(Face.Ten, Suit.Spades)], opponent: [card(Face.Two, Suit.Hearts)] },
    })
    const next = playCapture(state, 'player', card(Face.Ten, Suit.Spades), ['f1', 'f2'])
    expect(next.floor).toHaveLength(0)
    expect(next.captures.player).toHaveLength(3)
  })

  it('rejects a capture whose targets do not sum to the played card value', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Four, Suit.Diamonds) }],
      hands: { player: [card(Face.Ten, Suit.Spades)], opponent: [] },
    })
    expect(() => playCapture(state, 'player', card(Face.Ten, Suit.Spades), ['f1'])).toThrow()
  })

  it('awards a 50-point sweep bonus for clearing the floor mid-hand', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        player: [card(Face.Seven, Suit.Clubs), card(Face.Two, Suit.Spades)],
        opponent: [card(Face.Three, Suit.Hearts)],
      },
      cardsPlayedThisHand: 10,
      totalPlayableThisHand: 48,
    })
    const next = playCapture(state, 'player', card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.sweepPoints.player).toBe(50)
  })

  it('awards only a 25-point sweep bonus on the opening move', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        player: [card(Face.Seven, Suit.Clubs), card(Face.Two, Suit.Spades)],
        opponent: [card(Face.Three, Suit.Hearts)],
      },
      cardsPlayedThisHand: 0,
      totalPlayableThisHand: 48,
    })
    const next = playCapture(state, 'player', card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.sweepPoints.player).toBe(25)
  })

  it('awards no sweep bonus on the very last play of the hand', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { player: [card(Face.Seven, Suit.Clubs)], opponent: [] },
      cardsPlayedThisHand: 47,
      totalPlayableThisHand: 48,
    })
    const next = playCapture(state, 'player', card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.sweepPoints.player).toBe(0)
  })
})

describe('playBuildHouse', () => {
  it('builds a new uncemented house when the player holds a reserve card', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: {
        player: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)],
        opponent: [],
      },
    })
    const next = playBuildHouse(state, 'player', card(Face.Six, Suit.Clubs), ['f1'], 11)
    const house = next.floor.find(isHouse)
    expect(house).toBeDefined()
    expect(house!.captureValue).toBe(11)
    expect(house!.cemented).toBe(false)
  })

  it('refuses to build a house without a reserve card of that value in hand', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { player: [card(Face.Six, Suit.Clubs)], opponent: [] },
    })
    expect(() => playBuildHouse(state, 'player', card(Face.Six, Suit.Clubs), ['f1'], 11)).toThrow()
  })

  it('refuses to build a duplicate house value', () => {
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: ['opponent'] },
        { kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) },
      ],
      hands: {
        player: [card(Face.Four, Suit.Clubs), card(Face.Nine, Suit.Spades)],
        opponent: [],
      },
    })
    expect(() => playBuildHouse(state, 'player', card(Face.Four, Suit.Clubs), ['f1'], 9)).toThrow()
  })
})

describe('building a house accepts a multiple of the target value, cementing it immediately', () => {
  it('reproduces the exact reported scenario: 4 + 9 + two loose Kings = 3x13, cemented on creation', () => {
    const state = makeState({
      phase: 'opening-move',
      bidValue: 13,
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Nine, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.King, Suit.Hearts) },
        { kind: 'loose', id: 'f3', card: card(Face.King, Suit.Spades) },
      ],
      hands: {
        player: [card(Face.Four, Suit.Spades), card(Face.King, Suit.Diamonds)],
        opponent: [],
      },
    })
    const next = playBuildHouse(state, 'player', card(Face.Four, Suit.Spades), ['f1', 'f2', 'f3'], 13)
    const house = next.floor.find(isHouse)!
    expect(house.captureValue).toBe(13)
    expect(house.cemented).toBe(true)
    expect(house.cards).toHaveLength(4)
    expect(next.floor).toHaveLength(1)
  })

  it('still builds an ordinary uncemented house when the sum is exactly the target (1x)', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)], opponent: [] },
    })
    const next = playBuildHouse(state, 'player', card(Face.Six, Suit.Clubs), ['f1'], 11)
    const house = next.floor.find(isHouse)!
    expect(house.cemented).toBe(false)
  })

  it('still rejects a selection whose total is not a multiple of the intended target', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Five, Suit.Diamonds) }],
      hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Jack, Suit.Hearts)], opponent: [] },
    })
    expect(() => playBuildHouse(state, 'player', card(Face.Six, Suit.Clubs), ['f1'], 13)).toThrow()
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
      hands: { player: [card(Face.Ten, Suit.Diamonds)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playCapture(state, 'player', card(Face.Ten, Suit.Diamonds), ['f1', 'f2', 'f3'])
    expect(next.floor).toHaveLength(0)
    expect(next.captures.player).toHaveLength(4)
  })

  it('rejects capturing just the single loose Ten when the combined 2+8 group is also available', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Clubs) },
        { kind: 'loose', id: 'f3', card: card(Face.Ten, Suit.Hearts) },
      ],
      hands: { player: [card(Face.Ten, Suit.Diamonds)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    expect(() => playCapture(state, 'player', card(Face.Ten, Suit.Diamonds), ['f3'])).toThrow()
  })

  it('still allows an ordinary single-group capture when no second group exists', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { player: [card(Face.Seven, Suit.Clubs)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playCapture(state, 'player', card(Face.Seven, Suit.Clubs), ['f1'])
    expect(next.floor).toHaveLength(0)
  })

  it('rejects a selection whose total happens to be a multiple but does not cleanly decompose', () => {
    const state = makeState({
      floor: [
        { kind: 'loose', id: 'f1', card: card(Face.Three, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Four, Suit.Diamonds) },
        { kind: 'loose', id: 'f3', card: card(Face.King, Suit.Hearts) },
      ],
      hands: { player: [card(Face.Ten, Suit.Diamonds)], opponent: [card(Face.Five, Suit.Clubs)] },
    })
    expect(() => playCapture(state, 'player', card(Face.Ten, Suit.Diamonds), ['f1', 'f2', 'f3'])).toThrow()
  })

  it('a house is still captured alone, unaffected by an unrelated matching loose group elsewhere', () => {
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.Ten, Suit.Spades)], captureValue: 10, cemented: false, owners: ['opponent'] },
        { kind: 'loose', id: 'f1', card: card(Face.Two, Suit.Clubs) },
        { kind: 'loose', id: 'f2', card: card(Face.Eight, Suit.Diamonds) },
      ],
      hands: { player: [card(Face.Ten, Suit.Diamonds)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playCapture(state, 'player', card(Face.Ten, Suit.Diamonds), ['h1'])
    const remaining = next.floor.filter((i) => i.kind === 'loose')
    expect(remaining).toHaveLength(2)
  })
})

describe('playModifyHouse', () => {
  it('cements a house when a matching-value card is added and a reserve remains', () => {
    const state = makeState({
      floor: [{ kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: ['player'] }],
      hands: { player: [card(Face.Nine, Suit.Clubs), card(Face.Nine, Suit.Spades)], opponent: [] },
    })
    const next = playModifyHouse(state, 'player', card(Face.Nine, Suit.Clubs), 'h1')
    const house = next.floor.find(isHouse)!
    expect(house.cemented).toBe(true)
    expect(house.cards).toHaveLength(2)
  })

  it('cements via a card + loose-card combination summing to exactly the house value (1x)', () => {
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.King, Suit.Hearts)], captureValue: 13, cemented: false, owners: ['opponent'] },
        { kind: 'loose', id: 'f1', card: card(Face.Jack, Suit.Hearts) },
      ],
      hands: { player: [card(Face.Two, Suit.Hearts), card(Face.King, Suit.Clubs)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playModifyHouse(state, 'player', card(Face.Two, Suit.Hearts), 'h1', ['f1'])
    const house = next.floor.find(isHouse)!
    expect(house.captureValue).toBe(13)
    expect(house.cemented).toBe(true)
    expect(house.cards).toHaveLength(3)
  })

  it('cements via a combination summing to a full multiple (2x) of the house value', () => {
    const state = makeState({
      floor: [
        { kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: ['opponent'] },
        { kind: 'loose', id: 'f1', card: card(Face.Six, Suit.Diamonds) },
        { kind: 'loose', id: 'f2', card: card(Face.Three, Suit.Diamonds) },
      ],
      hands: { player: [card(Face.Nine, Suit.Clubs), card(Face.Nine, Suit.Spades)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playModifyHouse(state, 'player', card(Face.Nine, Suit.Clubs), 'h1', ['f1', 'f2'])
    const house = next.floor.find(isHouse)!
    expect(house.captureValue).toBe(9)
    expect(house.cemented).toBe(true)
    expect(house.cards).toHaveLength(4)
  })

  it('a combination that is NOT a multiple of the house value still falls through to breaking it', () => {
    const state = makeState({
      floor: [{ kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: ['opponent'] }],
      hands: { player: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], opponent: [card(Face.Four, Suit.Clubs)] },
    })
    const next = playModifyHouse(state, 'player', card(Face.Three, Suit.Clubs), 'h1')
    const house = next.floor.find(isHouse)!
    expect(house.captureValue).toBe(12)
    expect(house.cemented).toBe(false)
  })

  it('breaks an uncemented house up to a new value the player can still capture', () => {
    const state = makeState({
      floor: [{ kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts)], captureValue: 9, cemented: false, owners: ['opponent'] }],
      hands: { player: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], opponent: [] },
    })
    const next = playModifyHouse(state, 'player', card(Face.Three, Suit.Clubs), 'h1')
    const house = next.floor.find(isHouse)!
    expect(house.captureValue).toBe(12)
    expect(house.owners).toContain('player')
  })

  it('refuses to break a cemented house', () => {
    const state = makeState({
      floor: [{ kind: 'house', id: 'h1', cards: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], captureValue: 9, cemented: true, owners: ['opponent'] }],
      hands: { player: [card(Face.Three, Suit.Clubs), card(Face.Queen, Suit.Spades)], opponent: [] },
    })
    expect(() => playModifyHouse(state, 'player', card(Face.Three, Suit.Clubs), 'h1')).toThrow()
  })
})

describe('playThrow', () => {
  it('refuses to throw a card that could capture something', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: { player: [card(Face.Seven, Suit.Clubs)], opponent: [] },
    })
    expect(() => playThrow(state, 'player', card(Face.Seven, Suit.Clubs))).toThrow()
  })

  it('allows throwing a card with no legal capture', () => {
    const state = makeState({
      floor: [{ kind: 'loose', id: 'f1', card: card(Face.Seven, Suit.Diamonds) }],
      hands: {
        player: [card(Face.Two, Suit.Clubs), card(Face.Three, Suit.Hearts)],
        opponent: [card(Face.Four, Suit.Spades)],
      },
    })
    const next = playThrow(state, 'player', card(Face.Two, Suit.Clubs))
    expect(next.floor).toHaveLength(2)
  })
})

describe('hand-over scoring', () => {
  it('zeroes out card points for a player under the 9-point qualifying minimum', () => {
    const state = makeState({
      floor: [],
      hands: { player: [card(Face.Two, Suit.Clubs)], opponent: [] },
      captures: { player: [card(Face.Two, Suit.Spades)], opponent: [card(Face.King, Suit.Spades)] },
      cardsPlayedThisHand: 47,
      totalPlayableThisHand: 48,
    })
    const next = playThrow(state, 'player', card(Face.Two, Suit.Clubs))
    expect(next.phase).toBe('hand-over')
    expect(next.lastHandTotals!.player.qualifyingCardPoints).toBe(0)
    expect(next.lastHandTotals!.opponent.qualifyingCardPoints).toBe(13)
  })
})
