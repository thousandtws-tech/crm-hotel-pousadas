// Lógica e estado de pdv — separada da camada de UI (pdv.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, effect, ElementRef, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { PdvApi } from '@core/api/pdv.api';
import { num } from '@core/utils/num.utils';
import { Page } from '@core/models/comum.models';
import { ContaFinanceira } from '@core/models/financeiro.models';
import { Funcionario } from '@core/models/funcionarios.models';
import { FormaPagamento } from '@core/models/pagamentos.models';
import {
  ComandaItemView,
  ComandaView,
  ComissaoResumo,
  ComissaoView,
  GarcomView,
  ItemVendaView,
  MesaView,
} from '@core/models/pdv.models';
import { ReservaResumo } from '@core/models/reservas.models';
import { NotifyService } from '@core/services/notify.service';
import type { Signal } from '@angular/core';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

type Aba = 'mesas' | 'comandas' | 'garcons';

/** Rótulo humano da comanda — mesa, quarto ou balcão. */
function rotuloComanda(c: ComandaView): string {
  if (c.tipo === 'mesa') return `Mesa ${c.mesa_numero ?? '?'}`;
  if (c.tipo === 'quarto') return `Quarto ${c.quarto_numero ?? '?'}`;
  return c.rotulo ?? 'Balcão';
}

@Directive()
export abstract class PdvStore implements OnInit {
  declare protected readonly modalVoltar: Signal<ElementRef<HTMLButtonElement> | undefined>;
  private readonly comunicacaoApi = inject(ComunicacaoApi);
  private readonly pdvApi = inject(PdvApi);
  private readonly notify = inject(NotifyService);

  readonly num = num;
  readonly fmt = fmt;
  readonly rotulo = rotuloComanda;

  rotuloItem(status: string): string {
    return status === 'em_preparo' ? 'em preparo' : status;
  }

  readonly abas: { id: Aba; rotulo: string; icone: string }[] = [
    { id: 'mesas', rotulo: 'Mesas', icone: 'grid_view' },
    { id: 'comandas', rotulo: 'Comandas', icone: 'assignment' },
    { id: 'garcons', rotulo: 'Garçons & Comissões', icone: 'group' },
  ];
  readonly tipos = [
    { id: 'mesa' as const, rotulo: 'Mesa', icone: 'table_restaurant' },
    { id: 'quarto' as const, rotulo: 'Quarto', icone: 'hotel' },
    { id: 'balcao' as const, rotulo: 'Balcão', icone: 'storefront' },
  ];

  readonly aba = signal<Aba>('mesas');
  readonly salvando = signal(false);

  /* workspace (aba mesas) */
  readonly tiposAtend = [
    { id: 'mesa' as const, rotulo: 'Mesas' },
    { id: 'quarto' as const, rotulo: 'Quartos' },
    { id: 'balcao' as const, rotulo: 'Balcão' },
  ];
  readonly tipoAtend = signal<'mesa' | 'quarto' | 'balcao'>('mesa');
  readonly buscaAtend = signal('');
  readonly buscaProd = signal('');
  readonly filtroLista = signal<'todas' | 'livre' | 'ocupada'>('todas');
  readonly catProd = signal<string | null>(null);
  readonly comandasAbertas = signal<ComandaView[]>([]);
  readonly selecao = signal<{
    tipo: 'mesa' | 'quarto' | 'balcao';
    id: number | null;
    rotulo: string;
  } | null>(null);

  readonly mesas = signal<MesaView[]>([]);
  readonly comandas = signal<ComandaView[]>([]);
  readonly comanda = signal<ComandaView | null>(null);
  readonly itens = signal<ComandaItemView[]>([]);
  readonly itensVenda = signal<ItemVendaView[]>([]);
  readonly garcons = signal<GarcomView[]>([]);
  readonly funcionarios = signal<Funcionario[]>([]);
  readonly reservasEstadia = signal<ReservaResumo[]>([]);
  readonly contas = signal<ContaFinanceira[]>([]);
  readonly formas = signal<FormaPagamento[]>([]);
  readonly comissoes = signal<ComissaoView[]>([]);
  readonly resumoComissoes = signal<ComissaoResumo[]>([]);

  readonly POR_PAGINA = 15;
  readonly novaMesa = signal(false);
  readonly abrindo = signal(false);
  readonly fechando = signal(false);
  readonly modo = signal<'pagar' | 'faturar'>('pagar');
  readonly pagando = signal<number | null>(null);
  readonly cancelando = signal<'item' | 'comanda' | null>(null);
  readonly cancelandoItem = signal<number | null>(null);
  readonly comandasPage = signal(1);
  readonly comandasTotal = signal(0);
  readonly comissoesPage = signal(1);
  readonly comissoesTotal = signal(0);

