import { Injectable, InjectionToken, inject, signal } from '@angular/core'
import { ANALYTICS } from './analytics-config'
import {
  AnalyticsController, type AnalyticsConfig, type AnalyticsDeps, type ClarityConsent, type ConsentChoice, type ScriptStatus, CLARITY_SITE_COOKIES, clarityScriptUrl, isLocalDevelopment,
} from './analytics-consent'

/** The real configuration; the browser tests replace it with a stand-in so no real analytics script is ever contacted. */
export const ANALYTICS_CONFIG = new InjectionToken<AnalyticsConfig>('ANALYTICS_CONFIG', {
  providedIn: 'root',
  // On a developer's own machine there is no project id, so no banner and no analytics (see isLocalDevelopment).
  factory: () => ({
    projectId: typeof location !== 'undefined' && isLocalDevelopment(location.hostname) ? null : ANALYTICS.clarityProjectId,
    scriptUrl: clarityScriptUrl,
    removableCookies: CLARITY_SITE_COOKIES,
  }),
})

function browserStorage(): AnalyticsDeps['storage'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null // some browsers throw just for looking at storage when it is blocked
  }
}

interface ClarityFunction {
  (...args: unknown[]): void
  q?: unknown[]
}

/**
 * Clarity's own start-up snippet begins by creating a function that queues calls until the real script arrives and replays them. Doing the same
 * means the consent signal can be given before the script has loaded, and is not lost.
 */
function clarityQueue(): ClarityFunction {
  const w = window as unknown as { clarity?: ClarityFunction }
  if (!w.clarity) {
    const queue: ClarityFunction = function () {
      // eslint-disable-next-line prefer-rest-params
      ;(queue.q = queue.q ?? []).push(arguments)
    }
    w.clarity = queue
  }
  return w.clarity
}

function tellClarity(consent: ClarityConsent): void {
  clarityQueue()('consentv2', consent)
}

/** Removes a cookie by name, trying the site's own domain and each parent domain, since the cookie may have been set on any of them. */
function removeCookie(name: string): void {
  const host = location.hostname
  const parts = host.split('.')
  const domains: (string | null)[] = [null, host]
  for (let i = 0; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join('.')}`)
  for (const domain of domains) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ''}`
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly controller = new AnalyticsController(
    {
      storage: browserStorage(),
      now: () => new Date(),
      loadScript: (url, done) => {
        const script = document.createElement('script')
        script.async = true
        script.src = url
        script.onload = () => done(true)
        script.onerror = () => done(false) // blocked by an extension or a network filter, or the address did not answer
        document.head.appendChild(script)
      },
      tellClarity,
      changed: () => this.sync(),
      removeCookies: (names) => names.forEach(removeCookie),
      reload: () => location.reload(),
      warn: (message) => console.warn(message),
    },
    inject(ANALYTICS_CONFIG),
  )

  readonly enabled = signal(false)
  readonly choice = signal<ConsentChoice | null>(null)
  readonly bannerOpen = signal(false)
  /** Whether the Clarity script arrived and ran on this device. It shows what the browser did; Clarity's own dashboard shows what it recorded. */
  readonly script = signal<ScriptStatus>('none')
  private started = false

  /** Starts it once; every later call does nothing. */
  init(): void {
    if (this.started) return
    this.started = true
    this.controller.start()
    this.sync()
  }

  accept(): void {
    this.controller.accept()
    this.sync()
  }

  decline(): void {
    this.controller.decline()
    this.sync()
  }

  openChoices(): void {
    this.controller.openChoices()
    this.sync()
  }

  closeChoices(): void {
    this.controller.closeChoices()
    this.sync()
  }

  private sync(): void {
    const s = this.controller.state
    this.enabled.set(s.enabled)
    this.choice.set(s.choice)
    this.bannerOpen.set(s.bannerOpen)
    this.script.set(s.script)
  }
}
