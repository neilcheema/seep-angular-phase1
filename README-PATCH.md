# Patch 4: sweep bonus now explicitly shown for your own captures

## Your question
"Why didn't I get the seep points when I captured J" — from this log:
Partner cemented your 11-house (adding a 3rd card to it), then two other
players moved, then you captured that same house with J of Hearts for 3
cards.

## Two separate things

**Likely explanation, can't confirm from the log alone:** a sweep bonus
only applies when a move clears the *entire* floor. A house can only ever
be captured on its own — never combined with other loose floor cards in
the same move, even if the totals would work out. So if any other loose
cards were sitting on the floor besides that house at the moment you
captured it, taking the house (even for 3 cards) wouldn't have cleared the
floor, and no sweep bonus would be due. That's correct behavior per the
rules if it's what happened — I can't see the full floor state from log
text alone to confirm it either way.

**Confirmed real gap, fixed regardless:** when the computer sweeps, its
narration explicitly says "for a sweep bonus." When *you* capture
something, the old code never said anything about a sweep either way, even
when one happened — so there was no way to actually verify which
explanation applied to your capture just by reading the log. That's the
part this patch fixes.

## What changed
`four-player.component.ts` — every capture (yours or the computer's) now
compares the acting team's `sweepPoints` immediately before and after the
move. If it went up, both the reveal overlay's label and the move-log text
now say so explicitly:
- Reveal overlay label: "Capturing" -> "Capturing — Sweep! +50" (or +25 on
  the opening move, per the existing sweep-bonus tiers)
- Move log text: "... and captured N card(s). Seep! +50 sweep bonus."

This required also passing the *pre-move* state through to the computer
snapshot function (`snapshotAction`), so it can compute the same
before/after comparison for AI captures rather than only trusting the AI's
own `reason` text (which says "for a sweep bonus" when the AI *intended*
one, but is a separate code path — comparing real state is more reliable
than trusting two systems always agree).

## Important caveat on this patch specifically
Unlike the last few patches, **I could not run `ng build` or `tsc` against
this file** — my sandbox only has the standalone engine (the part
`computer.ts`/`computer4p.ts` live in) reconstructed, not the full Angular
workspace this component depends on. I reviewed it carefully by hand for
type-narrowing correctness and structural issues, but there's a real chance
of something I can't catch without the actual Angular compiler. If
`npm run build` fails after applying this, paste me the error — don't
assume it's your setup.

## Files in this patch
- `projects/seep-web/src/app/pages/four-player/four-player.component.ts`
  (full file, replaces yours)
- `projects/seep-web/src/app/pages/four-player/four-player.component.html`
  (full file, replaces yours — mostly unchanged, added a line to "How to
  play" about houses/sweeps, everything else identical)

No engine files changed in this patch — computer.ts/computer4p.ts from
patch 3 are untouched and still apply as before.

## How to apply
Copy these two files into your repo at the paths above (overwriting your
current versions), then:

    npm test
    npm run lint
    npm run build

Since this patch has no test coverage of its own (it's UI-only, and this
workspace has no component-level test harness — same limitation noted
back in Phase 4/5), the real verification is playing a hand and confirming
"Seep!" text now shows up on your own captures when the floor actually
clears.

## Update: bold "Seep! +N" banner in the reveal overlay

Added a dedicated, bold line right in the "Next" window itself — not just the
move log — that reads **Seep! +N** whenever a capture's sweep bonus is
greater than 0. It reads directly off the same `sweepBonus` field computed
identically for both the human capture path (`onCapture`) and the computer
capture path (`snapshotAction`), so it isn't specific to any one seat — it
shows the same way whether you, your partner, or either opponent triggers
the sweep. The old inline "Capturing — Sweep! +N" text in the label was
simplified back to plain "Capturing" now that this dedicated banner carries
the announcement instead, avoiding redundant/cluttered text in the same
window.
