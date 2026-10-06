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

/**
 * A brand-new email-and-password account that has NOT confirmed its address (creating one through this call sends no email).
 * Returns its token and a function that deletes it again, so the check that uses it leaves nothing behind in Firebase.
 */
async function throwawayAccount() {
  const email = `smoke-unverified-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const post = async (action, body) => {
    const res = await fetch(`${IDENTITY}/v1/accounts:${action}?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, json: await res.json().catch(() => ({})) }
  }
  const made = await post('signUp', { email, password: PASSWORD, returnSecureToken: true })
  if (!made.json.idToken) throw new Error(`Firebase could not create the throwaway account: ${made.json.error?.message ?? 'unknown error'}`)
  return {
    token: made.json.idToken,
    remove: async () => {
      const gone = await post('delete', { idToken: made.json.idToken })
      if (!gone.ok) console.log(`  (warning: could not delete the throwaway account ${email}; delete it in the Firebase console)`)
    },
  }
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
// Set when a join was refused because an account is already in the maximum number of active matches (see matchLimitExplanation below).
let hitMatchLimit = false
/** The accounts this run signed in with. The clean-up SQL printed on a limit failure only ever touches matches made by these. */
const smokeEmails = new Set()
const isMatchLimit = (res) => res.status === 409 && /already playing \d+ matches/.test(res.text)
/** Notes (and remembers) that a refused join was the match limit, for the detail of a failed check. Empty for any other response. */
const limitNote = (res) => (isMatchLimit(res) ? ((hitMatchLimit = true), '  <- this account is at its limit of active matches: see the explanation at the end') : '')

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

/**
 * Printed when a join was refused because a test account is already in the maximum number of active matches (20 by default). It is not a bug:
 * every run of this script leaves the matches it starts open (about two a run), and nothing in the app lets a player end a match early, so the
 * test accounts slowly fill up. The SQL only touches matches in which EVERY human player is one of the accounts this run used.
 */
