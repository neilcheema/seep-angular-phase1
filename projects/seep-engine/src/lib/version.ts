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
 *   1.6.0  On the player's LAST card of a hand, when it matches a house THE PLAYER MADE that is still on the floor, the capture no longer needs the floor
 *          cards to be ticked: everything left on the floor goes to the last capturer, which that capture makes the player, so the card simply takes what it
 *          must capture (a selection that is a proper capture is still used as it is). Before, only the one exact set was accepted, and ticking everything
 *          was refused. A last card with no house of the player's own to take captures exactly as on any other play.
 *   1.4.0  The player's choice of combination on EVERY play, not only the opening move, for captures and for building a house: when several
 *          different combinations of floor cards make the same total (a Jack takes a 2 and a 9 whether the 9 is the spade or the diamond), the
 *          player decides which one; the other stays on the floor. Nothing may be left behind: every separate group, and any house worth the
 *          total, must still be taken. Before, after the opening move the engine silently picked one and refused the rest.
 *   1.3.0  The same on the opening move for CAPTURES: when several different combinations of floor cards add up to the bid (a Jack takes a 3 and
 *          an 8 whether the 3 is the club or the spade), the bidder may capture with any ONE of them, nothing left out. Before, only the first the
 *          engine found was accepted. From the second play on nothing changes.
 *   1.2.0  On the OPENING MOVE, when several different combinations of floor cards could make the bid house (a 2 with either 9, or with an Ace and an
 *          Eight, for 11), the bidder may choose any ONE of them. Before, the engine silently forced one (the first it found), so a perfectly good build
 *          could be refused. Nothing may be left out: every separate group that makes the house must still be taken. From the second play on nothing
 *          changes: the engine's own pick is required.
 *   1.1.0  Building or cementing a house now needs cards that split into COMPLETE SETS of its value (9, 4+5 and 3+6 are three sets of 9).
 *          Before, any total that divided evenly was accepted, so 11+12+13 (36) was wrongly allowed as a cemented "house of 9".
 *   1.0.0  The first rules.
 */
export const ENGINE_VERSION = '1.6.0';
