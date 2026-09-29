import { signal } from '@angular/core';
import {
  type ComputerPlayAction, type GameState, type GameView, type Intent, type PlayerId,
  applyMove, chooseComputerBid, chooseComputerMove, chooseComputerOpeningMove,
  dealNextHand, startMatch, viewFor,
} from 'seep-engine';
import type { GameSession, MoveEvent } from './game-session';

const COMPUTER_THINK_MS = 700;

/**
 * Plays against the built-in bots, entirely in the browser — today's
 * actual behaviour, now behind the GameSession interface so the
 * two-player page doesn't need to change again when a RemoteSession
 * (talking to a real server) eventually replaces this. Owns the full
 * GameState internally, since the bots need it to decide their own
 * moves, but only ever exposes the redacted GameView the viewer is
 * entitled to see — see the note on GameSession.view.
 */
export class LocalSession implements GameSession<GameView, Intent, PlayerId> {
  private readonly myId: PlayerId;
  private readonly botId: PlayerId;
  private state: GameState;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly view = signal<GameView | null>(null);
  readonly lastMove = signal<MoveEvent<GameView, Intent, PlayerId> | null>(null);

  constructor(myId: PlayerId = 'player', firstBidder: PlayerId = myId) {
    this.myId = myId;
    this.botId = myId === 'player' ? 'opponent' : 'player';
    this.state = startMatch(firstBidder);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // no prior reveal to wait for at the very start of a match
  }

  /** Submits a move on the viewer's own behalf. Throws the same validation errors the engine always has — the caller catches these exactly as it did calling the engine directly before. Does not itself schedule a bot move — see acknowledge(). */
  submit(intent: Intent): void {
    const before = viewFor(this.state, this.myId);
    const next = applyMove(this.state, this.myId, intent);
    this.state = next;
    this.publish(next);
    this.lastMove.set({ actor: this.myId, intent, before, after: viewFor(next, this.myId) });
  }

  acknowledge(): void {
    this.scheduleBotMoveIfNeeded(this.state);
  }

  startNewMatch(): void {
    this.cancelPendingBotMove();
    this.lastMove.set(null);
    this.state = startMatch(this.myId);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // fresh match, nothing pending to acknowledge yet
  }

  dealNext(): void {
    this.lastMove.set(null);
    this.state = dealNextHand(this.state);
    this.publish(this.state);
    this.scheduleBotMoveIfNeeded(this.state); // new hand, nothing pending to acknowledge yet
  }

  dispose(): void {
    this.cancelPendingBotMove();
  }

  /** Updates the published view only. Scheduling a bot move is always a separate, explicit step — see the callers of scheduleBotMoveIfNeeded. */
  private publish(next: GameState): void {
    this.cancelPendingBotMove();
    this.view.set(viewFor(next, this.myId));
  }

  private scheduleBotMoveIfNeeded(s: GameState): void {
    this.cancelPendingBotMove();
    if (s.turn !== this.botId) return;
    const canAct =
      (s.phase === 'bidding' && s.bidder === this.botId) ||
      (s.phase === 'opening-move' && s.bidder === this.botId) ||
      s.phase === 'playing';
    if (!canAct) return;

    this.timer = setTimeout(() => {
      const before = viewFor(this.state, this.myId);
      const { intent, reason } = this.chooseBotIntent(this.state);
      const next = applyMove(this.state, this.botId, intent);
      this.state = next;
      this.publish(next);
      this.lastMove.set({ actor: this.botId, intent, reason, before, after: viewFor(next, this.myId) });
    }, COMPUTER_THINK_MS);
  }

  private chooseBotIntent(s: GameState): { intent: Intent; reason?: string } {
    if (s.phase === 'bidding') {
      const value = chooseComputerBid(s);
      return { intent: { type: 'bid', value }, reason: 'chose the lowest value it could support from its hand' };
    }
    const action: ComputerPlayAction =
      s.phase === 'opening-move' ? chooseComputerOpeningMove(s) : chooseComputerMove(s);
    return { intent: this.actionToIntent(action), reason: action.reason };
  }

  private actionToIntent(action: ComputerPlayAction): Intent {
    if (action.type === 'capture') return { type: 'capture', card: action.card, targetItemIds: action.targetItemIds };
    if (action.type === 'build') {
      return { type: 'build', card: action.card, looseItemIds: action.looseItemIds, targetValue: action.targetValue };
    }
    return { type: 'throw', card: action.card };
  }

  private cancelPendingBotMove(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
