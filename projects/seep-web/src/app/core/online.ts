import { InjectionToken, inject } from '@angular/core'
import { APP_VERSION } from '../version'
import { AuthService } from './auth.service'
import { FirebaseIdentityProvider } from './firebase-identity'
import { HttpApi } from './game-api'
import type { IdentityProvider } from './identity'

export interface OnlineConfig {
  /** The seep-api Function App, without a trailing /api. */
  readonly apiBaseUrl: string
}

export const DEFAULT_API_BASE_URL = 'https://seep-api-hxbegag7h2cde0a6.westus2-01.azurewebsites.net'

/**
 * The online features' dependencies, as root-provided tokens: nothing has to
 * be registered in app.config.ts, and a test or harness replaces any of them
 * with `{ provide: TOKEN, useValue: ... }`.
 */
export const ONLINE_CONFIG = new InjectionToken<OnlineConfig>('ONLINE_CONFIG', {
  providedIn: 'root',
  factory: () => ({ apiBaseUrl: DEFAULT_API_BASE_URL }),
})

export const IDENTITY_PROVIDER = new InjectionToken<IdentityProvider>('IDENTITY_PROVIDER', {
  providedIn: 'root',
  factory: () => new FirebaseIdentityProvider(),
})

export const AUTH = new InjectionToken<AuthService>('AUTH', {
  providedIn: 'root',
  factory: () => new AuthService(inject(IDENTITY_PROVIDER)),
})

export const ONLINE_API = new InjectionToken<HttpApi>('ONLINE_API', {
  providedIn: 'root',
  factory: () => {
    const auth = inject(AUTH)
    return new HttpApi({
      baseUrl: inject(ONLINE_CONFIG).apiBaseUrl,
      appVersion: APP_VERSION,
      getToken: (forceRefresh) => auth.getToken(forceRefresh),
    })
  },
})
