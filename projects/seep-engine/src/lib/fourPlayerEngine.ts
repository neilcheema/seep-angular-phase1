import { type ForfeitReason, forfeitReasonText } from './gameEngine'
import { type Card, captureValue, isHouseValue, legalHouseBids } from './card'
import { createDeck, dealFourPlayerHands, shuffleDeck } from './deck'
import { ALL_SEATS, ALL_TEAMS, SeatId, type TeamId, areTeammates, nextSeat, partnerOf, teamOf } from './seats'
import { ENGINE_VERSION } from './version'
import {
  type FloorItem, type House,
  allCardsOf, canSplitIntoSets, findHouseByValue, findItem, findMaximalExactGroups,
  hasAnyLegalCapture, isHouse, isLoose, itemValue, removeItems, sumValues,
} from './floor'
import { hasCard, hasCaptureValue, removeCard } from './hand'
import {
  OPENING_SWEEP_BONUS, SWEEP_BONUS, type HandRecord, type HandSideTotals, checkBazziWinner, computeHandTotals,
} from './scoring'

export type FourPlayerPhase = 'bidding' | 'opening-move' | 'playing' | 'hand-over' | 'match-over'

export interface FourPlayerGameState {
  readonly floor: FloorItem<SeatId>[]
  readonly hands: Record<SeatId, Card[]>
  readonly captures: Record<TeamId, Card[]>
  readonly sweepPoints: Record<TeamId, number>
  readonly matchScores: Record<TeamId, number>
  readonly dealer: SeatId
  readonly bidder: SeatId
  readonly turn: SeatId
  readonly phase: FourPlayerPhase
  readonly bidValue: number | null
  /**
   * Cards dealt but not yet given to anyone's visible hand — the bidder's
   * remaining eight cards and the other three seats' entire hands, held
   * back until the opening move resolves (matching the real dealing
   * procedure: only the bidder's first four cards and the four-card floor
   * are dealt before bidding and the opening move; everyone else is dealt
   * their full hand, all at once, right after). Null once the second deal
   * has happened for this hand.
   */
  readonly pendingDeal: Record<SeatId, Card[]> | null
  readonly lastCapturer: TeamId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly nextItemId: number
  readonly log: string[]
  readonly winner: TeamId | null
  readonly lastHandTotals: Record<TeamId, HandSideTotals> | null
  /** Every hand finished so far this match, oldest first. Absent from games dealt before it existed (treat as empty). */
  readonly handHistory?: readonly HandRecord<TeamId>[]
  readonly misdeals: number
  /** The engine version this game was dealt under — see version.ts. */
  readonly engineVersion: string
}

const MAX_MISDEAL_ATTEMPTS = 25

function emptyRecord<Id extends string, V>(ids: readonly Id[], factory: () => V): Record<Id, V> {
  const out = {} as Record<Id, V>
  for (const id of ids) out[id] = factory()
  return out
}

function pushLog(state: FourPlayerGameState, message: string): FourPlayerGameState {
  return { ...state, log: [...state.log, message] }
}

