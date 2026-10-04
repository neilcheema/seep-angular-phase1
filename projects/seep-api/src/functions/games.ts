import { app } from '@azure/functions'
import { getDb } from '../lib/db'
import { isGameKind } from '../lib/engines'
import { BadRequestError } from '../lib/errors'
import { createGame, dealNext, getGame, joinGame, leaveWaitingTable, listMyGames, parseVersion, requestRematch, submitMove } from '../lib/games'
import { authed, readJsonBody } from '../lib/http'
import { assertTableCaps, guardCreate, guardJoin, guardMove, limitSettings } from '../lib/limits'
import { resolveUserId } from '../lib/users'

/**
 * The game-hosting endpoints. Each handler only parses its request, calls
 * the matching service function in lib/games.ts, and shapes the response —
 * all the logic worth testing lives there.
 *
 * Which seat a caller plays is never taken from the request: it comes from
 * the seats table, via the caller's verified identity.
 */

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined
}

export const createGameHandler = authed(async ({ request, context, identity }) => {
  const body = await readJsonBody(request)
  const kind = field(body, 'kind')
  if (!isGameKind(kind)) throw new BadRequestError('kind must be "two_player" or "four_player".')
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  await guardCreate(db, userId, limitSettings(), (m) => context.warn(m))
  return { status: 201, jsonBody: await createGame(db, userId, kind) }
})

export const joinGameHandler = authed(async ({ request, context, identity }) => {
  const body = await readJsonBody(request)
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  const game = await guardJoin(db, userId, limitSettings(), () => joinGame(db, userId, field(body, 'code')), (m) => context.warn(m))
  return { status: 200, jsonBody: game }
})

export const listGamesHandler = authed(async ({ identity }) => {
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  return { status: 200, jsonBody: { games: await listMyGames(db, userId) } }
})

export const getGameHandler = authed(async ({ request, identity }) => {
  const since = parseVersion(request.query.get('since'), 'since')
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  return { status: 200, jsonBody: await getGame(db, userId, request.params['id'] ?? '', since) }
})

/**
 * POST /api/v1/games/{id}/rematch — ask for a rematch of a finished two-player match. 201 for the first player to ask
 * (a new table was made), 200 for the second (they joined it) or for asking again. The limits apply: whoever makes the
 * new table counts as starting one, and whoever joins counts against the matches-in-play cap.
 */
export const rematchHandler = authed(async ({ request, context, identity }) => {
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  const settings = limitSettings()
  const log = (m: string) => context.warn(m)
  const result = await requestRematch(db, userId, request.params['id'] ?? '', {
    beforeCreate: (tx) => guardCreate(tx, userId, settings, log),
    beforeJoin: (tx) => (settings.enabled ? assertTableCaps(tx, userId, settings, 'join') : Promise.resolve()),
  })
  return { status: result.created ? 201 : 200, jsonBody: result }
})

export const leaveGameHandler = authed(async ({ request, identity }) => {
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  return { status: 200, jsonBody: await leaveWaitingTable(db, userId, request.params['id'] ?? '') }
})

export const submitMoveHandler = authed(async ({ request, context, identity }) => {
  const body = await readJsonBody(request)
  const expectedVersion = parseVersion(field(body, 'expectedVersion'), 'expectedVersion')
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  await guardMove(db, userId, limitSettings(), (m) => context.warn(m))
  const result = await submitMove(db, userId, request.params['id'] ?? '', field(body, 'intent'), expectedVersion)
  return { status: 200, jsonBody: result }
})

export const dealNextHandler = authed(async ({ request, identity }) => {
  const body = await readJsonBody(request, { optional: true })
  const expectedVersion = parseVersion(field(body, 'expectedVersion'), 'expectedVersion')
  const db = getDb()
  const userId = await resolveUserId(db, identity)
  const result = await dealNext(db, userId, request.params['id'] ?? '', expectedVersion)
  return { status: 200, jsonBody: result }
})

// "v1/join" rather than "v1/games/join": a literal segment next to the
// "{id}" route below is exactly the kind of overlap that is cheap to avoid.
app.http('games-create', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/games', handler: createGameHandler })
app.http('games-list', { methods: ['GET'], authLevel: 'anonymous', route: 'v1/games', handler: listGamesHandler })
app.http('games-join', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/join', handler: joinGameHandler })
app.http('games-get', { methods: ['GET'], authLevel: 'anonymous', route: 'v1/games/{id}', handler: getGameHandler })
app.http('games-rematch', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/games/{id}/rematch', handler: rematchHandler })
app.http('games-leave', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/games/{id}/leave', handler: leaveGameHandler })
app.http('games-move', { methods: ['POST'], authLevel: 'anonymous', route: 'v1/games/{id}/moves', handler: submitMoveHandler })
app.http('games-deal-next', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'v1/games/{id}/deal-next',
  handler: dealNextHandler,
})
