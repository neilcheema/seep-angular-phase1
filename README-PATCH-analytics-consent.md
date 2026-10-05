# Analytics consent for Microsoft Clarity (option B), and the rewritten Privacy Policy

Clarity will run **only for visitors who press Accept, once the old way of loading it is removed (see step 1)**. Until then nothing is loaded, nothing is sent to Microsoft, and no analytics cookie exists.
Website only: no database change, no API change.

## DO THESE IN THIS ORDER (the first one is the most important)
1. **Stop the app loading Clarity by itself, in the SAME deploy.** I found where: `projects/seep-web/src/app/app.component.ts` imported `@microsoft/clarity`, held your project id and called
   `Clarity.init(...)` in its constructor, so Clarity started for EVERY visitor the moment the app opened. **This zip contains that file with Clarity removed. It is your file with ONLY
   deletions** (the import, the project-id constant, and the constructor, whose only job was to start Clarity); the `@Component` part is untouched. Copy it over yours. Then run
   `npm uninstall @microsoft/clarity` so the package is gone from `package.json` and `package-lock.json` (the new loader does not use it: it adds the Clarity script itself, only after a visitor presses Accept).
   **Your old rule is kept:** the old code skipped Clarity on `localhost` and `127.0.0.1` so your own testing does not pollute real usage data. The new loader does the same, so on your own
   machine there is no banner and no analytics. (To test the banner locally, change `isLocalDevelopment` in `core/analytics-consent.ts` temporarily.)
   **If Clarity is still started by any other code after this deploy, it loads before anyone is asked, and the new policy is false.** Step 6 below (the Incognito check) proves it is gone.
2. **Your Clarity project id is already set** to `yo1jcfvwdm` in `src/app/core/analytics-config.ts` (taken from that same file; it is not secret). Change it only if you move to a different project.
3. **Look up how long Clarity keeps recordings** in your Clarity project's settings, and put the number in `legal-config.ts`:
   `retentionDays: 30` (use your real figure). Until you do, the policy says "for the time set in our Clarity project" without a number. Never guess it.
