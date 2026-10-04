# Phase 5, slice 5b: delete your account, Privacy Policy, Terms of Use

## READ THIS FIRST: the order matters
1. **Run `projects/seep-api/db/005_phase5_account_deletion.sql` in Neon (production, then dev) BEFORE you deploy.**
   The new API reads a table that this creates. Deploy the API first and **sign-in breaks for everyone** until the
   migration is run. (It only creates a small table; it is safe to run twice.)
2. Apply the engine patch: `git apply forfeit-reason.patch` (11 lines added, 7 removed; checked to apply cleanly).
3. Copy the other files in this zip over your repo.
4. `npm test && npm run lint && npm run build`, commit and push.

## What players get
- **Delete my account** (Play online, bottom of the page). A panel says what will happen. The person types DELETE and,
  for an email account, their password (a Google account confirms in the Google window). It cannot be undone.
- **What deleting does:**
  - A match in progress is **forfeited**; the opponent (or the other team) wins, and the log says the person *left*.
  - A table still waiting for players loses their seat and **stays open for the others**; it closes only if nobody is left.
  - Finished tables stay for the other players, with the person's link and name removed, until the normal cleanup removes them.
  - Their name and email are erased from our database, and their sign-in record at Google is deleted.
- **The order is safe to interrupt:** (1) confirm it is really them (a wrong password stops here, nothing changed),
  (2) erase our records (safe to repeat), (3) delete the sign-in record. If step 3 fails they just try again.
- **A deleted account cannot be quietly brought back.** Every game call used to *create* a user it did not know, email
  included, so a browser tab still polling with a valid token (good for up to an hour) would have restored the record. A small
  marker (an anonymous id only) now blocks that; the daily cleanup removes it after 48 hours.
- **Privacy Policy** (`/privacy`) and **Terms of Use** (`/terms`), linked from the sign-in screen, the lobby and the home page footer.
  The sign-in screen says "By continuing you agree to the Terms and Privacy Policy".
- The "table closed" message now covers both reasons: idle for days, or someone at the table left.

## Why a POST and not a DELETE
Deletion is `POST /v1/me/delete`. My first version used `DELETE /v1/me`, and the browser blocked it in my test server. Whether
**Azure's own CORS setting** lets DELETE through was never verified, and my tests would pass either way. POST is exactly what every other
call your browser already makes successfully against production uses, so this depends on nothing untested.

## BEFORE YOU PUBLISH THE LEGAL PAGES (these are drafts, not legal advice)
Have someone qualified read them. And:
1. **Put your name in.** `projects/seep-web/src/app/pages/legal/legal-config.ts`: `operator` (currently the generic "the operator of
   seep.quest"), `contactEmail`, `governingLaw` (currently British Columbia: confirm it), `lastUpdated`.
2. **Check what the site loads from elsewhere.** I could not see your `index.html` or global styles, so I could not verify the claim
   "We do not use advertising or tracking cookies", or whether the site loads fonts or scripts from other sites. Run
   `grep -n "googleapis\|gstatic\|gtag\|analytics\|<script" projects/seep-web/src/index.html` (and check your styles). If it does load
   something (Google Fonts, for example), add a sentence to the policy.
3. **Say how long technical logs are kept.** The policy says "a limited time" because I do not know your Application Insights
   retention. Find it (Function App, Application Insights, Usage and estimated costs, Data retention) and state it.
4. The policy names the Office of the Information and Privacy Commissioner for British Columbia as a complaints body. Confirm that
   is right for how you operate.
5. **Acceptance of the Terms is not recorded** (notice-and-continue only). Fine for a small hobby site; say so if you ever need proof.
6. There is no "download my data" button. The policy says to email you. That is a promise you must be ready to keep.

The retention numbers in the pages (7 days, 30 days, 48 hours) and the turn clock wording (one minute / two) are checked by a test:
if the server's real defaults change without the pages, the test fails instead of the policy quietly becoming untrue.

## Try it in production (10 minutes). The smoke test does NOT cover deletion
1. Make two throwaway email accounts, X and Y, on two browsers. Choose names. X starts a 2-player table; Y joins; make a move.
2. As X: Delete my account. Try Delete with nothing typed (refused), then a wrong password (refused: "That password isn't right.", still signed in),
   then the right one. X is signed out with a confirmation.
3. As Y, within about 10 seconds: the match has ended, and the log says the other player **left the game and forfeited the match**.
4. Try to sign in as X again with the same email: Firebase has no such account any more. "Create an account instead" makes a brand-new one,
   which asks for a name and has no old tables.
5. Optional, in Neon's SQL editor: `SELECT count(*) FROM users WHERE email = 'x@your-address';` should be 0, and `SELECT * FROM deleted_accounts;`
   shows one anonymous id, which disappears after 48 hours and the next daily cleanup.
6. Repeat once with a Google account (the re-confirmation is a Google window).
Then run the smoke test as before: **41 of 41**.

## Verified
- **660 tests across the repo** (176 engine, 303 API, 181 web), none skipped; lint clean (your exact toolchain); strict Angular compile
  clean; the API bundle builds.
- **Real browsers** (two-player journey 88 checks, four-player 97, no unexpected errors): the deletion panel's wording; DELETE must be typed; a
  wrong password stops it with nothing changed; a successful deletion mid-match, with the opponent's screen showing the match ended because the
  person *left*; a still-valid token refused (403); both legal pages by link and as deep links after a hard reload; coming back as a brand-new account.
- **Deliberate breakages, all caught by the right tests:** 12 on the server (wrong forfeit wording, wrong loser, person left linked to their seats,
  email left behind, no marker, game calls or sign-in re-creating a deleted user, a leaver closing a waiting table, a stuck match blocking deletion,
  deletion not in a transaction, markers never purged, markers purged too early) and 2 on the screens (skipping the re-confirmation, skipping the typed DELETE).
- The deletion is tested all-or-nothing: if its last step fails, the forfeit, the unlinking and the marker are all rolled back.

## NOT verified
- **Your production CORS and Azure behaviour for the new route.** It is a POST like the others, but I could not test it against your Azure.
- **Real Firebase** re-confirmation and account deletion (the test harness fakes both). Step 6 above is the check.
- **The deletion on real Neon.** The smoke script does not exercise it (see the production steps above).
- Four real people, as before.

## Known limits
- No smoke-script check for deletion: it would burn a shared test account. A throwaway-account version is possible later.
- A person who deletes their account loses it permanently, with no grace period.
- Finished games stay for opponents, without the name, for the normal retention (about five weeks).
- One more note on how this was tested: a sabotage run is only meaningful if the unmodified copy passes first. Mine did not at first (a stale
  engine in my scratch copy made every "caught" result counterfeit), so I now require a clean baseline, and I rebuild the clean test bundle after
  each sabotage run.
