# Install guides on the home page

Two one-page PDF guides, "Put Seep on your iPhone" and "Put Seep on your Android phone", now sit at the bottom of the seep.quest home page, on their own line directly above the version and Privacy / Terms line:

> Put Seep on your phone's home screen: **iPhone guide** · **Android guide** (one-page PDFs)

Each link opens its PDF in a new tab. Each guide has numbered steps with simple pictures, the app icon to look for, a QR code that opens seep.quest, and tips (signing in again, what to do with an invite link, how to remove it).

## Two decisions I made, easy to change
- **Their own line, a little larger and in gold,** not squeezed into the existing 10-pixel faint line. In that line they would be nearly unreadable for exactly the people who need them. The Privacy / Terms line is unchanged.
- **Hidden once Seep is installed.** Someone running Seep from their Home Screen doesn't need the guide, and a PDF opened inside the installed iPhone app has no browser controls to get back with.

## Apply
Five files (paths start with `projects/seep-web/`), all on top of 1.9.0 (the landing page files already carry the Learn card and the install hint):
- `public/Seep-on-your-iPhone.pdf` and `public/Seep-on-your-Android-phone.pdf` (new)
- `src/app/pages/landing/landing.component.html` and `.ts`
- `src/app/core/__tests__/install-guides.test.ts` (new)
Then `npm test && npm run lint && npm run build`, commit and push. **A website change only: no API redeploy, no migration, no setting, no change to `staticwebapp.config.json`.** Your build copies everything in `public/` to the site (`"glob": "**/*"`), so the PDFs are published automatically. If you want it numbered, it fits as 1.9.2 (or ship it together with 1.9.1); say the word and I will prepare the version package.

## After deploying
- Open **seep.quest/Seep-on-your-iPhone.pdf** and **seep.quest/Seep-on-your-Android-phone.pdf** directly: each should show the guide. (If a PDF were ever missing, your routing rule would quietly show the home page instead of an error, so this is worth one look.)
- On a phone, scroll to the bottom of the home page and tap each link.
- In the installed iPhone app the guides line should not appear.

## Checked
- **1,127 tests pass across the repo** (253 engine, 480 API, 394 web), none skipped; strict compile and lint clean.
- **A 7-test guard** (fails on the old home page): both PDFs exist and are real PDFs of sensible size; each link has the right file name, opens in a new tab with `rel="noopener"`; the block is shown only when Seep is not installed; the legal links are still there, after the guides.
- **Real browser, on an iPhone-sized screen (8 new checks):** both links are present; each really delivers a PDF (the right content type and the `%PDF` marker, 166 and 162 KB); both fit at 390 px with nothing scrolling sideways; Privacy and Terms are still there; tapping the iPhone guide opens a new tab that fetches the PDF while the home page stays put; inside the installed app the guides are not shown; and the line reads as a sentence (it found a missing space I had left, "guide(one-page PDFs)", which is fixed).
- **Four deliberate breakages, all caught:** guides shown in the installed app; a link to a file that does not exist; a link that no longer opens in a new tab; a lost separator.
- **Every browser journey still passes** on the final build: iPhone app and guides 37, Learn 124, pop-up 44, two-player online 147, four-player online 166, consent 33, email confirmation 26 and 3.

## NOT verified
- **On a real phone**, and the deployed site. My picture of the footer uses a stylesheet copy dated 28 September.
- **The Android steps in the guide.** They follow Chrome's documented behaviour but have not been tried on an Android phone.
- **How a PDF opens on each phone.** An iPhone shows it in Safari's viewer. Android Chrome may offer to download it instead; both are fine, but I have not seen it.
- **The guides are static.** If Apple's or Google's menus change, or a Seep label changes, they need updating (the labels used are **Play online**, **Join a table**, **Table code** and **Join**).
