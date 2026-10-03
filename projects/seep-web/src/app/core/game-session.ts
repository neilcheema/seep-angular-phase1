import type { Signal } from '@angular/core';

/**
 * A move that was just applied, carrying enough surrounding state for a
 * page to build its own move-reveal presentation from — who acted, what
 * they did, why (for a computer-chosen move), and the view just before
 * and just after, so a page can compare them (e.g. "how many points did
 * this sweep earn") without the session needing to know anything about
 * how a particular page chooses to present that.
 */
export interface MoveEvent<TView, TIntent, TActor> {
  readonly actor: TActor;
  readonly intent: TIntent;
  readonly reason?: string;
  readonly before: TView;
  readonly after: TView;
}

/**
 * What a game page actually needs, regardless of whether the game is
 * being played locally against bots (LocalSession — today's behaviour; it also has startNewMatch(), which only
 * makes sense against bots, so that one isn't part of this interface)
 * or against another logged-in player over the network (RemoteSession,
 * arriving in a later phase). A page written against this interface
 * alone doesn't need to know or care which one it's actually talking to.
 *
 * `view` is always the same redacted GameView/FourPlayerGameView shape a
 * real opponent's hand will eventually need to be hidden behind (see
 * seep-engine's viewFor/viewForSeat) — even LocalSession, where every
 * "opponent" is a bot and nothing is really secret, only ever exposes
 * this redacted shape, never the full GameState. That's deliberate: it
 * means there's nothing left to change in a page later just because an
 * opponent becomes a real, hidden hand instead of a bot's fully-known
 * one — that transition already happened here, now, while it's still
 * low-stakes to get right.
 */
export interface GameSession<TView, TIntent, TActor> {
  readonly view: Signal<TView | null>;
  readonly lastMove: Signal<MoveEvent<TView, TIntent, TActor> | null>;
  /**
   * Applies a move on the viewer's behalf. Resolves once it has been
   * applied; rejects with an Error whose message is the rules' own
   * explanation if it was refused (the page shows it as-is). It is a
   * Promise because an online game must go over the network to find out;
   * a local game settles instantly, and its state changes at the very
   * moment of the call, exactly as before this was asynchronous.
   */
  submit(intent: TIntent): Promise<void>;
  /**
   * Tells the session the page has finished showing whatever it wanted
   * to show about the last move (e.g. the move-reveal overlay was
   * dismissed) and it's safe to proceed. A LocalSession only schedules
   * its next bot move once this is called — never automatically right
   * after a move resolves — the same "every move pauses until Next"
   * pacing the two-player and four-player pages have always had. Call
   * this once, right when the page dismisses its own reveal; a
   * RemoteSession is free to make this a no-op, since pacing between
   * real players' moves isn't something a session needs to gate.
   */
  acknowledge(): void;
  /** Deals the next hand once one has finished. Rejects if the hand isn't over. */
  dealNext(): Promise<void>;
  /** Cancels any pending bot-move timer. Call from the page's DestroyRef. */
  dispose(): void;
}
