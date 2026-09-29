# Phase 2: four-player.component.ts wired to LocalFourPlayerSession

Same pattern as the two-player wiring, adapted for four seats and teams.
The page no longer talks to the engine directly — it holds a
LocalFourPlayerSession, reads its redacted view, submits intents, and
reacts to whatever move the session reports, whether from the human's
own submit() or any bot seat's scheduled move.

## What changed, and what didn't
**Behavior: unchanged**, verified below — same bidding, opening move,
capture/build/cement/break/throw, move-reveal pauses (now correctly
gated through every bot seat individually — this is the first place the
acknowledge fix is exercised with more than one bot in the chain), move
log, rule-note feature, Deal/Play again flow.

**Structural changes, mirroring two-player exactly:**
1. `state` is now `computed(() => this.session()?.view() ?? null)` — a
   `FourPlayerGameView`. The five template bindings that referenced
   `s.hands.p2/p3/p4.length` and `s.hands.p1` now read
   `s.handCounts.p2/p3/p4` and `s.myHand`.
2. `legalBidsFor` computes from the view's own `myHand` instead of
   taking a full `FourPlayerGameState`.
3. Six separate places that used to hand-build a `MoveReveal` (one per
   human action, plus `applyAction`/`snapshotAction` for computer moves)
   are now one `buildReveal()`, driven by an effect watching the
   session's `lastMove`.

## One real behavioral fix, found while unifying those six call sites
The original human-move cement/break check (`addedValue %
house.captureValue === 0`, matching the engine's actual multi-set
cementing rule) and the original AI-move check
(`extraLooseItemIds.length === 0 && card value === house value`, a
narrower special case) disagreed with each other. A computer move that
cemented a house via a multi-card combination could have been
mislabeled "Breaking house" in its own reveal — a real, pre-existing
inconsistency, not something this patch introduces. `buildReveal()` uses
the correct, general check for both human and computer moves now.

## Verified
- Real Angular AOT compiler, strict templates on, using every actual
  component you sent (not stubs this time) — clean on the first attempt.
- Confirmed `four-player-status-panel.component.ts` had the identical
  `input.required<FourPlayerGameState>()` issue as `status-panel.component.ts`
  — same fix (`FourPlayerGameView`), confirmed by reverting it and
  reproducing the exact predicted compile error before trusting the fix
  was necessary.
- Ran the compiled component in a headless browser, three times, three
  different random deals: start, bid, dismiss, opening move, dismiss,
  then walked through every consecutive bot turn — waiting real time and
  calling `dismissReveal()` (which calls `acknowledge()`) once per bot
  move, the same way a person clicking "Next" would. Confirmed in the
  browser:
  - **The scenario unique to four-player**: three consecutive bot turns
    (p2 → p3 → p4) each correctly waited for its own acknowledge — no
    move ever appeared before it was actually dismissed and waited for.
  - Capture, build, and throw moves all flowed correctly through
    `buildReveal()`, each with a `reason` string for bot moves.
  - `canShareRuleNote` correctly unlocked once both sides had moved.
  - Zero console or page errors across all three runs.

## The one thing not directly exercised at runtime
None of these three runs happened to produce a computer 'modify'
(cement/break) move in the first few turns — the AI tends to prefer an
available capture when one exists, the same reason multi-set builds are
rarely seen in AI play (documented earlier in this project). That path
is still covered by the AOT compiler's type-checking, and its logic
directly mirrors the two-player version's already runtime-verified
modify handling — but I want to be precise about what was actually
watched happen versus what's covered by the surrounding verification.

## Apply
Copy these three files into your repo at the paths shown, then
`npm test && npm run lint && npm run build`, then commit.

## What's left in Phase 2
The mySeat/table-rotation piece from the original plan. With both
LocalSession and LocalFourPlayerSession already parameterized by
viewer identity (`myId`), this is now a smaller piece of work than it
would have been before the wiring existed.
