# Version bump: 1.2.0 -> 1.3.0

## What changed
One line: APP_VERSION in version.ts.

## Why 1.3.0
Since 1.2.0, Phase 2 shipped in full: both game pages are now wired to
a GameSession abstraction (LocalSession / LocalFourPlayerSession) instead
of calling the engine directly, the acknowledge-gated reveal pacing fix,
and the four-player table now rotates around whichever seat the viewer
is in rather than assuming P1. This is real architectural groundwork for
online play, not a rules or UI change on its own, but it's a meaningful
enough shift to warrant a minor version bump rather than a patch one.

## Also worth doing, whenever convenient
The root package.json's "version" field and the landing page footer (if
it shows a hardcoded version rather than importing APP_VERSION) should
be updated to match — same two spots flagged in the 1.2.0 bump, still
outside what I can reach without those files.

## Apply
Copy this file to projects/seep-web/src/app/version.ts, then
`npm run build`.
