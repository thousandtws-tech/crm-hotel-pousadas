import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/** Base da API — no navegador é sempre a URL pública (default); no SSR o
 *  provider do servidor injeta a URL interna da rede privada (Railway),
 *  encurtando o fetch server-side sem mudar o que o browser usa. */
export const API_URL = new InjectionToken<string>('API_URL', {
  providedIn: 'root',
  factory: () => environment.apiUrl,
});
