import { describe, expect, it } from 'vitest'
import { adapterFor, isGameKind, swapLogPerspective } from '../lib/engines'
import { BadRequestError } from '../lib/errors'
import { INVITE_CODE_LENGTH, generateInviteCode, normalizeInviteCode } from '../lib/invite-code'

describe('swapLogPerspective', () => {
  it.each([
    ['New hand dealt. You must bid.', 'New hand dealt. Opponent must bid.'],
    ['New hand dealt. Opponent must bid.', 'New hand dealt. You must bid.'],
    ['You bid 9.', 'Opponent bid 9.'],
    ['Opponent played Nine of Hearts and captured. Seep! +50.', 'You played Nine of Hearts and captured. Seep! +50.'],
    ['You threw down King of Spades.', 'Opponent threw down King of Spades.'],
    ['Opponent built a house of 11.', 'You built a house of 11.'],
    ['Hand over. You scored 31, opponent scored 14.', 'Hand over. Opponent scored 31, you scored 14.'],
  ])('rewrites %j for the other seat', (input, expected) => {
    expect(swapLogPerspective(input)).toBe(expected)
  })

  it('swaps in one pass: applying it twice returns the original', () => {
    const entry = 'Hand over. You scored 31, opponent scored 14.'
    expect(swapLogPerspective(swapLogPerspective(entry))).toBe(entry)
  })

  it('does not touch words that merely contain those letters', () => {
    expect(swapLogPerspective('Youth opponents')).toBe('Youth opponents')
  })
})

describe('two-player view perspective', () => {
  const adapter = adapterFor('two_player')
  const state = adapter.newMatch() as { log: string[] }

  it("leaves the 'player' seat's log as the engine wrote it", () => {
    const view = adapter.viewFor(state, 'player') as { log: string[] }
    expect(view.log).toEqual(state.log)
  })

  it("rephrases the 'opponent' seat's log, and reports the viewer correctly", () => {
    const view = adapter.viewFor(state, 'opponent') as { log: string[]; viewer: string }
    expect(view.viewer).toBe('opponent')
    expect(view.log).toEqual(state.log.map(swapLogPerspective))
  })
})

describe('game kinds', () => {
  it('recognises exactly the two supported kinds', () => {
    expect(isGameKind('two_player')).toBe(true)
    expect(isGameKind('four_player')).toBe(true)
    expect(isGameKind('three_player')).toBe(false)
    expect(isGameKind(undefined)).toBe(false)
  })

  it('hands out seats in a fixed order with the creator first', () => {
    expect(adapterFor('two_player').seatKeys).toEqual(['player', 'opponent'])
    expect(adapterFor('four_player').seatKeys).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})

describe('invite codes', () => {
  it('generates codes of the right length from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/) // no I, O, 0, 1
    }
  })

  it('normalizes what a person might type', () => {
    expect(normalizeInviteCode('  abc234 ')).toBe('ABC234')
  })

  it.each([undefined, null, 123, '', 'ABC', 'ABCDEFG', 'ABC10O', 'ABC 23', 'ABC-23'])('rejects %j', (raw) => {
    expect(() => normalizeInviteCode(raw)).toThrow(BadRequestError)
  })
})
