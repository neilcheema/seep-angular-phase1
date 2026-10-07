import { type Card, Face, Suit, captureValue, pointValue } from './card'
import { createDeck } from './deck'
import { type FloorItem, isHouse, isLoose, requiredCaptureIds } from './floor'
import { type GameState, type GameView, type Intent, applyMove, legalBids, placeBid } from './gameEngine'
import { legalMoves } from './moves'
import type { PlayerId } from './player'
import { cardPoints } from './scoring'

/**
 * What the opponent could take from the floor right after a move. In ordinary play the whole deck has been dealt, so every card you cannot
 * see is in the opponent's hand: counting tells you EXACTLY what they hold, and this is measured against that. Before the deal is finished
 * (the opening move) nobody can know, so no danger is measured and the older "cards out of your sight" reasoning is used instead.
 */
export interface Danger {
  /** 'known': counting shows exactly what the opponent holds. 'guess': cards are still undealt, so it is only what they might hold. */
  readonly basis: 'known' | 'guess'
  /** Can any card they hold capture anything from the floor? */
  readonly canCapture: boolean
  /** The most points one of their cards could win from the floor (the cards taken, or the whole floor on the last card of the hand; not counting a Seep bonus). */
  readonly points: number
  /** True when ONE card they hold could clear the whole floor: a Seep (never true when their card would be the last of the hand, which earns no bonus). */
  readonly seep: boolean
  /** True when a card they hold could take the card you just played (the thrown card, the house you built or added to). */
  readonly takesYourCard: boolean
  /** The value of the card that does the most harm (the Seep card, else the one winning most points, else the one taking your card), or null. */
  readonly byValue: number | null
}

/** "Not measured": used before the deal is finished, and by tests that are about something else. */
export const NO_DANGER: Danger = { basis: 'guess', canCapture: false, points: 0, seep: false, takesYourCard: false, byValue: null }

/** What a move does, in facts the engine can compute: the website turns these into sentences. Nothing here is an opinion. */
export type MoveFacts =
  | {
      kind: 'capture'
      card: Card
      /** The cards taken from the floor (a house counts all its cards). */
      taken: Card[]
      takesHouse: boolean
      /** Points in everything won by this capture: the cards taken plus the card played. */
      points: number
      /** The cards among them that score points on their own. */
      scoringCards: Card[]
      /** Bonus points for clearing the floor (the engine decides: 50, 25 on the first move of a hand, 0 on the last card). */
      sweepBonus: number
      clearsFloor: boolean
      /** What the opponent could take from what is left on the floor. */
      danger: Danger
    }
  | {
      kind: 'build'
      card: Card
      targetValue: number
      looseCards: Card[]
      cemented: boolean
      /** Other cards worth the target that stay in your hand (at least one: that is a rule). */
      copiesInHand: number
      /** Cards worth the target that you cannot see anywhere: still with the opponent, undealt, or nowhere visible. */
      unseenCopies: number
      /** Points in the cards that go into the house, which the opponent wins if they capture it. */
      pointsInHouse: number
      danger: Danger
    }
  | {
      kind: 'modify'
      card: Card
      mode: 'cement' | 'break'
      fromValue: number
      toValue: number
      looseCards: Card[]
      copiesInHand: number
      unseenCopies: number
      pointsAdded: number
      danger: Danger
    }
  | {
      kind: 'throw'
      card: Card
      points: number
      /** Cards of the same value that you cannot see (a matching card in the opponent's hand could capture it). */
      unseenCopies: number
      /** True when this card could capture something right now: possible only on the opening move, and throwing it then gives that capture up. */
      couldHaveCaptured: boolean
      danger: Danger
    }

export interface Advice {
  readonly intent: Intent
  readonly facts: MoveFacts
  /** Higher is better. Only the ORDER means anything. */
  readonly score: number
}

export interface BidAdvice {
  readonly value: number
  /** Cards in your hand worth this bid. */
  readonly copiesInHand: number
  /** How many legal opening moves this bid leaves you. */
  readonly openingMoves: number
  /** The best of them, or null when there are none. */
  readonly bestOpening: Advice | null
  readonly score: number
}

/**
 * How moves are ranked. These numbers are judgment calls, not rules: they encode ordinary beginner advice (take points when you can; build
 * only when you keep a card to capture it with and are not handing the opponent points; throw the cards that are worth least). They live
 * in one place so that someone who plays well can change them. A capture always outranks a build and a throw (see the ordering tests).
 */
