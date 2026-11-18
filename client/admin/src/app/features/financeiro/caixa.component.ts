// UI de caixa — template, estilos e bindings. A lógica vive em caixa.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FinCaixaStore } from './caixa.store';

@Component({
  selector: 'app-fin-caixa',
  imports: [FinNavComponent, DatePipe, DecimalPipe, ReactiveFormsModule, MatIconModule, RouterLink],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Controle de Caixa</h2>
          <p class="fin-sub">Turnos por operador, sangrias, suprimentos e conferência</p>
        </div>
        <label class="lbl gaveta">
          Gaveta
          <select class="inp" [formControl]="selGaveta" aria-label="Gaveta (conta caixa físico)">
            @for (c of gavetas(); track c.id) {
              <option [ngValue]="c.id">{{ c.nome }}</option>
            }
          </select>
        </label>
      </div>

      <!-- ======================= fechamento do dia ======================= -->
      <section class="card fch">
        <header class="card-head">
          <h3><mat-icon>event_available</mat-icon> Fechamento do dia</h3>
          <div class="fch-steps">
            @for (s of [1, 2, 3]; track s) {
              <span class="fch-step" [class.ativa]="passo() === s">{{ s }}</span>
            }
          </div>
        </header>

        @if (passo() === 1) {
          <h4 class="fch-t">Pendências do dia</h4>
          @if (fch(); as f) {
            <p class="fch-linha">
              Contas abertas: <b>{{ f.contas_abertas }}</b> · total R$
              {{ f.contas_total | number: '1.2-2' }}
            </p>
            @if (f.checkouts_pendentes.length) {
              <p class="fch-sub">Check-outs pendentes</p>
              @for (c of f.checkouts_pendentes; track c.id) {
                <div class="fch-item">
                  <span
                    >{{ c.acomodacao_nome }} · {{ c.cliente_nome }} · saída
                    {{ c.saidaprevista | date: 'dd/MM' }}</span
                  >
                  <a class="fch-link" [routerLink]="['/reservas', c.id]">abrir</a>
                </div>
              }
            }
            @if (f.no_shows.length) {
              <p class="fch-sub">Possíveis no-shows — decisão requer PIN</p>
              @for (n of f.no_shows; track n.id) {
                <div class="fch-item ns">
                  <span
                    >{{ n.acomodacao_nome }} · {{ n.cliente_nome }} · entrada
                    {{ n.entradaprevista | date: 'dd/MM' }} ({{ n.dias_atraso }}d atraso)</span
                  >
                  <button class="fch-ns" type="button" (click)="pinAlvo.set(n)">No-show</button>
                </div>
              }
            } @else {
              <p class="fch-linha muted">Nenhum no-show pendente.</p>
            }
          } @else {
            <p class="fch-linha muted">Carregando…</p>
          }
          <div class="fch-nav">
            <button class="btn-prim" type="button" (click)="passo.set(2)">Avançar</button>
          </div>
        }

        @if (passo() === 2) {
          <h4 class="fch-t">Caixa</h4>
          <p class="fch-linha">
            Confira a conferência do turno abaixo na tela (esperado × contado por gaveta) antes de
            confirmar.
          </p>
          <div class="fch-nav">
            <button class="btn-ghost" type="button" (click)="passo.set(1)">Voltar</button>
            <button class="btn-prim" type="button" (click)="passo.set(3)">Avançar</button>
          </div>
        }

        @if (passo() === 3) {
          <h4 class="fch-t">Confirmação do dia</h4>
          @if (fch(); as f) {
            <p class="fch-linha">
              {{ f.contas_abertas }} conta(s) aberta(s) ·
              {{ f.checkouts_pendentes.length }} check-out(s) pendente(s) ·
              {{ f.no_shows.length }} no-show(s)
            </p>
          }
          <p class="fch-linha muted">
            O relatório determinístico será enviado ao e-mail da pousada.
          </p>
          <div class="fch-nav">
            <button class="btn-ghost" type="button" (click)="passo.set(1)">Voltar</button>
            <button
              class="btn-prim"
              type="button"
              [disabled]="enviandoRel()"
              (click)="enviarRelatorio()"
            >
              {{ enviandoRel() ? 'Enviando…' : 'Enviar relatório por e-mail' }}
            </button>
          </div>
        }
      </section>

      @if (pinAlvo(); as alvo) {
        <div class="ovl" (click)="pinAlvo.set(null)" (keydown.escape)="pinAlvo.set(null)">
          <div class="dlg" role="dialog" aria-modal="true" aria-label="Autorizar no-show">
            <h4 class="fch-t">No-show — {{ alvo.cliente_nome }}</h4>
            <p class="fch-linha">Cancela a reserva sem reembolso. Exige o PIN gerencial.</p>
            <label class="lbl"
              >PIN
              <input
                class="inp"
                type="password"
                inputmode="numeric"
                [value]="pinVal"
                (input)="pinVal = $any($event.target).value"
            /></label>
            <div class="fch-nav">
              <button class="btn-ghost" type="button" (click)="pinAlvo.set(null)">Cancelar</button>
              <button class="btn-prim" type="button" (click)="confirmarNoShow(alvo)">
                Autorizar
              </button>
            </div>
          </div>
        </div>
      }

      @if (!gavetaSel()) {
        <section class="card">
          <p class="vazio">Nenhuma conta do tipo “Caixa físico” — crie em Contas financeiras.</p>
        </section>
      } @else {
        <!-- ======================= estado do turno ======================= -->
        @if (carregando()) {
          <div class="skel sk-bloco"></div>
        } @else if (!turno()) {
          <!-- não há turno aberto -->
          <section class="card">
            <header class="card-head">
              <h3><mat-icon>lock_open</mat-icon> Abertura de turno</h3>
            </header>
            <form class="ab-form" [formGroup]="abrirForm" (ngSubmit)="abrir()">
              <label class="lbl"
                >Fundo de troco *
                <input
                  class="inp"
                  formControlName="saldo_inicial"
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label="Fundo de troco"
                />
              </label>
              <label class="lbl grow"
                >Observação
                <input
                  class="inp"
                  formControlName="observacao"
                  aria-label="Observação de abertura"
                />
              </label>
              <button class="btn-prim" type="submit" [disabled]="abrirForm.invalid">
                <mat-icon>lock_open</mat-icon> Abrir turno
              </button>
            </form>
          </section>
        } @else if (conferencia(); as c) {
          <!-- painel do turno aberto -->
          <section class="turno-info">
            <div class="kpi">
              <div class="kpi-item">
                <span class="kpi-num">{{ fmt(c.fundo) }}</span>
                <span class="kpi-lbl"><mat-icon>savings</mat-icon> Fundo</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-num pos">{{ fmt(c.suprimentos) }}</span>
                <span class="kpi-lbl"><mat-icon>add_circle</mat-icon> Suprimentos</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-num neg">{{ fmt(c.sangrias) }}</span>
                <span class="kpi-lbl"><mat-icon>remove_circle</mat-icon> Sangrias</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-num pos">{{ fmt(c.recebimentos) }}</span>
                <span class="kpi-lbl"><mat-icon>payments</mat-icon> Recebimentos</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-num neg">{{ fmt(c.pagamentos) }}</span>
                <span class="kpi-lbl"><mat-icon>money_off</mat-icon> Pagamentos</span>
              </div>
              <div class="kpi-item">
                <span class="kpi-num pos">{{ fmt(c.especie) }}</span>
                <span class="kpi-lbl"><mat-icon>point_of_sale</mat-icon> Espécie (checkout)</span>
              </div>
              <div class="kpi-item esperado">
                <span class="kpi-num">{{ fmt(c.esperado) }}</span>
                <span class="kpi-lbl"><mat-icon>calculate</mat-icon> Esperado em gaveta</span>
              </div>
            </div>
            <p class="turno-meta">
              <mat-icon>person</mat-icon> {{ c.turno.operador }} · aberto
              {{ c.turno.aberto_em | date: 'dd/MM HH:mm' }} · {{ c.turno.conta_financeira }}
            </p>
          </section>

          <div class="grid-2">
            <!-- movimentos -->
            <section class="card">
              <header class="card-head">
                <h3><mat-icon>sync_alt</mat-icon> Movimentos</h3>
                <small>sangrias e suprimentos do turno</small>
              </header>
              <form class="mv-form" [formGroup]="movForm" (ngSubmit)="movimentar()">
                <div class="seg" role="group" aria-label="Tipo de movimento">
                  <button
                    type="button"
                    class="seg-btn san"
                    [class.ativo]="movForm.controls.tipo.value === 'sangria'"
                    (click)="movForm.controls.tipo.setValue('sangria')"
                  >
                    <mat-icon>remove_circle</mat-icon> Sangria
                  </button>
                  <button
                    type="button"
                    class="seg-btn sup"
                    [class.ativo]="movForm.controls.tipo.value === 'suprimento'"
                    (click)="movForm.controls.tipo.setValue('suprimento')"
                  >
                    <mat-icon>add_circle</mat-icon> Suprimento
                  </button>
                </div>
                <input
                  class="inp val"
                  formControlName="valor"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Valor *"
                  aria-label="Valor"
                />
                <input
                  class="inp grow"
                  formControlName="motivo"
                  placeholder="Motivo *"
                  aria-label="Motivo"
                />
                <button class="btn-prim" type="submit" [disabled]="movForm.invalid">
                  <mat-icon>send</mat-icon>
                </button>
              </form>
              <div class="tab-wrap">
                <table class="tab">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Tipo</th>
                      <th>Motivo</th>
                      <th>Por</th>
                      <th class="tr">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of c.movimentos; track m.id) {
                      <tr>
                        <td>{{ m.criado_em | date: 'dd/MM HH:mm' }}</td>
                        <td>
                          <span
                            class="tag"
                            [class.san]="m.tipo === 'sangria'"
                            [class.sup]="m.tipo === 'suprimento'"
                            >{{ m.tipo }}</span
                          >
                        </td>
                        <td>{{ m.motivo }}</td>
                        <td>{{ m.funcionario }}</td>
                        <td
                          class="tr"
                          [class.pos]="m.tipo === 'suprimento'"
                          [class.neg]="m.tipo === 'sangria'"
                        >
                          {{ fmt(m.valor) }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="5" class="vazio">Nenhum movimento ainda.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>

            <!-- conferência + fechamento -->
            <section class="card">
              <header class="card-head">
                <h3><mat-icon>fact_check</mat-icon> Conferência & fechamento</h3>
                <small>{{ c.linhas.length }} evento(s) no período</small>
              </header>
              <div class="tab-wrap linhas">
                <table class="tab">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Evento</th>
                      <th class="tr">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of c.linhas; track $index) {
                      <tr>
                        <td>{{ l.criado_em | date: 'dd/MM HH:mm' }}</td>
                        <td>{{ l.descricao }}</td>
                        <td class="tr" [class.pos]="l.sinal > 0" [class.neg]="l.sinal < 0">
                          {{ l.sinal > 0 ? '+' : '−' }}{{ fmt(l.valor) }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="3" class="vazio">Nenhum recebimento/pagamento no período.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <form class="fe-form" [formGroup]="feForm" (ngSubmit)="fechar()">
                <label class="lbl"
                  >Dinheiro contado na gaveta *
                  <input
                    class="inp"
                    formControlName="valor_contado"
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label="Valor contado"
                  />
                </label>
                <label class="lbl grow"
                  >Observação
                  <input
                    class="inp"
                    formControlName="observacao"
                    aria-label="Observação do fechamento"
                  />
                </label>
                @if (prevQuebra() !== null) {
                  <span
                    class="quebra-prev"
                    [class.neg]="prevQuebra()! < 0"
                    [class.pos]="prevQuebra()! > 0"
                  >
                    {{ prevQuebra()! < 0 ? 'Quebra' : prevQuebra()! > 0 ? 'Sobra' : 'Exato' }}:
                    {{ fmt(prevQuebra()) }}
                  </span>
                }
                <button class="btn-prim" type="submit" [disabled]="feForm.invalid">
                  <mat-icon>lock</mat-icon> Fechar turno
                </button>
              </form>
            </section>
          </div>
        }
      }

      <!-- ======================= histórico ======================= -->
      <section class="card">
        <header class="card-head">
          <h3><mat-icon>history</mat-icon> Histórico de turnos</h3>
          <small>{{ historico().total }} turno(s)</small>
        </header>
        <div class="tab-wrap">
          <table class="tab">
            <thead>
              <tr>
                <th>Abertura</th>
                <th>Fechamento</th>
                <th>Operador</th>
                <th>Gaveta</th>
                <th class="tr">Fundo</th>
                <th class="tr">Esperado</th>
                <th class="tr">Contado</th>
                <th class="tr">Quebra</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (t of historico().items; track t.id) {
                <tr>
                  <td>{{ t.aberto_em | date: 'dd/MM/yy HH:mm' }}</td>
                  <td>{{ t.fechado_em ? (t.fechado_em | date: 'dd/MM/yy HH:mm') : '—' }}</td>
                  <td>{{ t.operador }}</td>
                  <td>{{ t.conta_financeira }}</td>
                  <td class="tr">{{ fmt(t.saldo_inicial) }}</td>
                  <td class="tr">{{ t.valor_esperado === null ? '—' : fmt(t.valor_esperado) }}</td>
                  <td class="tr">{{ t.valor_contado === null ? '—' : fmt(t.valor_contado) }}</td>
                  <td class="tr" [class.neg]="num(t.quebra) < 0" [class.pos]="num(t.quebra) > 0">
                    {{ t.quebra === null ? '—' : fmt(t.quebra) }}
                  </td>
                  <td>
                    <span
                      class="tag"
                      [class.ab]="t.status === 'aberto'"
                      [class.fe]="t.status === 'fechado'"
                      >{{ t.status }}</span
                    >
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="vazio">Nenhum turno registrado.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (historico().total > historico().items.length) {
          <button class="btn-ghost" (click)="maisHistorico()">
            <mat-icon>expand_more</mat-icon> Carregar mais
          </button>
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
    .gaveta {
      min-width: 220px;
    }
    .lbl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      color: #5d6d7e;
    }
    .lbl.grow,
    .inp.grow {
      flex: 1;
    }
    .inp {
      border: 1px solid #d7e1e8;
      border-radius: 7px;
      padding: 8px 11px;
      font-size: 0.86rem;
      color: #33424c;
      background: #fff;
    }
    .inp:focus-visible {
      outline: 2px solid #1a6f8a;
      outline-offset: 1px;
    }
    .btn-prim {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: #054054;
      color: #fff;
      border: none;
      border-radius: 7px;
      padding: 9px 16px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-prim:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-ghost {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      color: #054054;
      border: 1px solid #c9d8df;
      border-radius: 7px;
      padding: 7px 12px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-prim mat-icon,
    .btn-ghost mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .kpi {
      display: flex;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      overflow-x: auto;
    }
    .kpi-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 14px 20px;
      min-width: 140px;
      border-left: 1px solid #eef2f5;
    }
    .kpi-item:first-child {
      border-left: none;
    }
    .kpi-item.esperado {
      background: #f0f7fa;
    }
    .kpi-num {
      font-size: 1.3rem;
      font-weight: 800;
      color: #054054;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .kpi-num.pos,
    .pos {
      color: #198754;
    }
    .kpi-num.neg,
    .neg {
      color: #dc3545;
    }
    .kpi-lbl {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.66rem;
      font-weight: 600;
      color: #7d97a1;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    .kpi-lbl mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #a5b6bf;
    }
    .turno-info {
      margin-bottom: 14px;
    }
    .turno-meta {
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 8px 2px 0;
      font-size: 0.78rem;
      color: #7d97a1;
    }
    .turno-meta mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
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
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    }
    .card-head h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .card-head h3 mat-icon {
      font-size: 19px;
      width: 19px;
      height: 19px;
    }
    .card-head small {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .fch {
      border-left: 4px solid #054054;
    }
    .fch-steps {
      display: flex;
      gap: 6px;
    }
    .fch-step {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #e3eaef;
      color: #8a99a4;
      font-size: 0.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .fch-step.ativa {
      background: #054054;
      color: #fff;
    }
    .fch-t {
      margin: 0 0 8px;
      font-size: 0.88rem;
      color: #054054;
    }
    .fch-linha {
      margin: 4px 0;
      font-size: 0.85rem;
    }
    .fch-sub {
      margin: 10px 0 4px;
      font-size: 0.75rem;
      font-weight: 700;
      color: #5d6d7e;
      text-transform: uppercase;
    }
    .fch-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid #f0f4f6;
      font-size: 0.83rem;
    }
    .fch-item.ns {
      color: #8a4a00;
    }
    .fch-link {
      color: #1a6f8a;
      font-size: 0.78rem;
    }
    .fch-ns {
      background: #8a4a00;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }
    .fch-nav {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
    }
    .muted {
      color: #8a99a4;
    }
    .ovl {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    .dlg {
      background: #fff;
      border-radius: 10px;
      padding: 18px;
      width: min(360px, 90vw);
    }
    .lbl {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #40525d;
    }
    .inp {
      border: 1px solid #d7e0e6;
      border-radius: 7px;
      padding: 8px 10px;
      font-size: 0.85rem;
    }
    .ab-form {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .ab-form .btn-prim {
      margin-bottom: 1px;
    }
    .mv-form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .mv-form .val {
      width: 120px;
    }
    .seg {
      display: inline-flex;
      border: 1px solid #d7e1e8;
      border-radius: 7px;
      overflow: hidden;
    }
    .seg-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #fff;
      border: none;
      padding: 8px 12px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #7d97a1;
      cursor: pointer;
    }
    .seg-btn mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .seg-btn.san.ativo {
      background: #dc3545;
      color: #fff;
    }
    .seg-btn.sup.ativo {
      background: #198754;
      color: #fff;
    }
    .fe-form {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-top: 12px;
      border-top: 1px dashed #e3eaef;
      padding-top: 12px;
    }
    .quebra-prev {
      display: inline-flex;
      align-items: center;
      font-weight: 800;
      font-size: 1rem;
      padding: 8px 14px;
      border-radius: 7px;
      background: #f4f8fa;
      font-variant-numeric: tabular-nums;
    }
    .tab-wrap {
      overflow-x: auto;
    }
    .tab-wrap.linhas {
      max-height: 300px;
      overflow-y: auto;
    }
    .tab {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .tab thead th {
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 9px 12px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .tab tbody td {
      padding: 8px 12px;
      border-bottom: 1px solid #eef2f5;
      color: #33424c;
      font-variant-numeric: tabular-nums;
    }
    .tab .tr {
      text-align: right;
    }
    .tag {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 20px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .tag.san {
      background: #fdeaea;
      color: #dc3545;
    }
    .tag.sup {
      background: #e6f4ec;
      color: #198754;
    }
    .tag.ab {
      background: #e6f4ec;
      color: #198754;
    }
    .tag.fe {
      background: #eef2f5;
      color: #5d6d7e;
    }
    .vazio {
      color: #8a99a4;
      font-size: 0.85rem;
      text-align: center;
      padding: 20px 0;
      margin: 0;
    }
    .skel {
      border-radius: 8px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: sk 1.2s infinite;
    }
    .sk-bloco {
      height: 300px;
      margin-bottom: 14px;
    }
    @keyframes sk {
      to {
        background-position: -200% 0;
      }
    }
  `,
})
export class FinCaixaComponent extends FinCaixaStore {}
