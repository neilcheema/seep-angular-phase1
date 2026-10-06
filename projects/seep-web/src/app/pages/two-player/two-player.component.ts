import { MatchResultsComponent } from '../../components/match-results/match-results.component'
import { captureHintFor } from '../../core/capture-hint'
import { buildTwoPlayerResults } from '../../core/match-results'
import { describeTurn, isOnTheMove } from '../../core/turn-text'
import { Component, DestroyRef, type OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
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
  requiredCaptureIds,
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
import type { GameSession, MoveEvent } from '../../core/game-session'

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
  imports: [StatusPanelComponent, OpponentHandComponent, FloorItemComponent, PlayerHandComponent, CardComponent, MatchResultsComponent, RouterLink],
  templateUrl: './two-player.component.html',
})
export class TwoPlayerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)

  readonly appVersion = APP_VERSION

  /**
   * A game already in progress against another person, supplied by the online
   * table screen. When absent this page plays the bots, exactly as it always has.
   */
  readonly remote = input<GameSession<GameView, Intent, PlayerId> | null>(null)
  /** A line of text about the turn clock, supplied by the online table screen (never set against the bots). */
  readonly clockLine = input<string | null>(null)
  readonly clockUrgent = input(false)
  /** The other player has asked for a rematch (supplied by the online table screen). */
  readonly rematchOffered = input(false)
  readonly rematchBusy = input(false)
  readonly rematchError = input<string | null>(null)
  /** The person pressed Rematch (or Join rematch). The online table screen makes the request. */
  readonly rematch = output<void>()
  /** The other player's chosen name, when playing a person (supplied by the online table screen). */
  readonly opponentName = input<string | null>(null)
  /** How the opponent is referred to: their name if they chose one, else the generic word. */
  readonly opponentLabel = computed(() => this.opponentName() ?? 'Opponent')
  readonly session = signal<GameSession<GameView, Intent, PlayerId> | null>(null)
  readonly opponentPossessive = computed(() => (this.remote() ? "the other player's" : "the computer's"))
  readonly state = computed<GameView | null>(() => this.session()?.view() ?? null)
  /** The results of a finished match (null while it is still going). */
  readonly results = computed(() => {
    const s = this.state()
    return s && s.phase === 'match-over' ? buildTwoPlayerResults(s, this.opponentName()) : null
  })
  /** Whose turn it is, in words, for the big line above the buttons (online tables only). */
  readonly turnLine = computed(() => {
    const s = this.state()
    return s && this.remote() ? describeTurn(s.phase, s.turn, 'player', () => this.opponentLabel()) : null
  })
  /** True while it is the opponent's turn, so their name can carry a marker. */
  readonly opponentOnTheMove = computed(() => {
    const s = this.state()
    return !!s && !!this.remote() && isOnTheMove(s.phase, s.turn, 'opponent')
  })
  readonly selectedCard = signal<CardModel | null>(null)
  readonly selectedFloorIds = signal<string[]>([])
  readonly message = signal<string | null>(null)
  /** True while a move (or a deal) is being applied. */
  readonly busy = signal(false)
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

  /**
   * Why Throw is greyed out, when the reason is that the selected card HAS to capture: a beginner's "why can't I throw this?". Null otherwise,
   * including during the opening move (the card must match the bid instead) and once the player has started choosing cards to capture.
   */
  readonly captureHint = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    if (!s || !c || !this.isPlayerTurn() || this.isOpening() || this.selectedFloorIds().length > 0) return null
    return captureHintFor(s.floor, c)
  })

  /** "Select them": picks the cards the capture must take, so Capture is ready to press. */
  selectCaptureTargets(): void {
    const hint = this.captureHint()
    if (hint) this.selectedFloorIds.set([...hint.ids])
  }

  /**
   * Mirrors the engine's own playCapture validation exactly
   * (findHouseByValue + findMaximalExactGroups, the same "required
   * selection" computation) rather than a simplified, independent check.
   * The two had drifted: the old version only allowed a house captured
   * alone, or loose cards captured alone, never a house together with a
   * disjoint loose group at the same value — a combination the engine
   * has always required when both exist on the floor together. That
   * drift made a fully legal capture impossible to even select: the
   * button stayed disabled no matter what, since no selection could
   * satisfy either of the old branches.
   */
  readonly canCapture = computed(() => {
    const s = this.state()
    const c = this.selectedCard()
    if (!(s && c && this.selectedFloorIds().length > 0 && this.bidMatches())) return false
    const requiredIds = new Set(requiredCaptureIds(s.floor, c))
    if (requiredIds.size === 0) return false
    const selected = new Set(this.selectedFloorIds())
    return requiredIds.size === selected.size && [...requiredIds].every((id) => selected.has(id))
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

  /** Adopts a supplied online session before the first render, so there is no flash of the "Deal" screen. */
  ngOnInit(): void {
    const remote = this.remote()
    if (remote) this.session.set(remote)
  }

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
      // Only the MOVE should trigger a reveal; building it must not make this effect depend on anything else it reads.
      untracked(() => this.reveal(this.buildReveal(move), move.after.floor))
    })
  }

  startNewGame(): void {
    const existing = this.session()
    if (existing instanceof LocalSession) {
      existing.startNewMatch()
    } else if (!existing) {
      this.session.set(new LocalSession('player', 'player'))
    } // an online game is never restarted from here: a new table is a new game
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
    return who === 'player' ? 'You' : this.opponentLabel()
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
    void this.runPlayerAction(() => this.session()!.submit({ type: 'bid', value }))
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
    void this.runPlayerAction(() => this.session()!.submit({ type: 'capture', card: c, targetItemIds }))
  }

  onBuild(): void {
    const c = this.selectedCard()
    if (!c) return
    const looseItemIds = this.selectedLoose().map((i) => i.id)
    const targetValue = this.buildTargetValue()
    void this.runPlayerAction(() => this.session()!.submit({ type: 'build', card: c, looseItemIds, targetValue }))
  }

  onModify(): void {
    const c = this.selectedCard()
    const houses = this.selectedHouses()
    if (!c || houses.length !== 1) return
    const houseId = houses[0]!.id
    const extraLooseItemIds = this.selectedLoose().map((i) => i.id)
    void this.runPlayerAction(() => this.session()!.submit({ type: 'modify', card: c, houseId, extraLooseItemIds }))
  }

  onThrow(): void {
    const c = this.selectedCard()
    if (!c) return
    void this.runPlayerAction(() => this.session()!.submit({ type: 'throw', card: c }))
  }

  async onDealNext(): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    try {
      await this.session()?.dealNext()
      this.log.set([])
      this.pendingReveal.set(null)
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Could not deal the next hand.')
    } finally {
      this.busy.set(false)
    }
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
    return hasPlayer ? 'Yours' : `${this.opponentLabel()}'s`
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

  /**
   * Runs a move, ignoring any second click while one is still in flight (a
   * real network round trip in an online game; instantaneous against bots).
   */
  private async runPlayerAction(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    try {
      await fn()
      this.clearSelection()
      this.message.set(null)
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.')
    } finally {
      this.busy.set(false)
    }
  }

  private clearSelection(): void {
    this.selectedCard.set(null)
    this.selectedFloorIds.set([])
  }
}
