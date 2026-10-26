import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, num } from '@core/services/api.service';
import {
  Acomodacao,
  CategoriaEstoque,
  Frigobar,
  ItemEstoque,
  ItemFrigobarView,
} from '@core/models/api.models';
import { Confirm } from '@core/services/confirm.service';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';

// -- página (lista + detalhe, como index.php / frigobar.php do legado) ------------------

@Component({
  selector: 'app-frigobares',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      @if (detalhe(); as f) {
        <!-- ================= DETALHE (frigobar.php do legado) ================= -->
        <div class="acoes-topo">
          <button class="btn-dark-blue" type="button" (click)="voltar()">
            <mat-icon>arrow_back</mat-icon> Voltar
          </button>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Detalhes do Frigobar</h4></div>
          <div class="inner-card-body">
            <h5 class="tit-frig">Frigobar {{ f.modelo ?? '#' + f.id }}</h5>
            <div class="grid-detalhe">
              <form class="dados">
                <div class="campo">
                  <label class="form-label-inn">Modelo</label>
                  <input class="input-inn" readonly [value]="f.modelo ?? ''" />
                </div>
                <div class="campo">
                  <label class="form-label-inn">Patrimônio</label>
                  <input class="input-inn" readonly [value]="f.patrimonio ?? ''" />
                </div>
                <div class="campo">
                  <label class="form-label-inn">Acomodação</label>
                  <input class="input-inn" readonly [value]="nomeAcomodacao(f.idacomodacao)" />
                </div>
                <div class="campo">
                  <label class="form-label-inn">Número (Acomodação)</label>
                  <input class="input-inn" readonly [value]="numAcomodacao(f.idacomodacao)" />
                </div>
                <div class="campo">
                  <label class="form-label-inn">Total de itens</label>
                  <input class="input-inn" readonly [value]="totalItens()" />
                </div>
              </form>

              <div class="add-item">
                <h5 class="sub">Adicionar Item</h5>
                <div class="campo">
                  <label class="form-label-inn" for="cat-add">Categoria</label>
                  <select
                    id="cat-add"
                    class="input-inn sel"
                    [value]="categoriaSel()"
                    (change)="mudarCategoria($event)"
                  >
                    <option value="">Selecione uma opção</option>
                    @for (c of categorias(); track c.id) {
                      <option [value]="c.id">{{ c.nome }}</option>
                    }
                  </select>
                </div>
                <div class="campo">
                  <label class="form-label-inn" for="item-add">Item</label>
                  <select
                    id="item-add"
                    class="input-inn sel"
                    [value]="itemSel()"
                    (change)="itemSel.set(numeroDe($event))"
                  >
                    <option value="">
                      {{ categoriaSel() ? 'Selecione um item' : 'Selecione uma categoria' }}
                    </option>
                    @for (i of itensDaCategoria(); track i.id) {
                      <option [value]="i.id">
                        {{ i.nome }} (saldo: {{ i.quantidade }})
                      </option>
                    }
                  </select>
                </div>
                <div class="campo">
                  <label class="form-label-inn" for="qtd-add">Quantidade</label>
                  <input
                    id="qtd-add"
                    class="input-inn num"
                    type="number"
                    min="1"
                    [value]="qtdSel()"
                    (input)="qtdSel.set(numeroDe($event))"
                  />
                </div>
                <button
                  class="btn-green"
                  type="button"
                  [disabled]="!itemSel() || qtdSel() < 1"
                  (click)="repor(f.id)"
                >
                  Adicionar
                </button>
              </div>
            </div>

            <div class="tbl-wrap">
              <table class="plain bordered">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Categoria</th>
                    <th>Quantidade</th>
                    <th>Valor unitário</th>
                    <th class="tc">Status</th>
                    <th class="tc">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  @for (i of itens(); track i.id) {
                    <tr>
                      <td>{{ i.id }}</td>
                      <td>{{ i.item_nome }}</td>
                      <td>{{ categoriaDeItem(i.iditem) }}</td>
                      <td>
                        <button class="btn-mini" type="button" (click)="ajustar(i, -1)" aria-label="Diminuir">
                          <mat-icon>remove</mat-icon>
                        </button>
                        {{ i.quantidade }}
                        <button class="btn-mini" type="button" (click)="ajustar(i, 1)" aria-label="Aumentar">
                          <mat-icon>add</mat-icon>
                        </button>
                      </td>
                      <td>R$ {{ num(i.valor_unitario) | number: '1.2-2' }}</td>
                      <td class="tc">
                        <button
                          type="button"
                          class="status-chip badge-toggle"
                          [class.bg-success]="i.ativo"
                          [class.bg-danger]="!i.ativo"
                          (click)="statusItem(i, !i.ativo)"
                        >{{ i.ativo ? 'Ativo' : 'Inativo' }}</button>
                      </td>
                      <td class="tc">
                        <button class="btn-del" type="button" (click)="removerItem(i)" aria-label="Remover" title="Excluir">
                          <mat-icon>delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="muted tc">Frigobar vazio.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      } @else {
        <!-- ================= LISTA (index.php do legado) ======================== -->
        <div class="acoes-topo">
          <button class="btn-dark-blue" type="button" (click)="novoFrigobar()">
            <mat-icon>add_box</mat-icon> Novo Frigobar
          </button>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Gerenciar Frigobar</h4></div>
          <div class="inner-card-body">
            @if (carregando()) {
              <div class="center"><mat-spinner diameter="36" /></div>
            }
            <div class="tbl-wrap">
              <table class="plain bordered">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Modelo</th>
                    <th>Patrimônio</th>
                    <th>Acomodação</th>
                    <th class="tc">Status</th>
                    <th class="tc">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of frigobares(); track f.id) {
                    <tr>
                      <td>{{ f.id }}</td>
                      <td>
                        @if (editando() === f.id) {
                          <input class="input-inn cel" [value]="editModelo" (input)="editModelo = valorDe($event)" />
                        } @else {
                          {{ f.modelo }}
                        }
                      </td>
                      <td>
                        @if (editando() === f.id) {
                          <input class="input-inn cel" [value]="editPatrimonio" (input)="editPatrimonio = valorDe($event)" />
                        } @else {
                          {{ f.patrimonio }}
                        }
                      </td>
                      <td>
                        @if (editando() === f.id) {
                          <select
                            class="input-inn sel"
                            [value]="editAcomodacao"
                            (change)="editAcomodacao = numeroDe($event)"
                          >
                            @for (a of acomodacoes(); track a.id) {
                              <option [value]="a.id">{{ a.nome }}</option>
                            }
                          </select>
                        } @else {
                          {{ nomeAcomodacao(f.idacomodacao) }}
                        }
                      </td>
                      <td class="tc">
                        @if (auth.isAdmin()) {
                          <button
                            type="button"
                            class="status-chip badge-toggle"
                            [class.bg-success]="f.ativo"
                            [class.bg-danger]="!f.ativo"
                            [title]="f.ativo ? 'Desativar' : 'Ativar'"
                            (click)="statusFrigobar(f, !f.ativo)"
                          >
                            {{ f.ativo ? 'Ativo' : 'Inativo' }}
                          </button>
                        } @else {
                          <span
                            class="status-chip"
                            [class.bg-success]="f.ativo"
                            [class.bg-danger]="!f.ativo"
                          >{{ f.ativo ? 'Ativo' : 'Inativo' }}</span>
                        }
                      </td>
                      <td class="tc">
                        @if (editando() === f.id) {
                          <button
                            type="button"
                            class="badge-acao bg-green"
                            title="Salvar"
                            (click)="salvarEdicao(f)"
                          >
                            <mat-icon>check</mat-icon>
                          </button>
                        } @else {
                          <button
                            type="button"
                            class="badge-acao bg-yellow text-black-50"
                            title="Editar"
                            (click)="editar(f)"
                          >
                            <mat-icon>edit</mat-icon>
                          </button>
                        }
                        <button
                          type="button"
                          class="badge-acao bg-blue1"
                          title="Visualizar"
                          (click)="ver(f)"
                        >
                          <mat-icon>visibility</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    @if (!carregando()) {
                      <tr><td colspan="6" class="muted tc">Nenhum frigobar cadastrado.</td></tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- ============ Modal novo frigobar ============ -->
    @if (modalNovo()) {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-labelledby="titulo-frig">
          <div class="modal-head">
            <h5 id="titulo-frig">Cadastrar frigobar</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">&times;</button>
          </div>
          <form [formGroup]="formNovo" (ngSubmit)="criarFrigobar()">
            <div class="modal-body">
              <div class="campo">
                <label class="lbl" for="fr-modelo"> Modelo </label>
                <input
                  id="fr-modelo"
                  class="input-inn"
                  type="text"
                  formControlName="modelo"
                  placeholder="Ex.: Consul 80L"
                  title="Modelo do frigobar"
                />
              </div>
              <div class="campo">
                <label class="lbl" for="fr-pat"> Patrimônio </label>
                <input
                  id="fr-pat"
                  class="input-inn"
                  type="text"
                  formControlName="patrimonio"
                  placeholder="Ex.: 000123"
                  title="Patrimônio"
                />
              </div>
              <div class="campo">
                <label class="lbl" for="fr-ac"> Acomodação <small class="req">*</small> </label>
                <select id="fr-ac" class="input-inn" formControlName="idacomodacao" title="Acomodação">
                  <option [ngValue]="null">Selecione uma opção</option>
                  @for (a of acomodacoes(); track a.id) {
                    <option [ngValue]="a.id">{{ a.nome }} ({{ a.numero }})</option>
                  }
                </select>
              </div>
            </div>
            <div class="modal-foot">
              <button class="btn-green" type="submit" [disabled]="formNovo.invalid">
                <mat-icon>save</mat-icon> Gravar
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: `
    .tbl-wrap { overflow-x: auto; }
    .center { display: grid; place-items: center; padding: 24px; }
    .badge-acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; margin: 0 3px;
      color: #fff; cursor: pointer;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(0.9); }
    .cel { min-width: 110px; }
    .sel { min-width: 160px; }
    .num { width: 100px; }
    .btn-mini {
      background: none; border: 1px solid #1f618d; border-radius: 4px;
      padding: 0 6px; margin: 0 4px; cursor: pointer; vertical-align: middle;
      display: inline-flex; align-items: center;
    }
    .btn-mini mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .btn-mini:hover { background: #1f618d; color: #fff; }
    .btn-del {
      background: none; border: none; cursor: pointer;
      color: #842029; padding: 2px;
    }
    .btn-del:hover { color: #dc3545; }

    .tit-frig { text-align: center; width: 100%; margin-bottom: 1.5rem; }
    .grid-detalhe {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;
    }
    .dados {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
      border: 1px solid #c8c8c8; border-radius: 0.25rem; padding: 0.75rem;
      align-content: start;
    }
    .dados .campo:first-child { grid-column: 1 / -1; }
    .add-item { display: flex; flex-direction: column; gap: 0.75rem; max-width: 340px; }
    .add-item .sub { margin: 0 0 0.25rem; }
    @media (max-width: 900px) { .grid-detalhe { grid-template-columns: 1fr; } }
  `,
})
export class FrigobaresComponent implements OnInit {
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
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  protected readonly auth = inject(AuthStore);

  protected readonly frigobares = signal<Frigobar[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly categorias = signal<CategoriaEstoque[]>([]);
  protected readonly itensEstoque = signal<ItemEstoque[]>([]);
  protected readonly itens = signal<ItemFrigobarView[]>([]);
  protected readonly detalhe = signal<Frigobar | null>(null);
  protected readonly carregando = signal(true);
  protected readonly num = num;

  // edição inline
  protected readonly editando = signal<number | null>(null);
  protected editModelo = '';
  protected editPatrimonio = '';
  protected editAcomodacao = 0;

  // adicionar item (detalhe)
  protected readonly modalNovo = signal(false);
  protected readonly formNovo = inject(FormBuilder).nonNullable.group({
    modelo: [''],
    patrimonio: [''],
    idacomodacao: [null as number | null, Validators.required],
  });
  protected readonly categoriaSel = signal<number | ''>('');
  protected readonly itemSel = signal<number | null>(null);
  protected readonly qtdSel = signal(1);

  protected readonly itensDaCategoria = computed(() =>
    this.itensEstoque().filter(
      (i) => i.ativo && (!this.categoriaSel() || i.idcategoria === this.categoriaSel()),
    ),
  );

  ngOnInit(): void {
    this.carregar();
    this.api.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
    this.api.listarItens(1, 200, true).subscribe({
      next: (p) => this.itensEstoque.set(p.items),
      error: () => undefined,
    });
    this.api.listarCategorias().subscribe({
      next: (c) => this.categorias.set(c.filter((x) => x.ativo)),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.api.listarFrigobares().subscribe({
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

  valorDe(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  numeroDe(e: Event): number {
    return Number((e.target as HTMLSelectElement).value);
  }

  mudarCategoria(e: Event): void {
    const raw = (e.target as HTMLSelectElement).value;
    this.categoriaSel.set(raw === '' ? '' : Number(raw));
    this.itemSel.set(null);
  }

  // ---- lista ----------------------------------------------------------------

  novoFrigobar(): void {
    this.formNovo.reset({ modelo: '', patrimonio: '', idacomodacao: null });
    this.modalNovo.set(true);
  }

  fecharModal(): void {
    this.modalNovo.set(false);
  }

  criarFrigobar(): void {
    if (this.formNovo.invalid) return;
    const v = this.formNovo.getRawValue();
    this.api
      .criarFrigobar({
        modelo: v.modelo || null,
        patrimonio: v.patrimonio || null,
        idacomodacao: v.idacomodacao!,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Frigobar criado.');
          this.fecharModal();
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  editar(f: Frigobar): void {
    this.editando.set(f.id);
    this.editModelo = f.modelo ?? '';
    this.editPatrimonio = f.patrimonio ?? '';
    this.editAcomodacao = f.idacomodacao;
  }

  salvarEdicao(f: Frigobar): void {
    this.api
      .atualizarFrigobar(f.id, {
        modelo: this.editModelo || null,
        patrimonio: this.editPatrimonio || null,
        idacomodacao: this.editAcomodacao || f.idacomodacao,
        version: f.version,
      })
      .subscribe({
        next: () => {
          this.editando.set(null);
          this.notify.ok('Frigobar atualizado.');
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  statusFrigobar(f: Frigobar, ativo: boolean): void {
    this.api.statusFrigobar(f.id, ativo).subscribe({
      next: () => this.carregar(),
      error: (e) => this.notify.erro(e),
    });
  }

  // ---- detalhe --------------------------------------------------------------

  ver(f: Frigobar): void {
    this.detalhe.set(f);
    this.carregarItens(f.id);
    this.categoriaSel.set('');
    this.itemSel.set(null);
    this.qtdSel.set(1);
  }

  voltar(): void {
    this.detalhe.set(null);
    this.carregar();
  }

  carregarItens(idfrigobar: number): void {
    this.api.itensFrigobar(idfrigobar).subscribe({
      next: (i) => this.itens.set(i),
      error: () => undefined,
    });
  }

  repor(idfrigobar: number): void {
    const iditem = this.itemSel();
    const quantidade = this.qtdSel();
    if (!iditem || quantidade < 1) return;
    this.api.reporItemFrigobar(idfrigobar, iditem, quantidade).subscribe({
      next: () => {
        this.notify.ok('Item adicionado.');
        this.itemSel.set(null);
        this.qtdSel.set(1);
        this.carregarItens(idfrigobar);
        this.api.listarItens(1, 200, true).subscribe({
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
    this.api.atualizarItemFrigobar(i.id, qtd, i.version).subscribe({
      next: () => this.carregarItens(i.idfrigobar),
      error: (e) => this.notify.erro(e),
    });
  }

  statusItem(i: ItemFrigobarView, ativo: boolean): void {
    this.api.statusItemFrigobar(i.id, ativo).subscribe({
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
    this.api.removerItemFrigobar(i.id).subscribe({
      next: () => this.carregarItens(i.idfrigobar),
      error: (e) => this.notify.erro(e),
    });
  }
}
