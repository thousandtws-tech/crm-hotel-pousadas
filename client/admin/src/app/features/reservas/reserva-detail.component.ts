import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EstabelecimentoApi } from '@core/api/estabelecimento.api';
import { FrigobaresApi } from '@core/api/frigobares.api';
import { ImpressorasApi } from '@core/api/impressoras.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { ReservasApi } from '@core/api/reservas.api';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { ItemFila } from '@core/models/comunicacao.models';
import { STATUS_RESERVA } from '@core/models/reservas.models';
import { num } from '@core/utils/num';
import { TIPOS_DOCUMENTO, TipoDocumento } from '@core/models/clientes.models';
import { ItemFrigobarView } from '@core/models/frigobares.models';
import { FormaPagamento } from '@core/models/pagamentos.models';
import { Acompanhante, AdicionalConsumo, Fnrh, ItemConsumido, ReservaDetalhe } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { DateInputComponent } from '@shared/components/date-input.component';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import { switchMap } from 'rxjs';
import { ReservaFiscalComponent } from './reserva-fiscal.component';

type Modal =
  | 'checkin'
  | 'checkout'
  | 'dados-checkin'
  | 'dados-checkout'
  | 'cancelar'
  | 'fnrh'
  | null;

/** Motivos de viagem do modelo oficial da FNRH. */
const MOTIVOS_VIAGEM = [
  'Turismo/lazer',
  'Negócios/trabalho',
  'Congresso/evento',
  'Visita a parentes',
  'Saúde/tratamento',
  'Trânsito/conexão',
  'Outro',
] as const;

const PARENTESCOS = [
  'Cônjuge/companheiro(a)',
  'Filho(a)',
  'Pai/mãe',
  'Irmão(ã)',
  'Neto(a)',
  'Amigo(a)',
  'Outro',
] as const;

const TIPOS_DOC = Object.entries(TIPOS_DOCUMENTO) as [TipoDocumento, string][];

interface AdicionalLinha {
  motivo: string;
  valor: number;
}

// -- página de detalhe --------------------------------------------------------------
// Espelha legado/app/reserva/visualizarReserva.php + include/header.php
// + include/mCheck-in.php, mCheck-out.php, mDadosCheckin.php, mDadosCheckout.php.

