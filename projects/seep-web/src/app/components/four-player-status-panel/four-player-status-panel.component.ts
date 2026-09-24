import { Component, input } from '@angular/core'
import type { FourPlayerGameState } from 'seep-engine'

const PHASE_LABEL: Record<FourPlayerGameState['phase'], string> = {
  bidding: 'Bidding',
  'opening-move': 'Opening move',
  playing: 'In play',
  'hand-over': 'Hand over',
  'match-over': 'Match over',
}

const SEAT_LABEL: Record<string, string> = {
  p1: 'You',
  p2: 'Player 2',
  p3: 'Your partner',
  p4: 'Player 4',
}

/** Score, bid, phase, and last-move summary header for the four-player table. */
@Component({
  selector: 'app-four-player-status-panel',
  standalone: true,
  templateUrl: './four-player-status-panel.component.html',
})
export class FourPlayerStatusPanelComponent {
  readonly state = input.required<FourPlayerGameState>()

  get phaseLabel(): string {
    return PHASE_LABEL[this.state().phase]
  }

  get bidderLabel(): string {
    return SEAT_LABEL[this.state().bidder] ?? this.state().bidder
  }

  get lastLog(): string | undefined {
    const log = this.state().log
    return log[log.length - 1]
  }
}
