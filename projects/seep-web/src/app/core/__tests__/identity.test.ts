import { describe, expect, it } from 'vitest'
import { friendlyAuthError } from '../identity'

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
