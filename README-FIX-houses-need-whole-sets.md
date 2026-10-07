# Fix: a house must be made of whole sets (found through Learn mode)

## What was wrong
In Learn mode the coach suggested bidding 9 and then opening with **Jack + Queen + King as a "house of 9 (4×, cemented)"**, as shown in your screenshots. That is not a real move: 11 + 12 + 13 add up to 36, which is four nines' worth, but none of those cards can be part of a set that adds up to 9. The game accepted it, so this is a **rules bug in the engine, not just in the coach**: it affected every two-player and four-player game, online and against the computer. (The computer players were not affected: they only ever build from groups that each add up exactly to the target.)

**It was my mistake, from 25 September.** You reported a real problem (cards from the hand and the floor adding up exactly to a house's value were wrongly refused), and I fixed it by accepting *any total that divides evenly*. That was broader than what you asked for. It also let through 10 + 8 as a "house of 9", and 7 + 7 + 4. I also wrote that wider rule into the "How to play" text players read.

## The rule now
**A house of N, when built or cemented, must be made of whole sets that each add up to N.** 9 is a set of 9; so are 4 + 5 and 3 + 6; so you can combine 9, 4 + 5 and 3 + 6 into one cemented house of 9. Cards that merely total a multiple of N (11 + 12 + 13 = 36, or 10 + 8 = 18) are refused with a clear message: *"Those cards cannot be split into sets that each add up to 9."* This is the same idea the engine already used for captures, which never accepted a total that "happens to add up".
**Still allowed, and now tested:** your original scenario: bid 13, with 4 + 9 and two loose Kings folded into one cemented house of 13 (three whole sets, 39 in all). Breaking a house up to a new value is unchanged.

## What else changed
- **The move log now names the cards.** It used to say "built a house using J of Clubs plus 2 floor card(s)", which hid exactly what you needed to see. It now says, for example, "built a house using J of Clubs plus Q of Hearts and K of Clubs", and names the cards for captures, cementing and breaking too. (Both game screens.)
- **The rules text** on both game screens, and the Learn Seep welcome card, now describe whole sets, and say plainly that 11 + 12 + 13 is not four sets of 9. A test stops the old sentence from ever coming back.
- **The engine's rules version moves from 1.0.0 to 1.1.0** (with a note of why, in `version.ts`), because a rule's behaviour changed. New games record 1.1.0; nothing already stored is rewritten.
- **For the position in your screenshot** (floor A♠ Q♥ K♣ 3♥; hand J♣ 9♥ 8♣ 6♦), the coach now says bid 9's best opening is to **build a house of 9 with the Six of Diamonds and the Three of Hearts** (6 + 3 = 9), keeping the Nine of Hearts to capture it later.

## Apply
This replaces some files from earlier packages, so apply it **after** `seep-learn-1`, `seep-learn-2`, `seep-learn-3-coach` (and with `seep-version-1.8.0` if you are shipping that). Copy the 11 files (paths start with `projects/`), then `npm test && npm run lint && npm run build`, commit and push.
- **You must deploy the API as well as the website.** Online games are judged by the server, which contains this same engine; until the API is redeployed, an online game will still accept the bad move. (The push deploys both through your normal workflows.)
- **No migration, no setting.**
- Games already in progress are not touched: a house already built stays as it is. Only moves made after the deploy are checked by the new rule.
- If 1.8.0 is not live yet, ship this with it; no further version change is needed. If 1.8.0 is already live, say so and I will prepare 1.8.1.
- Afterwards, run the smoke script once (56 of 56).

## Verified
- **1,050 tests across the repo** (233 engine, 480 API, 337 web) at the last full run, none skipped; lint and strict compile clean. The rules tests have since grown to 14 (the original scenario was added) and pass.
- **The new rules tests (14) fail on the old engines:** with the old two-player and four-player engines put back, 7 of the first 12 failed, and the bidding-step test built from your screenshot also fails. They cover: your exact move refused (and absent from the legal moves and from every suggestion); 10 + 8 and 7 + 7 + 4 refused; single cards, two cards and three sets accepted; your original 13-with-Kings scenario accepted; cementing and breaking up; the four-player engine; and **160 random positions where every build and cement the engine accepts is checked with a different "whole sets" method written inside the test.**
- **Six deliberate breakages of the fix, all caught** (build and cement in each engine, and two ways of getting the splitter wrong).
- **Real-browser journeys on a rebuilt build:** Learn 51 checks (including a new one: no "card(s)" anywhere in the log, and every capture or house entry names its cards, 18 of 18), two-player online 147, four-player online 162 (these two vary with the deal).

## NOT verified
- **The deployed site and API**, and your phone.
- **Whether the coach's opening suggestions are good play.** They are legal and sensible by the engine's measure; whether they are what an experienced player would open with is for you to judge (see `seep-learn-3-coach.zip`).
- **Houses already on the table in games under way** were built under the old rule and are left alone.

## Along the way
- I parked my unfinished iPhone-app (6d) files outside the tree so none of them could leak into this fix; they are not in this package.
- One of my own tests had an unused import, which lint caught; I replaced it with a real test of the bidding step.
