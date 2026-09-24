import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Placeholder for the /four-player route. The real four-player team game
 * is built in Phases 2-4 of the technical spec (team-aware engine, the
 * four-seat UI, and the move-narration panel); this page exists now only
 * so the landing page's second entry point has somewhere to go.
 */
@Component({
  selector: 'app-four-player-coming-soon',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './four-player-coming-soon.component.html',
})
export class FourPlayerComingSoonComponent {}
