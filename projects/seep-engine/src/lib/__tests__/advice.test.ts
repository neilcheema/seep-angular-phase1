import { describe, expect, it } from 'vitest'
import { ADVICE_WEIGHTS, NO_DANGER, adviseBids, adviseMoves, moveFacts, rankMoves, scoreFacts, standInState, type MoveFacts } from '../advice.ts'
import { Face, Suit, type Card, captureValue } from '../card.ts'
import { chooseComputerBid, chooseComputerMove, chooseComputerOpeningMove } from '../computer.ts'
import type { FloorItem, House } from '../floor.ts'
import { type GameState, type Intent, applyMove, dealNextHand, legalBids, placeBid, startMatch, viewFor } from '../gameEngine.ts'
import { legalMoves } from '../moves.ts'
import { ENGINE_VERSION } from '../version.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number): House => ({ kind: 'house', id, cards: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], captureValue: value, cemented: false, owners: ['player'] })
function makeState(over: Partial<GameState>): GameState {
  return {
    floor: [], hands: { player: [], opponent: [card(Face.Two, Suit.Diamonds), card(Face.Three, Suit.Diamonds)] },
    captures: { player: [], opponent: [] }, sweepPoints: { player: 0, opponent: 0 }, matchScores: { player: 0, opponent: 0 },
    bidder: 'player', turn: 'player', phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0,
    engineVersion: ENGINE_VERSION, ...over,
  }
}
const cardKey = (c: Card) => `${c.face}-${c.suit}`
function keyOf(i: Intent): string {
  const ids = (xs: string[] | undefined) => [...(xs ?? [])].sort().join(',')
  switch (i.type) {
    case 'throw': return `throw|${cardKey(i.card)}`
    case 'capture': return `capture|${cardKey(i.card)}|${ids(i.targetItemIds)}`
    case 'build': return `build|${cardKey(i.card)}|${ids(i.looseItemIds)}|${i.targetValue}`
    case 'modify': return `modify|${cardKey(i.card)}|${i.houseId}|${ids(i.extraLooseItemIds)}`
    case 'bid': return `bid|${i.value}`
  }
}
function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Plays whole games (the computer as 'opponent', random legal moves for the human) and hands the test every position where the human is to act. */
function forEachHumanTurn(games: number, visit: (s: GameState, step: string) => void): number {
  let visited = 0
  for (let g = 0; g < games; g++) {
    const rand = mulberry32(31000 + g)
    let s = startMatch(g % 2 === 0 ? 'player' : 'opponent', 5000 + g)
    for (let step = 0; step < 400 && s.phase !== 'match-over'; step++) {
      if (s.phase === 'hand-over') { if (g % 3 === 0) break; s = dealNextHand(s, 8000 + g); continue }
      if (s.phase === 'bidding') {
        if (s.bidder === 'player') { visit(s, 'bidding'); visited++ }
        s = placeBid(s, s.bidder, s.bidder === 'opponent' ? chooseComputerBid(s) : legalBids(s)[0]!)
        continue
      }
      if (s.turn === 'player') {
        visit(s, s.phase); visited++
        const moves = legalMoves(s, 'player', { maxLooseCards: 99 })
        s = applyMove(s, 'player', moves[Math.floor(rand() * moves.length)]!)
      } else {
        const action = s.phase === 'opening-move' ? chooseComputerOpeningMove(s) : chooseComputerMove(s)
        const { reason, ...intent } = action
        void reason
        s = applyMove(s, 'opponent', intent as Intent)
      }
    }
  }
  return visited
}

