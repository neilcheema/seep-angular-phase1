# Phase 5, slice 5d (part 4): the full results screen

When a match ends, the screen now shows the final scores, who won and by how much, and a **hand-by-hand table** showing how every hand was scored.
It works for a two-player match against a person, a two-player match against the computer, and a four-player team match.

## READ THIS FIRST: deploy BOTH the API and the website
- **No database migration.** Nothing to run in Neon.
- The engine now records each finished hand (`handHistory`). The engine is built into **both** the API and the website, so for an online match to show the
  table, **the API must be deployed with this change** (it records the hands), and the website must be deployed too (it draws them).
- If the website goes out before the API, online matches still work, but their results show all the points as one "Earlier" row with no hands itemised,
  until the API catches up. Matches against the computer itemise straight away.
- Then run the smoke script from this zip: **52 of 52** (it was 51). The new check fails against an API without the history, so it tells you whether the
  API half is live.

## What players see
- **Final scores**, the winner's box highlighted, and "Won by N points." Names are used (and "Team A (your team)" with who is on each team at a four-player table).
- **Hand by hand:** each row shows the hand number, what each side scored and how ("62 cards", "80 cards + 50 sweep"), and the match score after the hand.
- **The 9-point minimum is visible:** a side that took card points but fewer than 9 shows "7 cards (under 9, none count)" and scores 0 for them.
- **A match that ended early** (someone left or ran out of time) says so and why ("Bob ran out of time and forfeited the match."), and shows the scores as they
  stood. If no hand had finished it says "No hand was completed." instead of an empty table.
- A summary line: hands itemised, hands won by each side, and sweep points.
- The Rematch / Join rematch / Back / Play again buttons are unchanged, below the results.

## How it works
- **Engine (additive):** `GameState.handHistory` is a list of what each side scored in every finished hand, carried from hand to hand for both table sizes and
  included in every view. It only RECORDS what happened and changes no rule, so the engine version is not bumped. Two-player seats are recorded from the 'player'
  side like everything else, and the opponent's seat is mirrored by the website (the history is swapped along with the scores).
- **Matches already under way when this is deployed** have hands that were never recorded. Rather than guess, the table shows the gap as one honest row,
  "Earlier" (the points from hands that could not be itemised), and the running score starts from there. Everything after is itemised.
- **An old API** that sends no history is treated as an empty list.

## Verified
- **857 tests across the repo** (176 engine, 430 API, 251 web), **none skipped**; lint clean (your exact toolchain); strict Angular compile clean (against
  the current engine); the API bundle builds.
- **History is right, hand after hand:** whole matches played by the computer at both table sizes check, after EVERY hand, that there is one record per hand,
  the newest equals the hand just played, and the records add up exactly to the running score; also that every record obeys the 9-point rule, that a game
  dealt before the history existed carries on and records only what follows, and that a forfeit leaves history and scores as they stood.
- **Through the real server, every seat:** the whole-match browser-session test now checks, for two- and four-player matches, that each screen's history adds up
  exactly to that screen's final score with nothing missing, and that the seats agree (teammates identical, opponents the mirror image).
- **Real browsers:** the two-player journey is **111 checks** (it was 107) and the four-player journey **116** (it was 110), on a freshly rebuilt clean bundle.
  They cover the results panel on a forfeited match: the reason from each side, "No hand was completed", the final scores naming both sides, and each
  four-player player seeing the teams listed by name from their own side.
- **Looked at, on a phone:** the screen was rendered at 360 px and 320 px wide for five realistic matches (a full match with a missed minimum and sweeps, the
  same against the computer, a loss with unrecorded earlier hands, an early finish with no hands, one with hands, and a four-player match). There is no
  sideways overflow at either width. (This found a real bug: the panel was 24 px too wide until it set its own box sizing.)
- **Nineteen deliberate breakages caught:** nine in the engine (including a blatant one first, to prove the scratch copy really runs the engine being
  broken), eight in the results model and the opponent's mirror, one on the screen (the reason a match ended early going missing), and one against the
  smoke script.
- **A failing test that was doing its job:** an existing independent test of the opponent's mirrored view started failing, because the helper it compares
  against did not know about the new field. I fixed that helper, so the mirror is now checked by two independent implementations that agree.

## NOT verified
- Anything against your real Azure and Neon.
- **The browser journeys end by forfeit with no finished hands**, so they never show a table with rows for a real finished match. The rows are verified two other
  ways: the whole-match test through the real server (the data), and the phone-width rendering of the real model on realistic fixtures (the look). A full
  real match in a browser has not been watched.
- **A real phone.** The look was checked in a desktop browser at phone widths, not on a device.
- **Four-player screen sabotage:** the screen-level breakage was done on the two-player screen. The four-player screen uses the same component and is covered
  by its journey checks, but I did not break it separately.

## Known limits
- A forfeit mid-hand does not count the unfinished hand's points; the screen shows the scores as they stood and says the match ended early.
- Not shown: bids and who made them, the number of cards taken, or how long the match took. The engine does not keep them, and this slice only records
  what each hand scored.
- If you have not yet deployed app version 1.6.0, this can ship with it. If you have, the next number would be 1.7.0; I have not changed the version.
