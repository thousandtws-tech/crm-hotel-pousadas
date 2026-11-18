// Lógica e estado de contas — separada da camada de UI (contas.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { num } from '@core/utils/num.utils';
import {
  BaixaView,
  ContaFinanceira,
  LancamentoView,
  PlanoConta,
  StatusLancamento,
  TipoLancamento,
} from '@core/models/financeiro.models';
import { FormaPagamento } from '@core/models/pagamentos.models';
import { NotifyService } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

const STATUS: Record<StatusLancamento, { rotulo: string; cls: string }> = {
  aberto: { rotulo: 'Em aberto', cls: 'st-aberto' },
  parcial: { rotulo: 'Parcial', cls: 'st-parcial' },
  liquidado: { rotulo: 'Liquidado', cls: 'st-liquidado' },
  cancelado: { rotulo: 'Cancelado', cls: 'st-cancelado' },
};

type Aba = 'receber' | 'pagar';

function hojeIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Directive()
export abstract class FinContasStore implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly notify = inject(NotifyService);

  readonly STATUS = STATUS;
  readonly fmt = fmt;
  readonly num = num;

  readonly aba = signal<Aba>('receber');
  readonly itens = signal<LancamentoView[]>([]);
  readonly contas = signal<ContaFinanceira[]>([]);
  readonly saldos = signal<Record<number, number>>({});
  readonly plano = signal<PlanoConta[]>([]);
  readonly pagamentos = signal<FormaPagamento[]>([]);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly formAberto = signal(false);
  readonly cfFormAberto = signal(false);
  readonly baixaAberta = signal<number | null>(null);
  readonly baixasAbertas = signal<number | null>(null);
  readonly baixas = signal<BaixaView[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 20)));

  readonly planoFiltrado = computed(() =>
    this.plano().filter((p) => p.tipo === this.form.controls.tipo.value),
  );

  readonly statusCtrl = new FormControl<string>('', { nonNullable: true });
  readonly vencidosCtrl = new FormControl<boolean>(false, { nonNullable: true });
  readonly buscaCtrl = new FormControl<string>('', { nonNullable: true });

  readonly form = new FormGroup({
    tipo: new FormControl<TipoLancamento>('receber', { nonNullable: true }),
    descricao: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    favorecido: new FormControl('', { nonNullable: true }),
    valor: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    vencimento: new FormControl(hojeIso(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    parcelas: new FormControl<number>(1, { nonNullable: true }),
    idplano_conta: new FormControl<number | null>(null),
    idconta_financeira: new FormControl<number | null>(null),
    observacao: new FormControl('', { nonNullable: true }),
  });

  readonly cfForm = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tipo: new FormControl<'banco' | 'caixa' | 'aplicacao'>('banco', { nonNullable: true }),
    banco: new FormControl('', { nonNullable: true }),
    agencia: new FormControl('', { nonNullable: true }),
    conta: new FormControl('', { nonNullable: true }),
    saldo_inicial: new FormControl<number | null>(0),
  });

  readonly baixaForm = new FormGroup({
    idconta_financeira: new FormControl<number | null>(null, { validators: [Validators.required] }),
    valor: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0.01)],
    }),
    data: new FormControl(hojeIso(), { nonNullable: true }),
    idforma_pagamento: new FormControl<number | null>(null),
    observacao: new FormControl('', { nonNullable: true }),
  });

  private buscaTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.recarregarAuxiliares();
    this.carregar();
    this.statusCtrl.valueChanges.subscribe(() => this.pagina(1));
    this.vencidosCtrl.valueChanges.subscribe(() => this.pagina(1));
    this.buscaCtrl.valueChanges.subscribe(() => {
      if (this.buscaTimer) clearTimeout(this.buscaTimer);
      this.buscaTimer = setTimeout(() => this.pagina(1), 350);
    });
  }

  private recarregarAuxiliares(): void {
    this.financeiroApi.listarContasFinanceiras(true).subscribe({
      next: (cs) => {
        this.contas.set(cs);
        for (const c of cs) {
          this.financeiroApi.saldoConta(c.id).subscribe({
            next: (r) => this.saldos.update((s) => ({ ...s, [c.id]: num(r.saldo) })),
            error: () => undefined,
          });
        }
      },
      error: (e) => this.notify.erro(e),
    });
    this.financeiroApi.listarPlanoContas(false).subscribe({
      next: (p) => this.plano.set(p),
      error: () => undefined,
    });
    this.pagamentosApi.listarPagamentos().subscribe({
      next: (p) => this.pagamentos.set(p),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.carregando.set(true);
    this.financeiroApi
      .listarLancamentos({
        tipo: this.aba(),
        status: (this.statusCtrl.value || null) as StatusLancamento | null,
        vencidos: this.vencidosCtrl.value,
        busca: this.buscaCtrl.value || null,
        page: this.page(),
      })
      .subscribe({
        next: (p) => {
          this.itens.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  mudarAba(a: Aba): void {
    this.aba.set(a);
    this.pagina(1);
  }

  pagina(p: number): void {
    this.page.set(p);
    this.fecharBaixa();
    this.baixasAbertas.set(null);
    this.carregar();
  }

  toggleForm(): void {
    this.formAberto.update((v) => !v);
  }
  toggleCfForm(): void {
    this.cfFormAberto.update((v) => !v);
  }

  salvar(): void {
    if (this.form.invalid) return;
    this.salvando.set(true);
    const v = this.form.getRawValue();
    this.financeiroApi
      .criarLancamento({
        tipo: v.tipo,
        descricao: v.descricao.trim(),
        favorecido: v.favorecido.trim() || null,
        valor: Number(v.valor),
        vencimento: v.vencimento,
        parcelas: v.parcelas > 1 ? v.parcelas : null,
        idplano_conta: v.idplano_conta,
        idconta_financeira: v.idconta_financeira,
        observacao: v.observacao.trim() || null,
      })
      .subscribe({
        next: (criados) => {
          this.salvando.set(false);
          this.notify.ok(
            criados.length > 1 ? `${criados.length} parcelas criadas.` : 'Lançamento criado.',
          );
          this.form.reset({
            tipo: v.tipo,
            descricao: '',
            favorecido: '',
            valor: null,
            vencimento: hojeIso(),
            parcelas: 1,
            idplano_conta: null,
            idconta_financeira: null,
            observacao: '',
          });
          this.formAberto.set(false);
          this.carregar();
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  salvarConta(): void {
    if (this.cfForm.invalid) return;
    const v = this.cfForm.getRawValue();
    this.financeiroApi
      .criarContaFinanceira({
        nome: v.nome.trim(),
        tipo: v.tipo,
        banco: v.banco.trim() || null,
        agencia: v.agencia.trim() || null,
        conta: v.conta.trim() || null,
        saldo_inicial: v.saldo_inicial ?? 0,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Conta criada.');
          this.cfForm.reset({
            nome: '',
            tipo: 'banco',
            banco: '',
            agencia: '',
            conta: '',
            saldo_inicial: 0,
          });
          this.cfFormAberto.set(false);
          this.recarregarAuxiliares();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  abrirBaixa(l: LancamentoView): void {
    this.baixasAbertas.set(null);
    this.baixaAberta.set(l.id);
    this.baixaForm.patchValue({ valor: num(l.saldo), data: hojeIso() });
    const conta =
      this.contas().find((c) => c.ativo && c.tipo === 'banco') ??
      this.contas().find((c) => c.ativo);
    this.baixaForm.patchValue({ idconta_financeira: conta?.id ?? null });
  }

  fecharBaixa(): void {
    this.baixaAberta.set(null);
  }

  confirmarBaixa(l: LancamentoView): void {
    if (this.baixaForm.invalid) return;
    const v = this.baixaForm.getRawValue();
    this.financeiroApi
      .baixarLancamento(l.id, {
        idconta_financeira: Number(v.idconta_financeira),
        valor: Number(v.valor),
        data: v.data || null,
        idforma_pagamento: v.idforma_pagamento,
        observacao: v.observacao.trim() || null,
      })
      .subscribe({
        next: (r) => {
          this.notify.ok(
            r.lancamento.status === 'liquidado' ? 'Título liquidado.' : 'Baixa parcial registrada.',
          );
          this.fecharBaixa();
          this.carregar();
          this.recarregarAuxiliares();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  cancelar(l: LancamentoView): void {
    if (!confirm(`Cancelar "${l.descricao}"? As baixas serão desconsideradas.`)) return;
    this.financeiroApi.cancelarLancamento(l.id).subscribe({
      next: () => {
        this.notify.ok('Lançamento cancelado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleBaixas(id: number): void {
    if (this.baixasAbertas() === id) {
      this.baixasAbertas.set(null);
      return;
    }
    this.baixasAbertas.set(id);
    this.financeiroApi.listarBaixas(id).subscribe({
      next: (b) => this.baixas.set(b),
      error: (e) => this.notify.erro(e),
    });
  }

  iconeConta(tipo: string): string {
    return tipo === 'banco' ? 'account_balance' : tipo === 'caixa' ? 'point_of_sale' : 'savings';
  }
}
