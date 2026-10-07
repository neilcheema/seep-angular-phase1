import { describe, expect, it, vi } from 'vitest'
import { registerOfflineWorker, shouldRegisterOfflineWorker } from '../offline-worker'

describe('shouldRegisterOfflineWorker', () => {
  it('registers on a secure page that supports workers, on any host but localhost', () => {
    expect(shouldRegisterOfflineWorker({ hasServiceWorker: true, secure: true, hostname: 'seep.quest' })).toBe(true)
    expect(shouldRegisterOfflineWorker({ hasServiceWorker: true, secure: true, hostname: '127.0.0.1' })).toBe(true)
  })
  it('does not on localhost (a developer’s own reloads), on an insecure page, or without worker support', () => {
    expect(shouldRegisterOfflineWorker({ hasServiceWorker: true, secure: true, hostname: 'localhost' })).toBe(false)
    expect(shouldRegisterOfflineWorker({ hasServiceWorker: true, secure: false, hostname: 'seep.quest' })).toBe(false)
    expect(shouldRegisterOfflineWorker({ hasServiceWorker: false, secure: true, hostname: 'seep.quest' })).toBe(false)
  })
})

function fakeWindow(over: { hostname?: string; secure?: boolean; ready?: string; supported?: boolean; register?: () => Promise<unknown> }) {
  const register = vi.fn(over.register ?? (() => Promise.resolve({})))
  const listeners: Record<string, () => void> = {}
  const navigator = over.supported === false ? {} : { serviceWorker: { register } }
  const win = {
    navigator, isSecureContext: over.secure ?? true, location: { hostname: over.hostname ?? 'seep.quest' },
    document: { readyState: over.ready ?? 'complete' }, addEventListener: (type: string, fn: () => void) => { listeners[type] = fn },
  } as unknown as Window
  return { win, register, fire: (type: string) => listeners[type]?.() }
}

describe('registerOfflineWorker', () => {
  it('registers /sw.js at the site’s root once the page has loaded', () => {
    const { win, register } = fakeWindow({})
    registerOfflineWorker(win)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })
  it('waits for the page to finish loading first, so it never competes with the app for the network', () => {
    const { win, register, fire } = fakeWindow({ ready: 'loading' })
    registerOfflineWorker(win)
    expect(register).not.toHaveBeenCalled()
    fire('load')
    expect(register).toHaveBeenCalledTimes(1)
  })
  it('does nothing on localhost, an insecure page, or a browser without service workers', () => {
    for (const over of [{ hostname: 'localhost' }, { secure: false }, { supported: false }]) {
      const { win, register } = fakeWindow(over)
      registerOfflineWorker(win)
      expect(register).not.toHaveBeenCalled()
    }
  })
  it('shrugs off a registration that fails: the app works the same without it', async () => {
    const { win, register } = fakeWindow({ register: () => Promise.reject(new Error('blocked')) })
    expect(() => registerOfflineWorker(win)).not.toThrow()
    await Promise.resolve()
    expect(register).toHaveBeenCalledTimes(1) // and no unhandled rejection is left behind
  })
})