export const ADVICE_WEIGHTS = {
  captureBase: 100,
  perPointCaptured: 10,
  perCardCaptured: 2,
  perSweepPoint: 2,
  buildBase: 55,
  buildCemented: 10,
  perUnseenCopyOfBuild: -3,
  perPointExposedInHouse: -4,
  modifyBase: 50,
  perUnseenCopyOfModify: -3,
  perPointAddedToHouse: -4,
  throwBase: 30,
  perPointThrown: -12,
  perUnseenMatchOfThrow: -1,
  perMissedCapture: -60,
  /** When counting shows what the opponent holds (ordinary play): */
  perPointAtRisk: -4,
  seepAtRisk: -60,
  houseCertainlyTaken: -30,
  /** A capture that leaves the opponent something to take is marked down, but never so far that it falls below a build or a throw. */
  perPointLeftBehind: -2,
  seepLeftBehind: -30,
  maxCaptureMarkdown: 30,
  perBidCopy: 2,
} as const

const W = ADVICE_WEIGHTS

/** Every value from Ace (1) to King (13) is carried by exactly four cards. */
const CARDS_PER_VALUE = 4

/** A card standing in for a hidden one. It is never looked at; only the NUMBER of hidden cards matters to the rules. */
const UNKNOWN: Card = { face: Face.Two, suit: Suit.Diamonds }

/**
 * A full game state built from what one player can see, with placeholders where the opponent's hidden cards are. The advisor is given a VIEW, so
 * it cannot read the opponent's hand; the engine still needs a full state to simulate a move, and the rules never look at the opponent's cards
 * when the player is moving (a test checks that this stand-in lists exactly the moves the real state does).
 */
export function standInState(view: GameView): GameState {
  const me = view.viewer
  const other: PlayerId = me === 'player' ? 'opponent' : 'player'
  return {
    floor: view.floor,
    hands: { [me]: view.myHand, [other]: Array.from({ length: view.opponentCardCount }, () => UNKNOWN) } as Record<PlayerId, Card[]>,
    captures: view.captures,
    sweepPoints: view.sweepPoints,
    matchScores: view.matchScores,
    bidder: view.bidder,
    turn: view.turn,
    phase: view.phase,
    bidValue: view.bidValue,
    pendingDeal: null,
    lastCapturer: view.lastCapturer,
    cardsPlayedThisHand: view.cardsPlayedThisHand,
    totalPlayableThisHand: view.totalPlayableThisHand,
    nextItemId: 1_000_000,
    log: [],
    winner: view.winner,
    lastHandTotals: view.lastHandTotals,
    handHistory: view.handHistory ?? [],
    misdeals: view.misdeals,
    engineVersion: view.engineVersion,
  }
}

const floorCards = (floor: FloorItem[]): Card[] => floor.flatMap((item) => (isHouse(item) ? item.cards : [item.card]))

/** How many cards worth `value` exist that the viewer cannot see: not in their hand, on the floor (houses included) or in either pile of captures. */
function unseenCopies(view: GameView, value: number): number {
  const visible = [...view.myHand, ...floorCards(view.floor), ...view.captures.player, ...view.captures.opponent]
  return Math.max(0, CARDS_PER_VALUE - visible.filter((c) => captureValue(c) === value).length)
}


const ALL_FACES = Object.values(Face)
/** A card with a given capture value (any suit): the opponent's card of that value, as far as capturing is concerned. */
function cardOfValue(value: number): Card {
  const face = ALL_FACES.find((f) => captureValue({ face: f, suit: Suit.Spades }) === value)
  return { face: face ?? Face.Ace, suit: Suit.Spades }
}
const cardKey = (c: Card) => `${c.face}|${c.suit}`

/**
 * Every card the viewer cannot see, and whether that is certainly the opponent's whole hand. In ordinary play it is: all 52 cards are in play, so
 * what is not in your hand, on the floor or in either pile of captures can only be with the opponent (checked against the real games in the tests).
 */
export function unseenCards(view: GameView): { cards: Card[]; known: boolean } {
  const visible = new Set([...view.myHand, ...floorCards(view.floor), ...view.captures.player, ...view.captures.opponent].map(cardKey))
  const cards = createDeck().filter((c) => !visible.has(cardKey(c)))
  return { cards, known: view.phase === 'playing' && cards.length === view.opponentCardCount }
}

