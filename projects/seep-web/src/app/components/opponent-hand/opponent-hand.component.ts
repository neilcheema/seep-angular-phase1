import { Component, input } from '@angular/core';

/** Renders the computer opponent's hand as a fan of face-down card backs, one per card held. */
@Component({
  selector: 'app-opponent-hand',
  standalone: true,
  templateUrl: './opponent-hand.component.html',
})
export class OpponentHandComponent {
  readonly count = input.required<number>();

  get slots(): number[] {
    return Array.from({ length: this.count() }, (_, i) => i);
  }
}
