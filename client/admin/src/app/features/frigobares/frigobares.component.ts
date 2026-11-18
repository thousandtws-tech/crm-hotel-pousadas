// UI de frigobares — template, estilos e bindings. A lógica vive em frigobares.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num';
import { Frigobar } from '@core/models/frigobares.models';
import { FrigobaresStore } from './frigobares.store';

@Component({
  selector: 'app-frigobares',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [DecimalPipe, ReactiveFormsModule, MatIconModule, MatSelectModule, MatFormFieldModule],
  template: `
    <div class="page">
      <div class="fr-head">
        <div class="fr-titulo-grupo">
          <p class="eyebrow">Cadastro</p>
          <div class="fr-titulo-linha">
            <h2 class="fr-titulo">Frigobares</h2>
            <span class="fr-contador" title="Total de frigobares e quantos ativos">
              {{ frigobares().length }}
              {{ frigobares().length === 1 ? 'frigobar' : 'frigobares' }} · {{ ativos() }}
              {{ ativos() === 1 ? 'ativo' : 'ativos' }}
            </span>
          </div>
        </div>
        <div class="fr-head-acoes">
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
            <mat-icon>school</mat-icon> Tutorial
          </button>
          <button id="tour-novo" class="btn-dark-blue" type="button" (click)="abrirForm()">
            <mat-icon>add_box</mat-icon> Novo frigobar
          </button>
        </div>
      </div>

      <div class="fr-info">
        <div class="fr-info-card">
          <span class="fr-info-icone"><mat-icon>kitchen</mat-icon></span>
          <div class="fr-info-txt">
            <strong>Um frigobar por acomodação</strong>
            <p>
              Cada frigobar fica vinculado a uma acomodação e guarda os produtos oferecidos ao
              hóspede.
            </p>
          </div>
        </div>
        <div class="fr-info-card">
          <span class="fr-info-icone"><mat-icon>add_shopping_cart</mat-icon></span>
          <div class="fr-info-txt">
            <strong>Reposição sai do estoque</strong>
            <p>
              No <b>ícone de olho</b> você repõe itens — a quantidade é descontada do estoque
              automaticamente.
            </p>
          </div>
        </div>
        <div class="fr-info-card">
          <span class="fr-info-icone"><mat-icon>receipt_long</mat-icon></span>
          <div class="fr-info-txt">
            <strong>Consumo na conta</strong>
            <p>O que o hóspede consome é lançado na conta da reserva e cobrado no check-out.</p>
          </div>
        </div>
      </div>

      <div class="inner-card fr-card">
        <div class="fr-toolbar">
          <div id="tour-busca" class="fr-busca" [class.foco]="buscaFoco()">
            <mat-icon class="fr-busca-icone">search</mat-icon>
            <input
              class="fr-busca-input"
              type="search"
              [formControl]="busca"
              placeholder="Buscar por modelo, patrimônio ou acomodação…"
              aria-label="Buscar frigobar"
              autocomplete="off"
              (focus)="buscaFoco.set(true)"
              (blur)="buscaFoco.set(false)"
            />
            @if (termo()) {
              <button
                type="button"
                class="fr-limpar"
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
            class="fr-toggle"
            [class.on]="apenasAtivos()"
            role="switch"
            [attr.aria-checked]="apenasAtivos()"
            (click)="apenasAtivos.set(!apenasAtivos())"
          >
            <span class="fr-trilho"><span class="fr-bolinha"></span></span>
            Somente ativos
          </button>
        </div>

        <div id="tour-tabela" class="fr-tabela-wrap">
          <table class="fr-tabela">
            <thead>
              <tr>
                <th>Frigobar</th>
                <th>Acomodação</th>
                <th class="tc">Status</th>
                <th class="tc">Ações</th>
              </tr>
            </thead>
            <tbody>
              @if (carregando()) {
                @for (s of skel; track s) {
                  <tr class="skel-row">
                    <td>
                      <span class="skel skel-ic"></span>
                      <span class="skel skel-nome"></span>
                    </td>
                    <td><span class="skel skel-txt"></span></td>
                    <td class="tc"><span class="skel skel-chip"></span></td>
                    <td class="tc"><span class="skel skel-acoes"></span></td>
                  </tr>
                }
              } @else {
                @for (f of filtrados(); track f.id) {
                  <tr class="fr-row">
                    <td>
                      <div class="fr-cell">
                        <span class="fr-ic"><mat-icon>kitchen</mat-icon></span>
                        <span class="fr-cell-txt">
                          <strong>{{ f.modelo || 'Frigobar #' + f.id }}</strong>
                          <small>
                            @if (f.patrimonio) {
                              Patrimônio {{ f.patrimonio }} ·
                            }
                            #{{ f.id }}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span class="fr-acom">
                        {{ nomeAcomodacao(f.idacomodacao) }}
                        <small>Nº {{ numAcomodacao(f.idacomodacao) }}</small>
                      </span>
                    </td>
                    <td class="tc">
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="st-chip"
                          [class.off]="!f.ativo"
                          [title]="f.ativo ? 'Clique para desativar' : 'Clique para ativar'"
                          (click)="statusFrigobar(f, !f.ativo)"
                        >
                          {{ f.ativo ? 'Ativo' : 'Inativo' }}
                        </button>
                      } @else {
                        <span class="st-chip" [class.off]="!f.ativo">{{
                          f.ativo ? 'Ativo' : 'Inativo'
                        }}</span>
                      }
                    </td>
                    <td class="tc fr-acoes">
                      <button
                        type="button"
                        class="acao-btn"
                        title="Editar"
                        aria-label="Editar frigobar"
                        (click)="abrirForm(f)"
                      >
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button
                        type="button"
                        class="acao-btn fr-ver"
                        title="Ver itens e repor"
                        aria-label="Ver itens do frigobar"
                        (click)="ver(f)"
                      >
                        <mat-icon>visibility</mat-icon>
                      </button>
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="acao-btn perigo"
                          title="Excluir"
                          aria-label="Excluir frigobar"
                          (click)="excluirFrigobar(f)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="4" class="fr-vazio">
                      <mat-icon>kitchen</mat-icon>
                      <p>
                        {{
                          termo() || apenasAtivos()
                            ? 'Nenhum frigobar encontrado para esses filtros.'
                            : 'Nenhum frigobar cadastrado ainda.'
                        }}
                      </p>
                      @if (!termo() && !apenasAtivos()) {
                        <button class="btn-dark-blue" type="button" (click)="abrirForm()">
                          <mat-icon>add_box</mat-icon> Cadastrar o primeiro frigobar
                        </button>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ============ Drawer Frigobar (criar/editar) ============ -->
    @if (drawerAberto()) {
      <div class="drawer-backdrop" (click.self)="fecharDrawer()">
        <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="titulo-drawer">
          <header class="drawer-head">
            <div class="drawer-head-txt">
              <h5 id="titulo-drawer">{{ editando() ? 'Editar frigobar' : 'Novo frigobar' }}</h5>
              <p>
                {{
                  editando()
                    ? 'Atualize os dados do frigobar'
                    : 'Preencha os dados para cadastrar o frigobar'
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

          <form [formGroup]="form" (ngSubmit)="salvar()" autocomplete="off" class="drawer-form">
            <div class="drawer-body">
              <section class="dsec">
                <div class="dsec-tit"><mat-icon>kitchen</mat-icon> Identificação</div>
                <div class="dgrid">
                  <div class="campo full">
                    <label class="lbl" for="fr-modelo">Modelo</label>
                    <input
                      id="fr-modelo"
                      class="input-inn"
                      type="text"
                      formControlName="modelo"
                      placeholder="Ex.: Consul 80L"
                    />
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="fr-pat">Patrimônio</label>
                    <input
                      id="fr-pat"
                      class="input-inn"
                      type="text"
                      formControlName="patrimonio"
                      placeholder="Ex.: 000123"
                    />
                  </div>
                  <div class="campo full">
                    <label class="lbl" for="fr-ac">Acomodação <small class="req">*</small></label>
                    <mat-form-field
                      appearance="outline"
                      subscriptSizing="dynamic"
                      class="campo-mat"
                      [class.err]="invalido('idacomodacao')"
                    >
                      <mat-select
                        id="fr-ac"
                        formControlName="idacomodacao"
                        placeholder="Selecione…"
                      >
                        @for (a of acomodacoesSel(); track a.id) {
                          <mat-option [value]="a.id"> {{ a.nome }} (Nº {{ a.numero }}) </mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    @if (invalido('idacomodacao')) {
                      <small class="erro-campo">Escolha a acomodação.</small>
                    }
                  </div>
                </div>
              </section>
            </div>

            <footer class="drawer-foot">
              <span class="drawer-req"><small class="req">*</small> Campos obrigatórios</span>
              <div class="drawer-foot-acoes">
                <button class="btn-gray" type="button" (click)="fecharDrawer()">Cancelar</button>
                <button class="btn-dark-blue" type="submit">
                  <mat-icon>save</mat-icon>
                  {{ editando() ? 'Salvar alterações' : 'Cadastrar frigobar' }}
                </button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
    }

    <!-- ============ Modal detalhe do frigobar ============ -->
    @if (detalhe(); as f) {
      <div class="overlay" (click.self)="fecharDetalhe()">
        <div class="modal-inn modal-fr" role="dialog" aria-modal="true" aria-labelledby="titulo-fr">
          <div class="modal-head">
            <h5 id="titulo-fr" class="fr-det-titulo">
              <span class="fr-det-ic"><mat-icon>kitchen</mat-icon></span>
              {{ f.modelo || 'Frigobar #' + f.id }}
              <span class="st-chip" [class.off]="!f.ativo">{{
                f.ativo ? 'Ativo' : 'Inativo'
              }}</span>
            </h5>
            <button type="button" class="close" (click)="fecharDetalhe()" aria-label="Fechar">
              &times;
            </button>
          </div>
          <div class="modal-body">
            <!-- Resumo do frigobar -->
            <div class="det-faixa">
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>kitchen</mat-icon></span>
                <span class="det-item-txt">
                  <small>Modelo</small>
                  <strong>{{ f.modelo || '—' }}</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>tag</mat-icon></span>
                <span class="det-item-txt">
                  <small>Patrimônio</small>
                  <strong>{{ f.patrimonio || '—' }}</strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>hotel</mat-icon></span>
                <span class="det-item-txt">
                  <small>Acomodação</small>
                  <strong>
                    {{ nomeAcomodacao(f.idacomodacao) }} · Nº {{ numAcomodacao(f.idacomodacao) }}
                  </strong>
                </span>
              </span>
              <span class="det-item">
                <span class="det-item-ic"><mat-icon>inventory_2</mat-icon></span>
                <span class="det-item-txt">
                  <small>Itens no frigobar</small>
                  <strong
                    >{{ totalItens() }} {{ totalItens() === 1 ? 'unidade' : 'unidades' }}</strong
                  >
                </span>
              </span>
            </div>

            <h4><mat-icon>add_shopping_cart</mat-icon> Repor item</h4>
            <p class="det-dica">
              Escolha a categoria e o item — a quantidade sai do estoque na hora.
            </p>
            <div class="fr-add">
              <mat-form-field
                appearance="outline"
                subscriptSizing="dynamic"
                class="campo-mat fr-add-cat"
              >
                <mat-select
                  [value]="categoriaSel()"
                  (selectionChange)="categoriaSel.set($event.value); itemSel.set(null)"
                  placeholder="Todas as categorias"
                  aria-label="Categoria do item"
                >
                  <mat-option value="">Todas as categorias</mat-option>
                  @for (c of categorias(); track c.id) {
                    <mat-option [value]="c.id">{{ c.nome }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field
                appearance="outline"
                subscriptSizing="dynamic"
                class="campo-mat fr-add-item"
              >
                <mat-select
                  [(value)]="itemSel"
                  placeholder="Escolha o item"
                  aria-label="Item do estoque"
                >
                  @for (i of itensDaCategoria(); track i.id) {
                    <mat-option [value]="i.id">
                      {{ i.nome }} (saldo: {{ i.quantidade }})
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <div class="input-group-inn fr-add-qtd">
                <span class="addon"><mat-icon>tag</mat-icon></span>
                <input
                  class="input-inn"
                  type="number"
                  min="1"
                  [value]="qtdSel()"
                  (input)="qtdSel.set(numeroDe($event) || 1)"
                  aria-label="Quantidade"
                />
              </div>
              <button
                class="btn-dark-blue fr-add-btn"
                type="button"
                [disabled]="!itemSel() || qtdSel() < 1"
                (click)="repor(f.id)"
              >
                <mat-icon>add</mat-icon> Adicionar
              </button>
            </div>

            <h4><mat-icon>inventory_2</mat-icon> Itens do frigobar</h4>
            <p class="det-dica">
              Use <b>−</b> e <b>+</b> para ajustar a quantidade — consumo do hóspede é lançado pela
              tela da reserva.
            </p>
            <div class="fr-itens-wrap">
              <table class="fr-tabela fr-tabela-itens">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Categoria</th>
                    <th class="tc">Quantidade</th>
                    <th>Valor unitário</th>
                    <th class="tc">Status</th>
                    <th class="tc">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  @for (i of itens(); track i.id) {
                    <tr>
                      <td>
                        <strong class="fr-item-nome">{{ i.item_nome }}</strong>
                      </td>
                      <td>
                        <span class="fr-cat">{{ categoriaDeItem(i.iditem) }}</span>
                      </td>
                      <td class="tc">
                        <span class="qtd-ctl">
                          <button
                            class="qtd-btn"
                            type="button"
                            aria-label="Diminuir quantidade"
                            (click)="ajustar(i, -1)"
                          >
                            <mat-icon>remove</mat-icon>
                          </button>
                          <strong class="qtd-num">{{ i.quantidade }}</strong>
                          <button
                            class="qtd-btn"
                            type="button"
                            aria-label="Aumentar quantidade"
                            (click)="ajustar(i, 1)"
                          >
                            <mat-icon>add</mat-icon>
                          </button>
                        </span>
                      </td>
                      <td>
                        <span class="fr-valor"
                          >R$ {{ num(i.valor_unitario) | number: '1.2-2' }}</span
                        >
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
                      <td class="tc">
                        <button
                          class="btn-del"
                          type="button"
                          title="Remover do frigobar"
                          aria-label="Remover {{ i.item_nome }} do frigobar"
                          (click)="removerItem(i)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="fr-vazio">
                        <mat-icon>inventory_2</mat-icon>
                        <p>Frigobar vazio — use o painel acima para repor itens.</p>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* ---------- cabeçalho da página ---------- */
    .fr-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .fr-titulo-grupo {
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
    .fr-titulo-linha {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }
    .fr-titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      letter-spacing: -0.01em;
    }
    .fr-contador {
      font-size: 0.78rem;
      font-weight: 600;
      color: #054054;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .fr-head-acoes {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .fr-head-acoes button {
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
    .fr-info {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }
    .fr-info-card {
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
    .fr-info-card:hover {
      box-shadow: 0 6px 18px rgba(5, 64, 84, 0.08);
      transform: translateY(-1px);
    }
    .fr-info-icone {
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
    .fr-info-icone mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .fr-info-txt {
      min-width: 0;
    }
    .fr-info-txt strong {
      display: block;
      font-size: 0.9rem;
      font-weight: 700;
      color: #054054;
      margin-bottom: 3px;
    }
    .fr-info-txt p {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #7d97a1;
    }
    .fr-info-txt b {
      color: #40525d;
    }
    @media (max-width: 960px) {
      .fr-info {
        grid-template-columns: 1fr;
      }
    }

    /* ---------- toolbar ---------- */
    .fr-card {
      padding-top: 14px;
    }
    .fr-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 28px;
      flex-wrap: wrap;
      margin-bottom: 18px;
      padding: 4px 2px;
    }
    .fr-busca {
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
    .fr-busca.foco {
      border-color: #054054;
      box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.1);
    }
    .fr-busca-icone {
      color: #7d97a1;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .fr-busca-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 0.9rem;
      color: #33424c;
      font-family: inherit;
      height: 100%;
    }
    .fr-busca-input::placeholder {
      color: #8fa3ab;
    }
    .fr-busca-input::-webkit-search-cancel-button {
      display: none;
    }
    .fr-limpar {
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
    .fr-limpar mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .fr-limpar:hover {
      background: #d7e0e6;
    }

    .fr-toggle {
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
    .fr-trilho {
      width: 34px;
      height: 19px;
      border-radius: 999px;
      background: #c3d2d9;
      position: relative;
      transition: background 0.18s;
      flex-shrink: 0;
    }
    .fr-bolinha {
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
    .fr-toggle.on {
      border-color: #054054;
      color: #054054;
    }
    .fr-toggle.on .fr-trilho {
      background: #054054;
    }
    .fr-toggle.on .fr-bolinha {
      transform: translateX(16px);
    }

    /* ---------- tabela ---------- */
    .fr-tabela-wrap {
      overflow-x: auto;
      border-radius: 8px;
      min-height: 42vh;
    }
    .fr-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .fr-tabela thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 14px 16px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .fr-tabela tbody td {
      padding: 16px;
      border-bottom: 1px solid #eef2f5;
      vertical-align: middle;
      color: #33424c;
    }
    .fr-tabela tbody tr:hover {
      background: #f7fafb;
    }
    .fr-tabela .tc {
      text-align: center;
    }
    .fr-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .fr-ic {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      flex-shrink: 0;
      background: rgba(5, 64, 84, 0.08);
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .fr-ic mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .fr-cell-txt {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .fr-cell-txt strong {
      font-size: 0.95rem;
      color: #054054;
      font-weight: 700;
    }
    .fr-cell-txt small {
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .fr-acom {
      display: inline-flex;
      flex-direction: column;
    }
    .fr-acom small {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .fr-tabela .acao-btn {
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

    /* ---------- estado vazio / skeleton ---------- */
    .fr-vazio {
      text-align: center;
      padding: 40px 16px !important;
      color: #7d97a1;
    }
    .fr-vazio mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #c3d2d9;
      margin-bottom: 8px;
    }
    .fr-vazio p {
      margin: 0 0 14px;
      font-size: 0.9rem;
    }
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
    .skel-ic {
      width: 42px;
      height: 42px;
      border-radius: 10px;
    }
    .skel-nome {
      width: 150px;
      height: 14px;
      margin-left: 12px;
      vertical-align: middle;
    }
    .skel-txt {
      width: 110px;
      height: 13px;
    }
    .skel-chip {
      width: 62px;
      height: 24px;
      border-radius: 999px;
    }
    .skel-acoes {
      width: 110px;
      height: 26px;
    }

    /* ---------- drawer lateral ---------- */
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
      width: min(540px, 100vw);
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
    .input-group-inn .addon mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .input-group-inn .input-inn {
      border-radius: 0 4px 4px 0;
      flex: 1;
    }

    /* ---------- modal detalhe do frigobar ---------- */
    .overlay {
      z-index: 310;
    }
    .modal-fr {
      max-width: 860px;
      width: calc(100vw - 32px);
    }
    .modal-fr .modal-body {
      max-height: 78vh;
      overflow-y: auto;
    }
    .fr-det-titulo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fr-det-ic {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      flex-shrink: 0;
      background: rgba(5, 64, 84, 0.1);
      color: #054054;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .fr-det-ic mat-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
    }
    .modal-fr h4 {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #40525d;
      margin: 18px 0 10px;
    }
    .modal-fr h4 mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .det-dica {
      margin: -4px 0 10px;
      font-size: 0.76rem;
      color: #8a99a4;
      line-height: 1.5;
    }
    .det-dica b {
      color: #40525d;
    }

    /* faixa-resumo — itens fluem sem truncar */
    .det-faixa {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 24px;
      background: #f7fafb;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 12px 18px;
      margin: 0 0 4px;
    }
    .det-item {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }
    .det-item-ic {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #eef4f6;
      color: #054054;
    }
    .det-item-ic mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .det-item-txt {
      display: flex;
      flex-direction: column;
      line-height: 1.15;
    }
    .det-item-txt small {
      font-size: 0.66rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #7d97a1;
    }
    .det-item-txt strong {
      font-size: 0.9rem;
      color: #054054;
      font-weight: 700;
      white-space: nowrap;
    }

    /* faixa de reposição de item */
    .fr-add {
      display: flex;
      align-items: stretch;
      gap: 10px;
      flex-wrap: wrap;
      background: #f4f8fa;
      border: 1px solid #e0ebf0;
      border-radius: 10px;
      padding: 12px;
    }
    .fr-add-cat {
      width: 200px;
    }
    .fr-add-item {
      flex: 1;
      min-width: 200px;
    }
    .fr-add .campo-mat {
      margin: 0;
    }
    .fr-add-qtd {
      width: 110px;
    }
    .fr-add-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 4px;
      padding: 0 18px;
      font-size: 0.85rem;
    }
    .fr-add-btn mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    /* itens do frigobar */
    .fr-itens-wrap {
      overflow-x: auto;
      border-radius: 8px;
    }
    .fr-tabela-itens .fr-item-nome {
      color: #054054;
      font-size: 0.9rem;
    }
    .fr-cat {
      font-size: 0.78rem;
      font-weight: 600;
      color: #5d6d7e;
      background: #eef4f6;
      border-radius: 999px;
      padding: 3px 10px;
      white-space: nowrap;
    }
    .fr-valor {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: #054054;
    }
    .qtd-ctl {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #f2f6f8;
      border: 1px solid #dfe8ed;
      border-radius: 999px;
      padding: 3px 6px;
    }
    .qtd-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: #fff;
      color: #054054;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(5, 64, 84, 0.15);
      transition:
        background 0.15s,
        color 0.15s;
    }
    .qtd-btn mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .qtd-btn:hover {
      background: #054054;
      color: #fff;
    }
    .qtd-num {
      min-width: 22px;
      text-align: center;
      font-size: 0.92rem;
      font-variant-numeric: tabular-nums;
      color: #054054;
    }
    .btn-del {
      background: none;
      border: none;
      cursor: pointer;
      color: #7d97a1;
      padding: 4px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      transition:
        color 0.15s,
        background 0.15s;
    }
    .btn-del mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .btn-del:hover {
      color: #054054;
      background: rgba(5, 64, 84, 0.08);
    }

    @media (max-width: 640px) {
      .fr-head {
        flex-direction: column;
        align-items: stretch;
      }
      .fr-head-acoes {
        justify-content: stretch;
      }
      .fr-head-acoes button {
        flex: 1;
        justify-content: center;
      }
      .fr-busca {
        max-width: none;
      }
      .fr-add-cat,
      .fr-add-qtd {
        width: 100%;
      }
    }
  `,
})
export class FrigobaresComponent extends FrigobaresStore {}
