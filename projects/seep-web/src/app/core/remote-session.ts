import { signal } from '@angular/core'
import type { GameKind, GameStatus, GameSnapshotDto, MutationDto, PlayerInfoDto } from './api-types'
import { ApiError, type GameApi } from './game-api'
import type { GameSession, MoveEvent } from './game-session'
import type { Perspective } from './perspective'
import { nextPollDelay } from './poll-policy'

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'unauthorized'

export interface RemoteSessionOptions<TView, TActor> {
  readonly api: GameApi
  readonly gameId: string
  readonly perspective: Perspective<TView, TActor>
  /** True while the tab is in the background (polling then slows right down). Defaults to the page's visibility. */
  readonly isHidden?: () => boolean
}

const MAX_BACKOFF_MS = 30_000

function isDealNext(intent: unknown): boolean {
  return typeof intent === 'object' && intent !== null && (intent as { type?: unknown }).type === 'deal-next'
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

  private readonly options: RemoteSessionOptions<TView, TActor>
  private version: number | undefined
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private polling = false
  private failures = 0
  private unchangedPolls = 0

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
    const res = await this.options.api.getGame<TView>(this.options.gameId, this.version)
    this.failures = 0
    this.connection.set('online')
    if (!res.changed) {
      // Same rule as for snapshots: an answer older than what we already hold (e.g. a poll sent before our own
      // move, answered after it) must not drag the status back. A finished game would look active again.
      if (this.version !== undefined && res.version < this.version) return
      this.unchangedPolls++
      this.status.set(res.status)
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
    this.status.set(res.status)
    this.players.set(res.players)
    this.inviteCode.set(res.inviteCode)
    this.view.set(after)

    const others = res.moves.filter((m) => m.seat !== res.seat && !isDealNext(m.intent))
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
      this.status.set(result.status)
      this.view.set(after)
    }
    return after
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
    })
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
