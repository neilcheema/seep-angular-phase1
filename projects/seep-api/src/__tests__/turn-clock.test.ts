import { describe, expect, it } from 'vitest'
import { CLOCK_PHASES, PRESENCE_TOUCH_SECONDS, PRESENCE_WINDOW_MS, clockSettings } from '../lib/turn-clock'

describe('clockSettings', () => {
  it('warns after one minute and forfeits after two, by default', () => {
    expect(clockSettings({})).toEqual({ warnAfterMs: 60_000, forfeitAfterMs: 120_000, presenceWindowMs: PRESENCE_WINDOW_MS })
  })

  it('can be changed with application settings, without a redeploy', () => {
    expect(clockSettings({ TURN_WARN_SECONDS: '30', TURN_FORFEIT_SECONDS: '90' })).toMatchObject({ warnAfterMs: 30_000, forfeitAfterMs: 90_000 })
  })

  it.each(['abc', '', '-5', '0', '1.5', ' '])('ignores a setting that is not a whole number of seconds (%j)', (bad) => {
    expect(clockSettings({ TURN_WARN_SECONDS: bad, TURN_FORFEIT_SECONDS: bad })).toMatchObject({ warnAfterMs: 60_000, forfeitAfterMs: 120_000 })
  })

  it('can never forfeit someone before they have been warned, whatever the settings say', () => {
    expect(clockSettings({ TURN_WARN_SECONDS: '100', TURN_FORFEIT_SECONDS: '50' }).forfeitAfterMs).toBe(101_000)
    expect(clockSettings({ TURN_WARN_SECONDS: '100', TURN_FORFEIT_SECONDS: '100' }).forfeitAfterMs).toBe(101_000)
  })

  it('counts presence over a window longer than the slowest a watching player can look (30s record interval + 15s background poll)', () => {
    expect(PRESENCE_WINDOW_MS).toBeGreaterThan((PRESENCE_TOUCH_SECONDS + 15) * 1000)
  })

  it('runs the clock only while someone has a move to make', () => {
    expect([...CLOCK_PHASES].sort()).toEqual(['bidding', 'opening-move', 'playing'])
  })
})
