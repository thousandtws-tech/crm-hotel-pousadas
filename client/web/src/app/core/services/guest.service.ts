import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PreFichaInfo {
  cliente_nome: string;
  acomodacao: string;
  entrada: string;
  saida: string;
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
}
