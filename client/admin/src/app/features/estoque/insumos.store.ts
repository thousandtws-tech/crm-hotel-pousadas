// Lógica e estado de insumos — separada da camada de UI (insumos.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, effect, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { EstoqueApi } from '@core/api/estoque.api';
import { num } from '@core/utils/num.utils';
import { RealtimeService } from '@core/services/realtime.service';
import { NotifyService } from '@core/services/notify.service';
import {
  ConversaoUnidade,
  EstoqueBaixoView,
  FichaItemView,
  ItemEstoque,
  NfeImportRequest,
  NfePreview,
} from '@core/models/estoque.models';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

interface LinhaNfe {
  nome: string;
  unidade_compra: string;
  quantidade: string;
  valor_unit: string;
  valor_total: string;
  iditem: FormControl<number | null>; // null = criar insumo novo
  fator: FormControl<number>;
}

@Directive()
export abstract class InsumosStore implements OnInit {
  private readonly estoqueApi = inject(EstoqueApi);
  private readonly notify = inject(NotifyService);
  protected readonly rt = inject(RealtimeService);

  protected readonly fmt = fmt;
  protected readonly num = num;

  protected readonly itens = signal<ItemEstoque[]>([]);
  protected readonly alertas = signal<EstoqueBaixoView[]>([]);
  protected readonly selecionado = signal<ItemEstoque | null>(null);
  protected readonly ficha = signal<FichaItemView[]>([]);
  protected readonly conversoes = signal<ConversaoUnidade[]>([]);
  protected readonly busca = new FormControl('', { nonNullable: true });

