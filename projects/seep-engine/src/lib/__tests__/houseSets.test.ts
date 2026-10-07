import { describe, expect, it } from 'vitest'
import { adviseBids, adviseMoves } from '../advice.ts'
import { Face, Suit, type Card, captureValue } from '../card.ts'
import { type FloorItem, type House, canSplitIntoSets } from '../floor.ts'
import { type FourPlayerGameState, playFourPlayerBuildHouse, playFourPlayerModifyHouse } from '../fourPlayerEngine.ts'
import { type GameState, applyMove, playBuildHouse, playModifyHouse, viewFor } from '../gameEngine.ts'
import { legalMoves } from '../moves.ts'
import { SeatId } from '../seats.ts'
import { ENGINE_VERSION } from '../version.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number, cemented = false): House => ({ kind: 'house', id, cards: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], captureValue: value, cemented, owners: ['player'] })
function makeState(over: Partial<GameState>): GameState {
  return {
    floor: [], hands: { player: [], opponent: [card(Face.Two, Suit.Diamonds), card(Face.Three, Suit.Diamonds)] },
    captures: { player: [], opponent: [] }, sweepPoints: { player: 0, opponent: 0 }, matchScores: { player: 0, opponent: 0 },
    bidder: 'player', turn: 'player', phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0,
    engineVersion: ENGINE_VERSION, ...over,
  }
}
function makeState4(over: Partial<FourPlayerGameState>): FourPlayerGameState {
  return {
    floor: [], hands: { p1: [], p2: [], p3: [], p4: [] }, captures: { teamA: [], teamB: [] }, sweepPoints: { teamA: 0, teamB: 0 }, matchScores: { teamA: 0, teamB: 0 },
    dealer: SeatId.P4, bidder: SeatId.P1, turn: SeatId.P1, phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 0, log: [], winner: null, lastHandTotals: null, misdeals: 0,
    engineVersion: ENGINE_VERSION, ...over,
  }
}

/** A deliberately different way to answer the same question, so the real one cannot share a mistake with its test: put each card in a block, and see whether some arrangement leaves every block at exactly the target. */
function naiveSplit(values: number[], target: number): boolean {
  const blocks: number[] = []
  const go = (i: number): boolean => {
    if (i === values.length) return blocks.every((b) => b === target)
    for (let b = 0; b < blocks.length; b++) {
      if (blocks[b]! + values[i]! > target) continue
      blocks[b]! += values[i]!
      if (go(i + 1)) return true
      blocks[b]! -= values[i]!
    }
    blocks.push(values[i]!)
    const ok = go(i + 1)
    blocks.pop()
    return ok
  }
  return values.length > 0 && go(0)
}
function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('canSplitIntoSets', () => {
  it('knows which cards make whole sets and which only add up', () => {
    expect(canSplitIntoSets([9], 9)).toBe(true)
    expect(canSplitIntoSets([4, 5], 9)).toBe(true)
    expect(canSplitIntoSets([9, 4, 5, 3, 6], 9)).toBe(true) // three sets
    expect(canSplitIntoSets([6, 3, 5, 4], 9)).toBe(true)
    expect(canSplitIntoSets([11, 12, 13], 9)).toBe(false) // 36, but not one set of 9 in it
    expect(canSplitIntoSets([10, 8], 9)).toBe(false) // 18
    expect(canSplitIntoSets([7, 7, 4], 9)).toBe(false) // 18
    expect(canSplitIntoSets([4, 4, 4, 6], 9)).toBe(false) // 18 again
    expect(canSplitIntoSets([13, 13], 13)).toBe(true) // two Kings: two sets of 13
    expect(canSplitIntoSets([10, 3, 13], 13)).toBe(true)
    expect(canSplitIntoSets([], 9)).toBe(false)
    expect(canSplitIntoSets([4, 4], 9)).toBe(false) // not even a multiple
  })

  it('agrees with an independent search on thousands of random hands of cards', () => {
    const rand = mulberry32(2026)
    let yes = 0
    let evenButNo = 0
    for (let n = 0; n < 4000; n++) {
      const count = 1 + Math.floor(rand() * 7)
      const values = Array.from({ length: count }, () => 1 + Math.floor(rand() * 13))
      const target = 9 + Math.floor(rand() * 5)
      const expected = naiveSplit(values, target)
      expect(canSplitIntoSets(values, target), `${values} into sets of ${target}`).toBe(expected)
      if (expected) yes++
      else if (values.reduce((t, v) => t + v, 0) % target === 0) evenButNo++
    }
    expect(yes).toBeGreaterThan(100) // the comparison met plenty of real sets,
    expect(evenButNo).toBeGreaterThan(20) // and plenty of totals that divide evenly without being sets: the case this whole rule is about
  })
})

