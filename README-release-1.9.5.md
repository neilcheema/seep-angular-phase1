# Release 1.9.5: invite people to play online

You asked for a highlight on the Play online box and a popup that encourages people to play, so that they invite friends and family.

## What people will see
- **The Play online card stands out.** A gold edge, a soft glow that gently pulses, and a label on it: "Play with friends and family". For anyone whose phone or computer is set to reduce motion, it keeps the edge and label but does not pulse. It is the only card that does this.
- **A popup, once.** About 2.5 seconds after the home page appears, a box says: **"Play Seep with friends and family. Make a free table, send them the invite link, and play together from wherever you are: two players, or four in teams. A free account is needed to play online."** with two buttons, **Play online** (goes to the online lobby) and **Not now**. Escape, or a click or tap outside the box, also closes it.

**Updated after your lint run (9 October):** the first version of the popup had a click handler on its dark backdrop `<div>`, which your accessibility lint rightly refused (`click-events-have-key-events` and `interactive-supports-focus`). The click on the dark area is now heard by the component itself, which closes the popup only when the click lands on the backdrop (a click inside the box does nothing, as before). Escape and the two real buttons are unchanged, so keyboard users lose nothing. Two files changed: the popup component and its wiring test.

## Choices I made (each is easy to change; tell me)
- **It never sits on top of the privacy banner.** A first-time visitor sees the banner first; the popup comes 2.5 seconds after they have chosen. If they reopen "Privacy choices" while it is showing, it steps aside.
- **Once, then 30 days of quiet.** Closing it, or pressing Play online, or using the highlighted card itself, all count as "seen". It returns after 30 days. (The number is `INVITE_SNOOZE_DAYS` in `core/invite-prompt.ts`, the delay `INVITE_DELAY_MS`.)
- **Home page only.** Not in games, the lobby, Learn or the legal pages. People who arrive by an invite link go straight to the lobby and never see it.
- **It does not check whether someone is signed in.** The sign-in service is part of the online area, and starting it on the home page would contact Firebase before a visitor has answered the privacy banner. So it relies on its own marker on this device instead. A test guards this (it fails if the home page or the popup ever mention the sign-in service).
- **Where I left things:** the Play online card keeps its place (last). On a phone that is below the first screen, so the popup is what makes sure people see it. If you want the card moved to the top, say so.

## Apply
Eight files (paths start with `projects/seep-web/src/app/`), all in the website. **Website only: no API redeploy, no migration, no setting.** The version becomes **1.9.5**.
```
cd ~/Desktop/seep-angular-phase1
unzip -o ~/Downloads/seep-release-1.9.5.zip
bash verify-release.sh
npm test && npm run lint && npm run build
```
`verify-release.sh` should end with "Release 1.9.5 is complete". The website's suite should report **433 tests** passing (408 before, plus 25). `release-1.9.5.sha256` and `verify-release.sh` are only for checking; do not commit them.

## After deploying
- Open the site in a **private window** (so it has no memory of you): the privacy banner appears, no popup. Choose Accept or Decline: about 2.5 seconds later the popup appears.
- Press Not now, reload: no popup. To see it again, clear the site's data, or in the browser tools delete the `seep.invite-seen` entry under Local Storage.
- Check the highlighted card on a phone, and the installed iPhone app.

## Verified
- **Strict compile** of the whole website, templates included.
- **25 new tests:** the rules (never seen, 29 vs 30 days, a changed clock, blocked storage, whether the privacy banner is out of the way) and the wiring (the card, the dialog's accessibility, the banner, the sign-in guard). **Six deliberate breakages** (popup removed, covering the banner, glow ignoring reduced motion, snooze shortened, consent ignored, sign-in service pulled in): all caught.
- **A real browser test on the built site (29 checks, passing twice in a row),** on a public-style hostname so the real privacy banner shows: the highlight; no popup while the banner is open (even after waiting longer than its delay); **nothing outside your site contacted before a choice**; the popup about 2.5 seconds after the choice; a labelled modal dialog; focus on the main button; Tab and Shift+Tab staying inside; Not now, Escape and a click outside each closing it and being remembered; no return after a reload; Play online and the card both going to the lobby, and not coming back afterwards; 5 days later still quiet, 31 days later shown again; stepping aside for "Privacy choices"; no pulse under reduced motion; clicking inside the box not closing it (and not counting as dismissing it); fitting a 360 x 640 phone with comfortably sized buttons; no page errors.

## NOT verified
- **A real phone, or the live site.** The browser test used a desktop-class Chromium on my machine, with a copy of your stylesheet dated 28 September, so spacing may differ a little from what you see.
- **Your exact lint run.** I do not have your lint configuration. I installed the Angular lint tooling with its accessibility rules, confirmed that it reports exactly your two errors on the first version of the popup (line 45, column 7, the same messages) and nothing on the fixed one, and ran it over every file this release touches. `npm run lint` on your side is still the final word.
- **The earlier whole-app browser tests** (online games, consent, Learn and the others). My test setup was lost when my working machine restarted; I rebuilt the code from your delivered packages (the rebuilt copy reports exactly your 480 + 283 + 408 tests), but I could not rerun those older browser tests. This change only touches the home page and adds one component, and the privacy and banner behaviour was checked directly above.
- **The Privacy Policy** may need a line: the popup stores one marker (the date it was last shown, as `seep.invite-seen`) in the visitor's browser. It holds nothing about the person, but you may want it in the list of what the site stores. I have not changed the policy; I can add the line.
