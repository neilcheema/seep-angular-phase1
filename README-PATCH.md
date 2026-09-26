# Rule correction: building a house accepts a multiple of the target value

## The reported scenario
Opening move, bid 13. Floor has a loose 9♣ plus two separate loose Kings
(K♥, K♠ — each worth 13 on their own). Hand: 4♠ and K♦. The player wanted
to combine 4+9 (=13, one set) together with both loose Kings (two more
complete 13s) into a single house of 13, already cemented, in one move —
total 4+9+13+13 = 39 = 3×13.

## What was actually already legal vs. what was missing
Worth being precise here, since my first answer to this was wrong: during
an opening move, only the *target house value* must equal the bid — not
the face value of the card played. So building 4+9=13 was already legal
before this patch. What was missing was folding the two extra loose Kings
into that same build — the engine only accepted a selection summing to
*exactly* the target, not a multiple of it.

## The corrected rule
Founding a house now accepts any combination (the played card plus loose
floor cards) summing to a **positive multiple** of the declared target
value — 1×, 2×, 3×, etc. — not just an exact match. This is the same
generalization already applied to cementing (spec §15.5) and capturing
(§21), now extended to building a brand-new house too. When the sum is
more than 1× the target, the new house is created **already cemented**,
since it inherently holds multiple complete sets from the moment it's
formed.

Unaffected by this change: the opening-move constraint (target must still
equal the bid, exactly — regardless of the multiple), the "no duplicate
house value" rule, the reserve-card requirement, and the "you can only
found a house for yourself" rule (§8.5) — ownership is unaffected by how
many sets got folded in at creation.

## What changed
- **`gameEngine.ts` / `fourPlayerEngine.ts`** (`playBuildHouse` /
  `playFourPlayerBuildHouse`): validation changed from `sum !== targetValue`
  to `sum % targetValue !== 0`; the new house's `cemented` flag is set to
  `true` whenever the multiple is greater than 1.
- **`four-player.component.ts` / `two-player.component.ts`**: this is
  where most of the actual work was. The UI previously assumed
  `target = sum` always (since that was the only legal case) — with
  multiples now legal, `buildTargetValue` needed to *infer* the intended
  target from a sum that might be a multiple of it, not equal to it:
  - During an opening move, it now prefers the bid value first if the sum
    is evenly divisible by it (matching the hard engine constraint).
  - Otherwise, if the raw sum is itself a legal house value (9-13), that's
    used directly — this is the common, everyday single-set case,
    completely unchanged in behavior.
  - Otherwise, it searches for the largest legal house value (13 down to
    9) that evenly divides the sum, and uses that as the inferred target.
  - `canBuild` now explicitly checks `sum % target === 0` (previously
    implicit, since target was always defined as equal to sum).
  - The reveal overlay's label now shows the multiple when relevant (e.g.
    "Building house of 13 (3×, cemented)").

## New tests
Three new tests in each of `game.test.ts` and `fourPlayerActions.test.ts`:
a direct reproduction of the reported 4+9+K+K scenario (asserting the
resulting house is cemented with all 4 cards absorbed), confirmation an
ordinary single-set build still produces an uncemented house exactly as
before, and confirmation a non-multiple sum is still correctly rejected.
A fourth test confirms the opening-move-must-match-bid constraint still
holds regardless of the multiple.

## Known scope limitation
The computer AI's own house-building heuristic was **not** updated to
seek out multi-set builds — it still only ever tries the simple 1× case.
This wasn't required to fix the reported issue (which was specifically
about the human player being unable to make this move), and extending the
AI to recognize and prefer multi-set opportunities is a real judgment-call
enhancement, similar in spirit to the AI limitation already documented
back in Phase 4. Worth a look if you want a noticeably sharper computer
opponent later.

## How to apply
Copy these six files into your repo at the paths shown. The two component
files are full-file replacements that carry forward every previous fix
(rule-note feature, floor-state log summary, etc.) — apply these instead
of any earlier version of these two files, not alongside them.

    npm test
    npm run lint
    npm run build

## Verified here
110/110 tests passing (7 new), full `tsc` type-check clean on the engine
side. As with every UI-touching patch: no full Angular workspace in this
sandbox, so the two component files couldn't be run through `ng build`
directly — reviewed carefully by hand, but `npm run build` on your end is
the real confirmation.
