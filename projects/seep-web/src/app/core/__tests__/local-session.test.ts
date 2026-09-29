import { describe, expect, it, vi } from 'vitest'
import { captureValue, isHouseValue } from 'seep-engine'
import { LocalSession } from '../local-session'

/** The legal bid values available from a redacted view's own visible hand — mirrors what legalBids(state) computes internally, without needing the full GameState the session deliberately doesn't expose. */
function legalBidsFromView(myHand: { face: string; suit: string }[]): number[] {
  return [...new Set(myHand.map((c) => captureValue(c as never)).filter(isHouseValue))]
}

describe('LocalSession', () => {
  it('starts a match and immediately exposes a redacted view, never the full state', () => {
    const session = new LocalSession('player', 'player')
    const view = session.view()
    expect(view).not.toBeNull()
    expect(view!.myHand).toHaveLength(4) // bidder's staged first four
    expect(view!.opponentCardCount).toBe(0) // opponent's pendingDeal isn't dealt yet, and wouldn't be visible either way
    expect('pendingDeal' in view!).toBe(false)
    session.dispose()
  })

  it('submitting a legal move updates the view and records lastMove with before/after', () => {
    const session = new LocalSession('player', 'player')
    const before = session.view()!
    const value = legalBidsFromView(before.myHand)[0]!

    session.submit({ type: 'bid', value })

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe('player')
    expect(move!.intent).toEqual({ type: 'bid', value })
    expect(move!.reason).toBeUndefined() // the human's own move never carries a bot "reason"
    expect(move!.before.bidValue).toBeNull()
    expect(move!.after.bidValue).toBe(value)
    expect(session.view()!.bidValue).toBe(value)
    session.dispose()
  })

  it('submitting an illegal move throws, the same validation the engine has always had', () => {
    const session = new LocalSession('player', 'player')
    expect(() => session.submit({ type: 'bid', value: 4 })).toThrow() // 4 is never a legal house-value bid
    session.dispose()
  })

  it('schedules and applies a bot move automatically once it is the bot\u2019s turn, then reports it via lastMove', async () => {
    vi.useFakeTimers()
    const session = new LocalSession('player', 'opponent') // bot (opponent) is the bidder — should bid on its own
    expect(session.lastMove()).toBeNull()

    await vi.advanceTimersByTimeAsync(1000)

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe('opponent')
    expect(move!.reason).toBeDefined() // bot moves always carry a reason
    expect(session.view()!.bidValue).not.toBeNull()
    session.dispose()
    vi.useRealTimers()
  })

  it('dispose() cancels a pending bot move \u2014 no move happens after disposal', async () => {
    vi.useFakeTimers()
    const session = new LocalSession('player', 'opponent')
    session.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(session.lastMove()).toBeNull()
    vi.useRealTimers()
  })

  it('startNewMatch resets lastMove and deals a fresh hand', () => {
    const session = new LocalSession('player', 'player')
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