/** Which card values could capture anything from this floor at all: a house's value, or what some of the loose cards add up to (at most 13). */
function capturableValues(floor: FloorItem[]): Set<number> {
  const sums = new Array<boolean>(14).fill(false)
  sums[0] = true
  for (const item of floor) {
    if (!isLoose(item)) continue
    const v = captureValue(item.card)
    for (let s = 13; s >= v; s--) if (sums[s - v]) sums[s] = true
  }
  const values = new Set<number>()
  for (let s = 1; s <= 13; s++) if (sums[s]) values.add(s)
  for (const item of floor) if (isHouse(item)) values.add(item.captureValue)
  return values
}

/** What the opponent could take from the floor after this move, given what they are known to hold. */
function dangerAfter(after: GameState, played: Card, opponent: { cards: Card[]; known: boolean }): Danger {
  if (!opponent.known) return NO_DANGER
  const floor = after.floor
  if (floor.length === 0) return { ...NO_DANGER, basis: 'known' }
  const lastCard = after.cardsPlayedThisHand + 1 >= after.totalPlayableThisHand // their card would be the last of the hand: a Seep then earns nothing
  const couldCapture = capturableValues(floor)
  let danger: Danger = { ...NO_DANGER, basis: 'known' }
  let worst: [number, number, number] = [-1, -1, -1]
  for (const value of new Set(opponent.cards.map(captureValue))) {
    if (!couldCapture.has(value)) continue
    const ids = requiredCaptureIds(floor, cardOfValue(value))
    if (ids.length === 0) continue
    // On the last card of the hand, whoever captured last is given EVERYTHING still on the floor, so a capture then wins the whole floor.
    const gained = lastCard ? floorCards(floor) : floorCards(floor.filter((i) => ids.includes(i.id)))
    const points = cardPoints(gained)
    const seep = ids.length === floor.length && !lastCard
    const takes = gained.some((c) => c.face === played.face && c.suit === played.suit)
    const rank: [number, number, number] = [seep ? 1 : 0, points, takes ? 1 : 0]
    const better = rank[0] > worst[0] || (rank[0] === worst[0] && (rank[1] > worst[1] || (rank[1] === worst[1] && rank[2] > worst[2])))
    danger = { basis: 'known', canCapture: true, points: Math.max(danger.points, points), seep: danger.seep || seep, takesYourCard: danger.takesYourCard || takes, byValue: better ? value : danger.byValue }
    if (better) worst = rank
  }
  return danger
}

/** The facts about one legal move, worked out by actually playing it on the stand-in state. */
export function moveFacts(view: GameView, state: GameState, intent: Intent, opponent: { cards: Card[]; known: boolean } = unseenCards(view)): MoveFacts {
  const me = view.viewer
  const after = applyMove(state, me, intent)
  const danger = dangerAfter(after, intent.type === 'bid' ? ({ face: Face.Ace, suit: Suit.Spades } as Card) : intent.card, opponent)
  const handAfter = after.hands[me]
  const copiesWorth = (value: number) => handAfter.filter((c) => captureValue(c) === value).length

  switch (intent.type) {
    case 'capture': {
      const items = state.floor.filter((i) => intent.targetItemIds.includes(i.id))
      const taken = floorCards(items)
      const all = [...taken, intent.card]
      return {
        kind: 'capture',
        card: intent.card,
        taken,
        takesHouse: items.some(isHouse),
        points: cardPoints(all),
        scoringCards: all.filter((c) => pointValue(c) > 0),
        sweepBonus: after.sweepPoints[me] - state.sweepPoints[me],
        clearsFloor: items.length === state.floor.length,
        danger,
      }
    }
    case 'build': {
      const looseCards = state.floor.filter((i) => intent.looseItemIds.includes(i.id) && isLoose(i)).map((i) => (i as { card: Card }).card)
      const built = after.floor.find((i) => isHouse(i) && i.captureValue === intent.targetValue && !state.floor.some((o) => o.id === i.id))
      return {
        kind: 'build',
        card: intent.card,
        targetValue: intent.targetValue,
        looseCards,
        cemented: built !== undefined && isHouse(built) && built.cemented,
        copiesInHand: copiesWorth(intent.targetValue),
        unseenCopies: unseenCopies(view, intent.targetValue),
        pointsInHouse: cardPoints([intent.card, ...looseCards]),
        danger,
      }
    }
    case 'modify': {
      const before = state.floor.find((i) => i.id === intent.houseId)
      const fromValue = before && isHouse(before) ? before.captureValue : 0
      const result = after.floor.find((i) => i.id === intent.houseId)
      const toValue = result && isHouse(result) ? result.captureValue : fromValue
      const looseCards = state.floor.filter((i) => (intent.extraLooseItemIds ?? []).includes(i.id) && isLoose(i)).map((i) => (i as { card: Card }).card)
      return {
        kind: 'modify',
        card: intent.card,
        mode: toValue === fromValue ? 'cement' : 'break',
        fromValue,
        toValue,
        looseCards,
        copiesInHand: copiesWorth(toValue),
        unseenCopies: unseenCopies(view, toValue),
        pointsAdded: cardPoints([intent.card, ...looseCards]),
        danger,
      }
    }
    case 'throw':
      return {
        kind: 'throw',
        card: intent.card,
        points: pointValue(intent.card),
        unseenCopies: unseenCopies(view, captureValue(intent.card)),
        couldHaveCaptured: requiredCaptureIds(state.floor, intent.card).length > 0,
        danger,
      }
    case 'bid':
      throw new Error('A bid is advised with adviseBids, not as a move.')
  }
}

