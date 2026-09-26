import { type Card, MAX_HOUSE_VALUE, MIN_HOUSE_VALUE, captureValue, isHouseValue, pointValue } from './card'
import {
  type FloorItem, findHouseByValue, findMaximalExactGroups, hasAnyLegalCapture, isLoose, itemValue,
} from './floor'
import { hasCaptureValue } from './hand'
import { type GameState, legalBids } from './gameEngine'

export type ComputerPlayAction =
  | { type: 'capture'; card: Card; targetItemIds: string[]; reason: string }
  | { type: 'build'; card: Card; looseItemIds: string[]; targetValue: number; reason: string }
  | { type: 'throw'; card: Card; reason: string }

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
/**
 * Finds what a card captures: a matching house alone, or every disjoint
 * loose-card group summing to the card's value, combined into one
 * capture — not just one such group (spec §15.5's cementing
 * generalization mirrored onto capturing).
 */
function findCaptureCombination(floor: FloorItem[], card: Card): string[] | null {
  const target = captureValue(card)
  const house = findHouseByValue(floor, target)
  if (house) return [house.id]

  const groups = findMaximalExactGroups(floor, target)
  return groups.length > 0 ? groups.flat() : null
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

/** Counts how many of `hand`'s cards would find a legal capture against `floor`. */
function captureOpportunities(floor: FloorItem[], hand: Card[]): number {
  return hand.filter(c => hasAnyLegalCapture(floor, c)).length
}

/**
 * Finds a house the computer could build this turn: a hand card plus zero
 * or more loose floor cards summing to a house value (9-13) that doesn't
 * already exist on the floor, with a *separate* reserve card of that same
 * value left in hand afterward (required to ever capture the house later).
 * Prefers whichever option clears the most loose cards off the floor, then
 * the highest target value.
 */
function findBuildOption(
  floor: FloorItem[], hand: Card[],
): { card: Card; looseItemIds: string[]; targetValue: number } | null {
  const loose = floor.filter(isLoose)
  let best: { card: Card; looseItemIds: string[]; targetValue: number; looseCount: number } | null = null

  for (const card of hand) {
    const remainingHand = hand.filter((c) => c !== card)
    for (let target = MIN_HOUSE_VALUE; target <= MAX_HOUSE_VALUE; target++) {
      if (findHouseByValue(floor, target)) continue
      if (!hasCaptureValue(remainingHand, target)) continue
      const need = target - captureValue(card)
      if (need < 0) continue

      if (need === 0) {
        if (!best || 0 > best.looseCount || (0 === best.looseCount && target > best.targetValue)) {
          best = { card, looseItemIds: [], targetValue: target, looseCount: 0 }
        }
        continue
      }

      const combo = subsetSummingTo(loose.map((l) => ({ id: l.id, v: captureValue(l.card) })), need)
      if (combo && (!best || combo.length > best.looseCount || (combo.length === best.looseCount && target > best.targetValue))) {
        best = { card, looseItemIds: combo, targetValue: target, looseCount: combo.length }
      }
    }
  }
  return best
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
  if (targets) {
    return {
      type: 'capture', card: bidCard, targetItemIds: targets,
      reason: 'captured with the bid card to open the hand',
    }
  }

  const remainingAfterBid = hand.filter(c => c !== bidCard)
  const loose = state.floor.filter(isLoose)
  for (const c of remainingAfterBid) {
    if (!hasCaptureValue(remainingAfterBid.filter(x => x !== c), bidValue)) continue
    // try to find loose cards + this card summing to bidValue
    const need = bidValue - captureValue(c)
    if (need === 0) continue
    const combo = subsetSummingTo(loose.map(l => ({ id: l.id, v: captureValue(l.card) })), need)
    if (combo) {
      return {
        type: 'build', card: c, looseItemIds: combo, targetValue: bidValue,
        reason: `built a house of ${bidValue} to open, keeping the bid card in reserve to capture it later`,
      }
    }
  }

  return {
    type: 'throw', card: bidCard,
    reason: 'had no capture or house available for the bid, so threw the bid card down',
  }
}

/**
 * Chooses the computer's move on a normal turn:
 * 1. Capture when possible. A capture that would clear the entire floor
 *    (a sweep, worth a real bonus) is always preferred over a merely
 *    bigger-looking partial capture — without this, the AI could pass up
 *    an available sweep in favor of grabbing a single higher-value house.
 *    Among non-sweep options, prefers the biggest haul.
 * 2. Otherwise, build a new house if one can be formed (this is what
 *    actually gets houses onto the floor during real play — without it,
 *    the computer only ever captures or throws, and the build/cement/
 *    break mechanics that define Seep rarely show up).
 * 3. Otherwise, throw down whichever card opens up the fewest capture
 *    opportunities for the opponent; ties are broken by each card's
 *    scoring point value (not its capture value), since those diverge for
 *    every non-spade card — a King of Hearts is worth 0 points and a Two
 *    of Spades is worth 2, so preferring "lower capture value" as the old
 *    tie-break did could actually throw away the more valuable card.
 */
export function chooseComputerMove(state: GameState): ComputerPlayAction {
  const myHand = state.hands.opponent

  let bestCapture: { card: Card; targetItemIds: string[]; size: number; sweeps: boolean } | null = null
  for (const card of myHand) {
    const combo = findCaptureCombination(state.floor, card)
    if (combo) {
      const size = combo.reduce((t, id) => t + itemValue(findItemSafe(state.floor, id)), 0)
      const sweeps = combo.length === state.floor.length
      const better =
        !bestCapture ||
        (sweeps && !bestCapture.sweeps) ||
        (sweeps === bestCapture.sweeps && size > bestCapture.size)
      if (better) {
        bestCapture = { card, targetItemIds: combo, size, sweeps }
      }
    }
  }
  if (bestCapture) {
    return {
      type: 'capture', card: bestCapture.card, targetItemIds: bestCapture.targetItemIds,
      reason: bestCapture.sweeps
        ? 'captured every card on the floor for a sweep bonus'
        : 'captured the largest available combination on the floor',
    }
  }

  const build = findBuildOption(state.floor, myHand)
  if (build) {
    return {
      type: 'build', card: build.card, looseItemIds: build.looseItemIds, targetValue: build.targetValue,
      reason: `built a house of ${build.targetValue}, keeping a reserve card to capture it later`,
    }
  }

  // No capture or house build available — throw the safest card.
  let safest = myHand[0]!
  let safestScore = Infinity
  for (const card of myHand) {
    const hypotheticalFloor: FloorItem[] = [
      ...state.floor,
      { kind: 'loose', id: '__hypothetical__', card },
    ]
    const opponentHand = state.hands.player
    const score = captureOpportunities(hypotheticalFloor, opponentHand)
    if (score < safestScore || (score === safestScore && pointValue(card) < pointValue(safest))) {
      safest = card
      safestScore = score
    }
  }
  return {
    type: 'throw', card: safest,
    reason:
      safestScore === 0
        ? 'threw down a card that gives you no capture at all'
        : 'threw down the card that opens the fewest capture opportunities for you',
  }
}

function findItemSafe(floor: FloorItem[], id: string): FloorItem {
  const item = floor.find(i => i.id === id)
  if (!item) throw new Error(`Floor item ${id} not found`)
  return item
}

export function isValidHouseTarget(value: number): boolean {
  return isHouseValue(value)
}
