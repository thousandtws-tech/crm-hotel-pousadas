// Lógica e estado de inteligencia — separada da camada de UI (inteligencia.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { InteligenciaApi } from '@core/api/inteligencia.api';
import { Notify } from '@core/services/notify.service';
import {
  IaEscalaDia,
  IaEstoquePrev,
  IaMesHistorico,
  IaPerfil,
  IaResumo,
  IaRisco,
  IaRiscoQuarto,
  IaUpsell,
} from '@core/models/inteligencia.models';

type Aba = 'visao' | 'riscos' | 'hospedes' | 'operacao';

const CLASSE_ROTULO: Record<string, string> = {
  vip: 'VIP',
  ativo: 'Ativo',
  em_risco: 'Em risco',
  churn: 'Churn',
  novo: 'Novo',
};

/** Inteligência preditiva — BI, risco de no-show, perfis, pace e otimização. */
@Directive()
export abstract class InteligenciaStore implements OnInit {
  private readonly inteligenciaApi = inject(InteligenciaApi);
  private readonly notify = inject(Notify);

  readonly aba = signal<Aba>('visao');
  readonly resumo = signal<IaResumo | null>(null);
  readonly historico = signal<IaMesHistorico[]>([]);
  readonly riscos = signal<IaRisco[]>([]);
  readonly riscoQuartos = signal<IaRiscoQuarto[]>([]);
  readonly perfis = signal<IaPerfil[]>([]);
  readonly upsells = signal<IaUpsell[]>([]);
  readonly escala = signal<IaEscalaDia[]>([]);
  readonly estoque = signal<IaEstoquePrev[]>([]);

  readonly classeRotulo = CLASSE_ROTULO;
  readonly classesOrdenadas = ['vip', 'ativo', 'em_risco', 'churn', 'novo'];
  private carregadas = new Set<Aba>();

  ngOnInit() {
    this.inteligenciaApi.iaResumo().subscribe({
      next: (r) => this.resumo.set(r),
      error: (e) => this.notify.erro(e),
    });
    this.inteligenciaApi.iaHistorico().subscribe({
      next: (h) => this.historico.set(h),
      error: () => {},
    });
    this.carregadas.add('visao');
  }

  trocar(aba: Aba) {
    this.aba.set(aba);
    if (this.carregadas.has(aba)) return;
    this.carregadas.add(aba);
    if (aba === 'riscos') {
      this.inteligenciaApi
        .iaRiscos()
        .subscribe({ next: (r) => this.riscos.set(r), error: (e) => this.notify.erro(e) });
      this.inteligenciaApi
        .iaManutencao()
        .subscribe({ next: (r) => this.riscoQuartos.set(r), error: (e) => this.notify.erro(e) });
    } else if (aba === 'hospedes') {
      this.inteligenciaApi
        .iaPerfis()
        .subscribe({ next: (p) => this.perfis.set(p), error: (e) => this.notify.erro(e) });
      this.inteligenciaApi
        .iaUpsell()
        .subscribe({ next: (u) => this.upsells.set(u), error: (e) => this.notify.erro(e) });
    } else if (aba === 'operacao') {
      this.inteligenciaApi
        .iaEscala()
        .subscribe({ next: (e) => this.escala.set(e), error: (e2) => this.notify.erro(e2) });
      this.inteligenciaApi
        .iaEstoque()
        .subscribe({ next: (e) => this.estoque.set(e), error: (e2) => this.notify.erro(e2) });
    }
  }

  pct(ocupados: number, total: number) {
    return total > 0 ? Math.round((ocupados / total) * 100) : 0;
  }

  somaReceita(r: IaResumo) {
    return r.receita_4sem.reduce((a, s) => a + Number(s.receita), 0);
  }
}
