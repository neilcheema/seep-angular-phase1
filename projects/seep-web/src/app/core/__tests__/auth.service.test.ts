import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../auth.service'
import type { Identity, IdentityProvider } from '../identity'

function fakeProvider(initial: Identity | null = null) {
  let listener: ((i: Identity | null) => void) | null = null
  const provider = {
    init: vi.fn(() => Promise.resolve(initial)),
    onChange: vi.fn((l: (i: Identity | null) => void) => ((listener = l), () => undefined)),
    signInWithGoogle: vi.fn(() => Promise.resolve()),
    signInWithEmail: vi.fn<(email: string, password: string) => Promise<void>>(() => Promise.resolve()),
    signUpWithEmail: vi.fn<(email: string, password: string) => Promise<void>>(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    getIdToken: vi.fn<(forceRefresh?: boolean) => Promise<string | null>>(() => Promise.resolve('tok')),
  }
  return { provider: provider as IdentityProvider, fns: provider, emit: (i: Identity | null) => listener?.(i) }
}
const bob: Identity = { uid: 'u-bob', email: 'b@example.test', displayName: null }

describe('AuthService', () => {
  it('is not ready until the provider has said who (if anyone) is signed in', async () => {
    const { provider } = fakeProvider(bob)
    const auth = new AuthService(provider)
    expect(auth.ready()).toBe(false)
    await auth.start()
    expect(auth.ready()).toBe(true)
    expect(auth.identity()).toEqual(bob)
  })

  it('starts the provider only once, however many screens ask', async () => {
    const { provider, fns } = fakeProvider()
    const auth = new AuthService(provider)
    await Promise.all([auth.start(), auth.start(), auth.start()])
    expect(fns.init).toHaveBeenCalledTimes(1)
  })

  it('follows later sign-ins and sign-outs', async () => {
    const f = fakeProvider()
    const auth = new AuthService(f.provider)
    await auth.start()
    f.emit(bob)
    expect(auth.identity()).toEqual(bob)
    f.emit(null)
    expect(auth.identity()).toBeNull()
  })

  it('still becomes ready, with a clear message, if sign-in cannot be loaded at all', async () => {
    const { provider, fns } = fakeProvider()
    fns.init.mockRejectedValueOnce(new Error('chunk failed'))
    const auth = new AuthService(provider)
    await auth.start()
    expect(auth.ready()).toBe(true)
    expect(auth.identity()).toBeNull()
    expect(auth.error()).toMatch(/Couldn't load sign-in/)
  })

  it('trims the email, is busy while working, and clears the busy flag afterwards', async () => {
    const { provider, fns } = fakeProvider()
    const auth = new AuthService(provider)
    let busyDuring = false
    fns.signInWithEmail.mockImplementationOnce(() => ((busyDuring = auth.busy()), Promise.resolve()))
    await auth.signInWithEmail('  b@example.test ', 'pw')
    expect(fns.signInWithEmail).toHaveBeenCalledWith('b@example.test', 'pw')
    expect(busyDuring).toBe(true)
    expect(auth.busy()).toBe(false)
  })

  it('turns a failure into a sentence, and clears it on the next attempt', async () => {
    const { provider, fns } = fakeProvider()
    const auth = new AuthService(provider)
    fns.signInWithEmail.mockRejectedValueOnce({ code: 'auth/wrong-password' })
    await auth.signInWithEmail('b@example.test', 'bad')
    expect(auth.error()).toMatch(/don't match an account/)
    await auth.signInWithEmail('b@example.test', 'good')
    expect(auth.error()).toBeNull()
  })

  it('shows nothing when the person just closed the Google window', async () => {
    const { provider, fns } = fakeProvider()
    const auth = new AuthService(provider)
    fns.signInWithGoogle.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' })
    await auth.signInWithGoogle()
    expect(auth.error()).toBeNull()
    expect(auth.busy()).toBe(false)
  })

  it("hands the provider's token (and the refresh request) to the API client", async () => {
    const { provider, fns } = fakeProvider()
    const auth = new AuthService(provider)
    expect(await auth.getToken(true)).toBe('tok')
    expect(fns.getIdToken).toHaveBeenCalledWith(true)
  })
})
