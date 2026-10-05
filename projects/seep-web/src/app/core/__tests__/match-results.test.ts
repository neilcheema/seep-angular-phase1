import { describe, expect, it } from 'vitest'
import { type FourPlayerGameView, type GameView, type HandSideTotals, SeatId, teamOf } from 'seep-engine'
import { buildFourPlayerResults, buildTwoPlayerResults } from '../match-results'

const side = (cardPoints: number, sweeps = 0): HandSideTotals => {
  const counted = cardPoints >= 9 ? cardPoints : 0
  return { cardPoints, qualifyingCardPoints: counted, sweepPoints: sweeps, total: counted + sweeps }
}
const twoView = (over: Record<string, unknown>) => ({ phase: 'match-over', winner: 'player', matchScores: { player: 0, opponent: 0 }, handHistory: [], log: [], ...over }) as unknown as GameView
const hand2 = (a: HandSideTotals, b: HandSideTotals) => ({ totals: { player: a, opponent: b } })

describe('a finished two-player match', () => {
  const finished = twoView({
    matchScores: { player: 195, opponent: 55 },
    handHistory: [hand2(side(70), side(30)), hand2(side(75, 50), side(25))],
  })

  it('has the final score, the lead and who won, from the viewer’s side', () => {
    const r = buildTwoPlayerResults(finished, 'Bob')
    expect(r.final).toEqual([195, 55])
    expect(r.lead).toBe(140)
    expect(r.winner).toBe(0)
    expect(r.sides.map((s) => s.label)).toEqual(['You', 'Bob'])
    expect(r.sides.map((s) => s.isYou)).toEqual([true, false])
  })

  it('itemises every hand, with the running score after each', () => {
    const r = buildTwoPlayerResults(finished, 'Bob')
    expect(r.hands.map((h) => [h.number, h.sides[0].total, h.sides[1].total, ...h.after])).toEqual([[1, 70, 30, 70, 30], [2, 125, 25, 195, 55]])
    expect(r.earlier).toBeNull()
    expect(r.endedEarly).toBeNull()
  })

  it('totals the sweeps and counts hands won', () => {
    const r = buildTwoPlayerResults(finished, 'Bob')
    expect(r.sweepPoints).toEqual([50, 0])
    expect(r.handsWon).toEqual([2, 0])
  })

  it('says “Opponent” when there is no name (against the computer, or an unnamed player), and names them otherwise', () => {
    expect(buildTwoPlayerResults(finished, null).sides[1].label).toBe('Opponent')
    expect(buildTwoPlayerResults(finished, 'Bob').sides[1].label).toBe('Bob')
  })

  it('credits the other side when they won, and nobody when there is no winner', () => {
    expect(buildTwoPlayerResults(twoView({ winner: 'opponent', matchScores: { player: 40, opponent: 150 } }), null).winner).toBe(1)
    expect(buildTwoPlayerResults(twoView({ winner: null }), null).winner).toBeNull()
  })
})

describe('how a hand’s score was made', () => {
  it('shows when a side took card points but not the 9 needed, so they counted for nothing', () => {
    const r = buildTwoPlayerResults(twoView({ matchScores: { player: 0, opponent: 93 }, handHistory: [hand2(side(7), side(93))] }), null)
    const [you, them] = r.hands[0]!.sides
    expect(you).toMatchObject({ cardPoints: 7, counted: 0, total: 0, missedMinimum: true })
    expect(them).toMatchObject({ cardPoints: 93, counted: 93, total: 93, missedMinimum: false })
  })

  it('does not call it a missed minimum when a side took no card points at all', () => {
    const r = buildTwoPlayerResults(twoView({ matchScores: { player: 100, opponent: 0 }, handHistory: [hand2(side(100), side(0))] }), null)
    expect(r.hands[0]!.sides[1].missedMinimum).toBe(false)
  })

  it('keeps a sweep bonus even when the card points missed the minimum', () => {
    const r = buildTwoPlayerResults(twoView({ matchScores: { player: 50, opponent: 90 }, handHistory: [hand2(side(5, 50), side(90))] }), null)
    expect(r.hands[0]!.sides[0]).toMatchObject({ counted: 0, sweeps: 50, total: 50, missedMinimum: true })
  })
})

