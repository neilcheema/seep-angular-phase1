/**
 * The turn clock's rules, in one place.
 *
 *   - The clock belongs to whoever has to move (bidding, opening move, play).
 *     It does not run between hands or while a table waits for an opponent.
 *   - At WARN both players are told time is nearly up.
 *   - At FORFEIT the mover loses the match, but only when decided while the
 *     OTHER player is present. If they had been away, the mover's clock simply
 *     restarts when they come back: being offline never costs anyone a match.
 *
 * Defaults: warn after 1 minute, forfeit after 2. Both can be changed with
 * the TURN_WARN_SECONDS / TURN_FORFEIT_SECONDS application settings, without
 * a redeploy.
 */

export interface ClockSettings {
  readonly warnAfterMs: number
  readonly forfeitAfterMs: number
  /** How recently the waiting player must have been seen for a forfeit to count. */
  readonly presenceWindowMs: number
}

/** What a client needs to draw the clock. Times are measured by the server, so no device's own clock matters. */
export interface ClockDto {
  /** The seat that is on the clock, or null when no clock is running. */
  readonly seat: string | null
  /** How long that seat has been on the clock, as of this response. */
  readonly elapsedMs: number
  readonly warnAfterMs: number
  readonly forfeitAfterMs: number
}

/** The phases in which someone has a move to make. */
export const CLOCK_PHASES: ReadonlySet<string> = new Set(['bidding', 'opening-move', 'playing'])

/** A seat is written as "seen" at most this often. */
export const PRESENCE_TOUCH_SECONDS = 30

/**
 * Longer than the touch interval plus the slowest poll (a background tab polls
 * every 15s), so a player who is watching continuously always counts as present.
 */
export const PRESENCE_WINDOW_MS = 60_000

const DEFAULT_WARN_SECONDS = 60
const DEFAULT_FORFEIT_SECONDS = 120

function wholeSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return n >= 1 ? n : undefined
}

export function clockSettings(env: Record<string, string | undefined> = process.env): ClockSettings {
  const warn = wholeSeconds(env['TURN_WARN_SECONDS']) ?? DEFAULT_WARN_SECONDS
  const forfeit = wholeSeconds(env['TURN_FORFEIT_SECONDS']) ?? DEFAULT_FORFEIT_SECONDS
  return {
    warnAfterMs: warn * 1000,
    // A bad setting must never be able to forfeit someone before they have even been warned.
    forfeitAfterMs: Math.max(forfeit, warn + 1) * 1000,
    presenceWindowMs: PRESENCE_WINDOW_MS,
  }
}
