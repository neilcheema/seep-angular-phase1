# Fair AI: no hand-peeking, deduction only — replaces the previous patch entirely

## What you asked for
The AI should never see what's actually in an opponent's hand. It should
only reason from what a human player could legitimately know: cards
already played/captured, what's currently on the floor, and the fact that
building or maintaining a house reveals its owner is holding a matching
reserve card.

## What I found and fixed
This wasn't just about the risk-check I'd added in the previous patch —
the **original** throw-safety logic, present since early in this project,
also directly inspected the opponent's real hand
(`captureOpportunities(floor, state.hands.player)`, and the four-player
equivalent per opponent seat). Both games had this. All of it is now
replaced with deduction from public information only. Neither AI is ever
given access to any hand but its own, anywhere in either file.

## The deduction model (both games)
1. **Card-counting**: for any capture value, count how many of its four
   copies are visible — in the acting seat's own hand, anywhere on the
   floor (loose or inside a house), or in either side's capture pile. If
   fewer than four are visible, the rest are somewhere in an unseen hand.
   This is exactly the running tally a careful human player keeps in their
   head over a hand.
2. **The house tell you specifically asked for**: an opponent's uncaptured
   house on the floor is a direct, public signal that they're holding a
   matching reserve card — the same clue a human watching the table would
   pick up on.

These replace `captureOpportunities` (which counted an opponent's actual
matching cards) with `deducedRiskScore` and `deducedSweepRisk` (which
count values that aren't yet deducibly ruled out). Used in two places in
each file: the risk-check before committing to an ordinary capture (from
the previous patch, now fixed to use deduction), and the original
throw-safety fallback (which needed the exact same fix).

## An honest limitation worth knowing about
I tried to construct a test proving the house-tell adds information
beyond card-counting alone, and traced through why it mostly can't in the
normal case: if a house's owner still holds their original reserve card
(the expected case), that card is inherently unaccounted-for anyway, so
card-counting alone already catches it. The house-tell only diverges from
card-counting in a rare edge case — the owner has already spent that
reserve on something else, and by coincidence all four copies of the
value are otherwise accounted for — where it would actually cause a false
positive (treating an already-dead house as live risk). I kept the
mechanism because it's what you asked for and it makes the AI's reasoning
traceable to a concrete, visible event rather than only an abstract count,
and the false-positive case just makes the AI a little more cautious than
strictly optimal in an unusual scenario — not a broken decision. Flagging
this now rather than presenting the house-tell as adding more than it
reliably does.

## Test changes
Every test from the previous patch that constructed a "the opponent's
configured hand does/doesn't have a matching card" scenario no longer
makes sense under this model — the AI has no such hand to check anymore.
Rewritten to construct genuine *deducible* safety instead (accounting for
a value's other copies via capture piles, matching how a hand would
actually have evolved) or genuine risk (leaving copies unaccounted for).
One new test specifically exercises the house-tell mechanism (a lone
opponent house built from a non-obvious combination, with no literal
matching card visible anywhere else, still correctly flagged as risky).

## How to apply
Copy these six files into your repo at the paths shown — full
replacements for both AI files and all four of their test files.

    npm test
    npm run lint
    npm run build

## Verified here
125/125 tests passing (1 new since the last patch), full `tsc`
type-check clean, plus the stricter `--noUnusedLocals
--noUnusedParameters` pass — clean. Both randomized fuzz tests re-run 5
times back to back with no flakiness.
