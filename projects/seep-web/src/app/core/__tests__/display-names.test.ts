import { describe, expect, it } from 'vitest'
import type { GameInfoDto, PlayerInfoDto } from '../api-types'
import { otherNames, seatLine, seatNumber, suggestName, tableStatusText } from '../display-names'

const player = (seat: string, over: Partial<PlayerInfoDto> = {}): PlayerInfoDto => ({
  seat, displayName: null, isBot: false, isYou: false, joined: true, ...over,
})
const game = (over: Partial<GameInfoDto>): GameInfoDto => ({
  gameId: 'g', kind: 'two_player', status: 'active', version: 1, seat: 'player', inviteCode: null, players: [], ...over,
})

describe('suggestName', () => {
  it('suggests only the first word of a full name, for privacy', () => {
    expect(suggestName('Narender Cheema')).toBe('Narender')
    expect(suggestName('  Mary Ann Smith ')).toBe('Mary')
  })
  it('keeps names in other scripts', () => {
    expect(suggestName('ਨਰਿੰਦਰ ਸਿੰਘ')).toBe('ਨਰਿੰਦਰ')
  })
  it('strips characters the server would refuse', () => {
    expect(suggestName('Bob🎉 Smith')).toBe('Bob')
    expect(suggestName('<b>Bob</b>')).toBe('bBobb') // the < > / are dropped; what is left is a plain name the server accepts
  })
  it('gives nothing when there is nothing usable, or only one character', () => {
    expect(suggestName(null)).toBe('')
    expect(suggestName('')).toBe('')
    expect(suggestName('🎉🎉')).toBe('')
    expect(suggestName('A')).toBe('')
  })
  it('never exceeds the 20 character limit', () => {
    expect(Array.from(suggestName('A'.repeat(40))).length).toBe(20)
  })
})

describe('seatLine', () => {
  it('says who has arrived at a four-player table, and who is still awaited', () => {
    expect(seatLine(player('p1', { displayName: 'Alice', isYou: true }))).toBe('Player 1 — Alice (you)')
    expect(seatLine(player('p2', { displayName: 'Bob' }))).toBe('Player 2 — Bob')
    expect(seatLine(player('p3', { joined: false }))).toBe('Player 3 — waiting…')
  })
  it('copes with someone who has not chosen a name', () => {
    expect(seatLine(player('p2'))).toBe('Player 2 — a player')
    expect(seatLine(player('p1', { isYou: true }))).toBe('Player 1 — you (you)')
  })
  it('numbers seats', () => {
    expect(seatNumber('p4')).toBe(4)
  })
})

describe('tableStatusText', () => {
  it('keeps the two-player waiting wording', () => {
    expect(tableStatusText(game({ status: 'waiting', inviteCode: 'ABC234' }))).toBe('Waiting for an opponent, code ABC234')
  })
  it('counts the seats filled at a four-player table that is still waiting', () => {
    const players = [player('p1', { isYou: true }), player('p2'), player('p3', { joined: false }), player('p4', { joined: false })]
    expect(tableStatusText(game({ kind: 'four_player', status: 'waiting', inviteCode: 'ZZZ999', players }))).toBe('Waiting for players (2 of 4), code ZZZ999')
  })
  it('names the opponent at a two-player table in progress', () => {
    const players = [player('player', { isYou: true, displayName: 'Alice' }), player('opponent', { displayName: 'Bob' })]
    expect(tableStatusText(game({ players }))).toBe('In progress vs Bob')
  })
  it('names the others at a four-player table in progress', () => {
    const players = [player('p1', { isYou: true }), player('p2', { displayName: 'Bob' }), player('p3', { displayName: 'Carol' }), player('p4')]
    expect(tableStatusText(game({ kind: 'four_player', players }))).toBe('In progress with Bob, Carol, a player')
  })
  it('does not leave a gap when the opponent has no name yet, or nobody else is there', () => {
    expect(tableStatusText(game({ players: [player('player', { isYou: true }), player('opponent')] }))).toBe('In progress vs a player')
    expect(tableStatusText(game({ players: [] }))).toBe('In progress')
  })
  it('says finished and closed', () => {
    expect(tableStatusText(game({ status: 'finished' }))).toBe('Finished')
    expect(tableStatusText(game({ status: 'abandoned' }))).toBe('Closed')
  })
  it('lists only people who have arrived and are not you or a bot', () => {
    const g = game({ players: [player('p1', { isYou: true, displayName: 'Me' }), player('p2', { displayName: 'Bob' }), player('p3', { isBot: true, displayName: 'Robo' }), player('p4', { joined: false, displayName: 'Ghost' })] })
    expect(otherNames(g)).toEqual(['Bob'])
  })
})