  protected readonly formFicha = new FormGroup({
    idinsumo: new FormControl<number | null>(null, Validators.required),
    quantidade: new FormControl(1, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1)],
    }),
  });
  protected readonly formConv = new FormGroup({
    unidade_compra: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    fator: new FormControl(1, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1)],
    }),
  });
  protected readonly formNfe = new FormGroup({
    vencimento: new FormControl('', { nonNullable: true }),
    gerar_pagamento: new FormControl(true, { nonNullable: true }),
  });

  protected readonly nfeAberto = signal(false);
  protected readonly nfe = signal<NfePreview | null>(null);
  protected readonly nfeErro = signal<string | null>(null);
  protected readonly nomeArquivo = signal('');
  protected readonly linhas = signal<LinhaNfe[]>([]);
  protected readonly importando = signal(false);

  protected readonly itensFiltrados = computed(() => {
    const t = this.busca.value.trim().toLowerCase();
    const base = this.itens();
    return t ? base.filter((i) => i.nome.toLowerCase().includes(t)) : base;
  });

  protected readonly candidatosInsumo = computed(() => {
    const sel = this.selecionado();
    const ja = new Set(this.ficha().map((f) => f.idinsumo));
    return this.itens().filter((i) => i.id !== sel?.id && !ja.has(i.id));
  });

  protected readonly custoFicha = computed(() =>
    this.ficha().reduce((acc, f) => acc + num(f.custo_unit) * f.quantidade, 0),
  );

  constructor() {
    // RealtimeService: deltas de estoque/ficha/conversao recarregam o painel
    effect(() => {
      this.rt.delta('estoque');
      this.rt.delta('ficha_tecnica');
      this.rt.delta('estoque_conversao');
      this.rt.delta('estoque_nfe');
      this.carregar(true);
      const sel = this.selecionado();
      if (sel) this.carregarDetalhe(sel);
    });
  }

  ngOnInit() {
    this.carregar();
  }

  protected carregar(silencioso = false) {
    this.estoqueApi.listarItens(1, 500, true).subscribe({
      next: (p) => this.itens.set(p.items),
      error: () => !silencioso && this.notify.erro('Falha ao carregar itens.'),
    });
    this.estoqueApi.alertasEstoque().subscribe({
      next: (a) => this.alertas.set(a),
      error: () => {},
    });
  }

  protected selecionar(i: ItemEstoque) {
    this.selecionado.set(i);
    this.carregarDetalhe(i);
  }

  private carregarDetalhe(i: ItemEstoque) {
    this.estoqueApi.listarFicha(i.id).subscribe((f) => this.ficha.set(f));
    this.estoqueApi.listarConversoes(i.id).subscribe((c) => this.conversoes.set(c));
  }

  protected baixo(i: ItemEstoque) {
    return i.estoque_minimo > 0 && i.quantidade <= i.estoque_minimo;
  }

  // -- ficha -------------------------------------------------------------------

  protected addFicha() {
    const sel = this.selecionado();
    if (!sel) return;
    const { idinsumo, quantidade } = this.formFicha.getRawValue();
    if (!idinsumo || !quantidade) return;
    this.estoqueApi.salvarFichaItem(sel.id, { idinsumo, quantidade }).subscribe({
      next: () => {
        this.notify.ok('Insumo incluído na ficha.');
        this.formFicha.patchValue({ quantidade: 1 });
      },
      error: (e) => this.notify.erro(e),
    });
  }

  protected removerFicha(f: FichaItemView) {
    this.estoqueApi.removerFichaItem(f.id).subscribe({
      next: () => this.notify.ok('Insumo removido.'),
      error: () => this.notify.erro('Falha ao remover.'),
    });
  }

  // -- conversoes ----------------------------------------------------------------

  protected addConv() {
    const sel = this.selecionado();
    if (!sel) return;
    const { unidade_compra, fator } = this.formConv.getRawValue();
    this.estoqueApi
      .salvarConversao(sel.id, { unidade_compra: unidade_compra.trim(), fator })
      .subscribe({
        next: () => {
          this.notify.ok('Conversão salva.');
          this.formConv.patchValue({ unidade_compra: '', fator: 1 });
        },
        error: (e) => this.notify.erro(e),
      });
  }

  protected removerConversao(c: ConversaoUnidade) {
    this.estoqueApi.removerConversao(c.id).subscribe({
      next: () => this.notify.ok('Conversão removida.'),
      error: () => this.notify.erro('Falha ao remover.'),
    });
  }

  // -- NF-e ------------------------------------------------------------------------

  protected abrirNfe() {
    this.nfeAberto.set(true);
    this.nfe.set(null);
    this.nfeErro.set(null);
    this.nomeArquivo.set('');
    this.linhas.set([]);
  }

  protected fecharNfe() {
    this.nfeAberto.set(false);
  }

  protected lerArquivo(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.nomeArquivo.set(file.name);
    this.nfeErro.set(null);
    const reader = new FileReader();
    reader.onload = () => {
      this.estoqueApi.previewNfe(String(reader.result)).subscribe({
        next: (n) => {
          this.nfe.set(n);
          this.linhas.set(
            n.itens.map((it) => ({
              nome: it.nome,
              unidade_compra: it.unidade_compra,
              quantidade: it.quantidade,
              valor_unit: it.valor_unit,
              valor_total: it.valor_total,
              iditem: new FormControl<number | null>(it.iditem_sugerido),
              fator: new FormControl<number>(it.fator_sugerido ?? 1, {
                nonNullable: true,
              }),
            })),
          );
        },
        error: (e) => this.nfeErro.set(e?.error?.erro?.mensagem || 'Não consegui ler este XML.'),
      });
    };
    reader.readAsText(file);
  }

  protected unidadeDe(l: LinhaNfe) {
    const id = l.iditem.value;
    return this.itens().find((i) => i.id === id)?.unidade ?? 'un';
  }

  protected confirmarNfe() {
    const n = this.nfe();
    if (!n) return;
    const { vencimento, gerar_pagamento } = this.formNfe.getRawValue();
    const req: NfeImportRequest = {
      chave: n.chave,
      numero: n.numero,
      emitente: n.emitente,
      cnpj: n.cnpj,
      emissao: n.emissao,
      total: n.total,
      vencimento: vencimento || null,
      gerar_pagamento,
      itens: this.linhas().map((l) => ({
        iditem: l.iditem.value,
        nome: l.nome,
        unidade_compra: l.unidade_compra,
        fator: l.fator.value || 1,
        quantidade: l.quantidade,
        valor_total: l.valor_total,
      })),
    };
    this.importando.set(true);
    this.estoqueApi.importarNfe(req).subscribe({
      next: (r) => {
        this.importando.set(false);
        this.notify.ok(
          r.idlancamento
            ? `NF-e importada — conta a pagar Nº${r.idlancamento} criada.`
            : 'NF-e importada com sucesso.',
        );
        this.fecharNfe();
      },
      error: (e) => {
        this.importando.set(false);
        this.nfeErro.set(e?.error?.erro?.mensagem || 'Falha na importação.');
      },
    });
  }
}
