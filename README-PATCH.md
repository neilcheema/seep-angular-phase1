# Rule correction: a capture must take every matching group at once

## The reported scenario
Floor: 2♣, 8♣, 10♥. Bid/played card: 10. The player wanted to capture all
three together (2+8=10, and the loose 10♥ is a second "ten") but the game
only allowed capturing one group at a time — either the 2+8 pair, or the
lone 10♥, never both together.

## The corrected rule (confirmed with the user, two clarifying questions)
A capture must take **every** disjoint group of loose cards that sums to
the played card's value, combined into a single move — not just one such
group. This mirrors the cementing generalization from the previous patch:
a cemented house holding two separate sets of the same value is captured
as one unit regardless of how many sets are inside it; loose cards on the
floor now work the same way.

Two design points were confirmed explicitly before implementing, since
they meaningfully change the behavior:

1. **The groups must be clean** — the selection must actually decompose
   into distinct subsets that each exactly equal the card's value (like
   2+8=10 and 10 alone). A combination whose *total* merely happens to be
   divisible by the card's value, without a genuine way to split it into
   exact-value groups, does **not** qualify. Example that must still be
   rejected: floor 3, 4, 13 with a played 10 — total is 20 (2×10), but no
   subset of {3, 4, 13} sums to exactly 10, so there's no clean split.
2. **It's mandatory, not optional** — if a combined multi-group capture is
   available, the player cannot choose to take just one group instead
   (the same way today's mandatory-capture rule already forces capturing
   over throwing when *any* capture exists).

## What changed
- **`floor.ts`** — two new shared helpers used by both engines:
  - `findMaximalExactGroups(floor, target)`: finds the largest possible
    number of disjoint loose-card groups each summing to `target`.
  - `canDecomposeIntoExactGroups(floor, ids, target, groupCount)`: verifies
    a specific set of ids actually splits cleanly into that many exact
    groups (used to reject the "coincidental total" case above).
- **`gameEngine.ts` / `fourPlayerEngine.ts`** (`playCapture` /
  `playFourPlayerCapture`): a loose-only capture selection now must total
  exactly `maxK * cardValue` (where `maxK` is the true maximum achievable
  across the *whole* floor, not just what was selected) and must itself
  decompose cleanly into that many groups. Houses are unaffected — still
  always captured alone, never combined with a loose group even if one
  happens to exist elsewhere on the floor.
- **`computer.ts` / `computer4p.ts`**: both AIs' capture-finding logic now
  computes the full maximal grouping instead of just one match, so they
  correctly take the combined capture themselves rather than erroring
  against the new engine rule.
- **Fuzz tests** (`fuzz.test.ts`, `fourPlayerFuzz.test.ts`): their own
  independent random-move generators were updated the same way — this is
  what actually caught that the AI files needed fixing too, since these
  tests failed immediately with the old logic against the new engine rule.

## New tests
Six new tests in each of `game.test.ts` and `fourPlayerActions.test.ts`,
including a direct reproduction of the reported 2♣+8♣+10♥ scenario, both
"wrong subset" rejections, the tricky non-decomposable-coincidence case
(3+4+13), confirmation an ordinary single-group capture still works when
there's nothing else to combine with, and confirmation houses remain
unaffected.

## How to apply
Copy these nine files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build

## Verified here
103/103 tests passing (11 new), full `tsc` type-check clean, and the two
randomized fuzz tests (which now exercise a meaningfully more complex
combinatorial rule) re-run 5 times back to back with no flakiness and no
performance degradation.
