# Phase 6, slice 6d: Seep as an iPhone web app

Seep can now be put on an iPhone's Home Screen and opens full screen, like an app: no Apple fee, no App Store review. This is a website change only (the API is untouched), with no migration and no setting.

## What a player gets
- **An icon and a name.** "Seep", with a spade playing card on the felt-green background, in the site's own colours. **The icon is a placeholder I drew**: to use a designed one, replace the four PNGs in `public/` keeping the same names and sizes.
- **A hint on the home page**, only on an iPhone or iPad in a browser: "Tap Share, then Add to Home Screen". It is never shown inside an installed app, on a desktop, or inside another app's built-in browser (Facebook, Instagram and so on, which have no such menu). "No thanks" hides it for good.
- **A friendly page instead of a browser error** when the app is opened and the site cannot be reached ("You're offline … Try again"). Nothing else is stored.
- **A note in the lobby, for installed-app users only.** A link tapped in Messages opens in Safari, not in the installed app, so the lobby says: "Did an invite link open in Safari instead of this app? Type its six-letter code here to join in the app." (The person who invites already sees the six-letter code.)
- **A tidy-up for an app left asleep.** An installed app can sleep for days still running the version it started with. When one wakes after six hours or more *on the home page, the lobby or a legal page*, it reloads itself. **It never reloads during a game**, because a game against the computer lives only in the page.

**What it does not do:** no push notifications, no offline play, no App Store listing. Those are separate pieces of work.

## Apply
This builds on the earlier Phase 6 packages, so apply it **after** `seep-learn-1`, `seep-learn-2`, `seep-learn-3-coach`, `seep-fix-house-sets` (and with `seep-version-1.8.0`, as you have been). Copy the files (paths start with `projects/seep-web/`), run `npm test && npm run lint && npm run build`, commit and push.
- **`staticwebapp.config.json` is NOT changed**, and is not in this package: the copy you sent is exactly what the site already uses. The new files are real files, so Azure serves them as themselves. (That is also why the manifest is called `manifest.json` and not `manifest.webmanifest`: `.json` is certain to be served with the right content type, so no config change is needed.)
- **Two of your own files are replaced:** `src/index.html` and `src/main.ts`. Both are the versions you uploaded, with **only additions**: seven tags in `index.html` (theme colour, manifest, Home Screen icon, "app capable", app name, status bar style), and two start-up calls in `main.ts`. If you have changed either file since you uploaded it, keep your changes and add just those lines.
- **`tools/make-pwa-icons.py` is optional**: it only redraws the icons. Skip it unless you want to regenerate them.
- Version: this is a visible feature. If 1.8.0 (and the fix) are live, **1.9.0** is the natural number; say the word and I will prepare it.

## Please test this on your iPhone (I cannot)
1. **Remove the Home Screen icon from your earlier test** (touch and hold, Remove App), so iOS fetches the new icon and name.
2. Open seep.quest in Safari: the hint card should be on the home page. Tap Share, then Add to Home Screen. The name should say "Seep" and the icon should be the spade card.
3. **Open it from the Home Screen.** Look at the top and the bottom on the home page, the Learn page, and a game: is anything hidden under the status bar or the home bar? Is the status bar dark, matching the page?
4. Sign in with **email and password** (not yet tried in the installed app) and with Google (already known to work).
5. Turn on **Airplane Mode** and open the app: you should see the "You're offline" page, then "Try again" once back online.
6. Send yourself an **invite link** in Messages, tap it, and see which app opens; then try typing the code in the lobby of the installed app.
Tell me what you see at each step and I will fix what is wrong.

## What I chose without being able to see it, and may need correcting
- **Status bar:** set to `black` (an opaque dark bar) and I deliberately did **not** add `viewport-fit=cover`. That keeps the page entirely inside the safe area, so nothing can slide under the status bar or the home bar, at the cost of a plain strip at the top. A test now forbids `viewport-fit` so it cannot be added by accident. If the strip looks wrong to you, that is the one thing to revisit.
- **Offline page versus the browser's cache:** the offline page appears when the home page cannot be fetched. If Azure marks pages as cacheable for a few hours (I believe it does), a recently visited page may simply load from the browser's own copy instead and then show the app's own errors. That is not harmful, only different; I could not check Azure's headers from here.
- **Separate storage:** an installed app has its own storage, so people sign in again there (you saw this in your test).
- **Android:** the same manifest should let Chrome offer to install it. Untested.

## Verified (in a real browser, on a rebuilt clean bundle)
- **The new journey, 28 checks:** the manifest loads as JSON; **every icon loads as a PNG of exactly the size it declares**; your original viewport and share-card tags are untouched; the hint shows on an iPhone and fits at 390 px, hides after "No thanks" and stays hidden, and never shows in an installed app, on a desktop or in Facebook's browser; the lobby note shows only in the installed app; the worker registers for the whole site and **has stored exactly one thing, the offline page**; **with the site genuinely unreachable (the server stopped), opening the home page, the lobby, a game and an invite link each shows the friendly page; the worker answers nothing but page openings**; "Try again" returns to the very page that was being opened; the stale guard leaves a two-hour sleep alone, reloads after seven hours on the home page, and never touches a game or an ordinary browser tab; no page or console errors.
- **Every older journey still passes with the worker running:** Learn 51, two-player online 143, four-player online 162, consent 33 (it watches every network request), email confirmation 26 and 3.
- **1,088 tests across the repo** (480 API, 235 engine, 373 web), none skipped; lint and strict compile clean. The 36 new unit and file tests cover device detection (iPhone Safari, Chrome on iPhone, Facebook and Instagram browsers, an iPad that calls itself a Mac, a Mac, Android), the worker's registration, the stale guard, and the files themselves (manifest fields, each icon's real size and that it is opaque, the worker's narrow behaviour, the page tags, `main.ts`, and that the hosting config is unchanged).
- **21 deliberate breakages, all caught:** 17 in the logic and files (two needed a better test of mine first) and 4 in the real browser (the hint missing from the page, the worker answering everything, the dismissal not remembered, the lobby note missing).

## NOT verified
- **Everything on a real iPhone**, and the deployed site. Safari and iOS behave differently from the Chromium I tested with; the checklist above is how we find out.
- **iOS 26's own handling** of the status bar and safe areas for Home Screen apps.

## Along the way
- **A flaw in my test setup:** the test server treated every `.json` and `.html` file as the home page, unlike Azure, which serves a file that exists as itself. I corrected the test server to follow Azure's real rule before trusting any result.
- **Playwright's "offline" switch does not reach a service worker,** so it showed the worker never falling back; I now stop the test server instead, which is what a phone with no signal really looks like.
- **My cleanup commands killed my own shell once** (a `pkill` pattern that matched the command running it), and I found the port-based cleanup in my older launcher scripts does nothing in this environment. I replaced both with exact-command cleanup. No product code was involved.