4. **In the Clarity dashboard, set masking to the strictest setting that suits you** (look for Masking in the project's settings). The lobby is already marked
   `data-clarity-mask="True"` in this package, but a project-level setting is the stronger protection.
5. Copy the files over your repo, run `npm test && npm run lint && npm run build`, commit and push.
6. **Check it on the live site, in a fresh Incognito window** (F12 -> Network, with "Disable cache" ticked, and Application -> Cookies):
   - Before pressing anything: **no request to clarity.ms** and **no `_clck`, `_clsk`, `CLID` or `MUID`**. This confirms step 1 worked.
   - Press **Accept**: `clarity.ms` appears, and the cookies are set.
   - Open **Privacy choices** (foot of the home page) and press **Decline**: the page reloads, `_clck` and `_clsk` are gone, and clarity.ms is no longer requested.
   - In your normal browser (which has the old cookies), the first visit should remove `_clck` and `_clsk` unless you accept.
7. **Decide about data already collected.** Everything Clarity recorded before today was collected without asking. Removing the snippet stops new collection but does not
   delete what is there. In Clarity, delete the existing recordings (or the project's data).
8. **Have the policy reviewed** (see the lists below), and tell me anything that is wrong.

## What visitors see
- A first visit shows a short banner: "May we use Microsoft Clarity to see how people use Seep? ... It is optional: Seep works exactly the same either way."
  **Accept** and **Decline** are the same size and style. The banner does not block the page.
- The choice is remembered (in the browser's local storage, not a cookie). A **Privacy choices** link at the foot of the home page, and a button in the policy, reopen it.
- Withdrawing consent removes the Clarity cookies on seep.quest and reloads the page (the only way to stop a script that is already running).
- Visitors who still have Clarity's cookies from the old always-on setup have them removed at their first visit, unless they accept.

## The Privacy Policy changes
Rewritten or added, all in `privacy.component.html` and `legal-config.ts`:
- **Operator:** Narender Cheema. **Last updated:** 5 October 2026.
- **New: Analytics (Microsoft Clarity), only if you agree:** what Clarity records, its four cookies (listed from the same lists the code uses, so they cannot drift apart),
  that Microsoft handles it under its own privacy statement and may process it in the United States and other countries, and how to change your mind.
- **New: Activity records:** when you last used the game and last had a table open (the turn clock uses it), and the short-lived action counts used to stop abuse.
  Two things the system really stores that the old policy left out.
- **Technical records:** now says monitoring records are kept for up to 90 days (the figure you read from Application Insights).
- **Browser storage:** the sentence "We do not use advertising or tracking cookies" was not true and is replaced: Seep sets no cookies of its own unless you accept analytics;
  Google may set its own cookies as part of sign-in; and the analytics choice is remembered in local storage.
- Also updated: the short summary, why we use information, who can see it, how long we keep it, and your choices.

## How it works
- `core/analytics-consent.ts` holds every rule as plain code (no browser objects) so each one is tested. `core/analytics.service.ts` connects it to the page.
- A **shell** wraps every route (`app.routes.ts`), so the banner appears on every page, including one reached through an invite link. The shell uses `display: contents`,
  so it adds no box and the pages lay out exactly as before. I could not edit your root component (it is not in my copy of the code), which is why it works through the routes.
- **Safe by default:** no valid project id means no banner and nothing loads. An invalid id is refused with a console warning, so a typo cannot load a stray script.
- Clarity's own consent settings are not used: loading is gated entirely, so before Accept the script is simply not on the page.

## Verified
- **892 tests across the repo** (176 engine, 430 API, 286 web), none skipped; lint clean (your exact toolchain); strict Angular compile clean.
- **25 tests of the consent rules**, one by one (including that a developer's own machine never runs analytics): nothing loads before a yes; Decline is remembered and loads nothing; Accept loads once; a returning visitor who agreed is not asked
  again; a changed notice asks again; withdrawing removes cookies and reloads; old cookies are cleared; no id means nothing happens; a bad id is refused; blocked storage and junk
  in storage are handled. **10 guard tests** keep the policy honest (the false sentence cannot come back; the operator is not the placeholder; the config line is valid).
- **A real-browser journey of 33 checks**, using a stand-in script so the real Clarity is never contacted and every request can be seen: no request and no cookie before a choice;
  Accept and Decline are the same size and style; Decline holds across reloads; Accept loads once; withdrawing stops and clears; accepting again works; leftover cookies are removed;
  the policy names Clarity and all four cookies; the lobby is marked for masking; and the banner covers no game link and causes no sideways scrolling at 1280 and 360 px.
- The two **game journeys are unchanged at 111 and 116 checks**, so wrapping every route in the shell did not disturb the game.
- **Nineteen deliberate breakages caught:** 17 in the rules, the policy wording and the config line (loading before consent, forgetting a refusal, leaving cookies behind, not reloading on
  withdrawal, ignoring a saved refusal, accepting a bad id, a stale notice still counting, loading twice, and more), and 2 on the screens (Decline made less prominent than Accept;
  the banner never starting).

## NOT verified
- **Your deployed site.** I have checked the cleaned `app.component.ts` only by compiling it with the rest of the app and linting it (both clean). Whether Clarity is really gone on the live site is what the Incognito check in step 6 shows.
- **Your real Clarity project.** The journey uses a stand-in script. I have not seen the real Clarity load, or confirmed that it honours the masking marker.
- **The real look.** My test page does not load your app's real stylesheet, so I have only seen the banner unstyled at phone width. Please look at it on your real site on a phone.
  The "Privacy choices" link inherits the home page footer's style (10 px, dim), which is hard to see; you may want to enlarge it.
- **What the policy says about Clarity** (what it records, approximate location, that Microsoft may process data in the US and elsewhere) comes from my general knowledge, not
  from Microsoft's current documentation. Check it against Microsoft's own pages.
- **Whether a plain Accept/Decline banner is enough** for visitors in every region (for example the EU and UK) is a question for the person who reviews your policy.

## Known limits
- Withdrawing removes the Clarity cookies on seep.quest. The two on clarity.ms (`CLID`, `MUID`) belong to Microsoft and can only be cleared in the browser's settings; the policy says so.
- Withdrawing does not delete recordings already made; that is done in Clarity.
- On a first visit the banner sits at the bottom of the screen and can cover controls there until it is answered.
- I have not bumped the app version. This is a visible change, so if 1.6.0 is already live, the next number would be 1.7.0.
