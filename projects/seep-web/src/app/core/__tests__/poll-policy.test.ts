import { describe, expect, it } from 'vitest'
import { FINISHED_POLL_MS, FINISHED_WATCH_MS, type PollContext, nextPollDelay } from '../poll-policy'

const base: PollContext = { status: 'active', myTurn: false, phase: 'playing', hidden: false, unchangedPolls: 0 }

describe('nextPollDelay', () => {
  it('stops for good once a game is over (unless a rematch could still be asked for)', () => {
    expect(nextPollDelay({ ...base, status: 'finished' })).toBeNull()
    expect(nextPollDelay({ ...base, status: 'abandoned' })).toBeNull()
  })

  describe('listening for a rematch after a two-player match', () => {
    const over: PollContext = { ...base, status: 'finished', watchForRematch: true, finishedForMs: 0 }

    it('listens slowly, every 8 seconds: nothing else happens in a finished game', () => {
      expect(nextPollDelay(over)).toBe(FINISHED_POLL_MS)
      expect(FINISHED_POLL_MS).toBe(8_000)
      expect(nextPollDelay({ ...over, finishedForMs: 4 * 60_000 })).toBe(8_000)
    })

    it('stops after five minutes', () => {
      expect(nextPollDelay({ ...over, finishedForMs: FINISHED_WATCH_MS - 1 })).toBe(8_000)
      expect(nextPollDelay({ ...over, finishedForMs: FINISHED_WATCH_MS })).toBeNull()
      expect(FINISHED_WATCH_MS).toBe(300_000)
    })

    it('stops at once if a rematch cannot be asked for here (four-player), or has already been asked for', () => {
      expect(nextPollDelay({ ...over, watchForRematch: false })).toBeNull()
      expect(nextPollDelay({ ...over, watchForRematch: undefined })).toBeNull()
    })

    it('stops if it is not known how long ago the match ended (it never listens for ever)', () => {
      expect(nextPollDelay({ ...base, status: 'finished', watchForRematch: true })).toBeNull()
    })

    it('slows right down in a background tab', () => {
      expect(nextPollDelay({ ...over, hidden: true })).toBe(15_000)
    })

    it('never listens at a table that was closed', () => {
      expect(nextPollDelay({ ...over, status: 'abandoned' })).toBeNull()
    })
  })

  it("polls briskly while waiting for someone else's move", () => {
    expect(nextPollDelay(base)).toBe(2_000)
  })

  it('polls briskly for the other players to arrive', () => {
    expect(nextPollDelay({ ...base, status: 'waiting' })).toBe(3_000)
  })

  it("slows right down when it's the viewer's own move: they are the ones everyone is waiting on", () => {
    expect(nextPollDelay({ ...base, myTurn: true })).toBe(10_000)
  })

  it('stays brisk between hands, even though it may be "my turn", because someone is about to deal', () => {
    expect(nextPollDelay({ ...base, myTurn: true, phase: 'hand-over' })).toBe(2_000)
  })

  it('backs off as nothing happens, so a forgotten tab costs little', () => {
    expect(nextPollDelay({ ...base, unchangedPolls: 29 })).toBe(2_000)
    expect(nextPollDelay({ ...base, unchangedPolls: 30 })).toBe(5_000)
    expect(nextPollDelay({ ...base, unchangedPolls: 149 })).toBe(5_000)
    expect(nextPollDelay({ ...base, unchangedPolls: 150 })).toBe(15_000)
  })

  it('never polls a background tab faster than every 15 seconds', () => {
    expect(nextPollDelay({ ...base, hidden: true })).toBe(15_000)
    expect(nextPollDelay({ ...base, hidden: true, myTurn: true })).toBe(15_000)
    expect(nextPollDelay({ ...base, hidden: true, unchangedPolls: 500, status: 'waiting' })).toBe(15_000)
  })

  it('keeps one idle tab under the free monthly grant (1,000,000 executions)', () => {
    // Worst realistic case for a tab left open all month: a long-silent game, visible, other player to move.
    const perMonth = (30 * 24 * 3600 * 1000) / nextPollDelay({ ...base, unchangedPolls: 1000 })!
    expect(perMonth).toBeLessThan(200_000)
  })
})
