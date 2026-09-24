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

## Next steps

Phases 2-5 of the spec (team-aware engine, the four-seat UI, move narration, and the four-player
fuzz test) are not started. The `/four-player` route currently shows an honest "coming soon"
placeholder rather than a real game.
