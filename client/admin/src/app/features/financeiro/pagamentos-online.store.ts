// Lógica e estado de pagamentos-online — separada da camada de UI (pagamentos-online.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import {
  PagOnlineResumo,
  ReceitaAcomodacao,
  ResumoFinanceiroOnline,
  StatusPagOnline,
} from '@core/models/pagamentos.models';

// Pagamentos online (Stripe): cartão/Pix recebidos pelo site, com resumo,
// filtros e reembolso restrito à permissão `financeiro`.
@Directive()
export abstract class FinPagamentosOnlineStore implements OnInit {
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly notify = inject(Notify);
  readonly auth = inject(AuthStore);

  protected readonly resumo = signal<ResumoFinanceiroOnline | null>(null);
  protected readonly porAcomodacao = signal<ReceitaAcomodacao[]>([]);
  protected readonly lista = signal<PagOnlineResumo[]>([]);
  protected readonly carregando = signal(true);
  protected readonly modal = signal<PagOnlineResumo | null>(null);
  protected readonly reembolsando = signal(false);
  protected valorReembolso: number | null = null;
  protected motivoReembolso = '';
  protected de = '';
  protected ate = '';
  protected status = '';

  ngOnInit(): void {
    const hoje = new Date();
    this.ate = hoje.toISOString().slice(0, 10);
    this.de = new Date(hoje.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    this.carregar();
  }

  protected carregar(): void {
    this.carregando.set(true);
    this.pagamentosApi.resumoFinanceiroOnline(this.de, this.ate).subscribe({
      next: (r) => this.resumo.set(r),
      error: () => this.notify.erro('Não foi possível carregar o resumo financeiro.'),
    });
    this.pagamentosApi.receitaPorAcomodacao(this.de, this.ate).subscribe({
      next: (r) => this.porAcomodacao.set(r),
      error: () => undefined,
    });
    this.pagamentosApi
      .pagamentosOnline({
        status: this.status || undefined,
        inicio: this.de,
        fim: this.ate,
        per_page: 200,
      })
      .subscribe({
        next: (p) => {
          this.lista.set(p.items);
          this.carregando.set(false);
        },
        error: () => {
          this.carregando.set(false);
          this.notify.erro('Não foi possível listar os pagamentos.');
        },
      });
  }

  protected podeReembolsar(p: PagOnlineResumo): boolean {
    return (
      this.auth.canFinanceiro() &&
      (p.status === 'pago' || p.status === 'reembolso_parcial') &&
      p.reembolsado_centavos < p.valor_centavos
    );
  }

  protected abrirReembolso(p: PagOnlineResumo): void {
    this.valorReembolso = null;
    this.motivoReembolso = '';
    this.modal.set(p);
  }

  protected confirmarReembolso(p: PagOnlineResumo): void {
    if (this.reembolsando()) return;
    this.reembolsando.set(true);
    const centavos =
      this.valorReembolso && this.valorReembolso > 0 ? Math.round(this.valorReembolso * 100) : null;
    this.pagamentosApi.reembolsarPagamento(p.id, centavos, this.motivoReembolso).subscribe({
      next: () => {
        this.reembolsando.set(false);
        this.modal.set(null);
        this.notify.ok('Reembolso solicitado ao Stripe.');
        this.carregar();
      },
      error: (e) => {
        this.reembolsando.set(false);
        this.notify.erro(e?.error?.erro?.mensagem ?? 'Reembolso recusado.');
      },
    });
  }

  protected brl(centavos: number): string {
    return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  protected rotTipo(t: string): string {
    return t === 'sinal' ? 'Sinal 30%' : t === 'saldo' ? 'Saldo' : 'Integral';
  }

  protected rotStatus(s: StatusPagOnline): string {
    const mapa: Record<StatusPagOnline, string> = {
      pendente: 'Pendente',
      pago: 'Pago',
      expirado: 'Expirado',
      falhou: 'Recusado',
      cancelado: 'Cancelado',
      reembolso_parcial: 'Reemb. parcial',
      reembolsado: 'Reembolsado',
    };
    return mapa[s];
  }
}
