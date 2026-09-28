import { type Card, MAX_HOUSE_VALUE, MIN_HOUSE_VALUE, captureValue, isHouseValue, pointValue } from './card'
import {
  type FloorItem, findHouseByValue, findMaximalExactGroups, hasAnyLegalCapture, isHouse, isLoose,
  itemValue, removeItems,
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
/**
 * Finds what a card captures: a matching house, combined with every
 * disjoint loose-card group also summing to the card's value (a house at
 * exactly the played value and any separate loose groups are independent
 * matches to the same card and must all be taken together).
 */
function findCaptureCombination(floor: FloorItem[], card: Card): string[] | null {
  const target = captureValue(card)
  const house = findHouseByValue(floor, target)
  const groups = findMaximalExactGroups(floor, target)
  const ids = house ? [house.id, ...groups.flat()] : groups.flat()
  return ids.length > 0 ? ids : null
}

/**
 * How many of the four copies of a given capture value are currently
 * visible to the computer: in its own hand, anywhere on the floor (loose
 * or inside a house), or in either player's capture pile. Anything short
 * of four is unaccounted for — in the human's unseen hand. This is the
 * same running tally a careful human player keeps in their head over a
 * hand; the AI is never given access to the human's actual hand.
 */
function accountedCopies(value: number, state: GameState): number {
  const visible: Card[] = [
    ...state.hands.opponent,
    ...state.floor.flatMap((item) => (isHouse(item) ? item.cards : [item.card])),
    ...state.captures.player,
    ...state.captures.opponent,
  ]
  return visible.filter(c => captureValue(c) === value).length
}

/**
 * True if the human owns an uncaptured house on the floor at exactly this
 * value. Founding or maintaining a house requires holding a matching
 * reserve card, so a visible house is a direct, public tell — the same
 * clue a human opponent watching the table would pick up on.
 */
function playerHouseRevealsValue(floor: FloorItem[], value: number): boolean {
  return floor.some(item => isHouse(item) && item.captureValue === value && item.owners.includes('player'))
}

/** True if a card of this value could capture something on the floor, regardless of which card it is. */
function hasCaptureAtValue(floor: FloorItem[], value: number): boolean {
  if (findHouseByValue(floor, value)) return true
  return findMaximalExactGroups(floor, value).length > 0
}

/**
 * True if this value is plausibly still in the human's hand: either their
 * own house on the floor confirms it directly, or fewer than all four
 * copies are visible anywhere the computer can actually see (own hand,
 * floor, both capture piles) — meaning the rest must be in the human's
 * unseen hand (there is only one other hand in a two-player game, so this
 * is exact, not a guess).
 */
function isValueAtRisk(value: number, state: GameState): boolean {
  if (playerHouseRevealsValue(state.floor, value)) return true
  return accountedCopies(value, state) < 4
}

/** Deduced exposure score for a hypothetical floor: how many distinct, still-plausibly-live values could capture something on it. */
function deducedRiskScore(floor: FloorItem[], state: GameState): number {
  let score = 0
  for (let value = 1; value <= MAX_HOUSE_VALUE; value++) {
    if (hasCaptureAtValue(floor, value) && isValueAtRisk(value, state)) score++
  }
  return score
}

/** True if this exact floor could be swept whole by some value the human plausibly still holds. */
function deducedSweepRisk(floor: FloorItem[], state: GameState): boolean {
  if (floor.length === 0) return false
  const loose = floor.filter(isLoose)
  const houses = floor.filter(isHouse)
  if (houses.length > 1) return false

  if (houses.length === 1) {
    if (loose.length > 0) return false
    return isValueAtRisk(houses[0]!.captureValue, state)
  }

  for (let value = 1; value <= MAX_HOUSE_VALUE; value++) {
    const groups = findMaximalExactGroups(floor, value)
    if (loose.length > 0 && groups.flat().length === loose.length && isValueAtRisk(value, state)) return true
  }
  return false
}

/**
 * Finds the safest card to throw instead — restricted to cards with no
 * capture of their own available (mandatory capture would otherwise block
 * throwing them), preferring whichever leaves the fewest deduced exposure
 * on the resulting floor. Returns null if every card in hand can capture
 * something, in which case there is no safer alternative to fall back to.
 */
function findSaferThrow(floor: FloorItem[], hand: Card[], state: GameState): Card | null {
  let safest: Card | null = null
  let safestScore = Infinity
  for (const card of hand) {
    if (hasAnyLegalCapture(floor, card)) continue
    const hypotheticalFloor: FloorItem[] = [...floor, { kind: 'loose', id: '__hypothetical__', card }]
    const score = deducedRiskScore(hypotheticalFloor, state)
    if (!safest || score < safestScore || (score === safestScore && pointValue(card) < pointValue(safest))) {
      safest = card
      safestScore = score
    }
  }
  return safest
}

/**
 * Finds a house the computer could build this turn: a hand card plus zero
 * or more loose floor cards summing to a house value (9-13) that doesn't
 * already exist on the floor, with a *separate* reserve card of that same
 * value left in hand afterward (required to ever capture the house later).
 * Prefers whichever option clears the most loose cards off the floor, then
 * the highest target value.
 */
/**
 * Finds the best house the computer could found this turn — including
 * multi-set opportunities: if a hand card, together with the loose floor
 * cards, can form more than one complete set of some target value, this
 * finds the full required combination the same way the engine itself
 * computes it, and prefers whichever (card, target) pairing delivers the
 * most total value.
 */
function findBuildOption(
  floor: FloorItem[], hand: Card[],
): { card: Card; looseItemIds: string[]; targetValue: number; multiple: number } | null {
  let best:
    | { card: Card; looseItemIds: string[]; targetValue: number; multiple: number; totalValue: number }
    | null = null

  for (const card of hand) {
    const remainingHand = hand.filter((c) => c !== card)
    for (let target = MIN_HOUSE_VALUE; target <= MAX_HOUSE_VALUE; target++) {
      if (findHouseByValue(floor, target)) continue
      if (!hasCaptureValue(remainingHand, target)) continue

      const virtualId = '__card__'
      const augmented: FloorItem[] = [...floor, { kind: 'loose', id: virtualId, card }]
      const groups = findMaximalExactGroups(augmented, target)
      const cardGroup = groups.find((g) => g.includes(virtualId))
      if (!cardGroup) continue

      const looseItemIds = groups.flat().filter((id) => id !== virtualId)
      const multiple = groups.length
      const totalValue = multiple * target
      if (!best || totalValue > best.totalValue) {
        best = { card, looseItemIds, targetValue: target, multiple, totalValue }
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
  let bestOpenBuild: { card: Card; looseItemIds: string[]; multiple: number; totalValue: number } | null = null
  for (const c of remainingAfterBid) {
    if (!hasCaptureValue(remainingAfterBid.filter(x => x !== c), bidValue)) continue
    if (captureValue(c) === bidValue) continue // degenerate case, same as before: no loose cards needed
    const virtualId = '__card__'
    const augmented: FloorItem[] = [...state.floor, { kind: 'loose', id: virtualId, card: c }]
    const groups = findMaximalExactGroups(augmented, bidValue)
    const cardGroup = groups.find(g => g.includes(virtualId))
    if (!cardGroup) continue
    const looseItemIds = groups.flat().filter(id => id !== virtualId)
    const multiple = groups.length
    const totalValue = multiple * bidValue
    if (!bestOpenBuild || totalValue > bestOpenBuild.totalValue) {
      bestOpenBuild = { card: c, looseItemIds, multiple, totalValue }
    }
  }
  if (bestOpenBuild) {
    return {
      type: 'build', card: bestOpenBuild.card, looseItemIds: bestOpenBuild.looseItemIds, targetValue: bidValue,
      reason:
        bestOpenBuild.multiple > 1
          ? `built a house of ${bidValue} to open (${bestOpenBuild.multiple}\u00d7 its value, already cemented), ` +
            'keeping the bid card in reserve to capture it later'
          : `built a house of ${bidValue} to open, keeping the bid card in reserve to capture it later`,
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
    if (!bestCapture.sweeps) {
      const floorAfter = removeItems(state.floor, bestCapture.targetItemIds)
      if (deducedSweepRisk(floorAfter, state)) {
        const saferThrow = findSaferThrow(state.floor, myHand, state)
        if (saferThrow) {
          return {
            type: 'throw',
            card: saferThrow,
            reason:
              'held back an available capture that would have left the opponent a likely sweep, ' +
              'and threw a safer card instead',
          }
        }
      }
    }
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
      reason:
        build.multiple > 1
          ? `built a house of ${build.targetValue} (${build.multiple}\u00d7 its value, already cemented), ` +
            'keeping a reserve card to capture it later'
          : `built a house of ${build.targetValue}, keeping a reserve card to capture it later`,
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
    const score = deducedRiskScore(hypotheticalFloor, state)
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
