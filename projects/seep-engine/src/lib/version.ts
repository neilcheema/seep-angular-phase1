/**
 * The rules engine's own version — distinct from the web app's
 * APP_VERSION. Stamped onto every GameState/FourPlayerGameState at
 * creation (see ENGINE_VERSION usage in dealHand / dealFourPlayerHand),
 * so a game created under one set of rules can be identified later, even
 * after the engine itself has moved on. This is what lets an in-flight
 * game finish under the rules it started with when a rule is corrected —
 * without it, "which version of the rules made this decision" is
 * unanswerable once the engine has changed.
 *
 * Bump this whenever a rule's actual behavior changes (a capture,
 * scoring, or dealing rule) — not for refactors, UI, or test-only
 * changes that don't change what a game does.
 */
/*
 * History of rule changes:
 *   1.2.0  On the OPENING MOVE, when several different combinations of floor cards could make the bid house (a 2 with either 9, or with an Ace and an
 *          Eight, for 11), the bidder may choose any ONE of them. Before, the engine silently forced one (the first it found), so a perfectly good build
 *          could be refused. Nothing may be left out: every separate group that makes the house must still be taken. From the second play on nothing
 *          changes: the engine's own pick is required.
 *   1.1.0  Building or cementing a house now needs cards that split into COMPLETE SETS of its value (9, 4+5 and 3+6 are three sets of 9).
 *          Before, any total that divided evenly was accepted, so 11+12+13 (36) was wrongly allowed as a cemented "house of 9".
 *   1.0.0  The first rules.
 */
export const ENGINE_VERSION = '1.2.0';
