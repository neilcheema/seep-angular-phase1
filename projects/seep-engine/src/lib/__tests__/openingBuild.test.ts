import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { type House, isHouse, isLoose } from '../floor.ts'
import { type FourPlayerGameState, playFourPlayerBuildHouse, viewForSeat } from '../fourPlayerEngine.ts'
import { type GameState, legalBids, placeBid, playBuildHouse, startMatch, viewFor } from '../gameEngine.ts'
import { buildHouseRefusal, fourPlayerBuildHouseRefusal } from '../preview.ts'
import { legalMoves } from '../moves.ts'
import { SeatId } from '../seats.ts'
import { ENGINE_VERSION } from '../version.ts'

const c = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, f: Face, s: Suit) => ({ kind: 'loose' as const, id, card: c(f, s) })
const worked = (f: () => unknown): boolean => { try { f(); return true } catch { return false } }

// The position the owner reported (7 October): the bid is 11; the floor is A, 9, 9, 8; the hand holds a 6, two 2s and the Jack to capture with.
const FLOOR = [loose('a', Face.Ace, Suit.Clubs), loose('b', Face.Nine, Suit.Diamonds), loose('c', Face.Nine, Suit.Spades), loose('d', Face.Eight, Suit.Clubs)]
const HAND = [c(Face.Six, Suit.Hearts), c(Face.Two, Suit.Clubs), c(Face.Jack, Suit.Clubs), c(Face.Two, Suit.Hearts)]
const TWO_H = c(Face.Two, Suit.Hearts)
const TWO_C = c(Face.Two, Suit.Clubs)
const WAYS: [string, string[]][] = [['the 9 of Diamonds', ['b']], ['the 9 of Spades', ['c']], ['the Ace and the Eight', ['a', 'd']]]

function two(phase: 'opening-move' | 'playing'): GameState {
  return {
    floor: FLOOR, hands: { player: HAND, opponent: [c(Face.Two, Suit.Diamonds)] }, captures: { player: [], opponent: [] }, sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 0, opponent: 0 }, bidder: 'player', turn: 'player', phase, bidValue: phase === 'opening-move' ? 11 : null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: phase === 'opening-move' ? 0 : 8, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION,
  }
}
function four(phase: 'opening-move' | 'playing'): FourPlayerGameState {
  return {
    floor: FLOOR, hands: { p1: HAND, p2: [c(Face.Two, Suit.Diamonds)], p3: [c(Face.Three, Suit.Diamonds)], p4: [c(Face.Four, Suit.Diamonds)] }, captures: { teamA: [], teamB: [] },
    sweepPoints: { teamA: 0, teamB: 0 }, matchScores: { teamA: 0, teamB: 0 }, dealer: SeatId.P4, bidder: SeatId.P1, turn: SeatId.P1, phase, bidValue: phase === 'opening-move' ? 11 : null,
    pendingDeal: null, lastCapturer: null, cardsPlayedThisHand: phase === 'opening-move' ? 0 : 8, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null,
    misdeals: 0, engineVersion: ENGINE_VERSION,
  }
}

