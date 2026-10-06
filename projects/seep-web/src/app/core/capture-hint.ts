import { type Card, type FloorItem, captureValue, findHouseByValue, findItem, findMaximalExactGroups, requiredCaptureIds } from 'seep-engine'

/** Why a card cannot be thrown: it has to capture. `ids` are the floor items that capture would take, ready to select. */
export interface CaptureHint {
  /** "You must capture with the Six of Hearts." */
  readonly headline: string
  /** Which cards it would take, in plain words. */
  readonly detail: string
  /** The floor items a capture with this card must take, all at once. */
  readonly ids: string[]
}

/** "A", "A and B", "A, B and C". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const plural = (face: string): string => (face.endsWith('x') ? `${face}es` : `${face}s`)

/** "the Three, the Six and the Ace", or "two Sixes" when cards share a face (never "the Six and Six"). */
function cardsText(faces: string[]): string {
  const counts = new Map<string, number>()
  for (const face of faces) counts.set(face, (counts.get(face) ?? 0) + 1)
  return joinList([...counts].map(([face, n]) => (n === 1 ? `the ${face}` : `${NUMBER_WORDS[n] ?? n} ${plural(face)}`)))
}

/**
 * Explains, for a beginner, why Throw is greyed out for `card`: a capture is available, and a capture is compulsory. Null when the card may be
 * thrown (nothing to capture). The cards to take come from the engine (requiredCaptureIds and findMaximalExactGroups), the very rule it enforces.
 */
export function captureHintFor<P>(floor: FloorItem<P>[], card: Card): CaptureHint | null {
  const ids = requiredCaptureIds(floor, card)
  if (ids.length === 0) return null

  const value = captureValue(card)
  const house = findHouseByValue(floor, value)
  const groups = findMaximalExactGroups(floor, value).map((group) =>
    group.map((id) => findItem(floor, id)).flatMap((item) => (item?.kind === 'loose' ? [item.card.face] : [])),
  )
  const groupText = (faces: string[]): string => (faces.length === 1 ? `the ${faces[0]}` : `${cardsText(faces)} (together ${value})`)

  let detail: string
  if (groups.length === 0) {
    detail = `There is a house of ${value} on the table, and this card matches it.`
  } else if (house) {
    detail = `It takes the house of ${value} and ${joinList(groups.map(groupText))} together.`
  } else if (groups.length === 1 && groups[0]!.length === 1) {
    detail = `It matches the ${groups[0]![0]} on the table.`
  } else if (groups.length === 1) {
    detail = `It takes ${cardsText(groups[0]!)} (together ${value}).`
  } else {
    detail = `It takes every matching set at once: ${joinList(groups.map(groupText))}.`
  }
  return { headline: `You must capture with the ${card.face} of ${card.suit}.`, detail, ids }
}
