import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { API_URL } from './core/config/api-url';
import { environment } from '../environments/environment';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Fetch server-side vai pela rede privada quando configurada
    // (API_INTERNAL_URL) — mesma API, sem sair pro edge público.
    {
      provide: API_URL,
      useValue: process.env['API_INTERNAL_URL'] || environment.apiUrl,
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
