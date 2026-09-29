# Phase 2, part 2: LocalFourPlayerSession

The four-player equivalent of the LocalSession patch from before — same
GameSession interface, same pattern, adapted for four seats and teams.
Still completely unwired from four-player.component.ts; this patch alone
changes nothing about the live site.

## What's different from the two-player version
- No single fixed "the bot" seat — whichever of the three non-viewer
  seats currently holds the turn is the one that acts. This turned out
  to need no real complexity: at any moment exactly one seat has the
  turn (`state.turn`), so the gating is just "is that seat the viewer,
  or not" — the same shape as two-player, just checked against a
  4-seat enum instead of a 2-value union.
- Uses viewForSeat/applyFourPlayerMove/FourPlayerIntent from the
  four-player engine, and handles the 'modify' action the four-player
  AI can choose that the two-player one never does (building/cementing
  a house).

## Verified
- Compiled clean against the real `@angular/core`, the real engine, and
  your project's actual tsconfig.json settings.
- 7 tests: initial view redaction, submit+lastMove, illegal-move
  rejection, a bot bidding on its own when the viewer is the dealer, play
  continuing automatically through several bot seats in a row after the
  human's own move with no further input needed, dispose() cancelling a
  pending move, startNewMatch resetting cleanly.
- Deliberately broke the bot-scheduling logic to confirm two of these
  tests catch it (they did) before trusting them, and restored the file
  — confirmed byte-for-byte with `diff`.
- Ran the full combined suite (both engines' tests plus both session
  layers) 5 times back to back: 177/177, stable.

## Apply
Copy these two files into your repo at the paths shown, then
`npm test && npm run lint && npm run build`.

## What's still ahead
The actual wiring — replacing two-player.component.ts and
four-player.component.ts's direct engine calls with the GameSession each
now has available. That's the next and last piece of Phase 2.
