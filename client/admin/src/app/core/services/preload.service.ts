import { Service } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

/**
 * Preload seletivo: só baixa em background os chunks das rotas marcadas
 * com `data: { preload: true }` em app.routes — as telas quentes de
 * recepção/operação diária. Telas administrativas e de relatórios
 * ficam sob demanda, sem disputar banda no login.
 */
@Service()
export class PreloadService implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.['preload'] === true ? load() : of(null);
  }
}
