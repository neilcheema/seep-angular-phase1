import { describe, expect, it } from 'vitest'
import { friendlyAuthError, friendlyReauthError } from '../identity'

describe('friendlyAuthError', () => {
  it.each([
    ['auth/invalid-credential', /don't match an account/],
    ['auth/wrong-password', /don't match an account/],
    ['auth/user-not-found', /don't match an account/],
    ['auth/email-already-in-use', /already an account/],
    ['auth/weak-password', /at least 6 characters/],
    ['auth/invalid-email', /valid email/],
    ['auth/too-many-requests', /Too many attempts/],
    ['auth/network-request-failed', /connection/],
    ['auth/popup-blocked', /Allow pop-ups/],
    ['auth/unauthorized-domain', /isn't enabled for this web address/],
    ['auth/operation-not-allowed', /method isn't enabled/],
    ['auth/account-exists-with-different-credential', /different sign-in method/],
  ])('explains %s in plain words', (code, expected) => {
    expect(friendlyAuthError({ code, message: 'Firebase: Error (' + code + ').' })).toMatch(expected)
  })

  it('says nothing when the person just closed the Google window', () => {
    expect(friendlyAuthError({ code: 'auth/popup-closed-by-user' })).toBeNull()
    expect(friendlyAuthError({ code: 'auth/cancelled-popup-request' })).toBeNull()
  })

  it('never leaks a raw SDK message: an unknown error gets a generic sentence', () => {
    const text = friendlyAuthError({ code: 'auth/some-new-code', message: 'Firebase: Error (auth/some-new-code). secret internals' })
    expect(text).toBe('Sign-in failed. Please try again.')
    expect(friendlyAuthError(new Error('boom'))).toBe('Sign-in failed. Please try again.')
    expect(friendlyAuthError('weird')).toBe('Sign-in failed. Please try again.')
    expect(friendlyAuthError(null)).toBe('Sign-in failed. Please try again.')
  })
})

describe('friendlyReauthError (confirming it is really you before deleting an account)', () => {
  it.each(['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'])('says the password is wrong for %s, not that an "email and password" do not match', (code) => {
    expect(friendlyReauthError({ code })).toBe("That password isn't right.")
  })
  it('asks for the password when none was given', () => {
    expect(friendlyReauthError({ code: 'auth/missing-password' })).toBe('Enter your password to confirm.')
  })
  it('says nothing was deleted when the person closes the Google window', () => {
    expect(friendlyReauthError({ code: 'auth/popup-closed-by-user' })).toBe('Cancelled. Nothing was deleted.')
  })
  it('explains a stale sign-in and a different account in plain words', () => {
    expect(friendlyReauthError({ code: 'auth/requires-recent-login' })).toMatch(/confirm it is really you/)
    expect(friendlyReauthError({ code: 'auth/user-mismatch' })).toMatch(/different account/)
  })
  it('never shows a raw SDK message', () => {
    expect(friendlyReauthError(new Error('Firebase: Error (auth/internal-error).'))).toBe('Sign-in failed. Please try again.')
  })
})