export function dealFourPlayerHand(
  dealer: SeatId,
  matchScores: Record<TeamId, number> = emptyRecord(ALL_TEAMS, () => 0),
  seed?: number,
  handHistory: readonly HandRecord<TeamId>[] = [],
): FourPlayerGameState {
  const bidder = nextSeat(dealer)
  let attempt = 0
  let floor: Card[] = []
  let bidderFirstFour: Card[] = []
  let bidderRest: Card[] = []
  let otherHands: Record<SeatId, Card[]> = emptyRecord(ALL_SEATS, () => [])

  do {
    // Retries (on a misdeal) stay deterministic too when a seed is given.
    const deck = shuffleDeck(createDeck(), seed === undefined ? undefined : seed + attempt)
    const dealt = dealFourPlayerHands(deck, bidder)
    floor = dealt.floor
    bidderFirstFour = dealt.bidderFirstFour
    bidderRest = dealt.bidderRest
    otherHands = dealt.otherHands
    attempt++
  } while (legalHouseBids(bidderFirstFour).length === 0 && attempt < MAX_MISDEAL_ATTEMPTS)

  const totalPlayable =
    bidderFirstFour.length + bidderRest.length +
    ALL_SEATS.filter((s) => s !== bidder).reduce((t, s) => t + otherHands[s].length, 0)

  const state: FourPlayerGameState = {
    floor: floor.map((card, i) => ({ kind: 'loose', id: `f${i}`, card }) as const),
    hands: { ...emptyRecord(ALL_SEATS, () => [] as Card[]), [bidder]: bidderFirstFour },
    pendingDeal: { ...emptyRecord(ALL_SEATS, () => [] as Card[]), [bidder]: bidderRest, ...otherHands },
    captures: emptyRecord(ALL_TEAMS, () => [] as Card[]),
    sweepPoints: emptyRecord(ALL_TEAMS, () => 0),
    matchScores,
    dealer,
    bidder,
    turn: bidder,
    phase: 'bidding',
    bidValue: null,
    lastCapturer: null,
    cardsPlayedThisHand: 0,
    totalPlayableThisHand: totalPlayable,
    nextItemId: floor.length,
    log:
      attempt > 1 ? [`Misdealt ${attempt - 1} time(s) — no house card in the bidder's first four.`] : [],
    winner: null,
    lastHandTotals: null,
    handHistory,
    misdeals: attempt - 1,
    engineVersion: ENGINE_VERSION,
  }
  return pushLog(state, `New hand dealt. Dealer: ${dealer}. ${bidder} must bid.`)
}

export function startFourPlayerMatch(dealer: SeatId = SeatId.P4, seed?: number): FourPlayerGameState {
  return dealFourPlayerHand(dealer, emptyRecord(ALL_TEAMS, () => 0), seed)
}

/**
 * Computes who deals the next hand, per the real dealing procedure: the
 * dealer's team deals again if they're behind or tied after the hand just
 * played; if the hand put them ahead, the deal passes to the next seat.
 * If the hand also completed a baazi, the deal instead passes to that
 * next-in-line player's partner, not to them directly.
 *
 * The baazi branch is currently unreachable via dealNextFourPlayerHand,
 * since a baazi ends the match outright here (spec §9's "first to 100
 * wins") rather than resetting to continue toward a further baazi — kept
 * correct and independently testable regardless, in case that design
 * ever changes.
 */
export function computeNextDealer(
  dealer: SeatId,
  matchScoresAfterHand: Record<TeamId, number>,
  baaziWinner: TeamId | null,
): SeatId {
  const dealerTeam = teamOf(dealer)
  const otherTeam = ALL_TEAMS.find((t) => t !== dealerTeam)!
  const normalNextDealer =
    matchScoresAfterHand[dealerTeam] > matchScoresAfterHand[otherTeam] ? nextSeat(dealer) : dealer
  return baaziWinner ? partnerOf(normalNextDealer) : normalNextDealer
}

export function dealNextFourPlayerHand(state: FourPlayerGameState, seed?: number): FourPlayerGameState {
  if (state.phase !== 'hand-over') throw new Error('The current hand has not finished.')
  const nextDealer = computeNextDealer(state.dealer, state.matchScores, null)
  return dealFourPlayerHand(nextDealer, state.matchScores, seed, state.handHistory ?? [])
}

/**
 * Ends the match because `loser` ran out of time: the loser's whole team
 * forfeits and the other team wins. Not a rule of play; see forfeitMatch in
 * gameEngine.ts.
 */
export function forfeitFourPlayerMatch(state: FourPlayerGameState, loser: SeatId, reason: ForfeitReason = 'timeout'): FourPlayerGameState {
  if (state.phase === 'match-over') throw new Error('The match is already over.')
  const winner = ALL_TEAMS.find((team) => team !== teamOf(loser))!
  return pushLog({ ...state, phase: 'match-over', winner }, `${loser} ${forfeitReasonText(reason)}`)
}

export function legalFourPlayerBids(state: FourPlayerGameState): number[] {
  if (state.phase !== 'bidding') return []
  return legalHouseBids(state.hands[state.bidder])
}

/**
 * Every kind of move a player can make, as one JSON-serializable type —
 * what a future server would actually receive over the wire from a
 * client, instead of the client needing to know which of five
 * differently-shaped functions to call.
 */
