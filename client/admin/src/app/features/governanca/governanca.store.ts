// Lógica e estado de governanca — separada da camada de UI (governanca.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { OperacaoApi } from '@core/api/operacao.api';
import { NotifyService } from '@core/services/notify.service';
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
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(NotifyService);

  protected readonly aba = signal<Aba>('quadro');
  protected readonly tarefas = signal<GovTarefa[]>([]);
  protected readonly previsao = signal<PrevisaoDia[]>([]);
  protected readonly lotes = signal<LavLote[]>([]);
  protected readonly movs = signal<EnxovalMov[]>([]);
  protected readonly saldoEnxoval = signal<[string, number][]>([]);
  protected readonly funcionarios = signal<{ id: number; nome: string }[]>([]);
  protected readonly modalLote = signal(false);
  protected readonly modalMov = signal(false);
  // Data local (não UTC): toISOString vira o dia às 21h no horário de Brasília.
  protected dataQuadro = GovernancaStore.hojeLocal();
  protected novoLote = { fornecedor: '', qtd_itens: 0, custo: 0 };
  protected novaMov = { tipo_item: '', quantidade: 1, origem: 'estoque', destino: 'lavanderia' };
  protected readonly tipoRotulo = TIPO_ROTULO;

  private static hojeLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 1 request consolidada — backend resolve as 6 leituras em paralelo.
  ngOnInit(): void {
    this.operacaoApi.painelGovernanca(this.dataQuadro).subscribe({
      next: (p) => {
        this.tarefas.set(p.tarefas);
        this.previsao.set(p.previsao);
        this.lotes.set(p.lotes);
        this.movs.set(p.movs_enxoval);
        this.saldoEnxoval.set(p.saldo_enxoval);
        this.funcionarios.set(p.funcionarios.map((f) => ({ id: f.id, nome: f.nome })));
      },
      error: () => this.notify.erroMsg('Falha ao carregar governança.'),
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
