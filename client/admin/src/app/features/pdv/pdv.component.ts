import { Component, computed, inject, signal, OnInit } from '@angular/core';
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
  imports: [DatePipe, ReactiveFormsModule, MatIconModule],
  template: `
    <div class="page">
      <header class="pdv-head">
        <div>
          <h2 class="titulo">PDV &amp; Comandas</h2>
          <p class="sub">Mesas, quartos e balcão — baixa automática no estoque</p>
        </div>
        <nav class="abas" aria-label="Seções do PDV">
          @for (a of abas; track a.id) {
            <button type="button" class="aba" [class.ativa]="aba() === a.id" (click)="mudarAba(a.id)">
              <mat-icon>{{ a.icone }}</mat-icon> {{ a.rotulo }}
            </button>
          }
        </nav>
      </header>

      <!-- ================================================== comanda aberta -->
      @if (comanda(); as com) {
        <section class="card comanda">
          <header class="com-head">
            <button type="button" class="btn-voltar" (click)="fecharDetalhe()" aria-label="Voltar">
              <mat-icon>arrow_back</mat-icon>
            </button>
            <div class="com-id">
              <h3>{{ rotulo(com) }} <small>Nº {{ com.id }}</small></h3>
              <p class="com-meta">
                <span class="chip" [class]="'chip-' + com.status">{{ com.status }}</span>
                @if (com.garcom_nome) { <span><mat-icon>person</mat-icon> {{ com.garcom_nome }}</span> }
                @if (com.cliente_nome) { <span><mat-icon>hotel</mat-icon> {{ com.cliente_nome }}</span> }
                <span><mat-icon>schedule</mat-icon> aberta {{ com.aberto_em | date: 'dd/MM HH:mm' }}</span>
              </p>
            </div>
            <div class="com-total">
              <span class="sub-l">Total</span>
              <strong>{{ fmt(com.total_itens) }}</strong>
            </div>
          </header>

          @if (com.status === 'aberta') {
            <!-- adicionar item -->
            <form class="add-form" [formGroup]="itemForm" (ngSubmit)="adicionarItem()">
              <label class="lbl grow">Item
                <select class="inp" formControlName="iditem" aria-label="Item do estoque">
                  <option [ngValue]="null" disabled>Selecione…</option>
                  @for (i of itensVenda(); track i.id) {
                    <option [ngValue]="i.id">
                      {{ i.nome }}{{ i.categoria_nome ? ' · ' + i.categoria_nome : '' }} — {{ fmt(i.valor_unitario) }} (est. {{ i.quantidade }})
                    </option>
                  }
                </select>
              </label>
              <label class="lbl qtd">Qtd.
                <input class="inp" formControlName="quantidade" type="number" min="1" step="1" aria-label="Quantidade" />
              </label>
              <button class="btn-prim" type="submit" [disabled]="itemForm.invalid || salvando()">
                <mat-icon>add_shopping_cart</mat-icon> Lançar
              </button>
            </form>
          }

          <!-- itens -->
          <div class="tab-wrap">
            <table class="tab">
              <thead><tr>
                <th>Item</th><th class="r">Qtd</th><th class="r">Unit.</th>
                <th class="r">Total</th><th>Status</th><th class="r">Ações</th>
              </tr></thead>
              <tbody>
                @for (i of itens(); track i.id) {
                  <tr [class.linha-cancelada]="i.status === 'cancelado'">
                    <td>
                      {{ i.item_nome }}
                      @if (i.categoria_nome) { <small class="cat">{{ i.categoria_nome }}</small> }
                      @if (i.motivo_cancelamento) {
                        <small class="mot">motivo: {{ i.motivo_cancelamento }}</small>
                      }
                    </td>
                    <td class="r">{{ i.quantidade }}</td>
                    <td class="r">{{ fmt(i.valor_unit) }}</td>
                    <td class="r">{{ fmt(i.valor_total) }}</td>
                    <td>
                      <span class="chip" [class]="'chip-' + i.status">{{ rotuloItem(i.status) }}</span>
                    </td>
                    <td class="r">
                      @if (com.status === 'aberta' && i.status !== 'cancelado') {
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
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" class="vazio">Nenhum item lançado.</td></tr>
                }
              </tbody>
            </table>
          </div>

          @if (com.status === 'aberta') {
            <!-- ações da comanda -->
            <footer class="com-foot">
              <button type="button" class="btn-danger" (click)="iniciarCancelamento('comanda')" [disabled]="salvando()">
                <mat-icon>cancel</mat-icon> Cancelar comanda
              </button>
              <span class="flex"></span>
              <button type="button" class="btn-prim" (click)="fechando.set(true)" [disabled]="itens().length === 0">
                <mat-icon>point_of_sale</mat-icon> Fechar comanda
              </button>
            </footer>

            <!-- painel de cancelamento -->
            @if (cancelando(); as tipo) {
              <form class="fechar cancel" [formGroup]="cancelForm" (ngSubmit)="confirmarCancelamento()">
                <h4><mat-icon>cancel</mat-icon> Cancelar {{ tipo === 'item' ? 'item' : 'comanda inteira' }}</h4>
                <p class="cancel-aviso">
                  <mat-icon>info</mat-icon>
                  {{ tipo === 'item' ? 'A quantidade volta ao estoque.' : 'Todos os itens voltam ao estoque.' }}
                </p>
                <input class="inp" formControlName="motivo" placeholder="Motivo do cancelamento *"
                       aria-label="Motivo do cancelamento" />
                <div class="fechar-acoes">
                  <button type="button" class="btn-gray" (click)="cancelando.set(null)">Voltar</button>
                  <button type="submit" class="btn-danger" [disabled]="cancelForm.invalid || salvando()">
                    <mat-icon>cancel</mat-icon> Confirmar cancelamento
                  </button>
                </div>
              </form>
            }

            <!-- painel de fechamento -->
            @if (fechando()) {
              <form class="fechar" [formGroup]="fecharForm" (ngSubmit)="fecharComanda()">
                <h4><mat-icon>point_of_sale</mat-icon> Fechamento</h4>
                <div class="seg" role="group" aria-label="Modo de fechamento">
                  <button type="button" class="seg-btn" [class.ativo]="modo() === 'pagar'" (click)="setModo('pagar')">
                    <mat-icon>payments</mat-icon> Pagar agora
                  </button>
                  @if (com.idreserva) {
                    <button type="button" class="seg-btn" [class.ativo]="modo() === 'faturar'" (click)="setModo('faturar')">
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
                  <button type="button" class="btn-gray" (click)="fechando.set(false)">Voltar</button>
                  <button type="submit" class="btn-prim" [disabled]="!fecharValido() || salvando()">
                    <mat-icon>check_circle</mat-icon>
                    {{ modo() === 'pagar' ? 'Confirmar pagamento' : 'Faturar' }}
                  </button>
                </div>
              </form>
            }
          }
        </section>
      } @else {

      <!-- ===================================================== aba: mesas -->
      @if (aba() === 'mesas') {
        <section class="card">
          <header class="card-head">
            <h3><mat-icon>table_restaurant</mat-icon> Mesas do salão</h3>
            <button type="button" class="btn-mini-cta" (click)="novaMesa.set(!novaMesa())">
              <mat-icon>add</mat-icon> Nova mesa
            </button>
          </header>

          @if (novaMesa()) {
            <form class="mini-form" [formGroup]="mesaForm" (ngSubmit)="criarMesa()">
              <input class="inp" formControlName="numero" placeholder="Número/nome *" aria-label="Número da mesa" />
              <input class="inp n" formControlName="lugares" type="number" min="1" placeholder="Lugares" aria-label="Lugares" />
              <button class="btn-prim" type="submit" [disabled]="mesaForm.invalid">
                <mat-icon>check</mat-icon>
              </button>
            </form>
          }

          <div class="mesas-grid">
            @for (m of mesasAtivas(); track m.id) {
              <div class="mesa-wrap" [class.ocupada]="m.idcomanda !== null">
                <button type="button" class="mesa" (click)="clicarMesa(m)" [attr.aria-label]="'Mesa ' + m.numero">
                  <span class="mesa-num">{{ m.numero }}</span>
                  <span class="mesa-info">
                    @if (m.idcomanda === null) {
                      <mat-icon>check_circle</mat-icon> Livre · {{ m.lugares }} lug.
                    } @else {
                      <mat-icon>restaurant</mat-icon>
                      {{ fmt(m.total_aberto) }}
                      @if (m.garcom_nome) { <small> · {{ m.garcom_nome }}</small> }
                    }
                  </span>
                </button>
                <button type="button" class="mesa-toggle" (click)="toggleMesa(m)"
                        [attr.aria-label]="'Desativar mesa ' + m.numero" title="Desativar mesa">
                  <mat-icon>power_settings_new</mat-icon>
                </button>
              </div>
            } @empty {
              <p class="vazio">Nenhuma mesa ativa — crie a primeira acima.</p>
            }
          </div>

          @if (mesasInativas().length) {
            <details class="inativas">
              <summary>Mesas inativas ({{ mesasInativas().length }})</summary>
              <div class="mesas-grid cinza">
                @for (m of mesasInativas(); track m.id) {
                  <div class="mesa-wrap inativa">
                    <button type="button" class="mesa" disabled [attr.aria-label]="'Mesa ' + m.numero + ' inativa'">
                      <span class="mesa-num">{{ m.numero }}</span>
                      <span class="mesa-info"><mat-icon>block</mat-icon> Inativa</span>
                    </button>
                    <button type="button" class="mesa-toggle on" (click)="toggleMesa(m)"
                            [attr.aria-label]="'Reativar mesa ' + m.numero" title="Reativar mesa">
                      <mat-icon>power_settings_new</mat-icon>
                    </button>
                  </div>
                }
              </div>
            </details>
          }
        </section>
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
      }
    </div>
  `,
  styles: `
    .page { padding: 4px 6px 40px; max-width: 1200px; }
    .pdv-head { display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    .titulo { margin: 0; font-size: 1.35rem; font-weight: 700; color: #054054; }
    .sub { margin: 2px 0 0; font-size: 0.84rem; color: #7d8c96; }
    .abas { display: flex; gap: 6px; }
    .aba { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px;
      border: 1px solid #dde5ea; border-radius: 8px; background: #fff; color: #5d6d7e;
      font-weight: 600; font-size: 0.84rem; cursor: pointer; }
    .aba.ativa { background: #054054; border-color: #054054; color: #fff; }
    .aba:focus-visible { outline: 2px solid #1a6f8a; outline-offset: 2px; }

    .card { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 18px 20px; margin-bottom: 16px; }
    .card-head { display: flex; justify-content: space-between; align-items: center;
      gap: 12px; margin-bottom: 14px; }
    .card-head h3 { margin: 0; font-size: 1rem; font-weight: 700; color: #054054;
      display: flex; align-items: center; gap: 8px; }
    .card-head small { color: #8a99a4; }

    .mesas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px; }
    .mesa { display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 20px 12px; border: 1.5px solid #b9e4c9; border-radius: 12px;
      background: #f4fbf6; cursor: pointer; transition: transform .12s, box-shadow .12s; }
    .mesa:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(5,64,84,.12); }
    .mesa:focus-visible { outline: 2px solid #1a6f8a; outline-offset: 2px; }
    .mesa.ocupada { background: #fdf3e7; border-color: #f3d3a7; }
    .mesa-num { font-size: 1.3rem; font-weight: 800; color: #054054; }
    .mesa-info { font-size: 0.78rem; color: #5d6d7e; display: inline-flex;
      align-items: center; gap: 4px; }
    .mesa-info mat-icon { font-size: 15px; width: 15px; height: 15px; color: #2e7d32; }
    .mesa.ocupada .mesa-info mat-icon { color: #c47f17; }

    .mini-form, .ab-form { display: flex; gap: 10px; align-items: center;
      flex-wrap: wrap; padding: 12px; background: #f6f9fb; border-radius: 10px;
      margin-bottom: 14px; }
    .ab-form { flex-direction: column; align-items: stretch; }
    .ab-campos { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
    .filtros { display: flex; gap: 8px; align-items: center; }

    .lbl { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem;
      font-weight: 600; color: #5d6d7e; }
    .lbl.grow, .grow { flex: 1; min-width: 160px; }
    .lbl.qtd { width: 90px; }
    .inp { border: 1px solid #dde5ea; border-radius: 8px; padding: 9px 12px;
      font-size: 0.88rem; background: #fff; color: #2d3f4c; }
    .inp:focus { outline: 2px solid #1a6f8a; border-color: #1a6f8a; }
    .inp.n { width: 110px; }
    .inp.sm { padding: 7px 10px; font-size: 0.82rem; }

    .btn-prim { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: #054054; color: #fff; font-weight: 600; font-size: 0.85rem;
      padding: 10px 18px; border-radius: 8px; cursor: pointer; }
    .btn-prim:hover:not(:disabled) { background: #1a6f8a; }
    .btn-prim:disabled { opacity: 0.55; cursor: default; }
    .btn-gray { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #dde5ea;
      background: #fff; color: #5d6d7e; font-weight: 600; font-size: 0.85rem;
      padding: 10px 18px; border-radius: 8px; cursor: pointer; }
    .btn-danger { display: inline-flex; align-items: center; gap: 7px; border: 0;
      background: #fbeaea; color: #b3261e; font-weight: 600; font-size: 0.85rem;
      padding: 10px 18px; border-radius: 8px; cursor: pointer; }
    .btn-danger:hover:not(:disabled) { background: #f5d5d3; }
    .btn-mini-cta { display: inline-flex; align-items: center; gap: 6px; border: 0;
      background: #e8f2f6; color: #054054; font-weight: 600; font-size: 0.8rem;
      padding: 8px 14px; border-radius: 8px; cursor: pointer; }
    .btn-mini { border: 0; border-radius: 6px; width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; margin-left: 4px; }
    .btn-mini mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-mini.ok { background: #e3f3e6; color: #2e7d32; }
    .btn-mini.dan { background: #fbeaea; color: #b3261e; }
    .btn-voltar { border: 0; background: #eef4f7; border-radius: 8px; width: 36px;
      height: 36px; display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; color: #054054; }

    .seg { display: inline-flex; gap: 6px; }
    .seg-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px;
      border: 1px solid #dde5ea; border-radius: 8px; background: #fff; color: #5d6d7e;
      font-weight: 600; font-size: 0.83rem; cursor: pointer; }
    .seg-btn.ativo { background: #054054; color: #fff; border-color: #054054; }

    .tab-wrap { overflow-x: auto; }
    .tab { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    .tab th { text-align: left; padding: 10px 10px; color: #8a99a4; font-size: 0.74rem;
      text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid #eef2f5; }
    .tab td { padding: 10px; border-bottom: 1px solid #f1f5f7; vertical-align: middle; }
    .tab .r { text-align: right; }
    .linha-comanda { cursor: pointer; }
    .linha-comanda:hover td { background: #f6fafc; }
    .linha-cancelada td { opacity: 0.55; }
    .cat { color: #8a99a4; }
    .cat::before { content: ' · '; }
    .mot { display: block; color: #b3261e; font-size: 0.75rem; }

    .chip { display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 0.72rem; font-weight: 700; text-transform: capitalize; }
    .chip-aberta, .chip-pendente { background: #fff3d6; color: #92670b; }
    .chip-em_preparo { background: #dbeafe; color: #1d4ed8; }
    .chip-fechada, .chip-entregue, .chip-pronto { background: #e3f3e6; color: #2e7d32; }
    .chip-cancelada, .chip-cancelado { background: #fbeaea; color: #b3261e; }

    .com-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .com-id { flex: 1; }
    .com-id h3 { margin: 0; font-size: 1.1rem; color: #054054; }
    .com-id h3 small { color: #8a99a4; font-weight: 500; }
    .com-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      margin: 4px 0 0; font-size: 0.8rem; color: #5d6d7e; }
    .com-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .com-meta mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .com-total { text-align: right; }
    .com-total strong { font-size: 1.3rem; color: #054054; }
    .sub-l { display: block; font-size: 0.72rem; color: #8a99a4; text-transform: uppercase; }

    .add-form { display: flex; gap: 10px; align-items: flex-end;
      padding: 12px; background: #f6f9fb; border-radius: 10px; margin-bottom: 12px; }
    .com-foot { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
    .flex { flex: 1; }

    .fechar { margin-top: 14px; padding: 16px; background: #f0f7fa;
      border: 1px solid #d3e4ec; border-radius: 10px; }
    .fechar h4 { margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
      color: #054054; font-size: 0.95rem; }
    .fechar-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .fechar-grid .lbl { min-width: 200px; }
    .fechar-total { font-size: 0.88rem; color: #5d6d7e; margin: 12px 0; }
    .fechar-total strong { color: #054054; font-size: 1rem; }
    .fechar-acoes { display: flex; justify-content: flex-end; gap: 10px; }

    .kpi { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
    .kpi-item { flex: 1; min-width: 150px; background: #f6f9fb; border: 1px solid #e8eef2;
      border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
    .kpi-num { font-size: 1.15rem; font-weight: 800; color: #054054; }
    .kpi-num.neg { color: #b3261e; }
    .kpi-lbl { font-size: 0.74rem; color: #7d8c96; display: inline-flex;
      align-items: center; gap: 5px; }
    .kpi-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .pago { color: #2e7d32; font-size: 0.74rem; }

    .vazio { text-align: center; color: #8a99a4; padding: 22px !important;
      font-size: 0.85rem; }

    .mesa-wrap { position: relative; }
    .mesa-wrap .mesa { width: 100%; }
    .mesa-wrap.inativa .mesa { background: #f1f4f6; border-color: #dde5ea;
      opacity: 0.7; cursor: not-allowed; }
    .mesa-wrap.inativa .mesa-num { color: #7d97a1; }
    .mesa-toggle { position: absolute; top: 6px; right: 6px; width: 24px;
      height: 24px; border: 0; border-radius: 6px; background: transparent;
      color: #a5b6bf; cursor: pointer; display: inline-flex; align-items: center;
      justify-content: center; opacity: 0; transition: opacity .15s; }
    .mesa-wrap:hover .mesa-toggle, .mesa-toggle:focus-visible,
    .mesa-wrap.inativa .mesa-toggle { opacity: 1; }
    .mesa-toggle:hover { background: #fbeaea; color: #b3261e; }
    .mesa-toggle.on:hover { background: #e3f3e6; color: #2e7d32; }
    .mesa-toggle mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .mesa-toggle:focus-visible { outline: 2px solid #1a6f8a; }

    .inativas { margin-top: 14px; border-top: 1px dashed #e3eaef; padding-top: 12px; }
    .inativas summary { cursor: pointer; font-size: 0.8rem; font-weight: 600;
      color: #7d97a1; margin-bottom: 12px; }
    .mesas-grid.cinza { opacity: 0.85; }

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
    { id: 'mesas', rotulo: 'Mesas', icone: 'table_restaurant' },
    { id: 'comandas', rotulo: 'Comandas', icone: 'receipt_long' },
    { id: 'garcons', rotulo: 'Garçons & Comissões', icone: 'room_service' },
  ];
  readonly tipos = [
    { id: 'mesa' as const, rotulo: 'Mesa', icone: 'table_restaurant' },
    { id: 'quarto' as const, rotulo: 'Quarto', icone: 'hotel' },
    { id: 'balcao' as const, rotulo: 'Balcão', icone: 'storefront' },
  ];

  readonly aba = signal<Aba>('mesas');
  readonly salvando = signal(false);

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
  readonly itemForm = new FormGroup({
    iditem: new FormControl<number | null>(null, { validators: [Validators.required] }),
    quantidade: new FormControl(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
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

  ngOnInit(): void {
    this.carregarMesas();
    this.carregarComandas();
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
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Falha ao criar mesa.'),
    });
  }

  clicarMesa(m: MesaView): void {
    if (m.idcomanda !== null) {
      this.abrirDetalhe(m.idcomanda);
      return;
    }
    // mesa livre → abre comanda direto nela
    this.abrindo.set(true);
    this.aba.set('comandas');
    this.abrirForm.patchValue({ tipo: 'mesa', idmesa: m.id });
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
        this.abrirForm.reset({ tipo: 'balcao', idmesa: null, idquarto: null, idgarcom: null, rotulo: '' });
        this.carregarMesas();
        this.carregarComandas();
        this.abrirDetalhe(c.id);
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e?.error?.mensagem ?? 'Falha ao abrir comanda.');
      },
    });
  }

  abrirDetalhe(id: number): void {
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
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Comanda não encontrada.'),
    });
  }

  fecharDetalhe(): void {
    this.comanda.set(null);
    this.itens.set([]);
    this.fechando.set(false);
    this.cancelando.set(null);
    this.carregarMesas();
    this.carregarComandas();
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

  adicionarItem(): void {
    const com = this.comanda();
    const v = this.itemForm.getRawValue();
    if (!com || v.iditem === null) return;
    this.salvando.set(true);
    this.api.adicionarItem(com.id, v.iditem, v.quantidade).subscribe({
      next: () => {
        this.salvando.set(false);
        this.itemForm.reset({ iditem: null, quantidade: 1 });
        this.recarregarComanda();
      },
      error: (e) => {
        this.salvando.set(false);
        this.notify.erro(e?.error?.mensagem ?? 'Falha ao lançar item.');
      },
    });
  }

  entregarItem(iditem: number): void {
    const com = this.comanda();
    if (!com) return;
    this.api.entregarItem(com.id, iditem).subscribe({
      next: () => this.recarregarComanda(),
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Falha ao marcar entregue.'),
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
    const erro = (e: { error?: { mensagem?: string } }) => {
      this.salvando.set(false);
      this.notify.erro(
        e?.error?.mensagem ??
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
        this.notify.erro(e?.error?.mensagem ?? 'Falha ao fechar comanda.');
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
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Falha ao salvar garçom.'),
    });
  }

  toggleMesa(m: MesaView): void {
    this.api.statusMesa(m.id, !m.ativo).subscribe({
      next: () => {
        this.notify.ok(`Mesa ${m.numero} ${m.ativo ? 'desativada' : 'reativada'}.`);
        this.carregarMesas();
      },
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Falha ao atualizar mesa.'),
    });
  }

  toggleGarcom(g: GarcomView): void {
    this.api.salvarGarcom(g.idfuncionario, num(g.percentual), !g.ativo).subscribe({
      next: () => {
        this.notify.ok(`${g.funcionario_nome} ${g.ativo ? 'desativado' : 'reativado'}.`);
        this.carregarGarcons();
      },
      error: (e) => this.notify.erro(e?.error?.mensagem ?? 'Falha ao atualizar garçom.'),
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
        this.notify.erro(e?.error?.mensagem ?? 'Falha ao pagar comissão.');
      },
    });
  }
}
