import { signal } from '@angular/core';
import {
  type ComputerPlayAction4P, type FourPlayerGameState, type FourPlayerGameView,
  type FourPlayerIntent, SeatId,
  applyFourPlayerMove, chooseFourPlayerBid, chooseFourPlayerMove, chooseFourPlayerOpeningMove,
  dealNextFourPlayerHand, startFourPlayerMatch, viewForSeat,
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
  }

  /** Submits a move on the viewer's own behalf. Throws the same validation errors the engine always has. */
  submit(intent: FourPlayerIntent): void {
    const before = viewForSeat(this.state, this.myId);
    const next = applyFourPlayerMove(this.state, this.myId, intent);
    this.state = next;
    this.publish(next);
    this.lastMove.set({ actor: this.myId, intent, before, after: viewForSeat(next, this.myId) });
  }

  startNewMatch(): void {
    this.cancelPendingBotMove();
    this.lastMove.set(null);
    this.state = startFourPlayerMatch();
    this.publish(this.state);
  }

  dealNext(): void {
    this.lastMove.set(null);
    this.state = dealNextFourPlayerHand(this.state);
    this.publish(this.state);
  }

  dispose(): void {
    this.cancelPendingBotMove();
  }

  private publish(next: FourPlayerGameState): void {
    this.view.set(viewForSeat(next, this.myId));
    this.scheduleBotMoveIfNeeded(next);
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
