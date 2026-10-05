import type { FourPlayerGameView, GameView, PlayerId, SeatId } from 'seep-engine'

/**
 * The server always speaks in absolute seat names. A page, though, is
 * written from one viewer's point of view. A Perspective is the small
 * adapter between the two, so the pages don't have to know whether they are
 * showing a local bot game or one seat of a game between two people.
 */
export interface Perspective<TView, TActor> {
  /** Re-expresses a server view as this viewer should see it. `seat` is the viewer's absolute seat. */
  view(raw: TView, seat: string): TView
  /** Who a page should attribute a move to, given the mover's absolute seat. */
  actor(moveSeat: string, mySeat: string): TActor
  /** True if the viewer holds the turn in this (already re-expressed) view. */
  isMyTurn(view: TView): boolean
  phase(view: TView): string
}

const other = (id: PlayerId): PlayerId => (id === 'player' ? 'opponent' : 'player')
const swap = <T>(record: Record<PlayerId, T>): Record<PlayerId, T> => ({ player: record.opponent, opponent: record.player })

/**
 * Swaps the roles of the two players throughout a two-player view.
 *
 * The two-player pages are written for a viewer who is always 'player'. A
 * game between two people has someone seated as 'opponent'; for them, the
 * session swaps the roles so the same, unmodified page works. It is exact for
 * two players because the game is symmetric. `myHand` and `opponentCardCount`
 * are already relative to the viewer and so stay as they are. (The server
 * has already rephrased the engine's log for the 'opponent' seat, so "You
 * played..." is already true of the viewer.) Applying it twice gives back the
 * original.
 */
export function mirrorTwoPlayerView(view: GameView): GameView {
  return {
    ...view,
    viewer: other(view.viewer),
    floor: view.floor.map((item) => (item.kind === 'house' ? { ...item, owners: item.owners.map(other) } : item)),
    captures: swap(view.captures),
    sweepPoints: swap(view.sweepPoints),
    matchScores: swap(view.matchScores),
    bidder: other(view.bidder),
    turn: other(view.turn),
    lastCapturer: view.lastCapturer && other(view.lastCapturer),
    winner: view.winner && other(view.winner),
    lastHandTotals: view.lastHandTotals && swap(view.lastHandTotals),
    // The history is kept from the 'player' side too, so the opponent's seat swaps each hand's two sides as well.
    handHistory: view.handHistory?.map((hand) => ({ totals: swap(hand.totals) })),
  }
}

export const twoPlayerPerspective: Perspective<GameView, PlayerId> = {
  view: (raw, seat) => (seat === 'opponent' ? mirrorTwoPlayerView(raw) : raw),
  actor: (moveSeat, mySeat) => (moveSeat === mySeat ? 'player' : 'opponent'),
  isMyTurn: (view) => view.turn === 'player',
  phase: (view) => view.phase,
}

/** The four-player page already works from `view.viewer` (its mySeat), so nothing needs re-expressing. */
export const fourPlayerPerspective: Perspective<FourPlayerGameView, SeatId> = {
  view: (raw) => raw,
  actor: (moveSeat) => moveSeat as SeatId,
  isMyTurn: (view) => view.turn === view.viewer,
  phase: (view) => view.phase,
}
