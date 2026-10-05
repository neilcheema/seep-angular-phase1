import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANALYTICS } from '../analytics-config'
import { isValidProjectId } from '../analytics-consent'
import { LEGAL } from '../../pages/legal/legal-config'

/**
 * Guards for the legal pages and for the one line the owner edits. They cannot make the pages legally right (a person has to
 * review that), but they stop the specific mistakes we have already made or nearly made from coming back.
 */
const privacy = readFileSync(resolve(__dirname, '../../pages/legal/privacy.component.html'), 'utf8')

describe('who runs the site, and the facts the pages state', () => {
  it('names a real operator, not the placeholder', () => {
    expect(LEGAL.operator).toBe('Narender Cheema')
    expect(LEGAL.operator).not.toMatch(/the operator of/i)
  })

  it('has a last-updated date in plain words, and a log-retention figure that is a whole number of days', () => {
    expect(LEGAL.lastUpdated).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
    expect(Number.isInteger(LEGAL.monitoringLogDays)).toBe(true)
    expect(LEGAL.monitoringLogDays).toBeGreaterThan(0)
  })

  it('states the Clarity retention as a number of days, or as nothing at all if it has not been looked up (never a made-up figure)', () => {
    const days = LEGAL.analytics.retentionDays
    expect(days === null || (Number.isInteger(days) && days > 0)).toBe(true)
  })
})

describe('the analytics configuration the owner edits', () => {
  it('is either switched off (null) or a plausible project id, so a typo cannot slip through to the live site', () => {
    const id = ANALYTICS.clarityProjectId
    expect(id === null || isValidProjectId(id)).toBe(true)
  })
})

describe('the Privacy Policy matches what the site does', () => {
  it('no longer claims there are no tracking cookies: it names Microsoft Clarity and says it runs only if you agree', () => {
    expect(privacy).not.toContain('We do not use advertising or tracking cookies')
    expect(privacy).toContain('Microsoft Clarity')
    expect(privacy).toMatch(/only if you agree/i)
  })

  it('lists the Clarity cookies from the same lists the code uses to remove them, so the two cannot disagree', () => {
    expect(privacy).toContain('siteCookies')
    expect(privacy).toContain('ownCookies')
  })

  it('says where to change the choice', () => {
    expect(privacy).toContain('Privacy choices')
    expect(privacy).toContain('privacy-choices-policy')
  })

  it('lists the activity records the system really keeps: when someone last used the game, and the short-lived action counts', () => {
    expect(privacy).toContain('Activity records')
    expect(privacy).toContain('last used the game')
    expect(privacy).toContain('recent actions')
  })

  it('says how long monitoring records are kept, from the configured number', () => {
    expect(privacy).toContain('legal.monitoringLogDays')
  })

  it('says it sets no cookies of its own unless analytics is accepted, and mentions the choice kept in local storage', () => {
    expect(privacy).toContain('sets no cookies of its own')
    expect(privacy).toMatch(/local storage/)
  })
})
