// Lógica e estado de split — separada da camada de UI (split.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { num } from '@core/utils/num';
import {
  SplitEventoView,
  SplitResumo,
  TributoApuracao,
  TributoConfig,
} from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));
const PCT = (v: string | number | null | undefined) =>
  `${num(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Directive()
export abstract class FinSplitStore implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;
  readonly PCT = PCT;

  readonly config = signal<TributoConfig | null>(null);
  readonly resumo = signal<SplitResumo | null>(null);
  readonly eventos = signal<SplitEventoView[]>([]);
  readonly apuracoes = signal<TributoApuracao[]>([]);
  readonly cfgAberto = signal(false);
  readonly recAberto = signal(false);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 20)));

  readonly cfgForm = new FormGroup({
    aliq_ibs: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    aliq_cbs: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0)],
    }),
    regime: new FormControl<'split' | 'destaque'>('split', { nonNullable: true }),
    vigente_desde: new FormControl(isoLocal(new Date()), { nonNullable: true }),
  });

  readonly recForm = new FormGroup({
    competencia: new FormControl(
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      { nonNullable: true, validators: [Validators.required] },
    ),
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.financeiroApi.tributoConfig().subscribe({
      next: (c) => this.config.set(c),
      error: (e) => this.notify.erro(e),
    });
    this.financeiroApi.splitResumo().subscribe({
      next: (r) => this.resumo.set(r),
      error: (e) => this.notify.erro(e),
    });
    this.financeiroApi.listarApuracoes().subscribe({
      next: (a) => this.apuracoes.set(a),
      error: () => undefined,
    });
    this.carregarEventos();
  }

  carregarEventos(): void {
    this.financeiroApi.splitEventos(null, null, this.page()).subscribe({
      next: (p) => {
        this.eventos.set(p.items);
        this.total.set(p.total);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  pagina(p: number): void {
    this.page.set(p);
    this.carregarEventos();
  }

  toggleConfig(): void {
    this.cfgAberto.update((v) => !v);
    const c = this.config();
    if (c) {
      this.cfgForm.patchValue({
        aliq_ibs: num(c.aliq_ibs),
        aliq_cbs: num(c.aliq_cbs),
        regime: c.regime === 'destaque' ? 'destaque' : 'split',
        vigente_desde: isoLocal(new Date()),
      });
    }
  }

  salvarConfig(): void {
    if (this.cfgForm.invalid) return;
    const v = this.cfgForm.getRawValue();
    this.financeiroApi
      .criarTributoConfig({
        aliq_ibs: Number(v.aliq_ibs),
        aliq_cbs: Number(v.aliq_cbs),
        regime: v.regime,
        vigente_desde: v.vigente_desde,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Alíquotas atualizadas.');
          this.cfgAberto.set(false);
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  toggleRecolher(): void {
    this.recAberto.update((v) => !v);
  }

  confirmarRecolher(): void {
    const mes = this.recForm.controls.competencia.value; // "yyyy-MM"
    if (!mes) return;
    this.financeiroApi.recolherApuracao(`${mes}-01`).subscribe({
      next: (a) => {
        this.notify.ok(
          `Apuração ${mes} fechada: ${fmt(num(a.valor_ibs) + num(a.valor_cbs))} recolhidos.`,
        );
        this.recAberto.set(false);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }
}