describe('the stand-in state (what the advisor simulates on) is faithful to the real one', () => {
  it('lists exactly the same legal moves and bids as the real state, at every human turn of 60 simulated games', () => {
    let compared = 0
    const turns = forEachHumanTurn(60, (s, step) => {
      const stand = standInState(viewFor(s, 'player'))
      if (step === 'bidding') {
        expect(legalBids(stand)).toEqual(legalBids(s))
      } else {
        const real = legalMoves(s, 'player', { maxLooseCards: 99 }).map(keyOf).sort()
        expect(legalMoves(stand, 'player', { maxLooseCards: 99 }).map(keyOf).sort(), `${step}`).toEqual(real)
        compared++
      }
    })
    expect(turns).toBeGreaterThan(400)
    expect(compared).toBeGreaterThan(350)
  }, 180_000)

  it('plays every move to the same visible result as the real state: the floor, the captures, the sweep bonus', () => {
    let moves = 0
    forEachHumanTurn(25, (s, step) => {
      if (step === 'bidding') return
      const stand = standInState(viewFor(s, 'player'))
      for (const intent of legalMoves(s, 'player', { maxLooseCards: 3 })) {
        const real = applyMove(s, 'player', intent)
        const sim = applyMove(stand, 'player', intent)
        expect(sim.floor.map((i) => (i.kind === 'house' ? `H${i.captureValue}${i.cemented}` : cardKey(i.card))).sort()).toEqual(real.floor.map((i) => (i.kind === 'house' ? `H${i.captureValue}${i.cemented}` : cardKey(i.card))).sort())
        expect(sim.sweepPoints.player).toBe(real.sweepPoints.player)
        expect(sim.captures.player.length).toBe(real.captures.player.length)
        expect(sim.phase).toBe(real.phase)
        moves++
      }
    })
    expect(moves).toBeGreaterThan(1500)
  }, 180_000)

  it('does not depend on the opponent’s hidden cards: only their number is used', () => {
    const base = makeState({ floor: [loose('a', Face.Six, Suit.Hearts)], hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Nine, Suit.Spades)], opponent: [card(Face.Ace, Suit.Spades), card(Face.King, Suit.Hearts)] } })
    const swapped = { ...base, hands: { ...base.hands, opponent: [card(Face.Ten, Suit.Diamonds), card(Face.Queen, Suit.Clubs)] }, pendingDeal: { player: [card(Face.Two, Suit.Hearts)], opponent: [card(Face.Three, Suit.Hearts)] } }
    expect(adviseMoves(viewFor(swapped, 'player'))).toEqual(adviseMoves(viewFor(base, 'player')))
    expect(JSON.stringify(standInState(viewFor(base, 'player')))).not.toContain('Ace')
  })
})

