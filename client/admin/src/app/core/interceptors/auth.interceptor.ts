// Interceptor: injeta Bearer e, em 401 de rotas protegidas, tenta uma
// rotação de refresh (single-flight) e repete a requisição uma única vez.

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthStore } from '@core/services/auth.store';

const ROTAS_PUBLICAS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const publica = ROTAS_PUBLICAS.some((p) => req.url.includes(p));
  const token = auth.accessToken();

  const authed = !publica && token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || publica || req.headers.has('X-Retry')) {
        return throwError(() => err);
      }
      return auth.tentarRefresh().pipe(
        switchMap((ok) => {
          if (!ok) {
            auth.sairSilencioso();
            return throwError(() => err);
          }
          const retry = req.clone({
            setHeaders: {
              Authorization: `Bearer ${auth.accessToken()}`,
              'X-Retry': '1',
            },
          });
          return next(retry);
        }),
      );
    }),
  );
};
