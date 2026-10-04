import { Component, effect, inject, signal, untracked } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import type { GameInfoDto, GameKind } from '../../core/api-types'
import { ApiError } from '../../core/game-api'
import { suggestName, tableStatusText } from '../../core/display-names'
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

  /** The name the person plays under, once they have one. */
  readonly profileName = signal<string | null>(null)
  /** True while the "What should we call you?" step is showing (first sign-in, or when changing the name). */
  readonly needName = signal(false)
  readonly nameSuggestion = signal('')
  readonly nameError = signal<string | null>(null)
  readonly nameSaving = signal(false)

  private handledUid: string | null = null
  /** The invited seat is taken, and the tables listed, once only per sign-in: after the name step if there is one. */
  private carriedOn = false

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
    this.profileName.set(null)
    this.needName.set(false)
    this.nameError.set(null)
    void this.auth.signOut()
  }

  async createTable(kind: GameKind): Promise<void> {
    await this.work(async () => {
      const game = await this.api.createGame(kind)
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
    return tableStatusText(game)
  }

  /** Saves the chosen name, then carries on to whatever the person came here to do. */
  async saveName(event: Event, raw: string): Promise<void> {
    event.preventDefault()
    this.nameSaving.set(true)
    this.nameError.set(null)
    try {
      const profile = await this.api.setDisplayName(raw)
      this.profileName.set(profile.displayName)
      this.needName.set(false)
      await this.carryOn()
    } catch (err) {
      this.nameError.set(this.messageFor(err))
    } finally {
      this.nameSaving.set(false)
    }
  }

  changeName(): void {
    this.nameSuggestion.set(this.profileName() ?? '')
    this.nameError.set(null)
    this.needName.set(true)
  }

  cancelNameChange(): void {
    if (this.profileName()) this.needName.set(false)
  }

  private async afterSignIn(): Promise<void> {
    this.error.set(null)
    this.carriedOn = false
    try {
      const profile = await this.api.me()
      this.profileName.set(profile.displayName)
      if (!profile.displayName) {
        // Nobody can sit at a table without a name the others will recognise, so this comes first. saveName() carries on from here.
        this.nameSuggestion.set(suggestName(this.identity()?.displayName ?? null))
        this.needName.set(true)
        return
      }
      await this.carryOn()
    } catch (err) {
      this.error.set(this.messageFor(err))
    }
  }

  /** Takes the invited seat (if they came by a link) and lists the person's tables. */
  private async carryOn(): Promise<void> {
    if (!this.carriedOn) {
      this.carriedOn = true
      const code = this.linkCode()
      if (code) await this.work(() => this.join(code))
    }
    await this.refreshGames()
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
