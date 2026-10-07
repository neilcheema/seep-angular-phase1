import { MatchResultsComponent } from '../../components/match-results/match-results.component'
import { captureHintFor } from '../../core/capture-hint'
import { buildFourPlayerResults } from '../../core/match-results'
import { describeTurn, isOnTheMove } from '../../core/turn-text'
import { Component, DestroyRef, type OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { APP_VERSION, FEEDBACK_EMAIL } from '../../version'
import {
  type Card as CardModel,
  type FloorItem,
  type FourPlayerGameView,
  type FourPlayerIntent,
  SeatId,
  Suit,
  allCardsOf,
  nextSeat,
  partnerOf,
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
  teamOf,
} from 'seep-engine'
import { FourPlayerStatusPanelComponent } from '../../components/four-player-status-panel/four-player-status-panel.component'
import { OpponentHandComponent } from '../../components/opponent-hand/opponent-hand.component'
import { FourPlayerFloorItemComponent } from '../../components/four-player-floor-item/four-player-floor-item.component'
import { PlayerHandComponent } from '../../components/player-hand/player-hand.component'
import { CardComponent } from '../../components/card/card.component'
import { LocalFourPlayerSession } from '../../core/local-four-player-session'
import { type SeatNames, fourPlayerSeatLabel } from '../../core/board-names'
import { joinNames } from '../../core/names'
import type { GameSession, MoveEvent } from '../../core/game-session'

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

const SEAT_LABEL: Record<SeatId, string> = {
  p1: 'Player 1', p2: 'Player 2', p3: 'Player 3', p4: 'Player 4',
}

/**
 * The four-player team game page. Every move — the human's own included —
 * pauses on a MoveReveal overlay until "Next" is clicked.
 *
 * As of this patch, wired to LocalFourPlayerSession the same way the
 * two-player page is wired to LocalSession — the page no longer talks to
 * the engine directly, and the five separate places that used to build a
 * MoveReveal by hand (one per action method, plus a sixth for AI moves
 * via snapshotAction) are now one buildReveal(), driven by an effect that
 * watches the session's lastMove signal.
 *
 * One real behavioral fix, not just a refactor, surfaced while unifying
 * those six call sites: the original human-move cement/break check
 * (isCement = addedValue % house.captureValue === 0, matching the
 * engine's actual multi-set cementing rule) and the original AI-move
 * check (isCement = extraLooseItemIds.length === 0 && card value ===
 * house value, a narrower special case) disagreed with each other. A
 * computer move that cemented a house via a multi-card combination could
 * have been mislabeled "Breaking house" in its own reveal. buildReveal()
 * uses the correct, general check — the one the human side already had
 * — for both.
 *
 * mySeat: the viewer's seat is no longer hardcoded to SeatId.P1 — every
 * place that used to check `=== SeatId.P1` now checks `=== this.mySeat()`,
 * and the table's four screen positions (bottom/left/top/right) are
 * derived from it via the engine's own nextSeat/partnerOf, not assumed.
 * mySeat is still fixed to P1 today, since there's no mechanism yet to
 * assign a viewer to a different seat (that's an online-multiplayer
 * concern, not something this local, bots-only game can reach) — but the
 * whole page is now written so that changing what mySeat resolves to,
 * later, is the only change needed to make the layout and every "You"/
 * "Your partner" label correctly follow whichever seat the viewer
 * actually sits in.
 */
@Component({
  selector: 'app-four-player',
  standalone: true,
  imports: [
    MatchResultsComponent,
    FourPlayerStatusPanelComponent, OpponentHandComponent, FourPlayerFloorItemComponent,
    PlayerHandComponent, CardComponent, RouterLink,
  ],
  templateUrl: './four-player.component.html',
})
export class FourPlayerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly destroyRef = inject(DestroyRef)

  readonly appVersion = APP_VERSION

  /**
   * The viewer's own seat: whatever seat the session's view is for. Against
   * the bots that is always P1; at an online table it is the seat the person
   * was dealt (join order: the creator is P1, then P2, P3, P4). Every
   * reference to "which seat is mine" in this file goes through this, so the
   * table rotation, the "You / Your partner" labels and the turn checks all
   * follow it.
   */
  readonly mySeat = computed<SeatId>(() => this.state()?.viewer ?? SeatId.P1)
  readonly myTeam = computed(() => teamOf(this.mySeat()))
  readonly myTeamLetter = computed(() => (this.myTeam() === 'teamA' ? 'A' : 'B'))
  readonly otherTeamLetter = computed(() => (this.myTeam() === 'teamA' ? 'B' : 'A'))
  /** The seat rendered at the top of the table — always the viewer's partner, two seats away in either direction. */
  readonly partnerSeat = computed(() => partnerOf(this.mySeat()))
  /** The seat rendered on the left — the next seat after the viewer in turn order. */
  readonly leftSeat = computed(() => nextSeat(this.mySeat()))
  /** The seat rendered on the right — the partner of whoever is on the left. */
  readonly rightSeat = computed(() => partnerOf(this.leftSeat()))

  /**
   * A game already in progress against other people, supplied by the online
   * table screen. When absent this page plays the bots, exactly as it always has.
   */
  readonly remote = input<GameSession<FourPlayerGameView, FourPlayerIntent, SeatId> | null>(null)
  /** A line of text about the turn clock, supplied by the online table screen (never set against the bots). */
  readonly clockLine = input<string | null>(null)
  readonly clockUrgent = input(false)
  /** The names people chose, by seat (supplied by the online table screen; never set against the computer). */
  readonly seatNames = input<SeatNames>({})
  readonly session = signal<GameSession<FourPlayerGameView, FourPlayerIntent, SeatId> | null>(null)
  readonly opponentPossessive = computed(() => (this.remote() ? "the other players'" : "the computer's"))
  readonly state = computed<FourPlayerGameView | null>(() => this.session()?.view() ?? null)
  /** The results of a finished match (null while it is still going). */
  readonly results = computed(() => {
    const s = this.state()
    return s && s.phase === 'match-over' ? buildFourPlayerResults(s, this.seatNames()) : null
  })
  /** Whose turn it is, in words, for the big line above the buttons (online tables only). */
  readonly turnLine = computed(() => {
    const s = this.state()
    return s && this.remote() ? describeTurn(s.phase, s.turn, this.mySeat(), (seat) => fourPlayerSeatLabel(seat as SeatId, this.mySeat(), this.seatNames())) : null
  })

  /** True while it is this seat's turn, so its label can carry a marker (online tables only). */
  onTheMove(seat: SeatId): boolean {
    const s = this.state()
    return !!s && !!this.remote() && isOnTheMove(s.phase, s.turn, seat)
  }
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
      s.turn === this.mySeat() &&
      (s.phase === 'playing' || (s.phase === 'opening-move' && s.bidder === this.mySeat()))
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
   * Mirrors the engine's own playFourPlayerCapture validation exactly
   * (findHouseByValue + findMaximalExactGroups, the same "required
   * selection" computation) rather than a simplified, independent check.
   * The two had drifted: the old version only allowed a house captured
   * alone, or loose cards captured alone, never a house together with a
   * disjoint loose group at the same value — a combination the engine
   * has always required when both exist on the floor together, per §21
   * of the rules. That drift made a fully legal capture impossible to
   * even select: the button stayed disabled no matter what, since no
   * selection could satisfy either of the old branches.
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

  /** "p3" -> 3, for running text like "Player 3". */
  seatNumber(seat: SeatId): number {
    return Number(seat.slice(1))
  }

  constructor() {
    this.destroyRef.onDestroy(() => this.session()?.dispose())

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.has('new')) this.startNewGame()
    })

    // Reacts to every move the session reports — the human's own (from
    // submit()) and any bot seat's (scheduled inside the session,
    // COMPUTER_THINK_MS after acknowledge()) alike — and builds the same
    // move-reveal presentation this page has always shown.
    effect(() => {
      const session = this.session()
      if (!session) return
      const move = session.lastMove()
      if (!move) return
      // Only the MOVE should trigger a reveal. Building it reads the viewer's seat, names and so on; if the effect tracked
      // those, any change to them would re-show a move the player had already dismissed.
      untracked(() => this.reveal(this.buildReveal(move), move.after.floor))
    })
  }

  startNewGame(): void {
    const existing = this.session()
    if (existing instanceof LocalFourPlayerSession) {
      existing.startNewMatch()
    } else if (!existing) {
      // Explicit dealer, not the session's own default: nextSeat(dealer)
      // is who bids first, and a fresh game should always start with the
      // viewer bidding — the same "you always bid first on Deal" the
      // page has always had. rightSeat() is exactly the seat whose
      // nextSeat is mySeat(), by construction (see the class doc
      // comment's rotation note) — passing SeatId.P4's old default here
      // would only coincidentally make P1 the bidder; for any other
      // mySeat it would leave the viewer bidder-less on a fresh hand.
      this.session.set(new LocalFourPlayerSession(this.mySeat(), this.rightSeat()))
    } // an online game is never restarted from here: a new table is a new game
    this.clearSelection()
    this.message.set(null)
    this.log.set([])
    this.pendingReveal.set(null)
  }

  legalBidsFor(view: FourPlayerGameView): number[] {
    return [...new Set(view.myHand.map((c) => captureValue(c)).filter(isHouseValue))]
  }

  isFloorSelected(id: string): boolean {
    return this.selectedFloorIds().includes(id)
  }

  /** How to refer to a seat in running text (the move-reveal overlay, the move log) — relative to the viewer, not the seat's fixed identity. */
  seatTag(seat: SeatId): string {
    return fourPlayerSeatLabel(seat, this.mySeat(), this.seatNames())
  }

  /** How to label a seat's hand around the table (the partner row, the two side hands) — always names the seat, adding the relationship only for the partner, matching how the page has always labeled that one specially. */
  seatHeaderLabel(seat: SeatId): string {
    const base = this.seatNames()[seat] ?? SEAT_LABEL[seat]
    return seat === this.partnerSeat() ? `${base} \u00b7 Your partner` : base
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
      `Game: 4 Player Seep\n` +
      `Version: ${APP_VERSION}\n` +
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
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    this.ruleNotePanelOpen.set(false)
    this.ruleNoteText.set('')
  }

  onBid(value: number): void {
    void this.runPlayerAction(() => this.session()!.submit({ type: 'bid', value }))
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

  /**
   * Builds a MoveReveal from a session move event — the single place
   * this now happens, replacing six separate near-duplicate blocks that
   * used to build this by hand (one per human action method, plus
   * applyAction/snapshotAction for computer moves). See the class-level
   * doc comment for the cement/break detection fix this unification
   * surfaced.
   */
  private buildReveal(move: MoveEvent<FourPlayerGameView, FourPlayerIntent, SeatId>): MoveReveal {
    const { intent, before, after, actor, reason } = move
    const sweepBonus = after.sweepPoints[teamOf(actor)] - before.sweepPoints[teamOf(actor)]

    switch (intent.type) {
      case 'bid':
        return {
          seat: actor, kind: 'bid', label: `Bid ${intent.value}`, playedCard: null, targetCards: [], sweepBonus, reason,
        }
      case 'capture':
        return {
          seat: actor, kind: 'capture', label: 'Capturing', playedCard: intent.card,
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
          seat: actor, kind: 'build', label, playedCard: intent.card,
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
          seat: actor, kind: isCement ? 'cement' : 'break', label: isCement ? 'Cementing house' : 'Breaking house',
          playedCard: intent.card, targetCards: [...houseCards, ...allCardsOf(before.floor, extraIds)], sweepBonus, reason,
        }
      }
      case 'throw':
        return {
          seat: actor, kind: 'throw', label: 'Throwing', playedCard: intent.card, targetCards: [], sweepBonus, reason,
        }
    }
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
    if (seat === this.mySeat()) this.humanHasMoved.set(true)
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
    if (this.remote()) return onlyTeam === teamOf(this.mySeat()) ? 'Your team' : 'Their team'
    return onlyTeam === teamOf(this.mySeat()) ? 'Human team' : 'AI team'
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
        base = `${framing} played ${cardTxt} and captured ${r.targetCards.length > 0 ? joinNames(r.targetCards.map(cardLabel)) : 'the cards'}.`
        if (r.sweepBonus > 0) base += ` Seep! +${r.sweepBonus} sweep bonus.`
        break
      case 'build': base = `${framing} built a house using ${cardTxt}${r.targetCards.length > 0 ? ` plus ${joinNames(r.targetCards.map(cardLabel))}` : ''}.`; break
      case 'cement': base = `${framing} cemented a house using ${cardTxt}${r.targetCards.length > 0 ? ` plus ${joinNames(r.targetCards.map(cardLabel))}` : ''}.`; break
      case 'break': base = `${framing} broke a house using ${cardTxt}${r.targetCards.length > 0 ? ` plus ${joinNames(r.targetCards.map(cardLabel))}` : ''}.`; break
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