export type FourPlayerIntent =
  | { type: 'bid'; value: number }
  | { type: 'capture'; card: Card; targetItemIds: string[] }
  | { type: 'build'; card: Card; looseItemIds: string[]; targetValue: number }
  | { type: 'modify'; card: Card; houseId: string; extraLooseItemIds?: string[] }
  | { type: 'throw'; card: Card }

/**
 * Single entry point for applying a move: routes to
 * placeFourPlayerBid/playFourPlayerCapture/playFourPlayerBuildHouse/
 * playFourPlayerModifyHouse/playFourPlayerThrow based on intent.type.
 * Every one of those functions already validates its own move and throws
 * on anything illegal, so this adds no new validation of its own — it's
 * purely a dispatch, kept as a thin wrapper on purpose so there is only
 * one place the rules actually live.
 */
export function applyFourPlayerMove(
  state: FourPlayerGameState, seat: SeatId, intent: FourPlayerIntent,
): FourPlayerGameState {
  switch (intent.type) {
    case 'bid':
      return placeFourPlayerBid(state, seat, intent.value)
    case 'capture':
      return playFourPlayerCapture(state, seat, intent.card, intent.targetItemIds)
    case 'build':
      return playFourPlayerBuildHouse(state, seat, intent.card, intent.looseItemIds, intent.targetValue)
    case 'modify':
      return playFourPlayerModifyHouse(state, seat, intent.card, intent.houseId, intent.extraLooseItemIds)
    case 'throw':
      return playFourPlayerThrow(state, seat, intent.card)
  }
}

export function placeFourPlayerBid(state: FourPlayerGameState, seat: SeatId, value: number): FourPlayerGameState {
  if (state.phase !== 'bidding') throw new Error('Not currently bidding.')
  if (state.turn !== seat || state.bidder !== seat) throw new Error('Not your bid.')
  if (!legalFourPlayerBids(state).includes(value)) {
    throw new Error(`${value} is not a legal bid from your first four cards.`)
  }
  return pushLog({ ...state, bidValue: value, phase: 'opening-move' }, `${seat} bid ${value}.`)
}

export function finishFourPlayerHand(
  state: FourPlayerGameState,
  finalFloor: FloorItem<SeatId>[],
  lastCapturer: TeamId | null,
): FourPlayerGameState {
  let finalCaptures = state.captures
  if (finalFloor.length > 0 && lastCapturer) {
    const leftover = finalFloor.flatMap((item) => (isHouse(item) ? item.cards : [item.card]))
    finalCaptures = {
      ...finalCaptures,
      [lastCapturer]: [...finalCaptures[lastCapturer], ...leftover],
    }
  }

  const totals = {} as Record<TeamId, HandSideTotals>
  for (const team of ALL_TEAMS) {
    totals[team] = computeHandTotals(finalCaptures[team], state.sweepPoints[team])
  }

  const matchScores = {} as Record<TeamId, number>
  for (const team of ALL_TEAMS) {
    matchScores[team] = state.matchScores[team] + totals[team].total
  }

  const winner = checkBazziWinner(matchScores, ALL_TEAMS)

  return pushLog(
    {
      ...state,
      floor: [],
      captures: finalCaptures,
      matchScores,
      lastHandTotals: totals,
      handHistory: [...(state.handHistory ?? []), { totals }],
      phase: winner ? 'match-over' : 'hand-over',
      winner,
    },
    `Hand over. Team A scored ${totals.teamA.total}, Team B scored ${totals.teamB.total}.`,
  )
}

function assertTurn(state: FourPlayerGameState, seat: SeatId): void {
  if (state.phase !== 'opening-move' && state.phase !== 'playing') {
    throw new Error('No move can be made right now.')
  }
  if (state.turn !== seat) throw new Error("It's not your turn.")
  if (state.phase === 'opening-move' && state.bidder !== seat) {
    throw new Error('Only the bidder makes the opening move.')
  }
}

function takeCard(state: FourPlayerGameState, seat: SeatId, card: Card): Card[] {
  const hand = state.hands[seat]
  if (!hasCard(hand, card)) throw new Error('That card is not in hand.')
  return removeCard(hand, card)
}

function isLastPlayOfHand(state: FourPlayerGameState): boolean {
  return state.cardsPlayedThisHand + 1 === state.totalPlayableThisHand
}

