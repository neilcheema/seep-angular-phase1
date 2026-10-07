# Fix: the "Cementing house" pop-up could be taller than the phone, with no way to reach Next

## What you reported
Playing the computer in two-player, you built up a big house. When you added to it, the pop-up that shows each move listed every card in the house (16 in your screenshot), grew taller than the screen, cut off its own title at the top, and had **no scroll bar**, so the button at the bottom could not be reached.

## What was wrong
The pop-up (the "move reveal") was a box centred on the screen with no maximum height and no scrolling, holding three groups: the card played, every card of the house or capture, and a Next button. With a handful of cards that is fine. With a big house it is not. **Both game screens have the same pop-up, so four-player had the same problem.** I had never tested a large one; the biggest reveal I had looked at was a few cards.

## What changed (two templates and one guard test; no stylesheet, no server)
1. **The box can never be taller than the screen.** It is limited to the screen height (using the browser's dynamic height, so it follows the browser bars as they come and go) and scrolls inside.
2. **The Next button stays stuck to the bottom of the box**, so it is always on screen, however many cards there are.
3. **More than six cards are shown smaller** (about 60%), so a normal big house fits without scrolling at all. At your phone's size the whole 16-card house now fits with room to spare. A reveal of six cards or fewer looks exactly as before. (If a browser ignores the shrinking, the box simply scrolls.)

## Apply
Three files (paths start with `projects/seep-web/src/app/`): `pages/two-player/two-player.component.html`, `pages/four-player/four-player.component.html` and `core/__tests__/reveal-popup.test.ts`. The two templates also carry the earlier changes to those screens (the hint, the coach, the rules text), so apply this **after** `seep-learn-3-coach`, `seep-fix-house-sets` and the others in the 1.9.0 list, and before `seep-version-1.9.0`. Then `npm test && npm run lint && npm run build`, commit and push. No migration, no setting, no server change, no version change: it belongs to 1.9.0.

## Verified
- **Your bug is reproduced, then fixed.** A browser test opens a 16-card reveal on an 844-high iPhone. On the OLD templates the box runs from -86 to 930 on an 844 screen, the title is cut off and the Next button is below the bottom edge, exactly as in your screenshot. On the new ones the box fits, and the whole house shows without scrolling (599 high).
- **A 44-check browser journey**, run on both game screens at three phone sizes (an iPhone 390 x 844, a small phone 360 x 640, and a phone on its side 844 x 390): all 16 cards are there; the box fits on the screen; the Next button is on screen without scrolling; scrolled to the end, the last card and Next are both on screen; scrolled back to the top, the title is on screen; and tapping Next closes the pop-up. An ordinary 3-card reveal is unchanged: no scrolling, normal card size.
- **Four deliberate breakages, all caught:** removing the height limit; unsticking the Next button; not shrinking large houses; and shrinking every reveal.
- **A permanent guard test (6 tests):** it fails if the height limit, the scrolling, the stuck button or the shrinking is removed from either screen; all 6 fail on the old templates.
- **1,120 tests across the repo** (253 engine, 480 API, 387 web), none skipped; lint and strict compile clean; every other browser journey still passes (Learn 121, iPhone app 28, two-player online 147, four-player online 166, consent 33, email confirmation 26 and 3).

## NOT verified
- **On your phone.** The test uses a copy of your global stylesheet and a card size I measured from your screenshot (about 78 x 110 points, three to a row). It reproduces your picture on the old code, but it is not your real screen.
- The stylesheet copy is dated **28 September**; I do not have the current one (see below).

## Two things I found while testing, both about MY test setup
1. **My browser tests never loaded your site's global stylesheet**, and the card component in my working copy is an empty stand-in with no size. So until now my journeys' layout checks (a phone-width fit, a tray on screen) ran without the real styles and without real-sized cards: weaker than I described them. Your phone is what caught this bug. Only the new pop-up journey loads a stylesheet copy and card size.
2. **A possible problem I cannot confirm.** With that old stylesheet copy, on a 1280 x 720 screen, the open reactions tray (pinned to the bottom-right) covered the 💬 button that closes it. The stylesheet copy is from before reactions existed, so this may only be an artefact. **Please check on your phone, in an online game: open the reactions tray; can you still tap the 💬 button to close it?** If you can **upload your current `projects/seep-web/src/styles.css`**, my tests will use the real one and I can answer this properly.
