/**
 * The invitation on the home page: "play online with your friends and family".
 *
 * It is meant to be noticed once, politely, and then left alone. These are the rules for when it may appear. They are kept free of Angular and
 * of the browser so that they can be tested on their own; the component that shows the popup only asks them.
 */

/** Where the time of the last invitation is kept, on this device only. It is a plain "already shown" marker and holds nothing about the person. */
export const INVITE_SEEN_KEY = 'seep.invite-seen'

/** After the invitation has been seen (accepted or dismissed), it stays away for this many days. */
export const INVITE_SNOOZE_DAYS = 30

/** How long after the home page appears before the invitation shows, so people can look at the page first. */
export const INVITE_DELAY_MS = 2500

const DAY_MS = 24 * 60 * 60 * 1000

/** The two things this needs from the browser's localStorage, so a test can supply its own. */
export interface InviteStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** When the invitation was last seen, or null if never (or if what is stored cannot be read). Never throws: storage can be blocked. */
export function readInviteSeen(storage: InviteStorage | null): Date | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(INVITE_SEEN_KEY)
    if (!raw) return null
    const time = Date.parse(raw)
    return Number.isNaN(time) ? null : new Date(time)
  } catch {
    return null
  }
}

/** Notes that the invitation has been seen. Never throws: if storage is blocked or full the invitation may simply show again, which is harmless. */
export function rememberInviteSeen(storage: InviteStorage | null, now: Date): void {
  if (!storage) return
  try {
    storage.setItem(INVITE_SEEN_KEY, now.toISOString())
  } catch {
    /* private browsing or a full store: nothing to do */
  }
}

/** True when the privacy banner is out of the way: it is not open, and either analytics is not in use or the visitor has already chosen. */
export function consentSettled(analytics: { enabled: boolean; choice: unknown; bannerOpen: boolean }): boolean {
  return !analytics.bannerOpen && (!analytics.enabled || analytics.choice !== null)
}

export interface InviteInput {
  /** The feature switch (off in tests that must not be interrupted). */
  readonly enabled: boolean
  /** The privacy banner is out of the way (see consentSettled). */
  readonly settled: boolean
  /** When the invitation was last seen, or null. */
  readonly seenAt: Date | null
  readonly now: Date
}

/** Whether the invitation may be shown now. A "seen" time in the future (a changed clock) counts as seen, so it errs on the side of staying away. */
export function shouldShowInvite(input: InviteInput): boolean {
  if (!input.enabled || !input.settled) return false
  if (!input.seenAt) return true
  return input.now.getTime() - input.seenAt.getTime() >= INVITE_SNOOZE_DAYS * DAY_MS
}
