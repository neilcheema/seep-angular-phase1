import { describe, expect, it } from 'vitest'
import { describeTurn, isOnTheMove } from '../turn-text'

const nameOf = (seat: string) => ({ p1: 'Alice', p2: 'Bob', p3: 'Your partner', p4: 'Dave' })[seat] ?? seat

describe('describeTurn: who is on the move, in words', () => {
  it('says "Your turn" when it is the viewer’s move', () => {
    expect(describeTurn('playing', 'p1', 'p1', nameOf)).toEqual({ text: 'Your turn', mine: true })
  })

  it('names the person on the move otherwise, so nobody has to guess', () => {
    expect(describeTurn('playing', 'p2', 'p1', nameOf)).toEqual({ text: 'Bob’s turn', mine: false })
    expect(describeTurn('bidding', 'p4', 'p1', nameOf)).toEqual({ text: 'Dave’s turn', mine: false })
    expect(describeTurn('opening-move', 'p3', 'p1', nameOf)).toEqual({ text: 'Your partner’s turn', mine: false })
  })

  it('works at a two-player table, where the opponent is a single label', () => {
    expect(describeTurn('playing', 'opponent', 'player', () => 'Opponent')).toEqual({ text: 'Opponent’s turn', mine: false })
    expect(describeTurn('playing', 'player', 'player', () => 'Opponent')).toEqual({ text: 'Your turn', mine: true })
  })

  it('says nothing between hands, after the match, or before anyone has the move', () => {
    expect(describeTurn('hand-over', 'p1', 'p1', nameOf)).toBeNull()
    expect(describeTurn('match-over', 'p2', 'p1', nameOf)).toBeNull()
    expect(describeTurn('playing', null, 'p1', nameOf)).toBeNull()
    expect(describeTurn('playing', undefined, 'p1', nameOf)).toBeNull()
  })
})

describe('isOnTheMove: which seat gets the marker', () => {
  it('is true only for the seat whose turn it is, and only while a turn exists', () => {
    expect(isOnTheMove('playing', 'p2', 'p2')).toBe(true)
    expect(isOnTheMove('playing', 'p2', 'p3')).toBe(false)
    expect(isOnTheMove('match-over', 'p2', 'p2')).toBe(false)
    expect(isOnTheMove('hand-over', 'p2', 'p2')).toBe(false)
    expect(isOnTheMove('playing', null, 'p2')).toBe(false)
  })
})
