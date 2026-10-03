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
const IDENTITY = (process.env.IDENTITY_TOOLKIT_URL || 'https://identitytoolkit.googleapis.com').replace(/\/+$/, '')
const PASSWORD = process.env.TEST_PASSWORD || 'TestPassword123!' // lives in code, not on a command line: a "!" in a bash command line is history expansion
const EMAIL_A = process.env.EMAIL_A || 'phase3-test@seep.quest'
const EMAIL_B = process.env.EMAIL_B || 'phase4-test-b@seep.quest'
// Two more accounts, used only for the four-player section.
const EMAIL_C = process.env.EMAIL_C || 'phase4-test-c@seep.quest'
const EMAIL_D = process.env.EMAIL_D || 'phase4-test-d@seep.quest'

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

// With an API key the script fetches fresh tokens itself and ignores any TOKEN_A / TOKEN_B left in the
// environment: a reused terminal session can easily still hold stale or junk values from an earlier attempt.
let TOKEN_A = API_KEY ? undefined : process.env.TOKEN_A
let TOKEN_B = API_KEY ? undefined : process.env.TOKEN_B
// Optional: with these (or with an API key) the four-player section runs too.
let TOKEN_C = API_KEY ? undefined : process.env.TOKEN_C
let TOKEN_D = API_KEY ? undefined : process.env.TOKEN_D
if (API_KEY && (process.env.TOKEN_A || process.env.TOKEN_B)) {
  console.log('Note: ignoring TOKEN_A / TOKEN_B from the environment because FIREBASE_API_KEY is set; fetching fresh tokens.\n')
}
try {
  TOKEN_A ||= await tokenFor(EMAIL_A)
  TOKEN_B ||= await tokenFor(EMAIL_B)
  if (API_KEY) {
    TOKEN_C ||= await tokenFor(EMAIL_C)
    TOKEN_D ||= await tokenFor(EMAIL_D)
  }
} catch (err) {
  console.error(err.message)
  process.exit(2)
}
for (const [name, token] of [['TOKEN_A', TOKEN_A], ['TOKEN_B', TOKEN_B], ...(TOKEN_C || TOKEN_D ? [['TOKEN_C', TOKEN_C], ['TOKEN_D', TOKEN_D]] : [])]) {
  if (!looksLikeJwt(token)) {
    console.error(`${name} is not a Firebase ID token (got ${JSON.stringify(String(token).slice(0, 40))}). Check FIREBASE_API_KEY, or how the token was copied.`)
    process.exit(2)
  }
}

const FACE_VALUE = { Ace: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10, Jack: 11, Queen: 12, King: 13 }
let checks = 0
let failures = 0

async function api(token, method, path, body) {
  const headers = { 'content-type': 'application/json', 'x-app-version': process.env.APP_VERSION || '1.5.0' }
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
/** True if any card in `hand` appears anywhere in `view`. */
const viewShows = (view, hand) => hand.some((c) => cards(view).includes(`"face":"${c.face}","suit":"${c.suit}"`) || cards(view).includes(`"suit":"${c.suit}","face":"${c.face}"`))
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

  // The turn clock (needs migration 003): the player on the move is on the clock, with a warning before the forfeit.
  const clock = viewA.json?.clock
  check('the game reports a turn clock for the player on the move (migration 003 applied)', clock?.seat === a.turn && clock?.warnAfterMs > 0 && clock?.forfeitAfterMs > clock?.warnAfterMs && clock?.elapsedMs < 60_000, JSON.stringify(clock))

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

  if (TOKEN_C && TOKEN_D) await fourPlayerSection()
  else console.log('\n(four-player section skipped: it needs FIREBASE_API_KEY, or TOKEN_C and TOKEN_D as well)')
}

/**
 * A four-player table, end to end: four people take the four seats one at a time, the creator's screen has to
 * be told about each arrival (a waiting screen shows the seats filling), the game starts when the fourth sits
 * down, nobody can see anyone else's cards, the turn clock is reported, and the first bid reaches the others.
 */
