// UI de pdv — template, estilos e bindings. A lógica vive em pdv.store.ts.
import { Component, ElementRef, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { PdvStore } from './pdv.store';

@Component({
  selector: 'app-pdv',
  host: { '(document:keydown.escape)': 'fecharModais()' },
  imports: [DatePipe, ReactiveFormsModule, MatIconModule],
  template: `
    <div class="page">
      <header class="pdv-head">
        <div>
          <p class="eyebrow">Operação</p>
          <h2 class="titulo">PDV &amp; Comandas</h2>
          <p class="sub">Mesas, quartos e balcão. Tudo para atender sem complicar.</p>
        </div>
      </header>
      <nav class="abas" aria-label="Seções do PDV">
        @for (a of abas; track a.id) {
          <button type="button" class="aba" [class.ativa]="aba() === a.id" (click)="mudarAba(a.id)">
            <mat-icon>{{ a.icone }}</mat-icon> {{ a.rotulo }}
          </button>
        }
      </nav>

      <!-- =========================================== aba: mesas · workspace -->
      @if (aba() === 'mesas') {
        @if (!comanda()) {
          <!-- ============ VISÃO SALÃO — grade de atendimentos ============ -->
          <div class="salao">
            <div class="salao-tools card0">
              <div class="seg3" role="group" aria-label="Tipo de atendimento">
                @for (t of tiposAtend; track t.id) {
                  <button
                    type="button"
                    class="seg3-btn"
                    [class.ativo]="tipoAtend() === t.id"
                    (click)="tipoAtend.set(t.id)"
                  >
                    {{ t.rotulo }}
                  </button>
                }
              </div>
              <div class="salao-busca">
                <mat-icon>search</mat-icon>
                <input
                  class="salao-inp"
                  type="search"
                  placeholder="Mesa, quarto ou comanda"
                  [value]="buscaAtend()"
                  (input)="buscaAtend.set($any($event.target).value)"
                  aria-label="Buscar mesa, quarto ou comanda"
                  autocomplete="off"
                />
              </div>
              @if (tipoAtend() !== 'balcao') {
                <select
                  class="inp sm"
                  [value]="filtroLista()"
                  aria-label="Filtrar atendimentos"
                  (change)="filtroLista.set($any($event.target).value)"
                >
                  <option value="todas">
                    {{ tipoAtend() === 'mesa' ? 'Todas as mesas' : 'Todos os quartos' }}
                  </option>
                  <option value="livre">
                    {{ tipoAtend() === 'mesa' ? 'Livres' : 'Sem comanda' }}
                  </option>
                  <option value="ocupada">Com consumo</option>
                </select>
              }
              @if (tipoAtend() === 'mesa') {
                <button type="button" class="btn-mini-cta" (click)="novaMesa.set(!novaMesa())">
                  <mat-icon>add</mat-icon> Nova mesa
                </button>
              }
            </div>

            @if (novaMesa() && tipoAtend() === 'mesa') {
              <form
                class="mini-form salao-mesa-form"
                [formGroup]="mesaForm"
                (ngSubmit)="criarMesa()"
              >
                <input
                  class="inp"
                  formControlName="numero"
                  placeholder="Número/nome *"
                  aria-label="Número da mesa"
                />
                <input
                  class="inp n"
                  formControlName="lugares"
                  type="number"
                  min="1"
                  placeholder="Lugares"
                  aria-label="Lugares"
                />
                <button class="btn-prim" type="submit" [disabled]="mesaForm.invalid">
                  <mat-icon>check</mat-icon> Criar mesa
                </button>
              </form>
            }

            <!-- abertura rápida — tocou num atendimento livre -->
            @if (selecao(); as sel) {
              <form class="quick" [formGroup]="abrirForm" (ngSubmit)="abrirComanda()">
                <p class="quick-t">
                  <mat-icon>receipt</mat-icon>
                  {{
                    sel.tipo === 'mesa'
                      ? 'Abrir comanda — Mesa ' + sel.rotulo
                      : sel.tipo === 'quarto'
                        ? 'Abrir comanda — Quarto ' + sel.rotulo
                        : 'Nova comanda de balcão'
                  }}
                </p>
                @if (sel.tipo === 'balcao') {
                  <input
                    class="inp"
                    formControlName="rotulo"
                    placeholder="Rótulo * — ex.: Delivery"
                    aria-label="Rótulo da comanda"
                  />
                }
                <label class="lbl"
                  >Garçom
                  <select class="inp" formControlName="idgarcom" aria-label="Garçom responsável">
                    <option [ngValue]="null">—</option>
                    @for (g of garconsAtivos(); track g.idfuncionario) {
                      <option [ngValue]="g.idfuncionario">
                        {{ g.funcionario_nome }} ({{ g.percentual }}%)
                      </option>
                    }
                  </select>
                </label>
                <div class="quick-acoes">
                  <button type="button" class="btn-gray" (click)="limparSelecao()">Voltar</button>
                  <button class="btn-prim" type="submit" [disabled]="!abrirValido() || salvando()">
                    <mat-icon>receipt</mat-icon> Abrir
                  </button>
                </div>
              </form>
            }

            <!-- grade de tiles -->
            @if (tipoAtend() === 'mesa') {
              <div class="tiles" role="list" aria-label="Mesas">
                @for (m of mesasVisiveis(); track m.id) {
                  <div
                    class="tile"
                    role="listitem"
                    [class.ocupada]="m.idcomanda !== null"
                    [class.sel]="selecionada(m.idcomanda, m.id)"
                  >
                    <button
                      type="button"
                      class="tile-main"
                      (click)="clicarMesa(m)"
                      [attr.aria-label]="
                        'Mesa ' + m.numero + (m.idcomanda !== null ? ' — com consumo' : ' — livre')
                      "
                    >
                      <span class="tile-num">{{ m.numero }}</span>
                      <span class="tile-meta">
                        <mat-icon>event_seat</mat-icon> {{ m.lugares }}
                      </span>
                      <span class="tile-status">{{
                        m.idcomanda === null ? 'Livre' : 'Com consumo'
                      }}</span>
                      <span class="tile-val">{{
                        m.idcomanda === null ? '' : fmt(m.total_aberto)
                      }}</span>
                    </button>
                    <button
                      type="button"
                      class="mesa-toggle"
                      (click)="toggleMesa(m)"
                      [disabled]="m.idcomanda !== null"
                      [attr.aria-label]="'Desativar mesa ' + m.numero"
                      [title]="
                        m.idcomanda !== null
                          ? 'Feche a comanda antes de desativar a mesa.'
                          : 'Desativar mesa'
                      "
                    >
                      <mat-icon>power_settings_new</mat-icon>
                    </button>
                  </div>
                } @empty {
                  <p class="vazio tile-vazio">Nenhuma mesa encontrada.</p>
                }
              </div>
              @if (mesasInativas().length) {
                <details class="inativas">
                  <summary>Mesas inativas ({{ mesasInativas().length }})</summary>
                  <div class="tiles">
                    @for (m of mesasInativas(); track m.id) {
                      <div class="tile inativa">
                        <span class="tile-main">
                          <span class="tile-num">{{ m.numero }}</span>
                          <span class="tile-meta"
                            ><mat-icon>event_seat</mat-icon> {{ m.lugares }}</span
                          >
                          <span class="tile-status">Inativa</span>
                        </span>
                        <button
                          type="button"
                          class="mesa-toggle on"
                          (click)="toggleMesa(m)"
                          [attr.aria-label]="'Reativar mesa ' + m.numero"
                          title="Reativar mesa"
                        >
                          <mat-icon>power_settings_new</mat-icon>
                        </button>
                      </div>
                    }
                  </div>
                </details>
              }
            }

            @if (tipoAtend() === 'quarto') {
              <div class="tiles" role="list" aria-label="Quartos em estadia">
                @for (r of quartosVisiveis(); track r.idquarto) {
                  @if (comandaDoQuarto(r.quarto_numero); as cq) {
                    <button
                      type="button"
                      class="tile ocupada"
                      [class.sel]="cq.id === comanda()?.id"
                      (click)="clicarQuarto(r)"
                      [attr.aria-label]="'Quarto ' + r.quarto_numero + ' — com consumo'"
                    >
                      <span class="tile-num">{{ r.quarto_numero }}</span>
                      <span class="tile-meta tile-nome">{{ r.cliente_nome }}</span>
                      <span class="tile-status">Com consumo</span>
                      <span class="tile-val">{{ fmt(cq.total_itens) }}</span>
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="tile"
                      [class.sel]="selecao()?.tipo === 'quarto' && selecao()?.id === r.idquarto"
                      (click)="clicarQuarto(r)"
                      [attr.aria-label]="'Quarto ' + r.quarto_numero + ' — em estadia'"
                    >
                      <span class="tile-num">{{ r.quarto_numero }}</span>
                      <span class="tile-meta tile-nome">{{ r.cliente_nome }}</span>
                      <span class="tile-status">Em estadia</span>
                      <span class="tile-val"></span>
                    </button>
                  }
                } @empty {
                  <p class="vazio tile-vazio">Nenhum quarto em estadia.</p>
                }
              </div>
            }

            @if (tipoAtend() === 'balcao') {
              <div class="tiles" role="list" aria-label="Comandas de balcão">
                <button type="button" class="tile novo" (click)="novoBalcao()">
                  <mat-icon>add</mat-icon>
                  <span>Nova comanda<br />de balcão</span>
                </button>
                @for (c of balcaoVisiveis(); track c.id) {
                  <button
                    type="button"
                    class="tile ocupada"
                    [class.sel]="comanda()?.id === c.id"
                    (click)="abrirDetalhe(c.id)"
                    [attr.aria-label]="rotulo(c)"
                  >
                    <span class="tile-num"><mat-icon>storefront</mat-icon></span>
                    <span class="tile-meta tile-nome">{{ rotulo(c) }}</span>
                    <span class="tile-status">Aberta</span>
                    <span class="tile-val">{{ fmt(c.total_itens) }}</span>
                  </button>
                }
              </div>
            }
          </div>
        } @else {
          <!-- ============ VISÃO PEDIDO — catálogo + comanda ============ -->
          <div class="atend">
            <button type="button" class="cc-voltar voltar-salao" (click)="fecharDetalhe()">
              <mat-icon>arrow_back</mat-icon> Voltar ao salão
            </button>

            <!-- ---------- catálogo ---------- -->
            <section class="cat-col" aria-label="Adicionar produtos">
              <header class="cat-head">
                <div>
                  <h3>Adicionar produtos</h3>
                  <p class="cat-sub">
                    {{
                      comanda()
                        ? 'Inclua itens na comanda ' + rotulo(comanda()!) + '.'
                        : 'Selecione um atendimento para lançar itens.'
                    }}
                  </p>
                </div>
                <span class="pill-gold">Catálogo</span>
              </header>

              @if (comanda(); as com) {
                @if (com.status === 'aberta') {
                  <label class="lbl" for="busca-prod">Buscar produto</label>
                  <input
                    class="inp"
                    id="busca-prod"
                    type="search"
                    placeholder="Digite o nome ou código do produto"
                    [value]="buscaProd()"
                    (input)="buscaProd.set($any($event.target).value)"
                    aria-label="Buscar produto"
                  />

                  <div class="cats" role="group" aria-label="Categorias">
                    <button
                      type="button"
                      class="cat-pill"
                      [class.ativo]="catProd() === null"
                      (click)="catProd.set(null)"
                    >
                      Todos
                    </button>
                    @for (c of categorias(); track c) {
                      <button
                        type="button"
                        class="cat-pill"
                        [class.ativo]="catProd() === c"
                        (click)="catProd.set(c)"
                      >
                        {{ c }}
                      </button>
                    }
                  </div>

                  <div class="produtos">
                    @for (i of itensFiltrados(); track i.id) {
                      <div class="prod">
                        <div class="prod-desc">
                          <strong>{{ i.nome }}</strong>
                          <small
                            >{{ i.categoria_nome ?? 'Sem categoria' }} · est.
                            {{ i.quantidade }}</small
                          >
                        </div>
                        <div class="prod-rod">
                          <span class="prod-preco">{{ fmt(i.valor_unitario) }}</span>
                          <button
                            type="button"
                            class="btn-add"
                            [disabled]="salvando() || num(i.quantidade) < 1"
                            (click)="adicionarProduto(i)"
                            [attr.aria-label]="'Adicionar ' + i.nome"
                          >
                            <mat-icon>add</mat-icon> Adicionar
                          </button>
                        </div>
                      </div>
                    } @empty {
                      <p class="vazio">Nenhum produto encontrado.</p>
                    }
                  </div>

                  <div class="info-card">
                    <mat-icon>info</mat-icon>
                    <div>
                      <strong>Baixa automática no estoque</strong>
                      <p>Os itens lançados na comanda atualizam o estoque.</p>
                    </div>
                  </div>
                } @else {
                  <div class="sem-atend">
                    <mat-icon>lock</mat-icon>
                    <p>Comanda {{ com.status }} — itens não podem ser alterados.</p>
                  </div>
                }
              }
            </section>

            <!-- ---------- comanda ---------- -->
            <aside class="com-card card0" aria-label="Comanda">
              @if (comanda(); as com) {
                <header class="cc-head">
                  <div>
                    <span class="eyebrow sm">{{ eyebrowComanda(com) }}</span>
                    <h3>
                      {{ rotulo(com) }} <small>Nº {{ com.id }}</small>
                    </h3>
                  </div>
                  <span class="chip" [class]="'chip-' + com.status">{{
                    rotuloStatus(com.status)
                  }}</span>
                </header>

                <div class="cc-meta">
                  @if (com.garcom_nome) {
                    <span><mat-icon>person</mat-icon> {{ com.garcom_nome }}</span>
                  }
                  @if (com.cliente_nome) {
                    <span><mat-icon>hotel</mat-icon> {{ com.cliente_nome }}</span>
                  }
                  <span
                    ><mat-icon>schedule</mat-icon> aberta
                    {{ com.aberto_em | date: 'dd/MM HH:mm' }}</span
                  >
                </div>

                <div class="cc-pedido">
                  <header class="cc-ped-head">
                    <h4>Pedido</h4>
                    <span>{{ itens().length }} {{ itens().length === 1 ? 'item' : 'itens' }}</span>
                  </header>

                  <div class="cc-consumo">
                    <div>
                      <strong>Consumo registrado</strong>
                      <span class="cc-total-sm">{{ fmt(com.total_itens) }}</span>
                    </div>
                    <p>Valor acumulado dos itens lançados nesta comanda.</p>
                  </div>

                  <ul class="cc-itens">
                    @for (i of itens(); track i.id) {
                      <li [class.cancelado]="i.status === 'cancelado'">
                        <span class="cc-qtd">{{ i.quantidade }}×</span>
                        <span class="cc-item">
                          <strong>{{ i.item_nome }}</strong>
                          <small>
                            {{ fmt(i.valor_total) }}
                            <span class="chip" [class]="'chip-' + i.status">{{
                              rotuloItem(i.status)
                            }}</span>
                          </small>
                        </span>
                        @if (com.status === 'aberta' && i.status !== 'cancelado') {
                          <span class="cc-acoes">
                            @if (i.status !== 'entregue') {
                              <button
                                type="button"
                                class="btn-mini ok"
                                (click)="entregarItem(i.id)"
                                aria-label="Marcar entregue"
                                title="Marcar entregue"
                              >
                                <mat-icon>check</mat-icon>
                              </button>
                            }
                            <button
                              type="button"
                              class="btn-mini dan"
                              (click)="iniciarCancelamento('item', i.id)"
                              aria-label="Cancelar item"
                              title="Cancelar e devolver ao estoque"
                            >
                              <mat-icon>undo</mat-icon>
                            </button>
                          </span>
                        }
                      </li>
                    } @empty {
                      <li class="cc-vazio">
                        <mat-icon>list_alt</mat-icon>
                        <strong>Nenhum item lançado</strong>
                        <span
                          >Use "Adicionar" no catálogo ao lado. Confira os itens antes de
                          lançar.</span
                        >
                      </li>
                    }
                  </ul>
                </div>

                <footer class="cc-foot">
                  <div class="cc-total">
                    <div><strong>Total da comanda</strong><small>Consumo registrado</small></div>
                    <span class="cc-total-vl">{{ fmt(com.total_itens) }}</span>
                  </div>
                  @if (com.status === 'aberta') {
                    <button
                      type="button"
                      class="btn-outline block"
                      (click)="fechando.set(true)"
                      [disabled]="itens().length === 0"
                    >
                      <mat-icon>point_of_sale</mat-icon> Revisar fechamento
                    </button>
                    <p class="cc-nota">Confira a comanda antes de seguir para o pagamento.</p>
                    <button
                      type="button"
                      class="btn-ghost-danger block"
                      (click)="iniciarCancelamento('comanda')"
                      [disabled]="salvando()"
                    >
                      Cancelar comanda
                    </button>
                    <button type="button" class="cc-voltar" (click)="fecharDetalhe()">
                      <mat-icon>arrow_back</mat-icon> Voltar ao salão
                    </button>
                  } @else {
                    <button type="button" class="btn-gray block" (click)="fecharDetalhe()">
                      <mat-icon>arrow_back</mat-icon> Voltar
                    </button>
                  }
                </footer>
              }
            </aside>
          </div>
        }
      }

      <!-- ============ modal · fechamento ============ -->
      @if (fechando()) {
        @if (comanda(); as com) {
          <div class="overlay" (click.self)="fechando.set(false)">
            <div class="modal-inn" role="dialog" aria-modal="true" aria-labelledby="fechar-tit">
              <div class="modal-head">
                <h5 id="fechar-tit">
                  <mat-icon>point_of_sale</mat-icon> Fechamento — {{ rotulo(com) }}
                </h5>
                <button
                  type="button"
                  class="close"
                  (click)="fechando.set(false)"
                  aria-label="Fechar"
                >
                  &times;
                </button>
              </div>
              <form class="modal-body" [formGroup]="fecharForm" (ngSubmit)="fecharComanda()">
                <div class="seg" role="group" aria-label="Modo de fechamento">
                  <button
                    type="button"
                    class="seg-btn"
                    [class.ativo]="modo() === 'pagar'"
                    (click)="setModo('pagar')"
                  >
                    <mat-icon>payments</mat-icon> Pagar agora
                  </button>
                  @if (com.idreserva) {
                    <button
                      type="button"
                      class="seg-btn"
                      [class.ativo]="modo() === 'faturar'"
                      (click)="setModo('faturar')"
                    >
                      <mat-icon>hotel</mat-icon> Faturar ao quarto
                    </button>
                  }
                </div>
                <div class="fechar-grid">
                  @if (modo() === 'pagar') {
                    <label class="lbl"
                      >Conta *
                      <select
                        class="inp"
                        formControlName="idconta_financeira"
                        aria-label="Conta financeira"
                      >
                        <option [ngValue]="null" disabled>Selecione…</option>
                        @for (c of contas(); track c.id) {
                          <option [ngValue]="c.id">{{ c.nome }}</option>
                        }
                      </select>
                    </label>
                    <label class="lbl"
                      >Forma de pagamento *
                      <select
                        class="inp"
                        formControlName="idforma_pagamento"
                        aria-label="Forma de pagamento"
                      >
                        <option [ngValue]="null" disabled>Selecione…</option>
                        @for (f of formas(); track f.id) {
                          <option [ngValue]="f.id">{{ f.nome }}</option>
                        }
                      </select>
                    </label>
                  }
                  <label class="lbl"
                    >Desconto
                    <input
                      class="inp"
                      formControlName="desconto"
                      type="number"
                      step="0.01"
                      min="0"
                      aria-label="Desconto"
                    />
                  </label>
                </div>
                <p class="fechar-total">
                  Subtotal {{ fmt(com.total_itens) }}
                  @if (num(fecharForm.controls.desconto.value) > 0) {
                    − desconto {{ fmt(fecharForm.controls.desconto.value) }}
                  }
                  =
                  <strong>{{
                    fmt(num(com.total_itens) - num(fecharForm.controls.desconto.value))
                  }}</strong>
                </p>
                <div class="fechar-acoes">
                  <button type="button" class="btn-gray" #modalVoltar (click)="fechando.set(false)">
                    Voltar
                  </button>
                  <button type="submit" class="btn-prim" [disabled]="!fecharValido() || salvando()">
                    <mat-icon>check_circle</mat-icon>
                    {{ modo() === 'pagar' ? 'Confirmar pagamento' : 'Faturar' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        }
      }

      <!-- ============ modal · cancelamento ============ -->
      @if (cancelando(); as tipo) {
        <div class="overlay" (click.self)="cancelando.set(null)">
          <div class="modal-inn" role="alertdialog" aria-modal="true" aria-labelledby="cancel-tit">
            <div class="modal-head">
              <h5 id="cancel-tit">
                <mat-icon>cancel</mat-icon> Cancelar
                {{ tipo === 'item' ? 'item' : 'comanda inteira' }}
              </h5>
              <button
                type="button"
                class="close"
                (click)="cancelando.set(null)"
                aria-label="Fechar"
              >
                &times;
              </button>
            </div>
            <form class="modal-body" [formGroup]="cancelForm" (ngSubmit)="confirmarCancelamento()">
              <p class="cancel-aviso">
                <mat-icon>info</mat-icon>
                {{
                  tipo === 'item'
                    ? 'A quantidade volta ao estoque.'
                    : 'Todos os itens voltam ao estoque.'
                }}
              </p>
              <input
                class="inp"
                formControlName="motivo"
                placeholder="Motivo do cancelamento *"
                aria-label="Motivo do cancelamento"
              />
              <div class="fechar-acoes">
                <button type="button" class="btn-gray" #modalVoltar (click)="cancelando.set(null)">
                  Voltar
                </button>
                <button
                  type="submit"
                  class="btn-danger"
                  [disabled]="cancelForm.invalid || salvando()"
                >
                  <mat-icon>cancel</mat-icon> Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ================================================== aba: comandas -->
      @if (aba() === 'comandas') {
        <section class="card">
          <header class="card-head">
            <h3><mat-icon>receipt_long</mat-icon> Comandas</h3>
            <div class="filtros">
              <select class="inp sm" [formControl]="filtroStatus" aria-label="Filtrar por status">
                <option value="aberta">Abertas</option>
                <option value="fechada">Fechadas</option>
                <option value="cancelada">Canceladas</option>
                <option [ngValue]="null">Todas</option>
              </select>
              <button type="button" class="btn-mini-cta" (click)="abrindo.set(!abrindo())">
                <mat-icon>add</mat-icon> Nova comanda
              </button>
            </div>
          </header>

          @if (abrindo()) {
            <form class="ab-form" [formGroup]="abrirForm" (ngSubmit)="abrirComanda()">
              <div class="seg" role="group" aria-label="Tipo da comanda">
                @for (t of tipos; track t.id) {
                  <button
                    type="button"
                    class="seg-btn"
                    [class.ativo]="abrirForm.controls.tipo.value === t.id"
                    (click)="setTipo(t.id)"
                  >
                    <mat-icon>{{ t.icone }}</mat-icon> {{ t.rotulo }}
                  </button>
                }
              </div>
              <div class="ab-campos">
                @if (abrirForm.controls.tipo.value === 'mesa') {
                  <label class="lbl"
                    >Mesa *
                    <select class="inp" formControlName="idmesa" aria-label="Mesa">
                      <option [ngValue]="null" disabled>Selecione…</option>
                      @for (m of mesasLivres(); track m.id) {
                        <option [ngValue]="m.id">Mesa {{ m.numero }} ({{ m.lugares }} lug.)</option>
                      }
                    </select>
                  </label>
                }
                @if (abrirForm.controls.tipo.value === 'quarto') {
                  <label class="lbl grow"
                    >Quarto (reserva em estadia) *
                    <select
                      class="inp"
                      formControlName="idquarto"
                      aria-label="Quarto com reserva em estadia"
                    >
                      <option [ngValue]="null" disabled>Selecione…</option>
                      @for (r of reservasEstadia(); track r.id) {
                        <option [ngValue]="r.idquarto">
                          Quarto {{ r.quarto_numero }} — {{ r.cliente_nome }}
                        </option>
                      }
                    </select>
                  </label>
                }
                @if (abrirForm.controls.tipo.value === 'balcao') {
                  <label class="lbl grow"
                    >Rótulo *
                    <input
                      class="inp"
                      formControlName="rotulo"
                      placeholder="Ex.: Cliente balcão, Delivery…"
                      aria-label="Rótulo da comanda"
                    />
                  </label>
                }
                <label class="lbl"
                  >Garçom
                  <select class="inp" formControlName="idgarcom" aria-label="Garçom responsável">
                    <option [ngValue]="null">—</option>
                    @for (g of garconsAtivos(); track g.idfuncionario) {
                      <option [ngValue]="g.idfuncionario">
                        {{ g.funcionario_nome }} ({{ g.percentual }}%)
                      </option>
                    }
                  </select>
                </label>
                <button class="btn-prim" type="submit" [disabled]="!abrirValido() || salvando()">
                  <mat-icon>receipt</mat-icon> Abrir
                </button>
              </div>
            </form>
          }

          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Comanda</th>
                  <th>Garçom</th>
                  <th>Abertura</th>
                  <th class="r">Itens</th>
                  <th class="r">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (c of comandas(); track c.id) {
                  <tr class="linha-comanda" (click)="abrirDetalhe(c.id)">
                    <td>{{ c.id }}</td>
                    <td>
                      {{ rotulo(c) }}
                      @if (c.cliente_nome) {
                        <small class="cat"> · {{ c.cliente_nome }}</small>
                      }
                    </td>
                    <td>{{ c.garcom_nome ?? '—' }}</td>
                    <td>{{ c.aberto_em | date: 'dd/MM HH:mm' }}</td>
                    <td class="r">{{ c.itens_pendentes }}</td>
                    <td class="r">{{ fmt(c.status === 'fechada' ? c.total : c.total_itens) }}</td>
                    <td>
                      <span class="chip" [class]="'chip-' + c.status">{{ c.status }}</span>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="vazio">Nenhuma comanda encontrada.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (comandasTotal() > POR_PAGINA) {
            <footer class="pag">
              <button
                type="button"
                class="btn-mini-cta"
                [disabled]="comandasPage() <= 1"
                (click)="paginarComandas(comandasPage() - 1)"
              >
                <mat-icon>chevron_left</mat-icon> Anterior
              </button>
              <span
                >{{ comandasPage() }} / {{ comandasTotalPaginas() }} —
                {{ comandasTotal() }} comandas</span
              >
              <button
                type="button"
                class="btn-mini-cta"
                [disabled]="comandasPage() >= comandasTotalPaginas()"
                (click)="paginarComandas(comandasPage() + 1)"
              >
                Próxima <mat-icon>chevron_right</mat-icon>
              </button>
            </footer>
          }
        </section>
      }

      <!-- ==================================================== aba: garçons -->
      @if (aba() === 'garcons') {
        <section class="card">
          <header class="card-head">
            <h3><mat-icon>room_service</mat-icon> Garçons &amp; comissão</h3>
            <small>percentual aplicado sobre o total da comanda fechada</small>
          </header>
          <form class="mini-form" [formGroup]="garcomForm" (ngSubmit)="salvarGarcom()">
            <select class="inp grow" formControlName="idfuncionario" aria-label="Funcionário">
              <option [ngValue]="null" disabled>Funcionário *</option>
              @for (f of funcionarios(); track f.id) {
                <option [ngValue]="f.id">{{ f.nome }}</option>
              }
            </select>
            <input
              class="inp n"
              formControlName="percentual"
              type="number"
              step="0.5"
              min="0"
              max="100"
              placeholder="% comissão"
              aria-label="Percentual de comissão"
            />
            <button class="btn-prim" type="submit" [disabled]="garcomForm.invalid">
              <mat-icon>save</mat-icon>
            </button>
          </form>
          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Garçom</th>
                  <th class="r">Comissão</th>
                  <th>Status</th>
                  <th class="r">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (g of garcons(); track g.id) {
                  <tr [class.linha-cancelada]="!g.ativo">
                    <td>{{ g.funcionario_nome }}</td>
                    <td class="r">{{ g.percentual }}%</td>
                    <td>
                      <span class="chip" [class]="g.ativo ? 'chip-entregue' : 'chip-cancelado'">
                        {{ g.ativo ? 'ativo' : 'inativo' }}
                      </span>
                    </td>
                    <td class="r">
                      <button
                        type="button"
                        class="btn-mini"
                        [class.ok]="!g.ativo"
                        [class.dan]="g.ativo"
                        (click)="toggleGarcom(g)"
                        [attr.aria-label]="
                          (g.ativo ? 'Desativar' : 'Reativar') + ' ' + g.funcionario_nome
                        "
                        [title]="g.ativo ? 'Desativar garçom' : 'Reativar garçom'"
                      >
                        <mat-icon>power_settings_new</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="4" class="vazio">Cadastre o primeiro garçom acima.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <header class="card-head">
            <h3><mat-icon>account_balance_wallet</mat-icon> Comissões</h3>
          </header>

          <div class="kpi">
            @for (r of resumoComissoes(); track r.idgarcom) {
              <div class="kpi-item">
                <span class="kpi-num neg">{{ fmt(r.valor_pendente) }}</span>
                <span class="kpi-lbl"
                  ><mat-icon>person</mat-icon> {{ r.garcom_nome }} — pendente</span
                >
                <small class="pago">pago: {{ fmt(r.valor_pago) }}</small>
              </div>
            } @empty {
              <p class="vazio">Nenhuma comissão provisionada ainda.</p>
            }
          </div>

          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Garçom</th>
                  <th>Comanda</th>
                  <th class="r">%</th>
                  <th class="r">Base</th>
                  <th class="r">Valor</th>
                  <th>Status</th>
                  <th class="r">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (c of comissoes(); track c.id) {
                  <tr>
                    <td>{{ c.garcom_nome }}</td>
                    <td>{{ c.comanda_descricao }}</td>
                    <td class="r">{{ c.percentual }}%</td>
                    <td class="r">{{ fmt(c.base) }}</td>
                    <td class="r">{{ fmt(c.valor) }}</td>
                    <td>
                      <span
                        class="chip"
                        [class]="'chip-' + (c.status === 'paga' ? 'entregue' : 'pendente')"
                        >{{ c.status }}</span
                      >
                    </td>
                    <td class="r">
                      @if (c.status === 'pendente') {
                        <button
                          type="button"
                          class="btn-mini ok"
                          (click)="iniciarPagamento(c.id)"
                          aria-label="Pagar comissão"
                          title="Pagar comissão"
                        >
                          <mat-icon>payments</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="vazio">Sem comissões no período.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (comissoesTotal() > POR_PAGINA) {
            <footer class="pag">
              <button
                type="button"
                class="btn-mini-cta"
                [disabled]="comissoesPage() <= 1"
                (click)="paginarComissoes(comissoesPage() - 1)"
              >
                <mat-icon>chevron_left</mat-icon> Anterior
              </button>
              <span
                >{{ comissoesPage() }} / {{ comissoesTotalPaginas() }} —
                {{ comissoesTotal() }} comissões</span
              >
              <button
                type="button"
                class="btn-mini-cta"
                [disabled]="comissoesPage() >= comissoesTotalPaginas()"
                (click)="paginarComissoes(comissoesPage() + 1)"
              >
                Próxima <mat-icon>chevron_right</mat-icon>
              </button>
            </footer>
          }

          @if (pagando(); as pid) {
            <form class="fechar" [formGroup]="pagarForm" (ngSubmit)="pagarComissao(pid)">
              <h4><mat-icon>payments</mat-icon> Pagar comissão Nº{{ pid }}</h4>
              <div class="fechar-grid">
                <label class="lbl"
                  >Conta de origem *
                  <select
                    class="inp"
                    formControlName="idconta_financeira"
                    aria-label="Conta financeira"
                  >
                    <option [ngValue]="null" disabled>Selecione…</option>
                    @for (c of contas(); track c.id) {
                      <option [ngValue]="c.id">{{ c.nome }}</option>
                    }
                  </select>
                </label>
                <label class="lbl"
                  >Forma de pagamento
                  <select
                    class="inp"
                    formControlName="idforma_pagamento"
                    aria-label="Forma de pagamento"
                  >
                    <option [ngValue]="null">—</option>
                    @for (f of formas(); track f.id) {
                      <option [ngValue]="f.id">{{ f.nome }}</option>
                    }
                  </select>
                </label>
              </div>
              <div class="fechar-acoes">
                <button type="button" class="btn-gray" (click)="pagando.set(null)">Voltar</button>
                <button type="submit" class="btn-prim" [disabled]="pagarForm.invalid || salvando()">
                  <mat-icon>check_circle</mat-icon> Confirmar pagamento
                </button>
              </div>
            </form>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .page {
      padding: 4px 6px 40px;
      background: transparent;
      border: 0;
      box-shadow: none;
    }
    .pdv-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
      padding: 8px 4px 0;
    }
    .eyebrow {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #4b95ab;
      margin: 0 0 4px;
    }
    .eyebrow.sm {
      font-size: 0.66rem;
    }
    .titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      line-height: 1.1;
      letter-spacing: -0.01em;
    }
    .sub {
      margin: 4px 0 0;
      font-size: 0.86rem;
      color: #7d97a1;
    }

    /* ---------- abas ---------- */
    .abas {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid #e5ded2;
      margin: 14px 0 18px;
      padding: 0 4px;
    }
    .aba {
      gap: 8px;
      padding: 12px 18px;
      border: 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      background: transparent;
      color: #5d6d7e;
      font-weight: 600;
      font-size: 0.86rem;
    }
    .aba:hover,
    .aba.ativa {
      color: #054054;
    }
    .aba.ativa {
      border-bottom-color: #054054;
    }
    .aba:focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: 2px;
    }

    .card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .card-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: #054054;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-head small {
      color: #8a99a4;
    }
    .card0 {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
    }

    /* ---------- visão pedido · catálogo + comanda ---------- */
    .atend {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 400px;
      gap: 18px;
      align-items: start;
    }
    .voltar-salao {
      grid-column: 1 / -1;
      justify-self: start;
    }
    @media (max-width: 980px) {
      .atend {
        grid-template-columns: 1fr;
      }
    }

    /* ---------- visão salão · grade de atendimentos ---------- */
    .salao {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .salao-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px 14px;
    }
    .salao-tools .seg3 {
      flex: 0 1 320px;
      min-width: 250px;
    }
    .seg3 {
      display: flex;
      background: #eef2f5;
      border-radius: 9px;
      padding: 3px;
    }
    .seg3-btn {
      flex: 1;
      border: 0;
      background: transparent;
      padding: 7px 4px;
      border-radius: 7px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #5d6d7e;
      cursor: pointer;
    }
    .seg3-btn.ativo {
      background: #fff;
      color: #054054;
      box-shadow: 0 1px 3px rgba(5, 64, 84, 0.12);
    }
    .salao-busca {
      flex: 1;
      min-width: 190px;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #d7e0e6;
      border-radius: 9px;
      padding: 0 12px;
      background: #fff;
    }
    .salao-busca:focus-within {
      outline: 2px solid #1a6f8a;
      border-color: #1a6f8a;
    }
    .salao-busca mat-icon {
      color: #8a99a4;
    }
    .salao-inp {
      flex: 1;
      border: 0;
      outline: 0;
      padding: 9px 0;
      font-size: 0.88rem;
      background: transparent;
      color: #33424c;
    }
    .salao-mesa-form {
      margin-bottom: 0;
    }

    /* tiles — padrão floor plan dos PDVs */
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }
    .tile {
      position: relative;
      background: #fff;
      border: 1px solid #e3eaef;
      border-left: 4px solid #198754;
      border-radius: 12px;
      transition:
        box-shadow 0.15s,
        border-color 0.15s;
    }
    .tile.ocupada {
      border-left-color: #054054;
    }
    .tile:hover {
      box-shadow: 0 3px 10px rgba(5, 64, 84, 0.1);
    }
    .tile.sel {
      border-color: #054054;
      border-left-color: #054054;
      box-shadow: 0 0 0 1px #054054 inset;
    }
    .tile.inativa {
      border-left-color: #c9d4da;
      opacity: 0.65;
    }
    .tile-main,
    button.tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-height: 104px;
      padding: 13px 15px;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
    }
    .tile-main {
      width: 100%;
      border: 0;
      background: transparent;
    }
    .tile-num {
      font-size: 1.25rem;
      font-weight: 800;
      color: #33424c;
      line-height: 1.15;
      display: inline-flex;
      align-items: center;
    }
    .tile-num mat-icon {
      color: #5d6d7e;
    }
    .tile-meta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.74rem;
      color: #8a99a4;
      max-width: 100%;
    }
    .tile-nome {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tile-status {
      margin-top: auto;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #198754;
    }
    .tile.ocupada .tile-status {
      color: #054054;
    }
    .tile.inativa .tile-status {
      color: #8a99a4;
    }
    .tile-val {
      font-size: 0.92rem;
      font-weight: 800;
      color: #054054;
      min-height: 1.15em;
    }
    .tile.novo {
      border-style: dashed;
      border-left-width: 1px;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #5d6d7e;
      font-weight: 600;
      font-size: 0.82rem;
    }
    .tile.novo:hover {
      color: #054054;
      border-color: #9fb6bf;
      background: #f6fafb;
      box-shadow: none;
    }
    .tile-vazio {
      grid-column: 1 / -1;
    }

    .mesa-toggle {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #a5b6bf;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .tile:hover .mesa-toggle,
    .mesa-toggle:focus-visible,
    .tile.inativa .mesa-toggle {
      opacity: 1;
    }
    .mesa-toggle:hover:not(:disabled) {
      background: #fbeaea;
      color: #dc3545;
    }
    .mesa-toggle.on {
      opacity: 1;
    }
    .mesa-toggle.on:hover {
      background: #e3f3e6;
      color: #198754;
    }
    .mesa-toggle:disabled {
      cursor: not-allowed;
      color: #cfd9de;
    }
    .mesa-toggle:focus-visible {
      outline: 2px solid #1a6f8a;
    }
    .inativas {
      border-top: 1px dashed #e3eaef;
      padding-top: 10px;
    }
    .inativas summary {
      cursor: pointer;
      font-size: 0.78rem;
      font-weight: 600;
      color: #7d97a1;
      margin-bottom: 10px;
    }

    /* abertura rápida — painel horizontal */
    .quick {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .quick-t {
      flex-basis: 100%;
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      font-size: 0.88rem;
      font-weight: 700;
      color: #054054;
    }
    .quick .inp {
      width: auto;
      min-width: 220px;
    }
    .quick .lbl {
      flex: 1;
      min-width: 180px;
    }
    .quick .lbl .inp {
      width: 100%;
      min-width: 0;
    }
    .quick-acoes {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }

    /* ---------- catálogo ---------- */
    .cat-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .cat-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .cat-head h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: #054054;
    }
    .cat-sub {
      margin: 3px 0 0;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .pill-gold {
      flex-shrink: 0;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 999px;
      background: #fdf3e2;
      color: #92670b;
      border: 1px solid #f3d9a8;
    }
    .cats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .cat-pill {
      border: 1px solid #d7e0e6;
      background: #fff;
      border-radius: 9px;
      padding: 8px 15px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #5d6d7e;
    }
    .cat-pill:hover {
      border-color: #4b95ab;
      color: #054054;
    }
    .cat-pill.ativo {
      background: #054054;
      border-color: #054054;
      color: #fff;
    }
    .produtos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
      gap: 12px;
    }
    .prod {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .prod-desc {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .prod-desc strong {
      font-size: 0.92rem;
      color: #33424c;
    }
    .prod-desc small {
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .prod-rod {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .prod-preco {
      font-size: 0.95rem;
      font-weight: 800;
      color: #054054;
    }
    .btn-add {
      gap: 5px;
      border: 1px solid #054054;
      background: #fff;
      color: #054054;
      font-weight: 600;
      font-size: 0.8rem;
      padding: 8px 13px;
      border-radius: 9px;
    }
    .btn-add:hover:not(:disabled) {
      background: #054054;
      color: #fff;
    }
    .btn-add:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .info-card {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: #eef4f6;
      border: 1px solid #d3e4ec;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .info-card mat-icon {
      color: #054054;
      margin-top: 2px;
    }
    .info-card strong {
      font-size: 0.86rem;
      color: #054054;
    }
    .info-card p {
      margin: 3px 0 0;
      font-size: 0.78rem;
      color: #5d6d7e;
    }
    .sem-atend {
      background: #fff;
      border: 1px dashed #ddd4c4;
      border-radius: 12px;
      padding: 44px 24px;
      text-align: center;
      color: #8a99a4;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .sem-atend mat-icon {
      color: #b9c4cb;
    }
    .sem-atend p {
      margin: 0;
      font-size: 0.88rem;
      max-width: 340px;
    }

    /* ---------- comanda ---------- */
    .com-card {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: sticky;
      top: 12px;
    }
    .cc-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .cc-head h3 {
      margin: 2px 0 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #054054;
    }
    .cc-head h3 small {
      font-family: 'Manrope', sans-serif;
      font-size: 0.78rem;
      color: #8a99a4;
      font-weight: 500;
    }
    .cc-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      color: #5d6d7e;
      padding-bottom: 12px;
      border-bottom: 1px solid #e3eaef;
    }
    .cc-meta span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .cc-ped-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }
    .cc-ped-head h4 {
      margin: 0;
      font-size: 0.92rem;
      font-weight: 700;
      color: #33424c;
    }
    .cc-ped-head span {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .cc-consumo {
      background: #eef4f6;
      border-radius: 10px;
      padding: 12px 14px;
      margin: 10px 0;
    }
    .cc-consumo > div {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .cc-consumo strong {
      font-size: 0.84rem;
      color: #054054;
    }
    .cc-total-sm {
      font-weight: 800;
      color: #054054;
    }
    .cc-consumo p {
      margin: 5px 0 0;
      font-size: 0.74rem;
      color: #5d6d7e;
      line-height: 1.45;
    }
    .cc-itens {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .cc-itens li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 2px;
      border-bottom: 1px solid #f2f7f9;
    }
    .cc-itens li:last-child {
      border-bottom: 0;
    }
    .cc-itens li.cancelado {
      opacity: 0.5;
    }
    .cc-qtd {
      flex-shrink: 0;
      font-size: 0.8rem;
      font-weight: 800;
      color: #054054;
      background: #eef2f5;
      border-radius: 7px;
      padding: 5px 8px;
      min-width: 38px;
      text-align: center;
    }
    .cc-item {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cc-item strong {
      font-size: 0.86rem;
      color: #33424c;
    }
    .cc-item small {
      font-size: 0.74rem;
      color: #8a99a4;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .cc-acoes {
      display: inline-flex;
      flex-shrink: 0;
    }
    .cc-vazio {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 20px !important;
      text-align: center;
      border: 1px dashed #ddd4c4 !important;
      border-radius: 10px;
    }
    .cc-vazio mat-icon {
      color: #b9c4cb;
    }
    .cc-vazio strong {
      font-size: 0.86rem;
      color: #5d6d7e;
    }
    .cc-vazio span {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .cc-foot {
      display: flex;
      flex-direction: column;
      gap: 9px;
      border-top: 1px solid #e3eaef;
      padding-top: 14px;
    }
    .cc-total {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .cc-total strong {
      font-size: 0.9rem;
      color: #33424c;
      display: block;
    }
    .cc-total small {
      font-size: 0.72rem;
      color: #8a99a4;
    }
    .cc-total-vl {
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      font-variant-numeric: tabular-nums;
    }
    .btn-prim.block,
    .btn-ghost-danger.block,
    .btn-gray.block,
    .btn-outline.block {
      width: 100%;
      justify-content: center;
      padding: 12px;
      font-size: 0.88rem;
    }
    .btn-outline {
      gap: 7px;
      border: 1px solid #054054;
      background: #fff;
      color: #054054;
      font-weight: 700;
      padding: 10px 18px;
      border-radius: 9px;
    }
    .btn-outline:hover:not(:disabled) {
      background: #eef4f6;
    }
    .btn-outline:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .cc-nota {
      margin: 0;
      font-size: 0.72rem;
      color: #8fa3ab;
      text-align: center;
    }
    .btn-ghost-danger {
      gap: 7px;
      border: 1px solid #e7c8c6;
      background: #fff;
      color: #dc3545;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 18px;
      border-radius: 8px;
    }
    .btn-ghost-danger:hover:not(:disabled) {
      background: #fbeaea;
    }
    .btn-ghost-danger:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .cc-voltar {
      border: 0;
      background: transparent;
      color: #5d6d7e;
      font-size: 0.8rem;
      font-weight: 600;
      justify-content: center;
      gap: 6px;
      padding: 6px;
    }
    .cc-voltar:hover {
      color: #054054;
    }

    /* ---------- formulários ---------- */
    .mini-form,
    .ab-form {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      padding: 12px;
      background: #f4f8fa;
      border-radius: 10px;
      margin-bottom: 14px;
    }
    .ab-form {
      flex-direction: column;
      align-items: stretch;
    }
    .ab-campos {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .filtros {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .lbl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #5d6d7e;
    }
    .lbl.grow,
    .grow {
      flex: 1;
      min-width: 160px;
    }
    .inp {
      border: 1px solid #d7e0e6;
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.88rem;
      background: #fff;
      color: #33424c;
      width: 100%;
    }
    .inp:focus {
      outline: 2px solid #1a6f8a;
      border-color: #1a6f8a;
    }
    .inp.n {
      width: 110px;
    }
    .inp.sm {
      padding: 7px 10px;
      font-size: 0.82rem;
      width: auto;
    }

    .btn-prim {
      gap: 7px;
      border: 0;
      background: #054054;
      color: #fff;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 18px;
      border-radius: 9px;
    }
    .btn-prim:hover:not(:disabled) {
      background: #042f3d;
    }
    .btn-prim:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .btn-gray {
      gap: 7px;
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #5d6d7e;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 18px;
      border-radius: 9px;
    }
    .btn-danger {
      gap: 7px;
      border: 0;
      background: #fbeaea;
      color: #dc3545;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 10px 18px;
      border-radius: 9px;
    }
    .btn-danger:hover:not(:disabled) {
      background: #f5d5d3;
    }
    .btn-mini-cta {
      gap: 6px;
      border: 0;
      background: #e8f2f6;
      color: #054054;
      font-weight: 600;
      font-size: 0.8rem;
      padding: 8px 14px;
      border-radius: 9px;
    }
    .btn-prim,
    .btn-gray,
    .btn-danger,
    .btn-mini-cta,
    .btn-outline,
    .btn-ghost-danger,
    .btn-add,
    .seg-btn,
    .cc-voltar,
    .aba,
    .cat-pill {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .btn-mini {
      border: 0;
      border-radius: 6px;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-left: 2px;
    }
    .btn-mini.ok {
      background: #e3f3e6;
      color: #198754;
    }
    .btn-mini.dan {
      background: #fbeaea;
      color: #dc3545;
    }

    .seg {
      display: inline-flex;
      gap: 6px;
    }
    .seg-btn {
      gap: 7px;
      padding: 9px 16px;
      border: 1px solid #d7e0e6;
      border-radius: 9px;
      background: #fff;
      color: #5d6d7e;
      font-weight: 600;
      font-size: 0.83rem;
    }
    .seg-btn.ativo {
      background: #054054;
      color: #fff;
      border-color: #054054;
    }

    .tab-wrap {
      overflow-x: auto;
    }
    .tab {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    .tab th {
      text-align: left;
      padding: 10px;
      color: #054054;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 2px solid #eef2f5;
    }
    .tab td {
      padding: 10px;
      border-bottom: 1px solid #f1f5f7;
      vertical-align: middle;
    }
    .tab .r {
      text-align: right;
    }
    .linha-comanda {
      cursor: pointer;
    }
    .linha-comanda:hover td {
      background: #f6fafc;
    }
    .linha-cancelada td {
      opacity: 0.55;
    }
    .cat {
      color: #8a99a4;
    }

    .chip {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: capitalize;
    }
    .chip-aberta,
    .chip-pendente {
      background: #f7ead2;
      color: #92670b;
    }
    .chip-em_preparo {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .chip-fechada,
    .chip-entregue,
    .chip-pronto {
      background: #e3f3e6;
      color: #198754;
    }
    .chip-cancelada,
    .chip-cancelado {
      background: #fbeaea;
      color: #dc3545;
    }

    .fechar {
      margin-top: 4px;
      padding: 16px;
      background: #f0f7fa;
      border: 1px solid #d3e4ec;
      border-radius: 10px;
    }
    .fechar h4 {
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #054054;
      font-size: 0.95rem;
    }
    .fechar-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
    }
    .fechar-total {
      font-size: 0.88rem;
      color: #5d6d7e;
      margin: 12px 0;
    }
    .fechar-total strong {
      color: #054054;
      font-size: 1rem;
    }
    .fechar-acoes {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .modal-head h5 {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #054054;
    }

    .kpi {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .kpi-item {
      flex: 1;
      min-width: 150px;
      background: #f4f8fa;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kpi-num {
      font-size: 1.15rem;
      font-weight: 800;
      color: #054054;
    }
    .kpi-num.neg {
      color: #dc3545;
    }
    .kpi-lbl {
      font-size: 0.74rem;
      color: #7d97a1;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .pago {
      color: #198754;
      font-size: 0.74rem;
    }
    .vazio {
      text-align: center;
      color: #8a99a4;
      padding: 22px !important;
      font-size: 0.85rem;
    }
    .pag {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding-top: 12px;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .pag button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .cancel-aviso {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 12px;
      font-size: 0.82rem;
      color: #8a5a56;
    }

    /* mat-icon — tamanhos agrupados */
    .aba mat-icon,
    .salao-busca mat-icon,
    .info-card mat-icon,
    .modal-head h5 mat-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
    }
    .quick-t mat-icon,
    .btn-outline mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .btn-add mat-icon,
    .btn-mini mat-icon,
    .cc-voltar mat-icon,
    .cancel-aviso mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .cc-meta mat-icon,
    .mesa-toggle mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .tile-meta mat-icon,
    .kpi-lbl mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .tile-num mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .tile.novo mat-icon,
    .cc-vazio mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    .sem-atend mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
    }
  `,
})
export class PdvComponent extends PdvStore {
  protected override readonly modalVoltar = viewChild<ElementRef<HTMLButtonElement>>('modalVoltar');
}
