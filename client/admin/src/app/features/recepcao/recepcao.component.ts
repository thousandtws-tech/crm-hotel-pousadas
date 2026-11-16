import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ReservasApi } from '@core/api/reservas.api';
import { MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';

const DIA_MS = 86_400_000;

/** Recepção — front desk operacional: fluxo do dia + mapa de quartos em tempo real. */
@Component({
  selector: 'app-recepcao',
  imports: [DatePipe, RouterLink, MatIconModule],
  template: `
    <div class="fd">
      <!-- ============================ cabeçalho ============================ -->
      <header class="fd-head">
        <div>
          <p class="eyebrow">Front Desk</p>
          <h2 class="titulo">
            Recepção
            <span class="live" [class.live-on]="rt.online()" role="status">
              <i></i>{{ rt.online() ? 'Ao vivo' : 'Reconectando…' }}
            </span>
          </h2>
          <p class="sub">{{ hoje | date: "EEEE, d 'de' MMMM 'de' yyyy" }}</p>
        </div>
        <div class="fd-acoes">
          <button
            class="btn-ghost"
            type="button"
            (click)="carregar()"
            [disabled]="carregando()"
            aria-label="Atualizar painel"
            title="Atualizar"
          >
            <mat-icon>refresh</mat-icon>
          </button>
          <a class="btn-pri" routerLink="/reservas">
            <mat-icon>calendar_month</mat-icon> Reservas
          </a>
        </div>
      </header>

      <!-- ============================ KPIs do turno ============================ -->
      <div class="stats">
        <div class="stat">
          <div class="stat-txt">
            <span class="stat-l">Ocupação</span>
            <p><strong>{{ ocupacao() }}%</strong><small>{{ ocupados() }} de {{ mapa().length }} quartos</small></p>
            <div class="stat-bar" role="img" [attr.aria-label]="'Ocupação de ' + ocupacao() + '%'">
              <i [style.width.%]="ocupacao()"></i>
            </div>
          </div>
          <span class="stat-ico"><mat-icon>hotel</mat-icon></span>
        </div>
        <div class="stat">
          <div class="stat-txt">
            <span class="stat-l">Chegadas hoje</span>
            <p><strong [class.stat-warn]="chegadas().length > 0">{{ chegadas().length }}</strong>
              <small>{{ chegadas().length === 1 ? 'reserva' : 'reservas' }}</small></p>
          </div>
          <span class="stat-ico ico-in"><mat-icon>luggage</mat-icon></span>
        </div>
        <div class="stat">
          <div class="stat-txt">
            <span class="stat-l">Saídas hoje</span>
            <p><strong [class.stat-warn]="saidas().length > 0">{{ saidas().length }}</strong>
              <small>{{ saidas().length === 1 ? 'saída' : 'saídas' }}</small></p>
          </div>
          <span class="stat-ico ico-out"><mat-icon>meeting_room</mat-icon></span>
        </div>
        <div class="stat">
          <div class="stat-txt">
            <span class="stat-l">Na casa</span>
            <p><strong>{{ naCasa().length }}</strong>
              <small>{{ naCasa().length === 1 ? 'reserva' : 'reservas' }}</small></p>
          </div>
          <span class="stat-ico ico-casa"><mat-icon>king_bed</mat-icon></span>
        </div>
        <div class="stat">
          <div class="stat-txt">
            <span class="stat-l">Em atenção</span>
            <p><strong>{{ emAtencao() }}</strong>
              <small>{{ limpezaPend() }} limpeza · {{ manutAberta() }} manut.</small></p>
          </div>
          <span class="stat-ico ico-atn"><mat-icon>room_preferences</mat-icon></span>
        </div>
      </div>

      <div class="fd-grid">
        <!-- ==================== coluna operacional ==================== -->
        <div class="fd-col">
          <!-- ============ chegadas ============ -->
          <section class="fd-card">
            <header class="sec-head">
              <h3><mat-icon>how_to_reg</mat-icon> Chegadas</h3>
              <span class="pill p-arr">{{ chegadas().length }}</span>
            </header>
            @if (carregando()) {
              @for (s of skel; track s) { <div class="skel skel-row"></div> }
            } @else {
              @for (r of chegadas(); track r.id) {
                <div class="row">
                  <span class="av" [style.background]="avatarCor(r)">{{ iniciais(r.cliente_nome) }}</span>
                  <span class="row-txt">
                    <strong>{{ r.cliente_nome }}</strong>
                    <small>
                      {{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }} ·
                      {{ r.quantidade_hospedes }} {{ r.quantidade_hospedes === 1 ? 'hóspede' : 'hóspedes' }} ·
                      {{ diarias(r) }} {{ diarias(r) === 1 ? 'diária' : 'diárias' }}
                    </small>
                  </span>
                  <button
                    class="btn-ck"
                    type="button"
                    [disabled]="aguardando() === r.id"
                    (click)="checkin(r)"
                  >
                    <mat-icon>key</mat-icon>
                    {{ aguardando() === r.id ? 'Check-in…' : 'Check-in' }}
                  </button>
                </div>
              } @empty {
                <p class="vazio">
                  <mat-icon>done_all</mat-icon>
                  Todas as chegadas previstas já entraram.
                </p>
              }
            }
          </section>

          <!-- ============ saídas ============ -->
          <section class="fd-card">
            <header class="sec-head">
              <h3><mat-icon>meeting_room</mat-icon> Saídas</h3>
              <span class="pill p-out">{{ saidas().length }}</span>
            </header>
            @if (carregando()) {
              @for (s of skel; track s) { <div class="skel skel-row"></div> }
            } @else {
              @for (r of saidas(); track r.id) {
                <a class="row link" [routerLink]="['/reservas', r.id]">
                  <span class="av av-out" [style.background]="avatarCor(r)">{{ iniciais(r.cliente_nome) }}</span>
                  <span class="row-txt">
                    <strong>{{ r.cliente_nome }}</strong>
                    <small>{{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }} · sai hoje</small>
                  </span>
                  <span class="go">
                    <small>Check-out</small>
                    <mat-icon>chevron_right</mat-icon>
                  </span>
                </a>
              } @empty {
                <p class="vazio">
                  <mat-icon>done_all</mat-icon>
                  Nenhuma saída prevista para hoje.
                </p>
              }
            }
          </section>

          <!-- ============ na casa ============ -->
          <section class="fd-card">
            <header class="sec-head">
              <h3><mat-icon>king_bed</mat-icon> Hóspedes na casa</h3>
              <span class="pill p-casa">{{ naCasa().length }}</span>
            </header>
            @if (carregando()) {
              @for (s of skel; track s) { <div class="skel skel-row"></div> }
            } @else {
              @for (r of naCasa(); track r.id) {
                <a class="row link" [routerLink]="['/reservas', r.id]">
                  <span class="av av-casa" [style.background]="avatarCor(r)">{{ iniciais(r.cliente_nome) }}</span>
                  <span class="row-txt">
                    <strong>{{ r.cliente_nome }}</strong>
                    <small>{{ r.acomodacao_nome }} Nº{{ r.acomodacao_numero }}</small>
                  </span>
                  <span class="go">
                    <small>até {{ r.saidaprevista | date: 'dd/MM' }}</small>
                    <mat-icon>chevron_right</mat-icon>
                  </span>
                </a>
              } @empty {
                <p class="vazio">
                  <mat-icon>bedtime</mat-icon>
                  Nenhum hóspede na casa.
                </p>
              }
            }
          </section>
        </div>

        <!-- ==================== mapa de quartos ==================== -->
        <section class="fd-card fd-mapa">
          <header class="sec-head">
            <h3><mat-icon>map</mat-icon> Mapa de quartos</h3>
            <div class="leg" role="list" aria-label="Legenda de status">
              <span role="listitem"><i class="dt lv"></i>Livre</span>
              <span role="listitem"><i class="dt oc"></i>Ocupado</span>
              <span role="listitem"><i class="dt pd"></i>Chega hoje</span>
              <span role="listitem"><i class="dt bq"></i>Bloqueado</span>
              <span role="listitem"><i class="dt lm"></i>Limpeza</span>
              <span role="listitem"><i class="dt mn"></i>Manutenção</span>
            </div>
          </header>

          @if (carregando()) {
            <div class="qt-grid">
              @for (s of skelMapa; track s) { <div class="skel skel-qt"></div> }
            </div>
          } @else {
            @for (a of andares(); track a.andar) {
              <div class="andar">
                <span class="andar-lbl">
                  {{ a.andar === 0 ? 'Térreo' : a.andar + 'º andar' }}
                  <em>{{ a.quartos.length }} {{ a.quartos.length === 1 ? 'quarto' : 'quartos' }}</em>
                </span>
                <div class="qt-grid">
                  @for (q of a.quartos; track q.id) {
                    <button
                      class="qt"
                      [class]="'qt ' + statusQuarto(q)"
                      type="button"
                      [routerLink]="q.idreserva_hoje ? ['/reservas', q.idreserva_hoje] : []"
                      [title]="q.nome + ' Nº' + q.numero + ' — ' + rotuloQuarto(q)"
                      [attr.aria-label]="q.nome + ' Nº' + q.numero + ' — ' + rotuloQuarto(q)"
                    >
                      <b>{{ q.numero }}</b>
                      <small>{{ q.nome }}</small>
                      @if (q.limpeza_pendente > 0 || q.manut_aberta > 0) {
                        <span class="qt-flags">
                          @if (q.limpeza_pendente > 0) {
                            <em class="flg lm" title="Limpeza pendente">
                              <mat-icon>cleaning_services</mat-icon>{{ q.limpeza_pendente }}
                            </em>
                          }
                          @if (q.manut_aberta > 0) {
                            <em class="flg mn" title="Manutenção aberta">
                              <mat-icon>build</mat-icon>{{ q.manut_aberta }}
                            </em>
                          }
                        </span>
                      }
                    </button>
                  }
                </div>
              </div>
            } @empty {
              <p class="vazio">
                <mat-icon>hotel</mat-icon>
                Nenhuma acomodação cadastrada.
              </p>
            }
          }
        </section>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .fd { display: flex; flex-direction: column; gap: 16px; max-width: 1440px; }

    /* ---------- cabeçalho ---------- */
    .fd-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap;
    }
    .eyebrow {
      margin: 0 0 4px; font-size: 0.72rem; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase; color: #3d6db5;
    }
    .titulo {
      margin: 0; font-family: var(--font-display);
      font-size: 1.45rem; font-weight: 700; color: #20242c; line-height: 1.1;
      display: flex; align-items: center; gap: 12px;
    }
    .sub { margin: 4px 0 0; font-size: 0.86rem; color: #66707e; text-transform: capitalize; }
    .live {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: var(--font-body); font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.05em; padding: 4px 11px; border-radius: 999px;
      background: #fbebec; color: #dc3545;
    }
    .live i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .live-on { background: #e6f3ec; color: #198754; }
    .live-on i { animation: pulso 2s infinite; }
    @keyframes pulso { 50% { opacity: 0.5; } }

    .fd-acoes { display: flex; gap: 8px; align-items: center; }
    .btn-ghost {
      width: 40px; height: 40px; border-radius: 10px;
      border: 1px solid #dde2e8; background: #fff; color: #55606d;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: border-color 0.15s, color 0.15s;
    }
    .btn-ghost:hover:not(:disabled) { border-color: #2457a7; color: #2457a7; }
    .btn-ghost:disabled { opacity: 0.5; }
    .btn-ghost mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .btn-pri {
      display: inline-flex; align-items: center; gap: 7px;
      background: #20242c; color: #fff; border-radius: 10px;
      padding: 0 18px; height: 40px; font-size: 0.86rem; font-weight: 700;
      text-decoration: none; transition: background 0.15s;
    }
    .btn-pri:hover { background: #2457a7; color: #fff; }
    .btn-pri mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* ---------- KPIs ---------- */
    .stats {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
    .stat {
      background: #fff; border: 1px solid #e9ecf0; border-radius: 12px;
      padding: 15px 16px; display: flex; align-items: flex-start;
      justify-content: space-between; gap: 10px;
    }
    .stat-txt { min-width: 0; }
    .stat-l {
      font-size: 0.72rem; font-weight: 700; color: #66707e;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .stat p { margin: 7px 0 0; display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
    .stat strong {
      font-family: var(--font-display); font-size: 1.45rem; font-weight: 700;
      color: #20242c; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .stat-warn { color: #b45309; }
    .stat small { font-size: 0.76rem; color: #66707e; }
    .stat-ico {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      background: #f0f2f5; color: #20242c;
      display: flex; align-items: center; justify-content: center;
    }
    .stat-ico mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .ico-in { background: #e6f3ec; color: #198754; }
    .ico-out { background: #fef3e0; color: #b45309; }
    .ico-casa { background: #e8eef8; color: #2457a7; }
    .ico-atn { background: #fef3e0; color: #b45309; }
    .stat-bar {
      margin-top: 8px; height: 6px; border-radius: 99px;
      background: #f0f2f5; overflow: hidden;
    }
    .stat-bar i {
      display: block; height: 100%; border-radius: 99px;
      background: #2457a7;
      transition: width 0.4s ease;
    }

    /* ---------- grade principal ---------- */
    .fd-grid {
      display: grid; gap: 16px; align-items: start;
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    }
    @media (max-width: 1024px) { .fd-grid { grid-template-columns: 1fr; } }
    .fd-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

    .fd-card {
      background: #fff; border: 1px solid #e9ecf0; border-radius: 14px;
      padding: 16px 18px; min-width: 0;
    }
    .sec-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 10px; flex-wrap: wrap;
    }
    .sec-head h3 {
      margin: 0; font-family: var(--font-display);
      font-size: 1.35rem; font-weight: 600; color: #20242c;
      display: flex; align-items: center; gap: 9px;
    }
    .sec-head h3 mat-icon { font-size: 20px; width: 20px; height: 20px; color: #3d6db5; }
    .pill {
      border-radius: 999px; padding: 3px 11px;
      font-size: 0.74rem; font-weight: 800; color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .p-arr { background: #198754; }
    .p-out { background: #b45309; }
    .p-casa { background: #2457a7; }

    /* ---------- linhas de hóspedes ---------- */
    .row {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 4px; border-top: 1px solid #eef3fb;
      color: inherit; text-decoration: none; border-radius: 8px;
    }
    .row:first-of-type { border-top: 0; }
    .row.link { transition: background 0.13s; }
    .row.link:hover { background: #f8f9fb; }
    .av {
      flex: none; width: 42px; height: 42px; border-radius: 50%;
      background: #2457a7; color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.78rem; font-weight: 800; letter-spacing: 0.03em;
    }
    .row-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .row-txt strong {
      font-size: 0.92rem; color: #1d4789; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row-txt small { font-size: 0.76rem; color: #66707e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .go { display: inline-flex; align-items: center; gap: 4px; color: #66707e; }
    .go small { font-size: 0.74rem; font-weight: 600; }
    .go mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .btn-ck {
      flex: none; display: inline-flex; align-items: center; gap: 6px;
      min-height: 42px; padding: 0 18px; border: none; border-radius: 10px;
      background: #198754; color: #fff; font-family: inherit;
      font-size: 0.85rem; font-weight: 700; cursor: pointer;
      transition: background 0.15s, transform 0.12s;
    }
    .btn-ck:hover:not(:disabled) { background: #0f5624; transform: translateY(-1px); }
    .btn-ck:disabled { opacity: 0.55; }
    .btn-ck mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .vazio {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      margin: 0; padding: 30px 16px; color: #66707e; font-size: 0.86rem;
      text-align: center;
    }
    .vazio mat-icon { font-size: 34px; width: 34px; height: 34px; color: #cbd2dc; }

    /* ---------- legenda ---------- */
    .leg { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.72rem; color: #55606d; }
    .leg span { display: inline-flex; align-items: center; gap: 4px; }
    .dt { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .dt.lv { background: #198754; } .dt.oc { background: #3d6db5; }
    .dt.pd { background: #b45309; } .dt.bq { background: #55606d; }
    .dt.lm { background: #3d6db5; } .dt.mn { background: #b45309; }

    /* ---------- mapa de quartos ---------- */
    .andar { margin-top: 14px; }
    .andar:first-of-type { margin-top: 2px; }
    .andar-lbl {
      display: flex; align-items: baseline; gap: 8px;
      font-size: 0.72rem; font-weight: 700; color: #66707e;
      text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 6px;
    }
    .andar-lbl em { font-style: normal; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .qt-grid {
      display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    }
    .qt {
      position: relative; min-height: 72px; padding: 8px 10px;
      border: 1px solid #e9ecf0; border-left: 5px solid;
      border-radius: 10px; background: #fff; cursor: pointer;
      display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
      font-family: inherit; text-align: left;
      transition: box-shadow 0.14s, transform 0.14s;
    }
    .qt:hover { box-shadow: 0 5px 14px rgba(61, 69, 82, 0.12); transform: translateY(-1px); }
    .qt b { font-size: 1.05rem; color: #20242c; line-height: 1.1; }
    .qt small {
      font-size: 0.68rem; color: #66707e;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .qt-livre { border-left-color: #198754; }
    .qt-livre b { color: #198754; }
    .qt-ocup { border-left-color: #3d6db5; background: #eef3fb; }
    .qt-pend { border-left-color: #b45309; background: #fdf9ec; }
    .qt-bloq { border-left-color: #55606d; background: #f0f2f5; opacity: 0.85; }
    .qt-bloq b, .qt-bloq small { color: #66707e; }
    .qt-flags { display: flex; gap: 5px; margin-top: 4px; }
    .flg {
      display: inline-flex; align-items: center; gap: 3px;
      font-style: normal; font-size: 0.66rem; font-weight: 700;
      border-radius: 8px; padding: 1px 6px;
    }
    .flg mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .flg.lm { background: #e8eef8; color: #2457a7; }
    .flg.mn { background: #fef3e0; color: #b45309; }

    /* ---------- skeleton ---------- */
    .skel {
      display: block; border-radius: 8px;
      background: linear-gradient(90deg, #f0f2f5 25%, #e9ecf0 50%, #f0f2f5 75%);
      background-size: 200% 100%; animation: shimmer 1.4s infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .skel-row { height: 64px; margin-top: 8px; }
    .skel-qt { height: 72px; }

    @media (prefers-reduced-motion: reduce) {
      .skel, .live-on i { animation: none; }
      .qt, .btn-ck, .row.link { transition: none; }
    }
    @media (max-width: 640px) {
      .titulo { font-size: 1.55rem; }
      .fd-card { padding: 14px; }
      .btn-ck { min-height: 46px; }
      .qt-grid { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
    }
  `,
})
export class RecepcaoComponent implements OnInit {
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);
  protected readonly rt = inject(Realtime);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly aguardando = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly skel = [1, 2, 3];
  protected readonly skelMapa = Array.from({ length: 18 }, (_, i) => i);

  private pendentes = 0;

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

  protected readonly ocupados = computed(
    () => this.mapa().filter((q) => q.status_hoje === 'i').length,
  );
  protected readonly ocupacao = computed(() => {
    const total = this.mapa().length;
    return total ? Math.round((this.ocupados() / total) * 100) : 0;
  });
  protected readonly limpezaPend = computed(() =>
    this.mapa().filter((q) => q.limpeza_pendente > 0).length,
  );
  protected readonly manutAberta = computed(() =>
    this.mapa().filter((q) => q.manut_aberta > 0).length,
  );
  protected readonly emAtencao = computed(() => this.limpezaPend() + this.manutAberta());

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'acomodacao', 'bloqueio');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
  }

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.pendentes = 3;
    this.carregando.set(true);
    const done = () => {
      if (--this.pendentes === 0) this.carregando.set(false);
    };
    const hoje = this.hoje.toISOString().slice(0, 10);
    this.reservasApi.listarReservas({ inicio: hoje, fim: hoje, status: 'p', porPagina: 50 }).subscribe({
      next: (p) => this.chegadas.set(p.items),
      error: (e) => this.notify.erro(e),
      complete: done,
    });
    this.reservasApi.listarReservas({ inicio: hoje, fim: hoje, status: 'i', porPagina: 100 }).subscribe({
      next: (p) => {
        this.naCasa.set(p.items);
        this.saidas.set(p.items.filter((r) => r.saidaprevista === hoje));
      },
      error: () => undefined,
      complete: done,
    });
    this.reservasApi.mapaQuartos().subscribe({
      next: (m) => this.mapa.set(m),
      error: () => undefined,
      complete: done,
    });
  }

  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.reservasApi.checkin(r.id, null, null).subscribe({
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

  statusQuarto(q: MapaQuarto): string {
    if (q.bloqueado) return 'qt-bloq';
    if (q.status_hoje === 'i') return 'qt-ocup';
    if (q.status_hoje === 'p') return 'qt-pend';
    return 'qt-livre';
  }

  rotuloQuarto(q: MapaQuarto): string {
    if (q.bloqueado) return 'Bloqueado';
    if (q.status_hoje === 'i') return 'Ocupado';
    if (q.status_hoje === 'p') return 'Chegada prevista hoje';
    return 'Livre';
  }

  iniciais(nome: string): string {
    const p = nome.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
  }

  /** Cor do avatar derivada do nome — estável entre recargas. */
  avatarCor(r: ReservaResumo): string {
    const cores = ['#2457a7', '#3d6db5', '#198754', '#b45309', '#2457a7', '#20242c'];
    let h = 0;
    for (const ch of r.cliente_nome) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return cores[h % cores.length];
  }

  diarias(r: ReservaResumo): number {
    const ini = new Date(r.entradaprevista + 'T12:00:00');
    const fim = new Date(r.saidaprevista + 'T12:00:00');
    return Math.max(1, Math.round((fim.getTime() - ini.getTime()) / DIA_MS));
  }
}
