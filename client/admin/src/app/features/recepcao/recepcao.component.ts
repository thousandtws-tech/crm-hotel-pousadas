import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '@core/services/api.service';
import { MapaQuarto, ReservaResumo } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';

/** Recepção mobile-first — check-in em 1 toque, saídas do dia e mapa de quartos. */
@Component({
  selector: 'app-recepcao',
  imports: [DatePipe, RouterLink, MatIconModule],
  template: `
    <div class="rec">
      <header class="rec-head">
        <div>
          <h1>Recepção</h1>
          <p class="rec-data">{{ hoje | date: "EEEE, dd 'de' MMMM" }}</p>
        </div>
        <button class="rec-ref" type="button" (click)="carregar()" aria-label="Atualizar">
          <mat-icon>refresh</mat-icon>
        </button>
      </header>

      <!-- ============ check-ins de hoje ============ -->
      <section class="rec-card">
        <h2><mat-icon>login</mat-icon> Check-ins de hoje <span class="pill">{{ chegadas().length }}</span></h2>
        @for (r of chegadas(); track r.id) {
          <div class="rec-item">
            <div class="rec-info">
              <strong>{{ r.cliente_nome }}</strong>
              <span>{{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }} · {{ r.quantidade_hospedes }} hóspede(s)</span>
            </div>
            <button class="rec-ck" type="button" [disabled]="aguardando() === r.id" (click)="checkin(r)">
              {{ aguardando() === r.id ? '…' : 'Check-in' }}
            </button>
          </div>
        } @empty {
          <p class="rec-vazio">Nenhuma chegada prevista para hoje.</p>
        }
      </section>

      <!-- ============ saídas de hoje ============ -->
      <section class="rec-card">
        <h2><mat-icon>logout</mat-icon> Check-outs de hoje <span class="pill out">{{ saidas().length }}</span></h2>
        @for (r of saidas(); track r.id) {
          <a class="rec-item link" [routerLink]="['/reservas', r.id]">
            <div class="rec-info">
              <strong>{{ r.cliente_nome }}</strong>
              <span>{{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }}</span>
            </div>
            <mat-icon>chevron_right</mat-icon>
          </a>
        } @empty {
          <p class="rec-vazio">Nenhuma saída prevista para hoje.</p>
        }
      </section>

      <!-- ============ na casa ============ -->
      <section class="rec-card">
        <h2><mat-icon>hotel</mat-icon> Hóspedes na casa <span class="pill in">{{ naCasa().length }}</span></h2>
        @for (r of naCasa(); track r.id) {
          <a class="rec-item link" [routerLink]="['/reservas', r.id]">
            <div class="rec-info">
              <strong>{{ r.cliente_nome }}</strong>
              <span>{{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }} · até {{ r.saidaprevista | date:'dd/MM' }}</span>
            </div>
            <mat-icon>chevron_right</mat-icon>
          </a>
        } @empty {
          <p class="rec-vazio">Nenhum hóspede na casa.</p>
        }
      </section>

      <!-- ============ mapa de quartos ============ -->
      <section class="rec-card">
        <h2><mat-icon>map</mat-icon> Status dos quartos</h2>
        <div class="rec-leg">
          <span><i class="dot lv"></i>Livre</span><span><i class="dot oc"></i>Ocupado</span>
          <span><i class="dot pd"></i>Pendente</span><span><i class="dot bq"></i>Bloq.</span>
          <span><i class="dot lm"></i>Limpeza</span><span><i class="dot mn"></i>Manut.</span>
        </div>
        @for (a of andares(); track a.andar) {
          <div class="rec-andar">
            <span class="rec-andar-lbl">{{ a.andar === 0 ? 'Térreo' : a.andar + 'º andar' }}</span>
            <div class="rec-quartos">
              @for (q of a.quartos; track q.id) {
                <button class="rec-quarto" [class]="classe(q)" type="button" [routerLink]="q.idreserva_hoje ? ['/reservas', q.idreserva_hoje] : []"
                  [attr.aria-label]="q.nome + ' Nº' + q.numero">
                  <b>{{ q.numero }}</b>
                  <i>
                    @if (q.limpeza_pendente > 0) { <em class="mini lm" title="Limpeza pendente">🧹</em> }
                    @if (q.manut_aberta > 0) { <em class="mini mn" title="Manutenção aberta">🔧</em> }
                  </i>
                </button>
              }
            </div>
          </div>
        } @empty {
          <p class="rec-vazio">Nenhuma acomodação cadastrada.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .rec { max-width: 560px; margin: 0 auto; padding: 12px 14px 32px; display: flex; flex-direction: column; gap: 12px; }
    .rec-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; }
    .rec-head h1 { margin: 0; font-size: 1.3rem; color: #054054; }
    .rec-data { margin: 0; font-size: .8rem; color: #8a99a4; text-transform: capitalize; }
    .rec-ref { background: #e8f4f8; border: none; border-radius: 10px; width: 44px; height: 44px; color: #054054; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .rec-card { background: #fff; border: 1px solid #e3eaef; border-radius: 12px; padding: 12px 14px; }
    .rec-card h2 { margin: 0 0 8px; font-size: .92rem; font-weight: 700; color: #054054; display: flex; align-items: center; gap: 6px; }
    .rec-card h2 mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pill { background: #054054; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: .72rem; }
    .pill.out { background: #8a4a00; } .pill.in { background: #1a6f8a; }
    .rec-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f0f4f6; text-decoration: none; color: inherit; }
    .rec-item:last-child { border-bottom: none; }
    .rec-info { flex: 1; display: flex; flex-direction: column; }
    .rec-info strong { font-size: .88rem; color: #212e36; }
    .rec-info span { font-size: .76rem; color: #8a99a4; }
    .rec-ck { min-width: 96px; min-height: 48px; border: none; border-radius: 10px; background: #054054; color: #fff; font-size: .9rem; font-weight: 700; cursor: pointer; }
    .rec-ck:disabled { opacity: .5; }
    .rec-vazio { margin: 6px 0; font-size: .82rem; color: #8a99a4; }
    .rec-leg { display: flex; flex-wrap: wrap; gap: 10px; font-size: .72rem; color: #5d6d7e; margin-bottom: 8px; }
    .rec-leg span { display: flex; align-items: center; gap: 4px; }
    .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dot.lv { background: #2e9e63; } .dot.oc { background: #c0392b; } .dot.pd { background: #e6a23c; }
    .dot.bq { background: #7a8a94; } .dot.lm { background: #f1c40f; } .dot.mn { background: #e67e22; }
    .rec-andar { margin-top: 8px; }
    .rec-andar-lbl { font-size: .72rem; font-weight: 700; color: #8a99a4; text-transform: uppercase; }
    .rec-quartos { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; margin-top: 4px; }
    .rec-quarto { min-height: 52px; border: none; border-radius: 10px; color: #fff; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
    .rec-quarto b { font-size: .85rem; }
    .rec-quarto i { font-style: normal; font-size: .68rem; }
    .rec-quarto.sq-livre { background: #2e9e63; }
    .rec-quarto.sq-ocup { background: #c0392b; }
    .rec-quarto.sq-pend { background: #e6a23c; }
    .rec-quarto.sq-bloq { background: #7a8a94; }
    .mini { font-style: normal; }
  `,
})
export class RecepcaoComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly aguardando = signal<number | null>(null);

  protected readonly andares = computed(() => {
    const porAndar = new Map<number, MapaQuarto[]>();
    for (const q of this.mapa()) {
      const l = porAndar.get(q.andar) ?? [];
      l.push(q);
      porAndar.set(q.andar, l);
    }
    return [...porAndar.entries()]
      .sort(([a], [b]) => b - a)
      .map(([andar, quartos]) => ({ andar, quartos }));
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    const hoje = this.hoje.toISOString().slice(0, 10);
    this.api.listarReservas({ inicio: hoje, fim: hoje, status: 'p', porPagina: 50 }).subscribe({
      next: (p) => this.chegadas.set(p.items),
      error: (e) => this.notify.erro(e),
    });
    this.api.listarReservas({ inicio: hoje, fim: hoje, status: 'i', porPagina: 100 }).subscribe({
      next: (p) => {
        this.naCasa.set(p.items);
        this.saidas.set(p.items.filter((r) => r.saidaprevista === hoje));
      },
      error: () => undefined,
    });
    this.api.mapaQuartos().subscribe({ next: (m) => this.mapa.set(m), error: () => undefined });
  }

  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.api.checkin(r.id, null, null).subscribe({
      next: () => {
        this.aguardando.set(null);
        this.notify.ok(`Check-in de ${r.cliente_nome} realizado.`);
        this.carregar();
      },
      error: (e) => {
        this.aguardando.set(null);
        this.notify.erro(e);
      },
    });
  }

  classe(q: MapaQuarto): string {
    if (q.bloqueado) return 'rec-quarto sq-bloq';
    if (q.status_hoje === 'i') return 'rec-quarto sq-ocup';
    if (q.status_hoje === 'p') return 'rec-quarto sq-pend';
    return 'rec-quarto sq-livre';
  }
}
