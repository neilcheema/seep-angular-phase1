/** Who is signed in, as far as the app needs to know. */
export interface Identity {
  readonly uid: string
  readonly email: string | null
  readonly displayName: string | null
}

/**
 * Everything the app needs from a sign-in service, and nothing Firebase-
 * specific. The real implementation loads Firebase lazily (see
 * firebase-identity.ts); tests and the browser harness swap in a fake.
 */
export interface IdentityProvider {
  /** Loads the sign-in service and resolves once it is known whether someone is already signed in. */
  init(): Promise<Identity | null>
  /** Called whenever the signed-in person changes (including to nobody). Returns an unsubscribe function. */
  onChange(listener: (identity: Identity | null) => void): () => void
  signInWithGoogle(): Promise<void>
  signInWithEmail(email: string, password: string): Promise<void>
  signUpWithEmail(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** A current ID token for the API, or null when signed out. `forceRefresh` asks for a brand-new one. */
  getIdToken(forceRefresh?: boolean): Promise<string | null>
}

/** Cancelling the Google window is a choice, not an error. */
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': "That email and password don't match an account.",
  'auth/invalid-login-credentials': "That email and password don't match an account.",
  'auth/wrong-password': "That email and password don't match an account.",
  'auth/user-not-found': "That email and password don't match an account.",
  'auth/email-already-in-use': 'There is already an account with that email. Try signing in instead.',
  'auth/weak-password': 'Choose a password with at least 6 characters.',
  'auth/invalid-email': "That doesn't look like a valid email address.",
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': "Couldn't reach the sign-in service. Check your connection and try again.",
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/account-exists-with-different-credential': 'That email is already registered with a different sign-in method.',
  'auth/unauthorized-domain': "Sign-in isn't enabled for this web address yet.",
  'auth/operation-not-allowed': "That sign-in method isn't enabled yet.",
}

/**
 * Turns a sign-in failure into a sentence for the player, or null if there is
 * nothing to say (they simply closed the window). Raw SDK messages are never shown.
 */
export function friendlyAuthError(err: unknown): string | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  if (typeof code === 'string') {
    if (SILENT.has(code)) return null
    const known = MESSAGES[code]
    if (known) return known
  }
  return 'Sign-in failed. Please try again.'
}
