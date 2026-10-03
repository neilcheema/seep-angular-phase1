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
    expect(view!.myHand).toHaveLength(4)
    expect(view!.opponentCardCount).toBe(0)
    expect('pendingDeal' in view!).toBe(false)
    session.dispose()
  })

  it('submitting a legal move updates the view and records lastMove with before/after', async () => {
    const session = new LocalSession('player', 'player')
    const before = session.view()!
    const value = legalBidsFromView(before.myHand)[0]!

    await session.submit({ type: 'bid', value })

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe('player')
    expect(move!.intent).toEqual({ type: 'bid', value })
    expect(move!.reason).toBeUndefined()
    expect(move!.before.bidValue).toBeNull()
    expect(move!.after.bidValue).toBe(value)
    expect(session.view()!.bidValue).toBe(value)
    session.dispose()
  })

  it('submitting an illegal move throws, the same validation the engine has always had', async () => {
    const session = new LocalSession('player', 'player')
    await expect(session.submit({ type: 'bid', value: 4 })).rejects.toThrow()
    session.dispose()
  })

  it('a fresh match with the bot as bidder schedules and applies its move automatically \u2014 no prior reveal to wait for', async () => {
    vi.useFakeTimers()
    const session = new LocalSession('player', 'opponent')
    expect(session.lastMove()).toBeNull()

    await vi.advanceTimersByTimeAsync(1000)

    const move = session.lastMove()
    expect(move).not.toBeNull()
    expect(move!.actor).toBe('opponent')
    expect(move!.reason).toBeDefined()
    expect(session.view()!.bidValue).not.toBeNull()
    session.dispose()
    vi.useRealTimers()
  })

  it('the critical fix: after the human\u2019s opening move, the bot\u2019s reply is NOT scheduled until acknowledge() is called', async () => {
    vi.useFakeTimers()
    const session = new LocalSession('player', 'player') // human is the bidder, and so plays the opening move too
    const before = session.view()!
    await session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    // Same bidder plays the opening move next \u2014 turn does not switch to the
    // opponent until this resolves, so throw the bid-matching card.
    const afterBid = session.view()!
    const bidCard = afterBid.myHand.find((c) => captureValue(c) === afterBid.bidValue)!
    await session.submit({ type: 'throw', card: bidCard })
    const ownMove = session.lastMove()
    expect(session.view()!.turn).toBe('opponent') // confirms the scenario: it is now genuinely the bot's turn

    // Without this fix, submitting a move used to schedule the bot's next
    // move immediately (the original bug this patch corrects) — the bot
    // would start computing its reply before the page had even shown the
    // human their own move's reveal. Advancing well past the bot's think
    // time here must NOT produce a new move.
    await vi.advanceTimersByTimeAsync(5000)
    expect(session.lastMove()).toBe(ownMove) // still the human's own move — nothing snuck in

    session.acknowledge()
    await vi.advanceTimersByTimeAsync(1000)

    expect(session.lastMove()).not.toBe(ownMove)
    expect(session.lastMove()!.actor).toBe('opponent') // now the bot has replied, only after acknowledge()
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

  it('startNewMatch resets lastMove and deals a fresh hand', async () => {
    const session = new LocalSession('player', 'player')
    const before = session.view()!
    await session.submit({ type: 'bid', value: legalBidsFromView(before.myHand)[0]! })
    expect(session.lastMove()).not.toBeNull()

    session.startNewMatch()

    expect(session.lastMove()).toBeNull()
    expect(session.view()).not.toBeNull()
    expect(session.view()!.phase).toBe('bidding')
    session.dispose()
  })
})
