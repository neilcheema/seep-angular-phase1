import { describe, expect, it, vi } from 'vitest'
import { ApiError, HttpApi } from '../game-api'

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function fakeFetch(responses: { status: number; body?: unknown; raw?: string; statusText?: string }[]) {
  const sent: Sent[] = []
  const fn = vi.fn((url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const r = responses.shift() ?? { status: 500 }
    const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body))
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.statusText ?? '',
      text: () => Promise.resolve(text),
    } as Response)
  })
  return { fn: fn as unknown as typeof fetch, sent }
}

function api(responses: Parameters<typeof fakeFetch>[0], token: string | null = 'tok-1', refreshed = 'tok-2') {
  const { fn, sent } = fakeFetch(responses)
  const getToken = vi.fn((forceRefresh?: boolean) => Promise.resolve(forceRefresh ? refreshed : token))
  return { http: new HttpApi({ baseUrl: 'https://api.test', appVersion: '1.4.0', getToken, fetchFn: fn }), sent, getToken }
}

describe('HttpApi', () => {
  it('sends the bearer token and the app version on every request, under /api', async () => {
    const { http, sent } = api([{ status: 200, body: { id: 'u1' } }])
    await http.me()
    expect(sent[0]).toMatchObject({
      url: 'https://api.test/api/v1/me',
      method: 'POST',
      headers: { authorization: 'Bearer tok-1', 'x-app-version': '1.4.0' },
    })
  })

  it('sends a chosen name as the body of the profile call, and returns the saved profile', async () => {
    const { http, sent } = api([{ status: 200, body: { id: 'u1', displayName: 'Alice' } }])
    const profile = await http.setDisplayName('Alice')
    expect(sent[0]).toMatchObject({ url: 'https://api.test/api/v1/me', method: 'POST' })
    expect(sent[0]!.body).toEqual({ displayName: 'Alice' })
    expect(profile.displayName).toBe('Alice')
  })

  it('passes the server’s reason for refusing a name through, so the person can fix it', async () => {
    const { http } = api([{ status: 400, body: { error: 'Your name needs at least 2 characters.' } }])
    await expect(http.setDisplayName('A')).rejects.toMatchObject({ status: 400, message: 'Your name needs at least 2 characters.' })
  })

  it('only declares a JSON content type when it actually sends a body', async () => {
    const { http, sent } = api([{ status: 200, body: { id: 'u1' } }, { status: 200, body: { games: [] } }])
    await http.me()
    await http.listGames()
    expect(sent[0]!.headers['content-type']).toBeUndefined()
    const { http: h2, sent: s2 } = api([{ status: 201, body: {} }])
    await h2.createGame('two_player')
    expect(s2[0]!.headers['content-type']).toBe('application/json')
  })

  it('omits the Authorization header when signed out, rather than sending "Bearer null"', async () => {
    const { http, sent } = api([{ status: 401, body: { error: 'x' } }, { status: 401, body: { error: 'x' } }], null, null as unknown as string)
    await http.me().catch(() => undefined)
    expect(sent.every((s) => s.headers['authorization'] === undefined)).toBe(true)
  })

  it('builds each call as the server expects it', async () => {
    const { http, sent } = api(Array.from({ length: 6 }, () => ({ status: 200, body: { games: [] } })))
    await http.createGame('four_player')
    await http.joinGame('ABC234')
    await http.listGames()
    await http.getGame('g-1')
    await http.getGame('g/1', 7)
    await http.submitMove('g-1', { type: 'bid', value: 9 }, 3)
    expect(sent.map((s) => `${s.method} ${s.url.replace('https://api.test/api', '')}`)).toEqual([
      'POST /v1/games',
      'POST /v1/join',
      'GET /v1/games',
      'GET /v1/games/g-1',
      'GET /v1/games/g%2F1?since=7', // ids are encoded, never trusted into a path
      'POST /v1/games/g-1/moves',
    ])
    expect(sent[0]!.body).toEqual({ kind: 'four_player' })
    expect(sent[1]!.body).toEqual({ code: 'ABC234' })
    expect(sent[5]!.body).toEqual({ intent: { type: 'bid', value: 9 }, expectedVersion: 3 })
  })

  it('unwraps the games list', async () => {
    const { http } = api([{ status: 200, body: { games: [{ gameId: 'g1' }] } }])
    expect(await http.listGames()).toEqual([{ gameId: 'g1' }])
  })

  it('turns an error response into an ApiError carrying the status, the message, and any extra details', async () => {
    const { http } = api([{ status: 409, body: { error: 'The game has changed.', currentVersion: 7 } }])
    const err = await http.submitMove('g1', {}, 1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, message: 'The game has changed.', details: { currentVersion: 7 } })
  })

  it('still produces a sensible ApiError when the body is not JSON (e.g. a platform error page)', async () => {
    const { http } = api([{ status: 502, raw: '<html>Bad gateway</html>', statusText: 'Bad Gateway' }])
    const err = (await http.me().catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.message).toBe('Bad Gateway')
  })

  it('retries once with a freshly refreshed token after a 401, and succeeds if that works', async () => {
    const { http, sent, getToken } = api([{ status: 401, body: { error: 'expired' } }, { status: 200, body: { id: 'u1' } }])
    expect(await http.me()).toEqual({ id: 'u1' })
    expect(getToken.mock.calls).toEqual([[false], [true]])
    expect(sent.map((s) => s.headers['authorization'])).toEqual(['Bearer tok-1', 'Bearer tok-2'])
  })

  it('gives up after that one retry rather than looping', async () => {
    const { http, sent } = api([{ status: 401, body: { error: 'nope' } }, { status: 401, body: { error: 'still nope' } }])
    const err = (await http.me().catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(401)
    expect(err.message).toBe('still nope')
    expect(sent).toHaveLength(2)
  })

  it('does not retry any other failure', async () => {
    const { http, sent } = api([{ status: 500, body: { error: 'boom' } }])
    await http.me().catch(() => undefined)
    expect(sent).toHaveLength(1)
  })

  it('lets a network failure through as it is (not an ApiError), so callers can tell "offline" from "refused"', async () => {
    const http = new HttpApi({
      baseUrl: 'https://api.test',
      appVersion: '1.4.0',
      getToken: () => Promise.resolve('t'),
      fetchFn: (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch,
    })
    const err = await http.me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(ApiError)
  })
})
