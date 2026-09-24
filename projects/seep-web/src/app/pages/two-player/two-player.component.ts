import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  type Card as CardModel,
  cardEquals,
  captureValue,
  isHouseValue,
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
} from 'seep-engine';
import { StatusPanelComponent } from '../../components/status-panel/status-panel.component';
import { OpponentHandComponent } from '../../components/opponent-hand/opponent-hand.component';
import { FloorItemComponent } from '../../components/floor-item/floor-item.component';
import { PlayerHandComponent } from '../../components/player-hand/player-hand.component';

const COMPUTER_DELAY_MS = 850;

/**
 * The two-player game page. This is a like-for-like port of the original
 * React App.tsx: same state shape (held in Angular signals instead of
 * useState), same derived-value logic (Angular computed() instead of
 * useMemo), and the same computer-turn automation (an Angular effect()
 * instead of a useEffect keyed on [state]). No rules or behavior changes.
 *
 * The presence/absence of `state` alone determines which screen renders
 * (start vs. game) — there is no separate "screen" flag, since the two
 * are always set together in startNewGame().
 */
@Component({
  selector: 'app-two-player',
  standalone: true,
  imports: [StatusPanelComponent, OpponentHandComponent, FloorItemComponent, PlayerHandComponent],
  templateUrl: './two-player.component.html',
})
export class TwoPlayerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<GameState | null>(null);
  readonly selectedCard = signal<CardModel | null>(null);
  readonly selectedFloorIds = signal<string[]>([]);
  readonly message = signal<string | null>(null);

  readonly isPlayerTurn = computed(() => {
    const s = this.state();
    return (
      !!s &&
      s.turn === 'player' &&
      (s.phase === 'playing' || (s.phase === 'opening-move' && s.bidder === 'player'))
    );
  });

  readonly selectedHouses = computed<FloorItem[]>(() => {
    const s = this.state();
    if (!s) return [];
    return this.selectedFloorIds()
      .map((id) => findItem(s.floor, id)!)
      .filter(isHouse);
  });

  readonly selectedLoose = computed<FloorItem[]>(() => {
    const s = this.state();
    if (!s) return [];
    return this.selectedFloorIds()
      .map((id) => findItem(s.floor, id)!)
      .filter(isLoose);
  });

  readonly looseSum = computed(() => this.selectedLoose().reduce((t, i) => t + itemValue(i), 0));

  readonly isOpening = computed(() => this.state()?.phase === 'opening-move');

  readonly bidMatches = computed(() => {
    const s = this.state();
    const c = this.selectedCard();
    return !!(s && c && (!this.isOpening() || captureValue(c) === s.bidValue));
  });

  readonly canThrow = computed(() => {
    const s = this.state();
    const c = this.selectedCard();
    return !!(
      s &&
      c &&
      this.selectedFloorIds().length === 0 &&
      this.bidMatches() &&
      (this.isOpening() || !hasAnyLegalCapture(s.floor, c))
    );
  });

  readonly canCapture = computed(() => {
    const s = this.state();
    const c = this.selectedCard();
    if (!(s && c && this.selectedFloorIds().length > 0 && this.bidMatches())) return false;
    const houses = this.selectedHouses();
    const loose = this.selectedLoose();
    if (houses.length === 1 && loose.length === 0) {
      return itemValue(houses[0]!) === captureValue(c);
    }
    return houses.length === 0 && this.looseSum() === captureValue(c);
  });

  readonly buildTargetValue = computed(() => {
    const c = this.selectedCard();
    return c ? this.looseSum() + captureValue(c) : 0;
  });

  readonly canBuild = computed(() => {
    const s = this.state();
    const c = this.selectedCard();
    const target = this.buildTargetValue();
    return !!(
      s &&
      c &&
      this.selectedHouses().length === 0 &&
      isHouseValue(target) &&
      (!this.isOpening() || target === s.bidValue) &&
      !findHouseByValue(s.floor, target) &&
      hasCaptureValue(removeCard(s.hands.player, c), target)
    );
  });

  readonly canModify = computed(
    () => !!(this.state() && this.selectedCard() && this.selectedHouses().length === 1 && !this.isOpening()),
  );

  constructor() {
    // Deep-link support (spec §5.3): /two-player?new=1 starts a fresh game
    // immediately, e.g. when arriving from the landing page's button.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.has('new')) this.startNewGame();
    });

    // Computer opponent automation — mirrors the original useEffect(() => {...}, [state]).
    effect((onCleanup) => {
      const s = this.state();
      if (!s) return;

      if (s.phase === 'bidding' && s.turn === 'opponent') {
        const t = setTimeout(() => {
          this.state.update((cur) => (cur ? placeBid(cur, 'opponent', chooseComputerBid(cur)) : cur));
        }, COMPUTER_DELAY_MS);
        onCleanup(() => clearTimeout(t));
        return;
      }

      if (s.phase === 'opening-move' && s.bidder === 'opponent') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur;
            const action = chooseComputerOpeningMove(cur);
            if (action.type === 'capture') return playCapture(cur, 'opponent', action.card, action.targetItemIds);
            if (action.type === 'build') {
              return playBuildHouse(cur, 'opponent', action.card, action.looseItemIds, action.targetValue);
            }
            return playThrow(cur, 'opponent', action.card);
          });
        }, COMPUTER_DELAY_MS);
        onCleanup(() => clearTimeout(t));
        return;
      }

      if (s.phase === 'playing' && s.turn === 'opponent') {
        const t = setTimeout(() => {
          this.state.update((cur) => {
            if (!cur) return cur;
            const action = chooseComputerMove(cur);
            if (action.type === 'capture') return playCapture(cur, 'opponent', action.card, action.targetItemIds);
            if (action.type === 'build') {
              return playBuildHouse(cur, 'opponent', action.card, action.looseItemIds, action.targetValue);
            }
            return playThrow(cur, 'opponent', action.card);
          });
        }, COMPUTER_DELAY_MS);
        onCleanup(() => clearTimeout(t));
      }
    });
  }

  startNewGame(): void {
    this.state.set(startMatch('player'));
    this.clearSelection();
    this.message.set(null);
  }

  legalBidsFor(state: GameState): number[] {
    return legalBids(state);
  }

  isFloorSelected(id: string): boolean {
    return this.selectedFloorIds().includes(id);
  }

  onBid(value: number): void {
    const s = this.state();
    if (!s) return;
    this.runAction(() => placeBid(s, 'player', value));
  }

  onFloorClick(item: FloorItem): void {
    this.message.set(null);
    this.selectedFloorIds.update((ids) =>
      ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id],
    );
  }

  onCardSelect(card: CardModel): void {
    this.message.set(null);
    this.selectedFloorIds.set([]);
    this.selectedCard.update((prev) => (prev && cardEquals(prev, card) ? null : card));
  }

  onCapture(): void {
    const s = this.state();
    const c = this.selectedCard();
    if (!s || !c) return;
    this.runAction(() => playCapture(s, 'player', c, this.selectedFloorIds()));
  }

  onBuild(): void {
    const s = this.state();
    const c = this.selectedCard();
    if (!s || !c) return;
    const looseIds = this.selectedLoose().map((i) => i.id);
    const target = this.buildTargetValue();
    this.runAction(() => playBuildHouse(s, 'player', c, looseIds, target));
  }

  onModify(): void {
    const s = this.state();
    const c = this.selectedCard();
    const houses = this.selectedHouses();
    if (!s || !c || houses.length !== 1) return;
    const looseIds = this.selectedLoose().map((i) => i.id);
    this.runAction(() => playModifyHouse(s, 'player', c, houses[0]!.id, looseIds));
  }

  onThrow(): void {
    const s = this.state();
    const c = this.selectedCard();
    if (!s || !c) return;
    this.runAction(() => playThrow(s, 'player', c));
  }

  onDealNext(): void {
    const s = this.state();
    if (!s) return;
    this.state.set(dealNextHand(s));
  }

  onPlayAgain(): void {
    this.state.set(startMatch('player'));
    this.clearSelection();
  }

  private clearSelection(): void {
    this.selectedCard.set(null);
    this.selectedFloorIds.set([]);
  }

  private runAction(fn: () => GameState): void {
    try {
      const next = fn();
      this.state.set(next);
      this.clearSelection();
      this.message.set(null);
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'Invalid move.');
    }
  }
}
