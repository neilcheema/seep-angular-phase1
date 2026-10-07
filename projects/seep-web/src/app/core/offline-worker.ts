/**
 * Registers Seep's one-job service worker (public/sw.js): when the app is opened with no connection, it shows a friendly page instead of a
 * browser error. It stores nothing else, so it cannot cause an out-of-date copy of the app to be shown.
 */
export interface WorkerEnv {
  readonly hasServiceWorker: boolean
  /** https, or a local address: browsers only allow service workers there. */
  readonly secure: boolean
  readonly hostname: string
}

/**
 * Not on `localhost`: a developer running `ng serve` there should not get a worker that interferes with their own reloads. Everywhere else
 * that is secure (the real site, and the test server on 127.0.0.1) it is registered.
 */
export function shouldRegisterOfflineWorker(env: WorkerEnv): boolean {
  return env.hasServiceWorker && env.secure && env.hostname !== 'localhost'
}

export function registerOfflineWorker(win: Window = window): void {
  const env: WorkerEnv = { hasServiceWorker: 'serviceWorker' in win.navigator, secure: win.isSecureContext, hostname: win.location.hostname }
  if (!shouldRegisterOfflineWorker(env)) return
  const register = () => {
    win.navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration can fail (private browsing, a blocked worker). The app works exactly the same without it, so there is nothing to report.
    })
  }
  // After the page has finished loading, so the worker never competes with the app for the network when it starts.
  if (win.document.readyState === 'complete') register()
  else win.addEventListener('load', register, { once: true })
}
