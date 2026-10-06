/**
 * Whose turn it is, in words, for the big line above the buttons on an online table. The player on the move is already named in
 * the small clock line; this makes it the most obvious thing on the screen, so nobody has to work out "it must be my turn
 * because the buttons appeared".
 */
export interface TurnLine {
  readonly text: string
  /** True when it is the viewer's own turn. */
  readonly mine: boolean
}

/** The phases in which someone is on the move. Between hands and after the match nobody is. */
const PHASES_WITH_A_TURN: readonly string[] = ['bidding', 'opening-move', 'playing']

export function isOnTheMove(phase: string, turnSeat: string | null | undefined, seat: string): boolean {
  return PHASES_WITH_A_TURN.includes(phase) && !!turnSeat && turnSeat === seat
}

/** "Your turn", or "Carol’s turn" naming whoever is on the move; null when nobody is. */
export function describeTurn(phase: string, turnSeat: string | null | undefined, mySeat: string, nameOf: (seat: string) => string): TurnLine | null {
  if (!PHASES_WITH_A_TURN.includes(phase) || !turnSeat) return null
  if (turnSeat === mySeat) return { text: 'Your turn', mine: true }
  return { text: `${nameOf(turnSeat)}’s turn`, mine: false }
}