@Component({
  selector: 'app-reserva-detail',
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DateInputComponent,
    ReservaFiscalComponent,
  ],
  template: `
    <div class="page">
      <a class="btn-dark-blue" routerLink="/reservas">
        <mat-icon>arrow_back</mat-icon> Reservas
      </a>

      <!-- alerta "checkin-fake" do legado -->
      @if (checkinFake()) {
        <div class="alert-warn">Não é possível realizar check-in antes da data de entrada</div>
      }

      @if (carregando()) {
        <div class="center"><mat-spinner diameter="48" /></div>
      } @else if (r(); as res) {
        <!-- ===== Dados da reserva ===== -->
        <div class="inner-card">
          <div class="inner-card-header">
            <h4>Dados da reserva Nº <b>&nbsp;{{ res.id }}</b></h4>
          </div>
          <div class="inner-card-body">
            <div class="head-row">
              <div class="badges">
                @if (res.status === 'c') {
                  <span class="my-badge status-chip bg-danger">Reserva cancelada</span>
                } @else {
                  <span
                    class="my-badge status-chip"
                    [class.bg-warn-t]="!res.checkin_em"
                    [class.bg-blue]="!!res.checkin_em"
                  >
                    Check-in {{ res.checkin_em ? 'realizado' : 'pendente' }}
                  </span>
                  <span
                    class="my-badge status-chip"
                    [class.bg-warn-t]="!res.checkout_em"
                    [class.bg-blue]="!!res.checkout_em"
                  >
                    Check-out {{ res.checkout_em ? 'realizado' : 'pendente' }}
                  </span>
                }
              </div>
              <div class="acoes">
                @if (res.status === 'p') {
                  @if (podeCheckin(res)) {
                    <button class="btn-green" type="button" (click)="abrirModal('checkin')">
                      Realizar Check-in
                    </button>
                  } @else {
                    <button class="btn-gray" type="button" (click)="mostrarCheckinFake()">
                      Check-in
                    </button>
                  }
                } @else if (res.checkin_em) {
                  <button class="btn-gray" type="button" (click)="abrirDados('checkin')">
                    Dados do Check-in
                  </button>
                }
                @if (res.status === 'i') {
                  <button class="btn-green" type="button" (click)="abrirCheckout()">
                    Realizar Check-out
                  </button>
                } @else if (res.checkout_em) {
                  <button class="btn-gray" type="button" (click)="abrirDados('checkout')">
                    Dados do Check-out
                  </button>
                }
                @if (res.status === 'p' || res.status === 'i') {
                  <button class="btn-danger" type="button" (click)="abrirModal('cancelar')">
                    Cancelar reserva
                  </button>
                }
              </div>
            </div>

            <!-- reserva read-only com input-group + ícone (legado) -->
            <div class="sec">Reserva</div>
            <div class="fgrid">
              <div class="f c6">
                <label class="lbl2">Cliente</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>person</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.cliente_nome" />
                </div>
              </div>
              <div class="f c6">
                <label class="lbl2">CPF</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>badge</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.cliente_cpf" />
                </div>
              </div>
              <div class="f c6">
                <label class="lbl2">Acomodação</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>house</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.acomodacao_nome" />
                </div>
              </div>
              <div class="f c3">
                <label class="lbl2">Número</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>tag</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.acomodacao_numero" />
                </div>
              </div>
              <div class="f c3">
                <label class="lbl2">Valor da Diária</label>
                <div class="ig">
                  <span class="ig-icon"><strong>R$</strong></span>
                  <input class="ig-input" readonly [value]="num(res.valordiaria) | number: '1.2-2'" />
                </div>
              </div>
              <div class="f c4">
                <label class="lbl2">Entrada prevista</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>event_available</mat-icon></span>
                  <input
                    class="ig-input"
                    readonly
                    [value]="res.entradaprevista | date: 'dd/MM/yyyy'"
                  />
                </div>
              </div>
              <div class="f c4">
                <label class="lbl2">Saída prevista</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>event_busy</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.saidaprevista | date: 'dd/MM/yyyy'" />
                </div>
              </div>
              <div class="f c4">
                <label class="lbl2">Quantidade de hóspedes</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>groups</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.quantidade_hospedes" />
                </div>
              </div>
              <div class="f c12">
                <label class="lbl2">Observação</label>
                <div class="ig">
                  <span class="ig-icon"><mat-icon>comment</mat-icon></span>
                  <input class="ig-input" readonly [value]="res.obs ?? ''" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== Registro de hóspedes (acompanhantes + FNRH) ===== -->
        <div class="inner-card">
          <div class="inner-card-header spread">
            <h4>Registro de hóspedes</h4>
            <button class="btn-dark-blue fnrh-btn" type="button" (click)="abrirFnrh()">
              <mat-icon>assignment_ind</mat-icon> Emitir FNRH
            </button>
          </div>
          <div class="inner-card-body">
            <span class="sec2"><mat-icon>groups</mat-icon> Acompanhantes</span>
            @if (res.status !== 'c' && !res.checkout_em) {
              <form [formGroup]="acompForm" class="consumo-form" autocomplete="off">
                <label class="lbl2 grow">
                  Nome completo
                  <input class="input-inn" type="text" formControlName="nome" />
                </label>
                <label class="lbl2">
                  Nascimento
                  <app-date formControlName="data_nascimento" />
                </label>
                <label class="lbl2">
                  Parentesco
                  <select class="input-inn" formControlName="parentesco">
                    <option value="">—</option>
                    @for (p of parentescos; track p) {
                      <option [value]="p">{{ p }}</option>
                    }
                  </select>
                </label>
                <label class="lbl2">
                  Doc.
                  <select class="input-inn" formControlName="doc_tipo">
                    <option value="">—</option>
                    @for (t of tiposDoc; track t[0]) {
                      <option [value]="t[0]">{{ t[1] }}</option>
                    }
                  </select>
                </label>
                <label class="lbl2">
                  Nº doc.
                  <input class="input-inn w110" type="text" formControlName="doc_numero" />
                </label>
                <button
                  class="btn-green"
                  type="button"
                  [disabled]="acompForm.invalid"
                  (click)="adicionarAcompanhante()"
                >
                  Adicionar
                </button>
              </form>
            }
            <table class="plain bordered sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Nascimento</th>
                  <th>Parentesco</th>
                  <th>Documento</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (a of acompanhantes(); track a.id) {
                  <tr>
                    <td>{{ a.id }}</td>
                    <td>{{ a.nome }}</td>
                    <td>{{ a.data_nascimento | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ a.parentesco ?? '—' }}</td>
                    <td>
                      {{ a.doc_tipo ? rotuloDoc(a.doc_tipo) : '—' }}
                      {{ a.doc_numero ?? '' }}
                    </td>
                    <td>
                      @if (res.status !== 'c' && !res.checkout_em) {
                        <button
                          class="badge-acao bg-dark-blue"
                          type="button"
                          title="Remover acompanhante"
                          (click)="removerAcompanhante(a)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="muted tc">Sem acompanhantes.</td>
                  </tr>
                }
              </tbody>
            </table>

            @if (fichas().length) {
              <span class="sec2 bt"><mat-icon>description</mat-icon> Fichas FNRH emitidas</span>
              <div class="fnrh-export">
                <span class="fx-lbl">Exportar SNE/CSV (MTur):</span>
                <input class="fx-inp" type="date" [value]="sneIni" (input)="sneIni=$any($event.target).value" aria-label="Início" />
                <input class="fx-inp" type="date" [value]="sneFim" (input)="sneFim=$any($event.target).value" aria-label="Fim" />
                <button class="badge-acao bg-dark-blue" type="button" title="Baixar CSV das fichas do período" (click)="exportarSne()">
                  <mat-icon>download</mat-icon>
                </button>
              </div>
              <table class="plain bordered sm">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Emitida em</th>
                    <th>Retenção legal</th>
                    <th>Motivo da viagem</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of fichas(); track f.id) {
                    <tr>
                      <td>{{ f.id }}</td>
                      <td>{{ f.emitida_em | date: 'dd/MM/yyyy - HH:mm' }}</td>
                      <td><span class="ret-badge" title="Guarda obrigatória — Portaria MTur 41/2025">até {{ retencaoAte(f.emitida_em) }}</span></td>
                      <td>{{ f.motivo_viagem ?? '—' }}</td>
                      <td>
                        <button
                          class="badge-acao bg-dark-blue"
                          type="button"
                          title="Imprimir ficha"
                          (click)="imprimirFnrh(f)"
                        >
                          <mat-icon>print</mat-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>

        <!-- ===== Consumo ===== -->
        @if (res.consumo; as c) {
          <div class="inner-card">
            <div class="inner-card-header spread">
              <h4>Consumo</h4>
              <span class="total-consumo">
                Total consumido
                <b>R$ {{ num(c.valor_itens) + num(c.valor_adicional) | number: '1.2-2' }}</b>
              </span>
            </div>
            <div class="inner-card-body">
              <div class="cols">
                <!-- Itens consumidos (frigobar) -->
                <div class="col">
                  <span class="sec2"><mat-icon>shopping_cart</mat-icon> Itens consumidos</span>
                  @if (res.status === 'i') {
                    <form [formGroup]="itemForm" class="consumo-form">
                      <label class="lbl2">
                        Item do frigobar
                        <select class="input-inn" formControlName="iditem_frigobar">
                          <option [ngValue]="0">Selecione um item</option>
                          @for (i of itensFrigobar(); track i.id) {
                            <option [ngValue]="i.id">
                              {{ i.item_nome }} ({{ i.quantidade }} disp.)
                            </option>
                          }
                        </select>
                      </label>
                      <label class="lbl2 w90">
                        Quantidade
                        <input class="input-inn" type="number" min="1" formControlName="quantidade" />
                      </label>
                      <div class="ig-add">
                        <input
                          class="input-inn"
                          readonly
                          [value]="'R$ ' + (valorItem() | number: '1.2-2')"
                        />
                        <button
                          class="btn-green"
                          type="button"
                          [disabled]="itemForm.invalid"
                          (click)="registrarItem()"
                        >
                          Adicionar
                        </button>
                      </div>
                    </form>
                  }
                  <table class="plain bordered sm">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th>Quantidade</th>
                        <th>Data</th>
                        <th>Valor total</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (i of itens(); track i.id) {
                        <tr>
                          <td>{{ i.id }}</td>
                          <td>{{ i.nome }}</td>
                          <td>{{ i.quantidade }}</td>
                          <td>{{ i.criado_em | date: 'dd/MM/yyyy - HH:mm' }}</td>
                          <td>R$ {{ num(i.valor_total) | number: '1.2-2' }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="muted tc">Nenhum item consumido.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  @if (itens().length) {
                    <button class="btn-dark-blue print" type="button" (click)="reimprimirProducao()">
                      <mat-icon>print</mat-icon> Reimprimir pedidos (setores)
                    </button>
                  }
                </div>

                <!-- Consumo adicional -->
                <div class="col">
                  <span class="sec2"><mat-icon>add_shopping_cart</mat-icon> Consumo adicional</span>
                  @if (res.status === 'i') {
                    <form [formGroup]="adicionalForm" class="consumo-form">
                      <label class="lbl2 grow">
                        Descrição
                        <input class="input-inn" type="text" formControlName="motivo" />
                      </label>
                      <div class="ig-add">
                        <span class="rs">R$</span>
                        <input
                          class="input-inn w110"
                          type="number"
                          step="0.01"
                          min="0"
                          formControlName="valor"
                        />
                        <button
                          class="btn-green"
                          type="button"
                          [disabled]="adicionalForm.invalid"
                          (click)="lancarAdicional()"
                        >
                          Adicionar
                        </button>
                      </div>
                    </form>
                  }
                  <table class="plain bordered sm">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Motivo</th>
                        <th>Valor total</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (a of adicionaisList(); track a.id) {
                        <tr>
                          <td>{{ a.id }}</td>
                          <td>{{ a.motivo }}</td>
                          <td>R$ {{ num(a.valor) | number: '1.2-2' }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="3" class="muted tc">Nenhum adicional.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        }

        <!-- ===== Comunicações (fila de envio e-mail/WhatsApp) ===== -->
        <div class="inner-card">
          <div class="inner-card-header">
            <h4>Comunicações com o hóspede</h4>
          </div>
          <div class="inner-card-body">
            @if (comunicacoes().length === 0) {
              <p class="muted">Nenhuma mensagem registrada para esta reserva.</p>
            } @else {
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead>
                    <tr>
                      <th>Canal</th>
                      <th>Mensagem</th>
                      <th>Destino</th>
                      <th>Status</th>
                      <th>Enviado</th>
                      <th>Entregue</th>
                      <th>Lido</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of comunicacoes(); track c.id) {
                      <tr>
                        <td>{{ rotuloCanal(c.canal) }}</td>
                        <td>{{ rotuloTemplate(c.template) }}</td>
                        <td>{{ c.destino }}</td>
                        <td>
                          <span class="ret-badge">{{ rotuloStatus(c.status) }}</span>
                          @if (c.ultimo_erro) {
                            <div class="muted" style="font-size:0.7rem">{{ c.ultimo_erro }}</div>
                          }
                        </td>
                        <td>{{ c.enviado_em ? (c.enviado_em | date: 'dd/MM HH:mm') : '—' }}</td>
                        <td>{{ c.entregue_em ? (c.entregue_em | date: 'dd/MM HH:mm') : '—' }}</td>
                        <td>{{ c.lido_em ? (c.lido_em | date: 'dd/MM HH:mm') : '—' }}</td>
                        <td>
                          @if (c.status === 'falhou' || c.status === 'desconhecido') {
                            <button
                              class="btn-dark-blue btn-sm"
                              type="button"
                              [disabled]="enviando()"
                              (click)="reenviarComunicacao(c.id)"
                            >
                              Reenviar
                            </button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>

        <!-- ===== Notas fiscais (NFS-e via Spedy) ===== -->
        <app-reserva-fiscal [idreserva]="res.id" />
      }
    </div>

    <!-- ===== modal Realizar Check-in (mCheck-in.php) ===== -->
    @if (modal() === 'checkin') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Realizar Check-in">
          <div class="modal-head">
            <h5>Realizar Check-in</h5>
            <button class="close" type="button" (click)="fecharModal()" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <form [formGroup]="checkinForm">
              <span class="lbl2">Escolha uma opção</span>
              <label class="radio-row">
                <input type="radio" formControlName="modo" value="auto" />
                Check-in Automático (Recupera a data e hora atuais)
              </label>
              <label class="radio-row bb">
                <input type="radio" formControlName="modo" value="manual" />
                Check-in Manual (Digite a data e hora manualmente)
              </label>
              @if (checkinForm.value.modo === 'manual') {
                <div class="duo mt">
                  <label class="lbl2">
                    Data do check-in
                    <app-date
                      formControlName="data"
                      [min]="hojeMenosUm()"
                      [max]="hoje()"
                    />
                  </label>
                  <label class="lbl2">
                    Hora do check-in
                    <input class="input-inn" type="time" formControlName="hora" />
                  </label>
                </div>
              }
              <small class="muted note">
                * Apenas é possível realizar check-in manual com no máximo 1 dia de diferença
              </small>
              @if (ecaBloqueio()) {
                <div class="alert-eca mt">
                  <strong>Menor desacompanhado (ECA art. 82)</strong>
                  <p>Não há adulto nesta reserva. Registre o documento da autorização
                    assinada pelos pais ou responsável legal para liberar o check-in.</p>
                  <label class="lbl2">
                    Documento de autorização (nº/órgão ou referência)
                    <input class="input-inn" type="text" formControlName="autorizacao"
                      placeholder="Ex.: Autorização notarial nº 2026-114 / RG do responsável" />
                  </label>
                </div>
              }
              <div class="end mt">
                @if (ecaBloqueio()) {
                  <button
                    class="btn-green"
                    type="button"
                    [disabled]="enviando() || !checkinForm.value.autorizacao?.trim()"
                    (click)="registrarAutorizacao()"
                  >
                    Registrar autorização e concluir
                  </button>
                } @else {
                  <button
                    class="btn-green"
                    type="button"
                    [disabled]="enviando() || checkinForm.invalid"
                    (click)="confirmarCheckin()"
                  >
                    Concluir Check-in
                  </button>
                }
              </div>
            </form>
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Realizar Check-out (mCheck-out.php) ===== -->
    @if (modal() === 'checkout') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Realizar Check-out">
          <div class="modal-head">
            <h5>Realizar Check-out</h5>
            <button class="close" type="button" (click)="fecharModal()" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            @if (r()?.consumo; as c) {
              <div class="fgrid">
                <div class="f c6">
                  <label class="lbl2">Total de itens consumidos</label>
                  <input class="input-inn ro" readonly [value]="itens().length" />
                </div>
                <div class="f c6">
                  <label class="lbl2">Valor total consumido</label>
                  <input
                    class="input-inn ro"
                    readonly
                    [value]="'R$ ' + (num(c.valor_itens) | number: '1.2-2')"
                  />
                </div>
                <div class="f c6">
                  <label class="lbl2">Total de diárias</label>
                  <input class="input-inn ro" readonly [value]="diarias()" />
                </div>
                <div class="f c6">
                  <label class="lbl2">Valor total da diária</label>
                  <input
                    class="input-inn ro"
                    readonly
                    [value]="'R$ ' + (num(c.valor_estadia) | number: '1.2-2')"
                  />
                </div>
                @if (num(c.valor_adicional) > 0) {
                  <div class="f c12">
                    <label class="lbl2">Adicionais lançados na estadia</label>
                    <input
                      class="input-inn ro"
                      readonly
                      [value]="'R$ ' + (num(c.valor_adicional) | number: '1.2-2')"
                    />
                  </div>
                }
              </div>

              <label class="switch-row bb">
                <input type="checkbox" [checked]="custosAdicionais()" (change)="toggleCustos()" />
                Custos Adicionais
              </label>

              @if (custosAdicionais()) {
                @for (ad of adicionaisCheckout(); track $index) {
                  <div class="add-row">
                    <div class="ig-add">
                      <span class="rs">R$</span>
                      <input
                        class="input-inn w110"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Valor"
                        [value]="ad.valor"
                        (input)="editAdValor($index, $event)"
                      />
                    </div>
                    <input
                      class="input-inn grow"
                      type="text"
                      placeholder="Descrição"
                      [value]="ad.motivo"
                      (input)="editAdMotivo($index, $event)"
                    />
                    <button
                      class="btn-gray sq"
                      type="button"
                      (click)="$index === adicionaisCheckout().length - 1 ? addAdicional() : removerAdicional($index)"
                      [attr.aria-label]="$index === adicionaisCheckout().length - 1 ? 'Adicionar linha' : 'Remover linha'"
                    >
                      <mat-icon>{{
                        $index === adicionaisCheckout().length - 1 ? 'add' : 'delete'
                      }}</mat-icon>
                    </button>
                  </div>
                }
              }

              <form [formGroup]="checkoutForm" class="fgrid mt">
                <div class="f c6">
                  <label class="lbl2">Desconto</label>
                  <div class="ig-add">
                    <span class="rs">R$</span>
                    <input
                      class="input-inn"
                      type="number"
                      step="0.01"
                      min="0"
                      formControlName="desconto"
                    />
                  </div>
                </div>
                <div class="f c6">
                  <label class="lbl2">Valor Final</label>
                  <input
                    class="input-inn ro"
                    readonly
                    [value]="'R$ ' + (totalFinal() | number: '1.2-2')"
                  />
                </div>
                <div class="f c12">
                  <label class="lbl2">Forma de pagamento</label>
                  <select class="input-inn" formControlName="idforma_pagamento">
                    <option [ngValue]="0">Selecione uma forma de pagamento</option>
                    @for (p of pagamentos(); track p.id) {
                      <option [ngValue]="p.id">{{ p.nome }}</option>
                    }
                  </select>
                </div>
              </form>

              <div class="end mt">
                <button
                  class="btn-green"
                  type="button"
                  [disabled]="enviando() || checkoutForm.invalid"
                  (click)="confirmarCheckout()"
                >
                  Confirmar Pagamento
                </button>
              </div>
            }
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Dados do check-in (mDadosCheckin.php) ===== -->
    @if (modal() === 'dados-checkin'; as m) {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Dados do check-in">
          <div class="modal-head">
            <h5>Dados do check-in</h5>
            <button class="close" type="button" (click)="fecharModal()" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <table class="plain bordered">
              <thead>
                <tr>
                  <th colspan="2">Dados do check-in</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Realizado por:</td>
                  <td>{{ realizador() || '—' }}</td>
                </tr>
                <tr>
                  <td>Dia e hora:</td>
                  <td>
                    {{ r()?.checkin_em | date: 'dd/MM/yyyy' }} às
                    {{ r()?.checkin_em | date: 'HH:mm' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Dados do check-out (mDadosCheckout.php) ===== -->
    @if (modal() === 'dados-checkout') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn" role="dialog" aria-modal="true" aria-label="Dados do check-out">
          <div class="modal-head">
            <h5>Dados do check-out</h5>
            <button class="close" type="button" (click)="fecharModal()" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <table class="plain bordered">
              <thead>
                <tr>
                  <th colspan="2">Dados do check-out</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Realizado por:</td>
                  <td>{{ realizador() || '—' }}</td>
                </tr>
                <tr>
                  <td>Dia e hora:</td>
                  <td>
                    {{ r()?.checkout_em | date: 'dd/MM/yyyy' }} às
                    {{ r()?.checkout_em | date: 'HH:mm' }}
                  </td>
                </tr>
                @if (r()?.consumo; as c) {
                  <tr>
                    <td>Valor da estadia:</td>
                    <td>R$ {{ num(c.valor_estadia) | number: '1.2-2' }}</td>
                  </tr>
                  <tr>
                    <td>Valor de itens consumidos:</td>
                    <td>R$ {{ num(c.valor_itens) | number: '1.2-2' }}</td>
                  </tr>
                  <tr>
                    <td>Valor adicional:</td>
                    <td>R$ {{ num(c.valor_adicional) | number: '1.2-2' }}</td>
                  </tr>
                  <tr>
                    <td>Desconto:</td>
                    <td>R$ {{ num(c.total_desconto) | number: '1.2-2' }}</td>
                  </tr>
                  <tr>
                    <td>Total:</td>
                    <td>R$ {{ num(c.valor_final) | number: '1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <div class="end">
              <button class="btn-dark-blue" type="button" (click)="baixarComprovante()">
                <mat-icon>download</mat-icon> Comprovante
              </button>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Cancelar reserva (mCancelarReserva / mCancelarReservaAdministrador) ===== -->
    @if (modal() === 'cancelar') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn sm" role="dialog" aria-modal="true" aria-label="Cancelar reserva">
          <div class="modal-body">
            <h5 class="cancel-title">Essa reserva será cancelada, deseja mesmo continuar?</h5>
            @if (cancelarAdmin()) {
              <form [formGroup]="adminForm" class="admin-box">
                <h6 class="tc">Informe usuário e senha de administrador</h6>
                <label class="lbl2">
                  Usuário
                  <input
                    class="input-inn"
                    type="text"
                    formControlName="login_admin"
                    placeholder="Login de administrador"
                  />
                </label>
                <label class="lbl2">
                  Senha
                  <input
                    class="input-inn"
                    type="password"
                    formControlName="senha_admin"
                    placeholder="Senha de administrador"
                  />
                </label>
              </form>
              <div class="end mt">
                <button
                  class="btn-primary"
                  type="button"
                  [disabled]="enviando() || adminForm.invalid"
                  (click)="confirmarCancelar()"
                >
                  Continuar
                </button>
              </div>
            } @else {
              <div class="cancel-btns bt">
                <button class="btn-warning" type="button" (click)="fecharModal()">NÃO</button>
                <button class="btn-primary" type="button" (click)="simCancelar()">SIM</button>
              </div>
            }
          </div>
        </div>
      </div>
    }

    <!-- ===== modal Emitir FNRH ===== -->
    @if (modal() === 'fnrh') {
      <div class="overlay" (click.self)="fecharModal()">
        <div class="modal-inn sm" role="dialog" aria-modal="true" aria-label="Emitir FNRH">
          <div class="modal-head">
            <h5>Emitir FNRH — ficha de registro</h5>
            <button class="close" type="button" (click)="fecharModal()" aria-label="Fechar">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="modal-body">
            <small class="muted">
              A ficha grava um snapshot do hóspede, da estadia e dos acompanhantes
              (fica no arquivo digital do cliente).
            </small>
            <form [formGroup]="fnrhForm" class="fgrid">
              <div class="f c12">
                <label class="lbl2">Motivo da viagem</label>
                <select class="input-inn" formControlName="motivo_viagem">
                  <option value="">—</option>
                  @for (m of motivosViagem; track m) {
                    <option [value]="m">{{ m }}</option>
                  }
                </select>
              </div>
              <div class="f c12">
                <label class="lbl2">Placa do veículo (se houver)</label>
                <input
                  class="input-inn"
                  type="text"
                  formControlName="placa_veiculo"
                  placeholder="ABC1D23"
                />
              </div>
            </form>
            <div class="end mt">
              <button
                class="btn-green"
                type="button"
                [disabled]="enviando()"
                (click)="emitirFnrh()"
              >
                <mat-icon>assignment_ind</mat-icon> Emitir e imprimir
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .center { display: grid; place-items: center; padding: 64px; }
    .inner-card { margin-top: 1rem; }
    .inner-card-header h4 { display: flex; align-items: baseline; }
    .inner-card-header.spread { display: flex; justify-content: space-between; align-items: center; }
    .total-consumo { font-size: 0.9rem; }

    .alert-warn {
      margin-top: 12px; background: #fff3cd; color: #664d03;
      border: 1px solid #ffecb5; border-radius: 0.25rem;
      padding: 0.6rem 1rem; font-size: 0.85rem;
      animation: in 0.3s ease-out;
    }
    .alert-eca {
      background: #fdf1e8; border: 1px solid #f0c9a8; border-radius: 8px;
      padding: 10px 12px; font-size: 0.82rem; color: #7a4a12;
    }
    .alert-eca strong { display: block; margin-bottom: 4px; }
    .alert-eca p { margin: 0 0 8px; }

    .head-row { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .my-badge { font-size: 0.8rem; }
    .status-chip.bg-warn-t { background: #b5811f; color: #33424c; }
    .status-chip.bg-blue { background: #1a6f8a; }
    .status-chip.bg-danger { background: #7d97a1; }
    .acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .acoes .btn-green, .acoes .btn-gray, .acoes .btn-danger { font-size: 0.8rem; padding: 0.3em 0.7em; }
    .btn-gray.sq { padding: 0 8px; display: inline-flex; align-items: center; }
    .btn-gray.sq mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .sec { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
    .sec2 { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; font-weight: 600; margin-bottom: 8px; }
    .sec2 mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* input-group read-only com addon de ícone cinza (legado) */
    .fgrid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 10px; }
    .f { display: flex; flex-direction: column; gap: 4px; }
    .c3 { grid-column: span 3; } .c4 { grid-column: span 4; }
    .c6 { grid-column: span 6; } .c12 { grid-column: span 12; }
    .lbl2 { font-size: 0.8rem; font-weight: 600; color: #374151; display: flex; flex-direction: column; gap: 4px; }
    .ig { display: flex; }
    .ig-icon {
      background: #5d6d7e; color: #fff; border-radius: 0.2rem 0 0 0.2rem;
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 34px; font-size: 12px; padding: 0 8px;
    }
    .ig-icon mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .ig-input {
      flex: 1; border: 1px solid #c3d2d9; border-left: none;
      border-radius: 0 0.2rem 0.2rem 0; padding: 5px 9px;
      font-size: 0.82rem; font-family: inherit; background: #eef2f5; color: #495057;
    }

    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; }
    .consumo-form { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin: 8px 0 12px; }
    .consumo-form .grow { flex: 1; min-width: 140px; }
    .w90 { width: 90px; }
    .w110 { width: 110px; }
    .ig-add { display: flex; gap: 0; align-items: stretch; }
    .ig-add .input-inn { border-radius: 0.2rem 0 0 0.2rem; border-right: none; width: 110px; }
    .ig-add .rs {
      background: #eef2f5; border: 1px solid #c3d2d9; border-right: none;
      border-radius: 0.2rem 0 0 0.2rem; padding: 6px 9px; font-size: 0.85rem; color: #495057;
    }
    .ig-add .btn-green { border-radius: 0 0.2rem 0.2rem 0; }
    .ig-add .rs + .input-inn { border-radius: 0; }
    .ig-add .rs + .input-inn + .btn-green { border-radius: 0 0.2rem 0.2rem 0; }
    table.sm { font-size: 80%; }
    .print { margin-top: 10px; }

    /* modais Bootstrap-like — base global em styles.css */
    .modal-inn { max-width: 560px; }
    .modal-inn.sm { max-width: 420px; }
    .modal-body { gap: 10px; }
    .alert-warn { animation: modal-in 0.3s ease-out; }
    .mt { margin-top: 8px; }
    .bb { border-bottom: 1px solid #d7e0e6; padding-bottom: 10px; }
    .bt { border-top: 1px solid #d7e0e6; padding-top: 12px; }
    .tc { text-align: center; }
    .end { display: flex; justify-content: flex-end; }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .ro { background: #eef2f5; }
    .note { font-size: 70%; }
    .radio-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.85rem; padding: 6px 0; cursor: pointer;
    }
    .switch-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.85rem; padding: 4px 0; cursor: pointer;
    }
    .add-row { display: flex; gap: 8px; align-items: center; }
    .add-row .grow { flex: 1; }

    /* registro de hóspedes */
    .fnrh-btn {
      font-size: 0.8rem; padding: 0.3em 0.7em;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .fnrh-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .consumo-form select.input-inn { min-width: 110px; }
    .cancel-title { font-size: 1rem; font-weight: 600; text-align: center; margin: 0.5rem 0; }
    .cancel-btns { display: flex; justify-content: space-between; }
    .admin-box {
      border: 1px solid #d7e0e6; border-radius: 0.25rem; padding: 1rem;
      display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .admin-box h6 { margin: 0; font-size: 0.85rem; font-weight: 600; }
    table.plain td { font-size: 0.85rem; }
    .fnrh-export { display: flex; align-items: center; gap: 6px; margin: 4px 0 8px; flex-wrap: wrap; }
    .fx-lbl { font-size: 0.75rem; color: #5d6d7e; font-weight: 600; }
    .fx-inp { border: 1px solid #d7e0e6; border-radius: 6px; padding: 4px 8px; font-size: 0.8rem; }
    .ret-badge {
      background: #eef4f6; color: #054054; border-radius: 10px;
      padding: 2px 8px; font-size: 0.72rem; font-weight: 600;
    }

    @media (max-width: 760px) {
      .c3, .c4, .c6 { grid-column: span 12; }
    }
  `,
})
export class ReservaDetailComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'adicional_consumo');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        const id = this.id();
        if (id > 0) {
          this.reservasApi.buscarReserva(id).subscribe({
            next: (r) => {
              this.r.set(r);
              this.carregarExtras(r);
            },
            error: () => undefined,
          });
        }
      }
    });
  }
  private readonly estabelecimentoApi = inject(EstabelecimentoApi);
  private readonly frigobaresApi = inject(FrigobaresApi);
  private readonly impressorasApi = inject(ImpressorasApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly comunicacaoApi = inject(ComunicacaoApi);
  private readonly notify = inject(Notify);
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthStore);
  private readonly fb = inject(FormBuilder);

  protected readonly id = signal(0);
  protected readonly r = signal<ReservaDetalhe | null>(null);
  protected readonly itens = signal<ItemConsumido[]>([]);
  protected readonly adicionaisList = signal<AdicionalConsumo[]>([]);
  protected readonly itensFrigobar = signal<ItemFrigobarView[]>([]);
  protected readonly carregando = signal(true);
  protected readonly num = num;

  // modais
  protected readonly modal = signal<Modal>(null);
  protected readonly enviando = signal(false);
  protected readonly checkinFake = signal(false);
  /** ECA — check-in bloqueado aguardando autorização de menor. */
  protected readonly ecaBloqueio = signal(false);
  protected readonly realizador = signal<string | null>(null);
  protected readonly pagamentos = signal<FormaPagamento[]>([]);
  protected readonly custosAdicionais = signal(false);
  protected readonly adicionaisCheckout = signal<AdicionalLinha[]>([]);
  protected readonly cancelarAdmin = signal(false);

  // registro de hóspedes
  protected readonly acompanhantes = signal<Acompanhante[]>([]);
  protected readonly fichas = signal<Fnrh[]>([]);
  protected readonly comunicacoes = signal<ItemFila[]>([]);
  protected readonly retencaoAnos = signal(5);
  protected sneIni = '';
  protected sneFim = '';
  protected readonly motivosViagem = MOTIVOS_VIAGEM;
  protected readonly parentescos = PARENTESCOS;
  protected readonly tiposDoc = TIPOS_DOC;

  protected readonly itemForm = this.fb.nonNullable.group({
    iditem_frigobar: [0, Validators.min(1)],
    quantidade: [1, [Validators.required, Validators.min(1)]],
  });
  protected readonly adicionalForm = this.fb.nonNullable.group({
    motivo: ['', Validators.required],
    valor: [0, [Validators.required, Validators.min(0.01)]],
  });
  protected readonly checkinForm = this.fb.nonNullable.group({
    modo: ['auto' as 'auto' | 'manual'],
    data: [''],
    hora: [''],
    autorizacao: [''],
  });
  protected readonly checkoutForm = this.fb.nonNullable.group({
    idforma_pagamento: [0, Validators.min(1)],
    desconto: [0, Validators.min(0)],
  });
  protected readonly adminForm = this.fb.nonNullable.group({
    login_admin: ['', Validators.required],
    senha_admin: ['', Validators.required],
  });
  protected readonly acompForm = this.fb.nonNullable.group({
    nome: ['', Validators.required],
    data_nascimento: [''],
    parentesco: [''],
    doc_tipo: [''],
    doc_numero: [''],
  });
  protected readonly fnrhForm = this.fb.nonNullable.group({
    motivo_viagem: [''],
    placa_veiculo: [''],
  });

  /** Valor unitário do item do frigobar selecionado (exibição no form). */
  protected valorItem(): number {
    const id = Number(this.itemForm.value.iditem_frigobar ?? 0);
    const it = this.itensFrigobar().find((i) => i.id === id);
    return it ? num(it.valor_unitario) : 0;
  }

  /** Check-in só liberado a partir da data de entrada prevista (legado). */
  podeCheckin(res: ReservaDetalhe): boolean {
    return this.hoje() >= res.entradaprevista.slice(0, 10);
  }

  hoje(): string {
    return new Date().toISOString().slice(0, 10);
  }
  hojeMenosUm(): string {
    return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  }

  /** Diárias efetivas: check-in → hoje, mínimo 1 (regra do mCheck-out.php). */
  diarias(): number {
    const cin = this.r()?.checkin_em;
    if (!cin) return 1;
    const diff = Math.floor(
      (new Date(this.hoje()).getTime() - new Date(cin.slice(0, 10)).getTime()) / 86400000,
    );
    return Math.max(1, diff);
  }

  /** Total do check-out — mesma fórmula do backend (estadia + itens +
   *  adicionais já lançados + adicionais do modal - desconto). */
  totalFinal(): number {
    const c = this.r()?.consumo;
    if (!c) return 0;
    const novos = this.adicionaisCheckout().reduce((s, a) => s + (a.valor || 0), 0);
    const t =
      num(c.valor_estadia) +
      num(c.valor_itens) +
      num(c.valor_adicional) +
      novos -
      (this.checkoutForm.value.desconto || 0);
    return Math.max(0, t);
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(switchMap((p) => this.reservasApi.buscarReserva(Number(p.get('id')))))
      .subscribe({
        next: (r) => {
          this.id.set(r.id);
          this.r.set(r);
          this.carregarExtras(r);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  private carregarExtras(res: ReservaDetalhe): void {
    this.carregando.set(true);
    this.reservasApi.itensConsumidos(res.id).subscribe({
      next: (i) => this.itens.set(i),
      error: () => undefined,
    });
    this.reservasApi.adicionais(res.id).subscribe({
      next: (a) => this.adicionaisList.set(a),
      error: () => undefined,
    });
    this.reservasApi.listarAcompanhantes(res.id).subscribe({
      next: (a) => this.acompanhantes.set(a),
      error: () => undefined,
    });
    this.reservasApi.fnrhReserva(res.id).subscribe({
      next: (f) => this.fichas.set(f),
      error: () => undefined,
    });
    this.comunicacaoApi.comunicacoesReserva(res.id).subscribe({
      next: (c) => this.comunicacoes.set(c),
      error: () => undefined,
    });
    this.estabelecimentoApi.obterEstabelecimento().subscribe({
      next: (e) => this.retencaoAnos.set(e.retencao_dados_anos ?? 5),
      error: () => undefined,
    });
    if (res.status === 'i') {
      this.frigobaresApi.listarFrigobares().subscribe({
        next: (fs) => {
          const f = fs.find((x) => x.idacomodacao === res.idacomodacao && x.ativo);
          if (f) {
            this.frigobaresApi.itensFrigobar(f.id).subscribe({
              next: (its) =>
                this.itensFrigobar.set(its.filter((i) => i.ativo && i.quantidade > 0)),
              error: () => undefined,
            });
          }
        },
        error: () => undefined,
      });
    }
    this.carregando.set(false);
  }

  private recarregar(): void {
    this.reservasApi.buscarReserva(this.id()).subscribe({
      next: (r) => {
        this.r.set(r);
        this.carregarExtras(r);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  protected reenviarComunicacao(iditem: number): void {
    const id = this.id();
    if (id <= 0) return;
    this.enviando.set(true);
    this.comunicacaoApi.reenviarComunicacao(id, iditem).subscribe({
      next: () => {
        this.enviando.set(false);
        this.notify.ok('Mensagem reenfileirada para envio.');
        this.carregarExtras(this.r()!);
      },
      error: (e) => {
        this.enviando.set(false);
        this.notify.erro(e);
      },
    });
  }

  protected rotuloCanal(canal: ItemFila['canal']): string {
    return { email: 'E-mail', whatsapp: 'WhatsApp', push: 'Push', inbox: 'Interna' }[canal];
  }

  protected rotuloStatus(status: ItemFila['status']): string {
    return {
      pendente: 'Na fila',
      enviando: 'Enviando',
      enviado: 'Enviado',
      falhou: 'Falhou',
      cancelado: 'Cancelado',
      suprimido: 'Suprimido',
      desconhecido: 'Resultado incerto',
    }[status];
  }

  protected rotuloTemplate(template: string): string {
    const mapa: Record<string, string> = {
      reserva_confirmada: 'Reserva confirmada',
      reserva_pagamento: 'Pagamento confirmado',
      reserva_cancelada: 'Reserva cancelada',
      reserva_expirada: 'Reserva expirada',
      lembrete_checkin: 'Lembrete de check-in',
      fnrh_link: 'Pré-check-in (FNRH)',
      checkout_link: 'Check-out online',
      pesquisa_satisfacao: 'Pesquisa de satisfação',
      pesquisa_lembrete: 'Lembrete de pesquisa',
      cobranca: 'Cobrança',
    };
    return mapa[template] ?? template;
  }

  // -- modais --------------------------------------------------------------------

  abrirModal(m: Exclude<Modal, null>): void {
    if (m === 'cancelar') {
      this.cancelarAdmin.set(false);
      this.adminForm.reset({ login_admin: '', senha_admin: '' });
    }
    if (m === 'checkin') {
      this.ecaBloqueio.set(false);
      this.checkinForm.reset({ modo: 'auto', data: this.hoje(), hora: '', autorizacao: '' });
    }
    this.modal.set(m);
  }

  fecharModal(): void {
    this.modal.set(null);
    this.enviando.set(false);
  }

  mostrarCheckinFake(): void {
    this.checkinFake.set(true);
    setTimeout(() => this.checkinFake.set(false), 4000);
  }

  // -- check-in (mCheck-in.php: automático ou manual ±1 dia) ----------------------

  confirmarCheckin(): void {
    const v = this.checkinForm.getRawValue();
    let data: string | null = null;
    let hora: string | null = null;
    if (v.modo === 'manual') {
      if (!v.data || !v.hora) {
        this.notify.erro(new Error('Informe a data e a hora do check-in.'));
        return;
      }
      const diff = Math.abs(new Date(v.data).getTime() - new Date(this.hoje()).getTime());
      if (diff > 86400000) {
        this.notify.erro(
          new Error('Check-in manual permite no máximo 1 dia de diferença.'),
        );
        return;
      }
      data = v.data;
      hora = v.hora;
    }
    this.enviando.set(true);
    this.reservasApi.checkin(this.id(), data, hora).subscribe({
      next: () => {
        this.notify.ok('Check-in realizado.');
        this.ecaBloqueio.set(false);
        this.fecharModal();
        this.recarregar();
      },
      error: (e) => {
        this.enviando.set(false);
        // ECA art. 82 — menor desacompanhado pede autorização documentada.
        const msg = String(e?.error?.erro?.mensagem ?? e?.message ?? '');
        if (/menor|ECA|autoriza/i.test(msg)) {
          this.ecaBloqueio.set(true);
        } else {
          this.notify.erro(e);
        }
      },
    });
  }

  /** Registra a autorização dos pais (ECA) e refaz o check-in. */
  registrarAutorizacao(): void {
    const doc = this.checkinForm.value.autorizacao?.trim();
    if (!doc) return;
    this.enviando.set(true);
    this.reservasApi.autorizacaoMenor(this.id(), doc).subscribe({
      next: () => this.confirmarCheckin(),
      error: (e) => {
        this.enviando.set(false);
        this.notify.erro(e);
      },
    });
  }

  // -- check-out (mCheck-out.php) --------------------------------------------------

  abrirCheckout(): void {
    this.pagamentosApi.listarPagamentos(true).subscribe({
      next: (p) => {
        this.pagamentos.set(p);
        this.custosAdicionais.set(false);
        this.adicionaisCheckout.set([]);
        this.checkoutForm.reset({ idforma_pagamento: 0, desconto: 0 });
        this.modal.set('checkout');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleCustos(): void {
    const on = !this.custosAdicionais();
    this.custosAdicionais.set(on);
    this.adicionaisCheckout.set(on ? [{ motivo: '', valor: 0 }] : []);
  }
  addAdicional(): void {
    this.adicionaisCheckout.update((xs) => [...xs, { motivo: '', valor: 0 }]);
  }
  removerAdicional(i: number): void {
    this.adicionaisCheckout.update((xs) => xs.filter((_, j) => j !== i));
  }
  editAdMotivo(i: number, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.adicionaisCheckout.update((xs) =>
      xs.map((a, j) => (j === i ? { ...a, motivo: v } : a)),
    );
  }
  editAdValor(i: number, e: Event): void {
    const v = Number((e.target as HTMLInputElement).value) || 0;
    this.adicionaisCheckout.update((xs) =>
      xs.map((a, j) => (j === i ? { ...a, valor: v } : a)),
    );
  }

  confirmarCheckout(): void {
    const v = this.checkoutForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi.checkout(this.id(), {
        idforma_pagamento: v.idforma_pagamento,
        total_desconto: v.desconto || null,
        adicionais: this.adicionaisCheckout().filter((a) => a.motivo.trim() && a.valor > 0),
      })
      .subscribe({
        next: () => {
          this.notify.ok('Check-out concluído.');
          this.fecharModal();
          this.recarregar();
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- dados do check-in / check-out (mDadosCheckin/mDadosCheckout) ----------------

  /** Busca no log de auditoria quem executou a ação nesta reserva. */
  abrirDados(acao: 'checkin' | 'checkout'): void {
    this.realizador.set(null);
    this.modal.set(acao === 'checkin' ? 'dados-checkin' : 'dados-checkout');
    this.relatoriosApi.logs({ tabela: 'reserva', acao, idtabela: this.id(), porPagina: 1 })
      .subscribe({
        next: (p) => this.realizador.set(p.items[0]?.funcionario_nome ?? null),
        error: () => undefined,
      });
  }

  baixarComprovante(): void {
    const res = this.r();
    if (!res) return;
    this.pagamentosApi.comprovanteTexto(res.id).subscribe({
      next: (texto) => {
        const nome = res.consumo?.comprovante ?? `comprovante_${res.id}.txt`;
        const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- cancelar (mCancelarReserva / mCancelarReservaAdministrador) ------------------

  /** SIM — se em estadia sem ser admin, revela o form de credenciais (legado). */
  simCancelar(): void {
    const res = this.r();
    const precisaAdmin = !!res?.checkin_em && !res?.checkout_em && !this.auth.isAdmin();
    if (precisaAdmin) {
      this.cancelarAdmin.set(true);
    } else {
      this.confirmarCancelar();
    }
  }

  confirmarCancelar(): void {
    const v = this.adminForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi.cancelarReserva(this.id(), {
        login_admin: this.cancelarAdmin() ? v.login_admin : null,
        senha_admin: this.cancelarAdmin() ? v.senha_admin : null,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Reserva cancelada.');
          this.fecharModal();
          this.recarregar();
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  // -- consumo ----------------------------------------------------------------------

  registrarItem(): void {
    if (this.itemForm.invalid) return;
    const v = this.itemForm.getRawValue();
    this.reservasApi.registrarItemConsumido(this.id(), v.iditem_frigobar, v.quantidade).subscribe({
      next: () => {
        this.notify.ok('Consumo lançado.');
        this.itemForm.reset({ iditem_frigobar: 0, quantidade: 1 });
        this.recarregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Lançamento avulso na conta durante a estadia (consumo adicional). */
  lancarAdicional(): void {
    const v = this.adicionalForm.getRawValue();
    this.reservasApi.lancarAdicional(this.id(), v.motivo, v.valor).subscribe({
      next: () => {
        this.notify.ok('Adicional lançado.');
        this.adicionalForm.reset({ motivo: '', valor: 0 });
        this.recarregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Reimprime os tickets de produção — um por impressora de setor. */
  reimprimirProducao(): void {
    this.impressorasApi.imprimirProducao(this.id()).subscribe({
      next: (r) => this.notify.ok(r.mensagem),
      error: (e) => this.notify.erro(e),
    });
  }

  // -- registro de hóspedes (acompanhantes + FNRH) ------------------------------

  adicionarAcompanhante(): void {
    if (this.acompForm.invalid) return;
    const v = this.acompForm.getRawValue();
    this.reservasApi.adicionarAcompanhante(this.id(), {
        nome: v.nome.trim(),
        data_nascimento: v.data_nascimento || null,
        parentesco: v.parentesco || null,
        doc_tipo: v.doc_tipo || null,
        doc_numero: v.doc_numero || null,
      })
      .subscribe({
        next: (a) => {
          this.acompanhantes.update((xs) => [...xs, a]);
          this.acompForm.reset({
            nome: '',
            data_nascimento: '',
            parentesco: '',
            doc_tipo: '',
            doc_numero: '',
          });
          this.notify.ok('Acompanhante adicionado.');
        },
        error: (e) => this.notify.erro(e),
      });
  }

  removerAcompanhante(a: Acompanhante): void {
    this.reservasApi.removerAcompanhante(a.id).subscribe({
      next: () => {
        this.acompanhantes.update((xs) => xs.filter((x) => x.id !== a.id));
        this.notify.ok('Acompanhante removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirFnrh(): void {
    this.fnrhForm.reset({ motivo_viagem: '', placa_veiculo: '' });
    this.modal.set('fnrh');
  }

  /** Emite a ficha (snapshot imutável no servidor) e já abre a impressão. */
  emitirFnrh(): void {
    const v = this.fnrhForm.getRawValue();
    this.enviando.set(true);
    this.reservasApi.emitirFnrh(this.id(), {
        motivo_viagem: v.motivo_viagem || null,
        placa_veiculo: v.placa_veiculo || null,
      })
      .subscribe({
        next: (f) => {
          this.fichas.update((xs) => [f, ...xs]);
          this.notify.ok('Ficha FNRH emitida.');
          this.fecharModal();
          imprimirFnrh(f);
        },
        error: (e) => {
          this.enviando.set(false);
          this.notify.erro(e);
        },
      });
  }

  imprimirFnrh(f: Fnrh): void {
    imprimirFnrh(f);
  }

  retencaoAte(emitidaEm: string): string {
    const d = new Date(emitidaEm);
    d.setFullYear(d.getFullYear() + this.retencaoAnos());
    return d.toLocaleDateString('pt-BR');
  }

  exportarSne(): void {
    if (!this.sneIni || !this.sneFim) return;
    this.reservasApi.exportarFnrh(this.sneIni, this.sneFim).subscribe({
      next: (csv) => {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `fnrh-sne-${this.sneIni}_${this.sneFim}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  rotuloDoc(t: string): string {
    return TIPOS_DOCUMENTO[t as TipoDocumento] ?? t;
  }

  rotulo(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.rotulo ?? s;
  }
}
