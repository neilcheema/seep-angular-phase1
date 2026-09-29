import { describe, expect, it } from 'vitest'
import { type Card, captureValue } from '../card.ts'
import { findHouseByValue, findMaximalExactGroups } from '../floor.ts'
import {
  type GameState, dealNextHand, legalBids, placeBid, playCapture, playThrow, startMatch, viewFor,
} from '../gameEngine.ts'
import { SeatId } from '../seats.ts'
import {
  type FourPlayerGameState, dealNextFourPlayerHand, legalFourPlayerBids,
  placeFourPlayerBid, playFourPlayerCapture, playFourPlayerThrow, startFourPlayerMatch, viewForSeat,
} from '../fourPlayerEngine.ts'

const key = (c: Card) => `${c.face}-${c.suit}`

/** Every literal Card object findable anywhere in an arbitrary JSON-ish value. */
function cardsIn(value: unknown, seen = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    if ('face' in value && 'suit' in value) seen.add(key(value as Card))
    for (const v of Object.values(value)) cardsIn(v, seen)
  }
  return seen
}

/**
 * Not aiming to be a good player, or even to exercise every move type —
 * the rule-correctness fuzz tests already do that exhaustively. This only
 * needs to drive a real, valid game through every phase (bidding, the
 * opening move, normal play, hand changeovers) so viewFor/viewForSeat get
 * checked against a wide variety of real states below.
 */
function chooseCard(floor: unknown, hand: Card[], target: number): { card: Card; ids: string[] } | null {
  const groups = findMaximalExactGroups(floor as never, target)
  const house = findHouseByValue(floor as never, target)
  const ids = house ? [house.id, ...groups.flat()] : groups.flat()
  if (ids.length === 0) return null
  const card = hand.find((c) => captureValue(c) === target) ?? hand[0]!
  return { card, ids }
}

describe('viewFor never leaks hidden information (two-player)', () => {
  it('across many full randomized matches, no view ever contains an opponent card or a pending-deal card', () => {
    for (let m = 0; m < 15; m++) {
      let state: GameState = startMatch(m % 2 === 0 ? 'player' : 'opponent')
      let guard = 0
      while (state.phase !== 'match-over' && guard++ < 500) {
        if (state.phase === 'hand-over') { state = dealNextHand(state); continue }

        checkView(state, 'player')
        checkView(state, 'opponent')

        if (state.phase === 'bidding') {
          state = placeBid(state, state.bidder, legalBids(state)[0]!)
          continue
        }

        const acting = state.turn
        const hand = state.hands[acting]
        if (state.phase === 'opening-move') {
          const bidCard = hand.find((c) => captureValue(c) === state.bidValue)!
          const found = chooseCard(state.floor, [bidCard], state.bidValue!)
          state = found ? playCapture(state, acting, found.card, found.ids) : playThrow(state, acting, bidCard)
          continue
        }
        const found = hand.map((c) => chooseCard(state.floor, [c], captureValue(c))).find((f) => f)
        state = found ? playCapture(state, acting, found.card, found.ids) : playThrow(state, acting, hand[0]!)
      }
    }

    function checkView(state: GameState, viewer: 'player' | 'opponent') {
      const view = viewFor(state, viewer)
      const visible = cardsIn(view)
      const opponent = viewer === 'player' ? 'opponent' : 'player'
      for (const hidden of state.hands[opponent]) {
        expect(visible.has(key(hidden)), `view for ${viewer} leaked opponent card ${key(hidden)}`).toBe(false)
      }
      if (state.pendingDeal) {
        for (const seatCards of Object.values(state.pendingDeal)) {
          for (const hidden of seatCards) {
            expect(visible.has(key(hidden)), `view for ${viewer} leaked a pending-deal card ${key(hidden)}`).toBe(false)
          }
        }
      }
      expect(view.myHand).toEqual(state.hands[viewer])
      expect('pendingDeal' in view).toBe(false)
    }
  })
})

describe('viewForSeat never leaks hidden information (four-player)', () => {
  it('across many full randomized matches, no view ever contains another seat\u2019s card or a pending-deal card', () => {
    const seats = [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]
    for (let m = 0; m < 8; m++) {
      let state: FourPlayerGameState = startFourPlayerMatch(seats[m % 4]!)
      let guard = 0
      while (state.phase !== 'match-over' && guard++ < 800) {
        if (state.phase === 'hand-over') { state = dealNextFourPlayerHand(state); continue }

        for (const seat of seats) checkView(state, seat)

        if (state.phase === 'bidding') {
          state = placeFourPlayerBid(state, state.bidder, legalFourPlayerBids(state)[0]!)
          continue
        }

        const acting = state.turn
        const hand = state.hands[acting]
        if (state.phase === 'opening-move') {
          const bidCard = hand.find((c) => captureValue(c) === state.bidValue)!
          const found = chooseCard(state.floor, [bidCard], state.bidValue!)
          state = found ? playFourPlayerCapture(state, acting, found.card, found.ids) : playFourPlayerThrow(state, acting, bidCard)
          continue
        }
        const found = hand.map((c) => chooseCard(state.floor, [c], captureValue(c))).find((f) => f)
        state = found ? playFourPlayerCapture(state, acting, found.card, found.ids) : playFourPlayerThrow(state, acting, hand[0]!)
      }
    }

    function checkView(state: FourPlayerGameState, viewer: SeatId) {
      const view = viewForSeat(state, viewer)
      const visible = cardsIn(view)
      for (const seat of seats) {
        if (seat === viewer) continue
        for (const hidden of state.hands[seat]) {
          expect(visible.has(key(hidden)), `view for ${viewer} leaked ${seat}'s card ${key(hidden)}`).toBe(false)
        }
      }
      if (state.pendingDeal) {
        for (const seatCards of Object.values(state.pendingDeal)) {
          for (const hidden of seatCards) {
            expect(visible.has(key(hidden)), `view for ${viewer} leaked a pending-deal card ${key(hidden)}`).toBe(false)
          }
        }
      }
      expect(view.myHand).toEqual(state.hands[viewer])
      expect('pendingDeal' in view).toBe(false)
    }
  })
})
