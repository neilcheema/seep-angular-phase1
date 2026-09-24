import { describe, expect, it } from 'vitest'
import { captureValue, isHouseValue, type Card } from '../card'
import { hasCaptureValue, removeCard } from '../hand'
import { findHouseByValue, isHouse, isLoose, type House } from '../floor'
import { ALL_SEATS, SeatId, areTeammates, type SeatId as SeatIdType } from '../seats'
import {
  type FourPlayerGameState,
  dealNextFourPlayerHand,
  legalFourPlayerBids,
  placeFourPlayerBid,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
  startFourPlayerMatch,
} from '../fourPlayerEngine'

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

/** Plays one legal move for the seat whose turn it is, chosen uniformly at random among all found. */
function playRandomMove(state: FourPlayerGameState): FourPlayerGameState {
  if (state.phase === 'bidding') {
    return placeFourPlayerBid(state, state.turn, rand(legalFourPlayerBids(state)))
  }

  const seat = state.turn
  const hand = state.hands[seat]
  const isOpening = state.phase === 'opening-move'
  const candidates = isOpening ? hand.filter((c) => captureValue(c) === state.bidValue) : hand

  type Option = () => FourPlayerGameState
  const options: Option[] = []

  for (const card of candidates) {
    // Capture: a matching house, or any subset of loose cards summing to the card's value.
    const house = findHouseByValue(state.floor, captureValue(card))
    if (house) options.push(() => playFourPlayerCapture(state, seat, card, [house.id]))
    const loose = state.floor.filter(isLoose)
    for (const combo of subsetsSummingTo(loose, captureValue(card), (i) => captureValue(i.card))) {
      options.push(() => playFourPlayerCapture(state, seat, card, combo.map((i) => i.id)))
    }

    // Build: subsets of loose cards + card summing to a free house value.
    for (let target = 9; target <= 13; target++) {
      if (isOpening && target !== state.bidValue) continue
      if (findHouseByValue(state.floor, target)) continue
      const need = target - captureValue(card)
      if (need < 0) continue
      if (need === 0) {
        if (hasCaptureValue(removeCard(hand, card), target)) {
          options.push(() => playFourPlayerBuildHouse(state, seat, card, [], target))
        }
        continue
      }
      for (const combo of subsetsSummingTo(loose, need, (i) => captureValue(i.card))) {
        if (hasCaptureValue(removeCard(hand, card), target)) {
          options.push(() => playFourPlayerBuildHouse(state, seat, card, combo.map((i) => i.id), target))
        }
      }
    }

    // Cement / break existing houses — exercises the §8.5 team-ownership rules directly.
    if (!isOpening) {
      for (const item of state.floor.filter(isHouse)) {
        const h = item as House<SeatIdType>
        if (captureValue(card) === h.captureValue) {
          const isPartnersHouse = h.owners.some((owner) => areTeammates(owner, seat))
          if (isPartnersHouse || hasCaptureValue(removeCard(hand, card), h.captureValue)) {
            options.push(() => playFourPlayerModifyHouse(state, seat, card, h.id))
          }
        } else if (!h.cemented && !h.owners.includes(seat)) {
          const newValue = h.captureValue + captureValue(card)
          if (isHouseValue(newValue) && hasCaptureValue(removeCard(hand, card), newValue)) {
            options.push(() => playFourPlayerModifyHouse(state, seat, card, h.id))
          }
        }
      }
    }

    // Throw.
    if (isOpening || !hasAnyLegalCaptureForCard(state, card)) {
      options.push(() => playFourPlayerThrow(state, seat, card))
    }
  }

  if (options.length === 0) {
    throw new Error(`No legal move found for ${seat} in phase ${state.phase}`)
  }
  return rand(options)()
}

function hasAnyLegalCaptureForCard(state: FourPlayerGameState, card: Card): boolean {
  const target = captureValue(card)
  if (findHouseByValue(state.floor, target)) return true
  const loose = state.floor.filter(isLoose)
  return subsetsSummingTo(loose, target, (i) => captureValue(i.card)).length > 0
}

describe('full four-player game fuzzing', () => {
  it('plays complete randomized team matches to a finish without throwing', () => {
    for (let match = 0; match < 6; match++) {
      let state = startFourPlayerMatch(rand(ALL_SEATS as SeatId[]))
      let guard = 0
      while (state.phase !== 'match-over') {
        guard++
        if (guard > 8000) throw new Error('Game did not terminate')
        if (state.phase === 'hand-over') {
          state = dealNextFourPlayerHand(state)
          continue
        }
        state = playRandomMove(state)
      }
      expect(state.winner).not.toBeNull()
      const lead = Math.abs(state.matchScores.teamA - state.matchScores.teamB)
      expect(lead).toBeGreaterThanOrEqual(100)
    }
  })
})
