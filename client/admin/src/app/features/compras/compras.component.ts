import { Component, computed, effect, inject, signal } from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { DatePipe } from "@angular/common";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../core/services/api.service";
import { Notify } from "../../core/services/notify.service";
import { Realtime } from "../../core/services/realtime.service";
import {
  Fornecedor,
  FornecedorInput,
  ItemEstoque,
  PedidoCompraView,
  RecebimentoItem,
} from "../../core/models/api.models";

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

@Component({
  selector: "app-compras",
  imports: [ReactiveFormsModule, MatIconModule, MatSelectModule, DatePipe],
  template: `
    <div class="page">
      <header class="cab">
        <div>
          <h1>Compras</h1>
          <p class="sub">Pedidos de compra, fornecedores e recebimento no estoque.</p>
        </div>
        <div class="cab_acoes">
          <button class="btn" [class.ativo]="aba() === 'fornecedores'" (click)="aba.set('fornecedores')">
            <mat-icon>local_shipping</mat-icon> Fornecedores
          </button>
          <button class="btn prim" (click)="novoPedido()">
            <mat-icon>add_shopping_cart</mat-icon> Novo pedido
          </button>
        </div>
      </header>

      @if (aba() === 'pedidos') {
        <div class="chips" role="tablist" aria-label="Filtrar pedidos">
          @for (st of ['', 'pendente', 'parcial', 'recebido', 'cancelado']; track st) {
            <button class="chip" [class.on]="filtro() === st" (click)="setFiltro(st)">
              {{ st ? rotulo(st) : 'Todos' }}
            </button>
          }
        </div>

        @if (pedidos().length === 0 && !carregando()) {
          <div class="vazio"><mat-icon>shopping_cart</mat-icon> Nenhum pedido encontrado.</div>
        }
        <div class="lista">
          @for (p of pedidos(); track p.id) {
            <article class="ped" [class]="'ped st_' + p.status" (click)="abrir(p)">
              <div class="ped_topo">
                <strong>Pedido Nº {{ p.id }}</strong>
                <span class="tag" [class]="'tag ' + p.status">{{ rotulo(p.status) }}</span>
                @if (p.origem === 'maria') { <span class="tag maria">MARIA</span> }
              </div>
              <div class="ped_forn">{{ p.fornecedor_nome }}</div>
              <div class="ped_meta">
                <span>{{ p.itens.length }} ite{{ p.itens.length === 1 ? 'm' : 'ns' }}</span>
                @if (p.data_prevista) { <span>prev. {{ p.data_prevista | date: 'dd/MM' }}</span> }
                @if (p.valor_total > 0) { <span class="tot">R$ {{ moeda(p.valor_total) }}</span> }
              </div>
            </article>
          }
        </div>
        <nav class="pager" aria-label="Paginação">
          <button class="btn" [disabled]="pagina() <= 1" (click)="pagina.update(v => v - 1); carregar()">Anterior</button>
          <span>Página {{ pagina() }} de {{ totalPaginas() }}</span>
          <button class="btn" [disabled]="pagina() >= totalPaginas()" (click)="pagina.update(v => v + 1); carregar()">Próxima</button>
        </nav>
      }

      @if (aba() === 'fornecedores') {
        <section class="panel">
          <h2>Fornecedores</h2>
          <form class="form" [formGroup]="fornForm" (ngSubmit)="salvarFornecedor()">
            <input formControlName="nome" placeholder="Nome *" aria-label="Nome do fornecedor" />
            <input formControlName="cnpj" placeholder="CNPJ" aria-label="CNPJ" />
            <input formControlName="telefone" placeholder="Telefone" aria-label="Telefone" />
            <input formControlName="lead_time_dias" type="number" min="0" placeholder="Lead time (dias)"
                   aria-label="Lead time em dias" title="Dias até a entrega" />
            <button class="btn prim" type="submit" [disabled]="fornForm.invalid">
              <mat-icon>save</mat-icon> {{ fornForm.value.id ? 'Atualizar' : 'Cadastrar' }}
            </button>
          </form>
          <table class="tab">
            <thead><tr><th>Nome</th><th>CNPJ</th><th>Telefone</th><th>Lead time</th><th></th></tr></thead>
            <tbody>
              @for (f of fornecedores(); track f.id) {
                <tr [class.inativo]="!f.ativo">
                  <td>{{ f.nome }}</td><td>{{ f.cnpj || '—' }}</td><td>{{ f.telefone || '—' }}</td>
                  <td>{{ f.lead_time_dias }} d</td>
                  <td class="ac">
                    <button class="ic" (click)="editarForn(f)" aria-label="Editar"><mat-icon>edit</mat-icon></button>
                    <button class="ic" (click)="toggleForn(f)" [aria-label]="f.ativo ? 'Desativar' : 'Ativar'">
                      <mat-icon>{{ f.ativo ? 'toggle_on' : 'toggle_off' }}</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }

      @if (detalhe(); as p) {
        <div class="ov" (click)="fechar()">
          <section class="modal" (click)="$event.stopPropagation()" aria-modal="true" role="dialog" [attr.aria-label]="'Pedido Nº ' + p.id">
            <header class="md_cab">
              <h2>Pedido Nº {{ p.id }} <span class="tag" [class]="'tag ' + p.status">{{ rotulo(p.status) }}</span>
                @if (p.origem === 'maria') { <span class="tag maria">MARIA</span> }</h2>
              <button class="ic" (click)="fechar()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
            </header>
            <div class="md_info">
              <div><b>{{ p.fornecedor_nome }}</b></div>
              <div class="mut">
                Pedido em {{ p.criado_em | date: 'dd/MM/yyyy HH:mm' }}
                @if (p.data_prevista) { · prev. {{ p.data_prevista | date: 'dd/MM/yyyy' }} }
                @if (p.funcionario_nome) { · por {{ p.funcionario_nome }} }
              </div>
              @if (p.idlancamento) {
                <div class="mut"><mat-icon class="mini">receipt_long</mat-icon>
                  Conta a pagar Nº {{ p.idlancamento }} — R$ {{ moeda(p.lancamento_valor ?? 0) }} ({{ p.lancamento_status }})</div>
              }
              @if (p.observacao) { <div class="mut">{{ p.observacao }}</div> }
            </div>
            <table class="tab">
              <thead><tr><th>Item</th><th>Pedido</th><th>Recebido</th><th>Pendente</th><th>Valor un.</th>
                @if (recebendo()) { <th>Receber agora</th> }
              </tr></thead>
              <tbody>
                @for (i of p.itens; track i.id) {
                  <tr>
                    <td>{{ i.item_nome }}</td>
                    <td>{{ i.quantidade }} {{ i.unidade }}</td>
                    <td>{{ i.recebido }}</td>
                    <td [class.ok]="i.pendente === 0">{{ i.pendente }}</td>
                    <td>{{ i.valor_unit != null ? 'R$ ' + moeda(i.valor_unit) : '—' }}</td>
                    @if (recebendo()) {
                      <td><input class="rq" type="number" min="0" [max]="i.pendente" [attr.max]="i.pendente"
                                 [value]="recebMap()[i.iditem] ?? 0"
                                 (input)="setReceb(i.iditem, $event)" [attr.aria-label]="'Receber ' + i.item_nome" /></td>
                    }
                  </tr>
                }
              </tbody>
            </table>
            @if (recebendo()) {
              <div class="rec_bar">
                <input #obs class="rec_obs" placeholder="Observação do recebimento" aria-label="Observação" />
                <button class="btn" (click)="receberTudo(p)"><mat-icon>done_all</mat-icon> Tudo pendente</button>
                <button class="btn prim" [disabled]="totalReceb() === 0" (click)="confirmarRecebimento(p, obs.value)">
                  <mat-icon>inventory</mat-icon> Dar entrada ({{ totalReceb() }})
                </button>
              </div>
            }
            <footer class="md_ac">
              @if (p.status === 'pendente' || p.status === 'parcial') {
                <button class="btn prim" [class.ghost]="recebendo()" (click)="recebendo.update(v => !v)">
                  <mat-icon>inventory_2</mat-icon> {{ recebendo() ? 'Cancelar recebimento' : 'Receber mercadoria' }}
                </button>
                <button class="btn dan" (click)="cancelar(p)"><mat-icon>cancel</mat-icon> Cancelar pedido</button>
              }
            </footer>
          </section>
        </div>
      }

      @if (novo()) {
        <div class="ov" (click)="novo.set(false)">
          <section class="modal" (click)="$event.stopPropagation()" aria-modal="true" role="dialog" aria-label="Novo pedido de compra">
            <header class="md_cab">
              <h2>Novo pedido de compra</h2>
              <button class="ic" (click)="novo.set(false)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
            </header>
            <form class="np" [formGroup]="pedForm" (ngSubmit)="criarPedido()">
              <mat-select formControlName="idfornecedor" placeholder="Fornecedor *" aria-label="Fornecedor">
                @for (f of fornecedoresAtivos(); track f.id) {
                  <mat-option [value]="f.id">{{ f.nome }} (lead {{ f.lead_time_dias }}d)</mat-option>
                }
              </mat-select>
              <div class="np_itens">
                @for (ln of linhas(); track $index) {
                  <div class="np_linha">
                    <mat-select [value]="ln.iditem" (selectionChange)="ln.iditem = $event.value" placeholder="Item" aria-label="Item">
                      @for (it of itens(); track it.id) {
                        <mat-option [value]="it.id">{{ it.nome }} ({{ it.unidade }})</mat-option>
                      }
                    </mat-select>
                    <input type="number" min="1" placeholder="Qtd" [value]="ln.quantidade"
                           (input)="ln.quantidade = num($event)" aria-label="Quantidade" />
                    <input type="number" min="0" step="0.01" placeholder="R$ un." [value]="ln.valor_unit"
                           (input)="ln.valor_unit = numOrNull($event)" aria-label="Valor unitário" />
                    <button type="button" class="ic" (click)="linhas.update(v => v.filter(x => x !== ln))" aria-label="Remover linha">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                }
                <button type="button" class="btn" (click)="linhas.update(v => [...v, { iditem: null, quantidade: 1, valor_unit: null }])">
                  <mat-icon>add</mat-icon> Adicionar item
                </button>
              </div>
              <label class="chk">
                <input type="checkbox" formControlName="gerar_pagamento" />
                Gerar conta a pagar ao criar
              </label>
              <input formControlName="observacao" placeholder="Observação" aria-label="Observação" />
              <button class="btn prim" type="submit" [disabled]="pedForm.invalid || linhas().length === 0">
                <mat-icon>add_shopping_cart</mat-icon> Criar pedido
              </button>
            </form>
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .page { padding: 8px; }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    h1 { font-size: 22px; margin: 0; } .sub { color: var(--mut); margin: 2px 0 0; font-size: 13px; }
    .cab_acoes { display: flex; gap: 8px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px;
      border: 1px solid var(--borda); background: var(--card); cursor: pointer; font: inherit; font-size: 13.5px; }
    .btn.prim { background: var(--prim); border-color: var(--prim); color: #fff; }
    .btn.dan { color: var(--dan); border-color: var(--dan); }
    .btn.ghost { opacity: .65; }
    .btn.ativo { border-color: var(--prim); color: var(--prim); }
    .btn:disabled { opacity: .45; cursor: default; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    .chip { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--borda); background: var(--card); cursor: pointer; font-size: 12.5px; }
    .chip.on { background: var(--prim); color: #fff; border-color: var(--prim); }
    .lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
    .ped { background: var(--card); border: 1px solid var(--borda); border-radius: 12px; padding: 12px 14px; cursor: pointer; }
    .ped:hover { border-color: var(--prim); }
    .ped_topo { display: flex; align-items: center; gap: 8px; }
    .ped_forn { color: var(--mut); font-size: 13px; margin: 4px 0; }
    .ped_meta { display: flex; gap: 10px; font-size: 12.5px; color: var(--mut); }
    .tot { color: var(--prim); font-weight: 600; }
    .tag { font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; text-transform: uppercase; }
    .tag.pendente { background: #fef3c7; color: #92400e; }
    .tag.parcial { background: #dbeafe; color: #1e40af; }
    .tag.recebido { background: #d1fae5; color: #065f46; }
    .tag.cancelado { background: #fee2e2; color: #991b1b; }
    .tag.maria { background: #ede9fe; color: #5b21b6; }
    .vazio { padding: 40px; text-align: center; color: var(--mut); display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .vazio mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .pager { display: flex; gap: 12px; align-items: center; justify-content: center; margin-top: 14px; font-size: 13px; color: var(--mut); }
    .panel { background: var(--card); border: 1px solid var(--borda); border-radius: 12px; padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 16px; }
    .form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .form input, .np input { padding: 9px 12px; border: 1px solid var(--borda); border-radius: 8px; font: inherit; background: var(--bg); color: inherit; }
    .form input:first-child { min-width: 220px; }
    .form input[type="number"] { width: 110px; }
    .tab { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .tab th { text-align: left; padding: 8px; color: var(--mut); font-weight: 600; border-bottom: 1px solid var(--borda); }
    .tab td { padding: 8px; border-bottom: 1px solid var(--borda); }
    .tab td.ok { color: #059669; font-weight: 700; }
    tr.inativo td { opacity: .45; text-decoration: line-through; }
    .ac { display: flex; gap: 4px; }
    .ic { border: 0; background: transparent; cursor: pointer; color: var(--mut); padding: 6px; border-radius: 8px; }
    .ic:hover { color: var(--prim); }
    .ov { position: fixed; inset: 0; background: rgb(0 0 0 / .45); display: grid; place-items: center; z-index: 60; padding: 12px; }
    .modal { background: var(--bg); border-radius: 14px; width: min(760px, 100%); max-height: 90vh; overflow: auto; padding: 18px; }
    .md_cab { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .md_cab h2 { margin: 0; font-size: 17px; display: flex; align-items: center; gap: 8px; }
    .md_info { margin-bottom: 12px; font-size: 13.5px; }
    .mut { color: var(--mut); font-size: 12.5px; margin-top: 3px; display: flex; align-items: center; gap: 4px; }
    .mini { font-size: 16px; width: 16px; height: 16px; }
    .rq { width: 90px; padding: 7px 9px; border: 1px solid var(--prim); border-radius: 8px; font: inherit; text-align: center; background: var(--bg); color: inherit; }
    .rec_bar { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    .rec_obs { flex: 1; min-width: 160px; padding: 9px 12px; border: 1px solid var(--borda); border-radius: 8px; font: inherit; background: var(--bg); color: inherit; }
    .md_ac { display: flex; gap: 8px; margin-top: 14px; }
    .np { display: flex; flex-direction: column; gap: 12px; }
    .np_linha { display: flex; gap: 8px; margin-bottom: 8px; }
    .np_linha mat-select { flex: 1; }
    .np_linha input { width: 80px; }
    .np_linha input:nth-child(3) { width: 100px; }
    .chk { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
  `,
})
export class ComprasComponent {
  private api = inject(ApiService);
  private nt = inject(Notify);
  private rt = inject(Realtime);

