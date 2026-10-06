import { describe, expect, it } from 'vitest'
import { APP_VERSION, FEEDBACK_EMAIL } from '../../version'

/**
 * The server compares the app's version number by number, and treats anything it cannot read as 0, so a malformed
 * version ("v1.7", "1.7", "1.7.1-beta") would not fail loudly: it would quietly compare as something else.
 */
const numbers = (version: string) => version.split('.').map(Number)

describe('the app version', () => {
  it('is three plain numbers like 1.7.1, with nothing around them', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has not gone backwards from the last release that was recorded (1.7.0)', () => {
    const [major, minor, patch] = numbers(APP_VERSION)
    const [lastMajor, lastMinor, lastPatch] = numbers('1.7.0')
    const newer = major! > lastMajor! || (major === lastMajor && (minor! > lastMinor! || (minor === lastMinor && patch! >= lastPatch!)))
    expect(newer).toBe(true)
  })

  it('leaves the feedback address looking like an email address', () => {
    expect(FEEDBACK_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  })
})
