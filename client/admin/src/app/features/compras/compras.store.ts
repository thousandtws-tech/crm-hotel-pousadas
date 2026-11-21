// Lógica e estado de compras — separada da camada de UI (compras.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, effect, inject, signal, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  Fornecedor,
  FornecedorInput,
  PedidoCompraView,
  PedidoItemView,
  RecebimentoItem,
} from '@core/models/compras.models';
import { ItemEstoque } from '@core/models/estoque.models';
import { ComprasApi } from '@core/api/compras.api';
import { EstoqueApi } from '@core/api/estoque.api';
import { GeoApi } from '@core/api/geo.api';
import { ConfirmService } from '../../core/services/confirm.service';
import { NotifyService } from '../../core/services/notify.service';
import { RealtimeService } from '../../core/services/realtime.service';

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

const STATUS_ICON: Record<string, string> = {
  pendente: 'schedule',
  parcial: 'hourglass_top',
  recebido: 'check_circle',
  cancelado: 'cancel',
};

interface LinhaPedido {
  readonly uid: number;
  iditem: number | null;
  quantidade: number;
  valor_unit: number | null;
}

/** "1123851939" -> "(11) 2385-1939" */
function formatarFoneCnpj(t: string): string {
  const d = t.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

@Directive()
export abstract class ComprasStore {
  private readonly comprasApi = inject(ComprasApi);
  private readonly estoqueApi = inject(EstoqueApi);
  private readonly geo = inject(GeoApi);
  private readonly nt = inject(NotifyService);
  private readonly rt = inject(RealtimeService);
  private readonly confirm = inject(ConfirmService);

  private uidSeq = 0;

  readonly aba = signal<'pedidos' | 'fornecedores'>('pedidos');
  readonly pedidos = signal<PedidoCompraView[]>([]);
  readonly fornecedores = signal<Fornecedor[]>([]);
  readonly itens = signal<ItemEstoque[]>([]);
  readonly detalhe = signal<PedidoCompraView | null>(null);
  readonly detalheItens = signal<PedidoItemView[]>([]);
  readonly novo = signal(false);
  readonly abrindoNovo = signal(false);
  readonly criando = signal(false);
  readonly salvandoForn = signal(false);
  readonly salvandoReceb = signal(false);
  readonly recebendo = signal(false);
  readonly fornSel = signal<number | null>(null);
  readonly geraPag = signal(true);
  readonly recebMap = signal<Record<number, number>>({});
  readonly filtro = signal('');
  readonly pagina = signal(1);
  readonly total = signal(0);
  readonly carregando = signal(false);
  readonly busca = signal('');
  readonly buscaForn = signal('');
  readonly contagens = signal<Record<string, number>>({});

  readonly criandoFornRapido = signal(false);
  readonly rapidoNome = signal('');
  readonly rapidoCnpj = signal('');
  readonly rapidoLead = signal(3);

  readonly TABS = [
    { v: '', rotulo: 'Todos' },
    { v: 'pendente', rotulo: 'Pendente' },
    { v: 'parcial', rotulo: 'Parcial' },
    { v: 'recebido', rotulo: 'Recebido' },
    { v: 'cancelado', rotulo: 'Cancelado' },
  ];

  readonly linhas = signal<LinhaPedido[]>([]);

  readonly fornForm = new FormGroup({
    id: new FormControl<number | null>(null),
    nome: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    cnpj: new FormControl('', { nonNullable: true }),
    contato: new FormControl('', { nonNullable: true }),
    telefone: new FormControl('', { nonNullable: true }),
    lead_time_dias: new FormControl(0, { nonNullable: true }),
  });

  protected readonly cnpjFornBuscando = signal(false);
  private ultimoCnpjForn = '';
  private ultimoCnpjRapido = '';
  private cnpjFornReq = 0;

  readonly pedForm = new FormGroup({
    idfornecedor: new FormControl<number | null>(null, { validators: [Validators.required] }),
    gerar_pagamento: new FormControl(true, { nonNullable: true }),
    vencimento: new FormControl('', { nonNullable: true }),
    observacao: new FormControl('', { nonNullable: true }),
  });

  readonly fornecedoresAtivos = computed(() => this.fornecedores().filter((f) => f.ativo));
  readonly fornecedorSelecionado = computed(() => {
    const id = this.fornSel();
    return id ? (this.fornecedores().find((f) => f.id === id) ?? null) : null;
  });
  readonly fornecedoresFiltrados = computed(() => {
    const b = this.buscaForn().trim().toLowerCase();
    if (!b) return this.fornecedores();
    return this.fornecedores().filter(
      (f) =>
        f.nome.toLowerCase().includes(b) ||
        (f.cnpj ?? '').toLowerCase().includes(b) ||
        (f.contato ?? '').toLowerCase().includes(b),
    );
  });
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 15)));
  readonly totalReceb = computed(() => Object.values(this.recebMap()).reduce((s, v) => s + v, 0));
  readonly pedidosFiltrados = computed(() => {
    const b = this.busca().trim().toLowerCase();
    if (!b) return this.pedidos();
    return this.pedidos().filter(
      (p) => String(p.id).includes(b) || p.fornecedor.toLowerCase().includes(b),
    );
  });
  readonly itensValidosCount = computed(
    () => this.linhas().filter((l) => l.iditem !== null && l.quantidade > 0).length,
  );
  readonly totalPrevisto = computed(() =>
    this.linhas().reduce((s, l) => s + l.quantidade * (l.valor_unit ?? 0), 0),
  );
  readonly podeCriar = computed(() => this.fornSel() !== null && this.itensValidosCount() > 0);
  readonly totalGeral = computed(() => this.contagens()[''] ?? this.total());
  readonly legendaPedidos = computed(() => {
    const n = this.totalGeral();
    return `${n} pedido${n === 1 ? '' : 's'} cadastrado${n === 1 ? '' : 's'}`;
  });

  constructor() {
    effect(() => {
      this.rt.delta('compra_pedido');
      this.rt.delta('fornecedor');
      void this.carregar();
      void this.carregarFornecedores();
    });
  }

  protected fecharModais(): void {
    if (this.novo()) this.novo.set(false);
    else if (this.detalhe()) this.fechar();
  }

  alternarAba(): void {
    this.aba.set(this.aba() === 'fornecedores' ? 'pedidos' : 'fornecedores');
  }

  irParaStatus(st: string): void {
    this.aba.set('pedidos');
    this.setFiltro(this.filtro() === st ? '' : st);
  }

  rotulo(s: string): string {
    return STATUS_LABEL[s] ?? s;
  }

  statusIcon(s: string): string {
    return STATUS_ICON[s] ?? 'help';
  }

  inp(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  pos(v: string | number | null | undefined): boolean {
    return Number(v) > 0;
  }

  numVal(v: string | number | null | undefined): number {
    return Number(v) || 0;
  }

  pendente(i: PedidoItemView): number {
    return Math.max(0, i.quantidade - i.quantidade_recebida);
  }

  pctPedido(p: PedidoCompraView): number {
    if (p.status === 'recebido') return 100;
    if (!p.total_itens) return 0;
    return Math.min(100, Math.round((p.recebido_itens / p.total_itens) * 100));
  }

  itemPorId(id: number | null): ItemEstoque | undefined {
    return id ? this.itens().find((x) => x.id === id) : undefined;
  }

  dataPrevistaEstimada(leadDias: number): string {
    const ms = Date.now() + Math.max(0, leadDias) * 86_400_000;
    return new Intl.DateTimeFormat('pt-BR').format(ms);
  }

  moeda(v: number | string | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value) || 0;
  }

  sincronizarFornecedor(): void {
    const val = this.pedForm.controls.idfornecedor.value;
    this.fornSel.set(typeof val === 'number' ? val : null);
  }

  adicionarLinha(): void {
    this.linhas.update((v) => [
      ...v,
      { uid: ++this.uidSeq, iditem: null, quantidade: 1, valor_unit: null },
    ]);
  }

  removerLinha(uid: number): void {
    this.linhas.update((v) => (v.length > 1 ? v.filter((x) => x.uid !== uid) : v));
  }

  selecionarItemLinha(uid: number, e: Event): void {
    const raw = (e.target as HTMLSelectElement).value;
    const iditem = raw === '' ? null : Number(raw);
    const est = this.itemPorId(iditem);
    const custoPadrao = est && Number(est.valor_unitario) > 0 ? Number(est.valor_unitario) : null;
    this.linhas.update((lista) =>
      lista.map((ln) =>
        ln.uid === uid ? { ...ln, iditem, valor_unit: ln.valor_unit ?? custoPadrao } : ln,
      ),
    );
  }

  atualizarQtdLinha(uid: number, e: Event): void {
    const quantidade = Math.max(1, this.num(e));
    this.linhas.update((lista) => lista.map((ln) => (ln.uid === uid ? { ...ln, quantidade } : ln)));
  }

  atualizarValorLinha(uid: number, e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    const valor_unit = raw === '' ? null : Math.max(0, Number(raw));
    this.linhas.update((lista) => lista.map((ln) => (ln.uid === uid ? { ...ln, valor_unit } : ln)));
  }

  setFiltro(s: string): void {
    this.filtro.set(s);
    this.pagina.set(1);
    void this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.listarPedidos({
          status: this.filtro() || undefined,
          pagina: this.pagina(),
        }),
      );
      this.pedidos.set(r.items);
      this.total.set(r.total);
      void this.carregarContagens();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.carregando.set(false);
    }
  }

  async carregarContagens(): Promise<void> {
    try {
      const sts = ['pendente', 'parcial', 'recebido', 'cancelado'];
      const rs = await Promise.all(
        sts.map((s) => firstValueFrom(this.comprasApi.listarPedidos({ status: s, pagina: 1 }))),
      );
      const m: Record<string, number> = { '': 0 };
      rs.forEach((r, i) => {
        m[sts[i]] = r.total;
        m[''] += r.total;
      });
      this.contagens.set(m);
    } catch {
      /* contagem é auxiliar */
    }
  }

  async carregarFornecedores(): Promise<void> {
    try {
      this.fornecedores.set(await firstValueFrom(this.comprasApi.listarFornecedores(false)));
    } catch (e) {
      this.nt.erro(e);
    }
  }

  async novoPedido(): Promise<void> {
    this.linhas.set([{ uid: ++this.uidSeq, iditem: null, quantidade: 1, valor_unit: null }]);
    this.geraPag.set(true);
    this.criandoFornRapido.set(false);
    const primeiroAtivo = this.fornecedoresAtivos()[0]?.id ?? null;
    this.fornSel.set(primeiroAtivo);
    this.pedForm.reset({
      idfornecedor: primeiroAtivo,
      gerar_pagamento: true,
      vencimento: '',
      observacao: '',
    });
    this.novo.set(true);
    this.abrindoNovo.set(true);
    try {
      const [it] = await Promise.all([
        this.itens().length
          ? Promise.resolve({ items: this.itens(), total: this.itens().length })
          : firstValueFrom(this.estoqueApi.listarItens(1, 500, true)),
        this.fornecedores().length ? Promise.resolve() : this.carregarFornecedores(),
      ]);
      this.itens.set(it.items);
      if (this.fornSel() === null && this.fornecedoresAtivos().length) {
        const id = this.fornecedoresAtivos()[0].id;
        this.fornSel.set(id);
        this.pedForm.controls.idfornecedor.setValue(id);
      }
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.abrindoNovo.set(false);
    }
  }

  async criarFornecedorRapido(): Promise<void> {
    const nome = this.rapidoNome().trim();
    if (!nome) return;
    this.salvandoForn.set(true);
    try {
      const f = await firstValueFrom(
        this.comprasApi.salvarFornecedor({
          nome,
          cnpj: this.rapidoCnpj().trim() || undefined,
          lead_time_dias: Math.max(0, this.rapidoLead()),
        }),
      );
      await this.carregarFornecedores();
      this.fornSel.set(f.id);
      this.pedForm.controls.idfornecedor.setValue(f.id);
      this.criandoFornRapido.set(false);
      this.rapidoNome.set('');
      this.rapidoCnpj.set('');
      this.nt.ok(`Fornecedor "${f.nome}" cadastrado e selecionado.`);
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoForn.set(false);
    }
  }

  async salvarFornecedor(): Promise<void> {
    const v = this.fornForm.getRawValue();
    const b: FornecedorInput = {
      nome: v.nome.trim(),
      cnpj: v.cnpj.trim() || undefined,
      contato: v.contato.trim() || undefined,
      telefone: v.telefone.trim() || undefined,
      lead_time_dias: v.lead_time_dias,
    };
    this.salvandoForn.set(true);
    try {
      await firstValueFrom(this.comprasApi.salvarFornecedor(b));
      this.nt.ok(v.id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      this.fornForm.reset({ lead_time_dias: 0 });
      await this.carregarFornecedores();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoForn.set(false);
    }
  }

  /** Mesma máscara/consulta do form completo — para o campo rápido (signal). */
  mascaraCnpjRapido(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 14);
    const v = d
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    this.rapidoCnpj.set(v);
    if (d.length === 14) this.buscarCnpjRapido(d);
    else this.ultimoCnpjRapido = '';
  }

  private buscarCnpjRapido(digitos: string): void {
    if (digitos === this.ultimoCnpjRapido) return;
    this.ultimoCnpjRapido = digitos;
    const req = ++this.cnpjFornReq;
    this.geo.buscarCnpj(digitos).subscribe({
      next: (r) => {
        if (req !== this.cnpjFornReq || !r?.cnpj) return;
        if (!this.rapidoNome().trim()) this.rapidoNome.set(r.nome_fantasia || r.razao_social || '');
      },
      error: () => {},
    });
  }

  /** Máscara 00.000.000/0000-00; CNPJ completo consulta a BrasilAPI. */
  mascaraCnpjForn(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 14);
    const v = d
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    this.fornForm.controls.cnpj.setValue(v, { emitEvent: false });
    if (d.length === 14) this.buscarCnpjForn(d);
    else this.ultimoCnpjForn = '';
  }

  /** CNPJ completo -> BrasilAPI preenche nome/telefone vazios; falhas ficam manuais. */
  private buscarCnpjForn(digitos: string): void {
    if (digitos === this.ultimoCnpjForn) return;
    this.ultimoCnpjForn = digitos;
    const req = ++this.cnpjFornReq;
    this.cnpjFornBuscando.set(true);
    this.geo.buscarCnpj(digitos).subscribe({
      next: (r) => {
        if (req !== this.cnpjFornReq) return;
        this.cnpjFornBuscando.set(false);
        if (!r?.cnpj) return;
        const f = this.fornForm.controls;
        if (!f.nome.value) f.nome.setValue(r.nome_fantasia || r.razao_social || '');
        if (!f.telefone.value && r.ddd_telefone_1)
          f.telefone.setValue(formatarFoneCnpj(r.ddd_telefone_1));
      },
      error: () => {
        if (req === this.cnpjFornReq) this.cnpjFornBuscando.set(false);
      },
    });
  }

  editarForn(f: Fornecedor): void {
    this.fornForm.setValue({
      id: f.id,
      nome: f.nome,
      cnpj: f.cnpj ?? '',
      contato: f.contato ?? '',
      telefone: f.telefone ?? '',
      lead_time_dias: f.lead_time_dias,
    });
  }

  async toggleForn(f: Fornecedor): Promise<void> {
    try {
      await firstValueFrom(this.comprasApi.statusFornecedor(f.id, !f.ativo));
      this.nt.ok(f.ativo ? 'Fornecedor desativado.' : 'Fornecedor reativado.');
      await this.carregarFornecedores();
    } catch (e) {
      this.nt.erro(e);
    }
  }

  async criarPedido(): Promise<void> {
    const v = this.pedForm.getRawValue();
    const itens = this.linhas().filter((l) => l.iditem !== null && l.quantidade > 0);
    const idforn = this.fornSel() ?? (typeof v.idfornecedor === 'number' ? v.idfornecedor : null);
    if (!itens.length || !idforn) return;
    this.criando.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.criarPedido({
          idfornecedor: idforn,
          itens: itens.map((l) => ({
            iditem: l.iditem!,
            quantidade: l.quantidade,
            valor_unit: l.valor_unit ?? undefined,
          })),
          gerar_pagamento: v.gerar_pagamento,
          vencimento: v.gerar_pagamento && v.vencimento ? v.vencimento : undefined,
          observacao: v.observacao.trim() || undefined,
          origem: 'manual',
        }),
      );
      this.nt.ok(`Pedido Nº ${r.pedido.id} criado — total R$ ${this.moeda(r.pedido.valor_total)}.`);
      this.novo.set(false);
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.criando.set(false);
    }
  }

  async abrir(p: PedidoCompraView): Promise<void> {
    try {
      const d = await firstValueFrom(this.comprasApi.buscarPedido(p.id));
      this.detalhe.set(d.pedido);
      this.detalheItens.set(d.itens);
      this.recebendo.set(false);
      this.recebMap.set({});
    } catch (e) {
      this.nt.erro(e);
    }
  }

  fechar(): void {
    this.detalhe.set(null);
    this.detalheItens.set([]);
    this.recebendo.set(false);
  }

  iniciarRecebimento(): void {
    this.receberTudo();
    this.recebendo.set(true);
  }

  setReceb(iditem: number, maxPend: number, e: Event): void {
    const v = Math.min(maxPend, Math.max(0, this.num(e)));
    this.recebMap.update((m) => ({ ...m, [iditem]: v }));
  }

  receberTudo(): void {
    const m: Record<number, number> = {};
    for (const i of this.detalheItens()) {
      const pend = this.pendente(i);
      if (pend > 0) m[i.iditem] = pend;
    }
    this.recebMap.set(m);
  }

  async receberTotalDireto(p: PedidoCompraView): Promise<void> {
    this.receberTudo();
    await this.confirmarRecebimento(p, 'Recebimento integral');
  }

  async confirmarRecebimento(p: PedidoCompraView, obs: string): Promise<void> {
    const itens: RecebimentoItem[] = Object.entries(this.recebMap())
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ iditem: Number(id), quantidade: q }));
    if (!itens.length) return;
    this.salvandoReceb.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.receberPedido(p.id, {
          itens,
          observacao: obs.trim() || undefined,
        }),
      );
      this.nt.ok(`Entrada registrada no estoque — pedido ${this.rotulo(r.status).toLowerCase()}.`);
      const d = await firstValueFrom(this.comprasApi.buscarPedido(p.id));
      this.detalhe.set(d.pedido);
      this.detalheItens.set(d.itens);
      this.recebendo.set(false);
      this.recebMap.set({});
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoReceb.set(false);
    }
  }

  async cancelar(p: PedidoCompraView): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Deseja cancelar o Pedido Nº ${p.id} de ${p.fornecedor}?`,
      {
        titulo: 'Cancelar pedido de compra',
        confirmar: 'Sim, cancelar pedido',
        cancelar: 'Voltar',
        detalhe: p.idlancamento
          ? `A conta a pagar Nº ${p.idlancamento} vinculada será estornada automaticamente.`
          : 'Esta ação não poderá ser desfeita.',
      },
    );
    if (!ok) return;
    try {
      const r = await firstValueFrom(this.comprasApi.cancelarPedido(p.id));
      this.nt.ok(r.mensagem ?? 'Pedido cancelado.');
      this.fechar();
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    }
  }
}
