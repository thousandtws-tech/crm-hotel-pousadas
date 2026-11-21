// Lógica e estado de acomodacoes — separada da camada de UI (acomodacoes.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, computed, OnInit, effect, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { EstacionamentoApi } from '@core/api/estacionamento.api';
import { num } from '@core/utils/num.utils';
import {
  Acomodacao,
  AcomodacaoInput,
  Quarto,
  TarifaOcupacaoInput,
  TarifaPeriodo,
  TarifaPeriodoInput,
  TipoAcomodacao,
} from '@core/models/catalogo.models';
import { TarifaHistorico } from '@core/models/comercial.models';
import { VagaEstacionamento } from '@core/models/estacionamento.models';
import { NotifyService } from '@core/services/notify.service';
import { ConfirmService } from '@core/services/confirm.service';
import { RealtimeService } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourService } from '@core/services/tour.service';

type Modal = 'tipos' | 'quarto' | null;

@Directive()
export abstract class AcomodacoesStore implements OnInit {
  private readonly rt = inject(RealtimeService);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('acomodacao', 'quarto', 'tipo_acomodacao', 'estacionamento');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarTipos();
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
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly items = signal<Acomodacao[]>([]);
  protected readonly tipos = signal<TipoAcomodacao[]>([]);
  protected readonly quartos = signal<Quarto[]>([]);
  protected readonly tarifas = signal<TarifaHistorico[]>([]);
  /** Vagas de estacionamento vinculadas à acomodação aberta no modal. */
  protected readonly vagasDaAcomodacao = signal<VagaEstacionamento[]>([]);
  /** Quartos ativos da acomodação aberta no modal. */
  protected readonly quartosAtivos = computed(() => this.quartos().filter((q) => q.ativo).length);
  protected readonly selecionada = signal<Acomodacao | null>(null);
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivas = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5];
  protected readonly num = num;

  protected readonly modal = signal<Modal>(null);
  protected readonly drawerAberto = signal(false);
  protected readonly editando = signal<Acomodacao | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);
  protected readonly vagasLivres = signal<VagaEstacionamento[]>([]);
  protected readonly comVaga = signal(false);
  protected readonly vagasSel = signal<number[]>([]);
  protected readonly editandoTipo = signal<number | null>(null);
  protected readonly tarifasTipo = signal<number | null>(null);
  protected readonly faixas = signal<{ hospedes: number; valor: string }[]>([]);
  protected readonly salvandoFaixas = signal(false);
  protected readonly novoTipo = new FormControl('', [Validators.required]);
  protected readonly tipoNomeCtrl = new FormControl('', [Validators.required]);
  protected readonly quartoNumero = new FormControl('', [Validators.required]);

  /** Diárias diferenciadas por data da acomodação aberta no modal. */
  protected readonly tarifasPeriodo = signal<TarifaPeriodo[]>([]);
  protected readonly salvandoTarifa = signal(false);
  protected readonly tarifaForm = this.fb.nonNullable.group({
    inicio: ['', Validators.required],
    fim: ['', Validators.required],
    valor: [null as number | null, [Validators.required, Validators.min(0.01)]],
    rotulo: [''],
    prioridade: [0],
  });

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    numero: [0, [Validators.required, Validators.min(0)]],
    andar: [0, [Validators.min(0), Validators.max(99)]],
    idtipo_acomodacao: [null as number | null, Validators.required],
    valor: [null as number | null],
    capacidade: [1, [Validators.required, Validators.min(1)]],
    descricao: [''],
    cor: ['#1a6f8a'],
  });

  /** Acomodações ativas — selo dourado do cabeçalho. */
  protected readonly ativas = computed(() => this.items().filter((a) => a.ativo).length);

  /** Filtro instantâneo: nome, número ou nome do tipo. */
  protected readonly filtradas = computed(() => {
    const q = this.termo();
    return this.items().filter((a) => {
      if (this.apenasAtivas() && !a.ativo) return false;
      if (!q) return true;
      return (
        a.nome.toLowerCase().includes(q) ||
        String(a.numero).includes(q) ||
        this.tipoNome(a.idtipo_acomodacao).toLowerCase().includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.carregar();
    this.carregarTipos();
  }

  carregar(): void {
    this.acomodacoesApi.listarAcomodacoes(1, 200).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarTipos(): void {
    this.acomodacoesApi.listarTipos().subscribe({
      next: (t) => this.tipos.set(t),
      error: (e) => this.notify.erro(e),
    });
  }

  tipoNome(id: number | null): string {
    return this.tipos().find((t) => t.id === id)?.nome ?? '—';
  }

  visualizar(a: Acomodacao): void {
    this.selecionada.set(a);
    this.acomodacoesApi.listarQuartos(a.id).subscribe({
      next: (q) => this.quartos.set(q),
      error: () => undefined,
    });
    this.acomodacoesApi.tarifasAcomodacao(a.id).subscribe({
      next: (t) => this.tarifas.set(t),
      error: () => undefined,
    });
    this.acomodacoesApi.tarifasPeriodo(a.id).subscribe({
      next: (t) => this.tarifasPeriodo.set(t),
      error: () => this.tarifasPeriodo.set([]),
    });
    this.estacionamentoApi.listarVagas().subscribe({
      next: (v) => this.vagasDaAcomodacao.set(v.filter((x) => x.idacomodacao === a.id && x.ativo)),
      error: () => this.vagasDaAcomodacao.set([]),
    });
  }

  onEsc(): void {
    if (this.tour.ativo()) return;
    if (this.modal()) this.fecharModal();
    else if (this.selecionada()) this.selecionada.set(null);
    else if (this.drawerAberto()) this.fecharDrawer();
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editando.set(null);
    document.body.style.overflow = '';
  }

  fecharModal(): void {
    this.modal.set(null);
    this.editandoTipo.set(null);
  }

  chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  invalido(ctrl: string): boolean {
    const c = this.form.get(ctrl);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  abrirForm(a?: Acomodacao): void {
    this.editando.set(a ?? null);
    this.comVaga.set(false);
    this.vagasSel.set([]);
    this.tentouSalvar.set(false);
    if (a) {
      this.form.patchValue({
        nome: a.nome,
        numero: a.numero,
        andar: a.andar ?? 0,
        idtipo_acomodacao: a.idtipo_acomodacao,
        valor: a.valor !== null ? Number(a.valor) : null,
        capacidade: a.capacidade,
        descricao: a.descricao ?? '',
        cor: a.cor ?? '#1a6f8a',
      });
    } else {
      this.form.reset({
        nome: '',
        numero: 0,
        andar: 0,
        idtipo_acomodacao: null,
        valor: null,
        capacidade: 1,
        descricao: '',
        cor: '#1a6f8a',
      });
      this.estacionamentoApi.listarVagas().subscribe({
        next: (v) => this.vagasLivres.set(v.filter((x) => x.ativo && x.idacomodacao === null)),
        error: () => this.vagasLivres.set([]),
      });
    }
    this.drawerAberto.set(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('ac-nome')?.focus(), 260);
  }

  salvar(): void {
    if (this.form.invalid) {
      this.tentouSalvar.set(true);
      this.notify.aviso('Revise os campos destacados.');
      setTimeout(
        () => document.querySelector('.drawer .inval')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.form.getRawValue();
    const input: AcomodacaoInput = {
      nome: v.nome,
      numero: v.numero,
      andar: v.andar,
      idtipo_acomodacao: v.idtipo_acomodacao,
      valor: v.valor,
      capacidade: v.capacidade,
      descricao: v.descricao || null,
      cor: v.cor || null,
      version: this.editando()?.version,
    };
    const editando = this.editando();
    const op = editando
      ? this.acomodacoesApi.atualizarAcomodacao(editando.id, input)
      : this.acomodacoesApi.criarAcomodacao(input);
    op.subscribe({
      next: (salva) => {
        const vagas = this.vagasSel();
        if (!editando && vagas.length > 0) {
          forkJoin(vagas.map((id) => this.estacionamentoApi.vincularVaga(id, salva.id))).subscribe({
            error: (e) => this.notify.erro(e),
          });
        }
        this.notify.ok(editando ? 'Acomodação atualizada.' : 'Acomodação cadastrada.');
        this.fecharDrawer();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirTipos(): void {
    this.modal.set('tipos');
  }

  criarTipo(): void {
    const nome = this.novoTipo.value?.trim();
    if (!nome) return;
    this.acomodacoesApi.criarTipo(nome).subscribe({
      next: (salvo) => {
        this.novoTipo.reset();
        this.tipos.update((l) => [...l, salvo].sort((a, b) => a.nome.localeCompare(b.nome)));
        this.notify.ok('Tipo criado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  editarTipo(t: TipoAcomodacao): void {
    this.editandoTipo.set(t.id);
    this.tipoNomeCtrl.setValue(t.nome);
  }

  // -- tarifa por ocupação -----------------------------------------------------

  toggleTarifas(t: TipoAcomodacao): void {
    if (this.tarifasTipo() === t.id) {
      this.tarifasTipo.set(null);
      return;
    }
    this.tarifasTipo.set(t.id);
    this.acomodacoesApi.tarifasOcupacao(t.id).subscribe({
      next: (lista) => {
        // Semente: faixas 1..3 sempre visíveis (spec), mescladas com o que já existe.
        const base = [1, 2, 3].map((h) => {
          const ex = lista.find((x) => x.hospedes === h);
          return { hospedes: h, valor: ex ? String(Number(ex.valor)) : '' };
        });
        const extras = lista
          .filter((x) => x.hospedes > 3)
          .map((x) => ({ hospedes: x.hospedes, valor: String(Number(x.valor)) }));
        this.faixas.set([...base, ...extras]);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  faixaCampo(i: number, campo: 'hospedes' | 'valor', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.faixas.update((f) =>
      f.map((x, j) => (j === i ? { ...x, [campo]: campo === 'hospedes' ? Number(v) : v } : x)),
    );
  }

  addFaixa(): void {
    const prox = Math.max(0, ...this.faixas().map((f) => f.hospedes)) + 1;
    this.faixas.update((f) => [...f, { hospedes: prox, valor: '' }]);
  }

  remFaixa(i: number): void {
    this.faixas.update((f) => f.filter((_, j) => j !== i));
  }

  salvarFaixas(t: TipoAcomodacao): void {
    const payload: TarifaOcupacaoInput[] = this.faixas()
      .filter((f) => f.valor !== '' && Number(f.valor) > 0)
      .map((f) => ({ hospedes: f.hospedes, valor: Number(f.valor) }));
    this.salvandoFaixas.set(true);
    this.acomodacoesApi.salvarTarifasOcupacao(t.id, payload).subscribe({
      next: () => {
        this.salvandoFaixas.set(false);
        this.notify.ok(`Faixas de ocupação de '${t.nome}' salvas.`);
      },
      error: (e) => {
        this.salvandoFaixas.set(false);
        this.notify.erro(e);
      },
    });
  }

  salvarTipo(t: TipoAcomodacao): void {
    const nome = this.tipoNomeCtrl.value?.trim();
    if (!nome) return;
    this.acomodacoesApi.atualizarTipo(t.id, nome, t.version).subscribe({
      next: (salvo) => {
        this.editandoTipo.set(null);
        this.tipos.update((l) => l.map((x) => (x.id === salvo.id ? salvo : x)));
        this.notify.ok('Tipo atualizado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusTipo(t: TipoAcomodacao, ativo: boolean): void {
    this.acomodacoesApi.statusTipo(t.id, ativo).subscribe({
      next: (salvo) => this.tipos.update((l) => l.map((x) => (x.id === salvo.id ? salvo : x))),
      error: (e) => this.notify.erro(e),
    });
  }

  statusAcomodacao(a: Acomodacao, ativo: boolean): void {
    this.acomodacoesApi.statusAcomodacao(a.id, ativo).subscribe({
      next: (salva) => {
        this.notify.ok(ativo ? 'Acomodação ativada.' : 'Acomodação desativada.');
        this.items.update((l) => l.map((x) => (x.id === salva.id ? salva : x)));
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirAcomodacao(a: Acomodacao): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a acomodação ${a.nome}? Quartos físicos, conteúdo do site e mídias serão apagados.`,
      { titulo: 'Excluir acomodação', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.excluirAcomodacao(a.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        if (this.selecionada()?.id === a.id) this.selecionada.set(null);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirTipo(t: TipoAcomodacao): Promise<void> {
    const ok = await this.confirm.perguntar(`Excluir o tipo de acomodação "${t.nome}"?`, {
      titulo: 'Excluir tipo',
      confirmar: 'Excluir',
    });
    if (!ok) return;
    this.acomodacoesApi.excluirTipo(t.id).subscribe({
      next: () => {
        this.notify.ok('Tipo excluído.');
        this.carregarTipos();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirQuarto(q: Quarto): Promise<void> {
    const ok = await this.confirm.perguntar(`Excluir o quarto ${q.numero}?`, {
      titulo: 'Excluir quarto',
      confirmar: 'Excluir',
    });
    if (!ok) return;
    this.acomodacoesApi.excluirQuarto(q.id).subscribe({
      next: () => {
        this.notify.ok('Quarto excluído.');
        const a = this.selecionada();
        if (a) this.visualizar(a);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirQuarto(): void {
    this.quartoNumero.reset();
    this.modal.set('quarto');
  }

  criarQuarto(): void {
    const a = this.selecionada();
    const numero = this.quartoNumero.value?.trim();
    if (!a || !numero) return;
    this.acomodacoesApi.criarQuarto(a.id, numero).subscribe({
      next: (salvo) => {
        this.fecharModal();
        this.quartos.update((l) => [...l, salvo].sort((x, y) => x.numero.localeCompare(y.numero)));
        this.notify.ok('Quarto cadastrado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusQuarto(q: Quarto, ativo: boolean): void {
    this.acomodacoesApi.statusQuarto(q.id, ativo).subscribe({
      next: (novo) => {
        this.quartos.update((list) => list.map((x) => (x.id === novo.id ? novo : x)));
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- tarifa por período (fds, feriados, alta temporada) ----------------------

  criarTarifaPeriodo(): void {
    const a = this.selecionada();
    if (!a || this.tarifaForm.invalid || this.salvandoTarifa()) return;
    const v = this.tarifaForm.getRawValue();
    if (v.fim < v.inicio) {
      this.notify.aviso('O fim do período não pode ser antes do início.');
      return;
    }
    const input: TarifaPeriodoInput = {
      inicio: v.inicio,
      fim: v.fim,
      valor: v.valor ?? 0,
      rotulo: v.rotulo.trim() || null,
      prioridade: v.prioridade,
    };
    this.salvandoTarifa.set(true);
    this.acomodacoesApi.criarTarifaPeriodo(a.id, input).subscribe({
      next: (t) => {
        this.salvandoTarifa.set(false);
        this.tarifaForm.reset({ inicio: '', fim: '', valor: null, rotulo: '', prioridade: 0 });
        this.tarifasPeriodo.update((l) =>
          [...l, t].sort((x, y) => x.inicio.localeCompare(y.inicio) || x.fim.localeCompare(y.fim)),
        );
        this.notify.ok('Tarifa de período cadastrada.');
      },
      error: (e) => {
        this.salvandoTarifa.set(false);
        this.notify.erro(e);
      },
    });
  }

  async excluirTarifaPeriodo(t: TarifaPeriodo): Promise<void> {
    const a = this.selecionada();
    if (!a) return;
    const ok = await this.confirm.perguntar(
      `Excluir a tarifa ${t.rotulo ?? 'de período'} (${t.inicio} → ${t.fim})? Reservas existentes mantêm o valor já fechado.`,
      { titulo: 'Excluir tarifa de período', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.acomodacoesApi.removerTarifaPeriodo(a.id, t.id).subscribe({
      next: () => {
        this.tarifasPeriodo.update((l) => l.filter((x) => x.id !== t.id));
        this.notify.ok('Tarifa de período excluída.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js) — abre até o drawer de cadastro. */
  iniciarTour(): void {
    this.tour.iniciar(
      [
        {
          popover: {
            title: 'Bem-vindo à tela de Acomodações!',
            description:
              'Este tour rápido mostra cada parte da tela. Avance com <b>Próximo</b> ' +
              'e feche a qualquer momento no ✕ ou pela tecla Esc.',
          },
        },
        {
          element: '#tour-busca',
          popover: {
            title: 'Busca rápida',
            description:
              'Filtre por <b>nome</b>, <b>número</b> ou <b>tipo</b> — a lista ' +
              'filtra sozinha enquanto digita.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativas',
          popover: {
            title: 'Somente ativas',
            description:
              'Ligado, a lista mostra apenas acomodações ativas. Desligado, ' +
              'aparecem todas — inclusive as inativas.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-tipos',
          popover: {
            title: 'Tipos de acomodação',
            description:
              'Aqui você cria e organiza os <b>tipos</b> (Suíte, Chalé, ' +
              'Apartamento…) usados no cadastro de cada acomodação.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-nova',
          popover: {
            title: 'Nova acomodação',
            description:
              'Clique aqui para cadastrar. Um painel abre à direita com o ' +
              'formulário — vou abrir para você ver!',
            side: 'bottom',
            onNextClick: () => {
              this.abrirForm();
              setTimeout(() => this.tour.avancar(), 420);
            },
          },
        },
        {
          element: '.drawer',
          popover: {
            title: 'Painel de cadastro',
            description:
              'Campos com <b>*</b> são obrigatórios. Você ainda escolhe a ' +
              '<b>cor do calendário</b> e pode vincular vagas de estacionamento ' +
              'livres. Conclua em <b>Cadastrar</b> no rodapé.',
            side: 'left',
            onNextClick: () => {
              this.fecharDrawer();
              setTimeout(() => this.tour.avancar(), 120);
            },
            onPrevClick: () => {
              this.fecharDrawer();
              this.tour.voltar();
            },
          },
        },
        {
          element: '#tour-tabela',
          popover: {
            title: 'Lista de acomodações',
            description:
              'Cada linha mostra a <b>cor do calendário</b>, nome, tipo, diária ' + 'e capacidade.',
            side: 'top',
          },
        },
        {
          element: 'tr.acm-row .acm-ver',
          skipMissingElement: true,
          popover: {
            title: 'Quartos físicos e tarifas',
            description:
              'O <b>olho</b> abre a janela da acomodação: cadastre quartos ' +
              'reais, ative/desative cada um e veja o histórico de tarifas.',
            side: 'left',
          },
        },
        {
          element: 'tr.acm-row .badge-toggle',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para mudar o status — <b>Ativo</b> aparece ' +
              'destacado, <b>Inativo</b> esmaecido. Acomodações inativas não ' +
              'aparecem para reserva.',
            side: 'top',
          },
        },
        {
          element: 'tr.acm-row .acm-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações da acomodação',
            description:
              '<b>Lápis</b> edita os dados · <b>olho</b> abre quartos e ' +
              'tarifas · <b>lixeira</b> exclui (apaga também quartos e fotos ' +
              'do site, sempre com confirmação).',
            side: 'left',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Acomodações. Para rever, clique em ' +
              '<b>Tutorial</b> no topo a qualquer momento.',
          },
        },
      ],
      () => {
        if (this.drawerAberto()) this.fecharDrawer();
      },
    );
  }
}