describe('a match that was under way before hands were recorded', () => {
  it('shows the points from the unrecorded hands as one row, and the running score starts from there', () => {
    const r = buildTwoPlayerResults(twoView({ matchScores: { player: 230, opponent: 100 }, handHistory: [hand2(side(70), side(30)), hand2(side(80), side(20))] }), null)
    expect(r.earlier).toEqual([80, 50])
    expect(r.hands.map((h) => h.after)).toEqual([[150, 80], [230, 100]])
  })

  it('treats a score with no recorded hands at all as entirely earlier, and a zero score as nothing to explain', () => {
    expect(buildTwoPlayerResults(twoView({ matchScores: { player: 120, opponent: 15 } }), null).earlier).toEqual([120, 15])
    expect(buildTwoPlayerResults(twoView({ matchScores: { player: 0, opponent: 0 } }), null).earlier).toBeNull()
  })

  it('copes with a view from an older server that has no history field at all', () => {
    const view = twoView({ matchScores: { player: 110, opponent: 10 } })
    delete (view as { handHistory?: unknown }).handHistory
    expect(buildTwoPlayerResults(view, null).hands).toEqual([])
  })
})

describe('a match that ended without a bazzi', () => {
  const early = (extra: Record<string, unknown> = {}) => twoView({ matchScores: { player: 60, opponent: 40 }, handHistory: [hand2(side(60), side(40))], log: ['Opponent ran out of time and forfeited the match.'], ...extra })

  it('says why, in the opponent’s name', () => {
    const r = buildTwoPlayerResults(early(), 'Bob')
    expect(r.endedEarly).toBe('Bob ran out of time and forfeited the match.')
    expect(r.winner).toBe(0)
  })

  it('is not “ended early” when the lead really reached a bazzi, or while the match is still going', () => {
    expect(buildTwoPlayerResults(early({ matchScores: { player: 160, opponent: 40 } }), 'Bob').endedEarly).toBeNull()
    expect(buildTwoPlayerResults(early({ phase: 'playing' }), 'Bob').endedEarly).toBeNull()
  })
})

describe('a finished four-player match', () => {
  const names = { p1: 'Alice', p2: 'Bob', p3: 'Carol', p4: 'Dave' }
  const mineB = teamOf(SeatId.P2) // Bob's team
  const theirs = mineB === 'teamA' ? 'teamB' : 'teamA'
  const hand4 = (mine: HandSideTotals, other: HandSideTotals) => ({ totals: { [mineB]: mine, [theirs]: other } })
  const fourView = (over: Record<string, unknown> = {}) => ({
    viewer: SeatId.P2, phase: 'match-over', winner: mineB, log: [],
    matchScores: { [mineB]: 170, [theirs]: 60 },
    handHistory: [hand4(side(80), side(20)), hand4(side(40, 50), side(40))],
    ...over,
  }) as unknown as FourPlayerGameView

  it('is worked out from the viewer’s own team, whichever seat they sit in', () => {
    const r = buildFourPlayerResults(fourView(), names)
    expect(r.final).toEqual([170, 60])
    expect(r.winner).toBe(0)
    expect(r.hands.map((h) => h.after)).toEqual([[80, 20], [170, 60]])
    expect(r.sweepPoints).toEqual([50, 0])
    expect(r.sides[0].isYou).toBe(true)
  })

  it('lists who is on each team by name: “You & Dave” for Bob’s team, “Alice & Carol” for the others', () => {
    const r = buildFourPlayerResults(fourView(), names)
    expect(r.sides[0].detail).toBe('You & Dave')
    expect(r.sides[1].detail).toBe('Alice & Carol')
  })

  it('falls back to “Your partner” and “Player N” for people who chose no name', () => {
    const r = buildFourPlayerResults(fourView(), {})
    expect(r.sides[0].detail).toBe('You & Your partner')
    expect(r.sides[1].detail).toBe('Player 1 & Player 3')
  })

  it('credits the other team when they won, and words a forfeit from the viewer’s side', () => {
    const r = buildFourPlayerResults(fourView({ winner: theirs, matchScores: { [mineB]: 60, [theirs]: 90 }, handHistory: [hand4(side(60), side(90))], log: ['p4 ran out of time and forfeited the match.'] }), names)
    expect(r.winner).toBe(1)
    expect(r.endedEarly).toBe('Your partner ran out of time and forfeited the match.')
  })
})
