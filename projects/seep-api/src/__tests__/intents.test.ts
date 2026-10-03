import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../lib/errors'
import { parseIntent } from '../lib/intents'

const king = { face: 'King', suit: 'Spades' }

describe('parseIntent', () => {
  it('accepts each of the five intent shapes and returns clean copies', () => {
    expect(parseIntent({ type: 'bid', value: 9 })).toEqual({ type: 'bid', value: 9 })
    expect(parseIntent({ type: 'throw', card: king })).toEqual({ type: 'throw', card: king })
    expect(parseIntent({ type: 'capture', card: king, targetItemIds: ['f1', 'f2'] })).toEqual({
      type: 'capture',
      card: king,
      targetItemIds: ['f1', 'f2'],
    })
    expect(parseIntent({ type: 'build', card: king, looseItemIds: ['f3'], targetValue: 13 })).toEqual({
      type: 'build',
      card: king,
      looseItemIds: ['f3'],
      targetValue: 13,
    })
    expect(parseIntent({ type: 'modify', card: king, houseId: 'f9', extraLooseItemIds: ['f4'] })).toEqual({
      type: 'modify',
      card: king,
      houseId: 'f9',
      extraLooseItemIds: ['f4'],
    })
  })

  it('treats extraLooseItemIds on a modify as optional', () => {
    expect(parseIntent({ type: 'modify', card: king, houseId: 'f9' })).toEqual({
      type: 'modify',
      card: king,
      houseId: 'f9',
      extraLooseItemIds: undefined,
    })
  })

  it('drops unknown properties instead of passing them to the engine or the move log', () => {
    const parsed = parseIntent({ type: 'throw', card: { ...king, hacked: true }, isAdmin: true, __proto__: { x: 1 } })
    expect(parsed).toEqual({ type: 'throw', card: king })
    expect(Object.keys(parsed)).toEqual(['type', 'card'])
    expect(Object.keys((parsed as { card: object }).card)).toEqual(['face', 'suit'])
  })

  it.each([
    ['null', null],
    ['a string', 'bid'],
    ['an array', []],
    ['no type', { value: 9 }],
    ['an unknown type', { type: 'forfeit' }],
    ['a type that is not a string', { type: 7 }],
    ['a bid with a fractional value', { type: 'bid', value: 9.5 }],
    ['a bid with a negative value', { type: 'bid', value: -1 }],
    ['a bid with a string value', { type: 'bid', value: '9' }],
    ['a bid with an absurd value', { type: 'bid', value: 1e9 }],
    ['a throw with no card', { type: 'throw' }],
    ['a card that is not an object', { type: 'throw', card: 'King of Spades' }],
    ['a card with an invalid face', { type: 'throw', card: { face: 'Joker', suit: 'Spades' } }],
    ['a card with an invalid suit', { type: 'throw', card: { face: 'King', suit: 'Stars' } }],
    ['a card missing its suit', { type: 'throw', card: { face: 'King' } }],
    ['a capture whose targets are not a list', { type: 'capture', card: king, targetItemIds: 'f1' }],
    ['a capture whose target is not a string', { type: 'capture', card: king, targetItemIds: [1] }],
    ['a capture with an empty-string target', { type: 'capture', card: king, targetItemIds: [''] }],
    ['a capture with an oversized target id', { type: 'capture', card: king, targetItemIds: ['x'.repeat(33)] }],
    ['a capture with far too many targets', { type: 'capture', card: king, targetItemIds: Array(500).fill('f1') }],
    ['a build with no targetValue', { type: 'build', card: king, looseItemIds: [] }],
    ['a modify with no houseId', { type: 'modify', card: king }],
    ['a modify whose extras are not a list', { type: 'modify', card: king, houseId: 'f1', extraLooseItemIds: 'f2' }],
  ])('rejects %s with a 400', (_label, raw) => {
    expect(() => parseIntent(raw)).toThrow(BadRequestError)
  })
})
