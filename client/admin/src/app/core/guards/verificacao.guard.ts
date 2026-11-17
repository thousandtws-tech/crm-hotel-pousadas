import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { VerificacaoApi } from '@core/api/verificacao.api';
import type { MinhaVerificacao } from '@core/models';
import { firstValueFrom } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';

const BYPASS_KEY = 'verificacao_bypass_admin';
const TTL_MS = 30_000;

/** Cache curto — o portão roda a cada navegação; um HTTP por 30s basta. */
let cache: { at: number; v: MinhaVerificacao | null } | null = null;

/** Bypass de emergência gravado pela tela de verificação (só admins veem). */
export function marcarBypassAdmin(): void {
  sessionStorage.setItem(BYPASS_KEY, '1');
}

/** A tela de verificação chama ao aprovar — a próxima rota não pode
 *  reutilizar o `bloqueado` cacheado. */
export function invalidarCacheVerificacao(): void {
  cache = null;
}

/**
 * Portão de identidade — roda no shell autenticado: quando a integração
 * Didit de produção exige verificação e o funcionário ainda não aprovou o
 * KYC, toda navegação cai na tela de verificação. Falha da API (rede fora,
 * deploy) não tranca: deixa passar e a tela tenta de novo na próxima rota.
 * Admin (nível 1) pode liberar o acesso de emergência pela tela — o
 * backend informa `admin` e a marcação fica na sessionStorage da aba.
 */
export const verificacaoGuard: CanActivateFn = async () => {
  const api = inject(VerificacaoApi);
  const router = inject(Router);
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const v = await firstValueFrom(
      api.minha().pipe(
        map((x) => x),
        catchError(() => of(null)),
      ),
    );
    cache = { at: Date.now(), v };
  }
  const r = cache.v;
  if (!r || !r.bloqueado) return true;
  if (r.admin && sessionStorage.getItem(BYPASS_KEY) === '1') return true;
  return router.createUrlTree(['/verificacao']);
};
