import { describe, expect, it } from 'vitest'
import { Face, Suit, type Card } from '../card.ts'
import { type FloorItem, type House, resolveLastCardCapture } from '../floor.ts'
import { type FourPlayerGameState, applyFourPlayerMove, playFourPlayerCapture, viewForSeat } from '../fourPlayerEngine.ts'
import { type GameState, applyMove, playCapture, viewFor } from '../gameEngine.ts'
import { captureRefusal, fourPlayerCaptureRefusal } from '../preview.ts'
import { SeatId } from '../seats.ts'
import { ENGINE_VERSION } from '../version.ts'

const c = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, f: Face, s: Suit): FloorItem => ({ kind: 'loose', id, card: c(f, s) })
const key = (cards: Card[]) => cards.map((x) => `${x.face}${x.suit}`).sort().join(',')
const QD = c(Face.Queen, Suit.Diamonds)

// The position the owner reported (9 October): their LAST card is the Queen of Diamonds; the floor holds their house of 12 and the loose 10, 8, 3, 5, 2 of Spades.
const HOUSE = (owner: 'player' | SeatId): House<never> => ({ kind: 'house', id: 'h12', cards: [c(Face.Queen, Suit.Hearts), c(Face.Three, Suit.Diamonds), c(Face.Nine, Suit.Diamonds)], captureValue: 12, cemented: true, owners: [owner] } as unknown as House<never>)
const LOOSE = [loose('s10', Face.Ten, Suit.Spades), loose('s8', Face.Eight, Suit.Spades), loose('s3', Face.Three, Suit.Spades), loose('s5', Face.Five, Suit.Spades), loose('s2', Face.Two, Suit.Spades)]
const SELECTIONS: [string, string[]][] = [['the house only (what the owner ticked)', ['h12']], ['nothing at all', []], ['the house + 10 + 2 (the exact set the old rule demanded)', ['h12', 's10', 's2']], ['everything on the floor', ['h12', 's10', 's8', 's3', 's5', 's2']], ['a wrong card', ['s8']]]

function two(over: Partial<GameState> = {}, floor: FloorItem[] = [HOUSE('player') as unknown as FloorItem, ...LOOSE]): GameState {
  return {
    floor, hands: { player: [QD], opponent: [] }, captures: { player: [c(Face.Ace, Suit.Clubs)], opponent: [c(Face.Four, Suit.Clubs)] }, sweepPoints: { player: 0, opponent: 0 },
    matchScores: { player: 65, opponent: 35 }, bidder: 'opponent', turn: 'player', phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: 'opponent',
    cardsPlayedThisHand: 47, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION, ...over,
  }
}
function four(over: Partial<FourPlayerGameState> = {}, floor: FloorItem[] = [HOUSE(SeatId.P1) as unknown as FloorItem, ...LOOSE]): FourPlayerGameState {
  return {
    floor, hands: { p1: [QD], p2: [], p3: [], p4: [] }, captures: { teamA: [c(Face.Ace, Suit.Clubs)], teamB: [c(Face.Four, Suit.Clubs)] }, sweepPoints: { teamA: 0, teamB: 0 },
    matchScores: { teamA: 65, teamB: 35 }, dealer: SeatId.P4, bidder: SeatId.P2, turn: SeatId.P1, phase: 'playing', bidValue: null, pendingDeal: null, lastCapturer: SeatId.P2,
    cardsPlayedThisHand: 47, totalPlayableThisHand: 48, nextItemId: 100, log: [], winner: null, lastHandTotals: null, misdeals: 0, engineVersion: ENGINE_VERSION, ...over,
  }
}

