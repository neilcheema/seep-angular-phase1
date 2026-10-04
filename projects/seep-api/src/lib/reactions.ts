/**
 * The quick reactions a player can send. A fixed list, on purpose: there is no way to send free text, so there is no
 * way to send an insult or a link. The website keeps the matching list of words and emoji (core/reactions.ts there);
 * a test keeps the two lists in step.
 */
export const REACTION_CODES = ['nice_move', 'wow', 'oops', 'thanks', 'good_game', 'good_luck'] as const

export type ReactionCode = (typeof REACTION_CODES)[number]

export function isReactionCode(value: unknown): value is ReactionCode {
  return typeof value === 'string' && (REACTION_CODES as readonly string[]).includes(value)
}

/** A reaction is only worth showing for a minute; older ones are never handed to a client. */
export const REACTION_FRESH_SECONDS = 60
/** The most reactions one poll can carry (a flood is cut off, newest last). */
export const REACTIONS_PER_POLL = 20
