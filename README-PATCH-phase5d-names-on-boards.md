# Phase 5, slice 5d (part 2): names on the game boards

**Website only: no database migration, no API change, nothing to run in Neon.** Copy the files, test, push. (It builds on the earlier 5d rematch
package: apply that first.)

## What players see
When you play a person (online), the boards now use the name they chose instead of "Opponent" / "Player N":
- **Two-player:** the opponent's name above their hand; the score line says "Bob:" instead of "Opponent:"; the bid owner reads "(you)" or "(Bob)"; the
  hand-complete line reads "you 40 · Bob 25"; the match-over message reads "Bob won the bazzi."; the move reveals and the move log say "Bob played..."; and
  the last line in the status bar names them too, for example "Bob ran out of time and forfeited the match."
- **Four-player:** the labels around the table show names, with the partner as "Carol · Your partner"; the move reveals and move log use names; the status
  panel names the bidder and the last log line ("Dave ran out of time and forfeited the match.", or "Your partner ran out of time..." if that is your partner).
- Someone who has not chosen a name still shows as "Opponent" / "Player N". **Games against the computer are unchanged:** they supply no names.

## A real bug this slice found in itself, and its fix
The four-player journey failed at the end of a forfeit: the winning team's "Your team won the bazzi!" never appeared, because a move reveal the player had
already dismissed was showing again, and the winner banner waits for reveals to clear. The cause was my own change. The reveal is built inside an
effect, and building it now read the names, which are a new object after every server update, so every update re-ran the effect and re-showed the last
move. **In real play this would have made old reveals pop back up whenever anything changed.** Two fixes, either of which alone would have worked:
the effect now tracks only the move itself (both boards), and the names are compared by content, so an update that changes no names is not a change.

## Also fixed along the way (test side)
- A browser-journey check expected the old wording "Opponent won the bazzi." That wording is exactly what this slice replaces, so it now expects the name.
- A check that a waiting table is listed under Your tables ran before the list had loaded: a race that passed or failed on timing. It now waits.
- An integration test counted ALL fake timers, which includes the database driver's; under load that count was wrong. It now asks the sessions.
- My test run scripts could leave servers running after a timed-out run, and the next run then talked to a stale server (I lost time to exactly this).
  They now free their ports first and always stop what they start.

## Apply
1. Copy the files in this zip over your repo; `npm test && npm run lint && npm run build`; commit and push (this deploys the website; the API is unchanged).
2. Try it with two accounts that have chosen names: play a few moves and check the opponent's name above their hand and in the score line.

## Verified
- **775 tests across the repo** (176 engine, 383 API, 216 web), none skipped; lint clean (your exact toolchain); strict Angular compile clean.
- **Real browsers, on a freshly rebuilt clean bundle:** the two-player journey is now **103 checks** (it was 99; three runs in a row) and the four-player journey
  **106** (it was 97). The new checks cover: the name above the opponent's hand; "Bob:" in the score line; the loser's screen saying "You ran out of time" while
  the winner's screen names who did; the loser told who won, by name; every one of four players seeing the partner and both opponents by name; nobody called
  "Player N" once named; and the forfeit line worded correctly from each person's side.
- **Breakages caught:** the two-player log line keeping the generic word, and the four-player hand labels ignoring names. The bug above was also caught by
  the journey on its own, before I looked for it.

## NOT verified
- Anything against your real Azure and Neon (this is browser-side only, but the journeys use a stand-in server).
- **How long names look in the narrow status bar or on a small phone.** Names can be up to 20 characters, in any script, and I have not looked at the longest
  ones on a phone. The status bar's last line is already cut off with "..." when long; check a long name there.

## Known limits
- The four-player team scoreboard still reads "Team A (You & Partner)", not names. The house-owner labels ("Yours", "Partner's", "Opponents'") are unchanged.
- Two people can choose the same name; at a four-player table the seat in the corner tells them apart.
- A name that is itself the word "You" or "Opponent" would be confusing. The rules allow it.
