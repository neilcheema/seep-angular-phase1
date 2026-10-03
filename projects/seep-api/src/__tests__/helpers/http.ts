import { vi } from 'vitest'
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'

export type Handler = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>

export interface CallOptions {
  /** Who is calling: sent as `Authorization: Bearer <as>`. Omit for an unauthenticated call. */
  readonly as?: string
  readonly params?: Record<string, string>
  readonly query?: string
  /** Sent as JSON unless it's already a string (use that to send malformed JSON). */
  readonly body?: unknown
  readonly appVersion?: string
}

export interface CallResult {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly log: ReturnType<typeof vi.fn>
}

/** Calls a handler the way the Functions host would, with a minimal fake request. */
export async function call(handler: Handler, options: CallOptions = {}): Promise<CallResult> {
  const headers = new Headers()
  if (options.as !== undefined) headers.set('authorization', `Bearer ${options.as}`)
  if (options.appVersion !== undefined) headers.set('x-app-version', options.appVersion)
  const text =
    options.body === undefined ? '' : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  const request = {
    url: 'https://example.test/api/v1/test',
    headers,
    params: options.params ?? {},
    query: new URLSearchParams(options.query ?? ''),
    text: () => Promise.resolve(text),
  } as unknown as HttpRequest
  const log = vi.fn()
  const response = await handler(request, { log } as unknown as InvocationContext)
  return { status: response.status ?? 200, body: (response.jsonBody ?? {}) as Record<string, unknown>, log }
}
