import {
  Component, computed, effect, ElementRef, inject, signal, viewChild, OnInit,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService, num } from '@core/services/api.service';
import {
  ComandaItemView,
  ComandaView,
  ComissaoResumo,
  ComissaoView,
  ContaFinanceira,
  FormaPagamento,
  Funcionario,
  GarcomView,
  ItemVendaView,
  MesaView,
  Page,
  ReservaResumo,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

type Aba = 'mesas' | 'comandas' | 'garcons';

/** Rótulo humano da comanda — mesa, quarto ou balcão. */
function rotuloComanda(c: ComandaView): string {
  if (c.tipo === 'mesa') return `Mesa ${c.mesa_numero ?? '?'}`;
  if (c.tipo === 'quarto') return `Quarto ${c.quarto_numero ?? '?'}`;
  return c.rotulo ?? 'Balcão';
}

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
        <button type="button" class="btn-prim" (click)="novaMesa.set(!novaMesa())">
          <mat-icon>add</mat-icon> Nova mesa
        </button>
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
        <div class="atend">

          <!-- ---------- coluna 1 · atendimentos ---------- -->
          <aside class="ates card0" aria-label="Atendimentos">
            <header class="ates-head">
              <h3>Atendimentos</h3>
              <button type="button" class="icon-btn" (click)="novaMesa.set(!novaMesa())"
                      aria-label="Nova mesa" title="Nova mesa">
                <mat-icon>tune</mat-icon>
              </button>
            </header>

            @if (novaMesa()) {
              <form class="mini-form" [formGroup]="mesaForm" (ngSubmit)="criarMesa()">
                <input class="inp" formControlName="numero" placeholder="Número/nome *" aria-label="Número da mesa" />
                <input class="inp n" formControlName="lugares" type="number" min="1" placeholder="Lugares" aria-label="Lugares" />
                <button class="btn-prim" type="submit" [disabled]="mesaForm.invalid" aria-label="Criar mesa">
                  <mat-icon>check</mat-icon>
                </button>
              </form>
            }

            <div class="seg3" role="group" aria-label="Tipo de atendimento">
              @for (t of tiposAtend; track t.id) {
                <button type="button" class="seg3-btn" [class.ativo]="tipoAtend() === t.id"
                        (click)="tipoAtend.set(t.id)">{{ t.rotulo }}</button>
              }
            </div>

            <label class="lbl">Buscar atendimento</label>
            <input class="inp" placeholder="Mesa ou comanda" [value]="buscaAtend()"
                   (input)="buscaAtend.set($any($event.target).value)"
                   aria-label="Buscar mesa ou comanda" />

            @if (tipoAtend() !== 'balcao') {
              <select class="inp" [value]="filtroLista()" aria-label="Filtrar atendimentos"
                      (change)="filtroLista.set($any($event.target).value)">
                <option value="todas">
                  {{ tipoAtend() === 'mesa' ? 'Todas as mesas' : 'Todos os quartos' }}</option>
                <option value="livre">
                  {{ tipoAtend() === 'mesa' ? 'Livres' : 'Sem comanda' }}</option>
                <option value="ocupada">Com consumo</option>
              </select>
            }

            <div class="lista">
              @if (tipoAtend() === 'mesa') {
                @for (m of mesasVisiveis(); track m.id) {
                  <div class="at-card" [class.sel]="selecionada(m.idcomanda, m.id)"
                       [class.ocupada]="m.idcomanda !== null">
                    <button type="button" class="at-main" (click)="clicarMesa(m)"
                            [attr.aria-label]="'Mesa ' + m.numero">
                      <mat-icon>table_restaurant</mat-icon>
                      <span class="at-id">
                        <strong>Mesa {{ m.numero }}</strong>
                        <span class="at-chip" [class.livre]="m.idcomanda === null">
                          {{ m.idcomanda === null ? 'Livre' : 'Com consumo' }}
                        </span>
                      </span>
                      <span class="at-right">
                        @if (selecionada(m.idcomanda, m.id)) {
                          <small class="at-tag">Selecionada</small>
                        }
                        <span class="at-val">{{ m.idcomanda === null ? '—' : fmt(m.total_aberto) }}</span>
                      </span>
                    </button>
                    <button type="button" class="mesa-toggle" (click)="toggleMesa(m)"
                            [disabled]="m.idcomanda !== null"
                            [attr.aria-label]="'Desativar mesa ' + m.numero"
                            [title]="m.idcomanda !== null ? 'Feche a comanda antes de desativar a mesa.' : 'Desativar mesa'">
                      <mat-icon>power_settings_new</mat-icon>
                    </button>
                  </div>
                } @empty {
                  <p class="vazio">Nenhuma mesa encontrada.</p>
                }
                @if (mesasInativas().length) {
                  <details class="inativas">
                    <summary>Mesas inativas ({{ mesasInativas().length }})</summary>
                    @for (m of mesasInativas(); track m.id) {
                      <div class="at-card inativa">
                        <span class="at-main">
                          <mat-icon>table_restaurant</mat-icon>
                          <span class="at-id"><strong>Mesa {{ m.numero }}</strong>
                            <span class="at-chip">Inativa</span></span>
                          <button type="button" class="mesa-toggle on" (click)="toggleMesa(m)"
                                  [attr.aria-label]="'Reativar mesa ' + m.numero" title="Reativar mesa">
                            <mat-icon>power_settings_new</mat-icon>
                          </button>
                        </span>
                      </div>
                    }
                  </details>
                }
              }

              @if (tipoAtend() === 'quarto') {
                @for (r of quartosVisiveis(); track r.idquarto) {
                  <div class="at-card" [class.sel]="comandaDoQuarto(r.quarto_numero)?.id === comanda()?.id"
                       [class.ocupada]="comandaDoQuarto(r.quarto_numero) !== undefined">
                    <button type="button" class="at-main" (click)="clicarQuarto(r)"
                            [attr.aria-label]="'Quarto ' + r.quarto_numero">
                      <mat-icon>bed_double</mat-icon>
                      <span class="at-id">
                        <strong>Quarto {{ r.quarto_numero }}</strong>
                        <small class="at-sub">{{ r.cliente_nome }}</small>
                        <span class="at-chip" [class.livre]="!comandaDoQuarto(r.quarto_numero)">
                          {{ comandaDoQuarto(r.quarto_numero) ? 'Com consumo' : 'Em estadia' }}
                        </span>
                      </span>
                      <span class="at-right">
                        @if (comandaDoQuarto(r.quarto_numero)?.id === comanda()?.id) {
                          <small class="at-tag">Selecionada</small>
                        }
                        <span class="at-val">
                          @if (comandaDoQuarto(r.quarto_numero); as cq) { {{ fmt(cq.total_itens) }} } @else { — }
                        </span>
                      </span>
                    </button>
                  </div>
                } @empty {
                  <p class="vazio">Nenhum quarto em estadia.</p>
                }
              }

              @if (tipoAtend() === 'balcao') {
                <button type="button" class="at-card novo" (click)="novoBalcao()">
                  <mat-icon>add</mat-icon> Nova comanda de balcão
                </button>
                @for (c of balcaoVisiveis(); track c.id) {
                  <div class="at-card ocupada" [class.sel]="comanda()?.id === c.id">
                    <button type="button" class="at-main" (click)="abrirDetalhe(c.id)"
                            [attr.aria-label]="rotulo(c)">
                      <mat-icon>storefront</mat-icon>
                      <span class="at-id">
                        <strong>{{ rotulo(c) }}</strong>
                        <span class="at-chip">Aberta</span>
                      </span>
                      <span class="at-right">
                        @if (comanda()?.id === c.id) { <small class="at-tag">Selecionada</small> }
                        <span class="at-val">{{ fmt(c.total_itens) }}</span>
                      </span>
                    </button>
                  </div>
                } @empty {
                  <p class="vazio">Nenhuma comanda de balcão aberta.</p>
                }
              }
            </div>

            <!-- abertura rápida -->
            @if (selecao(); as sel) {
              <form class="quick" [formGroup]="abrirForm" (ngSubmit)="abrirComanda()">
                <p class="quick-t">
                  <mat-icon>receipt</mat-icon>
                  {{ sel.tipo === 'mesa' ? 'Abrir comanda — Mesa ' + sel.rotulo :
                     sel.tipo === 'quarto' ? 'Abrir comanda — Quarto ' + sel.rotulo :
                     'Nova comanda de balcão' }}
                </p>
                @if (sel.tipo === 'balcao') {
                  <input class="inp" formControlName="rotulo" placeholder="Rótulo * — ex.: Delivery"
                         aria-label="Rótulo da comanda" />
                }
                <label class="lbl">Garçom
                  <select class="inp" formControlName="idgarcom" aria-label="Garçom responsável">
                    <option [ngValue]="null">—</option>
                    @for (g of garconsAtivos(); track g.idfuncionario) {
                      <option [ngValue]="g.idfuncionario">{{ g.funcionario_nome }} ({{ g.percentual }}%)</option>
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

            <p class="ates-nota">Selecione um atendimento para acessar a comanda ou iniciar um novo.</p>
          </aside>

          <!-- ---------- coluna 2 · catálogo ---------- -->
          <section class="cat-col" aria-label="Adicionar produtos">
            <header class="cat-head">
              <div>
                <h3>Adicionar produtos</h3>
                <p class="cat-sub">
                  {{ comanda() ? 'Inclua itens na comanda ' + rotulo(comanda()!) + '.' : 'Selecione um atendimento para lançar itens.' }}
                </p>
              </div>
              <span class="pill-gold">Catálogo</span>
            </header>

            @if (comanda(); as com) {
              @if (com.status === 'aberta') {
                <label class="lbl">Buscar produto</label>
                <input class="inp" placeholder="Digite o nome ou código do produto" [value]="buscaProd()"
                       (input)="buscaProd.set($any($event.target).value)"
                       aria-label="Buscar produto" />

                <div class="cats" role="group" aria-label="Categorias">
                  <button type="button" class="cat-pill" [class.ativo]="catProd() === null"
                          (click)="catProd.set(null)">Todos</button>
                  @for (c of categorias(); track c) {
                    <button type="button" class="cat-pill" [class.ativo]="catProd() === c"
                            (click)="catProd.set(c)">{{ c }}</button>
                  }
                </div>

                <div class="produtos">
                  @for (i of itensFiltrados(); track i.id) {
                    <div class="prod">
                      <div class="prod-desc">
                        <strong>{{ i.nome }}</strong>
                        <small>{{ i.categoria_nome ?? 'Sem categoria' }} · est. {{ i.quantidade }}</small>
                      </div>
                      <div class="prod-rod">
                        <span class="prod-preco">{{ fmt(i.valor_unitario) }}</span>
                        <button type="button" class="btn-add" [disabled]="salvando() || num(i.quantidade) < 1"
                                (click)="adicionarProduto(i)" [attr.aria-label]="'Adicionar ' + i.nome">
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
            } @else {
              <div class="sem-atend">
                <mat-icon>point_of_sale</mat-icon>
                <p>Selecione um atendimento ao lado para abrir a comanda e lançar produtos.</p>
              </div>
            }
          </section>

          <!-- ---------- coluna 3 · comanda ---------- -->
          <aside class="com-card card0" aria-label="Comanda">
            @if (comanda(); as com) {
              <header class="cc-head">
                <div>
                  <span class="eyebrow sm">{{ eyebrowComanda(com) }}</span>
                  <h3>{{ rotulo(com) }} <small>Nº {{ com.id }}</small></h3>
                </div>
                <span class="chip" [class]="'chip-' + com.status">{{ rotuloStatus(com.status) }}</span>
              </header>

              <div class="cc-meta">
                @if (com.garcom_nome) { <span><mat-icon>person</mat-icon> {{ com.garcom_nome }}</span> }
                @if (com.cliente_nome) { <span><mat-icon>hotel</mat-icon> {{ com.cliente_nome }}</span> }
                <span><mat-icon>schedule</mat-icon> aberta {{ com.aberto_em | date: 'dd/MM HH:mm' }}</span>
              </div>

              <div class="cc-pedido">
                <header class="cc-ped-head">
                  <h4>Pedido</h4>
                  <span>{{ itens().length }} {{ itens().length === 1 ? 'item' : 'itens' }}</span>
                </header>

                <div class="cc-consumo">
                  <div><strong>Consumo registrado</strong>
                    <span class="cc-total-sm">{{ fmt(com.total_itens) }}</span></div>
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
                          <span class="chip" [class]="'chip-' + i.status">{{ rotuloItem(i.status) }}</span>
                        </small>
                      </span>
                      @if (com.status === 'aberta' && i.status !== 'cancelado') {
                        <span class="cc-acoes">
                          @if (i.status !== 'entregue') {
                            <button type="button" class="btn-mini ok" (click)="entregarItem(i.id)"
                                    aria-label="Marcar entregue" title="Marcar entregue">
                              <mat-icon>check</mat-icon>
                            </button>
                          }
                          <button type="button" class="btn-mini dan" (click)="iniciarCancelamento('item', i.id)"
                                  aria-label="Cancelar item" title="Cancelar e devolver ao estoque">
                            <mat-icon>undo</mat-icon>
                          </button>
                        </span>
                      }
                    </li>
                  } @empty {
                    <li class="cc-vazio">
                      <mat-icon>list_alt</mat-icon>
                      <strong>Nenhum item lançado</strong>
                      <span>Use "Adicionar" no catálogo ao lado. Confira os itens antes de lançar.</span>
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
                  <button type="button" class="btn-outline block" (click)="fechando.set(true)"
                          [disabled]="itens().length === 0">
                    <mat-icon>point_of_sale</mat-icon> Revisar fechamento
                  </button>
                  <p class="cc-nota">Confira a comanda antes de seguir para o pagamento.</p>
                  <button type="button" class="btn-ghost-danger block"
                          (click)="iniciarCancelamento('comanda')" [disabled]="salvando()">
                    Cancelar comanda
                  </button>
                  <button type="button" class="cc-voltar" (click)="fecharDetalhe()">
                    <mat-icon>arrow_back</mat-icon> Voltar aos atendimentos
                  </button>
                } @else {
                  <button type="button" class="btn-gray block" (click)="fecharDetalhe()">
                    <mat-icon>arrow_back</mat-icon> Voltar
                  </button>
                }
              </footer>

            } @else {
              <div class="cc-vazio grande">
                <mat-icon>receipt_long</mat-icon>
                <strong>Nenhum atendimento selecionado</strong>
                <span>Escolha uma mesa, quarto ou balcão ao lado para ver a comanda.</span>
              </div>
            }
          </aside>
        </div>
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
                <button type="button" class="close" (click)="fechando.set(false)"
                        aria-label="Fechar">&times;</button>
              </div>
              <form class="modal-body" [formGroup]="fecharForm" (ngSubmit)="fecharComanda()">
                <div class="seg" role="group" aria-label="Modo de fechamento">
                  <button type="button" class="seg-btn" [class.ativo]="modo() === 'pagar'"
                          (click)="setModo('pagar')">
                    <mat-icon>payments</mat-icon> Pagar agora
                  </button>
                  @if (com.idreserva) {
                    <button type="button" class="seg-btn" [class.ativo]="modo() === 'faturar'"
                            (click)="setModo('faturar')">
                      <mat-icon>hotel</mat-icon> Faturar ao quarto
                    </button>
                  }
                </div>
                <div class="fechar-grid">
                  @if (modo() === 'pagar') {
                    <label class="lbl">Conta *
                      <select class="inp" formControlName="idconta_financeira" aria-label="Conta financeira">
                        <option [ngValue]="null" disabled>Selecione…</option>
                        @for (c of contas(); track c.id) {
                          <option [ngValue]="c.id">{{ c.nome }}</option>
                        }
                      </select>
                    </label>
                    <label class="lbl">Forma de pagamento *
                      <select class="inp" formControlName="idforma_pagamento" aria-label="Forma de pagamento">
                        <option [ngValue]="null" disabled>Selecione…</option>
                        @for (f of formas(); track f.id) {
                          <option [ngValue]="f.id">{{ f.nome }}</option>
                        }
                      </select>
                    </label>
                  }
                  <label class="lbl">Desconto
                    <input class="inp" formControlName="desconto" type="number" step="0.01" min="0" aria-label="Desconto" />
                  </label>
                </div>
                <p class="fechar-total">
                  Subtotal {{ fmt(com.total_itens) }}
                  @if (num(fecharForm.controls.desconto.value) > 0) {
                    − desconto {{ fmt(fecharForm.controls.desconto.value) }}
                  }
                  = <strong>{{ fmt(num(com.total_itens) - num(fecharForm.controls.desconto.value)) }}</strong>
                </p>
                <div class="fechar-acoes">
                  <button type="button" class="btn-gray" #modalVoltar (click)="fechando.set(false)">Voltar</button>
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
                <mat-icon>cancel</mat-icon> Cancelar {{ tipo === 'item' ? 'item' : 'comanda inteira' }}
              </h5>
              <button type="button" class="close" (click)="cancelando.set(null)"
                      aria-label="Fechar">&times;</button>
            </div>
            <form class="modal-body" [formGroup]="cancelForm" (ngSubmit)="confirmarCancelamento()">
              <p class="cancel-aviso">
                <mat-icon>info</mat-icon>
                {{ tipo === 'item' ? 'A quantidade volta ao estoque.' : 'Todos os itens voltam ao estoque.' }}
              </p>
              <input class="inp" formControlName="motivo" placeholder="Motivo do cancelamento *"
                     aria-label="Motivo do cancelamento" />
              <div class="fechar-acoes">
                <button type="button" class="btn-gray" #modalVoltar (click)="cancelando.set(null)">Voltar</button>
                <button type="submit" class="btn-danger" [disabled]="cancelForm.invalid || salvando()">
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
                  <button type="button" class="seg-btn" [class.ativo]="abrirForm.controls.tipo.value === t.id"
                          (click)="setTipo(t.id)">
                    <mat-icon>{{ t.icone }}</mat-icon> {{ t.rotulo }}
                  </button>
                }
              </div>
              <div class="ab-campos">
                @if (abrirForm.controls.tipo.value === 'mesa') {
                  <label class="lbl">Mesa *
                    <select class="inp" formControlName="idmesa" aria-label="Mesa">
                      <option [ngValue]="null" disabled>Selecione…</option>
                      @for (m of mesasLivres(); track m.id) {
                        <option [ngValue]="m.id">Mesa {{ m.numero }} ({{ m.lugares }} lug.)</option>
                      }
                    </select>
                  </label>
                }
                @if (abrirForm.controls.tipo.value === 'quarto') {
                  <label class="lbl grow">Quarto (reserva em estadia) *
                    <select class="inp" formControlName="idquarto" aria-label="Quarto com reserva em estadia">
                      <option [ngValue]="null" disabled>Selecione…</option>
                      @for (r of reservasEstadia(); track r.id) {
                        <option [ngValue]="r.idquarto">Quarto {{ r.quarto_numero }} — {{ r.cliente_nome }}</option>
                      }
                    </select>
                  </label>
                }
                @if (abrirForm.controls.tipo.value === 'balcao') {
                  <label class="lbl grow">Rótulo *
                    <input class="inp" formControlName="rotulo" placeholder="Ex.: Cliente balcão, Delivery…" aria-label="Rótulo da comanda" />
                  </label>
                }
                <label class="lbl">Garçom
                  <select class="inp" formControlName="idgarcom" aria-label="Garçom responsável">
                    <option [ngValue]="null">—</option>
                    @for (g of garconsAtivos(); track g.idfuncionario) {
                      <option [ngValue]="g.idfuncionario">{{ g.funcionario_nome }} ({{ g.percentual }}%)</option>
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
              <thead><tr>
                <th>Nº</th><th>Comanda</th><th>Garçom</th>
                <th>Abertura</th><th class="r">Itens</th><th class="r">Total</th>
                <th>Status</th>
              </tr></thead>
              <tbody>
                @for (c of comandas(); track c.id) {
                  <tr class="linha-comanda" (click)="abrirDetalhe(c.id)">
                    <td>{{ c.id }}</td>
                    <td>{{ rotulo(c) }}@if (c.cliente_nome) { <small class="cat"> · {{ c.cliente_nome }}</small> }</td>
                    <td>{{ c.garcom_nome ?? '—' }}</td>
                    <td>{{ c.aberto_em | date: 'dd/MM HH:mm' }}</td>
                    <td class="r">{{ c.itens_pendentes }}</td>
                    <td class="r">{{ fmt(c.status === 'fechada' ? c.total : c.total_itens) }}</td>
                    <td><span class="chip" [class]="'chip-' + c.status">{{ c.status }}</span></td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="vazio">Nenhuma comanda encontrada.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (comandasTotal() > POR_PAGINA) {
            <footer class="pag">
              <button type="button" class="btn-mini-cta" [disabled]="comandasPage() <= 1"
                      (click)="paginarComandas(comandasPage() - 1)">
                <mat-icon>chevron_left</mat-icon> Anterior
              </button>
              <span>{{ comandasPage() }} / {{ comandasTotalPaginas() }} — {{ comandasTotal() }} comandas</span>
              <button type="button" class="btn-mini-cta" [disabled]="comandasPage() >= comandasTotalPaginas()"
                      (click)="paginarComandas(comandasPage() + 1)">
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
            <input class="inp n" formControlName="percentual" type="number" step="0.5" min="0" max="100"
                   placeholder="% comissão" aria-label="Percentual de comissão" />
            <button class="btn-prim" type="submit" [disabled]="garcomForm.invalid">
              <mat-icon>save</mat-icon>
            </button>
          </form>
          <div class="tab-wrap">
            <table class="tab">
              <thead><tr><th>Garçom</th><th class="r">Comissão</th><th>Status</th><th class="r">Ação</th></tr></thead>
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
                      <button type="button" class="btn-mini" [class.ok]="!g.ativo" [class.dan]="g.ativo"
                              (click)="toggleGarcom(g)"
                              [attr.aria-label]="(g.ativo ? 'Desativar' : 'Reativar') + ' ' + g.funcionario_nome"
                              [title]="g.ativo ? 'Desativar garçom' : 'Reativar garçom'">
                        <mat-icon>power_settings_new</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="vazio">Cadastre o primeiro garçom acima.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h3><mat-icon>account_balance_wallet</mat-icon> Comissões</h3></header>

          <div class="kpi">
            @for (r of resumoComissoes(); track r.idgarcom) {
              <div class="kpi-item">
                <span class="kpi-num neg">{{ fmt(r.valor_pendente) }}</span>
                <span class="kpi-lbl"><mat-icon>person</mat-icon> {{ r.garcom_nome }} — pendente</span>
                <small class="pago">pago: {{ fmt(r.valor_pago) }}</small>
              </div>
            } @empty {
              <p class="vazio">Nenhuma comissão provisionada ainda.</p>
            }
          </div>

          <div class="tab-wrap">
            <table class="tab">
              <thead><tr>
                <th>Garçom</th><th>Comanda</th><th class="r">%</th>
                <th class="r">Base</th><th class="r">Valor</th><th>Status</th><th class="r">Ação</th>
              </tr></thead>
              <tbody>
                @for (c of comissoes(); track c.id) {
                  <tr>
                    <td>{{ c.garcom_nome }}</td>
                    <td>{{ c.comanda_descricao }}</td>
                    <td class="r">{{ c.percentual }}%</td>
                    <td class="r">{{ fmt(c.base) }}</td>
                    <td class="r">{{ fmt(c.valor) }}</td>
                    <td><span class="chip" [class]="'chip-' + (c.status === 'paga' ? 'entregue' : 'pendente')">{{ c.status }}</span></td>
                    <td class="r">
                      @if (c.status === 'pendente') {
                        <button type="button" class="btn-mini ok" (click)="iniciarPagamento(c.id)"
                                aria-label="Pagar comissão" title="Pagar comissão">
                          <mat-icon>payments</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="vazio">Sem comissões no período.</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (comissoesTotal() > POR_PAGINA) {
            <footer class="pag">
              <button type="button" class="btn-mini-cta" [disabled]="comissoesPage() <= 1"
                      (click)="paginarComissoes(comissoesPage() - 1)">
                <mat-icon>chevron_left</mat-icon> Anterior
              </button>
              <span>{{ comissoesPage() }} / {{ comissoesTotalPaginas() }} — {{ comissoesTotal() }} comissões</span>
              <button type="button" class="btn-mini-cta" [disabled]="comissoesPage() >= comissoesTotalPaginas()"
                      (click)="paginarComissoes(comissoesPage() + 1)">
                Próxima <mat-icon>chevron_right</mat-icon>
              </button>
            </footer>
          }

          @if (pagando(); as pid) {
            <form class="fechar" [formGroup]="pagarForm" (ngSubmit)="pagarComissao(pid)">
              <h4><mat-icon>payments</mat-icon> Pagar comissão Nº{{ pid }}</h4>
              <div class="fechar-grid">
                <label class="lbl">Conta de origem *
                  <select class="inp" formControlName="idconta_financeira" aria-label="Conta financeira">
                    <option [ngValue]="null" disabled>Selecione…</option>
                    @for (c of contas(); track c.id) {
                      <option [ngValue]="c.id">{{ c.nome }}</option>
                    }
                  </select>
                </label>
                <label class="lbl">Forma de pagamento
                  <select class="inp" formControlName="idforma_pagamento" aria-label="Forma de pagamento">
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
    .page { padding: 4px 6px 40px; max-width: 1440px; background: transparent;
      border: 0; box-shadow: none; }

    /* ---------- cabeçalho da operação (padrão Espírito do Mar) ---------- */
    .pdv-head { display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap; padding: 8px 4px 0; }
    .eyebrow { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: #4b95ab; margin: 0 0 4px; }
    .eyebrow.sm { font-size: 0.66rem; }
    .titulo { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.9rem; font-weight: 600; color: #054054; line-height: 1.1; }
    .sub { margin: 4px 0 0; font-size: 0.86rem; color: #7d97a1; }

    /* ---------- abas — linha com underline ativo ---------- */
    .abas { display: flex; gap: 4px; border-bottom: 1px solid #e5ded2;
      margin: 14px 0 18px; padding: 0 4px; }
    .aba { display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px;
      border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px;
      background: transparent; color: #5d6d7e;
      font-weight: 600; font-size: 0.86rem; cursor: pointer; }
    .aba mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .aba:hover { color: #054054; }
    .aba.ativa { color: #054054; border-bottom-color: #054054; }
    .aba:focus-visible { outline: 2px solid #1a6f8a; outline-offset: 2px; }

    .card { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 18px 20px; margin-bottom: 16px; }
    .card-head { display: flex; justify-content: space-between; align-items: center;
      gap: 12px; margin-bottom: 14px; }
    .card-head h3 { margin: 0; font-size: 1rem; font-weight: 700; color: #054054;
      display: flex; align-items: center; gap: 8px; }
    .card-head small { color: #8a99a4; }
    .card0 { background: #fff; border: 1px solid #e3eaef; border-radius: 12px; }

    /* ================= workspace 3 colunas ================= */
    .atend { display: grid; grid-template-columns: 300px minmax(0, 1fr) 400px;
      gap: 18px; align-items: start; }
    @media (max-width: 1180px) {
      .atend { grid-template-columns: 300px minmax(0, 1fr); }
      .com-card { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      .atend { grid-template-columns: 1fr; }
    }

    /* ---------- coluna 1 · atendimentos ---------- */
    .ates { padding: 16px; display: flex; flex-direction: column; gap: 12px;
      position: sticky; top: 12px; }
    .ates-head { display: flex; align-items: center; justify-content: space-between; }
    .ates-head h3 { margin: 0; font-size: 1.05rem; font-weight: 700; color: #33424c; }
    .icon-btn { border: 0; background: transparent; color: #5d6d7e; width: 34px;
      height: 34px; border-radius: 8px; display: inline-flex; align-items: center;
      justify-content: center; cursor: pointer; }
    .icon-btn:hover { background: #eef2f5; color: #054054; }
    .seg3 { display: flex; background: #eef2f5; border-radius: 9px; padding: 3px; }
    .seg3-btn { flex: 1; border: 0; background: transparent; padding: 7px 4px;
      border-radius: 7px; font-size: 0.78rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; }
    .seg3-btn.ativo { background: #fff; color: #054054;
      box-shadow: 0 1px 3px rgba(5,64,84,.12); }

    .lista { display: flex; flex-direction: column; gap: 8px; max-height: 430px;
      overflow-y: auto; }
    .at-card { position: relative; border: 1px solid #e8e2d6; border-radius: 10px;
      background: #fff; }
    .at-card.ocupada { border-color: #cfe0e7; }
    .at-card.sel { border-color: #054054; box-shadow: 0 0 0 1px #054054 inset; }
    .at-card.novo { display: flex; align-items: center; justify-content: center;
      gap: 8px; padding: 11px; border-style: dashed; color: #054054;
      font-weight: 600; font-size: 0.82rem; cursor: pointer; }
    .at-card.novo:hover { background: #f6fafb; }
    .at-main { display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 11px 12px; border: 0; background: transparent; cursor: pointer;
      text-align: left; }
    .at-main mat-icon { color: #054054; font-size: 20px; width: 20px; height: 20px; }
    .at-card.inativa .at-main { cursor: default; opacity: .65; }
    .at-id { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .at-id strong { font-size: 0.88rem; color: #33424c; }
    .at-sub { font-size: 0.74rem; color: #8a99a4; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .at-chip { align-self: flex-start; font-size: 0.68rem; font-weight: 700;
      padding: 2px 8px; border-radius: 999px; background: #e8f2f6; color: #054054; }
    .at-chip.livre { background: #e3f3e6; color: #198754; }
    .at-right { display: flex; flex-direction: column; align-items: flex-end;
      gap: 3px; flex-shrink: 0; }
    .at-tag { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: #4b95ab; }
    .at-val { font-size: 0.85rem; font-weight: 700; color: #054054;
      white-space: nowrap; }
    .mesa-toggle { position: absolute; top: 8px; right: 8px; width: 24px;
      height: 24px; border: 0; border-radius: 6px; background: transparent;
      color: #a5b6bf; cursor: pointer; display: inline-flex; align-items: center;
      justify-content: center; opacity: 0; transition: opacity .15s; }
    .at-card:hover .mesa-toggle, .mesa-toggle:focus-visible,
    .at-card.inativa .mesa-toggle { opacity: 1; }
    .mesa-toggle:hover:not(:disabled) { background: #fbeaea; color: #dc3545; }
    .mesa-toggle.on:hover { background: #e3f3e6; color: #198754; }
    .mesa-toggle:disabled { cursor: not-allowed; color: #cfd9de; }
    .mesa-toggle mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .mesa-toggle:focus-visible { outline: 2px solid #1a6f8a; }
    .inativas { border-top: 1px dashed #e3eaef; padding-top: 10px; }
    .inativas summary { cursor: pointer; font-size: 0.78rem; font-weight: 600;
      color: #7d97a1; margin-bottom: 8px; }
    .inativas .at-card { margin-top: 8px; }

    .quick { border-top: 1px solid #e3eaef; padding-top: 12px;
      display: flex; flex-direction: column; gap: 10px; }
    .quick-t { display: flex; align-items: center; gap: 7px; margin: 0;
      font-size: 0.84rem; font-weight: 700; color: #054054; }
    .quick-t mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .quick-acoes { display: flex; justify-content: flex-end; gap: 8px; }
    .ates-nota { margin: 2px 0 0; font-size: 0.74rem; color: #8fa3ab;
      line-height: 1.45; }

    /* ---------- coluna 2 · catálogo ---------- */
    .cat-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .cat-head { display: flex; justify-content: space-between; align-items: flex-start;
      gap: 12px; }
    .cat-head h3 { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.45rem; font-weight: 600; color: #054054; }
    .cat-sub { margin: 3px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .pill-gold { flex-shrink: 0; font-size: 0.72rem; font-weight: 700;
      padding: 5px 12px; border-radius: 999px; background: #fdf3e2;
      color: #92670b; border: 1px solid #f3d9a8; }
    .cats { display: flex; gap: 8px; flex-wrap: wrap; }
    .cat-pill { border: 1px solid #d7e0e6; background: #fff; border-radius: 9px;
      padding: 8px 15px; font-size: 0.8rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; }
    .cat-pill:hover { border-color: #4b95ab; color: #054054; }
    .cat-pill.ativo { background: #054054; border-color: #054054; color: #fff; }
    .produtos { display: grid; grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
      gap: 12px; }
    .prod { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .prod-desc { display: flex; flex-direction: column; gap: 3px; }
    .prod-desc strong { font-size: 0.92rem; color: #33424c; }
    .prod-desc small { font-size: 0.76rem; color: #8a99a4; }
    .prod-rod { display: flex; align-items: center; justify-content: space-between;
      gap: 10px; }
    .prod-preco { font-size: 0.95rem; font-weight: 800; color: #054054; }
    .btn-add { display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #054054; background: #fff; color: #054054;
      font-weight: 600; font-size: 0.8rem; padding: 8px 13px; border-radius: 9px;
      cursor: pointer; }
    .btn-add:hover:not(:disabled) { background: #054054; color: #fff; }
    .btn-add:disabled { opacity: .45; cursor: default; }
    .btn-add mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .info-card { display: flex; gap: 12px; align-items: flex-start;
      background: #eef4f6; border: 1px solid #d3e4ec; border-radius: 12px;
      padding: 14px 16px; }
    .info-card mat-icon { color: #054054; font-size: 19px; width: 19px;
      height: 19px; margin-top: 2px; }
    .info-card strong { font-size: 0.86rem; color: #054054; }
    .info-card p { margin: 3px 0 0; font-size: 0.78rem; color: #5d6d7e; }
    .sem-atend { background: #fff; border: 1px dashed #ddd4c4; border-radius: 12px;
      padding: 44px 24px; text-align: center; color: #8a99a4;
      display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .sem-atend mat-icon { font-size: 30px; width: 30px; height: 30px;
      color: #b9c4cb; }
    .sem-atend p { margin: 0; font-size: 0.88rem; max-width: 340px; }

    /* ---------- coluna 3 · comanda ---------- */
    .com-card { padding: 18px; display: flex; flex-direction: column; gap: 14px;
      position: sticky; top: 12px; }
    .cc-head { display: flex; align-items: flex-start; justify-content: space-between;
      gap: 10px; }
    .cc-head h3 { margin: 2px 0 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.5rem; font-weight: 600; color: #054054; }
    .cc-head h3 small { font-family: 'Manrope', sans-serif; font-size: 0.78rem;
      color: #8a99a4; font-weight: 500; }
    .cc-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      font-size: 0.78rem; color: #5d6d7e; padding-bottom: 12px;
      border-bottom: 1px solid #e3eaef; }
    .cc-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .cc-meta mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .cc-ped-head { display: flex; align-items: baseline; justify-content: space-between; }
    .cc-ped-head h4 { margin: 0; font-size: 0.92rem; font-weight: 700; color: #33424c; }
    .cc-ped-head span { font-size: 0.74rem; color: #8a99a4; }
    .cc-consumo { background: #eef4f6; border-radius: 10px; padding: 12px 14px;
      margin: 10px 0; }
    .cc-consumo > div { display: flex; justify-content: space-between;
      align-items: baseline; }
    .cc-consumo strong { font-size: 0.84rem; color: #054054; }
    .cc-total-sm { font-weight: 800; color: #054054; }
    .cc-consumo p { margin: 5px 0 0; font-size: 0.74rem; color: #5d6d7e;
      line-height: 1.45; }
    .cc-itens { list-style: none; margin: 0; padding: 0; display: flex;
      flex-direction: column; }
    .cc-itens li { display: flex; align-items: center; gap: 10px;
      padding: 9px 2px; border-bottom: 1px solid #f2f7f9; }
    .cc-itens li:last-child { border-bottom: 0; }
    .cc-itens li.cancelado { opacity: .5; }
    .cc-qtd { flex-shrink: 0; font-size: 0.8rem; font-weight: 800; color: #054054;
      background: #eef2f5; border-radius: 7px; padding: 5px 8px; min-width: 38px;
      text-align: center; }
    .cc-item { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .cc-item strong { font-size: 0.86rem; color: #33424c; }
    .cc-item small { font-size: 0.74rem; color: #8a99a4; display: inline-flex;
      align-items: center; gap: 8px; }
    .cc-acoes { display: inline-flex; flex-shrink: 0; }
    .cc-vazio { display: flex; flex-direction: column; align-items: center;
      gap: 6px; padding: 20px !important; text-align: center;
      border: 1px dashed #ddd4c4 !important; border-radius: 10px; }
    .cc-vazio mat-icon { color: #b9c4cb; font-size: 24px; width: 24px;
      height: 24px; }
    .cc-vazio strong { font-size: 0.86rem; color: #5d6d7e; }
    .cc-vazio span { font-size: 0.74rem; color: #8a99a4; }
    .cc-vazio.grande { margin: auto; padding: 40px 22px !important; }
    .cc-foot { display: flex; flex-direction: column; gap: 9px;
      border-top: 1px solid #e3eaef; padding-top: 14px; }
    .cc-total { display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 4px; }
    .cc-total strong { font-size: 0.9rem; color: #33424c; display: block; }
    .cc-total small { font-size: 0.72rem; color: #8a99a4; }
    .cc-total-vl { font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.7rem; font-weight: 700; color: #054054; }
    .btn-prim.block, .btn-ghost-danger.block, .btn-gray.block,
    .btn-outline.block { width: 100%; justify-content: center; padding: 12px;
      font-size: 0.88rem; }
    .btn-outline { display: inline-flex; align-items: center; gap: 7px;
      border: 1px solid #054054; background: #fff; color: #054054;
      font-weight: 700; padding: 10px 18px; border-radius: 9px; cursor: pointer; }
    .btn-outline:hover:not(:disabled) { background: #eef4f6; }
    .btn-outline:disabled { opacity: .45; cursor: default; }
    .btn-outline mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cc-nota { margin: 0; font-size: 0.72rem; color: #8fa3ab; text-align: center; }
    .btn-ghost-danger { display: inline-flex; align-items: center; gap: 7px;
      border: 1px solid #e7c8c6; background: #fff; color: #dc3545;
      font-weight: 600; font-size: 0.85rem; padding: 10px 18px;
      border-radius: 8px; cursor: pointer; }
    .btn-ghost-danger:hover:not(:disabled) { background: #fbeaea; }
    .btn-ghost-danger:disabled { opacity: .55; cursor: default; }
    .cc-voltar { border: 0; background: transparent; color: #5d6d7e;
      font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center;
      justify-content: center; gap: 6px; cursor: pointer; padding: 6px; }
    .cc-voltar:hover { color: #054054; }
    .cc-voltar mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* ---------- formulários compartilhados ---------- */
    .mini-form, .ab-form { display: flex; gap: 10px; align-items: center;
      flex-wrap: wrap; padding: 12px; background: #f4f8fa; border-radius: 10px;
      margin-bottom: 14px; }
    .ates .mini-form { margin-bottom: 0; }
    .ab-form { flex-direction: column; align-items: stretch; }
    .ab-campos { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
    .filtros { display: flex; gap: 8px; align-items: center; }

    .lbl { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem;
      font-weight: 600; color: #5d6d7e; }
    .lbl.grow, .grow { flex: 1; min-width: 160px; }
    .inp { border: 1px solid #d7e0e6; border-radius: 8px; padding: 9px 12px;
      font-size: 0.88rem; background: #fff; color: #33424c; width: 100%; }
    .ates .inp, .cat-col .inp { background: #fff; }
    .inp:focus { outline: 2px solid #1a6f8a; border-color: #1a6f8a; }
    .inp.n { width: 110px; }
    .inp.sm { padding: 7px 10px; font-size: 0.82rem; width: auto; }

    .btn-prim { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: #054054; color: #fff; font-weight: 600; font-size: 0.85rem;
      padding: 10px 18px; border-radius: 9px; cursor: pointer; }
    .btn-prim:hover:not(:disabled) { background: #042f3d; }
    .btn-prim:disabled { opacity: 0.55; cursor: default; }
    .btn-gray { display: inline-flex; align-items: center; gap: 7px;
      border: 1px solid #d7e0e6; background: #fff; color: #5d6d7e;
      font-weight: 600; font-size: 0.85rem; padding: 10px 18px;
      border-radius: 9px; cursor: pointer; }
    .btn-danger { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: #fbeaea; color: #dc3545; font-weight: 600; font-size: 0.85rem;
      padding: 10px 18px; border-radius: 9px; cursor: pointer; }
    .btn-danger:hover:not(:disabled) { background: #f5d5d3; }
    .btn-mini-cta { display: inline-flex; align-items: center; gap: 6px; border: 0;
      background: #e8f2f6; color: #054054; font-weight: 600; font-size: 0.8rem;
      padding: 8px 14px; border-radius: 9px; cursor: pointer; }
    .btn-mini { border: 0; border-radius: 6px; width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; margin-left: 2px; }
    .btn-mini mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .btn-mini.ok { background: #e3f3e6; color: #198754; }
    .btn-mini.dan { background: #fbeaea; color: #dc3545; }

    .seg { display: inline-flex; gap: 6px; }
    .seg-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px;
      border: 1px solid #d7e0e6; border-radius: 9px; background: #fff;
      color: #5d6d7e; font-weight: 600; font-size: 0.83rem; cursor: pointer; }
    .seg-btn.ativo { background: #054054; color: #fff; border-color: #054054; }

    .tab-wrap { overflow-x: auto; }
    .tab { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    .tab th { text-align: left; padding: 10px 10px; color: #054054; font-size: 0.74rem;
      text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid #eef2f5; }
    .tab td { padding: 10px; border-bottom: 1px solid #f1f5f7; vertical-align: middle; }
    .tab .r { text-align: right; }
    .linha-comanda { cursor: pointer; }
    .linha-comanda:hover td { background: #f6fafc; }
    .linha-cancelada td { opacity: 0.55; }
    .cat { color: #8a99a4; }
    .cat::before { content: ' · '; }
    .mot { display: block; color: #dc3545; font-size: 0.75rem; }

    .chip { display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 0.72rem; font-weight: 700; text-transform: capitalize; }
    .chip-aberta, .chip-pendente { background: #f7ead2; color: #92670b; }
    .chip-em_preparo { background: #dbeafe; color: #1d4ed8; }
    .chip-fechada, .chip-entregue, .chip-pronto { background: #e3f3e6; color: #198754; }
    .chip-cancelada, .chip-cancelado { background: #fbeaea; color: #dc3545; }

    .fechar { margin-top: 4px; padding: 16px; background: #f0f7fa;
      border: 1px solid #d3e4ec; border-radius: 10px; }
    .fechar h4 { margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
      color: #054054; font-size: 0.95rem; }
    .fechar-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
    .fechar-total { font-size: 0.88rem; color: #5d6d7e; margin: 12px 0; }
    .fechar-total strong { color: #054054; font-size: 1rem; }
    .fechar-acoes { display: flex; justify-content: flex-end; gap: 10px; }
    .modal-head h5 { display: flex; align-items: center; gap: 8px;
      color: #054054; }
    .modal-head h5 mat-icon { font-size: 19px; width: 19px; height: 19px; }

    .kpi { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .kpi-item { flex: 1; min-width: 150px; background: #f4f8fa; border: 1px solid #e3eaef;
      border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
    .kpi-num { font-size: 1.15rem; font-weight: 800; color: #054054; }
    .kpi-num.neg { color: #dc3545; }
    .kpi-lbl { font-size: 0.74rem; color: #7d97a1; display: inline-flex;
      align-items: center; gap: 5px; }
    .kpi-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .pago { color: #198754; font-size: 0.74rem; }

    .vazio { text-align: center; color: #8a99a4; padding: 22px !important;
      font-size: 0.85rem; }

    .pag { display: flex; align-items: center; justify-content: center;
      gap: 14px; padding-top: 12px; font-size: 0.82rem; color: #7d97a1; }
    .pag button:disabled { opacity: 0.45; cursor: default; }

    .fechar.cancel { background: #fdf3f2; border-color: #f0d4d2; }
    .cancel-aviso { display: flex; align-items: center; gap: 6px; margin: 0 0 12px;
      font-size: 0.82rem; color: #8a5a56; }
    .cancel-aviso mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .fechar.cancel .inp { margin-bottom: 12px; width: 100%; }
  `,
})
export class PdvComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

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
  readonly selecao = signal<{ tipo: 'mesa' | 'quarto' | 'balcao'; id: number | null; rotulo: string } | null>(null);

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

  readonly mesasLivres = computed(() =>
    this.mesasAtivas().filter((m) => m.idcomanda === null),
  );
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
      (i) =>
        (!cat || i.categoria_nome === cat) &&
        (!q || i.nome.toLowerCase().includes(q)),
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
    percentual: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0), Validators.max(100)] }),
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
  private readonly modalVoltar = viewChild<ElementRef<HTMLButtonElement>>('modalVoltar');

  constructor() {
    effect(() => {
      if (this.fechando() || this.cancelando()) {
        this.modalVoltar()?.nativeElement.focus();
      }
    });
  }

  ngOnInit(): void {
    this.carregarMesas();
    this.carregarComandas();
    this.carregarAbertas();
    this.carregarGarcons();
    this.carregarAuxiliares();
    this.filtroStatus.valueChanges.subscribe(() => {
      this.comandasPage.set(1);
      this.carregarComandas();
    });
  }

  private carregarAuxiliares(): void {
    this.api.listarContasFinanceiras().subscribe({
      next: (c) => this.contas.set(c.filter((x) => x.ativo)),
      error: () => {},
    });
    this.api.listarPagamentos().subscribe({
      next: (f) => this.formas.set(f.filter((x) => x.ativo)),
      error: () => {},
    });
    this.api.listarFuncionarios(1, 100, true).subscribe({
      next: (p: Page<Funcionario>) => this.funcionarios.set(p.items),
      error: () => {},
    });
    this.api.itensVenda().subscribe({
      next: (i) => this.itensVenda.set(i),
      error: () => {},
    });
    this.api.listarReservas({ status: 'i', porPagina: 100 }).subscribe({
      next: (p) => this.reservasEstadia.set(p.items.filter((r) => r.idquarto !== null)),
      error: () => {},
    });
  }

  mudarAba(a: Aba): void {
    this.aba.set(a);
    if (a === 'comandas') this.carregarComandas();
    if (a === 'garcons') this.carregarComissoes();
  }

  carregarMesas(): void {
    this.api.listarMesas().subscribe({
      next: (m) => this.mesas.set(m),
      error: () => this.notify.erro('Falha ao carregar mesas.'),
    });
  }

  carregarComandas(): void {
    this.api
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
    this.api.listarGarcons().subscribe({
      next: (g) => this.garcons.set(g),
      error: () => {},
    });
  }

  carregarComissoes(): void {
    this.api
      .listarComissoes({ page: this.comissoesPage(), porPagina: this.POR_PAGINA })
      .subscribe({
        next: (p) => {
          this.comissoes.set(p.items);
          this.comissoesTotal.set(p.total);
        },
        error: () => this.notify.erro('Falha ao carregar comissões.'),
      });
    this.api.resumoComissoes().subscribe({
      next: (r) => this.resumoComissoes.set(r),
      error: () => {},
    });
  }

  // -------------------------------------------------------------------- mesas

  criarMesa(): void {
    const v = this.mesaForm.getRawValue();
    this.api.criarMesa(v.numero.trim(), v.lugares).subscribe({
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
    this.abrirForm.reset({ tipo: 'balcao', idmesa: null, idquarto: null, idgarcom: null, rotulo: '' });
  }

  selecionada(idcomanda: number | null, idmesa: number): boolean {
    const sel = this.selecao();
    if (sel?.tipo === 'mesa' && sel.id === idmesa) return true;
    const com = this.comanda();
    return com !== null && idcomanda !== null && com.id === idcomanda;
  }

  eyebrowComanda(c: ComandaView): string {
    return c.tipo === 'mesa' ? 'Comanda da mesa'
      : c.tipo === 'quarto' ? 'Comanda do quarto' : 'Comanda do balcão';
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
    this.api.abrirComanda({
      tipo: v.tipo,
      idmesa: v.idmesa,
      idquarto: v.idquarto,
      idgarcom: v.idgarcom,
      rotulo: v.rotulo.trim() || null,
    }).subscribe({
      next: (c) => {
        this.salvando.set(false);
        this.notify.ok(`Comanda Nº${c.id} aberta.`);
        this.abrindo.set(false);
        this.selecao.set(null);
        this.abrirForm.reset({ tipo: 'balcao', idmesa: null, idquarto: null, idgarcom: null, rotulo: '' });
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
    this.api.buscarComanda(id).subscribe({
      next: (c) => {
        this.comanda.set(c);
        this.fechando.set(false);
        this.cancelando.set(null);
        this.api.itensComanda(id).subscribe({
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
    this.api
      .listarComandas({ status: 'aberta', page: 1, porPagina: 50 })
      .subscribe({
        next: (p) => this.comandasAbertas.set(p.items),
        error: () => {},
      });
  }

  private recarregarComanda(): void {
    const id = this.comanda()?.id;
    if (id) {
      this.api.buscarComanda(id).subscribe({ next: (c) => this.comanda.set(c), error: () => {} });
      this.api.itensComanda(id).subscribe({ next: (i) => this.itens.set(i), error: () => {} });
      this.api.itensVenda().subscribe({ next: (i) => this.itensVenda.set(i), error: () => {} });
    }
  }

  // -------------------------------------------------------------------- itens

  adicionarProduto(i: ItemVendaView): void {
    const com = this.comanda();
    if (!com || com.status !== 'aberta') return;
    this.salvando.set(true);
    this.api.adicionarItem(com.id, i.id, 1).subscribe({
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
    this.api.entregarItem(com.id, iditem).subscribe({
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
        e?.error?.erro?.mensagem ??
          `Falha ao cancelar ${tipo === 'item' ? 'item' : 'comanda'}.`,
      );
    };
    if (tipo === 'item') {
      this.api.cancelarItem(com.id, this.cancelandoItem()!, motivo).subscribe({
        next: () => {
          ok('Item cancelado — estoque devolvido.');
          this.recarregarComanda();
        },
        error: erro,
      });
    } else {
      this.api.cancelarComanda(com.id, motivo).subscribe({
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
    this.api.fecharComanda(com.id, {
      modo: this.modo(),
      desconto: v.desconto,
      idconta_financeira: v.idconta_financeira,
      idforma_pagamento: v.idforma_pagamento,
    }).subscribe({
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
    this.api.salvarGarcom(v.idfuncionario, v.percentual, true).subscribe({
      next: () => {
        this.notify.ok('Garçom configurado.');
        this.garcomForm.reset({ idfuncionario: null, percentual: null });
        this.carregarGarcons();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao salvar garçom.'),
    });
  }

  toggleMesa(m: MesaView): void {
    this.api.statusMesa(m.id, !m.ativo).subscribe({
      next: () => {
        this.notify.ok(`Mesa ${m.numero} ${m.ativo ? 'desativada' : 'reativada'}.`);
        this.carregarMesas();
      },
      error: (e) => this.notify.erro(e?.error?.erro?.mensagem ?? 'Falha ao atualizar mesa.'),
    });
  }

  toggleGarcom(g: GarcomView): void {
    this.api.salvarGarcom(g.idfuncionario, num(g.percentual), !g.ativo).subscribe({
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
    this.api.pagarComissao(id, v.idconta_financeira, v.idforma_pagamento).subscribe({
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
