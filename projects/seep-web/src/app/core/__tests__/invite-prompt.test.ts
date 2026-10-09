import { describe, expect, it } from 'vitest'
import {
  INVITE_DELAY_MS,
  INVITE_SEEN_KEY,
  INVITE_SNOOZE_DAYS,
  type InviteStorage,
  consentSettled,
  readInviteSeen,
  rememberInviteSeen,
  shouldShowInvite,
} from '../invite-prompt'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-08T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

function memory(initial: Record<string, string> = {}): InviteStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => { data[k] = v } }
}
const blocked: InviteStorage = {
  getItem: () => { throw new Error('storage is blocked') },
  setItem: () => { throw new Error('storage is blocked') },
}

describe('reading and remembering when the invitation was last seen', () => {
  it('knows nothing when nothing has been stored, or when there is no storage at all', () => {
    expect(readInviteSeen(memory())).toBeNull()
    expect(readInviteSeen(null)).toBeNull()
  })
  it('reads back what was remembered, under one plain key', () => {
    const s = memory()
    rememberInviteSeen(s, NOW)
    expect(Object.keys(s.data)).toEqual([INVITE_SEEN_KEY])
    expect(readInviteSeen(s)?.getTime()).toBe(NOW.getTime())
  })
  it('treats anything unreadable as "never seen" instead of failing', () => {
    expect(readInviteSeen(memory({ [INVITE_SEEN_KEY]: 'yesterday-ish' }))).toBeNull()
    expect(readInviteSeen(memory({ [INVITE_SEEN_KEY]: '' }))).toBeNull()
  })
  it('never throws when storage is blocked (private browsing, a full store): reading says "never", writing does nothing', () => {
    expect(readInviteSeen(blocked)).toBeNull()
    expect(() => rememberInviteSeen(blocked, NOW)).not.toThrow()
    expect(() => rememberInviteSeen(null, NOW)).not.toThrow()
  })
})

describe('when the invitation may be shown', () => {
  const base = { enabled: true, settled: true, seenAt: null, now: NOW }
  it('is shown to someone who has never seen it', () => {
    expect(shouldShowInvite(base)).toBe(true)
  })
  it('is not shown while switched off, or while the privacy banner is still in the way', () => {
    expect(shouldShowInvite({ ...base, enabled: false })).toBe(false)
    expect(shouldShowInvite({ ...base, settled: false })).toBe(false)
  })
  it('stays away for 30 days after it was seen, and returns on the 30th', () => {
    expect(INVITE_SNOOZE_DAYS).toBe(30)
    expect(shouldShowInvite({ ...base, seenAt: ago(1 * DAY) })).toBe(false)
    expect(shouldShowInvite({ ...base, seenAt: ago(29 * DAY + 23 * 60 * 60 * 1000) })).toBe(false)
    expect(shouldShowInvite({ ...base, seenAt: ago(30 * DAY) })).toBe(true)
    expect(shouldShowInvite({ ...base, seenAt: ago(400 * DAY) })).toBe(true)
  })
  it('errs on the side of staying away when the stored time is in the future (a changed clock)', () => {
    expect(shouldShowInvite({ ...base, seenAt: new Date(NOW.getTime() + 5 * DAY) })).toBe(false)
  })
  it('lets people look at the page first, and never nags a person who dismissed it', () => {
    expect(INVITE_DELAY_MS).toBeGreaterThanOrEqual(1500)
    const s = memory()
    expect(shouldShowInvite({ ...base, seenAt: readInviteSeen(s) })).toBe(true) // first visit
    rememberInviteSeen(s, NOW) // they pressed "Not now" or "Play online"
    expect(shouldShowInvite({ ...base, seenAt: readInviteSeen(s), now: new Date(NOW.getTime() + 2 * DAY) })).toBe(false)
    expect(shouldShowInvite({ ...base, seenAt: readInviteSeen(s), now: new Date(NOW.getTime() + 31 * DAY) })).toBe(true)
  })
})

describe('"the privacy banner is out of the way"', () => {
  it('is false while the banner is open, however the choice stands', () => {
    expect(consentSettled({ enabled: true, choice: null, bannerOpen: true })).toBe(false)
    expect(consentSettled({ enabled: true, choice: 'granted', bannerOpen: true })).toBe(false) // reopened from "Privacy choices"
    expect(consentSettled({ enabled: false, choice: null, bannerOpen: true })).toBe(false)
  })
  it('is false when analytics is in use and the visitor has not chosen yet', () => {
    expect(consentSettled({ enabled: true, choice: null, bannerOpen: false })).toBe(false)
  })
  it('is true once the visitor has chosen (either way), or when analytics is not in use at all', () => {
    expect(consentSettled({ enabled: true, choice: 'granted', bannerOpen: false })).toBe(true)
    expect(consentSettled({ enabled: true, choice: 'denied', bannerOpen: false })).toBe(true)
    expect(consentSettled({ enabled: false, choice: null, bannerOpen: false })).toBe(true)
  })
})
