// Lógica e estado de estoque — separada da camada de UI (estoque.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject, signal, computed, OnInit, effect, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { EstoqueApi } from '@core/api/estoque.api';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { num } from '@core/utils/num.utils';
import { Impressora } from '@core/models/estabelecimento.models';
import {
  CategoriaEstoque,
  ItemEstoque,
  ItemEstoqueInput,
  MovimentacaoInput,
  MovimentoView,
} from '@core/models/estoque.models';
import { NotifyService } from '@core/services/notify.service';
import { ConfirmService } from '@core/services/confirm.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TourService } from '@core/services/tour.service';

// -- página ---------------------------------------------------------------------------

@Directive()
export abstract class EstoqueStore implements OnInit {
  private readonly rt = inject(RealtimeService);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('estoque', 'movimento_estoque', 'categoria_estoque');
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
  private readonly estoqueApi = inject(EstoqueApi);
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly notify = inject(NotifyService);
  private readonly tour = inject(TourService);
  private readonly confirm = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);

  protected readonly modal = signal<'categorias' | null>(null);
  protected readonly drawerAberto = signal(false);
  protected readonly editandoItem = signal<ItemEstoque | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);
  protected readonly novaCategoria = new FormControl('', [Validators.required]);
  protected readonly formItem = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    idcategoria: [null as number | null],
    valor_unitario: [null as number | null],
    quantidade_inicial: [0],
    unidade: ['un'],
    estoque_minimo: [0],
    eh_insumo: [false],
  });

  protected readonly itens = signal<ItemEstoque[]>([]);
  protected readonly categorias = signal<CategoriaEstoque[]>([]);
  protected readonly impressoras = signal<Impressora[]>([]);
  protected readonly movimentos = signal<MovimentoView[]>([]);
  protected readonly entradaAdd = signal<Record<number, number>>({});
  protected readonly saidaAdd = signal<Record<number, number>>({});
  protected readonly saidaMotivo = signal<Record<number, string>>({});
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivos = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5];
  protected readonly UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'cx', 'pct', 'lata', 'fardo'];
  protected readonly num = num;

  /** Itens ativos sem saldo — selo dourado de alerta no cabeçalho. */
  protected readonly semEstoque = computed(
    () => this.itens().filter((i) => i.ativo && i.quantidade === 0).length,
  );

  /** Busca instantânea por nome do item ou da categoria. */
  private correspondeTermo(i: ItemEstoque): boolean {
    const q = this.termo();
    if (!q) return true;
    return (
      i.nome.toLowerCase().includes(q) ||
      this.categoriaNome(i.idcategoria).toLowerCase().includes(q)
    );
  }

  /** Aba Itens — aplica também o toggle "Somente ativos". */
  protected readonly filtrados = computed(() =>
    this.itens().filter((i) => (!this.apenasAtivos() || i.ativo) && this.correspondeTermo(i)),
  );
  /** Aba Entrada — só itens ativos que combinam com a busca. */
  protected readonly filtradosAtivos = computed(() =>
    this.itens().filter((i) => i.ativo && this.correspondeTermo(i)),
  );
  /** Aba Saída — só itens ativos com saldo que combinam com a busca. */
  protected readonly filtradosComSaldo = computed(() =>
    this.itens().filter((i) => i.ativo && i.quantidade > 0 && this.correspondeTermo(i)),
  );

  /** Resumo da entrada pendente: quantos itens e quantas unidades serão lançados. */
  protected readonly entradasPendentes = computed(() => {
    const qs = Object.values(this.entradaAdd()).filter((q) => q > 0);
    return { itens: qs.length, total: qs.reduce((a, b) => a + b, 0) };
  });

  /** Resumo da saída pendente. */
  protected readonly saidasPendentes = computed(() => {
    const qs = Object.values(this.saidaAdd()).filter((q) => q > 0);
    return { itens: qs.length, total: qs.reduce((a, b) => a + b, 0) };
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.estoqueApi.listarItens(1, 200).subscribe({
      next: (p) => {
        this.itens.set(p.items);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    this.estoqueApi.listarCategorias().subscribe({
      next: (c) => this.categorias.set(c),
      error: () => undefined,
    });
    this.impressorasApi.listarImpressoras().subscribe({
      next: (p) => this.impressoras.set(p),
      error: () => undefined,
    });
    this.estoqueApi.listarMovimentos(1, 50).subscribe({
      next: (p) => this.movimentos.set(p.items),
      error: () => undefined,
    });
  }

  categoriaNome(id: number | null): string {
    return this.categorias().find((c) => c.id === id)?.nome ?? 'Sem categoria';
  }

  setEntrada(id: number, e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.entradaAdd.update((m) => ({ ...m, [id]: v > 0 ? v : 0 }));
  }

  setSaida(id: number, e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.saidaAdd.update((m) => ({ ...m, [id]: v > 0 ? v : 0 }));
  }

  setMotivo(id: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.saidaMotivo.update((m) => ({ ...m, [id]: v }));
  }

  salvarEntrada(): void {
    const movs: MovimentacaoInput[] = Object.entries(this.entradaAdd())
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({
        iditem: Number(id),
        tipo: 'entrada' as const,
        quantidade: q,
        motivo: 'Entrada de estoque',
      }));
    if (!movs.length) {
      this.notify.erroMsg('Informe a quantidade a adicionar em ao menos um item.');
      return;
    }
    this.enviarMovimentos(movs, 'Entrada registrada.');
  }

  salvarSaida(): void {
    const motivos = this.saidaMotivo();
    const movs: MovimentacaoInput[] = Object.entries(this.saidaAdd())
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({
        iditem: Number(id),
        tipo: 'saida' as const,
        quantidade: q,
        motivo: motivos[Number(id)] || undefined,
      }));
    if (!movs.length) {
      this.notify.erroMsg('Informe a quantidade a retirar em ao menos um item.');
      return;
    }
    this.enviarMovimentos(movs, 'Saída registrada.');
  }

  private enviarMovimentos(movs: MovimentacaoInput[], msg: string): void {
    this.estoqueApi.movimentar(movs).subscribe({
      next: () => {
        this.notify.ok(msg);
        this.entradaAdd.set({});
        this.saidaAdd.set({});
        this.saidaMotivo.set({});
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  onEsc(): void {
    if (this.tour.ativo()) return;
    if (this.drawerAberto()) this.fecharDrawer();
    else if (this.modal()) this.fecharModal();
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editandoItem.set(null);
    document.body.style.overflow = '';
  }

  fecharModal(): void {
    this.modal.set(null);
  }

  invalido(ctrl: string): boolean {
    const c = this.formItem.get(ctrl);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  abrirItem(item?: ItemEstoque): void {
    this.editandoItem.set(item ?? null);
    this.tentouSalvar.set(false);
    if (item) {
      this.formItem.patchValue({
        nome: item.nome,
        idcategoria: item.idcategoria,
        valor_unitario: item.valor_unitario !== null ? Number(item.valor_unitario) : null,
        quantidade_inicial: 0,
        unidade: item.unidade || 'un',
        estoque_minimo: item.estoque_minimo || 0,
        eh_insumo: item.eh_insumo,
      });
    } else {
      this.formItem.reset({
        nome: '',
        idcategoria: null,
        valor_unitario: null,
        quantidade_inicial: 0,
        unidade: 'un',
        estoque_minimo: 0,
        eh_insumo: false,
      });
    }
    this.drawerAberto.set(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('it-nome')?.focus(), 260);
  }

  salvarItem(): void {
    if (this.formItem.invalid) {
      this.tentouSalvar.set(true);
      this.notify.aviso('Revise os campos destacados.');
      setTimeout(
        () => document.querySelector('.drawer .inval')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.formItem.getRawValue();
    const input: ItemEstoqueInput = {
      nome: v.nome,
      idcategoria: v.idcategoria,
      valor_unitario: v.valor_unitario,
      quantidade_inicial: v.quantidade_inicial || undefined,
      unidade: v.unidade || 'un',
      estoque_minimo: v.estoque_minimo || 0,
      eh_insumo: v.eh_insumo,
      version: this.editandoItem()?.version,
    };
    const item = this.editandoItem();
    const op = item
      ? this.estoqueApi.atualizarItem(item.id, input)
      : this.estoqueApi.criarItem(input);
    op.subscribe({
      next: () => {
        this.notify.ok(item ? 'Item atualizado.' : 'Item cadastrado.');
        this.fecharDrawer();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirCategorias(): void {
    this.modal.set('categorias');
  }

  criarCategoriaModal(): void {
    const nome = this.novaCategoria.value?.trim();
    if (!nome) return;
    this.estoqueApi.criarCategoria(nome).subscribe({
      next: () => {
        this.novaCategoria.reset();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Roteamento KOT — envia tickets de produção da categoria à impressora. */
  rotearCategoria(c: CategoriaEstoque, impressoraId: number | null): void {
    this.estoqueApi.rotaCategoria(c.id, impressoraId).subscribe({
      next: () => {
        this.carregar();
        this.notify.ok(impressoraId ? 'Categoria roteada.' : 'Roteamento removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusItem(i: ItemEstoque, ativo: boolean): void {
    this.estoqueApi.statusItem(i.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  imprimirEtiqueta(i: ItemEstoque): void {
    this.impressorasApi.etiquetaItem(i.id).subscribe({
      next: () => this.notify.ok(`Etiqueta de "${i.nome}" enviada.`),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirItem(i: ItemEstoque): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o item ${i.nome}? Todo o histórico de movimentações será apagado.`,
      { titulo: 'Excluir item', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.estoqueApi.excluirItem(i.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusCategoria(c: CategoriaEstoque, ativo: boolean): void {
    this.estoqueApi.statusCategoria(c.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirCategoria(c: CategoriaEstoque): Promise<void> {
    const ok = await this.confirm.perguntar(`Excluir a categoria ${c.nome}?`, {
      titulo: 'Excluir categoria',
      confirmar: 'Excluir',
    });
    if (!ok) return;
    this.estoqueApi.excluirCategoria(c.id).subscribe({
      next: () => {
        this.notify.ok('Categoria excluída.');
        this.carregar();
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
            title: 'Bem-vindo à tela de Estoque!',
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
              'Filtre por <b>nome do item</b> ou <b>categoria</b> — vale para a ' +
              'lista e também para as abas de Entrada e Saída.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativos',
          popover: {
            title: 'Somente ativos',
            description:
              'Ligado, a aba Itens mostra apenas itens ativos. Desligado, ' + 'aparecem todos.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-categorias',
          popover: {
            title: 'Categorias e impressoras',
            description:
              'Aqui você cria as <b>categorias</b> e escolhe para qual ' +
              '<b>impressora</b> sai o ticket de produção de cada uma.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-novo',
          popover: {
            title: 'Novo item',
            description:
              'Clique aqui para cadastrar um produto. Um painel abre à direita ' +
              '— vou abrir para você ver!',
            side: 'bottom',
            onNextClick: () => {
              this.abrirItem();
              setTimeout(() => this.tour.avancar(), 420);
            },
          },
        },
        {
          element: '.drawer',
          popover: {
            title: 'Painel de cadastro',
            description:
              'Informe o <b>nome</b>, a categoria, o valor unitário e a ' +
              'quantidade inicial. Conclua em <b>Cadastrar item</b> no rodapé.',
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
          element: '#tour-abas',
          popover: {
            title: 'Abas de trabalho',
            description:
              '<b>Itens</b> lista tudo · <b>Entrada</b> soma ao estoque · ' +
              '<b>Saída</b> retira com motivo · <b>Movimentações</b> mostra o histórico.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-tabela',
          popover: {
            title: 'Lista de itens',
            description:
              'Cada linha mostra nome, categoria, quantidade (o selo ' +
              '<b>sem estoque</b> avisa quando zera), preço e status.',
            side: 'top',
          },
        },
        {
          element: 'tr.est-row .st-chip',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para mudar o status entre <b>Ativo</b> e ' +
              '<b>Inativo</b>. Itens inativos somem das Entradas e Saídas.',
            side: 'top',
          },
        },
        {
          element: 'tr.est-row .est-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações do item',
            description:
              '<b>Etiqueta</b> imprime a etiqueta · <b>lápis</b> edita os dados · ' +
              '<b>lixeira</b> exclui o item — sempre com confirmação.',
            side: 'left',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Estoque. Para rever, clique em ' +
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
