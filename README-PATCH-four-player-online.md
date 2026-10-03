# Four-player online

Four people can now play a four-player game of Seep over the internet, each on their own device.

## What a player sees
- **Play online** now has **Start a 4-player table** next to the two-player button, with a note that
  it needs four people.
- The creator gets the same code and link as before, and sends it to three people. The waiting
  screen shows **"2 of 4 seats filled"** and counts up as each person arrives. Everyone waiting sees
  it, plus a line such as "You are Player 3, on Team A".
- **Seats and partners are decided by join order**: the creator is Player 1, then Players 2, 3, 4 as
  they arrive. Partners sit across the table, so you play with the **third** person to join (Players
  1 and 3 are Team A; Players 2 and 4 are Team B). The game starts the moment the fourth person sits down.
- The game is the existing four-player page, turned so you are always at the bottom with your
  partner across from you. The status panel marks *your* team ("Team B (You & Partner)") and keeps the
  team names the same for all four players, so you can say "Team A is winning" and everyone knows.
- Every move pauses with the usual reveal, for everyone, attributed to the right seat.
- **The turn clock works as in two-player** (a warning at 1 minute, a forfeit at 2 in front of a
  witness), but it names who is on the clock ("Player 2's move", "Your partner's move") and
  says the **whole team** forfeits, with different wording when it is your own partner running out of time.
- A forfeit gives the match to the other team: both of them win, both of the other team lose.

## Decision: four people, no bots (for now)
A table needs four real people. A bot filling an empty seat would have to take its turns instantly
inside someone else's request (the server has no background process), so the other players would never
see those moves happen. That is a separate design, and nothing here prevents adding it later.

## A bug this found, and its fix (on the server)
Joining a seat only changed the game's version when it was the *last* seat. At a two-player table that is
the same thing, but at a four-player table the second and third arrivals changed nothing a poll could
see, so the creator's waiting screen stayed at "1 of 4" until the game started. My server tests checked
the version numbers but never asked whether the creator could *see* a partial arrival; the four-browser
test did. Now **every arrival moves the version**. No database migration is needed, but **the API must be
redeployed** for the seat count to update (the website works without it, but its waiting screen would not
count up).

## Apply
1. Copy the files in this zip over your repo.
2. `npm test && npm run lint && npm run build`
3. Commit and push. This deploys both the website and the API. Check the four-player page, the status
   panel and the online table files in `git diff`: they are full-file replacements of the last versions I
   delivered, so merge by hand if you have edited any of them.
4. Run the smoke test as before. With your API key it now plays a four-player table too (creating two more
   test accounts, `phase4-test-c@seep.quest` and `phase4-test-d@seep.quest`), and should end with
   **`PASS: 37 of 37 checks passed`** (it was 20; the four-player section adds 17):

       FIREBASE_API_KEY=<your apiKey> node projects/seep-api/scripts/live-smoke.mjs <your API url>

   This is also the first run of the changed join statement on Neon.

## Verified
- **489 tests across the repo** (35 files); lint clean with your exact toolchain; strict Angular compile clean;
  the deployable API bundle builds.
- **Four real browsers, one table (95 checks, no console or network errors)**: the lobby note; the seat
  count going 1, 2, 3 of 4 on the creator's screen by polling; each person's seat and team; the table
  turned correctly with the right partner across; the status panel marking each player's own team; only the
  bidder holding cards at first; ten consecutive moves, each seen by the other three and attributed to the
  right seat, with the turn passing through all four players; a refresh mid-game putting a player back in
  their own seat; the clock naming each player and telling a partner differently from an opponent; and a timed-out
  player's whole team losing while the other team wins, with the reason shown to all four.
- **The two-player journey still passes (52 checks)** through the shared table screen that was rewritten, and
  **both bot games are unchanged** in a real browser (four-player: three runs, bots at p2, p3, p4 taking consecutive turns).
- **Three deliberate breakages were each caught**: the old join behaviour restored (2 server tests fail),
  a four-player table given the two-player page, and the four-player page pinned to seat 1.
- New tests: the creator seeing every partial arrival; the four-player clock wording from several seats; the
  smoke script's four-player section, including failing when two of the four players are secretly the same person.

## NOT verified
- **Four real devices.** I tested four browsers; you have not yet had four people at a table.
- **The new join statement on Neon** until you run the smoke test above.
- **Google sign-in on four devices**, as before.

## Known limits
- If two or more other players move between one of your polls and the next, you see a reveal for the last
  of them only (your view of the table is always complete). With four people this is more likely than with two,
  though a person usually takes longer than the 2-second poll to move.
- Partners are whoever happens to join third; there is no way to choose or swap seats. A creator who wants a
  particular partner should send them the link third.
- Tables nobody returns to still never expire, and there are still no display names.
