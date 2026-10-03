import { describe, expect, it } from 'vitest'
import { type GameState, applyMove, startFourPlayerMatch, startMatch, viewFor, viewForSeat } from 'seep-engine'
import { aiIntent, mirrorTwoPlayerState } from '../../../../../seep-api/src/__tests__/helpers/play'
import { fourPlayerPerspective, mirrorTwoPlayerView, twoPlayerPerspective } from '../perspective'

/** A spread of real mid-game states: AI vs AI, stopping at assorted points of a hand. */
function sampleStates(): GameState[] {
  const states: GameState[] = []
  for (let game = 0; game < 6; game++) {
    let s = startMatch(game % 2 === 0 ? 'player' : 'opponent')
    states.push(s)
    for (let move = 0; move < 60 && s.phase !== 'hand-over' && s.phase !== 'match-over'; move++) {
      s = applyMove(s, s.turn, aiIntent('two_player', s))
      if (move % 4 === 0) states.push(s)
    }
    states.push(s)
  }
  return states
}

const withoutLog = (v: { log: string[] }): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...v }
  delete copy['log']
  return copy
}

describe('mirrorTwoPlayerView', () => {
  const states = sampleStates()

  it('is its own inverse', () => {
    for (const s of states) {
      for (const seat of ['player', 'opponent'] as const) {
        const v = viewFor(s, seat)
        expect(mirrorTwoPlayerView(mirrorTwoPlayerView(v))).toEqual(v)
      }
    }
  })

  it("agrees with an independently written state-level swap: mirroring the opponent's view == the player's view of the role-swapped game", () => {
    expect(states.length).toBeGreaterThan(20)
    for (const s of states) {
      const viaView = mirrorTwoPlayerView(viewFor(s, 'opponent'))
      const viaState = viewFor(mirrorTwoPlayerState(s), 'player')
      expect(withoutLog(viaView)).toEqual(withoutLog(viaState))
    }
  })

  it('always presents the viewer as the player, whichever seat they really hold', () => {
    for (const s of states) {
      expect(twoPlayerPerspective.view(viewFor(s, 'opponent'), 'opponent').viewer).toBe('player')
      expect(twoPlayerPerspective.view(viewFor(s, 'player'), 'player').viewer).toBe('player')
    }
  })

  it('leaves a player-seat view completely untouched (the same object)', () => {
    const v = viewFor(states[0]!, 'player')
    expect(twoPlayerPerspective.view(v, 'player')).toBe(v)
  })

  it("keeps 'whose turn is it' and 'who bids' meaning the same thing from either seat", () => {
    for (const s of states) {
      for (const seat of ['player', 'opponent'] as const) {
        const raw = viewFor(s, seat)
        const mine = twoPlayerPerspective.view(raw, seat)
        expect(twoPlayerPerspective.isMyTurn(mine)).toBe(raw.turn === seat)
        expect(mine.bidder === 'player').toBe(raw.bidder === seat)
        // Scores follow the person, not the label.
        expect(mine.matchScores.player).toBe(raw.matchScores[seat])
        expect(mine.sweepPoints.player).toBe(raw.sweepPoints[seat])
      }
    }
  })

  it("keeps the viewer's own hand and the opponent's card count exactly as the server sent them", () => {
    for (const s of states) {
      const raw = viewFor(s, 'opponent')
      const mine = twoPlayerPerspective.view(raw, 'opponent')
      expect(mine.myHand).toEqual(raw.myHand)
      expect(mine.opponentCardCount).toBe(raw.opponentCardCount)
    }
  })

  it('attributes moves to whoever made them, relative to the viewer', () => {
    expect(twoPlayerPerspective.actor('player', 'player')).toBe('player')
    expect(twoPlayerPerspective.actor('opponent', 'player')).toBe('opponent')
    expect(twoPlayerPerspective.actor('opponent', 'opponent')).toBe('player')
    expect(twoPlayerPerspective.actor('player', 'opponent')).toBe('opponent')
  })
})

describe('fourPlayerPerspective', () => {
  it('passes the view through untouched and judges the turn by the viewer', () => {
    const s = startFourPlayerMatch('p4') // p1 bids first
    const v = viewForSeat(s, 'p1')
    expect(fourPlayerPerspective.view(v, 'p1')).toBe(v)
    expect(fourPlayerPerspective.isMyTurn(v)).toBe(true)
    expect(fourPlayerPerspective.isMyTurn(viewForSeat(s, 'p2'))).toBe(false)
    expect(fourPlayerPerspective.actor('p3', 'p1')).toBe('p3')
  })
})
