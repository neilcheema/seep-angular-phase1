import { Component, input, output } from '@angular/core';
import { type Card as CardModel, Face, Suit, faceLabel } from 'seep-engine';

const SUIT_SYM: Record<Suit, string> = {
  [Suit.Spades]: '♠',
  [Suit.Hearts]: '♥',
  [Suit.Clubs]: '♣',
  [Suit.Diamonds]: '♦',
};

const RED_SUITS = new Set<Suit>([Suit.Hearts, Suit.Diamonds]);
const FACE_CARDS = new Set<Face>([Face.Jack, Face.Queen, Face.King]);

const PIP_ROWS: Partial<Record<Face, string[][]>> = {
  [Face.Two]: [['♦'], ['♦']],
  [Face.Three]: [['♦'], ['♦'], ['♦']],
  [Face.Four]: [['♦', '♦'], ['♦', '♦']],
  [Face.Five]: [['♦', '♦'], ['♦'], ['♦', '♦']],
  [Face.Six]: [['♦', '♦'], ['♦', '♦'], ['♦', '♦']],
  [Face.Seven]: [['♦', '♦'], ['♦', '♦'], ['♦'], ['♦', '♦']],
  [Face.Eight]: [['♦', '♦'], ['♦', '♦'], ['♦', '♦'], ['♦', '♦']],
  [Face.Nine]: [['♦', '♦'], ['♦', '♦'], ['♦'], ['♦', '♦'], ['♦', '♦']],
  [Face.Ten]: [['♦', '♦'], ['♦', '♦'], ['♦', '♦'], ['♦', '♦'], ['♦', '♦']],
};

/**
 * Renders a single playing card. A direct port of the React Card
 * component — same CSS classes (defined globally in styles.css), same
 * pip-layout table, so the visual result is unchanged.
 */
@Component({
  selector: 'app-card',
  standalone: true,
  templateUrl: './card.component.html',
})
export class CardComponent {
  readonly card = input.required<CardModel>();
  readonly selected = input(false);
  readonly selectable = input(false);
  readonly dimmed = input(false);
  readonly cardClick = output<void>();

  get isRed(): boolean {
    return RED_SUITS.has(this.card().suit);
  }

  get isAce(): boolean {
    return this.card().face === Face.Ace;
  }

  get isFaceCard(): boolean {
    return FACE_CARDS.has(this.card().face);
  }

  get pipRows(): string[][] | null {
    return PIP_ROWS[this.card().face] ?? null;
  }

  get faceLbl(): string {
    return faceLabel(this.card().face);
  }

  get sym(): string {
    return SUIT_SYM[this.card().suit];
  }

  get label(): string {
    return `${this.faceLbl} of ${this.card().suit}`;
  }

  get classes(): string {
    return [
      'card',
      this.isRed ? 'card-red' : 'card-black',
      this.selectable() ? 'card-valid' : '',
      this.selected() ? 'card-selected' : '',
      this.dimmed() ? 'card-dimmed' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  onActivate(): void {
    if (this.selectable()) this.cardClick.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.selectable()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.cardClick.emit();
    }
  }
}