describe('two-player: building a house needs whole sets', () => {
  it('refuses the reported move: bid 9, and Jack + Queen + King as a "house of 9"', () => {
    const state = makeState({
      phase: 'opening-move', bidValue: 9,
      floor: [loose('a', Face.Ace, Suit.Spades), loose('q', Face.Queen, Suit.Hearts), loose('k', Face.King, Suit.Clubs), loose('t', Face.Three, Suit.Hearts)],
      hands: { player: [card(Face.Jack, Suit.Clubs), card(Face.Nine, Suit.Hearts), card(Face.Eight, Suit.Clubs), card(Face.Six, Suit.Diamonds)], opponent: [card(Face.Two, Suit.Diamonds)] },
    })
    expect(() => playBuildHouse(state, 'player', card(Face.Jack, Suit.Clubs), ['q', 'k'], 9)).toThrow(/cannot be split into sets that each add up to 9/)
    expect(() => applyMove(state, 'player', { type: 'build', card: card(Face.Jack, Suit.Clubs), looseItemIds: ['q', 'k'], targetValue: 9 })).toThrow()
    // and neither the list of legal moves nor the coach ever offers it
    const offered = legalMoves(state, 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'build' && m.card.face === Face.Jack)
    expect(offered).toEqual([])
    const view = viewFor(state, 'player')
    for (const a of adviseMoves(view, { count: 50 })) expect(a.intent.type === 'build' && a.intent.card.face === Face.Jack).toBe(false)
  })

  it('the bid step of the reported game: bidding 9 no longer suggests that opening', () => {
    // The same four floor cards and the same hand, one step earlier: the player is choosing a bid.
    const bidding = makeState({
      phase: 'bidding', bidValue: null,
      floor: [loose('a', Face.Ace, Suit.Spades), loose('q', Face.Queen, Suit.Hearts), loose('k', Face.King, Suit.Clubs), loose('t', Face.Three, Suit.Hearts)],
      hands: { player: [card(Face.Jack, Suit.Clubs), card(Face.Nine, Suit.Hearts), card(Face.Eight, Suit.Clubs), card(Face.Six, Suit.Diamonds)], opponent: [card(Face.Two, Suit.Diamonds)] },
    })
    const bids = adviseBids(viewFor(bidding, 'player'), { count: 5 })
    expect(bids.map((b) => b.value)).toEqual([9, 11].filter((v) => bids.some((b) => b.value === v)))
    const nine = bids.find((b) => b.value === 9)
    expect(nine).toBeDefined()
    const opening = nine!.bestOpening
    // Whatever it now suggests, it is not the Jack-Queen-King "house of 9", and it is a move the engine really accepts.
    expect(opening && opening.intent.type === 'build' && opening.intent.card.face === Face.Jack).toBe(false)
    if (opening) expect(() => applyMove({ ...bidding, phase: 'opening-move', bidValue: 9 }, 'player', opening.intent)).not.toThrow()
  })

  it('still allows the scenario the multi-set rule was written for: bid 13, with 4 + 9 and two loose Kings folded into one cemented house', () => {
    // The original report: opening move, bid 13. Floor: a loose 9 of Clubs and two loose Kings. Hand: 4 of Spades and a King to keep. The 4 + 9 is
    // one set of 13 and each King is a set on its own: three whole sets, 39 in all.
    const state = makeState({
      phase: 'opening-move', bidValue: 13,
      floor: [loose('n', Face.Nine, Suit.Clubs), loose('k1', Face.King, Suit.Hearts), loose('k2', Face.King, Suit.Spades)],
      hands: { player: [card(Face.Four, Suit.Spades), card(Face.King, Suit.Diamonds)], opponent: [card(Face.Two, Suit.Diamonds)] },
    })
    const next = applyMove(state, 'player', { type: 'build', card: card(Face.Four, Suit.Spades), looseItemIds: ['n', 'k1', 'k2'], targetValue: 13 })
    const built = next.floor.find((i) => i.kind === 'house') as House
    expect([built.captureValue, built.cemented, built.cards.length]).toEqual([13, true, 4])
  })

  it('refuses any total that divides evenly without being whole sets: 10 + 8, and 7 + 7 + 4', () => {
    const hand = { player: [card(Face.Ten, Suit.Hearts), card(Face.Seven, Suit.Clubs), card(Face.Nine, Suit.Hearts)], opponent: [card(Face.Two, Suit.Diamonds)] }
    expect(() => playBuildHouse(makeState({ floor: [loose('e', Face.Eight, Suit.Clubs)], hands: hand }), 'player', card(Face.Ten, Suit.Hearts), ['e'], 9)).toThrow(/cannot be split into sets/)
    const floor = [loose('s', Face.Seven, Suit.Spades), loose('f', Face.Four, Suit.Spades)]
    expect(() => playBuildHouse(makeState({ floor, hands: hand }), 'player', card(Face.Seven, Suit.Clubs), ['s', 'f'], 9)).toThrow(/cannot be split into sets/)
  })

  it('still accepts every real house: a single card, two cards, and several whole sets at once', () => {
    const nines = { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] }
    const one = playBuildHouse(makeState({ floor: [], hands: nines }), 'player', card(Face.Nine, Suit.Hearts), [], 9)
    expect((one.floor[0] as House).cemented).toBe(false)
    const two = playBuildHouse(makeState({ floor: [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Hearts)], hands: nines }), 'player', card(Face.Nine, Suit.Hearts), ['a', 'b'], 9)
    expect((two.floor.find((i) => i.kind === 'house') as House).cemented).toBe(true) // 9 and 4+5: two sets
    const many = playBuildHouse(makeState({ floor: [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Hearts), loose('c', Face.Three, Suit.Clubs), loose('d', Face.Six, Suit.Diamonds)], hands: nines }), 'player', card(Face.Nine, Suit.Hearts), ['a', 'b', 'c', 'd'], 9)
    expect((many.floor.find((i) => i.kind === 'house') as House).cards).toHaveLength(5) // 9, 4+5 and 3+6: three sets
    const kings = playBuildHouse(makeState({ floor: [loose('k', Face.King, Suit.Spades)], hands: { player: [card(Face.King, Suit.Hearts), card(Face.King, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } }), 'player', card(Face.King, Suit.Hearts), ['k'], 13)
    expect((kings.floor.find((i) => i.kind === 'house') as House).captureValue).toBe(13)
  })
})