/** What counting says the opponent can do to this move, as a mark-down. Zero unless their hand is known (see Danger). */
function dangerMarkdown(d: Danger): number {
  if (d.basis !== 'known') return 0
  return W.perPointAtRisk * d.points + (d.seep ? W.seepAtRisk : 0)
}

export function scoreFacts(facts: MoveFacts): number {
  switch (facts.kind) {
    case 'capture': {
      const left = facts.danger.basis === 'known' ? Math.min(W.maxCaptureMarkdown, -(W.perPointLeftBehind * facts.danger.points + (facts.danger.seep ? W.seepLeftBehind : 0))) : 0
      return W.captureBase + W.perPointCaptured * facts.points + W.perCardCaptured * (facts.taken.length + 1) + W.perSweepPoint * facts.sweepBonus - left
    }
    case 'build':
      return W.buildBase + (facts.cemented ? W.buildCemented : 0) + houseRisk(facts.danger, facts.unseenCopies, facts.pointsInHouse, W.perUnseenCopyOfBuild, W.perPointExposedInHouse)
    case 'modify':
      return W.modifyBase + (facts.mode === 'cement' ? W.buildCemented : 0) + houseRisk(facts.danger, facts.unseenCopies, facts.pointsAdded, W.perUnseenCopyOfModify, W.perPointAddedToHouse)
    case 'throw':
      return W.throwBase + W.perPointThrown * facts.points + (facts.danger.basis === 'known' ? dangerMarkdown(facts.danger) : W.perUnseenMatchOfThrow * facts.unseenCopies) + (facts.couldHaveCaptured ? W.perMissedCapture : 0)
  }
}

/** The mark-down for a house the opponent might take: exact when their hand is known, a guess from the cards out of sight when it is not. */
function houseRisk(d: Danger, unseen: number, points: number, perUnseen: number, perPoint: number): number {
  if (d.basis === 'known') return (d.takesYourCard ? W.houseCertainlyTaken : 0) + dangerMarkdown(d)
  return perUnseen * unseen + (unseen > 0 ? perPoint * points : 0)
}

export interface AdviceOptions {
  /** How many suggestions to return. Default 3. */
  readonly count?: number
  /** Passed to legalMoves: a time limit for the optional part of the list. Captures and throws are always complete. */
  readonly budgetMs?: number
}

/** Every legal move for the viewer, ranked best first. Empty unless it is the viewer's turn in the opening move or ordinary play. */
export function rankMoves(view: GameView, options: AdviceOptions = {}): Advice[] {
  if (view.turn !== view.viewer || (view.phase !== 'playing' && view.phase !== 'opening-move')) return []
  const state = standInState(view)
  const opponent = unseenCards(view) // worked out once for the whole list, not once per move
  const moves = legalMoves(state, view.viewer, options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs })
  // Working out the facts means playing each move once more, so it gets its own share of the time limit. Captures and throws always get theirs;
  // only the optional moves (builds and house changes, which come last) can be dropped.
  const factsDeadline = options.budgetMs === undefined ? Infinity : Date.now() + options.budgetMs
  return moves
    .flatMap((intent, index) => {
      if ((intent.type === 'build' || intent.type === 'modify') && Date.now() > factsDeadline) return []
      const facts = moveFacts(view, state, intent, opponent)
      return [{ advice: { intent, facts, score: scoreFacts(facts) } as Advice, index }]
    })
    .sort((a, b) => b.advice.score - a.advice.score || a.index - b.index)
    .map((r) => r.advice)
}

