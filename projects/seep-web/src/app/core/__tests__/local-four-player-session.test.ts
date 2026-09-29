import { describe, expect, it, vi } from 'vitest'
import { SeatId, captureValue, isHouseValue } from 'seep-engine'
import { LocalFourPlayerSession } from '../local-four-player-session'

/** Mirrors legalFourPlayerBids(state) using only what a redacted view exposes. */
function legalBidsFromView(myHand: { face: string; suit: string }[]): number[] {
  return [...new Set(myHand.map((c) => captureValue(c as never)).filter(isHouseValue))]
}

describe('LocalFourPlayerSession', () => {
  it('starts a match and immediately exposes a redacted view for the viewer\u2019s own seat', () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4) // P1 (nextSeat of P4) is the bidder
    const view = session.view()
    expect(view).not.toBeNull()
    expect(view!.viewer).toBe(SeatId.P1)
    expect(view!.myHand).toHaveLength(4)
    expect(view!.handCounts[SeatId.P1]).toBe(4)
    expect(view!.handCounts[SeatId.P2]).toBe(0) // not yet dealt (staged dealing)
    expect('pendingDeal' in view!).toBe(false)
    session.dispose()
  })

  it('submitting a legal move updates the view and records lastMove with before/after', () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    const before = session.view()!
    const value = legalBidsFromView(before.myHand)[0]!

    session.submit({ type: 'bid', value })

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe(SeatId.P1)
    expect(move!.intent).toEqual({ type: 'bid', value })
    expect(move!.reason).toBeUndefined()
    expect(session.view()!.bidValue).toBe(value)
    session.dispose()
  })

  it('submitting an illegal move throws, the same validation the engine has always had', () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    expect(() => session.submit({ type: 'bid', value: 4 })).toThrow()
    session.dispose()
  })

  it('when the viewer is the dealer (not the bidder), a bot bids on its own', async () => {
    vi.useFakeTimers()
    // Dealer P1 -> bidder is nextSeat(P1) = P2, a bot from the viewer's perspective.
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P1)
    expect(session.lastMove()).toBeNull()

    await vi.advanceTimersByTimeAsync(1000)

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe(SeatId.P2)
    expect(move!.reason).toBeDefined()
    expect(session.view()!.bidValue).not.toBeNull()
    session.dispose()
    vi.useRealTimers()
  })

  it('after the human\u2019s move, play continues automatically through multiple bot seats without further input', async () => {
    vi.useFakeTimers()
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4) // P1 is the bidder
    const before = session.view()!
    session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })

    // It's now the opening move, still P1's turn (the bidder plays first) — submit a plausible opening move.
    const afterBid = session.view()!
    const bidCard = afterBid.myHand.find((c) => captureValue(c as never) === afterBid.bidValue)!
    session.submit({ type: 'throw', card: bidCard })

    // From here it should be seat P2's turn, then P3, then P4, all bots — advance
    // enough real time for several bot moves and confirm the turn has moved on
    // past P1 without needing any further human input.
    const seatAfterHuman = session.view()!.turn
    expect(seatAfterHuman).not.toBe(SeatId.P1)

    await vi.advanceTimersByTimeAsync(3000)

    expect(session.lastMove()).not.toBeNull()
    expect(session.lastMove()!.actor).not.toBe(SeatId.P1)
    session.dispose()
    vi.useRealTimers()
  })

  it('dispose() cancels a pending bot move \u2014 no move happens after disposal', async () => {
    vi.useFakeTimers()
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P1) // bot bids next
    session.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(session.lastMove()).toBeNull()
    vi.useRealTimers()
  })

  it('startNewMatch resets lastMove and deals a fresh hand', () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    const before = session.view()!
    session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    expect(session.lastMove()).not.toBeNull()

    session.startNewMatch()

    expect(session.lastMove()).toBeNull()
    expect(session.view()).not.toBeNull()
    expect(session.view()!.phase).toBe('bidding')
    session.dispose()
  })
})
