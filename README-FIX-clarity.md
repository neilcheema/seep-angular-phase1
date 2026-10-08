# Clarity: it is now told that consent was given, and the Privacy choices panel shows whether it loaded

## What you reported
Clarity is enabled, but nothing has appeared in the Clarity dashboard since 5 October, the day the consent banner replaced the always-on Clarity.

## What I found, stated carefully
**I cannot see your Clarity project or your live site from here, so I cannot prove the cause.** What I could check:
- **The site's wiring is sound.** Every page sits inside the one component that starts analytics and shows the banner (including invite links and the lazily loaded online pages). After "Accept" the page requests `https://www.clarity.ms/tag/yo1jcfvwdm`; on later visits it loads again without asking. Declining loads nothing.
- **But my test was too easy, and that is a real gap.** The stand-in Clarity script in my consent test only recorded that it had been *requested*. It proved "the script loads after Accept", not "Clarity starts recording". The real Clarity can be set to wait for a **consent signal** before it records anything. Microsoft's documentation: "If your Clarity project is configured to require cookie consent, use the consent V2 API to pass the user's consent decision." Our code never sent that signal. If your project is set that way, Clarity would load, stay idle, and show nothing in the dashboard, even for you.

## What changed
1. **Clarity is told that consent was given**, using Microsoft's Consent API v2 (`consentv2`), queued just *before* the script is added, so Clarity finds it waiting when it starts, on the visit where someone clicks Accept and on every later visit. It is harmless if your project does not require it. Nothing is sent, and nothing loads, before a yes or after a no.
2. **A status line in the Privacy choices panel.** After you have accepted, "Privacy choices" now also says whether the Clarity script actually loaded **on this device**: "Clarity script: loaded on this device", or "could not be loaded… a browser extension, a network filter or a privacy setting may be blocking it". It shows what the browser did; Clarity's own dashboard shows what it recorded.
3. **My test now behaves like a Clarity that waits for the signal** (it records, and sets its cookies, only after being told both kinds of storage are granted), so a missing signal makes a test fail. On the OLD code this test fails exactly as your dashboard would suggest: the script loads, nothing is recorded.

## Apply
Four files (paths start with `projects/seep-web/src/app/`): `core/analytics-consent.ts`, `core/analytics.service.ts`, `components/analytics-banner/analytics-banner.component.ts` and `core/__tests__/analytics-consent.test.ts`. Then `npm test && npm run lint && npm run build`, commit and push. A website change only: no migration, no setting. It ships in version 1.9.4.

## What to do on your side (this is where the cause may still be)
1. **On your phone, after this is live:** open seep.quest, scroll to the bottom and tap **Privacy choices**. It should say "Your current choice: Accepted" and "Clarity script: loaded on this device". If it says Declined, tap Accept (a decline is remembered, and you may have declined on that phone). If it says "could not be loaded", something on that phone or network is blocking Clarity: tell me which phone, browser and network.
2. **In Clarity (your project's Settings → Setup, names may differ slightly):** check whether it is set to require cookie consent (this fix is for that), and check that **your own IP address is not on a blocked list**, which would hide your sessions. Then visit the site after accepting and give the dashboard a few minutes.
3. **Expect fewer sessions than before.** With a consent banner only visitors who tap Accept are recorded. Before 5 October everyone was.

## One decision for you
Accepting now tells Clarity that **both** kinds of storage are granted (`ad_Storage` and `analytics_Storage`). Clarity needs both before it sets its cookies and follows a visit across pages. Seep does not use advertising, and the banner and Privacy Policy describe Clarity as one optional choice, but if you would rather send only analytics storage as granted, say so: Clarity may then record in a more limited, cookie-free way.

## Verified
- **38-check real-browser journey** (it was 33): after Accept the script is requested once, Clarity has been told both storages are granted before it started, it records, and the cookies appear; the same on every later visit; Decline loads nothing and leaves no Clarity function behind; a blocked script makes the panel say so; the banner still never covers the game links at 360 px.
- **Four deliberate breakages, all caught:** the consent signal never sent; only one of the two storages granted; the loaded/failed status not updated; the start-up queue not created.
- **31 unit tests** of the consent rules (it was 22), including that the signal is sent before the script, once, and never before a yes or after a no.
- **1,152 tests across the repo**, lint and strict compile clean, and every browser journey passes.

## NOT verified
- **Against the real Clarity.** My environment cannot reach it, so I have not seen a single session recorded. The signal follows Microsoft's documentation; whether it is the cause of your empty dashboard depends on your project's settings, and on whether visitors (including you) tapped Accept.
