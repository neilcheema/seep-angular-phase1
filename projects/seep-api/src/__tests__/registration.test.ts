import { describe, expect, it, vi } from 'vitest'

const registered: { name: string; methods: string[]; route: string; authLevel: string }[] = []
const timers: { name: string; schedule: string }[] = []
vi.mock('@azure/functions', () => ({
  app: {
    http: (name: string, options: { methods: string[]; route: string; authLevel: string }) => {
      registered.push({ name, methods: options.methods, route: options.route, authLevel: options.authLevel })
    },
    timer: (name: string, options: { schedule: string }) => {
      timers.push({ name, schedule: options.schedule })
    },
  },
}))

describe('function registration', () => {
  it('registers exactly the expected endpoints, with no two sharing a method and route shape', async () => {
    await import('../index')

    expect(registered.map((r) => `${r.methods.join(',')} ${r.route}`).sort()).toEqual(
      [
        'GET v1/games',
        'GET v1/games/{id}',
        'GET v1/health',
        'POST v1/games',
        'POST v1/games/{id}/deal-next',
        'POST v1/games/{id}/leave',
        'POST v1/games/{id}/rematch',
        'POST v1/games/{id}/moves',
        'POST v1/join',
        'POST v1/me',
        'POST v1/me/delete',
      ].sort(),
    )

    // Two routes that differ only in a parameter's name would collide in the Functions host.
    const shapes = registered.flatMap((r) => r.methods.map((m) => `${m} ${r.route.replace(/\{[^}]+\}/g, '{}')}`))
    expect(new Set(shapes).size).toBe(shapes.length)

    // Function names must be unique too.
    expect(new Set(registered.map((r) => r.name)).size).toBe(registered.length)

    // Auth is done in code with the Firebase token, so the platform's own key check is switched off —
    // every route being 'anonymous' at the platform level is intentional, and authed() is what protects it.
    expect(registered.every((r) => r.authLevel === 'anonymous')).toBe(true)
  })

  it('registers the daily cleanup on a timer, once a day, and nothing else on a timer', () => {
    expect(timers).toHaveLength(1)
    expect(timers[0]!.name).toBe('cleanup')
    // second minute hour day month weekday: a fixed time of day, every day
    expect(timers[0]!.schedule).toMatch(/^0 \d{1,2} \d{1,2} \* \* \*$/)
  })
})
