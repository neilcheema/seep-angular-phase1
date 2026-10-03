import { describe, expect, it } from 'vitest'
import type { ClockState } from '../remote-session'
import { type ClockNames, describeClock, mmss } from '../turn-clock-text'

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

describe('describeClock at a four-player table (names the player, and says a whole team forfeits)', () => {
  // Seen from seat p1: p3 is the partner, p2 and p4 the opponents.
  const names: ClockNames = {
    nameOf: (seat) => (seat === 'p1' ? 'You' : seat === 'p3' ? 'Your partner' : `Player ${seat.slice(1)}`),
    sameTeam: (seat) => seat === 'p1' || seat === 'p3',
  }
  const c = (seat: string, elapsedMs: number) => clock({ seat, elapsedMs })
  const text = (clk: ClockState, mySeat = 'p1') => describeClock(clk, mySeat, clk.receivedAt, names)

  it('says whose move it is, by name, during the first minute', () => {
    expect(text(c('p1', 18_000))).toEqual({ text: 'Your move · 0:42 left', urgent: false })
    expect(text(c('p2', 18_000))).toEqual({ text: 'Player 2’s move · 0:42 left', urgent: false })
    expect(text(c('p3', 18_000))).toEqual({ text: 'Your partner’s move · 0:42 left', urgent: false })
  })

  it('warns the player on the clock that THEIR TEAM forfeits, not only themselves', () => {
    expect(text(c('p1', 60_000))).toEqual({ text: 'Out of time! Move within 1:00 or your team forfeits the match', urgent: true })
  })

  it('tells everyone else who is out of time, and whose team pays for it', () => {
    expect(text(c('p2', 75_000))).toEqual({ text: 'Player 2 is out of time. Their team forfeits the match in 0:45', urgent: true })
    expect(text(c('p4', 75_000))?.text).toMatch(/^Player 4 is out of time\. Their team forfeits/)
  })

  it('warns a player when it is their own PARTNER who is running out of time (their team forfeits too)', () => {
    expect(text(c('p3', 75_000))).toEqual({ text: 'Your partner is out of time. Your team forfeits the match in 0:45', urgent: true })
  })

  it('says it plainly once time is up', () => {
    expect(text(c('p1', 120_000))?.text).toBe('Out of time!')
    expect(text(c('p2', 120_000))?.text).toBe('Player 2 ran out of time…')
    expect(text(c('p3', 120_000))?.text).toBe('Your partner ran out of time…')
  })

  it('reads correctly from another seat (the same clock, seen by p2)', () => {
    const clk = c('p2', 18_000)
    const fromP2: ClockNames = {
      nameOf: (seat) => (seat === 'p2' ? 'You' : seat === 'p4' ? 'Your partner' : `Player ${seat.slice(1)}`),
      sameTeam: (seat) => seat === 'p2' || seat === 'p4',
    }
    expect(describeClock(clk, 'p2', clk.receivedAt, fromP2)?.text).toBe('Your move · 0:42 left')
    expect(describeClock(clk, 'p1', clk.receivedAt, names)?.text).toBe('Player 2’s move · 0:42 left')
  })

  it('leaves the two-player wording exactly as it was when no names are given', () => {
    const clk = c('player', 75_000)
    expect(describeClock(clk, 'opponent', clk.receivedAt)?.text).toBe('They are out of time. They forfeit the match in 0:45')
    expect(describeClock(clk, 'player', clk.receivedAt)?.text).toBe('Out of time! Move within 0:45 or you forfeit the match')
  })
})
