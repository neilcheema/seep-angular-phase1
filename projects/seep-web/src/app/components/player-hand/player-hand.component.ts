import { Component, input, output } from '@angular/core';
import { type Card as CardModel, cardEquals } from 'seep-engine';
import { CardComponent } from '../card/card.component';

/** Renders the human player's own hand, face-up and individually selectable. */
@Component({
  selector: 'app-player-hand',
  standalone: true,
  imports: [CardComponent],
  templateUrl: './player-hand.component.html',
})
export class PlayerHandComponent {
  readonly cards = input.required<CardModel[]>();
  readonly selectedCard = input<CardModel | null>(null);
  readonly selectableCards = input<CardModel[] | null>(null);
  readonly cardSelected = output<CardModel>();

  isSelectable(card: CardModel): boolean {
    const set = this.selectableCards() ?? this.cards();
    return set.some((sc) => cardEquals(sc, card));
  }

  isSelected(card: CardModel): boolean {
    const sel = this.selectedCard();
    return sel ? cardEquals(sel, card) : false;
  }

  /**
   * Rotation for the card at this position, giving the hand the look of a
   * real fanned hand (outer cards tilted outward, middle roughly upright)
   * instead of a flat row — same technique as the opponent/partner hand,
   * kept a little gentler here since this hand is the one you actually
   * tap to select cards from, and a wide spread makes that fussier on a
   * small screen.
   */
  rotationFor(index: number): number {
    const total = this.cards().length;
    if (total <= 1) return 0;
    const maxSpread = Math.min(4 * (total - 1), 24);
    const step = maxSpread / (total - 1);
    return -maxSpread / 2 + step * index;
  }
}
