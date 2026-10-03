# Bug fix: a legal house + loose-group capture was impossible to select

## What was actually happening
The floor had a cemented house of 13 (10+3+8+5) alongside three loose
cards (8, 5, 4). Playing a King, the only complete, correct capture is
the house PLUS the loose 8+5 together \u2014 the engine has always required
capturing every matching house and loose group as one move, never just
part of what's available (the loose 4 correctly stays behind, since no
combination including it sums to 13).

The engine itself has always enforced this correctly. The bug was
entirely in the two page components: canCapture() only recognized two
shapes of selection \u2014 a house captured completely alone, or loose cards
captured completely alone \u2014 never a house together with a disjoint
loose group. Selecting the actually-correct combination (house + 8 + 5)
satisfied neither old branch, so the Capture button stayed disabled no
matter what \u2014 a fully legal move was impossible to even attempt.

Separately, the old logic had the opposite problem too: selecting just
the loose 8 + 5 (without the house) WAS accepted by the old client
check (loose sum matched 13), enabling the button \u2014 but the engine
correctly rejects that as incomplete, producing exactly the "bigger
combined capture is available" error. That's almost certainly what
happened in the screenshots: unable to select the actually-correct
combination, selecting just the loose pair was the only thing that
lit up the button \u2014 and the engine, correctly, said no.

## The fix
canCapture() in both pages now mirrors the engine's own validation
exactly \u2014 the same findHouseByValue + findMaximalExactGroups
computation the engine itself uses to decide what's required \u2014 instead
of a simplified, independent check that had drifted out of sync with
it. The button is now enabled if and only if the current selection is
exactly what the engine will accept.

## Verified precisely, not just reasoned about
- Reproduced the exact floor from both screenshots (the same house
  composition, the same three loose cards, a King as the only card
  left) directly against the real engine code in this session's
  sandbox:
  - Confirmed the OLD canCapture logic returns false for the correct,
    complete selection (house+8+5) \u2014 the bug, reproduced precisely.
  - Confirmed the OLD logic WRONGLY returns true for the incomplete
    selection (just 8+5) \u2014 explaining exactly how the button could
    ever become clickable in the first place, right before the engine
    rejected it.
  - Confirmed the NEW logic gets both of those exactly right.
  - Confirmed directly against playFourPlayerCapture itself: the
    complete selection is accepted: the incomplete one is rejected
    with the identical message from the screenshots.
- Compiled both fixed components with the real Angular AOT compiler,
  strict templates \u2014 clean.
- Ran the actual compiled four-player component in a headless browser,
  with the exact scenario injected directly into a real session (not a
  simulation): confirmed the Capture button is genuinely disabled in
  the OLD code and genuinely enabled in the FIXED code for the same
  selection, then clicked it in the fixed version and confirmed the
  capture actually completes \u2014 the King played, the house's four
  cards and both loose cards all correctly captured together, zero
  page errors.
- The two-player fix is the identical code pattern against the
  identical engine functions; verified by AOT compilation. Not
  separately re-run through the full headless-browser scenario, since
  the underlying logic is exactly what was already proven correct for
  four-player \u2014 noted plainly rather than claimed as directly observed.

## Apply
Replace these two files, then npm test && npm run lint && npm run build.
No engine changes, no schema changes, no test suite changes \u2014 the bug
and the fix are both entirely in these two files.
