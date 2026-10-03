# Phase 4: the turn clock (1 minute to move, forfeit at 2)

## Your numbers, and one change to how they work
One minute per move with a forfeit at two is a sensible, fairly brisk pace for friends. The risk is
not the numbers but a plain "two minutes and you lose": the server has no background clock (it only
acts when someone asks), so a plain rule would punish people for things that are not their fault.
Two friends both close their laptops mid-match; next day whoever reopens the game first finds a
long match "forfeited". So, keeping your numbers:

- **The clock belongs to whoever has to move** (bidding, opening move, play). It starts when the
  previous move lands, or when the opponent joins. It does not run between hands, or while a table
  is waiting for an opponent.
- **At 1:00** both players see a warning: "Out of time! Move within 1:00 or you forfeit the match"
  / "They are out of time. They forfeit the match in 1:00". Nothing else happens at one minute
  (no bot takes over).
- **At 2:00 the mover forfeits the match**, but only when it is decided **in front of a witness**:
  at the moment the *waiting* player's screen checks in, and only if that player had been seen in
  the last minute. If they had been away, nobody loses: the mover's clock restarts when they return.
  Being offline never costs anyone a match.
- A forfeit ends the match: the other player wins ("You won the bazzi!"), and both screens say why.
- A mover who is late but moves before the waiting player's next check (a second or two) simply moves.

Tuning: set `TURN_WARN_SECONDS` and `TURN_FORFEIT_SECONDS` as Application Settings on the
Function App (no redeploy). A bad value falls back to the default, and the forfeit can never come
before the warning.

## Apply: the ORDER matters
1. **Run `projects/seep-api/db/003_phase4_turn_clock.sql` in the Neon SQL editor, on production and
   then dev** (safe to run twice). *The new API reads the new columns: if it is deployed first,
   every game endpoint fails.*
2. From the repo root: `git apply engine-forfeit.patch` (adds two small functions to the engine,
   23 lines, nothing removed; it applies cleanly to the engine files as of my last delivery). If it
   refuses because you have edited those files, the two blocks are `forfeitMatch` (after
   `dealNextHand` in `gameEngine.ts`) and `forfeitFourPlayerMatch` (after `dealNextFourPlayerHand` in
   `fourPlayerEngine.ts`); the patch shows exactly what they are.
3. Copy the rest of the files in this zip over your repo.
4. `npm test && npm run lint && npm run build`, then commit and push.
5. Prove it live: `FIREBASE_API_KEY=... node projects/seep-api/scripts/live-smoke.mjs <your API url>`.
   It now has a 20th check, "the game reports a turn clock (migration 003 applied)", which fails
   clearly if step 1 was skipped.

The website tolerates an API that does not have the clock yet, so the two can be deployed in either order.

**To try a forfeit without waiting two minutes:** temporarily set `TURN_WARN_SECONDS=15` and
`TURN_FORFEIT_SECONDS=30` on the Function App, play with two devices, stop moving on one, keep the
other open, and remove the settings afterwards.

## Verified
- **479 tests across the repo** (35 files); lint clean with your exact toolchain for all three projects;
  strict Angular compile clean; the deployable API bundle builds; the bot game is unchanged in a real browser.
- **The rules, at their boundaries, against real Postgres**: 119 seconds does nothing; 121 forfeits; a
  present witness is required; a waiting player who had been away (or never seen) restarts the clock
  instead; the mover's own requests never forfeit them; a late move that arrives first is accepted;
  a move landing during the decision cancels it (re-checked under the lock); no clock at "hand over"
  or while waiting; every move, deal and join restarts it; polling does not become a database write per
  request; four-player tables use the same clock; bad settings fall back safely.
- **The clock through the real client and server**: two live sessions are told of the clock, a
  forfeit reaches both screens without being mistaken for a move, polling stops, and a returning
  player's restart reaches the mover without any move being made.
- **Two real browsers** (now 52 checks, three clean runs, no console or network errors): the countdowns
  on both screens; the away-player restart; the warning at one minute; the forfeit at two with the right
  winner and message on each screen; the clock disappearing afterwards.
- **23 deliberate breakages of the clock** (15 on the server, 8 on the client) **plus the screen wiring
  were all caught by the tests**.

## NOT verified
- **Real Neon and your real Function App.** The SQL is exercised on real Postgres (PGlite) but not on Neon.
- **The countdown is as fresh as the last poll.** It counts down locally between polls (so it can be
  off by a few seconds from the server's view), but the forfeit itself is always decided by the server.

## Known limits (deliberate, or not yet done)
- A forfeit needs the waiting player's screen open. If both players have gone, nothing happens until
  someone returns, and then the clock restarts, never a surprise loss.
- Nothing ends a table that nobody returns to: tables waiting for an opponent, or sitting at "Deal next
  hand", stay in "Your tables" (the 20 most recently active). A tidy-up after, say, a week is the natural
  next step.
- Four-player tables have the clock on the server, but the lobby still only offers two-player.
