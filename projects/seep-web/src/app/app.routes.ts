import { Routes } from '@angular/router';
import { LandingComponent } from './pages/landing/landing.component';
import { TwoPlayerComponent } from './pages/two-player/two-player.component';
import { FourPlayerComponent } from './pages/four-player/four-player.component';

// The online screens are loaded on demand (and with them the sign-in SDK), so
// anyone who only plays the bots never downloads any of it.
const lobby = () => import('./pages/online/lobby.component').then((m) => m.LobbyComponent);

export const routes: Routes = [
  { path: '', component: LandingComponent, title: 'Seep' },
  { path: 'two-player', component: TwoPlayerComponent, title: 'Seep — 2 Player' },
  { path: 'four-player', component: FourPlayerComponent, title: 'Seep — 4 Player' },
  { path: 'online', loadComponent: lobby, title: 'Seep — Play online' },
  { path: 'join/:code', loadComponent: lobby, title: 'Seep — Join a table' },
  {
    path: 'online/game/:id',
    loadComponent: () => import('./pages/online/online-game.component').then((m) => m.OnlineGameComponent),
    title: 'Seep — Online table',
  },
  { path: '**', redirectTo: '' },
];
