import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, num } from '@core/services/api.service';
import {
  CategoriaEstoque,
  Impressora,
  ItemEstoque,
  ItemEstoqueInput,
  MovimentacaoInput,
  MovimentoView,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';

// -- página ---------------------------------------------------------------------------

@Component({
  selector: 'app-estoque',
  imports: [
    DatePipe,
    DecimalPipe,
    MatTabsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  template: `
    <div class="page">
      <div class="acoes-topo">
        <button class="btn-dark-blue" type="button" (click)="abrirCategorias()">
          <mat-icon>category</mat-icon> Categorias
        </button>
        <button class="btn-dark-blue" type="button" (click)="abrirItem()">
          <mat-icon>add_shopping_cart</mat-icon> Adicionar Item
        </button>
      </div>

      <div class="inner-card">
        <div class="inner-card-header"><h4>Estoque</h4></div>
        <div class="inner-card-body">
          <mat-tab-group>
            <!-- ============================== ITENS ============================== -->
            <mat-tab label="Itens">
              <div class="tbl-wrap">
                <table class="plain bordered">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Item</th>
                      <th>Categoria</th>
                      <th>Quantidade</th>
                      <th>Preço (Unitário)</th>
                      <th class="tc">Status</th>
                      <th class="tc">Editar</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (i of itens(); track i.id) {
                      <tr>
                        <td>{{ i.id }}</td>
                        <td>{{ i.nome }}</td>
                        <td>{{ categoriaNome(i.idcategoria) }}</td>
                        <td>{{ i.quantidade }}</td>
                        <td>R$ {{ num(i.valor_unitario) | number: '1.2-2' }}</td>
                        <td class="tc">
                          <button
                            type="button"
                            class="status-chip badge-toggle"
                            [class.bg-success]="i.ativo"
                            [class.bg-danger]="!i.ativo"
                            [title]="i.ativo ? 'Desativar' : 'Ativar'"
                            (click)="statusItem(i, !i.ativo)"
                          >
                            {{ i.ativo ? 'Ativo' : 'Inativo' }}
                          </button>
                        </td>
                        <td class="tc">
                          <button
                            type="button"
                            class="badge-acao bg-yellow text-black-50"
                            title="Editar"
                            (click)="abrirItem(i)"
                          >
                            <mat-icon>edit</mat-icon>
                          </button>
                        </td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7" class="muted tc">Nenhum item cadastrado.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>

            <!-- ========================= ADICIONAR ENTRADA ======================= -->
            <mat-tab label="Adicionar Entrada">
              <form (submit)="$event.preventDefault(); salvarEntrada()">
                <div class="tbl-wrap">
                  <table class="plain bordered">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th>Categoria</th>
                        <th>Quantidade Atual</th>
                        <th>Adicionar</th>
                        <th>Quantidade futura</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (i of itensAtivos(); track i.id) {
                        <tr>
                          <td>{{ i.id }}</td>
                          <td>{{ i.nome }}</td>
                          <td>{{ categoriaNome(i.idcategoria) }}</td>
                          <td>
                            <input class="input-inn num" type="number" readonly [value]="i.quantidade" />
                          </td>
                          <td>
                            <input
                              class="input-inn num"
                              type="number"
                              min="1"
                              [value]="entradaAdd()[i.id] ?? ''"
                              (input)="setEntrada(i.id, $event)"
                              aria-label="Adicionar quantidade"
                            />
                          </td>
                          <td>
                            <input
                              class="input-inn num"
                              type="number"
                              readonly
                              [value]="i.quantidade + (entradaAdd()[i.id] ?? 0)"
                            />
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="6" class="muted tc">Nenhum item ativo.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
                <div class="fim">
                  <button class="btn-green" type="submit">Adicionar</button>
                </div>
              </form>
            </mat-tab>

            <!-- ========================== ADICIONAR SAÍDA ======================== -->
            <mat-tab label="Adicionar Saida">
              <form (submit)="$event.preventDefault(); salvarSaida()">
                <div class="tbl-wrap">
                  <table class="plain bordered">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th>Categoria</th>
                        <th>Quantidade Atual</th>
                        <th>Retirar</th>
                        <th>Quantidade futura</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (i of itensComSaldo(); track i.id) {
                        <tr>
                          <td>{{ i.id }}</td>
                          <td>{{ i.nome }}</td>
                          <td>{{ categoriaNome(i.idcategoria) }}</td>
                          <td>
                            <input class="input-inn num" type="number" readonly [value]="i.quantidade" />
                          </td>
                          <td>
                            <input
                              class="input-inn num"
                              type="number"
                              min="1"
                              [max]="i.quantidade"
                              [value]="saidaAdd()[i.id] ?? ''"
                              (input)="setSaida(i.id, $event)"
                              aria-label="Retirar quantidade"
                            />
                          </td>
                          <td>
                            <input
                              class="input-inn num"
                              type="number"
                              readonly
                              [value]="i.quantidade - (saidaAdd()[i.id] ?? 0)"
                            />
                          </td>
                          <td>
                            <input
                              class="input-inn"
                              type="text"
                              [value]="saidaMotivo()[i.id] ?? ''"
                              (input)="setMotivo(i.id, $event)"
                              aria-label="Motivo"
                            />
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="7" class="muted tc">Nenhum item com saldo.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
                <div class="fim">
                  <button class="btn-green" type="submit">Retirar</button>
                </div>
              </form>
            </mat-tab>

            <!-- ========================== MOVIMENTAÇÕES ========================== -->
            <mat-tab label="Movimentações">
              <div class="tbl-wrap">
                <table class="plain bordered">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Item</th>
                      <th>Tipo</th>
                      <th>Qtd</th>
                      <th>Funcionário</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of movimentos(); track m.id) {
                      <tr>
                        <td>{{ m.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                        <td>{{ m.item_nome }}</td>
                        <td>
                          <span
                            class="status-chip"
                            [class.bg-success]="m.tipo === 'entrada'"
                            [class.bg-danger]="m.tipo === 'saida'"
                          >{{ m.tipo === 'entrada' ? 'Entrada' : 'Saída' }}</span>
                        </td>
                        <td>{{ m.quantidade }}</td>
                        <td>{{ m.funcionario ?? '—' }}</td>
                        <td>{{ m.motivo }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="6" class="muted tc">Sem movimentações.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>
          </mat-tab-group>
        </div>
      </div>
    </div>

    <!-- ============ Modal Item (cadastrar/editar) ============ -->
    @if (modal() === 'item') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn modal-md" role="dialog" aria-modal="true" aria-labelledby="titulo-item">
          <div class="modal-head">
            <h5 id="titulo-item">
              {{ editandoItem() ? 'Editar item' : 'Adicionar novo item' }}
            </h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form [formGroup]="formItem" (ngSubmit)="salvarItem()">
            <div class="modal-body f-grid">
              <div class="campo full">
                <label class="lbl" for="it-nome"> Nome <small class="req">*</small> </label>
                <input
                  id="it-nome"
                  class="input-inn"
                  type="text"
                  formControlName="nome"
                  placeholder="Ex.: Heineken 200ml"
                  title="Nome do item"
                />
              </div>
              <div class="campo">
                <label class="lbl" for="it-cat"> Categoria </label>
                <select id="it-cat" class="input-inn" formControlName="idcategoria" title="Categoria do item">
                  <option [ngValue]="null">Sem categoria</option>
                  @for (c of categorias(); track c.id) {
                    @if (c.ativo) {
                      <option [ngValue]="c.id">{{ c.nome }}</option>
                    }
                  }
                </select>
              </div>
              <div class="campo">
                <label class="lbl" for="it-valor"> Valor (unitário) </label>
                <div class="input-group-inn">
                  <span class="addon">R$</span>
                  <input
                    id="it-valor"
                    class="input-inn"
                    type="number"
                    step="0.01"
                    min="0"
                    formControlName="valor_unitario"
                    placeholder="Ex.: 5,99"
                    title="Valor do item"
                  />
                </div>
              </div>
              @if (!editandoItem()) {
                <div class="campo">
                  <label class="lbl" for="it-qtd"> Quantidade inicial </label>
                  <input
                    id="it-qtd"
                    class="input-inn"
                    type="number"
                    min="0"
                    formControlName="quantidade_inicial"
                    placeholder="Ex.: 100"
                    title="Quantidade inicial em estoque"
                  />
                </div>
              }
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="formItem.invalid">
                <mat-icon>save</mat-icon> Salvar
              </button>
            </div>
          </form>
        </div>
      </div>
    }

    <!-- ============ Modal Categorias ============ -->
    @if (modal() === 'categorias') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn modal-md" role="dialog" aria-modal="true" aria-labelledby="titulo-cat">
          <div class="modal-head">
            <h5 id="titulo-cat">Categorias</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <div class="modal-body">
            <form class="input-group-inn" style="margin-bottom: 12px" (submit)="$event.preventDefault(); criarCategoriaModal()">
              <input
                class="input-inn"
                type="text"
                [formControl]="novaCategoria"
                placeholder="Nova categoria"
                aria-label="Nome da categoria"
              />
              <button class="btn-green" type="submit" [disabled]="novaCategoria.invalid">Adicionar</button>
            </form>
            <table class="plain bordered">
              <thead>
                <tr><th>#</th><th>Nome</th><th>Impressora (setor)</th><th class="tc">Status</th></tr>
              </thead>
              <tbody>
                @for (c of categorias(); track c.id) {
                  <tr>
                    <td>{{ c.id }}</td>
                    <td>{{ c.nome }}</td>
                    <td>
                      <select
                        class="input-inn"
                        style="padding: 4px 8px; font-size: 0.85rem; max-width: 190px"
                        [value]="c.impressora_id ?? ''"
                        (change)="rotearCategoria(c, valorSel($event))"
                        aria-label="Impressora do setor"
                      >
                        <option value="">— sem ticket —</option>
                        @for (p of impressoras(); track p.id) {
                          <option [value]="p.id">{{ p.nome }} ({{ p.setor }})</option>
                        }
                      </select>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="status-chip badge-toggle"
                        [class.bg-success]="c.ativo"
                        [class.bg-danger]="!c.ativo"
                        (click)="statusCategoria(c, !c.ativo)"
                      >
                        {{ c.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="muted tc">Nenhuma categoria.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .tbl-wrap { margin-top: 1rem; overflow-x: auto; }
    .num { width: 90px; text-align: right; }
    .fim { display: flex; justify-content: flex-end; margin-top: 8px; }
    .badge-acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; color: #fff; cursor: pointer;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(0.9); }
  `,
})
export class EstoqueComponent implements OnInit {
  private readonly rt = inject(Realtime);

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
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly modal = signal<'item' | 'categorias' | null>(null);
  protected readonly editandoItem = signal<ItemEstoque | null>(null);
  protected readonly novaCategoria = new FormControl('', [Validators.required]);
  protected readonly formItem = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    idcategoria: [null as number | null],
    valor_unitario: [null as number | null],
    quantidade_inicial: [0],
  });

  protected readonly itens = signal<ItemEstoque[]>([]);
  protected readonly categorias = signal<CategoriaEstoque[]>([]);
  protected readonly impressoras = signal<Impressora[]>([]);
  protected readonly movimentos = signal<MovimentoView[]>([]);
  protected readonly entradaAdd = signal<Record<number, number>>({});
  protected readonly saidaAdd = signal<Record<number, number>>({});
  protected readonly saidaMotivo = signal<Record<number, string>>({});
  protected readonly num = num;

  protected readonly itensAtivos = () => this.itens().filter((i) => i.ativo);
  protected readonly itensComSaldo = () =>
    this.itens().filter((i) => i.ativo && i.quantidade > 0);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.api.listarItens(1, 200).subscribe({
      next: (p) => this.itens.set(p.items),
      error: (e) => this.notify.erro(e),
    });
    this.api.listarCategorias().subscribe({
      next: (c) => this.categorias.set(c),
      error: () => undefined,
    });
    this.api.listarImpressoras().subscribe({
      next: (p) => this.impressoras.set(p),
      error: () => undefined,
    });
    this.api.listarMovimentos(1, 50).subscribe({
      next: (p) => this.movimentos.set(p.items),
      error: () => undefined,
    });
  }

  categoriaNome(id: number | null): string {
    return this.categorias().find((c) => c.id === id)?.nome ?? '—';
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
    this.api.movimentar(movs).subscribe({
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

  fecharModal(): void {
    this.modal.set(null);
    this.editandoItem.set(null);
  }

  valorSel(e: Event): number | null {
    const v = (e.target as HTMLSelectElement).value;
    return v === '' ? null : Number(v);
  }

  abrirItem(item?: ItemEstoque): void {
    this.editandoItem.set(item ?? null);
    if (item) {
      this.formItem.patchValue({
        nome: item.nome,
        idcategoria: item.idcategoria,
        valor_unitario: item.valor_unitario !== null ? Number(item.valor_unitario) : null,
        quantidade_inicial: 0,
      });
    } else {
      this.formItem.reset({ nome: '', idcategoria: null, valor_unitario: null, quantidade_inicial: 0 });
    }
    this.modal.set('item');
  }

  salvarItem(): void {
    if (this.formItem.invalid) return;
    const v = this.formItem.getRawValue();
    const input: ItemEstoqueInput = {
      nome: v.nome,
      idcategoria: v.idcategoria,
      valor_unitario: v.valor_unitario,
      quantidade_inicial: v.quantidade_inicial || undefined,
      version: this.editandoItem()?.version,
    };
    const item = this.editandoItem();
    const op = item ? this.api.atualizarItem(item.id, input) : this.api.criarItem(input);
    op.subscribe({
      next: () => {
        this.notify.ok('Item salvo.');
        this.fecharModal();
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
    this.api.criarCategoria(nome).subscribe({
      next: () => {
        this.novaCategoria.reset();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Roteamento KOT — envia tickets de produção da categoria à impressora. */
  rotearCategoria(c: CategoriaEstoque, impressoraId: number | null): void {
    this.api.rotaCategoria(c.id, impressoraId).subscribe({
      next: () => {
        this.carregar();
        this.notify.ok(impressoraId ? 'Categoria roteada.' : 'Roteamento removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  statusItem(i: ItemEstoque, ativo: boolean): void {
    this.api.statusItem(i.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  statusCategoria(c: CategoriaEstoque, ativo: boolean): void {
    this.api.statusCategoria(c.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

}
