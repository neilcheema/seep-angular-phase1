# Release 1.10.2: the "Notice something…" button no longer floats, so it can never cover Capture, Build or Throw

**This release replaces 1.10.1 (and 1.10.0, 1.9.6 to 1.9.9): apply only this one.** It contains everything they did. Please delete the older zips.

## What you reported
With many cards on the floor, after you select a hand card and floor cards, the "Notice something that doesn't match the rules you know?" button blocks the action buttons, so you cannot capture or do anything else, and the only thing left is to throw the card.

## What was wrong
In 1.10.1 I moved that button into the page only at the end of a hand or a match. During play it was still **fixed to the bottom-right corner of the screen**, and a crowded floor pushes the action buttons down to exactly that part of a phone screen, so it floated on top of them. I fixed the place where I had seen it and did not ask where else a fixed element could land on a button. That was my miss.

## What changed
- **The floating button is gone, everywhere.** The same button is now a normal button in the page, at the bottom (after "How to play"), whenever it is available (after both sides have moved), and it opens the same "something felt off" panel. Nothing in the two game screens is fixed to the screen any more, so nothing can sit on top of a button.
- Both the two-player and the four-player screens.
- The trade-off: you now scroll to the bottom of the page to find that button, instead of it always being in the corner. The panel it opens is unchanged.

## Apply
**This is a website change only** (the engine and the API are not touched). 24 files (paths start with `projects/`): for this change `seep-web/src/app/pages/two-player/two-player.component.html`, `four-player/four-player.component.html`, the guard test `core/__tests__/end-of-hand-layout-wiring.test.ts` and `version.ts` (**1.10.2**) with its guard test; the rest are the earlier changes of 1.9.6 to 1.10.1. No migration, no setting, and `styles.css` is not touched.
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.10.2.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
`verify-release.sh` should end with "Release 1.10.2 is complete". The tests should report **1,264** passing in total (engine 316, API 480, website 468). `release-1.10.2.sha256` and `verify-release.sh` are only for checking; do not commit them.

## After deploying
Play until the floor is crowded (a dozen cards or more), select a hand card and floor cards, and check that Capture, Build house, Add / break house and Throw can all be pressed at any scroll position, with nothing floating over them.

## Verified
- **Your problem, reproduced first** with a test that builds a crowded floor (13 cards) on a 390 x 790 phone screen, selects a card and floor cards, scrolls through the whole page and, wherever an enabled button is fully on screen, checks three points along it (left, middle, right) to see whether something else is drawn on top. Against 1.10.1 it fails 10 of its 18 checks: **Throw was fully covered at two scroll positions and Capture partly covered at another**, and the floating button was the cause. Against this release it passes all 18, twice, on both game screens.
- **The layout test from 1.10.1** (the end of a match and of a hand, 52 checks) still passes, twice.
- **I looked at screenshots** of the crowded floor at the top of the page and scrolled to the bottom: all four action buttons are in plain view, and the button is in the page at the bottom, covering nothing.
- **Guard tests** rewritten, and **six deliberate breakages** all caught (the floating button back, the in-page button shown only at the end of a hand, something fixed to the screen again, the in-page button missing, the results table open from the start, the empty floor box back).
- **Whole suites:** engine 316 (unchanged), API 480, website 468. Strict compile and the Angular and TypeScript lint rules are clean on all 24 files.

## Something I noticed and did NOT change
On a crowded floor the page is taller than the screen: your hand and part of the action buttons can sit below the first screen, so you scroll between picking floor cards and pressing Capture. A fixed action bar could make that easier. It is an enhancement, so I have not touched it; tell me if you want it.

## NOT verified
- A real phone with your own stylesheet. As in 1.10.1, the layout tests use a fuller copy of the stylesheet that I found in my working folder (dated 2 October), because the `styles.css` I have lacks the floating button's rule. Nothing in this release depends on that rule, because the floating button no longer exists, but spacing could differ slightly from yours.
- The older whole-app browser tests were lost when my working environment restarted.
