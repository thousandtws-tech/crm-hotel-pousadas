import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiService, num } from '@core/services/api.service';
import {
  ConciliacaoResumo,
  ContaFinanceira,
  ExtratoView,
  PlanoConta,
  StatusExtrato,
  SugestaoConciliacao,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { FinNavComponent } from './fin-nav.component';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

@Component({
  selector: 'app-fin-conciliacao',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Conciliação bancária</h2>
          <p class="fin-sub">Extrato (OFX/CSV) × baixas da tesouraria</p>
        </div>
        <div class="acoes">
          <select class="inp" [formControl]="contaCtrl" aria-label="Conta bancária">
            @for (c of contasBanco(); track c.id) {
              <option [ngValue]="c.id">{{ c.nome }}</option>
            }
          </select>
          <label class="btn-ghost" for="arq-extrato">
            <mat-icon>upload_file</mat-icon> Importar OFX/CSV
          </label>
          <input id="arq-extrato" type="file" class="sr-only" accept=".ofx,.csv,.txt"
                 (change)="importar($event)" aria-label="Arquivo de extrato" />
          <button type="button" class="btn-prim" (click)="autoConciliar()" [disabled]="rodando()">
            <mat-icon>bolt</mat-icon> {{ rodando() ? 'Conciliando…' : 'Conciliar automático' }}
          </button>
        </div>
      </div>

      @if (resumo(); as r) {
        <div class="resumo">
          <button type="button" class="rz pend" [class.ativo]="status() === 'pendente'" (click)="filtroStatus('pendente')">
            <strong>{{ r.pendentes }}</strong><span>pendentes</span>
          </button>
          <button type="button" class="rz conc" [class.ativo]="status() === 'conciliado'" (click)="filtroStatus('conciliado')">
            <strong>{{ r.conciliados }}</strong><span>conciliados</span>
          </button>
          <button type="button" class="rz ign" [class.ativo]="status() === 'ignorado'" (click)="filtroStatus('ignorado')">
            <strong>{{ r.ignorados }}</strong><span>ignorados</span>
          </button>
          <button type="button" class="rz" [class.ativo]="status() === null" (click)="filtroStatus(null)">
            <strong>{{ r.pendentes + r.conciliados + r.ignorados }}</strong><span>todos</span>
          </button>
          @if (r.coberto_ate) {
            <span class="rz-info"><mat-icon>event</mat-icon> Extrato até {{ r.coberto_ate | date: 'dd/MM/yyyy' }}</span>
          }
        </div>
      }

      <section class="card">
        @if (carregando()) {
          <div class="skel sk-tab"></div>
        } @else {
          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th class="tr">Valor</th>
                  <th class="tc">Status</th>
                  <th class="tc">Match</th>
                  <th class="tc">Ações</th>
                </tr>
              </thead>
              <tbody>
                @for (e of itens(); track e.id) {
                  <tr [class.desat]="e.status === 'ignorado'">
                    <td class="nw">{{ e.data | date: 'dd/MM/yy' }}</td>
                    <td>
                      <div class="td-desc">{{ e.descricao }}</div>
                      @if (e.documento) { <span class="td-mini">{{ e.documento }}</span> }
                    </td>
                    <td class="tr td-valor" [class.pos]="num(e.valor) > 0" [class.neg]="num(e.valor) < 0">
                      {{ fmt(e.valor) }}
                    </td>
                    <td class="tc">
                      <span class="st" [class]="'st st-' + e.status">{{ rotulo(e.status) }}</span>
                    </td>
                    <td class="tc">
                      @if (e.melhor_score) {
                        <span class="score" [class.alto]="num(e.melhor_score) >= 80">
                          {{ num(e.melhor_score).toFixed(0) }}%
                        </span>
                      } @else { — }
                    </td>
                    <td class="tc td-acoes">
                      @if (e.status === 'pendente') {
                        <button type="button" class="badge-acao bg-blue1" title="Ver sugestões" (click)="toggleSugestoes(e)">
                          <mat-icon>psychology</mat-icon>
                        </button>
                        <button type="button" class="badge-acao bg-teal" title="Classificar direto" (click)="toggleClassificar(e)">
                          <mat-icon>label</mat-icon>
                        </button>
                        <button type="button" class="badge-acao bg-gray" title="Ignorar" (click)="ignorar(e)">
                          <mat-icon>visibility_off</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                  @if (aberto() === e.id) {
                    <tr class="tr-det">
                      <td colspan="6">
                        @if (carregandoSug()) {
                          <p class="vazio">Buscando candidatos…</p>
                        } @else if (sugestoes().length) {
                          <div class="sug-lista">
                            @for (s of sugestoes(); track s.baixa.id; let i = $index) {
                              <div class="sug">
                                <span class="sug-score" [class.alto]="num(s.score) >= 80">{{ num(s.score).toFixed(0) }}%</span>
                                <div class="sug-info">
                                  <strong>{{ s.lancamento_descricao }}</strong>
                                  <small>
                                    Baixa Nº{{ s.baixa.id }} · {{ s.baixa.data | date: 'dd/MM/yy' }}
                                    · {{ s.baixa.forma_pagamento ?? 'sem forma' }}
                                    · Δ {{ s.dias_diferenca }}d
                                  </small>
                                </div>
                                <span class="sug-valor">{{ fmt(s.baixa.valor) }}</span>
                                <button type="button" class="btn-prim sm" (click)="conciliar(e, s.baixa.id)">
                                  Conciliar
                                </button>
                              </div>
                            }
                          </div>
                        } @else {
                          <p class="vazio">Nenhuma baixa candidata — classifique diretamente ou importe o lançamento.</p>
                        }
                      </td>
                    </tr>
                  }
                  @if (classAberto() === e.id) {
                    <tr class="tr-det">
                      <td colspan="6">
                        <form class="cls-form" [formGroup]="clsForm" (ngSubmit)="confirmarClassificar(e)">
                          <strong>Criar lançamento {{ num(e.valor) > 0 ? 'a receber' : 'a pagar' }} de {{ fmt(num(e.valor) < 0 ? -num(e.valor) : e.valor) }}</strong>
                          <select class="inp" formControlName="idplano_conta" aria-label="Plano de contas">
                            <option [ngValue]="null" disabled>Plano de contas *</option>
                            @for (p of planoPara(e); track p.id) {
                              <option [ngValue]="p.id">{{ p.codigo }} — {{ p.nome }}</option>
                            }
                          </select>
                          <input class="inp" formControlName="descricao" placeholder="Descrição (opcional)" aria-label="Descrição" />
                          <button class="btn-prim sm" type="submit" [disabled]="clsForm.invalid">Classificar</button>
                          <button class="btn-ghost" type="button" (click)="classAberto.set(null)">Fechar</button>
                        </form>
                      </td>
                    </tr>
                  }
                } @empty {
                  <tr><td colspan="6" class="vazio">Nenhum item de extrato. Importe um OFX/CSV para começar.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <footer class="pag">
            <button type="button" class="btn-ghost" [disabled]="page() <= 1" (click)="pagina(page() - 1)">
              <mat-icon>chevron_left</mat-icon> Anterior
            </button>
            <span>{{ page() }} / {{ totalPaginas() }} — {{ total() }} itens</span>
            <button type="button" class="btn-ghost" [disabled]="page() >= totalPaginas()" (click)="pagina(page() + 1)">
              Próxima <mat-icon>chevron_right</mat-icon>
            </button>
          </footer>
        }
      </section>
    </div>
  `,
  styles: `
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e3eaef; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#054054; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#7d97a1; }
    .acoes { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .inp { border:1px solid #d7e0e6; border-radius:7px; padding:8px 11px; font-size:.85rem; font-family:inherit; color:#33424c; background:#fff; }
    .inp:focus { outline:2px solid #1a6f8a33; border-color:#1a6f8a; }
    .btn-prim { display:inline-flex; align-items:center; gap:6px; background:#054054; color:#fff; border:none; border-radius:7px; padding:0 16px; min-height:36px; font-weight:600; font-size:.85rem; cursor:pointer; font-family:inherit; }
    .btn-prim.sm { min-height:30px; padding:0 14px; font-size:.8rem; }
    .btn-prim:hover:not(:disabled) { background:#0a5a74; }
    .btn-prim:disabled { opacity:.55; }
    .btn-ghost { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid #d7e0e6; color:#5d6d7e; border-radius:7px; padding:0 12px; min-height:34px; font-weight:600; font-size:.82rem; cursor:pointer; font-family:inherit; }
    .btn-ghost:hover:not(:disabled) { border-color:#1a6f8a; color:#1a6f8a; }
    .btn-ghost:disabled { opacity:.45; }
    .resumo { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
    .rz { display:flex; flex-direction:column; align-items:center; min-width:100px; padding:10px 16px; border:1px solid #e3eaef; border-radius:9px; background:#fff; cursor:pointer; font-family:inherit; }
    .rz strong { font-size:1.25rem; font-weight:800; color:#054054; font-variant-numeric:tabular-nums; }
    .rz span { font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; color:#7d97a1; font-weight:600; }
    .rz.pend strong { color:#b97e12; } .rz.conc strong { color:#198754; } .rz.ign strong { color:#8a99a4; }
    .rz.ativo { border-color:#054054; background:#f4f8fa; }
    .rz-info { margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:.76rem; color:#7d97a1; }
    .rz-info mat-icon { font-size:15px; width:15px; height:15px; }
    .card { background:#fff; border:1px solid #e3eaef; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .tab-wrap { overflow-x:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.9rem; }
    .tab thead th { background:#f4f8fa; color:#40525d; font-size:.73rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:11px 14px; text-align:left; border-bottom:2px solid #e3eaef; white-space:nowrap; }
    .tab tbody td { padding:11px 14px; border-bottom:1px solid #eef2f5; vertical-align:middle; color:#33424c; }
    .tab .tc { text-align:center; } .tab .tr { text-align:right; }
    .nw { white-space:nowrap; }
    .desat td { opacity:.55; }
    .td-desc { font-weight:600; color:#054054; }
    .td-mini { font-size:.72rem; color:#8a99a4; }
    .td-valor { font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .pos { color:#198754; } .neg { color:#dc3545; }
    .st { display:inline-block; font-size:.72rem; font-weight:700; border-radius:999px; padding:3px 11px; white-space:nowrap; }
    .st-pendente { background:#f7ead2; color:#9a6b00; }
    .st-conciliado { background:#dff2e5; color:#198754; }
    .st-ignorado { background:#eee; color:#7d97a1; }
    .score, .sug-score { font-size:.78rem; font-weight:800; color:#8a99a4; font-variant-numeric:tabular-nums; }
    .score.alto, .sug-score.alto { color:#198754; }
    .td-acoes { white-space:nowrap; }
    .badge-acao { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:7px; cursor:pointer; color:#fff; margin:0 2px; }
    .badge-acao mat-icon { font-size:16px; width:16px; height:16px; }
    .bg-blue1 { background:#1a6f8a; } .bg-teal { background:#0d7d7d; } .bg-gray { background:#8a99a4; }
    .tr-det td { background:#f7fafb; padding:12px 18px; }
    .sug-lista { display:flex; flex-direction:column; gap:8px; }
    .sug { display:flex; align-items:center; gap:14px; background:#fff; border:1px solid #e3eaef; border-radius:8px; padding:10px 14px; }
    .sug-score { min-width:40px; text-align:center; font-size:1rem; }
    .sug-info { flex:1; min-width:0; display:flex; flex-direction:column; }
    .sug-info strong { font-size:.86rem; color:#054054; }
    .sug-info small { font-size:.74rem; color:#8a99a4; }
    .sug-valor { font-weight:800; color:#054054; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .cls-form { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .cls-form strong { color:#054054; font-size:.85rem; }
    .pag { display:flex; align-items:center; justify-content:center; gap:14px; padding-top:12px; font-size:.82rem; color:#7d97a1; }
    .vazio { color:#8a99a4; font-size:.85rem; text-align:center; padding:22px 0; margin:0; }
    .skel { border-radius:8px; background:linear-gradient(90deg,#eef2f5 25%,#f7fafb 50%,#eef2f5 75%); background-size:200% 100%; animation:sk 1.2s infinite; }
    .sk-tab { height:320px; }
    @keyframes sk { to { background-position:-200% 0; } }
  `,
})
export class FinConciliacaoComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;

  readonly contas = signal<ContaFinanceira[]>([]);
  readonly contasBanco = computed(() => this.contas().filter((c) => c.tipo === 'banco' && c.ativo));
  readonly plano = signal<PlanoConta[]>([]);
  readonly itens = signal<ExtratoView[]>([]);
  readonly resumo = signal<ConciliacaoResumo | null>(null);
  readonly sugestoes = signal<SugestaoConciliacao[]>([]);
  readonly status = signal<StatusExtrato | null>('pendente');
  readonly carregando = signal(true);
  readonly carregandoSug = signal(false);
  readonly rodando = signal(false);
  readonly aberto = signal<number | null>(null);
  readonly classAberto = signal<number | null>(null);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 30)));

  readonly contaCtrl = new FormControl<number | null>(null);
  readonly clsForm = new FormGroup({
    idplano_conta: new FormControl<number | null>(null),
    descricao: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    this.api.listarContasFinanceiras(true).subscribe({
      next: (cs) => {
        this.contas.set(cs);
        const banco = cs.find((c) => c.tipo === 'banco' && c.ativo) ?? cs.find((c) => c.ativo);
        if (banco) this.contaCtrl.setValue(banco.id, { emitEvent: false });
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
    this.api.listarPlanoContas(false).subscribe({
      next: (p) => this.plano.set(p),
      error: () => undefined,
    });
    this.contaCtrl.valueChanges.subscribe(() => this.pagina(1));
  }

  planoPara(e: ExtratoView): PlanoConta[] {
    const tipo = num(e.valor) > 0 ? 'receber' : 'pagar';
    return this.plano().filter((p) => p.tipo === tipo);
  }

  carregar(): void {
    this.carregando.set(true);
    this.aberto.set(null);
    this.classAberto.set(null);
    const idconta = this.contaCtrl.value;
    this.api
      .listarExtrato({
        idconta_financeira: idconta,
        status: this.status(),
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
    this.api.resumoExtrato(idconta).subscribe({
      next: (r) => this.resumo.set(r),
      error: () => undefined,
    });
  }

  pagina(p: number): void {
    this.page.set(p);
    this.carregar();
  }

  filtroStatus(s: StatusExtrato | null): void {
    this.status.set(s);
    this.pagina(1);
  }

  rotulo(s: StatusExtrato): string {
    return s === 'pendente' ? 'Pendente' : s === 'conciliado' ? 'Conciliado' : 'Ignorado';
  }

  importar(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const idconta = this.contaCtrl.value;
    if (!file) return;
    if (!idconta) {
      this.notify.aviso('Selecione a conta bancária antes de importar.');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.api.importarExtrato(idconta, String(reader.result ?? '')).subscribe({
        next: (r) => {
          this.notify.ok(
            `${r.importados} itens importados, ${r.duplicados} duplicados ignorados.`,
          );
          this.pagina(1);
        },
        error: (e) => this.notify.erro(e),
      });
    };
    reader.readAsText(file);
    input.value = '';
  }

  autoConciliar(): void {
    const idconta = this.contaCtrl.value;
    if (!idconta) {
      this.notify.aviso('Selecione a conta bancária.');
      return;
    }
    this.rodando.set(true);
    this.api.autoConciliar(idconta).subscribe({
      next: (r) => {
        this.rodando.set(false);
        this.notify.ok(`${r.conciliados} itens conciliados automaticamente.`);
        this.carregar();
      },
      error: (e) => {
        this.rodando.set(false);
        this.notify.erro(e);
      },
    });
  }

  toggleSugestoes(e: ExtratoView): void {
    if (this.aberto() === e.id) {
      this.aberto.set(null);
      return;
    }
    this.classAberto.set(null);
    this.aberto.set(e.id);
    this.carregandoSug.set(true);
    this.api.sugestoesExtrato(e.id).subscribe({
      next: (s) => {
        this.sugestoes.set(s);
        this.carregandoSug.set(false);
      },
      error: (err) => {
        this.carregandoSug.set(false);
        this.notify.erro(err);
      },
    });
  }

  toggleClassificar(e: ExtratoView): void {
    this.aberto.set(null);
    this.classAberto.set(this.classAberto() === e.id ? null : e.id);
    this.clsForm.reset({ idplano_conta: null, descricao: e.descricao });
  }

  conciliar(e: ExtratoView, idbaixa: number): void {
    this.api.conciliarExtrato(e.id, idbaixa).subscribe({
      next: () => {
        this.notify.ok('Conciliado.');
        this.carregar();
      },
      error: (err) => this.notify.erro(err),
    });
  }

  confirmarClassificar(e: ExtratoView): void {
    const v = this.clsForm.getRawValue();
    if (v.idplano_conta === null) return;
    this.api
      .classificarExtrato(e.id, v.idplano_conta, v.descricao.trim() || null)
      .subscribe({
        next: () => {
          this.notify.ok('Lançamento criado e conciliado.');
          this.classAberto.set(null);
          this.carregar();
        },
        error: (err) => this.notify.erro(err),
      });
  }

  ignorar(e: ExtratoView): void {
    this.api.ignorarExtrato(e.id).subscribe({
      next: () => {
        this.notify.ok('Item ignorado.');
        this.carregar();
      },
      error: (err) => this.notify.erro(err),
    });
  }
}
