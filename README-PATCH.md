# App versioning: v1.1.0

## What this adds
- A single source of truth for the app's version (`version.ts`).
- A small, unobtrusive version number at the bottom of both game pages
  (below "How to play").
- The version included in every "notice something off?" report email, so
  any report you get can always be tied back to the exact build it came
  from — this was the main practical reason to add versioning now, not
  just cosmetic display.

## Why 1.1.0
Treating everything already live before this conversation's changes
(mandatory maximal capture, mandatory maximal build, the mobile side-hand
layout, Clarity analytics, the rule-note feature, etc.) as an implicit
baseline "1.0.0", this round — the maximal-capture and maximal-build rule
corrections plus the smarter AI — is a real behavior/rule change, not just
a bug patch, so I bumped the minor version rather than the patch version.
Adjust this if you'd prefer a different starting number or scheme; it's
just a string in one file from here on.

## Files included (safe to apply directly)
- `version.ts` — new file, the single source of truth.
- `four-player.component.ts` / `.html` — full-file replacements, carrying
  forward every previous fix, plus the version import/display/email
  inclusion.
- `two-player.component.ts` / `.html` — same.

## Two things I did NOT touch, and why
I don't have your current `landing.component.html` or
`projects/seep-web/package.json` in front of me in this session, and
guessing at their exact content risked silently clobbering something.
Instead, here's exactly what to add by hand — both are small, quick edits:

### 1. `projects/seep-web/package.json`
Find the `"version"` field and set it to match:

    "version": "1.1.0",

### 2. `projects/seep-web/src/app/pages/landing/landing.component.html`
Add this near the bottom of the template, just before its final closing
`</div>` (matching the same small, muted footer style used on the game
pages):

    <div style="text-align: center; padding: 4px 0 10px; font-size: 10px; color: rgba(255,255,255,0.3);">
      v1.1.0
    </div>

If you'd rather this pull from the same `version.ts` constant instead of
being a hardcoded string (so you only ever update one file per release),
add this import to `landing.component.ts`:

    import { APP_VERSION } from '../../version';

and a field on the class:

    readonly appVersion = APP_VERSION;

then use `v{{ appVersion }}` in the template snippet above instead of the
literal `v1.1.0`. This is exactly the pattern used in both game
components — recommended if you want true single-source-of-truth
versioning, but I left the landing page as a plain hardcoded string
option too, since I can't see the file to wire up the class field myself.

## How to apply
Copy the four `.ts`/`.html` files into your repo at the paths shown, add
`version.ts`, make the two manual edits above, then:

    npm run build
    npm run lint

No engine changes in this patch, so no `npm test` needed — this is purely
version plumbing and display.

## Verified here
Grepped all four files to confirm consistent single-reference usage of
`appVersion`/`APP_VERSION` with no naming collisions. As with every
UI-touching patch: no full Angular workspace in this sandbox to run
`ng build` against directly — reviewed by hand.
