import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { AuthError, type VerifiedUser, verifyFirebaseToken } from './auth'
import { BadRequestError, HttpError } from './errors'
import { checkMinVersion } from './version-check'

export interface AuthedArgs {
  readonly request: HttpRequest
  readonly context: InvocationContext
  readonly identity: VerifiedUser
}

/**
 * The front door every endpoint goes through, in this order:
 *   1. minimum-app-version check  -> 426 (a client that needs updating should
 *      hear that whether or not its token happens to be valid)
 *   2. Firebase token verification -> 401
 *   3. the handler itself; any HttpError it throws becomes its status code
 *
 * Anything else a handler throws is a bug or an outage: it is deliberately
 * NOT caught, so it surfaces as a 500 and lands in Application Insights
 * instead of being disguised as a client error.
 */
export function authed(handler: (args: AuthedArgs) => Promise<HttpResponseInit>) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const versionCheck = checkMinVersion(request.headers.get('x-app-version'))
    if (!versionCheck.ok) {
      context.log(`Rejected app version ${versionCheck.clientVersion} (minimum ${versionCheck.minVersion})`)
      return {
        status: 426,
        jsonBody: {
          error: `This app version (${versionCheck.clientVersion}) is no longer supported. Minimum required: ${versionCheck.minVersion}.`,
        },
      }
    }

    let identity: VerifiedUser
    try {
      identity = await verifyFirebaseToken(request.headers.get('authorization'))
    } catch (err) {
      if (err instanceof AuthError) {
        // Logged via context.log, not console.log, so this reaches Azure's own
        // monitoring (Application Insights). Logs the reason, never the token.
        context.log(`Auth failed on ${request.url}: ${err.message}`)
        return { status: 401, jsonBody: { error: err.message } }
      }
      throw err
    }

    try {
      return await handler({ request, context, identity })
    } catch (err) {
      if (err instanceof HttpError) {
        return { status: err.status, jsonBody: { error: err.message, ...err.details } }
      }
      throw err
    }
  }
}

/**
 * Reads a JSON request body. An absent body is a 400 unless `optional`, in
 * which case it reads as an empty object (e.g. POST .../deal-next, which
 * takes no required fields).
 */
export async function readJsonBody(request: HttpRequest, options: { optional?: boolean } = {}): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') {
    if (options.optional) return {}
    throw new BadRequestError('Request body is required.')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequestError('Request body must be valid JSON.')
  }
}
