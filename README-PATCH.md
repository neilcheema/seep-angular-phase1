# Patch 6: per-move pause/reveal and move log added to two-player Seep

## What changed
Ported the same step-through pause pattern built for the four-player game
over to two-player: every move — yours or the computer's — now pauses on
an overlay showing the card played, whatever it interacted with on the
floor, and a "Next" button, plus a persistent move-log drawer underneath.
Same reasons as before: a way to verify each move visually, not just via
the engine's test suite.

- `two-player.component.ts` / `.html` — full rewrite, following the same
  structure as `four-player.component.ts`: a `pendingReveal` signal driving
  a blocking overlay, a `log` signal for the move-log drawer, the computer-
  automation `effect()` reading `pendingReveal` alongside game state so
  dismissing a reveal correctly re-triggers it. Simplified for two players:
  no seat/team concepts, just "You" and "Opponent", and sweep-bonus
  detection compares `sweepPoints.player`/`sweepPoints.opponent` directly
  rather than going through a team lookup.
- `computer.ts` (two-player AI) — added a `reason` string to every decision
  `chooseComputerBid`/`chooseComputerOpeningMove`/`chooseComputerMove`
  returns, mirroring `computer4p.ts`. The two-player AI never needed this
  before (two-player had no narration requirement), but the reveal overlay
  needed something to show for the computer's moves, so this brings it up
  to the same standard.
- `computer.test.ts` — one new test confirming every decision now carries
  a non-empty reason, matching the equivalent four-player test.

## Also carried forward automatically
Since `onModify()` in the new two-player component uses the same
generalized cementing check as the four-player one (`addedValue %
house.captureValue === 0`), the multi-card cementing fix from the previous
patch works correctly here too — no separate fix needed, it's just how the
new file was written from the start.

## How to apply
Copy these four files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build

## Verified here
92/92 tests passing (1 new), full `tsc` type-check clean on the engine
side. Same caveat as every UI-touching patch: I don't have the full
Angular workspace in this sandbox, so `two-player.component.ts/.html`
couldn't be run through `ng build` directly — reviewed carefully by hand,
but `npm run build` on your end is the real confirmation.
