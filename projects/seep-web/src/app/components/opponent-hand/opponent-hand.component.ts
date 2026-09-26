import { Component, input } from '@angular/core'

/**
 * Renders the computer opponent's hand as a fan of face-down card backs,
 * one per card held. `orientation` controls how the fan is laid out:
 * 'top' (default) is a horizontal row — used for the two-player opponent
 * and the four-player partner, both of which sit across the table from
 * the human. 'left'/'right' stack the cards vertically and rotate each
 * one 90° to face the table center, matching how a side-seated player's
 * hand actually reads — this keeps the fan narrow (not wide), which is
 * what actually frees up floor space on a narrow mobile screen.
 */
@Component({
  selector: 'app-opponent-hand',
  standalone: true,
  templateUrl: './opponent-hand.component.html',
})
export class OpponentHandComponent {
  readonly count = input.required<number>()
  readonly orientation = input<'top' | 'left' | 'right'>('top')

  get slots(): number[] {
    return Array.from({ length: this.count() }, (_, i) => i)
  }

  get fanClass(): string {
    return `comp-fan comp-fan--${this.orientation()}`
  }
}
