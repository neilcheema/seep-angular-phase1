import { Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { TwoPlayerComponent } from './pages/two-player/two-player.component';
import { FourPlayerComponent } from './pages/four-player/four-player.component';

export const routes: Routes = [
  { path: '', component: LandingComponent, title: 'Seep' },
  { path: 'two-player', component: TwoPlayerComponent, title: 'Seep — 2 Player' },
  { path: 'four-player', component: FourPlayerComponent, title: 'Seep — 4 Player' },
  { path: '**', redirectTo: '' },
];
