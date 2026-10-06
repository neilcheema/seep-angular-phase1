# Smoke script: explains the 20-match limit, with the SQL to clear it

**Only the smoke script and its test change. Nothing in the app, no migration, no deploy.** Copy the two files into your repo and commit; there is nothing to run on the server. Apply it after the email-confirmation (6b) and unique-names packages, since it builds on their versions of these two files.

## What it fixes
When a test account is already in the maximum number of active matches (20), a join is refused and the script used to print a bare "409 You are already playing 20 matches". It now says what it is and what to do:
- The failing check ends with "this account is at its limit of active matches: see the explanation at the end".
- After the last check it prints an explanation (this is not a bug in the app; why it happens; that the daily cleanup closes them after 7 idle days by default) followed by two pieces of SQL: **STEP 1** (preview) and **STEP 2** (close them). It tells you to run step 1 first and check the rows.
- The SQL is built from the accounts that run actually used (their emails come back from the sign-in call, plus the C and D accounts when you use a Firebase API key), and it only touches matches in which EVERY human player is one of them, so a real player's match can never be included.
- A normal run prints nothing extra.

## Using it
Run the script as before. If it ever fails with the explanation, run STEP 1 in the Neon SQL editor on the **production** branch, check that every row is a smoke-test match, run STEP 2, and run the script again. The two statements are the same ones I gave you earlier, which worked.

## Why it still happens
The script leaves the matches it starts open (about two per run) and nothing in the app lets a player end a match early. After roughly ten runs an account is at the limit. You chose to leave it that way and have the script explain it, rather than add a Resign button; the question stays open in the planning notes.

## Verified
- **970 tests across the repo** (176 engine, 480 API, 314 web), none skipped; lint clean; strict compile clean. The smoke script's own test file has 17 tests, stable over repeated runs.
- The new test runs the script into the limit with a real player's match in the same database, then **extracts the SQL the script printed and executes it, exactly as printed, on a real Postgres**: the preview finds only the smoke match; STEP 2 closes only that match, with the same status the daily cleanup uses; the real player's match stays active; and the script then passes again.
- **Six deliberate breakages caught:** the explanation never printed; printed on every run; the SQL not limited to the smoke accounts; the SQL leaving out an account it used; the limit not recognised; the SQL closing matches with a status the cleanup does not use.

## NOT verified
- The SQL has not been run on your real Neon database by this version of the script (the earlier version of the same statements was, by you). It has been run on a real Postgres in the tests.
- The explanation prints the emails of the accounts the script used. If you run it with tokens only (no API key), accounts C and D are not known, so the printed SQL covers A and B and tells you to add C and D if you use them.

## A slip along the way
My first attempt to add the test failed on a quoting mistake in my own tool step, so the test was not added; the "16 passed" lines from that attempt were the old tests. I noticed, wrote the test to a file, and only counted the runs after it was in.
