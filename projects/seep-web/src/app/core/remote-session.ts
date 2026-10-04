import { signal } from '@angular/core'
import type { ClockDto, GameKind, GameStatus, GameSnapshotDto, MutationDto, PlayerInfoDto, ReactionDto } from './api-types'
import { ApiError, type GameApi } from './game-api'
import type { GameSession, MoveEvent } from './game-session'
import type { Perspective } from './perspective'
import { nextPollDelay } from './poll-policy'

/** A quick reaction from another player, as this screen first heard it. */
export interface IncomingReaction {
  readonly seq: number
  readonly seat: string
  readonly code: string
}

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'unauthorized'

export interface RemoteSessionOptions<TView, TActor> {
  readonly api: GameApi
  readonly gameId: string
  readonly perspective: Perspective<TView, TActor>
  /** True while the tab is in the background (polling then slows right down). Defaults to the page's visibility. */
  readonly isHidden?: () => boolean
  /** The current time in milliseconds. Defaults to the real clock; tests supply their own. */
  readonly now?: () => number
}

const MAX_BACKOFF_MS = 30_000

/** A clock reading plus when this device received it, so the time since can be added without trusting this device's idea of the date. */
export interface ClockState extends ClockDto {
  readonly receivedAt: number
}

/** Entries in the move list that are not plays, so are never shown as "what just happened". */
function isNotAPlay(intent: unknown): boolean {
  const type = typeof intent === 'object' && intent !== null ? (intent as { type?: unknown }).type : undefined
  return type === 'deal-next' || type === 'forfeit'
}

/**
 * One seat of a game played over the network, behind the same GameSession
 * interface LocalSession implements, so the existing pages need no idea
 * which they're talking to.
 *
 * The server owns the game; this keeps a redacted copy fresh by polling
 * (cheaply: "anything since version N?"), and turns what it learns into the
 * same `lastMove` events a local game produces, so a page can show "what
 * just happened" for the other player's moves exactly as it does for a bot's.
 *
 * Known limit: if several other players move between two polls (possible in
 * four-player), only the last of those moves gets a reveal; the view itself
 * is always fully up to date.
 */
export class RemoteSession<TView, TIntent, TActor> implements GameSession<TView, TIntent, TActor> {
  readonly view = signal<TView | null>(null)
  readonly lastMove = signal<MoveEvent<TView, TIntent, TActor> | null>(null)
  readonly status = signal<GameStatus>('waiting')
  /** Which game this is (set once loaded), so a screen can decline kinds it can't show. */
  readonly kind = signal<GameKind | null>(null)
  readonly players = signal<PlayerInfoDto[]>([])
  readonly inviteCode = signal<string | null>(null)
  /** The viewer's own seat, in the server's absolute names. */
  readonly seat = signal<string | null>(null)
  readonly connection = signal<ConnectionState>('connecting')
  /** Whose turn clock is running and for how long, or null (no clock, or an older server). */
  readonly clock = signal<ClockState | null>(null)
  /** The table made for a rematch of this game, once either player has asked for one. */
  readonly rematchGameId = signal<string | null>(null)
  /** Quick reactions from the OTHER players, newest last, as this screen heard them (at most the last ten). */
  readonly reactions = signal<IncomingReaction[]>([])

  private readonly options: RemoteSessionOptions<TView, TActor>
  private version: number | undefined
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private polling = false
  private failures = 0
  private unchangedPolls = 0
  /** When this screen first saw the game was over (for the short listen for a rematch). */
  private finishedSeenAt: number | null = null
  /** The last quick reaction we have heard about. Undefined until the first load, so old reactions are never replayed. */
  private reactionSeq: number | undefined

  private constructor(options: RemoteSessionOptions<TView, TActor>) {
    this.options = options
  }

  /**
   * Loads the game and starts keeping it fresh. If the first load fails the
   * ApiError reaches the caller (404: no such game or not yours; 401: signed
   * out), so a page can say so instead of showing an empty table.
   */
  static async open<TView, TIntent, TActor>(
    options: RemoteSessionOptions<TView, TActor>,
  ): Promise<RemoteSession<TView, TIntent, TActor>> {
    const session = new RemoteSession<TView, TIntent, TActor>(options)
    await session.refresh()
    session.schedule()
    return session
  }

  async submit(intent: TIntent): Promise<void> {
    const before = this.view()
    const version = this.version
    if (before === null || version === undefined) throw new Error('The game has not loaded yet.')

    let result: MutationDto<TView>
    try {
      result = await this.options.api.submitMove<TView>(this.options.gameId, intent, version)
    } catch (err) {
      throw await this.explain(err)
    }
    const after = this.adoptMutation(result)
    this.lastMove.set({ actor: this.options.perspective.actor(result.seat, result.seat), intent, before, after })
    this.afterOwnChange()
  }

  async dealNext(): Promise<void> {
    const version = this.version
    if (version === undefined) throw new Error('The game has not loaded yet.')
    let result: MutationDto<TView>
    try {
      result = await this.options.api.dealNext<TView>(this.options.gameId, version)
    } catch (err) {
      throw await this.explain(err)
    }
    this.lastMove.set(null)
    this.adoptMutation(result)
    this.afterOwnChange()
  }

  /** Online there is nothing to pace between real players' moves. */
  acknowledge(): void {
    // intentionally nothing
  }

