# Seep — Angular workspace (Phase 1)

This is the Angular rebuild of the Seep web app, per `Seep-4Player-Technical-Specification.docx`
(v0.2). This delivery covers **Phase 1 only** (spec §13, item 1): the pure migration of the
existing two-player game to Angular, with the landing page routing to it. No rules or gameplay
behavior changed in this phase.

## What's here

```
projects/seep-engine/   Framework-agnostic rules engine (no Angular imports). Ported verbatim
                         from the original React app's src/game/*. Same public API, same Vitest
                         unit + fuzz tests (22/22 passing, unchanged).
projects/seep-web/      The Angular application: landing page ("/"), the two-player game
                         ("/two-player"), and a placeholder for the four-player game
                         ("/four-player") that Phases 2-4 of the spec will build out.
```

## Running it

```bash
npm install
npm start         # ng serve — dev server at http://localhost:4200
npm test          # vitest — engine unit + fuzz tests
npm run lint       # eslint . — zero warnings/errors currently
npm run build      # ng build seep-web — production build to dist/seep-web/browser
```

## Notable implementation choices

- **Tailwind v4** is wired into the Angular build via `@tailwindcss/postcss` (see `.postcssrc.json`),
  because the original app leaned on Tailwind utility classes throughout rather than only
  hand-written CSS. This was needed for a faithful port, not a rewrite.
- **`seep-engine` is a source-linked library**, not a published/prebuilt one: the root
  `tsconfig.json` path-maps `seep-engine` straight to `projects/seep-engine/src/public-api.ts`,
  so editing engine code is picked up immediately by `ng serve`/`ng build` with no separate
  `ng build seep-engine` step required during development.
- **State management** uses Angular signals (`signal`, `computed`, `effect`) as the direct
  equivalent of the original `useState`/`useMemo`/`useEffect` — see
  `two-player.component.ts`, which is a close line-for-line port of the old `App.tsx`.
- **Deep-linking** (`/two-player?new=1`) is already wired per spec §5.3, so the landing page's
  buttons start a fresh game immediately instead of requiring a second "Deal" click.
- **`staticwebapp.config.json`** (in `projects/seep-web/public/`) adds the SPA navigation
  fallback Azure Static Web Apps needs so that refreshing `/two-player` directly doesn't 404.
- Build output for Azure Static Web Apps' "output location" setting is `dist/seep-web/browser`.

## Deploying

Follow `Seep-Vercel-to-Azure-Migration-Steps.docx` once this repo is pushed to GitHub: create
the Azure Static Web App from the free tier pointed at this repo, set the output path above,
then add `seep.quest` as its custom domain.

## Phase 2 status (this delivery)

Added to `seep-engine`, per spec §8.1-8.4 and §8.8 — types, dealing, turn rotation, and scoring
only, no gameplay actions yet:

- `seats.ts` — `SeatId` (p1-p4), `TeamId` (teamA/teamB), the fixed turn-order rotation, and
  partner/opponent/team lookups. p1 (the human user) and p3 (their computer partner) are teamA;
  p2 and p4 are teamB.
- `fourPlayerEngine.ts` — `dealFourPlayerHand`/`startFourPlayerMatch` (misdeal-aware dealing: 4
  to the floor, 12 to each seat), `legalFourPlayerBids`/`placeFourPlayerBid`, and
  `dealNextFourPlayerHand` (deal passes to the next seat in turn order). `finishFourPlayerHand`
  resolves end-of-hand scoring (leftover floor cards to the last-capturing team, the 9-point
  qualifying minimum, sweep bonuses, and bazzi-winner detection) — it's decoupled from the actual
  turn-by-turn play actions that will call it, since those depend on the team house-ownership
  rules Phase 3 adds.
- `card.ts` gained a shared `legalHouseBids` helper (used by both engines) and `floor.ts`'s
  `House`/`FloorItem` types became generic over the owner-id type (default `PlayerId`, unchanged
  for two-player) so the same capture/house primitives can be reused as `House<SeatId>` in
  Phase 3, without forking the file.
- 26 new unit tests (`seats.test.ts`, `fourPlayerEngine.test.ts`), all passing alongside the
  original 22 — 48/48 total. Nothing in the two-player engine or UI changed.

## Phase 3 status (this delivery)

Added the actual four-player turn actions and the team-ownership rules from spec §8.5-8.6 that
govern them, on top of Phase 2's foundation:

- `playFourPlayerCapture` / `playFourPlayerBuildHouse` / `playFourPlayerModifyHouse` /
  `playFourPlayerThrow` in `fourPlayerEngine.ts` — the four-seat equivalents of the two-player
  engine's turn actions, reusing the same `floor.ts` primitives (now generic over `SeatId`).
- Every §8.5 rule implemented and covered by its own dedicated test in
  `fourPlayerActions.test.ts`: captures pooled by team, a player can only found a house for
  themselves, no self-breaking, partners add to each other's houses for free (no reserve card
  needed) while your own or an opponent's still requires one, breaking transfers ownership to the
  breaker, and breaking into a value your partner already holds merges the two into one cemented,
  multi-owner house.
- `finishMove` (private) wires these actions into `finishFourPlayerHand` from Phase 2 once all
  four hands empty — turn advances via seat rotation rather than a two-way flip.
- **A full four-player fuzz test** (`fourPlayerFuzz.test.ts`) plays complete randomized team
  matches to a bazzi. Note: the delivery plan lists the fuzz test at step 5, after the UI: I moved
  it here instead, since it's a pure engine-level test with no UI dependency, and right after the
  turn-action engine is built is the highest-value moment to catch systemic bugs — which is
  exactly what happened for the two-player engine originally. Worth knowing since it's a
  deliberate reordering, not an oversight.
- 66/66 tests passing (22 two-player + 44 new four-player), ESLint clean, production build clean.
  Nothing in the two-player engine or UI changed.

## Next steps

Phase 4 (spec UI requirements, §8.9-8.10): the four-seat Angular UI wired to this engine behind
`/four-player`, including the move-narration panel (with AI reasoning, pause/replay via a move
log) and the team-aware computer AI for all three computer seats. Phase 5: final QA pass against
the full §8.5 rule table and the assumptions in the spec's §12. The `/four-player` route still
shows the "coming soon" placeholder — the engine underneath it is now fully playable and tested,
but nothing is wired to a UI yet.
