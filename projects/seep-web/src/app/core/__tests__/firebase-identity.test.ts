import { describe, expect, it, vi } from 'vitest'
import { FirebaseIdentityProvider, type FirebaseSdk } from '../firebase-identity'

interface FakeUser {
  uid: string
  email: string | null
  displayName: string | null
  providerData?: { providerId: string }[]
  getIdToken: ReturnType<typeof vi.fn>
}

const alice = (providerId = 'password'): FakeUser => ({ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice', providerData: [{ providerId }], getIdToken: vi.fn(() => Promise.resolve('token-1')) })

function fakeSdk(initialUser: FakeUser | null = null, existingApp = false) {
  const stateListeners: ((user: FakeUser | null) => void)[] = []
  const auth = { currentUser: initialUser, authStateReady: vi.fn(() => Promise.resolve()) }
  const calls: string[] = []
  class GoogleAuthProvider {
    readonly kind = 'google'
  }
  const sdk = {
    app: {
      getApps: vi.fn(() => (existingApp ? [{}] : [])),
      getApp: vi.fn(() => ({ name: 'existing' })),
      initializeApp: vi.fn(() => ({ name: 'new' })),
    },
    auth: {
      getAuth: vi.fn(() => auth),
      onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: FakeUser | null) => void) => {
        stateListeners.push(cb)
        return () => undefined
      }),
      GoogleAuthProvider,
      signInWithPopup: vi.fn((_a: unknown, provider: unknown) => (calls.push(`popup:${(provider as { kind: string }).kind}`), Promise.resolve())),
      signInWithEmailAndPassword: vi.fn((_a: unknown, e: string, p: string) => (calls.push(`signin:${e}:${p}`), Promise.resolve())),
      createUserWithEmailAndPassword: vi.fn((_a: unknown, e: string, p: string) => (calls.push(`signup:${e}:${p}`), Promise.resolve())),
      signOut: vi.fn(() => (calls.push('signout'), Promise.resolve())),
      EmailAuthProvider: { credential: vi.fn((email: string, password: string) => ({ kind: 'email-credential', email, password })) },
      reauthenticateWithCredential: vi.fn((_u: unknown, cred: { email: string; password: string }) => (calls.push(`reauth-credential:${cred.email}:${cred.password}`), Promise.resolve())),
      reauthenticateWithPopup: vi.fn((_u: unknown, provider: unknown) => (calls.push(`reauth-popup:${(provider as { kind: string }).kind}`), Promise.resolve())),
      deleteUser: vi.fn(() => (calls.push('delete-user'), Promise.resolve())),
    },
  }
  return { sdk: sdk as unknown as FirebaseSdk, raw: sdk, auth, calls, emit: (u: FakeUser | null) => stateListeners.forEach((l) => l(u)) }
}

const provider = (f: ReturnType<typeof fakeSdk>) => new FirebaseIdentityProvider(() => Promise.resolve(f.sdk), { apiKey: 'k' } as never)