describe('the LAST card of a hand: the floor cards need not be ticked (two-player)', () => {
  it('every way of ticking is accepted, and they all end the same: the player wins every card on the floor', () => {
    const results = SELECTIONS.map(([label, ids]) => {
      const after = playCapture(two(), 'player', QD, ids)
      expect(after.phase, label).toBe('hand-over')
      expect(after.floor, label).toHaveLength(0)
      return { label, mine: key(after.captures.player), theirs: key(after.captures.opponent), totals: JSON.stringify(after.lastHandTotals) }
    })
    for (const r of results) expect(r, r.label).toEqual({ ...results[0]!, label: r.label })
    expect(results[0]!.mine.split(',').length).toBe(10) // the Ace they had, the Queen, the house's three cards, and all five loose cards
    expect(results[0]!.theirs).toBe('FourClubs') // the opponent keeps only what they already had
  })
  it('the whole floor is the player’s even though the opponent captured last before this (the last capture decides)', () => {
    const after = playCapture(two({ lastCapturer: 'opponent' }), 'player', QD, [])
    expect(key(after.captures.opponent)).toBe('FourClubs')
    expect(after.floor).toHaveLength(0)
  })
  it('no Seep bonus on the last card, as before', () => {
    const only = two({}, [HOUSE('player') as unknown as FloorItem])
    const after = playCapture(only, 'player', QD, [])
    expect(after.sweepPoints.player).toBe(0)
  })
  it('works through the move interface the server uses, with the empty selection too', () => {
    const after = applyMove(two(), 'player', { type: 'capture', card: QD, targetItemIds: [] })
    expect(after.phase).toBe('hand-over')
  })
  it('when the card CANNOT capture it is thrown as usual, and a capture with nothing ticked is still refused', () => {
    const s = two({ hands: { player: [c(Face.King, Suit.Diamonds)], opponent: [] } }, [loose('a', Face.Two, Suit.Spades), loose('b', Face.Five, Suit.Spades)])
    expect(() => playCapture(s, 'player', c(Face.King, Suit.Diamonds), [])).toThrow(/Select at least one/)
    expect(() => playCapture(s, 'player', c(Face.King, Suit.Diamonds), ['a'])).toThrow(/total/)
    expect(applyMove(s, 'player', { type: 'throw', card: c(Face.King, Suit.Diamonds) }).phase).toBe('hand-over')
  })
})

describe('any earlier play is exactly as before', () => {
  it('the same position with cards still to play still needs the exact set', () => {
    const s = two({ cardsPlayedThisHand: 40, hands: { player: [QD, c(Face.Two, Suit.Hearts)], opponent: [c(Face.Two, Suit.Diamonds)] } })
    for (const ids of [[], ['h12'], ['h12', 's10', 's8', 's3', 's5', 's2'], ['s8']]) expect(() => playCapture(s, 'player', QD, ids), ids.join('+') || 'nothing').toThrow()
    expect(() => playCapture(s, 'player', QD, ['h12', 's10', 's2'])).not.toThrow()
  })
})

describe('the helper itself', () => {
  it('changes nothing unless it is the last play and the card matches a house the player made; keeps a proper selection', () => {
    const floor = two().floor
    expect(resolveLastCardCapture(floor, QD, ['h12'], false, 'player')).toEqual(['h12'])
    expect(resolveLastCardCapture(floor, QD, [], false, 'player')).toEqual([])
    expect(resolveLastCardCapture(floor, QD, [], true, 'player').sort()).toEqual(['h12', 's10', 's2'])
    expect(resolveLastCardCapture(floor, QD, ['h12', 's10', 's2'], true, 'player')).toEqual(['h12', 's10', 's2'])
    expect(resolveLastCardCapture(floor, QD, ['s8'], true, 'player').sort()).toEqual(['h12', 's10', 's2'])
    expect(resolveLastCardCapture(floor, c(Face.Ace, Suit.Hearts), ['s8'], true, 'player')).toEqual(['s8']) // an Ace cannot capture on this floor: untouched
    expect(resolveLastCardCapture(floor, QD, [], true, 'opponent')).toEqual([]) // the same floor, but the house is not THAT player's: untouched
  })
})

