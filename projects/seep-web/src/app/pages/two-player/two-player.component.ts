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
  type PlayerId,
  type GameState,
  dealNextHand,
  legalBids,
  placeBid,
  playBuildHouse,
  playCapture,
  playModifyHouse,
  playThrow,
  startMatch,
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
  chooseComputerBid,
  chooseComputerMove,
  chooseComputerOpeningMove,
  type ComputerPlayAction,
} from 'seep-engine'
import { StatusPanelComponent } from '../../components/status-panel/status-panel.component'
import { OpponentHandComponent } from '../../components/opponent-hand/opponent-hand.component'
import { FloorItemComponent } from '../../components/floor-item/floor-item.component'
import { PlayerHandComponent } from '../../components/player-hand/player-hand.component'
import { CardComponent } from '../../components/card/card.component'

const COMPUTER_THINK_MS = 700

type RevealKind = 'capture' | 'build' | 'cement' | 'break' | 'throw' | 'bid'

/** A single move, frozen for display: what was played, what it interacted with, why (if the computer). */
interface MoveReveal {
  readonly who: PlayerId
  readonly kind: RevealKind
  readonly label: string
  readonly playedCard: CardModel | null
  readonly targetCards: CardModel[]
  readonly reason?: string
  /** Sweep bonus this move earned, if any — 0 when it didn't sweep. */
  readonly sweepBonus: number
}

interface LogEntry {
  readonly who: PlayerId
  readonly text: string
  readonly floorSummary: string
}

const SUIT_SYMBOL: Record<Suit, string> = {
  [Suit.Spades]: '\u2660',
  [Suit.Hearts]: '\u2665',
  [Suit.Clubs]: '\u2663',
  [Suit.Diamonds]: '\u2666',
}

/**
 * The two-player game page. Every move — the human's own included — pauses
 * on a MoveReveal overlay until "Next" is clicked, the same step-through
 * pattern built for the four-player game, ported here for the same reason:
 * a way to verify each move visually rather than only via the engine's own
 * test suite.
 */
