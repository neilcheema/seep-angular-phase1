import { app } from '@azure/functions'
import { deleteAccount } from '../lib/account'
import { getDb } from '../lib/db'
import { authed } from '../lib/http'

/**
 * POST /api/v1/me/delete — erases the signed-in person (see lib/account.ts for exactly what that means).
 * Idempotent: a second call succeeds too, so a deletion that was interrupted can always be finished.
 *
 * A POST rather than a DELETE on purpose: a browser calling a different origin sends a "preflight" check first, and
 * whether the platform's CORS setting lets DELETE through was never verified. POST is exactly what every other call
 * the browser already makes in production uses, so this depends on nothing untested.
 */
export const deleteMe = authed(async ({ identity }) => {
  const result = await deleteAccount(getDb(), identity.uid)
  return { status: 200, jsonBody: result }
})

app.http('me-delete', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/me/delete', handler: deleteMe })
