import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withInterceptors} from '@angular/common/http';

import {routes} from './app.routes';
import {BASE_PATH, Configuration} from './api';
import {
  BASE_PATH as LOCATION_BASE_PATH,
  Configuration as LocationConfiguration
} from './api/location';
import {browserSessionInterceptor} from './services/browser-session.service';

class JsonApiConfiguration extends Configuration {
  override selectHeaderAccept(accepts: string[]): string | undefined {
    const selected = super.selectHeaderAccept(accepts);
    return selected === '*/*' ? 'application/json' : selected;
  }
}

class JsonLocationConfiguration extends LocationConfiguration {
  override selectHeaderAccept(accepts: string[]): string | undefined {
    const selected = super.selectHeaderAccept(accepts);
    return selected === '*/*' ? 'application/json' : selected;
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([browserSessionInterceptor])),
    {provide: BASE_PATH, useValue: ''},
    {provide: LOCATION_BASE_PATH, useValue: ''},
    {
      provide: Configuration,
      useFactory: () => new JsonApiConfiguration({basePath: '', withCredentials: true}),
    },
    {
      provide: LocationConfiguration,
      useFactory: () => new JsonLocationConfiguration({basePath: ''}),
    },
  ],
};
