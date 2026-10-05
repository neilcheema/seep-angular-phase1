import { describe, expect, it } from 'vitest'
import {
  type FourPlayerGameState, type GameState, SeatId,
  applyFourPlayerMove, applyMove, dealNextFourPlayerHand, dealNextHand, forfeitFourPlayerMatch, forfeitMatch,
  startFourPlayerMatch, startMatch, viewFor, viewForSeat,
} from 'seep-engine'
import { aiIntent } from './helpers/play'

/**
 * The engine keeps what each side scored in every finished hand (handHistory), carried from hand to hand, so a finished
 * match can be itemised on the results screen. These play whole matches with the computer's own player (it lives in this
 * package's test helpers) and check, after EVERY hand, that the history adds up to the real score. They sit here because
 * this is where the helper that plays both seats already is.
 */

type Side = 'player' | 'opponent' | 'teamA' | 'teamB'
interface Hand { readonly totals: Record<string, { readonly total: number; readonly cardPoints: number; readonly qualifyingCardPoints: number; readonly sweepPoints: number }> }

const sumOf = (history: readonly Hand[], side: Side) => history.reduce((t, h) => t + h.totals[side]!.total, 0)

/** Plays a whole two-player match, calling `afterHand` each time a hand finishes (before the next is dealt). */
function playTwoPlayer(seed: number, afterHand: (state: GameState, handsFinished: number) => void): GameState {
  let state = startMatch('player', seed)
  let finished = 0
  for (let guard = 0; guard < 20_000; guard++) {
    if (state.phase === 'match-over') return state
    if (state.phase === 'hand-over') {
      state = dealNextHand(state, seed + finished)
      continue
    }
    state = applyMove(state, state.turn, aiIntent('two_player', state) as Parameters<typeof applyMove>[2])
    if (state.phase === 'hand-over' || state.phase === 'match-over') {
      finished++
      afterHand(state, finished)
    }
  }
  throw new Error('the match never ended')
}

function playFourPlayer(seed: number, afterHand: (state: FourPlayerGameState, handsFinished: number) => void): FourPlayerGameState {
  let state = startFourPlayerMatch(SeatId.P4, seed)
  let finished = 0
  for (let guard = 0; guard < 20_000; guard++) {
    if (state.phase === 'match-over') return state
    if (state.phase === 'hand-over') {
      state = dealNextFourPlayerHand(state, seed + finished)
      continue
    }
    state = applyFourPlayerMove(state, state.turn, aiIntent('four_player', state) as Parameters<typeof applyFourPlayerMove>[2])
    if (state.phase === 'hand-over' || state.phase === 'match-over') {
      finished++
      afterHand(state, finished)
    }
  }
  throw new Error('the match never ended')
}

/** A match in which the first hand ended and the match goes on (a seed where one hand ends the whole match is skipped). */
function firstHandOverTwo(startSeed: number): GameState {
  for (let seed = startSeed; seed < startSeed + 60; seed++) {
    let state = startMatch('player', seed)
    for (let guard = 0; guard < 5000 && state.phase !== 'hand-over' && state.phase !== 'match-over'; guard++) state = applyMove(state, state.turn, aiIntent('two_player', state) as Parameters<typeof applyMove>[2])
    if (state.phase === 'hand-over') return state
  }
  throw new Error('no seed gave a first hand that left the match going')
}
function firstHandOverFour(startSeed: number): FourPlayerGameState {
  for (let seed = startSeed; seed < startSeed + 60; seed++) {
    let state = startFourPlayerMatch(SeatId.P4, seed)
    for (let guard = 0; guard < 8000 && state.phase !== 'hand-over' && state.phase !== 'match-over'; guard++) state = applyFourPlayerMove(state, state.turn, aiIntent('four_player', state) as Parameters<typeof applyFourPlayerMove>[2])
    if (state.phase === 'hand-over') return state
  }
  throw new Error('no seed gave a first hand that left the match going')
}

