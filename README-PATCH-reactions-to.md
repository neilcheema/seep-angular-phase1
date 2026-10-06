# Quick reactions: say who it is for ("To:")

At a four-player table, a reaction can now be **addressed to one player**. Everyone at the table still sees every reaction (option A, as chosen);
the address only says who it is for, so "Alice → Dave: 👍 Nice move!" is no longer a message to nobody in particular.

## READ THIS FIRST: the order matters
1. **Run `projects/seep-api/db/009_phase5_reaction_recipient.sql` in Neon (production, then dev) BEFORE you deploy the API.** It adds one nullable column to `reactions`.
   The new API writes to it every time someone sends a reaction, so deploying first would make **every reaction fail** until the migration is run. (Safe to run twice.)
   The migrations to have run, in order, are now 005, 006, 007, 008 and **009**.
2. Copy the files over your repo; `npm test && npm run lint && npm run build`; commit and push (this deploys both the API and the website).
3. Open `https://<your API>/api/v1/health?deep=1`: it should say `"schema":"ok"` (the deep check now also looks for the new column).
4. Run the smoke script from this zip: **54 of 54** (it was 52). **Do not run it more than twice within a minute against the real site**: each run makes three reaction attempts, and the allowance is six a minute.

Either half can go out first without breaking the other: a new website against the old API simply shows no arrow (the old API ignores the address); the old website against the new API is unaffected.

## What players see
- **A "To:" row in the reactions tray, at a four-player table:** Everyone (selected by default), then **Your partner**, then the two opponents **by name**. A two-player table has only one other person, so it shows no such row.
- **The message names who it is for, from each reader's own side.** If Alice sends one to Dave: Dave sees **"Alice → you"**; Dave's partner sees **"Alice → your partner"**; Alice's own partner sees **"Your partner → Dave"**.
- **A reaction addressed to you gets a stronger gold border.** The two people who only overhear it do not.
- **Each reaction starts as "Everyone" again** after you send one (or close the tray), so you cannot address someone by accident.

## How it works
- The server accepts an optional `to` (a seat). It must be a seat at **this** table and **not the sender's own**; anything else is a 400 and nothing is recorded (not even the counter moves). It stores the seat key only, never a person, so deleting an account leaves nothing personal in it.
- Every reaction is still delivered to everyone at the table. This is a label, not a privacy filter. If you ever want reactions private to the recipient, that is a different (and larger) change, and I would want to talk it through first.
- Older reactions, and ones from before this change, read as "for everyone".

## Verified
- **917 tests across the repo** (176 engine, 445 API, 296 web), none skipped; lint clean; strict Angular compile clean; the API bundle builds.
- **Real-browser journeys on a freshly rebuilt clean bundle:** four-player **135 checks** (was 124), two-player **118** (was 117), consent **33**. New four-player checks: the tray's choices (Everyone, partner, the two opponents by name) and the default;
  choosing a player selects him and un-selects Everyone; each of the other three players reads the message correctly from their own side; the next reaction goes back to Everyone; a reaction for Alice gets the stronger border on her screen and on neither of the two who only overheard it;
  and the taller tray still fits on screen at phone width. The two-player journey checks there is no "To:" row.
- **Eleven distinct deliberate breakages caught:** seven on the server (address not stored, not shown on the poll, addressing yourself allowed, addressing a seat not at the table allowed, a non-text address accepted, the handler ignoring it, the health check missing the column),
  four in the website's plumbing (toast never shows the arrow, the session drops the address, the API call never sends it, an empty address shown as an arrow), and two on the screen (the chosen player not forgotten after sending; every addressed reaction marked "for me").
- **The smoke script passes 54 of 54** against my test server at the real default allowance, and its own tests are stable.

## Mistakes along the way, so you know what was checked
- My three new smoke checks first raised the reaction attempts per run from 2 to 4, so running the script twice in a minute tripped the allowance. I merged two sends into one (three attempts per run) and the smoke tests' own server now has the loggers a real one has.
- Three of my own test expectations were wrong (a confused test about a deleted player's seat, and two journey lines that forgot that the sender is "Your partner" on his partner's screen). The app was right each time.
- A check I had labelled "…and only hers" verified nothing about the others. It is now a real check, and the breakage that marked everyone as "for me" shows it works.

## NOT verified
- **How it looks with your real stylesheet** (the tray's new row and the toast border). My test page does not load your app's real CSS.
- **Real devices and real people.** Please try it at your next four-person game.
- The server part has not run against the real Azure or Neon until you deploy; the 54-check smoke script is what will tell you.

## Known limits
- Only at four-player tables. Rematch is still two-player only.
- No way to address a reaction to more than one player.
- I have not changed the app version. This is a visible change; if 1.6.0 is live, the next number would be 1.7.0 (the turn-bar change is also unreleased).
