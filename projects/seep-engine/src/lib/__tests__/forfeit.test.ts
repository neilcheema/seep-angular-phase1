import { describe, expect, it } from 'vitest'
import { applyFourPlayerMove, forfeitFourPlayerMatch, startFourPlayerMatch, viewForSeat } from '../fourPlayerEngine'
import { applyMove, forfeitMatch, legalBids, startMatch, viewFor } from '../gameEngine'
import { ALL_SEATS, teamOf } from '../seats'

describe('forfeitMatch (two-player)', () => {
  it('ends the match in favour of the other player, in any phase, leaving scores as they stood', () => {
    const bidding = startMatch('player')
    const playing = applyMove(bidding, 'player', { type: 'bid', value: legalBids(bidding)[0]! })
    for (const state of [bidding, playing]) {
      for (const loser of ['player', 'opponent'] as const) {
        const over = forfeitMatch(state, loser)
        expect(over.phase).toBe('match-over')
        expect(over.winner).toBe(loser === 'player' ? 'opponent' : 'player')
        expect(over.matchScores).toEqual(state.matchScores)
        expect(over.floor).toEqual(state.floor)
      }
    }
  })

  it('says why in the log, from the player seat’s point of view like every other 2P log line', () => {
    const state = startMatch('player')
    expect(forfeitMatch(state, 'player').log.at(-1)).toBe('You ran out of time and forfeited the match.')
    expect(forfeitMatch(state, 'opponent').log.at(-1)).toBe('Opponent ran out of time and forfeited the match.')
  })

  it('does not alter the state it was given', () => {
    const state = startMatch('player')
    const logLength = state.log.length
    forfeitMatch(state, 'player')
    expect(state.phase).toBe('bidding')
    expect(state.log).toHaveLength(logLength)
  })

  it('cannot forfeit a match that is already over, and no move can follow a forfeit', () => {
    const over = forfeitMatch(startMatch('player'), 'opponent')
    expect(() => forfeitMatch(over, 'player')).toThrow(/already over/)
    expect(() => applyMove(over, 'player', { type: 'bid', value: 9 })).toThrow()
  })

  it('is visible to both players through their views, with the winner named', () => {
    const over = forfeitMatch(startMatch('player'), 'player')
    expect(viewFor(over, 'player').phase).toBe('match-over')
    expect(viewFor(over, 'opponent').winner).toBe('opponent')
  })
})

describe('forfeitFourPlayerMatch', () => {
  it('gives the match to the other team whichever seat timed out', () => {
    const state = startFourPlayerMatch('p4')
    for (const loser of ALL_SEATS) {
      const over = forfeitFourPlayerMatch(state, loser)
      expect(over.phase).toBe('match-over')
      expect(over.winner).not.toBe(teamOf(loser))
      expect(over.winner).not.toBeNull()
      expect(over.log.at(-1)).toBe(`${loser} ran out of time and forfeited the match.`)
    }
  })

  it('cannot be applied twice, and no move can follow it', () => {
    const over = forfeitFourPlayerMatch(startFourPlayerMatch('p4'), 'p2')
    expect(() => forfeitFourPlayerMatch(over, 'p1')).toThrow(/already over/)
    expect(() => applyFourPlayerMove(over, 'p1', { type: 'bid', value: 9 })).toThrow()
    expect(viewForSeat(over, 'p3').phase).toBe('match-over')
  })
})

describe('forfeiting because the person left (for example by deleting their account)', () => {
  it('two-player: the log says they left, not that time ran out, from either side', () => {
    const state = startMatch('player')
    expect(forfeitMatch(state, 'player', 'left').log.at(-1)).toBe('You left the game and forfeited the match.')
    expect(forfeitMatch(state, 'opponent', 'left').log.at(-1)).toBe('Opponent left the game and forfeited the match.')
  })

  it('two-player: the other player still wins, exactly as for a timeout', () => {
    const state = startMatch('player')
    for (const loser of ['player', 'opponent'] as const) {
      const over = forfeitMatch(state, loser, 'left')
      expect(over.phase).toBe('match-over')
      expect(over.winner).toBe(loser === 'player' ? 'opponent' : 'player')
    }
  })

  it('four-player: the other team wins and the log says they left', () => {
    const state = startFourPlayerMatch('p1')
    const over = forfeitFourPlayerMatch(state, 'p2', 'left')
    expect(over.phase).toBe('match-over')
    expect(over.winner).toBe('teamA') // p2 is on team B
    expect(over.log.at(-1)).toBe('p2 left the game and forfeited the match.')
  })

  it('leaves the timeout wording exactly as it was when no reason is given', () => {
    expect(forfeitMatch(startMatch('player'), 'player').log.at(-1)).toBe('You ran out of time and forfeited the match.')
    expect(forfeitFourPlayerMatch(startFourPlayerMatch('p1'), 'p3').log.at(-1)).toBe('p3 ran out of time and forfeited the match.')
  })

  it('still refuses to forfeit a match that is already over', () => {
    const over = forfeitMatch(startMatch('player'), 'opponent', 'left')
    expect(() => forfeitMatch(over, 'player', 'left')).toThrow(/already over/)
  })
})

