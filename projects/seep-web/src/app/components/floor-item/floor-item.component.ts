import { Component, input, output } from '@angular/core';
import { type Card as CardModel, type FloorItem, type House, isHouse } from 'seep-engine';
import { CardComponent } from '../card/card.component';

/** Renders a single floor item: a loose card, or a stacked house with its badge and owner tag. */
@Component({
  selector: 'app-floor-item',
  standalone: true,
  imports: [CardComponent],
  templateUrl: './floor-item.component.html',
})
export class FloorItemComponent {
  readonly item = input.required<FloorItem>();
  readonly selected = input(false);
  readonly selectable = input(false);
  readonly itemClick = output<void>();

  get house(): House | null {
    const it = this.item();
    return isHouse(it) ? it : null;
  }

  get looseCard(): CardModel | null {
    const it = this.item();
    return isHouse(it) ? null : it.card;
  }

  get ownerLabel(): string {
    const h = this.house;
    if (!h) return '';
    const hasPlayer = h.owners.includes('player');
    const hasOpponent = h.owners.includes('opponent');
    if (hasPlayer && hasOpponent) return 'Shared';
    return hasPlayer ? 'Yours' : "Opponent's";
  }

  get ariaLabel(): string {
    const h = this.house;
    if (!h) return '';
    return `House of ${h.captureValue}${h.cemented ? ', cemented' : ''}`;
  }

  onActivate(): void {
    if (this.selectable()) this.itemClick.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.selectable()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.itemClick.emit();
    }
  }
}
