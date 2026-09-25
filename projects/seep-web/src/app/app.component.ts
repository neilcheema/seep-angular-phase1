import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import Clarity from '@microsoft/clarity';

// Replace with your actual Clarity project ID — get it from
// clarity.microsoft.com > your project > Settings > Overview.
const CLARITY_PROJECT_ID = 'yo1jcfvwdm';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  constructor() {
    // Skip on local dev (ng serve) so testing sessions don't pollute real
    // usage data — runs on both seep.quest and www.seep.quest once deployed.
    // Root-level, so it tracks navigation across the landing page and both
    // games for the whole SPA session, not per-route.
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      Clarity.init(CLARITY_PROJECT_ID)
    }
  }
}