describe('two-player: adding to a house needs whole sets too', () => {
  const nineHand = { player: [card(Face.Four, Suit.Hearts), card(Face.Ten, Suit.Hearts), card(Face.Nine, Suit.Clubs), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] }
  it('cements with cards that make a whole set', () => {
    const next = playModifyHouse(makeState({ floor: [house('h', 9), loose('f', Face.Five, Suit.Spades)], hands: nineHand }), 'player', card(Face.Four, Suit.Hearts), 'h', ['f'])
    expect((next.floor.find((i) => i.kind === 'house') as House).cemented).toBe(true)
  })
  it('refuses cards that total a multiple but are not whole sets (10 + 8 onto a house of 9)', () => {
    expect(() => playModifyHouse(makeState({ floor: [house('h', 9), loose('e', Face.Eight, Suit.Clubs)], hands: nineHand }), 'player', card(Face.Ten, Suit.Hearts), 'h', ['e'])).toThrow(/cannot be split into sets that each add up to 9/)
  })
  it('still lets a house be broken up to a new value, which is a different thing', () => {
    const next = playModifyHouse(makeState({ floor: [house('h', 9)], hands: { player: [card(Face.Two, Suit.Hearts), card(Face.Jack, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } }), 'player', card(Face.Two, Suit.Hearts), 'h', [])
    expect((next.floor.find((i) => i.kind === 'house') as House).captureValue).toBe(11)
  })
})

describe('four-player: the same rules', () => {
  const nines = [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs), card(Face.Jack, Suit.Clubs), card(Face.Ten, Suit.Hearts)]
  it('refuses Jack + Queen + King as a house of 9', () => {
    const state = makeState4({ floor: [loose('q', Face.Queen, Suit.Hearts), loose('k', Face.King, Suit.Clubs)], hands: { p1: nines, p2: [], p3: [], p4: [] } })
    expect(() => playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Jack, Suit.Clubs), ['q', 'k'], 9)).toThrow(/cannot be split into sets that each add up to 9/)
  })
  it('refuses 10 + 8 as a house of 9, and accepts 9 + 4 + 5', () => {
    const state = makeState4({ floor: [loose('e', Face.Eight, Suit.Clubs), loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Hearts)], hands: { p1: nines, p2: [], p3: [], p4: [] } })
    expect(() => playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Ten, Suit.Hearts), ['e'], 9)).toThrow(/cannot be split/)
    const next = playFourPlayerBuildHouse(state, SeatId.P1, card(Face.Nine, Suit.Hearts), ['a', 'b'], 9)
    expect((next.floor.find((i) => i.kind === 'house') as House<SeatId>).cemented).toBe(true)
  })
  it('refuses to cement a house with 10 + 8, and cements it with 4 + 5', () => {
    const base = { floor: [{ kind: 'house', id: 'h', cards: [card(Face.Nine, Suit.Diamonds)], captureValue: 9, cemented: false, owners: [SeatId.P2] } as House<SeatId>, loose('e', Face.Eight, Suit.Clubs), loose('f', Face.Five, Suit.Spades)], hands: { p1: [...nines, card(Face.Four, Suit.Hearts)], p2: [], p3: [], p4: [] } }
    expect(() => playFourPlayerModifyHouse(makeState4(base), SeatId.P1, card(Face.Ten, Suit.Hearts), 'h', ['e'])).toThrow(/cannot be split into sets/)
    const ok = playFourPlayerModifyHouse(makeState4(base), SeatId.P1, card(Face.Four, Suit.Hearts), 'h', ['f'])
    expect((ok.floor.find((i) => i.kind === 'house') as House<SeatId>).cemented).toBe(true)
  })
})

