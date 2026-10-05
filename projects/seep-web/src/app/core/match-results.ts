import { BAZZI_TARGET, type FourPlayerGameView, type GameView, type HandSideTotals, SeatId, partnerOf, teamOf } from 'seep-engine'
import { type SeatNames, fourPlayerSeatLabel, relabelFourPlayerLine, relabelTwoPlayerLine } from './board-names'

/**
 * What the results screen shows for a finished match, worked out from the finished game's view. Side 0 is always the
 * viewer ("you", or "your team"), side 1 the other, so the screen never has to think about seats. The same shape serves a
 * two-player match (against a person or the computer) and a four-player team match.
 */
export interface ResultSide {
  readonly label: string
  /** The people on this side, e.g. "You & Carol"; null where the label already says it. */
  readonly detail: string | null
  readonly isYou: boolean
}

/** One side's score in one hand, with how it was made. */
export interface ResultHandSide {
  readonly cardPoints: number
  /** Card points that counted: a side needs at least 9 to count any of them. */
  readonly counted: number
  readonly sweeps: number
  readonly total: number
  /** The side took some card points but fewer than the 9 needed, so they counted for nothing. */
  readonly missedMinimum: boolean
}

export interface ResultHand {
  /** 1, 2, 3, ... */
  readonly number: number
  readonly sides: readonly [ResultHandSide, ResultHandSide]
  /** The match score after this hand. */
  readonly after: readonly [number, number]
}

export interface MatchResults {
  readonly sides: readonly [ResultSide, ResultSide]
  /** 0 if the viewer's side won, 1 if the other did, null if there is no winner. */
  readonly winner: 0 | 1 | null
  readonly final: readonly [number, number]
  readonly lead: number
  readonly hands: readonly ResultHand[]
  /**
   * Points scored in hands that were not recorded: a match that was already under way when the history was added. The
   * screen shows them as one honest row rather than leave the score unexplained. Null when everything is itemised.
   */
  readonly earlier: readonly [number, number] | null
  /** Why a match that was not won by a bazzi ended (someone left, or ran out of time), or null for a normal finish. */
  readonly endedEarly: string | null
  readonly sweepPoints: readonly [number, number]
  readonly handsWon: readonly [number, number]
}

const handSide = (t: HandSideTotals): ResultHandSide => ({
  cardPoints: t.cardPoints,
  counted: t.qualifyingCardPoints,
  sweeps: t.sweepPoints,
  total: t.total,
  missedMinimum: t.cardPoints > 0 && t.qualifyingCardPoints === 0,
})

function assemble(
  sides: readonly [ResultSide, ResultSide],
  final: readonly [number, number],
  hands: readonly (readonly [HandSideTotals, HandSideTotals])[],
  winner: 0 | 1 | null,
  matchOver: boolean,
  lastLogLine: string | undefined,
): MatchResults {
  const sums: [number, number] = [0, 0]
  for (const [a, b] of hands) {
    sums[0] += a.total
    sums[1] += b.total
  }
  const gap: [number, number] = [final[0] - sums[0], final[1] - sums[1]]
  const earlier = gap[0] >= 0 && gap[1] >= 0 && (gap[0] > 0 || gap[1] > 0) ? gap : null

  const running: [number, number] = earlier ? [earlier[0], earlier[1]] : [0, 0]
  const rows: ResultHand[] = hands.map(([a, b], i) => {
    running[0] += a.total
    running[1] += b.total
    return { number: i + 1, sides: [handSide(a), handSide(b)], after: [running[0], running[1]] }
  })

  const lead = Math.abs(final[0] - final[1])
  return {
    sides,
    winner,
    final,
    lead,
    hands: rows,
    earlier,
    endedEarly: matchOver && lead < BAZZI_TARGET ? (lastLogLine ?? 'The match ended early.') : null,
    sweepPoints: [hands.reduce((t, [a]) => t + a.sweepPoints, 0), hands.reduce((t, [, b]) => t + b.sweepPoints, 0)],
    handsWon: [hands.filter(([a, b]) => a.total > b.total).length, hands.filter(([a, b]) => b.total > a.total).length],
  }
}

/** A finished two-player match, from the viewer's side. `opponentName` is null against the computer or an unnamed player. */
export function buildTwoPlayerResults(view: GameView, opponentName: string | null): MatchResults {
  const history = view.handHistory ?? []
  const last = view.log[view.log.length - 1]
  return assemble(
    [{ label: 'You', detail: null, isYou: true }, { label: opponentName ?? 'Opponent', detail: null, isYou: false }],
    [view.matchScores.player, view.matchScores.opponent],
    history.map((h) => [h.totals.player, h.totals.opponent] as const),
    view.winner === 'player' ? 0 : view.winner === 'opponent' ? 1 : null,
    view.phase === 'match-over',
    last === undefined ? undefined : relabelTwoPlayerLine(last, opponentName),
  )
}

/** A finished four-player match, from the viewer's team. */
export function buildFourPlayerResults(view: FourPlayerGameView, names: SeatNames): MatchResults {
  const mine = teamOf(view.viewer)
  const theirs = mine === 'teamA' ? 'teamB' : 'teamA'
  const letter = (team: string) => (team === 'teamA' ? 'A' : 'B')
  const seats = [SeatId.P1, SeatId.P2, SeatId.P3, SeatId.P4]
  const nameOf = (seat: SeatId) => fourPlayerSeatLabel(seat, view.viewer, names)
  /** For listing who is on a team: the person's own name where they chose one ("You & Carol"), not just "Your partner". */
  const memberName = (seat: SeatId) => (seat === view.viewer ? 'You' : seat === partnerOf(view.viewer) ? (names[seat] ?? 'Your partner') : nameOf(seat))
  const mates = seats.filter((s) => teamOf(s) === mine)
  const rivals = seats.filter((s) => teamOf(s) === theirs)
  const history = view.handHistory ?? []
  const last = view.log[view.log.length - 1]
  return assemble(
    [
      { label: `Team ${letter(mine)}`, detail: mates.map(memberName).join(' & '), isYou: true },
      { label: `Team ${letter(theirs)}`, detail: rivals.map(memberName).join(' & '), isYou: false },
    ],
    [view.matchScores[mine], view.matchScores[theirs]],
    history.map((h) => [h.totals[mine], h.totals[theirs]] as const),
    view.winner === mine ? 0 : view.winner === theirs ? 1 : null,
    view.phase === 'match-over',
    last === undefined ? undefined : relabelFourPlayerLine(last, nameOf),
  )
}

