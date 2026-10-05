import { Routes } from '@angular/router';
import { ShellComponent } from './components/shell/shell.component';
import { LandingComponent } from './pages/landing/landing.component';
import { TwoPlayerComponent } from './pages/two-player/two-player.component';
import { FourPlayerComponent } from './pages/four-player/four-player.component';

// The online screens are loaded on demand (and with them the sign-in SDK), so
// anyone who only plays the bots never downloads any of it.
const lobby = () => import('./pages/online/lobby.component').then((m) => m.LobbyComponent);

const pages: Routes = [
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
  {
    path: 'privacy',
    loadComponent: () => import('./pages/legal/privacy.component').then((m) => m.PrivacyComponent),
    title: 'Seep — Privacy Policy',
  },
  {
    path: 'terms',
    loadComponent: () => import('./pages/legal/terms.component').then((m) => m.TermsComponent),
    title: 'Seep — Terms of Use',
  },
  { path: '**', redirectTo: '' },
];

// Every page sits inside the shell, which carries the analytics choice (see components/shell).
export const routes: Routes = [{ path: '', component: ShellComponent, children: pages }];
