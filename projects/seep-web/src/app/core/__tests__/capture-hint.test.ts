import { describe, expect, it } from 'vitest'
import { Face, type Card, type FloorItem, type House, Suit, hasAnyLegalCapture, requiredCaptureIds } from 'seep-engine'
import { captureHintFor } from '../capture-hint'

const card = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, face: Face, suit: Suit): FloorItem => ({ kind: 'loose', id, card: card(face, suit) })
const house = (id: string, value: number): House => ({ kind: 'house', id, cards: [card(Face.Four, Suit.Clubs), card(Face.Five, Suit.Clubs)], captureValue: value, cemented: false, owners: ['player'] })

describe('captureHintFor: why Throw is greyed out', () => {
  it('says nothing when the card may be thrown', () => {
    expect(captureHintFor([loose('a', Face.Two, Suit.Spades), loose('b', Face.Four, Suit.Clubs)], card(Face.Queen, Suit.Hearts))).toBeNull()
    expect(captureHintFor([], card(Face.Queen, Suit.Hearts))).toBeNull()
  })

  it('names a single matching card', () => {
    const hint = captureHintFor([loose('a', Face.Six, Suit.Hearts), loose('b', Face.Nine, Suit.Spades)], card(Face.Six, Suit.Clubs))!
    expect(hint.headline).toBe('You must capture with the Six of Clubs.')
    expect(hint.detail).toBe('It matches the Six on the table.')
    expect(hint.ids).toEqual(['a'])
  })

  it('explains a combination that adds up (the case that confused a real player: 3 + 6 + Ace = 10)', () => {
    const floor = [loose('a', Face.Three, Suit.Spades), loose('b', Face.Six, Suit.Hearts), loose('c', Face.Ace, Suit.Spades), loose('d', Face.King, Suit.Clubs)]
    const hint = captureHintFor(floor, card(Face.Ten, Suit.Hearts))!
    expect(hint.headline).toBe('You must capture with the Ten of Hearts.')
    expect(hint.detail).toBe('It takes the Three, the Six and the Ace (together 10).')
    expect([...hint.ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('explains that every matching set is taken at once', () => {
    const floor = [loose('a', Face.Ten, Suit.Diamonds), loose('b', Face.Three, Suit.Spades), loose('c', Face.Seven, Suit.Clubs), loose('d', Face.King, Suit.Hearts)]
    const hint = captureHintFor(floor, card(Face.Ten, Suit.Hearts))!
    expect(hint.detail).toMatch(/^It takes every matching set at once: /)
    expect(hint.detail).toContain('the Ten')
    expect(hint.detail).toContain('the Three and the Seven (together 10)')
    expect([...hint.ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('says "two Sixes", not "the Six and Six", when cards share a face (a real wording flaw the browser journey found)', () => {
    const twoSixes = captureHintFor([loose('a', Face.Six, Suit.Hearts), loose('b', Face.Six, Suit.Clubs), loose('c', Face.King, Suit.Spades)], card(Face.Queen, Suit.Hearts))!
    expect(twoSixes.detail).toBe('It takes two Sixes (together 12).')
    const mixed = captureHintFor([loose('a', Face.Ace, Suit.Hearts), loose('b', Face.Four, Suit.Clubs), loose('c', Face.Four, Suit.Spades), loose('d', Face.Three, Suit.Hearts)], card(Face.Queen, Suit.Spades))!
    expect(mixed.detail).toBe('It takes the Ace, two Fours and the Three (together 12).')
    const aces = captureHintFor([loose('a', Face.Ace, Suit.Hearts), loose('b', Face.Ace, Suit.Clubs), loose('c', Face.Ace, Suit.Spades), loose('d', Face.Ace, Suit.Diamonds), loose('e', Face.Eight, Suit.Hearts)], card(Face.Queen, Suit.Diamonds))!
    expect(aces.detail).toBe('It takes four Aces and the Eight (together 12).')
    expect(captureHintFor([loose('a', Face.Six, Suit.Hearts), loose('b', Face.Six, Suit.Clubs)], card(Face.Queen, Suit.Hearts))!.detail).not.toMatch(/Six and Six|the Six, Six/)
  })

  it('explains a house on its own, and a house together with loose cards', () => {
    expect(captureHintFor([house('h', 9), loose('a', Face.Two, Suit.Clubs)], card(Face.Nine, Suit.Hearts))!.detail).toBe('There is a house of 9 on the table, and this card matches it.')
    const both = captureHintFor([house('h', 9), loose('a', Face.Nine, Suit.Spades)], card(Face.Nine, Suit.Hearts))!
    expect(both.detail).toBe('It takes the house of 9 and the Nine together.')
    expect([...both.ids].sort()).toEqual(['a', 'h'])
  })

  it('uses plain words only: no internal ids, and the face names the game itself uses', () => {
    const hint = captureHintFor([loose('L7', Face.Jack, Suit.Spades)], card(Face.Jack, Suit.Hearts))!
    expect(hint.headline + hint.detail).not.toMatch(/L7|undefined|\[object/)
    expect(hint.detail).toBe('It matches the Jack on the table.')
  })
})

describe('captureHintFor agrees with the engine over many random positions', () => {
  function mulberry32(seed: number): () => number {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('is there exactly when a capture exists, selects exactly what the engine requires, and names every card it takes', () => {
    const rand = mulberry32(7)
    const faces = Object.values(Face)
    const suits = Object.values(Suit)
    let hints = 0
    for (let n = 0; n < 300; n++) {
      const deck = suits.flatMap((s) => faces.map((f) => card(f, s)))
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
      }
      const k = 2 + Math.floor(rand() * 8)
      const floor: FloorItem[] = deck.slice(0, k).map((c, i) => ({ kind: 'loose', id: `L${i}`, card: c }))
      if (rand() < 0.3) floor.push(house('H', 9 + Math.floor(rand() * 5)))
      const mine = deck[k]!
      const hint = captureHintFor(floor, mine)
      expect(hint !== null, `sample ${n}`).toBe(hasAnyLegalCapture(floor, mine))
      if (!hint) continue
      hints++
      expect([...hint.ids].sort(), `sample ${n}`).toEqual([...requiredCaptureIds(floor, mine)].sort())
      expect(hint.headline).toContain(mine.face)
      for (const id of hint.ids) {
        const item = floor.find((i) => i.id === id)!
        if (item.kind === 'loose') expect(hint.detail, `sample ${n}: ${item.card.face}`).toContain(item.card.face)
      }
      expect(hint.detail).not.toMatch(/undefined|L\d/)
    }
    expect(hints).toBeGreaterThan(80)
  })
})
