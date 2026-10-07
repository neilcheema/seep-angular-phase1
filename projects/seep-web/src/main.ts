import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { registerOfflineWorker } from './app/core/offline-worker';
import { startStaleAppGuard } from './app/core/stale-app';

bootstrapApplication(AppComponent, appConfig)
  .then(() => {
    registerOfflineWorker();
    startStaleAppGuard();
  })
  .catch((err) => console.error(err));
