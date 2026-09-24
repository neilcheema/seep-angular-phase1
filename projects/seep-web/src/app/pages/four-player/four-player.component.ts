import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import {
  type Card as CardModel,
  cardEquals,
  cardLabel,
  captureValue,
  isHouseValue,
  SeatId,
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
}

interface LogEntry {
  readonly seat: SeatId
  readonly text: string
}

const SEAT_TAG: Record<SeatId, string> = {
  p1: 'You', p2: 'Player 2', p3: 'Your partner', p4: 'Player 4',
}

/**
 * The four-player team game page. Every move — the human's own included —
 * pauses on a MoveReveal overlay (the card played, whatever it interacted
 * with on the floor, and why for computer moves) until "Next" is clicked.
 * This exists specifically so the whole game can be stepped through and
 * visually verified move by move, which is the actual QA ask this was
 * built for — not just a UX nicety.
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
    const c = this.selectedCard()
    return c ? this.looseSum() + captureValue(c) : 0
  })

  readonly canBuild = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    const target = this.buildTargetValue()
    return !!(
      s && c && this.selectedHouses().length === 0 && isHouseValue(target) &&
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

    // Computer automation. Reads pendingReveal() as well as state() so that
    // dismissing a reveal (which doesn't itself change `state`) re-triggers
    // this effect and lets the next computer move get scheduled.
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
              seat, kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [],
              reason: 'chose the lowest value they could support from their hand',
            })
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
            const snapshot = this.snapshotAction(cur, seat, action)
            const next = this.applyAction(cur, seat, action)
            this.reveal(snapshot)
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
            const snapshot = this.snapshotAction(cur, seat, action)
            const next = this.applyAction(cur, seat, action)
            this.reveal(snapshot)
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

  /** Dismisses the current move reveal — the only way play advances past a paused move. */
  dismissReveal(): void {
    this.pendingReveal.set(null)
  }

  onBid(value: number): void {
    const s = this.state()
    if (!s) return
    try {
      const next = placeFourPlayerBid(s, SeatId.P1, value)
      this.state.set(next)
      this.reveal({ seat: SeatId.P1, kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [] })
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
    this.runPlayerAction(
      () => playFourPlayerCapture(s, SeatId.P1, c, targetItemIds),
      { seat: SeatId.P1, kind: 'capture', label: 'Capturing', playedCard: c, targetCards: allCardsOf(s.floor, targetItemIds) },
    )
  }

  onBuild(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    const looseIds = this.selectedLoose().map((i) => i.id)
    const target = this.buildTargetValue()
    this.runPlayerAction(
      () => playFourPlayerBuildHouse(s, SeatId.P1, c, looseIds, target),
      { seat: SeatId.P1, kind: 'build', label: `Building house of ${target}`, playedCard: c, targetCards: allCardsOf(s.floor, looseIds) },
    )
  }

  onModify(): void {
    const s = this.state()
    const c = this.selectedCard()
    const houses = this.selectedHouses()
    if (!s || !c || houses.length !== 1) return
    const house = houses[0]!
    const looseIds = this.selectedLoose().map((i) => i.id)
    const isCement = looseIds.length === 0 && isHouse(house) && captureValue(c) === house.captureValue
    const houseCards = isHouse(house) ? house.cards : []
    this.runPlayerAction(
      () => playFourPlayerModifyHouse(s, SeatId.P1, c, house.id, looseIds),
      {
        seat: SeatId.P1,
        kind: isCement ? 'cement' : 'break',
        label: isCement ? 'Cementing house' : 'Breaking house',
        playedCard: c,
        targetCards: [...houseCards, ...allCardsOf(s.floor, looseIds)],
      },
    )
  }

  onThrow(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    this.runPlayerAction(
      () => playFourPlayerThrow(s, SeatId.P1, c),
      { seat: SeatId.P1, kind: 'throw', label: 'Throwing', playedCard: c, targetCards: [] },
    )
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

  /** Builds a MoveReveal snapshot from a computer action, using the *pre-move* state (so captured/combined cards are still findable on the floor). */
  private snapshotAction(state: FourPlayerGameState, seat: SeatId, action: ComputerPlayAction4P): MoveReveal {
    if (action.type === 'capture') {
      return {
        seat, kind: 'capture', label: 'Capturing', playedCard: action.card,
        targetCards: allCardsOf(state.floor, action.targetItemIds), reason: action.reason,
      }
    }
    if (action.type === 'build') {
      return {
        seat, kind: 'build', label: `Building house of ${action.targetValue}`, playedCard: action.card,
        targetCards: allCardsOf(state.floor, action.looseItemIds), reason: action.reason,
      }
    }
    if (action.type === 'modify') {
      const house = findItem(state.floor, action.houseId)
      const houseCards = house && isHouse(house) ? house.cards : []
      const isCement =
        action.extraLooseItemIds.length === 0 && house && isHouse(house) && captureValue(action.card) === house.captureValue
      return {
        seat, kind: isCement ? 'cement' : 'break', label: isCement ? 'Cementing house' : 'Breaking house',
        playedCard: action.card, targetCards: [...houseCards, ...allCardsOf(state.floor, action.extraLooseItemIds)],
        reason: action.reason,
      }
    }
    return { seat, kind: 'throw', label: 'Throwing', playedCard: action.card, targetCards: [], reason: action.reason }
  }

  private reveal(snapshot: MoveReveal): void {
    this.pendingReveal.set(snapshot)
    this.log.update((list) => [...list, { seat: snapshot.seat, text: this.revealToLogText(snapshot) }])
  }

  private revealToLogText(r: MoveReveal): string {
    const framing = this.seatTag(r.seat)
    const cardTxt = r.playedCard ? cardLabel(r.playedCard) : ''
    let base: string
    switch (r.kind) {
      case 'capture': base = `${framing} played ${cardTxt} and captured ${r.targetCards.length} card(s).`; break
      case 'build': base = `${framing} built a house using ${cardTxt} plus ${r.targetCards.length} floor card(s).`; break
      case 'cement': base = `${framing} cemented a house using ${cardTxt}.`; break
      case 'break': base = `${framing} broke a house using ${cardTxt}.`; break
      case 'throw': base = `${framing} threw down ${cardTxt}.`; break
      case 'bid': base = `${framing} ${r.label.toLowerCase()}.`; break
    }
    return r.reason ? `${base} (${r.reason})` : base
  }

  private runPlayerAction(fn: () => FourPlayerGameState, snapshot: MoveReveal): void {
    try {
      const next = fn()
      this.state.set(next)
      this.reveal(snapshot)
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
