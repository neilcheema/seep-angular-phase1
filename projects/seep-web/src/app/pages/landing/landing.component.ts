import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The app's home route: two entry points, one per game variant (spec §6).
 * Each link carries ?new=1 so the destination page starts a fresh game
 * immediately, rather than requiring a second "Deal" click once inside.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.component.html',
})
export class LandingComponent {}
