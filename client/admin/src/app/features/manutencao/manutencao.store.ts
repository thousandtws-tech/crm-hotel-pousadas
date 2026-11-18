// Lógica e estado de manutencao — separada da camada de UI (manutencao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, Directive } from '@angular/core';
import { OperacaoApi } from '@core/api/operacao.api';
import { Notify } from '@core/services/notify.service';
import {
  ManutOrdem,
  PmocRegistro,
  PrioridadeManut,
  StatusManut,
} from '@core/models/operacao.models';

type Aba = 'ordens' | 'pmoc';

const PRIORIDADES: PrioridadeManut[] = ['baixa', 'media', 'alta', 'urgente'];
const STATUS: StatusManut[] = [
  'aberta',
  'em_execucao',
  'aguardando_peca',
  'concluida',
  'cancelada',
];

/** Manutenção — ordens de serviço e PMOC (Lei 13.589/2018). */
@Directive()
export abstract class ManutencaoStore implements OnInit {
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(Notify);

  protected readonly aba = signal<Aba>('ordens');
  protected readonly ordens = signal<ManutOrdem[]>([]);
  protected readonly pmoc = signal<PmocRegistro[]>([]);
  protected readonly itensPmoc = signal<string[]>([]);
  protected readonly filtroStatus = signal('');
  protected readonly modalOrdem = signal(false);
  protected readonly modalPmoc = signal(false);
  protected checkPmoc: boolean[] = Array(10).fill(true);
  protected readonly prioridades = PRIORIDADES;
  protected readonly statusLista = STATUS;
  protected readonly statusFiltros = [
    { v: '', r: 'Todas' },
    { v: 'aberta', r: 'Abertas' },
    { v: 'em_execucao', r: 'Em execução' },
    { v: 'aguardando_peca', r: 'Aguardando peça' },
  ];
  protected novaOrdem: {
    titulo: string;
    idquarto: number | null;
    local: string;
    prioridade: PrioridadeManut;
    descricao: string;
  } = { titulo: '', idquarto: null, local: '', prioridade: 'media', descricao: '' };
  protected pmocForm = { nome: '', crea: '', art: '', obs: '' };

  ngOnInit(): void {
    this.carregar();
    this.operacaoApi
      .pmocItens()
      .subscribe({ next: (i) => this.itensPmoc.set(i), error: () => undefined });
  }

  carregar(): void {
    this.operacaoApi.manutOrdens(this.filtroStatus() || undefined).subscribe({
      next: (o) => this.ordens.set(o),
      error: () => this.notify.erroMsg('Falha ao carregar ordens.'),
    });
  }

  carregarPmoc(): void {
    this.operacaoApi
      .pmocListar()
      .subscribe({ next: (p) => this.pmoc.set(p), error: () => undefined });
  }

  vencimentoPmoc(): { data: string; vencido: boolean } | null {
    const prox = this.pmoc()[0]?.proxima_data;
    if (!prox) return null;
    return { data: prox, vencido: prox < new Date().toISOString().slice(0, 10) };
  }

  mudarStatus(o: ManutOrdem, status: StatusManut): void {
    this.operacaoApi.manutStatus(o.id, status).subscribe({
      next: () => this.carregar(),
      error: () => this.notify.erroMsg('Falha ao atualizar status.'),
    });
  }

  criarOrdem(): void {
    this.operacaoApi
      .manutCriar({
        titulo: this.novaOrdem.titulo,
        idquarto: this.novaOrdem.idquarto || null,
        local: this.novaOrdem.local,
        prioridade: this.novaOrdem.prioridade,
        descricao: this.novaOrdem.descricao,
      })
      .subscribe({
        next: () => {
          this.modalOrdem.set(false);
          this.carregar();
          this.notify.ok('OS aberta.');
        },
        error: () => this.notify.erroMsg('Falha ao abrir OS.'),
      });
  }

  registrarPmoc(): void {
    const itens = this.itensPmoc().map((item, i) => ({
      item,
      conforme: this.checkPmoc[i] ?? false,
      obs: '',
    }));
    this.operacaoApi
      .pmocRegistrar({
        itens,
        responsavel_nome: this.pmocForm.nome,
        responsavel_crea: this.pmocForm.crea,
        responsavel_art: this.pmocForm.art,
        observacoes: this.pmocForm.obs,
      })
      .subscribe({
        next: () => {
          this.modalPmoc.set(false);
          this.carregarPmoc();
          this.notify.ok('Inspeção registrada.');
        },
        error: () => this.notify.erroMsg('Falha ao registrar inspeção.'),
      });
  }

  brl(c: number): string {
    return `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  }
}
