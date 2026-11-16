import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { firstValueFrom } from 'rxjs';
import { Fornecedor, FornecedorInput, PedidoCompraView, PedidoItemView, RecebimentoItem } from '@core/models/compras.models';
import { ItemEstoque } from '@core/models/estoque.models';
import { ComprasApi } from '@core/api/compras.api';
import { EstoqueApi } from '@core/api/estoque.api';
import { Confirm } from '../../core/services/confirm.service';
import { Notify } from '../../core/services/notify.service';
import { Realtime } from '../../core/services/realtime.service';

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  recebido: 'Recebido',
  cancelado: 'Cancelado',
};

const STATUS_ICON: Record<string, string> = {
  pendente: 'schedule',
  parcial: 'hourglass_top',
  recebido: 'check_circle',
  cancelado: 'cancel',
};

interface LinhaPedido {
  readonly uid: number;
  iditem: number | null;
  quantidade: number;
  valor_unit: number | null;
}

@Component({
  selector: 'app-compras',
  imports: [ReactiveFormsModule, MatIconModule, DatePipe, DateInputComponent],
  host: { '(document:keydown.escape)': 'fecharModais()' },
  template: `
    <div class="page">
      <!-- ============ Cabeçalho ============ -->
      <header class="cab">
        <div>
          <h1>Compras</h1>
          <p class="sub">Pedidos de compra, fornecedores e recebimento integrado ao estoque e financeiro.</p>
        </div>
        <div class="cab-acoes">
          <button
            type="button"
            class="btn-out"
            [class.on]="aba() === 'fornecedores'"
            (click)="alternarAba()"
          >
            <mat-icon>{{ aba() === 'fornecedores' ? 'receipt_long' : 'local_shipping' }}</mat-icon>
            {{ aba() === 'fornecedores' ? 'Ver pedidos' : 'Fornecedores' }}
            <span class="pill-cnt">{{ fornecedoresAtivos().length }}</span>
          </button>
          <button type="button" class="btn-dark" [disabled]="abrindoNovo()" (click)="novoPedido()">
            <mat-icon>{{ abrindoNovo() ? 'hourglass_top' : 'add' }}</mat-icon>
            {{ abrindoNovo() ? 'Abrindo…' : 'Novo pedido' }}
          </button>
        </div>
      </header>

      <!-- ============ KPIs Operacionais ============ -->
      <section class="kpis" aria-label="Resumo de compras">
        <button
          type="button"
          class="kpi-card"
          [class.ativo]="aba() === 'pedidos' && filtro() === 'pendente'"
          (click)="irParaStatus('pendente')"
        >
          <div class="kpi-ic kpi-pend"><mat-icon>schedule</mat-icon></div>
          <div class="kpi-txt">
            <span class="kpi-val">{{ contagens()['pendente'] ?? 0 }}</span>
            <span class="kpi-lbl">Aguardando entrega</span>
          </div>
        </button>
        <button
          type="button"
          class="kpi-card"
          [class.ativo]="aba() === 'pedidos' && filtro() === 'parcial'"
          (click)="irParaStatus('parcial')"
        >
          <div class="kpi-ic kpi-parc"><mat-icon>hourglass_top</mat-icon></div>
          <div class="kpi-txt">
            <span class="kpi-val">{{ contagens()['parcial'] ?? 0 }}</span>
            <span class="kpi-lbl">Recebimento parcial</span>
          </div>
        </button>
        <button
          type="button"
          class="kpi-card"
          [class.ativo]="aba() === 'pedidos' && filtro() === 'recebido'"
          (click)="irParaStatus('recebido')"
        >
          <div class="kpi-ic kpi-rec"><mat-icon>inventory</mat-icon></div>
          <div class="kpi-txt">
            <span class="kpi-val">{{ contagens()['recebido'] ?? 0 }}</span>
            <span class="kpi-lbl">Concluídos no estoque</span>
          </div>
        </button>
        <button
          type="button"
          class="kpi-card"
          [class.ativo]="aba() === 'fornecedores'"
          (click)="aba.set('fornecedores')"
        >
          <div class="kpi-ic kpi-forn"><mat-icon>handshake</mat-icon></div>
          <div class="kpi-txt">
            <span class="kpi-val">{{ fornecedoresAtivos().length }}<small>/{{ fornecedores().length }}</small></span>
            <span class="kpi-lbl">Fornecedores ativos</span>
          </div>
        </button>
      </section>

      <!-- ============ ABA: PEDIDOS (Figma 38:205) ============ -->
      @if (aba() === 'pedidos') {
        <div class="sec">
          <h2>Pedidos de compra</h2>
          <span class="sec-cnt">{{ legendaPedidos() }}</span>
        </div>

        <section class="card">
          <div class="filtros">
            <label class="busca">
              <span class="lbl">Buscar pedido</span>
              <div class="busca-wrap">
                <mat-icon class="busca-ic">search</mat-icon>
                <input
                  class="inp inp-busca"
                  placeholder="Nº do pedido ou nome do fornecedor…"
                  [value]="busca()"
                  (input)="busca.set(inp($event))"
                  aria-label="Buscar pedido"
                />
                @if (busca()) {
                  <button type="button" class="busca-limpar" (click)="busca.set('')" aria-label="Limpar busca">
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </div>
            </label>
            <div class="tabs" role="tablist" aria-label="Filtrar por situação">
              @for (t of TABS; track t.v) {
                <button
                  type="button"
                  role="tab"
                  class="tab"
                  [class.on]="filtro() === t.v"
                  [attr.aria-selected]="filtro() === t.v"
                  (click)="setFiltro(t.v)"
                >
                  {{ t.rotulo }}
                  @if (contagens()[t.v] !== undefined) {
                    <span class="tab-cnt">{{ contagens()[t.v] }}</span>
                  }
                </button>
              }
            </div>
          </div>

          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Entrega &amp; Progresso</th>
                  <th>Valor total</th>
                  <th>Situação</th>
                  <th class="ta">Ação</th>
                </tr>
              </thead>
              <tbody>
                @for (p of pedidosFiltrados(); track p.id) {
                  <tr class="row-click" (click)="abrir(p)">
                    <td>
                      <div class="ped">
                        <div class="ped-ic"><mat-icon>description</mat-icon></div>
                        <div class="ped-txt">
                          <strong>
                            Pedido Nº {{ p.id }}
                            @if (p.origem === 'maria') {
                              <span class="maria">Maria</span>
                            }
                            @if (p.idlancamento) {
                              <span class="fin-tag" title="Conta a pagar vinculada">
                                <mat-icon>receipt_long</mat-icon> #{{ p.idlancamento }}
                              </span>
                            }
                          </strong>
                          <small>
                            {{ p.fornecedor }}
                            @if (p.fornecedor_cnpj) {
                              · {{ p.fornecedor_cnpj }}
                            }
                            · Criado em {{ p.criado_em | date: 'dd/MM/yyyy' }}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div class="prog-cell">
                        <div class="prog-top">
                          <span>{{ p.recebido_itens }} de {{ p.total_itens }} {{ p.total_itens === 1 ? 'item' : 'itens' }}</span>
                          @if (p.data_prevista) {
                            <small class="prev-dt">Prev. {{ p.data_prevista | date: 'dd/MM/yyyy' }}</small>
                          }
                        </div>
                        <div class="prog-bar" [attr.aria-label]="'Progresso ' + pctPedido(p) + '%'">
                          <div
                            class="prog-fill"
                            [class.prog-ok]="p.status === 'recebido'"
                            [class.prog-parc]="p.status === 'parcial'"
                            [style.width.%]="pctPedido(p)"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      @if (pos(p.valor_total)) {
                        <strong class="val-str">R$ {{ moeda(p.valor_total) }}</strong>
                      } @else {
                        <span class="mut-inline">A definir</span>
                      }
                    </td>
                    <td>
                      <span [class]="'st st_' + p.status">
                        <mat-icon>{{ statusIcon(p.status) }}</mat-icon>
                        {{ rotulo(p.status) }}
                      </span>
                    </td>
                    <td class="ta" (click)="$event.stopPropagation()">
                      <button type="button" class="btn-ver" (click)="abrir(p)">
                        Ver detalhes <mat-icon>arrow_forward</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5">
                      @if (!carregando()) {
                        <div class="vazio">
                          <mat-icon>shopping_bag</mat-icon>
                          <strong>Nenhum pedido encontrado</strong>
                          <p>Crie um novo pedido de compra para abastecer o estoque da pousada.</p>
                          <button type="button" class="btn-dark" (click)="novoPedido()">
                            <mat-icon>add</mat-icon> Criar primeiro pedido
                          </button>
                        </div>
                      } @else {
                        <div class="vazio">
                          <mat-icon>hourglass_top</mat-icon>
                          <p>Carregando pedidos…</p>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <footer class="card-foot">
            <span class="mut">Exibindo {{ pedidosFiltrados().length }} de {{ total() }} pedidos</span>
            <div class="pager">
              <button
                type="button"
                class="btn-pg"
                [disabled]="pagina() <= 1"
                (click)="pagina.set(pagina() - 1); carregar()"
              >
                Anterior
              </button>
              <span>Página {{ pagina() }} de {{ totalPaginas() }}</span>
              <button
                type="button"
                class="btn-pg"
                [disabled]="pagina() >= totalPaginas()"
                (click)="pagina.set(pagina() + 1); carregar()"
              >
                Próxima
              </button>
            </div>
          </footer>
        </section>
      }

      <!-- ============ ABA: FORNECEDORES ============ -->
      @if (aba() === 'fornecedores') {
        <div class="sec">
          <h2>Fornecedores homologados</h2>
          <span class="sec-cnt">{{ fornecedoresAtivos().length }} ativos de {{ fornecedores().length }} cadastrados</span>
        </div>

        <div class="forn-layout">
          <section class="card card-pad forn-form-card">
            <div class="forn-card-head">
              <h3>
                <mat-icon>{{ fornForm.controls.id.value ? 'edit' : 'person_add' }}</mat-icon>
                {{ fornForm.controls.id.value ? 'Atualizar fornecedor' : 'Novo fornecedor' }}
              </h3>
              @if (fornForm.controls.id.value) {
                <button
                  type="button"
                  class="btn-link"
                  (click)="fornForm.reset({ lead_time_dias: 0 })"
                >
                  Limpar edição
                </button>
              }
            </div>

            @if (fornForm.controls.id.value) {
              <div class="aviso aviso-sm">
                <mat-icon>info</mat-icon>
                <span>A atualização identifica o fornecedor pelo <b>nome</b>; alterar o nome cria um novo cadastro.</span>
              </div>
            }

            <form class="forn-form" [formGroup]="fornForm" (ngSubmit)="salvarFornecedor()">
              <label class="fld">
                <span class="lbl">Razão social / Nome fantasia *</span>
                <input class="inp" formControlName="nome" placeholder="Ex.: Distribuidora Litoral Ltda" />
              </label>
              <div class="fld-row">
                <label class="fld">
                  <span class="lbl">CNPJ</span>
                  <input class="inp" formControlName="cnpj" placeholder="00.000.000/0000-00" />
                </label>
                <label class="fld">
                  <span class="lbl">Lead time (dias)</span>
                  <input class="inp" type="number" min="0" formControlName="lead_time_dias" />
                </label>
              </div>
              <div class="fld-row">
                <label class="fld">
                  <span class="lbl">Pessoa de contato</span>
                  <input class="inp" formControlName="contato" placeholder="Nome do representante" />
                </label>
                <label class="fld">
                  <span class="lbl">Telefone / WhatsApp</span>
                  <input class="inp" formControlName="telefone" placeholder="(00) 00000-0000" />
                </label>
              </div>
              <div class="forn-form-foot">
                <button
                  class="btn-dark w-full"
                  type="submit"
                  [disabled]="fornForm.invalid || salvandoForn()"
                >
                  <mat-icon>save</mat-icon>
                  {{ salvandoForn() ? 'Salvando…' : fornForm.controls.id.value ? 'Salvar alterações' : 'Cadastrar fornecedor' }}
                </button>
              </div>
            </form>
          </section>

          <section class="card">
            <div class="filtros">
              <label class="busca">
                <span class="lbl">Buscar fornecedor</span>
                <div class="busca-wrap">
                  <mat-icon class="busca-ic">search</mat-icon>
                  <input
                    class="inp inp-busca"
                    placeholder="Nome, CNPJ ou contato…"
                    [value]="buscaForn()"
                    (input)="buscaForn.set(inp($event))"
                    aria-label="Buscar fornecedor"
                  />
                </div>
              </label>
            </div>
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Contato</th>
                    <th>Prazo de entrega</th>
                    <th>Status</th>
                    <th class="ta">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of fornecedoresFiltrados(); track f.id) {
                    <tr [class.inativo]="!f.ativo">
                      <td>
                        <div class="ped">
                          <div class="ped-ic"><mat-icon>storefront</mat-icon></div>
                          <div class="ped-txt">
                            <strong>{{ f.nome }}</strong>
                            <small>{{ f.cnpj || 'CNPJ não informado' }}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div class="ped-txt">
                          <strong>{{ f.contato || '—' }}</strong>
                          <small>{{ f.telefone || 'Sem telefone' }}</small>
                        </div>
                      </td>
                      <td>
                        <span class="lead-pill">
                          <mat-icon>local_shipping</mat-icon>
                          {{ f.lead_time_dias }} {{ f.lead_time_dias === 1 ? 'dia' : 'dias' }}
                        </span>
                      </td>
                      <td>
                        <span [class]="f.ativo ? 'st st_recebido' : 'st st_cancelado'">
                          <mat-icon>{{ f.ativo ? 'check_circle' : 'block' }}</mat-icon>
                          {{ f.ativo ? 'Ativo' : 'Inativo' }}
                        </span>
                      </td>
                      <td class="ta">
                        <div class="ac">
                          <button
                            type="button"
                            class="ic"
                            (click)="editarForn(f)"
                            title="Editar dados"
                            aria-label="Editar fornecedor"
                          >
                            <mat-icon>edit</mat-icon>
                          </button>
                          <button
                            type="button"
                            class="ic"
                            (click)="toggleForn(f)"
                            [title]="f.ativo ? 'Desativar fornecedor' : 'Reativar fornecedor'"
                            [attr.aria-label]="f.ativo ? 'Desativar fornecedor' : 'Reativar fornecedor'"
                          >
                            <mat-icon>{{ f.ativo ? 'toggle_on' : 'toggle_off' }}</mat-icon>
                          </button>
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="5">
                        <div class="vazio">
                          <mat-icon>local_shipping</mat-icon>
                          <strong>Nenhum fornecedor cadastrado</strong>
                          <p>Use o formulário ao lado para cadastrar seu primeiro fornecedor.</p>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }

      <!-- ============ MODAL: NOVO PEDIDO DE COMPRA ============ -->
      @if (novo()) {
        <div class="overlay" (click.self)="novo.set(false)">
          <div
            class="modal-inn modal-compra"
            role="dialog"
            aria-modal="true"
            aria-labelledby="np-titulo"
          >
            <div class="modal-head">
              <h5 id="np-titulo">
                <mat-icon>add_shopping_cart</mat-icon> Novo pedido de compra
              </h5>
              <button type="button" class="close" (click)="novo.set(false)" aria-label="Fechar">
                &times;
              </button>
            </div>

            <form class="modal-body np-body" [formGroup]="pedForm" (ngSubmit)="criarPedido()">
              @if (abrindoNovo()) {
                <div class="aviso">
                  <mat-icon>hourglass_top</mat-icon>
                  <span>Carregando fornecedores e catálogo de insumos…</span>
                </div>
              }

              <!-- Bloco 1: Fornecedor + Entrega/Financeiro -->
              <div class="np-sec">
                <div class="np-sec-head">
                  <span class="np-step">1</span>
                  <div>
                    <strong>Fornecedor e condições</strong>
                    <small>Escolha o fornecedor homologado ou cadastre um novo rapidamente.</small>
                  </div>
                  <button
                    type="button"
                    class="btn-link"
                    (click)="criandoFornRapido.set(!criandoFornRapido())"
                  >
                    <mat-icon>{{ criandoFornRapido() ? 'expand_less' : 'add' }}</mat-icon>
                    {{ criandoFornRapido() ? 'Fechar cadastro rápido' : 'Novo fornecedor rápido' }}
                  </button>
                </div>

                @if (criandoFornRapido()) {
                  <div class="quick-forn">
                    <input
                      class="inp"
                      placeholder="Nome do fornecedor *"
                      [value]="rapidoNome()"
                      (input)="rapidoNome.set(inp($event))"
                      aria-label="Nome do novo fornecedor"
                    />
                    <input
                      class="inp"
                      placeholder="CNPJ (opcional)"
                      [value]="rapidoCnpj()"
                      (input)="rapidoCnpj.set(inp($event))"
                      aria-label="CNPJ do novo fornecedor"
                    />
                    <input
                      class="inp"
                      type="number"
                      min="0"
                      placeholder="Prazo (dias)"
                      [value]="rapidoLead()"
                      (input)="rapidoLead.set(num($event))"
                      aria-label="Lead time em dias"
                    />
                    <button
                      type="button"
                      class="btn-dark"
                      [disabled]="!rapidoNome().trim() || salvandoForn()"
                      (click)="criarFornecedorRapido()"
                    >
                      <mat-icon>check</mat-icon> Salvar e selecionar
                    </button>
                  </div>
                }

                <div class="np-grid">
                  <label class="fld">
                    <span class="lbl">Fornecedor *</span>
                    <select
                      class="inp"
                      formControlName="idfornecedor"
                      (change)="sincronizarFornecedor()"
                      aria-label="Fornecedor"
                    >
                      <option [ngValue]="null" disabled>Selecione um fornecedor ativo…</option>
                      @for (f of fornecedoresAtivos(); track f.id) {
                        <option [ngValue]="f.id">
                          {{ f.nome }}{{ f.cnpj ? ' · ' + f.cnpj : '' }} (prazo {{ f.lead_time_dias }}d)
                        </option>
                      }
                    </select>
                    @if (fornecedorSelecionado(); as fs) {
                      <small class="hint ok-hint">
                        <mat-icon class="mini">event_available</mat-icon>
                        Entrega prevista: <b>{{ dataPrevistaEstimada(fs.lead_time_dias) }}</b>
                        ({{ fs.lead_time_dias }} {{ fs.lead_time_dias === 1 ? 'dia corrido' : 'dias corridos' }})
                      </small>
                    } @else if (!abrindoNovo() && !fornecedoresAtivos().length) {
                      <small class="hint warn-hint">
                        Nenhum fornecedor ativo. Clique em "Novo fornecedor rápido" acima.
                      </small>
                    }
                  </label>

                  <div class="fld">
                    <span class="lbl">Integração financeira</span>
                    <label class="chk-box">
                      <input
                        type="checkbox"
                        formControlName="gerar_pagamento"
                        (change)="geraPag.set(chk($event))"
                      />
                      <div>
                        <strong>Gerar conta a pagar automaticamente</strong>
                        <small>Lança a despesa no Financeiro vinculada a este pedido</small>
                      </div>
                    </label>
                    @if (geraPag()) {
                      <label class="fld mt-6">
                        <span class="lbl">Vencimento da fatura (opcional)</span>
                        <app-date formControlName="vencimento" rotulo="Vencimento da conta a pagar" />
                        <small class="hint">Se deixar em branco, usa a data prevista de entrega.</small>
                      </label>
                    }
                  </div>
                </div>
              </div>

              <!-- Bloco 2: Itens do Pedido -->
              <div class="np-sec">
                <div class="np-sec-head">
                  <span class="np-step">2</span>
                  <div>
                    <strong>Itens do pedido</strong>
                    <small>Selecione os produtos do estoque, quantidades e custo unitário negociado.</small>
                  </div>
                  <button type="button" class="btn-out btn-sm" (click)="adicionarLinha()">
                    <mat-icon>add</mat-icon> Adicionar linha
                  </button>
                </div>

                <div class="np-itens-tbl">
                  <div class="np-head">
                    <span>Item de estoque *</span>
                    <span>Qtd *</span>
                    <span>Custo unit. (R$)</span>
                    <span class="ta">Subtotal</span>
                    <span></span>
                  </div>

                  @for (ln of linhas(); track ln.uid; let idx = $index) {
                    <div class="np-linha">
                      <div class="np-item-col">
                        <select
                          class="inp"
                          [value]="ln.iditem ?? ''"
                          (change)="selecionarItemLinha(ln.uid, $event)"
                          [attr.aria-label]="'Item da linha ' + (idx + 1)"
                        >
                          <option value="" disabled>Selecione o produto ou insumo…</option>
                          @for (it of itens(); track it.id) {
                            <option [value]="it.id">
                              {{ it.nome }} ({{ it.unidade }}) — saldo: {{ it.quantidade }}
                            </option>
                          }
                        </select>
                        @if (itemPorId(ln.iditem); as itSel) {
                          <small class="item-meta">
                            Estoque atual: <b>{{ itSel.quantidade }} {{ itSel.unidade }}</b>
                            · Mínimo: {{ itSel.estoque_minimo }} {{ itSel.unidade }}
                            @if (itSel.quantidade <= itSel.estoque_minimo) {
                              <span class="low-tag">Abaixo do mínimo</span>
                            }
                          </small>
                        }
                      </div>

                      <input
                        class="inp"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Qtd"
                        [value]="ln.quantidade"
                        (input)="atualizarQtdLinha(ln.uid, $event)"
                        aria-label="Quantidade"
                      />

                      <input
                        class="inp"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        [value]="ln.valor_unit ?? ''"
                        (input)="atualizarValorLinha(ln.uid, $event)"
                        aria-label="Custo unitário"
                      />

                      <div class="np-sub ta">
                        @if (ln.valor_unit !== null && ln.quantidade > 0) {
                          <strong>R$ {{ moeda(ln.quantidade * ln.valor_unit) }}</strong>
                        } @else {
                          <span class="mut-inline">—</span>
                        }
                      </div>

                      <button
                        type="button"
                        class="ic ic-del"
                        (click)="removerLinha(ln.uid)"
                        aria-label="Remover item"
                        [disabled]="linhas().length === 1"
                        title="Remover linha"
                      >
                        <mat-icon>delete_outline</mat-icon>
                      </button>
                    </div>
                  }
                </div>
              </div>

              <!-- Bloco 3: Observações e Resumo -->
              <div class="np-rod-grid">
                <label class="fld">
                  <span class="lbl">Observações / Condições comerciais</span>
                  <input
                    class="inp"
                    formControlName="observacao"
                    placeholder="Ex.: Entrega pela manhã, boleto 28 dias, NF enviada por e-mail…"
                  />
                </label>

                <div class="resumo-box">
                  <div class="resumo-ln">
                    <span>Itens válidos</span>
                    <b>{{ itensValidosCount() }} {{ itensValidosCount() === 1 ? 'item' : 'itens' }}</b>
                  </div>
                  <div class="resumo-ln resumo-tot">
                    <span>Total estimado</span>
                    <strong>R$ {{ moeda(totalPrevisto()) }}</strong>
                  </div>
                </div>
              </div>

              <div class="np-acoes">
                <button type="button" class="btn-out" (click)="novo.set(false)">Cancelar</button>
                <button
                  type="submit"
                  class="btn-dark"
                  [disabled]="!podeCriar() || criando() || abrindoNovo()"
                >
                  <mat-icon>check_circle</mat-icon>
                  {{ criando() ? 'Registrando pedido…' : 'Confirmar pedido de compra' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ============ MODAL: DETALHE E RECEBIMENTO DO PEDIDO ============ -->
      @if (detalhe(); as p) {
        <div class="overlay" (click.self)="fechar()">
          <div
            class="modal-inn modal-compra"
            role="dialog"
            aria-modal="true"
            [attr.aria-labelledby]="'det-tit-' + p.id"
          >
            <div class="modal-head">
              <h5 [id]="'det-tit-' + p.id">
                <mat-icon>receipt_long</mat-icon>
                Pedido Nº {{ p.id }}
                <span [class]="'st st_' + p.status">
                  <mat-icon>{{ statusIcon(p.status) }}</mat-icon> {{ rotulo(p.status) }}
                </span>
                @if (p.origem === 'maria') {
                  <span class="maria">Maria</span>
                }
              </h5>
              <button type="button" class="close" (click)="fechar()" aria-label="Fechar">
                &times;
              </button>
            </div>

            <div class="modal-body np-body">
              <!-- Cards de Metadados -->
              <div class="det-meta-grid">
                <div class="det-box">
                  <span class="det-lbl">Fornecedor</span>
                  <strong>{{ p.fornecedor }}</strong>
                  <small>{{ p.fornecedor_cnpj || 'CNPJ não informado' }}</small>
                </div>
                <div class="det-box">
                  <span class="det-lbl">Emissão &amp; Previsão</span>
                  <strong>{{ p.criado_em | date: 'dd/MM/yyyy HH:mm' }}</strong>
                  <small>
                    Previsão: {{ p.data_prevista ? (p.data_prevista | date: 'dd/MM/yyyy') : '—' }}
                    @if (p.criado_por) {
                      · por {{ p.criado_por }}
                    }
                  </small>
                </div>
                <div class="det-box">
                  <span class="det-lbl">Progresso de entrega</span>
                  <strong>{{ p.recebido_itens }} / {{ p.total_itens }} itens concluídos</strong>
                  <div class="prog-bar mt-6">
                    <div
                      class="prog-fill"
                      [class.prog-ok]="p.status === 'recebido'"
                      [class.prog-parc]="p.status === 'parcial'"
                      [style.width.%]="pctPedido(p)"
                    ></div>
                  </div>
                </div>
                <div class="det-box">
                  <span class="det-lbl">Financeiro</span>
                  <strong>
                    {{ pos(p.valor_total) ? 'R$ ' + moeda(p.valor_total) : 'Sem valor' }}
                  </strong>
                  <small>
                    @if (p.idlancamento) {
                      Conta a pagar Nº {{ p.idlancamento }} gerada
                    } @else {
                      Sem lançamento financeiro
                    }
                  </small>
                </div>
              </div>

              @if (p.observacao) {
                <div class="obs-banner">
                  <mat-icon>notes</mat-icon>
                  <span><b>Observação:</b> {{ p.observacao }}</span>
                </div>
              }

              <!-- Tabela de Itens do Pedido -->
              <div class="tbl-wrap det-tbl-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>Produto / Insumo</th>
                      <th>Pedido</th>
                      <th>Já recebido</th>
                      <th>Pendente</th>
                      <th>Custo un.</th>
                      <th class="ta">Subtotal</th>
                      @if (recebendo()) {
                        <th class="ta">Dar entrada agora</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (i of detalheItens(); track i.id) {
                      <tr>
                        <td>
                          <strong>{{ i.item }}</strong>
                          <small class="un-badge">{{ i.unidade }}</small>
                        </td>
                        <td>{{ i.quantidade }} {{ i.unidade }}</td>
                        <td>{{ i.quantidade_recebida }} {{ i.unidade }}</td>
                        <td [class.ok]="pendente(i) === 0" [class.pend-num]="pendente(i) > 0">
                          {{ pendente(i) }} {{ i.unidade }}
                        </td>
                        <td>{{ pos(i.valor_unit) ? 'R$ ' + moeda(i.valor_unit) : '—' }}</td>
                        <td class="ta">
                          @if (pos(i.valor_unit)) {
                            <strong>R$ {{ moeda(i.quantidade * numVal(i.valor_unit)) }}</strong>
                          } @else {
                            —
                          }
                        </td>
                        @if (recebendo()) {
                          <td class="ta">
                            @if (pendente(i) > 0) {
                              <input
                                class="rq"
                                type="number"
                                min="0"
                                [max]="pendente(i)"
                                [value]="recebMap()[i.iditem] ?? pendente(i)"
                                (input)="setReceb(i.iditem, pendente(i), $event)"
                                [attr.aria-label]="'Quantidade recebida de ' + i.item"
                              />
                            } @else {
                              <span class="st st_recebido">Concluído</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              @if (recebendo()) {
                <div class="rec-panel">
                  <div class="rec-panel-head">
                    <div>
                      <strong>Conferência de entrada no estoque</strong>
                      <small>Informe as quantidades que chegaram fisicamente. O saldo do estoque será somado na hora.</small>
                    </div>
                    <button type="button" class="btn-out btn-sm" (click)="receberTudo()">
                      <mat-icon>done_all</mat-icon> Preencher tudo pendente
                    </button>
                  </div>
                  <div class="rec-bar">
                    <input
                      #obsRec
                      class="inp rec-obs"
                      placeholder="Nota fiscal, lote ou observação da entrega (opcional)…"
                      aria-label="Observação do recebimento"
                    />
                    <button type="button" class="btn-out" (click)="recebendo.set(false)">
                      Voltar
                    </button>
                    <button
                      type="button"
                      class="btn-dark"
                      [disabled]="totalReceb() === 0 || salvandoReceb()"
                      (click)="confirmarRecebimento(p, obsRec.value)"
                    >
                      <mat-icon>inventory</mat-icon>
                      {{ salvandoReceb() ? 'Dando entrada…' : 'Confirmar entrada (' + totalReceb() + ' un.)' }}
                    </button>
                  </div>
                </div>
              }

              @if (!recebendo()) {
                <div class="det-acoes">
                  @if (p.status === 'pendente' || p.status === 'parcial') {
                    <button type="button" class="btn-dan" (click)="cancelar(p)">
                      <mat-icon>cancel</mat-icon> Cancelar pedido
                    </button>
                    <div class="det-acoes-dir">
                      <button
                        type="button"
                        class="btn-out"
                        [disabled]="salvandoReceb()"
                        (click)="receberTotalDireto(p)"
                      >
                        <mat-icon>done_all</mat-icon> Receber tudo de uma vez
                      </button>
                      <button type="button" class="btn-dark" (click)="iniciarRecebimento()">
                        <mat-icon>inventory_2</mat-icon> Conferir / Receber parcial
                      </button>
                    </div>
                  } @else {
                    <span class="mut">Este pedido já foi finalizado ({{ rotulo(p.status).toLowerCase() }}).</span>
                    <button type="button" class="btn-out" (click)="fechar()">Fechar</button>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .page { padding: 20px 24px 32px; display: flex; flex-direction: column; gap: 18px; }

    /* Cabeçalho */
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
    h1 { font-family: var(--font-body); font-size: 23px; font-weight: 700; color: #20242c; margin: 0; line-height: 1.1; }
    .sub { color: #55606d; margin: 4px 0 0; font-size: 13.5px; }
    .cab-acoes { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

    /* Botões */
    .btn-dark, .btn-out, .btn-dan { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 10px 18px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
      transition: all .15s ease; white-space: nowrap; }
    .btn-sm { padding: 7px 13px; font-size: 12.5px; border-radius: 9px; }
    .w-full { width: 100%; }
    .btn-dark { background: #20242c; border: 1px solid #20242c; color: #fff; }
    .btn-dark:hover:not(:disabled) { background: #2457a7; border-color: #2457a7; }
    .btn-out { background: #fff; border: 1px solid #dde2e8; color: #20242c; }
    .btn-out:hover:not(:disabled), .btn-out.on { border-color: #2457a7; color: #2457a7; background: #f5f7fa; }
    .btn-dan { background: #fff; border: 1px solid #dc3545; color: #dc3545; }
    .btn-dan:hover:not(:disabled) { background: #fbebec; }
    .btn-dark:disabled, .btn-out:disabled, .btn-dan:disabled { opacity: .48; cursor: not-allowed; }
    .btn-link { border: 0; background: none; color: #2457a7; font: inherit; font-size: 13px; font-weight: 600;
      cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 6px; }
    .btn-link:hover { background: #f0f2f5; color: #20242c; }
    .pill-cnt { background: #f0f2f5; color: #20242c; font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }

    /* KPIs */
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .kpi-card { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid #e9ecf0;
      border-radius: 14px; padding: 14px 16px; text-align: left; font: inherit; cursor: pointer; transition: all .15s ease; }
    .kpi-card:hover { border-color: #3d6db5; transform: translateY(-1px); }
    .kpi-card.ativo { border-color: #20242c; box-shadow: 0 0 0 1px #20242c; background: #f8f9fb; }
    .kpi-ic { width: 42px; height: 42px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; }
    .kpi-pend { background: #e8eef8; color: #20242c; }
    .kpi-parc { background: #f7ead2; color: #b45309; }
    .kpi-rec { background: #d1fae5; color: #0f5624; }
    .kpi-forn { background: #f0f2f5; color: #2457a7; }
    .kpi-txt { display: flex; flex-direction: column; gap: 2px; }
    .kpi-val { font-size: 20px; font-weight: 800; color: #20242c; line-height: 1.1; }
    .kpi-val small { font-size: 13px; font-weight: 600; color: #66707e; margin-left: 2px; }
    .kpi-lbl { font-size: 12.5px; color: #55606d; font-weight: 500; }

    /* Seção & Card */
    .sec { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .sec h2 { font-family: var(--font-body); font-size: 19px; font-weight: 700; color: #20242c; margin: 0; }
    .sec-cnt { color: #55606d; font-size: 13px; font-weight: 600; }
    .card { background: #fff; border: 1px solid #e9ecf0; border-radius: 16px; overflow: hidden; }
    .card-pad { padding: 18px 20px; }

    /* Filtros e Busca */
    .filtros { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; flex-wrap: wrap; padding: 16px 20px; }
    .busca { display: flex; flex-direction: column; gap: 6px; min-width: 290px; flex: 1; max-width: 380px; }
    .busca-wrap { position: relative; display: flex; align-items: center; }
    .busca-ic { position: absolute; left: 12px; color: #66707e; font-size: 18px; width: 18px; height: 18px; pointer-events: none; }
    .inp-busca { width: 100%; padding-left: 38px !important; padding-right: 34px !important; }
    .busca-limpar { position: absolute; right: 8px; border: 0; background: none; color: #66707e; cursor: pointer; display: grid; place-items: center; padding: 4px; }
    .lbl { font-size: 12.5px; font-weight: 600; color: #20242c; }
    .inp { padding: 10px 13px; border: 1px solid #dde2e8; border-radius: 10px; font: inherit; font-size: 13.5px; background: #fff; color: #3d4552; }
    .inp:focus { outline: 2px solid #2457a7; outline-offset: -1px; border-color: #2457a7; }
    .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
    .tab { border: 0; background: transparent; padding: 9px 15px; border-radius: 999px; font: inherit;
      font-size: 13px; font-weight: 600; color: #20242c; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .tab:hover { background: #f5f7fa; }
    .tab.on { background: #20242c; color: #fff; }
    .tab-cnt { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(61, 69, 82, 0.09); }
    .tab.on .tab-cnt { background: rgba(255, 255, 255, 0.22); color: #fff; }

    /* Tabela */
    .tbl-wrap { overflow-x: auto; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .tbl thead { background: #20242c; }
    .tbl th { text-align: left; padding: 12px 18px; color: #fff; font-size: 11px; font-weight: 700;
      letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; }
    .tbl td { padding: 14px 18px; border-bottom: 1px solid #e9ecf0; vertical-align: middle; }
    .tbl tbody tr:last-child td { border-bottom: 0; }
    .row-click { cursor: pointer; transition: background .12s; }
    .row-click:hover td { background: #f8f9fb; }
    .tbl td.ok { color: #198754; font-weight: 700; }
    .tbl td.pend-num { color: #b45309; font-weight: 700; }
    .ta { text-align: right; }

    .ped { display: flex; align-items: center; gap: 13px; }
    .ped-ic { width: 38px; height: 38px; border-radius: 10px; background: #f5f7fa; color: #2457a7;
      display: grid; place-items: center; flex-shrink: 0; }
    .ped-txt strong { color: #20242c; font-size: 14.5px; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ped-txt small { display: block; color: #55606d; margin-top: 2px; font-size: 12px; }
    .maria { font-size: 10px; font-weight: 700; background: #e8eef8; color: #2457a7; padding: 2px 7px;
      border-radius: 999px; text-transform: uppercase; }
    .fin-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600;
      background: #f0f2f5; color: #2457a7; padding: 1px 7px; border-radius: 999px; }
    .fin-tag mat-icon { font-size: 13px; width: 13px; height: 13px; }

    /* Barra de Progresso */
    .prog-cell { min-width: 170px; max-width: 240px; }
    .prog-top { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: #3d4552; margin-bottom: 5px; gap: 8px; }
    .prev-dt { color: #66707e; font-weight: 500; }
    .prog-bar { height: 6px; background: #f0f2f5; border-radius: 999px; overflow: hidden; }
    .prog-fill { height: 100%; background: #2457a7; border-radius: 999px; transition: width .25s ease; }
    .prog-fill.prog-parc { background: #b45309; }
    .prog-fill.prog-ok { background: #198754; }
    .val-str { color: #20242c; font-size: 14px; }
    .mut-inline { color: #66707e; font-size: 12.5px; }

    /* Status chips */
    .st { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; white-space: nowrap; }
    .st mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .st_pendente { background: #20242c; color: #fff; }
    .st_parcial { background: #f7ead2; color: #b45309; }
    .st_recebido { background: #d1fae5; color: #0f5624; }
    .st_cancelado { background: #f0f2f5; color: #55606d; }

    .btn-ver { display: inline-flex; align-items: center; gap: 7px; padding: 8px 15px; border-radius: 10px;
      border: 1px solid #dde2e8; background: #fff; color: #20242c; font: inherit; font-weight: 600;
      font-size: 13px; cursor: pointer; }
    .btn-ver:hover { border-color: #2457a7; color: #2457a7; background: #f5f7fa; }
    .btn-ver mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .vazio { padding: 40px 20px; text-align: center; color: #55606d; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .vazio mat-icon { font-size: 42px; width: 42px; height: 42px; color: #66707e; }
    .vazio strong { color: #20242c; font-size: 15px; }
    .vazio p { margin: 0 0 6px; font-size: 13px; }

    .card-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 13px 20px; border-top: 1px solid #f0f2f5; background: #f8f9fb; }
    .mut { color: #55606d; font-size: 12.5px; }
    .pager { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #55606d; }
    .btn-pg { padding: 7px 14px; border-radius: 9px; border: 1px solid #e9ecf0; background: #fff; color: #20242c;
      font: inherit; font-weight: 600; cursor: pointer; }
    .btn-pg:not(:disabled):hover { border-color: #2457a7; color: #2457a7; }
    .btn-pg:disabled { opacity: .45; cursor: default; }

    /* Aba Fornecedores */
    .forn-layout { display: grid; grid-template-columns: 360px 1fr; gap: 16px; align-items: start; }
    @media (max-width: 960px) { .forn-layout { grid-template-columns: 1fr; } }
    .forn-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .forn-card-head h3 { margin: 0; font-size: 16px; color: #20242c; display: flex; align-items: center; gap: 7px; }
    .forn-form { display: flex; flex-direction: column; gap: 12px; }
    .fld-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .forn-form-foot { margin-top: 4px; }
    .lead-pill { display: inline-flex; align-items: center; gap: 5px; background: #f5f7fa; color: #20242c;
      padding: 4px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
    .lead-pill mat-icon { font-size: 15px; width: 15px; height: 15px; color: #2457a7; }
    tr.inativo td { opacity: .48; }
    .ac { display: flex; gap: 4px; justify-content: flex-end; }
    .ic { border: 0; background: transparent; cursor: pointer; color: #55606d; padding: 6px; border-radius: 8px;
      display: inline-grid; place-items: center; }
    .ic:hover:not(:disabled) { color: #2457a7; background: #f0f2f5; }
    .ic-del:hover:not(:disabled) { color: #dc3545; background: #fbebec; }
    .ic:disabled { opacity: .35; cursor: default; }

    /* Modais (.overlay e .modal-inn vêm do styles.css global) */
    .modal-compra { max-width: 820px !important; width: 100%; border-radius: 16px !important; overflow: hidden; }
    .np-body { gap: 16px !important; max-height: calc(90vh - 64px); overflow-y: auto; padding: 18px 20px !important; }
    .np-sec { background: #f8f9fb; border: 1px solid #e9ecf0; border-radius: 12px; padding: 14px 16px;
      display: flex; flex-direction: column; gap: 12px; }
    .np-sec-head { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
    .np-sec-head > div { flex: 1; min-width: 180px; }
    .np-sec-head strong { display: block; color: #20242c; font-size: 14px; }
    .np-sec-head small { color: #55606d; font-size: 12px; }
    .np-step { width: 26px; height: 26px; border-radius: 50%; background: #20242c; color: #fff;
      font-size: 12px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }

    .quick-forn { display: grid; grid-template-columns: 1.4fr 1fr 110px auto; gap: 8px; background: #f0f2f5;
      padding: 10px; border-radius: 10px; align-items: center; }
    @media (max-width: 720px) { .quick-forn { grid-template-columns: 1fr; } }

    .np-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 14px; align-items: start; }
    @media (max-width: 680px) { .np-grid { grid-template-columns: 1fr; } }
    .fld { display: flex; flex-direction: column; gap: 5px; }
    .mt-6 { margin-top: 6px; }
    .hint { color: #55606d; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
    .ok-hint { color: #0f5624; }
    .warn-hint { color: #b45309; }
    .mini { font-size: 15px; width: 15px; height: 15px; }

    .chk-box { display: flex; align-items: flex-start; gap: 10px; background: #fff; border: 1px solid #dde2e8;
      border-radius: 10px; padding: 10px 12px; cursor: pointer; }
    .chk-box input { margin-top: 3px; }
    .chk-box strong { display: block; font-size: 13px; color: #20242c; }
    .chk-box small { color: #55606d; font-size: 11.5px; }

    .np-itens-tbl { display: flex; flex-direction: column; gap: 8px; }
    .np-head { display: grid; grid-template-columns: 1fr 90px 125px 110px 36px; gap: 8px; padding: 0 4px 4px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #55606d; }
    .np-linha { display: grid; grid-template-columns: 1fr 90px 125px 110px 36px; gap: 8px; align-items: start;
      background: #fff; border: 1px solid #e9ecf0; border-radius: 10px; padding: 8px; }
    @media (max-width: 680px) {
      .np-head { display: none; }
      .np-linha { grid-template-columns: 1fr 1fr; }
    }
    .np-item-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .np-linha .inp { width: 100%; padding: 8px 10px; }
    .item-meta { font-size: 11.5px; color: #55606d; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .low-tag { background: #fbebec; color: #dc3545; font-weight: 700; padding: 1px 6px; border-radius: 999px; font-size: 10.5px; }
    .np-sub { padding-top: 9px; font-size: 13px; color: #20242c; }

    .np-rod-grid { display: grid; grid-template-columns: 1fr 250px; gap: 14px; align-items: end; }
    @media (max-width: 680px) { .np-rod-grid { grid-template-columns: 1fr; } }
    .resumo-box { background: #f0f2f5; border: 1px solid #dde2e8; border-radius: 11px; padding: 11px 14px;
      display: flex; flex-direction: column; gap: 5px; }
    .resumo-ln { display: flex; justify-content: space-between; font-size: 12.5px; color: #55606d; }
    .resumo-tot { border-top: 1px solid #dde2e8; padding-top: 6px; font-size: 14px; color: #20242c; }
    .resumo-tot strong { font-size: 16px; color: #20242c; }
    .np-acoes { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #e9ecf0; padding-top: 12px; }

    /* Modal Detalhe */
    .det-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
    .det-box { background: #f5f7fa; border: 1px solid #e9ecf0; border-radius: 11px; padding: 11px 13px;
      display: flex; flex-direction: column; gap: 3px; }
    .det-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #66707e; }
    .det-box strong { color: #20242c; font-size: 13.5px; }
    .det-box small { color: #55606d; font-size: 11.5px; }
    .obs-banner { display: flex; align-items: center; gap: 8px; background: #f7ead2; color: #8a6116;
      padding: 9px 13px; border-radius: 10px; font-size: 13px; }
    .obs-banner mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .det-tbl-wrap { border: 1px solid #e9ecf0; border-radius: 12px; overflow: hidden; }
    .un-badge { margin-left: 6px; background: #f0f2f5; color: #55606d; padding: 1px 6px; border-radius: 6px; font-size: 11px; }
    .rq { width: 88px; padding: 7px 9px; border: 1px solid #2457a7; border-radius: 8px; font: inherit; text-align: center; background: #fff; color: #20242c; font-weight: 700; }

    .rec-panel { background: #eef3fb; border: 1px solid #dde2e8; border-radius: 12px; padding: 14px;
      display: flex; flex-direction: column; gap: 12px; }
    .rec-panel-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rec-panel-head strong { display: block; color: #20242c; font-size: 14px; }
    .rec-panel-head small { color: #55606d; font-size: 12px; }
    .rec-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .rec-obs { flex: 1; min-width: 200px; }

    .det-acoes { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
      border-top: 1px solid #e9ecf0; padding-top: 12px; }
    .det-acoes-dir { display: flex; gap: 8px; flex-wrap: wrap; }

    .aviso { display: flex; gap: 10px; align-items: center; background: #f7ead2; color: #b45309;
      border-radius: 10px; padding: 10px 13px; font-size: 13px; }
    .aviso-sm { margin-bottom: 10px; font-size: 12px; }
  `,
})
export class ComprasComponent {
  private readonly comprasApi = inject(ComprasApi);
  private readonly estoqueApi = inject(EstoqueApi);
  private readonly nt = inject(Notify);
  private readonly rt = inject(Realtime);
  private readonly confirm = inject(Confirm);