describe('a proper selection is respected on the last card, so the screen shows the move as the player chose it', () => {
  it('a Jack that takes the player’s own house of 11, with a 2 and two 9s loose, keeps whichever 9 the player ticked', () => {
    const jack = c(Face.Jack, Suit.Clubs)
    const h11 = { kind: 'house', id: 'h11', cards: [c(Face.Six, Suit.Clubs), c(Face.Five, Suit.Clubs)], captureValue: 11, cemented: false, owners: ['player'] } as unknown as FloorItem
    const floor = [h11, loose('c2', Face.Two, Suit.Clubs), loose('d9', Face.Nine, Suit.Diamonds), loose('s9', Face.Nine, Suit.Spades)]
    expect(resolveLastCardCapture(floor, jack, ['h11', 'c2', 's9'], true, 'player')).toEqual(['h11', 'c2', 's9'])
    expect(resolveLastCardCapture(floor, jack, ['h11', 'c2', 'd9'], true, 'player')).toEqual(['h11', 'c2', 'd9'])
    expect(resolveLastCardCapture(floor, jack, ['h11', 'c2', 'd9', 's9'], true, 'player').sort()).toEqual(resolveLastCardCapture(floor, jack, [], true, 'player').sort()) // a wrong selection becomes the default
    // (The engine's own final piles are the same either way on the last card, and its log does not name cards; this matters for what the screen
    // reveals, which is built from the selection that was sent. So the helper itself is what is checked.)
  })
})

describe('ONLY when the last card matches a house the player made: everything else is exactly as before (two-player)', () => {
  const exactOnly = (s: GameState, label: string) => {
    for (const ids of [[], ['h12'], ['h12', 's10', 's8', 's3', 's5', 's2'], ['s8']]) expect(() => playCapture(s, 'player', QD, ids), `${label}: ${ids.join('+') || 'nothing'}`).toThrow()
    expect(() => playCapture(s, 'player', QD, ['h12', 's10', 's2'])).not.toThrow()
  }
  it('the house belongs to the OPPONENT: the exact set is still required', () => {
    exactOnly(two({}, [HOUSE('opponent') as unknown as FloorItem, ...LOOSE]), 'the opponent’s house')
  })
  it('a house of the player’s own, but of a DIFFERENT value from the last card: nothing to relax', () => {
    const nine = { kind: 'house', id: 'h9', cards: [c(Face.Four, Suit.Clubs), c(Face.Five, Suit.Clubs)], captureValue: 9, cemented: false, owners: ['player'] } as unknown as FloorItem
    const s = two({}, [nine, ...LOOSE])
    expect(() => playCapture(s, 'player', QD, [])).toThrow(/Select at least one/)
    expect(() => playCapture(s, 'player', QD, ['s8'])).toThrow()
    expect(() => playCapture(s, 'player', QD, ['s10', 's2'])).not.toThrow() // the proper capture still works
  })
  it('NO house at all on the floor: a loose capture with the last card needs the exact set, as on any play', () => {
    const s = two({}, LOOSE) // the Queen can take the 10 and the 2 (12); the 8, 3 and 5 are not a 12 on their own
    expect(() => playCapture(s, 'player', QD, [])).toThrow(/Select at least one/)
    expect(() => playCapture(s, 'player', QD, ['s10'])).toThrow()
    expect(() => playCapture(s, 'player', QD, ['s10', 's8', 's2'])).toThrow()
    const after = playCapture(s, 'player', QD, ['s10', 's2'])
    expect(after.phase).toBe('hand-over') // and the leftovers still come to the last capturer, as always
    expect(after.floor).toHaveLength(0)
  })
})

