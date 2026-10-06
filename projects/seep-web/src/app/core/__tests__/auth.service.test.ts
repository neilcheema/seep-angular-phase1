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
    reauthenticate: vi.fn<(password?: string) => Promise<void>>(() => Promise.resolve()),
    deleteAccount: vi.fn(() => Promise.resolve()),
    sendVerificationEmail: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    refreshIdentity: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  }
  return { provider: provider as IdentityProvider, fns: provider, emit: (i: Identity | null) => listener?.(i) }
}
const bob: Identity = { uid: 'u-bob', email: 'b@example.test', displayName: null, method: 'password', emailVerified: true }

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

  describe('deleting an account', () => {
    it('passes the password through to confirm it is really the person, and the sign-in record deletion through after', async () => {
      const { provider, fns } = fakeProvider(bob)
      const auth = new AuthService(provider)
      await auth.start()
      await auth.reauthenticate('hunter22')
      await auth.deleteSignInRecord()
      expect(fns.reauthenticate).toHaveBeenCalledWith('hunter22')
      expect(fns.deleteAccount).toHaveBeenCalledTimes(1)
    })

    it('lets failures through to the caller instead of swallowing them into the shared error message', async () => {
      const { provider, fns } = fakeProvider(bob)
      fns.reauthenticate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/wrong-password' }))
      fns.deleteAccount.mockRejectedValueOnce(new Error('network'))
      const auth = new AuthService(provider)
      await auth.start()
      await expect(auth.reauthenticate('nope')).rejects.toMatchObject({ code: 'auth/wrong-password' })
      await expect(auth.deleteSignInRecord()).rejects.toThrow('network')
      expect(auth.error()).toBeNull()
    })
  })

  describe('confirming the email address', () => {
    it('sends the confirmation link as soon as a new account exists, and remembers that it went', async () => {
      const { provider, fns } = fakeProvider()
      const auth = new AuthService(provider)
      await auth.signUpWithEmail('  new@example.test ', 'pw')
      expect(fns.signUpWithEmail).toHaveBeenCalledWith('new@example.test', 'pw')
      expect(fns.sendVerificationEmail).toHaveBeenCalledTimes(1)
      expect(auth.verificationEmail()).toBe('sent')
      expect(auth.error()).toBeNull()
    })

    it('does NOT treat a failed send as a failed sign-up: the account exists, and the person can ask again', async () => {
      const { provider, fns } = fakeProvider()
      fns.sendVerificationEmail.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }))
      const auth = new AuthService(provider)
      await auth.signUpWithEmail('new@example.test', 'pw')
      expect(auth.verificationEmail()).toBe('failed')
      expect(auth.error()).toBeNull()
    })

    it('sends nothing when the sign-up itself fails', async () => {
      const { provider, fns } = fakeProvider()
      fns.signUpWithEmail.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/email-already-in-use' }))
      const auth = new AuthService(provider)
      await auth.signUpWithEmail('taken@example.test', 'pw')
      expect(fns.sendVerificationEmail).not.toHaveBeenCalled()
      expect(auth.error()).toMatch(/already an account/)
      expect(auth.verificationEmail()).toBeNull()
    })

    it('sends it again on request: null when it went, a sentence for the person when it did not', async () => {
      const { provider, fns } = fakeProvider(bob)
      const auth = new AuthService(provider)
      await expect(auth.sendVerificationEmail()).resolves.toBeNull()
      expect(auth.verificationEmail()).toBe('sent')
      fns.sendVerificationEmail.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/too-many-requests' }))
      await expect(auth.sendVerificationEmail()).resolves.toMatch(/Too many attempts/)
      expect(auth.verificationEmail()).toBe('failed')
    })

    it('never shows the SDK’s raw message when a send fails for a reason it does not know', async () => {
      const { provider, fns } = fakeProvider(bob)
      fns.sendVerificationEmail.mockRejectedValueOnce(new Error('INTERNAL ASSERTION FAILED: secret detail'))
      const message = await new AuthService(provider).sendVerificationEmail()
      expect(message).not.toContain('secret detail')
      expect(message).toBeTruthy()
    })

    it('refreshes by asking the provider, and lets a failure through so the screen can say what to do', async () => {
      const { provider, fns } = fakeProvider(bob)
      const auth = new AuthService(provider)
      await auth.refreshVerification()
      expect(fns.refreshIdentity).toHaveBeenCalledTimes(1)
      fns.refreshIdentity.mockRejectedValueOnce(new Error('offline'))
      await expect(auth.refreshVerification()).rejects.toThrow('offline')
    })

    it('forgets how the last send went when the person signs in again or signs out', async () => {
      const { provider } = fakeProvider(bob)
      const auth = new AuthService(provider)
      await auth.sendVerificationEmail()
      expect(auth.verificationEmail()).toBe('sent')
      await auth.signInWithEmail('x@example.test', 'pw')
      expect(auth.verificationEmail()).toBeNull()
      await auth.sendVerificationEmail()
      await auth.signOut()
      expect(auth.verificationEmail()).toBeNull()
      await auth.sendVerificationEmail()
      await auth.signInWithGoogle()
      expect(auth.verificationEmail()).toBeNull()
    })
  })
})
