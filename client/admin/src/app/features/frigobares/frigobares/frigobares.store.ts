// Lógica e estado de frigobares — separada da camada de UI (frigobares.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { EstoqueApi } from '@core/api/estoque.api';
import { FrigobaresApi } from '@core/api/frigobares.api';
import { num } from '@core/utils/num';
import { Acomodacao } from '@core/models/catalogo.models';
import { CategoriaEstoque, ItemEstoque } from '@core/models/estoque.models';
import { Frigobar, ItemFrigobarView } from '@core/models/frigobares.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourGuiado } from '@core/services/tour.service';

@Directive()
export abstract class FrigobaresStore implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('frigobar', 'item_frigobar');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        const d = this.detalhe();
        if (d) this.carregarItens(d.id);
      }
    });
    this.busca.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((v) => this.termo.set(v.trim().toLowerCase()));
  }

  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly estoqueApi = inject(EstoqueApi);
  private readonly frigobaresApi = inject(FrigobaresApi);
  private readonly notify = inject(Notify);
  private readonly tour = inject(TourGuiado);
  private readonly confirm = inject(Confirm);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthStore);

  protected readonly frigobares = signal<Frigobar[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly categorias = signal<CategoriaEstoque[]>([]);
  protected readonly itensEstoque = signal<ItemEstoque[]>([]);
  protected readonly itens = signal<ItemFrigobarView[]>([]);
  protected readonly detalhe = signal<Frigobar | null>(null);
  protected readonly carregando = signal(true);
  protected readonly busca = new FormControl('', { nonNullable: true });
  /** Termo da busca já normalizado — alimenta o filtro instantâneo. */
  protected readonly termo = signal('');
  protected readonly buscaFoco = signal(false);
  protected readonly apenasAtivos = signal(false);
  /** Linhas fantasma exibidas enquanto a lista carrega. */
  protected readonly skel = [1, 2, 3, 4, 5];
  protected readonly num = num;

  // drawer criar/editar
  protected readonly drawerAberto = signal(false);
  protected readonly editando = signal<Frigobar | null>(null);
  /** Marca a 1ª tentativa de salvar — exibe os erros inline daí em diante. */
  protected readonly tentouSalvar = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    modelo: [''],
    patrimonio: [''],
    idacomodacao: [null as number | null, Validators.required],
  });

  // adicionar item (modal de detalhe)
  protected readonly categoriaSel = signal<number | ''>('');
  protected readonly itemSel = signal<number | null>(null);
  protected readonly qtdSel = signal(1);

  protected readonly itensDaCategoria = computed(() =>
    this.itensEstoque().filter(
      (i) => i.ativo && (!this.categoriaSel() || i.idcategoria === this.categoriaSel()),
    ),
  );

  /** Acomodações oferecidas no drawer — ativas + a já vinculada na edição. */
  protected readonly acomodacoesSel = computed(() => {
    const atual = this.editando()?.idacomodacao;
    return this.acomodacoes().filter((a) => a.ativo || a.id === atual);
  });

  /** Frigobares ativos — selo dourado do cabeçalho. */
  protected readonly ativos = computed(() => this.frigobares().filter((f) => f.ativo).length);

  /** Filtro instantâneo: modelo, patrimônio ou acomodação (nome/número). */
  protected readonly filtrados = computed(() => {
    const q = this.termo();
    return this.frigobares().filter((f) => {
      if (this.apenasAtivos() && !f.ativo) return false;
      if (!q) return true;
      return (
        (f.modelo ?? '').toLowerCase().includes(q) ||
        (f.patrimonio ?? '').toLowerCase().includes(q) ||
        String(f.id).includes(q) ||
        this.nomeAcomodacao(f.idacomodacao).toLowerCase().includes(q) ||
        this.numAcomodacao(f.idacomodacao).includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.carregar();
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
    this.estoqueApi.listarItens(1, 200, true).subscribe({
      next: (p) => this.itensEstoque.set(p.items),
      error: () => undefined,
    });
    this.estoqueApi.listarCategorias().subscribe({
      next: (c) => this.categorias.set(c.filter((x) => x.ativo)),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.frigobaresApi.listarFrigobares().subscribe({
      next: (f) => {
        this.frigobares.set(f);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  nomeAcomodacao(id: number): string {
    return this.acomodacoes().find((a) => a.id === id)?.nome ?? `#${id}`;
  }

  numAcomodacao(id: number): string {
    const a = this.acomodacoes().find((x) => x.id === id);
    return a ? String(a.numero) : '';
  }

  categoriaDeItem(iditem: number): string {
    const item = this.itensEstoque().find((i) => i.id === iditem);
    return this.categorias().find((c) => c.id === item?.idcategoria)?.nome ?? '—';
  }

  totalItens(): number {
    return this.itens().reduce((s, i) => s + i.quantidade, 0);
  }

  numeroDe(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  onEsc(): void {
    if (this.tour.ativo()) return;
    if (this.detalhe()) this.fecharDetalhe();
    else if (this.drawerAberto()) this.fecharDrawer();
  }

  // ---- lista / drawer --------------------------------------------------------

  abrirForm(f?: Frigobar): void {
    this.editando.set(f ?? null);
    this.tentouSalvar.set(false);
    if (f) {
      this.form.patchValue({
        modelo: f.modelo ?? '',
        patrimonio: f.patrimonio ?? '',
        idacomodacao: f.idacomodacao,
      });
    } else {
      this.form.reset({ modelo: '', patrimonio: '', idacomodacao: null });
    }
    this.drawerAberto.set(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('fr-modelo')?.focus(), 260);
  }

  fecharDrawer(): void {
    this.drawerAberto.set(false);
    this.editando.set(null);
    document.body.style.overflow = '';
  }

  invalido(ctrl: string): boolean {
    const c = this.form.get(ctrl);
    return !!c && c.invalid && (c.touched || this.tentouSalvar());
  }

  salvar(): void {
    if (this.form.invalid) {
      this.tentouSalvar.set(true);
      this.notify.aviso('Revise os campos destacados.');
      setTimeout(
        () => document.querySelector('.drawer .campo-mat.err')?.scrollIntoView({ block: 'center' }),
        60,
      );
      return;
    }
    const v = this.form.getRawValue();
    const editando = this.editando();
    const input = {
      modelo: v.modelo || null,
      patrimonio: v.patrimonio || null,
      idacomodacao: v.idacomodacao!,
      version: editando?.version,
    };
    const op = editando
      ? this.frigobaresApi.atualizarFrigobar(editando.id, input)
      : this.frigobaresApi.criarFrigobar(input);
    op.subscribe({
      next: () => {
        this.notify.ok(editando ? 'Frigobar atualizado.' : 'Frigobar cadastrado.');
        this.fecharDrawer();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusFrigobar(f: Frigobar, ativo: boolean): void {
    this.frigobaresApi.statusFrigobar(f.id, ativo).subscribe({
      next: () => {
        this.notify.ok(ativo ? 'Frigobar ativado.' : 'Frigobar desativado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluirFrigobar(f: Frigobar): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o frigobar Nº${f.id}${f.modelo ? ' (' + f.modelo + ')' : ''}? Todos os itens associados serão removidos.`,
      { titulo: 'Excluir frigobar', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.frigobaresApi.excluirFrigobar(f.id).subscribe({
      next: (r) => {
        this.notify.ok(r.mensagem);
        if (this.detalhe()?.id === f.id) this.fecharDetalhe();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // ---- detalhe (modal) --------------------------------------------------------

  ver(f: Frigobar): void {
    this.detalhe.set(f);
    this.carregarItens(f.id);
    this.categoriaSel.set('');
    this.itemSel.set(null);
    this.qtdSel.set(1);
  }

  fecharDetalhe(): void {
    this.detalhe.set(null);
  }

  carregarItens(idfrigobar: number): void {
    this.frigobaresApi.itensFrigobar(idfrigobar).subscribe({
      next: (i) => this.itens.set(i),
      error: () => undefined,
    });
  }

  repor(idfrigobar: number): void {
    const iditem = this.itemSel();
    const quantidade = this.qtdSel();
    if (!iditem || quantidade < 1) return;
    this.frigobaresApi.reporItemFrigobar(idfrigobar, iditem, quantidade).subscribe({
      next: () => {
        this.notify.ok('Item adicionado.');
        this.itemSel.set(null);
        this.qtdSel.set(1);
        this.carregarItens(idfrigobar);
        this.estoqueApi.listarItens(1, 200, true).subscribe({
          next: (p) => this.itensEstoque.set(p.items),
          error: () => undefined,
        });
      },
      error: (e) => this.notify.erro(e),
    });
  }

  ajustar(i: ItemFrigobarView, delta: number): void {
    const qtd = i.quantidade + delta;
    if (qtd < 0) return;
    this.frigobaresApi.atualizarItemFrigobar(i.id, qtd, i.version).subscribe({
      next: () => this.carregarItens(i.idfrigobar),
      error: (e) => this.notify.erro(e),
    });
  }

  statusItem(i: ItemFrigobarView, ativo: boolean): void {
    this.frigobaresApi.statusItemFrigobar(i.id, ativo).subscribe({
      next: () => this.carregarItens(i.idfrigobar),
      error: (e) => this.notify.erro(e),
    });
  }

  async removerItem(i: ItemFrigobarView): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover "${i.item_nome}" do frigobar?`, {
      titulo: 'Remover item',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.frigobaresApi.removerItemFrigobar(i.id).subscribe({
      next: () => this.carregarItens(i.idfrigobar),
      error: (e) => this.notify.erro(e),
    });
  }

  /** Tour guiado da tela (driver.js) — abre até o drawer de cadastro. */
  iniciarTour(): void {
    this.tour.iniciar(
      [
        {
          popover: {
            title: 'Bem-vindo à tela de Frigobares!',
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
              'Filtre por <b>modelo</b>, <b>patrimônio</b> ou <b>acomodação</b> — ' +
              'a lista filtra sozinha enquanto digita.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-ativos',
          popover: {
            title: 'Somente ativos',
            description:
              'Ligado, a lista mostra apenas frigobares ativos. Desligado, ' +
              'aparecem todos — inclusive os inativos.',
            side: 'bottom',
          },
        },
        {
          element: '#tour-novo',
          popover: {
            title: 'Novo frigobar',
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
              'Informe <b>modelo</b> e <b>patrimônio</b> (opcionais) e escolha a ' +
              '<b>acomodação</b> — a única obrigatória. Conclua em ' +
              '<b>Cadastrar</b> no rodapé.',
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
            title: 'Lista de frigobares',
            description:
              'Cada linha mostra o modelo, o patrimônio e a acomodação onde o ' +
              'frigobar está instalado.',
            side: 'top',
          },
        },
        {
          element: 'tr.fr-row .fr-ver',
          skipMissingElement: true,
          popover: {
            title: 'Itens e reposição',
            description:
              'O <b>ícone de olho</b> abre o frigobar: veja os itens, ajuste ' +
              'quantidades com <b>−</b>/<b>+</b> e reponha produtos — a baixa ' +
              'sai do estoque na hora.',
            side: 'left',
          },
        },
        {
          element: 'tr.fr-row .st-chip',
          skipMissingElement: true,
          popover: {
            title: 'Ativar / desativar',
            description:
              'Clique no selo para mudar o status entre <b>Ativo</b> e ' +
              '<b>Inativo</b>. Frigobares inativos ficam fora de uso.',
            side: 'top',
          },
        },
        {
          element: 'tr.fr-row .fr-acoes',
          skipMissingElement: true,
          popover: {
            title: 'Ações do frigobar',
            description:
              '<b>Lápis</b> edita os dados · <b>olho</b> abre os itens · ' +
              '<b>lixeira</b> exclui (remove também os itens, sempre com confirmação).',
            side: 'left',
          },
        },
        {
          popover: {
            title: 'Pronto!',
            description:
              'Você já conhece a tela de Frigobares. Para rever, clique em ' +
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
