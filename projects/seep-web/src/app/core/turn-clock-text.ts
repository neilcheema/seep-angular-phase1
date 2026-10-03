import type { ClockState } from './remote-session'

export interface ClockLine {
  readonly text: string
  /** Time is nearly up or already up: draw it in the warning colour. */
  readonly urgent: boolean
}

/** 62_000 -> "1:02". Rounds up, so the display never reaches 0:00 before time really is up. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The sentence shown for the turn clock, or null when there is nothing to show.
 *
 * `nowMs` is this device's current time; only its *difference* from when the
 * server's reading arrived is used, so a device with the wrong date still
 * shows the right countdown.
 */
export function describeClock(clock: ClockState | null, mySeat: string | null, nowMs: number): ClockLine | null {
  if (clock === null || clock.seat === null || mySeat === null) return null
  const elapsed = clock.elapsedMs + Math.max(0, nowMs - clock.receivedAt)
  const mine = clock.seat === mySeat

  if (elapsed < clock.warnAfterMs) {
    const left = clock.warnAfterMs - elapsed
    return { text: `${mine ? 'Your' : 'Their'} move · ${mmss(left)} left`, urgent: mine && left <= 10_000 }
  }

  const left = clock.forfeitAfterMs - elapsed
  if (mine) {
    return { text: left > 0 ? `Out of time! Move within ${mmss(left)} or you forfeit the match` : 'Out of time!', urgent: true }
  }
  return { text: left > 0 ? `They are out of time. They forfeit the match in ${mmss(left)}` : 'They ran out of time…', urgent: true }
}
