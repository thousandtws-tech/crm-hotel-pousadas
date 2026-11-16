import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FuncionariosApi } from '@core/api/funcionarios.api';
import { OperacaoApi } from '@core/api/operacao.api';
import { Notify } from '@core/services/notify.service';
import { CltViolacao, EscalaTurno, FuncionarioJornada, RegimeEscala } from '@core/models/operacao.models';

type Aba = 'grade' | 'jornadas' | 'clt';

const REGRA_ROTULO: Record<string, string> = {
  interjornada: 'Interjornada <11h', dsr: 'DSR semanal', jornada_diaria: 'Jornada diária',
  almoco: 'Intervalo de almoço', duracao: 'Duração do turno', duplicado: 'Turno duplicado',
};

/** Escalas — jornadas por regime, grade de turnos e conformidade CLT. */
@Component({
  selector: 'app-escalas',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Escalas &amp; CLT</h2>
          <p class="pg-sub">Regimes 5x1, 6x1 e 12x36 — validação automática de jornada</p>
        </div>
        <div class="filtros">
          <input type="date" [(ngModel)]="inicio" (change)="carregar()" aria-label="Início" />
          <input type="date" [(ngModel)]="fim" (change)="carregar()" aria-label="Fim" />
          <button class="btn-mini" (click)="validarClt()">Validar CLT</button>
        </div>
      </header>

      <nav class="abas">
        <button class="aba" [class.ativa]="aba()==='grade'" (click)="aba.set('grade')">Grade de turnos</button>
        <button class="aba" [class.ativa]="aba()==='jornadas'" (click)="aba.set('jornadas')">Jornadas</button>
        <button class="aba" [class.ativa]="aba()==='clt'" (click)="aba.set('clt'); validarClt()">
          Conformidade CLT
          @if (violacoes().length) {<span class="badge">{{ violacoes().length }}</span>}
        </button>
      </nav>

      @if (aba()==='grade') {
        <div class="bloco">
          <h3>{{ turnos().length }} turnos no período</h3>
          <table>
            <thead><tr><th>Data</th><th>Funcionário</th><th>Início</th><th>Fim</th><th>Almoço</th><th>Origem</th><th></th></tr></thead>
            <tbody>
              @for (t of turnos(); track t.id) {
                <tr>
                  <td>{{ t.data | date:'EEE dd/MM' }}</td>
                  <td>{{ nomeFunc(t.idfuncionario) }}</td>
                  <td>
                    <input type="time" [ngModel]="hhmm(t.inicio)" (ngModelChange)="horasEdit.set(t.id+'-i', $event); editado(t)" aria-label="Início" />
                  </td>
                  <td>
                    <input type="time" [ngModel]="hhmm(t.fim)" (ngModelChange)="horasEdit.set(t.id+'-f', $event); editado(t)" aria-label="Fim" />
                  </td>
                  <td>{{ t.almoco_min }}min</td>
                  <td>{{ t.origem }}</td>
                  <td>
                    @if (alterados().has(t.id)) {
                      <button class="btn-mini" (click)="salvarTurno(t)">Salvar</button>
                    }
                    <button class="btn-mini danger" (click)="removerTurno(t)">Excluir</button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="vazio">Nenhum turno — configure jornadas na aba ao lado.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='jornadas') {
        <div class="bloco">
          <h3>Regimes cadastrados
            <button class="btn-mini" (click)="modalJornada.set(true)">Nova jornada</button>
          </h3>
          <table>
            <thead><tr><th>Funcionário</th><th>Regime</th><th>Entrada</th><th>Saída</th><th>Almoço</th><th>Âncora</th><th>Ativo</th></tr></thead>
            <tbody>
              @for (j of jornadas(); track j.id) {
                <tr>
                  <td>{{ nomeFunc(j.idfuncionario) }}</td>
                  <td><strong>{{ j.regime }}</strong></td>
                  <td>{{ j.entrada.slice(0,5) }}</td>
                  <td>{{ j.saida.slice(0,5) }}</td>
                  <td>{{ j.almoco_min }}min</td>
                  <td>{{ j.ancora | date:'dd/MM/yyyy' }}</td>
                  <td>{{ j.ativo ? 'Sim' : 'Não' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="vazio">Nenhuma jornada — cadastre para gerar turnos.</td></tr>
              }
            </tbody>
          </table>
          <p class="vazio">Salvar uma jornada gera automaticamente os turnos dos próximos 30 dias.</p>
        </div>
      }

      @if (aba()==='clt') {
        <div class="bloco">
          <h3>Violações encontradas (próximos 14 dias)</h3>
          <table>
            <thead><tr><th>Funcionário</th><th>Regra</th><th>Data</th><th>Detalhe</th><th>Severidade</th><th></th></tr></thead>
            <tbody>
              @for (v of violacoes(); track v.idfuncionario+v.data+v.regra) {
                <tr [class.critica]="v.severidade==='alta'">
                  <td>{{ v.funcionario_nome }}</td>
                  <td>{{ regraRotulo[v.regra] ?? v.regra }}</td>
                  <td>{{ v.data | date:'dd/MM' }}</td>
                  <td>{{ v.detalhe }}</td>
                  <td><span class="sev sev-{{ v.severidade }}">{{ v.severidade }}</span></td>
                  <td>
                    @if (v.correcao) {
                      <button class="btn-mini" (click)="corrigir(v)">Corrigir em 1 clique</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="vazio">Nenhuma violação — escalas em conformidade.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (modalJornada()) {
        <div class="overlay" (click)="modalJornada.set(false)" (keydown.escape)="modalJornada.set(false)">
          <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Nova jornada</h3>
            <label>Funcionário
              <select [(ngModel)]="jornadaForm.idfuncionario">
                @for (f of funcionarios(); track f.id) {<option [ngValue]="f.id">{{ f.nome }}</option>}
              </select>
            </label>
            <label>Regime
              <select [(ngModel)]="jornadaForm.regime">
                <option value="5x1">5x1 — 5 dias trabalho, 1 folga</option>
                <option value="6x1">6x1 — 6 dias trabalho, 1 folga</option>
                <option value="12x36">12x36 — 12h trabalho, 36h folga</option>
              </select>
            </label>
            <div class="duo">
              <label>Entrada <input type="time" [(ngModel)]="jornadaForm.entrada" /></label>
              <label>Saída <input type="time" [(ngModel)]="jornadaForm.saida" /></label>
            </div>
            <label>Almoço (minutos) <input type="number" [(ngModel)]="jornadaForm.almoco_min" /></label>
            <label>Data âncora (1º dia de trabalho do ciclo)
              <input type="date" [(ngModel)]="jornadaForm.ancora" />
            </label>
            <label>Dias a gerar <input type="number" [(ngModel)]="diasGerar" min="7" max="90" /></label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalJornada.set(false)">Cancelar</button>
              <button class="btn" [disabled]="!jornadaForm.idfuncionario" (click)="gravarJornada()">Salvar e gerar turnos</button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .pg{padding:1.25rem;display:flex;flex-direction:column;gap:1rem}
    .pg-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1rem}
    .pg-titulo{font-size:1.35rem;margin:0}
    .pg-sub{margin:.15rem 0 0;color:var(--mut,#667);font-size:.85rem}
    .filtros{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
    .filtros input{padding:.45rem .6rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.85rem}
    .abas{display:flex;gap:.4rem;border-bottom:1px solid var(--borda,#dde2e8)}
    .aba{padding:.55rem 1rem;border:0;background:none;border-bottom:2px solid transparent;cursor:pointer;font-size:.88rem;display:flex;align-items:center;gap:.4rem}
    .aba.ativa{border-bottom-color:#2457a7;font-weight:700}
    .badge{background:#b02a37;color:#fff;border-radius:999px;font-size:.65rem;padding:.1rem .45rem}
    .bloco{background:var(--card,#fff);border:1px solid var(--borda,#dde2e8);border-radius:12px;padding:1rem;overflow-x:auto}
    .bloco h3{margin:0 0 .75rem;font-size:.95rem;display:flex;align-items:center;gap:.6rem}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--borda,#eee)}
    th{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut,#667)}
    td input[type=time]{padding:.25rem .4rem;border:1px solid var(--borda,#ccd);border-radius:6px;font-size:.8rem}
    .sev{padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:600}
    .sev-alta{background:#fde2e2;color:#a11}
    .sev-media{background:#fef3e0;color:#b45309}
    .critica td{background:#fdf1f2}
    select{padding:.3rem .5rem;border:1px solid var(--borda,#ccd);border-radius:6px;font-size:.78rem}
    .btn-mini{font-size:.72rem;padding:.3rem .7rem;border-radius:6px;border:1px solid var(--borda,#ccd);background:#fff;cursor:pointer}
    .btn-mini.danger{color:#a11;border-color:#ecc}
    .vazio{color:var(--mut,#667);font-size:.85rem;padding:.5rem 0}
    .overlay{position:fixed;inset:0;background:rgba(22, 26, 32, .45);display:flex;align-items:center;justify-content:center;z-index:60}
    .modal{background:#fff;border-radius:14px;padding:1.5rem;width:min(440px,92vw);display:flex;flex-direction:column;gap:.8rem;max-height:90vh;overflow-y:auto}
    .modal h3{margin:0}
    .modal label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:600}
    .modal input,.modal select{padding:.55rem .65rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.9rem}
    .duo{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
    .acoes{display:flex;gap:.6rem;margin-top:.4rem}
    .btn{flex:1;padding:.6rem;border:0;border-radius:8px;background:#2457a7;color:#fff;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}.btn-sec{padding:.6rem 1rem;border:1px solid var(--borda,#ccd);border-radius:8px;background:#fff;cursor:pointer}
  `],
})
export class EscalasComponent implements OnInit {
  private readonly funcionariosApi = inject(FuncionariosApi);
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(Notify);

  protected readonly aba = signal<Aba>('grade');
  protected readonly turnos = signal<EscalaTurno[]>([]);
  protected readonly jornadas = signal<FuncionarioJornada[]>([]);
  protected readonly violacoes = signal<CltViolacao[]>([]);
  protected readonly funcionarios = signal<{ id: number; nome: string }[]>([]);
  protected readonly modalJornada = signal(false);
  protected readonly alterados = signal<Set<number>>(new Set());
  protected inicio = new Date().toISOString().slice(0, 10);
  protected fim = new Date(Date.now() + 13 * 864e5).toISOString().slice(0, 10);
  protected diasGerar = 30;
  protected jornadaForm: { idfuncionario: number; regime: RegimeEscala; entrada: string; saida: string; almoco_min: number; ancora: string } = {
    idfuncionario: 0, regime: '6x1', entrada: '08:00', saida: '17:00', almoco_min: 60,
    ancora: new Date().toISOString().slice(0, 10),
  };
  protected readonly regraRotulo = REGRA_ROTULO;
  private nomes = new Map<number, string>();

  ngOnInit(): void {
    this.funcionariosApi.listarFuncionarios(1, 100, true).subscribe({
      next: (p) => {
        this.funcionarios.set(p.items.map((f) => ({ id: f.id, nome: f.nome })));
        this.nomes = new Map(p.items.map((f) => [f.id, f.nome]));
      },
      error: () => undefined,
    });
    this.carregar();
    this.operacaoApi.jornadas().subscribe({ next: (j) => this.jornadas.set(j), error: () => undefined });
    this.validarClt();
  }

  carregar(): void {
    this.operacaoApi.turnos(this.inicio, this.fim).subscribe({
      next: (t) => { this.turnos.set(t); this.alterados.set(new Set()); },
      error: () => this.notify.erroMsg('Falha ao carregar turnos.'),
    });
  }

  nomeFunc(id: number): string {
    return this.nomes.get(id) ?? `#${id}`;
  }

  editado(t: EscalaTurno): void {
    this.alterados.update((s) => new Set(s).add(t.id));
  }

  protected readonly horasEdit = new Map<string, string>();

  hhmm(iso: string): string {
    return iso.slice(11, 16);
  }

  salvarTurno(t: EscalaTurno): void {
    const inicio = `${t.data}T${this.horasEdit.get(t.id + '-i') ?? this.hhmm(t.inicio)}:00Z`;
    const fim = `${t.data}T${this.horasEdit.get(t.id + '-f') ?? this.hhmm(t.fim)}:00Z`;
    this.operacaoApi.turnoAtualizar(t.id, { inicio, fim, almoco_min: t.almoco_min }).subscribe({
      next: () => {
        this.alterados.update((s) => { const n = new Set(s); n.delete(t.id); return n; });
        this.notify.ok('Turno atualizado.');
      },
      error: () => this.notify.erroMsg('Falha ao salvar turno.'),
    });
  }

  removerTurno(t: EscalaTurno): void {
    this.operacaoApi.removerTurno(t.id).subscribe({
      next: () => this.carregar(),
      error: () => this.notify.erroMsg('Falha ao excluir turno.'),
    });
  }

  gravarJornada(): void {
    this.operacaoApi.gravarJornada({
      ...this.jornadaForm,
      entrada: this.jornadaForm.entrada + ':00',
      saida: this.jornadaForm.saida + ':00',
    }, this.diasGerar).subscribe({
      next: () => {
        this.modalJornada.set(false);
        this.operacaoApi.jornadas().subscribe({ next: (j) => this.jornadas.set(j), error: () => undefined });
        this.carregar();
        this.notify.ok(`Jornada salva — turnos gerados por ${this.diasGerar} dias.`);
      },
      error: () => this.notify.erroMsg('Falha ao salvar jornada.'),
    });
  }

  validarClt(): void {
    this.operacaoApi.cltValidar(14).subscribe({
      next: (v) => this.violacoes.set(v),
      error: () => undefined,
    });
  }

  corrigir(v: CltViolacao): void {
    this.operacaoApi.cltCorrigir(v.correcao).subscribe({
      next: () => { this.validarClt(); this.carregar(); this.notify.ok('Correção aplicada.'); },
      error: () => this.notify.erroMsg('Falha ao aplicar correção.'),
    });
  }
}
