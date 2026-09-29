import { Component, input } from '@angular/core'
import { type FourPlayerGameView, SeatId, partnerOf } from 'seep-engine'

const PHASE_LABEL: Record<FourPlayerGameView['phase'], string> = {
  bidding: 'Bidding',
  'opening-move': 'Opening move',
  playing: 'In play',
  'hand-over': 'Hand over',
  'match-over': 'Match over',
}

const SEAT_LABEL: Record<SeatId, string> = {
  p1: 'Player 1',
  p2: 'Player 2',
  p3: 'Player 3',
  p4: 'Player 4',
}

/**
 * Score, bid, phase, and last-move summary header for the four-player
 * table. mySeat defaults to P1 for backward compatibility with any other
 * caller, but four-player.component.ts always passes its own mySeat
 * explicitly, so "You"/"Your partner" here track the actual viewer.
 */
@Component({
  selector: 'app-four-player-status-panel',
  standalone: true,
  templateUrl: './four-player-status-panel.component.html',
})
export class FourPlayerStatusPanelComponent {
  readonly state = input.required<FourPlayerGameView>()
  readonly mySeat = input<SeatId>(SeatId.P1)

  get phaseLabel(): string {
    return PHASE_LABEL[this.state().phase]
  }

  get bidderLabel(): string {
    const bidder = this.state().bidder
    if (bidder === this.mySeat()) return 'You'
    if (bidder === partnerOf(this.mySeat())) return 'Your partner'
    return SEAT_LABEL[bidder]
  }

  get lastLog(): string | undefined {
    const log = this.state().log
    return log[log.length - 1]
  }
}
