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

  /**
   * Rotation for the card at this position, giving the 'top' hand the
   * look of a real fanned hand (outer cards tilted outward, middle
   * roughly upright). Only ever called for 'top' — the template gates
   * this entirely for 'left'/'right' so their existing fixed 90°/-90°
   * CSS rotation (from .comp-fan--left/.comp-fan--right in styles.css)
   * is left completely alone, not overridden by an inline style.
   */
  rotationFor(index: number): number {
    const total = this.count()
    if (total <= 1) return 0
    const maxSpread = Math.min(6 * (total - 1), 30)
    const step = maxSpread / (total - 1)
    return -maxSpread / 2 + step * index
  }
}
