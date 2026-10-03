#!/usr/bin/env node
/**
 * End-to-end smoke test for a running seep-api, from the outside, over HTTP:
 * two people sign in, one creates a game, the other joins with the code, they
 * look at their (different) views, one bids, and the other sees it.
 *
 * Simplest use: give it your Firebase web apiKey and it signs in (or creates)
 * two test accounts itself, so there is no shell juggling of tokens:
 *
 *   FIREBASE_API_KEY=<apiKey> node scripts/live-smoke.mjs https://<app>.azurewebsites.net
 *
 * Or supply tokens you already have:
 *
 *   TOKEN_A=<id token> TOKEN_B=<a different person's id token> node scripts/live-smoke.mjs <url>
 *
 * Optional: EMAIL_A, EMAIL_B, TEST_PASSWORD (defaults below), APP_VERSION.
 * Exits 0 if every check passed, 1 if any failed, 2 if it couldn't get started.
 * Creates one real game in whatever database the API points at; it is a
 * normal game and can simply be left or abandoned.
 */
const base = (process.argv[2] ?? '').replace(/\/+$/, '')
const API_KEY = process.env.FIREBASE_API_KEY
const IDENTITY = (process.env.IDENTITY_TOOLKIT_URL ?? 'https://identitytoolkit.googleapis.com').replace(/\/+$/, '')
const PASSWORD = process.env.TEST_PASSWORD ?? 'TestPassword123!' // lives in code, not on a command line: a "!" in a bash command line is history expansion
const EMAIL_A = process.env.EMAIL_A ?? 'phase3-test@seep.quest'
const EMAIL_B = process.env.EMAIL_B ?? 'phase4-test-b@seep.quest'

const usage = () => {
  console.error('Usage:\n  FIREBASE_API_KEY=<apiKey> node scripts/live-smoke.mjs <base url>\n  TOKEN_A=<id token> TOKEN_B=<id token> node scripts/live-smoke.mjs <base url>')
  process.exit(2)
}
if (!base) usage()
if ((!process.env.TOKEN_A || !process.env.TOKEN_B) && !API_KEY) usage()

const looksLikeJwt = (t) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t ?? '')

