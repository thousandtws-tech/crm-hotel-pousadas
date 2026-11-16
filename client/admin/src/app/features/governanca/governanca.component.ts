import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FuncionariosApi } from '@core/api/funcionarios.api';
import { OperacaoApi } from '@core/api/operacao.api';
import { Notify } from '@core/services/notify.service';
import { EnxovalMov, GovTarefa, LavLote, PrevisaoDia, StatusTarefaGov } from '@core/models/operacao.models';

type Aba = 'quadro' | 'previsao' | 'lavanderia';

const TIPO_ROTULO: Record<string, string> = {
  checkout: 'Checkout', stayover: 'Stayover', semanal: 'Semanal',
  area_comum: 'Área comum', extra: 'Extra',
};

/** Governança — tarefas do dia, previsão de demanda e lavanderia/enxoval. */
@Component({
  selector: 'app-governanca',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Governança</h2>
          <p class="pg-sub">Limpeza, enxoval e lavanderia — D-1 automático às 22h UTC</p>
        </div>
        <div class="filtros">
          <input type="date" [(ngModel)]="dataQuadro" (change)="carregarQuadro()" aria-label="Data" />
          <button class="btn-mini" (click)="gerarD1()">Gerar tarefas de amanhã</button>
        </div>
      </header>

      <nav class="abas">
        <button class="aba" [class.ativa]="aba()==='quadro'" (click)="aba.set('quadro')">Quadro do dia</button>
        <button class="aba" [class.ativa]="aba()==='previsao'" (click)="aba.set('previsao')">Previsão 14 dias</button>
        <button class="aba" [class.ativa]="aba()==='lavanderia'" (click)="aba.set('lavanderia')">Lavanderia & Enxoval</button>
      </nav>

      @if (aba()==='quadro') {
        <div class="bloco">
          <h3>{{ tarefas().length }} tarefas em {{ dataQuadro | date:'dd/MM/yyyy' }}</h3>
          <table>
            <thead><tr><th>Quarto/Local</th><th>Tipo</th><th>Est.</th><th>Responsável</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (t of tarefas(); track t.id) {
                <tr>
                  <td>{{ t.idquarto ? 'Quarto '+t.idquarto : 'Área comum' }}</td>
                  <td>{{ tipoRotulo[t.tipo] ?? t.tipo }}</td>
                  <td>{{ t.estimado_min }}min</td>
                  <td>
                    <select [ngModel]="t.idfuncionario" (ngModelChange)="atribuir(t.id, $event)" aria-label="Responsável">
                      <option [ngValue]="null">—</option>
                      @for (f of funcionarios(); track f.id) {
                        <option [ngValue]="f.id">{{ f.nome }}</option>
                      }
                    </select>
                  </td>
                  <td><span class="st st-{{ t.status }}">{{ t.status.replace('_',' ') }}</span></td>
                  <td class="acoes-td">
                    @if (t.status === 'pendente') {
                      <button class="btn-mini" (click)="status(t, 'em_andamento')">Iniciar</button>
                    }
                    @if (t.status === 'em_andamento') {
                      <button class="btn-mini" (click)="status(t, 'concluida')">Concluir</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="vazio">Nenhuma tarefa — o cron gera às 22h UTC ou use o botão acima.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='previsao') {
        <div class="bloco">
          <h3>Demanda × capacidade da equipe (14 dias)</h3>
          <table>
            <thead><tr><th>Dia</th><th>Checkouts</th><th>Stayovers</th><th>Demanda</th><th>Capacidade</th><th>Situação</th></tr></thead>
            <tbody>
              @for (d of previsao(); track d.data) {
                <tr [class.critica]="d.situacao !== 'ok'">
                  <td>{{ d.data | date:'EEE dd/MM' }}</td>
                  <td>{{ d.checkouts }}</td>
                  <td>{{ d.stayovers }}</td>
                  <td>{{ horas(d.demanda_min) }}</td>
                  <td>{{ d.capacidade_min ? horas(d.capacidade_min) : '—' }}</td>
                  <td>
                    <span class="st" [class]="d.situacao==='ok' ? 'st-concluida' : 'st-pendente'">
                      {{ d.situacao === 'ok' ? 'OK' : d.situacao === 'sobrecarga' ? 'Sobrecarga' : 'Sem equipe' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <p class="vazio">Checkout=60min · stayover=30min · capacidade = turnos do setor governança em Escalas.</p>
        </div>
      }

      @if (aba()==='lavanderia') {
        <div class="cards">
          @for (s of saldoEnxoval(); track s[0]) {
            <div class="card"><span>{{ s[0] }}</span><strong>{{ s[1] }}</strong><small>em estoque</small></div>
          } @empty {
            <p class="vazio">Enxoval sem movimentações — registre a primeira abaixo.</p>
          }
        </div>

        <div class="bloco">
          <h3>Lotes de lavanderia
            <button class="btn-mini" (click)="modalLote.set(true)">Novo lote</button>
            <button class="btn-mini" (click)="fecharMes()">Fechar mês (conta a pagar)</button>
          </h3>
          <table>
            <thead><tr><th>Fornecedor</th><th>Competência</th><th>Enviado</th><th>Itens</th><th>Devolvidos</th><th>Custo</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (l of lotes(); track l.id) {
                <tr>
                  <td>{{ l.fornecedor }}</td>
                  <td>{{ l.competencia | date:'MM/yyyy' }}</td>
                  <td>{{ l.enviado_em | date:'dd/MM' }}</td>
                  <td>{{ l.qtd_itens }}</td>
                  <td>{{ l.qtd_devolvida }}</td>
                  <td>{{ brl(l.custo_centavos) }}</td>
                  <td><span class="st st-{{ l.status }}">{{ l.status.replace('_',' ') }}</span></td>
                  <td>
                    @if (l.status !== 'fechado' && l.qtd_devolvida < l.qtd_itens) {
                      <button class="btn-mini" (click)="devolver(l)">Devolução</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="vazio">Nenhum lote registrado.</td></tr>
              }
            </tbody>
          </table>
        </div>

        <div class="bloco">
          <h3>Movimentações de enxoval
            <button class="btn-mini" (click)="modalMov.set(true)">Registrar</button>
          </h3>
          <table>
            <thead><tr><th>Data</th><th>Peça</th><th>Qtd</th><th>Origem → Destino</th></tr></thead>
            <tbody>
              @for (m of movs(); track m.id) {
                <tr>
                  <td>{{ m.data | date:'dd/MM HH:mm' }}</td>
                  <td>{{ m.tipo_item }}</td>
                  <td>{{ m.quantidade }}</td>
                  <td>{{ m.origem }} → {{ m.destino }}</td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="vazio">Sem movimentações.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (modalLote()) {
        <div class="overlay" (click)="modalLote.set(false)" (keydown.escape)="modalLote.set(false)">
          <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Novo lote de lavanderia</h3>
            <label>Fornecedor <input [(ngModel)]="novoLote.fornecedor" /></label>
            <label>Quantidade de itens <input type="number" [(ngModel)]="novoLote.qtd_itens" /></label>
            <label>Custo total (R$) <input type="number" step="0.01" [(ngModel)]="novoLote.custo" /></label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalLote.set(false)">Cancelar</button>
              <button class="btn" [disabled]="!novoLote.fornecedor || !novoLote.qtd_itens" (click)="abrirLote()">Enviar lote</button>
            </div>
          </div>
        </div>
      }

      @if (modalMov()) {
        <div class="overlay" (click)="modalMov.set(false)" (keydown.escape)="modalMov.set(false)">
          <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Movimentação de enxoval</h3>
            <label>Peça <input [(ngModel)]="novaMov.tipo_item" placeholder="Lençol casal, toalha banho…" /></label>
            <label>Quantidade <input type="number" [(ngModel)]="novaMov.quantidade" /></label>
            <label>Origem
              <select [(ngModel)]="novaMov.origem">
                <option value="estoque">Estoque</option><option value="quarto">Quarto</option>
                <option value="lavanderia">Lavanderia</option><option value="descarte">Descarte</option>
              </select>
            </label>
            <label>Destino
              <select [(ngModel)]="novaMov.destino">
                <option value="quarto">Quarto</option><option value="lavanderia">Lavanderia</option>
                <option value="estoque">Estoque</option><option value="descarte">Descarte</option>
              </select>
            </label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalMov.set(false)">Cancelar</button>
              <button class="btn" [disabled]="!novaMov.tipo_item || !novaMov.quantidade" (click)="gravarMov()">Registrar</button>
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
    .filtros{display:flex;gap:.5rem;align-items:center}
    .filtros input{padding:.45rem .6rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.85rem}
    .abas{display:flex;gap:.4rem;border-bottom:1px solid var(--borda,#e3e6ea)}
    .aba{padding:.55rem 1rem;border:0;background:none;border-bottom:2px solid transparent;cursor:pointer;font-size:.88rem}
    .aba.ativa{border-bottom-color:#0b7285;font-weight:700}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem}
    .card{background:var(--card,#fff);border:1px solid var(--borda,#e3e6ea);border-radius:12px;padding:.9rem 1rem;display:flex;flex-direction:column;gap:.15rem}
    .card span{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut,#667)}
    .card strong{font-size:1.15rem}
    .card small{color:var(--mut,#667);font-size:.72rem}
    .bloco{background:var(--card,#fff);border:1px solid var(--borda,#e3e6ea);border-radius:12px;padding:1rem;overflow-x:auto}
    .bloco h3{margin:0 0 .75rem;font-size:.95rem;display:flex;align-items:center;gap:.6rem}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--borda,#eee)}
    th{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut,#667)}
    .st{padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:600}
    .st-pendente,.st-enviado,.st-devolvido_parcial{background:#fdf3d7;color:#8a6200}
    .st-em_andamento{background:#e8ecfd;color:#345}
    .st-concluida,.st-devolvido,.st-fechado{background:#e4f6e8;color:#146c2e}
    .critica td{background:#fff5f5}
    .acoes-td{white-space:nowrap}
    select{padding:.3rem .5rem;border:1px solid var(--borda,#ccd);border-radius:6px;font-size:.78rem}
    .btn-mini{font-size:.72rem;padding:.3rem .7rem;border-radius:6px;border:1px solid var(--borda,#ccd);background:#fff;cursor:pointer}
    .vazio{color:var(--mut,#667);font-size:.85rem;padding:.5rem 0}
    .overlay{position:fixed;inset:0;background:rgba(10,15,20,.45);display:flex;align-items:center;justify-content:center;z-index:60}
    .modal{background:#fff;border-radius:14px;padding:1.5rem;width:min(420px,92vw);display:flex;flex-direction:column;gap:.8rem}
    .modal h3{margin:0}
    .modal label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:600}
    .modal input,.modal select{padding:.55rem .65rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.9rem}
    .acoes{display:flex;gap:.6rem;margin-top:.4rem}
    .btn{flex:1;padding:.6rem;border:0;border-radius:8px;background:#0b7285;color:#fff;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}.btn-sec{padding:.6rem 1rem;border:1px solid var(--borda,#ccd);border-radius:8px;background:#fff;cursor:pointer}
  `],
})
export class GovernancaComponent implements OnInit {
  private readonly funcionariosApi = inject(FuncionariosApi);
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly notify = inject(Notify);

  protected readonly aba = signal<Aba>('quadro');
  protected readonly tarefas = signal<GovTarefa[]>([]);
  protected readonly previsao = signal<PrevisaoDia[]>([]);
  protected readonly lotes = signal<LavLote[]>([]);
  protected readonly movs = signal<EnxovalMov[]>([]);
  protected readonly saldoEnxoval = signal<[string, number][]>([]);
  protected readonly funcionarios = signal<{ id: number; nome: string }[]>([]);
  protected readonly modalLote = signal(false);
  protected readonly modalMov = signal(false);
  protected dataQuadro = new Date().toISOString().slice(0, 10);
  protected novoLote = { fornecedor: '', qtd_itens: 0, custo: 0 };
  protected novaMov = { tipo_item: '', quantidade: 1, origem: 'estoque', destino: 'lavanderia' };
  protected readonly tipoRotulo = TIPO_ROTULO;

  ngOnInit(): void {
    this.carregarQuadro();
    this.operacaoApi.govPrevisao().subscribe({ next: (p) => this.previsao.set(p), error: () => undefined });
    this.operacaoApi.lavLotes().subscribe({ next: (l) => this.lotes.set(l), error: () => undefined });
    this.operacaoApi.enxovalMovs().subscribe({ next: (m) => this.movs.set(m), error: () => undefined });
    this.operacaoApi.enxovalSaldo().subscribe({ next: (s) => this.saldoEnxoval.set(s), error: () => undefined });
    this.funcionariosApi.listarFuncionarios(1, 100, true).subscribe({
      next: (p) => this.funcionarios.set(p.items.map((f) => ({ id: f.id, nome: f.nome }))),
      error: () => undefined,
    });
  }

  carregarQuadro(): void {
    this.operacaoApi.govQuadro(this.dataQuadro).subscribe({
      next: (t) => this.tarefas.set(t),
      error: () => this.notify.erroMsg('Falha ao carregar tarefas.'),
    });
  }

  status(t: GovTarefa, status: StatusTarefaGov): void {
    this.operacaoApi.govStatus(t.id, status).subscribe({
      next: () => this.carregarQuadro(),
      error: () => this.notify.erroMsg('Não foi possível atualizar.'),
    });
  }

  atribuir(id: number, idfuncionario: number | null): void {
    if (!idfuncionario) return;
    this.operacaoApi.govAtribuir(id, idfuncionario).subscribe({
      next: () => this.notify.ok('Responsável atribuído.'),
      error: () => this.notify.erroMsg('Falha ao atribuir.'),
    });
  }

  gerarD1(): void {
    this.operacaoApi.govGerarD1().subscribe({
      next: (r) => this.notify.ok(`${r.criadas} tarefas geradas para amanhã.`),
      error: () => this.notify.erroMsg('Falha na geração.'),
    });
  }

  abrirLote(): void {
    this.operacaoApi.lavAbrir({
      fornecedor: this.novoLote.fornecedor,
      qtd_itens: this.novoLote.qtd_itens,
      custo_centavos: Math.round(this.novoLote.custo * 100),
    }).subscribe({
      next: () => { this.modalLote.set(false); this.ngOnInit(); this.notify.ok('Lote enviado.'); },
      error: () => this.notify.erroMsg('Falha ao registrar lote.'),
    });
  }

  devolver(l: LavLote): void {
    const qtd = l.qtd_itens - l.qtd_devolvida;
    this.operacaoApi.lavDevolver(l.id, qtd).subscribe({
      next: () => { this.operacaoApi.lavLotes().subscribe({ next: (x) => this.lotes.set(x), error: () => undefined }); },
      error: () => this.notify.erroMsg('Falha ao registrar devolução.'),
    });
  }

  fecharMes(): void {
    const comp = this.dataQuadro.slice(0, 7) + '-01';
    this.operacaoApi.lavFechar(comp).subscribe({
      next: (r) => this.notify.ok(`Competência fechada — conta a pagar #${r.idlancamento}.`),
      error: () => this.notify.erroMsg('Competência já fechada ou sem lotes.'),
    });
  }

  gravarMov(): void {
    this.operacaoApi.enxovalRegistrar(this.novaMov).subscribe({
      next: () => { this.modalMov.set(false); this.ngOnInit(); this.notify.ok('Movimentação registrada.'); },
      error: () => this.notify.erroMsg('Falha ao registrar.'),
    });
  }

  horas(min: number): string {
    return `${(min / 60).toFixed(1)}h`;
  }

  brl(c: number): string {
    return `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  }
}