  private uidSeq = 0;

  readonly aba = signal<'pedidos' | 'fornecedores'>('pedidos');
  readonly pedidos = signal<PedidoCompraView[]>([]);
  readonly fornecedores = signal<Fornecedor[]>([]);
  readonly itens = signal<ItemEstoque[]>([]);
  readonly detalhe = signal<PedidoCompraView | null>(null);
  readonly detalheItens = signal<PedidoItemView[]>([]);
  readonly novo = signal(false);
  readonly abrindoNovo = signal(false);
  readonly criando = signal(false);
  readonly salvandoForn = signal(false);
  readonly salvandoReceb = signal(false);
  readonly recebendo = signal(false);
  readonly fornSel = signal<number | null>(null);
  readonly geraPag = signal(true);
  readonly recebMap = signal<Record<number, number>>({});
  readonly filtro = signal('');
  readonly pagina = signal(1);
  readonly total = signal(0);
  readonly carregando = signal(false);
  readonly busca = signal('');
  readonly buscaForn = signal('');
  readonly contagens = signal<Record<string, number>>({});

  readonly criandoFornRapido = signal(false);
  readonly rapidoNome = signal('');
  readonly rapidoCnpj = signal('');
  readonly rapidoLead = signal(3);

  readonly TABS = [
    { v: '', rotulo: 'Todos' },
    { v: 'pendente', rotulo: 'Pendente' },
    { v: 'parcial', rotulo: 'Parcial' },
    { v: 'recebido', rotulo: 'Recebido' },
    { v: 'cancelado', rotulo: 'Cancelado' },
  ];

