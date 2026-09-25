# Add Microsoft Clarity analytics

## What this does
Initializes Clarity once, at the app root, so it tracks visits across the
landing page and both games for the whole session — not per-route. Skips
initialization entirely on `localhost`/`127.0.0.1` (i.e. `ng serve`), so
your own dev-testing sessions don't show up in your real usage data.

## Setup steps (in order)

1. **Create your Clarity project** at https://clarity.microsoft.com if you
   haven't already — sign in with a Microsoft account, add a new project
   for seep.quest.

2. **Get your project ID**: in the Clarity dashboard, go to your project
   → Settings → Overview. Copy the project ID shown there.

3. **Install the package** — from your repo root:

       npm install @microsoft/clarity

4. **Apply this patch**: copy `app.component.ts` into your repo at
   `projects/seep-web/src/app/app.component.ts` (full-file replacement —
   it's a tiny file, this just adds the Clarity import and init call to
   the existing minimal component).

5. **Paste in your project ID**: open the file and replace
   `'YOUR_CLARITY_PROJECT_ID'` with the actual ID from step 2.

6. **Build, verify, deploy**:

       npm run build
       npm run lint
       git add .
       git commit -m "Add Microsoft Clarity analytics"
       git push

7. **Confirm it's working**: once deployed, visit seep.quest yourself,
   click around a bit, then check the Clarity dashboard — recordings
   typically show up within a few minutes.

## Note on cookie consent
By default, a new Clarity project doesn't require explicit cookie
consent. If you want stricter compliance later (a cookie-consent banner
gating tracking), Clarity has a `Clarity.consentV2(...)` API for that —
not wired in here since it adds real UI complexity (a banner, user choice
persistence) that isn't needed for a project at this stage. Worth
revisiting if this ever gets meaningfully more traffic or a paid tier.

## Verified here
This is a two-line functional change to an already-simple file. I don't
have the full Angular workspace in this sandbox to run `npm install` or
`ng build` against it directly — reviewed by hand, but `npm run build`
on your end (after installing the package and adding your project ID)
is the real confirmation.
