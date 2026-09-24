import { type Card, captureValue } from './card'
import {
  type FloorItem,
  findHouseByValue, findItem, hasAnyLegalCapture, isLoose, itemValue,
} from './floor'
import { hasCaptureValue } from './hand'
import { type SeatId, opponentsOf } from './seats'
import { type FourPlayerGameState, legalFourPlayerBids } from './fourPlayerEngine'

/**
 * Every computer decision carries a `reason` — spec §8.9 requires the UI to
 * narrate *why* a computer seat moved, not just what happened, for every
 * seat in every situation (including the user's own partner).
 */
export type ComputerPlayAction4P =
  | { type: 'capture'; card: Card; targetItemIds: string[]; reason: string }
  | { type: 'build'; card: Card; looseItemIds: string[]; targetValue: number; reason: string }
  | { type: 'modify'; card: Card; houseId: string; extraLooseItemIds: string[]; reason: string }
  | { type: 'throw'; card: Card; reason: string }

/** Picks the lowest legal bid — a simple, low-risk default, same as the two-player AI. */
export function chooseFourPlayerBid(state: FourPlayerGameState): number {
  const bids = legalFourPlayerBids(state)
  if (bids.length === 0) throw new Error('Computer has no legal bid.')
  return bids[0]!
}

function findCaptureCombination(floor: FloorItem<SeatId>[], card: Card): string[] | null {
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

function captureOpportunities(floor: FloorItem<SeatId>[], hand: Card[]): number {
  return hand.filter((c) => hasAnyLegalCapture(floor, c)).length
}

/**
 * Chooses the bidder's opening move. Prefers to capture immediately, then
 * to build a house, and only throws the bid card down as a last resort —
 * same priority order as the two-player AI, since no team rules apply yet
 * (no houses exist on the floor before the opening move).
 */
export function chooseFourPlayerOpeningMove(state: FourPlayerGameState): ComputerPlayAction4P {
  const bidValue = state.bidValue!
  const seat = state.bidder
  const hand = state.hands[seat]
  const bidCard = hand.find((c) => captureValue(c) === bidValue)!

  const targets = findCaptureCombination(state.floor, bidCard)
  if (targets) {
    return {
      type: 'capture',
      card: bidCard,
      targetItemIds: targets,
      reason: 'captured with the bid card to open the hand',
    }
  }

  const remainingAfterBid = hand.filter((c) => c !== bidCard)
  const loose = state.floor.filter(isLoose)
  for (const c of remainingAfterBid) {
    if (!hasCaptureValue(remainingAfterBid.filter((x) => x !== c), bidValue)) continue
    const need = bidValue - captureValue(c)
    if (need <= 0) continue
    const combo = subsetSummingTo(loose.map((l) => ({ id: l.id, v: captureValue(l.card) })), need)
    if (combo) {
      return {
        type: 'build',
        card: c,
        looseItemIds: combo,
        targetValue: bidValue,
        reason: `built a house of ${bidValue} to open, keeping the bid card in reserve to capture it later`,
      }
    }
  }

  return {
    type: 'throw',
    card: bidCard,
    reason: 'had no capture or house available for the bid, so threw the bid card down',
  }
}

/**
 * Chooses a computer seat's move on a normal turn (spec §8.10): capture
 * when possible — always, preferring the largest available combination —
 * otherwise throw down whichever card opens the fewest capture
 * opportunities for either opponent (not just one, since there are two).
 *
 * A genuinely team-aware move (cementing or growing a house instead of
 * capturing it outright) was deliberately left out here: any card able to
 * cement or merge toward a partner's house necessarily matches an existing
 * house's value on the floor, which means that same card can always just
 * capture that house directly instead — so with "always capture the best
 * available option" as the first priority, those moves can never actually
 * be reached; they'd only ever compete with a less appealing capture, not
 * with "no capture." Making a simple heuristic weigh "capture now" against
 * "grow the house for later" well is a real judgment call beyond what this
 * AI attempts — the team ownership *rules* are still fully implemented and
 * tested (Phase 3), a human player can use them, but this AI doesn't
 * volunteer to grow a house when it could cash it in instead.
 */
export function chooseFourPlayerMove(state: FourPlayerGameState): ComputerPlayAction4P {
  const seat = state.turn
  const hand = state.hands[seat]

  let bestCapture: { card: Card; targetItemIds: string[]; size: number } | null = null
  for (const card of hand) {
    const combo = findCaptureCombination(state.floor, card)
    if (combo) {
      const size = combo.reduce((t, id) => t + itemValue(findItem(state.floor, id)!), 0)
      if (!bestCapture || size > bestCapture.size) {
        bestCapture = { card, targetItemIds: combo, size }
      }
    }
  }
  if (bestCapture) {
    return {
      type: 'capture',
      card: bestCapture.card,
      targetItemIds: bestCapture.targetItemIds,
      reason: 'captured the largest available combination on the floor',
    }
  }

  let safest = hand[0]!
  let safestScore = Infinity
  const opponentSeats = opponentsOf(seat)
  for (const card of hand) {
    const hypotheticalFloor: FloorItem<SeatId>[] = [
      ...state.floor,
      { kind: 'loose', id: '__hypothetical__', card },
    ]
    const score = opponentSeats.reduce((t, s) => t + captureOpportunities(hypotheticalFloor, state.hands[s]), 0)
    if (score < safestScore || (score === safestScore && captureValue(card) < captureValue(safest))) {
      safest = card
      safestScore = score
    }
  }
  return {
    type: 'throw',
    card: safest,
    reason:
      safestScore === 0
        ? 'threw down a card that gives your opponents no capture at all'
        : 'threw down the card that opens the fewest capture opportunities for your opponents',
  }
}
