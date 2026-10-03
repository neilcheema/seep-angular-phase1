# Phase 4, slice 4a: the game-hosting API

The server side of online play, for two-player and four-player games: create
a table, join it by invite code, poll for changes, submit moves, deal the next
hand. The rules still live only in `seep-engine`; this layer decides who may do
what and when, then asks the engine whether the move itself is legal. Nothing
in the Angular app changes in this patch.

## Apply — the ORDER matters

1. **Run the migration first**, on both Neon branches (production, then dev), in
   the SQL Editor: paste `projects/seep-api/db/002_phase4_games.sql`. It is safe
   to run twice. (`001_phase3_schema.sql` is the file you already ran, kept in
   the repo so the tests build the database from the real files. Do not re-run it.)
2. Copy the files in this zip over your repo.
3. `cd projects/seep-api && npm install` (one new dev-only dependency,
   `@electric-sql/pglite`, used by the tests), then from the repo root:
   `npm test && npm run lint && npm run build`
4. Commit and push to `main`. The deploy workflow now also fires when
   `projects/seep-engine/**` changes, because the engine is compiled into the API.
5. **Prove it live** with the smoke test (below). Until you have, treat the
   deployment as untested.

If you push before step 1, only the new game endpoints fail; `POST /v1/me` is
unaffected.

## Prove it live: one command

Get a token for two different test accounts (tokens last an hour; keep them out
of chat). `FIREBASE_API_KEY` is the `apiKey` from your Firebase web config.

    export FIREBASE_API_KEY=<your apiKey>
    tok() { curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:$1?key=$FIREBASE_API_KEY" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$2\",\"password\":\"TestPassword123!\",\"returnSecureToken\":true}" \
      | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).idToken))"; }
    export TOKEN_A=$(tok signInWithPassword phase3-test@seep.quest)   # the account from phase 3
    export TOKEN_B=$(tok signUp phase4-test-b@seep.quest)             # a second one (use signInWithPassword next time)
    node projects/seep-api/scripts/live-smoke.mjs https://<your-function-app>.azurewebsites.net

It signs both people in, creates a game, joins it by code, checks each sees only
their own cards, makes a bid, polls, and checks that a stale move, an out-of-turn
move and a malformed move are each refused. It prints one line per check and
exits non-zero on any failure. It leaves one ordinary game in the database.

## API (all under `/api`)

Every request needs `Authorization: Bearer <Firebase ID token>`; send
`X-App-Version` and a client below `MIN_CLIENT_VERSION` gets 426. A caller's
seat is never taken from the request; it comes from the seats table.

| Method and path | Body / query | Success | Refusals |
|---|---|---|---|
| `POST /v1/me` | none | 200 profile | 401, 426 |
| `POST /v1/games` | `{kind: "two_player"\|"four_player"}` | 201 game info incl. `inviteCode`, your `seat` | 400 |
| `POST /v1/join` | `{code}` (any case) | 200 game info; game starts when the last seat fills | 400 bad code, 404 unknown, 409 not open |
| `GET /v1/games` | none | 200 `{games: [...]}` your unfinished games | |
| `GET /v1/games/{id}?since=N` | `since` optional | `{changed:false, version}` if nothing new, else your redacted `view`, `players`, and the `moves` after N | 404 not yours / unknown |
| `POST /v1/games/{id}/moves` | `{intent, expectedVersion?}` | 200 `{version, status, seat, view}` | 400 malformed, 409 stale (`currentVersion`) / not started / over, 422 the engine's own reason |
| `POST /v1/games/{id}/deal-next` | `{expectedVersion?}` optional | 200, same shape as a move | 409, 422 hand not finished |

Intents are the engine's five shapes: `bid`, `capture`, `build`, `modify`, `throw`.
`moves[].intent` for a dealt hand is `{"type":"deal-next"}`. A game is `waiting`,
`active`, `finished` or `abandoned` (nothing sets the last yet).

## What was verified, and how

- **134 API tests** (11 files; 298 with the engine's, run from the repo root as
  `npm test` does), stable across repeated runs with fresh random deals.
- **Real Postgres, not mocks.** The tests run the actual migration files and SQL
  on PGlite (Postgres compiled to WASM): constraints, unique violations,
  JSONB, `RETURNING`, transactions, rollback.
