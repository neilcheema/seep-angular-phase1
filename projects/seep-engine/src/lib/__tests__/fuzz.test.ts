import { describe, expect, it } from 'vitest'
import { captureValue, isHouseValue } from '../card'
import {
  type GameState, dealNextHand, legalBids, placeBid,
  playBuildHouse, playCapture, playModifyHouse, playThrow,
} from '../gameEngine'
import { findHouseByValue, hasAnyLegalCapture, isHouse, isLoose } from '../floor'
import { hasCaptureValue, removeCard } from '../hand'
import { startMatch } from '../gameEngine'
import type { PlayerId } from '../player'

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function subsetsSummingTo<T extends { id: string }>(
  items: T[], target: number, value: (t: T) => number,
): T[][] {
  const n = items.length
  const results: T[][] = []
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0
    const picked: T[] = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += value(items[i]!)
        picked.push(items[i]!)
      }
    }
    if (sum === target) results.push(picked)
  }
  return results
}

/** Plays one legal move for `playerId` chosen uniformly at random among all legal moves found. */
function playRandomMove(state: GameState, playerId: PlayerId): GameState {
  if (state.phase === 'bidding') {
    return placeBid(state, playerId, rand(legalBids(state)))
  }

  const hand = state.hands[playerId]
  const isOpening = state.phase === 'opening-move'
  const candidates = isOpening ? hand.filter(c => captureValue(c) === state.bidValue) : hand

  type Option = () => GameState
  const options: Option[] = []

  for (const card of candidates) {
    // Capture options: single house, or subsets of loose cards.
    const house = findHouseByValue(state.floor, captureValue(card))
    if (house) options.push(() => playCapture(state, playerId, card, [house.id]))
    const loose = state.floor.filter(isLoose)
    for (const combo of subsetsSummingTo(loose, captureValue(card), i => captureValue(i.card))) {
      options.push(() => playCapture(state, playerId, card, combo.map(i => i.id)))
    }

    // Build options: subsets of loose cards + card summing to a free house value.
    for (let target = 9; target <= 13; target++) {
      if (isOpening && target !== state.bidValue) continue
      if (findHouseByValue(state.floor, target)) continue
      const need = target - captureValue(card)
      if (need < 0) continue
      if (need === 0) {
        if (hasCaptureValue(removeCard(hand, card), target)) {
          options.push(() => playBuildHouse(state, playerId, card, [], target))
        }
        continue
      }
      for (const combo of subsetsSummingTo(loose, need, i => captureValue(i.card))) {
        if (hasCaptureValue(removeCard(hand, card), target)) {
          options.push(() => playBuildHouse(state, playerId, card, combo.map(i => i.id), target))
        }
      }
    }

    if (!isOpening) {
      // Modify-house options: cement or break each house on the floor.
      for (const item of state.floor.filter(isHouse)) {
        if (captureValue(card) === item.captureValue) {
          if (hasCaptureValue(removeCard(hand, card), item.captureValue)) {
            options.push(() => playModifyHouse(state, playerId, card, item.id))
          }
        } else if (!item.cemented) {
          const newValue = item.captureValue + captureValue(card)
          if (isHouseValue(newValue) && hasCaptureValue(removeCard(hand, card), newValue)) {
            options.push(() => playModifyHouse(state, playerId, card, item.id))
          }
        }
      }
    }

    // Throw option.
    if (isOpening || !hasAnyLegalCapture(state.floor, card)) {
      options.push(() => playThrow(state, playerId, card))
    }
  }

  if (options.length === 0) {
    throw new Error(`No legal move found for ${playerId} in phase ${state.phase}`)
  }
  return rand(options)()
}

describe('full game fuzzing', () => {
  it('plays complete randomized matches to a finish without throwing', () => {
    for (let match = 0; match < 8; match++) {
      let state = startMatch(match % 2 === 0 ? 'player' : 'opponent')
      let guard = 0
      while (state.phase !== 'match-over') {
        guard++
        if (guard > 5000) throw new Error('Game did not terminate')
        if (state.phase === 'hand-over') {
          state = dealNextHand(state)
          continue
        }
        state = playRandomMove(state, state.turn)
      }
      expect(state.winner).not.toBeNull()
      expect(Math.abs(state.matchScores.player - state.matchScores.opponent)).toBeGreaterThanOrEqual(100)
    }
  })
})
