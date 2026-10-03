import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { GameView, Intent, PlayerId } from 'seep-engine'
import { ApiError } from '../../core/game-api'
import { AUTH, ONLINE_API } from '../../core/online'
import { twoPlayerPerspective } from '../../core/perspective'
import { RemoteSession } from '../../core/remote-session'
import { describeClock } from '../../core/turn-clock-text'
import { TwoPlayerComponent } from '../two-player/two-player.component'

/**
 * One table of an online game. Opens the game, shows a "waiting for your
 * opponent" panel (with the invite link) until the seat is taken, and then
 * hands the live session to the same two-player page used against the bots.
 */
@Component({
  selector: 'app-online-game',
  standalone: true,
  imports: [RouterLink, TwoPlayerComponent],
  templateUrl: './online-game.component.html',
})
export class OnlineGameComponent {
  private readonly route = inject(ActivatedRoute)
  private readonly auth = inject(AUTH)
  private readonly api = inject(ONLINE_API)
  private readonly destroyRef = inject(DestroyRef)

  readonly session = signal<RemoteSession<GameView, Intent, PlayerId> | null>(null)
  readonly error = signal<string | null>(null)
  readonly copied = signal(false)
  readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator

  readonly inviteLink = computed(() => {
    const code = this.session()?.inviteCode()
    return code ? `${window.location.origin}/join/${code}` : null
  })

  /** Once a second, so the countdown moves. */
  private readonly now = signal(Date.now())
  private readonly ticker = setInterval(() => this.now.set(Date.now()), 1000)

  readonly clockLine = computed(() => {
    const session = this.session()
    return session ? describeClock(session.clock(), session.seat(), this.now()) : null
  })

  private disposed = false
  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.session()?.refreshNow()
  }

  constructor() {
    // Coming back to a backgrounded tab: catch up at once rather than waiting for the (slow) background poll.
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    this.destroyRef.onDestroy(() => {
      this.disposed = true
      clearInterval(this.ticker)
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.session()?.dispose()
    })
    void this.open()
  }

  retry(): void {
    void this.session()?.refreshNow()
  }

  async copyLink(): Promise<void> {
    const link = this.inviteLink()
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      this.copied.set(true)
      setTimeout(() => this.copied.set(false), 2000)
    } catch {
      // Clipboard access can be refused; the link is on screen to copy by hand.
    }
  }

  async share(): Promise<void> {
    const link = this.inviteLink()
    if (!link) return
    try {
      await navigator.share({ title: 'Seep', text: 'Join my game of Seep', url: link })
    } catch {
      // The person closed the share sheet; nothing to do.
    }
  }

  private async open(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? ''
    await this.auth.start()
    if (!this.auth.identity()) {
      this.error.set('Please sign in to open this table.')
      return
    }
    try {
      const session = await RemoteSession.open<GameView, Intent, PlayerId>({
        api: this.api,
        gameId: id,
        perspective: twoPlayerPerspective,
      })
      if (this.disposed) {
        session.dispose()
        return
      }
      if (session.kind() !== 'two_player') {
        session.dispose()
        this.error.set("Four-player tables can't be played online yet.")
        return
      }
      this.session.set(session)
    } catch (err) {
      this.error.set(this.messageFor(err))
    }
  }

  private messageFor(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.status === 404) return "That table wasn't found, or it isn't yours."
      if (err.status === 401) return 'Your sign-in has expired. Please sign in again.'
      return err.message
    }
    return "Couldn't reach the server. Check your connection and try again."
  }
}
