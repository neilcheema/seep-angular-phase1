/**
 * Analytics consent: Microsoft Clarity may run ONLY after a visitor has said yes. This file holds the rules as plain code
 * (no browser objects), so every rule can be tested; analytics.service.ts connects it to the real page.
 *
 * The promises it keeps:
 *   - Nothing is loaded, and nothing is sent to Clarity, before an explicit "Accept".
 *   - "Decline" is as easy as "Accept", is remembered, and the site works fully either way.
 *   - A choice can be changed at any time; withdrawing stops Clarity and removes the cookies we are able to remove.
 *   - Without a valid Clarity project id configured there is no banner and nothing ever loads.
 */
export type ConsentChoice = 'granted' | 'denied'

/** Raise this when the banner's meaning changes enough that people should be asked again. */
export const CONSENT_NOTICE_VERSION = 1
export const CONSENT_STORAGE_KEY = 'seep.analytics-consent'

/** Clarity's cookies on our own site, which we can remove when someone declines or withdraws. */
export const CLARITY_SITE_COOKIES = ['_clck', '_clsk'] as const
/** Clarity's cookies on clarity.ms. They are Microsoft's, so only the visitor's browser settings can remove them. */
export const CLARITY_OWN_COOKIES = ['CLID', 'MUID'] as const

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The saved choice, or null if there is none (or it is unreadable, or was made for an older notice). Never throws. */
export function readConsent(storage: KeyValueStorage | null): ConsentChoice | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { choice?: unknown; v?: unknown } | null
    if (parsed && (parsed.choice === 'granted' || parsed.choice === 'denied') && parsed.v === CONSENT_NOTICE_VERSION) return parsed.choice
  } catch {
    // Unreadable or storage blocked: the same as no choice.
  }
  return null
}

/** Saves the choice. Returns false if the browser would not let us (private mode, blocked storage). Never throws. */
export function writeConsent(storage: KeyValueStorage | null, choice: ConsentChoice, now: Date): boolean {
  if (!storage) return false
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ choice, at: now.toISOString(), v: CONSENT_NOTICE_VERSION }))
    return true
  } catch {
    return false
  }
}

/**
 * Local development (ng serve) never runs analytics, so testing sessions do not pollute real usage data. This is the same rule the old,
 * always-on Clarity code followed, kept so that moving to a consent banner does not change it.
 */
export function isLocalDevelopment(hostname: string): boolean {
  return hostname === '' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** A Clarity project id: a short run of letters and digits. Anything else is refused, so a typo never loads a stray script. */
export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9]{6,16}$/i.test(id)
}

export function clarityScriptUrl(projectId: string): string {
  return `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`
}

export interface AnalyticsConfig {
  /** Null until the owner sets it: with no id there is no banner and nothing loads. */
  readonly projectId: string | null
  readonly scriptUrl: (projectId: string) => string
  /** The cookies to remove when someone declines or withdraws. */
  readonly removableCookies: readonly string[]
}

/** Everything that touches the real page, so the rules above can be tested without one. */
export interface AnalyticsDeps {
  readonly storage: KeyValueStorage | null
  readonly now: () => Date
  /** Adds the analytics script to the page. Called at most once, and only after consent. */
  readonly loadScript: (url: string) => void
  readonly removeCookies: (names: readonly string[]) => void
  /** Reloads the page, which is the only way to stop an analytics script that is already running. */
  readonly reload: () => void
  readonly warn: (message: string) => void
}

export interface AnalyticsState {
  /** False when no valid project id is configured: there is nothing to ask about. */
  readonly enabled: boolean
  readonly choice: ConsentChoice | null
  readonly bannerOpen: boolean
}

export class AnalyticsController {
  private choice: ConsentChoice | null = null
  private bannerOpen = false
  private loaded = false
  private readonly projectId: string | null

  constructor(
    private readonly deps: AnalyticsDeps,
    private readonly config: AnalyticsConfig,
  ) {
    if (config.projectId !== null && !isValidProjectId(config.projectId)) {
      deps.warn('The analytics project id is not valid, so analytics is switched off.')
      this.projectId = null
    } else {
      this.projectId = config.projectId
    }
  }

  get state(): AnalyticsState {
    return { enabled: this.projectId !== null, choice: this.choice, bannerOpen: this.bannerOpen }
  }

  /** Called once when the app starts. */
  start(): void {
    if (this.projectId === null) return
    this.choice = readConsent(this.deps.storage)
    if (this.choice === 'granted') {
      this.load()
      return
    }
    // No consent: clear any Clarity cookies left from before consent was asked for, and ask if there is no answer yet.
    this.deps.removeCookies(this.config.removableCookies)
    this.bannerOpen = this.choice === null
  }

  accept(): void {
    if (this.projectId === null) return
    this.choice = 'granted'
    this.bannerOpen = false
    // If the browser will not remember the choice, it is still honoured for this visit and asked again next time.
    writeConsent(this.deps.storage, 'granted', this.deps.now())
    this.load()
  }

  decline(): void {
    if (this.projectId === null) return
    const wasRunning = this.loaded
    this.choice = 'denied'
    this.bannerOpen = false
    writeConsent(this.deps.storage, 'denied', this.deps.now())
    this.deps.removeCookies(this.config.removableCookies)
    if (wasRunning) this.deps.reload() // an analytics script that is already running only stops when the page is reloaded
  }

  /** Reopens the choice (the "Privacy choices" link). */
  openChoices(): void {
    if (this.projectId !== null) this.bannerOpen = true
  }

  /** Closes the choice without changing it; only possible once a choice exists. */
  closeChoices(): void {
    if (this.choice !== null) this.bannerOpen = false
  }

  private load(): void {
    if (this.loaded || this.projectId === null) return
    this.loaded = true
    this.deps.loadScript(this.config.scriptUrl(this.projectId))
  }
}
