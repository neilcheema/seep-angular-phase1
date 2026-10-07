import { describe, expect, it } from 'vitest'
import { joinNames } from '../names'

describe('joinNames', () => {
  it('writes a list the way a sentence would', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['J of Clubs'])).toBe('J of Clubs')
    expect(joinNames(['Q of Hearts', 'K of Clubs'])).toBe('Q of Hearts and K of Clubs')
    expect(joinNames(['A of Spades', 'Q of Hearts', 'K of Clubs'])).toBe('A of Spades, Q of Hearts and K of Clubs')
  })
})