  /** Polls right now (e.g. when the tab becomes visible, or the user taps "reconnect"). */
  async refreshNow(): Promise<void> {
    if (this.disposed) return
    try {
      await this.refresh()
    } catch (err) {
      this.onPollError(err)
    }
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  // ---------------------------------------------------------------- internals

  /** Fetches anything newer than what we have. Throws on any failure. */
  private async refresh(): Promise<void> {
    const res = await this.options.api.getGame<TView>(this.options.gameId, this.version, this.reactionSeq)
    this.failures = 0
    this.connection.set('online')
    this.takeReactions(res)
    if (!res.changed) {
      // Same rule as for snapshots: an answer older than what we already hold (e.g. a poll sent before our own
      // move, answered after it) must not drag the status back. A finished game would look active again.
      if (this.version !== undefined && res.version < this.version) return
      this.unchangedPolls++
      this.status.set(res.status)
      this.takeClock(res.clock)
      return
    }
    this.unchangedPolls = 0
    this.applySnapshot(res)
  }

  private applySnapshot(res: GameSnapshotDto<TView>): void {
    // A slow response can arrive after a newer one (e.g. our own move's result): never go backwards.
    if (this.version !== undefined && res.version < this.version) return

    const before = this.view()
    const after = this.options.perspective.view(res.view, res.seat)
    this.version = res.version
    this.seat.set(res.seat)
    this.kind.set(res.kind)
    this.noteStatus(res.status)
    this.rematchGameId.set(res.rematchGameId ?? null)
    this.players.set(res.players)
    this.inviteCode.set(res.inviteCode)
    this.view.set(after)
    this.takeClock(res.clock)

    const others = res.moves.filter((m) => m.seat !== res.seat && !isNotAPlay(m.intent))
    const last = others.at(-1)
    if (before !== null && last !== undefined) {
      this.lastMove.set({
        actor: this.options.perspective.actor(last.seat, res.seat),
        intent: last.intent as TIntent,
        before,
        after,
      })
    }
  }

  /** Takes the state our own move produced, unless polling has already delivered something newer. */
  private adoptMutation(result: MutationDto<TView>): TView {
    const after = this.options.perspective.view(result.view, result.seat)
    if (this.version === undefined || result.version >= this.version) {
      this.version = result.version
      this.seat.set(result.seat)
      this.noteStatus(result.status)
      this.view.set(after)
      this.takeClock(result.clock)
    }
    return after
  }

  private takeClock(clock: ClockDto | undefined): void {
    this.clock.set(clock ? { ...clock, receivedAt: Date.now() } : null)
  }

  private afterOwnChange(): void {
    this.unchangedPolls = 0
    this.failures = 0
    this.connection.set('online')
    this.schedule()
  }

  /** Turns a failed request into an Error whose message is fit to show the player. */
  private async explain(err: unknown): Promise<Error> {
    if (err instanceof ApiError) {
      if (err.status === 409 && typeof err.details['currentVersion'] === 'number') {
        // We were looking at an old version of the game: catch up so the next attempt is informed.
        await this.refreshNow()
        return new Error('The game changed while you were deciding. Your view has been refreshed; please try again.')
      }
      if (err.status === 401) this.connection.set('unauthorized')
      return new Error(err.message)
    }
    return new Error("Couldn't reach the server. Check your connection and try again.")
  }

  private schedule(): void {
    this.clearTimer()
    if (this.disposed) return
    const delay = this.currentDelay()
    if (delay === null) return
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    this.timer = null
    if (this.disposed || this.polling) return
    this.polling = true
    try {
      await this.refresh()
    } catch (err) {
      this.onPollError(err)
    } finally {
      this.polling = false
      this.schedule()
    }
  }

  private currentDelay(): number | null {
    if (this.connection() === 'unauthorized') return null
    if (this.failures > 0) return Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (this.failures - 1))
    const view = this.view()
    const hidden = this.options.isHidden?.() ?? (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return nextPollDelay({
      status: this.status(),
      myTurn: view !== null && this.options.perspective.isMyTurn(view),
      phase: view === null ? '' : this.options.perspective.phase(view),
      hidden,
      unchangedPolls: this.unchangedPolls,
      ...(this.finishedSeenAt === null ? {} : { finishedForMs: this.now() - this.finishedSeenAt }),
      watchForRematch: this.kind() === 'two_player' && this.rematchGameId() === null,
    })
  }

  /** Sends a quick reaction to everyone at the table. It never changes the game. Errors (such as “too quickly”) are let through. */
  async sendReaction(code: string): Promise<void> {
    await this.options.api.sendReaction(this.options.gameId, code)
  }

  /**
   * Hears the other players' reactions. The cursor only moves forward, a reaction of our own is not echoed back to us,
   * and an older server (which sends no reaction fields at all) is simply ignored.
   */
  private takeReactions(res: { reactionSeq?: number; reactions?: readonly ReactionDto[] }): void {
    if (res.reactionSeq === undefined) return
    const cursor = this.reactionSeq
    if (cursor !== undefined) {
      const mine = this.seat()
      const fresh = (res.reactions ?? []).filter((r) => r.seq > cursor && r.seat !== mine)
      if (fresh.length > 0) {
        this.reactions.update((list) => [...list, ...fresh.map((r) => ({ seq: r.seq, seat: r.seat, code: r.code }))].slice(-10))
      }
    }
    const newest = Math.max(res.reactionSeq, ...(res.reactions ?? []).map((r) => r.seq))
    this.reactionSeq = cursor === undefined ? newest : Math.max(cursor, newest)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** Records the status, and when the game was first seen to be over. */
  private noteStatus(status: GameStatus): void {
    this.status.set(status)
    if (status === 'finished' && this.finishedSeenAt === null) this.finishedSeenAt = this.now()
  }

  private onPollError(err: unknown): void {
    this.failures++
    this.connection.set(err instanceof ApiError && err.status === 401 ? 'unauthorized' : 'offline')
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
