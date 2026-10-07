# App version 1.9.1

A small release on top of **1.9.0, which is live**. It contains one fix, plus the version number. The two files in this zip change only the version number and its guard test; the fix itself is in `seep-fix-reveal-popup.zip`.

## What 1.9.1 fixes
When a house or capture was large (16 cards in your screenshot), the pop-up that shows each move ("Cementing house") grew taller than the phone, had its title cut off and no scroll bar, so the Next button at the bottom could not be reached. It is fixed in both game screens (two-player and four-player): the box can never be taller than the screen and scrolls inside; Next stays stuck to the bottom of the box so it is always on screen; and more than six cards are shown smaller, so a normal big house fits without scrolling. A reveal of six cards or fewer looks exactly as before.

## Apply
1. **`seep-fix-reveal-popup.zip` first.** Its two templates (the two-player and four-player screens) already carry all the 1.9.0 changes to those screens, so they go straight on top of what is live.
2. **Then this zip:**
   - `projects/seep-web/src/app/version.ts`: the same file as the 1.9.0 one with **one line changed** (`APP_VERSION = '1.9.1'`). If you have edited it, keep your edits and change only the number.
   - `projects/seep-web/src/app/core/__tests__/version.test.ts`: the same guard, with its floor raised: three plain numbers, and **not older than 1.9.0** (it was 1.8.0).
3. Optional, if you keep it in step: `"version": "1.9.1"` in your root `package.json`.
4. `npm test && npm run lint && npm run build`, commit and push.

**It is a website change only: no API redeploy, no migration, no setting.** Leave `MIN_CLIENT_VERSION` unset: nothing here is needed by every player.

## After deploying
- The landing page footer reads **v1.9.1** (and the "notice something off?" note includes `Version: 1.9.1`). Someone who already has the site open stays on 1.9.0 until they reload; an installed iPhone copy reloads itself after a long sleep, but never mid-game.
- **Try the thing that went wrong:** in a two-player game, build up a big house and add to it. The pop-up should fit on the screen (cards smaller), and Next should be tappable. Turn the phone on its side too: the box should scroll and Next should stay visible.
- If you did not already: check on a phone, in an online game, that the 💬 reactions button can still be tapped while the tray is open (see the pop-up package's notes), and send me your current `projects/seep-web/src/styles.css` so my tests can use the real stylesheet.

## Checked
- Strict compile clean and the compiled output reads 1.9.1; lint clean; **1,120 tests pass across the whole repository** (253 engine, 480 API, 387 web), none skipped.
- The guard test **fails** on `v1.9.1`, `1.9`, `1.9.1-beta` and `1.8.9` (below the new floor), and passes on `1.9.1`.
- A real browser loads the landing page on a freshly built bundle: the footer shows **v1.9.1**, with no page errors.
- The pop-up journey passes on this exact build (**44 checks**: both game screens, an iPhone 390 x 844, a small phone 360 x 640 and a phone on its side 844 x 390). On the OLD templates the same journey fails exactly as your screenshot shows (the box from -86 to 930 on an 844 screen, Next below the edge).
- The new `version.ts` differs from the 1.9.0 file I delivered by exactly one line.

## NOT checked
- The deployed site, and a real phone: I have not seen the fix on one. My tests use a copy of your stylesheet dated 28 September and a card size measured from your screenshot.
- Your actual repo (if `version.ts` has changed since 1.9.0, apply only the one-line change) and your root `package.json`.
