/**
 * The quick reactions a player can send: a fixed list, with the words and emoji people see. There is no free text.
 * The server keeps the matching list of codes and refuses anything else; a test in the API keeps the two in step.
 */
export interface ReactionChoice {
  readonly code: string
  readonly emoji: string
  readonly text: string
}

export const REACTIONS: readonly ReactionChoice[] = [
  { code: 'nice_move', emoji: '👍', text: 'Nice move!' },
  { code: 'wow', emoji: '😮', text: 'Wow!' },
  { code: 'oops', emoji: '😅', text: 'Oops' },
  { code: 'thanks', emoji: '🙏', text: 'Thanks' },
  { code: 'good_game', emoji: '👏', text: 'Good game!' },
  { code: 'good_luck', emoji: '🍀', text: 'Good luck!' },
]

/** What a reaction says, e.g. "👍 Nice move!", or null for a code this version does not know (a newer server's). */
export function reactionLabel(code: string): string | null {
  const found = REACTIONS.find((r) => r.code === code)
  return found ? `${found.emoji} ${found.text}` : null
}

/** The line shown when someone reacts: "Bob: 👍 Nice move!". Null for an unknown code, so it is simply not shown. */
export function reactionToastText(who: string, code: string): string | null {
  const label = reactionLabel(code)
  return label === null ? null : `${who}: ${label}`
}
