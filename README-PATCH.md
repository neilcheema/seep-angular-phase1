# Phase 1, last piece: public-api.ts was missing version.ts

## What was wrong
Every module this session touched or added is re-exported from
public-api.ts with a wildcard (`export * from './lib/gameEngine'`, etc.),
which is exactly why applyMove, Intent, viewFor, GameView,
applyFourPlayerMove, FourPlayerIntent, viewForSeat, and
FourPlayerGameView were already reachable through the `seep-engine`
import path without needing anything added here — they ride along
automatically with everything else those two files export.

version.ts — the one genuinely new file this session created — was
never added to this list. ENGINE_VERSION was real, tested, and correctly
stamped onto every GameState/FourPlayerGameState as `engineVersion`, but
the constant itself had no way out of the library. Anything outside
seep-engine wanting to compare "is this game's version the current one"
had no way to reach it.

## What changed
One line added: `export * from './lib/version';`

## Verified
Checked with the real file content, in a directory structure mirroring
your actual layout (public-api.ts next to a lib/ folder, not above it —
an early attempt at this check used the wrong relative layout and
produced a misleading error for a reason that had nothing to do with the
fix). With that corrected, tsc resolves ENGINE_VERSION, applyMove,
viewFor, applyFourPlayerMove, and viewForSeat all successfully through
this file, exactly as `import { ... } from 'seep-engine'` would in
seep-web.

## Also worth doing, whenever convenient, no urgency
projects/seep-engine/package.json lists @angular/common and
@angular/core as peerDependencies. Nothing in seep-engine's actual source
imports anything Angular — every file across this whole project has
been plain TypeScript — so these are almost certainly leftover from when
`ng generate library` first scaffolded the project, not a real
requirement. Worth confirming and removing at some point, since a future
Node.js backend importing this same engine source would have no reason
to need them — but this doesn't block or affect anything today, and
doesn't touch your build or deploy configuration at all.

## Apply
Copy this one file to projects/seep-engine/src/public-api.ts, then
`npm run build && npm test`.
