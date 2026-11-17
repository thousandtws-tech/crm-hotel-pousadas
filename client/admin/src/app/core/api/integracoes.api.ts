// Cliente HTTP das integrações de pagamento — catálogo (provedor × ambiente),
// credenciais write-only, habilitação, teste ao vivo, padrão do site e eventos
// de webhook. Rotas admin-only no backend; a UI já passa pelo adminGuard.

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class IntegracoesApi extends ApiHttp {
  /** Catálogo completo — inclui pares ainda não configurados. */
  listar() {
    return this.get<M.IntegracaoView[]>('/integracoes');
  }

  buscar(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao) {
    return this.get<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}`);
  }

  /** `segredos`: campo presente substitui, `""` remove, ausente mantém. */
  salvar(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao, input: M.IntegracaoInput) {
    return this.put<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}`, input);
  }

  habilitacao(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao, habilitado: boolean) {
    return this.patch<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}/habilitacao`, {
      habilitado,
    });
  }

  testar(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao) {
    return this.post<M.TesteIntegracao>(`/integracoes/${provedor}/${ambiente}/testar`, {});
  }

  /** Define o par como provedor padrão das novas cobranças do site (204). */
  definirPadrao(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao) {
    return this.put<null>(`/integracoes/${provedor}/${ambiente}/padrao`, {});
  }

  /** Últimos 50 eventos de webhook recebidos pelo par. */
  eventos(provedor: M.ProvedorPagamento, ambiente: M.AmbienteIntegracao) {
    return this.get<M.EventoIntegracaoView[]>(`/integracoes/${provedor}/${ambiente}/eventos`);
  }
}