@Component({
  selector: 'app-two-player',
  standalone: true,
  imports: [StatusPanelComponent, OpponentHandComponent, FloorItemComponent, PlayerHandComponent, CardComponent],
  templateUrl: './two-player.component.html',
})
export class TwoPlayerComponent {
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)

  readonly state = signal<GameState | null>(null)
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
      s.turn === 'player' &&
      (s.phase === 'playing' || (s.phase === 'opening-move' && s.bidder === 'player'))
    )
  })

  readonly selectedHouses = computed<FloorItem[]>(() => {
    const s = this.state()
    if (!s) return []
    return this.selectedFloorIds().map((id) => findItem(s.floor, id)!).filter(isHouse)
  })

  readonly selectedLoose = computed<FloorItem[]>(() => {
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
    // — a combination summing to a multiple of the target folds all those
    // complete sets into one house, already cemented. During the opening
    // move the target must equal the bid regardless, so prefer that first
    // if it evenly divides the sum.
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
      hasCaptureValue(removeCard(s.hands.player, c), target)
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
    // this effect and lets the computer's next move get scheduled.
    effect((onCleanup) => {
      const s = this.state()
      const paused = this.pendingReveal()
      if (!s || paused) return
      if (s.turn !== 'opponent') return

      if (s.phase === 'bidding' && s.bidder === 'opponent') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const value = chooseComputerBid(cur)
            const next = placeBid(cur, 'opponent', value)
            this.reveal({
              who: 'opponent', kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [], sweepBonus: 0,
              reason: 'chose the lowest value it could support from its hand',
            }, next.floor)
            return next
          })
        }, COMPUTER_THINK_MS)
        onCleanup(() => clearTimeout(t))
        return
      }

      if (s.phase === 'opening-move' && s.bidder === 'opponent') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur
            const action = chooseComputerOpeningMove(cur)
            const before = cur
            const next = this.applyAction(cur, action)
            this.reveal(this.snapshotAction(before, next, action), next.floor)
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
            const action = chooseComputerMove(cur)
            const before = cur
            const next = this.applyAction(cur, action)
            this.reveal(this.snapshotAction(before, next, action), next.floor)
            return next
          })
        }, COMPUTER_THINK_MS)
        onCleanup(() => clearTimeout(t))
      }
    })
  }

  startNewGame(): void {
    this.state.set(startMatch('player'))
    this.clearSelection()
    this.message.set(null)
    this.log.set([])
    this.pendingReveal.set(null)
  }

  legalBidsFor(state: GameState): number[] {
    return legalBids(state)
  }

  isFloorSelected(id: string): boolean {
    return this.selectedFloorIds().includes(id)
  }

  whoTag(who: PlayerId): string {
    return who === 'player' ? 'You' : 'Opponent'
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
      `Game: 2 Player Seep\n` +
      (s ? `Phase: ${s.phase}, Turn: ${this.whoTag(s.turn)}\n` : 'No active game.\n') +
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

    const subject = 'Seep — a rule that might need a look (2 Player)'
    const body = header + logText + omittedNote
    window.location.href = `mailto:narender.cheema@cheemaclan.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    this.ruleNotePanelOpen.set(false)
    this.ruleNoteText.set('')
  }

  onBid(value: number): void {
    const s = this.state()
    if (!s) return
    try {
      const next = placeBid(s, 'player', value)
      this.state.set(next)
      this.reveal({ who: 'player', kind: 'bid', label: `Bid ${value}`, playedCard: null, targetCards: [], sweepBonus: 0 }, next.floor)
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.')
    }
  }

  onFloorClick(item: FloorItem): void {
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
    this.runPlayerAction(() => playCapture(s, 'player', c, targetItemIds), (next) => {
      const sweepBonus = next.sweepPoints.player - s.sweepPoints.player
      return {
        who: 'player',
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
    this.runPlayerAction(() => playBuildHouse(s, 'player', c, looseIds, target), () => ({
      who: 'player', kind: 'build', label, playedCard: c,
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
    // Cementing accepts any combination (card + loose cards) summing to a
    // positive multiple of the house's value, not just a bare single-card
    // exact match — mirrors the same check the engine itself uses.
    const addedValue = captureValue(c) + this.looseSum()
    const isCement = isHouse(house) && addedValue % house.captureValue === 0
    this.runPlayerAction(() => playModifyHouse(s, 'player', c, house.id, looseIds), () => ({
      who: 'player',
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
    this.runPlayerAction(() => playThrow(s, 'player', c), () => (
      { who: 'player', kind: 'throw', label: 'Throwing', playedCard: c, targetCards: [], sweepBonus: 0 }
    ))
  }

  onDealNext(): void {
    const s = this.state()
    if (!s) return
    this.state.set(dealNextHand(s))
    this.log.set([])
    this.pendingReveal.set(null)
  }

  onPlayAgain(): void {
    this.state.set(startMatch('player'))
    this.clearSelection()
    this.log.set([])
    this.pendingReveal.set(null)
  }

  private applyAction(state: GameState, action: ComputerPlayAction): GameState {
    if (action.type === 'capture') return playCapture(state, 'opponent', action.card, action.targetItemIds)
    if (action.type === 'build') {
      return playBuildHouse(state, 'opponent', action.card, action.looseItemIds, action.targetValue)
    }
    return playThrow(state, 'opponent', action.card)
  }

  /** Builds a MoveReveal snapshot from a computer action, reading target cards from the pre-move state. */
  private snapshotAction(before: GameState, after: GameState, action: ComputerPlayAction): MoveReveal {
    const sweepBonus = after.sweepPoints.opponent - before.sweepPoints.opponent

    if (action.type === 'capture') {
      return {
        who: 'opponent', kind: 'capture', label: 'Capturing', playedCard: action.card,
        targetCards: allCardsOf(before.floor, action.targetItemIds), reason: action.reason, sweepBonus,
      }
    }
    if (action.type === 'build') {
      return {
        who: 'opponent', kind: 'build', label: `Building house of ${action.targetValue}`, playedCard: action.card,
        targetCards: allCardsOf(before.floor, action.looseItemIds), reason: action.reason, sweepBonus: 0,
      }
    }
    return {
      who: 'opponent', kind: 'throw', label: 'Throwing', playedCard: action.card, reason: action.reason,
      targetCards: [], sweepBonus: 0,
    }
  }

  private reveal(snapshot: MoveReveal, floor: FloorItem[]): void {
    this.trackMove(snapshot.who)
    this.pendingReveal.set(snapshot)
    this.log.update((list) => [
      ...list,
      { who: snapshot.who, text: this.revealToLogText(snapshot), floorSummary: this.describeFloor(floor) },
    ])
  }

  /** Unlocks the "notice something off?" note once both you and the computer have each played a move (a bid counts). Never re-locks once unlocked. */
  private trackMove(who: PlayerId): void {
    if (who === 'player') this.humanHasMoved.set(true)
    else this.opponentHasMoved.set(true)
  }

  /** Renders the current floor as compact text for the move log: loose cards, then piles with value + owner. */
  private describeFloor(floor: FloorItem[]): string {
    if (floor.length === 0) return 'Floor: empty'
    const parts = floor.map((item) =>
      isHouse(item) ? `Pile-${item.captureValue} (${this.pileOwnerLabel(item.owners)})` : this.shortCard(item.card),
    )
    return `Floor: ${parts.join(', ')}`
  }

  private pileOwnerLabel(owners: PlayerId[]): string {
    const hasPlayer = owners.includes('player')
    const hasOpponent = owners.includes('opponent')
    if (hasPlayer && hasOpponent) return 'Shared'
    return hasPlayer ? 'Yours' : "Opponent's"
  }

  private shortCard(c: CardModel): string {
    return `${faceLabel(c.face)}${SUIT_SYMBOL[c.suit]}`
  }

  private revealToLogText(r: MoveReveal): string {
    const framing = this.whoTag(r.who)
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
    fn: () => GameState,
    buildSnapshot: (next: GameState) => MoveReveal,
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
