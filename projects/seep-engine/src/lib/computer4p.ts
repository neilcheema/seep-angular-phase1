import { type Card, MAX_HOUSE_VALUE, MIN_HOUSE_VALUE, captureValue, pointValue } from './card'
import {
  type FloorItem, type House,
  findHouseByValue, findItem, findMaximalExactGroups, hasAnyLegalCapture, isHouse, isLoose, itemValue,
  removeItems,
} from './floor'
import { hasCaptureValue } from './hand'
import { type SeatId, areTeammates } from './seats'
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

/**
 * Finds what a card captures: a matching house alone, or — per the
 * maximal-capture rule (spec §15.5's cementing generalization mirrored
 * onto capturing) — every disjoint loose-card group summing to the card's
 * value, combined into one capture, not just one such group.
 */
function findCaptureCombination(floor: FloorItem<SeatId>[], card: Card): string[] | null {
  const target = captureValue(card)
  const house = findHouseByValue(floor, target)
  if (house) return [house.id]

  const groups = findMaximalExactGroups(floor, target)
  return groups.length > 0 ? groups.flat() : null
}

/**
 * How many of the four copies of a given capture value are currently
 * visible to the acting seat: in their own hand, anywhere on the floor
 * (loose or inside a house), or in either team's capture pile. Anything
 * short of four is unaccounted for — somewhere in another player's unseen
 * hand. This is exactly the running tally a careful human player keeps in
 * their head over the course of a hand; the AI is never given access to
 * any hand but its own.
 */
function accountedCopies(value: number, state: FourPlayerGameState, actingSeat: SeatId): number {
  const visible: Card[] = [
    ...state.hands[actingSeat],
    ...state.floor.flatMap((item) => (isHouse(item) ? item.cards : [item.card])),
    ...state.captures.teamA,
    ...state.captures.teamB,
  ]
  return visible.filter((c) => captureValue(c) === value).length
}

/**
 * True if an opponent (not the acting seat or their partner) owns an
 * uncaptured house on the floor at exactly this value. Founding or
 * maintaining a house requires holding a matching reserve card, so a
 * visible opponent house is a direct, public tell about their hand — the
 * same clue a human watching the table would pick up on, not a peek at
 * anything hidden.
 */
function opponentHouseRevealsValue(floor: FloorItem<SeatId>[], value: number, actingSeat: SeatId): boolean {
  return floor.some(
    (item) =>
      isHouse(item) &&
      item.captureValue === value &&
      item.owners.some((o) => o !== actingSeat && !areTeammates(o, actingSeat)),
  )
}

/** True if a card of this value could capture something on the floor, regardless of which card it is. */
function hasCaptureAtValue(floor: FloorItem<SeatId>[], value: number): boolean {
  if (findHouseByValue(floor, value)) return true
  return findMaximalExactGroups(floor, value).length > 0
}

/**
 * True if this value is plausibly still in an opponent's hand: either an
 * opponent's own house on the floor confirms it directly, or fewer than
 * all four copies are visible anywhere the acting seat can actually see
 * (own hand, floor, both capture piles) — meaning the rest are unseen and
 * could be with an opponent. Deliberately conservative: an unseen card
 * could equally be the acting seat's partner's, but with no way to tell
 * which, treating it as a possible risk mirrors how a cautious human
 * player would weigh the same uncertainty.
 */
function isValueAtRisk(value: number, state: FourPlayerGameState, actingSeat: SeatId): boolean {
  if (opponentHouseRevealsValue(state.floor, value, actingSeat)) return true
  return accountedCopies(value, state, actingSeat) < 4
}

/**
 * Deduced exposure score for a hypothetical floor: counts how many
 * distinct, still-plausibly-live values could capture something on it.
 * Replaces counting an opponent's actual matching cards (which would
 * require seeing their hand) with counting values that aren't yet
 * deducibly ruled out — the fair equivalent for picking the safest card
 * to throw.
 */
function deducedRiskScore(floor: FloorItem<SeatId>[], state: FourPlayerGameState, actingSeat: SeatId): number {
  let score = 0
  for (let value = 1; value <= MAX_HOUSE_VALUE; value++) {
    if (hasCaptureAtValue(floor, value) && isValueAtRisk(value, state, actingSeat)) score++
  }
  return score
}

/**
 * True if this exact floor could be swept whole by some value an opponent
 * plausibly still holds — checked by deduction (see isValueAtRisk), not
 * by inspecting any hand directly.
 */
