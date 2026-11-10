import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '@core/services/api.service';
import { Notify } from '@core/services/notify.service';
import {
  ManutOrdem, PmocRegistro, StatusManut, PrioridadeManut,
} from '@core/models/api.models';

type Aba = 'ordens' | 'pmoc';

const PRIORIDADES: PrioridadeManut[] = ['baixa', 'media', 'alta', 'urgente'];
const STATUS: StatusManut[] = ['aberta', 'em_execucao', 'aguardando_peca', 'concluida', 'cancelada'];

/** Manutenção — ordens de serviço e PMOC (Lei 13.589/2018). */
@Component({
  selector: 'app-manutencao',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Manutenção</h2>
          <p class="pg-sub">Ordens de serviço e PMOC — Lei 13.589/2018</p>
        </div>
        <button class="btn-mini" (click)="modalOrdem.set(true)">Nova OS</button>
      </header>

      <nav class="abas">
        <button class="aba" [class.ativa]="aba()==='ordens'" (click)="aba.set('ordens')">Ordens de serviço</button>
        <button class="aba" [class.ativa]="aba()==='pmoc'" (click)="aba.set('pmoc'); carregarPmoc()">PMOC</button>
      </nav>

      @if (aba()==='ordens') {
        <div class="filtros">
          @for (s of statusFiltros; track s.v) {
            <button class="chip" [class.ativa]="filtroStatus()===s.v" (click)="filtroStatus.set(s.v); carregar()">{{ s.r }}</button>
          }
        </div>
        <div class="bloco">
          <table>
            <thead><tr><th>#</th><th>Local</th><th>Título</th><th>Prioridade</th><th>Custo</th><th>Responsável</th><th>Aberta</th><th>Status</th></tr></thead>
            <tbody>
              @for (o of ordens(); track o.id) {
                <tr [class.critica]="o.prioridade==='urgente' && o.status!=='concluida'">
                  <td>{{ o.id }}</td>
                  <td>{{ o.idquarto ? 'Quarto '+o.idquarto : o.local }}</td>
                  <td>{{ o.titulo }}</td>
                  <td><span class="prio prio-{{ o.prioridade }}">{{ o.prioridade }}</span></td>
                  <td>{{ brl(o.custo_centavos) }}</td>
                  <td>{{ o.responsavel ?? '—' }}</td>
                  <td>{{ o.aberta_em | date:'dd/MM' }}</td>
                  <td>
                    <select [ngModel]="o.status" (ngModelChange)="mudarStatus(o, $event)" aria-label="Status">
                      @for (s of statusLista; track s) {
                        <option [ngValue]="s">{{ s.replace('_',' ') }}</option>
                      }
                    </select>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="vazio">Nenhuma ordem {{ filtroStatus() ? 'com status '+filtroStatus() : '' }}.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba()==='pmoc') {
        <div class="bloco">
          <h3>Checklist PMOC (10 itens obrigatórios)
            <button class="btn-mini" (click)="modalPmoc.set(true)">Registrar inspeção</button>
          </h3>
          @if (vencimentoPmoc(); as v) {
            <p class="aviso-pmoc" [class.vencido]="v.vencido">
              {{ v.vencido ? 'PMOC VENCIDO — ' : 'Próxima inspeção: ' }}{{ v.data | date:'dd/MM/yyyy' }}
            </p>
          }
          <table>
            <thead><tr><th>Data</th><th>Conformes</th><th>Responsável técnico</th><th>CREA/ART</th><th>Próxima</th></tr></thead>
            <tbody>
              @for (r of pmoc(); track r.id) {
                <tr>
                  <td>{{ r.referente_a | date:'dd/MM/yyyy' }}</td>
                  <td>{{ r.conformes }}/10</td>
                  <td>{{ r.responsavel_nome }}</td>
                  <td>{{ r.responsavel_crea }} · {{ r.responsavel_art }}</td>
                  <td>{{ r.proxima_data | date:'dd/MM/yyyy' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="vazio">Nenhuma inspeção registrada — a lei exige periodicidade.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (modalOrdem()) {
        <div class="overlay" (click)="modalOrdem.set(false)" (keydown.escape)="modalOrdem.set(false)">
          <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Nova ordem de serviço</h3>
            <label>Título <input [(ngModel)]="novaOrdem.titulo" placeholder="Ex.: Vazamento torneira" /></label>
            <label>Quarto (opcional)
              <input type="number" [(ngModel)]="novaOrdem.idquarto" placeholder="ID do quarto" />
            </label>
            <label>Local <input [(ngModel)]="novaOrdem.local" placeholder="Ex.: Cozinha, corredor…" /></label>
            <label>Prioridade
              <select [(ngModel)]="novaOrdem.prioridade">
                @for (p of prioridades; track p) {<option [ngValue]="p">{{ p }}</option>}
              </select>
            </label>
            <label>Descrição <textarea [(ngModel)]="novaOrdem.descricao" rows="3"></textarea></label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalOrdem.set(false)">Cancelar</button>
              <button class="btn" [disabled]="!novaOrdem.titulo" (click)="criarOrdem()">Abrir OS</button>
            </div>
          </div>
        </div>
      }

      @if (modalPmoc()) {
        <div class="overlay" (click)="modalPmoc.set(false)" (keydown.escape)="modalPmoc.set(false)">
          <div class="modal modal-lg" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Inspeção PMOC — checklist</h3>
            <div class="itens">
              @for (item of itensPmoc(); track item; let i = $index) {
                <label class="item-check">
                  <input type="checkbox" [(ngModel)]="checkPmoc[i]" /> {{ item }}
                </label>
              }
            </div>
            <label>Responsável técnico <input [(ngModel)]="pmocForm.nome" /></label>
            <div class="duo">
              <label>CREA <input [(ngModel)]="pmocForm.crea" placeholder="CREA-XX 000000" /></label>
              <label>ART <input [(ngModel)]="pmocForm.art" placeholder="nº da ART" /></label>
            </div>
            <label>Observações <textarea [(ngModel)]="pmocForm.obs" rows="2"></textarea></label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalPmoc.set(false)">Cancelar</button>
              <button class="btn" [disabled]="!pmocForm.nome" (click)="registrarPmoc()">Registrar inspeção</button>
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
    .abas{display:flex;gap:.4rem;border-bottom:1px solid var(--borda,#e3e6ea)}
    .aba{padding:.55rem 1rem;border:0;background:none;border-bottom:2px solid transparent;cursor:pointer;font-size:.88rem}
    .aba.ativa{border-bottom-color:#0b7285;font-weight:700}
    .filtros{display:flex;gap:.4rem;flex-wrap:wrap}
    .chip{padding:.3rem .75rem;border-radius:999px;border:1px solid var(--borda,#ccd);background:#fff;font-size:.75rem;cursor:pointer}
    .chip.ativa{background:#0b7285;color:#fff;border-color:#0b7285}
    .bloco{background:var(--card,#fff);border:1px solid var(--borda,#e3e6ea);border-radius:12px;padding:1rem;overflow-x:auto}
    .bloco h3{margin:0 0 .75rem;font-size:.95rem;display:flex;align-items:center;gap:.6rem}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--borda,#eee)}
    th{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut,#667)}
    .prio{padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:600}
    .prio-baixa{background:#eee;color:#555}
    .prio-media{background:#e8ecfd;color:#345}
    .prio-alta{background:#fdf3d7;color:#8a6200}
    .prio-urgente{background:#fde2e2;color:#a11}
    .critica td{background:#fff5f5}
    .aviso-pmoc{margin:0 0 .75rem;padding:.5rem .8rem;border-radius:8px;background:#e4f6e8;color:#146c2e;font-size:.8rem;font-weight:600}
    .aviso-pmoc.vencido{background:#fde2e2;color:#a11}
    select{padding:.3rem .5rem;border:1px solid var(--borda,#ccd);border-radius:6px;font-size:.78rem}
    .btn-mini{font-size:.72rem;padding:.3rem .7rem;border-radius:6px;border:1px solid var(--borda,#ccd);background:#fff;cursor:pointer}
    .vazio{color:var(--mut,#667);font-size:.85rem}
    .overlay{position:fixed;inset:0;background:rgba(10,15,20,.45);display:flex;align-items:center;justify-content:center;z-index:60}
    .modal{background:#fff;border-radius:14px;padding:1.5rem;width:min(420px,92vw);display:flex;flex-direction:column;gap:.8rem;max-height:90vh;overflow-y:auto}
    .modal-lg{width:min(560px,94vw)}
    .modal h3{margin:0}
    .modal label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:600}
    .modal input,.modal select,.modal textarea{padding:.55rem .65rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.9rem;font-family:inherit}
    .duo{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
    .itens{display:flex;flex-direction:column;gap:.35rem}
    .item-check{flex-direction:row!important;align-items:center;gap:.5rem;font-weight:400!important;font-size:.82rem}
    .acoes{display:flex;gap:.6rem;margin-top:.4rem}
    .btn{flex:1;padding:.6rem;border:0;border-radius:8px;background:#0b7285;color:#fff;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}.btn-sec{padding:.6rem 1rem;border:1px solid var(--borda,#ccd);border-radius:8px;background:#fff;cursor:pointer}
  `],
})
export class ManutencaoComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  protected readonly aba = signal<Aba>('ordens');
  protected readonly ordens = signal<ManutOrdem[]>([]);
  protected readonly pmoc = signal<PmocRegistro[]>([]);
  protected readonly itensPmoc = signal<string[]>([]);
  protected readonly filtroStatus = signal('');
  protected readonly modalOrdem = signal(false);
  protected readonly modalPmoc = signal(false);
  protected checkPmoc: boolean[] = Array(10).fill(true);
  protected readonly prioridades = PRIORIDADES;
  protected readonly statusLista = STATUS;
  protected readonly statusFiltros = [
    { v: '', r: 'Todas' }, { v: 'aberta', r: 'Abertas' },
    { v: 'em_execucao', r: 'Em execução' }, { v: 'aguardando_peca', r: 'Aguardando peça' },
  ];
  protected novaOrdem: { titulo: string; idquarto: number | null; local: string; prioridade: PrioridadeManut; descricao: string } =
    { titulo: '', idquarto: null, local: '', prioridade: 'media', descricao: '' };
  protected pmocForm = { nome: '', crea: '', art: '', obs: '' };

  ngOnInit(): void {
    this.carregar();
    this.api.pmocItens().subscribe({ next: (i) => this.itensPmoc.set(i), error: () => undefined });
  }

  carregar(): void {
    this.api.manutOrdens(this.filtroStatus() || undefined).subscribe({
      next: (o) => this.ordens.set(o),
      error: () => this.notify.erroMsg('Falha ao carregar ordens.'),
    });
  }

  carregarPmoc(): void {
    this.api.pmocListar().subscribe({ next: (p) => this.pmoc.set(p), error: () => undefined });
  }

  vencimentoPmoc(): { data: string; vencido: boolean } | null {
    const prox = this.pmoc()[0]?.proxima_data;
    if (!prox) return null;
    return { data: prox, vencido: prox < new Date().toISOString().slice(0, 10) };
  }

  mudarStatus(o: ManutOrdem, status: StatusManut): void {
    this.api.manutStatus(o.id, status).subscribe({
      next: () => this.carregar(),
      error: () => this.notify.erroMsg('Falha ao atualizar status.'),
    });
  }

  criarOrdem(): void {
    this.api.manutCriar({
      titulo: this.novaOrdem.titulo,
      idquarto: this.novaOrdem.idquarto || null,
      local: this.novaOrdem.local,
      prioridade: this.novaOrdem.prioridade,
      descricao: this.novaOrdem.descricao,
    }).subscribe({
      next: () => { this.modalOrdem.set(false); this.carregar(); this.notify.ok('OS aberta.'); },
      error: () => this.notify.erroMsg('Falha ao abrir OS.'),
    });
  }

  registrarPmoc(): void {
    const itens = this.itensPmoc().map((item, i) => ({ item, conforme: this.checkPmoc[i] ?? false, obs: '' }));
    this.api.pmocRegistrar({
      itens,
      responsavel_nome: this.pmocForm.nome,
      responsavel_crea: this.pmocForm.crea,
      responsavel_art: this.pmocForm.art,
      observacoes: this.pmocForm.obs,
    }).subscribe({
      next: () => { this.modalPmoc.set(false); this.carregarPmoc(); this.notify.ok('Inspeção registrada.'); },
      error: () => this.notify.erroMsg('Falha ao registrar inspeção.'),
    });
  }

  brl(c: number): string {
    return `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  }
}
