# Unique display names

No two players can have the same name. When a name is taken, the person is offered free alternatives and one tap takes one.

## READ THIS FIRST: the order matters
1. **Apply the email-confirmation package (6b) first, or take both together.** This package builds on it: `me.ts`, the smoke script and the lobby files here already contain the 6b changes.
2. **Run `projects/seep-api/db/010_phase6_unique_names.sql` in Neon (production, then dev) BEFORE you deploy the API.** The new API calls a database function that this migration creates. Deploying first would make every name save fail until it is run. It is safe to run twice. The migrations to have run, in order, are now 005 to 010.
3. **What the migration does to your data:** it keeps the EARLIEST account's name and gives each later one a number. From your query, that means the later of your two "narender" accounts becomes "narender 2" (the spelling it had, plus the number). If you would rather choose its new name yourself, rename it in the app first. Afterwards your duplicate query should return no rows, and the deep health check (`/api/v1/health?deep=1`) should say `"schema":"ok"` (it now also looks for the new function).
4. **Check two things about your Neon database before relying on it** (I could not see them): run `SELECT version();` (the comparison uses `normalize()`, which needs Postgres 13 or newer; Neon's current versions have it), and `SELECT datcollate FROM pg_database WHERE datname = current_database();`. If that says `C`, then upper- and lower-case letters outside plain English letters (for example "É" and "é") will NOT count as the same name; English letters, digits, spaces and punctuation are unaffected.
5. Copy the files (all paths start with `projects/`), run `npm test && npm run lint && npm run build`, commit and push. Both halves go in the same push.

## What players see
- Choosing a name that is taken shows **"That name is already taken. Choose one of these, or type a different one:"** with up to three free alternatives ("Alex 2", "Alex 3", "Alex 4") as buttons. One tap takes the name and goes straight on.
- "Taken" means the same once case is ignored and spaces and `. - _ '` are ignored: "Alex", "alex", "A.lex" and "Alex_" are one name. (Compatibility forms count too: a full-width "Ａｌｅｘ" is "alex".)
- Your own name is never "taken" from you: saving it again, or changing only its capitals, is fine. Changing to another name frees the old one, and deleting an account frees its name.
- Nothing reveals who has a name.

## How it works
- The unique index in the database is the only thing that decides, so two people choosing the same name at the same moment cannot both succeed. The comparison is defined once, in the database (`seep_name_key()`), and the index and the suggestion lookup both use it, so they cannot disagree.
- The server answers a taken name with a 409 and `code: "name_taken"` plus the suggestions. The suggestions are checked in one query and skip numbers that are already taken ("Alex2" and "Alex 2" count as the same).
- People who have not chosen a name yet (no name stored) never collide with each other.

## The smoke script
- It has one new check: a second account tries to take A's name written differently ("smoke_a" against "Smoke A") and must be refused with alternatives. It fails if the server lets them, on purpose.
- Because names are now unique, if the name "Smoke A" belongs to a DIFFERENT account, the script takes the server's first suggestion for A instead and carries on.

## Verified
- **969 tests across the repo** (176 engine, 479 API, 314 web), none skipped; lint clean; strict compile clean; the API bundle builds.
- **Journeys, on a freshly rebuilt clean bundle and a rebuilt test server that enforces both new rules:** two-player **124** (the new taken-name scenario adds four), four-player **137**, consent **33**, email confirmation **26** with the rule on and **3** with it off.
- **Nineteen deliberate breakages caught:** 12 on the server (the comparison ignoring punctuation or case; an ordinary index instead of a unique one; the renumbering keeping the latest account, or running only once; a taken name surfacing as a crash; suggestions not skipping taken numbers or overflowing 20 characters; any unique violation taken for a name; the wrong status; the health check ignoring the function; the smoke check passing whatever the server says), 4 in the website's helper, and 3 on the screen (suggestions never shown; tapping one doing nothing; the person not told the name is taken).
- The migration's renumbering is tested on real Postgres, including a numbered name that collides with a name somebody already has, and running it twice.

## NOT verified
- **Your real Neon database:** the migration has been run only on the test Postgres (PGlite), not on Neon. Step 4 above is how to check the two things that could differ.
- **The real look** of the suggestion buttons with your stylesheet, and on your phone.
- **Lookalike letters across alphabets** (a Latin "a" and a Cyrillic "а") are not caught, because every language is allowed on purpose.
- **Names are not reserved.** Someone could take a name like "Seep Support" if it is free. Say so if you want a short list of reserved names.

## Mistakes along the way
- I ran a code formatter over `me.ts` with no project settings, so it added semicolons your code does not use. I noticed, restored the file and re-applied the change by hand; the difference is now small and in your style.
- My new test first assumed a refused newcomer would have an account with no name; the server correctly stores nothing, so the test now covers both paths. My smoke script also hard-coded "Smoke A" in three places, which the new rule exposed; it now uses whichever name it actually got.
- One of my breakages (N12) was too weak to mean anything, and I replaced it with a stronger one rather than count it.
