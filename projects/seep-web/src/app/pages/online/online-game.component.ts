import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import type { FourPlayerGameView, FourPlayerIntent, GameView, Intent, PlayerId, SeatId } from 'seep-engine'
import { partnerOf, teamOf } from 'seep-engine'
import { opponentNameOf, sameNames, seatNamesOf } from '../../core/board-names'
import { seatLine } from '../../core/display-names'
import { ApiError } from '../../core/game-api'
import { AUTH, ONLINE_API } from '../../core/online'
import { fourPlayerPerspective, twoPlayerPerspective } from '../../core/perspective'
import { RemoteSession } from '../../core/remote-session'
import { type ClockNames, describeClock } from '../../core/turn-clock-text'
import { FourPlayerComponent } from '../four-player/four-player.component'
import { TwoPlayerComponent } from '../two-player/two-player.component'

type TwoPlayerSession = RemoteSession<GameView, Intent, PlayerId>
type FourPlayerSession = RemoteSession<FourPlayerGameView, FourPlayerIntent, SeatId>

/**
 * One table of an online game. Opens the game, shows a "waiting" panel (with
 * the invite link and who has arrived) until every seat is taken, and then
 * hands the live session to the same page used against the bots: the
 * two-player page or the four-player page, whichever kind of table this is.
 */
@Component({
  selector: 'app-online-game',
  standalone: true,
  imports: [RouterLink, TwoPlayerComponent, FourPlayerComponent],
  templateUrl: './online-game.component.html',
})
export class OnlineGameComponent {
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly auth = inject(AUTH)
  private readonly api = inject(ONLINE_API)
  private readonly destroyRef = inject(DestroyRef)

  /** Exactly one of these is set once the table has opened, according to its kind. */
  readonly two = signal<TwoPlayerSession | null>(null)
  readonly four = signal<FourPlayerSession | null>(null)
  /** Whichever it is, for the parts of the screen that don't care (waiting panel, banners, clock). */
  readonly session = computed<TwoPlayerSession | FourPlayerSession | null>(() => this.two() ?? this.four())

  readonly error = signal<string | null>(null)

  // --- rematch (two-player) ---
  readonly rematchBusy = signal(false)
  readonly rematchError = signal<string | null>(null)
  /** The other player has already asked for a rematch, so the button becomes "Join rematch". */
  readonly rematchOffered = computed(() => this.two()?.rematchGameId() != null)
  readonly copied = signal(false)
  readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator

  readonly inviteLink = computed(() => {
    const code = this.session()?.inviteCode()
    return code ? `${window.location.origin}/join/${code}` : null
  })

  // --- names on the boards ---
  readonly opponentName = computed(() => opponentNameOf(this.two()?.players() ?? []))
  /** Compared by content: the player list is a new array after every server update, but the names rarely change. */
  readonly seatNames = computed(() => seatNamesOf(this.four()?.players() ?? []), { equal: sameNames })

  // --- the waiting panel, for a table that needs several people ---
  /** One line per seat for the list of who has arrived, e.g. "Player 2 — Bob". */
  readonly seatLine = seatLine
  readonly seatsFilled = computed(() => this.session()?.players().filter((p) => p.joined).length ?? 0)
  readonly seatsTotal = computed(() => this.session()?.players().length ?? 0)
  /** "p3" -> 3 (the viewer's seat number at a four-player table). */
  readonly mySeatNumber = computed(() => Number((this.session()?.seat() ?? 'p1').slice(1)))
  readonly myTeamLetter = computed(() => (this.mySeatNumber() % 2 === 1 ? 'A' : 'B'))

  /** Once a second, so the countdown moves. */
  private readonly now = signal(Date.now())
  private readonly ticker = setInterval(() => this.now.set(Date.now()), 1000)

  /** The clock line says WHO is on the clock, by the name they chose (or "Your opponent" / "Player N" if they have none). */
  private readonly clockNames = computed<ClockNames | undefined>(() => {
    const session = this.session()
    const seat = session?.seat()
    if (!session || !seat) return undefined
    const nameOfSeat = (s: string): string | null => session.players().find((p) => p.seat === s)?.displayName ?? null
    if (this.four()) {
      const mine = seat as SeatId
      return {
        nameOf: (s) => (s === mine ? 'You' : s === partnerOf(mine) ? 'Your partner' : (nameOfSeat(s) ?? `Player ${s.slice(1)}`)),
        sameTeam: (s) => teamOf(s as SeatId) === teamOf(mine),
      }
    }
    return { nameOf: (s) => (s === seat ? 'You' : (nameOfSeat(s) ?? 'Your opponent')) }
  })

  readonly clockLine = computed(() => {
    const session = this.session()
    return session ? describeClock(session.clock(), session.seat(), this.now(), this.clockNames()) : null
  })

  private disposed = false
  /** Which table is open, and a counter so a slow open for a table we have since left cannot win. */
  private gameId = ''
  private openSeq = 0
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
    // The same screen is reused when only the table in the address changes (old match -> its rematch), so it must
    // reopen whenever the id changes, not just once.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => void this.reopen(params.get('id') ?? ''))
  }

  /** Asks for a rematch of this match: makes the table if first, joins it if the other player already did. */
  async rematch(): Promise<void> {
    if (!this.gameId || this.rematchBusy()) return
    this.rematchBusy.set(true)
    this.rematchError.set(null)
    try {
      const result = await this.api.requestRematch(this.gameId)
      await this.router.navigate(['/online/game', result.gameId])
    } catch (err) {
      this.rematchError.set(err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.")
    } finally {
      this.rematchBusy.set(false)
    }
  }

  private async reopen(id: string): Promise<void> {
    const seq = ++this.openSeq
    this.session()?.dispose()
    this.two.set(null)
    this.four.set(null)
    this.error.set(null)
    this.rematchError.set(null)
    this.gameId = id
    await this.open(id, seq)
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

  private async open(id: string, seq: number): Promise<void> {
    await this.auth.start()
    if (!this.auth.identity()) {
      this.error.set('Please sign in to open this table.')
      return
    }
    try {
      // Which kind of table is this? Ask once, then open the matching kind of session.
      const probe = await this.api.getGame<unknown>(id)
      if (!probe.changed) throw new Error('unexpected reply')
      if (probe.kind === 'four_player') {
        const session = await RemoteSession.open<FourPlayerGameView, FourPlayerIntent, SeatId>({
          api: this.api,
          gameId: id,
          perspective: fourPlayerPerspective,
        })
        if (this.disposed || seq !== this.openSeq) return session.dispose()
        this.four.set(session)
      } else {
        const session = await RemoteSession.open<GameView, Intent, PlayerId>({
          api: this.api,
          gameId: id,
          perspective: twoPlayerPerspective,
        })
        if (this.disposed || seq !== this.openSeq) return session.dispose()
        this.two.set(session)
      }
    } catch (err) {
      if (seq === this.openSeq) this.error.set(this.messageFor(err))
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