function sweepBonusFor(state: FourPlayerGameState): number {
  if (isLastPlayOfHand(state)) return 0
  if (state.cardsPlayedThisHand === 0) return OPENING_SWEEP_BONUS
  return SWEEP_BONUS
}

function finishMove(
  state: FourPlayerGameState,
  seat: SeatId,
  newHand: Card[],
  newFloor: FloorItem<SeatId>[],
  newCaptures: Record<TeamId, Card[]>,
  newSweepPoints: Record<TeamId, number>,
  lastCapturerTeam: TeamId | null,
): FourPlayerGameState {
  let newHands = { ...state.hands, [seat]: newHand }
  let pendingDeal = state.pendingDeal

  // The opening move completes the staged deal: the bidder's hand (down to
  // whatever they didn't just play) is topped up with the rest of their
  // cards, and all three other seats receive their full hands for the
  // first time, all at once — matching the real dealing procedure (see
  // FourPlayerGameState.pendingDeal).
  if (state.phase === 'opening-move' && pendingDeal) {
    newHands = Object.fromEntries(
      ALL_SEATS.map((s) => [s, [...newHands[s], ...pendingDeal![s]]]),
    ) as Record<SeatId, Card[]>
    pendingDeal = null
  }

  const cardsPlayedThisHand = state.cardsPlayedThisHand + 1
  const allHandsEmpty = ALL_SEATS.every((s) => newHands[s].length === 0)

  const base: FourPlayerGameState = {
    ...state,
    hands: newHands,
    pendingDeal,
    floor: newFloor,
    captures: newCaptures,
    sweepPoints: newSweepPoints,
    lastCapturer: lastCapturerTeam ?? state.lastCapturer,
    cardsPlayedThisHand,
    turn: nextSeat(seat),
    phase: 'playing',
  }

  if (!allHandsEmpty) return base
  return finishFourPlayerHand(base, base.floor, base.lastCapturer)
}

export function legalCaptureTargetsFourPlayer(state: FourPlayerGameState, card: Card): FloorItem<SeatId>[] {
  const target = captureValue(card)
  const house = findHouseByValue(state.floor, target)
  if (house) return [house]
  return state.floor.filter(isLoose).filter((item) => itemValue(item) === target)
}

export function playFourPlayerCapture(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  targetItemIds: string[],
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move' && captureValue(card) !== state.bidValue) {
    throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
  }
  if (targetItemIds.length === 0) throw new Error('Select at least one card or house to capture.')

  const target = captureValue(card)
  const selectedHouse = targetItemIds.map((id) => findItem(state.floor, id)!).find(isHouse)

  // A house's own value must exactly match the played card — it can never
  // be combined arithmetically with other floor items to reach some other
  // sum (a 9-house plus a loose 3 does not make a queen capturable). This
  // is the one thing that never changes about houses.
  if (selectedHouse && selectedHouse.captureValue !== target) {
    throw new Error(
      `A house can only be captured by a card matching its own value of ${selectedHouse.captureValue}.`,
    )
  }

  // Beyond that, a house at exactly the played value and any disjoint loose
  // groups also at that value are independent matches to the same card and
  // must all be captured together — the same maximal-capture principle
  // already applied to multiple loose groups (§21), now covering houses
  // too: "if there is a jack-house and a loose 7 and a loose 4 on the
  // floor, then by playing a jack you can pick up the house and also the
  // 7 and the 4" (a house is simply never allowed to be one of the terms
  // summed together to reach the target — it only ever matches on its own
  // exact value, alongside whatever else also does).
  const houseAtTarget = findHouseByValue(state.floor, target)
  const maxGroups = findMaximalExactGroups(state.floor, target)
  const requiredIds = new Set(houseAtTarget ? [houseAtTarget.id, ...maxGroups.flat()] : maxGroups.flat())

  if (requiredIds.size > 0) {
    const selectedSet = new Set(targetItemIds)
    const matches = requiredIds.size === selectedSet.size && [...requiredIds].every((id) => selectedSet.has(id))
    if (!matches) {
      throw new Error(
        `A bigger combined capture of ${target} is available on the floor — you must capture ` +
          `every matching house and group together, not just some of it.`,
      )
    }
  } else {
    const sum = sumValues(state.floor, targetItemIds)
    if (sum !== target) throw new Error(`Selected cards total ${sum}, but ${card.face} captures ${target}.`)
  }

  const newHand = takeCard(state, seat, card)
  const capturedCards = allCardsOf(state.floor, targetItemIds)
  const newFloor = removeItems(state.floor, targetItemIds)
  const team = teamOf(seat)
  const newCaptures = {
    ...state.captures,
    [team]: [...state.captures[team], ...capturedCards, card],
  }

  let newSweepPoints = state.sweepPoints
  let sweepMsg = ''
  if (newFloor.length === 0) {
    const bonus = sweepBonusFor(state)
    if (bonus > 0) {
      newSweepPoints = { ...state.sweepPoints, [team]: state.sweepPoints[team] + bonus }
      sweepMsg = ` Sweep! +${bonus} for ${team}.`
    }
  }

  const next = finishMove(state, seat, newHand, newFloor, newCaptures, newSweepPoints, team)
  return pushLog(next, `${seat} played ${card.face} of ${card.suit} and captured.${sweepMsg}`)
}

