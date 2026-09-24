import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import {
  type Card as CardModel,
  cardEquals,
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

const COMPUTER_DELAY_MS = 850

interface NarrationEntry {
  readonly seat: SeatId
  readonly text: string
}

const SEAT_TAG: Record<SeatId, string> = {
  p1: 'You',
  p2: 'Player 2',
  p3: 'Partner',
  p4: 'Player 4',
}

/**
 * The four-player team game page (spec §8, §8.9-8.10). State-management
 * shape mirrors TwoPlayerComponent exactly (signals, computed, an effect
 * driving computer turns) — the differences are: three computer seats
 * instead of one, and every computer move gets narrated (spec §8.9)
 * before the banner hands off to whichever seat plays next.
 */
@Component({
  selector: 'app-four-player',
  standalone: true,
  imports: [
    FourPlayerStatusPanelComponent, OpponentHandComponent, FourPlayerFloorItemComponent, PlayerHandComponent,
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
  readonly narrations = signal<NarrationEntry[]>([])
  readonly viewedIndex = signal<number | null>(null)

  readonly isPlayerTurn = computed(() => {
    const s = this.state()
    return (
      !!s &&
      s.turn === SeatId.P1 &&
      (s.phase === 'playing' || (s.phase === 'opening-move' && s.bidder === SeatId.P1))
    )
  })

  readonly selectedHouses = computed<FloorItem<SeatId>[]>(() => {
    const s = this.state()
    if (!s) return []
    return this.selectedFloorIds()
      .map((id) => findItem(s.floor, id)!)
      .filter(isHouse)
  })

  readonly selectedLoose = computed<FloorItem<SeatId>[]>(() => {
    const s = this.state()
    if (!s) return []
    return this.selectedFloorIds()
      .map((id) => findItem(s.floor, id)!)
      .filter(isLoose)
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
      s &&
      c &&
      this.selectedFloorIds().length === 0 &&
      this.bidMatches() &&
      (this.isOpening() || !hasAnyLegalCapture(s.floor, c))
    )
  })

  readonly canCapture = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    if (!(s && c && this.selectedFloorIds().length > 0 && this.bidMatches())) return false
    const houses = this.selectedHouses()
    const loose = this.selectedLoose()
    if (houses.length === 1 && loose.length === 0) {
      return itemValue(houses[0]!) === captureValue(c)
    }
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
      s &&
      c &&
      this.selectedHouses().length === 0 &&
      isHouseValue(target) &&
      (!this.isOpening() || target === s.bidValue) &&
      !findHouseByValue(s.floor, target) &&
      hasCaptureValue(removeCard(s.hands.p1, c), target)
    )
  })

  readonly canModify = computed(
    () => !!(this.state() && this.selectedCard() && this.selectedHouses().length === 1 && !this.isOpening()),
  )

  readonly displayedNarration = computed<NarrationEntry | null>(() => {
    const list = this.narrations()
    if (list.length === 0) return null
    const idx = this.viewedIndex()
    return idx !== null && idx < list.length ? list[idx]! : list[list.length - 1]!
  })

  constructor() {
    // Deep-link support (spec §5.3): /four-player?new=1 starts a fresh game immediately.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.has('new')) this.startNewGame()
    })

    // Computer automation for whichever of p2/p3/p4 has the turn — mirrors
    // TwoPlayerComponent's effect, generalized to three computer seats and
    // wired to push a narration entry (spec §8.9) alongside every move.
    effect((onCleanup) => {
      const s = this.state()
      if (!s) return
      const seat = s.turn
      if (seat === SeatId.P1) return

      if (s.phase === 'bidding' && seat === s.bidder) {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const value = chooseFourPlayerBid(cur)
            const next = placeFourPlayerBid(cur, seat, value)
            this.pushNarration(seat, `bid ${value} — the lowest value they could support from their hand`)
            return next
          })
        }, COMPUTER_DELAY_MS)
        onCleanup(() => clearTimeout(t))
        return
      }

      if (s.phase === 'opening-move' && seat === s.bidder) {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const action = chooseFourPlayerOpeningMove(cur)
            const next = this.applyAction(cur, seat, action)
            this.pushNarration(seat, action.reason)
            return next
          })
        }, COMPUTER_DELAY_MS)
        onCleanup(() => clearTimeout(t))
        return
      }

      if (s.phase === 'playing') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const action = chooseFourPlayerMove(cur)
            const next = this.applyAction(cur, seat, action)
            this.pushNarration(seat, action.reason)
            return next
          })
        }, COMPUTER_DELAY_MS)
        onCleanup(() => clearTimeout(t))
      }
    })
  }

  startNewGame(): void {
    this.state.set(startFourPlayerMatch())
    this.clearSelection()
    this.message.set(null)
    this.narrations.set([])
    this.viewedIndex.set(null)
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

  viewNarration(index: number): void {
    this.viewedIndex.set(index)
  }

  onBid(value: number): void {
    const s = this.state()
    if (!s) return
    this.runAction(() => placeFourPlayerBid(s, SeatId.P1, value))
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
    this.runAction(() => playFourPlayerCapture(s, SeatId.P1, c, this.selectedFloorIds()))
  }

  onBuild(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    const looseIds = this.selectedLoose().map((i) => i.id)
    const target = this.buildTargetValue()
    this.runAction(() => playFourPlayerBuildHouse(s, SeatId.P1, c, looseIds, target))
  }

  onModify(): void {
    const s = this.state()
    const c = this.selectedCard()
    const houses = this.selectedHouses()
    if (!s || !c || houses.length !== 1) return
    const looseIds = this.selectedLoose().map((i) => i.id)
    this.runAction(() => playFourPlayerModifyHouse(s, SeatId.P1, c, houses[0]!.id, looseIds))
  }

  onThrow(): void {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c) return
    this.runAction(() => playFourPlayerThrow(s, SeatId.P1, c))
  }

  onDealNext(): void {
    const s = this.state()
    if (!s) return
    this.state.set(dealNextFourPlayerHand(s))
    this.narrations.set([])
    this.viewedIndex.set(null)
  }

  onPlayAgain(): void {
    this.state.set(startFourPlayerMatch())
    this.clearSelection()
    this.narrations.set([])
    this.viewedIndex.set(null)
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

  private pushNarration(seat: SeatId, reason: string): void {
    const framing = seat === SeatId.P3 ? 'Your partner' : this.seatTag(seat)
    const text = `${framing} ${reason}.`
    this.narrations.update((list) => [...list, { seat, text }])
    this.viewedIndex.set(null)
  }

  private clearSelection(): void {
    this.selectedCard.set(null)
    this.selectedFloorIds.set([])
  }

  private runAction(fn: () => FourPlayerGameState): void {
    try {
      const next = fn()
      this.state.set(next)
      this.clearSelection()
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.')
    }
  }
}
