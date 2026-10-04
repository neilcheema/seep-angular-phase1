import { describe, expect, it } from 'vitest'
import { SeatId } from 'seep-engine'
import type { PlayerInfoDto } from '../api-types'
import { fourPlayerSeatLabel, opponentNameOf, relabelFourPlayerLine, relabelTwoPlayerLine, sameNames, seatNamesOf } from '../board-names'

const player = (seat: string, over: Partial<PlayerInfoDto> = {}): PlayerInfoDto => ({ seat, displayName: null, isBot: false, isYou: false, joined: true, ...over })

describe('seatNamesOf', () => {
  it('maps each seat to the name its person chose', () => {
    expect(seatNamesOf([player('p1', { displayName: 'Alice', isYou: true }), player('p2', { displayName: 'Bob' })])).toEqual({ p1: 'Alice', p2: 'Bob' })
  })
  it('leaves out people with no name, empty seats and bots', () => {
    const names = seatNamesOf([player('p1'), player('p2', { joined: false, displayName: 'Ghost' }), player('p3', { isBot: true, displayName: 'Robo' }), player('p4', { displayName: 'Dave' })])
    expect(names).toEqual({ p4: 'Dave' })
  })
})

describe('opponentNameOf', () => {
  it('is the other player’s name at a two-player table', () => {
    expect(opponentNameOf([player('player', { isYou: true, displayName: 'Alice' }), player('opponent', { displayName: 'Bob' })])).toBe('Bob')
  })
  it('is null if they have no name, have not arrived, or the only other seat is a bot', () => {
    expect(opponentNameOf([player('player', { isYou: true }), player('opponent')])).toBeNull()
    expect(opponentNameOf([player('player', { isYou: true }), player('opponent', { joined: false, displayName: 'Bob' })])).toBeNull()
    expect(opponentNameOf([player('player', { isYou: true }), player('opponent', { isBot: true })])).toBeNull()
    expect(opponentNameOf([])).toBeNull()
  })
})

describe('relabelTwoPlayerLine', () => {
  it.each([
    ['Opponent played a Ten.', 'Bob played a Ten.'],
    ['Opponent ran out of time and forfeited the match.', 'Bob ran out of time and forfeited the match.'],
    ["Opponent's house is broken.", "Bob's house is broken."],
    ['Opponent’s house is broken.', 'Bob’s house is broken.'],
    ["You took the opponent's house.", "You took Bob's house."],
    ['You played a Two.', 'You played a Two.'],
  ])('%j -> %j', (line, expected) => {
    expect(relabelTwoPlayerLine(line, 'Bob')).toBe(expected)
  })
  it('changes nothing when the opponent has no name', () => {
    expect(relabelTwoPlayerLine('Opponent played a Ten.', null)).toBe('Opponent played a Ten.')
  })
  it('puts the name in as plain text, even if it looks like a pattern', () => {
    expect(relabelTwoPlayerLine('Opponent played.', '$& $1 .*')).toBe('$& $1 .* played.')
  })
  it('does not touch longer words that merely contain the word', () => {
    expect(relabelTwoPlayerLine('Opponents all passed.', 'Bob')).toBe('Opponents all passed.')
  })
})

describe('fourPlayerSeatLabel', () => {
  const names = { p2: 'Bob', p4: 'Dave' }
  it('says You for the viewer and Your partner for the partner, whichever seat the viewer is in', () => {
    expect(fourPlayerSeatLabel(SeatId.P1, SeatId.P1, names)).toBe('You')
    expect(fourPlayerSeatLabel(SeatId.P3, SeatId.P1, names)).toBe('Your partner')
    expect(fourPlayerSeatLabel(SeatId.P4, SeatId.P2, names)).toBe('Your partner') // p2's partner is p4
  })
  it('names the opponents, or falls back to “Player N”', () => {
    expect(fourPlayerSeatLabel(SeatId.P2, SeatId.P1, names)).toBe('Bob')
    expect(fourPlayerSeatLabel(SeatId.P4, SeatId.P1, names)).toBe('Dave')
    expect(fourPlayerSeatLabel(SeatId.P4, SeatId.P1, { p2: 'Bob' })).toBe('Player 4')
  })
})

describe('relabelFourPlayerLine', () => {
  const label = (seat: SeatId) => fourPlayerSeatLabel(seat, SeatId.P1, { p2: 'Bob' })
  it('replaces every seat id in the viewer’s terms', () => {
    expect(relabelFourPlayerLine('p2 played a Ten onto p3’s house.', label)).toBe('Bob played a Ten onto Your partner’s house.')
    expect(relabelFourPlayerLine('p1 left the game and forfeited the match.', label)).toBe('You left the game and forfeited the match.')
    expect(relabelFourPlayerLine('p4 ran out of time and forfeited the match.', label)).toBe('Player 4 ran out of time and forfeited the match.')
  })
  it('leaves a line with no seat ids alone, and does not touch words that merely contain one', () => {
    expect(relabelFourPlayerLine('Team A won the bazzi.', label)).toBe('Team A won the bazzi.')
    expect(relabelFourPlayerLine('Group p5 and app2 are not seats.', label)).toBe('Group p5 and app2 are not seats.')
  })
})

describe('sameNames', () => {
  it('treats a map rebuilt from an unchanged player list as the SAME, which is what stops a screen reacting to every server update', () => {
    const players = [player('p1', { displayName: 'Alice', isYou: true }), player('p2', { displayName: 'Bob' })]
    const first = seatNamesOf(players)
    const second = seatNamesOf([...players]) // a new array, as after every poll
    expect(second).not.toBe(first) // a different object...
    expect(sameNames(first, second)).toBe(true) // ...but the same names
  })
  it('notices a real change: a new name, a changed name, or a name that went away', () => {
    expect(sameNames({ p1: 'Alice' }, { p1: 'Alice', p2: 'Bob' })).toBe(false)
    expect(sameNames({ p1: 'Alice', p2: 'Bob' }, { p1: 'Alice' })).toBe(false)
    expect(sameNames({ p1: 'Alice' }, { p1: 'Alicia' })).toBe(false)
    expect(sameNames({ p1: 'Alice' }, { p2: 'Alice' })).toBe(false)
  })
  it('treats two empty maps as the same', () => {
    expect(sameNames({}, {})).toBe(true)
  })
})