describe('the facts are what the engine really does', () => {
  it('a capture’s points, cards and sweep bonus', () => {
    // Capture the loose Nine of Spades with a Nine of Hearts, and the floor is cleared: a sweep, 9 points of spade.
    const state = makeState({ floor: [loose('a', Face.Nine, Suit.Spades)], hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const facts = moveFacts(viewFor(state, 'player'), state, { type: 'capture', card: card(Face.Nine, Suit.Hearts), targetItemIds: ['a'] }) as Extract<MoveFacts, { kind: 'capture' }>
    expect(facts.points).toBe(9)
    expect(facts.sweepBonus).toBe(50)
    expect(facts.clearsFloor).toBe(true)
    expect(facts.takesHouse).toBe(false)
    expect(facts.scoringCards).toEqual([card(Face.Nine, Suit.Spades)])
  })

  it('there is no sweep bonus for the last card of the hand, but the floor still counts as cleared', () => {
    const state = makeState({ floor: [loose('a', Face.Six, Suit.Hearts)], hands: { player: [card(Face.Six, Suit.Clubs)], opponent: [] }, cardsPlayedThisHand: 47, totalPlayableThisHand: 48 })
    const facts = moveFacts(viewFor(state, 'player'), state, { type: 'capture', card: card(Face.Six, Suit.Clubs), targetItemIds: ['a'] }) as Extract<MoveFacts, { kind: 'capture' }>
    expect(facts.clearsFloor).toBe(true)
    expect(facts.sweepBonus).toBe(0)
  })

  it('counts the cards you cannot see exactly: not in your hand, on the floor, or in either pile', () => {
    // I hold two Nines, one Nine is on the floor, one is in the opponent's pile: nothing is unseen.
    const state = makeState({
      floor: [loose('a', Face.Nine, Suit.Clubs), loose('b', Face.Four, Suit.Spades), loose('c', Face.Five, Suit.Spades)],
      hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Diamonds), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] },
      captures: { player: [], opponent: [card(Face.Nine, Suit.Spades)] },
    })
    const view = viewFor(state, 'player')
    const build = moveFacts(view, standInState(view), { type: 'build', card: card(Face.Nine, Suit.Hearts), looseItemIds: ['a', 'b', 'c'], targetValue: 9 }) as Extract<MoveFacts, { kind: 'build' }>
    expect(build.unseenCopies).toBe(0)
    expect(build.cemented).toBe(true) // 9 + 9 + 4 + 5 = 27: three sets of nine at once, and the engine insists the loose Nine is pulled in too
    expect(build.copiesInHand).toBe(1) // the other Nine (the played one is in the house)
    expect(build.pointsInHouse).toBe(9) // the Nine of Hearts scores nothing; the Four and Five of Spades score 4 + 5
  })

  it('counts the points of the card you PLAY as well as the ones you take', () => {
    const state = makeState({ floor: [loose('a', Face.Five, Suit.Hearts)], hands: { player: [card(Face.Five, Suit.Spades), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const facts = moveFacts(viewFor(state, 'player'), state, { type: 'capture', card: card(Face.Five, Suit.Spades), targetItemIds: ['a'] }) as Extract<MoveFacts, { kind: 'capture' }>
    expect(facts.points).toBe(5) // the Five of Hearts scores nothing; the Five of Spades you play scores 5
    expect(facts.scoringCards).toEqual([card(Face.Five, Suit.Spades)])
  })

  it('takes the cards inside a house when a house is captured, and counts them as seen', () => {
    // A house of 9 made of a Four and a Five of Clubs sits on the floor.
    const state = makeState({ floor: [house('h', 9), loose('a', Face.Two, Suit.Spades)], hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Four, Suit.Spades)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const view = viewFor(state, 'player')
    const capture = moveFacts(view, standInState(view), { type: 'capture', card: card(Face.Nine, Suit.Hearts), targetItemIds: ['h'] }) as Extract<MoveFacts, { kind: 'capture' }>
    expect(capture.takesHouse).toBe(true)
    expect(capture.taken).toHaveLength(2)
    // Fours: I hold the Four of Spades and the Four of Clubs is inside the house, so two of the four Fours are unseen.
    const thrown = moveFacts(view, standInState(view), { type: 'throw', card: card(Face.Four, Suit.Spades) }) as Extract<MoveFacts, { kind: 'throw' }>
    expect(thrown.unseenCopies).toBe(2)
  })

  it('tells cementing a house from breaking it up', () => {
    const floor = [house('h', 9), loose('a', Face.Two, Suit.Spades)]
    const cement = viewFor(makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } }), 'player')
    const c = moveFacts(cement, standInState(cement), { type: 'modify', card: card(Face.Nine, Suit.Hearts), houseId: 'h', extraLooseItemIds: [] }) as Extract<MoveFacts, { kind: 'modify' }>
    expect([c.mode, c.fromValue, c.toValue]).toEqual(['cement', 9, 9])
    const breaking = viewFor(makeState({ floor, hands: { player: [card(Face.Two, Suit.Hearts), card(Face.Jack, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } }), 'player')
    const b = moveFacts(breaking, standInState(breaking), { type: 'modify', card: card(Face.Two, Suit.Hearts), houseId: 'h', extraLooseItemIds: [] }) as Extract<MoveFacts, { kind: 'modify' }>
    expect([b.mode, b.fromValue, b.toValue, b.copiesInHand]).toEqual(['break', 9, 11, 1])
  })

  it('a throw’s points and its unseen matches', () => {
    const state = makeState({ floor: [loose('a', Face.Two, Suit.Clubs)], hands: { player: [card(Face.Queen, Suit.Spades), card(Face.King, Suit.Hearts)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const facts = moveFacts(viewFor(state, 'player'), state, { type: 'throw', card: card(Face.Queen, Suit.Spades) }) as Extract<MoveFacts, { kind: 'throw' }>
    expect(facts.points).toBe(12)
    expect(facts.unseenCopies).toBe(3) // I hold the Queen of Spades; the other three Queens are nowhere I can see
  })
})

describe('the ranking', () => {
  it('puts the capture that wins more points first', () => {
    const state = makeState({ floor: [loose('a', Face.Nine, Suit.Spades), loose('b', Face.Six, Suit.Hearts), loose('c', Face.King, Suit.Diamonds)], hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const top = adviseMoves(viewFor(state, 'player'))
    expect(keyOf(top[0]!.intent)).toBe('capture|Nine-Hearts|a')
    expect(keyOf(top[1]!.intent)).toBe('capture|Six-Clubs|b')
  })

  it('puts a sweep first', () => {
    const state = makeState({ floor: [loose('a', Face.Six, Suit.Hearts)], hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Queen, Suit.Hearts)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const [best] = adviseMoves(viewFor(state, 'player'))
    expect(keyOf(best!.intent)).toBe('capture|Six-Clubs|a')
    expect((best!.facts as Extract<MoveFacts, { kind: 'capture' }>).sweepBonus).toBe(50)
  })

  it('throws away the card worth nothing before a spade', () => {
    const state = makeState({ floor: [loose('a', Face.King, Suit.Diamonds)], hands: { player: [card(Face.Ten, Suit.Spades), card(Face.Three, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const order = rankMoves(viewFor(state, 'player')).filter((a) => a.facts.kind === 'throw').map((a) => keyOf(a.intent))
    expect(order.indexOf('throw|Three-Hearts')).toBeLessThan(order.indexOf('throw|Ten-Spades'))
    expect(order.indexOf('throw|Two-Clubs')).toBeLessThan(order.indexOf('throw|Ten-Spades'))
  })

  it('likes a build more when the opponent cannot have a card to capture it with, and when it risks fewer points', () => {
    const safe: MoveFacts = { kind: 'build', card: card(Face.Nine, Suit.Hearts), targetValue: 9, looseCards: [], cemented: false, copiesInHand: 1, unseenCopies: 0, pointsInHouse: 9, danger: NO_DANGER }
    expect(scoreFacts(safe)).toBeGreaterThan(scoreFacts({ ...safe, unseenCopies: 3 }))
    expect(scoreFacts({ ...safe, unseenCopies: 3, pointsInHouse: 0 })).toBeGreaterThan(scoreFacts({ ...safe, unseenCopies: 3, pointsInHouse: 9 }))
  })

  it('always ranks any capture above any build or throw (the weights guarantee it)', () => {
    const lowestCapture = ADVICE_WEIGHTS.captureBase + ADVICE_WEIGHTS.perCardCaptured * 2 - ADVICE_WEIGHTS.maxCaptureMarkdown // even a capture that leaves the opponent something to take
    expect(lowestCapture).toBeGreaterThan(ADVICE_WEIGHTS.buildBase + ADVICE_WEIGHTS.buildCemented)
    expect(lowestCapture).toBeGreaterThan(ADVICE_WEIGHTS.modifyBase + ADVICE_WEIGHTS.buildCemented)
    expect(lowestCapture).toBeGreaterThan(ADVICE_WEIGHTS.throwBase)
    forEachHumanTurn(30, (s, step) => {
      if (step === 'bidding') return
      const ranked = rankMoves(viewFor(s, 'player'))
      if (ranked.some((a) => a.facts.kind === 'capture')) expect(ranked[0]!.facts.kind).toBe('capture')
    })
  }, 120_000)

  it('returns at most the number asked for, with no repeats, best first, and every one is a legal move', () => {
    let checked = 0
    forEachHumanTurn(40, (s, step) => {
      if (step === 'bidding') return
      const view = viewFor(s, 'player')
      const legal = new Set(legalMoves(s, 'player', { maxLooseCards: 99 }).map(keyOf))
      for (const count of [1, 2, 3]) {
        const advice = adviseMoves(view, { count })
        expect(advice.length).toBeLessThanOrEqual(count)
        expect(advice.length).toBeGreaterThan(0)
        expect(new Set(advice.map((a) => keyOf(a.intent))).size).toBe(advice.length)
        for (let i = 1; i < advice.length; i++) expect(advice[i - 1]!.score).toBeGreaterThanOrEqual(advice[i]!.score)
        for (const a of advice) expect(legal.has(keyOf(a.intent))).toBe(true)
      }
      checked++
    })
    expect(checked).toBeGreaterThan(300)
  }, 180_000)

  it('does not recommend throwing away a card that could capture (the opening move), and says it could have', () => {
    // Bid 12 with the Queen: it can take the Jack and Ace of Spades (12 points). Throwing it would leave those for the opponent.
    const state = makeState({
      phase: 'opening-move', bidValue: 12,
      floor: [loose('a', Face.Six, Suit.Diamonds), loose('b', Face.Three, Suit.Clubs), loose('c', Face.Jack, Suit.Spades), loose('d', Face.Ace, Suit.Spades)],
      hands: { player: [card(Face.Queen, Suit.Clubs), card(Face.Six, Suit.Clubs), card(Face.Six, Suit.Spades), card(Face.Seven, Suit.Spades)], opponent: [card(Face.Two, Suit.Diamonds)] },
    })
    const ranked = rankMoves(viewFor(state, 'player'))
    const keys = ranked.map((a) => keyOf(a.intent))
    expect(keys[0]).toBe('capture|Queen-Clubs|c,d')
    const thrown = ranked.find((a) => a.intent.type === 'throw')!
    expect((thrown.facts as Extract<MoveFacts, { kind: 'throw' }>).couldHaveCaptured).toBe(true)
    expect(keys.indexOf('throw|Queen-Clubs')).toBe(keys.length - 1) // the throw is the worst of the opening moves
  })

  it('never offers two suggestions that amount to the same advice (two zero-point sixes are one throw)', () => {
    const state = makeState({ floor: [loose('a', Face.King, Suit.Diamonds)], hands: { player: [card(Face.Six, Suit.Clubs), card(Face.Six, Suit.Hearts), card(Face.Three, Suit.Clubs), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const keys = adviseMoves(viewFor(state, 'player')).map((a) => keyOf(a.intent))
    expect(keys).toHaveLength(3)
    expect(keys.filter((k) => k.startsWith('throw|Six'))).toHaveLength(1)
    expect(keys.filter((k) => k.startsWith('throw'))).toHaveLength(3)
  })

  it('merges captures that differ only by an interchangeable card, but keeps the one that scores', () => {
    // Three Sevens can each take the Seven of Hearts. The Seven of Spades scores 7; the other two are worth nothing and are the same advice.
    const state = makeState({ floor: [loose('a', Face.Seven, Suit.Hearts), loose('b', Face.King, Suit.Diamonds)], hands: { player: [card(Face.Seven, Suit.Spades), card(Face.Seven, Suit.Diamonds), card(Face.Seven, Suit.Clubs), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    const keys = adviseMoves(viewFor(state, 'player'), { count: 5 }).map((a) => keyOf(a.intent))
    expect(keys.filter((k) => k.startsWith('capture'))).toEqual(['capture|Seven-Spades|a', 'capture|Seven-Diamonds|a'])
    expect(keys.some((k) => k.includes('Seven-Clubs|a'))).toBe(false)
  })

  it('stays quick with a full 24-card hand on a crowded floor (the first time a real game revealed hands this big)', () => {
    const faces = Object.values(Face)
    const suits = Object.values(Suit)
    const deck = suits.flatMap((su) => faces.map((f) => card(f, su)))
    const floor: FloorItem[] = deck.slice(24, 34).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
    floor.push(house('H1', 10))
    const state = makeState({ floor, hands: { player: deck.slice(0, 24), opponent: Array.from({ length: 20 }, () => card(Face.Two, Suit.Diamonds)) } })
    const started = Date.now()
    const advice = adviseMoves(viewFor(state, 'player'), { budgetMs: 100 })
    expect(Date.now() - started).toBeLessThan(2500) // generous for a slow machine; it takes well under a second here
    expect(advice).toHaveLength(3)
  })

  it('gives three suggestions when no number is asked for', () => {
    const hand = [card(Face.Ace, Suit.Hearts), card(Face.Two, Suit.Clubs), card(Face.Three, Suit.Hearts), card(Face.Four, Suit.Clubs), card(Face.Six, Suit.Hearts)]
    const view = viewFor(makeState({ floor: [loose('a', Face.King, Suit.Diamonds)], hands: { player: hand, opponent: [card(Face.Two, Suit.Diamonds)] } }), 'player')
    expect(rankMoves(view).length).toBeGreaterThan(3)
    expect(adviseMoves(view)).toHaveLength(3)
  })

  it('gives nothing when it is not the viewer’s turn, or the game is in another phase', () => {
    const base = makeState({ hands: { player: [card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(adviseMoves(viewFor({ ...base, turn: 'opponent' }, 'player'))).toEqual([])
    expect(adviseMoves(viewFor({ ...base, phase: 'bidding' }, 'player'))).toEqual([])
    expect(adviseMoves(viewFor({ ...base, phase: 'hand-over' }, 'player'))).toEqual([])
    expect(adviseMoves(viewFor({ ...base, phase: 'match-over' }, 'player'))).toEqual([])
  })
})

describe('advice on a bid', () => {
  it('offers only bids the player can make, best first, with what the opening would be', () => {
    let seen = 0
    forEachHumanTurn(60, (s, step) => {
      if (step !== 'bidding') return
      const view = viewFor(s, 'player')
      const bids = adviseBids(view, { count: 5 })
      const legal = legalBids(s)
      expect(bids.length).toBe(Math.min(5, legal.length))
      for (const b of bids) {
        expect(legal).toContain(b.value)
        expect(b.copiesInHand).toBe(s.hands.player.filter((c) => captureValue(c) === b.value).length)
        expect(b.copiesInHand).toBeGreaterThan(0) // a bid is only possible for a value the bidder holds
        expect(b.openingMoves).toBeGreaterThan(0)
        expect(b.bestOpening).not.toBeNull()
      }
      for (let i = 1; i < bids.length; i++) expect(bids[i - 1]!.score).toBeGreaterThanOrEqual(bids[i]!.score)
      seen++
    })
    expect(seen).toBeGreaterThan(10)
  }, 120_000)

  it('is empty unless the viewer is the bidder and it is the bidding phase', () => {
    const s = startMatch('opponent', 42)
    expect(adviseBids(viewFor(s, 'player'))).toEqual([])
    const mine = startMatch('player', 42)
    expect(adviseBids(viewFor(mine, 'player')).length).toBeGreaterThan(0)
    expect(adviseBids(viewFor({ ...mine, phase: 'playing' }, 'player'))).toEqual([])
  })
})
