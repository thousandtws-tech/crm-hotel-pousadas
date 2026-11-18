// Lógica e estado de governanca — separada da camada de UI (governanca.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { FuncionariosApi } from '@core/api/funcionarios.api';
import { OperacaoApi } from '@core/api/operacao.api';
import { Notify } from '@core/services/notify.service';
import {
  EnxovalMov,
  GovTarefa,
  LavLote,
  PrevisaoDia,
  StatusTarefaGov,
} from '@core/models/operacao.models';

type Aba = 'quadro' | 'previsao' | 'lavanderia';

const TIPO_ROTULO: Record<string, string> = {
  checkout: 'Checkout',
  stayover: 'Stayover',
  semanal: 'Semanal',
  area_comum: 'Área comum',
  extra: 'Extra',
};

/** Governança — tarefas do dia, previsão de demanda e lavanderia/enxoval. */
@Directive()
export abstract class GovernancaStore implements OnInit {
  private readonly funcionariosApi = inject(FuncionariosApi);
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(Notify);

  protected readonly aba = signal<Aba>('quadro');
  protected readonly tarefas = signal<GovTarefa[]>([]);
  protected readonly previsao = signal<PrevisaoDia[]>([]);
  protected readonly lotes = signal<LavLote[]>([]);
  protected readonly movs = signal<EnxovalMov[]>([]);
  protected readonly saldoEnxoval = signal<[string, number][]>([]);
  protected readonly funcionarios = signal<{ id: number; nome: string }[]>([]);
  protected readonly modalLote = signal(false);
  protected readonly modalMov = signal(false);
  protected dataQuadro = new Date().toISOString().slice(0, 10);
  protected novoLote = { fornecedor: '', qtd_itens: 0, custo: 0 };
  protected novaMov = { tipo_item: '', quantidade: 1, origem: 'estoque', destino: 'lavanderia' };
  protected readonly tipoRotulo = TIPO_ROTULO;

  ngOnInit(): void {
    this.carregarQuadro();
    this.operacaoApi
      .govPrevisao()
      .subscribe({ next: (p) => this.previsao.set(p), error: () => undefined });
    this.operacaoApi
      .lavLotes()
      .subscribe({ next: (l) => this.lotes.set(l), error: () => undefined });
    this.operacaoApi
      .enxovalMovs()
      .subscribe({ next: (m) => this.movs.set(m), error: () => undefined });
    this.operacaoApi
      .enxovalSaldo()
      .subscribe({ next: (s) => this.saldoEnxoval.set(s), error: () => undefined });
    this.funcionariosApi.listarFuncionarios(1, 100, true).subscribe({
      next: (p) => this.funcionarios.set(p.items.map((f) => ({ id: f.id, nome: f.nome }))),
      error: () => undefined,
    });
  }

  carregarQuadro(): void {
    this.operacaoApi.govQuadro(this.dataQuadro).subscribe({
      next: (t) => this.tarefas.set(t),
      error: () => this.notify.erroMsg('Falha ao carregar tarefas.'),
    });
  }

  status(t: GovTarefa, status: StatusTarefaGov): void {
    this.operacaoApi.govStatus(t.id, status).subscribe({
      next: () => this.carregarQuadro(),
      error: () => this.notify.erroMsg('Não foi possível atualizar.'),
    });
  }

  atribuir(id: number, idfuncionario: number | null): void {
    if (!idfuncionario) return;
    this.operacaoApi.govAtribuir(id, idfuncionario).subscribe({
      next: () => this.notify.ok('Responsável atribuído.'),
      error: () => this.notify.erroMsg('Falha ao atribuir.'),
    });
  }

  gerarD1(): void {
    this.operacaoApi.govGerarD1().subscribe({
      next: (r) => this.notify.ok(`${r.criadas} tarefas geradas para amanhã.`),
      error: () => this.notify.erroMsg('Falha na geração.'),
    });
  }

  abrirLote(): void {
    this.operacaoApi
      .lavAbrir({
        fornecedor: this.novoLote.fornecedor,
        qtd_itens: this.novoLote.qtd_itens,
        custo_centavos: Math.round(this.novoLote.custo * 100),
      })
      .subscribe({
        next: () => {
          this.modalLote.set(false);
          this.ngOnInit();
          this.notify.ok('Lote enviado.');
        },
        error: () => this.notify.erroMsg('Falha ao registrar lote.'),
      });
  }

  devolver(l: LavLote): void {
    const qtd = l.qtd_itens - l.qtd_devolvida;
    this.operacaoApi.lavDevolver(l.id, qtd).subscribe({
      next: () => {
        this.operacaoApi
          .lavLotes()
          .subscribe({ next: (x) => this.lotes.set(x), error: () => undefined });
      },
      error: () => this.notify.erroMsg('Falha ao registrar devolução.'),
    });
  }

  fecharMes(): void {
    const comp = this.dataQuadro.slice(0, 7) + '-01';
    this.operacaoApi.lavFechar(comp).subscribe({
      next: (r) => this.notify.ok(`Competência fechada — conta a pagar #${r.idlancamento}.`),
      error: () => this.notify.erroMsg('Competência já fechada ou sem lotes.'),
    });
  }

  gravarMov(): void {
    this.operacaoApi.enxovalRegistrar(this.novaMov).subscribe({
      next: () => {
        this.modalMov.set(false);
        this.ngOnInit();
        this.notify.ok('Movimentação registrada.');
      },
      error: () => this.notify.erroMsg('Falha ao registrar.'),
    });
  }

  horas(min: number): string {
    return `${(min / 60).toFixed(1)}h`;
  }

  brl(c: number): string {
    return `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  }
}
