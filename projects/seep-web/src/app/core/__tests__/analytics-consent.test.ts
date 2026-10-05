import { describe, expect, it, vi } from 'vitest'
import {
  AnalyticsController, type AnalyticsConfig, type AnalyticsDeps, CLARITY_SITE_COOKIES, CONSENT_NOTICE_VERSION, CONSENT_STORAGE_KEY,
  clarityScriptUrl, isLocalDevelopment, isValidProjectId, readConsent, writeConsent,
} from '../analytics-consent'

/** A page that has not been told it may run analytics must not run it. These are the rules, one by one. */

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v } }
}
const saved = (choice: string, v = CONSENT_NOTICE_VERSION) => ({ [CONSENT_STORAGE_KEY]: JSON.stringify({ choice, at: '2026-10-05T00:00:00.000Z', v }) })

function setup(over: { projectId?: string | null; storage?: AnalyticsDeps['storage'] } = {}) {
  const storage = over.storage === undefined ? memoryStorage() : over.storage
  const deps = { storage, now: () => new Date('2026-10-05T12:00:00Z'), loadScript: vi.fn(), removeCookies: vi.fn(), reload: vi.fn(), warn: vi.fn() }
  const config: AnalyticsConfig = { projectId: over.projectId === undefined ? 'abcd1234ef' : over.projectId, scriptUrl: clarityScriptUrl, removableCookies: CLARITY_SITE_COOKIES }
  return { deps, controller: new AnalyticsController(deps, config), storage }
}

describe('nothing loads before an explicit yes', () => {
  it('on a first visit it asks, and loads nothing', () => {
    const { controller, deps } = setup()
    controller.start()
    expect(controller.state).toEqual({ enabled: true, choice: null, bannerOpen: true })
    expect(deps.loadScript).not.toHaveBeenCalled()
  })

  it('still loads nothing however long the banner is left unanswered or reopened', () => {
    const { controller, deps } = setup()
    controller.start()
    controller.openChoices()
    controller.closeChoices()
    expect(deps.loadScript).not.toHaveBeenCalled()
  })

  it('loads only the Clarity address for the configured project, and only on Accept', () => {
    const { controller, deps } = setup()
    controller.start()
    controller.accept()
    expect(deps.loadScript).toHaveBeenCalledTimes(1)
    expect(deps.loadScript).toHaveBeenCalledWith('https://www.clarity.ms/tag/abcd1234ef')
    expect(controller.state).toEqual({ enabled: true, choice: 'granted', bannerOpen: false })
  })

  it('never loads it twice, however many times it is accepted or the app starts', () => {
    const { controller, deps } = setup()
    controller.start()
    controller.accept()
    controller.accept()
    controller.start()
    expect(deps.loadScript).toHaveBeenCalledTimes(1)
  })
})

describe('declining', () => {
  it('is as easy as accepting, is remembered, and loads nothing', () => {
    const { controller, deps, storage } = setup()
    controller.start()
    controller.decline()
    expect(controller.state).toEqual({ enabled: true, choice: 'denied', bannerOpen: false })
    expect(deps.loadScript).not.toHaveBeenCalled()
    expect(readConsent(storage)).toBe('denied')
  })

  it('on the next visit does not ask again, and still loads nothing', () => {
    const { controller, deps } = setup({ storage: memoryStorage(saved('denied')) })
    controller.start()
    expect(controller.state).toEqual({ enabled: true, choice: 'denied', bannerOpen: false })
    expect(deps.loadScript).not.toHaveBeenCalled()
  })

  it('does not reload the page when nothing was running (there is nothing to stop)', () => {
    const { controller, deps } = setup()
    controller.start()
    controller.decline()
    expect(deps.reload).not.toHaveBeenCalled()
  })
})

describe('a returning visitor who said yes', () => {
  it('has Clarity loaded straight away, without being asked again', () => {
    const { controller, deps } = setup({ storage: memoryStorage(saved('granted')) })
    controller.start()
    expect(controller.state).toEqual({ enabled: true, choice: 'granted', bannerOpen: false })
    expect(deps.loadScript).toHaveBeenCalledTimes(1)
  })

  it('is asked again if the notice has changed since they agreed', () => {
    const { controller, deps } = setup({ storage: memoryStorage(saved('granted', CONSENT_NOTICE_VERSION - 1)) })
    controller.start()
    expect(controller.state.choice).toBeNull()
    expect(controller.state.bannerOpen).toBe(true)
    expect(deps.loadScript).not.toHaveBeenCalled()
  })
})

