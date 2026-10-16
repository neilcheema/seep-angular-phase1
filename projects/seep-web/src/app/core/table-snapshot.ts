import { type Card, type FloorItem, Suit, faceLabel, isHouse } from 'seep-engine'

/**
 * The text a player's "something felt off" email carries: the table as it stood (their cards, what they had selected, the floor with the cards inside each
 * pile) and the last few moves, so that a problem can be rebuilt from the email alone, without screenshots. Kept free of Angular so it can be tested on its
 * own. Cards are written as short codes (4S, 10D, JH) because the email is a link, and every suit symbol would take nine characters of it.
 */

const SUIT_LETTER: Record<Suit, string> = { [Suit.Spades]: 'S', [Suit.Hearts]: 'H', [Suit.Diamonds]: 'D', [Suit.Clubs]: 'C' }

/** A card as a short code: the face (A, 2 to 10, J, Q, K) and the first letter of the suit, such as 4S or 10D. */
export function cardCode(card: Card): string {
  return `${faceLabel(card.face)}${SUIT_LETTER[card.suit]}`
}

export function cardsLine(cards: Card[]): string {
  return cards.map(cardCode).join(' ')
}

export function handLine(label: string, cards: Card[]): string {
  return `${label} (${cards.length}): ${cards.length > 0 ? cardsLine(cards) : 'none'}`
}

/** The floor now: each pile with its value, owner, whether it is cemented and the cards inside it, then the loose cards. */
export function floorLine<P>(floor: FloorItem<P>[], ownerLabel: (owners: P[]) => string): string {
  if (floor.length === 0) return 'Floor: empty'
  const parts = floor.map((item) =>
    isHouse(item) ? `Pile-${item.captureValue} (${ownerLabel(item.owners)}${item.cemented ? ', cemented' : ''}: ${cardsLine(item.cards)})` : cardCode(item.card),
  )
  return `Floor: ${parts.join(', ')}`
}

/** What the player had selected when they pressed the button: the hand card, and which floor cards or piles. */
export function selectionLine<P>(card: Card | null, floorIds: string[], floor: FloorItem<P>[]): string {
  const picked = floorIds
    .map((id) => floor.find((item) => item.id === id))
    .filter((item): item is FloorItem<P> => item !== undefined)
    .map((item) => (isHouse(item) ? `Pile-${item.captureValue}` : cardCode(item.card)))
  return `Selected: ${card ? cardCode(card) : 'no hand card'}; on the floor: ${picked.length > 0 ? picked.join(', ') : 'nothing'}`
}

export interface ReportLogEntry {
  readonly text: string
  readonly floorSummary: string
}

/** The longest body the email may have: it travels inside a link, and some mail programs refuse long ones. */
export const REPORT_MAX_LENGTH = 1500

/**
 * The whole email body: the head (what the player wrote, game, version, phase), the table now, and as many of the latest moves as fit, newest first.
 * The newest move's floor is left out because the table section already gives the floor as it is now.
 */
export function buildReportBody(options: { head: string; snapshot: string; log: ReportLogEntry[]; maxLength?: number }): string {
  const max = options.maxLength ?? REPORT_MAX_LENGTH
  const header = `${options.head}\nTable now:\n${options.snapshot}\n\nMove log (most recent first):\n`
  const entries = [...options.log].reverse().map((entry, index) => (index === 0 ? entry.text : `${entry.text}\n  ${entry.floorSummary}`))
  const omittedNote = (count: number) => `\n\n...(${count} earlier move(s) omitted for length)`
  // Fill the room that is left with the newest moves. The "N earlier moves omitted" line has to fit too, so when not everything fits, the room is cut by that line first.
  const fill = (room: number) => {
    let text = ''
    let count = 0
    for (const entry of entries) {
      const candidate = text + (text ? '\n\n' : '') + entry
      if ((header + candidate).length > room) break
      text = candidate
      count++
    }
    return { text, count }
  }
  let { text: logText, count: included } = fill(max)
  if (included < entries.length) ({ text: logText, count: included } = fill(max - omittedNote(entries.length).length))
  const omitted = included < entries.length ? omittedNote(entries.length - included) : ''
  return header + logText + omitted
}
