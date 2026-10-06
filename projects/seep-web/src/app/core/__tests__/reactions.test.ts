import { describe, expect, it } from 'vitest'
import { REACTIONS, reactionLabel, reactionToastText } from '../reactions'

describe('the quick reactions', () => {
  it('are a short fixed list, each with a code, an emoji and a few friendly words', () => {
    expect(REACTIONS.map((r) => r.code)).toEqual(['nice_move', 'wow', 'oops', 'thanks', 'good_game', 'good_luck'])
    for (const r of REACTIONS) {
      expect(r.code).toMatch(/^[a-z_]+$/)
      expect(r.emoji.length).toBeGreaterThan(0)
      expect(r.text.length).toBeGreaterThan(2)
      expect(r.text.length).toBeLessThan(20) // a few words, never a sentence
    }
  })

  it('have no duplicate codes or wording', () => {
    expect(new Set(REACTIONS.map((r) => r.code)).size).toBe(REACTIONS.length)
    expect(new Set(REACTIONS.map((r) => r.text)).size).toBe(REACTIONS.length)
  })

  it('say what they mean, with the emoji first', () => {
    expect(reactionLabel('nice_move')).toBe('👍 Nice move!')
    expect(reactionLabel('good_game')).toBe('👏 Good game!')
  })

  it('make the line shown to the other player: who, then what', () => {
    expect(reactionToastText('Bob', 'oops')).toBe('Bob: 😅 Oops')
    expect(reactionToastText('Your partner', 'thanks')).toBe('Your partner: 🙏 Thanks')
  })

  it('say who a reaction is for, when it is addressed: "Bob → Dave: …"', () => {
    expect(reactionToastText('Bob', 'nice_move', 'Dave')).toBe('Bob → Dave: 👍 Nice move!')
    expect(reactionToastText('Bob', 'oops', 'you')).toBe('Bob → you: 😅 Oops')
  })

  it('read exactly as before when there is no address (for everyone)', () => {
    expect(reactionToastText('Bob', 'thanks', null)).toBe('Bob: 🙏 Thanks')
    expect(reactionToastText('Bob', 'thanks', '')).toBe('Bob: 🙏 Thanks')
    expect(reactionToastText('Bob', 'thanks')).toBe('Bob: 🙏 Thanks')
  })

  it('show nothing for a code this version does not know (a newer server’s), rather than something broken', () => {
    expect(reactionLabel('some_new_one')).toBeNull()
    expect(reactionToastText('Bob', 'some_new_one')).toBeNull()
    expect(reactionToastText('Bob', '<script>')).toBeNull()
  })
})
