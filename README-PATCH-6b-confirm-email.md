# Phase 6, slice 6b: a new account must confirm its email address

A new email-and-password account now has to confirm its email address before it can play online. Our own database holds nothing about a person until they have. **No database migration.** Website and API change together.

## What a new player sees
1. They create an account. Firebase emails them a one-time link straight away.
2. The lobby shows **"Check your email"**: where the link went, a button **"I've confirmed my email"**, and **"Send the email again"** (locked for 60 seconds after each send).
3. They open the link, come back, and tap the first button. The app re-reads the account, gets a fresh sign-in token (the old one still says "unconfirmed") and asks the server again. If it still cannot see the confirmation, it says so in plain words and the step stays.
4. They carry on as usual: choose a name, then the lobby.
- If the automatic send fails, the screen says so ("We couldn't send the email…") instead of claiming it went.
- **Google sign-in is not asked**: Google has already confirmed the address.
- **Nobody who already has an account is ever asked or locked out.** The rule is "refuse to CREATE an account row for an unconfirmed address". Anyone who already has a row is never touched, whatever Firebase says about their address.

## How it works (so you can trust it)
- **One rule, both doors.** Accounts can be created in two places on the server: the sign-in call (`POST /v1/me`) and any other request that finds no row yet. The rule is one shared function used by both, so there is no back door. A refused request answers 403 with `code: "email_not_verified"`.
- **The website asks the server.** It does not guess from Firebase's flag: it tries `/me` and shows the "Check your email" step only when the server says so. That is why existing players never see it and why the kill switch needs no website change.
- **Kill switch.** Set the Function App setting **`REQUIRE_VERIFIED_EMAIL` = `false`** and the rule is off at once for both doors, no deploy needed (Azure restarts the app when you save; allow a minute). Remove the setting, or set anything else, and it is on again. In the Azure portal: your Function App `seep-api` → Settings → Environment variables → App settings.

## Deploy
1. **Copy the files** (all paths start with `projects/`) and run `npm test && npm run lint && npm run build`. Commit and push **both halves in the same push.** (A new website against the old API works but never shows the step; the OLD website against the new API would leave a brand-new player at a plain error with no email sent, so do not deploy the API alone.)
2. **Test it with a real address you control, BEFORE telling anyone.** A Gmail "plus" address works well (for example `yourname+seeptest1@gmail.com`). Check: (a) the email arrives (look in spam too) and who it says it is from; (b) its link works; (c) "I've confirmed my email" lets you through to choosing a name; (d) an existing account still signs in with no extra step; (e) Google still works; (f) on your iPhone's installed app, the same sign-up: the link will open in Safari, then return to the app and tap the button.
3. Run the smoke script. With `FIREBASE_API_KEY` it makes **one more check (55)**: it creates a throwaway unconfirmed account in Firebase, expects the server to refuse it, and deletes it again. With tokens only it prints a note that this check is skipped and stays at 54. **If it FAILS, the rule is off or the API is old** (it says so). Your four smoke accounts already exist, so they are not affected. On a brand-new empty database the script's first sign-in would be refused; it now says why and what to do.

## Things you may want to do (optional)
- **Firebase console → Authentication → Templates → Email address verification:** you can change the sender name, subject and message. The default works. I have not seen your project's settings.
- **Housekeeping:** people who sign up and never confirm leave an unconfirmed account in Firebase Authentication (Google holds it; we hold nothing). Look through Authentication → Users now and then and delete old unconfirmed ones. I have built nothing automatic for this.
- **Privacy Policy:** I added one paragraph (confirming the address, what is held meanwhile, how to have it removed). Its "last updated" date is still 5 October 2026; if you deploy on a later day, change `lastUpdated` in `legal-config.ts`. Please include this paragraph when the policy is reviewed.
- **Version:** not bumped. This is a visible feature, so 1.8.0 would be the natural number; say the word and I will prepare it.

## Verified
- **944 tests across the repo** (176 engine, 458 API, 310 web), none skipped; lint clean; strict Angular compile clean; the API bundle builds.
- **Real-browser journeys on a freshly rebuilt clean bundle and a rebuilt test server that ENFORCES the rule:** the new confirmation journey **26 checks** with the rule on and **3** with it switched off; and the older journeys unchanged: two-player **120**, four-player **137**, consent **33**.
  The new journey covers: the step appearing; the address named; exactly one email at sign-up; none of the lobby shown; **no account row created** until confirmed; "I've confirmed" before opening the link; resend with its countdown and a locked button; the failed-send path; the phone width (360 px); the link opened and the player carried on; **an existing account whose email was never confirmed going straight in**; Google; signing out from the step and back in with no false "we sent it"; and no row for anyone who never confirmed.
- **Twenty deliberate breakages caught:** 9 on the server (either door left open, existing accounts locked out, the kill switch ignored or inverted, a confirmed newcomer refused, no machine-readable code, a 401 instead of a 403, the smoke check leaving its throwaway behind), 7 in the website's logic, and 4 on the screen (the lobby not recognising the server's answer; "I've confirmed" skipping the server; the resend never locking; the panel claiming "we sent a link" when nothing was sent).

## NOT verified
- **Real email delivery.** The browser tests use a stand-in for Firebase; no real email was sent. Whether Firebase's email arrives, how fast, whether it lands in spam, and what the link page looks like with seep.quest are exactly what step 2 above is for. Firebase may also limit how many emails it sends; I have not looked up its quota.
- **The real look** of the new step with your stylesheet, and on the iPhone installed app.
- **Production.** The server part has not run against your real Azure and Neon until you deploy.

## Mistakes along the way
- My new smoke-script tests first failed because they started more tables per hour than the allowance; I raised the allowance for that test file only.
- Two of my own test steps were wrong (a form still in "create account" mode after signing up; an over-strict count in a self-check). The app was right each time.
