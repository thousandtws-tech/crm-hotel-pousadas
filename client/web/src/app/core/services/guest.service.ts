import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PreFichaInfo {
  cliente_nome: string;
  acomodacao: string;
  entrada: string;
  saida: string;
  fnrh_assinatura: boolean;
}

export interface AvaliacaoInfo {
  respondida: boolean;
  comentario: string | null;
  resposta: string | null;
  nota_geral: number | null;
}

export interface RespostaAvaliacao {
  nota_geral: number;
  nota_limpeza?: number;
  nota_atendimento?: number;
  nota_custo?: number;
  nota_localizacao?: number;
  nps?: number;
  comentario?: string;
}

export interface MensagemChat {
  origem: 'hospede' | 'inna';
  texto: string;
  criado_em?: string;
}

export interface PortalInfo {
  hospede: string;
  acomodacao: string | null;
  entrada: string;
  saida: string;
  historico: MensagemChat[];
}

export interface RespostaConcierge {
  resposta: string;
  escalar: boolean;
}

/** Endpoints públicos de hóspede — acesso por token opaco, sem login. */
@Injectable({ providedIn: 'root' })
export class GuestService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/publico`;

  preFicha(token: string): Observable<PreFichaInfo> {
    return this.http.get<PreFichaInfo>(`${this.base}/fnrh/${token}`);
  }

  gravarPreFicha(token: string, dados: Record<string, unknown>): Observable<void> {
    return this.http.post<void>(`${this.base}/fnrh/${token}`, dados);
  }

  avaliacao(token: string): Observable<AvaliacaoInfo> {
    return this.http.get<AvaliacaoInfo>(`${this.base}/avaliacoes/${token}`);
  }

  responderAvaliacao(token: string, resposta: RespostaAvaliacao): Observable<void> {
    return this.http.post<void>(`${this.base}/avaliacoes/${token}`, resposta);
  }

  /** Portal do hóspede — contexto + histórico do concierge (token opaco). */
  portal(token: string): Observable<PortalInfo> {
    return this.http.get<PortalInfo>(`${this.base}/concierge/${token}`);
  }

  enviarMensagem(token: string, mensagem: string): Observable<RespostaConcierge> {
    return this.http.post<RespostaConcierge>(`${this.base}/concierge/${token}`, { mensagem });
  }

  /** LGPD art. 18 — documento PDF legível com os dados do titular.
   *  URL direta: o navegador baixa via Content-Disposition do backend. */
  dadosPdfUrl(token: string): string {
    return `${this.base}/lgpd/${token}/dados.pdf`;
  }

  /** LGPD — enfileira o documento do titular no canal pedido
   *  (e-mail com PDF anexo ou WhatsApp com o link do documento). */
  enviarDados(token: string, canal: 'email' | 'whatsapp'): Observable<void> {
    return this.http.post<void>(`${this.base}/lgpd/${token}/enviar`, { canal });
  }

  /** LGPD — nova solicitação do titular (protocolo + prazo de 15 dias). */
  solicitarLgpd(token: string, tipo: string, detalhe?: string): Observable<{ protocolo: number; prazo_dias: number }> {
    return this.http.post<{ protocolo: number; prazo_dias: number }>(`${this.base}/lgpd/${token}`, { tipo, detalhe });
  }
}
