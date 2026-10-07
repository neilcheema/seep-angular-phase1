import { isInstalledApp, readDeviceEnv } from './install-mode'

/**
 * An installed web app is put to sleep, not closed, so it can wake days later still running the version it started with. When it wakes after
 * a long sleep on a page where nothing can be lost, it reloads itself to pick up the current version. It NEVER does that during a game,
 * because a game against the computer lives only in the page.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000

/** Pages where a reload loses nothing: the home page, the online lobby and the legal pages. */
const SAFE_PATHS = ['/', '/online', '/privacy', '/terms']

export function shouldReloadOnReturn(input: { installed: boolean; hiddenForMs: number; path: string }): boolean {
  const path = input.path.length > 1 ? input.path.replace(/\/+$/, '') : input.path
  return input.installed && input.hiddenForMs >= STALE_AFTER_MS && SAFE_PATHS.includes(path)
}

export function startStaleAppGuard(win: Window = window, now: () => number = () => Date.now()): void {
  if (!isInstalledApp(readDeviceEnv(win))) return
  let hiddenAt: number | null = null
  win.document.addEventListener('visibilitychange', () => {
    if (win.document.visibilityState === 'hidden') {
      hiddenAt = now()
      return
    }
    const since = hiddenAt
    hiddenAt = null
    if (since !== null && shouldReloadOnReturn({ installed: true, hiddenForMs: now() - since, path: win.location.pathname })) win.location.reload()
  })
}
