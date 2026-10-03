import { signal } from '@angular/core';
import {
  type ComputerPlayAction4P, type FourPlayerGameState, type FourPlayerGameView,
  type FourPlayerIntent, SeatId,
  applyFourPlayerMove, chooseFourPlayerBid, chooseFourPlayerMove, chooseFourPlayerOpeningMove,
  dealNextFourPlayerHand, nextSeat, partnerOf, startFourPlayerMatch, viewForSeat,
} from 'seep-engine';
import type { GameSession, MoveEvent } from './game-session';

const COMPUTER_THINK_MS = 700;

/**
 * The four-player equivalent of LocalSession: plays against the built-in
 * bots for the three seats other than the viewer, entirely in the
 * browser — today's actual behaviour, now behind the same GameSession
 * interface the two-player game uses. Owns the full FourPlayerGameState
 * internally, since the bots need it to decide their own moves, but only
 * ever exposes the redacted FourPlayerGameView the viewer is entitled to
 * see — see the note on GameSession.view.
 *
 * Unlike the two-player game there's no single fixed "the bot" seat:
 * whichever of the three non-viewer seats currently holds the turn is
 * the one that acts next. The gating is still simple, because at any
 * moment exactly one seat has the turn — see scheduleBotMoveIfNeeded.
 */
export class LocalFourPlayerSession implements GameSession<FourPlayerGameView, FourPlayerIntent, SeatId> {
  private readonly myId: SeatId;
  private state: FourPlayerGameState;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly view = signal<FourPlayerGameView | null>(null);
  readonly lastMove = signal<MoveEvent<FourPlayerGameView, FourPlayerIntent, SeatId> | null>(null);

  constructor(myId: SeatId = SeatId.P1, dealer: SeatId = SeatId.P4) {
    this.myId = myId;
    this.state = startFourPlayerMatch(dealer);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // no prior reveal to wait for at the very start of a match
  }

  /** Submits a move on the viewer's own behalf. Throws the same validation errors the engine always has. Does not itself schedule a bot move — see acknowledge(). */
  async submit(intent: FourPlayerIntent): Promise<void> {
    const before = viewForSeat(this.state, this.myId);
    const next = applyFourPlayerMove(this.state, this.myId, intent);
    this.state = next;
    this.publish(next);
    this.lastMove.set({ actor: this.myId, intent, before, after: viewForSeat(next, this.myId) });
  }

  /**
   * Schedules the next bot move, if any is due — called once the page
   * has finished showing whatever it wanted to show about the last move.
   * With four seats, several bot turns can genuinely happen in a row
   * (unlike two-player, where a bot move is always immediately followed
   * by the human's own turn) — the page calls this once per reveal it
   * dismisses, the same as it always has, and each bot move in the
   * sequence waits for its own acknowledge() exactly like the human's
   * moves do.
   */
  acknowledge(): void {
    this.scheduleBotMoveIfNeeded(this.state);
  }

  startNewMatch(): void {
    this.cancelPendingBotMove();
    this.lastMove.set(null);
    // The dealer must be whichever seat's nextSeat is myId — that's what
    // makes the viewer the bidder on a fresh hand, regardless of which
    // seat they're actually in. Calling startFourPlayerMatch() with no
    // dealer here would default to the engine's own SeatId.P4, which
    // only coincidentally makes P1 the bidder — for any other myId it
    // would leave the viewer bidder-less (an empty staged hand) on every
    // restarted match, the same bug the constructor avoids by always
    // being given dealer explicitly rather than relying on its default.
    const dealer = partnerOf(nextSeat(this.myId));
    this.state = startFourPlayerMatch(dealer);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // fresh match, nothing pending to acknowledge yet
  }

  async dealNext(): Promise<void> {
    this.lastMove.set(null);
    this.state = dealNextFourPlayerHand(this.state);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // new hand, nothing pending to acknowledge yet
  }

  dispose(): void {
    this.cancelPendingBotMove();
  }

  /** Updates the published view only. Scheduling a bot move is always a separate, explicit step — see the callers of scheduleBotMoveIfNeeded. */
  private publish(next: FourPlayerGameState): void {
    this.cancelPendingBotMove();
    this.view.set(viewForSeat(next, this.myId));
  }

  private scheduleBotMoveIfNeeded(s: FourPlayerGameState): void {
    this.cancelPendingBotMove();
    const seat = s.turn;
    if (seat === this.myId) return;

    const canAct =
      (s.phase === 'bidding' && seat === s.bidder) ||
      (s.phase === 'opening-move' && seat === s.bidder) ||
      s.phase === 'playing';
    if (!canAct) return;

    this.timer = setTimeout(() => {
      const before = viewForSeat(this.state, this.myId);
      const { intent, reason } = this.chooseBotIntent(this.state);
      const next = applyFourPlayerMove(this.state, seat, intent);
      this.state = next;
      this.publish(next);
      this.lastMove.set({ actor: seat, intent, reason, before, after: viewForSeat(next, this.myId) });
    }, COMPUTER_THINK_MS);
  }

  /** s.turn already identifies the acting seat — every chooseFourPlayer* function reads it directly from state. */
  private chooseBotIntent(s: FourPlayerGameState): { intent: FourPlayerIntent; reason?: string } {
    if (s.phase === 'bidding') {
      const value = chooseFourPlayerBid(s);
      return { intent: { type: 'bid', value }, reason: 'chose the lowest value they could support from their hand' };
    }
    const action: ComputerPlayAction4P =
      s.phase === 'opening-move' ? chooseFourPlayerOpeningMove(s) : chooseFourPlayerMove(s);
    return { intent: this.actionToIntent(action), reason: action.reason };
  }

  private actionToIntent(action: ComputerPlayAction4P): FourPlayerIntent {
    if (action.type === 'capture') return { type: 'capture', card: action.card, targetItemIds: action.targetItemIds };
    if (action.type === 'build') {
      return { type: 'build', card: action.card, looseItemIds: action.looseItemIds, targetValue: action.targetValue };
    }
    if (action.type === 'modify') {
      return { type: 'modify', card: action.card, houseId: action.houseId, extraLooseItemIds: action.extraLooseItemIds };
    }
    return { type: 'throw', card: action.card };
  }

  private cancelPendingBotMove(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
