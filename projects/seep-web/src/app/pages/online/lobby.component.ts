import { Component, effect, inject, signal, untracked } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import type { GameInfoDto } from '../../core/api-types'
import { ApiError } from '../../core/game-api'
import { AUTH, ONLINE_API } from '../../core/online'

/**
 * "Play online": sign in, start a table, join one by code, or pick up a game
 * already under way. Also the landing place for an invite link
 * (/join/ABC234): once signed in, it takes the seat straight away.
 */
@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './lobby.component.html',
})
export class LobbyComponent {
  private readonly auth = inject(AUTH)
  private readonly api = inject(ONLINE_API)
  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)

  readonly identity = this.auth.identity
  readonly ready = this.auth.ready
  readonly authBusy = this.auth.busy
  readonly authError = this.auth.error

  /** The code from a /join/ABC234 link, if that is how the person got here. */
  readonly linkCode = signal<string | null>(null)
  readonly mode = signal<'signin' | 'signup'>('signin')
  readonly games = signal<GameInfoDto[]>([])
  readonly working = signal(false)
  readonly error = signal<string | null>(null)

  private handledUid: string | null = null

  constructor() {
    const code = this.route.snapshot.paramMap.get('code')
    if (code) this.linkCode.set(code.trim().toUpperCase())
    void this.auth.start()

    // Once per sign-in: register the profile, then either take the invited seat or list the person's tables.
    effect(() => {
      const who = this.identity()
      if (!who) {
        this.handledUid = null
        return
      }
      if (this.handledUid === who.uid) return
      this.handledUid = who.uid
      untracked(() => void this.afterSignIn())
    })
  }

  signInWithGoogle(): void {
    void this.auth.signInWithGoogle()
  }

  submitCredentials(event: Event, email: string, password: string): void {
    event.preventDefault()
    void (this.mode() === 'signup' ? this.auth.signUpWithEmail(email, password) : this.auth.signInWithEmail(email, password))
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'signin' ? 'signup' : 'signin'))
  }

  signOut(): void {
    this.games.set([])
    this.error.set(null)
    void this.auth.signOut()
  }

  async createTable(): Promise<void> {
    await this.work(async () => {
      const game = await this.api.createGame('two_player')
      await this.router.navigate(['/online/game', game.gameId])
    })
  }

  joinWithCode(event: Event, raw: string): void {
    event.preventDefault()
    void this.work(() => this.join(raw))
  }

  open(game: GameInfoDto): void {
    void this.router.navigate(['/online/game', game.gameId])
  }

  statusText(game: GameInfoDto): string {
    if (game.status === 'waiting') return `Waiting for an opponent, code ${game.inviteCode ?? ''}`.trim()
    return game.status === 'active' ? 'In progress' : 'Finished'
  }

  private async afterSignIn(): Promise<void> {
    this.error.set(null)
    try {
      await this.api.me()
      const code = this.linkCode()
      if (code) {
        await this.work(() => this.join(code))
      }
      await this.refreshGames()
    } catch (err) {
      this.error.set(this.messageFor(err))
    }
  }

  private async join(raw: string): Promise<void> {
    const game = await this.api.joinGame(raw)
    await this.router.navigate(['/online/game', game.gameId])
  }

  private async refreshGames(): Promise<void> {
    this.games.set(await this.api.listGames())
  }

  private async work(action: () => Promise<void>): Promise<void> {
    this.working.set(true)
    this.error.set(null)
    try {
      await action()
    } catch (err) {
      this.error.set(this.messageFor(err))
    } finally {
      this.working.set(false)
    }
  }

  private messageFor(err: unknown): string {
    if (err instanceof ApiError) return err.message
    return "Couldn't reach the server. Check your connection and try again."
  }
}