function matchLimitExplanation() {
  const emails = [...new Set([...smokeEmails, ...(API_KEY ? [EMAIL_C, EMAIL_D] : [])])]
  const list = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(', ')
  const smokeOnly = `bool_and(u.email IN (${list}))`
  const bar = '-'.repeat(110)
  return `
${bar}
THIS IS NOT A BUG IN THE APP. A player can be in at most 20 active matches, and a smoke-test account has reached that limit: each run of this
script leaves the matches it starts open (about two a run), and nothing in the app lets a player end a match early. The daily cleanup closes
them by itself after 7 idle days (by default). To clear them now, run the SQL below in the Neon SQL editor on the PRODUCTION branch.
Run STEP 1 first and check that every row is a smoke-test match. Only then run STEP 2. Then run this script again.
It only touches matches in which EVERY human player is one of: ${emails.join(', ')}.${API_KEY ? '' : ' If you also use TOKEN_C and TOKEN_D, add their emails to both lists.'}

-- STEP 1: preview
SELECT g.id, g.created_at, count(*) AS humans
FROM games g
JOIN seats s ON s.game_id = g.id AND s.user_id IS NOT NULL
JOIN users u ON u.id = s.user_id
WHERE g.status = 'active'
GROUP BY g.id, g.created_at
HAVING ${smokeOnly}
ORDER BY g.created_at;

-- STEP 2: close them (the same change the daily cleanup makes)
UPDATE games SET status = 'abandoned', version = version + 1, updated_at = now()
WHERE id IN (
  SELECT g.id FROM games g
  JOIN seats s ON s.game_id = g.id AND s.user_id IS NOT NULL
  JOIN users u ON u.id = s.user_id
  WHERE g.status = 'active'
  GROUP BY g.id
  HAVING ${smokeOnly}
);
${bar}`
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
    if (me.json?.email) smokeEmails.add(me.json.email)
    check(
      `${who} signs in (POST /v1/me)`,
      me.status === 200 && me.json?.id,
      me.json?.code === 'email_not_verified'
        ? `refused because this account is new and has not confirmed its email. On a fresh database, set REQUIRE_VERIFIED_EMAIL=false on the Function App for the first run, or use accounts that already exist. (${me.status})`
        : `${me.status} ${me.text.slice(0, 120)}`,
    )
  }
  // A brand-new account that has not confirmed its email address must be refused (the rule in lib/users.ts). A throwaway account is
  // made in Firebase for this and deleted straight afterwards. This fails against an API from before the rule, and when the Function App
  // setting REQUIRE_VERIFIED_EMAIL is "false", which is the point: it tells you the rule is switched off.
  if (API_KEY) {
    let throwaway = null
    try {
      throwaway = await throwawayAccount()
    } catch (err) {
      check('a throwaway unconfirmed account could be created for the check', false, err.message)
    }
    if (throwaway) {
      try {
        const refused = await api(throwaway.token, 'POST', '/v1/me')
        check(
          'a brand-new account that has not confirmed its email is refused (403, code email_not_verified)',
          refused.status === 403 && refused.json?.code === 'email_not_verified',
          `${refused.status} ${refused.text.slice(0, 120)} (if REQUIRE_VERIFIED_EMAIL is "false" on the Function App, this fails on purpose: the rule is switched off)`,
        )
      } finally {
        await throwaway.remove()
      }
    }
  } else {
    console.log('  (unverified-account check skipped: it needs FIREBASE_API_KEY, to create a throwaway account)')
  }
  // A name is chosen through the same call, so this runs the real upsert on the real database: the name is saved, a bad one
  // is refused without changing it, and the next plain sign-in (which sends no name) must not erase it.
  // Names are unique across the site, so if "Smoke A" already belongs to a DIFFERENT account (say you switched which account plays A), the
  // server refuses it and offers free alternatives: take the first one. That is also the real suggestion flow, run live.
  let nameA = 'Smoke A'
  let named = await api(TOKEN_A, 'POST', '/v1/me', { displayName: nameA })
  if (named.status === 409 && named.json?.code === 'name_taken' && named.json.suggestions?.length > 0) {
    nameA = named.json.suggestions[0]
    named = await api(TOKEN_A, 'POST', '/v1/me', { displayName: nameA })
  }
  check('A chooses a display name', named.status === 200 && named.json?.displayName === nameA, `${named.status} ${named.text.slice(0, 120)}`)
  // Display names are unique: B cannot take A's name even written differently (case, spaces and . - _ ' are ignored: "Smoke A" and "smoke_a" are one name). The server refuses (409,
  // code name_taken) and offers free alternatives. An API from before unique names accepts it (200), so this fails there on purpose.
  const taken = await api(TOKEN_B, 'POST', '/v1/me', { displayName: nameA.toLowerCase().replace(/ /g, '_') })
  check(
    'someone else taking A’s name, written differently, is refused (409, name_taken) and offered free alternatives',
    taken.status === 409 && taken.json?.code === 'name_taken' && Array.isArray(taken.json?.suggestions) && taken.json.suggestions.length > 0,
    `${taken.status} ${taken.text.slice(0, 160)}`,
  )
  const badName = await api(TOKEN_A, 'POST', '/v1/me', { displayName: '<b>x</b>' })
  check('a display name with markup is refused (400)', badName.status === 400, `${badName.status} ${badName.text.slice(0, 120)}`)
  const signedInAgain = await api(TOKEN_A, 'POST', '/v1/me')
  check('signing in again, with no name sent, keeps the chosen name', signedInAgain.json?.displayName === nameA, `${signedInAgain.status} ${signedInAgain.text.slice(0, 120)}`)

  const nobody = await api(null, 'POST', '/v1/games', { kind: 'two_player' })
  check('a request with no token is refused (401)', nobody.status === 401, nobody.status)

  // Health: the plain check needs no sign-in and never touches the database; the deep one also confirms every migration
  // has been run, so a forgotten migration shows up here and not as a mysterious failure later.
  const health = await api(null, 'GET', '/v1/health')
  check('the health check answers without signing in', health.status === 200 && health.json?.status === 'ok', `${health.status} ${health.text.slice(0, 120)}`)
  const deep = await api(null, 'GET', '/v1/health?deep=1')
  check('the deep health check confirms the database and every migration (schema ok)', deep.status === 200 && deep.json?.schema === 'ok', `${deep.status} ${deep.text.slice(0, 120)}`)

  // Leaving a table that is still waiting: a throwaway table, closed again straight away.
  const spare = await api(TOKEN_A, 'POST', '/v1/games', { kind: 'two_player' })
  if (check('A starts a throwaway table to leave again (201)', spare.status === 201 && spare.json?.gameId, `${spare.status} ${spare.text.slice(0, 160)}`)) {
    const left = await api(TOKEN_A, 'POST', `/v1/games/${spare.json.gameId}/leave`)
    check('A leaves it: a table with nobody else at it is closed', left.status === 200 && left.json?.result === 'closed', `${left.status} ${left.text.slice(0, 120)}`)
    const again = await api(TOKEN_A, 'POST', `/v1/games/${spare.json.gameId}/leave`)
    check('leaving it a second time is a 404 (no longer seated there)', again.status === 404, `${again.status} ${again.text.slice(0, 120)}`)
  }

  const created = await api(TOKEN_A, 'POST', '/v1/games', { kind: 'two_player' })
  if (!check('A creates a two-player game (201, with an invite code)', created.status === 201 && created.json?.inviteCode, `${created.status} ${created.text.slice(0, 160)}`)) return
  const { gameId, inviteCode } = created.json
  check('A is seated first and the game is waiting', created.json.seat === 'player' && created.json.status === 'waiting')

  const joined = await api(TOKEN_B, 'POST', '/v1/join', { code: inviteCode.toLowerCase() })
  if (!check('B joins with the code (any case) and the game starts', joined.status === 200 && joined.json?.status === 'active', `${joined.status} ${joined.text.slice(0, 160)}${limitNote(joined)}`)) return
  check('B took the other seat', joined.json.seat === 'opponent' && joined.json.version === 1)

  const viewA = await api(TOKEN_A, 'GET', `/v1/games/${gameId}`)
  const viewB = await api(TOKEN_B, 'GET', `/v1/games/${gameId}`)
  check('each player can read the game', viewA.status === 200 && viewB.status === 200)
  const a = viewA.json?.view
  const b = viewB.json?.view
  check('each sees their own seat as the viewer', a?.viewer === 'player' && b?.viewer === 'opponent')
  check("the other player sees A's name in the table's player list", viewB.json?.players?.find((pl) => pl.seat === 'player')?.displayName === nameA, JSON.stringify(viewB.json?.players))
  // The poll now carries the rematch pointer (empty while the match is on). An older API has no such field at all.
  check('the poll carries the rematch field, empty while the match is still on', viewA.json?.rematchGameId === null, `rematchGameId = ${JSON.stringify(viewA.json?.rematchGameId)}`)
  // The finished-hands history that the results screen itemises: a list in every player's view, empty until a hand ends. An
  // API from before it existed sends no such field, so this fails there on purpose.
  check('each view carries the hand-by-hand history, empty until a hand has finished', Array.isArray(viewA.json?.view?.handHistory) && viewA.json.view.handHistory.length === 0 && Array.isArray(viewB.json?.view?.handHistory), JSON.stringify(viewA.json?.view?.handHistory))
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

  // A rematch can only be asked for once a match is over, so asking now must be refused with this exact 409. That proves the
  // rematch route is deployed (an older API answers 404) and that its database column exists (a missing one would be a 500).
  const rematchEarly = await api(TOKEN_A, 'POST', `/v1/games/${gameId}/rematch`)
  check('asking for a rematch while the match is still on is refused (409): the rematch route and its column are live', rematchEarly.status === 409 && /once the match is over/.test(rematchEarly.json?.error ?? ''), `${rematchEarly.status} ${rematchEarly.text.slice(0, 140)}`)

  // Quick reactions: preset codes only, heard by the other player on a poll. An API from before they existed has no such route
  // (404) and its poll carries no reactionSeq, so these fail there on purpose.
  const sentReaction = await api(TOKEN_A, 'POST', `/v1/games/${gameId}/reactions`, { code: 'good_luck', to: 'opponent' })
  check('A sends a quick reaction to the match, addressed to the other player (200, with its number)', sentReaction.status === 200 && typeof sentReaction.json?.seq === 'number', `${sentReaction.status} ${sentReaction.text.slice(0, 120)}`)
  const freeText = await api(TOKEN_A, 'POST', `/v1/games/${gameId}/reactions`, { code: 'free text is not allowed' })
  check('anything but a preset reaction is refused (400)', freeText.status === 400, `${freeText.status} ${freeText.text.slice(0, 120)}`)
  const heardIt = await api(TOKEN_B, 'GET', `/v1/games/${gameId}?sinceReaction=0`)
  check('the other player hears it on their next poll, from the right seat', heardIt.json?.reactions?.some((r) => r.code === 'good_luck' && r.seat === 'player') === true && heardIt.json?.reactionSeq >= 1, JSON.stringify(heardIt.json?.reactions))
  // A reaction can be addressed to the other player: everyone still receives it, and the poll says who it was for. A made-up recipient is
  // refused (400). An API from before addressing existed ignores the address, so these fail there on purpose. (Each run makes THREE reaction
  // attempts: the default allowance is 6 a minute, so running this script more than twice within a minute can trip the limit.)
  const bogusAddress = await api(TOKEN_A, 'POST', `/v1/games/${gameId}/reactions`, { code: 'nice_move', to: 'nobody-at-this-table' })
  check('a reaction addressed to someone who is not at the table is refused (400)', bogusAddress.status === 400, `${bogusAddress.status} ${bogusAddress.text.slice(0, 120)}`)
  check('the poll says who the reaction was for', heardIt.json?.reactions?.some((r) => r.code === 'good_luck' && r.to === 'opponent') === true, JSON.stringify(heardIt.json?.reactions))

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
    check(`${seat} joins and takes seat ${seat} (${status})`, joinedRes.status === 200 && joinedRes.json?.seat === seat && joinedRes.json?.status === status, `${joinedRes.status} ${joinedRes.text.slice(0, 160)}${limitNote(joinedRes)}`)
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
    if (hitMatchLimit) console.log(matchLimitExplanation())
    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures} of ${checks} checks passed`)
    process.exit(failures === 0 ? 0 : 1)
  })
