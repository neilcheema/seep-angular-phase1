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
  /** How the last attempt to send the confirmation email went: null until one has been tried. */
  readonly verificationEmail = signal<'sent' | 'failed' | null>(null)

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
    this.verificationEmail.set(null)
    return this.run(() => this.provider.signInWithGoogle())
  }

  signInWithEmail(email: string, password: string): Promise<void> {
    this.verificationEmail.set(null)
    return this.run(() => this.provider.signInWithEmail(email.trim(), password))
  }

  /** Creates the account and, as soon as it exists, emails the person the link that confirms their address. */
  signUpWithEmail(email: string, password: string): Promise<void> {
    this.verificationEmail.set(null)
    return this.run(async () => {
      await this.provider.signUpWithEmail(email.trim(), password)
      await this.sendVerificationEmail() // a failure here is not a failed sign-up: the person can ask for the email again
    })
  }

  signOut(): Promise<void> {
    this.verificationEmail.set(null)
    return this.run(() => this.provider.signOut())
  }

  /** Sends the confirmation link. Resolves to null when it went, or a sentence for the person when it did not. */
  async sendVerificationEmail(): Promise<string | null> {
    try {
      await this.provider.sendVerificationEmail()
      this.verificationEmail.set('sent')
      return null
    } catch (err) {
      this.verificationEmail.set('failed')
      return friendlyAuthError(err) ?? "Couldn't send the email. Please try again."
    }
  }

  /** Re-reads the account after the person says they have confirmed. Errors are let through: the caller says what to do. */
  refreshVerification(): Promise<void> {
    return this.provider.refreshIdentity()
  }

  /**
   * Confirms it is really the person (see IdentityProvider.reauthenticate). Unlike the sign-in methods this lets the
   * error through, because the caller is in the middle of a longer job and decides what to say (friendlyReauthError).
   */
  reauthenticate(password?: string): Promise<void> {
    return this.provider.reauthenticate(password)
  }

  /** Deletes the sign-in record itself. Errors are let through for the same reason. */
  deleteSignInRecord(): Promise<void> {
    return this.provider.deleteAccount()
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