  aba = signal<"pedidos" | "fornecedores">("pedidos");
  pedidos = signal<PedidoCompraView[]>([]);
  fornecedores = signal<Fornecedor[]>([]);
  itens = signal<ItemEstoque[]>([]);
  detalhe = signal<PedidoCompraView | null>(null);
  novo = signal(false);
  recebendo = signal(false);
  recebMap = signal<Record<number, number>>({});
  filtro = signal("");
  pagina = signal(1);
  total = signal(0);
  carregando = signal(false);
  linhas = signal<{ iditem: number | null; quantidade: number; valor_unit: number | null }[]>([]);

  fornForm = new FormGroup({
    id: new FormControl<number | null>(null),
    nome: new FormControl("", { nonNullable: true, validators: [Validators.required] }),
    cnpj: new FormControl("", { nonNullable: true }),
    telefone: new FormControl("", { nonNullable: true }),
    lead_time_dias: new FormControl(0, { nonNullable: true }),
    version: new FormControl<number | null>(null),
  });
  pedForm = new FormGroup({
    idfornecedor: new FormControl<number | null>(null, Validators.required),
    gerar_pagamento: new FormControl(true, { nonNullable: true }),
    observacao: new FormControl("", { nonNullable: true }),
  });

  fornecedoresAtivos = computed(() => this.fornecedores().filter((f) => f.ativo));
  totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 15)));
  totalReceb = computed(() =>
    Object.values(this.recebMap()).reduce((s, v) => s + v, 0)
  );

  constructor() {
    effect(() => {
      this.rt.delta("compra_pedido");
      this.rt.delta("fornecedor");
      this.carregar();
      this.carregarFornecedores();
    });
  }

  rotulo(s: string) {
    return STATUS_LABEL[s] ?? s;
  }
  moeda(v: number) {
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }
  num(e: Event) {
    return Number((e.target as HTMLInputElement).value) || 0;
  }
  numOrNull(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    return v === "" ? null : Number(v);
  }

  setFiltro(s: string) {
    this.filtro.set(s);
    this.pagina.set(1);
    this.carregar();
  }

  async carregar() {
    this.carregando.set(true);
    try {
      const r = await firstValueFrom(
        this.api.listarPedidos({
          status: this.filtro() || undefined,
          pagina: this.pagina(),
        })
      );
      this.pedidos.set(r.items);
      this.total.set(r.total);
    } finally {
      this.carregando.set(false);
    }
  }

  async carregarFornecedores() {
    this.fornecedores.set(await firstValueFrom(this.api.listarFornecedores(false)));
  }

  async novoPedido() {
    if (!this.itens().length) {
      const it = await firstValueFrom(this.api.listarItens(1, 500, true));
      this.itens.set(it.items);
    }
    if (!this.fornecedores().length) await this.carregarFornecedores();
    this.linhas.set([{ iditem: null, quantidade: 1, valor_unit: null }]);
    this.novo.set(true);
  }

  async salvarFornecedor() {
    const v = this.fornForm.getRawValue();
    const b: FornecedorInput = {
      id: v.id ?? undefined,
      nome: v.nome,
      cnpj: v.cnpj || undefined,
      telefone: v.telefone || undefined,
      lead_time_dias: v.lead_time_dias,
      version: v.version ?? undefined,
    };
    try {
      await firstValueFrom(this.api.salvarFornecedor(b));
      this.nt.ok(v.id ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      this.fornForm.reset({ lead_time_dias: 0 });
      this.carregarFornecedores();
    } catch (e: any) {
      this.nt.erro(e instanceof Error ? e : "Falha ao salvar fornecedor.");
    }
  }

  editarForn(f: Fornecedor) {
    this.fornForm.setValue({
      id: f.id, nome: f.nome, cnpj: f.cnpj ?? "",
      telefone: f.telefone ?? "", lead_time_dias: f.lead_time_dias, version: f.version,
    });
  }

  async toggleForn(f: Fornecedor) {
    await firstValueFrom(this.api.statusFornecedor(f.id, !f.ativo));
    this.carregarFornecedores();
  }

  async criarPedido() {
    const v = this.pedForm.getRawValue();
    const itens = this.linhas().filter((l) => l.iditem);
    if (!itens.length) return;
    try {
      const r = await firstValueFrom(
        this.api.criarPedido({
          idfornecedor: v.idfornecedor!,
          itens: itens.map((l) => ({
            iditem: l.iditem!,
            quantidade: l.quantidade,
            valor_unit: l.valor_unit ?? undefined,
          })),
          gerar_pagamento: v.gerar_pagamento,
          observacao: v.observacao || undefined,
          origem: "manual",
        })
      );
      this.nt.ok(`Pedido Nº ${r.id} criado${v.gerar_pagamento ? " com conta a pagar" : ""}.`);
      this.novo.set(false);
      this.pedForm.reset({ gerar_pagamento: true });
      this.carregar();
    } catch (e: any) {
      this.nt.erro(e instanceof Error ? e : "Falha ao criar pedido.");
    }
  }

  async abrir(p: PedidoCompraView) {
    this.detalhe.set(await firstValueFrom(this.api.buscarPedido(p.id)));
    this.recebendo.set(false);
    this.recebMap.set({});
  }

  fechar() {
    this.detalhe.set(null);
    this.recebendo.set(false);
  }

  setReceb(id: number, e: Event) {
    const v = Math.max(0, this.num(e));
    this.recebMap.update((m) => ({ ...m, [id]: v }));
  }

  receberTudo(p: PedidoCompraView) {
    const m: Record<number, number> = {};
    for (const i of p.itens) if (i.pendente > 0) m[i.iditem] = i.pendente;
    this.recebMap.set(m);
  }

  async confirmarRecebimento(p: PedidoCompraView, obs: string) {
    const itens: RecebimentoItem[] = Object.entries(this.recebMap())
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ iditem: Number(id), quantidade: q }));
    if (!itens.length) return;
    try {
      const r = await firstValueFrom(
        this.api.receberPedido(p.id, {
          itens,
          observacao: obs || undefined,
        })
      );
      this.nt.ok(`Entrada registrada — pedido ${this.rotulo(r.status).toLowerCase()}.`);
      this.detalhe.set(await firstValueFrom(this.api.buscarPedido(p.id)));
      this.recebendo.set(false);
      this.recebMap.set({});
      this.carregar();
    } catch (e: any) {
      this.nt.erro(e instanceof Error ? e : "Falha ao receber.");
    }
  }

  async cancelar(p: PedidoCompraView) {
    const motivo = prompt("Motivo do cancelamento:");
    if (!motivo) return;
    try {
      await firstValueFrom(this.api.cancelarPedido(p.id, { motivo }));
      this.nt.ok("Pedido cancelado — conta a pagar estornada.");
      this.fechar();
      this.carregar();
    } catch (e: any) {
      this.nt.erro(e instanceof Error ? e : "Falha ao cancelar.");
    }
  }
}