describe('withdrawing consent', () => {
  it('stops Clarity: removes the cookies we can, remembers the refusal, and reloads (the only way to stop a running script)', () => {
    const { controller, deps, storage } = setup({ storage: memoryStorage(saved('granted')) })
    controller.start()
    controller.openChoices()
    controller.decline()
    expect(deps.removeCookies).toHaveBeenLastCalledWith(['_clck', '_clsk'])
    expect(deps.reload).toHaveBeenCalledTimes(1)
    expect(readConsent(storage)).toBe('denied')
    expect(controller.state.bannerOpen).toBe(false)
  })

  it('after the reload nothing loads, because the refusal was saved', () => {
    const { storage } = setup({ storage: memoryStorage(saved('granted')) })
    const first = setup({ storage })
    first.controller.start()
    first.controller.decline()
    const afterReload = setup({ storage })
    afterReload.controller.start()
    expect(afterReload.deps.loadScript).not.toHaveBeenCalled()
  })

  it('can change their mind again and accept', () => {
    const { controller, deps } = setup({ storage: memoryStorage(saved('denied')) })
    controller.start()
    controller.openChoices()
    expect(controller.state.bannerOpen).toBe(true)
    controller.accept()
    expect(deps.loadScript).toHaveBeenCalledTimes(1)
  })
})

describe('cookies left from before consent was asked for', () => {
  it('are removed on a first visit, so an old always-on setup leaves nothing behind unless the visitor now agrees', () => {
    const { controller, deps } = setup()
    controller.start()
    expect(deps.removeCookies).toHaveBeenCalledWith(['_clck', '_clsk'])
  })

  it('are removed when the visitor declines', () => {
    const { controller, deps } = setup()
    controller.start()
    deps.removeCookies.mockClear()
    controller.decline()
    expect(deps.removeCookies).toHaveBeenCalledWith(['_clck', '_clsk'])
  })

  it('are left alone for someone who has agreed', () => {
    const { controller, deps } = setup({ storage: memoryStorage(saved('granted')) })
    controller.start()
    expect(deps.removeCookies).not.toHaveBeenCalled()
  })
})

describe('when it is not configured, or goes wrong', () => {
  it('with no project id there is no banner, nothing loads, and nothing is touched', () => {
    const { controller, deps } = setup({ projectId: null })
    controller.start()
    controller.accept()
    controller.openChoices()
    expect(controller.state).toEqual({ enabled: false, choice: null, bannerOpen: false })
    expect(deps.loadScript).not.toHaveBeenCalled()
    expect(deps.removeCookies).not.toHaveBeenCalled()
  })

  it('an invalid project id is refused with a warning, and nothing loads (a typo never loads a stray script)', () => {
    for (const bad of ['', 'abc', 'has space!', '../evil', 'a'.repeat(40)]) {
      const { controller, deps } = setup({ projectId: bad })
      controller.start()
      controller.accept()
      expect(controller.state.enabled).toBe(false)
      expect(deps.loadScript).not.toHaveBeenCalled()
      expect(deps.warn).toHaveBeenCalled()
    }
  })

  it('if the browser blocks storage, the choice is honoured for this visit and asked again next time, and nothing breaks', () => {
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const { controller, deps } = setup({ storage: blocked })
    controller.start()
    expect(controller.state.bannerOpen).toBe(true)
    controller.accept()
    expect(deps.loadScript).toHaveBeenCalledTimes(1)
    const none = setup({ storage: null })
    none.controller.start()
    expect(none.controller.state.bannerOpen).toBe(true)
  })

  it('garbage in storage counts as no choice', () => {
    for (const junk of ['not json', '{}', '{"choice":"maybe","v":1}', 'null', '[]', '{"choice":"granted"}']) {
      expect(readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: junk }))).toBeNull()
    }
  })
})

describe('the small pieces', () => {
  it('accepts only plausible project ids', () => {
    expect(isValidProjectId('abcd1234ef')).toBe(true)
    expect(isValidProjectId('ABC123xyz9')).toBe(true)
    for (const bad of [null, undefined, 42, '', 'short', 'with-dash-1', 'a'.repeat(17), 'x y z 1 2 3']) expect(isValidProjectId(bad)).toBe(false)
  })

  it('writes a readable record, and says if it could not', () => {
    const storage = memoryStorage()
    expect(writeConsent(storage, 'granted', new Date('2026-10-05T00:00:00Z'))).toBe(true)
    expect(JSON.parse(storage.data[CONSENT_STORAGE_KEY]!)).toEqual({ choice: 'granted', at: '2026-10-05T00:00:00.000Z', v: CONSENT_NOTICE_VERSION })
    expect(writeConsent(null, 'granted', new Date())).toBe(false)
  })

  it('lists only the cookies that are on our own site as removable (Clarity’s CLID and MUID belong to clarity.ms)', () => {
    expect([...CLARITY_SITE_COOKIES]).toEqual(['_clck', '_clsk'])
  })

  it('builds the Clarity address from the id, escaping anything odd', () => {
    expect(clarityScriptUrl('abcd1234ef')).toBe('https://www.clarity.ms/tag/abcd1234ef')
    expect(clarityScriptUrl('a/b')).toBe('https://www.clarity.ms/tag/a%2Fb')
  })
})

describe('local development never runs analytics', () => {
  it('treats a developer’s own machine as local, as the old Clarity code did', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '']) expect(isLocalDevelopment(host)).toBe(true)
  })

  it('does not treat the real site, its www address, or a look-alike as local', () => {
    for (const host of ['seep.quest', 'www.seep.quest', 'localhost.evil.example', '127.0.0.1.evil.example', 'my-app.azurewebsites.net']) expect(isLocalDevelopment(host)).toBe(false)
  })
})

