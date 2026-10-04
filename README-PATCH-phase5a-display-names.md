# Phase 5, slice 5a: display names

## Phase 5, as planned (from the planning notes), and the order I propose
| Slice | What | Why this order |
|---|---|---|
| **5a** | **Display names** (this package) | Small, and names are personal data the next slice must describe and erase |
| 5b | Privacy policy and terms; self-serve account deletion | A store requirement; depends on 5a |
| 5c | Rate limits and table caps; a health check; monitoring and cost alerts | Abuse protection and early warning; mostly settings you make in Azure |
| 5d | Results, rematch and lobby polish; preset reactions (no free-text chat) | Nice to have, and independent |

## What players see
- **A name step.** A new account (and any existing one, on its next visit to Play online) is asked
  "What should we call you?" before it can start or join a table. An **invite link waits for the name**: the
  person signs in, chooses a name, and *then* takes their seat automatically.
- **The rules for a name:** 2 to 20 characters; letters and digits in **any language** (Gurmukhi, Devanagari,
  Chinese, Arabic and accented names all work), spaces, and `. - _ '`. No markup, links, emoji or invisible
  characters, and no piles of stacked accents. The server explains in plain words if a name is refused.
- **A Google account suggests only its first name** (never the full name). Email accounts start blank.
- **"Playing as Alice · Change"** sits in the lobby; changing it is one click, with Cancel.
- **Where names appear:** "Your tables" (`In progress vs Bob`, `In progress with Bob, Carol, Dave`,
  `Waiting for players (2 of 4)`), the four-player waiting list (`Player 2 — Bob`, `Player 3 — waiting…`), and the
  turn clock (`Bob's move · 0:42 left`, `Bob is out of time. They forfeit the match in 0:45`).
  A person with no name shows as "a player" / "Your opponent".
- **A later sign-in never erases a name** (tested, and checked against real Neon by the smoke script).

## Apply
1. **No database migration.** The `display_name` column has existed since Phase 3.
2. Copy the files in this zip over your repo; `npm test && npm run lint && npm run build`; commit and push
   (deploys the website and the API).
3. Run the smoke test as before. It now also chooses a name for the test account, checks a bad name is refused,
   checks a plain sign-in keeps the name, and checks the other player sees it. Expect
   **`PASS: 41 of 41 checks passed`** (it was 37).
4. Try it by hand: open Play online with an account that has no name. Try `A`, then `<b>x</b>` (both should be
   refused with a reason), then a real name. Open an invite link in a private window and confirm the name step
   comes first.

## Verified
- **605 tests** across the repo (171 engine, 271 API, 163 web); lint clean (your exact toolchain); strict Angular
  compile clean; the API bundle builds.
- **Real browsers:** the two-player journey is now 73 checks and the four-player journey 97, no unexpected
  errors. They cover: the gate (no start/join before a name); a one-letter name and a markup name refused; the
  invite link asking for a name *before* the seat; "In progress vs Alice"; "Alice's move" on the clock; Change,
  Cancel and a changed name; a returning user not asked again; the four-player arrival list by name.
- **Eleven deliberate breakages, all caught:** the name not checked at all; a later sign-in erasing it; markup
  allowed; stacked accents counted wrongly; a body that is not an object accepted; the length counted in code units
  not characters (this one first *survived*, which showed a real gap in my test; fixed and re-run); the name step
  skipped; the invited seat never taken after the name; the clock ignoring names; the arrival list blank; the client
  sending the name in the wrong field.
- **A real gap found and fixed along the way:** my first stacked-accent rule counted accents *after* merging them
  into their letters, so four accents slipped through as three. It now counts them separately.

## NOT verified
- **Real Google sign-in** suggesting a first name (the test harness's fake sign-in supplies no name).
- **Real Neon** for the new name SQL, until you run the smoke test (step 3).
- **Four real people**, as before.

## Known limits (decisions, not oversights)
- **Names are not yet on the game boards.** The boards still say "You / Opponent" and "Player N", and the
  engine's move log uses the same words. Names appear in the lobby, the waiting list and the clock. Threading them
  into the boards is a separate polish pass (5d).
- **No profanity filter or moderation, and no way to report a name.** A name is visible only to people who sit at a
  table with you (by code or link), which limits exposure. Revisit before any public matchmaking.
- **Names are not unique.** Two people can both be "Sam"; at a four-player table the seat numbers tell them apart.
- **Existing accounts will be asked for a name** on their next visit, including your smoke-test accounts (the smoke
  script names only account A; B, C and D stay unnamed and show as "a player").
- **A name is stored until the account is deleted.** Account deletion arrives in 5b, and the privacy policy will say so.