  readonly mesasAtivas = computed(() => this.mesas().filter((m) => m.ativo));
  readonly mesasInativas = computed(() => this.mesas().filter((m) => !m.ativo));
  readonly comandasTotalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.comandasTotal() / this.POR_PAGINA)),
  );
  readonly comissoesTotalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.comissoesTotal() / this.POR_PAGINA)),
  );

  readonly mesasLivres = computed(() => this.mesasAtivas().filter((m) => m.idcomanda === null));
  readonly garconsAtivos = computed(() => this.garcons().filter((g) => g.ativo));

  /* workspace — listas filtradas */
  private readonly qAtend = () => this.buscaAtend().trim().toLowerCase();
  readonly mesasVisiveis = computed(() => {
    const q = this.qAtend();
    const f = this.filtroLista();
    return this.mesasAtivas().filter((m) => {
      if (f === 'livre' && m.idcomanda !== null) return false;
      if (f === 'ocupada' && m.idcomanda === null) return false;
      return !q || String(m.numero).toLowerCase().includes(q);
    });
  });
  readonly quartosVisiveis = computed(() => {
    const q = this.qAtend();
    const f = this.filtroLista();
    return this.reservasEstadia().filter((r) => {
      const com = this.comandaDoQuarto(r.quarto_numero);
      if (f === 'livre' && com) return false;
      if (f === 'ocupada' && !com) return false;
      return (
        !q ||
        String(r.quarto_numero).toLowerCase().includes(q) ||
        (r.cliente_nome ?? '').toLowerCase().includes(q)
      );
    });
  });
  readonly balcaoVisiveis = computed(() => {
    const q = this.qAtend();
    return this.comandasAbertas().filter(
      (c) => c.tipo === 'balcao' && (!q || (c.rotulo ?? 'balcão').toLowerCase().includes(q)),
    );
  });
  readonly categorias = computed(() => {
    const set = new Set<string>();
    for (const i of this.itensVenda()) if (i.categoria_nome) set.add(i.categoria_nome);
    return [...set].sort();
  });
  readonly itensFiltrados = computed(() => {
    const cat = this.catProd();
    const q = this.buscaProd().trim().toLowerCase();
    return this.itensVenda().filter(
      (i) => (!cat || i.categoria_nome === cat) && (!q || i.nome.toLowerCase().includes(q)),
    );
  });

  readonly mesaForm = new FormGroup({
    numero: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lugares: new FormControl(4, { nonNullable: true, validators: [Validators.min(1)] }),
  });
  readonly abrirForm = new FormGroup({
    tipo: new FormControl<'mesa' | 'quarto' | 'balcao'>('balcao', { nonNullable: true }),
    idmesa: new FormControl<number | null>(null),
    idquarto: new FormControl<number | null>(null),
    idgarcom: new FormControl<number | null>(null),
    rotulo: new FormControl('', { nonNullable: true }),
  });
  readonly fecharForm = new FormGroup({
    idconta_financeira: new FormControl<number | null>(null),
    idforma_pagamento: new FormControl<number | null>(null),
    desconto: new FormControl<number | null>(null),
  });
  readonly garcomForm = new FormGroup({
    idfuncionario: new FormControl<number | null>(null, { validators: [Validators.required] }),
    percentual: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
  });
  readonly pagarForm = new FormGroup({
    idconta_financeira: new FormControl<number | null>(null, { validators: [Validators.required] }),
    idforma_pagamento: new FormControl<number | null>(null),
  });
  readonly filtroStatus = new FormControl<string | null>('aberta');
  readonly cancelForm = new FormGroup({
    motivo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Foco inicial ao abrir fechamento/cancelamento — padrão do ConfirmDialog. */

  constructor() {
    effect(() => {
      if (this.fechando() || this.cancelando()) {
        this.modalVoltar()?.nativeElement.focus();
      }
    });
  }

  ngOnInit(): void {
    // Boot consolidado — 9 leituras em 1 request. Refreshes pós-ação
    // continuam nas chamadas direcionadas (carregarComandas & cia).
    this.pdvApi
      .painelPdv({
        status: this.filtroStatus.value,
        page: 1,
        porPagina: this.POR_PAGINA,
      })
      .subscribe({
        next: (p) => {
          this.mesas.set(p.mesas);
          this.comandas.set(p.comandas.items);
          this.comandasTotal.set(p.comandas.total);
          this.comandasAbertas.set(p.comandas_abertas);
          this.garcons.set(p.garcons);
          this.itensVenda.set(p.itens_venda);
          this.contas.set(p.contas.filter((x) => x.ativo));
          this.formas.set(p.formas.filter((x) => x.ativo));
          this.funcionarios.set(p.funcionarios);
          this.reservasEstadia.set(p.reservas_estadia.filter((r) => r.idquarto !== null));
        },
        error: () => this.notify.erro('Falha ao carregar o PDV.'),
      });
    this.filtroStatus.valueChanges.subscribe(() => {
      this.comandasPage.set(1);
      this.carregarComandas();
    });
  }

  mudarAba(a: Aba): void {
    this.aba.set(a);
    if (a === 'comandas') this.carregarComandas();
    if (a === 'garcons') this.carregarComissoes();
  }

  carregarMesas(): void {
    this.pdvApi.listarMesas().subscribe({
      next: (m) => this.mesas.set(m),
      error: () => this.notify.erro('Falha ao carregar mesas.'),
    });
  }

  carregarComandas(): void {
    this.pdvApi
      .listarComandas({
        status: this.filtroStatus.value,
        page: this.comandasPage(),
        porPagina: this.POR_PAGINA,
      })
      .subscribe({
        next: (p) => {
          this.comandas.set(p.items);
          this.comandasTotal.set(p.total);
        },
        error: () => this.notify.erro('Falha ao carregar comandas.'),
      });
  }

  paginarComandas(p: number): void {
    this.comandasPage.set(p);
    this.carregarComandas();
  }

  paginarComissoes(p: number): void {
    this.comissoesPage.set(p);
    this.carregarComissoes();
  }

  carregarGarcons(): void {
    this.pdvApi.listarGarcons().subscribe({
      next: (g) => this.garcons.set(g),
      error: () => {},
    });
  }

  carregarComissoes(): void {
    this.comunicacaoApi
      .listarComissoes({ page: this.comissoesPage(), porPagina: this.POR_PAGINA })
      .subscribe({
        next: (p) => {
          this.comissoes.set(p.items);
          this.comissoesTotal.set(p.total);
        },
        error: () => this.notify.erro('Falha ao carregar comissões.'),
      });
    this.pdvApi.resumoComissoes().subscribe({
      next: (r) => this.resumoComissoes.set(r),
      error: () => {},
    });
  }

  // -------------------------------------------------------------------- mesas

  criarMesa(): void {
    const v = this.mesaForm.getRawValue();
    this.pdvApi.criarMesa(v.numero.trim(), v.lugares).subscribe({
      next: () => {
        this.notify.ok('Mesa criada.');
        this.mesaForm.reset({ numero: '', lugares: 4 });
        this.novaMesa.set(false);
        this.carregarMesas();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao criar mesa.'),
    });
  }

  clicarMesa(m: MesaView): void {
    if (m.idcomanda !== null) {
      this.abrirDetalhe(m.idcomanda);
      return;
    }
    // mesa livre → abertura rápida na coluna de atendimentos
    this.selecao.set({ tipo: 'mesa', id: m.id, rotulo: String(m.numero) });
    this.abrirForm.patchValue({ tipo: 'mesa', idmesa: m.id, idquarto: null, rotulo: '' });
  }

  clicarQuarto(r: ReservaResumo): void {
    const aberta = this.comandaDoQuarto(r.quarto_numero);
    if (aberta) {
      this.abrirDetalhe(aberta.id);
      return;
    }
    this.selecao.set({ tipo: 'quarto', id: r.idquarto, rotulo: String(r.quarto_numero) });
    this.abrirForm.patchValue({ tipo: 'quarto', idquarto: r.idquarto, idmesa: null, rotulo: '' });
  }

  comandaDoQuarto(quartoNumero: string | null | undefined): ComandaView | undefined {
    return this.comandasAbertas().find(
      (c) => c.tipo === 'quarto' && String(c.quarto_numero) === String(quartoNumero),
    );
  }

  novoBalcao(): void {
    this.selecao.set({ tipo: 'balcao', id: null, rotulo: '' });
    this.abrirForm.patchValue({ tipo: 'balcao', idmesa: null, idquarto: null, rotulo: '' });
  }

  limparSelecao(): void {
    this.selecao.set(null);
    this.abrirForm.reset({
      tipo: 'balcao',
      idmesa: null,
      idquarto: null,
      idgarcom: null,
      rotulo: '',
    });
  }

  selecionada(idcomanda: number | null, idmesa: number): boolean {
    const sel = this.selecao();
    if (sel?.tipo === 'mesa' && sel.id === idmesa) return true;
    const com = this.comanda();
    return com !== null && idcomanda !== null && com.id === idcomanda;
  }

  eyebrowComanda(c: ComandaView): string {
    return c.tipo === 'mesa'
      ? 'Comanda da mesa'
      : c.tipo === 'quarto'
        ? 'Comanda do quarto'
        : 'Comanda do balcão';
  }

  rotuloStatus(s: string): string {
    return s === 'aberta' ? 'Aberta' : s === 'fechada' ? 'Fechada' : 'Cancelada';
  }

  /** Esc fecha qualquer modal aberto (fechamento/cancelamento). */
  fecharModais(): void {
    this.fechando.set(false);
    this.cancelando.set(null);
  }

  // ----------------------------------------------------------------- comandas

  setTipo(t: 'mesa' | 'quarto' | 'balcao'): void {
    this.abrirForm.patchValue({ tipo: t, idmesa: null, idquarto: null });
  }

  abrirValido(): boolean {
    const v = this.abrirForm.getRawValue();
    if (v.tipo === 'mesa') return v.idmesa !== null;
    if (v.tipo === 'quarto') return v.idquarto !== null;
    return v.rotulo.trim().length > 0;
  }

  abrirComanda(): void {
    const v = this.abrirForm.getRawValue();
    this.salvando.set(true);
    this.pdvApi
      .abrirComanda({
        tipo: v.tipo,
        idmesa: v.idmesa,
        idquarto: v.idquarto,
        idgarcom: v.idgarcom,
        rotulo: v.rotulo.trim() || null,
      })
      .subscribe({
        next: (c) => {
          this.salvando.set(false);
          this.notify.ok(`Comanda Nº${c.id} aberta.`);
          this.abrindo.set(false);
          this.selecao.set(null);
          this.abrirForm.reset({
            tipo: 'balcao',
            idmesa: null,
            idquarto: null,
            idgarcom: null,
            rotulo: '',
          });
          this.carregarMesas();
          this.carregarComandas();
          this.carregarAbertas();
          this.abrirDetalhe(c.id);
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao abrir comanda.');
        },
      });
  }

  abrirDetalhe(id: number): void {
    this.aba.set('mesas');
    this.selecao.set(null);
    this.pdvApi.buscarComanda(id).subscribe({
      next: (c) => {
        this.comanda.set(c);
        this.fechando.set(false);
        this.cancelando.set(null);
        this.pdvApi.itensComanda(id).subscribe({
          next: (i) => this.itens.set(i),
          error: () => {},
        });
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Comanda não encontrada.'),
    });
  }

  fecharDetalhe(): void {
    this.comanda.set(null);
    this.itens.set([]);
    this.fechando.set(false);
    this.cancelando.set(null);
    this.carregarMesas();
    this.carregarComandas();
    this.carregarAbertas();
  }

  carregarAbertas(): void {
    this.pdvApi.listarComandas({ status: 'aberta', page: 1, porPagina: 50 }).subscribe({
      next: (p) => this.comandasAbertas.set(p.items),
      error: () => {},
    });
  }

  private recarregarComanda(): void {
    const id = this.comanda()?.id;
    if (id) {
      this.pdvApi
        .buscarComanda(id)
        .subscribe({ next: (c) => this.comanda.set(c), error: () => {} });
      this.pdvApi.itensComanda(id).subscribe({ next: (i) => this.itens.set(i), error: () => {} });
      this.pdvApi.itensVenda().subscribe({ next: (i) => this.itensVenda.set(i), error: () => {} });
    }
  }

  // -------------------------------------------------------------------- itens

  adicionarProduto(i: ItemVendaView): void {
    const com = this.comanda();
    if (!com || com.status !== 'aberta') return;
    this.salvando.set(true);
    this.pdvApi.adicionarItem(com.id, i.id, 1).subscribe({
      next: () => {
        this.salvando.set(false);
        this.recarregarComanda();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao lançar item.');
      },
    });
  }

  entregarItem(iditem: number): void {
    const com = this.comanda();
    if (!com) return;
    this.pdvApi.entregarItem(com.id, iditem).subscribe({
      next: () => this.recarregarComanda(),
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao marcar entregue.'),
    });
  }

  iniciarCancelamento(tipo: 'item' | 'comanda', iditem?: number): void {
    this.cancelando.set(tipo);
    this.cancelandoItem.set(iditem ?? null);
    this.fechando.set(false);
    this.cancelForm.reset({ motivo: '' });
  }

  confirmarCancelamento(): void {
    const com = this.comanda();
    const tipo = this.cancelando();
    const motivo = this.cancelForm.getRawValue().motivo.trim();
    if (!com || !tipo || !motivo) return;
    this.salvando.set(true);
    const ok = (msg: string) => {
      this.salvando.set(false);
      this.cancelando.set(null);
      this.notify.ok(msg);
    };
    const erro = (e: { error?: { erro?: { mensagem?: string } } }) => {
      this.salvando.set(false);
      this.notify.erro(
        e?.error?.erro?.mensagem ?? `Falha ao cancelar ${tipo === 'item' ? 'item' : 'comanda'}.`,
      );
    };
    if (tipo === 'item') {
      this.pdvApi.cancelarItem(com.id, this.cancelandoItem()!, motivo).subscribe({
        next: () => {
          ok('Item cancelado — estoque devolvido.');
          this.recarregarComanda();
        },
        error: erro,
      });
    } else {
      this.pdvApi.cancelarComanda(com.id, motivo).subscribe({
        next: () => {
          ok('Comanda cancelada — itens devolvidos ao estoque.');
          this.fecharDetalhe();
        },
        error: erro,
      });
    }
  }

  // -------------------------------------------------------------- fechamento

  setModo(m: 'pagar' | 'faturar'): void {
    this.modo.set(m);
  }

  fecharValido(): boolean {
    const v = this.fecharForm.getRawValue();
    if (this.modo() === 'faturar') return true;
    return v.idconta_financeira !== null && v.idforma_pagamento !== null;
  }

  fecharComanda(): void {
    const com = this.comanda();
    if (!com) return;
    const v = this.fecharForm.getRawValue();
    this.salvando.set(true);
    this.pdvApi
      .fecharComanda(com.id, {
        modo: this.modo(),
        desconto: v.desconto,
        idconta_financeira: v.idconta_financeira,
        idforma_pagamento: v.idforma_pagamento,
      })
      .subscribe({
        next: (c) => {
          this.salvando.set(false);
          this.notify.ok(
            this.modo() === 'pagar'
              ? `Comanda Nº${c.id} fechada — ${fmt(c.total)} recebidos.`
              : `Comanda Nº${c.id} faturada ao quarto — ${fmt(c.total)}.`,
          );
          this.fecharDetalhe();
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao fechar comanda.');
        },
      });
  }

  // ----------------------------------------------------------------- garçons

  salvarGarcom(): void {
    const v = this.garcomForm.getRawValue();
    if (v.idfuncionario === null || v.percentual === null) return;
    this.pdvApi.salvarGarcom(v.idfuncionario, v.percentual, true).subscribe({
      next: () => {
        this.notify.ok('Garçom configurado.');
        this.garcomForm.reset({ idfuncionario: null, percentual: null });
        this.carregarGarcons();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao salvar garçom.'),
    });
  }

  toggleMesa(m: MesaView): void {
    this.pdvApi.statusMesa(m.id, !m.ativo).subscribe({
      next: () => {
        this.notify.ok(`Mesa ${m.numero} ${m.ativo ? 'desativada' : 'reativada'}.`);
        this.carregarMesas();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao atualizar mesa.'),
    });
  }

  toggleGarcom(g: GarcomView): void {
    this.pdvApi.salvarGarcom(g.idfuncionario, num(g.percentual), !g.ativo).subscribe({
      next: () => {
        this.notify.ok(`${g.funcionario_nome} ${g.ativo ? 'desativado' : 'reativado'}.`);
        this.carregarGarcons();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao atualizar garçom.'),
    });
  }

  // ---------------------------------------------------------------- comissões

  iniciarPagamento(id: number): void {
    this.pagando.set(id);
  }

  pagarComissao(id: number): void {
    const v = this.pagarForm.getRawValue();
    if (v.idconta_financeira === null) return;
    this.salvando.set(true);
    this.pdvApi.pagarComissao(id, v.idconta_financeira, v.idforma_pagamento).subscribe({
      next: () => {
        this.salvando.set(false);
        this.notify.ok('Comissão paga — lançamento gerado no financeiro.');
        this.pagando.set(null);
        this.pagarForm.reset({ idconta_financeira: null, idforma_pagamento: null });
        this.carregarComissoes();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao pagar comissão.');
      },
    });
  }
}
