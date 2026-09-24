import { Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { TwoPlayerComponent } from './pages/two-player/two-player.component';
import { FourPlayerComingSoonComponent } from './pages/four-player-coming-soon/four-player-coming-soon.component';

export const routes: Routes = [
  { path: '', component: LandingComponent, title: 'Seep' },
  { path: 'two-player', component: TwoPlayerComponent, title: 'Seep — 2 Player' },
  { path: 'four-player', component: FourPlayerComingSoonComponent, title: 'Seep — 4 Player' },
  { path: '**', redirectTo: '' },
];