describe('FirebaseIdentityProvider', () => {
  it('loads and initializes the SDK once, however many times init is called, and waits for a saved sign-in to be restored', async () => {
    const f = fakeSdk()
    const loader = vi.fn(() => Promise.resolve(f.sdk))
    const p = new FirebaseIdentityProvider(loader, { apiKey: 'k' } as never)
    await Promise.all([p.init(), p.init(), p.init()])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(f.raw.app.initializeApp).toHaveBeenCalledTimes(1)
    expect(f.auth.authStateReady).toHaveBeenCalledTimes(1)
  })

  it('reuses an already-initialized Firebase app instead of creating a second', async () => {
    const f = fakeSdk(null, true)
    await provider(f).init()
    expect(f.raw.app.initializeApp).not.toHaveBeenCalled()
    expect(f.raw.app.getApp).toHaveBeenCalled()
  })

  it('reports nobody when signed out, and the person (only the fields the app needs, none of the SDK’s internals) when a saved sign-in is restored', async () => {
    expect(await provider(fakeSdk()).init()).toBeNull()
    expect(await provider(fakeSdk(alice())).init()).toEqual({ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice', method: 'password' })
  })

  it('tells every listener when the signed-in person changes, and stops telling one that unsubscribed', async () => {
    const f = fakeSdk()
    const p = provider(f)
    const a = vi.fn()
    const b = vi.fn()
    p.onChange(a)
    const stopB = p.onChange(b)
    await p.init()
    f.emit(alice())
    stopB()
    f.emit(null)
    expect(a.mock.calls).toEqual([[{ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice', method: 'password' }], [null]])
    expect(b.mock.calls).toEqual([[{ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice', method: 'password' }]])
  })

  it('performs each kind of sign-in through the SDK, loading it first if nobody has yet', async () => {
    const f = fakeSdk()
    const p = provider(f)
    await p.signInWithGoogle()
    await p.signInWithEmail('x@example.test', 'pw1')
    await p.signUpWithEmail('y@example.test', 'pw2')
    await p.signOut()
    expect(f.calls).toEqual(['popup:google', 'signin:x@example.test:pw1', 'signup:y@example.test:pw2', 'signout'])
  })

  it("passes the SDK's own error through untouched, so the caller can explain it", async () => {
    const f = fakeSdk()
    const err = Object.assign(new Error('nope'), { code: 'auth/wrong-password' })
    f.raw.auth.signInWithEmailAndPassword.mockRejectedValueOnce(err)
    await expect(provider(f).signInWithEmail('x@example.test', 'bad')).rejects.toBe(err)
  })

  it('hands out an ID token for the current person, forwarding the refresh request', async () => {
    const user = alice()
    const p = provider(fakeSdk(user))
    await p.init()
    expect(await p.getIdToken()).toBe('token-1')
    await p.getIdToken(true)
    expect(user.getIdToken.mock.calls).toEqual([[false], [true]])
  })

  it('has no token before it has started, or when nobody is signed in', async () => {
    expect(await provider(fakeSdk(alice())).getIdToken()).toBeNull() // not initialized yet
    const p = provider(fakeSdk())
    await p.init()
    expect(await p.getIdToken()).toBeNull()
  })

  describe('how the person signs in', () => {
    it('reports an email account as "password", a Google account as "google", and anything else as "other"', async () => {
      expect((await provider(fakeSdk(alice('password'))).init())?.method).toBe('password')
      expect((await provider(fakeSdk(alice('google.com'))).init())?.method).toBe('google')
      expect((await provider(fakeSdk(alice('apple.com'))).init())?.method).toBe('other')
      const noProviderInfo = { ...alice(), providerData: undefined }
      expect((await provider(fakeSdk(noProviderInfo)).init())?.method).toBe('other')
    })
  })

  describe('confirming it is really the person', () => {
    it('re-checks a password account against the password they typed, using their own email', async () => {
      const f = fakeSdk(alice('password'))
      await provider(f).reauthenticate('hunter22')
      expect(f.calls).toEqual(['reauth-credential:a@example.test:hunter22'])
    })

    it('asks a Google account to confirm with the Google window', async () => {
      const f = fakeSdk(alice('google.com'))
      await provider(f).reauthenticate()
      expect(f.calls).toEqual(['reauth-popup:google'])
    })

    it('refuses a password account that supplied no password, before contacting anyone', async () => {
      const f = fakeSdk(alice('password'))
      await expect(provider(f).reauthenticate('')).rejects.toMatchObject({ code: 'auth/missing-password' })
      await expect(provider(f).reauthenticate()).rejects.toMatchObject({ code: 'auth/missing-password' })
      expect(f.calls).toEqual([])
    })

    it('lets the sign-in service’s own refusal through (a wrong password), so the screen can explain it', async () => {
      const f = fakeSdk(alice('password'))
      f.raw.auth.reauthenticateWithCredential.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/wrong-password' }))
      await expect(provider(f).reauthenticate('nope')).rejects.toMatchObject({ code: 'auth/wrong-password' })
    })

    it('fails clearly when nobody is signed in', async () => {
      await expect(provider(fakeSdk(null)).reauthenticate('x')).rejects.toMatchObject({ code: 'auth/user-not-found' })
    })
  })

  describe('deleting the sign-in record', () => {
    it('deletes the signed-in user', async () => {
      const f = fakeSdk(alice())
      await provider(f).deleteAccount()
      expect(f.calls).toEqual(['delete-user'])
    })

    it('does nothing, and does not fail, if the record is already gone (so a retry can finish the job)', async () => {
      const f = fakeSdk(null)
      await provider(f).deleteAccount()
      expect(f.calls).toEqual([])
    })
  })
})

