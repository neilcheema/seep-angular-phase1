import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { type FloorItem, isLoose } from '../floor.ts'
import { type FourPlayerGameState, playFourPlayerCapture, viewForSeat } from '../fourPlayerEngine.ts'
import { type GameState, legalBids, placeBid, playCapture, startMatch, viewFor } from '../gameEngine.ts'
import { captureRefusal, fourPlayerCaptureRefusal } from '../preview.ts'
import { legalMoves } from '../moves.ts'
import { SeatId } from '../seats.ts'
import { ENGINE_VERSION } from '../version.ts'

const c = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, f: Face, s: Suit): FloorItem => ({ kind: 'loose', id, card: c(f, s) })
const worked = (f: () => unknown): boolean => { try { f(); return true } catch { return false } }

// The position the owner reported (9 October): the bid is 11, the floor is 3 of Clubs, 3 of Spades, Queen of Diamonds, 8 of Clubs; the hand is J, 2, 10, 7.
const FLOOR = [loose('c3', Face.Three, Suit.Clubs), loose('s3', Face.Three, Suit.Spades), loose('qd', Face.Queen, Suit.Diamonds), loose('c8', Face.Eight, Suit.Clubs)]
const HAND = [c(Face.Jack, Suit.Clubs), c(Face.Two, Suit.Hearts), c(Face.Ten, Suit.Spades), c(Face.Seven, Suit.Clubs)]
const JACK = c(Face.Jack, Suit.Clubs)

function two(phase: 'opening-move' | 'playing', floor: FloorItem[] = FLOOR): GameState {
  return {
    floor, hands: { player: HAND, opponent: [c(Face.Two, Suit.Diamonds)] }, captures: { player: [], opponent: [] }, sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 0, opponent: 0 }, bidder: 'player', turn: 'player', phase, bidValue: phase === 'opening-move' ? 11 : null, pendingDeal: null, lastCapturer: null,
    cardsPlayedThisHand: phase === 'opening-move' ? 0 : 8, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION,
  }
}
function four(phase: 'opening-move' | 'playing', floor: FloorItem[] = FLOOR): FourPlayerGameState {
  return {
    floor, hands: { p1: HAND, p2: [c(Face.Two, Suit.Diamonds)], p3: [c(Face.Three, Suit.Diamonds)], p4: [c(Face.Four, Suit.Diamonds)] }, captures: { teamA: [], teamB: [] },
    sweepPoints: { teamA: 0, teamB: 0 }, matchScores: { teamA: 0, teamB: 0 }, dealer: SeatId.P4, bidder: SeatId.P1, turn: SeatId.P1, phase, bidValue: phase === 'opening-move' ? 11 : null,
    pendingDeal: null, lastCapturer: null, cardsPlayedThisHand: phase === 'opening-move' ? 0 : 8, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null,
    misdeals: 0, engineVersion: ENGINE_VERSION,
  }
}
const TWO_GROUPS = [loose('c3', Face.Three, Suit.Clubs), loose('s3', Face.Three, Suit.Spades), loose('c8', Face.Eight, Suit.Clubs), loose('h5', Face.Five, Suit.Hearts), loose('d6', Face.Six, Suit.Diamonds)]

