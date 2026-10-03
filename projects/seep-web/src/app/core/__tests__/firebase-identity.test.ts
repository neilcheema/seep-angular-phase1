import { describe, expect, it, vi } from 'vitest'
import { FirebaseIdentityProvider, type FirebaseSdk } from '../firebase-identity'

interface FakeUser {
  uid: string
  email: string | null
  displayName: string | null
  getIdToken: ReturnType<typeof vi.fn>
}

const alice = (): FakeUser => ({ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice', getIdToken: vi.fn(() => Promise.resolve('token-1')) })

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

  it('reports nobody when signed out, and the person (without extra fields) when a saved sign-in is restored', async () => {
    expect(await provider(fakeSdk()).init()).toBeNull()
    expect(await provider(fakeSdk(alice())).init()).toEqual({ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice' })
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
    expect(a.mock.calls).toEqual([[{ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice' }], [null]])
    expect(b.mock.calls).toEqual([[{ uid: 'u-alice', email: 'a@example.test', displayName: 'Alice' }]])
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
})
