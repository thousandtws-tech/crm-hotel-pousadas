import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CaixaApi } from '@core/api/caixa.api';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num';
import { ConferenciaCaixa, PendenciaReserva, PendenciasFechamento, TipoMovimentoCaixa, TurnoView } from '@core/models/caixa.models';
import { ContaFinanceira } from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';
import { FinNavComponent } from './fin-nav.component';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

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
            @for (s of [1,2,3]; track s) {
              <span class="fch-step" [class.ativa]="passo() === s">{{ s }}</span>
            }
          </div>
        </header>

        @if (passo() === 1) {
          <h4 class="fch-t">Pendências do dia</h4>
          @if (fch(); as f) {
            <p class="fch-linha">Contas abertas: <b>{{ f.contas_abertas }}</b> · total R$ {{ f.contas_total | number:'1.2-2' }}</p>
            @if (f.checkouts_pendentes.length) {
              <p class="fch-sub">Check-outs pendentes</p>
              @for (c of f.checkouts_pendentes; track c.id) {
                <div class="fch-item">
                  <span>{{ c.acomodacao_nome }} · {{ c.cliente_nome }} · saída {{ c.saidaprevista | date:'dd/MM' }}</span>
                  <a class="fch-link" [routerLink]="['/reservas', c.id]">abrir</a>
                </div>
              }
            }
            @if (f.no_shows.length) {
              <p class="fch-sub">Possíveis no-shows — decisão requer PIN</p>
              @for (n of f.no_shows; track n.id) {
                <div class="fch-item ns">
                  <span>{{ n.acomodacao_nome }} · {{ n.cliente_nome }} · entrada {{ n.entradaprevista | date:'dd/MM' }} ({{ n.dias_atraso }}d atraso)</span>
                  <button class="fch-ns" type="button" (click)="pinAlvo.set(n)">No-show</button>
                </div>
              }
            } @else {
              <p class="fch-linha muted">Nenhum no-show pendente.</p>
            }
          } @else {
            <p class="fch-linha muted">Carregando…</p>
          }
          <div class="fch-nav"><button class="btn-prim" type="button" (click)="passo.set(2)">Avançar</button></div>
        }

        @if (passo() === 2) {
          <h4 class="fch-t">Caixa</h4>
          <p class="fch-linha">Confira a conferência do turno abaixo na tela (esperado × contado por gaveta) antes de confirmar.</p>
          <div class="fch-nav">
            <button class="btn-ghost" type="button" (click)="passo.set(1)">Voltar</button>
            <button class="btn-prim" type="button" (click)="passo.set(3)">Avançar</button>
          </div>
        }

        @if (passo() === 3) {
          <h4 class="fch-t">Confirmação do dia</h4>
          @if (fch(); as f) {
            <p class="fch-linha">
              {{ f.contas_abertas }} conta(s) aberta(s) · {{ f.checkouts_pendentes.length }} check-out(s) pendente(s) · {{ f.no_shows.length }} no-show(s)
            </p>
          }
          <p class="fch-linha muted">O relatório determinístico será enviado ao e-mail da pousada.</p>
          <div class="fch-nav">
            <button class="btn-ghost" type="button" (click)="passo.set(1)">Voltar</button>
            <button class="btn-prim" type="button" [disabled]="enviandoRel()" (click)="enviarRelatorio()">
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
            <label class="lbl">PIN <input class="inp" type="password" inputmode="numeric" [value]="pinVal" (input)="pinVal=$any($event.target).value" /></label>
            <div class="fch-nav">
              <button class="btn-ghost" type="button" (click)="pinAlvo.set(null)">Cancelar</button>
              <button class="btn-prim" type="button" (click)="confirmarNoShow(alvo)">Autorizar</button>
            </div>
          </div>
        </div>
      }

      @if (!gavetaSel()) {
        <section class="card"><p class="vazio">Nenhuma conta do tipo “Caixa físico” — crie em Contas financeiras.</p></section>
      } @else {

        <!-- ======================= estado do turno ======================= -->
        @if (carregando()) {
          <div class="skel sk-bloco"></div>
        } @else if (!turno()) {

          <!-- não há turno aberto -->
          <section class="card">
            <header class="card-head"><h3><mat-icon>lock_open</mat-icon> Abertura de turno</h3></header>
            <form class="ab-form" [formGroup]="abrirForm" (ngSubmit)="abrir()">
              <label class="lbl">Fundo de troco *
                <input class="inp" formControlName="saldo_inicial" type="number" step="0.01" min="0" aria-label="Fundo de troco" />
              </label>
              <label class="lbl grow">Observação
                <input class="inp" formControlName="observacao" aria-label="Observação de abertura" />
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
              <div class="kpi-item"><span class="kpi-num">{{ fmt(c.fundo) }}</span>
                <span class="kpi-lbl"><mat-icon>savings</mat-icon> Fundo</span></div>
              <div class="kpi-item"><span class="kpi-num pos">{{ fmt(c.suprimentos) }}</span>
                <span class="kpi-lbl"><mat-icon>add_circle</mat-icon> Suprimentos</span></div>
              <div class="kpi-item"><span class="kpi-num neg">{{ fmt(c.sangrias) }}</span>
                <span class="kpi-lbl"><mat-icon>remove_circle</mat-icon> Sangrias</span></div>
              <div class="kpi-item"><span class="kpi-num pos">{{ fmt(c.recebimentos) }}</span>
                <span class="kpi-lbl"><mat-icon>payments</mat-icon> Recebimentos</span></div>
              <div class="kpi-item"><span class="kpi-num neg">{{ fmt(c.pagamentos) }}</span>
                <span class="kpi-lbl"><mat-icon>money_off</mat-icon> Pagamentos</span></div>
              <div class="kpi-item"><span class="kpi-num pos">{{ fmt(c.especie) }}</span>
                <span class="kpi-lbl"><mat-icon>point_of_sale</mat-icon> Espécie (checkout)</span></div>
              <div class="kpi-item esperado"><span class="kpi-num">{{ fmt(c.esperado) }}</span>
                <span class="kpi-lbl"><mat-icon>calculate</mat-icon> Esperado em gaveta</span></div>
            </div>
            <p class="turno-meta">
              <mat-icon>person</mat-icon> {{ c.turno.operador }}
              · aberto {{ c.turno.aberto_em | date: 'dd/MM HH:mm' }}
              · {{ c.turno.conta_financeira }}
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
                  <button type="button" class="seg-btn san" [class.ativo]="movForm.controls.tipo.value === 'sangria'" (click)="movForm.controls.tipo.setValue('sangria')">
                    <mat-icon>remove_circle</mat-icon> Sangria
                  </button>
                  <button type="button" class="seg-btn sup" [class.ativo]="movForm.controls.tipo.value === 'suprimento'" (click)="movForm.controls.tipo.setValue('suprimento')">
                    <mat-icon>add_circle</mat-icon> Suprimento
                  </button>
                </div>
                <input class="inp val" formControlName="valor" type="number" step="0.01" min="0.01" placeholder="Valor *" aria-label="Valor" />
                <input class="inp grow" formControlName="motivo" placeholder="Motivo *" aria-label="Motivo" />
                <button class="btn-prim" type="submit" [disabled]="movForm.invalid">
                  <mat-icon>send</mat-icon>
                </button>
              </form>
              <div class="tab-wrap">
                <table class="tab">
                  <thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th>Por</th><th class="tr">Valor</th></tr></thead>
                  <tbody>
                    @for (m of c.movimentos; track m.id) {
                      <tr>
                        <td>{{ m.criado_em | date: 'dd/MM HH:mm' }}</td>
                        <td><span class="tag" [class.san]="m.tipo === 'sangria'" [class.sup]="m.tipo === 'suprimento'">{{ m.tipo }}</span></td>
                        <td>{{ m.motivo }}</td>
                        <td>{{ m.funcionario }}</td>
                        <td class="tr" [class.pos]="m.tipo === 'suprimento'" [class.neg]="m.tipo === 'sangria'">{{ fmt(m.valor) }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="5" class="vazio">Nenhum movimento ainda.</td></tr>
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
                  <thead><tr><th>Quando</th><th>Evento</th><th class="tr">Valor</th></tr></thead>
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
                      <tr><td colspan="3" class="vazio">Nenhum recebimento/pagamento no período.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
              <form class="fe-form" [formGroup]="feForm" (ngSubmit)="fechar()">
                <label class="lbl">Dinheiro contado na gaveta *
                  <input class="inp" formControlName="valor_contado" type="number" step="0.01" min="0" aria-label="Valor contado" />
                </label>
                <label class="lbl grow">Observação
                  <input class="inp" formControlName="observacao" aria-label="Observação do fechamento" />
                </label>
                @if (prevQuebra() !== null) {
                  <span class="quebra-prev" [class.neg]="prevQuebra()! < 0" [class.pos]="prevQuebra()! > 0">
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
              <tr><th>Abertura</th><th>Fechamento</th><th>Operador</th><th>Gaveta</th>
                  <th class="tr">Fundo</th><th class="tr">Esperado</th><th class="tr">Contado</th>
                  <th class="tr">Quebra</th><th>Status</th></tr>
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
                  <td><span class="tag" [class.ab]="t.status === 'aberto'" [class.fe]="t.status === 'fechado'">{{ t.status }}</span></td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="vazio">Nenhum turno registrado.</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (historico().total > historico().items.length) {
          <button class="btn-ghost" (click)="maisHistorico()"><mat-icon>expand_more</mat-icon> Carregar mais</button>
        }
      </section>
    </div>
  `,
  styles: `
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e9ecf0; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#20242c; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#66707e; }
    .gaveta { min-width:220px; }
    .lbl { display:flex; flex-direction:column; gap:4px; font-size:.72rem; font-weight:600; color:#55606d; }
    .lbl.grow, .inp.grow { flex:1; }
    .inp { border:1px solid #dde2e8; border-radius:7px; padding:8px 11px; font-size:.86rem; color:#3d4552; background:#fff; }
    .inp:focus-visible { outline:2px solid #2457a7; outline-offset:1px; }
    .btn-prim { display:inline-flex; align-items:center; gap:7px; background:#20242c; color:#fff; border:none; border-radius:7px; padding:9px 16px; font-size:.85rem; font-weight:600; cursor:pointer; }
    .btn-prim:disabled { opacity:.5; cursor:not-allowed; }
    .btn-ghost { display:inline-flex; align-items:center; gap:6px; background:transparent; color:#20242c; border:1px solid #cbd2dc; border-radius:7px; padding:7px 12px; font-size:.8rem; font-weight:600; cursor:pointer; }
    .btn-prim mat-icon, .btn-ghost mat-icon { font-size:17px; width:17px; height:17px; }
    .kpi { display:flex; background:#fff; border:1px solid #e9ecf0; border-radius:10px; overflow-x:auto; }
    .kpi-item { display:flex; flex-direction:column; gap:3px; padding:14px 20px; min-width:140px; border-left:1px solid #f0f2f5; }
    .kpi-item:first-child { border-left:none; }
    .kpi-item.esperado { background:#eef3fb; }
    .kpi-num { font-size:1.3rem; font-weight:800; color:#20242c; line-height:1; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .kpi-num.pos, .pos { color:#198754; } .kpi-num.neg, .neg { color:#dc3545; }
    .kpi-lbl { display:inline-flex; align-items:center; gap:5px; font-size:.66rem; font-weight:600; color:#66707e; text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; }
    .kpi-lbl mat-icon { font-size:14px; width:14px; height:14px; color:#a5b6bf; }
    .turno-info { margin-bottom:14px; }
    .turno-meta { display:flex; align-items:center; gap:5px; margin:8px 2px 0; font-size:.78rem; color:#66707e; }
    .turno-meta mat-icon { font-size:15px; width:15px; height:15px; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:start; }
    @media (max-width:1100px) { .grid-2 { grid-template-columns:1fr; } }
    .card { background:#fff; border:1px solid #e9ecf0; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:10px; }
    .card-head h3 { margin:0; font-size:.95rem; font-weight:700; color:#20242c; display:flex; align-items:center; gap:7px; }
    .card-head h3 mat-icon { font-size:19px; width:19px; height:19px; }
    .card-head small { font-size:.74rem; color:#66707e; }
    .fch { border-left:4px solid #20242c; }
    .fch-steps { display:flex; gap:6px; }
    .fch-step { width:22px; height:22px; border-radius:50%; background:#e9ecf0; color:#66707e; font-size:.75rem; font-weight:700; display:flex; align-items:center; justify-content:center; }
    .fch-step.ativa { background:#20242c; color:#fff; }
    .fch-t { margin:0 0 8px; font-size:.88rem; color:#20242c; }
    .fch-linha { margin:4px 0; font-size:.85rem; }
    .fch-sub { margin:10px 0 4px; font-size:.75rem; font-weight:700; color:#55606d; text-transform:uppercase; }
    .fch-item { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid #f0f2f5; font-size:.83rem; }
    .fch-item.ns { color:#8a6116; }
    .fch-link { color:#2457a7; font-size:.78rem; }
    .fch-ns { background:#8a6116; color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:.75rem; font-weight:600; cursor:pointer; }
    .fch-nav { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
    .muted { color:#66707e; }
    .ovl { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:50; }
    .dlg { background:#fff; border-radius:10px; padding:18px; width:min(360px,90vw); }
    .lbl { display:flex; flex-direction:column; gap:4px; font-size:.8rem; font-weight:600; color:#3d4552; }
    .inp { border:1px solid #dde2e8; border-radius:7px; padding:8px 10px; font-size:.85rem; }
    .ab-form { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
    .ab-form .btn-prim { margin-bottom:1px; }
    .mv-form { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .mv-form .val { width:120px; }
    .seg { display:inline-flex; border:1px solid #dde2e8; border-radius:7px; overflow:hidden; }
    .seg-btn { display:inline-flex; align-items:center; gap:5px; background:#fff; border:none; padding:8px 12px; font-size:.78rem; font-weight:600; color:#66707e; cursor:pointer; }
    .seg-btn mat-icon { font-size:15px; width:15px; height:15px; }
    .seg-btn.san.ativo { background:#dc3545; color:#fff; }
    .seg-btn.sup.ativo { background:#198754; color:#fff; }
    .fe-form { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; margin-top:12px; border-top:1px dashed #e9ecf0; padding-top:12px; }
    .quebra-prev { display:inline-flex; align-items:center; font-weight:800; font-size:1rem; padding:8px 14px; border-radius:7px; background:#f5f7fa; font-variant-numeric:tabular-nums; }
    .tab-wrap { overflow-x:auto; }
    .tab-wrap.linhas { max-height:300px; overflow-y:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.85rem; }
    .tab thead th { background:#f5f7fa; color:#3d4552; font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:9px 12px; text-align:left; border-bottom:2px solid #e9ecf0; white-space:nowrap; }
    .tab tbody td { padding:8px 12px; border-bottom:1px solid #f0f2f5; color:#3d4552; font-variant-numeric:tabular-nums; }
    .tab .tr { text-align:right; }
    .tag { display:inline-block; padding:2px 9px; border-radius:20px; font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .tag.san { background:#fbebec; color:#dc3545; } .tag.sup { background:#e6f3ec; color:#198754; }
    .tag.ab { background:#e6f3ec; color:#198754; } .tag.fe { background:#f0f2f5; color:#55606d; }
    .vazio { color:#66707e; font-size:.85rem; text-align:center; padding:20px 0; margin:0; }
    .skel { border-radius:8px; background:linear-gradient(90deg,#f0f2f5 25%,#f8f9fb 50%,#f0f2f5 75%); background-size:200% 100%; animation:sk 1.2s infinite; }
    .sk-bloco { height:300px; margin-bottom:14px; }
    @keyframes sk { to { background-position:-200% 0; } }
  `,
})
export class FinCaixaComponent implements OnInit {
  private readonly caixaApi = inject(CaixaApi);
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;

  readonly gavetas = signal<ContaFinanceira[]>([]);
  protected readonly fch = signal<PendenciasFechamento | null>(null);
  protected readonly passo = signal(1);
  protected readonly pinAlvo = signal<PendenciaReserva | null>(null);
  protected readonly enviandoRel = signal(false);
  protected pinVal = '';
  readonly gavetaSel = computed(() => Number(this.selGaveta.value) || null);
  readonly turno = signal<TurnoView | null>(null);
  readonly conferencia = signal<ConferenciaCaixa | null>(null);
  readonly carregando = signal(false);
  readonly historico = signal<{ items: TurnoView[]; total: number }>({ items: [], total: 0 });
  private histPagina = 1;

  readonly selGaveta = new FormControl<number | null>(null);

  readonly abrirForm = new FormGroup({
    saldo_inicial: new FormControl<number | null>(0, [Validators.required, Validators.min(0)]),
    observacao: new FormControl<string | null>(null),
  });

  readonly movForm = new FormGroup({
    tipo: new FormControl<TipoMovimentoCaixa>('sangria', { nonNullable: true }),
    valor: new FormControl<number | null>(null, [Validators.required, Validators.min(0.01)]),
    motivo: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly feForm = new FormGroup({
    valor_contado: new FormControl<number | null>(null, [Validators.required, Validators.min(0)]),
    observacao: new FormControl<string | null>(null),
  });

  /** Quebra prevista = contado − esperado, só quando há valor digitado. */
  readonly prevQuebra = computed(() => {
    const c = this.conferencia();
    const v = this.feForm.value.valor_contado;
    if (!c || v === null || v === undefined) return null;
    return v - num(c.esperado);
  });

  ngOnInit(): void {
    this.financeiroApi.listarContasFinanceiras().subscribe({
      next: (contas) => {
        const gs = contas.filter((c) => c.tipo === 'caixa' && c.ativo);
        this.gavetas.set(gs);
        if (gs.length) this.selGaveta.setValue(gs[0].id);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
    this.selGaveta.valueChanges.subscribe(() => this.carregar());
    this.carregarPendencias();
  }

  carregarPendencias(): void {
    this.reservasApi.pendenciasFechamento().subscribe({
      next: (p) => this.fch.set(p),
      error: () => undefined,
    });
  }

  confirmarNoShow(alvo: PendenciaReserva): void {
    if (!this.pinVal.trim()) return;
    this.reservasApi.marcarNoShow(alvo.id, this.pinVal.trim()).subscribe({
      next: () => {
        this.pinAlvo.set(null);
        this.pinVal = '';
        this.notify.ok(`Reserva de ${alvo.cliente_nome} marcada como no-show.`);
        this.carregarPendencias();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  enviarRelatorio(): void {
    this.enviandoRel.set(true);
    this.reservasApi.enviarRelatorioFechamento().subscribe({
      next: () => {
        this.enviandoRel.set(false);
        this.notify.ok('Relatório de fechamento enfileirado para envio.');
        this.passo.set(1);
      },
      error: (e) => {
        this.enviandoRel.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregar(): void {
    const g = this.gavetaSel();
    this.histPagina = 1;
    if (!g) {
      this.turno.set(null);
      this.conferencia.set(null);
      return;
    }
    this.carregando.set(true);
    this.caixaApi.turnoAberto(g).subscribe({
      next: (t) => {
        this.carregando.set(false);
        if (t) this.recarregarTurno(t.id);
        else { this.turno.set(null); this.conferencia.set(null); }
      },
      error: (e) => { this.carregando.set(false); this.notify.erro(e); },
    });
    this.caixaApi.listarTurnos({ idconta_financeira: g, porPagina: 10 }).subscribe({
      next: (p) => this.historico.set({ items: p.items, total: p.total }),
      error: (e) => this.notify.erro(e),
    });
  }

  private recarregarTurno(id: number): void {
    this.caixaApi.conferirTurno(id).subscribe({
      next: (c) => { this.conferencia.set(c); this.turno.set(c.turno); },
      error: (e) => this.notify.erro(e),
    });
  }

  abrir(): void {
    const g = this.gavetaSel();
    const v = this.abrirForm.getRawValue();
    if (!g || v.saldo_inicial === null) return;
    this.caixaApi.abrirTurno({ idconta_financeira: g, saldo_inicial: v.saldo_inicial, observacao: v.observacao })
      .subscribe({
        next: (t) => {
          this.notify.ok('Turno aberto.');
          this.recarregarTurno(t.id);
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  movimentar(): void {
    const t = this.turno();
    const v = this.movForm.getRawValue();
    if (!t || v.valor === null || !v.motivo.trim()) return;
    this.caixaApi.movimentarTurno(t.id, { tipo: v.tipo, valor: v.valor, motivo: v.motivo.trim() })
      .subscribe({
        next: () => {
          this.notify.ok(v.tipo === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
          this.movForm.reset({ tipo: v.tipo, motivo: '' });
          this.recarregarTurno(t.id);
        },
        error: (e) => this.notify.erro(e),
      });
  }

  fechar(): void {
    const t = this.turno();
    const v = this.feForm.getRawValue();
    if (!t || v.valor_contado === null) return;
    this.caixaApi.fecharTurno(t.id, { valor_contado: v.valor_contado, observacao: v.observacao })
      .subscribe({
        next: (t2) => {
          const q = num(t2.quebra);
          if (q < 0) this.notify.aviso(`Turno fechado com QUEBRA de ${fmt(q)}.`);
          else this.notify.ok(`Turno fechado. ${q > 0 ? `Sobra de ${fmt(q)}.` : 'Valores exatos.'}`);
          this.feForm.reset();
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  maisHistorico(): void {
    const g = this.gavetaSel();
    if (!g) return;
    this.histPagina++;
    this.caixaApi.listarTurnos({ idconta_financeira: g, page: this.histPagina, porPagina: 10 })
      .subscribe({
        next: (p) =>
          this.historico.update((h) => ({ items: [...h.items, ...p.items], total: p.total })),
        error: (e) => this.notify.erro(e),
      });
  }
}
