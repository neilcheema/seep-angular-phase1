import { describe, expect, it } from 'vitest'
import type { ClockState } from '../remote-session'
import { describeClock, mmss } from '../turn-clock-text'

const clock = (over: Partial<ClockState> = {}): ClockState => ({
  seat: 'player',
  elapsedMs: 0,
  warnAfterMs: 60_000,
  forfeitAfterMs: 120_000,
  receivedAt: 1_000_000,
  ...over,
})
const at = (c: ClockState, sinceReceivedMs = 0) => c.receivedAt + sinceReceivedMs

describe('mmss', () => {
  it.each([
    [0, '0:00'],
    [1, '0:01'], // rounds up: never shows 0:00 while time remains
    [999, '0:01'],
    [1_000, '0:01'],
    [59_001, '1:00'],
    [62_000, '1:02'],
    [120_000, '2:00'],
    [-5, '0:00'],
  ])('%i ms -> %s', (ms, text) => {
    expect(mmss(ms)).toBe(text)
  })
})

describe('describeClock', () => {
  it('shows nothing when no clock is running, or before it is known who is who', () => {
    expect(describeClock(null, 'player', 0)).toBeNull()
    expect(describeClock(clock({ seat: null }), 'player', 0)).toBeNull()
    expect(describeClock(clock(), null, 0)).toBeNull()
  })

  it('counts down the first minute, in plain words, for the player on the clock', () => {
    const c = clock({ elapsedMs: 18_000 })
    expect(describeClock(c, 'player', at(c))).toEqual({ text: 'Your move · 0:42 left', urgent: false })
  })

  it('shows the same countdown to the player who is waiting', () => {
    const c = clock({ elapsedMs: 18_000 })
    expect(describeClock(c, 'opponent', at(c))).toEqual({ text: 'Their move · 0:42 left', urgent: false })
  })

  it('turns urgent for the mover in the last ten seconds of the first minute, but not for the one waiting', () => {
    const c = clock({ elapsedMs: 52_000 })
    expect(describeClock(c, 'player', at(c))?.urgent).toBe(true)
    expect(describeClock(c, 'opponent', at(c))?.urgent).toBe(false)
  })

  it('warns at one minute and counts down to the forfeit', () => {
    const c = clock({ elapsedMs: 60_000 })
    expect(describeClock(c, 'player', at(c))).toEqual({ text: 'Out of time! Move within 1:00 or you forfeit the match', urgent: true })
    expect(describeClock(c, 'opponent', at(c))).toEqual({ text: 'They are out of time. They forfeit the match in 1:00', urgent: true })
  })

  it('is still in the first minute one second before the warning, and past it one second after', () => {
    const c = clock({ elapsedMs: 59_000 })
    expect(describeClock(c, 'player', at(c))?.text).toMatch(/Your move/)
    expect(describeClock(c, 'player', at(c, 1_000))?.text).toMatch(/Out of time/)
  })

  it('says time is up at the limit, for each side, without a negative countdown', () => {
    const c = clock({ elapsedMs: 120_000 })
    expect(describeClock(c, 'player', at(c))?.text).toBe('Out of time!')
    expect(describeClock(c, 'opponent', at(c))?.text).toBe('They ran out of time…')
    expect(describeClock(clock({ elapsedMs: 900_000 }), 'player', at(c))?.text).toBe('Out of time!')
  })

  it('adds the time since the reading arrived, so the countdown moves between polls', () => {
    const c = clock({ elapsedMs: 10_000 })
    expect(describeClock(c, 'player', at(c, 0))?.text).toBe('Your move · 0:50 left')
    expect(describeClock(c, 'player', at(c, 20_000))?.text).toBe('Your move · 0:30 left')
  })

  it("depends only on the time since the reading arrived, so a device with the wrong date still counts down correctly", () => {
    const wrongDate = clock({ receivedAt: 4_102_444_800_000 }) // a device whose clock says the year 2100
    expect(describeClock({ ...wrongDate, elapsedMs: 5_000 }, 'player', wrongDate.receivedAt + 5_000)?.text).toBe('Your move · 0:50 left')
  })

  it('never runs backwards if this device’s clock steps back', () => {
    const c = clock({ elapsedMs: 30_000 })
    expect(describeClock(c, 'player', at(c, -60_000))?.text).toBe('Your move · 0:30 left')
  })
})
