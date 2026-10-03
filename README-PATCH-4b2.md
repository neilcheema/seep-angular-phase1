# Phase 4, slice 4b (part 2): Play online

Two people can now play a game of two-player Seep over the internet: sign in,
start a table, send an invite link, play. Bot games are unchanged.

## What a player sees
- Landing page: a third card, **Play online**.
- `/online`: sign in (Google, or email + password), **Start a 2-player table**, join by
  6-letter code, and a list of your tables to pick up where you left off.
- After starting a table: a waiting screen with the code, the link
  (`https://seep.quest/join/ABC234`), Copy and Share buttons. It turns into the game by
  itself when the opponent joins.
- `/join/ABC234`: the invite link. Signs you in if needed, then takes your seat.
- The game itself is the existing two-player page, so it looks and feels the same. Every
  move, including the other player's, pauses with the same reveal. "Waiting for the
  other player…" shows when it isn't your move; a banner appears if the connection drops.
- I also fixed the landing page's version footer, which printed literal backticks
  around `v1.4.0`.

## Before it works live: three settings only you can change
1. **Firebase console, Authentication, Sign-in method**: make sure **Google** and
   **Email/Password** are both enabled.
2. **Firebase console, Authentication, Settings, Authorized domains**: add
   `seep.quest` and `www.seep.quest`. Without this the Google sign-in window fails
   ("Sign-in isn't enabled for this web address yet"). `localhost` is there already.
3. **Azure Portal, seep-api Function App, API, CORS**: allow the origins
   `https://seep.quest`, `https://www.seep.quest` and `http://localhost:4200`, then Save.
   Without this the browser blocks every call to the API. (The test server in my
   verification refuses a preflight unless it is for exactly the three headers the
   client sends: `authorization`, `content-type`, `x-app-version`.)

Your `staticwebapp.config.json` already rewrites unknown paths to `index.html`, so invite
links survive a hard refresh; nothing to change there. `app.config.ts` is unchanged too:
the online pieces are root-provided injection tokens (`core/online.ts`).

## Apply
1. Copy the files in this zip over your repo.
2. `npm test && npm run lint && npm run build`
3. Commit and push. Check the `ng build` output: the initial bundle should be about the
   same as before. The online screens and the Firebase SDK are separate lazy chunks that
   only load when someone opens Play online. (In my build the SDK was one separate
   chunk and the main chunk contained none of it.)
4. Do the three settings above, then try it with two browsers.

## Verified
- **413 tests** across the repo (31 files); 0 failures in 6 further runs of the web suite.
- **Two real browsers, one table, the whole journey** (Playwright against the app's real
  routes, lazy loading and DI, talking to the real seep-api code on real Postgres; only
  the Firebase popup is faked): wrong-password message; create table; waiting screen polls
  about every 3s (not hammering the API); invite link opened cold and signed out, via the SPA
  fallback; sign-in takes the seat; the creator's waiting screen turns into the game by
  itself; a full table is refused with a clear message; seven consecutive moves, including
  captures, by both seats, each seen by the other browser and attributed correctly; resume
  from the lobby; refresh restores the table without replaying old moves; a dropped
  connection shows a banner and Retry clears it; sign-out; opening a table while signed out
  asks for sign-in. 43 checks, 3 consecutive full passes, zero console, network or page errors.
- **Two deliberate breakages of that wiring were each caught by the journey** (invite link
  no longer takes the seat; the page ignores the online session it is given).
- **Bot game regression**: the two-player page, compiled with the real Angular compiler
  (strict templates) and driven in a browser in local mode, behaves exactly as before.
- **Lint with your exact toolchain** (angular-eslint 19.8.1, typescript-eslint 8.33.1, standard
  Angular flat config incl. template accessibility): clean.
- **Firebase wrapper type-checks against the real firebase 12.19.0** (your version) and is
  unit-tested against a fake SDK (init once, saved sign-in restored, listeners, each sign-in
  method, token refresh, errors passed through).
- The Angular compiler caught two template mistakes of mine along the way
  (`@else if (...; as x)` isn't allowed in Angular 19); both fixed.

## NOT verified
- **Real Firebase.** I cannot reach it from here. The Google popup in particular is
  untested, including on iPhone Safari, where popups are fussier. Email + password is the
  dependable path; if Google misbehaves there, tell me what Safari shows.
- **Real Azure CORS and the real deploy.** My test server mimics the preflight rule, but
  the platform setting is yours to confirm.
- **Anything with four players.** The server supports it and a session test covers it, but
  the four-player *page* still pins you to seat P1, so the lobby only offers two-player.
- Polling cost figures are design estimates, not measurements.

## Known gaps (none block a first try)
- No way to leave or forfeit a table yet, so abandoned tables stay in "Your tables" (the
  list shows the 20 most recently active). Needs your turn-timer and forfeit decision.
- If both players click "Deal next hand" at once, one sees a short "hand has not finished" message.
- Players are anonymous ("the other player"); nothing sets a display name yet.
- "Play again" online returns you to the lobby; a new table is a new game.
- `APP_VERSION` is still 1.4.0; bump it if you want this release tagged.