export function playFourPlayerBuildHouse(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  looseItemIds: string[],
  targetValue: number,
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move' && targetValue !== state.bidValue) {
    throw new Error(`Your opening house must be built for your bid of ${state.bidValue}.`)
  }
  if (!isHouseValue(targetValue)) throw new Error('House values must be between 9 and 13.')
  if (findHouseByValue(state.floor, targetValue)) {
    throw new Error(`A house of ${targetValue} already exists — add to it instead of building a new one.`)
  }
  const looseItems = looseItemIds.map((id) => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const sum = looseItems.reduce((t, i) => t + captureValue(i.card), 0) + captureValue(card)
  // Founding a house isn't limited to summing to exactly its target value —
  // any combination that splits into complete sets of the target folds in
  // that many complete sets at once, the same generalization already
  // applied to cementing (spec §15.5): a played card, a loose 9, and two
  // separate loose Kings (13 each) can all combine into one house of 13,
  // already cemented, holding three sets of 13 (39 total) in a single move.
  if (sum % targetValue !== 0) {
    throw new Error(`Selected cards total ${sum}, not a multiple of your target of ${targetValue}.`)
  }
  // The cards must really BE whole sets of the target, not merely a total that divides evenly: 9, 4+5 and 3+6 are three sets of 9, but 11+12+13
  // (36) contains no set of 9 at all, and 10+8 (18) none either.
  if (!canSplitIntoSets([captureValue(card), ...looseItems.map((i) => captureValue(i.card))], targetValue)) {
    throw new Error(`Those cards cannot be split into sets that each add up to ${targetValue}.`)
  }
  const multiple = sum / targetValue

  // Enforced by default for every player, human or computer: once a target
  // value is chosen, you can't cherry-pick just some of the matching loose
  // cards and leave others behind — every card that could complete another
  // exact-target set alongside the played card must be pulled in too. This
  // is the same mandatory-maximal principle already enforced for captures
  // (spec §21), applied here to building. Choosing a *different* target
  // value entirely remains a free choice — this only blocks under-including
  // for the value actually chosen.
  const virtualId = '__played-card__'
  const augmentedFloor: FloorItem<SeatId>[] = [...state.floor, { kind: 'loose', id: virtualId, card }]
  const requiredGroups = findMaximalExactGroups(augmentedFloor, targetValue)
  const cardGroup = requiredGroups.find((g) => g.includes(virtualId))
  if (cardGroup) {
    const requiredLooseIds = requiredGroups.flat().filter((id) => id !== virtualId)
    const requiredSet = new Set(requiredLooseIds)
    const selectedSet = new Set(looseItemIds)
    const matches = requiredSet.size === selectedSet.size && [...requiredSet].every((id) => selectedSet.has(id))
    if (!matches) {
      throw new Error(
        `A bigger combined house of ${targetValue} is available on the floor — you must pull in ` +
          `every matching group, not just some of them.`,
      )
    }
  }

  const newHand = takeCard(state, seat, card)
  if (!hasCaptureValue(newHand, targetValue)) {
    throw new Error(`You need another card worth ${targetValue} left in hand to build this house.`)
  }

  const houseId = `f${state.nextItemId}`
  const house: House<SeatId> = {
    kind: 'house',
    id: houseId,
    cards: [...looseItems.map((i) => i.card), card],
    captureValue: targetValue,
    cemented: multiple > 1,
    owners: [seat],
  }
  const seeded = { ...state, nextItemId: state.nextItemId + 1 }
  const newFloor = [...removeItems(seeded.floor, looseItemIds), house]

  const next = finishMove(seeded, seat, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  const multipleNote = multiple > 1 ? ` (${multiple}\u00d7 its value, already cemented)` : ''
  return pushLog(next, `${seat} built a house of ${targetValue}${multipleNote}.`)
}

export function playFourPlayerModifyHouse(
  state: FourPlayerGameState,
  seat: SeatId,
  card: Card,
  houseId: string,
  extraLooseItemIds: string[] = [],
): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move') {
    throw new Error('There are no houses on the floor yet to add to.')
  }
  const house = findItem(state.floor, houseId)
  if (!house || !isHouse(house)) throw new Error('That is not a house on the floor.')

  const extraItems = extraLooseItemIds.map((id) => {
    const item = findItem(state.floor, id)
    if (!item || !isLoose(item)) throw new Error('Selected item is not a loose floor card.')
    return item
  })
  const addedValue = captureValue(card) + extraItems.reduce((t, i) => t + captureValue(i.card), 0)
  // Cementing isn't limited to a single card that exactly matches the house's
  // value — any combination (this card plus optional loose floor cards) whose
  // cards split into complete sets of the house's value cements it, adding a full
  // extra "set" of that value into the pile without changing its capture
  // value. A bare single-card exact match is just the simplest case (1x).
  const isMultipleCement = canSplitIntoSets([captureValue(card), ...extraItems.map((i) => captureValue(i.card))], house.captureValue)
  if (!isMultipleCement && addedValue % house.captureValue === 0) {
    // A total that divides evenly but is not made of whole sets (11+12+13 onto a house of 9). Breaking the house up cannot be meant either:
    // a house is already 9 or more, so adding a whole multiple of its value would pass 13.
    throw new Error(`Those cards cannot be split into sets that each add up to ${house.captureValue}, so they cannot be added to the house of ${house.captureValue}.`)
  }

  const newHand = takeCard(state, seat, card)

  if (isMultipleCement) {
    const isPartnersHouse = house.owners.some((owner) => areTeammates(owner, seat))
    if (!isPartnersHouse && !hasCaptureValue(newHand, house.captureValue)) {
      throw new Error(`You need another card worth ${house.captureValue} left in hand to cement this house.`)
    }
    const cemented: House<SeatId> = {
      ...house,
      cards: [...house.cards, ...extraItems.map((i) => i.card), card],
      cemented: true,
      owners: [...new Set([...house.owners, seat])],
    }
    const newFloor = [...removeItems(state.floor, extraLooseItemIds).filter((i) => i.id !== houseId), cemented]
    const next = finishMove(state, seat, newHand, newFloor, state.captures, state.sweepPoints, null)
    const freeNote = isPartnersHouse ? " (added freely to your partner's house)" : ''
    const multiple = addedValue / house.captureValue
    const multipleNote = multiple > 1 ? ` (${multiple}\u00d7 its value)` : ''
    return pushLog(next, `${seat} cemented the house of ${house.captureValue}${multipleNote}${freeNote}.`)
  }

  if (house.owners.includes(seat)) {
    throw new Error('You cannot break a house you already own — someone else must break it.')
  }
  if (house.cemented) throw new Error('A cemented house cannot be broken.')
  const newValue = house.captureValue + addedValue
  if (!isHouseValue(newValue)) {
    throw new Error(`${newValue} is not a legal house value (must be 9-13).`)
  }
  if (!hasCaptureValue(newHand, newValue)) {
    throw new Error(`You need a card worth ${newValue} left in hand to break this house up to that value.`)
  }

  const mergeTarget = state.floor.find(
    (i) => i.id !== houseId && isHouse(i) && i.captureValue === newValue,
  ) as House<SeatId> | undefined

  let newFloor = removeItems(
    state.floor,
    [houseId, ...extraLooseItemIds, ...(mergeTarget ? [mergeTarget.id] : [])],
  )
  const grownCards = [...house.cards, ...extraItems.map((i) => i.card), card]

  const resultHouse: House<SeatId> = mergeTarget
    ? {
        kind: 'house',
        id: houseId,
        cards: [...grownCards, ...mergeTarget.cards],
        captureValue: newValue,
        cemented: true,
        owners: [...new Set([...house.owners, ...mergeTarget.owners, seat])],
      }
    : {
        kind: 'house',
        id: houseId,
        cards: grownCards,
        captureValue: newValue,
        cemented: false,
        owners: [seat],
      }
  newFloor = [...newFloor, resultHouse]

  const next = finishMove(state, seat, newHand, newFloor, state.captures, state.sweepPoints, null)
  return pushLog(
    next,
    `${seat} broke the house of ${house.captureValue} up to ${newValue}` +
      `${mergeTarget ? ' and merged it into a cemented house' : ''}.`,
  )
}

