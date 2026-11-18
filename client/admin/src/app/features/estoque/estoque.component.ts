// UI de estoque — template, estilos e bindings. A lógica vive em estoque.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num';
import { Impressora } from '@core/models/estabelecimento.models';
import { EstoqueStore } from './estoque.store';

@Component({
  selector: 'app-estoque',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DatePipe,
    DecimalPipe,
    MatTabsModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  template: `
    <div class="page">
      <div class="est-head">
        <div class="est-titulo-grupo">
          <p class="eyebrow">Suprimentos</p>
          <div class="est-titulo-linha">
            <h2 class="est-titulo">Estoque</h2>
            <span class="est-contador" title="Total de itens cadastrados">
              {{ itens().length }} {{ itens().length === 1 ? 'item' : 'itens' }}
            </span>
            @if (semEstoque() > 0) {
              <span class="est-alerta" title="Itens ativos sem saldo em estoque">
                {{ semEstoque() }} sem estoque
              </span>
            }
          </div>
        </div>
        <div class="est-head-acoes">
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <a class="btn-gray" routerLink="/insumos" aria-label="Insumos, fichas técnicas e NF-e">
            <mat-icon>restaurant_menu</mat-icon> Insumos
          </a>
          <button id="tour-categorias" class="btn-gray" type="button" (click)="abrirCategorias()">
            <mat-icon>category</mat-icon> Categorias
          </button>
          <button id="tour-novo" class="btn-dark-blue" type="button" (click)="abrirItem()">
            <mat-icon>add_shopping_cart</mat-icon> Novo item
          </button>
        </div>
      </div>

      <div class="est-info">
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>inventory_2</mat-icon></span>
          <div class="est-info-txt">
            <strong>Entradas e saídas</strong>
            <p>
              Na aba <b>Entrada</b> você soma produtos ao estoque; na aba <b>Saída</b> você retira e
              informa o motivo.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>history</mat-icon></span>
          <div class="est-info-txt">
            <strong>Movimentações registradas</strong>
            <p>
              Toda entrada e saída fica gravada com data, quantidade e o funcionário responsável —
              nada se perde.
            </p>
          </div>
        </div>
        <div class="est-info-card">
          <span class="est-info-icone"><mat-icon>print</mat-icon></span>
          <div class="est-info-txt">
            <strong>Impressora por categoria</strong>
            <p>
              Em <b>Categorias</b> você escolhe para qual impressora sai o ticket de produção de
              cada grupo.
            </p>
          </div>
        </div>
      </div>

      <div class="inner-card est-card">
        <div class="est-toolbar">
          <div id="tour-busca" class="est-busca" [class.foco]="buscaFoco()">
            <mat-icon class="est-busca-icone">search</mat-icon>
            <input
              class="est-busca-input"
              type="search"
              [formControl]="busca"
              placeholder="Buscar por item ou categoria…"
              aria-label="Buscar item"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button
                type="button"
                class="est-limpar"
                aria-label="Limpar busca"
                (click)="busca.setValue('')"
              >
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          <button
            id="tour-ativos"
            type="button"
            class="est-toggle"
            [class.on]="apenasAtivos()"
            role="switch"
            [attr.aria-checked]="apenasAtivos()"
            (click)="apenasAtivos.set(!apenasAtivos())"
          >
            <span class="est-trilho"><span class="est-bolinha"></span></span>
            Somente ativos
          </button>
        </div>

        <div id="tour-abas">
          <mat-tab-group>
            <!-- ============================== ITENS ============================== -->
            <mat-tab label="Itens">
              <div class="est-tabela-wrap" id="tour-tabela">
                <table class="est-tabela">
                  <thead>
                    <tr>
                      <th class="est-th-nome">Item</th>
                      <th>Categoria</th>
                      <th class="tr">Quantidade</th>
                      <th class="tr">Preço unitário</th>
                      <th class="tc">Status</th>
                      <th class="tc">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    @if (carregando()) {
                      @for (s of skel; track s) {
                        <tr class="skel-row">
                          <td>
                            <span class="skel skel-icone"></span
                            ><span class="skel skel-nome"></span>
                          </td>
                          <td><span class="skel skel-txt"></span></td>
                          <td><span class="skel skel-txt"></span></td>
                          <td><span class="skel skel-txt"></span></td>
                          <td class="tc"><span class="skel skel-chip"></span></td>
                          <td class="tc"><span class="skel skel-acoes"></span></td>
                        </tr>
                      }
                    } @else {
                      @for (i of filtrados(); track i.id) {
                        <tr class="est-row">
                          <td>
                            <div class="est-cell">
                              <span class="est-item-icone"><mat-icon>inventory_2</mat-icon></span>
                              <span class="est-cell-txt">
                                <strong>{{ i.nome }}</strong>
                                <small>#{{ i.id }}</small>
                              </span>
                            </div>
                          </td>
                          <td>
                            <span class="est-tipo">{{ categoriaNome(i.idcategoria) }}</span>
                          </td>
                          <td class="tr">
                            <span class="est-qtd" [class.zero]="i.quantidade === 0">
                              {{ i.quantidade }}
                            </span>
                            @if (i.quantidade === 0 && i.ativo) {
                              <span class="est-tag-zero">sem estoque</span>
                            }
                          </td>
                          <td class="tr">
                            @if (i.valor_unitario !== null) {
                              <span class="est-valor"
                                >R$ {{ num(i.valor_unitario) | number: '1.2-2' }}</span
                              >
                            } @else {
                              <span class="muted">—</span>
                            }
                          </td>
                          <td class="tc">
                            <button
                              type="button"
                              class="st-chip"
                              [class.off]="!i.ativo"
                              [title]="i.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                              (click)="statusItem(i, !i.ativo)"
                            >
                              {{ i.ativo ? 'Ativo' : 'Inativo' }}
                            </button>
                          </td>
                          <td class="tc est-acoes">
                            <button
                              type="button"
                              class="acao-btn"
                              title="Imprimir etiqueta"
                              aria-label="Imprimir etiqueta"
                              (click)="imprimirEtiqueta(i)"
                            >
                              <mat-icon>sell</mat-icon>
                            </button>
                            <button
                              type="button"
                              class="acao-btn"
                              title="Editar"
                              aria-label="Editar item"
                              (click)="abrirItem(i)"
                            >
                              <mat-icon>edit</mat-icon>
                            </button>
                            <button
                              type="button"
                              class="acao-btn perigo"
                              title="Excluir"
                              aria-label="Excluir item"
                              (click)="excluirItem(i)"
                            >
                              <mat-icon>delete</mat-icon>
                            </button>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="6" class="est-vazio">
                            <mat-icon>inventory_2</mat-icon>
                            <p>
                              {{
                                termo() || apenasAtivos()
                                  ? 'Nenhum item encontrado para esses filtros.'
                                  : 'Nenhum item cadastrado ainda.'
                              }}
                            </p>
                            @if (!termo() && !apenasAtivos()) {
                              <button class="btn-dark-blue" type="button" (click)="abrirItem()">
                                <mat-icon>add_shopping_cart</mat-icon> Cadastrar o primeiro item
                              </button>
                            }
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>

            <!-- ========================= ADICIONAR ENTRADA ======================= -->
            <mat-tab label="Entrada">
              <form (submit)="$event.preventDefault(); salvarEntrada()">
                <p class="aba-dica">
                  <mat-icon>add_circle</mat-icon>
                  Digite quanto vai <b>entrar</b> de cada item — a coluna “Futuro” mostra como o
                  estoque vai ficar.
                </p>
                <div class="est-tabela-wrap">
                  <table class="est-tabela">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Categoria</th>
                        <th class="tr">Atual</th>
                        <th class="tr">Adicionar</th>
                        <th class="tr">Futuro</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (i of filtradosAtivos(); track i.id) {
                        <tr class="est-row" [class.marcada]="(entradaAdd()[i.id] ?? 0) > 0">
                          <td>
                            <strong class="est-item-nome">{{ i.nome }}</strong>
                          </td>
                          <td>
                            <span class="est-tipo">{{ categoriaNome(i.idcategoria) }}</span>
                          </td>
                          <td class="tr">
                            <span class="est-qtd">{{ i.quantidade }}</span>
                          </td>
                          <td class="tr">
                            <input
                              class="input-inn num"
                              type="number"
                              min="1"
                              [value]="entradaAdd()[i.id] ?? ''"
                              (input)="setEntrada(i.id, $event)"
                              aria-label="Adicionar quantidade"
                              placeholder="0"
                            />
                          </td>
                          <td class="tr">
                            <span class="est-futuro" [class.sobe]="(entradaAdd()[i.id] ?? 0) > 0">
                              {{ i.quantidade + (entradaAdd()[i.id] ?? 0) }}
                            </span>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="est-vazio">
                            <mat-icon>inventory_2</mat-icon>
                            <p>Nenhum item ativo{{ termo() ? ' para essa busca' : '' }}.</p>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <div class="mov-resumo">
                  <div class="mov-resumo-txt">
                    <mat-icon>add_circle</mat-icon>
                    @if (entradasPendentes().itens === 0) {
                      <span>Digite a quantidade nos itens acima para dar entrada.</span>
                    } @else {
                      <span>
                        <b>{{ entradasPendentes().itens }}</b>
                        {{ entradasPendentes().itens === 1 ? ' item' : ' itens' }}
                        — total de
                        <b>{{ entradasPendentes().total }}</b>
                        {{ entradasPendentes().total === 1 ? ' unidade' : ' unidades' }}
                        para entrar
                      </span>
                    }
                  </div>
                  <button
                    class="btn-dark-blue mov-btn"
                    type="submit"
                    [disabled]="entradasPendentes().itens === 0"
                  >
                    <mat-icon>add_circle</mat-icon> Registrar entrada
                  </button>
                </div>
              </form>
            </mat-tab>

            <!-- ========================== ADICIONAR SAÍDA ======================== -->
            <mat-tab label="Saída">
              <form (submit)="$event.preventDefault(); salvarSaida()">
                <p class="aba-dica">
                  <mat-icon>remove_circle</mat-icon>
                  Digite quanto vai <b>sair</b> de cada item e o motivo (consumo, perda, limpeza…).
                </p>
                <div class="est-tabela-wrap">
                  <table class="est-tabela">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Categoria</th>
                        <th class="tr">Atual</th>
                        <th class="tr">Retirar</th>
                        <th class="tr">Futuro</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (i of filtradosComSaldo(); track i.id) {
                        <tr class="est-row" [class.marcada]="(saidaAdd()[i.id] ?? 0) > 0">
                          <td>
                            <strong class="est-item-nome">{{ i.nome }}</strong>
                          </td>
                          <td>
                            <span class="est-tipo">{{ categoriaNome(i.idcategoria) }}</span>
                          </td>
                          <td class="tr">
                            <span class="est-qtd">{{ i.quantidade }}</span>
                          </td>
                          <td class="tr">
                            <input
                              class="input-inn num"
                              type="number"
                              min="1"
                              [max]="i.quantidade"
                              [value]="saidaAdd()[i.id] ?? ''"
                              (input)="setSaida(i.id, $event)"
                              aria-label="Retirar quantidade"
                              placeholder="0"
                            />
                          </td>
                          <td class="tr">
                            <span class="est-futuro" [class.desce]="(saidaAdd()[i.id] ?? 0) > 0">
                              {{ i.quantidade - (saidaAdd()[i.id] ?? 0) }}
                            </span>
                          </td>
                          <td>
                            <input
                              class="input-inn motivo"
                              type="text"
                              [value]="saidaMotivo()[i.id] ?? ''"
                              (input)="setMotivo(i.id, $event)"
                              aria-label="Motivo da saída"
                              placeholder="Ex.: consumo do bar"
                            />
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="6" class="est-vazio">
                            <mat-icon>inventory_2</mat-icon>
                            <p>Nenhum item com saldo{{ termo() ? ' para essa busca' : '' }}.</p>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <div class="mov-resumo">
                  <div class="mov-resumo-txt">
                    <mat-icon>remove_circle</mat-icon>
                    @if (saidasPendentes().itens === 0) {
                      <span>Digite a quantidade nos itens acima para dar saída.</span>
                    } @else {
                      <span>
                        <b>{{ saidasPendentes().itens }}</b>
                        {{ saidasPendentes().itens === 1 ? ' item' : ' itens' }}
                        — total de
                        <b>{{ saidasPendentes().total }}</b>
                        {{ saidasPendentes().total === 1 ? ' unidade' : ' unidades' }}
                        para sair
                      </span>
                    }
                  </div>
                  <button
                    class="btn-dark-blue mov-btn"
                    type="submit"
                    [disabled]="saidasPendentes().itens === 0"
                  >
                    <mat-icon>remove_circle</mat-icon> Registrar saída
                  </button>
                </div>
              </form>
            </mat-tab>

            <!-- ========================== MOVIMENTAÇÕES ========================== -->
            <mat-tab label="Movimentações">
              <div class="est-tabela-wrap">
                <table class="est-tabela">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Item</th>
                      <th class="tc">Tipo</th>
                      <th class="tr">Qtd</th>
                      <th>Funcionário</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of movimentos(); track m.id) {
                      <tr class="est-row">
                        <td class="est-quando">{{ m.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                        <td>
                          <strong class="est-item-nome">{{ m.item_nome }}</strong>
                        </td>
                        <td class="tc">
                          <span class="st-chip" [class.off]="m.tipo === 'saida'">
                            {{ m.tipo === 'entrada' ? '↙ Entrada' : '↗ Saída' }}
                          </span>
                        </td>
                        <td class="tr">
                          <span class="est-qtd">{{ m.quantidade }}</span>
                        </td>
                        <td>{{ m.funcionario ?? '—' }}</td>
                        <td class="est-motivo">{{ m.motivo || '—' }}</td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="6" class="est-vazio">
                          <mat-icon>history</mat-icon>
                          <p>Nenhuma movimentação registrada ainda.</p>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>
          </mat-tab-group>
        </div>
      </div>
    </div>

    <!-- ============ Drawer Item (cadastrar/editar) ============ -->
    @if (drawerAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharDrawer()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">{{ editandoItem() ? 'Editar item' : 'Novo item' }}</h5>
              <p>
                {{
                  editandoItem() ? 'Atualize os dados do item' : 'Cadastre um produto do estoque'
                }}
              </p>
            </div>
            <button
              type="button"
              class="drawer-fechar"
              (click)="fecharDrawer()"
              aria-label="Fechar painel"
            >
              <mat-icon>close</mat-icon>
            </button>
          </header>

          <form
            [formGroup]="formItem"
            (ngSubmit)="salvarItem()"
            autocomplete="off"
            class="drawer-form"
          >
            <div class="drawer-body">
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>inventory_2</mat-icon> Dados do item</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="it-nome">Nome <small class="req">*</small></label>
                    <input
                      id="it-nome"
                      class="input-inn"
                      type="text"
                      formControlName="nome"
                      placeholder="Ex.: Água mineral 500ml"
                      [class.inval]="invalido('nome')"
                    />
                    @if (invalido('nome')) {
                      <small class="erro-campo">Informe o nome do item.</small>
                    }
                  </div>
                  <div class="campo">
                    <label class="lbl" for="it-cat">Categoria</label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                    >
                      <mat-select
                        id="it-cat"
                        formControlName="idcategoria"
                        placeholder="Sem categoria"
                      >
                        <mat-option [value]="null">Sem categoria</mat-option>
                        @for (c of categorias(); track c.id) {
                          @if (c.ativo || c.id === editandoItem()?.idcategoria) {
                            <mat-option [value]="c.id">{{ c.nome }}</mat-option>
                          }
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                  <div class="campo">
                    <label class="lbl" for="it-valor">Valor unitário</label>
                    <div class="input-group-inn">
                      <span class="addon">R$</span>
                      <input
                        id="it-valor"
                        class="input-inn"
                        type="number"
                        step="0.01"
                        min="0"
                        formControlName="valor_unitario"
                        placeholder="Ex.: 3,50"
                      />
                    </div>
                  </div>
                  @if (!editandoItem()) {
                    <div class="campo">
                      <label class="lbl" for="it-qtd">Quantidade inicial</label>
                      <input
                        id="it-qtd"
                        class="input-inn"
                        type="number"
                        min="0"
                        formControlName="quantidade_inicial"
                        placeholder="Ex.: 50"
                      />
                    </div>
                  }
                  <div class="campo">
                    <label class="lbl" for="it-un">Unidade</label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                    >
                      <mat-select id="it-un" formControlName="unidade">
                        @for (u of UNIDADES; track u) {
                          <mat-option [value]="u">{{ u }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                  <div class="campo">
                    <label class="lbl" for="it-min">Estoque mínimo</label>
                    <input
                      id="it-min"
                      class="input-inn"
                      type="number"
                      min="0"
                      formControlName="estoque_minimo"
                      placeholder="0 = sem alerta"
                    />
                  </div>
                  <div class="campo full">
                    <label class="chk-insumo">
                      <input type="checkbox" formControlName="eh_insumo" />
                      É insumo (não aparece para venda direta no PDV — usado em ficha técnica)
                    </label>
                  </div>
                </div>
                @if (editandoItem()) {
                  <p class="dsec-dica" style="margin-top: 10px">
                    Para alterar a quantidade, use as abas <b>Entrada</b> e <b>Saída</b> — assim a
                    movimentação fica registrada.
                  </p>
                }
              </section>
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharDrawer()">Cancelar</button>
                <button class="btn-dark-blue" type="submit">
                  <mat-icon>save</mat-icon>
                  {{ editandoItem() ? 'Salvar alterações' : 'Cadastrar item' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }

    <!-- ============ Modal Categorias ============ -->
    @if (modal() === 'categorias') {
      <div class="overlay" (click.self)="fecharModal()">
        <div
          class="modal-inn modal-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-cat"
        >
          <div class="modal-head">
            <h5 id="titulo-cat">Categorias do estoque</h5>
            <button type="button" class="close" (click)="fecharModal()" aria-label="Fechar">
              &times;
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-dica">
              As categorias agrupam os itens e definem para qual
              <b>impressora</b> sai o ticket de produção.
            </p>
            <form
              class="input-group-inn"
              style="margin-bottom: 12px"
              (submit)="$event.preventDefault(); criarCategoriaModal()"
            >
              <input
                class="input-inn"
                type="text"
                [formControl]="novaCategoria"
                placeholder="Nova categoria"
                aria-label="Nome da categoria"
              />
              <button class="btn-dark-blue" type="submit" [disabled]="novaCategoria.invalid">
                Adicionar
              </button>
            </form>
            <table class="plain bordered">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Impressora (setor)</th>
                  <th class="tc">Status</th>
                  <th class="tc">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (c of categorias(); track c.id) {
                  <tr>
                    <td>{{ c.id }}</td>
                    <td>{{ c.nome }}</td>
                    <td>
                      <mat-select
                        class="mat-sel mat-sel-sm"
                        [value]="c.impressora_id"
                        (selectionChange)="rotearCategoria(c, $event.value)"
                        aria-label="Impressora do setor"
                        placeholder="— sem ticket —"
                      >
                        <mat-option [value]="null">— sem ticket —</mat-option>
                        @for (p of impressoras(); track p.id) {
                          <mat-option [value]="p.id">{{ p.nome }} ({{ p.setor }})</mat-option>
                        }
                      </mat-select>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="st-chip"
                        [class.off]="!c.ativo"
                        [title]="c.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                        (click)="statusCategoria(c, !c.ativo)"
                      >
                        {{ c.ativo ? 'Ativo' : 'Inativo' }}
                      </button>
                    </td>
                    <td class="tc">
                      <button
                        type="button"
                        class="acao-btn perigo"
                        title="Excluir"
                        aria-label="Excluir categoria"
                        (click)="excluirCategoria(c)"
                      >
                        <mat-icon>delete</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="muted tc">Nenhuma categoria.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho da página ---------- */
    .est-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .est-titulo-grupo {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .eyebrow {
      margin: 0;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: #8fa3ab;
    }
    .est-titulo-linha {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .est-titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      letter-spacing: -0.01em;
    }
    .est-contador {
      font-size: 0.78rem;
      font-weight: 600;
      color: #054054;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .est-alerta {
      font-size: 0.78rem;
      font-weight: 600;
      color: #92670b;
      background: #fdf3e2;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .est-head-acoes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .est-head-acoes button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-tour {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #5d6d7e;
      border-radius: 4px;
      padding: 0 14px;
      min-height: 34px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition:
        border-color 0.15s ease,
        color 0.15s ease;
    }
    .btn-tour mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .btn-tour:hover {
      border-color: #054054;
      color: #054054;
    }

    /* ---------- banners de informação ---------- */
    .est-info {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .est-info-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 15px 16px;
      transition:
        box-shadow 0.15s ease,
        transform 0.15s ease;
    }
    .est-info-card:hover {
      box-shadow: 0 6px 18px rgba(5, 64, 84, 0.08);
      transform: translateY(-1px);
    }
    .est-info-icone {
      width: 38px;
      height: 38px;
      border-radius: 9px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #eef4f6;
      color: #054054;
    }
    .est-info-icone mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .est-info-txt {
      min-width: 0;
    }
    .est-info-txt strong {
      display: block;
      font-size: 0.9rem;
      font-weight: 700;
      color: #054054;
      margin-bottom: 3px;
    }
    .est-info-txt p {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .est-info-txt b {
      color: #40525d;
    }
    @media (max-width: 960px) {
      .est-info {
        grid-template-columns: 1fr;
      }
    }

    /* ---------- toolbar ---------- */
    .est-card {
      padding-top: 14px;
    }
    .est-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
      flex-wrap: wrap;
      margin-bottom: 14px;
      padding: 4px 2px;
    }
    .est-busca {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 240px;
      max-width: 460px;
      background: #fff;
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 0 10px;
      height: 40px;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .est-busca.foco {
      border-color: #054054;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.1);
    }
    .est-busca-icone {
      color: #7d97a1;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .est-busca-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9rem;
      color: #33424c;
      font-family: inherit;
      height: 100%;
    }
    .est-busca-input::placeholder {
      color: #8fa3ab;
    }
    .est-busca-input::-webkit-search-cancel-button {
      display: none;
    }
    .est-limpar {
      border: none;
      background: #eef2f5;
      border-radius: 50%;
      width: 22px;
      height: 22px;
      cursor: pointer;
      color: #5d6d7e;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .est-limpar mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .est-limpar:hover {
      background: #d7e0e6;
    }

    .est-toggle {
      display: inline-flex;
      align-items: center;
      gap: 14px;
      border: 1px solid #d7e0e6;
      background: #fff;
      border-radius: 999px;
      padding: 8px 20px 8px 12px;
      font-size: 0.84rem;
      font-weight: 600;
      color: #5d6d7e;
      cursor: pointer;
      font-family: inherit;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    .est-trilho {
      width: 34px;
      height: 19px;
      border-radius: 999px;
      background: #c3d2d9;
      position: relative;
      transition: background 0.18s;
      flex-shrink: 0;
    }
    .est-bolinha {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      transition: transform 0.18s;
    }
    .est-toggle.on {
      border-color: #054054;
      color: #054054;
    }
    .est-toggle.on .est-trilho {
      background: #054054;
    }
    .est-toggle.on .est-bolinha {
      transform: translateX(16px);
    }

    /* ---------- tabelas ---------- */
    .est-tabela-wrap {
      overflow-x: auto;
      border-radius: 8px;
      margin-top: 12px;
    }
    .est-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .est-tabela thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-align: left;
      padding: 14px 14px;
      border-bottom: 1px solid #d7e0e6;
      white-space: nowrap;
    }
    .est-tabela tbody td {
      padding: 14px;
      border-bottom: 1px solid #eef2f5;
      color: #2c3a44;
      vertical-align: middle;
      white-space: nowrap;
    }
    .est-row {
      transition: background 0.12s;
    }
    .est-row:hover {
      background: #f4f8fa;
    }
    .est-row.marcada {
      background: rgba(5, 64, 84, 0.05);
    }
    .est-row:last-child td {
      border-bottom: none;
    }
    .tc {
      text-align: center;
    }
    .tr {
      text-align: right;
    }
    .est-th-nome {
      min-width: 220px;
    }

    .est-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 200px;
    }
    .est-item-icone {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      flex-shrink: 0;
      background: #eef4f6;
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .est-item-icone mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .est-cell-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.3;
    }
    .est-cell-txt strong {
      color: #054054;
      font-weight: 600;
      font-size: 0.95rem;
    }
    .est-cell-txt small {
      color: #7d97a1;
      font-size: 0.8rem;
    }
    .est-item-nome {
      color: #054054;
      font-weight: 600;
      font-size: 0.92rem;
    }
    .est-tipo {
      font-size: 0.78rem;
      font-weight: 600;
      color: #5d6d7e;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .est-qtd {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: #054054;
      font-size: 0.95rem;
    }
    .est-qtd.zero {
      color: #92670b;
    }
    .est-tag-zero {
      display: inline-block;
      margin-left: 6px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #92670b;
      background: #fdf3e2;
      border-radius: 999px;
      padding: 2px 8px;
    }
    .est-valor {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: #054054;
    }
    .est-futuro {
      display: inline-block;
      min-width: 34px;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: #8fa3ab;
    }
    .est-futuro.sobe {
      color: #054054;
    }
    .est-futuro.desce {
      color: #92670b;
    }
    .est-quando {
      color: #7d97a1;
      font-variant-numeric: tabular-nums;
    }
    .est-motivo {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #5d6d7e;
      font-size: 0.86rem;
    }

    .num {
      width: 96px;
      text-align: right;
    }
    .motivo {
      min-width: 200px;
    }

    /* ---------- barra de ação das abas Entrada/Saída ---------- */
    .mov-resumo {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      margin-top: 16px;
      padding: 16px 14px;
      background: #f4f8fa;
      border: 1px solid #e3eaef;
      border-radius: 12px;
    }
    .mov-resumo-txt {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.85rem;
      color: #5d6d7e;
    }
    .mov-resumo-txt mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #054054;
    }
    .mov-resumo-txt b {
      color: #054054;
    }
    .mov-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-width: 240px;
      padding: 0.68rem 1.5rem;
      font-size: 0.95rem;
      font-weight: 700;
    }
    .mov-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .aba-dica {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px 0 0;
      padding: 10px 14px;
      background: #f4f8fa;
      border: 1px dashed #c3d4dc;
      border-radius: 10px;
      font-size: 0.84rem;
      color: #40525d;
    }
    .aba-dica mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #054054;
    }

    .est-tabela .acao-btn {
      margin: 0 2px;
    }
    .acao-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid #d7e0e6;
      border-radius: 7px;
      background: #fff;
      color: #5d6d7e;
      cursor: pointer;
      transition:
        border-color 0.15s,
        color 0.15s,
        background 0.15s;
    }
    .acao-btn mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .acao-btn:hover {
      border-color: #054054;
      color: #054054;
    }
    .acao-btn.perigo:hover {
      border-color: #b3261e;
      color: #b3261e;
      background: #fdf3f2;
    }
    .st-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid #d7e0e6;
      border-radius: 999px;
      background: #eef4f6;
      color: #054054;
      padding: 6px 14px;
      font-size: 0.8rem;
      font-weight: 600;
      font-family: inherit;
      transition:
        border-color 0.15s,
        background 0.15s;
    }
    button.st-chip {
      cursor: pointer;
    }
    button.st-chip:hover {
      border-color: #054054;
    }
    .st-chip.off {
      background: #f4f6f8;
      color: #7d97a1;
    }

    /* ---------- estado vazio ---------- */
    .est-vazio {
      text-align: center;
      padding: 40px 16px !important;
      color: #7d97a1;
    }
    .est-vazio mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #c3d2d9;
      margin-bottom: 8px;
    }
    .est-vazio p {
      margin: 0 0 14px;
      font-size: 0.9rem;
    }

    /* ---------- skeleton ---------- */
    .skel-row td {
      border-bottom: 1px solid #eef2f5;
    }
    .skel {
      display: inline-block;
      border-radius: 6px;
      background: linear-gradient(90deg, #eef2f5 25%, #e3eaef 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    .skel-icone {
      width: 42px;
      height: 42px;
      border-radius: 10px;
    }
    .skel-nome {
      width: 150px;
      height: 14px;
      margin-left: 10px;
      vertical-align: middle;
    }
    .skel-txt {
      width: 90px;
      height: 13px;
    }
    .skel-chip {
      width: 62px;
      height: 24px;
      border-radius: 999px;
    }
    .skel-acoes {
      width: 80px;
      height: 26px;
    }

    /* ---------- modal categorias ---------- */
    .modal-md {
      max-width: 640px;
    }
    .modal-dica {
      margin: 0 0 12px;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .modal-foot {
      display: flex;
      justify-content: flex-end;
      padding: 10px 14px;
      border-top: 1px solid #d7e0e6;
    }

    /* ---------- drawer lateral ---------- */
    .overlay {
      z-index: 310;
    }
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 320;
      background: rgba(5, 32, 43, 0.45);
      animation: fadeIn 0.18s ease-out;
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
    }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 321;
      width: min(480px, 100vw);
      background: #f7fafb;
      box-shadow: -12px 0 40px rgba(3, 32, 43, 0.28);
      display: flex;
      flex-direction: column;
      animation: drawerIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    @keyframes drawerIn {
      from {
        transform: translateX(64px);
        opacity: 0.4;
      }
      to {
        transform: none;
        opacity: 1;
      }
    }
    .drawer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px;
      background: #fff;
      border-bottom: 1px solid #e3eaef;
      flex-shrink: 0;
    }
    .drawer-head-txt h5 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #054054;
    }
    .drawer-head-txt p {
      margin: 3px 0 0;
      font-size: 0.8rem;
      color: #7d97a1;
    }
    .drawer-fechar {
      border: none;
      background: #eef2f5;
      border-radius: 8px;
      width: 34px;
      height: 34px;
      cursor: pointer;
      color: #5d6d7e;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .drawer-fechar:hover {
      background: #d7e0e6;
      color: #054054;
    }
    .drawer-fechar mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .drawer-form {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 18px 22px;
    }
    .dsec {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .dsec-tit {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #40525d;
      margin-bottom: 12px;
    }
    .dsec-tit mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .dsec-dica {
      margin: 0;
      font-size: 0.76rem;
      color: #8a99a4;
      line-height: 1.5;
    }
    .dsec-dica b {
      color: #40525d;
    }
    .dgrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 14px;
    }
    .dgrid .full {
      grid-column: 1 / -1;
    }
    .campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .campo .lbl {
      font-size: 0.8rem;
      font-weight: 600;
      color: #40525d;
    }
    .campo .req,
    .drawer-req .req {
      color: #dc3545;
    }
    .erro-campo {
      color: #dc3545;
      font-size: 0.74rem;
      font-weight: 500;
    }
    .input-inn.inval {
      border-color: #dc3545;
      box-shadow: 0 0 0 2px rgba(220, 53, 69, 0.12);
    }

    .input-group-inn {
      display: flex;
      align-items: stretch;
    }
    .input-group-inn .addon {
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.8rem;
      background: #5d6d7e;
      color: #fff;
      border: 1px solid #5d6d7e;
      border-radius: 4px 0 0 4px;
    }
    .input-group-inn .input-inn {
      border-radius: 0 4px 4px 0;
      flex: 1;
    }

    /* (mat-form-field/mat-select estilizados globalmente em styles.css) */

    .drawer-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 22px;
      background: #fff;
      border-top: 1px solid #e3eaef;
      flex-shrink: 0;
    }
    .drawer-req {
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .drawer-foot-acoes {
      display: flex;
      gap: 8px;
    }
    .drawer-foot-acoes .btn-dark-blue,
    .drawer-foot-acoes .btn-gray {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0.5rem 1rem;
    }
    .drawer-foot-acoes mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    @media (max-width: 640px) {
      .est-head {
        flex-direction: column;
        align-items: stretch;
      }
      .est-head-acoes {
        justify-content: stretch;
      }
      .est-head-acoes button {
        flex: 1;
        justify-content: center;
      }
      .est-busca {
        max-width: none;
      }
    }
  `,
})
export class EstoqueComponent extends EstoqueStore {}
