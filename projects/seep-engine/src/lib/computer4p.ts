import { type Card, MAX_HOUSE_VALUE, MIN_HOUSE_VALUE, captureValue, pointValue } from './card'
import {
  type FloorItem, type House,
  findHouseByValue, findItem, hasAnyLegalCapture, isHouse, isLoose, itemValue,
} from './floor'
import { hasCaptureValue } from './hand'
import { type SeatId, areTeammates, opponentsOf } from './seats'
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
 * Finds a house this seat could build this turn: a hand card plus zero or
 * more loose floor cards summing to a house value (9-13) that doesn't
 * already exist on the floor, with a *separate* reserve card of that same
 * value left in hand afterward. Prefers whichever option clears the most
 * loose cards, then the highest target value. Ownership always goes to the
 * builder alone (spec §8.5: "a player can only found a house for
 * themselves") — this function doesn't need to special-case that, since
 * playFourPlayerBuildHouse already enforces it.
 */
function findBuildOption(
  floor: FloorItem<SeatId>[], hand: Card[],
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
 * Finds a house on the floor that this seat's partner owns, which this
 * seat could add to for free (spec §8.5 — no reserve card needed when the
 * house belongs to your partner). Only considers the same-value "cement"
 * case, not breaking, since breaking always transfers ownership to the
 * breaker rather than growing the *partner's* stake specifically.
 */
function findFreeTeammateCement(
  floor: FloorItem<SeatId>[], hand: Card[], seat: SeatId,
): { card: Card; houseId: string; value: number } | null {
  for (const item of floor.filter(isHouse)) {
    const h = item as House<SeatId>
    if (!h.owners.some((owner) => areTeammates(owner, seat))) continue
    const match = hand.find((c) => captureValue(c) === h.captureValue)
    if (match) return { card: match, houseId: h.id, value: h.captureValue }
  }
  return null
}

/**
 * Chooses a computer seat's move on a normal turn (spec §8.10):
 * 1. A sweep-capable capture (clears the whole floor) is always taken
 *    immediately — there's no reasonable case for passing one up.
 * 2. Otherwise, a *free* add to a partner's house (spec §8.5 — no reserve
 *    card needed) is preferred over an ordinary, non-sweep capture. This
 *    only works by checking it *before* ordinary captures rather than
 *    after: a card that could cement a partner's house can always capture
 *    that same house directly too, so if captures are checked first, the
 *    cement option can never actually be reached — it would only ever be
 *    competing with a capture, never with "no capture available." Moving
 *    it earlier in priority (behind only sweeps) is what makes it
 *    reachable, and is the fix for a real, observed problem: without it,
 *    a partner would greedily capture its own teammate's small houses
 *    the instant it held a matching card, rather than ever growing them.
 * 3. Otherwise, capture the largest available (non-sweep) combination.
 * 4. Otherwise, build a new house if one can be formed.
 * 5. Otherwise, throw down whichever card opens the fewest capture
 *    opportunities for either opponent; ties are broken by each card's
 *    scoring point value, not its capture value — those diverge for
 *    every non-spade card.
 */
export function chooseFourPlayerMove(state: FourPlayerGameState): ComputerPlayAction4P {
  const seat = state.turn
  const hand = state.hands[seat]

  let bestCapture: { card: Card; targetItemIds: string[]; size: number; sweeps: boolean } | null = null
  for (const card of hand) {
    const combo = findCaptureCombination(state.floor, card)
    if (combo) {
      const size = combo.reduce((t, id) => t + itemValue(findItem(state.floor, id)!), 0)
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

  if (bestCapture?.sweeps) {
    return {
      type: 'capture',
      card: bestCapture.card,
      targetItemIds: bestCapture.targetItemIds,
      reason: 'captured every card on the floor for a sweep bonus',
    }
  }

  const freeCement = findFreeTeammateCement(state.floor, hand, seat)
  if (freeCement) {
    return {
      type: 'modify',
      card: freeCement.card,
      houseId: freeCement.houseId,
      extraLooseItemIds: [],
      reason:
        `added freely to their partner's house of ${freeCement.value}, growing it for the team ` +
        'instead of capturing it immediately',
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

  const build = findBuildOption(state.floor, hand)
  if (build) {
    return {
      type: 'build',
      card: build.card,
      looseItemIds: build.looseItemIds,
      targetValue: build.targetValue,
      reason: `built a house of ${build.targetValue}, keeping a reserve card to capture it later`,
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
    if (score < safestScore || (score === safestScore && pointValue(card) < pointValue(safest))) {
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
