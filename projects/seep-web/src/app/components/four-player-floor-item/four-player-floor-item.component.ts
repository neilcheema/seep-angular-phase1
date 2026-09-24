import { Component, input, output } from '@angular/core'
import { type Card as CardModel, type FloorItem, type House, type SeatId, isHouse, teamOf } from 'seep-engine'
import { CardComponent } from '../card/card.component'

/**
 * Renders a single floor item for the four-player table: a loose card, or
 * a stacked house with its badge and a team-aware owner tag ("Yours",
 * "Your partner's", "Team B's", or "Shared" for a multi-owner cemented
 * house whose owners span both teams).
 */
@Component({
  selector: 'app-four-player-floor-item',
  standalone: true,
  imports: [CardComponent],
  templateUrl: './four-player-floor-item.component.html',
})
export class FourPlayerFloorItemComponent {
  readonly item = input.required<FloorItem<SeatId>>()
  readonly selected = input(false)
  readonly selectable = input(false)
  readonly itemClick = output<void>()

  get house(): House<SeatId> | null {
    const it = this.item()
    return isHouse(it) ? it : null
  }

  get looseCard(): CardModel | null {
    const it = this.item()
    return isHouse(it) ? null : it.card
  }

  get ownerLabel(): string {
    const h = this.house
    if (!h) return ''
    const hasSelf = h.owners.includes('p1')
    const hasPartner = h.owners.includes('p3')
    const teams = new Set(h.owners.map(teamOf))
    if (teams.size > 1) return 'Shared'
    if (hasSelf) return 'Yours'
    if (hasPartner) return "Partner's"
    return "Team B's"
  }

  get ariaLabel(): string {
    const h = this.house
    if (!h) return ''
    return `House of ${h.captureValue}${h.cemented ? ', cemented' : ''}`
  }

  onActivate(): void {
    if (this.selectable()) this.itemClick.emit()
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.selectable()) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.itemClick.emit()
    }
  }
}