export function playFourPlayerThrow(state: FourPlayerGameState, seat: SeatId, card: Card): FourPlayerGameState {
  assertTurn(state, seat)
  if (state.phase === 'opening-move') {
    if (captureValue(card) !== state.bidValue) {
      throw new Error(`Your opening move must use a card matching your bid of ${state.bidValue}.`)
    }
  } else if (hasAnyLegalCapture(state.floor, card)) {
    throw new Error('You must capture with this card — a capture is available.')
  }

  const newHand = takeCard(state, seat, card)
  const itemId = `f${state.nextItemId}`
  const seeded = { ...state, nextItemId: state.nextItemId + 1 }
  const newFloor = [...seeded.floor, { kind: 'loose', id: itemId, card } as const]

  const next = finishMove(seeded, seat, newHand, newFloor, seeded.captures, seeded.sweepPoints, null)
  return pushLog(next, `${seat} threw down ${card.face} of ${card.suit}.`)
}

/**
 * What one seat is allowed to see — the shape a future server would
 * actually send over the wire. The other three seats' hands become
 * counts (handCounts covers all four seats, including the viewer's own,
 * so a client always has one uniform source for "how many cards does
 * seat X hold" rather than treating its own hand as a special case).
 * pendingDeal (cards dealt but not yet given to any visible hand) never
 * appears at all — a client has no legitimate use for knowing how many
 * cards are waiting to be dealt to anyone. nextItemId is dropped too, as
 * pure internal bookkeeping with no meaning to a client.
 */
