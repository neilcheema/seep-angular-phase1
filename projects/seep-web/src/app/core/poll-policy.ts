import type { GameStatus } from './api-types'

export interface PollContext {
  readonly status: GameStatus
  /** The viewer is the one who has to act (so nothing is expected to change until they do). */
  readonly myTurn: boolean
  readonly phase: string
  /** The browser tab is in the background. */
  readonly hidden: boolean
  /** How many polls in a row found nothing new. */
  readonly unchangedPolls: number
  /** How long ago this screen first saw the game was over. Absent when it is not over, or not known. */
  readonly finishedForMs?: number
  /** A rematch can still be asked for here (a two-player match, and nobody has yet), so the other player's ask is worth hearing. */
  readonly watchForRematch?: boolean
}

/** After a two-player match ends, keep listening this long for the other player to ask for a rematch. */
export const FINISHED_WATCH_MS = 5 * 60_000
/** ...and listen this often. Slow on purpose: nothing happens in a finished game except this. */
export const FINISHED_POLL_MS = 8_000

/**
 * How long to wait before the next poll, or null to stop polling for good.
 *
 * This is about cost as much as responsiveness. Each poll is one Azure
 * Function execution plus a few database queries, and the free monthly grant
 * is 1,000,000 executions: a single tab polling every 2 seconds, left open,
 * would use about 1.3 million on its own. So the rate follows how much a
 * change is actually expected:
 *   - someone else is about to act  -> fast, backing off as nothing happens
 *   - it is my move                 -> slow (I'm the one holding things up)
 *   - the tab is hidden             -> slow regardless
 *   - the game is over              -> stop (after a short, slow listen for a rematch, in two-player)
 */
export function nextPollDelay(ctx: PollContext): number | null {
  if (ctx.status === 'abandoned') return null
  if (ctx.status === 'finished') {
    // Stop for good, unless a rematch could still be asked for and we have not been listening for long.
    if (!ctx.watchForRematch || (ctx.finishedForMs ?? Number.POSITIVE_INFINITY) >= FINISHED_WATCH_MS) return null
    return ctx.hidden ? Math.max(FINISHED_POLL_MS, 15_000) : FINISHED_POLL_MS
  }

  let delay: number
  if (ctx.status === 'waiting') {
    delay = 3_000
  } else if (ctx.myTurn && ctx.phase !== 'hand-over') {
    delay = 10_000
  } else if (ctx.unchangedPolls >= 150) {
    delay = 15_000 // ~10 minutes of silence
  } else if (ctx.unchangedPolls >= 30) {
    delay = 5_000 // ~1 minute of silence
  } else {
    delay = 2_000
  }
  return ctx.hidden ? Math.max(delay, 15_000) : delay
}
