import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_URL } from '../config/api-url';

export interface PreFichaInfo {
  cliente_nome: string;
  acomodacao: string;
  entrada: string;
  saida: string;
  fnrh_assinatura: boolean;
  /** Já há foto do documento na ficha (retomada do link). */
  tem_documento?: boolean;
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

/** Oferta de upsell — preço calculado no servidor; o checkout revalida. */
export interface OfertaUpsell {
  oferta: 'early_checkin' | 'late_checkout' | 'upgrade';
  idacomodacao?: number;
  titulo: string;
  descricao: string;
  valor_centavos: number;
}

export interface CheckoutExtraOut {
  checkout_url: string;
  valor_centavos: number;
  expira_em: string;
  idpagamento: number;
}

/** Endpoints públicos de hóspede — acesso por token opaco, sem login. */
@Injectable({ providedIn: 'root' })
export class GuestService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_URL);
  private readonly base = `${this.api}/publico`;

  preFicha(token: string): Observable<PreFichaInfo> {
    return this.http.get<PreFichaInfo>(`${this.base}/fnrh/${token}`);
  }

  gravarPreFicha(token: string, dados: Record<string, unknown>): Observable<void> {
    return this.http.post<void>(`${this.base}/fnrh/${token}`, dados);
  }

  /** Foto do documento da pré-ficha — imagem crua no corpo (≤4MB). */
  enviarDocumentoFnrh(token: string, arquivo: File): Observable<unknown> {
    return this.http.post(`${this.base}/fnrh/${token}/documento`, arquivo, {
      headers: { 'Content-Type': arquivo.type },
    });
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

  /** Upsell do portal — ofertas disponíveis agora pra esta reserva. */
  ofertas(token: string): Observable<OfertaUpsell[]> {
    return this.http.get<OfertaUpsell[]>(`${this.base}/portal/${token}/ofertas`);
  }

  /** Cria o checkout Stripe do extra — a confirmação vem só por webhook;
   *  o redirect de sucesso nunca marca o extra como pago. */
  checkoutExtra(token: string, oferta: string, idacomodacao?: number): Observable<CheckoutExtraOut> {
    return this.http.post<CheckoutExtraOut>(`${this.base}/portal/${token}/extras/checkout`, {
      oferta,
      idacomodacao,
    });
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
