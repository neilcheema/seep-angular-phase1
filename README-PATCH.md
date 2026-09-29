# vitest.config.ts, corrected: the include glob alone wasn't enough

## What your test run actually found
The previous patch's include-glob fix worked — local-session.test.ts was
discovered. But it then failed with `Cannot find package 'seep-engine'`.

## Why
Vitest doesn't read tsconfig.json's `paths` on its own — that mapping
(`"seep-engine": ["./projects/seep-engine/src/public-api.ts"]`) is a
TypeScript/Angular-CLI concept, not a Vite one. Your engine's own tests
never hit this because every one of them imports the engine with a
relative path (`from '../gameEngine.ts'`), never the bare `seep-engine`
specifier. local-session.test.ts is the first thing to actually import
`from 'seep-engine'` under vitest, and that's what exposed the gap.

## The fix
Added `resolve.alias`, mapping `seep-engine` to
`./projects/seep-engine/src/public-api.ts` directly — the same target
your tsconfig.json's path mapping points at, just expressed in the form
Vite's resolver understands. No new dependency needed.

## Verified properly this time
Built a directory tree matching your actual layout exactly — root
vitest.config.ts, projects/seep-engine/src/..., and
projects/seep-web/src/app/core/__tests__/local-session.test.ts in the
right place relative to it — and ran the real suite against it. All 11
test files, 170 tests, including local-session.test.ts genuinely
resolving and importing from 'seep-engine' through the alias. Re-ran 3
times for stability.

## Apply
Replace your root vitest.config.ts with this file, then
`npm test && npm run lint && npm run build`.
