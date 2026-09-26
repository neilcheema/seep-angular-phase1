import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import {
  type Card as CardModel,
  cardEquals,
  cardLabel,
  faceLabel,
  Suit,
  captureValue,
  isHouseValue,
  SeatId,
  teamOf,
  type FourPlayerGameState,
  dealNextFourPlayerHand,
  legalFourPlayerBids,
  placeFourPlayerBid,
  playFourPlayerBuildHouse,
  playFourPlayerCapture,
  playFourPlayerModifyHouse,
  playFourPlayerThrow,
  startFourPlayerMatch,
  type FloorItem,
  allCardsOf,
  findHouseByValue,
  findItem,
  hasAnyLegalCapture,
  isHouse,
  isLoose,
  itemValue,
  hasCaptureValue,
  removeCard,
  chooseFourPlayerBid,
  chooseFourPlayerMove,
  chooseFourPlayerOpeningMove,
  type ComputerPlayAction4P,
} from 'seep-engine'
import { FourPlayerStatusPanelComponent } from '../../components/four-player-status-panel/four-player-status-panel.component'
import { OpponentHandComponent } from '../../components/opponent-hand/opponent-hand.component'
import { FourPlayerFloorItemComponent } from '../../components/four-player-floor-item/four-player-floor-item.component'
import { PlayerHandComponent } from '../../components/player-hand/player-hand.component'
import { CardComponent } from '../../components/card/card.component'

const COMPUTER_THINK_MS = 700

type RevealKind = 'capture' | 'build' | 'cement' | 'break' | 'throw' | 'bid'

/** A single move, frozen for display: what was played, what it interacted with, why (if AI). */
interface MoveReveal {
  readonly seat: SeatId
  readonly kind: RevealKind
  readonly label: string
  readonly playedCard: CardModel | null
  readonly targetCards: CardModel[]
  readonly reason?: string
  /** Sweep bonus this move earned, if any — 0 when it didn't sweep. */
  readonly sweepBonus: number
}

interface LogEntry {
  readonly seat: SeatId
  readonly text: string
  readonly floorSummary: string
}

const SUIT_SYMBOL: Record<Suit, string> = {
  [Suit.Spades]: '\u2660',
  [Suit.Hearts]: '\u2665',
  [Suit.Clubs]: '\u2663',
  [Suit.Diamonds]: '\u2666',
}

const SEAT_TAG: Record<SeatId, string> = {
  p1: 'You', p2: 'Player 2', p3: 'Your partner', p4: 'Player 4',
}

/**
 * The four-player team game page. Every move — the human's own included —
 * pauses on a MoveReveal overlay (the card played, whatever it interacted
 * with on the floor, and why for computer moves) until "Next" is clicked.
 *
 * Sweep bonuses are explicitly surfaced on every capture, human or
 * computer — previously only the AI's own reasoning text ever mentioned a
 * sweep, so the human player's own captures gave zero indication whether
 * a sweep bonus was earned even when one was. Fixed by comparing
 * sweepPoints for the acting seat's team before and after the move, for
 * both the human capture handler and the computer capture snapshot.
 */