/**
 * What a suggestion amounts to, so that two of the same are not both offered: throwing the Six of Clubs or the Six of Hearts (both worth nothing)
 * is one piece of advice, and so is capturing the same cards with either of two interchangeable Sevens. Two moves are the same advice when they
 * take or build the same things for the same points. A move that differs in any way that matters (a spade against a club, a different house)
 * is its own advice.
 */
function adviceSignature(a: Advice): string {
  const cards = (xs: Card[]) => xs.map((c) => `${c.face}-${c.suit}`).sort().join(',')
  const f = a.facts
  switch (f.kind) {
    case 'capture':
      return `capture|${cards(f.taken)}|${f.points}|${f.sweepBonus}`
    case 'build':
      return `build|${f.targetValue}|${captureValue(f.card)}|${cards(f.looseCards)}|${f.pointsInHouse}|${f.cemented}`
    case 'modify':
      return `modify|${f.mode}|${f.fromValue}|${f.toValue}|${captureValue(f.card)}|${cards(f.looseCards)}|${f.pointsAdded}`
    case 'throw':
      return `throw|${captureValue(f.card)}|${f.points}|${f.couldHaveCaptured}`
  }
}

/** The best few moves (default 3) for the viewer, with no two that amount to the same advice. */
export function adviseMoves(view: GameView, options: AdviceOptions = {}): Advice[] {
  const wanted = options.count ?? 3
  const chosen: Advice[] = []
  const seen = new Set<string>()
  const ranked = rankMoves(view, options) // ranked once, and used both to choose and to find the safe throw
  for (const advice of ranked) {
    const signature = adviceSignature(advice)
    if (seen.has(signature)) continue
    seen.add(signature)
    chosen.push(advice)
    if (chosen.length >= wanted) break
  }
  return withSafeThrow(chosen, ranked, wanted)
}

/** A throw that costs nothing and gives nothing away: the opponent cannot win a point or clear the floor because of it. */
function isSafeThrow(a: Advice): boolean {
  return a.facts.kind === 'throw' && !a.facts.couldHaveCaptured && !(a.facts.danger.basis === 'known' && (a.facts.danger.seep || a.facts.danger.points > 0))
}

/**
 * When there is nothing to capture and the best options are all builds or house changes, the safe alternative must not be missing from the list:
 * a beginner should always be shown that throwing a worthless card is an option. If a safe throw exists and none is among the suggestions, the
 * last suggestion gives way to the best one. Suggestions that include a capture are left alone: a capture always comes first.
 */
function withSafeThrow(chosen: Advice[], everything: Advice[], wanted: number): Advice[] {
  if (chosen.length === 0 || chosen.some((a) => a.facts.kind === 'capture' || a.facts.kind === 'throw')) return chosen
  const safe = everything.find(isSafeThrow)
  if (!safe) return chosen
  return chosen.length < wanted ? [...chosen, safe] : [...chosen.slice(0, wanted - 1), safe]
}

/** Which bids to consider, best first, when the viewer is the bidder. Empty at any other time. */
export function adviseBids(view: GameView, options: AdviceOptions = {}): BidAdvice[] {
  if (view.phase !== 'bidding' || view.bidder !== view.viewer || view.turn !== view.viewer) return []
  const state = standInState(view)
  const bids = legalBids(state).map((value) => {
    const afterBid = placeBid(state, view.viewer, value)
    const openingView: GameView = { ...view, phase: afterBid.phase, bidValue: afterBid.bidValue, turn: afterBid.turn }
    const ranked = rankMoves(openingView, options)
    const copiesInHand = view.myHand.filter((c) => captureValue(c) === value).length
    const best = ranked[0] ?? null
    return { value, copiesInHand, openingMoves: ranked.length, bestOpening: best, score: (best?.score ?? 0) + W.perBidCopy * copiesInHand } as BidAdvice
  })
  return bids.sort((a, b) => b.score - a.score || a.value - b.value).slice(0, options.count ?? 3)
}
