/**
 * Is this an iPhone or iPad, and is Seep running as an installed Home Screen app? Pure functions over a plain description of the device, so they
 * can be tested with any device without owning one. readDeviceEnv() is the only part that touches the browser.
 */
export interface DeviceEnv {
  readonly userAgent: string
  readonly platform: string
  readonly maxTouchPoints: number
  /** Safari's own flag: true when the page was opened from the Home Screen. */
  readonly standaloneFlag: boolean
  /** The standard way to ask: the page is shown as an app, without a browser toolbar. */
  readonly displayModeStandalone: boolean
}

export function readDeviceEnv(win: Window = window): DeviceEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standaloneFlag: nav.standalone === true,
    displayModeStandalone: typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches,
  }
}

/** An iPhone, an iPod or an iPad, including an iPad that asks for desktop sites (it then calls itself a Mac, but has a touch screen). */
export function isAppleMobile(env: DeviceEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1
}

/** Browsers built into other apps (a link opened inside Facebook, say) have no Share, Add to Home Screen, so there is nothing to suggest there. */
const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|Snapchat|TikTok|musical_ly/

/** Can this browser put Seep on the Home Screen: Safari, or another real browser on an iPhone or iPad? */
export function canAddToHomeScreen(env: DeviceEnv): boolean {
  return isAppleMobile(env) && /Safari\//.test(env.userAgent) && !IN_APP_BROWSER.test(env.userAgent)
}

/** True when Seep was opened from the Home Screen, so it is running as an app. */
export function isInstalledApp(env: DeviceEnv): boolean {
  return env.standaloneFlag || env.displayModeStandalone
}

/** Show the "add it to your Home Screen" hint: on an iPhone or iPad that can, until it is installed or the person says no thanks. */
export function shouldShowInstallHint(env: DeviceEnv, dismissed: boolean): boolean {
  return canAddToHomeScreen(env) && !isInstalledApp(env) && !dismissed
}