describe('the opening move: a capture may use any ONE combination, nothing left out (two-player)', () => {
  it('the reported position: the Jack takes the 3 and the 8 with EITHER 3', () => {
    for (const ids of [['c3', 'c8'], ['s3', 'c8']]) {
      const after = playCapture(two('opening-move'), 'player', JACK, ids)
      expect(after.captures.player.length).toBe(3) // the Jack and the two cards
      expect(after.floor.map((i) => i.id).sort()).toEqual(['qd', ids[0] === 'c3' ? 's3' : 'c3'].sort()) // the other 3 and the Queen stay
    }
  })
  it('but not a part of a combination, a wrong total, or the Queen', () => {
    const s = two('opening-move')
    for (const ids of [['c3'], ['c8'], ['c3', 's3', 'c8'], ['c3', 'c8', 'qd'], ['qd'], ['c3', 's3']]) {
      expect(() => playCapture(s, 'player', JACK, ids), ids.join('+')).toThrow()
    }
  })
  it('with two separate groups on the floor, each may be made with any one of its combinations, but both groups must be taken', () => {
    const s = two('opening-move', TWO_GROUPS)
    expect(() => playCapture(s, 'player', JACK, ['c3', 'c8', 'h5', 'd6'])).not.toThrow()
    expect(() => playCapture(s, 'player', JACK, ['s3', 'c8', 'h5', 'd6'])).not.toThrow()
    expect(() => playCapture(s, 'player', JACK, ['s3', 'c8'])).toThrow(/every matching house and group together/) // the 5 and 6 would be left out
    expect(() => playCapture(s, 'player', JACK, ['h5', 'd6'])).toThrow(/every matching house and group together/) // the 3 and 8 would be left out
  })
  it('a house worth the bid must be taken as well, with any one combination for the loose cards', () => {
    const house = { kind: 'house' as const, id: 'h11', cards: [c(Face.Six, Suit.Clubs), c(Face.Five, Suit.Clubs)], captureValue: 11, cemented: false, owners: ['opponent' as const] }
    const s = two('opening-move', [house, FLOOR[0]!, FLOOR[1]!, FLOOR[3]!])
    expect(() => playCapture(s, 'player', JACK, ['h11', 'c3', 'c8'])).not.toThrow()
    expect(() => playCapture(s, 'player', JACK, ['h11', 's3', 'c8'])).not.toThrow()
    expect(() => playCapture(s, 'player', JACK, ['c3', 'c8'])).toThrow() // the house would be left out
    expect(() => playCapture(s, 'player', JACK, ['h11'])).toThrow() // the 3 and 8 would be left out
  })
  it('a house worth the bid, with no loose cards that make it: the house alone is the capture, and it is accepted and listed', () => {
    const house = { kind: 'house' as const, id: 'h10', cards: [c(Face.Six, Suit.Clubs), c(Face.Four, Suit.Clubs)], captureValue: 10, cemented: false, owners: ['opponent' as const] }
    const base = two('opening-move', [FLOOR[0]!, loose('n9', Face.Nine, Suit.Hearts), FLOOR[1]!, house])
    const s: GameState = { ...base, bidValue: 10, hands: { player: [c(Face.Ten, Suit.Diamonds), c(Face.Eight, Suit.Clubs)], opponent: [c(Face.Two, Suit.Diamonds)] } }
    expect(() => playCapture(s, 'player', c(Face.Ten, Suit.Diamonds), ['h10'])).not.toThrow()
    const listed = legalMoves(s, 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'capture').map((m) => (m.type === 'capture' ? m.targetItemIds.join(',') : ''))
    expect(listed).toContain('h10')
  })
  it('the opening move must still use a card matching the bid', () => {
    expect(() => playCapture(two('opening-move'), 'player', c(Face.Ten, Suit.Spades), ['c3'])).toThrow(/matching your bid/)
  })
})

describe('on EVERY play, not only the opening move, the player chooses the combination (nothing left out)', () => {
  it('the same position in an ordinary turn accepts either 3, and still refuses a part of a combination or leaving a group behind', () => {
    const s = two('playing')
    expect(() => playCapture(s, 'player', JACK, ['c3', 'c8'])).not.toThrow()
    expect(() => playCapture(s, 'player', JACK, ['s3', 'c8'])).not.toThrow()
    for (const ids of [['c3'], ['c8'], ['c3', 's3', 'c8'], ['c3', 'c8', 'qd']]) expect(() => playCapture(s, 'player', JACK, ids), ids.join('+')).toThrow()
    const groups = two('playing', TWO_GROUPS)
    expect(() => playCapture(groups, 'player', JACK, ['s3', 'c8', 'h5', 'd6'])).not.toThrow()
    expect(() => playCapture(groups, 'player', JACK, ['s3', 'c8'])).toThrow(/every matching house and group together/)
  })
  it('the player really keeps the choice: taking the spade leaves the club on the floor, and the other way round', () => {
    const spade = playCapture(two('playing'), 'player', JACK, ['s3', 'c8'])
    expect(spade.floor.map((i) => i.id)).toContain('c3')
    const club = playCapture(two('playing'), 'player', JACK, ['c3', 'c8'])
    expect(club.floor.map((i) => i.id)).toContain('s3')
  })
})

describe('four-player', () => {
  it('the opening move accepts either 3, and still refuses to leave a group out', () => {
    expect(() => playFourPlayerCapture(four('opening-move'), SeatId.P1, JACK, ['c3', 'c8'])).not.toThrow()
    expect(() => playFourPlayerCapture(four('opening-move'), SeatId.P1, JACK, ['s3', 'c8'])).not.toThrow()
    expect(() => playFourPlayerCapture(four('opening-move'), SeatId.P1, JACK, ['c3', 's3', 'c8'])).toThrow()
    const s = four('opening-move', TWO_GROUPS)
    expect(() => playFourPlayerCapture(s, SeatId.P1, JACK, ['s3', 'c8', 'h5', 'd6'])).not.toThrow()
    expect(() => playFourPlayerCapture(s, SeatId.P1, JACK, ['s3', 'c8'])).toThrow(/every matching house and group together/)
  })
  it('and on every later play too, still with nothing left out', () => {
    expect(() => playFourPlayerCapture(four('playing'), SeatId.P1, JACK, ['c3', 'c8'])).not.toThrow()
    expect(() => playFourPlayerCapture(four('playing'), SeatId.P1, JACK, ['s3', 'c8'])).not.toThrow()
    expect(() => playFourPlayerCapture(four('playing'), SeatId.P1, JACK, ['c3', 's3', 'c8'])).toThrow()
    expect(() => playFourPlayerCapture(four('playing', TWO_GROUPS), SeatId.P1, JACK, ['s3', 'c8'])).toThrow(/every matching house and group together/)
  })
})

