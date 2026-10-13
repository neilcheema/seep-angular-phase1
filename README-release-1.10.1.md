# Release 1.10.1: the end-of-match screen fits a phone, and the floating button stays out of the way

**This release replaces 1.10.0 (and 1.9.6 to 1.9.9): apply only this one.** It contains everything they did, so it works whether or not you applied any of them. Please delete the older zips.

## What I noticed on your screenshot, and have now fixed
1. **Your own point cards were below the first screen at the end of a match.** The results table sat between the floor and your cards, and an empty floor box was still taking up space.
2. **The floating "Notice something that doesn't match the rules you know?" button covered the Play again button.** It also sat on top of the summary line under your point cards ("40 card points = 40 this hand") at the end of every hand, because that line is exactly where the button floats on a phone.

## What changed
- **At the end of a match:** the empty "Floor empty" box is no longer drawn (nothing can be left on the floor), and that area gives back the space it normally keeps. The hand-by-hand table is folded away behind a tap; its heading carries the one-line summary ("Hand by hand · 2 hands itemised · hands won 2–0 · sweep points 150–0"), and tapping it opens the full table, nothing removed. On a 390 x 790 phone screen you now see the opponent's point cards, the result, **Play again**, your own point cards with their summary, and "How to play", all on the first screen.
- **The floating button:** at the end of a hand or a match it no longer floats over the page. The same button appears in the page, at the bottom, and opens the same "something felt off" panel. During play it is exactly where it was (bottom-right corner).
- Both the two-player and the four-player screens. Between hands the "Floor empty" box stays, as before.

## Two choices of mine that you can reverse
- The hand-by-hand table is folded by default. If you would rather it were open, it is one word (`open`) on `<details id="results-details">` in `match-results.component.ts`, at the cost of the point cards moving off the first screen again on a phone.
- The button is in the page only at the end of a hand or match, not during play.

## Apply
**This is a website change only** (the engine and the API are not touched in this release; if you already deployed the engine changes of 1.9.6 to 1.9.9 to the API, there is nothing to do there). 24 files (paths start with `projects/`): for this change `seep-web/src/app/pages/two-player/two-player.component.html`, `four-player/four-player.component.html`, `components/match-results/match-results.component.ts`, the new test `core/__tests__/end-of-hand-layout-wiring.test.ts` and `version.ts` (**1.10.1**) with its guard test; the rest are the earlier changes of 1.9.6 to 1.10.0. No migration, no setting, and **`styles.css` is not touched** (I could not see your current one, so I changed nothing in it).
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.10.1.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
`verify-release.sh` should end with "Release 1.10.1 is complete". The tests should report **1,264** passing in total (engine 316, API 480, website 468). `release-1.10.1.sha256` and `verify-release.sh` are only for checking; do not commit them.

## After deploying
Finish a match on your phone and check that your own point cards and Play again are on the first screen, and that the "Notice something…" button is in the page below them. Finish a single hand and check the same. During play the button should be in the corner as before.

## Verified
- **In a real browser, measured, not just looked at (56 checks, passing twice, both screens, at 390 x 790 and 1280 x 800):** at the end of a match your point cards end inside the screen, Play again is on the first screen, nothing floats over the page, the folded table opens with both hands when tapped, and tapping the in-page button opens the panel; between hands the in-page button covers neither the point cards nor Deal next hand; during play the floating button is back, fixed in the bottom-right corner.
- **The two problems reproduced first:** the same test against the 1.10.0 files fails 7 checks, including your own point cards ending at **908 px on a 790 px screen**, and a fixed button floating over the page.
- **I looked at the screenshots** of both games, at the end of a match and between hands (the phone views are attached): everything is visible, nothing overlaps.
- **Tests (7 new guard tests):** six deliberate breakages, all caught (the empty floor box back, the floating button back, the in-page button missing or not pressable, the table open from the start, the floor area keeping its height).
- **Whole suites:** engine 316 (unchanged), API 480, website 468. Strict compile and the Angular and TypeScript lint rules are clean on all 24 files.

## NOT verified
- **Your actual stylesheet.** The floating button's positioning rule is not in the `styles.css` I have, so for the browser test I used a later, fuller copy that I found in my working folder (`styles-full.css`, 2 October). It contains the rule and I believe it is close to yours, but if your file differs (card sizes, spacing), the amount of spare room on a phone could differ by a few pixels. That is why I would like you to look at it on your phone.
- A real phone, and the deployed site. The test positions are made-up hands presented to the real screens.
