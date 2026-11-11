// Cliente HTTP tipado do domínio inteligencia para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class InteligenciaApi extends ApiHttp {
  iaResumo() {
    return this.get<M.IaResumo>('/ia/resumo');
  }

  iaOcupacao() {
    return this.get<M.IaOcupacaoDia[]>('/ia/ocupacao-14d');
  }

  iaHistorico() {
    return this.get<M.IaMesHistorico[]>('/ia/historico-12m');
  }

  iaRiscos() {
    return this.get<M.IaRisco[]>('/ia/risco-cancelamentos');
  }

  iaPerfis() {
    return this.get<M.IaPerfil[]>('/ia/perfis-hospedes');
  }

  iaEscala() {
    return this.get<M.IaEscalaDia[]>('/ia/escala-ideal');
  }

  iaUpsell() {
    return this.get<M.IaUpsell[]>('/ia/upsell');
  }

  iaEstoque() {
    return this.get<M.IaEstoquePrev[]>('/ia/estoque-previsto');
  }

  iaManutencao() {
    return this.get<M.IaRiscoQuarto[]>('/ia/manutencao-preventiva');
  }
}
