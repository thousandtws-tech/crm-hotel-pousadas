import { Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { InteligenciaApi } from '@core/api/inteligencia.api';
import { Notify } from '@core/services/notify.service';
import { IaEscalaDia, IaEstoquePrev, IaMesHistorico, IaPerfil, IaResumo, IaRisco, IaRiscoQuarto, IaUpsell } from '@core/models/inteligencia.models';

type Aba = 'visao' | 'riscos' | 'hospedes' | 'operacao';

const CLASSE_ROTULO: Record<string, string> = {
  vip: 'VIP', ativo: 'Ativo', em_risco: 'Em risco', churn: 'Churn', novo: 'Novo',
};

/** Inteligência preditiva — BI, risco de no-show, perfis, pace e otimização. */
@Component({
  selector: 'app-inteligencia',
  imports: [DatePipe, CurrencyPipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Inteligência</h2>
          <p class="pg-sub">Análise preditiva determinística — sem custo de IA</p>
        </div>
      </header>

      <nav class="abas">
        <button class="aba" [class.ativa]="aba()==='visao'" (click)="trocar('visao')">Visão & BI</button>
        <button class="aba" [class.ativa]="aba()==='riscos'" (click)="trocar('riscos')">Riscos</button>
        <button class="aba" [class.ativa]="aba()==='hospedes'" (click)="trocar('hospedes')">Hóspedes & Upsell</button>
        <button class="aba" [class.ativa]="aba()==='operacao'" (click)="trocar('operacao')">Operação</button>
      </nav>

      @if (aba()==='visao' && resumo(); as r) {
        <div class="cards">
          <div class="card">
            <span class="card-label">Ocupação média 14d</span>
            <strong>{{ r.ocupacao_media_pct }}%</strong>
          </div>
          <div class="card">
            <span class="card-label">Receita prevista 4 sem.</span>
            <strong>{{ somaReceita(r) | currency:'BRL':'symbol':'1.0-0' }}</strong>
          </div>
          <div class="card">
            <span class="card-label">Fluxo previsto 30d</span>
            <strong [class.neg]="r.fluxo.saldo_previsto < 0">{{ r.fluxo.saldo_previsto | currency:'BRL' }}</strong>
            <small>entradas {{ r.fluxo.entradas_previstas | currency:'BRL':'symbol':'1.0-0' }}
              · saídas {{ r.fluxo.saidas_previstas | currency:'BRL':'symbol':'1.0-0' }}</small>
          </div>
          <div class="card">
            <span class="card-label">Pace vs ano anterior</span>
            <strong [class.neg]="r.pace.variacao_pct < 0">{{ r.pace.variacao_pct }}%</strong>
            <small>{{ r.pace.reservas_atual }} reservas / 30d ({{ r.pace.reservas_ano_anterior }} ano passado)</small>
          </div>
          <div class="card alerta" >
            <span class="card-label">Risco alto de no-show</span>
            <strong>{{ r.riscos_altos }}</strong>
            <small>{{ r.upsells }} oportunidades de upgrade</small>
          </div>
        </div>

        @if (r.pace.recomendacao) {
          <p class="reco">💡 {{ r.pace.recomendacao }}</p>
        }

        <div class="bloco">
          <h3>Ocupação projetada — 14 dias</h3>
          <div class="barras" role="img" aria-label="Gráfico de ocupação projetada">
            @for (d of r.ocupacao_14d; track d.data) {
              <div class="barra-col" [title]="d.data | date:'dd/MM':'' +' — '+ d.ocupados +'/'+ d.total_quartos">
                <div class="barra" [style.height.%]="pct(d.ocupados, d.total_quartos)"
                     [class.alta]="pct(d.ocupados, d.total_quartos) >= 80"></div>
                <span>{{ d.data | date:'dd' }}</span>
              </div>
            }
          </div>
          <div class="legenda">
            <span>■ ocupado</span><span class="quente">■ ≥80% (subir diária?)</span>
          </div>
        </div>

        <div class="bloco">
          <h3>Histórico 12 meses</h3>
          <table>
            <thead><tr><th>Mês</th><th>Ocupação</th><th>Diárias</th><th>ADR</th><th>Receita</th><th>Reservas</th></tr></thead>
            <tbody>
              @for (m of historico(); track m.mes) {
                <tr>
                  <td>{{ m.mes | date:'MMM/yy' }}</td>
                  <td>{{ m.ocupacao_pct }}%</td>
                  <td>{{ m.diarias }}</td>
                  <td>{{ m.adr | currency:'BRL' }}</td>
                  <td>{{ m.receita | currency:'BRL' }}</td>
                  <td>{{ m.reservas }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='riscos') {
        <div class="bloco">
          <h3>Risco de cancelamento / no-show — score 0-100</h3>
          <table>
            <thead><tr><th>Reserva</th><th>Hóspede</th><th>Entrada</th><th>Score</th><th>Sinais</th><th>Ação sugerida</th></tr></thead>
            <tbody>
              @for (x of riscos(); track x.idreserva) {
                <tr [class.linha-vermelho]="x.nivel==='vermelho'">
                  <td>#{{ x.idreserva }}</td>
                  <td>{{ x.cliente }}<br><small>{{ x.acomodacao }}</small></td>
                  <td>{{ x.entrada | date:'dd/MM/yy' }}</td>
                  <td><span class="pill pill-{{ x.nivel }}">{{ x.score }}</span></td>
                  <td><small>{{ x.sinais.join(' · ') }}</small></td>
                  <td><small>{{ x.acao }}</small></td>
                </tr>
              } @empty { <tr><td colspan="6" class="vazio">Nenhuma reserva futura.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="bloco">
          <h3>Manutenção preventiva por uso — quartos sob risco</h3>
          <table>
            <thead><tr><th>Quarto</th><th>Noites 90d</th><th>OS 90d</th><th>Score</th><th>Recomendação</th></tr></thead>
            <tbody>
              @for (q of riscoQuartos(); track q.idquarto) {
                @if (q.nivel !== 'verde') {
                  <tr [class.linha-vermelho]="q.nivel==='vermelho'">
                    <td>{{ q.quarto }}</td>
                    <td>{{ q.noites_90d }}</td>
                    <td>{{ q.os_90d }}</td>
                    <td><span class="pill pill-{{ q.nivel }}">{{ q.score }}</span></td>
                    <td><small>{{ q.recomendacao }}</small></td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='hospedes') {
        @if (resumo(); as r) {
          <div class="cards">
            @for (c of classesOrdenadas; track c) {
              <div class="card"><span class="card-label">{{ classeRotulo[c] }}</span><strong>{{ r.perfis[c] ?? 0 }}</strong></div>
            }
          </div>
        }
        <div class="bloco">
          <h3>Upsell por disponibilidade real</h3>
          <table>
            <thead><tr><th>Reserva</th><th>Hóspede</th><th>De → Para</th><th>Período</th><th>Dif. diária</th><th>Ganho</th></tr></thead>
            <tbody>
              @for (u of upsells(); track u.idreserva) {
                <tr>
                  <td>#{{ u.idreserva }}</td>
                  <td>{{ u.cliente }}</td>
                  <td>{{ u.acomodacao_atual }} → <strong>{{ u.acomodacao_alvo }}</strong></td>
                  <td>{{ u.entrada | date:'dd/MM' }} – {{ u.saida | date:'dd/MM' }}</td>
                  <td>+{{ u.diferenca_diaria | currency:'BRL' }}</td>
                  <td><strong>+{{ u.ganho_potencial | currency:'BRL' }}</strong></td>
                </tr>
              } @empty { <tr><td colspan="6" class="vazio">Nenhum upgrade disponível agora.</td></tr> }
            </tbody>
          </table>
        </div>

        <div class="bloco">
          <h3>Perfil de hóspedes — LTV & churn</h3>
          <table>
            <thead><tr><th>Hóspede</th><th>Classe</th><th>Estadias</th><th>Última</th><th>LTV</th></tr></thead>
            <tbody>
              @for (p of perfis(); track p.idcliente) {
                <tr>
                  <td>{{ p.nome }}</td>
                  <td><span class="tag tag-{{ p.classe }}">{{ classeRotulo[p.classe] ?? p.classe }}</span></td>
                  <td>{{ p.estadias }}</td>
                  <td>{{ p.ultima_estadia ? (p.ultima_estadia | date:'dd/MM/yy') : '—' }}</td>
                  <td>{{ p.ltv | currency:'BRL' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='operacao') {
        <div class="bloco">
          <h3>Headcount ideal por setor — próximos 14 dias</h3>
          <table>
            <thead><tr><th>Data</th><th>Setor</th><th>Demanda</th><th>Sugerido</th><th>Escalado</th><th>Déficit</th></tr></thead>
            <tbody>
              @for (e of escala(); track e.data + e.setor) {
                @if (e.sugerido > 0 || e.deficit !== 0) {
                  <tr [class.linha-vermelho]="e.deficit > 0">
                    <td>{{ e.data | date:'dd/MM (EEE)' }}</td>
                    <td>{{ e.setor }}</td>
                    <td>{{ e.demanda_min }}min</td>
                    <td>{{ e.sugerido }}</td>
                    <td>{{ e.escalado }}</td>
                    <td><strong [class.neg]="e.deficit > 0">{{ e.deficit > 0 ? '+' + e.deficit : e.deficit }}</strong></td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <div class="bloco">
          <h3>Estoque preditivo — demanda próximos 14d</h3>
          <table>
            <thead><tr><th>Item</th><th>Saldo</th><th>Consumo/dia</th><th>Demanda 14d</th><th>Dura até</th><th>Sugestão compra</th></tr></thead>
            <tbody>
              @for (i of estoque(); track i.iditem) {
                <tr [class.linha-vermelho]="i.dias_restantes !== null && i.dias_restantes < 14">
                  <td>{{ i.nome }}</td>
                  <td>{{ i.saldo }}</td>
                  <td>{{ i.consumo_diario_medio }}</td>
                  <td>{{ i.demanda_prevista_14d }}</td>
                  <td>{{ i.dias_restantes === null ? '—' : i.dias_restantes + 'd' }}</td>
                  <td>@if (i.sugestao_compra > 0) { <strong>{{ i.sugestao_compra }}</strong> } @else { — }</td>
                </tr>
              } @empty { <tr><td colspan="6" class="vazio">Sem consumo registrado nos últimos 30d.</td></tr> }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .pg { padding: 1.4rem; }
    .pg-head { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:1rem; }
    .pg-titulo { margin:0; font-size:1.4rem; }
    .pg-sub { margin:.2rem 0 0; color:var(--inn-muted,#6b7f88); font-size:.85rem; }
    .abas { display:flex; gap:.4rem; margin-bottom:1.1rem; flex-wrap:wrap; }
    .aba { border:1px solid #cfdde3; background:#fff; padding:.45rem .9rem; border-radius:999px; cursor:pointer; font-size:.85rem; }
    .aba.ativa { background:var(--inn-first,#14303c); color:#fff; border-color:var(--inn-first,#14303c); }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:.8rem; margin-bottom:1rem; }
    .card { background:#fff; border:1px solid #dde7ec; border-radius:12px; padding:.9rem 1rem; display:flex; flex-direction:column; gap:.25rem; }
    .card.alerta { border-color:#f0c36d; background:#fffaf0; }
    .card-label { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:#6b7f88; }
    .card strong { font-size:1.25rem; }
    .card small { color:#6b7f88; }
    .neg { color:var(--inn-danger,#dc3545); }
    .reco { background:#eef7f9; border:1px solid #cfe4ea; border-radius:10px; padding:.7rem 1rem; margin:0 0 1rem; font-size:.9rem; }
    .bloco { background:#fff; border:1px solid #dde7ec; border-radius:12px; padding:1rem 1.2rem; margin-bottom:1rem; overflow-x:auto; }
    .bloco h3 { margin:0 0 .8rem; font-size:1rem; }
    table { width:100%; border-collapse:collapse; font-size:.86rem; }
    th, td { text-align:left; padding:.45rem .5rem; border-bottom:1px solid #eef3f5; vertical-align:top; }
    th { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:#6b7f88; }
    .vazio { text-align:center; color:#8ba0a9; padding:1.4rem; }
    .linha-vermelho { background:#fdf2f2; }
    .pill { display:inline-block; min-width:2rem; text-align:center; padding:.15rem .5rem; border-radius:999px; font-weight:700; font-size:.8rem; }
    .pill-verde { background:#e3f3e7; color:#146c2e; }
    .pill-amarelo { background:#fdf1d7; color:#8a6116; }
    .pill-vermelho { background:#fbdcdc; color:#a02424; }
    .tag { padding:.15rem .55rem; border-radius:6px; font-size:.75rem; font-weight:600; }
    .tag-vip { background:#f4e6c8; color:#8a6116; }
    .tag-ativo { background:#e3f3e7; color:#146c2e; }
    .tag-em_risco { background:#fdf1d7; color:#8a6116; }
    .tag-churn { background:#fbdcdc; color:#a02424; }
    .tag-novo { background:#e5eefb; color:#27548f; }
    .barras { display:flex; align-items:flex-end; gap:6px; height:120px; }
    .barra-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; height:100%; justify-content:flex-end; font-size:.7rem; color:#6b7f88; }
    .barra { width:100%; min-height:2px; background:var(--inn-accent,#4b95ab); border-radius:4px 4px 0 0; }
    .barra.alta { background:var(--inn-gold,#b5811f); }
    .legenda { display:flex; gap:1.2rem; font-size:.75rem; color:#6b7f88; margin-top:.5rem; }
    .legenda .quente { color:var(--inn-gold,#b5811f); }
  `,
})
export class InteligenciaComponent implements OnInit {
  private readonly inteligenciaApi = inject(InteligenciaApi);
  private readonly notify = inject(Notify);

  readonly aba = signal<Aba>('visao');
  readonly resumo = signal<IaResumo | null>(null);
  readonly historico = signal<IaMesHistorico[]>([]);
  readonly riscos = signal<IaRisco[]>([]);
  readonly riscoQuartos = signal<IaRiscoQuarto[]>([]);
  readonly perfis = signal<IaPerfil[]>([]);
  readonly upsells = signal<IaUpsell[]>([]);
  readonly escala = signal<IaEscalaDia[]>([]);
  readonly estoque = signal<IaEstoquePrev[]>([]);

  readonly classeRotulo = CLASSE_ROTULO;
  readonly classesOrdenadas = ['vip', 'ativo', 'em_risco', 'churn', 'novo'];
  private carregadas = new Set<Aba>();

  ngOnInit() {
    this.inteligenciaApi.iaResumo().subscribe({
      next: (r) => this.resumo.set(r),
      error: (e) => this.notify.erro(e),
    });
    this.inteligenciaApi.iaHistorico().subscribe({
      next: (h) => this.historico.set(h),
      error: () => {},
    });
    this.carregadas.add('visao');
  }

  trocar(aba: Aba) {
    this.aba.set(aba);
    if (this.carregadas.has(aba)) return;
    this.carregadas.add(aba);
    if (aba === 'riscos') {
      this.inteligenciaApi.iaRiscos().subscribe({ next: (r) => this.riscos.set(r), error: (e) => this.notify.erro(e) });
      this.inteligenciaApi.iaManutencao().subscribe({ next: (r) => this.riscoQuartos.set(r), error: (e) => this.notify.erro(e) });
    } else if (aba === 'hospedes') {
      this.inteligenciaApi.iaPerfis().subscribe({ next: (p) => this.perfis.set(p), error: (e) => this.notify.erro(e) });
      this.inteligenciaApi.iaUpsell().subscribe({ next: (u) => this.upsells.set(u), error: (e) => this.notify.erro(e) });
    } else if (aba === 'operacao') {
      this.inteligenciaApi.iaEscala().subscribe({ next: (e) => this.escala.set(e), error: (e2) => this.notify.erro(e2) });
      this.inteligenciaApi.iaEstoque().subscribe({ next: (e) => this.estoque.set(e), error: (e2) => this.notify.erro(e2) });
    }
  }

  pct(ocupados: number, total: number) {
    return total > 0 ? Math.round((ocupados / total) * 100) : 0;
  }

  somaReceita(r: IaResumo) {
    return r.receita_4sem.reduce((a, s) => a + Number(s.receita), 0);
  }
}
