import {
  type Card,
  type FourPlayerGameState,
  type GameState,
  type Intent,
  type PlayerId,
  chooseComputerBid,
  chooseComputerMove,
  chooseComputerOpeningMove,
  chooseFourPlayerBid,
  chooseFourPlayerMove,
  chooseFourPlayerOpeningMove,
} from 'seep-engine'

type AnyState = GameState | FourPlayerGameState

/** Turns an AI decision into the same Intent a client would submit. */
function actionToIntent(action: {
  type: string
  card: Card
  targetItemIds?: string[]
  looseItemIds?: string[]
  targetValue?: number
  houseId?: string
  extraLooseItemIds?: string[]
}): Intent {
  if (action.type === 'capture') return { type: 'capture', card: action.card, targetItemIds: action.targetItemIds! }
  if (action.type === 'build') {
    return { type: 'build', card: action.card, looseItemIds: action.looseItemIds!, targetValue: action.targetValue! }
  }
  if (action.type === 'modify') {
    return { type: 'modify', card: action.card, houseId: action.houseId!, extraLooseItemIds: action.extraLooseItemIds }
  }
  return { type: 'throw', card: action.card }
}

const other = (id: PlayerId): PlayerId => (id === 'player' ? 'opponent' : 'player')
const swapRecord = <T>(r: Record<PlayerId, T>): Record<PlayerId, T> => ({ player: r.opponent, opponent: r.player })

/**
 * The two-player AI is written to play the 'opponent' seat only (in the local
 * game the computer always is). To get its advice for the 'player' seat, swap
 * the two players' roles throughout the state, ask it, and use the answer
 * as-is: an intent names cards and floor-item ids, never seats, so it means
 * the same thing in the mirrored and the real state.
 */
export function mirrorTwoPlayerState(state: GameState): GameState {
  return {
    ...state,
    floor: state.floor.map((item) => (item.kind === 'house' ? { ...item, owners: item.owners.map(other) } : item)),
    hands: swapRecord(state.hands),
    captures: swapRecord(state.captures),
    sweepPoints: swapRecord(state.sweepPoints),
    matchScores: swapRecord(state.matchScores),
    pendingDeal: state.pendingDeal && swapRecord(state.pendingDeal),
    lastHandTotals: state.lastHandTotals && swapRecord(state.lastHandTotals),
    bidder: other(state.bidder),
    turn: other(state.turn),
    lastCapturer: state.lastCapturer && other(state.lastCapturer),
    winner: state.winner && other(state.winner),
  }
}

/**
 * What the built-in AI would play for whichever seat holds the turn, given
 * the full server-side state. Used to drive whole matches through the
 * service in tests (the AIs are proven legal by the engine's own fuzz tests).
 */
export function aiIntent(kind: 'two_player' | 'four_player', state: AnyState): Intent {
  if (kind === 'two_player') {
    const real = state as GameState
    const s = real.turn === 'player' ? mirrorTwoPlayerState(real) : real
    if (s.phase === 'bidding') return { type: 'bid', value: chooseComputerBid(s) }
    return actionToIntent(s.phase === 'opening-move' ? chooseComputerOpeningMove(s) : chooseComputerMove(s))
  }
  const s = state as FourPlayerGameState
  if (s.phase === 'bidding') return { type: 'bid', value: chooseFourPlayerBid(s) }
  return actionToIntent(s.phase === 'opening-move' ? chooseFourPlayerOpeningMove(s) : chooseFourPlayerMove(s))
}

/** Every card-shaped object anywhere inside a value. */
export function collectCards(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const v of value) collectCards(v, out)
  } else if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>
    if (typeof rec['face'] === 'string' && typeof rec['suit'] === 'string') out.push(rec as unknown as Card)
    for (const v of Object.values(rec)) collectCards(v, out)
  }
  return out
}

const key = (c: Card): string => `${c.face}/${c.suit}`

/**
 * Cards `seat` must NOT be able to learn about: every other seat's hand, and
 * every card still waiting in the staged deal. (A card exists once in the
 * deck, so a card in someone else's hand can't also be public.)
 */
export function hiddenFrom(state: AnyState, seat: string): Card[] {
  const hands = state.hands as Record<string, Card[]>
  const hidden: Card[] = []
  for (const [owner, cards] of Object.entries(hands)) if (owner !== seat) hidden.push(...cards)
  const pending = state.pendingDeal as Record<string, Card[]> | null
  if (pending) for (const cards of Object.values(pending)) hidden.push(...cards)
  return hidden
}

/** Returns a description of the first leaked card found in `view`, or null if it's clean. */
export function findLeak(view: unknown, hidden: Card[]): string | null {
  const visible = new Set(collectCards(view).map(key))
  const leaked = hidden.find((c) => visible.has(key(c)))
  return leaked ? key(leaked) : null
}