/** Signs in with email + password, creating the account the first time. Throws a readable error. */
async function tokenFor(email) {
  const call = async (action) => {
    const res = await fetch(`${IDENTITY}/v1/accounts:${action}?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    })
    const json = await res.json().catch(() => ({}))
    return { token: json.idToken, message: json.error?.message ?? `HTTP ${res.status}` }
  }
  const signedIn = await call('signInWithPassword')
  if (signedIn.token) return signedIn.token
  // A brand-new account reports either of these (which one depends on the project's settings).
  if (signedIn.message !== 'EMAIL_NOT_FOUND' && signedIn.message !== 'INVALID_LOGIN_CREDENTIALS') {
    throw new Error(`Firebase sign-in for ${email} failed: ${signedIn.message}`)
  }
  const created = await call('signUp')
  if (created.token) return created.token
  if (created.message === 'EMAIL_EXISTS') {
    throw new Error(`${email} already exists with a different password. Set TEST_PASSWORD to its password, or use EMAIL_A / EMAIL_B for other test accounts.`)
  }
  throw new Error(`Firebase could not create ${email}: ${created.message}`)
}

let TOKEN_A = process.env.TOKEN_A
let TOKEN_B = process.env.TOKEN_B
try {
  TOKEN_A ||= await tokenFor(EMAIL_A)
  TOKEN_B ||= await tokenFor(EMAIL_B)
} catch (err) {
  console.error(err.message)
  process.exit(2)
}
for (const [name, token] of [['TOKEN_A', TOKEN_A], ['TOKEN_B', TOKEN_B]]) {
  if (!looksLikeJwt(token)) {
    console.error(`${name} is not a Firebase ID token (got ${JSON.stringify(String(token).slice(0, 40))}). Check FIREBASE_API_KEY, or how the token was copied.`)
    process.exit(2)
  }
}

const FACE_VALUE = { Ace: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10, Jack: 11, Queen: 12, King: 13 }
let checks = 0
let failures = 0

async function api(token, method, path, body) {
  const headers = { 'content-type': 'application/json', 'x-app-version': process.env.APP_VERSION ?? '1.4.0' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // leave json null; the check below will show the raw text
  }
  return { status: res.status, json, text }
}

function check(label, ok, detail) {
  checks++
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : `  -> ${detail ?? ''}`}`)
  return ok
}

const cards = (view) => JSON.stringify(view)
const cardKey = (c) => `"face":"${c.face}"`

async function main() {
  console.log(`seep-api smoke test against ${base}\n`)

  for (const [who, token] of [['A', TOKEN_A], ['B', TOKEN_B]]) {
    const me = await api(token, 'POST', '/v1/me')
    check(`${who} signs in (POST /v1/me)`, me.status === 200 && me.json?.id, `${me.status} ${me.text.slice(0, 120)}`)
  }
  const nobody = await api(null, 'POST', '/v1/games', { kind: 'two_player' })
  check('a request with no token is refused (401)', nobody.status === 401, nobody.status)

  const created = await api(TOKEN_A, 'POST', '/v1/games', { kind: 'two_player' })
  if (!check('A creates a two-player game (201, with an invite code)', created.status === 201 && created.json?.inviteCode, `${created.status} ${created.text.slice(0, 160)}`)) return
  const { gameId, inviteCode } = created.json
  check('A is seated first and the game is waiting', created.json.seat === 'player' && created.json.status === 'waiting')

  const joined = await api(TOKEN_B, 'POST', '/v1/join', { code: inviteCode.toLowerCase() })
  if (!check('B joins with the code (any case) and the game starts', joined.status === 200 && joined.json?.status === 'active', `${joined.status} ${joined.text.slice(0, 160)}`)) return
  check('B took the other seat', joined.json.seat === 'opponent' && joined.json.version === 1)

  const viewA = await api(TOKEN_A, 'GET', `/v1/games/${gameId}`)
  const viewB = await api(TOKEN_B, 'GET', `/v1/games/${gameId}`)
  check('each player can read the game', viewA.status === 200 && viewB.status === 200)
  const a = viewA.json?.view
  const b = viewB.json?.view
  check('each sees their own seat as the viewer', a?.viewer === 'player' && b?.viewer === 'opponent')
  // Staged dealing: before the opening move only the bidder holds cards (their first four); everyone else is dealt after.
  check('only the bidder holds cards at this point (staged dealing), so the two views differ', (a?.myHand?.length > 0) !== (b?.myHand?.length > 0) && cards(a) !== cards(b))
  const leak = (mine, theirs) => (theirs?.myHand ?? []).some((c) => cards(mine).includes(`${cardKey(c)},"suit":"${c.suit}"`) || cards(mine).includes(`"suit":"${c.suit}","face":"${c.face}"`))
  check("A's view contains none of B's cards, and B's none of A's", !leak(a, b) && !leak(b, a))

  const moverIsA = a.turn === 'player'
  const [moverToken, moverView, otherToken] = moverIsA ? [TOKEN_A, a, TOKEN_B] : [TOKEN_B, b, TOKEN_A]
  const houseValues = moverView.myHand.map((c) => FACE_VALUE[c.face]).filter((v) => v >= 9 && v <= 13).sort((x, y) => x - y)
  if (!check('the bidder has a house value to bid', houseValues.length > 0)) return
  const bid = { type: 'bid', value: houseValues[0] }

  const moved = await api(moverToken, 'POST', `/v1/games/${gameId}/moves`, { intent: bid, expectedVersion: 1 })
  check('the bidder bids (version 1 -> 2)', moved.status === 200 && moved.json?.version === 2, `${moved.status} ${moved.text.slice(0, 160)}`)

  const poll = await api(otherToken, 'GET', `/v1/games/${gameId}?since=1`)
  check('the other player sees exactly that move on their next poll', poll.status === 200 && poll.json?.moves?.length === 1 && poll.json.moves[0].intent?.type === 'bid' && poll.json.moves[0].version === 2, `${poll.status} ${poll.text.slice(0, 160)}`)
  const quiet = await api(otherToken, 'GET', `/v1/games/${gameId}?since=2`)
  check('polling again from the latest version says nothing changed', quiet.json?.changed === false)

  const stale = await api(moverToken, 'POST', `/v1/games/${gameId}/moves`, { intent: bid, expectedVersion: 1 })
  check('replaying the same move from a stale view is refused (409, current version 2)', stale.status === 409 && stale.json?.currentVersion === 2, `${stale.status} ${stale.text.slice(0, 160)}`)
  const early = await api(otherToken, 'POST', `/v1/games/${gameId}/moves`, { intent: bid })
  check("moving out of turn is refused by the rules engine (422)", early.status === 422, `${early.status} ${early.text.slice(0, 160)}`)
  const junk = await api(moverToken, 'POST', `/v1/games/${gameId}/moves`, { intent: { type: 'capture' } })
  check('a malformed move is rejected before it reaches the game (400)', junk.status === 400, junk.status)

  const list = await api(TOKEN_A, 'GET', '/v1/games')
  check('the game appears in A\'s list', list.status === 200 && list.json?.games?.some((g) => g.gameId === gameId))
}

main()
  .catch((err) => {
    failures++
    console.error('Smoke test crashed:', err)
  })
  .finally(() => {
    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures} of ${checks} checks passed`)
    process.exit(failures === 0 ? 0 : 1)
  })
