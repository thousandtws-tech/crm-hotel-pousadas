// Lógica e estado de conciliacao — separada da camada de UI (conciliacao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { num } from '@core/utils/num';
import {
  ConciliacaoResumo,
  ContaFinanceira,
  ExtratoView,
  PlanoConta,
  StatusExtrato,
  SugestaoConciliacao,
} from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

@Directive()
export abstract class FinConciliacaoStore implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;

  readonly contas = signal<ContaFinanceira[]>([]);
  readonly contasBanco = computed(() => this.contas().filter((c) => c.tipo === 'banco' && c.ativo));
  readonly plano = signal<PlanoConta[]>([]);
  readonly itens = signal<ExtratoView[]>([]);
  readonly resumo = signal<ConciliacaoResumo | null>(null);
  readonly sugestoes = signal<SugestaoConciliacao[]>([]);
  readonly status = signal<StatusExtrato | null>('pendente');
  readonly carregando = signal(true);
  readonly carregandoSug = signal(false);
  readonly rodando = signal(false);
  readonly aberto = signal<number | null>(null);
  readonly classAberto = signal<number | null>(null);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 30)));

  readonly contaCtrl = new FormControl<number | null>(null);
  readonly clsForm = new FormGroup({
    idplano_conta: new FormControl<number | null>(null),
    descricao: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.financeiroApi.listarContasFinanceiras(true).subscribe({
      next: (cs) => {
        this.contas.set(cs);
        const banco = cs.find((c) => c.tipo === 'banco' && c.ativo) ?? cs.find((c) => c.ativo);
        if (banco) this.contaCtrl.setValue(banco.id, { emitEvent: false });
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
    this.financeiroApi.listarPlanoContas(false).subscribe({
      next: (p) => this.plano.set(p),
      error: () => undefined,
    });
    this.contaCtrl.valueChanges.subscribe(() => this.pagina(1));
  }

  planoPara(e: ExtratoView): PlanoConta[] {
    const tipo = num(e.valor) > 0 ? 'receber' : 'pagar';
    return this.plano().filter((p) => p.tipo === tipo);
  }

  carregar(): void {
    this.carregando.set(true);
    this.aberto.set(null);
    this.classAberto.set(null);
    const idconta = this.contaCtrl.value;
    this.financeiroApi
      .listarExtrato({
        idconta_financeira: idconta,
        status: this.status(),
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
    this.financeiroApi.resumoExtrato(idconta).subscribe({
      next: (r) => this.resumo.set(r),
      error: () => undefined,
    });
  }

  pagina(p: number): void {
    this.page.set(p);
    this.carregar();
  }

  filtroStatus(s: StatusExtrato | null): void {
    this.status.set(s);
    this.pagina(1);
  }

  rotulo(s: StatusExtrato): string {
    return s === 'pendente' ? 'Pendente' : s === 'conciliado' ? 'Conciliado' : 'Ignorado';
  }

  importar(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const idconta = this.contaCtrl.value;
    if (!file) return;
    if (!idconta) {
      this.notify.aviso('Selecione a conta bancária antes de importar.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.financeiroApi.importarExtrato(idconta, String(reader.result ?? '')).subscribe({
        next: (r) => {
          this.notify.ok(`${r.importados} itens importados, ${r.duplicados} duplicados ignorados.`);
          this.pagina(1);
        },
        error: (e) => this.notify.erro(e),
      });
    };
    reader.readAsText(file);
    input.value = '';
  }

  autoConciliar(): void {
    const idconta = this.contaCtrl.value;
    if (!idconta) {
      this.notify.aviso('Selecione a conta bancária.');
      return;
    }
    this.rodando.set(true);
    this.financeiroApi.autoConciliar(idconta).subscribe({
      next: (r) => {
        this.rodando.set(false);
        this.notify.ok(`${r.conciliados} itens conciliados automaticamente.`);
        this.carregar();
      },
      error: (e) => {
        this.rodando.set(false);
        this.notify.erro(e);
      },
    });
  }

  toggleSugestoes(e: ExtratoView): void {
    if (this.aberto() === e.id) {
      this.aberto.set(null);
      return;
    }
    this.classAberto.set(null);
    this.aberto.set(e.id);
    this.carregandoSug.set(true);
    this.financeiroApi.sugestoesExtrato(e.id).subscribe({
      next: (s) => {
        this.sugestoes.set(s);
        this.carregandoSug.set(false);
      },
      error: (err) => {
        this.carregandoSug.set(false);
        this.notify.erro(err);
      },
    });
  }

  toggleClassificar(e: ExtratoView): void {
    this.aberto.set(null);
    this.classAberto.set(this.classAberto() === e.id ? null : e.id);
    this.clsForm.reset({ idplano_conta: null, descricao: e.descricao });
  }

  conciliar(e: ExtratoView, idbaixa: number): void {
    this.financeiroApi.conciliarExtrato(e.id, idbaixa).subscribe({
      next: () => {
        this.notify.ok('Conciliado.');
        this.carregar();
      },
      error: (err) => this.notify.erro(err),
    });
  }

  confirmarClassificar(e: ExtratoView): void {
    const v = this.clsForm.getRawValue();
    if (v.idplano_conta === null) return;
    this.financeiroApi
      .classificarExtrato(e.id, v.idplano_conta, v.descricao.trim() || null)
      .subscribe({
        next: () => {
          this.notify.ok('Lançamento criado e conciliado.');
          this.classAberto.set(null);
          this.carregar();
        },
        error: (err) => this.notify.erro(err),
      });
  }

  ignorar(e: ExtratoView): void {
    this.financeiroApi.ignorarExtrato(e.id).subscribe({
      next: () => {
        this.notify.ok('Item ignorado.');
        this.carregar();
      },
      error: (err) => this.notify.erro(err),
    });
  }
}