async function fourPlayerSection() {
  console.log('\nfour-player table:')
  const tokens = { p1: TOKEN_A, p2: TOKEN_B, p3: TOKEN_C, p4: TOKEN_D }
  const created = await api(TOKEN_A, 'POST', '/v1/games', { kind: 'four_player' })
  if (!check('A creates a four-player table (201, seat p1, waiting)', created.status === 201 && created.json?.seat === 'p1' && created.json?.status === 'waiting', `${created.status} ${created.text.slice(0, 160)}`)) return
  const { gameId, inviteCode } = created.json

  let seen = 0
  for (const [seat, status, joined] of [['p2', 'waiting', 2], ['p3', 'waiting', 3], ['p4', 'active', 4]]) {
    const joinedRes = await api(tokens[seat], 'POST', '/v1/join', { code: inviteCode })
    check(`${seat} joins and takes seat ${seat} (${status})`, joinedRes.status === 200 && joinedRes.json?.seat === seat && joinedRes.json?.status === status, `${joinedRes.status} ${joinedRes.text.slice(0, 160)}`)
    const poll = await api(TOKEN_A, 'GET', `/v1/games/${gameId}?since=${seen}`)
    check(`the creator is told about that arrival (${joined} of 4 seats filled), even before the game starts`, poll.json?.changed === true && poll.json?.players?.filter((pl) => pl.joined).length === joined, `${poll.status} ${poll.text.slice(0, 160)}`)
    seen = poll.json?.version ?? seen
  }
  check('the game started when the fourth seat was taken (version 3)', seen === 3)

  const views = {}
  for (const seat of ['p1', 'p2', 'p3', 'p4']) views[seat] = (await api(tokens[seat], 'GET', `/v1/games/${gameId}`)).json
  check('each of the four sees themselves in their own seat', ['p1', 'p2', 'p3', 'p4'].every((seat) => views[seat]?.view?.viewer === seat && views[seat]?.seat === seat))
  const bidderSeat = views.p1.view.turn
  const bidderHand = views[bidderSeat].view.myHand
  check('only the bidder holds cards at this point (staged dealing)', ['p1', 'p2', 'p3', 'p4'].every((seat) => (views[seat].view.myHand.length > 0) === (seat === bidderSeat)))
  check("nobody else's view contains the bidder's cards", ['p1', 'p2', 'p3', 'p4'].filter((seat) => seat !== bidderSeat).every((seat) => !viewShows(views[seat].view, bidderHand)))
  const clock = views[bidderSeat].clock
  check('the turn clock is on the bidder', clock?.seat === bidderSeat && clock?.forfeitAfterMs > clock?.warnAfterMs, JSON.stringify(clock))

  const houseValues = bidderHand.map((c) => FACE_VALUE[c.face]).filter((v) => v >= 9 && v <= 13).sort((x, y) => x - y)
  if (!check('the bidder has a house value to bid', houseValues.length > 0)) return
  const moved = await api(tokens[bidderSeat], 'POST', `/v1/games/${gameId}/moves`, { intent: { type: 'bid', value: houseValues[0] }, expectedVersion: 3 })
  check('the bidder bids (version 3 -> 4)', moved.status === 200 && moved.json?.version === 4, `${moved.status} ${moved.text.slice(0, 160)}`)
  for (const seat of ['p1', 'p2', 'p3', 'p4'].filter((x) => x !== bidderSeat)) {
    const poll = await api(tokens[seat], 'GET', `/v1/games/${gameId}?since=3`)
    check(`${seat} sees exactly that bid on their next poll`, poll.json?.moves?.length === 1 && poll.json.moves[0].seat === bidderSeat && poll.json.moves[0].intent?.type === 'bid', `${poll.status} ${poll.text.slice(0, 160)}`)
  }
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
