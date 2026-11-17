import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

if (environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.production ? 'production' : 'development',
    // Erros de chunk antigo pós-deploy se resolvem sozinhos no reload —
    // reportar seria ruído. O ChunkReloadErrorHandler filtra o resto.
    ignoreErrors: [
      /Failed to fetch dynamically imported module/i,
      /ChunkLoadError/i,
      /Importing a module script failed/i,
      /error loading dynamically imported module/i,
    ],
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
