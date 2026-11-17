// Cliente HTTP da verificação de identidade (KYC Didit) — portão de login
// do funcionário autenticado e gestão gerencial das sessões hospedadas.

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

export interface DiditConfigInput {
  workflowId?: string;
  callbackUrl?: string;
  exigirVerificacao?: boolean;
}

@Service()
export class VerificacaoApi extends ApiHttp {
  /** Status + flag do portão para o funcionário autenticado. */
  minha() {
    return this.get<M.MinhaVerificacao>('/verificacao/minha');
  }

  /** Cria/recupera a sessão hospedada do próprio usuário — produção. */
  minhaSessao() {
    return this.post<M.SessaoVerificacao>('/verificacao/minha/sessao', {});
  }

  listar(ambiente: M.AmbienteIntegracao = 'producao', pagina = 1) {
    return this.get<{ items: M.VerificacaoListItem[]; total: number }>('/verificacao', {
      ambiente,
      pagina,
    });
  }

  /** Status de um funcionário — badge na tela de equipe (gerencial+). */
  statusFuncionario(idfuncionario: number, ambiente: M.AmbienteIntegracao = 'producao') {
    return this.get<M.VerificacaoFuncionarioStatus>(`/verificacao/funcionarios/${idfuncionario}`, {
      ambiente,
    });
  }

  /** Cria/recupera a sessão de um funcionário para envio manual do link. */
  sessaoFuncionario(idfuncionario: number, ambiente: M.AmbienteIntegracao = 'producao') {
    return this.post<M.SessaoVerificacao>(
      `/verificacao/funcionarios/${idfuncionario}/sessao?ambiente=${ambiente}`,
      {},
    );
  }

  /** Puxa a decisão remota — atualiza o status se mudou. */
  sincronizar(id: string) {
    return this.post<M.VerificacaoListItem>(`/verificacao/${id}/sincronizar`, {});
  }

  /** Configura workflow/callback e o portão de login (admin). */
  configurar(ambiente: M.AmbienteIntegracao, input: DiditConfigInput) {
    return this.post<null>(`/integracoes/didit/${ambiente}/config`, {
      workflow_id: input.workflowId,
      callback_url: input.callbackUrl,
      exigir_verificacao: input.exigirVerificacao,
    });
  }

  /** Registra o destino de webhook na Didit e captura o segredo. */
  registrarWebhook(ambiente: M.AmbienteIntegracao) {
    return this.post<{ webhook_url: string }>(`/integracoes/didit/${ambiente}/webhook`, {});
  }
}
