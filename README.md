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

## Phase 4 status (this delivery)

The four-player game is wired up end to end — `/four-player` is a real, playable table now, not a
placeholder:

- `computer4p.ts` (new, in `seep-engine`): team-aware heuristic AI for all three computer seats
  (spec §8.10) — `chooseFourPlayerBid`, `chooseFourPlayerOpeningMove`, `chooseFourPlayerMove`.
  Every decision carries a `reason` string for narration, not just the move itself.
  **One thing worth knowing**: a "cement/grow a house instead of capturing it" team-aware move
  was deliberately left out. Structurally, any card that could cement or merge toward a partner's
  house always matches an existing floor house's value — which means that same card can *always*
  just capture that house outright instead. With "always take the best available capture" as the
  AI's first priority, those team-building moves can never actually be reached; they'd only ever
  compete with a *less appealing* capture, never with "no capture." Weighing "capture now" against
  "grow the house for later" well is a real judgment call beyond a simple heuristic — the §8.5
  team ownership *rules* are still fully implemented and tested (Phase 3), a human player can use
  them, but this AI won't volunteer to grow a house when it could cash it in instead. Caught this
  via a failing test, not by inspection — worth knowing since "AI is team-aware" could otherwise
  read as a stronger claim than what's actually implemented.
- Four-seat Angular UI behind `/four-player`: `FourPlayerComponent` (state orchestration, mirrors
  `TwoPlayerComponent`'s signals/computed/effect pattern), `FourPlayerStatusPanelComponent` (team
  scores), `FourPlayerFloorItemComponent` (houses tagged "Yours" / "Partner's" / "Team B's" /
  "Shared" for multi-owner cemented houses). `CardComponent`, `PlayerHandComponent`, and
  `OpponentHandComponent` are reused unchanged from the two-player UI — they never referenced
  player-specific ids, so they needed no changes.
- **Move narration (spec §8.9)**: a persistent banner shows the latest computer move — seat,
  reason, and outcome — framed as teammate context for Player 3 ("Your partner captured..."). A
  collapsible move-log drawer lists every move of the hand; clicking any entry re-displays its
  full text in the banner (the "replay" behavior from spec §12), and it snaps back to the latest
  move on the next play rather than blocking the game.
- Deep-linking (`/four-player?new=1`) wired the same way as two-player; the landing page's
  four-player card now links there directly instead of to the old placeholder.
- Full verification: 71/71 engine tests still pass (unchanged from Phase 3), ESLint clean,
  production build clean. No component-level (rendering/interaction) test harness is configured
  in this workspace — same as the two-player UI in Phase 1 — so the build's strict AOT template
  type-checking is what's catching UI bugs here, not a dedicated test suite.

## Phase 5 status (this delivery) — final QA pass

No browser is available in the environment this was built in, so this couldn't be a click-through
QA pass in the literal sense. What it is instead: a systematic line-by-line audit of every §8.5
rule and every §12 assumption against what's actually shipped, plus a full traced transcript of
real matches run through the actual engine and AI functions (not a mock) so the narration text,
team scoring, and phase transitions could be inspected the way clicking through a browser would
surface issues. Two real problems turned up:

- **Fixed — first-dealer default didn't match the spec.** §12 says the default dealer should be
  Player 4 (so Player 1 is always the first bidder), explicitly "matching how the two-player game
  auto-assigns the first bidder" — but two-player's `startMatch` is fully deterministic
  (`firstBidder = 'player'`, no randomness at all), while `startFourPlayerMatch()` was picking a
  **random** dealer by default. Fixed to default to `SeatId.P4` deterministically, matching both
  the spec text and the two-player precedent it points to. Test updated to match.
- **Fixed — accessibility gap against §11.** The non-functional requirements call for move
  narration and score changes to be announced to screen readers via an aria-live region; neither
  the narration banner nor the team score header had one. Added `aria-live="polite"` (plus
  `role="status"` on the banner) to both.
- **Reviewed, not changed — the "Add / break house" button doesn't pre-check self-ownership.**
  Selecting your own house plus a matching card enables the button; clicking it surfaces the
  engine's rejection ("You cannot break a house you already own...") as an error message rather
  than disabling the button beforehand. This matches the existing pattern used everywhere else in
  both UIs (optimistic enable, engine validates, error message on rejection) rather than
  duplicating cement-vs-break branching logic client-side just for button state — cementing your
  own house is legal (with a reserve card) using the exact same button, so a precise pre-check
  would need to replicate real engine logic in the UI layer. Left as-is deliberately.
- **Confirmed via transcript, not just unit tests**: team card pools sum correctly across a full
  hand (34 + 18 = 52, every card accounted for), narration reads naturally in context ("Your
  partner captured the largest available combination on the floor."), and a match reaches
  `match-over` cleanly at the bazzi threshold with zero illegal-move errors across every hand —
  including one case where my own QA script (not the shipped code) tried to play a move after the
  match had already ended, which the engine correctly rejected. That the engine caught my script's
  bug is itself a good sign for how it'll hold up against unexpected UI states.

Full verification: 71/71 tests still passing, ESLint clean, production build clean.

## Next steps

The two-player and four-player games are both complete and verified end to end. Deploy per
`Seep-Vercel-to-Azure-Migration-Steps.docx`. The one open item from Phase 4 remains open by
choice, not oversight: the computer AI doesn't voluntarily grow/cement a house over capturing it,
for the structural reason documented in the Phase 4 section above. Worth a look if you want a
noticeably smarter computer partner later, but it's a real design task, not a quick patch.

## Post-Phase-5: per-move pause/reveal (requested for manual QA)

The four-player page now pauses after **every** move — the human's own included — on a blocking
overlay before play continues. This replaces the auto-advancing narration banner from Phase 4;
the move-log drawer stays, listing every move's text after the fact.

- Shows who moved, the card played, and (for a capture) the exact floor cards captured, (for a
  house build) the loose cards it was combined with, or (for cementing/breaking) the house's
  cards — all as real `<app-card>` renders, not just text.
- For computer moves, also shows the AI's reason (already generated for the Phase 4 narration —
  reused here).
- Advances only when "Next" is clicked. The computer-automation `effect()` in
  `FourPlayerComponent` reads a new `pendingReveal` signal alongside `state` specifically so
  that dismissing a reveal (which doesn't itself change `state`) re-triggers the effect and lets
  the next computer move get scheduled — otherwise a reveal appearing mid-effect-run would leave
  the game silently stuck.
- This was built as a genuine QA tool, not just a UX flourish: it's the closest thing to a
  click-through browser test available in an environment with no browser — every capture, house
  build, cement, and break can now be checked by eye, move by move, the same way the Phase 5
  transcript was checked by reading, just interactively.

Verified: 71/71 tests still passing (this was a UI-only change, engine untouched), ESLint clean,
production build clean.
