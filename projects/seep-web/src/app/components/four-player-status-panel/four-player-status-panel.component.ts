import { Component, computed, input } from '@angular/core'
import { type FourPlayerGameView, SeatId, teamOf } from 'seep-engine'
import { type SeatNames, fourPlayerSeatLabel, relabelFourPlayerLine } from '../../core/board-names'

const PHASE_LABEL: Record<FourPlayerGameView['phase'], string> = {
  bidding: 'Bidding',
  'opening-move': 'Opening move',
  playing: 'In play',
  'hand-over': 'Hand over',
  'match-over': 'Match over',
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
  /** The names people chose, by seat (never set against the computer). */
  readonly seatNames = input<SeatNames>({})
  /** Which team the viewer is on, so their own team can be marked "(You & Partner)" whichever it is. */
  readonly myTeam = computed(() => teamOf(this.mySeat()))

  get phaseLabel(): string {
    return PHASE_LABEL[this.state().phase]
  }

  get bidderLabel(): string {
    const bidder = this.state().bidder
    return fourPlayerSeatLabel(bidder, this.mySeat(), this.seatNames())
  }

  get lastLog(): string | undefined {
    const log = this.state().log
    const last = log[log.length - 1]
    return last === undefined ? undefined : relabelFourPlayerLine(last, (seat) => fourPlayerSeatLabel(seat, this.mySeat(), this.seatNames()))
  }
}