  readonly linhas = signal<LinhaPedido[]>([]);

  readonly fornForm = new FormGroup({
    id: new FormControl<number | null>(null),
    nome: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    cnpj: new FormControl('', { nonNullable: true }),
    contato: new FormControl('', { nonNullable: true }),
    telefone: new FormControl('', { nonNullable: true }),
    lead_time_dias: new FormControl(0, { nonNullable: true }),
  });

  readonly pedForm = new FormGroup({
    idfornecedor: new FormControl<number | null>(null, { validators: [Validators.required] }),
    gerar_pagamento: new FormControl(true, { nonNullable: true }),
    vencimento: new FormControl('', { nonNullable: true }),
    observacao: new FormControl('', { nonNullable: true }),
  });

  readonly fornecedoresAtivos = computed(() => this.fornecedores().filter((f) => f.ativo));
  readonly fornecedorSelecionado = computed(() => {
    const id = this.fornSel();
    return id ? (this.fornecedores().find((f) => f.id === id) ?? null) : null;
  });
  readonly fornecedoresFiltrados = computed(() => {
    const b = this.buscaForn().trim().toLowerCase();
    if (!b) return this.fornecedores();
    return this.fornecedores().filter(
      (f) =>
        f.nome.toLowerCase().includes(b) ||
        (f.cnpj ?? '').toLowerCase().includes(b) ||
        (f.contato ?? '').toLowerCase().includes(b)
    );
  });
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 15)));
  readonly totalReceb = computed(() =>
    Object.values(this.recebMap()).reduce((s, v) => s + v, 0)
  );
  readonly pedidosFiltrados = computed(() => {
    const b = this.busca().trim().toLowerCase();
    if (!b) return this.pedidos();
    return this.pedidos().filter(
      (p) => String(p.id).includes(b) || p.fornecedor.toLowerCase().includes(b)
    );
  });
  readonly itensValidosCount = computed(
    () => this.linhas().filter((l) => l.iditem !== null && l.quantidade > 0).length
  );
  readonly totalPrevisto = computed(() =>
    this.linhas().reduce((s, l) => s + l.quantidade * (l.valor_unit ?? 0), 0)
  );
  readonly podeCriar = computed(
    () => this.fornSel() !== null && this.itensValidosCount() > 0
  );
  readonly totalGeral = computed(() => this.contagens()[''] ?? this.total());
  readonly legendaPedidos = computed(() => {
    const n = this.totalGeral();
    return `${n} pedido${n === 1 ? '' : 's'} cadastrado${n === 1 ? '' : 's'}`;
  });

  constructor() {
    effect(() => {
      this.rt.delta('compra_pedido');
      this.rt.delta('fornecedor');
      void this.carregar();
      void this.carregarFornecedores();
    });
  }

  protected fecharModais(): void {
    if (this.novo()) this.novo.set(false);
    else if (this.detalhe()) this.fechar();
  }

  alternarAba(): void {
    this.aba.set(this.aba() === 'fornecedores' ? 'pedidos' : 'fornecedores');
  }

  irParaStatus(st: string): void {
    this.aba.set('pedidos');
    this.setFiltro(this.filtro() === st ? '' : st);
  }

  rotulo(s: string): string {
    return STATUS_LABEL[s] ?? s;
  }

  statusIcon(s: string): string {
    return STATUS_ICON[s] ?? 'help';
  }

  inp(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  pos(v: string | number | null | undefined): boolean {
    return Number(v) > 0;
  }

  numVal(v: string | number | null | undefined): number {
    return Number(v) || 0;
  }

  pendente(i: PedidoItemView): number {
    return Math.max(0, i.quantidade - i.quantidade_recebida);
  }

  pctPedido(p: PedidoCompraView): number {
    if (p.status === 'recebido') return 100;
    if (!p.total_itens) return 0;
    return Math.min(100, Math.round((p.recebido_itens / p.total_itens) * 100));
  }

  itemPorId(id: number | null): ItemEstoque | undefined {
    return id ? this.itens().find((x) => x.id === id) : undefined;
  }

  dataPrevistaEstimada(leadDias: number): string {
    const ms = Date.now() + Math.max(0, leadDias) * 86_400_000;
    return new Intl.DateTimeFormat('pt-BR').format(ms);
  }

  moeda(v: number | string | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value) || 0;
  }

  sincronizarFornecedor(): void {
    const val = this.pedForm.controls.idfornecedor.value;
    this.fornSel.set(typeof val === 'number' ? val : null);
  }

  adicionarLinha(): void {
    this.linhas.update((v) => [
      ...v,
      { uid: ++this.uidSeq, iditem: null, quantidade: 1, valor_unit: null },
    ]);
  }

  removerLinha(uid: number): void {
    this.linhas.update((v) => (v.length > 1 ? v.filter((x) => x.uid !== uid) : v));
  }

  selecionarItemLinha(uid: number, e: Event): void {
    const raw = (e.target as HTMLSelectElement).value;
    const iditem = raw === '' ? null : Number(raw);
    const est = this.itemPorId(iditem);
    const custoPadrao = est && Number(est.valor_unitario) > 0 ? Number(est.valor_unitario) : null;
    this.linhas.update((lista) =>
      lista.map((ln) =>
        ln.uid === uid
          ? { ...ln, iditem, valor_unit: ln.valor_unit ?? custoPadrao }
          : ln
      )
    );
  }

  atualizarQtdLinha(uid: number, e: Event): void {
    const quantidade = Math.max(1, this.num(e));
    this.linhas.update((lista) =>
      lista.map((ln) => (ln.uid === uid ? { ...ln, quantidade } : ln))
    );
  }

  atualizarValorLinha(uid: number, e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    const valor_unit = raw === '' ? null : Math.max(0, Number(raw));
    this.linhas.update((lista) =>
      lista.map((ln) => (ln.uid === uid ? { ...ln, valor_unit } : ln))
    );
  }

  setFiltro(s: string): void {
    this.filtro.set(s);
    this.pagina.set(1);
    void this.carregar();
  }

  async carregar(): Promise<void> {
    this.carregando.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.listarPedidos({
          status: this.filtro() || undefined,
          pagina: this.pagina(),
        })
      );
      this.pedidos.set(r.items);
      this.total.set(r.total);
      void this.carregarContagens();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.carregando.set(false);
    }
  }

  async carregarContagens(): Promise<void> {
    try {
      const sts = ['pendente', 'parcial', 'recebido', 'cancelado'];
      const rs = await Promise.all(
        sts.map((s) => firstValueFrom(this.comprasApi.listarPedidos({ status: s, pagina: 1 })))
      );
      const m: Record<string, number> = { '': 0 };
      rs.forEach((r, i) => {
        m[sts[i]] = r.total;
        m[''] += r.total;
      });
      this.contagens.set(m);
    } catch {
      /* contagem é auxiliar */
    }
  }

  async carregarFornecedores(): Promise<void> {
    try {
      this.fornecedores.set(await firstValueFrom(this.comprasApi.listarFornecedores(false)));
    } catch (e) {
      this.nt.erro(e);
    }
  }

  async novoPedido(): Promise<void> {
    this.linhas.set([{ uid: ++this.uidSeq, iditem: null, quantidade: 1, valor_unit: null }]);
    this.geraPag.set(true);
    this.criandoFornRapido.set(false);
    const primeiroAtivo = this.fornecedoresAtivos()[0]?.id ?? null;
    this.fornSel.set(primeiroAtivo);
    this.pedForm.reset({
      idfornecedor: primeiroAtivo,
      gerar_pagamento: true,
      vencimento: '',
      observacao: '',
    });
    this.novo.set(true);
    this.abrindoNovo.set(true);
    try {
      const [it] = await Promise.all([
        this.itens().length
          ? Promise.resolve({ items: this.itens(), total: this.itens().length })
          : firstValueFrom(this.estoqueApi.listarItens(1, 500, true)),
        this.fornecedores().length ? Promise.resolve() : this.carregarFornecedores(),
      ]);
      this.itens.set(it.items);
      if (this.fornSel() === null && this.fornecedoresAtivos().length) {
        const id = this.fornecedoresAtivos()[0].id;
        this.fornSel.set(id);
        this.pedForm.controls.idfornecedor.setValue(id);
      }
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.abrindoNovo.set(false);
    }
  }

  async criarFornecedorRapido(): Promise<void> {
    const nome = this.rapidoNome().trim();
    if (!nome) return;
    this.salvandoForn.set(true);
    try {
      const f = await firstValueFrom(
        this.comprasApi.salvarFornecedor({
          nome,
          cnpj: this.rapidoCnpj().trim() || undefined,
          lead_time_dias: Math.max(0, this.rapidoLead()),
        })
      );
      await this.carregarFornecedores();
      this.fornSel.set(f.id);
      this.pedForm.controls.idfornecedor.setValue(f.id);
      this.criandoFornRapido.set(false);
      this.rapidoNome.set('');
      this.rapidoCnpj.set('');
      this.nt.ok(`Fornecedor "${f.nome}" cadastrado e selecionado.`);
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoForn.set(false);
    }
  }

  async salvarFornecedor(): Promise<void> {
    const v = this.fornForm.getRawValue();
    const b: FornecedorInput = {
      nome: v.nome.trim(),
      cnpj: v.cnpj.trim() || undefined,
      contato: v.contato.trim() || undefined,
      telefone: v.telefone.trim() || undefined,
      lead_time_dias: v.lead_time_dias,
    };
    this.salvandoForn.set(true);
    try {
      await firstValueFrom(this.comprasApi.salvarFornecedor(b));
      this.nt.ok(v.id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      this.fornForm.reset({ lead_time_dias: 0 });
      await this.carregarFornecedores();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoForn.set(false);
    }
  }

  editarForn(f: Fornecedor): void {
    this.fornForm.setValue({
      id: f.id,
      nome: f.nome,
      cnpj: f.cnpj ?? '',
      contato: f.contato ?? '',
      telefone: f.telefone ?? '',
      lead_time_dias: f.lead_time_dias,
    });
  }

  async toggleForn(f: Fornecedor): Promise<void> {
    try {
      await firstValueFrom(this.comprasApi.statusFornecedor(f.id, !f.ativo));
      this.nt.ok(f.ativo ? 'Fornecedor desativado.' : 'Fornecedor reativado.');
      await this.carregarFornecedores();
    } catch (e) {
      this.nt.erro(e);
    }
  }

  async criarPedido(): Promise<void> {
    const v = this.pedForm.getRawValue();
    const itens = this.linhas().filter((l) => l.iditem !== null && l.quantidade > 0);
    const idforn = this.fornSel() ?? (typeof v.idfornecedor === 'number' ? v.idfornecedor : null);
    if (!itens.length || !idforn) return;
    this.criando.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.criarPedido({
          idfornecedor: idforn,
          itens: itens.map((l) => ({
            iditem: l.iditem!,
            quantidade: l.quantidade,
            valor_unit: l.valor_unit ?? undefined,
          })),
          gerar_pagamento: v.gerar_pagamento,
          vencimento: v.gerar_pagamento && v.vencimento ? v.vencimento : undefined,
          observacao: v.observacao.trim() || undefined,
          origem: 'manual',
        })
      );
      this.nt.ok(
        `Pedido Nº ${r.pedido.id} criado — total R$ ${this.moeda(r.pedido.valor_total)}.`
      );
      this.novo.set(false);
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.criando.set(false);
    }
  }

  async abrir(p: PedidoCompraView): Promise<void> {
    try {
      const d = await firstValueFrom(this.comprasApi.buscarPedido(p.id));
      this.detalhe.set(d.pedido);
      this.detalheItens.set(d.itens);
      this.recebendo.set(false);
      this.recebMap.set({});
    } catch (e) {
      this.nt.erro(e);
    }
  }

  fechar(): void {
    this.detalhe.set(null);
    this.detalheItens.set([]);
    this.recebendo.set(false);
  }

  iniciarRecebimento(): void {
    this.receberTudo();
    this.recebendo.set(true);
  }

  setReceb(iditem: number, maxPend: number, e: Event): void {
    const v = Math.min(maxPend, Math.max(0, this.num(e)));
    this.recebMap.update((m) => ({ ...m, [iditem]: v }));
  }

  receberTudo(): void {
    const m: Record<number, number> = {};
    for (const i of this.detalheItens()) {
      const pend = this.pendente(i);
      if (pend > 0) m[i.iditem] = pend;
    }
    this.recebMap.set(m);
  }

  async receberTotalDireto(p: PedidoCompraView): Promise<void> {
    this.receberTudo();
    await this.confirmarRecebimento(p, 'Recebimento integral');
  }

  async confirmarRecebimento(p: PedidoCompraView, obs: string): Promise<void> {
    const itens: RecebimentoItem[] = Object.entries(this.recebMap())
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ iditem: Number(id), quantidade: q }));
    if (!itens.length) return;
    this.salvandoReceb.set(true);
    try {
      const r = await firstValueFrom(
        this.comprasApi.receberPedido(p.id, {
          itens,
          observacao: obs.trim() || undefined,
        })
      );
      this.nt.ok(`Entrada registrada no estoque — pedido ${this.rotulo(r.status).toLowerCase()}.`);
      const d = await firstValueFrom(this.comprasApi.buscarPedido(p.id));
      this.detalhe.set(d.pedido);
      this.detalheItens.set(d.itens);
      this.recebendo.set(false);
      this.recebMap.set({});
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    } finally {
      this.salvandoReceb.set(false);
    }
  }

  async cancelar(p: PedidoCompraView): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Deseja cancelar o Pedido Nº ${p.id} de ${p.fornecedor}?`,
      {
        titulo: 'Cancelar pedido de compra',
        confirmar: 'Sim, cancelar pedido',
        cancelar: 'Voltar',
        detalhe: p.idlancamento
          ? `A conta a pagar Nº ${p.idlancamento} vinculada será estornada automaticamente.`
          : 'Esta ação não poderá ser desfeita.',
      }
    );
    if (!ok) return;
    try {
      const r = await firstValueFrom(this.comprasApi.cancelarPedido(p.id));
      this.nt.ok(r.mensagem ?? 'Pedido cancelado.');
      this.fechar();
      await this.carregar();
    } catch (e) {
      this.nt.erro(e);
    }
  }
}
