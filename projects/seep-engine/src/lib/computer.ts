import { type Card, captureValue, isHouseValue } from './card'
import {
  type FloorItem, findHouseByValue, hasAnyLegalCapture, isLoose, itemValue,
} from './floor'
import { hasCaptureValue } from './hand'
import { type GameState, legalBids } from './gameEngine'

export type ComputerPlayAction =
  | { type: 'capture'; card: Card; targetItemIds: string[] }
  | { type: 'build'; card: Card; looseItemIds: string[]; targetValue: number }
  | { type: 'throw'; card: Card }

/** Picks the lowest legal bid — a simple, low-risk default. */
export function chooseComputerBid(state: GameState): number {
  const bids = legalBids(state)
  if (bids.length === 0) throw new Error('Computer has no legal bid.')
  return bids[0]!
}

/**
 * Finds a combination of floor items a given card can capture.
 * Prefers an existing house of matching value; otherwise looks for the
 * smallest set of loose cards that sum to the target.
 */
function findCaptureCombination(floor: FloorItem[], card: Card): string[] | null {
  const target = captureValue(card)
  const house = findHouseByValue(floor, target)
  if (house) return [house.id]

  const loose = floor.filter(isLoose)
  const n = loose.length
  let best: string[] | null = null
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += captureValue(loose[i]!.card)
        ids.push(loose[i]!.id)
      }
    }
    if (sum === target && (!best || ids.length < best.length)) best = ids
  }
  return best
}

/** Counts how many of `hand`'s cards would find a legal capture against `floor`. */
function captureOpportunities(floor: FloorItem[], hand: Card[]): number {
  return hand.filter(c => hasAnyLegalCapture(floor, c)).length
}

/**
 * Chooses the computer's opening move once it has bid. Prefers to capture
 * immediately, then to build a house, and only throws the bid card down as
 * a last resort.
 */
export function chooseComputerOpeningMove(state: GameState): ComputerPlayAction {
  const bidValue = state.bidValue!
  const hand = state.hands[state.bidder]
  const bidCard = hand.find(c => captureValue(c) === bidValue)!

  const targets = findCaptureCombination(state.floor, bidCard)
  if (targets) return { type: 'capture', card: bidCard, targetItemIds: targets }

  const remainingAfterBid = hand.filter(c => c !== bidCard)
  const loose = state.floor.filter(isLoose)
  for (const c of remainingAfterBid) {
    if (!hasCaptureValue(remainingAfterBid.filter(x => x !== c), bidValue)) continue
    // try to find loose cards + this card summing to bidValue
    const need = bidValue - captureValue(c)
    if (need === 0) continue
    const combo = subsetSummingTo(loose.map(l => ({ id: l.id, v: captureValue(l.card) })), need)
    if (combo) return { type: 'build', card: c, looseItemIds: combo, targetValue: bidValue }
  }

  return { type: 'throw', card: bidCard }
}

function subsetSummingTo(items: { id: string; v: number }[], target: number): string[] | null {
  const n = items.length
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += items[i]!.v
        ids.push(items[i]!.id)
      }
    }
    if (sum === target) return ids
  }
  return null
}

/**
 * Chooses the computer's move on a normal turn. Captures whenever possible
 * (preferring the biggest haul), otherwise throws down whichever card opens
 * up the fewest capture opportunities for the opponent.
 */
export function chooseComputerMove(state: GameState): ComputerPlayAction {
  const myHand = state.hands.opponent

  let bestCapture: { card: Card; targetItemIds: string[]; size: number } | null = null
  for (const card of myHand) {
    const combo = findCaptureCombination(state.floor, card)
    if (combo) {
      const size = combo.reduce((t, id) => t + itemValue(findItemSafe(state.floor, id)), 0)
      if (!bestCapture || size > bestCapture.size) {
        bestCapture = { card, targetItemIds: combo, size }
      }
    }
  }
  if (bestCapture) {
    return { type: 'capture', card: bestCapture.card, targetItemIds: bestCapture.targetItemIds }
  }

  // No capture available — throw the safest card.
  let safest = myHand[0]!
  let safestScore = Infinity
  for (const card of myHand) {
    const hypotheticalFloor: FloorItem[] = [
      ...state.floor,
      { kind: 'loose', id: '__hypothetical__', card },
    ]
    const opponentHand = state.hands.player
    const score = captureOpportunities(hypotheticalFloor, opponentHand)
    if (score < safestScore || (score === safestScore && captureValue(card) < captureValue(safest))) {
      safest = card
      safestScore = score
    }
  }
  return { type: 'throw', card: safest }
}

function findItemSafe(floor: FloorItem[], id: string): FloorItem {
  const item = floor.find(i => i.id === id)
  if (!item) throw new Error(`Floor item ${id} not found`)
  return item
}

export function isValidHouseTarget(value: number): boolean {
  return isHouseValue(value)
}
