import { describe, expect, it, vi } from 'vitest'
import { STALE_AFTER_MS, shouldReloadOnReturn, startStaleAppGuard } from '../stale-app'

const HOUR = 60 * 60 * 1000

describe('shouldReloadOnReturn', () => {
  const base = { installed: true, hiddenForMs: STALE_AFTER_MS, path: '/' }
  it('reloads an installed app that slept long enough, on a page where nothing can be lost', () => {
    for (const path of ['/', '/online', '/online/', '/privacy', '/terms']) expect(shouldReloadOnReturn({ ...base, path }), path).toBe(true)
  })
  it('never during a game, a join, or any page with something in progress', () => {
    for (const path of ['/two-player', '/four-player', '/learn', '/online/game/abc123', '/join/ABC234', '/online/results/1']) expect(shouldReloadOnReturn({ ...base, path }), path).toBe(false)
  })
  it('not before it has slept six hours, and not if it is only a browser tab', () => {
    expect(shouldReloadOnReturn({ ...base, hiddenForMs: STALE_AFTER_MS - 1 })).toBe(false)
    expect(shouldReloadOnReturn({ ...base, installed: false })).toBe(false)
    expect(STALE_AFTER_MS).toBe(6 * HOUR)
  })
})

function fakeWindow(opts: { installed: boolean; path: string }) {
  const listeners: (() => void)[] = []
  const doc = { visibilityState: 'visible', addEventListener: (_t: string, fn: () => void) => listeners.push(fn) }
  const reload = vi.fn()
  const win = {
    navigator: { userAgent: 'x', platform: 'iPhone', maxTouchPoints: 5, standalone: opts.installed }, matchMedia: () => ({ matches: false }),
    document: doc, location: { pathname: opts.path, reload },
  } as unknown as Window
  let clock = 1_000_000
  return {
    win, reload, now: () => clock,
    go: (state: 'hidden' | 'visible', advanceMs = 0) => { clock += advanceMs; doc.visibilityState = state; listeners.forEach((fn) => fn()) },
  }
}

describe('startStaleAppGuard', () => {
  it('reloads when an installed app wakes on the home page after a long sleep', () => {
    const t = fakeWindow({ installed: true, path: '/' })
    startStaleAppGuard(t.win, t.now)
    t.go('hidden'); t.go('visible', 7 * HOUR)
    expect(t.reload).toHaveBeenCalledTimes(1)
  })
  it('does not reload after a short sleep, or in the middle of a game, however long', () => {
    const short = fakeWindow({ installed: true, path: '/' })
    startStaleAppGuard(short.win, short.now)
    short.go('hidden'); short.go('visible', 5 * HOUR)
    expect(short.reload).not.toHaveBeenCalled()
    const game = fakeWindow({ installed: true, path: '/two-player' })
    startStaleAppGuard(game.win, game.now)
    game.go('hidden'); game.go('visible', 48 * HOUR)
    expect(game.reload).not.toHaveBeenCalled()
  })
  it('does nothing at all in an ordinary browser tab', () => {
    const t = fakeWindow({ installed: false, path: '/' })
    startStaleAppGuard(t.win, t.now)
    t.go('hidden'); t.go('visible', 48 * HOUR)
    expect(t.reload).not.toHaveBeenCalled()
  })
  it('measures each sleep afresh: a long one, then a short one', () => {
    const t = fakeWindow({ installed: true, path: '/online' })
    startStaleAppGuard(t.win, t.now)
    t.go('hidden'); t.go('visible', 7 * HOUR)
    expect(t.reload).toHaveBeenCalledTimes(1)
    t.go('hidden'); t.go('visible', 1 * HOUR)
    expect(t.reload).toHaveBeenCalledTimes(1) // not again
  })
  it('ignores a "visible" signal that was never preceded by hiding', () => {
    const t = fakeWindow({ installed: true, path: '/' })
    startStaleAppGuard(t.win, t.now)
    t.go('visible', 100 * HOUR)
    expect(t.reload).not.toHaveBeenCalled()
  })
})
