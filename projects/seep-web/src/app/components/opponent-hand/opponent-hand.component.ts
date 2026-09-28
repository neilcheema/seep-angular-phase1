import { Component, input } from '@angular/core'

/**
 * Renders a computer seat's hand as a fan of face-down card backs, one per
 * card held. `orientation` says where that seat sits at the table:
 *
 * - 'top' (the two-player opponent and the four-player partner): a
 *   horizontal fan, each card tilted a little more than its neighbour so the
 *   row opens like a hand of cards actually held.
 * - 'left' / 'right' (four-player Players 2 and 4): a compact vertical fan
 *   with each card lying sideways, its far end pointing at the table centre.
 *   Cards tilt progressively up and down along the stack, and the outer
 *   cards sit a little nearer the screen edge, so the column bulges toward
 *   the table like a real fan seen from the side, rather than a straight
 *   stack. Keeping it narrow is what leaves room for the floor on a phone.
 *
 * All positioning is applied inline here (not via styles.css) on purpose:
 * it needs to override the old `.comp-fan .card-back` margin rule and the
 * fixed `.comp-fan--left/right` rotation rules, and keeping the whole fan
 * geometry in one place means the CSS and the maths can't drift apart.
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

  /** Inline styles for the fan container. */
  get fanStyle(): Record<string, string> {
    if (this.orientation() === 'top') {
      // Wider screens would otherwise wrap a full hand onto a second row.
      return { 'flex-wrap': 'nowrap' }
    }
    // Side fans are laid out narrow, and the tilted outer cards must not be
    // clipped by the default horizontal-scroll container.
    return { overflow: 'visible', padding: '4px 20px' }
  }

  /** Inline styles for the card at this position in the fan. */
  cardStyle(index: number): Record<string, string> {
    const total = this.count()
    const last = index === total - 1

    if (this.orientation() === 'top') {
      const spread = total > 1 ? Math.min(6 * (total - 1), 30) : 0
      const angle = total > 1 ? -spread / 2 + (spread / (total - 1)) * index : 0
      return {
        transform: `rotate(${angle.toFixed(2)}deg)`,
        'margin-right': last ? '0' : 'calc(var(--cw) * -0.4)',
      }
    }

    // Side seats. Cards are laid landscape (width/height swapped) so the
    // column's layout footprint matches what you actually see, instead of
    // rotating a portrait card 90° and spilling into the floor.
    const spread = total > 1 ? Math.min(3.5 * (total - 1), 40) : 0
    let angle = total > 1 ? -spread / 2 + (spread / (total - 1)) * index : 0
    if (this.orientation() === 'right') angle = -angle

    // Outer cards ease toward the screen edge: the arc of the fan.
    const radius = 210
    const bulge = radius * (1 - Math.cos((angle * Math.PI) / 180))
    const shift = this.orientation() === 'left' ? -bulge : bulge

    return {
      width: 'var(--ch)',
      height: 'var(--cw)',
      margin: index === 0 ? '0' : 'calc(var(--cw) * -0.55) 0 0 0',
      transform: `translateX(${shift.toFixed(1)}px) rotate(${angle.toFixed(1)}deg)`,
    }
  }
}
