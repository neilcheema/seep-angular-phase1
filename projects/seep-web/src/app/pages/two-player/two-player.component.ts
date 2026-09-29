import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { APP_VERSION, FEEDBACK_EMAIL } from '../../version'
import {
  type Card as CardModel,
  type FloorItem,
  type GameView,
  type Intent,
  type PlayerId,
  Suit,
  allCardsOf,
  captureValue,
  cardEquals,
  cardLabel,
  faceLabel,
  findHouseByValue,
  findItem,
  hasAnyLegalCapture,
  hasCaptureValue,
  isHouse,
  isHouseValue,
  isLoose,
  itemValue,
  removeCard,
} from 'seep-engine'
import { StatusPanelComponent } from '../../components/status-panel/status-panel.component'
import { OpponentHandComponent } from '../../components/opponent-hand/opponent-hand.component'
import { FloorItemComponent } from '../../components/floor-item/floor-item.component'
import { PlayerHandComponent } from '../../components/player-hand/player-hand.component'
import { CardComponent } from '../../components/card/card.component'
import { LocalSession } from '../../core/local-session'
import type { MoveEvent } from '../../core/game-session'

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
 * The two-player game page. Every move — the human's own included —
 * pauses on a MoveReveal overlay until "Next" is clicked.
 *
 * As of this patch, the page no longer talks to the engine directly: it
 * holds a LocalSession and reads its (already redacted) view, submits
 * intents, and reacts to whatever move the session reports happened —
 * whether that came from the human's own submit() or from a bot's
 * scheduled move inside the session. That single reaction point
 * (the effect in the constructor) is what replaces the five separate,
 * near-duplicate places this page used to build its own MoveReveal by
 * hand — see buildReveal().
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

  readonly appVersion = APP_VERSION

  readonly session = signal<LocalSession | null>(null)
  readonly state = computed<GameView | null>(() => this.session()?.view() ?? null)
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
      hasCaptureValue(removeCard(s.myHand, c), target)
    )
  })

  readonly canModify = computed(
    () => !!(this.state() && this.selectedCard() && this.selectedHouses().length === 1 && !this.isOpening()),
  )

  constructor() {
    this.destroyRef.onDestroy(() => this.session()?.dispose())

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.has('new')) this.startNewGame()
    })

    // Reacts to every move the session reports — the human's own
    // (from submit()) and the bot's (scheduled inside the session,
    // COMPUTER_THINK_MS after acknowledge()) alike — and builds the same
    // move-reveal presentation this page has always shown.
    effect(() => {
      const session = this.session()
      if (!session) return
      const move = session.lastMove()
      if (!move) return
      this.reveal(this.buildReveal(move), move.after.floor)
    })
  }

  startNewGame(): void {
    const existing = this.session()
    if (existing) {
      existing.startNewMatch()
    } else {
      this.session.set(new LocalSession('player', 'player'))
    }
    this.clearSelection()
    this.message.set(null)
    this.log.set([])
    this.pendingReveal.set(null)
  }

  legalBidsFor(view: GameView): number[] {
    return [...new Set(view.myHand.map((c) => captureValue(c)).filter(isHouseValue))]
  }

  isFloorSelected(id: string): boolean {
    return this.selectedFloorIds().includes(id)
  }

  whoTag(who: PlayerId): string {
    return who === 'player' ? 'You' : 'Opponent'
  }

  dismissReveal(): void {
    this.pendingReveal.set(null)
    this.session()?.acknowledge()
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
      `Version: ${APP_VERSION}\n` +
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
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    this.ruleNotePanelOpen.set(false)
    this.ruleNoteText.set('')
  }

  onBid(value: number): void {
    this.runPlayerAction(() => this.session()!.submit({ type: 'bid', value }))
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
    const c = this.selectedCard()
    if (!c) return
    const targetItemIds = this.selectedFloorIds()
    this.runPlayerAction(() => this.session()!.submit({ type: 'capture', card: c, targetItemIds }))
  }

  onBuild(): void {
    const c = this.selectedCard()
    if (!c) return
    const looseItemIds = this.selectedLoose().map((i) => i.id)
    const targetValue = this.buildTargetValue()
    this.runPlayerAction(() => this.session()!.submit({ type: 'build', card: c, looseItemIds, targetValue }))
  }

  onModify(): void {
    const c = this.selectedCard()
    const houses = this.selectedHouses()
    if (!c || houses.length !== 1) return
    const houseId = houses[0]!.id
    const extraLooseItemIds = this.selectedLoose().map((i) => i.id)
    this.runPlayerAction(() => this.session()!.submit({ type: 'modify', card: c, houseId, extraLooseItemIds }))
  }

  onThrow(): void {
    const c = this.selectedCard()
    if (!c) return
    this.runPlayerAction(() => this.session()!.submit({ type: 'throw', card: c }))
  }

  onDealNext(): void {
    this.session()?.dealNext()
    this.log.set([])
    this.pendingReveal.set(null)
  }

  onPlayAgain(): void {
    this.startNewGame()
  }

  /** Builds a MoveReveal from a session move event — the single place this now happens, replacing five separate near-duplicate blocks that used to build this by hand for each move type. */
  private buildReveal(move: MoveEvent<GameView, Intent, PlayerId>): MoveReveal {
    const { intent, before, after, actor, reason } = move
    const sweepBonus = after.sweepPoints[actor] - before.sweepPoints[actor]

    switch (intent.type) {
      case 'bid':
        return {
          who: actor, kind: 'bid', label: `Bid ${intent.value}`, playedCard: null, targetCards: [], sweepBonus, reason,
        }
      case 'capture':
        return {
          who: actor, kind: 'capture', label: 'Capturing', playedCard: intent.card,
          targetCards: allCardsOf(before.floor, intent.targetItemIds), sweepBonus, reason,
        }
      case 'build': {
        const looseSum = intent.looseItemIds.reduce((t, id) => t + itemValue(findItem(before.floor, id)!), 0)
        const sum = captureValue(intent.card) + looseSum
        const multiple = sum / intent.targetValue
        const label = multiple > 1
          ? `Building house of ${intent.targetValue} (${multiple}\u00d7, cemented)`
          : `Building house of ${intent.targetValue}`
        return {
          who: actor, kind: 'build', label, playedCard: intent.card,
          targetCards: allCardsOf(before.floor, intent.looseItemIds), sweepBonus, reason,
        }
      }
      case 'modify': {
        const house = findItem(before.floor, intent.houseId)
        const extraIds = intent.extraLooseItemIds ?? []
        const extraSum = extraIds.reduce((t, id) => t + itemValue(findItem(before.floor, id)!), 0)
        const addedValue = captureValue(intent.card) + extraSum
        const isCement = !!house && isHouse(house) && addedValue % house.captureValue === 0
        const houseCards = house && isHouse(house) ? house.cards : []
        return {
          who: actor, kind: isCement ? 'cement' : 'break', label: isCement ? 'Cementing house' : 'Breaking house',
          playedCard: intent.card, targetCards: [...houseCards, ...allCardsOf(before.floor, extraIds)], sweepBonus, reason,
        }
      }
      case 'throw':
        return {
          who: actor, kind: 'throw', label: 'Throwing', playedCard: intent.card, targetCards: [], sweepBonus, reason,
        }
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

  private runPlayerAction(fn: () => void): void {
    try {
      fn()
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