describe('two-player: the history adds up to the score, hand by hand', () => {
  it.each([11, 29, 53])('over a whole match (seed %i)', (seed) => {
    const final = playTwoPlayer(seed, (state, finished) => {
      const history = state.handHistory ?? []
      expect(history).toHaveLength(finished) // one record per finished hand, no more, no fewer
      expect(history.at(-1)!.totals).toEqual(state.lastHandTotals) // the newest IS the hand just played
      expect(sumOf(history, 'player')).toBe(state.matchScores.player) // and they add up to the running score
      expect(sumOf(history, 'opponent')).toBe(state.matchScores.opponent)
    })
    expect(final.winner).not.toBeNull()
    expect((final.handHistory ?? []).length).toBeGreaterThanOrEqual(2) // a bazzi takes at least a couple of hands
  })

  it('every record is internally consistent: the 9-point minimum and the sweeps are what make the total', () => {
    playTwoPlayer(17, (state) => {
      for (const hand of state.handHistory ?? []) {
        for (const side of ['player', 'opponent'] as const) {
          const t = hand.totals[side]
          expect(t.qualifyingCardPoints).toBe(t.cardPoints >= 9 ? t.cardPoints : 0)
          expect(t.total).toBe(t.qualifyingCardPoints + t.sweepPoints)
        }
      }
    })
  })

  it('the view always carries it, as a list', () => {
    const state = startMatch('player', 5)
    expect(viewFor(state, 'player').handHistory).toEqual([])
    const final = playTwoPlayer(5, () => undefined)
    expect(viewFor(final, 'opponent').handHistory).toEqual(final.handHistory)
  })

  it('a game dealt before the history existed carries on: it records only the hands played from then on', () => {
    const state = firstHandOverTwo(3) // then strip the field, as an older stored game would not have it
    const old = { ...state } as GameState & { handHistory?: unknown }
    delete old.handHistory
    expect(old.handHistory).toBeUndefined()
    expect(viewFor(old, 'player').handHistory).toEqual([]) // readers get an empty list, not undefined
    let next = dealNextHand(old, 99)
    expect(next.handHistory).toEqual([]) // nothing is invented for the hand that was not recorded
    for (let guard = 0; guard < 5000 && next.phase !== 'hand-over' && next.phase !== 'match-over'; guard++) next = applyMove(next, next.turn, aiIntent('two_player', next) as Parameters<typeof applyMove>[2])
    expect(next.handHistory).toHaveLength(1) // and the next hand IS recorded
  })

  it('a forfeit leaves the history and the scores exactly as they stood', () => {
    const state = dealNextHand(firstHandOverTwo(8), 9)
    const forfeited = forfeitMatch(state, 'opponent', 'left')
    expect(forfeited.phase).toBe('match-over')
    expect(forfeited.handHistory).toEqual(state.handHistory)
    expect(forfeited.matchScores).toEqual(state.matchScores)
  })
})

describe('four-player: the same, by team', () => {
  it.each([7, 31])('over a whole match (seed %i)', (seed) => {
    const final = playFourPlayer(seed, (state, finished) => {
      const history = state.handHistory ?? []
      expect(history).toHaveLength(finished)
      expect(history.at(-1)!.totals).toEqual(state.lastHandTotals)
      expect(sumOf(history, 'teamA')).toBe(state.matchScores.teamA)
      expect(sumOf(history, 'teamB')).toBe(state.matchScores.teamB)
    })
    expect(final.winner).not.toBeNull()
    expect(viewForSeat(final, SeatId.P1).handHistory).toEqual(final.handHistory)
  })

  it('a game dealt before the history existed carries on, and a forfeit leaves things as they stood', () => {
    const state = firstHandOverFour(2)
    const old = { ...state } as FourPlayerGameState & { handHistory?: unknown }
    delete old.handHistory
    expect(viewForSeat(old, SeatId.P2).handHistory).toEqual([])
    const next = dealNextFourPlayerHand(old, 6)
    expect(next.handHistory).toEqual([])
    const forfeited = forfeitFourPlayerMatch(next, SeatId.P3, 'timeout')
    expect(forfeited.phase).toBe('match-over')
    expect(forfeited.matchScores).toEqual(next.matchScores)
  })
})
