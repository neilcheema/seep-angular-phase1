# Phase 4, slice 4b (part 1): the browser-side online client, with no visible change yet

Nothing a player sees changes in this patch. Bot games behave exactly as before.
What it adds is the tested plumbing the online screens will sit on, plus one
refactor of the existing pages that online play needs.

## Apply
1. Copy the files in this zip over your repo (all under `projects/seep-web/src/app/`).
2. From the repo root: `npm test && npm run lint && npm run build`
3. **Review `git diff` on the four page files** (`two-player.component.ts/.html`,
   `four-player.component.ts/.html`). They are full-file replacements of the last
   versions I delivered; if you have edited any of them yourself since, merge
   rather than overwrite. The change in each is small and the same: `runPlayerAction`
   and `onDealNext` are now async, there is a `busy` signal, and the action buttons
   gain `busy() ||` in their `[disabled]`.

## What changed in the existing code (4b-1)
- `GameSession.submit()` and `.dealNext()` now return a Promise (a refused move is a
  rejection instead of a throw). `startNewMatch()` moved off the interface onto the
  two Local sessions, since it only makes sense against bots.
- The pages ignore a second click while a move is in flight (`busy`).
- Local play is unchanged in timing: an `async` method with no `await` still runs
  synchronously up to its return, so state changes at the very instant of the call.

## What's new (inert until the screens use it)
- `api-types.ts`, `game-api.ts`: the server's JSON shapes, and `HttpApi`: bearer token
  and `X-App-Version` on every call, one retry with a refreshed token after a 401,
  server errors as `ApiError` (status, message, extra fields such as `currentVersion`).
- `perspective.ts`: presents a game from the viewer's side. For the two-player
  `'opponent'` seat it swaps the two players' roles, so the existing two-player
  page, which assumes it is `'player'`, works unmodified. (This replaces my earlier
  plan to make that page seat-aware; the real two-player `FloorItemComponent`, which
  hardcodes owner tags, is a file I have never seen, and the swap is exact for a
  symmetric two-seat game.)
- `poll-policy.ts`: how often to poll, set by how much change is expected (see below).
- `remote-session.ts`: a seat of a networked game behind the same `GameSession`
  interface. Loads once, then polls "anything since version N?", turns other
  players' moves into the same `lastMove` events a bot's moves produce, sends
  every move with the version it last saw, and explains failures in words fit to show.

## Polling cost, by design
Your Function App's free grant is 1,000,000 executions a month; one tab polling every
2 seconds all month would use about 1.3 million alone. So: 2s while another player is
about to move, backing off to 5s then 15s as nothing happens; 10s when it is the
viewer's own move; 3s while waiting for players to arrive; at least 15s in a background
tab; stopped when the game ends. These are design numbers, not measurements.

## Verified
- **77 web tests** (382 across the repo), stable over 12 consecutive runs under load.
- **Real client against the real server**: `remote-session.integration.test.ts` runs
  `RemoteSession`s against seep-api's own service layer on real Postgres, the network
  replaced by a JSON round-trip, on a fake clock. Complete two- and four-player
  matches, every seat learning of others' moves only by polling; at every step each
  session equals the server's truth, no hidden card reaches any client, each seat is
  told the right move, and polling stops when the match ends. Also: joining a table in
  progress, and a stale session being refused with the server's own 409 and caught up.
- **Existing pages, in a real browser**: both compiled with the Angular AOT compiler
  (strict templates) and driven through full move sequences (the four-player page for
  three consecutive bot turns, three runs); a double-click applies one bid; a refused
  move shows the engine's message and releases the busy flag.
- **30 deliberate sabotages of the new client code, all caught**, plus removing the
  page's double-click guard (caught by the browser test).
- **Lint with your exact toolchain** (angular-eslint 19.8.1, typescript-eslint 8.33.1,
  the standard Angular flat config incl. template accessibility): clean. It found two
  unused-variable errors in my own tests, now fixed.

## A real bug this work found and fixed
A poll sent just before the viewer's own final move could be answered just after it
("nothing new, version 1, still active"), and `RemoteSession` accepted that stale
answer, flipping a finished game back to active and re-arming polling. Snapshots were
already guarded against going backwards; "nothing new" answers were not. It showed up
as a failure in roughly one loaded integration run in six. Now guarded, with a
deterministic test that fails without the fix.

## NOT verified / not built yet
- **Nothing here talks to your live API yet**: there is no sign-in or lobby screen, and
  the Function App needs CORS configured before a browser can call it.
- The pages are not yet wired to `RemoteSession`. The four-player page's seat still
  has to follow `view.viewer` rather than a fixed seat.
- If several other players move between two polls (four-player), only the last gets a
  reveal; the view itself is always complete.
- Not yet wired: refreshing a session when a hidden tab becomes visible again
  (`refreshNow()` exists for it).
- The integration test imports seep-api's test helpers and service layer by relative
  path (`projects/seep-api/...`), so it needs both projects in the repo, as yours has.

## Next (4b part 2)
Firebase sign-in (lazy-loaded, so bot-only players' bundle doesn't grow), the API
wiring, a "Play online" lobby (create / join by code / resume), an invite link
(`/join/ABC123`), the online game screen with a "waiting for opponent" state, and the
landing-page entry. That needs: `landing.component.ts/.html`, a look at
`staticwebapp.config.json` if you have one (invite links need the SPA fallback), and
the CORS setting on the Function App.
