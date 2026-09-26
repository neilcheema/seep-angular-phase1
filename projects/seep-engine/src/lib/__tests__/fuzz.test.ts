import { describe, expect, it } from 'vitest'
import { captureValue, isHouseValue } from '../card.ts'
import {
  type GameState, dealNextHand, legalBids,
  placeBid, playBuildHouse, playCapture, playModifyHouse, playThrow,
} from '../gameEngine.ts'
import { findHouseByValue, findMaximalExactGroups, hasAnyLegalCapture, isHouse } from '../floor.ts'
import { hasCaptureValue, removeCard } from '../hand.ts'
import { startMatch } from '../gameEngine.ts'
import type { PlayerId } from '../player.ts'

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

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
    const house = findHouseByValue(state.floor, captureValue(card))
    if (house) options.push(() => playCapture(state, playerId, card, [house.id]))
    const maxGroups = findMaximalExactGroups(state.floor, captureValue(card))
    if (maxGroups.length > 0) {
      options.push(() => playCapture(state, playerId, card, maxGroups.flat()))
    }

    for (let target = 9; target <= 13; target++) {
      if (isOpening && target !== state.bidValue) continue
      if (findHouseByValue(state.floor, target)) continue
      if (!hasCaptureValue(removeCard(hand, card), target)) continue

      const virtualId = '__card__'
      const augmented = [...state.floor, { kind: 'loose' as const, id: virtualId, card }]
      const groups = findMaximalExactGroups(augmented, target)
      const cardGroup = groups.find(g => g.includes(virtualId))
      if (!cardGroup) continue
      const looseItemIds = groups.flat().filter(id => id !== virtualId)
      options.push(() => playBuildHouse(state, playerId, card, looseItemIds, target))
    }

    if (!isOpening) {
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