describe('the opening move: any ONE combination that makes the bid house is allowed, with nothing left out (two-player)', () => {
  for (const card of [TWO_H, TWO_C]) {
    for (const [label, ids] of WAYS) {
      it(`a ${card.face} of ${card.suit} with ${label} builds the house of 11`, () => {
        const after = playBuildHouse(two('opening-move'), 'player', card, ids, 11)
        const houses = after.floor.filter(isHouse) as House[]
        expect(houses).toHaveLength(1)
        expect(houses[0]!.captureValue).toBe(11)
        expect(after.hands.player.some((x) => x.face === Face.Jack)).toBe(true) // the Jack is kept to capture it with
        expect(after.floor.filter(isLoose).length).toBe(FLOOR.length - ids.length) // the cards not used stay on the floor
      })
    }
  }
  it('but nothing may be left out: 4+9=13 alone is refused when two loose Kings could also join, and taking all of them is allowed', () => {
    const s: GameState = { ...two('opening-move'), bidValue: 13, floor: [loose('f1', Face.Nine, Suit.Clubs), loose('f2', Face.King, Suit.Hearts), loose('f3', Face.King, Suit.Spades)], hands: { player: [c(Face.Four, Suit.Spades), c(Face.King, Suit.Diamonds)], opponent: [c(Face.Two, Suit.Diamonds)] } }
    expect(() => playBuildHouse(s, 'player', c(Face.Four, Suit.Spades), ['f1'], 13)).toThrow(/pull in every matching group/)
    expect(() => playBuildHouse(s, 'player', c(Face.Four, Suit.Spades), ['f1', 'f2', 'f3'], 13)).not.toThrow() // 4+9+13+13 = 39, three sets, cemented
  })
  it('two separate groups on the floor: each may be made with any ONE of its combinations, but both groups must be taken', () => {
    // bid 11; a 2 makes 11 with either 9, and a 5 and a 6 make 11 on their own
    const s: GameState = { ...two('opening-move'), floor: [loose('b', Face.Nine, Suit.Diamonds), loose('c', Face.Nine, Suit.Spades), loose('e', Face.Five, Suit.Clubs), loose('g', Face.Six, Suit.Hearts)] }
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b', 'e', 'g'], 11)).not.toThrow() // the 9 of Diamonds, plus the 5 and 6
    expect(() => playBuildHouse(s, 'player', TWO_H, ['c', 'e', 'g'], 11)).not.toThrow() // or the 9 of Spades, plus the 5 and 6
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b'], 11)).toThrow(/pull in every matching group/) // the 5 and 6 would be left out
    expect(() => playBuildHouse(s, 'player', TWO_H, ['c'], 11)).toThrow(/pull in every matching group/)
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b', 'c'], 11)).toThrow() // 2+9+9 is not whole sets of 11
  })
  it('everything else about the opening build is still enforced', () => {
    const s = two('opening-move')
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b'], 10)).toThrow() // the house must be for the bid
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b', 'c'], 11)).toThrow() // 2+9+9 = 20 is not whole sets of 11
    const noReserve: GameState = { ...s, hands: { player: [TWO_H, c(Face.Six, Suit.Hearts)], opponent: [c(Face.Two, Suit.Diamonds)] } }
    expect(() => playBuildHouse(noReserve, 'player', TWO_H, ['b'], 11)).toThrow() // no card left to capture it with
    const notSets: GameState = { ...s, bidValue: 9, floor: [loose('e', Face.Eight, Suit.Clubs)], hands: { player: [c(Face.Ten, Suit.Hearts), c(Face.Nine, Suit.Hearts)], opponent: [c(Face.Two, Suit.Diamonds)] } }
    expect(() => playBuildHouse(notSets, 'player', c(Face.Ten, Suit.Hearts), ['e'], 9)).toThrow(/cannot be split into sets/) // 10 + 8 are not whole sets of 9
  })
})

describe('from the second play on the rule is unchanged: every matching group must be pulled in', () => {
  it('the same position in an ordinary turn still refuses the alternatives the engine does not pick', () => {
    const s = two('playing')
    expect(() => playBuildHouse(s, 'player', TWO_H, ['c'], 11)).toThrow(/pull in every matching group/)
    expect(() => playBuildHouse(s, 'player', TWO_H, ['a', 'd'], 11)).toThrow(/pull in every matching group/)
    expect(() => playBuildHouse(s, 'player', TWO_H, ['b'], 11)).not.toThrow()
  })
})