export interface FourPlayerGameView {
  readonly viewer: SeatId
  readonly floor: FloorItem<SeatId>[]
  readonly myHand: Card[]
  readonly handCounts: Record<SeatId, number>
  readonly captures: Record<TeamId, Card[]>
  readonly sweepPoints: Record<TeamId, number>
  readonly matchScores: Record<TeamId, number>
  readonly dealer: SeatId
  readonly bidder: SeatId
  readonly turn: SeatId
  readonly phase: FourPlayerPhase
  readonly bidValue: number | null
  readonly lastCapturer: TeamId | null
  readonly cardsPlayedThisHand: number
  readonly totalPlayableThisHand: number
  readonly log: string[]
  readonly winner: TeamId | null
  readonly lastHandTotals: Record<TeamId, HandSideTotals> | null
  /** Every hand finished so far this match, oldest first. Absent from games dealt before it existed (treat as empty). */
  readonly handHistory?: readonly HandRecord<TeamId>[]
  readonly misdeals: number
  readonly engineVersion: string
}

export function viewForSeat(state: FourPlayerGameState, viewer: SeatId): FourPlayerGameView {
  const handCounts = {} as Record<SeatId, number>
  for (const seat of ALL_SEATS) handCounts[seat] = state.hands[seat].length
  return {
    viewer,
    floor: state.floor,
    myHand: state.hands[viewer],
    handCounts,
    captures: state.captures,
    sweepPoints: state.sweepPoints,
    matchScores: state.matchScores,
    dealer: state.dealer,
    bidder: state.bidder,
    turn: state.turn,
    phase: state.phase,
    bidValue: state.bidValue,
    lastCapturer: state.lastCapturer,
    cardsPlayedThisHand: state.cardsPlayedThisHand,
    totalPlayableThisHand: state.totalPlayableThisHand,
    log: state.log,
    winner: state.winner,
    lastHandTotals: state.lastHandTotals,
    handHistory: state.handHistory ?? [],
    misdeals: state.misdeals,
    engineVersion: state.engineVersion,
  }
}