describe('the screens ask the same question', () => {
  it('the helpers agree with the engine on the reported position, in both game types', () => {
    for (const ids of [['c3', 'c8'], ['s3', 'c8']]) {
      expect(captureRefusal(viewFor(two('opening-move'), 'player'), JACK, ids)).toBeNull()
      expect(fourPlayerCaptureRefusal(viewForSeat(four('opening-move'), SeatId.P1), JACK, ids)).toBeNull()
    }
    expect(captureRefusal(viewFor(two('opening-move'), 'player'), JACK, ['c3', 's3', 'c8'])).toMatch(/every matching house and group together|total/)
    expect(captureRefusal(viewFor(two('playing'), 'player'), JACK, ['s3', 'c8'])).toBeNull() // every play, not only the opening move
    expect(captureRefusal(viewFor(two('playing', TWO_GROUPS), 'player'), JACK, ['s3', 'c8'])).toMatch(/every matching house and group together/) // but nothing left behind
  })
})

describe('on a later play the move lister (and so the coach) offers every combination', () => {
  it('a Jack on a floor of 2, 9, 9 may take the 2 with EITHER 9, and the coach can tell which one wins more points', () => {
    const floor = [loose('c2', Face.Two, Suit.Clubs), loose('d9', Face.Nine, Suit.Diamonds), loose('s9', Face.Nine, Suit.Spades)]
    const s = two('playing', floor)
    const listed = legalMoves(s, 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'capture' && m.card.face === Face.Jack).map((m) => (m.type === 'capture' ? [...m.targetItemIds].sort().join('+') : ''))
    expect(listed.sort()).toEqual(['c2+d9', 'c2+s9']) // (the 2 of Hearts in the hand can also take the 2 of Clubs by itself, but that is a different card)
    const spade = playCapture(s, 'player', JACK, ['c2', 's9'])
    const diamond = playCapture(s, 'player', JACK, ['c2', 'd9'])
    expect(spade.captures.player.some((x) => x.face === Face.Nine && x.suit === Suit.Spades)).toBe(true) // the choice is real: different cards are won
    expect(diamond.captures.player.some((x) => x.face === Face.Nine && x.suit === Suit.Spades)).toBe(false)
  })
  it('and the reported floor on a later play: both captures are listed', () => {
    const listed = legalMoves(two('playing'), 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'capture' && m.card.face === Face.Jack).map((m) => (m.type === 'capture' ? [...m.targetItemIds].sort().join('+') : ''))
    expect(listed.sort()).toEqual(['c3+c8', 'c8+s3']) // the ids are sorted: the 3 of Clubs with the 8, and the 3 of Spades with the 8
  })
})

describe('the move lister offers every opening capture the engine accepts', () => {
  it('lists exactly the captures the engine accepts, over many real opening positions', () => {
    let positions = 0
    let withAlternatives = 0
    for (let seed = 1; seed <= 90; seed++) {
      const start = startMatch('player', 7000 + seed)
      for (const bid of legalBids(start)) {
        const s = placeBid(start, 'player', bid)
        if (s.phase !== 'opening-move') continue
        positions++
        const looseItems = s.floor.filter(isLoose)
        const accepted = new Set<string>()
        for (const card of s.hands.player) {
          for (let mask = 1; mask < 1 << looseItems.length; mask++) {
            const ids = looseItems.filter((_, i) => mask & (1 << i)).map((i) => i.id)
            if (worked(() => playCapture(s, 'player', card, ids))) accepted.add(`${card.face}${card.suit}|${[...ids].sort().join(',')}`)
          }
        }
        const listed = new Set(
          legalMoves(s, 'player', { maxLooseCards: 99 }).filter((m) => m.type === 'capture').map((m) => (m.type === 'capture' ? `${m.card.face}${m.card.suit}|${[...m.targetItemIds].sort().join(',')}` : '')),
        )
        expect([...listed].sort()).toEqual([...accepted].sort())
        const perCard = new Map<string, number>()
        for (const k of accepted) perCard.set(k.split('|')[0]!, (perCard.get(k.split('|')[0]!) ?? 0) + 1)
        if ([...perCard.values()].some((n) => n > 1)) withAlternatives++
      }
    }
    expect(positions).toBeGreaterThan(100)
    expect(withAlternatives).toBeGreaterThan(0) // some real positions had more than one way to capture with the same card
  }, 120_000)
})
