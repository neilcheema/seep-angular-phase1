# Phase 2 complete: mySeat and table rotation

The last piece of Phase 2 — the viewer's seat is no longer hardcoded to
P1 anywhere. Six files: the page, its two child components, the session
layer (one real bug found and fixed there), and that fix's tests.

## What changed

**four-player.component.ts**: a new `mySeat` signal (fixed to P1 for
now — there's no mechanism yet to assign a viewer to a different seat,
that's an online-multiplayer concern this local game can't reach) plus
three computed signals derived from it via the engine's own
`nextSeat`/`partnerOf`: `partnerSeat` (top), `leftSeat`, `rightSeat`.
Every place that checked `=== SeatId.P1` now checks `=== this.mySeat()`.
Two label helpers replace the old hardcoded map: `seatTag()` for running
text ("You"/"Your partner"/"Player N"), `seatHeaderLabel()` for the
three hand headers around the table.

**four-player.component.html**: the partner row and both side hands now
read `partnerSeat()`/`leftSeat()`/`rightSeat()` instead of literal
`p2`/`p3`/`p4`; the bidding-turn check reads `mySeat()` instead of the
literal `'p1'`.

**four-player-status-panel.component.ts** and
**four-player-floor-item.component.ts**: both had the identical
hardcoded-P1 problem in their own "You"/"Your partner" logic (bid label,
house-owner tag). Both now take a `mySeat` input the page passes through.
The floor-item's old "Team B's" fallback — which assumed the viewer was
always on Team A — is now "Opponents'", which says the same thing
without that assumption and reads more naturally besides. This is a
small, real text change from what's shown today, not hidden in the
refactor.

## A real bug this surfaced, not just a refactor
Testing only mySeat=P1 would have missed it entirely, which is exactly
why I also tested other seats even though nothing in the product can
reach them yet. `LocalFourPlayerSession.startNewMatch()` called
`startFourPlayerMatch()` with no dealer argument, silently defaulting to
the engine's own `SeatId.P4` — which only coincidentally made P1 the
bidder. For any other viewer seat, this left them bidder-less (an empty
staged hand, zero legal bids) on every restarted match. Fixed by
computing the dealer from `myId` directly (`partnerOf(nextSeat(myId))`
— the seat whose `nextSeat` is the viewer). The main component's
`startNewGame()` had the equivalent issue on the very first game and is
fixed the same way. Two new tests lock this in, covering both the
construction path and the restart path, for a non-P1 seat.

## Verified
- Real Angular AOT compiler, strict templates, all real components:
  clean.
- Verified the seat-rotation formula itself in isolation first (three
  unit tests) before building anything on it: P1 reproduces the known
  values (left=P2, partner=P3, right=P4), P3 gives the mirror image, and
  across all four seats the four computed positions are always four
  distinct seats.
- Ran the compiled component in a headless browser at three different
  seats — P1, P2, and P3 — full sequence each time: start, bid, opening
  move, walk every bot turn to completion. Confirmed for every seat: the
  four screen positions are always four distinct seats, "You" and "Your
  partner" always land correctly, no bot move is ever attributed to
  mySeat itself, and `mySeat=P1` reproduces the exact original layout
  (partner=P3, left=P2, right=P4) with zero drift.
- Deliberately reverted the startNewMatch fix and confirmed the new unit
  test catches it, before trusting the fix — then restored, confirmed
  byte-for-byte with `diff`.
- Full combined suite (engine + both session layers): 181 tests, 3 runs
  back to back, stable.

## What I deliberately didn't touch
The status panel's "Team A (You & Partner)" match-score label still
assumes the viewer is on Team A. Fixing that properly means deciding how
team names should display generally (probably "Your team" / "Their
team" throughout, not just patching this one spot) — a real question,
but a different and broader one than seat rotation. Flagging it rather
than silently leaving it or silently expanding scope to fix it here.

## Apply
Copy these six files into your repo at the paths shown, then
`npm test && npm run lint && npm run build`, then commit.

With this, Phase 2 is complete.
