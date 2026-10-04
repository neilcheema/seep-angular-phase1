# Phase 5, slice 5d (part 1): rematch

This builds on slices 5b and 5c (already applied if you ran the 46-check smoke test). Still to come in 5d: names on the game boards, and
preset reactions.

## READ THIS FIRST: the order matters
1. **Run `projects/seep-api/db/007_phase5_rematch.sql` in Neon (production, then dev) BEFORE you deploy.** It adds one column to `games`. The new API
   reads that column every time anyone opens a table, so deploying first would make **every table fail to load** until the migration is run.
   (It is one line and safe to run twice.)
2. Copy the files in this zip over your repo; `npm test && npm run lint && npm run build`; commit and push.
3. Open `https://<your API>/api/v1/health?deep=1`. It should say `"schema":"ok"` (the deep check now also looks for the new column).
4. Run the smoke test. It is unchanged: **46 of 46**.

## What players get
- When a **two-player** online match ends, the match-over screen has a **Rematch** button (and "Back to Play online").
- **The first player to press it** gets a new table with them in the first seat, and waits there.
- **The other player's finished screen hears about it** within about 8 seconds and shows "Your opponent wants a rematch" with a **Join rematch**
  button. Pressing it puts them at the same new table, and the match starts.
- **Both pressing at the very same moment is safe:** one makes the table and the other joins it. Pressing twice is harmless (you get the same table).
- The new match is a fresh deal, with the same limits as any table: whoever makes the table counts as starting one (10 an hour, 5 waiting at once);
  whoever joins counts against the 20-matches-in-play cap.
- If the first player closes the rematch table (Leave) before the other asks, the next person to ask simply gets a fresh table.
- **Not for four-player matches.** Keeping the same partners would need seats reserved for specific people, which is not built, so a four-player
  match still offers only "Back to Play online".

## What it costs: the slow listen
A finished match stops being polled, so the other player could not otherwise learn of a rematch. A just-finished **two-player** screen therefore asks
once every **8 seconds** for **at most 5 minutes**, and stops sooner as soon as the rematch is known. A background tab asks every 15 seconds. That is
about 38 requests at most per finished screen, and nothing for four-player. (An open finished match you left on screen for hours costs nothing after
the five minutes.)

## Also changed
- The online table screen now **reopens when the table in the address changes** (the old match to its rematch). Angular reuses a screen when only
  the id changes, so without this the new table would have shown stale state.
- The deep health check also looks for the new column.

## Try it by hand in production
The quickest way to finish a match is the turn clock. Two browsers, two accounts, start a table and join it. Make a move or two, then let the player
whose turn it is do nothing for two minutes while the other keeps the page open: the match is forfeited and both screens show the Rematch button.
Press it on one; the other should offer "Join rematch" within a few seconds; pressing it starts the new match for both.

## Verified
- **755 tests across the repo** (176 engine, 383 API, 196 web), **none skipped**; lint clean (your exact toolchain); strict Angular compile clean;
  the API bundle builds.
- **Real browsers:** the two-player journey is now **99 checks** (it was 94) and the four-player journey is still **97**, no unexpected errors. The new
  checks cover: the Rematch button for both players; the first player landing on a new waiting table; the opponent hearing of it and the button
  becoming Join rematch; both ending up at the same new table with the match started.
- **Eighteen deliberate breakages caught** (15 on the server, 3 on the screens), each by a test that should catch it, after a check that the unmodified
  copy passed first. They include: asking before the match is over; rematching a four-player match; the second player making ANOTHER table; the
  pointer not being saved, or the version not moving (so the opponent is never told); a closed table being reused; the creating or joining limits being
  skipped; the wrong 201/200 answer; a dangling pointer after the table is deleted; the health check missing the column; the create and join code
  I refactored to share (a table that never starts, a creator who is not seated); the Rematch button doing nothing; the opponent never listening;
  and the screen not reopening for the new table.
- Five older tests that said "stop polling the instant a match ends" were rewritten on purpose to say the new rule, with new tests for the five-minute
  limit, for stopping once the rematch is known, and for four-player and closed tables stopping at once.

## NOT verified
- Anything against your real Azure and Neon. The five-minute listen was tested with a fake clock, not for five real minutes.
- How it feels on a phone, and over a slow connection.

## Known limits
- **The opponent only hears about the rematch while their finished screen is open**, and for the first five minutes after it saw the match end. If they
  have left, the requester can share the code or link from the waiting screen as for any table, or just start again from the lobby.
- A rematch does not change who bids first; every new match is a fresh random deal.
- There is no score across rematches ("you lead 2-1"): nothing keeps results (finished matches are deleted after about 30 days).
- Names are still not on the game boards; that is the next part of 5d.
