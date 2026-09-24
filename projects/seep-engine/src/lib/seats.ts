/**
 * Seat and team identity for four-player Seep (spec §8.1-8.2).
 *
 * Fixed seat assignment for this app: the human user is always p1, on
 * teamA with their computer partner p3. p2 and p4 (both computer) are
 * teamB. Turn order rotates p1 -> p2 -> p3 -> p4 -> p1..., which
 * alternates team on every turn (A, B, A, B) since partners sit across
 * from one another rather than beside.
 */

export const SeatId = {
  P1: 'p1',
  P2: 'p2',
  P3: 'p3',
  P4: 'p4',
} as const
export type SeatId = (typeof SeatId)[keyof typeof SeatId]

export const TeamId = {
  TeamA: 'teamA',
  TeamB: 'teamB',
} as const
export type TeamId = (typeof TeamId)[keyof typeof TeamId]

/** Fixed turn-order rotation. Index 0 is not privileged; any seat may be dealer/bidder. */
export const TURN_ORDER: readonly SeatId[] = [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]

const TEAM_OF: Record<SeatId, TeamId> = {
  [SeatId.P1]: TeamId.TeamA,
  [SeatId.P3]: TeamId.TeamA,
  [SeatId.P2]: TeamId.TeamB,
  [SeatId.P4]: TeamId.TeamB,
}

const PARTNER_OF: Record<SeatId, SeatId> = {
  [SeatId.P1]: SeatId.P3,
  [SeatId.P3]: SeatId.P1,
  [SeatId.P2]: SeatId.P4,
  [SeatId.P4]: SeatId.P2,
}

export function teamOf(seat: SeatId): TeamId {
  return TEAM_OF[seat]
}

export function partnerOf(seat: SeatId): SeatId {
  return PARTNER_OF[seat]
}

/** The two seats on the opposing team, in turn-order order. */
export function opponentsOf(seat: SeatId): SeatId[] {
  const team = teamOf(seat)
  return TURN_ORDER.filter((s) => teamOf(s) !== team)
}

export function areTeammates(a: SeatId, b: SeatId): boolean {
  return a !== b && teamOf(a) === teamOf(b)
}

/** The next seat in turn-order rotation after the given seat. */
export function nextSeat(seat: SeatId): SeatId {
  const idx = TURN_ORDER.indexOf(seat)
  return TURN_ORDER[(idx + 1) % TURN_ORDER.length]!
}

/** The seat whose turn it is `steps` turns after `seat` (steps=0 returns seat itself). */
export function seatAfter(seat: SeatId, steps: number): SeatId {
  const idx = TURN_ORDER.indexOf(seat)
  const len = TURN_ORDER.length
  return TURN_ORDER[(((idx + steps) % len) + len) % len]!
}

export const ALL_SEATS: readonly SeatId[] = TURN_ORDER
export const ALL_TEAMS: readonly TeamId[] = [TeamId.TeamA, TeamId.TeamB]
