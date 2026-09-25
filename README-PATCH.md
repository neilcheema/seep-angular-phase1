# Patch 7: move log now shows floor state, pile values, and pile ownership

## What changed
Every move-log entry (both games) now has a second, smaller line underneath
showing the floor as it stood right after that move:

- Loose cards shown compactly with suit symbols (e.g. K\u2666, 4\u2663)
- Each pile shown as its value plus who owns it: "Pile-13 (...)"
- Empty floor shown as "Floor: empty"

**Four-player**: pile ownership is framed as "Human team" (you + your
partner, i.e. Team A) or "AI team" (both opponents, Team B), or "Shared"
for a cemented pile with owners split across both teams.

**Two-player**: pile ownership is framed as "Yours" / "Opponent's" /
"Shared" (a house can end up with both of you as owners too, via
cementing an opponent's pile).

## Implementation
- `reveal()` in both components now takes the resulting floor state
  alongside the move snapshot, and builds the summary text via a new
  `describeFloor()` helper (plus `pileOwnerLabel()` and `shortCard()`).
- `LogEntry` gained a `floorSummary: string` field; the template renders
  it as a smaller, muted line under each log entry's main text.
- All five places each component calls `reveal()` (human bid, computer
  bid, computer opening move, computer normal move, and every human
  action via `runPlayerAction`) were updated to pass the post-move floor.

## How to apply
Copy these four files into your repo at the paths shown (both are full-file
replacements, carrying forward every previous fix to each component —
sweep-bonus feedback, the cementing-label fix, and for two-player, the
entire move-reveal port from last time), then:

    npm run build
    npm run lint

No engine files changed in this patch — purely UI/display.

## Verified here
As with every UI-only patch: no full Angular workspace in this sandbox, so
`ng build` couldn't be run directly against these files. Reviewed by hand
for consistency (all `reveal()` call sites updated, all new helper
references resolve), but `npm run build` on your end is the real
confirmation this time.
