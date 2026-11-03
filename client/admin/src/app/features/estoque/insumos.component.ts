import { Component, computed, effect, inject, signal, OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ApiService, num } from '@core/services/api.service';
import { Realtime } from '@core/services/realtime.service';
import { Notify } from '@core/services/notify.service';
import {
  ConversaoUnidade,
  EstoqueBaixoView,
  FichaItemView,
  ItemEstoque,
  NfeImportRequest,
  NfePreview,
} from '@core/models/api.models';

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

@Component({
  selector: 'app-insumos',
  imports: [ReactiveFormsModule, MatIconModule, RouterLink],
  template: `
    <div class="pg">
      <header class="pg-head">
        <div>
          <h1>Insumos &amp; Compras</h1>
          <p class="sub">
            Fichas técnicas, conversões de unidade e importação de NF-e.
          </p>
        </div>
        <div class="head-actions">
          <a class="btn ghost" routerLink="/estoque">
            <mat-icon>inventory_2</mat-icon> Estoque
          </a>
          <button class="btn primary" type="button" (click)="abrirNfe()">
            <mat-icon>upload_file</mat-icon> Importar NF-e
          </button>
        </div>
      </header>

      @if (alertas().length) {
        <section class="alertas" aria-live="polite">
          <div class="alertas-titulo">
            <mat-icon>warning_amber</mat-icon>
            <b>{{ alertas().length }} item(ns) no mínimo ou abaixo</b>
          </div>
          <div class="alertas-lista">
            @for (a of alertas(); track a.id) {
              <div class="alerta" [class.zerado]="a.quantidade === 0">
                <span class="alerta-nome">{{ a.nome }}</span>
                <span class="alerta-qtd"
                  >{{ a.quantidade }} {{ a.unidade }} · mín {{ a.estoque_minimo }}</span
                >
              </div>
            }
          </div>
        </section>
      }

      <div class="grid">
        <!-- coluna esquerda: itens -->
        <section class="card">
          <div class="card-head">
            <h2>Itens</h2>
            <input
              class="busca"
              type="search"
              placeholder="Buscar item…"
              aria-label="Buscar item"
              [formControl]="busca"
            />
          </div>
          <div class="lista">
            @for (i of itensFiltrados(); track i.id) {
              <button
                type="button"
                class="linha"
                [class.sel]="selecionado()?.id === i.id"
                (click)="selecionar(i)"
              >
                <span class="l-nome">
                  {{ i.nome }}
                  @if (i.eh_insumo) { <em class="tag insumo">insumo</em> }
                  @if (baixo(i)) { <em class="tag baixo">baixo</em> }
                </span>
                <span class="l-qtd">{{ i.quantidade }} {{ i.unidade }}</span>
              </button>
            }
            @if (!itensFiltrados().length) {
              <p class="vazio">Nenhum item encontrado.</p>
            }
          </div>
        </section>

        <!-- coluna direita: detalhe do item selecionado -->
        <div class="col-dir">
          @if (selecionado(); as item) {
            <section class="card">
              <div class="card-head">
                <h2>Ficha técnica — {{ item.nome }}</h2>
              </div>
              <p class="dica">
                Baixa automática: ao vender <b>1 {{ item.unidade }}</b> de
                <b>{{ item.nome }}</b> o estoque debita os insumos abaixo.
                Sem ficha, debita o próprio item.
              </p>
              @if (ficha().length) {
                <table class="tab">
                  <thead>
                    <tr><th>Insumo</th><th>Qtd/un.</th><th>Custo un.</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (f of ficha(); track f.id) {
                      <tr>
                        <td>{{ f.insumo }}</td>
                        <td>{{ f.quantidade }} {{ f.unidade }}</td>
                        <td>{{ fmt(f.custo_unit) }}</td>
                        <td>
                          <button
                            class="ic-btn"
                            type="button"
                            aria-label="Remover insumo"
                            (click)="removerFicha(f)"
                          >
                            <mat-icon>delete</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colspan="2">Custo estimado por unidade</td>
                      <td colspan="2"><b>{{ fmt(custoFicha()) }}</b></td>
                    </tr>
                  </tfoot>
                </table>
              } @else {
                <p class="vazio">Sem ficha — a venda debita o item diretamente.</p>
              }
              <form class="addlinha" [formGroup]="formFicha" (ngSubmit)="addFicha()">
                <label>
                  Insumo
                  <select formControlName="idinsumo">
                    @for (c of candidatosInsumo(); track c.id) {
                      <option [ngValue]="c.id">{{ c.nome }} ({{ c.unidade }})</option>
                    }
                  </select>
                </label>
                <label class="w90">
                  Qtd
                  <input type="number" min="1" formControlName="quantidade" />
                </label>
                <button class="btn primary" type="submit" [disabled]="formFicha.invalid">
                  <mat-icon>add</mat-icon> Incluir
                </button>
              </form>
            </section>

            <section class="card">
              <div class="card-head"><h2>Conversões de unidade</h2></div>
              <p class="dica">
                Unidade base: <b>{{ item.unidade }}</b>. Cadastre como o item é
                comprado (ex.: 1 FARDO = 12 {{ item.unidade }}).
              </p>
              @if (conversoes().length) {
                <table class="tab">
                  <thead>
                    <tr><th>Compra</th><th>Equivale a</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (c of conversoes(); track c.id) {
                      <tr>
                        <td>1 {{ c.unidade_compra }}</td>
                        <td>{{ c.fator }} {{ item.unidade }}</td>
                        <td>
                          <button
                            class="ic-btn"
                            type="button"
                            aria-label="Remover conversão"
                            (click)="removerConversao(c)"
                          >
                            <mat-icon>delete</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="vazio">Sem conversões cadastradas.</p>
              }
              <form class="addlinha" [formGroup]="formConv" (ngSubmit)="addConv()">
                <label>
                  Unidade de compra
                  <input formControlName="unidade_compra" placeholder="FARDO, CX, KG…" />
                </label>
                <label class="w90">
                  Fator
                  <input type="number" min="1" formControlName="fator" />
                </label>
                <button class="btn primary" type="submit" [disabled]="formConv.invalid">
                  <mat-icon>add</mat-icon> Incluir
                </button>
              </form>
            </section>
          } @else {
            <section class="card vazio-card">
              <mat-icon>restaurant</mat-icon>
              <p>Selecione um item para gerenciar a ficha técnica e conversões.</p>
            </section>
          }
        </div>
      </div>
    </div>

    <!-- ============================ NF-e ============================ -->
    @if (nfeAberto()) {
      <div class="overlay" (click)="fecharNfe()">
        <section
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Importar NF-e"
          (click)="$event.stopPropagation()"
        >
          <div class="modal-head">
            <h2>Importar NF-e (XML)</h2>
            <button class="ic-btn" type="button" aria-label="Fechar" (click)="fecharNfe()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          @if (!nfe()) {
            <div class="nfe-upload">
              <p>
                Selecione o arquivo <b>.xml</b> da NF-e do fornecedor. Os itens
                entram no estoque e a fatura pode virar conta a pagar.
              </p>
              <label class="upload-box">
                <mat-icon>upload_file</mat-icon>
                <span>{{ nomeArquivo() || 'Escolher XML…' }}</span>
                <input
                  type="file"
                  accept=".xml,text/xml"
                  class="sr-only"
                  (change)="lerArquivo($event)"
                />
              </label>
              @if (nfeErro()) {
                <p class="erro" role="alert">{{ nfeErro() }}</p>
              }
            </div>
          } @else {
            @let n = nfe()!;
            <div class="nfe-resumo">
              <div><span>Emitente</span><b>{{ n.emitente || '—' }}</b></div>
              <div><span>Nº / Emissão</span><b>{{ n.numero || '—' }} · {{ n.emissao || '—' }}</b></div>
              <div><span>Total</span><b>{{ fmt(n.total) }}</b></div>
              <div><span>Chave</span><b class="chave">{{ n.chave }}</b></div>
            </div>
            @if (n.ja_importada) {
              <p class="erro" role="alert">
                Esta NF-e já foi importada — a confirmação será bloqueada.
              </p>
            }

            <div class="nfe-itens">
              @for (l of linhas(); track $index) {
                <div class="nfe-linha">
                  <div class="nl-info">
                    <b>{{ l.nome }}</b>
                    <span>
                      {{ l.quantidade }} {{ l.unidade_compra }} ×
                      {{ fmt(l.valor_unit) }} = {{ fmt(l.valor_total) }}
                    </span>
                  </div>
                  <div class="nl-map">
                    <select [formControl]="l.iditem" aria-label="Mapear item">
                      <option [ngValue]="null">+ Criar insumo novo</option>
                      @for (i of itens(); track i.id) {
                        <option [ngValue]="i.id">{{ i.nome }}</option>
                      }
                    </select>
                    <label class="fator">
                      ×
                      <input type="number" min="1" [formControl]="l.fator" />
                      <span class="u">{{ unidadeDe(l) }}</span>
                    </label>
                  </div>
                </div>
              }
            </div>

            <form class="nfe-rodape" [formGroup]="formNfe">
              <label>
                Vencimento da fatura
                <input type="date" formControlName="vencimento" />
              </label>
              <label class="chk">
                <input type="checkbox" formControlName="gerar_pagamento" />
                Gerar conta a pagar de {{ fmt(n.total) }}
              </label>
              <button
                class="btn primary"
                type="button"
                [disabled]="n.ja_importada || importando()"
                (click)="confirmarNfe()"
              >
                <mat-icon>check</mat-icon>
                {{ importando() ? 'Importando…' : 'Confirmar importação' }}
              </button>
            </form>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host { display:block; }
    .pg { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .pg-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
    h1 { font-size:22px; margin:0; }
    .sub { margin:4px 0 0; color:var(--txt-2,#5f6b7a); font-size:13px; }
    .head-actions { display:flex; gap:8px; }
    .btn { display:inline-flex; align-items:center; gap:6px; border:none; border-radius:10px;
           padding:10px 16px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; }
    .btn.primary { background:#1a6f8a; color:#fff; }
    .btn.primary:disabled { opacity:.55; cursor:default; }
    .btn.ghost { background:#eef2f5; color:#29414e; }
    .ic-btn { background:none; border:none; cursor:pointer; color:#8a97a5; padding:6px; border-radius:8px; }
    .ic-btn:hover { color:#c0392b; background:#fdecea; }
    .grid { display:grid; grid-template-columns: 340px 1fr; gap:16px; align-items:start; }
    .col-dir { display:flex; flex-direction:column; gap:16px; min-width:0; }
    .card { background:#fff; border:1px solid #e3e8ee; border-radius:14px; padding:16px; }
    .card-head { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; }
    .card-head h2 { font-size:15px; margin:0; }
    .busca { flex:1; max-width:200px; border:1px solid #d8dfe6; border-radius:8px; padding:8px 10px; font-size:13px; }
    .lista { display:flex; flex-direction:column; gap:4px; max-height:70vh; overflow:auto; }
    .linha { display:flex; justify-content:space-between; align-items:center; gap:8px; text-align:left;
             border:none; background:none; padding:9px 10px; border-radius:8px; cursor:pointer; font-size:13px; }
    .linha:hover { background:#f2f6f9; }
    .linha.sel { background:#e3f0f5; font-weight:600; }
    .l-nome { display:flex; align-items:center; gap:6px; min-width:0; }
    .tag { font-size:10px; font-style:normal; padding:1px 7px; border-radius:99px; }
    .tag.insumo { background:#eef0ff; color:#5359c9; }
    .tag.baixo { background:#fdecea; color:#c0392b; }
    .l-qtd { color:#5f6b7a; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .dica { font-size:12px; color:#5f6b7a; margin:0 0 10px; }
    .tab { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:10px; }
    .tab th { text-align:left; color:#5f6b7a; font-size:11px; text-transform:uppercase; padding:6px 8px; }
    .tab td { padding:7px 8px; border-top:1px solid #eef1f4; }
    .tab tfoot td { border-top:1px solid #d8dfe6; font-weight:600; }
    .addlinha { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-top:10px; }
    .addlinha label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#44525f; flex:1; min-width:150px; }
    .addlinha label.w90 { flex:0 0 90px; min-width:0; }
    .addlinha select, .addlinha input { border:1px solid #d8dfe6; border-radius:8px; padding:9px 10px; font-size:13px; }
    .vazio, .vazio-card p { color:#8a97a5; font-size:13px; margin:6px 0; }
    .vazio-card { display:flex; flex-direction:column; align-items:center; padding:48px 16px; color:#8a97a5; }
    .vazio-card mat-icon { font-size:40px; width:40px; height:40px; }
    .alertas { background:#fff8ec; border:1px solid #f5ddb0; border-radius:14px; padding:12px 16px; margin-bottom:16px; }
    .alertas-titulo { display:flex; align-items:center; gap:8px; color:#9a6a00; font-size:14px; margin-bottom:8px; }
    .alertas-lista { display:flex; flex-wrap:wrap; gap:8px; }
    .alerta { background:#fff; border:1px solid #f0e0b8; border-radius:10px; padding:6px 10px; font-size:12px; display:flex; flex-direction:column; }
    .alerta.zerado { border-color:#f2b8b0; background:#fdf3f2; }
    .alerta-nome { font-weight:600; }
    .alerta-qtd { color:#9a6a00; font-variant-numeric:tabular-nums; }
    .overlay { position:fixed; inset:0; background:rgba(15,25,35,.45); display:flex; align-items:center; justify-content:center; z-index:100; padding:16px; }
    .modal { background:#fff; border-radius:16px; width:min(760px,100%); max-height:90vh; overflow:auto; padding:20px; }
    .modal-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
    .modal-head h2 { font-size:17px; margin:0; }
    .upload-box { display:flex; align-items:center; justify-content:center; gap:10px; border:2px dashed #b9c6d0;
                  border-radius:12px; padding:32px; cursor:pointer; color:#1a6f8a; font-weight:600; }
    .upload-box:hover { background:#f2f8fb; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
    .nfe-resumo { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:14px; }
    .nfe-resumo div { display:flex; flex-direction:column; gap:2px; font-size:13px; }
    .nfe-resumo span { color:#5f6b7a; font-size:11px; text-transform:uppercase; }
    .chave { font-size:11px; word-break:break-all; }
    .nfe-itens { display:flex; flex-direction:column; gap:8px; max-height:340px; overflow:auto; margin-bottom:14px; }
    .nfe-linha { display:flex; justify-content:space-between; gap:12px; border:1px solid #e3e8ee; border-radius:10px; padding:10px 12px; flex-wrap:wrap; }
    .nl-info { display:flex; flex-direction:column; gap:2px; font-size:13px; min-width:200px; }
    .nl-info span { color:#5f6b7a; font-size:12px; }
    .nl-map { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .nl-map select { border:1px solid #d8dfe6; border-radius:8px; padding:8px; font-size:13px; max-width:220px; }
    .fator { display:flex; align-items:center; gap:6px; font-size:13px; }
    .fator input { width:64px; border:1px solid #d8dfe6; border-radius:8px; padding:8px; font-size:13px; }
    .fator .u { color:#5f6b7a; font-size:12px; }
    .nfe-rodape { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; }
    .nfe-rodape label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#44525f; }
    .nfe-rodape input[type=date] { border:1px solid #d8dfe6; border-radius:8px; padding:9px 10px; font-size:13px; }
    .chk { flex-direction:row !important; align-items:center; gap:8px !important; font-size:13px !important; }
    .chk input { width:16px; height:16px; }
    .erro { color:#c0392b; font-size:13px; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class InsumosComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  protected readonly rt = inject(Realtime);

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
    // Realtime: deltas de estoque/ficha/conversao recarregam o painel
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
    this.api.listarItens(1, 500, true).subscribe({
      next: (p) => this.itens.set(p.items),
      error: () => !silencioso && this.notify.erro('Falha ao carregar itens.'),
    });
    this.api.alertasEstoque().subscribe({
      next: (a) => this.alertas.set(a),
      error: () => {},
    });
  }

  protected selecionar(i: ItemEstoque) {
    this.selecionado.set(i);
    this.carregarDetalhe(i);
  }

  private carregarDetalhe(i: ItemEstoque) {
    this.api.listarFicha(i.id).subscribe((f) => this.ficha.set(f));
    this.api.listarConversoes(i.id).subscribe((c) => this.conversoes.set(c));
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
    this.api.salvarFichaItem(sel.id, { idinsumo, quantidade }).subscribe({
      next: () => {
        this.notify.ok('Insumo incluído na ficha.');
        this.formFicha.patchValue({ quantidade: 1 });
      },
      error: (e) => this.notify.erro(e),
    });
  }

  protected removerFicha(f: FichaItemView) {
    this.api.removerFichaItem(f.id).subscribe({
      next: () => this.notify.ok('Insumo removido.'),
      error: () => this.notify.erro('Falha ao remover.'),
    });
  }

  // -- conversoes ----------------------------------------------------------------

  protected addConv() {
    const sel = this.selecionado();
    if (!sel) return;
    const { unidade_compra, fator } = this.formConv.getRawValue();
    this.api
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
    this.api.removerConversao(c.id).subscribe({
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
      this.api.previewNfe(String(reader.result)).subscribe({
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
        error: (e) =>
          this.nfeErro.set(e?.error?.mensagem || 'Não consegui ler este XML.'),
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
    this.api.importarNfe(req).subscribe({
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
        this.nfeErro.set(e?.error?.mensagem || 'Falha na importação.');
      },
    });
  }
}