- **Whole matches through the server**, two- and four-player, each move submitted
  by the user holding that seat; at every step, no view contains a hidden card
  (other hands or undealt cards), and at the end the version counter and the
  move log account for every change with no gaps. The simulation is forced to
  include hand-to-hand dealing (about a third of AI matches end after one hand).
- **16 deliberate sabotages, all caught**: seat check removed, version guard
  removed, stale-client check removed, redaction removed, log perspective swap
  removed, a swallowed log-write failure, validation skipped, finished games not
  marked finished, invite-code collisions undetected, joins not starting the game,
  moves logged without versions, polling never short-circuiting, joining a started
  game, engine errors leaking as 500s, auth failure not stopping a request,
  deal-next allowed mid-hand.
- **The built bundle**, loaded in plain Node against a stubbed Functions runtime:
  engine compiled in, only `@azure/functions` and `node:crypto` required at
  runtime, all 7 routes register, each handler refuses an unauthenticated call.
- **`scripts/live-smoke.mjs` is itself tested**: it passes against the real
  handlers over HTTP, fails (exit 1) when the API misbehaves, exits 2 without tokens.
- **Strict `tsc`**, the stricter unused-code pass, and ESLint with
  typescript-eslint's recommended + stylistic rules. That last one only
  approximates your config (I have never seen the real file); it flagged one
  style error in my own test file, which is fixed, and does flag last time's
  unused-`_context` mistake when planted.

## What was NOT verified

- **Anything against live Neon.** Transactions use `pool.connect()` with explicit
  BEGIN/COMMIT. `/me` (plain `pool.query`) is proven live over the same driver
  and WebSocket transport, but transactions have not run there. The smoke test
  is the first real proof. If it fails, expect a 500 on create/join/move, with
  the driver's error in Application Insights.
- **Real Postgres lock contention.** PGlite is one connection, so overlapping
  transactions can't truly race. The logic is tested (a lost race is simulated
  and refused with full rollback), but `FOR UPDATE` behaviour under real
  concurrency is Postgres's, not demonstrated here.
- **The Azure host's own router** for the 7 routes (tests check what is
  registered and that no two collide).
- **Your exact lint config.**

## Known gaps, deliberately left for later

- No timers, forfeit or abandonment: a game whose players walk away stays
  `active` forever. (Needs your turn-timer and forfeit decision, planning §9.)
- No bots in online games: a four-player table needs four humans.
- No display names: players show only as seats; nothing sets `users.display_name`.
- The server applies the *current* engine to every game; `engine_version` is
  recorded but there is no policy yet for a game dealt under older rules.

## Carried into slice 4b (the browser client)

1. **`GameSession.submit()` is synchronous.** `RemoteSession` must be async, so
   the interface and both pages' action handling change.
2. **The two-player page hardcodes `'player'` as "me"** (turn checks, labels,
   session creation, floor-item owner tags). A joiner is seated `'opponent'`.
   It needs the seat-awareness the four-player page already has.
3. **CORS** must be configured on the Function App for seep.quest and
   localhost:4200 before a browser can call the API.
4. **Opponent reveals**: a page rebuilds "what just happened" from its previous
   view, the new view and the `moves` list. Fine for two-player (moves strictly
   alternate); four-player can skip over several moves between polls.
5. The 2P AI is written to play only the `'opponent'` seat, which will matter
   for "absent seat becomes a bot".
6. The engine's 2P log is phrased from the `'player'` side. The server rephrases
   it for the other seat (`swapLogPerspective`), guarded by a test that fails if
   the engine ever starts writing "Your ..." into the log.

## Files

New: `projects/seep-api/db/*`, `scripts/live-smoke.mjs`, `src/lib/{engines,games,http,intents,invite-code,users,errors}.ts`,
`src/functions/games.ts`, and the new tests. Changed: `src/lib/db.ts` (now a small
interface with a Neon implementation), `src/functions/me.ts` (same behaviour, on
the shared front door), `src/__tests__/me.test.ts` (rewritten on real Postgres),
`src/index.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`,
`.funcignore`, the root `vitest.config.ts` (longer timeouts for the Postgres tests),
and `.github/workflows/deploy-seep-api.yml`.
