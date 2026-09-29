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
export const ENGINE_VERSION = '1.0.0';
