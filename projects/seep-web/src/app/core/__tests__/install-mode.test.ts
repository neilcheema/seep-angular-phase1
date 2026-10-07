import { describe, expect, it } from 'vitest'
import { type DeviceEnv, canAddToHomeScreen, isAppleMobile, isInstalledApp, readDeviceEnv, shouldShowInstallHint } from '../install-mode'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1'
const IPHONE_FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0;FBBV/1;FBDV/iPhone15,2]'
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0 (iPhone15,2)'
// An in-app browser that ALSO says "Safari/": only the list of in-app browsers can tell it apart from the real Safari.
const IPHONE_INSTAGRAM_SAYING_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Instagram 320.0.0.0 (iPhone15,2)'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const env = (over: Partial<DeviceEnv>): DeviceEnv => ({ userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5, standaloneFlag: false, displayModeStandalone: false, ...over })

describe('isAppleMobile', () => {
  it('knows iPhones and iPads, including an iPad that asks for desktop sites', () => {
    expect(isAppleMobile(env({}))).toBe(true)
    expect(isAppleMobile(env({ userAgent: IPHONE_CHROME }))).toBe(true)
    expect(isAppleMobile(env({ userAgent: IPAD_AS_MAC, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true) // an iPad calls itself a Mac but has a touch screen
  })
  it('does not mistake a real Mac or an Android phone for one', () => {
    expect(isAppleMobile(env({ userAgent: IPAD_AS_MAC, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false)
    expect(isAppleMobile(env({ userAgent: ANDROID_CHROME, platform: 'Linux armv8l', maxTouchPoints: 5 }))).toBe(false)
  })
})

describe('canAddToHomeScreen', () => {
  it('is true in Safari and in another real browser on an iPhone or iPad', () => {
    expect(canAddToHomeScreen(env({}))).toBe(true)
    expect(canAddToHomeScreen(env({ userAgent: IPHONE_CHROME }))).toBe(true)
    expect(canAddToHomeScreen(env({ userAgent: IPAD_AS_MAC, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true)
  })
  it('is false inside another app’s built-in browser, which has no Share, Add to Home Screen', () => {
    expect(canAddToHomeScreen(env({ userAgent: IPHONE_FACEBOOK }))).toBe(false)
    expect(canAddToHomeScreen(env({ userAgent: IPHONE_INSTAGRAM }))).toBe(false)
    expect(canAddToHomeScreen(env({ userAgent: IPHONE_INSTAGRAM_SAYING_SAFARI }))).toBe(false)
  })
  it('is false off Apple devices', () => {
    expect(canAddToHomeScreen(env({ userAgent: ANDROID_CHROME, platform: 'Linux armv8l' }))).toBe(false)
  })
})

describe('isInstalledApp', () => {
  it('sees an app opened from the Home Screen by either of the two signals', () => {
    expect(isInstalledApp(env({ standaloneFlag: true }))).toBe(true)
    expect(isInstalledApp(env({ displayModeStandalone: true }))).toBe(true)
    expect(isInstalledApp(env({}))).toBe(false)
  })
})

describe('shouldShowInstallHint', () => {
  it('shows only on an iPhone or iPad browser, not installed, and not already dismissed', () => {
    expect(shouldShowInstallHint(env({}), false)).toBe(true)
    expect(shouldShowInstallHint(env({}), true)).toBe(false) // said no thanks
    expect(shouldShowInstallHint(env({ standaloneFlag: true }), false)).toBe(false) // already installed
    expect(shouldShowInstallHint(env({ displayModeStandalone: true }), false)).toBe(false)
    expect(shouldShowInstallHint(env({ userAgent: IPHONE_FACEBOOK }), false)).toBe(false)
    expect(shouldShowInstallHint(env({ userAgent: ANDROID_CHROME, platform: 'Linux armv8l' }), false)).toBe(false)
  })
})

describe('readDeviceEnv', () => {
  it('reads the browser’s own answers, and copes with ones that are missing', () => {
    const win = { navigator: { userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5, standalone: true }, matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) } as unknown as Window
    expect(readDeviceEnv(win)).toEqual({ userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5, standaloneFlag: true, displayModeStandalone: true })
    const bare = { navigator: { userAgent: 'x' } } as unknown as Window // no matchMedia, no platform, no touch points
    expect(readDeviceEnv(bare)).toEqual({ userAgent: 'x', platform: '', maxTouchPoints: 0, standaloneFlag: false, displayModeStandalone: false })
  })
})
