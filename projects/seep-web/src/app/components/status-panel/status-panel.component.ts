import { Component, input } from '@angular/core';
import type { GameState } from 'seep-engine';

const PHASE_LABEL: Record<GameState['phase'], string> = {
  bidding: 'Bidding',
  'opening-move': 'Opening move',
  playing: 'In play',
  'hand-over': 'Hand over',
  'match-over': 'Match over',
};

/** Score, bid, phase, and last-move summary header shown above the floor. */
@Component({
  selector: 'app-status-panel',
  standalone: true,
  templateUrl: './status-panel.component.html',
})
export class StatusPanelComponent {
  readonly state = input.required<GameState>();

  get phaseLabel(): string {
    return PHASE_LABEL[this.state().phase];
  }

  get lastLog(): string | undefined {
    const log = this.state().log;
    return log[log.length - 1];
  }
}
