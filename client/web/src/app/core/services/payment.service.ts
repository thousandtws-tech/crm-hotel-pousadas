import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export type TipoPagamento = 'integral' | 'sinal' | 'saldo';
export type StatusPagamento =
  | 'pendente' | 'pago' | 'expirado' | 'falhou' | 'cancelado'
  | 'reembolso_parcial' | 'reembolsado';

export interface CheckoutOutput {
  checkout_url: string;
  valor_centavos: number;
  expira_em: string;
  idpagamento: number;
}

export interface PagamentoResumo {
  tipo: TipoPagamento;
  status: StatusPagamento;
  valor_centavos: number;
  metodo: string | null;
}

export interface StatusReserva {
  status_reserva: 'p' | 'i' | 'c' | 'f';
  confirmada: boolean;
  pagamentos: PagamentoResumo[];
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  /**
   * Cria a sessão Stripe para a reserva identificada pelo token opaco.
   * O valor é recalculado no servidor — o site nunca envia dinheiro.
   */
  public async criarCheckout(token: string, tipo: TipoPagamento): Promise<CheckoutOutput | null> {
    try {
      const res = await fetch(`${environment.apiUrl}/publico/pagamentos/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tipo })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** Estado persistido da reserva — reflete o que o webhook confirmou. */
  public async status(token: string): Promise<StatusReserva | null> {
    try {
      const res = await fetch(`${environment.apiUrl}/publico/pagamentos/status?token=${token}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public formatCentavos(centavos: number): string {
    return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
