import { Component, input, output } from '@angular/core'
import { type Card as CardModel, type FloorItem, type House, SeatId, isHouse, partnerOf, teamOf } from 'seep-engine'
import { CardComponent } from '../card/card.component'

/**
 * Renders a single floor item for the four-player table: a loose card, or
 * a stacked house with its badge and a viewer-relative owner tag
 * ("Yours", "Partner's", "Opponents'", or "Shared" for a multi-owner
 * cemented house whose owners span both teams).
 *
 * mySeat defaults to P1 for backward compatibility with any other caller,
 * but four-player.component.ts always passes its own mySeat explicitly.
 * ownerLabel used to say "Team B's" for a house owned entirely by the
 * non-viewer team, which assumed the viewer was always on Team A —
 * "Opponents'" says the same thing without that assumption, and reads
 * more naturally besides.
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
  readonly mySeat = input<SeatId>(SeatId.P1)
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
    const my = this.mySeat()
    const partner = partnerOf(my)
    const teams = new Set(h.owners.map(teamOf))
    if (teams.size > 1) return 'Shared'
    if (h.owners.includes(my)) return 'Yours'
    if (h.owners.includes(partner)) return "Partner's"
    return "Opponents'"
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
