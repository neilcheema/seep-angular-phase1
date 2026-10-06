import { MAX_HOUSE_VALUE, MIN_HOUSE_VALUE, captureValue, isHouseValue } from './card'
import { type FloorItem, findHouseByValue, findMaximalExactGroups, isHouse, isLoose, requiredCaptureIds } from './floor'
import { type GameState, type Intent, applyMove } from './gameEngine'
import type { PlayerId } from './player'

/**
 * A build or house change may fold in any subset of the loose cards on the floor, so on a busy floor there are thousands of legal variants
 * (3,000 on a ten-card floor) and confirming each takes the engine about a millisecond. Nobody wants thousands of suggestions, and no real
 * play uses more than a few loose cards (in 2,952 computer turns of simulated play it never used more than this), so by default a build or
 * house change uses at most this many. Captures and throws are always complete. Pass a bigger `maxLooseCards` when every variant is wanted.
 */
export const DEFAULT_MAX_LOOSE_CARDS = 4

/** Past this many loose cards on the floor only captures and throws are listed; the engine's own capture search is slow by then. */
const MAX_LOOSE_FOR_COMBINATIONS = 14

/** The id the engine gives the card being played while it works out which floor cards a new house must pull in. */
const PLAYED_CARD_ID = '__played-card__'

export interface LegalMovesOptions {
  /** The most loose cards one build or house change may use. Default DEFAULT_MAX_LOOSE_CARDS. */
  readonly maxLooseCards?: number
  /**
   * A time limit in milliseconds for the optional part of the list (builds and house changes). When it runs out, what has been found so far is
   * returned: captures and throws are always complete, then builds and house changes using the fewest loose cards first. No limit by default,
   * which makes the result exact and the same on every machine.
   */
  readonly budgetMs?: number
}

function bitCount(x: number): number {
  let count = 0
  for (; x; x &= x - 1) count++
  return count
}

/**
 * Every legal move for `playerId` in this position (capture, build a house, add to or break a house, throw), during the opening move or
 * ordinary play. Empty when it is not that player's turn or the game is in another phase (bidding has its own list, legalBids).
 *
 * How it stays RIGHT, and FAST:
 * - Every candidate is finally checked by the engine itself (applyMove), so a listed move is legal by construction and this list can never
 *   drift from the rules.
 * - Before asking the engine, cheap arithmetic discards candidates the rules certainly refuse (the card totals are wrong; a house of that
 *   value exists; no card is left to capture the new house with; the opening move does not match the bid). Without this the engine would be
 *   asked about thousands of moves.
 * - A build or house change uses at most `maxLooseCards` loose cards, and the list is built simplest-first so that a `budgetMs` can cut it short.
 * - What such shortcuts could get wrong is a legal move going MISSING; that is what legalMoves.test.ts hunts for, against a brute-force
 *   search of every possible move and against the original slow version of this function.
 */
