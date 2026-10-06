import type { Auth, User } from 'firebase/auth'
import type { Identity, IdentityProvider } from './identity'

/**
 * Seep's Firebase web configuration. These are public identifiers (they ship
 * in every web page that uses Firebase), not secrets; what protects the
 * project is Firebase's authorized-domains list and the server verifying each token.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAgFPHmaezeO0T2p30dUGoSZ-sOwHJ9PzM',
  authDomain: 'seep-quest.firebaseapp.com',
  projectId: 'seep-quest',
  storageBucket: 'seep-quest.firebasestorage.app',
  messagingSenderId: '315679875245',
  appId: '1:315679875245:web:f9feec8bfa22c9cdc52624',
}

export interface FirebaseSdk {
  readonly app: typeof import('firebase/app')
  readonly auth: typeof import('firebase/auth')
}
export type SdkLoader = () => Promise<FirebaseSdk>

/**
 * Dynamic imports, so the Firebase SDK is a separate download fetched only
 * when someone opens an online screen: a player who only plays the bots
 * never pays for it.
 */
const loadFirebase: SdkLoader = async () => {
  const [app, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  return { app, auth }
}

function toIdentity(user: User | null): Identity | null {
  if (!user) return null
  const provider = user.providerData?.[0]?.providerId
  const method = provider === 'password' ? 'password' : provider === 'google.com' ? 'google' : 'other'
  return { uid: user.uid, email: user.email, displayName: user.displayName, method, emailVerified: user.emailVerified === true }
}

export class FirebaseIdentityProvider implements IdentityProvider {
  private readonly load: SdkLoader
  private readonly config: typeof FIREBASE_CONFIG
  private sdk: FirebaseSdk | null = null
  private auth: Auth | null = null
  private starting: Promise<Identity | null> | null = null
  private readonly listeners = new Set<(identity: Identity | null) => void>()

  constructor(load: SdkLoader = loadFirebase, config: typeof FIREBASE_CONFIG = FIREBASE_CONFIG) {
    this.load = load
    this.config = config
  }

  init(): Promise<Identity | null> {
    this.starting ??= this.start()
    return this.starting
  }

  onChange(listener: (identity: Identity | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async signInWithGoogle(): Promise<void> {
    const { sdk, auth } = await this.ready()
    // A popup rather than a redirect: browsers now partition the storage a redirect sign-in relies on
    // when the site's domain differs from Firebase's.
    await sdk.auth.signInWithPopup(auth, new sdk.auth.GoogleAuthProvider())
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { sdk, auth } = await this.ready()
    await sdk.auth.signInWithEmailAndPassword(auth, email, password)
  }

  async signUpWithEmail(email: string, password: string): Promise<void> {
    const { sdk, auth } = await this.ready()
    await sdk.auth.createUserWithEmailAndPassword(auth, email, password)
  }

  async signOut(): Promise<void> {
    const { sdk, auth } = await this.ready()
    await sdk.auth.signOut(auth)
  }

  async reauthenticate(password?: string): Promise<void> {
    const { sdk, auth } = await this.ready()
    const user = auth.currentUser
    if (!user) throw Object.assign(new Error('Not signed in.'), { code: 'auth/user-not-found' })
    if (user.providerData?.[0]?.providerId === 'password') {
      if (!user.email || !password) throw Object.assign(new Error('A password is needed.'), { code: 'auth/missing-password' })
      await sdk.auth.reauthenticateWithCredential(user, sdk.auth.EmailAuthProvider.credential(user.email, password))
    } else {
      await sdk.auth.reauthenticateWithPopup(user, new sdk.auth.GoogleAuthProvider())
    }
  }

  async deleteAccount(): Promise<void> {
    const { sdk, auth } = await this.ready()
    const user = auth.currentUser
    if (!user) return // already gone: nothing left to delete
    await sdk.auth.deleteUser(user)
  }

  async sendVerificationEmail(): Promise<void> {
    const { sdk, auth } = await this.ready()
    const user = auth.currentUser
    if (!user) throw Object.assign(new Error('Not signed in.'), { code: 'auth/user-not-found' })
    await sdk.auth.sendEmailVerification(user)
  }

  async refreshIdentity(): Promise<void> {
    const { auth } = await this.ready()
    const user = auth.currentUser
    if (!user) return
    await user.reload() // picks up that the address has been confirmed
    await user.getIdToken(true) // and the token the server sees now says so too
    const identity = toIdentity(auth.currentUser)
    for (const listener of this.listeners) listener(identity)
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    if (this.auth === null) return null
    const user = this.auth.currentUser
    return user ? user.getIdToken(forceRefresh) : null
  }

  private async start(): Promise<Identity | null> {
    const sdk = await this.load()
    const app = sdk.app.getApps().length > 0 ? sdk.app.getApp() : sdk.app.initializeApp(this.config)
    const auth = sdk.auth.getAuth(app)
    this.sdk = sdk
    this.auth = auth
    await auth.authStateReady() // resolves once a saved sign-in has been restored (or ruled out)
    sdk.auth.onAuthStateChanged(auth, (user) => {
      const identity = toIdentity(user)
      for (const listener of this.listeners) listener(identity)
    })
    return toIdentity(auth.currentUser)
  }

  private async ready(): Promise<{ sdk: FirebaseSdk; auth: Auth }> {
    await this.init()
    return { sdk: this.sdk!, auth: this.auth! }
  }
}
