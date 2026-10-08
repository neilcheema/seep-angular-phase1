import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { chooseComputerBid, chooseComputerMove, chooseComputerOpeningMove } from '../computer.ts'
import { chooseFourPlayerBid, chooseFourPlayerMove, chooseFourPlayerOpeningMove } from '../computer4p.ts'
import { type FloorItem, type House, isHouse, isLoose } from '../floor.ts'
import { type FourPlayerGameState, applyFourPlayerMove, dealNextFourPlayerHand, placeFourPlayerBid, playFourPlayerBuildHouse, playFourPlayerModifyHouse, startFourPlayerMatch, viewForSeat } from '../fourPlayerEngine.ts'
import { type GameState, type Intent, applyMove, dealNextHand, legalBids, placeBid, playBuildHouse, playModifyHouse, startMatch, viewFor } from '../gameEngine.ts'
import { buildHouseRefusal, fourPlayerBuildHouseRefusal, fourPlayerModifyHouseRefusal, modifyHouseRefusal } from '../preview.ts'
import { legalMoves } from '../moves.ts'
import { SeatId } from '../seats.ts'
import { ENGINE_VERSION } from '../version.ts'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number, owners: ('player' | 'opponent')[] = ['player'], cemented = false): House => ({ kind: 'house', id, cards: [card(Face.Six, Suit.Clubs), card(Face.Seven, Suit.Clubs)], captureValue: value, cemented, owners })
function makeState(over: Partial<GameState>): GameState {
  return {
    floor: [], hands: { player: [], opponent: [card(Face.Two, Suit.Diamonds), card(Face.Three, Suit.Diamonds)] },
    captures: { player: [], opponent: [] }, sweepPoints: { player: 0, opponent: 0 }, matchScores: { player: 0, opponent: 0 },
    bidder: 'player', turn: 'player', phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0,
    engineVersion: ENGINE_VERSION, ...over,
  }
}
function mulberry32(seed: number): () => number {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const worked = (f: () => unknown): boolean => { try { f(); return true } catch { return false } }
const LAST_KING = 'You need another card worth 13 left in hand to cement this house.'

describe('the reported bug: a house of 13 and only ONE King in hand (two-player)', () => {
  const floor = [house('h', 13), loose('a', Face.Four, Suit.Clubs)]
  const oneKing = makeState({ floor, hands: { player: [card(Face.King, Suit.Spades), card(Face.Three, Suit.Hearts), card(Face.Five, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
  const twoKings = makeState({ floor, hands: { player: [card(Face.King, Suit.Spades), card(Face.King, Suit.Hearts), card(Face.Five, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })

  it('adding the only King is refused, with the engine’s own explanation', () => {
    expect(modifyHouseRefusal(viewFor(oneKing, 'player'), card(Face.King, Suit.Spades), 'h')).toBe(LAST_KING)
  })
  it('with a second King, adding one is allowed', () => {
    expect(modifyHouseRefusal(viewFor(twoKings, 'player'), card(Face.King, Suit.Spades), 'h')).toBeNull()
  })
  it('the same goes for a house someone else made (the rule is about what is in YOUR hand)', () => {
    const theirs = makeState({ floor: [house('h', 13, ['opponent']), loose('a', Face.Four, Suit.Clubs)], hands: oneKing.hands })
    expect(modifyHouseRefusal(viewFor(theirs, 'player'), card(Face.King, Suit.Spades), 'h')).toBe(LAST_KING)
  })
  it('and the real engine agrees: it refuses the move too', () => {
    expect(() => playModifyHouse(oneKing, 'player', card(Face.King, Suit.Spades), 'h')).toThrow(LAST_KING)
    expect(() => playModifyHouse(twoKings, 'player', card(Face.King, Suit.Spades), 'h')).not.toThrow()
  })
  it('breaking a house up needs a card worth the new value, and says so', () => {
    const s = makeState({ floor: [house('h', 9)], hands: { player: [card(Face.Two, Suit.Hearts), card(Face.Ten, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(modifyHouseRefusal(viewFor(s, 'player'), card(Face.Two, Suit.Hearts), 'h')).toBe('You need a card worth 11 left in hand to break this house up to that value.')
    const ok = makeState({ floor: [house('h', 9)], hands: { player: [card(Face.Two, Suit.Hearts), card(Face.Jack, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(modifyHouseRefusal(viewFor(ok, 'player'), card(Face.Two, Suit.Hearts), 'h')).toBeNull()
  })
  it('a cemented house cannot be broken up, and the answer says that', () => {
    const s = makeState({ floor: [house('h', 9, ['player'], true)], hands: { player: [card(Face.Two, Suit.Hearts), card(Face.Jack, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(modifyHouseRefusal(viewFor(s, 'player'), card(Face.Two, Suit.Hearts), 'h')).toBe('A cemented house cannot be broken.')
  })
})

describe('the same for building a house', () => {
  it('cards that add up to a multiple but are not whole sets are refused (10 + 8 as a house of 9)', () => {
    const s = makeState({ floor: [loose('e', Face.Eight, Suit.Clubs)], hands: { player: [card(Face.Ten, Suit.Hearts), card(Face.Nine, Suit.Hearts)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(buildHouseRefusal(viewFor(s, 'player'), card(Face.Ten, Suit.Hearts), ['e'], 9)).toMatch(/cannot be split into sets/)
  })
  it('a real house, with a card kept to capture it with, is allowed; without that card it is not', () => {
    const floor = [loose('a', Face.Four, Suit.Spades), loose('b', Face.Five, Suit.Hearts)]
    const kept = makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Nine, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(buildHouseRefusal(viewFor(kept, 'player'), card(Face.Nine, Suit.Hearts), ['a', 'b'], 9)).toBeNull()
    const alone = makeState({ floor, hands: { player: [card(Face.Nine, Suit.Hearts), card(Face.Two, Suit.Clubs)], opponent: [card(Face.Two, Suit.Diamonds)] } })
    expect(buildHouseRefusal(viewFor(alone, 'player'), card(Face.Nine, Suit.Hearts), ['a', 'b'], 9)).not.toBeNull()
  })
})

describe('two-player: the answer always matches the real engine, across simulated games', () => {
  it('for every house, card and set of loose cards a player could pick (and every house value to build)', () => {
    const counts = { modifyAllowed: 0, modifyRefused: 0, buildAllowed: 0, buildRefused: 0, turns: 0 }
    for (let g = 0; g < 50; g++) {
      const rand = mulberry32(61000 + g)
      let s = startMatch(g % 2 === 0 ? 'player' : 'opponent', 12000 + g)
      for (let step = 0; step < 400 && s.phase !== 'match-over'; step++) {
        if (s.phase === 'hand-over') { if (g % 3 === 0) break; s = dealNextHand(s, 13000 + g); continue }
        if (s.phase === 'bidding') { s = placeBid(s, s.bidder, s.bidder === 'opponent' ? chooseComputerBid(s) : legalBids(s)[0]!); continue }
        if (s.turn === 'player') {
          if (s.phase === 'playing') {
            const view = viewFor(s, 'player')
            const houses = s.floor.filter(isHouse)
            const looseItems = s.floor.filter(isLoose)
            const pick = (): string[] => looseItems.filter(() => rand() < 0.3).slice(0, 3).map((i) => i.id)
            for (const c of s.hands.player) {
              for (const h of houses) {
                for (let t = 0; t < 3; t++) {
                  const ids = t === 0 ? [] : pick()
                  const real = worked(() => playModifyHouse(s, 'player', c, h.id, ids))
                  const asked = modifyHouseRefusal(view, c, h.id, ids)
                  expect(asked === null, `modify ${c.face} on house ${h.captureValue} + ${ids.length} loose: ${asked}`).toBe(real)
                  if (!real) expect(typeof asked === 'string' && asked.length > 5).toBe(true)
                  if (real) counts.modifyAllowed++
                  else counts.modifyRefused++
                }
              }
              for (let t = 0; t < 4; t++) {
                const ids = pick()
                for (let target = 9; target <= 13; target++) {
                  const real = worked(() => playBuildHouse(s, 'player', c, ids, target))
                  expect(buildHouseRefusal(view, c, ids, target) === null, `build ${target} with ${c.face} + ${ids.length} loose`).toBe(real)
                  if (real) counts.buildAllowed++
                  else counts.buildRefused++
                }
              }
            }
            counts.turns++
          }
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
    expect(counts.turns).toBeGreaterThan(300)
    expect(counts.modifyAllowed).toBeGreaterThan(20) // the comparison met plenty of both answers, for both kinds of move
    expect(counts.modifyRefused).toBeGreaterThan(300)
    expect(counts.buildAllowed).toBeGreaterThan(20)
    expect(counts.buildRefused).toBeGreaterThan(1000)
  }, 240_000)
})

describe('four-player: the same', () => {
  const nine = (id: string, value: number): House<SeatId> => ({ kind: 'house', id, cards: [card(Face.Six, Suit.Clubs), card(Face.Seven, Suit.Clubs)], captureValue: value, cemented: false, owners: [SeatId.P2] })
  function state4(over: Partial<FourPlayerGameState>): FourPlayerGameState {
    return {
      floor: [], hands: { p1: [], p2: [card(Face.Two, Suit.Clubs)], p3: [card(Face.Two, Suit.Hearts)], p4: [card(Face.Two, Suit.Spades)] }, captures: { teamA: [], teamB: [] }, sweepPoints: { teamA: 0, teamB: 0 }, matchScores: { teamA: 0, teamB: 0 },
      dealer: SeatId.P4, bidder: SeatId.P1, turn: SeatId.P1, phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null,
      cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 0, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION, ...over,
    }
  }
  it('one King: refused with the engine’s explanation; two Kings: allowed', () => {
    const floor = [nine('h', 13)]
    const one = state4({ floor, hands: { p1: [card(Face.King, Suit.Spades), card(Face.Three, Suit.Hearts)], p2: [card(Face.Two, Suit.Clubs)], p3: [card(Face.Two, Suit.Hearts)], p4: [card(Face.Two, Suit.Spades)] } })
    expect(fourPlayerModifyHouseRefusal(viewForSeat(one, SeatId.P1), card(Face.King, Suit.Spades), 'h')).toBe(LAST_KING)
    expect(() => playFourPlayerModifyHouse(one, SeatId.P1, card(Face.King, Suit.Spades), 'h')).toThrow(LAST_KING)
    const two = state4({ floor, hands: { p1: [card(Face.King, Suit.Spades), card(Face.King, Suit.Hearts)], p2: [card(Face.Two, Suit.Clubs)], p3: [card(Face.Two, Suit.Hearts)], p4: [card(Face.Two, Suit.Spades)] } })
    expect(fourPlayerModifyHouseRefusal(viewForSeat(two, SeatId.P1), card(Face.King, Suit.Spades), 'h')).toBeNull()
  })
  it('always matches the real four-player engine, for every seat, across simulated games', () => {
    const counts = { modifyAllowed: 0, modifyRefused: 0, buildAllowed: 0, buildRefused: 0, turns: 0 }
    for (let g = 0; g < 14; g++) {
      const rand = mulberry32(71000 + g)
      let s = startFourPlayerMatch(SeatId.P4, 15000 + g)
      for (let step = 0; step < 700 && s.phase !== 'match-over'; step++) {
        if (s.phase === 'hand-over') { if (g % 3 === 0) break; s = dealNextFourPlayerHand(s, 16000 + g); continue }
        if (s.phase === 'bidding') { s = placeFourPlayerBid(s, s.bidder, chooseFourPlayerBid(s)); continue }
        const seat = s.turn
        if (s.phase === 'playing') {
          const view = viewForSeat(s, seat)
          const houses = s.floor.filter(isHouse)
          const looseItems = s.floor.filter(isLoose)
          const pick = (): string[] => looseItems.filter(() => rand() < 0.3).slice(0, 3).map((i) => i.id)
          for (const c of s.hands[seat]) {
            for (const h of houses) {
              for (let t = 0; t < 3; t++) {
                const ids = t === 0 ? [] : pick()
                const real = worked(() => playFourPlayerModifyHouse(s, seat, c, h.id, ids))
                expect(fourPlayerModifyHouseRefusal(view, c, h.id, ids) === null, `4P modify ${c.face} on house ${h.captureValue}`).toBe(real)
                if (real) counts.modifyAllowed++
                else counts.modifyRefused++
              }
            }
            for (let t = 0; t < 3; t++) {
              const ids = pick()
              for (let target = 9; target <= 13; target++) {
                const real = worked(() => playFourPlayerBuildHouse(s, seat, c, ids, target))
                expect(fourPlayerBuildHouseRefusal(view, c, ids, target) === null, `4P build ${target} with ${c.face}`).toBe(real)
                if (real) counts.buildAllowed++
                else counts.buildRefused++
              }
            }
          }
          counts.turns++
        }
        const action = s.phase === 'opening-move' ? chooseFourPlayerOpeningMove(s) : chooseFourPlayerMove(s)
        const { reason, ...intent } = action
        void reason
        s = applyFourPlayerMove(s, seat, intent as Parameters<typeof applyFourPlayerMove>[2])
      }
    }
    expect(counts.turns).toBeGreaterThan(300)
    expect(counts.modifyRefused).toBeGreaterThan(200)
    expect(counts.buildRefused).toBeGreaterThan(500)
    expect(counts.modifyAllowed + counts.buildAllowed).toBeGreaterThan(10)
  }, 240_000)
})


describe('the computer can never do it either: with a house of 13 and a single King, it captures', () => {
  it('two-player: the computer’s move is a capture of the house (it cannot add the King to it or throw it), and the engine accepts it', () => {
    const s = makeState({
      turn: 'opponent', floor: [house('h', 13, ['opponent']), loose('a', Face.Four, Suit.Clubs)],
      hands: { player: [card(Face.Two, Suit.Diamonds), card(Face.Three, Suit.Diamonds)], opponent: [card(Face.King, Suit.Spades), card(Face.Five, Suit.Clubs)] },
    })
    const { reason, ...intent } = chooseComputerMove(s)
    void reason
    const move = intent as Intent
    expect(move.type === 'modify' || (move.type === 'throw' && move.card.face === Face.King)).toBe(false)
    expect(() => applyMove(s, 'opponent', move)).not.toThrow()
    // and nothing else is possible with that King: every legal move that uses it is a capture
    const withKing = legalMoves(s, 'opponent', { maxLooseCards: 99 }).filter((m) => m.type !== 'bid' && m.card.face === Face.King)
    expect(withKing.length).toBeGreaterThan(0)
    expect(withKing.every((m) => m.type === 'capture')).toBe(true)
  })
  it('four-player: the same for a computer seat', () => {
    const base = {
      floor: [{ kind: 'house', id: 'h', cards: [card(Face.Six, Suit.Clubs), card(Face.Seven, Suit.Clubs)], captureValue: 13, cemented: false, owners: [SeatId.P2] } as House<SeatId>],
      hands: { p1: [card(Face.Two, Suit.Clubs)], p2: [card(Face.King, Suit.Spades), card(Face.Five, Suit.Clubs)], p3: [card(Face.Two, Suit.Hearts)], p4: [card(Face.Two, Suit.Spades)] },
    }
    const s: FourPlayerGameState = { ...base, captures: { teamA: [], teamB: [] }, sweepPoints: { teamA: 0, teamB: 0 }, matchScores: { teamA: 0, teamB: 0 }, dealer: SeatId.P4, bidder: SeatId.P1, turn: SeatId.P2, phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: null, cardsPlayedThisHand: 10, totalPlayableThisHand: 48, nextItemId: 0, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION }
    const { reason, ...intent } = chooseFourPlayerMove(s)
    void reason
    const move = intent as Parameters<typeof applyFourPlayerMove>[2]
    expect(move.type === 'modify' || (move.type === 'throw' && move.card.face === Face.King)).toBe(false)
    expect(() => applyFourPlayerMove(s, SeatId.P2, move)).not.toThrow()
  })
})
