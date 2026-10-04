import { describe, expect, it } from 'vitest'
import { cleanDisplayName } from '../lib/display-name'
import { BadRequestError } from '../lib/errors'

const rejects = (raw: unknown) => expect(() => cleanDisplayName(raw)).toThrow(BadRequestError)

describe('cleanDisplayName', () => {
  it.each([
    ['Alice', 'Alice'],
    ['  Bob  ', 'Bob'],
    ['Mary   Ann', 'Mary Ann'],
    ["O'Brien", "O'Brien"],
    ['Jean-Luc', 'Jean-Luc'],
    ['J. Singh', 'J. Singh'],
    ['seep_king_99', 'seep_king_99'],
    ['José', 'José'],
    ['Zoë', 'Zoë'],
    ['ਨਰਿੰਦਰ', 'ਨਰਿੰਦਰ'], // Gurmukhi: letters and combining vowel signs
    ['नरेंद्र', 'नरेंद्र'], // Devanagari
    ['王小明', '王小明'],
    ['محمد', 'محمد'],
    ['Narender Cheema', 'Narender Cheema'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(cleanDisplayName(raw)).toBe(expected)
  })

  it('treats the same text in different Unicode forms as one name', () => {
    expect(cleanDisplayName('Jose\u0301')).toBe('Jos\u00e9') // e + combining acute becomes the single é
  })

  it('collapses tabs, newlines and non-breaking spaces into single spaces', () => {
    expect(cleanDisplayName('A\t\nB\u00a0C')).toBe('A B C')
  })

  it('counts characters the way a person does, so a short name in any script is not "too long"', () => {
    expect(cleanDisplayName('ਨ'.repeat(20))).toHaveLength(20) // 20 characters, 60 bytes
    rejects('ਨ'.repeat(21))
  })

  it('counts characters outside the basic range as ONE character each (some letters take two code units)', () => {
    const rare = '\u{20BB7}' // a CJK character from the supplementary planes; two UTF-16 units, one character
    expect(Array.from(rare.repeat(20))).toHaveLength(20)
    expect(cleanDisplayName(rare.repeat(20))).toBe(rare.repeat(20)) // 20 characters: allowed
    rejects(rare.repeat(21)) // 21 characters: too long
    expect(cleanDisplayName(rare.repeat(2))).toBe(rare.repeat(2)) // 2 characters: long enough
    rejects(rare) // 1 character: too short, even though it is two code units
  })

  it('enforces the length limits at their boundaries', () => {
    rejects('A')
    expect(cleanDisplayName('Al')).toBe('Al')
    expect(cleanDisplayName('A'.repeat(20))).toHaveLength(20)
    rejects('A'.repeat(21))
    rejects('')
    rejects('   ')
  })

  it.each([
    ['markup', '<script>alert(1)</script>'],
    ['a tag', '<b>Bob</b>'],
    ['a web address', 'http://evil.example'],
    ['an email address', 'a@b.com'],
    ['an emoji', 'Bob 🎉'],
    ['a zero-width space', 'Bo\u200bb'],
    ['a right-to-left override', 'Bob\u202eevil'],
    ['a control character', 'Bo\u0007b'],
    ['a slash', 'a/b'],
    ['a quote mark pair used for injection', 'Bob"; DROP TABLE users;--'],
    ['only punctuation', '...'],
    ['only underscores', '____'],
    ['stacked accents ("zalgo")', 'B\u0300\u0301\u0302\u0303\u0304ob'],
  ])('rejects %s', (_label, raw) => {
    rejects(raw)
  })

  it('allows ordinary accents but not a pile of them', () => {
    expect(cleanDisplayName('Zoë')).toBe('Zoë')
    rejects('Zo\u0308\u0308\u0308\u0308')
  })

  it('still allows up to three marks on one letter, which some scripts and fully-marked Arabic or Hebrew need', () => {
    expect(cleanDisplayName('Zo\u0308\u0308\u0308')).toBeTruthy()
    expect(cleanDisplayName('\u0645\u064f\u062d\u064e\u0645\u0651\u064e\u062f')).toBeTruthy() // vocalised Arabic
  })

  it.each([undefined, null, 42, true, {}, [], ['Bob']])('rejects %j because it is not text', (raw) => {
    rejects(raw)
  })

  it('gives a message a person can act on', () => {
    expect(() => cleanDisplayName('A')).toThrow(/at least 2 characters/)
    expect(() => cleanDisplayName('A'.repeat(21))).toThrow(/at most 20/)
    expect(() => cleanDisplayName('<b>')).toThrow(/letters, numbers, spaces/)
  })
})
