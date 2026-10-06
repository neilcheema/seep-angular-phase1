import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import type { GameInfoDto, GameKind } from '../../core/api-types'
import { ApiError } from '../../core/game-api'
import { friendlyReauthError } from '../../core/identity'
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

  // --- confirming the email address (a NEW account has to, before it can play) ---
  /** True while the "Check your email" step is showing: the SERVER said this new account has not confirmed its address yet. */
  readonly needsVerification = signal(false)
  readonly verifyBusy = signal(false)
  readonly verifyNote = signal<string | null>(null)
  readonly verifyError = signal<string | null>(null)
  /** How the last attempt to send the confirmation email went (it is sent automatically at sign-up). */
  readonly verificationEmail = this.auth.verificationEmail
  /** Seconds before "send again" is allowed, so the button cannot be hammered. */
  readonly resendWait = signal(0)
  private resendTimer: ReturnType<typeof setInterval> | null = null

  // --- deleting the account ---
  /** True while the "Delete your account" panel is open. */
  readonly deleting = signal(false)
  readonly deleteBusy = signal(false)
  readonly deleteError = signal<string | null>(null)
  /** Shown on the signed-out screen after a deletion, so the person knows it worked. */
  readonly accountDeleted = signal(false)
  /** A password account must type its password again to confirm; a Google account confirms in the Google window. */
  readonly needsPassword = computed(() => this.identity()?.method === 'password')

  private handledUid: string | null = null
  /** The invited seat is taken, and the tables listed, once only per sign-in: after the name step if there is one. */
  private carriedOn = false

  constructor() {
    const code = this.route.snapshot.paramMap.get('code')
    if (code) this.linkCode.set(code.trim().toUpperCase())
    void this.auth.start()
    inject(DestroyRef).onDestroy(() => this.stopCountdown())

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
    this.accountDeleted.set(false)
    this.deleting.set(false)
    this.games.set([])
    this.error.set(null)
    this.profileName.set(null)
    this.needName.set(false)
    this.nameError.set(null)
    this.resetVerification()
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

  /** Leaves a table that is still waiting for players (the way out of the cap on waiting tables). */
  async leave(game: GameInfoDto): Promise<void> {
    await this.work(async () => {
      await this.api.leaveGame(game.gameId)
      await this.refreshGames()
    })
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

  openDelete(): void {
    this.deleteError.set(null)
    this.deleting.set(true)
  }

  cancelDelete(): void {
    if (!this.deleteBusy()) this.deleting.set(false)
  }

  /**
   * Deletes the account, in an order that is safe to interrupt at any point:
   *   1. confirm it is really the person (nothing has been changed yet; a wrong password stops here),
   *   2. erase our records (forfeits matches in progress, frees or closes waiting tables, removes name and email;
   *      repeating it is harmless), and only then
   *   3. delete the sign-in record itself.
   * If step 3 fails the person simply tries again: steps 1 and 2 are safe to repeat.
   */
  async confirmDelete(event: Event, typed: string, password: string): Promise<void> {
    event.preventDefault()
    if (typed.trim().toUpperCase() !== 'DELETE') {
      this.deleteError.set('Type DELETE in the box to confirm.')
      return
    }
    this.deleteBusy.set(true)
    this.deleteError.set(null)
    try {
      try {
        await this.auth.reauthenticate(this.needsPassword() ? password : undefined)
      } catch (err) {
        this.deleteError.set(friendlyReauthError(err))
        return
      }
      try {
        await this.api.deleteAccount()
      } catch (err) {
        this.deleteError.set(this.messageFor(err))
        return
      }
      try {
        await this.auth.deleteSignInRecord()
      } catch {
        this.deleteError.set('Your game records were removed, but we could not delete your sign-in record. Please try again.')
        return
      }
      this.accountDeleted.set(true)
      this.deleting.set(false)
      this.games.set([])
      this.profileName.set(null)
      this.needName.set(false)
    } finally {
      this.deleteBusy.set(false)
    }
  }

  /** Sends the confirmation link again (the first one went automatically when the account was made). */
  async resendVerification(): Promise<void> {
    if (this.verifyBusy() || this.resendWait() > 0) return
    this.verifyBusy.set(true)
    this.verifyError.set(null)
    this.verifyNote.set(null)
    const problem = await this.auth.sendVerificationEmail()
    this.verifyBusy.set(false)
    if (problem) {
      this.verifyError.set(problem)
      return
    }
    this.verifyNote.set(`We sent the link to ${this.identity()?.email ?? 'your email address'}. It can take a minute, and it may land in your spam or junk folder.`)
    this.startCountdown()
  }

  /**
   * "I have confirmed it": re-reads the account and gets a fresh token (the old one still says the address is unconfirmed), then asks
   * the server again. The server is the one that decides, so this also does the right thing for anyone it lets through anyway.
   */
  async checkVerified(): Promise<void> {
    if (this.verifyBusy()) return
    this.verifyBusy.set(true)
    this.verifyError.set(null)
    this.verifyNote.set(null)
    try {
      await this.auth.refreshVerification()
    } catch {
      this.verifyBusy.set(false)
      this.verifyError.set("Couldn't check just now. Check your connection and try again.")
      return
    }
    await this.afterSignIn()
    this.verifyBusy.set(false)
    if (this.needsVerification()) {
      this.verifyError.set('We can’t see the confirmation yet. Open the link in the email we sent you, then tap this button again.')
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
    this.needsVerification.set(false)
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
      if (err instanceof ApiError && err.status === 403 && err.details['code'] === 'email_not_verified') {
        this.needsVerification.set(true) // not an error: the next step is to confirm the address
        return
      }
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

  private resetVerification(): void {
    this.needsVerification.set(false)
    this.verifyBusy.set(false)
    this.verifyNote.set(null)
    this.verifyError.set(null)
    this.stopCountdown()
  }

  private startCountdown(): void {
    this.stopCountdown()
    this.resendWait.set(60)
    this.resendTimer = setInterval(() => {
      this.resendWait.update((n) => Math.max(0, n - 1))
      if (this.resendWait() === 0) this.stopCountdown()
    }, 1000)
  }

  private stopCountdown(): void {
    if (this.resendTimer !== null) clearInterval(this.resendTimer)
    this.resendTimer = null
    this.resendWait.set(0)
  }

  private messageFor(err: unknown): string {
    if (err instanceof ApiError) return err.message
    return "Couldn't reach the server. Check your connection and try again."
  }
}