describe('four-player', () => {
  it('every way of ticking works on the last card and gives the same final piles', () => {
    const results = SELECTIONS.map(([label, ids]) => {
      const after = playFourPlayerCapture(four(), SeatId.P1, QD, ids)
      expect(after.phase, label).toBe('hand-over')
      expect(after.floor, label).toHaveLength(0)
      return { mine: key(after.captures.teamA), theirs: key(after.captures.teamB), totals: JSON.stringify(after.lastHandTotals) }
    })
    for (const r of results) expect(r).toEqual(results[0])
    expect(results[0]!.mine.split(',').length).toBe(10)
    expect(applyFourPlayerMove(four(), SeatId.P1, { type: 'capture', card: QD, targetItemIds: [] }).phase).toBe('hand-over')
  })
  it('and an earlier play is unchanged', () => {
    const s = four({ cardsPlayedThisHand: 40, hands: { p1: [QD, c(Face.Two, Suit.Hearts)], p2: [c(Face.Two, Suit.Diamonds)], p3: [], p4: [] } })
    expect(() => playFourPlayerCapture(s, SeatId.P1, QD, [])).toThrow()
    expect(() => playFourPlayerCapture(s, SeatId.P1, QD, ['h12'])).toThrow()
    expect(() => playFourPlayerCapture(s, SeatId.P1, QD, ['h12', 's10', 's2'])).not.toThrow()
  })
})

describe('ONLY when the last card matches a house the player made: four-player', () => {
  const ownedBy = (owners: SeatId[]): FloorItem => ({ kind: 'house', id: 'h12', cards: [c(Face.Queen, Suit.Hearts), c(Face.Three, Suit.Diamonds), c(Face.Nine, Suit.Diamonds)], captureValue: 12, cemented: true, owners } as unknown as FloorItem)
  it('the player’s own house (alone, or shared with the partner): the floor cards need not be ticked', () => {
    for (const owners of [[SeatId.P1], [SeatId.P1, SeatId.P3]]) expect(() => playFourPlayerCapture(four({}, [ownedBy(owners), ...LOOSE]), SeatId.P1, QD, []), owners.join('+')).not.toThrow()
  })
  it('a house made only by the partner, or by an opponent, does not count: the exact set is required', () => {
    for (const owners of [[SeatId.P3], [SeatId.P2], [SeatId.P2, SeatId.P4]]) {
      const s = four({}, [ownedBy(owners), ...LOOSE])
      expect(() => playFourPlayerCapture(s, SeatId.P1, QD, []), owners.join('+')).toThrow()
      expect(() => playFourPlayerCapture(s, SeatId.P1, QD, ['h12'])).toThrow()
      expect(() => playFourPlayerCapture(s, SeatId.P1, QD, ['h12', 's10', 's2'])).not.toThrow()
    }
  })
  it('no house at all: a loose capture needs the exact set', () => {
    const s = four({}, LOOSE)
    expect(() => playFourPlayerCapture(s, SeatId.P1, QD, [])).toThrow()
    expect(() => playFourPlayerCapture(s, SeatId.P1, QD, ['s10', 's2'])).not.toThrow()
  })
})

describe('the screens ask the same question', () => {
  it('the helpers agree: on the last card any selection (even none) is allowed; before it, not', () => {
    for (const ids of [[], ['h12'], ['s8']]) {
      expect(captureRefusal(viewFor(two(), 'player'), QD, ids), ids.join('+') || 'nothing').toBeNull()
      expect(fourPlayerCaptureRefusal(viewForSeat(four(), SeatId.P1), QD, ids), ids.join('+') || 'nothing').toBeNull()
    }
    expect(captureRefusal(viewFor(two({}, [HOUSE('opponent') as unknown as FloorItem, ...LOOSE]), 'player'), QD, [])).not.toBeNull() // someone else's house: not relaxed
    const early = two({ cardsPlayedThisHand: 40, hands: { player: [QD, c(Face.Two, Suit.Hearts)], opponent: [c(Face.Two, Suit.Diamonds)] } })
    expect(captureRefusal(viewFor(early, 'player'), QD, ['h12'])).not.toBeNull()
    expect(captureRefusal(viewFor(early, 'player'), QD, [])).not.toBeNull()
  })
})
