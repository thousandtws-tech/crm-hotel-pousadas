// Lógica e estado de caixa — separada da camada de UI (caixa.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { CaixaApi } from '@core/api/caixa.api';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num';
import {
  ConferenciaCaixa,
  PendenciaReserva,
  PendenciasFechamento,
  TipoMovimentoCaixa,
  TurnoView,
} from '@core/models/caixa.models';
import { ContaFinanceira } from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

@Directive()
export abstract class FinCaixaStore implements OnInit {
  private readonly caixaApi = inject(CaixaApi);
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;

  readonly gavetas = signal<ContaFinanceira[]>([]);
  protected readonly fch = signal<PendenciasFechamento | null>(null);
  protected readonly passo = signal(1);
  protected readonly pinAlvo = signal<PendenciaReserva | null>(null);
  protected readonly enviandoRel = signal(false);
  protected pinVal = '';
  readonly gavetaSel = computed(() => Number(this.selGaveta.value) || null);
  readonly turno = signal<TurnoView | null>(null);
  readonly conferencia = signal<ConferenciaCaixa | null>(null);
  readonly carregando = signal(false);
  readonly historico = signal<{ items: TurnoView[]; total: number }>({ items: [], total: 0 });
  private histPagina = 1;

  readonly selGaveta = new FormControl<number | null>(null);

  readonly abrirForm = new FormGroup({
    saldo_inicial: new FormControl<number | null>(0, [Validators.required, Validators.min(0)]),
    observacao: new FormControl<string | null>(null),
  });

  readonly movForm = new FormGroup({
    tipo: new FormControl<TipoMovimentoCaixa>('sangria', { nonNullable: true }),
    valor: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    motivo: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly feForm = new FormGroup({
    valor_contado: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    observacao: new FormControl<string | null>(null),
  });

  /** Quebra prevista = contado − esperado, só quando há valor digitado. */
  readonly prevQuebra = computed(() => {
    const c = this.conferencia();
    const v = this.feForm.value.valor_contado;
    if (!c || v === null || v === undefined) return null;
    return v - num(c.esperado);
  });

  ngOnInit(): void {
    this.financeiroApi.listarContasFinanceiras().subscribe({
      next: (contas) => {
        const gs = contas.filter((c) => c.tipo === 'caixa' && c.ativo);
        this.gavetas.set(gs);
        if (gs.length) this.selGaveta.setValue(gs[0].id);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
    this.selGaveta.valueChanges.subscribe(() => this.carregar());
    this.carregarPendencias();
  }

  carregarPendencias(): void {
    this.reservasApi.pendenciasFechamento().subscribe({
      next: (p) => this.fch.set(p),
      error: () => undefined,
    });
  }

  confirmarNoShow(alvo: PendenciaReserva): void {
    if (!this.pinVal.trim()) return;
    this.reservasApi.marcarNoShow(alvo.id, this.pinVal.trim()).subscribe({
      next: () => {
        this.pinAlvo.set(null);
        this.pinVal = '';
        this.notify.ok(`Reserva de ${alvo.cliente_nome} marcada como no-show.`);
        this.carregarPendencias();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  enviarRelatorio(): void {
    this.enviandoRel.set(true);
    this.reservasApi.enviarRelatorioFechamento().subscribe({
      next: () => {
        this.enviandoRel.set(false);
        this.notify.ok('Relatório de fechamento enfileirado para envio.');
        this.passo.set(1);
      },
      error: (e) => {
        this.enviandoRel.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregar(): void {
    const g = this.gavetaSel();
    this.histPagina = 1;
    if (!g) {
      this.turno.set(null);
      this.conferencia.set(null);
      return;
    }
    this.carregando.set(true);
    this.caixaApi.turnoAberto(g).subscribe({
      next: (t) => {
        this.carregando.set(false);
        if (t) this.recarregarTurno(t.id);
        else {
          this.turno.set(null);
          this.conferencia.set(null);
        }
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    this.caixaApi.listarTurnos({ idconta_financeira: g, porPagina: 10 }).subscribe({
      next: (p) => this.historico.set({ items: p.items, total: p.total }),
      error: (e) => this.notify.erro(e),
    });
  }

  private recarregarTurno(id: number): void {
    this.caixaApi.conferirTurno(id).subscribe({
      next: (c) => {
        this.conferencia.set(c);
        this.turno.set(c.turno);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrir(): void {
    const g = this.gavetaSel();
    const v = this.abrirForm.getRawValue();
    if (!g || v.saldo_inicial === null) return;
    this.caixaApi
      .abrirTurno({
        idconta_financeira: g,
        saldo_inicial: v.saldo_inicial,
        observacao: v.observacao,
      })
      .subscribe({
        next: (t) => {
          this.notify.ok('Turno aberto.');
          this.recarregarTurno(t.id);
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  movimentar(): void {
    const t = this.turno();
    const v = this.movForm.getRawValue();
    if (!t || v.valor === null || !v.motivo.trim()) return;
    this.caixaApi
      .movimentarTurno(t.id, { tipo: v.tipo, valor: v.valor, motivo: v.motivo.trim() })
      .subscribe({
        next: () => {
          this.notify.ok(v.tipo === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
          this.movForm.reset({ tipo: v.tipo, motivo: '' });
          this.recarregarTurno(t.id);
        },
        error: (e) => this.notify.erro(e),
      });
  }

  fechar(): void {
    const t = this.turno();
    const v = this.feForm.getRawValue();
    if (!t || v.valor_contado === null) return;
    this.caixaApi
      .fecharTurno(t.id, { valor_contado: v.valor_contado, observacao: v.observacao })
      .subscribe({
        next: (t2) => {
          const q = num(t2.quebra);
          if (q < 0) this.notify.aviso(`Turno fechado com QUEBRA de ${fmt(q)}.`);
          else
            this.notify.ok(`Turno fechado. ${q > 0 ? `Sobra de ${fmt(q)}.` : 'Valores exatos.'}`);
          this.feForm.reset();
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  maisHistorico(): void {
    const g = this.gavetaSel();
    if (!g) return;
    this.histPagina++;
    this.caixaApi
      .listarTurnos({ idconta_financeira: g, page: this.histPagina, porPagina: 10 })
      .subscribe({
        next: (p) =>
          this.historico.update((h) => ({ items: [...h.items, ...p.items], total: p.total })),
        error: (e) => this.notify.erro(e),
      });
  }
}
