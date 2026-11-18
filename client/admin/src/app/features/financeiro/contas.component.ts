// UI de contas — template, estilos e bindings. A lógica vive em contas.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { FinContasStore } from './contas.store';

@Component({
  selector: 'app-fin-contas',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule, DateInputComponent],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Contas a pagar e receber</h2>
          <p class="fin-sub">Títulos, baixas e contas financeiras</p>
        </div>
        <button type="button" class="btn-prim" (click)="toggleForm()">
          <mat-icon>add</mat-icon> Novo lançamento
        </button>
      </div>

      <!-- contas financeiras -->
      <section class="card cf-card">
        <header class="card-head">
          <h3><mat-icon>account_balance_wallet</mat-icon> Contas financeiras</h3>
          <button type="button" class="btn-ghost" (click)="toggleCfForm()">
            <mat-icon>add</mat-icon> Nova conta
          </button>
        </header>
        @if (cfFormAberto()) {
          <form class="cf-form" [formGroup]="cfForm" (ngSubmit)="salvarConta()">
            <input
              class="inp"
              formControlName="nome"
              placeholder="Nome da conta *"
              aria-label="Nome da conta"
            />
            <select class="inp" formControlName="tipo" aria-label="Tipo da conta">
              <option value="banco">Banco</option>
              <option value="caixa">Caixa físico</option>
              <option value="aplicacao">Aplicação</option>
            </select>
            <input class="inp" formControlName="banco" placeholder="Banco" aria-label="Banco" />
            <input
              class="inp"
              formControlName="agencia"
              placeholder="Agência"
              aria-label="Agência"
            />
            <input class="inp" formControlName="conta" placeholder="Conta" aria-label="Conta" />
            <input
              class="inp"
              formControlName="saldo_inicial"
              type="number"
              step="0.01"
              min="0"
              placeholder="Saldo inicial"
              aria-label="Saldo inicial"
            />
            <button class="btn-prim" type="submit" [disabled]="cfForm.invalid">Salvar</button>
          </form>
        }
        <div class="cf-lista">
          @for (c of contas(); track c.id) {
            <div class="cf-chip" [class.inativa]="!c.ativo">
              <mat-icon>{{ iconeConta(c.tipo) }}</mat-icon>
              <span class="cf-nome">{{ c.nome }}</span>
              <span class="cf-saldo">{{ fmt(saldos()[c.id] ?? c.saldo_inicial) }}</span>
              @if (!c.ativo) {
                <span class="cf-tag">inativa</span>
              }
            </div>
          } @empty {
            <p class="vazio">Nenhuma conta cadastrada — crie uma para dar baixas.</p>
          }
        </div>
      </section>

      <!-- novo lançamento -->
      @if (formAberto()) {
        <section class="card form-card">
          <header class="card-head">
            <h3><mat-icon>note_add</mat-icon> Novo lançamento</h3>
            <button
              type="button"
              class="btn-ghost"
              (click)="toggleForm()"
              aria-label="Fechar formulário"
            >
              <mat-icon>close</mat-icon>
            </button>
          </header>
          <form class="l-form" [formGroup]="form" (ngSubmit)="salvar()">
            <div class="seg" role="group" aria-label="Tipo do lançamento">
              <button
                type="button"
                class="seg-btn rec"
                [class.ativo]="form.controls.tipo.value === 'receber'"
                [attr.aria-pressed]="form.controls.tipo.value === 'receber'"
                (click)="form.controls.tipo.setValue('receber')"
              >
                <mat-icon>arrow_downward</mat-icon> A receber
              </button>
              <button
                type="button"
                class="seg-btn pag"
                [class.ativo]="form.controls.tipo.value === 'pagar'"
                [attr.aria-pressed]="form.controls.tipo.value === 'pagar'"
                (click)="form.controls.tipo.setValue('pagar')"
              >
                <mat-icon>arrow_upward</mat-icon> A pagar
              </button>
            </div>
            <label class="lbl l-half"
              >Descrição *
              <input
                class="inp"
                formControlName="descricao"
                placeholder="Ex.: Diárias da reserva"
                required
              />
            </label>
            <label class="lbl l-half"
              >Favorecido / fornecedor
              <input
                class="inp"
                formControlName="favorecido"
                placeholder="Nome da pessoa ou empresa"
              />
            </label>
            <label class="lbl"
              >Valor (R$) *
              <input
                class="inp"
                formControlName="valor"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                required
              />
            </label>
            <label class="lbl"
              >Vencimento *
              <app-date formControlName="vencimento" rotulo="Vencimento" />
            </label>
            <label class="lbl"
              >Parcelas
              <input
                class="inp"
                formControlName="parcelas"
                type="number"
                min="1"
                max="60"
                aria-label="Parcelas mensais"
              />
            </label>
            <label class="lbl l-half"
              >Plano de contas
              <select class="inp" formControlName="idplano_conta">
                <option [ngValue]="null">Sem classificação</option>
                @for (p of planoFiltrado(); track p.id) {
                  <option [ngValue]="p.id">{{ p.codigo }} — {{ p.nome }}</option>
                }
              </select>
            </label>
            <label class="lbl l-half"
              >Conta financeira
              <select class="inp" formControlName="idconta_financeira">
                <option [ngValue]="null">Sem conta</option>
                @for (c of contas(); track c.id) {
                  @if (c.ativo) {
                    <option [ngValue]="c.id">{{ c.nome }}</option>
                  }
                }
              </select>
            </label>
            <label class="lbl l-full"
              >Observação
              <input
                class="inp"
                formControlName="observacao"
                placeholder="Informações adicionais (opcional)"
              />
            </label>
            <div class="l-acoes">
              <span class="l-hint">* Campos obrigatórios</span>
              <button
                class="btn-ghost"
                type="button"
                (click)="toggleForm()"
                [disabled]="salvando()"
              >
                Cancelar
              </button>
              <button class="btn-prim" type="submit" [disabled]="form.invalid || salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar lançamento' }}
              </button>
            </div>
          </form>
        </section>
      }

      <!-- filtros -->
      <div class="fin-abas" role="group" aria-label="Tipo">
        <button
          type="button"
          class="aba rec"
          [class.ativo]="aba() === 'receber'"
          (click)="mudarAba('receber')"
        >
          <mat-icon>arrow_downward</mat-icon> A receber
        </button>
        <button
          type="button"
          class="aba pag"
          [class.ativo]="aba() === 'pagar'"
          (click)="mudarAba('pagar')"
        >
          <mat-icon>arrow_upward</mat-icon> A pagar
        </button>
        <div class="filtros">
          <select class="inp" [formControl]="statusCtrl" aria-label="Status">
            <option value="">Todos os status</option>
            <option value="aberto">Em aberto</option>
            <option value="parcial">Parcial</option>
            <option value="liquidado">Liquidado</option>
            <option value="cancelado">Cancelado</option>
          </select>
          <label class="chk">
            <input type="checkbox" [formControl]="vencidosCtrl" /> Só vencidos
          </label>
          <input
            class="inp"
            [formControl]="buscaCtrl"
            placeholder="Buscar…"
            aria-label="Buscar lançamentos"
          />
        </div>
      </div>

      <!-- tabela -->
      <section class="card">
        @if (carregando()) {
          <div class="skel sk-tab"></div>
        } @else {
          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Descrição</th>
                  <th>Favorecido</th>
                  <th>Classificação</th>
                  <th>Vencimento</th>
                  <th class="tr">Valor</th>
                  <th class="tr">Saldo</th>
                  <th class="tc">Status</th>
                  <th class="tc">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (l of itens(); track l.id) {
                  <tr [class.linha-vencida]="l.vencido">
                    <td>
                      <div class="td-desc">{{ l.descricao }}</div>
                      @if (l.idreserva) {
                        <span class="td-mini">Reserva Nº{{ l.idreserva }}</span>
                      }
                    </td>
                    <td>{{ l.favorecido ?? l.cliente_nome ?? '—' }}</td>
                    <td>
                      <span class="chip-conta">{{ l.plano_conta ?? '—' }}</span>
                    </td>
                    <td [class.td-venc]="l.vencido">
                      {{ l.vencimento | date: 'dd/MM/yy' }}
                      @if (l.vencido) {
                        <mat-icon class="ic-alerta" aria-label="Vencido">warning</mat-icon>
                      }
                    </td>
                    <td class="tr td-valor">{{ fmt(l.valor) }}</td>
                    <td class="tr td-valor">{{ fmt(l.saldo) }}</td>
                    <td class="tc">
                      <span class="st" [class]="'st ' + STATUS[l.status].cls">{{
                        STATUS[l.status].rotulo
                      }}</span>
                    </td>
                    <td class="tc td-acoes">
                      @if (l.status === 'aberto' || l.status === 'parcial') {
                        <button
                          type="button"
                          class="badge-acao bg-green"
                          title="Dar baixa"
                          (click)="abrirBaixa(l)"
                        >
                          <mat-icon>payments</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="badge-acao bg-red"
                          title="Cancelar"
                          (click)="cancelar(l)"
                        >
                          <mat-icon>block</mat-icon>
                        </button>
                      }
                      <button
                        type="button"
                        class="badge-acao bg-blue1"
                        title="Ver baixas"
                        (click)="toggleBaixas(l.id)"
                      >
                        <mat-icon>list</mat-icon>
                      </button>
                    </td>
                  </tr>
                  @if (baixaAberta() === l.id) {
                    <tr class="tr-baixa">
                      <td colspan="8">
                        <form
                          class="bx-form"
                          [formGroup]="baixaForm"
                          (ngSubmit)="confirmarBaixa(l)"
                        >
                          <strong>Baixa de {{ fmt(l.saldo) }}</strong>
                          <select
                            class="inp"
                            formControlName="idconta_financeira"
                            aria-label="Conta de destino"
                          >
                            @for (c of contas(); track c.id) {
                              @if (c.ativo) {
                                <option [ngValue]="c.id">{{ c.nome }}</option>
                              }
                            }
                          </select>
                          <input
                            class="inp"
                            formControlName="valor"
                            type="number"
                            step="0.01"
                            min="0.01"
                            [max]="num(l.saldo)"
                            aria-label="Valor da baixa"
                          />
                          <app-date
                            class="inp-date"
                            formControlName="data"
                            rotulo="Data da baixa"
                          />
                          <select
                            class="inp"
                            formControlName="idforma_pagamento"
                            aria-label="Forma de pagamento"
                          >
                            <option [ngValue]="null">Pagamento…</option>
                            @for (f of pagamentos(); track f.id) {
                              <option [ngValue]="f.id">{{ f.nome }}</option>
                            }
                          </select>
                          <input
                            class="inp"
                            formControlName="observacao"
                            placeholder="Observação"
                            aria-label="Observação"
                          />
                          <button class="btn-prim" type="submit" [disabled]="baixaForm.invalid">
                            Confirmar
                          </button>
                          <button class="btn-ghost" type="button" (click)="fecharBaixa()">
                            Fechar
                          </button>
                        </form>
                      </td>
                    </tr>
                  }
                  @if (baixasAbertas() === l.id) {
                    <tr class="tr-baixas">
                      <td colspan="8">
                        @if (baixas().length) {
                          <table class="tab tab-mini">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>Conta</th>
                                <th>Pagamento</th>
                                <th>Por</th>
                                <th class="tr">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (b of baixas(); track b.id) {
                                <tr>
                                  <td>{{ b.data | date: 'dd/MM/yy' }}</td>
                                  <td>{{ b.conta_financeira ?? '—' }}</td>
                                  <td>{{ b.forma_pagamento ?? '—' }}</td>
                                  <td>{{ b.funcionario ?? '—' }}</td>
                                  <td class="tr">{{ fmt(b.valor) }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                        } @else {
                          <p class="vazio">Sem baixas registradas.</p>
                        }
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr>
                    <td colspan="8" class="vazio">Nenhum lançamento encontrado.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <footer class="pag">
            <button
              type="button"
              class="btn-ghost"
              [disabled]="page() <= 1"
              (click)="pagina(page() - 1)"
            >
              <mat-icon>chevron_left</mat-icon> Anterior
            </button>
            <span>{{ page() }} / {{ totalPaginas() }} — {{ total() }} títulos</span>
            <button
              type="button"
              class="btn-ghost"
              [disabled]="page() >= totalPaginas()"
              (click)="pagina(page() + 1)"
            >
              Próxima <mat-icon>chevron_right</mat-icon>
            </button>
          </footer>
        }
      </section>
    </div>
  `,
  styles: `
    .fin-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 14px;
      margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .fin-titulo {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      letter-spacing: -0.02em;
    }
    .fin-sub {
      margin: 2px 0 0;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px 18px;
      margin-bottom: 14px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .card-head h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }
    .card-head h3 mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .btn-prim {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #054054;
      color: #fff;
      border: none;
      border-radius: 7px;
      padding: 0 16px;
      min-height: 36px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-prim:hover:not(:disabled) {
      background: #0a5a74;
    }
    .btn-prim:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #fff;
      border: 1px solid #d7e0e6;
      color: #5d6d7e;
      border-radius: 7px;
      padding: 0 12px;
      min-height: 32px;
      font-weight: 600;
      font-size: 0.8rem;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-ghost:hover:not(:disabled) {
      border-color: #1a6f8a;
      color: #1a6f8a;
    }
    .btn-ghost:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .inp {
      border: 1px solid #d7e0e6;
      border-radius: 7px;
      padding: 8px 11px;
      font-size: 0.85rem;
      font-family: inherit;
      color: #33424c;
      background: #fff;
      min-width: 0;
    }
    .inp:focus {
      outline: 2px solid #1a6f8a33;
      border-color: #1a6f8a;
    }
    .lbl {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 0.72rem;
      font-weight: 600;
      color: #7d97a1;
    }
    .cf-form {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 0;
      border-bottom: 1px dashed #e3eaef;
      margin-bottom: 10px;
    }
    .cf-form .inp {
      flex: 1 1 130px;
    }
    .cf-lista {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cf-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #e3eaef;
      border-radius: 8px;
      padding: 8px 14px;
      background: #f7fafb;
    }
    .cf-chip.inativa {
      opacity: 0.55;
    }
    .cf-chip mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #1a6f8a;
    }
    .cf-nome {
      font-weight: 600;
      font-size: 0.85rem;
      color: #33424c;
    }
    .cf-saldo {
      font-weight: 800;
      font-size: 0.88rem;
      color: #054054;
      font-variant-numeric: tabular-nums;
    }
    .cf-tag {
      font-size: 0.68rem;
      text-transform: uppercase;
      color: #a5b6bf;
      font-weight: 700;
    }
    .form-card {
      container-type: inline-size;
    }
    .l-form {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 16px;
    }
    .l-form .lbl {
      grid-column: span 2;
      min-width: 0;
      gap: 6px;
      font-size: 0.8rem;
      color: #40525d;
    }
    .l-form .l-half {
      grid-column: span 3;
    }
    .l-form .l-full,
    .l-form .seg,
    .l-acoes {
      grid-column: 1 / -1;
    }
    .l-form .inp {
      box-sizing: border-box;
      width: 100%;
      height: 42px;
      flex: none;
    }
    .l-form .inp::placeholder {
      color: #647580;
      opacity: 1;
    }
    .l-form :is(input, select, button):focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: 2px;
    }
    .l-acoes {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      border-top: 1px solid #e3eaef;
      padding-top: 16px;
    }
    .l-acoes button {
      min-height: 42px;
      justify-content: center;
    }
    .l-hint {
      margin-right: auto;
      color: #5d6d7e;
      font-size: 0.78rem;
    }
    .seg {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .l-form .seg-btn {
      min-height: 42px;
    }
    .l-form .seg-btn.rec.ativo {
      color: #146c43;
    }
    .l-form .seg-btn.pag.ativo {
      color: #b02a37;
    }
    @container (max-width:520px) {
      .l-form {
        grid-template-columns: minmax(0, 1fr);
      }
      .l-form .lbl {
        grid-column: 1 / -1;
      }
      .l-acoes {
        flex-wrap: wrap;
      }
      .l-hint {
        flex-basis: 100%;
      }
      .l-acoes button {
        flex: 1;
      }
    }
    .seg-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1.5px solid #d7e0e6;
      background: #fff;
      border-radius: 999px;
      padding: 7px 18px;
      font-weight: 600;
      font-size: 0.82rem;
      cursor: pointer;
      font-family: inherit;
      color: #5d6d7e;
    }
    .seg-btn.rec.ativo {
      border-color: #198754;
      color: #198754;
      background: #eaf7ef;
    }
    .seg-btn.pag.ativo {
      border-color: #dc3545;
      color: #dc3545;
      background: #fdeaec;
    }
    .fin-abas {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .aba {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid #d7e0e6;
      background: #fff;
      border-radius: 9px;
      padding: 9px 16px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      font-family: inherit;
      color: #5d6d7e;
    }
    .aba mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .aba.rec.ativo {
      border-color: #198754;
      color: #198754;
    }
    .aba.pag.ativo {
      border-color: #dc3545;
      color: #dc3545;
    }
    .aba-total {
      font-variant-numeric: tabular-nums;
      font-weight: 800;
    }
    .filtros {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .filtros .inp {
      padding: 7px 10px;
      font-size: 0.82rem;
    }
    .chk {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      color: #5d6d7e;
      font-weight: 600;
      white-space: nowrap;
    }
    .tab-wrap {
      overflow-x: auto;
    }
    .tab {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .tab thead th {
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.73rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 11px 14px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .tab tbody td {
      padding: 11px 14px;
      border-bottom: 1px solid #eef2f5;
      vertical-align: middle;
      color: #33424c;
    }
    .tab .tc {
      text-align: center;
    }
    .tab .tr {
      text-align: right;
    }
    .td-desc {
      font-weight: 600;
      color: #054054;
    }
    .td-mini {
      font-size: 0.72rem;
      color: #8a99a4;
    }
    .td-valor {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .td-venc {
      color: #dc3545;
      font-weight: 700;
      white-space: nowrap;
    }
    .linha-vencida {
      background: #fdf6f6;
    }
    .ic-alerta {
      font-size: 15px;
      width: 15px;
      height: 15px;
      vertical-align: -3px;
      color: #dc3545;
    }
    .chip-conta {
      font-size: 0.78rem;
      color: #5d6d7e;
      background: #eef4f6;
      border-radius: 5px;
      padding: 3px 8px;
      white-space: nowrap;
    }
    .st {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      border-radius: 999px;
      padding: 3px 11px;
      white-space: nowrap;
    }
    .st-aberto {
      background: #f7ead2;
      color: #9a6b00;
    }
    .st-parcial {
      background: #dbe9f5;
      color: #1a6f8a;
    }
    .st-liquidado {
      background: #dff2e5;
      color: #198754;
    }
    .st-cancelado {
      background: #eee;
      color: #7d97a1;
      text-decoration: line-through;
    }
    .td-acoes {
      white-space: nowrap;
    }
    .badge-acao {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      color: #fff;
      margin: 0 2px;
    }
    .badge-acao mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .bg-green {
      background: #198754;
    }
    .bg-red {
      background: #dc3545;
    }
    .bg-blue1 {
      background: #1a6f8a;
    }
    .tr-baixa td,
    .tr-baixas td {
      background: #f7fafb;
      padding: 14px 18px;
    }
    .bx-form {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .bx-form strong {
      color: #054054;
      font-size: 0.85rem;
    }
    .bx-form .inp {
      flex: 0 1 auto;
    }
    .tab-mini {
      font-size: 0.84rem;
    }
    .tab-mini thead th {
      padding: 8px 12px;
    }
    .tab-mini tbody td {
      padding: 8px 12px;
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
    .vazio {
      color: #8a99a4;
      font-size: 0.85rem;
      text-align: center;
      padding: 22px 0;
      margin: 0;
    }
    .skel {
      border-radius: 8px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: sk 1.2s infinite;
    }
    .sk-tab {
      height: 320px;
    }
    @keyframes sk {
      to {
        background-position: -200% 0;
      }
    }
  `,
})
export class FinContasComponent extends FinContasStore {}