export function legalMoves(state: GameState, playerId: PlayerId = state.turn, options: LegalMovesOptions = {}): Intent[] {
  if ((state.phase !== 'playing' && state.phase !== 'opening-move') || state.turn !== playerId) return []
  const maxLoose = options.maxLooseCards ?? DEFAULT_MAX_LOOSE_CARDS
  const started = Date.now()
  const outOfTime = (): boolean => options.budgetMs !== undefined && Date.now() - started > options.budgetMs

  const hand = state.hands[playerId]
  const loose = state.floor.filter(isLoose)
  const houses = state.floor.filter(isHouse)
  const n = loose.length
  const combinations = n <= MAX_LOOSE_FOR_COMBINATIONS
  const opening = state.phase === 'opening-move'
  const handHasValue = (without: number, value: number) => hand.some((c, i) => i !== without && captureValue(c) === value)

  const result: Intent[] = []
  const confirmed = (intent: Intent): boolean => {
    try {
      applyMove(state, playerId, intent)
      return true
    } catch {
      return false
    }
  }

  // The cards of the hand, each once.
  const cards = hand.map((card, index) => ({ card, index, value: captureValue(card) })).filter((c, i, all) => all.findIndex((o) => o.card.face === c.card.face && o.card.suit === c.card.suit) === i)

  // 1. Captures and throws: always complete, whatever the time limit.
  for (const { card } of cards) {
    const required = requiredCaptureIds(state.floor, card)
    if (required.length > 0) {
      const capture: Intent = { type: 'capture', card, targetItemIds: required }
      if (confirmed(capture)) result.push(capture)
    }
  }
  for (const { card } of cards) {
    const thrown: Intent = { type: 'throw', card }
    if (confirmed(thrown)) result.push(thrown)
  }
  if (!combinations) return result

  // 2. Builds and house changes, using 0 loose cards, then 1, then 2, up to the limit; simplest first.
  const looseValue = loose.map((item) => captureValue(item.card))
  const subsetSum = new Array<number>(1 << n)
  const bySize: number[][] = Array.from({ length: maxLoose + 1 }, () => [])
  subsetSum[0] = 0
  bySize[0]!.push(0)
  for (let mask = 1; mask < 1 << n; mask++) {
    subsetSum[mask] = subsetSum[mask & (mask - 1)]! + looseValue[31 - Math.clz32(mask & -mask)]!
    const size = bitCount(mask)
    if (size <= maxLoose) bySize[size]!.push(mask)
  }
  const idsOf = (mask: number) => loose.filter((_, i) => mask & (1 << i)).map((item) => item.id)

  // For a new house, the engine makes a played card that belongs to a matching group pull in EVERY card of the matching groups. That depends only
  // on the card and the target, so it is worked out once per pair, here, not once per candidate.
  const pulledIn = new Map<string, string[] | null>()
  const requiredPull = (cardIndex: number, target: number): string[] | null => {
    const key = `${cardIndex}|${target}`
    if (!pulledIn.has(key)) {
      const augmented: FloorItem[] = [...state.floor, { kind: 'loose', id: PLAYED_CARD_ID, card: hand[cardIndex]! }]
      const groups = findMaximalExactGroups(augmented, target)
      pulledIn.set(key, groups.some((g) => g.includes(PLAYED_CARD_ID)) ? groups.flat().filter((id) => id !== PLAYED_CARD_ID) : null)
    }
    return pulledIn.get(key)!
  }

  for (let size = 0; size <= maxLoose; size++) {
    for (const { card, index, value } of cards) {
      // A new house of `target`.
      for (let target = MIN_HOUSE_VALUE; target <= MAX_HOUSE_VALUE; target++) {
        if (outOfTime()) return result
        if (findHouseByValue(state.floor, target)) continue // there is one already: add to it instead
        if (opening && target !== state.bidValue) continue // the opening house must be for the bid
        if (!handHasValue(index, target)) continue // another card worth `target` must stay in hand to capture it with
        const pull = requiredPull(index, target)
        const options: Intent[] = []
        if (pull) {
          if (pull.length === size && (value + pull.reduce((t, id) => t + captureValue(loose.find((l) => l.id === id)!.card), 0)) % target === 0) {
            options.push({ type: 'build', card, looseItemIds: pull, targetValue: target })
          }
        } else {
          for (const mask of bySize[size]!) {
            if ((value + subsetSum[mask]!) % target === 0) options.push({ type: 'build', card, looseItemIds: idsOf(mask), targetValue: target })
          }
        }
        for (const build of options) {
          if (outOfTime()) return result
          if (confirmed(build)) result.push(build)
        }
      }
      // Changing an existing house: cement it (a whole number of sets of its value) or break it up to a new value (still 9 to 13).
      if (opening) continue
      for (const house of houses) {
        for (const mask of bySize[size]!) {
          const added = value + subsetSum[mask]!
          const cement = added % house.captureValue === 0 && handHasValue(index, house.captureValue)
          const breakUp = !house.cemented && isHouseValue(house.captureValue + added) && handHasValue(index, house.captureValue + added)
          if (!cement && !breakUp) continue
          if (outOfTime()) return result
          const modify: Intent = { type: 'modify', card, houseId: house.id, extraLooseItemIds: idsOf(mask) }
          if (confirmed(modify)) result.push(modify)
        }
      }
    }
  }
  return result
}