@Component({
  selector: 'app-four-player',
  standalone: true,
  imports: [
    FourPlayerStatusPanelComponent, OpponentHandComponent, FourPlayerFloorItemComponent,
    PlayerHandComponent, CardComponent,
  ],
  templateUrl: './four-player.component.html',
})
export class FourPlayerComponent {
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)

  readonly state = signal<FourPlayerGameState | null>(null)
  readonly selectedCard = signal<CardModel | null>(null)
  readonly selectedFloorIds = signal<string[]>([])
  readonly message = signal<string | null>(null)
  readonly pendingReveal = signal<MoveReveal | null>(null)
  readonly log = signal<LogEntry[]>([])
  readonly humanHasMoved = signal(false)
  readonly opponentHasMoved = signal(false)
  readonly canShareRuleNote = computed(() => this.humanHasMoved() && this.opponentHasMoved())
  readonly ruleNotePanelOpen = signal(false)
  readonly ruleNoteText = signal('')

  readonly isPlayerTurn = computed(() => {
    const s = this.state()
    return (
      !!s &&
      !this.pendingReveal() &&
      s.turn === SeatId.P1 &&
      (s.phase === 'playing' || (s.phase === 'opening-move' && s.bidder === SeatId.P1))
    )
  })

  readonly selectedHouses = computed<FloorItem<SeatId>[]>(() => {
    const s = this.state()
    if (!s) return []
    return this.selectedFloorIds().map((id) => findItem(s.floor, id)!).filter(isHouse)
  })

  readonly selectedLoose = computed<FloorItem<SeatId>[]>(() => {
    const s = this.state()
    if (!s) return []
    return this.selectedFloorIds().map((id) => findItem(s.floor, id)!).filter(isLoose)
  })

  readonly looseSum = computed(() => this.selectedLoose().reduce((t, i) => t + itemValue(i), 0))
  readonly isOpening = computed(() => this.state()?.phase === 'opening-move')

  readonly bidMatches = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    return !!(s && c && (!this.isOpening() || captureValue(c) === s.bidValue))
  })

  readonly canThrow = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    return !!(
      s && c && this.selectedFloorIds().length === 0 && this.bidMatches() &&
      (this.isOpening() || !hasAnyLegalCapture(s.floor, c))
    )
  })

  readonly canCapture = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    if (!(s && c && this.selectedFloorIds().length > 0 && this.bidMatches())) return false
    const houses = this.selectedHouses()
    const loose = this.selectedLoose()
    if (houses.length === 1 && loose.length === 0) return itemValue(houses[0]!) === captureValue(c)
    return houses.length === 0 && this.looseSum() === captureValue(c)
  })

  readonly buildTargetValue = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    if (!c) return 0
    const sum = this.looseSum() + captureValue(c)
    // Founding a house isn't limited to summing to exactly its target value
    // — a combination summing to a multiple of the target (e.g. a played
    // card, a loose 9, and two separate loose Kings: 4+9+13+13=39=3x13)
    // folds all three complete sets into one house, already cemented.
    // During the opening move the target must equal the bid regardless, so
    // prefer that first if it evenly divides the sum.
    if (this.isOpening() && s?.bidValue != null && sum % s.bidValue === 0) return s.bidValue
    if (isHouseValue(sum)) return sum
    for (let v = 13; v >= 9; v--) {
      if (sum % v === 0) return v
    }
    return sum
  })

  readonly canBuild = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    const target = this.buildTargetValue()
    const sum = c ? this.looseSum() + captureValue(c) : 0
    return !!(
      s && c && this.selectedHouses().length === 0 && isHouseValue(target) && sum % target === 0 &&
      (!this.isOpening() || target === s.bidValue) &&
      !findHouseByValue(s.floor, target) &&
      hasCaptureValue(removeCard(s.hands.p1, c), target)
    )
  })

  readonly canModify = computed(
    () => !!(this.state() && this.selectedCard() && this.selectedHouses().length === 1 && !this.isOpening()),
  )

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.has('new')) this.startNewGame()
    })

    effect((onCleanup) => {
      const s = this.state()
      const paused = this.pendingReveal()
      if (!s || paused) return
      const seat = s.turn
      if (seat === SeatId.P1) return

      if (s.phase === 'bidding' && seat === s.bidder) {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const value = chooseFourPlayerBid(cur)
            const next = placeFourPlayerBid(cur, seat, value)
            this.reveal({
              seat, kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [], sweepBonus: 0,
              reason: 'chose the lowest value they could support from their hand',
            }, next.floor)
            return next
          })
        }, COMPUTER_THINK_MS)
        onCleanup(() => clearTimeout(t))
        return
      }

      if (s.phase === 'opening-move' && seat === s.bidder) {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const action = chooseFourPlayerOpeningMove(cur)
            const before = cur
            const next = this.applyAction(cur, seat, action)
            this.reveal(this.snapshotAction(before, next, seat, action), next.floor)
            return next
          })
        }, COMPUTER_THINK_MS)
        onCleanup(() => clearTimeout(t))
        return
      }

      if (s.phase === 'playing') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const action = chooseFourPlayerMove(cur)
            const before = cur
            const next = this.applyAction(cur, seat, action)
            this.reveal(this.snapshotAction(before, next, seat, action), next.floor)
            return next
          })
        }, COMPUTER_THINK_MS)
        onCleanup(() => clearTimeout(t))
      }
    })
  }

  startNewGame(): void {
    this.state.set(startFourPlayerMatch())
    this.clearSelection()
    this.message.set(null)
    this.log.set([])
    this.pendingReveal.set(null)
  }

  legalBidsFor(state: FourPlayerGameState): number[] {
    return legalFourPlayerBids(state)
  }

  isFloorSelected(id: string): boolean {
    return this.selectedFloorIds().includes(id)
  }

  seatTag(seat: SeatId): string {
    return SEAT_TAG[seat]
  }

  dismissReveal(): void {
    this.pendingReveal.set(null)
  }

  toggleRuleNotePanel(): void {
    this.ruleNotePanelOpen.update((open) => !open)
  }

  onRuleNoteInput(value: string): void {
    this.ruleNoteText.set(value)
  }

  /**
   * Builds a mailto: link with what the user noticed plus as much of the
   * recent move log as fits in a safe URL length, most-recent move first,
   * and opens it — this hands off to the user's own email client rather
   * than sending anything directly, since a static site with no backend
   * has no way to dispatch an email itself.
   */
  sendRuleNote(): void {
    const s = this.state()
    const description = this.ruleNoteText().trim() || '(no details given)'
    const header =
      `What I noticed:\n${description}\n\n` +
      `Game: 4 Player Seep\n` +
      (s ? `Phase: ${s.phase}, Turn: ${this.seatTag(s.turn)}\n` : 'No active game.\n') +
      `\nMove log (most recent first):\n`

    const MAX_BODY_LENGTH = 1500
    const entriesNewestFirst = [...this.log()].reverse().map((e) => `${e.text}\n  ${e.floorSummary}`)
    let logText = ''
    let included = 0
    for (const entry of entriesNewestFirst) {
      const candidate = logText + (logText ? '\n\n' : '') + entry
      if ((header + candidate).length > MAX_BODY_LENGTH) break
      logText = candidate
      included++
    }
    const omittedNote =
      included < entriesNewestFirst.length
        ? `\n\n...(${entriesNewestFirst.length - included} earlier move(s) omitted for length)`
        : ''

    const subject = 'Seep — a rule that might need a look (4 Player)'
    const body = header + logText + omittedNote
    window.location.href = `mailto:narender.cheema@cheemaclan.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    this.ruleNotePanelOpen.set(false)
    this.ruleNoteText.set('')
  }

  onBid(value: number): void {
    const s = this.state()
    if (!s) return
    try {
      const next = placeFourPlayerBid(s, SeatId.P1, value)
      this.state.set(next)
      this.reveal({ seat: SeatId.P1, kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [], sweepBonus: 0 }, next.floor)
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.')
    }
  }

  onFloorClick(item: FloorItem<SeatId>): void {
    this.message.set(null)
    this.selectedFloorIds.update((ids) =>
      ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id],
    )
  }

  onCardSelect(card: CardModel): void {
    this.message.set(null)
    this.selectedFloorIds.set([])
    this.selectedCard.update((prev) => (prev && cardEquals(prev, card) ? null : card))
  }

  onCapture(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    const targetItemIds = this.selectedFloorIds()
    const targetCards = allCardsOf(s.floor, targetItemIds)
    this.runPlayerAction(() => playFourPlayerCapture(s, SeatId.P1, c, targetItemIds), (next) => {
      const sweepBonus = next.sweepPoints[teamOf(SeatId.P1)] - s.sweepPoints[teamOf(SeatId.P1)]
      return {
        seat: SeatId.P1,
        kind: 'capture',
        label: 'Capturing',
        playedCard: c,
        targetCards,
        sweepBonus,
      }
    })
  }

  onBuild(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    const looseIds = this.selectedLoose().map((i) => i.id)
    const target = this.buildTargetValue()
    const sum = this.looseSum() + captureValue(c)
    const multiple = sum / target
    const label = multiple > 1 ? `Building house of ${target} (${multiple}\u00d7, cemented)` : `Building house of ${target}`
    this.runPlayerAction(() => playFourPlayerBuildHouse(s, SeatId.P1, c, looseIds, target), () => ({
      seat: SeatId.P1, kind: 'build', label, playedCard: c,
      targetCards: allCardsOf(s.floor, looseIds), sweepBonus: 0,
    }))
  }

  onModify(): void {
    const s = this.state()
    const c = this.selectedCard()
    const houses = this.selectedHouses()
    if (!s || !c || houses.length !== 1) return
    const house = houses[0]!
    const looseIds = this.selectedLoose().map((i) => i.id)
    const houseCards = isHouse(house) ? house.cards : []
    // Cementing isn't limited to a bare single-card exact match anymore — any
    // combination (card + loose cards) whose sum is a positive multiple of
    // the house's value cements it. Mirrors the same check the engine itself
    // uses in playFourPlayerModifyHouse, so the label shown here (and the
    // reveal overlay it drives) always matches what actually happens.
    const addedValue = captureValue(c) + this.looseSum()
    const isCement = isHouse(house) && addedValue % house.captureValue === 0
    this.runPlayerAction(() => playFourPlayerModifyHouse(s, SeatId.P1, c, house.id, looseIds), () => ({
      seat: SeatId.P1,
      kind: isCement ? 'cement' : 'break',
      label: isCement ? 'Cementing house' : 'Breaking house',
      playedCard: c,
      targetCards: [...houseCards, ...allCardsOf(s.floor, looseIds)],
      sweepBonus: 0,
    }))
  }

  onThrow(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    this.runPlayerAction(() => playFourPlayerThrow(s, SeatId.P1, c), () => (
      { seat: SeatId.P1, kind: 'throw', label: 'Throwing', playedCard: c, targetCards: [], sweepBonus: 0 }
    ))
  }

  onDealNext(): void {
    const s = this.state()
    if (!s) return
    this.state.set(dealNextFourPlayerHand(s))
    this.log.set([])
    this.pendingReveal.set(null)
  }

  onPlayAgain(): void {
    this.state.set(startFourPlayerMatch())
    this.clearSelection()
    this.log.set([])
    this.pendingReveal.set(null)
  }

  private applyAction(state: FourPlayerGameState, seat: SeatId, action: ComputerPlayAction4P): FourPlayerGameState {
    if (action.type === 'capture') return playFourPlayerCapture(state, seat, action.card, action.targetItemIds)
    if (action.type === 'build') {
      return playFourPlayerBuildHouse(state, seat, action.card, action.looseItemIds, action.targetValue)
    }
    if (action.type === 'modify') {
      return playFourPlayerModifyHouse(state, seat, action.card, action.houseId, action.extraLooseItemIds)
    }
    return playFourPlayerThrow(state, seat, action.card)
  }

  /**
   * Builds a MoveReveal snapshot from a computer action. `before` is the
   * pre-move state (captured/combined cards are already gone from the
   * floor by the time the move resolves, so target cards have to be read
   * from there); `after` is the resulting state, used only to compute the
   * sweep bonus actually awarded (the AI's own `reason` text already says
   * "for a sweep bonus" when it *intended* one, but computing it from real
   * state here — rather than trusting the reason string — is what makes
   * this reliable even if the AI's own sweep detection ever drifts from
   * the engine's).
   */
  private snapshotAction(
    before: FourPlayerGameState, after: FourPlayerGameState, seat: SeatId, action: ComputerPlayAction4P,
  ): MoveReveal {
    const sweepBonus = after.sweepPoints[teamOf(seat)] - before.sweepPoints[teamOf(seat)]

    if (action.type === 'capture') {
      return {
        seat, kind: 'capture',
        label: 'Capturing',
        playedCard: action.card,
        targetCards: allCardsOf(before.floor, action.targetItemIds),
        reason: action.reason,
        sweepBonus,
      }
    }
    if (action.type === 'build') {
      return {
        seat, kind: 'build', label: `Building house of ${action.targetValue}`, playedCard: action.card,
        targetCards: allCardsOf(before.floor, action.looseItemIds), reason: action.reason, sweepBonus: 0,
      }
    }
    if (action.type === 'modify') {
      const house = findItem(before.floor, action.houseId)
      const houseCards = house && isHouse(house) ? house.cards : []
      const isCement =
        action.extraLooseItemIds.length === 0 && house && isHouse(house) && captureValue(action.card) === house.captureValue
      return {
        seat, kind: isCement ? 'cement' : 'break', label: isCement ? 'Cementing house' : 'Breaking house',
        playedCard: action.card, targetCards: [...houseCards, ...allCardsOf(before.floor, action.extraLooseItemIds)],
        reason: action.reason, sweepBonus: 0,
      }
    }
    return { seat, kind: 'throw', label: 'Throwing', playedCard: action.card, targetCards: [], reason: action.reason, sweepBonus: 0 }
  }

  private reveal(snapshot: MoveReveal, floor: FloorItem<SeatId>[]): void {
    this.trackMove(snapshot.seat)
    this.pendingReveal.set(snapshot)
    this.log.update((list) => [
      ...list,
      { seat: snapshot.seat, text: this.revealToLogText(snapshot), floorSummary: this.describeFloor(floor) },
    ])
  }

  /** Unlocks the "notice something off?" note once both the human and at least one computer seat have each played a move (a bid counts). Never re-locks once unlocked. */
  private trackMove(seat: SeatId): void {
    if (seat === SeatId.P1) this.humanHasMoved.set(true)
    else this.opponentHasMoved.set(true)
  }

  /** Renders the current floor as compact text for the move log: loose cards, then piles with value + owning team. */
  private describeFloor(floor: FloorItem<SeatId>[]): string {
    if (floor.length === 0) return 'Floor: empty'
    const parts = floor.map((item) =>
      isHouse(item) ? `Pile-${item.captureValue} (${this.pileOwnerLabel(item.owners)})` : this.shortCard(item.card),
    )
    return `Floor: ${parts.join(', ')}`
  }

  private pileOwnerLabel(owners: SeatId[]): string {
    const teams = new Set(owners.map(teamOf))
    if (teams.size > 1) return 'Shared'
    const [onlyTeam] = teams
    return onlyTeam === 'teamA' ? 'Human team' : 'AI team'
  }

  private shortCard(c: CardModel): string {
    return `${faceLabel(c.face)}${SUIT_SYMBOL[c.suit]}`
  }

  private revealToLogText(r: MoveReveal): string {
    const framing = this.seatTag(r.seat)
    const cardTxt = r.playedCard ? cardLabel(r.playedCard) : ''
    let base: string
    switch (r.kind) {
      case 'capture':
        base = `${framing} played ${cardTxt} and captured ${r.targetCards.length} card(s).`
        if (r.sweepBonus > 0) base += ` Seep! +${r.sweepBonus} sweep bonus.`
        break
      case 'build': base = `${framing} built a house using ${cardTxt} plus ${r.targetCards.length} floor card(s).`; break
      case 'cement': base = `${framing} cemented a house using ${cardTxt}.`; break
      case 'break': base = `${framing} broke a house using ${cardTxt}.`; break
      case 'throw': base = `${framing} threw down ${cardTxt}.`; break
      case 'bid': base = `${framing} ${r.label.toLowerCase()}.`; break
    }
    return r.reason ? `${base} (${r.reason})` : base
  }

  private runPlayerAction(
    fn: () => FourPlayerGameState,
    buildSnapshot: (next: FourPlayerGameState) => MoveReveal,
  ): void {
    try {
      const next = fn()
      this.state.set(next)
      this.reveal(buildSnapshot(next), next.floor)
      this.clearSelection()
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.')
    }
  }

  private clearSelection(): void {
    this.selectedCard.set(null)
    this.selectedFloorIds.set([])
  }
}
