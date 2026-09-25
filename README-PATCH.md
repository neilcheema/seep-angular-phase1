# Patch 5: cementing now accepts any combination that's a multiple of the house value

## What was wrong
Cementing was implemented far too narrowly: only a single hand card whose
own value exactly matched the house's value could cement it. Any card
played together with loose floor cards was always treated as a "break"
attempt (raising the house to a new value) — even when that combination
summed to *exactly* the house's own value, or an exact multiple of it.

Reported scenario: a house already at 13 (Seep's maximum legal value), a
hand card of 2, and a loose Jack (11) on the floor. 2 + 11 = 13 — the
player should be able to cement using that combination, since it's exactly
1x the house's value. The old code saw `extraLooseItemIds.length !== 0` and
routed it into the "break" path instead, which tried to raise the house to
26 — not a legal value (must be 9-13) — so it was rejected outright, with
no cementing option offered at all.

## The actual rule (confirmed with the user)
Cementing isn't restricted to a bare single matching card. Any combination
— the played card plus zero or more loose floor cards — whose sum is a
**positive multiple** of the house's existing value cements it: 1x, 2x, 3x,
etc. The house's declared value never changes when cementing (unlike
breaking, which raises it to a new value); the cards just get added into
the pile. This applies to any house — your own, your partner's, or an
opponent's — with the same reserve-card rule as before: free if it's your
partner's house, otherwise you need another card of that house's value
left in hand afterward.

## What changed
- `fourPlayerEngine.ts` (`playFourPlayerModifyHouse`) and `gameEngine.ts`
  (`playModifyHouse`, the two-player equivalent): the cement/break decision
  now checks `addedValue % house.captureValue === 0` instead of requiring
  a bare single card with no loose items. Everything else (reserve-card
  rule, free-for-partner, self-break restriction, merge-on-break) is
  unchanged.
- `four-player.component.ts`: the reveal overlay's "Cementing" vs
  "Breaking" label now uses the same generalized check, so it always
  matches what actually happens. **This file supersedes the version from
  the sweep-bonus-feedback patch** — it carries that fix forward plus this
  one; you don't need both, just this one.
- **No UI structural changes were needed beyond that label fix.** The
  ability to select a house plus additional loose floor cards alongside
  your played card already existed in the UI (it was built for breaking,
  which always supported combinations) — the engine fix alone unlocks the
  option through the existing interface.

## New tests
- `fourPlayerActions.test.ts`: 5 new tests, including one that reproduces
  the exact reported scenario (13-house, a 2, a loose Jack) and fails on
  the old code.
- `game.test.ts`: 3 new tests for the same rule in the two-player engine.

## How to apply
Copy these three files into your repo at the paths shown, then:

    npm test
    npm run lint
    npm run build

## Verified here
91/91 tests passing (8 new), full `tsc` type-check clean on the engine
side. As with the other UI-touching patches, I couldn't run `ng build`
against `four-player.component.ts` directly (no full Angular workspace in
this sandbox) — the edit is small and I reviewed it carefully, but treat
`npm run build` as the real confirmation.
