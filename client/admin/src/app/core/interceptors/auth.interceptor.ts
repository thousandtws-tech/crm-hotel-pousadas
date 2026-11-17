// Interceptor: injeta Bearer e, em 401 de rotas protegidas, tenta uma
// rotação de refresh (single-flight) e repete a requisição uma única vez.

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthStore } from '@core/services/auth.store';

const ROTAS_PUBLICAS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  // Credenciais só saem para a API da pousada — chamadas a serviços
  // externos (ViaCEP, REST Countries…) nunca carregam o Bearer.
  const interna = req.url.startsWith(environment.apiUrl);
  const publica = !interna || ROTAS_PUBLICAS.some((p) => req.url.includes(p));
  const token = auth.accessToken();

  const authed = !publica && token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      // Portão Didit: o backend recusa TODA rota protegida com 403
      // VERIFICACAO_PENDENTE enquanto o KYC não aprova — a navegação
      // para a tela de verificação é a única saída. As chamadas
      // /verificacao/minha* passam (AtorBasico) e não chegam aqui.
      if (
        err.status === 403 &&
        err.error?.erro?.codigo === 'VERIFICACAO_PENDENTE' &&
        !req.url.includes('/verificacao/')
      ) {
        router.navigateByUrl('/verificacao-pendente');
        return throwError(() => err);
      }
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
