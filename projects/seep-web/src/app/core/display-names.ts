import type { GameInfoDto, PlayerInfoDto } from './api-types'
import { ApiError } from './game-api'

/** "Narender Cheema" -> "Narender": a first-name suggestion from a sign-in provider's full name. Empty if nothing usable. */
export function suggestName(fullName: string | null): string {
  const first = (fullName ?? '').trim().split(/\s+/u)[0] ?? ''
  const kept = Array.from(first).filter((ch) => /[\p{L}\p{M}\p{N}'._-]/u.test(ch))
  const name = kept.slice(0, 20).join('')
  return Array.from(name).length >= 2 ? name : ''
}

/** "p3" -> 3. */
export function seatNumber(seat: string): number {
  return Number(seat.replace(/\D/gu, '')) || 0
}

/** One line of the "who has arrived" list at a four-player table. */
export function seatLine(player: PlayerInfoDto): string {
  const label = `Player ${seatNumber(player.seat)}`
  if (!player.joined) return `${label} — waiting…`
  const name = player.displayName ?? (player.isYou ? 'you' : 'a player')
  return player.isYou ? `${label} — ${name} (you)` : `${label} — ${name}`
}

/** The names of the other people at a table who have arrived, in seat order. */
export function otherNames(game: GameInfoDto): string[] {
  return game.players.filter((p) => p.joined && !p.isYou && !p.isBot).map((p) => p.displayName ?? 'a player')
}

/** What "Your tables" says about a table. */
export function tableStatusText(game: GameInfoDto): string {
  if (game.status === 'waiting') {
    const code = game.inviteCode ?? ''
    if (game.kind === 'two_player') return `Waiting for an opponent, code ${code}`.trim()
    const joined = game.players.filter((p) => p.joined).length
    return `Waiting for players (${joined} of ${game.players.length}), code ${code}`.trim()
  }
  if (game.status === 'active') {
    const others = otherNames(game)
    if (others.length === 0) return 'In progress'
    return game.kind === 'two_player' ? `In progress vs ${others[0]}` : `In progress with ${others.join(', ')}`
  }
  return game.status === 'finished' ? 'Finished' : 'Closed'
}

/**
 * When saving a name fails because somebody already has it (or a name that counts as the same), the server offers a few free alternatives.
 * This returns them (an empty list if it offered none), or null when the failure was anything else.
 */
export function nameTakenSuggestions(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.details['code'] !== 'name_taken') return null
  const offered = err.details['suggestions']
  return Array.isArray(offered) ? offered.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5) : []
}
