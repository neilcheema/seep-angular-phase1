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
}
