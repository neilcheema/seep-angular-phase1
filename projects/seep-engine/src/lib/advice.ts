import { type Card, Face, Suit, captureValue, pointValue } from './card'
import { type FloorItem, isHouse, isLoose, requiredCaptureIds } from './floor'
import { type GameState, type GameView, type Intent, applyMove, legalBids, placeBid } from './gameEngine'
import { legalMoves } from './moves'
import type { PlayerId } from './player'
import { cardPoints } from './scoring'

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
    }
  | {
      kind: 'throw'
      card: Card
      points: number
      /** Cards of the same value that you cannot see (a matching card in the opponent's hand could capture it). */
      unseenCopies: number
      /** True when this card could capture something right now: possible only on the opening move, and throwing it then gives that capture up. */
      couldHaveCaptured: boolean
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

/** The facts about one legal move, worked out by actually playing it on the stand-in state. */
export function moveFacts(view: GameView, state: GameState, intent: Intent): MoveFacts {
  const me = view.viewer
  const after = applyMove(state, me, intent)
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
      }
    }
    case 'throw':
      return {
        kind: 'throw',
        card: intent.card,
        points: pointValue(intent.card),
        unseenCopies: unseenCopies(view, captureValue(intent.card)),
        couldHaveCaptured: requiredCaptureIds(state.floor, intent.card).length > 0,
      }
    case 'bid':
      throw new Error('A bid is advised with adviseBids, not as a move.')
  }
}

export function scoreFacts(facts: MoveFacts): number {
  switch (facts.kind) {
    case 'capture':
      return W.captureBase + W.perPointCaptured * facts.points + W.perCardCaptured * (facts.taken.length + 1) + W.perSweepPoint * facts.sweepBonus
    case 'build':
      return W.buildBase + (facts.cemented ? W.buildCemented : 0) + W.perUnseenCopyOfBuild * facts.unseenCopies + (facts.unseenCopies > 0 ? W.perPointExposedInHouse * facts.pointsInHouse : 0)
    case 'modify':
      return W.modifyBase + (facts.mode === 'cement' ? W.buildCemented : 0) + W.perUnseenCopyOfModify * facts.unseenCopies + (facts.unseenCopies > 0 ? W.perPointAddedToHouse * facts.pointsAdded : 0)
    case 'throw':
      return W.throwBase + W.perPointThrown * facts.points + W.perUnseenMatchOfThrow * facts.unseenCopies + (facts.couldHaveCaptured ? W.perMissedCapture : 0)
  }
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
  const moves = legalMoves(state, view.viewer, options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs })
  // Working out the facts means playing each move once more, so it gets its own share of the time limit. Captures and throws always get theirs;
  // only the optional moves (builds and house changes, which come last) can be dropped.
  const factsDeadline = options.budgetMs === undefined ? Infinity : Date.now() + options.budgetMs
  return moves
    .flatMap((intent, index) => {
      if ((intent.type === 'build' || intent.type === 'modify') && Date.now() > factsDeadline) return []
      const facts = moveFacts(view, state, intent)
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
  for (const advice of rankMoves(view, options)) {
    const signature = adviceSignature(advice)
    if (seen.has(signature)) continue
    seen.add(signature)
    chosen.push(advice)
    if (chosen.length >= wanted) break
  }
  return chosen
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
