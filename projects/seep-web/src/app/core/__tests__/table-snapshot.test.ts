import { describe, expect, it } from 'vitest'
import { type Card, type FloorItem, Face, Suit } from 'seep-engine'
import { REPORT_MAX_LENGTH, buildReportBody, cardCode, floorLine, handLine, selectionLine } from '../table-snapshot'

const c = (face: Face, suit: Suit): Card => ({ face, suit })
const loose = (id: string, card: Card): FloorItem<'player' | 'opponent'> => ({ kind: 'loose', id, card })
const house = (id: string, value: number, cards: Card[], owners: ('player' | 'opponent')[], cemented: boolean): FloorItem<'player' | 'opponent'> =>
  ({ kind: 'house', id, cards, captureValue: value, cemented, owners }) as unknown as FloorItem<'player' | 'opponent'>
const owner = (owners: ('player' | 'opponent')[]) => (owners.includes('player') ? 'Yours' : "Opponent's")

// The position the owner described (13 October): three piles on the floor, a loose 6 of Clubs, the 4 of Spades selected.
const FLOOR = [
  house('h11', 11, [c(Face.Jack, Suit.Hearts), c(Face.Eight, Suit.Hearts), c(Face.Three, Suit.Spades)], ['opponent'], true),
  house('h12', 12, [c(Face.Queen, Suit.Clubs), c(Face.Five, Suit.Diamonds), c(Face.Seven, Suit.Diamonds)], ['opponent'], false),
  house('h13', 13, [c(Face.King, Suit.Clubs), c(Face.Ten, Suit.Hearts), c(Face.Three, Suit.Hearts)], ['player'], true),
  loose('six', c(Face.Six, Suit.Clubs)),
]
const HAND = [c(Face.Three, Suit.Clubs), c(Face.Seven, Suit.Hearts), c(Face.Four, Suit.Spades), c(Face.Ten, Suit.Diamonds)]

describe('the table, in words', () => {
  it('writes a card as a short code, with the face as the game shows it', () => {
    expect(cardCode(c(Face.Four, Suit.Spades))).toBe('4S')
    expect(cardCode(c(Face.Ten, Suit.Diamonds))).toBe('10D')
    expect(cardCode(c(Face.Jack, Suit.Hearts))).toBe('JH')
    expect(cardCode(c(Face.Ace, Suit.Clubs))).toBe('AC')
  })
  it('lists the player’s whole hand, with the number of cards, or says there is none', () => {
    expect(handLine('Your hand', HAND)).toBe('Your hand (4): 3C 7H 4S 10D')
    expect(handLine('Your hand', [])).toBe('Your hand (0): none')
  })
  it('lists every pile with its value, owner, whether it is cemented and the cards inside, then the loose cards', () => {
    expect(floorLine(FLOOR, owner)).toBe("Floor: Pile-11 (Opponent's, cemented: JH 8H 3S), Pile-12 (Opponent's: QC 5D 7D), Pile-13 (Yours, cemented: KC 10H 3H), 6C")
    expect(floorLine([], owner)).toBe('Floor: empty')
  })
  it('says what was selected: the hand card and the floor cards or piles, by name', () => {
    expect(selectionLine(c(Face.Four, Suit.Spades), ['six'], FLOOR)).toBe('Selected: 4S; on the floor: 6C')
    expect(selectionLine(c(Face.Queen, Suit.Spades), ['h12', 'six'], FLOOR)).toBe('Selected: QS; on the floor: Pile-12, 6C')
    expect(selectionLine(null, [], FLOOR)).toBe('Selected: no hand card; on the floor: nothing')
    expect(selectionLine(c(Face.Four, Suit.Spades), ['gone'], FLOOR)).toBe('Selected: 4S; on the floor: nothing') // an id that is no longer there is not invented
  })
})

describe('the email body', () => {
  const entry = (n: number) => ({ text: `Move ${n}: You played a card.`, floorSummary: `Floor: something after move ${n}` })
  const log = Array.from({ length: 30 }, (_, i) => entry(i + 1))
  const head = 'What I noticed:\nBuild house was grey.\n\nGame: 2 Player Seep\nVersion: 1.10.3\n'
  const snapshot = [handLine('Your hand', HAND), selectionLine(c(Face.Four, Suit.Spades), ['six'], FLOOR), floorLine(FLOOR, owner)].join('\n')

  it('carries the table: the player’s hand, the selection and the floor, exactly as they were', () => {
    const body = buildReportBody({ head, snapshot, log })
    expect(body).toContain('Table now:\nYour hand (4): 3C 7H 4S 10D\nSelected: 4S; on the floor: 6C\nFloor: Pile-11')
    expect(body).toContain('What I noticed:\nBuild house was grey.')
    expect(body.indexOf('Table now:')).toBeLessThan(body.indexOf('Move log (most recent first):'))
  })
  it('never goes over the limit when the log is long, and keeps the NEWEST moves, newest first', () => {
    const body = buildReportBody({ head, snapshot, log })
    expect(body.length).toBeLessThanOrEqual(REPORT_MAX_LENGTH)
    expect(body).toContain('Move 30:')
    expect(body.indexOf('Move 30:')).toBeLessThan(body.indexOf('Move 29:'))
    expect(body).not.toContain('Move 1:')
    expect(body).toMatch(/\.\.\.\(\d+ earlier move\(s\) omitted for length\)$/)
  })
  it('never goes over the limit, whatever the length of the log or of its lines (the “moves omitted” line is counted too)', () => {
    for (const lineLength of [10, 40, 80, 120, 200]) {
      for (let n = 0; n <= 60; n++) {
        const many = Array.from({ length: n }, (_, i) => ({ text: `Move ${i + 1}: ${'x'.repeat(lineLength)}`, floorSummary: `Floor: ${'y'.repeat(lineLength)}` }))
        const body = buildReportBody({ head, snapshot, log: many })
        expect(body.length, `${n} moves of ${lineLength} characters`).toBeLessThanOrEqual(REPORT_MAX_LENGTH)
        if (n > 0) expect(body, `${n} moves of ${lineLength}`).toContain(`Move ${n}:`) // the newest move is always there when there is room for any
      }
    }
  })
  it('counts the moves it left out correctly', () => {
    const body = buildReportBody({ head, snapshot, log })
    const shown = (body.match(/Move \d+:/g) ?? []).length
    expect(body).toContain(`...(${30 - shown} earlier move(s) omitted for length)`)
  })
  it('leaves out the newest move’s floor (the table section gives it), but keeps the floor of the older ones', () => {
    const body = buildReportBody({ head, snapshot, log })
    expect(body).not.toContain('Floor: something after move 30')
    expect(body).toContain('Floor: something after move 29')
  })
  it('says nothing about omitted moves when everything fits, and copes with an empty log', () => {
    const short = buildReportBody({ head, snapshot, log: [entry(1), entry(2)] })
    expect(short).not.toContain('omitted')
    expect(short).toContain('Move 2:')
    expect(short).toContain('Move 1:')
    const none = buildReportBody({ head, snapshot, log: [] })
    expect(none).toContain('Table now:')
    expect(none.endsWith('Move log (most recent first):\n')).toBe(true)
  })
  it('keeps the table in full even when the player writes a long description', () => {
    const long = buildReportBody({ head: head + 'x'.repeat(1400), snapshot, log })
    expect(long).toContain('Floor: Pile-11')
    expect(long).toContain('Selected: 4S; on the floor: 6C')
  })
})
