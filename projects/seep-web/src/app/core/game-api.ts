import type {
  GameInfoDto,
  GameKind,
  GameSnapshotDto,
  GameUnchangedDto,
  LeaveGameDto,
  MutationDto,
  RematchDto,
  DeleteAccountDto,
  ProfileDto,
} from './api-types'

/** A non-2xx answer from the server. `message` is written to be shown to a person as-is. */
export class ApiError extends Error {
  readonly status: number
  /** Any extra fields the server sent alongside `error`, e.g. `currentVersion` on a 409. */
  readonly details: Record<string, unknown>

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

/** What a live game needs from the server. */
export interface GameApi {
  getGame<TView>(gameId: string, since?: number, sinceReaction?: number): Promise<GameSnapshotDto<TView> | GameUnchangedDto>
  /** Sends a quick reaction (a preset code) to everyone at the table. Never changes the game. */
  sendReaction(gameId: string, code: string, to?: string | null): Promise<{ seq: number }>
  submitMove<TView>(gameId: string, intent: unknown, expectedVersion: number): Promise<MutationDto<TView>>
  dealNext<TView>(gameId: string, expectedVersion: number): Promise<MutationDto<TView>>
}

/** What the lobby needs from the server. */
export interface LobbyApi {
  me(): Promise<ProfileDto>
  /** Chooses the name the person's opponents see. The server checks it and says why if it refuses. */
  setDisplayName(name: string): Promise<ProfileDto>
  /** Asks for a rematch of a finished two-player match: makes the table if you are first, joins it if the other player already asked. */
  requestRematch(gameId: string): Promise<RematchDto>
  /** Leaves a table that is still waiting for players. A match under way cannot be left this way. */
  leaveGame(gameId: string): Promise<LeaveGameDto>
  /** Erases the person from the server: forfeits matches in progress, frees or closes waiting tables, removes name and email. */
  deleteAccount(): Promise<DeleteAccountDto>
  createGame(kind: GameKind): Promise<GameInfoDto>
  joinGame(code: string): Promise<GameInfoDto>
  listGames(): Promise<GameInfoDto[]>
}

export interface HttpApiConfig {
  /** e.g. https://seep-api-xxxx.westus2-01.azurewebsites.net, with no trailing /api. */
  readonly baseUrl: string
  /** Sent as X-App-Version so the server can tell an out-of-date app to update. */
  readonly appVersion: string
  /** The signed-in user's Firebase ID token, or null when signed out. `forceRefresh` asks for a new one. */
  readonly getToken: (forceRefresh?: boolean) => Promise<string | null>
  /** Injectable for tests; defaults to the browser's fetch. */
  readonly fetchFn?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class HttpApi implements GameApi, LobbyApi {
  private readonly config: HttpApiConfig

  constructor(config: HttpApiConfig) {
    this.config = config
  }

  me(): Promise<ProfileDto> {
    return this.request('POST', '/v1/me')
  }

  setDisplayName(name: string): Promise<ProfileDto> {
    return this.request('POST', '/v1/me', { displayName: name })
  }

  requestRematch(gameId: string): Promise<RematchDto> {
    return this.request('POST', `/v1/games/${encodeURIComponent(gameId)}/rematch`)
  }

  leaveGame(gameId: string): Promise<LeaveGameDto> {
    return this.request('POST', `/v1/games/${encodeURIComponent(gameId)}/leave`)
  }

  deleteAccount(): Promise<DeleteAccountDto> {
    return this.request('POST', '/v1/me/delete')
  }

  createGame(kind: GameKind): Promise<GameInfoDto> {
    return this.request('POST', '/v1/games', { kind })
  }

  joinGame(code: string): Promise<GameInfoDto> {
    return this.request('POST', '/v1/join', { code })
  }

  async listGames(): Promise<GameInfoDto[]> {
    const res = await this.request<{ games: GameInfoDto[] }>('GET', '/v1/games')
    return res.games
  }

  getGame<TView>(gameId: string, since?: number, sinceReaction?: number): Promise<GameSnapshotDto<TView> | GameUnchangedDto> {
    const params = [since === undefined ? null : `since=${since}`, sinceReaction === undefined ? null : `sinceReaction=${sinceReaction}`].filter((p) => p !== null)
    const query = params.length === 0 ? '' : `?${params.join('&')}`
    return this.request('GET', `/v1/games/${encodeURIComponent(gameId)}${query}`)
  }

  sendReaction(gameId: string, code: string, to?: string | null): Promise<{ seq: number }> {
    // An address is only sent when there is one: no address means "for everyone", exactly as before addressing existed.
    return this.request('POST', `/v1/games/${encodeURIComponent(gameId)}/reactions`, to ? { code, to } : { code })
  }

  submitMove<TView>(gameId: string, intent: unknown, expectedVersion: number): Promise<MutationDto<TView>> {
    return this.request('POST', `/v1/games/${encodeURIComponent(gameId)}/moves`, { intent, expectedVersion })
  }

  dealNext<TView>(gameId: string, expectedVersion: number): Promise<MutationDto<TView>> {
    return this.request('POST', `/v1/games/${encodeURIComponent(gameId)}/deal-next`, { expectedVersion })
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.send(method, path, body, false)
    // A token can expire between being issued and being used: ask for a fresh one and try once more.
    if (res.status === 401) res = await this.send(method, path, body, true)

    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Not JSON (e.g. a platform error page); fall through with the status text.
    }
    if (!res.ok) {
      const { error, ...details } = isRecord(json) ? json : ({} as Record<string, unknown>)
      throw new ApiError(res.status, typeof error === 'string' ? error : res.statusText || `HTTP ${res.status}`, details)
    }
    return json as T
  }

  private async send(method: string, path: string, body: unknown, forceRefresh: boolean): Promise<Response> {
    const headers: Record<string, string> = { 'x-app-version': this.config.appVersion }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const token = await this.config.getToken(forceRefresh)
    if (token) headers['authorization'] = `Bearer ${token}`
    // Not `this.config.fetchFn ?? fetch` then called: invoking the browser's fetch as a method of another object throws "Illegal invocation".
    const doFetch = this.config.fetchFn ?? globalThis.fetch.bind(globalThis)
    return doFetch(`${this.config.baseUrl}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
}
