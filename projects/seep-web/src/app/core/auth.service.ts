import { signal } from '@angular/core'
import { type Identity, type IdentityProvider, friendlyAuthError } from './identity'

/**
 * The sign-in state the screens bind to. A plain class (built by the factory
 * in online.ts) so it can be exercised without Angular's test machinery.
 */
export class AuthService {
  readonly identity = signal<Identity | null>(null)
  /** True once it is known whether someone is already signed in. Until then, screens should wait. */
  readonly ready = signal(false)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)

  private readonly provider: IdentityProvider
  private started: Promise<void> | null = null

  constructor(provider: IdentityProvider) {
    this.provider = provider
  }

  /** Loads the sign-in service. Safe to call from every screen: it only ever does the work once. */
  start(): Promise<void> {
    this.started ??= this.load()
    return this.started
  }

  signInWithGoogle(): Promise<void> {
    return this.run(() => this.provider.signInWithGoogle())
  }

  signInWithEmail(email: string, password: string): Promise<void> {
    return this.run(() => this.provider.signInWithEmail(email.trim(), password))
  }

  signUpWithEmail(email: string, password: string): Promise<void> {
    return this.run(() => this.provider.signUpWithEmail(email.trim(), password))
  }

  signOut(): Promise<void> {
    return this.run(() => this.provider.signOut())
  }

  /** For the API client: a current ID token, or null when signed out. */
  getToken(forceRefresh?: boolean): Promise<string | null> {
    return this.provider.getIdToken(forceRefresh)
  }

  private async load(): Promise<void> {
    try {
      this.identity.set(await this.provider.init())
      this.provider.onChange((identity) => this.identity.set(identity))
    } catch {
      this.error.set("Couldn't load sign-in. Check your connection and reload the page.")
    } finally {
      this.ready.set(true)
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null)
    this.busy.set(true)
    try {
      await action()
    } catch (err) {
      this.error.set(friendlyAuthError(err))
    } finally {
      this.busy.set(false)
    }
  }
}