function deducedSweepRisk(floor: FloorItem<SeatId>[], state: FourPlayerGameState, actingSeat: SeatId): boolean {
  if (floor.length === 0) return false
  const loose = floor.filter(isLoose)
  const houses = floor.filter(isHouse)
  if (houses.length > 1) return false

  if (houses.length === 1) {
    if (loose.length > 0) return false
    return isValueAtRisk(houses[0]!.captureValue, state, actingSeat)
  }

  for (let value = 1; value <= MAX_HOUSE_VALUE; value++) {
    const groups = findMaximalExactGroups(floor, value)
    if (loose.length > 0 && groups.flat().length === loose.length && isValueAtRisk(value, state, actingSeat)) {
      return true
    }
  }
  return false
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
/**
 * Finds the best house the computer could found this turn — including
 * multi-set opportunities: if a hand card, together with the loose floor
 * cards, can form more than one complete set of some target value (e.g. a
 * played 4, a loose 9, and two separate loose Kings all combine into one
 * house of 13 holding three sets), this finds the full required
 * combination the same way the engine itself computes it, and prefers
 * whichever (card, target) pairing delivers the most total value.
 */
function findBuildOption(
  floor: FloorItem<SeatId>[], hand: Card[],
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
      const augmented: FloorItem<SeatId>[] = [...floor, { kind: 'loose', id: virtualId, card }]
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
  let bestOpenBuild: { card: Card; looseItemIds: string[]; multiple: number; totalValue: number } | null = null
  for (const c of remainingAfterBid) {
    if (!hasCaptureValue(remainingAfterBid.filter((x) => x !== c), bidValue)) continue
    const virtualId = '__card__'
    const augmented: FloorItem<SeatId>[] = [...state.floor, { kind: 'loose', id: virtualId, card: c }]
    const groups = findMaximalExactGroups(augmented, bidValue)
    const cardGroup = groups.find((g) => g.includes(virtualId))
    if (!cardGroup) continue
    const looseItemIds = groups.flat().filter((id) => id !== virtualId)
    const multiple = groups.length
    const totalValue = multiple * bidValue
    if (!bestOpenBuild || totalValue > bestOpenBuild.totalValue) {
      bestOpenBuild = { card: c, looseItemIds, multiple, totalValue }
    }
  }
  if (bestOpenBuild) {
    return {
      type: 'build',
      card: bestOpenBuild.card,
      looseItemIds: bestOpenBuild.looseItemIds,
      targetValue: bidValue,
      reason:
        bestOpenBuild.multiple > 1
          ? `built a house of ${bidValue} to open (${bestOpenBuild.multiple}\u00d7 its value, already cemented), ` +
            'keeping the bid card in reserve to capture it later'
          : `built a house of ${bidValue} to open, keeping the bid card in reserve to capture it later`,
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
/**
 * True if some opponent hand contains a card that would sweep this exact
 * floor whole on their next turn. Checking actual opponent hands directly
 * is consistent with how this AI already evaluates throw safety further
 * below (it already inspects opponent hands there too) — the same
 * semi-omniscient risk assessment, just applied one step earlier, before
 * committing to a capture rather than only when picking a throw.
 */
/**
 * Finds the safest card to throw instead — restricted to cards with no
 * capture of their own available (mandatory capture would otherwise block
 * throwing them), preferring whichever leaves the fewest deduced exposure
 * on the resulting floor. Returns null if every card in hand can capture
 * something, in which case there is no safer alternative to fall back to.
 */
function findSaferThrow(floor: FloorItem<SeatId>[], hand: Card[], state: FourPlayerGameState, actingSeat: SeatId): Card | null {
  let safest: Card | null = null
  let safestScore = Infinity
  for (const card of hand) {
    if (hasAnyLegalCapture(floor, card)) continue
    const hypotheticalFloor: FloorItem<SeatId>[] = [...floor, { kind: 'loose', id: '__hypothetical__', card }]
    const score = deducedRiskScore(hypotheticalFloor, state, actingSeat)
    if (!safest || score < safestScore || (score === safestScore && pointValue(card) < pointValue(safest))) {
      safest = card
      safestScore = score
    }
  }
  return safest
}

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
    const floorAfter = removeItems(state.floor, bestCapture.targetItemIds)
    if (deducedSweepRisk(floorAfter, state, seat)) {
      const saferThrow = findSaferThrow(state.floor, hand, state, seat)
      if (saferThrow) {
        return {
          type: 'throw',
          card: saferThrow,
          reason:
            'held back an available capture that would have left an opponent a likely sweep, ' +
            'and threw a safer card instead',
        }
      }
    }
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
      reason:
        build.multiple > 1
          ? `built a house of ${build.targetValue} (${build.multiple}\u00d7 its value, already cemented), ` +
            'keeping a reserve card to capture it later'
          : `built a house of ${build.targetValue}, keeping a reserve card to capture it later`,
    }
  }

  let safest = hand[0]!
  let safestScore = Infinity
  for (const card of hand) {
    const hypotheticalFloor: FloorItem<SeatId>[] = [
      ...state.floor,
      { kind: 'loose', id: '__hypothetical__', card },
    ]
    const score = deducedRiskScore(hypotheticalFloor, state, seat)
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
        ? 'threw down a card that gives your opponents no likely capture at all'
        : 'threw down the card that opens the fewest deduced capture risks for your opponents',
  }
}
