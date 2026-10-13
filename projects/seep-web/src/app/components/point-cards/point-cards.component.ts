import { Component, input } from '@angular/core'
import type { Card as CardModel } from 'seep-engine'
import { CardComponent } from '../card/card.component'

/**
 * The point cards one side captured, shown where that side's hand was once the hand is over: a heading, the cards face up in a wrapping row (smaller
 * when there are many, so they fit a phone), and one line saying what they came to. Display only; nothing here can be tapped.
 */
@Component({
  selector: 'app-point-cards',
  standalone: true,
  imports: [CardComponent],
  template: `
    <section class="point-cards" style="padding: 4px 8px; text-align: center;">
      <div class="point-cards-title" style="color: var(--gold-lt); font-size: 13px; font-weight: 700; letter-spacing: 0.03em; margin-bottom: 4px;">{{ title() }}</div>
      @if (cards().length > 0) {
        <div class="point-cards-row" style="display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;" [style.zoom]="cards().length > 10 ? 0.5 : 0.62">
          @for (c of cards(); track $index) {
            <app-card [card]="c" />
          }
        </div>
      } @else {
        <div class="point-cards-none" style="color: rgba(255, 255, 255, 0.6); font-size: 13px; padding: 6px 0;">No point cards this hand.</div>
      }
      <div class="point-cards-summary" style="color: rgba(255, 255, 255, 0.78); font-size: 13px; margin-top: 4px;">{{ summary() }}</div>
    </section>
  `,
})
export class PointCardsComponent {
  readonly title = input.required<string>()
  readonly cards = input.required<CardModel[]>()
  readonly summary = input.required<string>()
}
