// Lógica e estado de pagamentos — separada da camada de UI (pagamentos.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { ComprovanteResumo, FormaPagamento } from '@core/models/pagamentos.models';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TourService } from '@core/services/tour.service';
import { AuthStore } from '@core/services/auth.store';

// Central de pagamentos: comprovantes emitidos + formas de pagamento aceitas.
@Directive()
export abstract class PagamentosStore implements OnInit {
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmService);
  private readonly rt = inject(RealtimeService);
  private readonly tour = inject(TourService);
  protected readonly auth = inject(AuthStore);

  protected readonly comprovantes = signal<ComprovanteResumo[]>([]);
  protected readonly formas = signal<FormaPagamento[]>([]);
  protected readonly modalFormas = signal(false);
  protected readonly nova = signal('');
  protected readonly editando = signal<number | null>(null);
  protected readonly imprimindo = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly skel = [0, 1, 2, 3, 4];

  protected readonly ativas = computed(() => this.formas().filter((f) => f.ativo).length);

  protected readonly filtrados = computed(() => {
    const t = this.termo().trim().toLowerCase();
    if (!t) return this.comprovantes();
    return this.comprovantes().filter(
      (c) =>
        c.cliente.toLowerCase().includes(t) ||
        c.acomodacao.toLowerCase().includes(t) ||
        String(c.idreserva).includes(t) ||
        this.codigo(c).toLowerCase().includes(t),
    );
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('forma_pagamento', 'consumo', 'pagamento');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarFormas();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarFormas();
  }

  onEsc(): void {
    if (this.modalFormas()) this.modalFormas.set(false);
  }

  carregar(): void {
    this.pagamentosApi.comprovantes().subscribe({
      next: (c) => {
        this.comprovantes.set(c);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarFormas(): void {
    this.pagamentosApi.listarPagamentos(false).subscribe({
      next: (p) => this.formas.set(p),
      error: (e) => this.notify.erro(e),
    });
  }

  abrirFormas(): void {
    this.carregarFormas();
    this.modalFormas.set(true);
  }

  codigo(c: ComprovanteResumo): string {
    return c.comprovante.replace(/\.[^.]+$/, '');
  }

  iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  visualizar(c: ComprovanteResumo): void {
    this.pagamentosApi.comprovanteTexto(c.idreserva).subscribe({
      next: (txt) => {
        const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        window.open(url, '_blank');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  baixar(c: ComprovanteResumo): void {
    this.pagamentosApi.comprovanteTexto(c.idreserva).subscribe({
      next: (txt) => {
        const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = c.comprovante;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  imprimir(c: ComprovanteResumo): void {
    this.imprimindo.set(c.idreserva);
    this.impressorasApi.imprimirComprovante(c.idreserva).subscribe({
      next: (r) => {
        this.imprimindo.set(null);
        this.notify.ok(r.mensagem);
      },
      error: (e) => {
        this.imprimindo.set(null);
        this.notify.erro(e);
      },
    });
  }

  criar(): void {
    const nome = this.nova().trim();
    if (!nome) return;
    this.pagamentosApi.criarPagamento(nome).subscribe({
      next: () => {
        this.nova.set('');
        this.carregarFormas();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  salvarNome(p: FormaPagamento, e: Event): void {
    const nome = (e.target as HTMLInputElement).value.trim();
    this.editando.set(null);
    if (!nome || nome === p.nome) return;
    this.pagamentosApi.atualizarPagamento(p.id, nome, p.version).subscribe({
      next: () => this.carregarFormas(),
      error: (err) => this.notify.erro(err),
    });
  }

  alternar(p: FormaPagamento): void {
    this.pagamentosApi.statusPagamento(p.id, !p.ativo).subscribe({
      next: () => this.carregarFormas(),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(p: FormaPagamento): Promise<void> {
    const ok = await this.confirm.perguntar(`Excluir a forma de pagamento "${p.nome}"?`, {
      titulo: 'Excluir forma de pagamento',
      confirmar: 'Excluir',
    });
    if (!ok) return;
    this.pagamentosApi.excluirPagamento(p.id).subscribe({
      next: () => {
        this.notify.ok('Forma de pagamento excluída.');
        this.carregarFormas();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à tela de Pagamentos!',
          description:
            'Aqui ficam os <b>comprovantes emitidos</b> e as <b>formas de ' +
            'pagamento</b> aceitas na pousada. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.pg-resumo',
        popover: {
          title: 'Resumo rápido',
          description:
            'Quantos <b>comprovantes</b> já foram emitidos e quantas ' +
            '<b>formas de pagamento</b> estão ativas no momento.',
          side: 'bottom',
        },
      },
      {
        element: '.pg-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite o <b>nome do hóspede</b>, o <b>nº da reserva</b> ou a ' +
            '<b>acomodação</b> — a lista filtra sozinha.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Comprovantes',
          description:
            'Cada linha é um comprovante de check-out. Os botões permitem ' +
            '<b>visualizar</b> (olho), <b>baixar o arquivo</b> (seta) e ' +
            '<b>imprimir na térmica</b> (impressora).',
          side: 'top',
        },
      },
      {
        element: '#tour-formas',
        popover: {
          title: 'Formas de pagamento',
          description:
            'Abre o cadastro dos meios aceitos: <b>PIX, cartões, dinheiro</b>… ' +
            'O que estiver <b>ativo</b> aparece na hora de receber do hóspede ' +
            'no check-out.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Tela de Pagamentos dominada. Lembre: comprovante só existe após ' +
            'o check-out — e a impressão sai direto na térmica da recepção.',
        },
      },
    ]);
  }
}
