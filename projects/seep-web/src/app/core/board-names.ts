import { SeatId, partnerOf } from 'seep-engine'
import type { PlayerInfoDto } from './api-types'

/** The names people chose, by seat key. People who have not chosen a name are simply absent. */
export type SeatNames = Readonly<Record<string, string>>

/** Turns a table's player list into names by seat. A bot, an empty seat or a person without a name is left out. */
export function seatNamesOf(players: readonly PlayerInfoDto[]): SeatNames {
  const names: Record<string, string> = {}
  for (const p of players) {
    if (p.joined && !p.isBot && p.displayName) names[p.seat] = p.displayName
  }
  return names
}

/** The other player's name at a two-player table, or null if they have not chosen one (or have not arrived). */
export function opponentNameOf(players: readonly PlayerInfoDto[]): string | null {
  const other = players.find((p) => !p.isYou && p.joined && !p.isBot)
  return other?.displayName ?? null
}

/**
 * Swaps the generic words in a two-player log line for the opponent's name: "Opponent played a Ten" becomes
 * "Bob played a Ten", and "the opponent's house" becomes "Bob's house". With no name the line is returned unchanged.
 * The name goes in as plain text, whatever characters it holds.
 */
export function relabelTwoPlayerLine(line: string, opponentName: string | null): string {
  if (!opponentName) return line
  return line.replace(/\b(?:the )?[Oo]pponent(['’]s)?\b/g, (_whole, possessive: string | undefined) => `${opponentName}${possessive ?? ''}`)
}

/**
 * How to refer to a seat at a four-player table, from the viewer's side: "You", "Your partner", then the person's
 * name, or "Player 3" if they have not chosen one.
 */
export function fourPlayerSeatLabel(seat: SeatId, mySeat: SeatId, names: SeatNames): string {
  if (seat === mySeat) return 'You'
  if (seat === partnerOf(mySeat)) return 'Your partner'
  return names[seat] ?? `Player ${seat.slice(1)}`
}

/** Swaps the seat ids in a four-player log line ("p2 played…") for how the viewer refers to those seats. */
export function relabelFourPlayerLine(line: string, label: (seat: SeatId) => string): string {
  return line.replace(/\bp([1-4])\b/g, (seat) => label(seat as SeatId))
}

/** True if two name maps hold the same names. A map rebuilt from an unchanged player list is equal, not new. */
export function sameNames(a: SeatNames, b: SeatNames): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

