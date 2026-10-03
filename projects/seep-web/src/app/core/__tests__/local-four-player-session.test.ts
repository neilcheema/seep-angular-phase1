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

  it('submitting a legal move updates the view and records lastMove with before/after', async () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    const before = session.view()!
    const value = legalBidsFromView(before.myHand)[0]!

    await session.submit({ type: 'bid', value })

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe(SeatId.P1)
    expect(move!.intent).toEqual({ type: 'bid', value })
    expect(move!.reason).toBeUndefined()
    expect(session.view()!.bidValue).toBe(value)
    session.dispose()
  })

  it('submitting an illegal move throws, the same validation the engine has always had', async () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    await expect(session.submit({ type: 'bid', value: 4 })).rejects.toThrow()
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

  it('the critical fix: after the human\u2019s opening move, the next bot\u2019s reply is NOT scheduled until acknowledge() is called', async () => {
    vi.useFakeTimers()
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4) // P1 is the bidder
    const before = session.view()!
    await session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    const afterBid = session.view()!
    const bidCard = afterBid.myHand.find((c) => captureValue(c as never) === afterBid.bidValue)!
    await session.submit({ type: 'throw', card: bidCard })
    const ownMove = session.lastMove()
    expect(session.view()!.turn).not.toBe(SeatId.P1) // confirms the scenario: it's now a bot's turn

    // Without this fix, submitting a move used to schedule the next bot
    // move immediately, before the page had shown the human their own
    // move's reveal. Advancing well past the bot's think time here must
    // NOT produce a new move.
    await vi.advanceTimersByTimeAsync(5000)
    expect(session.lastMove()).toBe(ownMove)

    session.acknowledge()
    await vi.advanceTimersByTimeAsync(1000)

    expect(session.lastMove()).not.toBe(ownMove)
    expect(session.lastMove()!.actor).not.toBe(SeatId.P1)
    session.dispose()
    vi.useRealTimers()
  })

  it('with four seats, several bot turns happen in a row, but each one still waits for its own acknowledge()', async () => {
    vi.useFakeTimers()
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    const before = session.view()!
    await session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    const afterBid = session.view()!
    const bidCard = afterBid.myHand.find((c) => captureValue(c as never) === afterBid.bidValue)!
    await session.submit({ type: 'throw', card: bidCard })

    // Walk through bot turns one at a time, each requiring its own
    // acknowledge() — stop once it's the human's turn again or after a
    // generous number of steps (should never take anywhere near this many
    // for three bot seats to each go once).
    const actors: unknown[] = []
    for (let i = 0; i < 6 && session.view()!.turn !== SeatId.P1; i++) {
      session.acknowledge()
      await vi.advanceTimersByTimeAsync(1000)
      actors.push(session.lastMove()!.actor)
    }

    expect(actors.length).toBeGreaterThan(0)
    expect(actors.every((a) => a !== SeatId.P1)).toBe(true) // every move in this stretch was a bot's
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

  it('startNewMatch resets lastMove and deals a fresh hand', async () => {
    const session = new LocalFourPlayerSession(SeatId.P1, SeatId.P4)
    const before = session.view()!
    await session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    expect(session.lastMove()).not.toBeNull()

    session.startNewMatch()

    expect(session.lastMove()).toBeNull()
    expect(session.view()).not.toBeNull()
    expect(session.view()!.phase).toBe('bidding')
    session.dispose()
  })

  it('the viewer is always the bidder on a fresh match, for any seat — not just P1', () => {
    // Regression coverage for a real bug: the dealer must be whichever
    // seat's nextSeat is myId, or a non-P1 viewer ends up with an empty
    // staged hand and zero legal bids on their own fresh game.
    for (const seat of [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]) {
      const dealer = { p1: SeatId.P4, p2: SeatId.P1, p3: SeatId.P2, p4: SeatId.P3 }[seat]
      const session = new LocalFourPlayerSession(seat, dealer)
      expect(session.view()!.myHand.length).toBeGreaterThan(0)
      expect(legalBidsFromView(session.view()!.myHand).length).toBeGreaterThan(0)
      session.dispose()
    }
  })

  it('startNewMatch keeps the same viewer as bidder on every restart, for a non-P1 seat too', () => {
    const session = new LocalFourPlayerSession(SeatId.P3, SeatId.P2)
    expect(session.view()!.myHand.length).toBeGreaterThan(0)

    session.startNewMatch()

    // Before the fix, startNewMatch() ignored myId entirely and always
    // dealt as if the viewer were P1 — for a P3 viewer this left
    // myHand empty on every restart, not just the first deal.
    expect(session.view()!.myHand.length).toBeGreaterThan(0)
    expect(legalBidsFromView(session.view()!.myHand).length).toBeGreaterThan(0)
    session.dispose()
  })
})
