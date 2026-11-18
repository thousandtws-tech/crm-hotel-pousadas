// Lógica e estado de estacionamento — separada da camada de UI (estacionamento.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, computed, OnInit, effect, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, Validators } from '@angular/forms';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { EstacionamentoApi } from '@core/api/estacionamento.api';
import { Acomodacao } from '@core/models/catalogo.models';
import { VagaEstacionamento } from '@core/models/estacionamento.models';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourService } from '@core/services/tour.service';

@Directive()
export abstract class EstacionamentoStore implements OnInit {
  private readonly rt = inject(RealtimeService);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('estacionamento', 'acomodacao');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
    this.busca.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => this.termo.set(v.trim().toLowerCase()));
  }
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly estacionamentoApi = inject(EstacionamentoApi);
  private readonly notify = inject(NotifyService);
  private readonly tour = inject(TourService);
  private readonly confirm = inject(ConfirmService);
  protected readonly auth = inject(AuthStore);

  protected readonly vagas = signal<VagaEstacionamento[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivas = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4];
  protected readonly numero = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(1),
  ]);

  /** Vagas sem acomodação vinculada — exibidas no selo dourado do cabeçalho. */
  protected readonly livres = computed(() => this.vagas().filter((v) => !v.idacomodacao).length);

  /** Filtro instantâneo: número da vaga, nome/número da acomodação ou "livre". */
  protected readonly vagasFiltradas = computed(() => {
    const q = this.termo();
    return this.vagas().filter((v) => {
      if (this.apenasAtivas() && !v.ativo) return false;
      if (!q) return true;
      const acomod = this.acomodacoes().find((a) => a.id === v.idacomodacao);
      return (
        v.numero.toLowerCase().includes(q) ||
        (acomod ? `${acomod.nome} ${acomod.numero}`.toLowerCase().includes(q) : false) ||
        (q === 'livre' && !v.idacomodacao)
      );
    });
  });

  ngOnInit(): void {
    this.carregar();
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.estacionamentoApi.listarVagas().subscribe({
      next: (v) => {
        this.vagas.set(v);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  criar(): void {
    const n = this.numero.value;
    if (n == null || n < 1) return;
    this.estacionamentoApi.criarVaga(String(n)).subscribe({
      next: () => {
        this.numero.reset();
        this.notify.ok('Vaga cadastrada.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  vincular(v: VagaEstacionamento, idacomodacao: number | null): void {
    this.estacionamentoApi.vincularVaga(v.id, idacomodacao).subscribe({
      next: () => {
        this.notify.ok('Vínculo atualizado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  status(v: VagaEstacionamento, ativo: boolean): void {
    this.estacionamentoApi.statusVaga(v.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  async remover(v: VagaEstacionamento): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover a vaga ${v.numero}?`, {
      titulo: 'Remover vaga',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.estacionamentoApi.removerVaga(v.id).subscribe({
      next: () => {
        this.notify.ok('Vaga removida.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Estacionamento!',
          description:
            'Este tour rápido mostra cada parte da tela. Avance com <b>Próximo</b> ' +
            'e feche a qualquer momento no ✕ ou pela tecla Esc.',
        },
      },
      {
        element: '#tour-form',
        popover: {
          title: 'Cadastrar nova vaga',
          description:
            'Digite o <b>número da vaga física</b> e clique em <b>Cadastrar</b>. ' +
            'A vaga entra na lista na hora.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-busca',
        popover: {
          title: 'Busca rápida',
          description:
            'Filtre por <b>número da vaga</b> ou pelo <b>nome da acomodação</b> — ' +
            'a lista filtra sozinha enquanto digita. Dica: digite <b>livre</b> para ' +
            'ver só as vagas sem dono.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-ativas',
        popover: {
          title: 'Somente ativas',
          description:
            'Ligado, a lista mostra apenas vagas ativas. Desligado, aparecem ' +
            'todas — inclusive as inativas.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de vagas',
          description: 'Cada linha é uma vaga: número, acomodação dona da vaga e o status.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .est-vinc',
        skipMissingElement: true,
        popover: {
          title: 'Vincular a uma acomodação',
          description:
            'Use o seletor para escolher qual <b>acomodação</b> fica com a vaga. ' +
            'A bolinha fica <b>destacada quando vinculada</b> e cinza quando livre. ' +
            'A troca salva na hora.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .st-chip',
        skipMissingElement: true,
        popover: {
          title: 'Ativar / desativar',
          description:
            'Clique no selo para mudar o status — <b>Ativo</b> aparece ' +
            'destacado, <b>Inativo</b> esmaecido. Vagas inativas não aparecem ' +
            'na hora da reserva.',
          side: 'top',
        },
      },
      {
        element: 'tr.est-row .acao-btn',
        skipMissingElement: true,
        popover: {
          title: 'Excluir vaga',
          description:
            'A <b>lixeira</b> exclui a vaga — sempre pedindo confirmação ' +
            'antes. Disponível apenas para administradores.',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Você já conhece a tela de Estacionamento. Para rever, clique em ' +
            '<b>Tutorial</b> no topo a qualquer momento.',
        },
      },
    ]);
  }
}
