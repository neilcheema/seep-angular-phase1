import type { ClockState } from './remote-session'

/**
 * For a table with more than two people: how to name the player on the clock,
 * and whether they are on the viewer's team (a four-player forfeit costs the
 * whole team, so the wording differs for a partner).
 */
export interface ClockNames {
  readonly nameOf: (seat: string) => string
  readonly sameTeam: (seat: string) => boolean
}

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
export function describeClock(clock: ClockState | null, mySeat: string | null, nowMs: number, names?: ClockNames): ClockLine | null {
  if (clock === null || clock.seat === null || mySeat === null) return null
  const elapsed = clock.elapsedMs + Math.max(0, nowMs - clock.receivedAt)
  const mine = clock.seat === mySeat
  const who = names ? names.nameOf(clock.seat) : 'They'

  if (elapsed < clock.warnAfterMs) {
    const left = clock.warnAfterMs - elapsed
    const label = mine ? 'Your move' : names ? `${who}’s move` : 'Their move'
    return { text: `${label} · ${mmss(left)} left`, urgent: mine && left <= 10_000 }
  }

  const left = clock.forfeitAfterMs - elapsed
  if (mine) {
    const penalty = names ? 'your team forfeits' : 'you forfeit'
    return { text: left > 0 ? `Out of time! Move within ${mmss(left)} or ${penalty} the match` : 'Out of time!', urgent: true }
  }
  if (names) {
    const penalty = names.sameTeam(clock.seat) ? 'Your team forfeits' : 'Their team forfeits'
    return { text: left > 0 ? `${who} is out of time. ${penalty} the match in ${mmss(left)}` : `${who} ran out of time…`, urgent: true }
  }
  return { text: left > 0 ? `They are out of time. They forfeit the match in ${mmss(left)}` : 'They ran out of time…', urgent: true }
}