describe('the opening move: any ONE combination, nothing left out (four-player)', () => {
  for (const [label, ids] of WAYS) {
    it(`a 2 of Hearts with ${label} builds the house of 11`, () => {
      expect(() => playFourPlayerBuildHouse(four('opening-move'), SeatId.P1, TWO_H, ids, 11)).not.toThrow()
    })
  }
  it('and nothing may be left out there either', () => {
    const f = [loose('b', Face.Nine, Suit.Diamonds), loose('c', Face.Nine, Suit.Spades), loose('e', Face.Five, Suit.Clubs), loose('g', Face.Six, Suit.Hearts)]
    const s = { ...four('opening-move'), floor: f }
    expect(() => playFourPlayerBuildHouse(s, SeatId.P1, TWO_H, ['c', 'e', 'g'], 11)).not.toThrow()
    expect(() => playFourPlayerBuildHouse(s, SeatId.P1, TWO_H, ['c'], 11)).toThrow(/pull in every matching group/)
  })
  it('and from the second play on it is unchanged', () => {
    const s = four('playing')
    expect(() => playFourPlayerBuildHouse(s, SeatId.P1, TWO_H, ['c'], 11)).toThrow(/pull in every matching group/)
    expect(() => playFourPlayerBuildHouse(s, SeatId.P1, TWO_H, ['b'], 11)).not.toThrow()
  })
})

describe('the screens ask the same question (the helpers agree with the engine on the reported position)', () => {
  it('two-player and four-player', () => {
    for (const [, ids] of WAYS) {
      expect(buildHouseRefusal(viewFor(two('opening-move'), 'player'), TWO_H, ids, 11)).toBeNull()
      expect(fourPlayerBuildHouseRefusal(viewForSeat(four('opening-move'), SeatId.P1), TWO_H, ids, 11)).toBeNull()
    }
    expect(buildHouseRefusal(viewFor(two('playing'), 'player'), TWO_H, ['c'], 11)).toMatch(/pull in every matching group/)
    const left = { ...two('opening-move'), floor: [loose('b', Face.Nine, Suit.Diamonds), loose('c', Face.Nine, Suit.Spades), loose('e', Face.Five, Suit.Clubs), loose('g', Face.Six, Suit.Hearts)] }
    expect(buildHouseRefusal(viewFor(left, 'player'), TWO_H, ['c'], 11)).toMatch(/pull in every matching group/)
  })
})

describe('the move lister offers every opening build the engine accepts', () => {
  it('lists exactly the builds the engine accepts, over many real opening positions', () => {
    let positions = 0
    let builds = 0
    let alternatives = 0
    for (let seed = 1; seed <= 70; seed++) {
      const start = startMatch('player', 3000 + seed)
      for (const bid of legalBids(start)) {
        const s = placeBid(start, 'player', bid)
        if (s.phase !== 'opening-move') continue
        positions++
        const looseItems = s.floor.filter(isLoose)
        const accepted = new Set<string>()
        for (const card of s.hands.player) {
          for (let mask = 0; mask < 1 << looseItems.length; mask++) {
            const ids = looseItems.filter((_, i) => mask & (1 << i)).map((i) => i.id)
            if (worked(() => playBuildHouse(s, 'player', card, ids, bid))) accepted.add(`${card.face}${card.suit}|${[...ids].sort().join(',')}`)
          }
        }
        const listed = new Set(
          legalMoves(s, 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'build').map((m) => (m.type === 'build' ? `${m.card.face}${m.card.suit}|${[...m.looseItemIds].sort().join(',')}` : '')),
        )
        expect([...listed].sort()).toEqual([...accepted].sort())
        builds += accepted.size
        const perCard = new Map<string, number>()
        for (const k of accepted) perCard.set(k.split('|')[0]!, (perCard.get(k.split('|')[0]!) ?? 0) + 1)
        if ([...perCard.values()].some((n) => n > 1)) alternatives++
      }
    }
    expect(positions).toBeGreaterThan(100)
    expect(builds).toBeGreaterThan(50)
    expect(alternatives).toBeGreaterThan(5) // positions with several ways to build with one card were among them
  }, 120_000)
})
