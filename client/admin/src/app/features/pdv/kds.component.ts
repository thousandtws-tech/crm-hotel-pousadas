// Cozinha (KDS) — painel de pedidos 100% realtime, otimizado para touch.
// Layout: prancha UX/UI "Cozinha — Operação" (kanban em 3 etapas).
//
// Sincronização: sem polling. O Realtime (Phoenix Channels) entrega deltas
// das triggers `trg_delta_pdv_item`/`trg_delta_pdv_comanda`; o effect()
// assina os contadores por tabela e recarrega a fila — o service já
// debounceia 300ms. O relógio `agora` só re-renderiza o tempo decorrido.

import {
  Component, OnDestroy, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { FilaItemView, PdvItemStatus } from '../../core/models/api.models';

interface Ticket {
  idcomanda: number;
  destino: string;
  icone: string;
  cliente: string | null;
  garcom: string | null;
  recebido: string;
  itens: FilaItemView[];
  minutos: number;
}

interface Coluna {
  status: PdvItemStatus;
  rotulo: string;
  ajuda: string;
  icone: string;
  tickets: Ticket[];
}

type FiltroStatus = 'todos' | PdvItemStatus;

@Component({
  selector: 'app-kds',
  imports: [MatIconModule, DatePipe],
  template: `
    <div class="page kds" [class.kds-offline]="!rt.online()">
      <header class="kds-head">
        <div>
          <p class="eyebrow">Operação</p>
          <h2 class="titulo">Cozinha
            <span class="live" [class.live-on]="rt.online()" role="status">
              <i></i>{{ rt.online() ? 'Ao vivo' : 'Reconectando…' }}
            </span>
          </h2>
          <p class="sub">Do primeiro preparo à retirada, cada pedido no seu lugar.</p>
        </div>
        <div class="stats">
          <div class="stat"><strong>{{ colunaDe('pendente').tickets.length }}</strong>
            <span>A fazer</span></div>
          <div class="stat"><strong>{{ colunaDe('em_preparo').tickets.length }}</strong>
            <span>Em preparo</span></div>
          <div class="stat prontos"><strong>{{ colunaDe('pronto').tickets.length }}</strong>
            <span>Prontos</span></div>
        </div>
      </header>

      @if (ticketsTotal() === 0 && !carregando()) {
        <div class="banner">
          <mat-icon>info</mat-icon>
          <div>
            <strong>Fila vazia</strong>
            <p>Acompanhe os novos pedidos por aqui. O painel está
              {{ rt.online() ? 'ao vivo' : 'reconectando' }} e o som está
              {{ somAtivo() ? 'ativado' : 'desativado' }}.</p>
          </div>
        </div>
      }

      <div class="controles">
        <div class="seg" role="group" aria-label="Filtrar por etapa">
          @for (f of filtrosStatus; track f.v) {
            <button type="button" class="seg-btn" [class.ativo]="filtroStatus() === f.v"
                    (click)="filtroStatus.set(f.v)">{{ f.rotulo }}</button>
          }
        </div>
        <div class="controles-d">
          <select class="sel" [value]="filtroCategoria()"
                  (change)="filtroCategoria.set($any($event.target).value)"
                  aria-label="Filtrar por categoria">
            <option value="todas">Todas as categorias</option>
            @for (c of categorias(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <button type="button" class="btn-som" [class.on]="somAtivo()"
                  (click)="alternarSom()" [attr.aria-pressed]="somAtivo()">
            <mat-icon>{{ somAtivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
            Som {{ somAtivo() ? 'ativado' : 'desativado' }}
          </button>
        </div>
      </div>

      <div class="resumo">
        <span>{{ ticketsTotal() }} {{ ticketsTotal() === 1 ? 'pedido' : 'pedidos' }} ·
          {{ itensTotal() }} {{ itensTotal() === 1 ? 'item' : 'itens' }}</span>
        <span class="resumo-r">
          @if (rt.online()) { Ao vivo · atualização em tempo real }
          @else { Sem conexão — tentando reconectar }
        </span>
      </div>

      @if (carregando() && ticketsTotal() === 0) {
        <div class="quadro-vazio">
          <mat-icon>hourglass_top</mat-icon>
          <p>Carregando pedidos…</p>
        </div>
      } @else if (ticketsTotal() === 0) {
        <div class="quadro-vazio">
          <span class="qv-ico"><mat-icon>done_all</mat-icon></span>
          <div class="qv-card">
            <strong>Fila vazia — nenhum pedido aguardando.</strong>
            <p>Novos pedidos de mesa, quarto ou balcão aparecerão em "A fazer".
              Mantenha este painel aberto para acompanhar a fila.</p>
          </div>
          <p class="qv-nota">
            <mat-icon>{{ somAtivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
            Som {{ somAtivo() ? 'ativado — novos pedidos tocarão um aviso' : 'desativado. Ative no controle acima para ouvir novos pedidos' }}.
          </p>
        </div>
      } @else {
        <div class="board">
          @for (col of colunasVisiveis(); track col.status) {
            <section class="coluna" [class]="'col-' + col.status">
              <header class="col-head">
                <div class="col-id">
                  <mat-icon>{{ col.icone }}</mat-icon>
                  <h3>{{ col.rotulo }}</h3>
                </div>
                <span class="col-count">{{ col.tickets.length }}</span>
              </header>
              <p class="col-ajuda">{{ col.ajuda }}</p>

              <div class="col-cards">
                @for (t of col.tickets; track t.idcomanda) {
                  <article class="ticket" [class.atraso]="col.status === 'pendente' && t.minutos >= 15">
                    <header class="t-ref">
                      <span>Comanda Nº{{ t.idcomanda }}</span>
                      <span>{{ t.itens.length }} {{ t.itens.length === 1 ? 'item' : 'itens' }}</span>
                    </header>
                    <div class="t-dest">
                      <mat-icon>{{ t.icone }}</mat-icon>
                      <strong>{{ t.destino }}</strong>
                    </div>
                    <p class="t-tempo">
                      <mat-icon>schedule</mat-icon>
                      {{ t.recebido | date: 'HH:mm' }} · há {{ t.minutos }} min no painel
                    </p>

                    @if (col.status === 'pendente' && t.minutos >= 15) {
                      <p class="t-alerta">
                        <mat-icon>schedule</mat-icon>
                        Espera prolongada · {{ t.minutos }} min sem iniciar
                      </p>
                    } @else if (col.status === 'em_preparo') {
                      <p class="t-pill prep">Em preparo há {{ t.minutos }} min</p>
                    } @else if (col.status === 'pronto') {
                      <p class="t-pill pronto">Pronto há {{ t.minutos }} min</p>
                    }

                    <ul class="t-itens">
                      @for (i of t.itens; track i.id) {
                        <li>
                          <span class="t-qtd">{{ i.quantidade }}×</span>
                          <span class="t-item">
                            <strong>{{ i.item_nome }}</strong>
                            @if (i.categoria_nome) { <small>{{ i.categoria_nome }}</small> }
                          </span>
                          @if (col.status !== 'pendente') {
                            <button type="button" class="t-undo" [disabled]="ocupando().has(i.id)"
                                    (click)="retornar(i)"
                                    [attr.aria-label]="'Devolver ' + i.item_nome"
                                    title="Devolver à etapa anterior">
                              <mat-icon>undo</mat-icon>
                            </button>
                          }
                        </li>
                      }
                    </ul>

                    @if (t.garcom || t.cliente) {
                      <p class="t-meta">
                        @if (t.garcom) { <span><mat-icon>room_service</mat-icon>{{ t.garcom }}</span> }
                        @if (t.cliente) { <span><mat-icon>person</mat-icon>{{ t.cliente }}</span> }
                      </p>
                    }

                    @switch (col.status) {
                      @case ('pendente') {
                        <button type="button" class="t-acao prim" [disabled]="ocupandoTicket(t)"
                                (click)="acaoTicket(t, 'preparar')">Iniciar preparo</button>
                      }
                      @case ('em_preparo') {
                        <button type="button" class="t-acao prim" [disabled]="ocupandoTicket(t)"
                                (click)="acaoTicket(t, 'pronto')">Marcar como pronto</button>
                      }
                      @case ('pronto') {
                        <p class="t-nota">Aguardando o atendimento retirar. Confirme apenas
                          após a retirada.</p>
                        <button type="button" class="t-acao ghost" [disabled]="ocupandoTicket(t)"
                                (click)="acaoTicket(t, 'entregar')">Confirmar retirada</button>
                      }
                    }
                  </article>
                } @empty {
                  <div class="col-vazia">Nenhum pedido nesta etapa.</div>
                }
              </div>
            </section>
          }
        </div>
        <p class="rodape-nota">
          <mat-icon>flag</mat-icon>
          Mais antigos primeiro em cada etapa. O tempo do pedido conta desde o recebimento.
        </p>
      }
    </div>
  `,
  styles: `
    .page { background: transparent; border: 0; box-shadow: none;
      padding: 4px 6px 40px; max-width: 1440px; }
    .kds { display: flex; flex-direction: column; gap: 14px;
      min-height: calc(100vh - 120px); }
    .kds-offline .board { opacity: .55; }

    /* ---------- cabeçalho ---------- */
    .kds-head { display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; }
    .eyebrow { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: #4b95ab; margin: 0 0 4px; }
    .titulo { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.9rem; font-weight: 600; color: #054054; line-height: 1.1;
      display: flex; align-items: center; gap: 12px; }
    .sub { margin: 4px 0 0; font-size: 0.86rem; color: #7d97a1; }
    .live { display: inline-flex; align-items: center; gap: 6px;
      font-family: 'Manrope', sans-serif; font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.05em; padding: 4px 11px; border-radius: 999px;
      background: #fbeaea; color: #dc3545; }
    .live i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .live-on { background: #e3f3e6; color: #198754; }
    .live-on i { animation: pulso 2s infinite; }
    @keyframes pulso { 50% { opacity: .5; } }

    .stats { display: flex; gap: 10px; }
    .stat { background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 10px 20px; display: flex; align-items: center; gap: 10px; }
    .stat strong { font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.9rem; font-weight: 700; color: #054054; line-height: 1; }
    .stat span { font-size: 0.8rem; color: #5d6d7e; font-weight: 600; }
    .stat.prontos { background: #e9f4ec; border-color: #d2e8d8; }

    .banner { display: flex; gap: 12px; align-items: flex-start;
      background: #eef4f6; border: 1px solid #d3e4ec; border-radius: 12px;
      padding: 14px 16px; }
    .banner mat-icon { color: #054054; font-size: 20px; width: 20px; height: 20px;
      margin-top: 1px; }
    .banner strong { font-size: 0.88rem; color: #054054; }
    .banner p { margin: 3px 0 0; font-size: 0.8rem; color: #5d6d7e; line-height: 1.45; }

    /* ---------- controles ---------- */
    .controles { display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; }
    .seg { display: inline-flex; background: #fff; border: 1px solid #e3eaef;
      border-radius: 10px; padding: 4px; gap: 2px; }
    .seg-btn { border: 0; background: transparent; padding: 9px 18px;
      border-radius: 7px; font-size: 0.82rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; }
    .seg-btn:hover { color: #054054; }
    .seg-btn.ativo { background: #054054; color: #fff; }
    .controles-d { display: flex; gap: 8px; align-items: center; }
    .sel { height: 42px; padding: 0 12px; border: 1px solid #d7e0e6;
      border-radius: 9px; background: #fff; font-size: 0.84rem; color: #33424c; }
    .btn-som { display: inline-flex; align-items: center; gap: 7px; height: 42px;
      padding: 0 16px; border: 1px solid #d7e0e6; border-radius: 9px;
      background: #fff; color: #5d6d7e; font-size: 0.82rem; font-weight: 600;
      cursor: pointer; }
    .btn-som.on { border-color: #054054; color: #054054; background: #eef4f6; }
    .btn-som mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .resumo { display: flex; justify-content: space-between; gap: 10px;
      font-size: 0.78rem; color: #7d97a1; flex-wrap: wrap; }
    .resumo > span:first-child { font-weight: 700; color: #5d6d7e; }

    /* ---------- quadro kanban ---------- */
    .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .board { grid-template-columns: 1fr; } }
    .col-head { display: flex; align-items: center; justify-content: space-between; }
    .col-id { display: flex; align-items: center; gap: 8px; }
    .col-id mat-icon { color: #054054; font-size: 20px; width: 20px; height: 20px; }
    .col-id h3 { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.35rem; font-weight: 600; color: #054054; }
    .col-count { font-size: 0.78rem; font-weight: 800; color: #054054;
      background: #eef4f6; border-radius: 8px; padding: 4px 10px; }
    .col-pronto .col-count { background: #e3f3e6; color: #198754; }
    .col-ajuda { margin: 3px 0 12px; font-size: 0.76rem; color: #8a99a4; }
    .col-cards { display: flex; flex-direction: column; gap: 14px; }
    .col-vazia { border: 1px dashed #ddd4c4; border-radius: 12px;
      padding: 26px 14px; text-align: center; font-size: 0.8rem; color: #8fa3ab;
      background: rgba(255,255,255,.5); }

    /* ---------- ticket ---------- */
    .ticket { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .ticket.atraso { border-color: #f3d3a7; }
    .t-ref { display: flex; justify-content: space-between; font-size: 0.7rem;
      font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #8a99a4; }
    .t-dest { display: flex; align-items: center; gap: 9px; }
    .t-dest mat-icon { color: #054054; font-size: 22px; width: 22px; height: 22px; }
    .t-dest strong { font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.3rem; font-weight: 600; color: #33424c; }
    .t-tempo { display: flex; align-items: center; gap: 6px; margin: 0;
      font-size: 0.76rem; color: #7d97a1; }
    .t-tempo mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .t-alerta { display: flex; align-items: center; gap: 7px; margin: 0;
      background: #fdf3e2; border-radius: 8px; padding: 8px 11px;
      font-size: 0.78rem; font-weight: 600; color: #92670b; }
    .t-alerta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .t-pill { margin: 0; display: inline-flex; align-self: flex-start;
      font-size: 0.74rem; font-weight: 700; padding: 4px 11px;
      border-radius: 999px; }
    .t-pill.prep { background: #eef4f6; color: #054054; }
    .t-pill.pronto { background: #e3f3e6; color: #198754; }
    .t-itens { list-style: none; margin: 0; padding: 8px 0 0;
      border-top: 1px solid #f2f7f9; display: flex; flex-direction: column; }
    .t-itens li { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
    .t-qtd { flex-shrink: 0; font-size: 0.8rem; font-weight: 800; color: #054054;
      background: #eef2f5; border-radius: 7px; padding: 5px 8px; min-width: 36px;
      text-align: center; }
    .t-item { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .t-item strong { font-size: 0.88rem; color: #33424c; }
    .t-item small { font-size: 0.74rem; color: #8a99a4; }
    .t-undo { flex-shrink: 0; width: 28px; height: 28px; border: 0;
      border-radius: 7px; background: transparent; color: #a5b6bf;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; opacity: 0; transition: opacity .15s; }
    li:hover .t-undo, .t-undo:focus-visible { opacity: 1; }
    .t-undo:hover { background: #fbeaea; color: #dc3545; }
    .t-undo mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .t-meta { display: flex; gap: 12px; margin: 0; font-size: 0.74rem;
      color: #7d97a1; }
    .t-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .t-meta mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .t-nota { margin: 0; font-size: 0.74rem; color: #8a99a4; line-height: 1.45; }
    .t-acao { width: 100%; border-radius: 9px; padding: 13px;
      font-size: 0.88rem; font-weight: 700; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      touch-action: manipulation; }
    .t-acao.prim { border: 0; background: #054054; color: #fff; }
    .t-acao.prim:hover:not(:disabled) { background: #042f3d; }
    .t-acao.ghost { border: 1px solid #054054; background: #fff; color: #054054; }
    .t-acao.ghost:hover:not(:disabled) { background: #eef4f6; }
    .t-acao:disabled { opacity: .5; cursor: wait; }

    /* ---------- fila vazia ---------- */
    .quadro-vazio { background: #fff; border: 1px solid #e3eaef;
      border-radius: 14px; min-height: 380px; display: flex;
      flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 40px 24px; }
    .quadro-vazio > mat-icon { font-size: 46px; width: 46px; height: 46px;
      color: #b9c4cb; }
    .quadro-vazio > p { margin: 0; color: #8a99a4; font-size: 0.92rem; }
    .qv-ico { width: 62px; height: 62px; border-radius: 50%;
      background: #eef4f6; display: flex; align-items: center;
      justify-content: center; }
    .qv-ico mat-icon { font-size: 30px; width: 30px; height: 30px;
      color: #054054; }
    .qv-card { background: #eef4f6; border-radius: 10px; padding: 16px 20px;
      max-width: 480px; }
    .qv-card strong { font-size: 0.9rem; color: #054054; }
    .qv-card p { margin: 5px 0 0; font-size: 0.8rem; color: #5d6d7e;
      line-height: 1.5; }
    .qv-nota { display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.78rem !important; }
    .qv-nota mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .rodape-nota { display: flex; align-items: center; gap: 6px; margin: 0;
      font-size: 0.76rem; color: #8fa3ab; }
    .rodape-nota mat-icon { font-size: 15px; width: 15px; height: 15px; }
  `,
})
export class KdsComponent implements OnInit, OnDestroy {
  protected readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly fila = signal<FilaItemView[]>([]);
  readonly carregando = signal(true);
  readonly agora = signal(Date.now());
  readonly filtroStatus = signal<FiltroStatus>('todos');
  readonly filtroCategoria = signal('todas');
  readonly somAtivo = signal(false);
  readonly ocupando = signal<ReadonlySet<number>>(new Set());

  readonly filtrosStatus: { v: FiltroStatus; rotulo: string }[] = [
    { v: 'todos', rotulo: 'Todos' },
    { v: 'pendente', rotulo: 'A fazer' },
    { v: 'em_preparo', rotulo: 'Em preparo' },
    { v: 'pronto', rotulo: 'Prontos' },
  ];

  private audio: AudioContext | null = null;
  private pendentesAntes = 0;
  private relogio: ReturnType<typeof setInterval> | null = null;

  readonly categorias = computed(() => {
    const set = new Set<string>();
    for (const i of this.fila()) if (i.categoria_nome) set.add(i.categoria_nome);
    return [...set].sort();
  });

  /** Etapas do kanban — mesma ordem do quadro. */
  private readonly etapas: { status: PdvItemStatus; rotulo: string; ajuda: string; icone: string }[] = [
    { status: 'pendente', rotulo: 'A fazer', ajuda: 'Comece pelos pedidos mais antigos', icone: 'assignment' },
    { status: 'em_preparo', rotulo: 'Em preparo', ajuda: 'Marque quando estiver pronto', icone: 'skillet' },
    { status: 'pronto', rotulo: 'Prontos', ajuda: 'Aguardando retirada · não entregues', icone: 'done_all' },
  ];

  /** Tickets de uma etapa: comanda agrupada, só com os itens daquela etapa. */
  private ticketsDe(status: PdvItemStatus): Ticket[] {
    const fc = this.filtroCategoria();
    const mapa = new Map<number, Ticket>();
    for (const i of this.fila()) {
      if (i.status !== status) continue;
      if (fc !== 'todas' && i.categoria_nome !== fc) continue;
      let t = mapa.get(i.idcomanda);
      if (!t) {
        t = {
          idcomanda: i.idcomanda,
          destino: this.destino(i),
          icone: this.icone(i.comanda_tipo),
          cliente: i.cliente_nome,
          garcom: i.garcom_nome,
          recebido: i.criado_em,
          itens: [],
          minutos: 0,
        };
        mapa.set(i.idcomanda, t);
      }
      t.itens.push(i);
      if (i.criado_em < t.recebido) t.recebido = i.criado_em;
      t.minutos = Math.max(t.minutos, this.minutosItem(i.criado_em));
    }
    // mais antigos primeiro — mesmo critério do rodapé da prancha
    return [...mapa.values()].sort((a, b) => b.minutos - a.minutos);
  }

  colunaDe(status: PdvItemStatus): Coluna {
    const meta = this.etapas.find((e) => e.status === status)!;
    return { ...meta, tickets: this.ticketsDe(status) };
  }

  readonly colunasVisiveis = computed<Coluna[]>(() => {
    const f = this.filtroStatus();
    return this.etapas
      .filter((e) => f === 'todos' || e.status === f)
      .map((e) => ({ ...e, tickets: this.ticketsDe(e.status) }));
  });

  readonly ticketsTotal = computed(() =>
    this.colunasVisiveis().reduce((s, c) => s + c.tickets.length, 0),
  );
  readonly itensTotal = computed(() =>
    this.colunasVisiveis().reduce((s, c) => s + c.tickets.reduce((x, t) => x + t.itens.length, 0), 0),
  );

  constructor() {
    // 100% realtime — deltas das triggers recarregam a fila (debounce no service)
    effect(() => {
      this.rt.delta('pdv_comanda_item');
      this.rt.delta('pdv_comanda');
      this.carregar(false);
    });
  }

  ngOnInit(): void {
    this.carregar(true);
    this.relogio = setInterval(() => this.agora.set(Date.now()), 20_000);
  }

  ngOnDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.audio?.close().catch(() => undefined);
  }

  carregar(mostrarSpinner: boolean): void {
    if (mostrarSpinner) this.carregando.set(true);
    this.api.filaCozinha().subscribe({
      next: (f) => {
        const pendentes = f.filter((i) => i.status === 'pendente').length;
        if (this.somAtivo() && pendentes > this.pendentesAntes) this.bip();
        this.pendentesAntes = pendentes;
        this.fila.set(f);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erro('Não foi possível carregar a fila da cozinha.');
      },
    });
  }

  minutosItem(iso: string): number {
    return Math.max(0, Math.floor((this.agora() - new Date(iso).getTime()) / 60_000));
  }

  ocupandoTicket(t: Ticket): boolean {
    return t.itens.some((i) => this.ocupando().has(i.id));
  }

  /** Ação do card aplica a transição a todos os itens exibidos daquela etapa. */
  acaoTicket(t: Ticket, acao: 'preparar' | 'pronto' | 'entregar'): void {
    for (const i of t.itens) {
      if (acao === 'preparar') void this.transicao(i, () => this.api.prepararItem(i.idcomanda, i.id));
      else if (acao === 'pronto') void this.transicao(i, () => this.api.prontoItem(i.idcomanda, i.id));
      else void this.transicao(i, () => this.api.entregarItem(i.idcomanda, i.id));
    }
  }

  async retornar(i: FilaItemView): Promise<void> {
    await this.transicao(i, () => this.api.retornarItem(i.idcomanda, i.id));
  }

  alternarSom(): void {
    const on = !this.somAtivo();
    this.somAtivo.set(on);
    if (on && !this.audio) {
      this.audio = new AudioContext();
      void this.audio.resume();
    }
  }

  /** Update otimista + fallback para a fila real em caso de erro/conflito. */
  private async transicao(
    item: FilaItemView,
    req: () => ReturnType<ApiService['prepararItem']>,
  ): Promise<void> {
    if (this.ocupando().has(item.id)) return;
    this.ocupando.update((s) => new Set(s).add(item.id));
    req().subscribe({
      next: (novo) => {
        this.fila.update((f) => f.map((x) => (x.id === novo.id ? { ...x, status: novo.status } : x)));
        this.ocupando.update((s) => { const n = new Set(s); n.delete(item.id); return n; });
      },
      error: (e: { error?: { erro?: { mensagem?: string } } }) => {
        this.ocupando.update((s) => { const n = new Set(s); n.delete(item.id); return n; });
        this.notify.erro(e?.error?.erro?.mensagem ?? 'Ação recusada — o item mudou de estado.');
        this.carregar(false);
      },
    });
  }

  private destino(i: FilaItemView): string {
    if (i.mesa_numero) return `Mesa ${i.mesa_numero}`;
    if (i.quarto_numero) return `Quarto ${i.quarto_numero}`;
    return i.rotulo ? `Balcão · ${i.rotulo}` : 'Balcão';
  }

  private icone(tipo: FilaItemView['comanda_tipo']): string {
    return tipo === 'mesa' ? 'table_restaurant' : tipo === 'quarto' ? 'bed_double' : 'storefront';
  }

  private bip(): void {
    if (!this.audio) return;
    const t = this.audio.currentTime;
    for (const [ini, freq] of [[0, 880], [0.16, 1320]] as const) {
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, t + ini);
      gain.gain.exponentialRampToValueAtTime(0.001, t + ini + 0.14);
      osc.connect(gain).connect(this.audio.destination);
      osc.start(t + ini);
      osc.stop(t + ini + 0.15);
    }
  }
}
