import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { PagamentosApi } from '@core/api/pagamentos.api';
import { num } from '@core/utils/num';
import { BaixaView, ContaFinanceira, LancamentoView, PlanoConta, StatusLancamento, TipoLancamento } from '@core/models/financeiro.models';
import { FormaPagamento } from '@core/models/pagamentos.models';
import { Notify } from '@core/services/notify.service';
import { FinNavComponent } from './fin-nav.component';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

const STATUS: Record<StatusLancamento, { rotulo: string; cls: string }> = {
  aberto: { rotulo: 'Em aberto', cls: 'st-aberto' },
  parcial: { rotulo: 'Parcial', cls: 'st-parcial' },
  liquidado: { rotulo: 'Liquidado', cls: 'st-liquidado' },
  cancelado: { rotulo: 'Cancelado', cls: 'st-cancelado' },
};

type Aba = 'receber' | 'pagar';

function hojeIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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
            <input class="inp" formControlName="nome" placeholder="Nome da conta *" aria-label="Nome da conta" />
            <select class="inp" formControlName="tipo" aria-label="Tipo da conta">
              <option value="banco">Banco</option>
              <option value="caixa">Caixa físico</option>
              <option value="aplicacao">Aplicação</option>
            </select>
            <input class="inp" formControlName="banco" placeholder="Banco" aria-label="Banco" />
            <input class="inp" formControlName="agencia" placeholder="Agência" aria-label="Agência" />
            <input class="inp" formControlName="conta" placeholder="Conta" aria-label="Conta" />
            <input class="inp" formControlName="saldo_inicial" type="number" step="0.01" min="0" placeholder="Saldo inicial" aria-label="Saldo inicial" />
            <button class="btn-prim" type="submit" [disabled]="cfForm.invalid">Salvar</button>
          </form>
        }
        <div class="cf-lista">
          @for (c of contas(); track c.id) {
            <div class="cf-chip" [class.inativa]="!c.ativo">
              <mat-icon>{{ iconeConta(c.tipo) }}</mat-icon>
              <span class="cf-nome">{{ c.nome }}</span>
              <span class="cf-saldo">{{ fmt(saldos()[c.id] ?? c.saldo_inicial) }}</span>
              @if (!c.ativo) { <span class="cf-tag">inativa</span> }
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
            <button type="button" class="btn-ghost" (click)="toggleForm()" aria-label="Fechar formulário">
              <mat-icon>close</mat-icon>
            </button>
          </header>
          <form class="l-form" [formGroup]="form" (ngSubmit)="salvar()">
            <div class="seg" role="group" aria-label="Tipo do lançamento">
              <button type="button" class="seg-btn rec" [class.ativo]="form.controls.tipo.value === 'receber'" [attr.aria-pressed]="form.controls.tipo.value === 'receber'" (click)="form.controls.tipo.setValue('receber')">
                <mat-icon>arrow_downward</mat-icon> A receber
              </button>
              <button type="button" class="seg-btn pag" [class.ativo]="form.controls.tipo.value === 'pagar'" [attr.aria-pressed]="form.controls.tipo.value === 'pagar'" (click)="form.controls.tipo.setValue('pagar')">
                <mat-icon>arrow_upward</mat-icon> A pagar
              </button>
            </div>
            <label class="lbl l-half">Descrição *
              <input class="inp" formControlName="descricao" placeholder="Ex.: Diárias da reserva" required />
            </label>
            <label class="lbl l-half">Favorecido / fornecedor
              <input class="inp" formControlName="favorecido" placeholder="Nome da pessoa ou empresa" />
            </label>
            <label class="lbl">Valor (R$) *
              <input class="inp" formControlName="valor" type="number" step="0.01" min="0.01" placeholder="0,00" required />
            </label>
            <label class="lbl">Vencimento *
              <app-date formControlName="vencimento" rotulo="Vencimento" />
            </label>
            <label class="lbl">Parcelas
              <input class="inp" formControlName="parcelas" type="number" min="1" max="60" aria-label="Parcelas mensais" />
            </label>
            <label class="lbl l-half">Plano de contas
              <select class="inp" formControlName="idplano_conta">
                <option [ngValue]="null">Sem classificação</option>
                @for (p of planoFiltrado(); track p.id) {
                  <option [ngValue]="p.id">{{ p.codigo }} — {{ p.nome }}</option>
                }
              </select>
            </label>
            <label class="lbl l-half">Conta financeira
              <select class="inp" formControlName="idconta_financeira">
                <option [ngValue]="null">Sem conta</option>
                @for (c of contas(); track c.id) {
                  @if (c.ativo) { <option [ngValue]="c.id">{{ c.nome }}</option> }
                }
              </select>
            </label>
            <label class="lbl l-full">Observação
              <input class="inp" formControlName="observacao" placeholder="Informações adicionais (opcional)" />
            </label>
            <div class="l-acoes">
              <span class="l-hint">* Campos obrigatórios</span>
              <button class="btn-ghost" type="button" (click)="toggleForm()" [disabled]="salvando()">Cancelar</button>
              <button class="btn-prim" type="submit" [disabled]="form.invalid || salvando()">
                {{ salvando() ? 'Salvando…' : 'Salvar lançamento' }}
              </button>
            </div>
          </form>
        </section>
      }

      <!-- filtros -->
      <div class="fin-abas" role="group" aria-label="Tipo">
        <button type="button" class="aba rec" [class.ativo]="aba() === 'receber'" (click)="mudarAba('receber')">
          <mat-icon>arrow_downward</mat-icon> A receber
        </button>
        <button type="button" class="aba pag" [class.ativo]="aba() === 'pagar'" (click)="mudarAba('pagar')">
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
          <input class="inp" [formControl]="buscaCtrl" placeholder="Buscar…" aria-label="Buscar lançamentos" />
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
                      @if (l.idreserva) { <span class="td-mini">Reserva Nº{{ l.idreserva }}</span> }
                    </td>
                    <td>{{ l.favorecido ?? l.cliente_nome ?? '—' }}</td>
                    <td><span class="chip-conta">{{ l.plano_conta ?? '—' }}</span></td>
                    <td [class.td-venc]="l.vencido">
                      {{ l.vencimento | date: 'dd/MM/yy' }}
                      @if (l.vencido) { <mat-icon class="ic-alerta" aria-label="Vencido">warning</mat-icon> }
                    </td>
                    <td class="tr td-valor">{{ fmt(l.valor) }}</td>
                    <td class="tr td-valor">{{ fmt(l.saldo) }}</td>
                    <td class="tc">
                      <span class="st" [class]="'st ' + STATUS[l.status].cls">{{ STATUS[l.status].rotulo }}</span>
                    </td>
                    <td class="tc td-acoes">
                      @if (l.status === 'aberto' || l.status === 'parcial') {
                        <button type="button" class="badge-acao bg-green" title="Dar baixa" (click)="abrirBaixa(l)">
                          <mat-icon>payments</mat-icon>
                        </button>
                        <button type="button" class="badge-acao bg-red" title="Cancelar" (click)="cancelar(l)">
                          <mat-icon>block</mat-icon>
                        </button>
                      }
                      <button type="button" class="badge-acao bg-blue1" title="Ver baixas" (click)="toggleBaixas(l.id)">
                        <mat-icon>list</mat-icon>
                      </button>
                    </td>
                  </tr>
                  @if (baixaAberta() === l.id) {
                    <tr class="tr-baixa">
                      <td colspan="8">
                        <form class="bx-form" [formGroup]="baixaForm" (ngSubmit)="confirmarBaixa(l)">
                          <strong>Baixa de {{ fmt(l.saldo) }}</strong>
                          <select class="inp" formControlName="idconta_financeira" aria-label="Conta de destino">
                            @for (c of contas(); track c.id) {
                              @if (c.ativo) { <option [ngValue]="c.id">{{ c.nome }}</option> }
                            }
                          </select>
                          <input class="inp" formControlName="valor" type="number" step="0.01" min="0.01" [max]="num(l.saldo)" aria-label="Valor da baixa" />
                          <app-date class="inp-date" formControlName="data" rotulo="Data da baixa" />
                          <select class="inp" formControlName="idforma_pagamento" aria-label="Forma de pagamento">
                            <option [ngValue]="null">Pagamento…</option>
                            @for (f of pagamentos(); track f.id) {
                              <option [ngValue]="f.id">{{ f.nome }}</option>
                            }
                          </select>
                          <input class="inp" formControlName="observacao" placeholder="Observação" aria-label="Observação" />
                          <button class="btn-prim" type="submit" [disabled]="baixaForm.invalid">
                            Confirmar
                          </button>
                          <button class="btn-ghost" type="button" (click)="fecharBaixa()">Fechar</button>
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
                              <tr><th>Data</th><th>Conta</th><th>Pagamento</th><th>Por</th><th class="tr">Valor</th></tr>
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
                  <tr><td colspan="8" class="vazio">Nenhum lançamento encontrado.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <footer class="pag">
            <button type="button" class="btn-ghost" [disabled]="page() <= 1" (click)="pagina(page() - 1)">
              <mat-icon>chevron_left</mat-icon> Anterior
            </button>
            <span>{{ page() }} / {{ totalPaginas() }} — {{ total() }} títulos</span>
            <button type="button" class="btn-ghost" [disabled]="page() >= totalPaginas()" (click)="pagina(page() + 1)">
              Próxima <mat-icon>chevron_right</mat-icon>
            </button>
          </footer>
        }
      </section>
    </div>
  `,
  styles: `
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e9ecf0; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#20242c; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#66707e; }
    .card { background:#fff; border:1px solid #e9ecf0; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .card-head h3 { margin:0; font-size:.95rem; font-weight:700; color:#20242c; display:inline-flex; align-items:center; gap:7px; }
    .card-head h3 mat-icon { font-size:18px; width:18px; height:18px; }
    .btn-prim { display:inline-flex; align-items:center; gap:6px; background:#20242c; color:#fff; border:none; border-radius:7px; padding:0 16px; min-height:36px; font-weight:600; font-size:.85rem; cursor:pointer; font-family:inherit; }
    .btn-prim:hover:not(:disabled) { background:#1d4789; }
    .btn-prim:disabled { opacity:.55; cursor:default; }
    .btn-ghost { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid #dde2e8; color:#55606d; border-radius:7px; padding:0 12px; min-height:32px; font-weight:600; font-size:.8rem; cursor:pointer; font-family:inherit; }
    .btn-ghost:hover:not(:disabled) { border-color:#2457a7; color:#2457a7; }
    .btn-ghost:disabled { opacity:.45; cursor:default; }
    .inp { border:1px solid #dde2e8; border-radius:7px; padding:8px 11px; font-size:.85rem; font-family:inherit; color:#3d4552; background:#fff; min-width:0; }
    .inp:focus { outline:2px solid #2457a733; border-color:#2457a7; }
    .lbl { display:flex; flex-direction:column; gap:3px; font-size:.72rem; font-weight:600; color:#66707e; }
    .cf-form { display:flex; gap:8px; flex-wrap:wrap; padding:10px 0; border-bottom:1px dashed #e9ecf0; margin-bottom:10px; }
    .cf-form .inp { flex:1 1 130px; }
    .cf-lista { display:flex; gap:10px; flex-wrap:wrap; }
    .cf-chip { display:inline-flex; align-items:center; gap:8px; border:1px solid #e9ecf0; border-radius:8px; padding:8px 14px; background:#f8f9fb; }
    .cf-chip.inativa { opacity:.55; }
    .cf-chip mat-icon { font-size:18px; width:18px; height:18px; color:#2457a7; }
    .cf-nome { font-weight:600; font-size:.85rem; color:#3d4552; }
    .cf-saldo { font-weight:800; font-size:.88rem; color:#20242c; font-variant-numeric:tabular-nums; }
    .cf-tag { font-size:.68rem; text-transform:uppercase; color:#a5b6bf; font-weight:700; }
    .form-card { container-type:inline-size; }
    .l-form { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:16px; }
    .l-form .lbl { grid-column:span 2; min-width:0; gap:6px; font-size:.8rem; color:#3d4552; }
    .l-form .l-half { grid-column:span 3; }
    .l-form .l-full, .l-form .seg, .l-acoes { grid-column:1 / -1; }
    .l-form .inp { box-sizing:border-box; width:100%; height:42px; flex:none; }
    .l-form .inp::placeholder { color:#66707e; opacity:1; }
    .l-form :is(input,select,button):focus-visible { outline:2px solid #2457a7; outline-offset:2px; }
    .l-acoes { display:flex; align-items:center; justify-content:flex-end; gap:10px; border-top:1px solid #e9ecf0; padding-top:16px; }
    .l-acoes button { min-height:42px; justify-content:center; }
    .l-hint { margin-right:auto; color:#55606d; font-size:.78rem; }
    .seg { display:flex; flex-wrap:wrap; gap:6px; }
    .l-form .seg-btn { min-height:42px; }
    .l-form .seg-btn.rec.ativo { color:#198754; }
    .l-form .seg-btn.pag.ativo { color:#b02a37; }
    @container (max-width:520px) {
      .l-form { grid-template-columns:minmax(0,1fr); }
      .l-form .lbl { grid-column:1 / -1; }
      .l-acoes { flex-wrap:wrap; }
      .l-hint { flex-basis:100%; }
      .l-acoes button { flex:1; }
    }
    .seg-btn { display:inline-flex; align-items:center; gap:6px; border:1.5px solid #dde2e8; background:#fff; border-radius:999px; padding:7px 18px; font-weight:600; font-size:.82rem; cursor:pointer; font-family:inherit; color:#55606d; }
    .seg-btn.rec.ativo { border-color:#198754; color:#198754; background:#e6f3ec; }
    .seg-btn.pag.ativo { border-color:#dc3545; color:#dc3545; background:#fbebec; }
    .fin-abas { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
    .aba { display:inline-flex; align-items:center; gap:7px; border:1px solid #dde2e8; background:#fff; border-radius:9px; padding:9px 16px; font-weight:600; font-size:.85rem; cursor:pointer; font-family:inherit; color:#55606d; }
    .aba mat-icon { font-size:17px; width:17px; height:17px; }
    .aba.rec.ativo { border-color:#198754; color:#198754; }
    .aba.pag.ativo { border-color:#dc3545; color:#dc3545; }
    .aba-total { font-variant-numeric:tabular-nums; font-weight:800; }
    .filtros { margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .filtros .inp { padding:7px 10px; font-size:.82rem; }
    .chk { display:inline-flex; align-items:center; gap:6px; font-size:.82rem; color:#55606d; font-weight:600; white-space:nowrap; }
    .tab-wrap { overflow-x:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.9rem; }
    .tab thead th { background:#f5f7fa; color:#3d4552; font-size:.73rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:11px 14px; text-align:left; border-bottom:2px solid #e9ecf0; white-space:nowrap; }
    .tab tbody td { padding:11px 14px; border-bottom:1px solid #f0f2f5; vertical-align:middle; color:#3d4552; }
    .tab .tc { text-align:center; } .tab .tr { text-align:right; }
    .td-desc { font-weight:600; color:#20242c; }
    .td-mini { font-size:.72rem; color:#66707e; }
    .td-valor { font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .td-venc { color:#dc3545; font-weight:700; white-space:nowrap; }
    .linha-vencida { background:#fdf1f2; }
    .ic-alerta { font-size:15px; width:15px; height:15px; vertical-align:-3px; color:#dc3545; }
    .chip-conta { font-size:.78rem; color:#55606d; background:#f0f2f5; border-radius:5px; padding:3px 8px; white-space:nowrap; }
    .st { display:inline-block; font-size:.72rem; font-weight:700; border-radius:999px; padding:3px 11px; white-space:nowrap; }
    .st-aberto { background:#f7ead2; color:#8a6116; }
    .st-parcial { background:#dbe9f5; color:#2457a7; }
    .st-liquidado { background:#e6f3ec; color:#198754; }
    .st-cancelado { background:#eee; color:#66707e; text-decoration:line-through; }
    .td-acoes { white-space:nowrap; }
    .badge-acao { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:7px; cursor:pointer; color:#fff; margin:0 2px; }
    .badge-acao mat-icon { font-size:16px; width:16px; height:16px; }
    .bg-green { background:#198754; } .bg-red { background:#dc3545; } .bg-blue1 { background:#2457a7; }
    .tr-baixa td, .tr-baixas td { background:#f8f9fb; padding:14px 18px; }
    .bx-form { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .bx-form strong { color:#20242c; font-size:.85rem; }
    .bx-form .inp { flex:0 1 auto; }
    .tab-mini { font-size:.84rem; }
    .tab-mini thead th { padding:8px 12px; }
    .tab-mini tbody td { padding:8px 12px; }
    .pag { display:flex; align-items:center; justify-content:center; gap:14px; padding-top:12px; font-size:.82rem; color:#66707e; }
    .vazio { color:#66707e; font-size:.85rem; text-align:center; padding:22px 0; margin:0; }
    .skel { border-radius:8px; background:linear-gradient(90deg,#f0f2f5 25%,#f8f9fb 50%,#f0f2f5 75%); background-size:200% 100%; animation:sk 1.2s infinite; }
    .sk-tab { height:320px; }
    @keyframes sk { to { background-position:-200% 0; } }
  `,
})
export class FinContasComponent implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly pagamentosApi = inject(PagamentosApi);
  private readonly notify = inject(Notify);

  readonly STATUS = STATUS;
  readonly fmt = fmt;
  readonly num = num;

  readonly aba = signal<Aba>('receber');
  readonly itens = signal<LancamentoView[]>([]);
  readonly contas = signal<ContaFinanceira[]>([]);
  readonly saldos = signal<Record<number, number>>({});
  readonly plano = signal<PlanoConta[]>([]);
  readonly pagamentos = signal<FormaPagamento[]>([]);
  readonly carregando = signal(true);
  readonly salvando = signal(false);
  readonly formAberto = signal(false);
  readonly cfFormAberto = signal(false);
  readonly baixaAberta = signal<number | null>(null);
  readonly baixasAbertas = signal<number | null>(null);
  readonly baixas = signal<BaixaView[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 20)));

  readonly planoFiltrado = computed(() =>
    this.plano().filter((p) => p.tipo === this.form.controls.tipo.value),
  );

  readonly statusCtrl = new FormControl<string>('', { nonNullable: true });
  readonly vencidosCtrl = new FormControl<boolean>(false, { nonNullable: true });
  readonly buscaCtrl = new FormControl<string>('', { nonNullable: true });

  readonly form = new FormGroup({
    tipo: new FormControl<TipoLancamento>('receber', { nonNullable: true }),
    descricao: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    favorecido: new FormControl('', { nonNullable: true }),
    valor: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0.01)] }),
    vencimento: new FormControl(hojeIso(), { nonNullable: true, validators: [Validators.required] }),
    parcelas: new FormControl<number>(1, { nonNullable: true }),
    idplano_conta: new FormControl<number | null>(null),
    idconta_financeira: new FormControl<number | null>(null),
    observacao: new FormControl('', { nonNullable: true }),
  });

  readonly cfForm = new FormGroup({
    nome: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tipo: new FormControl<'banco' | 'caixa' | 'aplicacao'>('banco', { nonNullable: true }),
    banco: new FormControl('', { nonNullable: true }),
    agencia: new FormControl('', { nonNullable: true }),
    conta: new FormControl('', { nonNullable: true }),
    saldo_inicial: new FormControl<number | null>(0),
  });

  readonly baixaForm = new FormGroup({
    idconta_financeira: new FormControl<number | null>(null, { validators: [Validators.required] }),
    valor: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0.01)] }),
    data: new FormControl(hojeIso(), { nonNullable: true }),
    idforma_pagamento: new FormControl<number | null>(null),
    observacao: new FormControl('', { nonNullable: true }),
  });

  private buscaTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.recarregarAuxiliares();
    this.carregar();
    this.statusCtrl.valueChanges.subscribe(() => this.pagina(1));
    this.vencidosCtrl.valueChanges.subscribe(() => this.pagina(1));
    this.buscaCtrl.valueChanges.subscribe(() => {
      if (this.buscaTimer) clearTimeout(this.buscaTimer);
      this.buscaTimer = setTimeout(() => this.pagina(1), 350);
    });
  }

  private recarregarAuxiliares(): void {
    this.financeiroApi.listarContasFinanceiras(true).subscribe({
      next: (cs) => {
        this.contas.set(cs);
        for (const c of cs) {
          this.financeiroApi.saldoConta(c.id).subscribe({
            next: (r) => this.saldos.update((s) => ({ ...s, [c.id]: num(r.saldo) })),
            error: () => undefined,
          });
        }
      },
      error: (e) => this.notify.erro(e),
    });
    this.financeiroApi.listarPlanoContas(false).subscribe({
      next: (p) => this.plano.set(p),
      error: () => undefined,
    });
    this.pagamentosApi.listarPagamentos().subscribe({
      next: (p) => this.pagamentos.set(p),
      error: () => undefined,
    });
  }

  carregar(): void {
    this.carregando.set(true);
    this.financeiroApi.listarLancamentos({
        tipo: this.aba(),
        status: (this.statusCtrl.value || null) as StatusLancamento | null,
        vencidos: this.vencidosCtrl.value,
        busca: this.buscaCtrl.value || null,
        page: this.page(),
      })
      .subscribe({
        next: (p) => {
          this.itens.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  mudarAba(a: Aba): void {
    this.aba.set(a);
    this.pagina(1);
  }

  pagina(p: number): void {
    this.page.set(p);
    this.fecharBaixa();
    this.baixasAbertas.set(null);
    this.carregar();
  }

  toggleForm(): void {
    this.formAberto.update((v) => !v);
  }
  toggleCfForm(): void {
    this.cfFormAberto.update((v) => !v);
  }

  salvar(): void {
    if (this.form.invalid) return;
    this.salvando.set(true);
    const v = this.form.getRawValue();
    this.financeiroApi.criarLancamento({
        tipo: v.tipo,
        descricao: v.descricao.trim(),
        favorecido: v.favorecido.trim() || null,
        valor: Number(v.valor),
        vencimento: v.vencimento,
        parcelas: v.parcelas > 1 ? v.parcelas : null,
        idplano_conta: v.idplano_conta,
        idconta_financeira: v.idconta_financeira,
        observacao: v.observacao.trim() || null,
      })
      .subscribe({
        next: (criados) => {
          this.salvando.set(false);
          this.notify.ok(
            criados.length > 1
              ? `${criados.length} parcelas criadas.`
              : 'Lançamento criado.',
          );
          this.form.reset({
            tipo: v.tipo,
            descricao: '',
            favorecido: '',
            valor: null,
            vencimento: hojeIso(),
            parcelas: 1,
            idplano_conta: null,
            idconta_financeira: null,
            observacao: '',
          });
          this.formAberto.set(false);
          this.carregar();
        },
        error: (e) => {
          this.salvando.set(false);
          this.notify.erro(e);
        },
      });
  }

  salvarConta(): void {
    if (this.cfForm.invalid) return;
    const v = this.cfForm.getRawValue();
    this.financeiroApi.criarContaFinanceira({
        nome: v.nome.trim(),
        tipo: v.tipo,
        banco: v.banco.trim() || null,
        agencia: v.agencia.trim() || null,
        conta: v.conta.trim() || null,
        saldo_inicial: v.saldo_inicial ?? 0,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Conta criada.');
          this.cfForm.reset({ nome: '', tipo: 'banco', banco: '', agencia: '', conta: '', saldo_inicial: 0 });
          this.cfFormAberto.set(false);
          this.recarregarAuxiliares();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  abrirBaixa(l: LancamentoView): void {
    this.baixasAbertas.set(null);
    this.baixaAberta.set(l.id);
    this.baixaForm.patchValue({ valor: num(l.saldo), data: hojeIso() });
    const conta = this.contas().find((c) => c.ativo && c.tipo === 'banco')
      ?? this.contas().find((c) => c.ativo);
    this.baixaForm.patchValue({ idconta_financeira: conta?.id ?? null });
  }

  fecharBaixa(): void {
    this.baixaAberta.set(null);
  }

  confirmarBaixa(l: LancamentoView): void {
    if (this.baixaForm.invalid) return;
    const v = this.baixaForm.getRawValue();
    this.financeiroApi.baixarLancamento(l.id, {
        idconta_financeira: Number(v.idconta_financeira),
        valor: Number(v.valor),
        data: v.data || null,
        idforma_pagamento: v.idforma_pagamento,
        observacao: v.observacao.trim() || null,
      })
      .subscribe({
        next: (r) => {
          this.notify.ok(
            r.lancamento.status === 'liquidado' ? 'Título liquidado.' : 'Baixa parcial registrada.',
          );
          this.fecharBaixa();
          this.carregar();
          this.recarregarAuxiliares();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  cancelar(l: LancamentoView): void {
    if (!confirm(`Cancelar "${l.descricao}"? As baixas serão desconsideradas.`)) return;
    this.financeiroApi.cancelarLancamento(l.id).subscribe({
      next: () => {
        this.notify.ok('Lançamento cancelado.');
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  toggleBaixas(id: number): void {
    if (this.baixasAbertas() === id) {
      this.baixasAbertas.set(null);
      return;
    }
    this.baixasAbertas.set(id);
    this.financeiroApi.listarBaixas(id).subscribe({
      next: (b) => this.baixas.set(b),
      error: (e) => this.notify.erro(e),
    });
  }

  iconeConta(tipo: string): string {
    return tipo === 'banco' ? 'account_balance' : tipo === 'caixa' ? 'point_of_sale' : 'savings';
  }
}
