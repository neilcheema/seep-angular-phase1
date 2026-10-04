# Phase 5, slice 5d (part 3): quick reactions

This builds on the earlier 5d packages (rematch, names on the boards). With this, the planned Phase 5 features are all built.

## READ THIS FIRST: the order matters
1. **Run `projects/seep-api/db/008_phase5_reactions.sql` in Neon (production, then dev) BEFORE you deploy.** It adds a counter column to `games` and a small
   `reactions` table. The new API reads that column every time anyone opens a table, so deploying first would make **every table fail to load**
   until the migration is run. (Safe to run twice.) The migrations to have run, in order, are 005, 006, 007, 008.
2. Copy the files in this zip over your repo; `npm test && npm run lint && npm run build`; commit and push.
3. Open `https://<your API>/api/v1/health?deep=1`. It should say `"schema":"ok"` (the deep check now also looks for the new column and table).
4. Run the smoke test with the **new `live-smoke.mjs` from this zip**: **51 of 51** (it was 48). The three new checks fail against an API without reactions,
   on purpose: sending a reaction (200), refusing anything not on the list (400), and the other player hearing it on their next poll.

## What players get
- While a match is on (and just after it ends, for "Good game!"), a small **💬** button sits at the right edge of the screen. It opens six preset
  reactions: 👍 Nice move!, 😮 Wow!, 😅 Oops, 🙏 Thanks, 👏 Good game!, 🍀 Good luck!
- The other player(s) see a short message for four seconds: "Bob: 👍 Nice move!". At a four-player table your partner appears as "Your partner: ...".
  Nobody is shown their own reaction.
- A **Mute reactions** switch in the tray hides incoming reactions on that screen (until the screen is closed or refreshed).
- **There is no free text.** The server holds a fixed list of codes and refuses anything else (400), so there is no way to send an insult or a link. A test
  keeps the server's list and the website's list identical.
- **Limits:** 6 reactions a minute per person (`LIMIT_REACTIONS_PER_MINUTE`, with the other limits' off switch). A refusal reads "You are sending reactions
  too quickly. Please wait a moment."

## The design point that matters
**A reaction never changes the game's version.** A move is sent together with the version the player last saw, and a stale version is refused ("the game
changed"). If a friendly "Nice move!" moved the version, it would make the other player's next move fail. So reactions have their own counter on the table
and ride on the same poll, and several tests prove a move still succeeds after any number of reactions (and that a reaction does not count as table
activity either).

## How they travel (and what it costs)
Reactions come back on the ordinary poll, so there is **no extra request**. The server only looks anything up when the table's counter shows something newer
than the player's cursor, so an ordinary poll pays nothing. A first load gets none of the old ones (nothing is replayed). Only reactions from the last minute
are handed out, at most 20 per poll. Reactions older than 10 minutes are deleted as new ones arrive, and they all vanish with the game. Because they ride
the poll, a reaction can take as long as the poll interval to arrive: about 2 seconds normally, up to 10 when it is the receiver's own turn.

## Privacy
A reaction is stored by **seat only** (no user id, no name), so deleting an account leaves nothing personal in it; the privacy page's list of what is
kept for a game now mentions quick reactions.

## Verified
- **827 tests across the repo** (176 engine, 420 API, 231 web), **none skipped**; lint clean (your exact toolchain); strict Angular compile clean; the API bundle builds.
- **Real browsers, on a freshly rebuilt clean bundle:** the two-player journey is now **107 checks** (it was 103) and the four-player journey **110** (it was
  106). They cover: a reaction appearing on the other player's screen naming the sender; a player who muted missing a "Wow!" yet hearing the next reaction
  after unmuting (proving they were listening); a fourth reaction in a minute refused in plain words; a sender never shown their own reactions; and at a
  four-player table, two opponents seeing "Alice: ..." while Alice's partner sees "Your partner: ...".
- **The smoke script passes 51 of 51** against my test server.
- **Seventeen deliberate breakages caught** (15 on the server, 2 on the screens), after a check that the unmodified copy passed first. They include the key one
  (a reaction that moves the game's version), accepting free text, reactions at a waiting table, replaying old reactions on a first load, minute-old ones
  handed out, no cap per poll, no pruning, a "nothing new" poll dropping reactions, the wrong seat, no rate limit, the health check missing the table, and
  reactions outliving their game; on the screens, the mute switch being ignored and a sender being shown their own reaction.
- **Two weaknesses in my own tests were found and fixed while doing this:** one breakage turned out not to inject a real bug (it did nothing, because of how
  the database treats an undefined cursor), so I replaced it with one that does; and the browser check that a sender is not shown their own reaction ran too
  early to be able to fail, so it now waits for the sender's screen to have polled.

## NOT verified
- Anything against your real Azure and Neon.
- **How the 💬 button and the tray look on a small phone**, and whether the button sits comfortably next to the cards. I positioned it at the right edge,
  vertically centred, but have not seen it on a real phone.
- Reaction delay on a real connection (it depends on the poll interval above).

## Known limits
- Mute lasts only as long as the screen is open; it is not remembered.
- A reaction shows only on the table screen the other player has open; someone who has left the table never sees it.
- There is no way to report or block a person from a reaction; the list is fixed and friendly, and rate-limited, so the risk is spamming, not abuse.