describe('across random positions, every house the engine accepts is made of whole sets', () => {
  it('checks every build and every cement the engine allows, with an independent test of "whole sets"', () => {
    const rand = mulberry32(8080)
    const faces = Object.values(Face)
    const suits = Object.values(Suit)
    let builds = 0
    let cements = 0
    for (let n = 0; n < 160; n++) {
      const deck = suits.flatMap((s) => faces.map((f) => card(f, s)))
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!] }
      const hand = deck.slice(0, 8)
      const floor: FloorItem[] = deck.slice(8, 8 + 2 + Math.floor(rand() * 5)).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
      const hv = [9, 10, 11, 12, 13].sort(() => rand() - 0.5).slice(0, Math.floor(rand() * 3))
      hv.forEach((v, i) => floor.push(house(`H${i}`, v)))
      const state = makeState({ floor, hands: { player: hand, opponent: [card(Face.Two, Suit.Diamonds)] } })
      for (const m of legalMoves(state, 'player', { maxLooseCards: 99 })) {
        if (m.type === 'build') {
          const values = [captureValue(m.card), ...m.looseItemIds.map((id) => captureValue((floor.find((i) => i.id === id) as { card: Card }).card))]
          expect(naiveSplit(values, m.targetValue), `a build of ${m.targetValue} from ${values}`).toBe(true)
          builds++
        } else if (m.type === 'modify') {
          const target = floor.find((i) => i.id === m.houseId) as House
          const values = [captureValue(m.card), ...(m.extraLooseItemIds ?? []).map((id) => captureValue((floor.find((i) => i.id === id) as { card: Card }).card))]
          const after = applyMove(state, 'player', m).floor.find((i) => i.id === m.houseId) as House
          if (after.captureValue === target.captureValue) { expect(naiveSplit(values, target.captureValue), `cementing a house of ${target.captureValue} with ${values}`).toBe(true); cements++ }
        }
      }
    }
    expect(builds).toBeGreaterThan(150)
    expect(cements).toBeGreaterThan(40)
  }, 120_000)
})
