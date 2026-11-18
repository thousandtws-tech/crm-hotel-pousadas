// UI de kds — template, estilos e bindings. A lógica vive em kds.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { KdsStore } from './kds.store';

@Component({
  selector: 'app-kds',
  imports: [MatIconModule, DatePipe],
  template: `
    <div class="page kds" [class.kds-offline]="!rt.online()">
      <header class="kds-head">
        <div>
          <p class="eyebrow">Operação</p>
          <h2 class="titulo">Cozinha</h2>
          <p class="sub">Do primeiro preparo à retirada, cada pedido no seu lugar.</p>
        </div>
        <div class="stats">
          <div class="stat">
            <strong>{{ colunaDe('pendente').tickets.length }}</strong> <span>A fazer</span>
          </div>
          <div class="stat">
            <strong>{{ colunaDe('em_preparo').tickets.length }}</strong> <span>Em preparo</span>
          </div>
          <div class="stat prontos">
            <strong>{{ colunaDe('pronto').tickets.length }}</strong> <span>Prontos</span>
          </div>
        </div>
      </header>

      @if (ticketsTotal() === 0 && !carregando()) {
        <div class="banner">
          <mat-icon>info</mat-icon>
          <div>
            <strong>Fila vazia</strong>
            <p>
              Acompanhe os novos pedidos por aqui. O som está
              {{ somAtivo() ? 'ativado' : 'desativado' }}.
            </p>
          </div>
        </div>
      }

      <div class="controles">
        <div class="seg" role="group" aria-label="Filtrar por etapa">
          @for (f of filtrosStatus; track f.v) {
            <button
              type="button"
              class="seg-btn"
              [class.ativo]="filtroStatus() === f.v"
              (click)="filtroStatus.set(f.v)"
            >
              {{ f.rotulo }}
            </button>
          }
        </div>
        <div class="controles-d">
          <select
            class="sel"
            [value]="filtroCategoria()"
            (change)="filtroCategoria.set($any($event.target).value)"
            aria-label="Filtrar por categoria"
          >
            <option value="todas">Todas as categorias</option>
            @for (c of categorias(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <button
            type="button"
            class="btn-som"
            [class.on]="somAtivo()"
            (click)="alternarSom()"
            [attr.aria-pressed]="somAtivo()"
          >
            <mat-icon>{{ somAtivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
            Som {{ somAtivo() ? 'ativado' : 'desativado' }}
          </button>
        </div>
      </div>

      <div class="resumo">
        <span
          >{{ ticketsTotal() }} {{ ticketsTotal() === 1 ? 'pedido' : 'pedidos' }} ·
          {{ itensTotal() }} {{ itensTotal() === 1 ? 'item' : 'itens' }}</span
        >
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
            <p>
              Novos pedidos de mesa, quarto ou balcão aparecerão em "A fazer". Mantenha este painel
              aberto para acompanhar a fila.
            </p>
          </div>
          <p class="qv-nota">
            <mat-icon>{{ somAtivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
            Som
            {{
              somAtivo()
                ? 'ativado — novos pedidos tocarão um aviso'
                : 'desativado. Ative no controle acima para ouvir novos pedidos'
            }}.
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
                  <article
                    class="ticket"
                    [class.atraso]="col.status === 'pendente' && t.minutos >= 15"
                  >
                    <header class="t-ref">
                      <span>Comanda Nº{{ t.idcomanda }}</span>
                      <span
                        >{{ t.itens.length }} {{ t.itens.length === 1 ? 'item' : 'itens' }}</span
                      >
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
                            @if (i.categoria_nome) {
                              <small>{{ i.categoria_nome }}</small>
                            }
                          </span>
                          @if (col.status !== 'pendente') {
                            <button
                              type="button"
                              class="t-undo"
                              [disabled]="ocupando().has(i.id)"
                              (click)="retornar(i)"
                              [attr.aria-label]="'Devolver ' + i.item_nome"
                              title="Devolver à etapa anterior"
                            >
                              <mat-icon>undo</mat-icon>
                            </button>
                          }
                        </li>
                      }
                    </ul>

                    @if (t.garcom || t.cliente) {
                      <p class="t-meta">
                        @if (t.garcom) {
                          <span><mat-icon>room_service</mat-icon>{{ t.garcom }}</span>
                        }
                        @if (t.cliente) {
                          <span><mat-icon>person</mat-icon>{{ t.cliente }}</span>
                        }
                      </p>
                    }

                    @switch (col.status) {
                      @case ('pendente') {
                        <button
                          type="button"
                          class="t-acao prim"
                          [disabled]="ocupandoTicket(t)"
                          (click)="acaoTicket(t, 'preparar')"
                        >
                          Iniciar preparo
                        </button>
                      }
                      @case ('em_preparo') {
                        <button
                          type="button"
                          class="t-acao prim"
                          [disabled]="ocupandoTicket(t)"
                          (click)="acaoTicket(t, 'pronto')"
                        >
                          Marcar como pronto
                        </button>
                      }
                      @case ('pronto') {
                        <p class="t-nota">
                          Aguardando o atendimento retirar. Confirme apenas após a retirada.
                        </p>
                        <button
                          type="button"
                          class="t-acao ghost"
                          [disabled]="ocupandoTicket(t)"
                          (click)="acaoTicket(t, 'entregar')"
                        >
                          Confirmar retirada
                        </button>
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
    .page {
      background: transparent;
      border: 0;
      box-shadow: none;
      padding: 4px 6px 40px;
      max-width: 1440px;
    }
    .kds {
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: calc(100vh - 120px);
    }
    .kds-offline .board {
      opacity: 0.55;
    }

    /* ---------- cabeçalho ---------- */
    .kds-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .eyebrow {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: #8fa3ab;
      margin: 0 0 4px;
    }
    .titulo {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 700;
      color: #054054;
      line-height: 1.1;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sub {
      margin: 4px 0 0;
      font-size: 0.86rem;
      color: #7d97a1;
    }

    .stats {
      display: flex;
      gap: 10px;
    }
    .stat {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .stat strong {
      font-size: 1.5rem;
      font-weight: 700;
      color: #054054;
      line-height: 1;
    }
    .stat span {
      font-size: 0.8rem;
      color: #5d6d7e;
      font-weight: 600;
    }
    .stat.prontos {
      background: #e9f4ec;
      border-color: #d2e8d8;
    }

    .banner {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: #eef4f6;
      border: 1px solid #d3e4ec;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .banner mat-icon {
      color: #054054;
      font-size: 20px;
      width: 20px;
      height: 20px;
      margin-top: 1px;
    }
    .banner strong {
      font-size: 0.88rem;
      color: #054054;
    }
    .banner p {
      margin: 3px 0 0;
      font-size: 0.8rem;
      color: #5d6d7e;
      line-height: 1.45;
    }

    /* ---------- controles ---------- */
    .controles {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .seg {
      display: inline-flex;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 4px;
      gap: 2px;
    }
    .seg-btn {
      border: 0;
      background: transparent;
      padding: 9px 18px;
      border-radius: 7px;
      font-size: 0.82rem;
      font-weight: 600;
      color: #5d6d7e;
      cursor: pointer;
    }
    .seg-btn:hover {
      color: #054054;
    }
    .seg-btn.ativo {
      background: #054054;
      color: #fff;
    }
    .controles-d {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .sel {
      height: 42px;
      padding: 0 12px;
      border: 1px solid #d7e0e6;
      border-radius: 9px;
      background: #fff;
      font-size: 0.84rem;
      color: #33424c;
    }
    .btn-som {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 42px;
      padding: 0 16px;
      border: 1px solid #d7e0e6;
      border-radius: 9px;
      background: #fff;
      color: #5d6d7e;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-som.on {
      border-color: #054054;
      color: #054054;
      background: #eef4f6;
    }
    .btn-som mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .resumo {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 0.78rem;
      color: #7d97a1;
      flex-wrap: wrap;
    }
    .resumo > span:first-child {
      font-weight: 700;
      color: #5d6d7e;
    }

    /* ---------- quadro kanban ---------- */
    .board {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .board {
        grid-template-columns: 1fr;
      }
    }
    .col-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .col-id {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .col-id mat-icon {
      color: #054054;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .col-id h3 {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      color: #054054;
    }
    .col-count {
      font-size: 0.78rem;
      font-weight: 800;
      color: #054054;
      background: #eef4f6;
      border-radius: 8px;
      padding: 4px 10px;
    }
    .col-pronto .col-count {
      background: #e3f3e6;
      color: #198754;
    }
    .col-ajuda {
      margin: 3px 0 12px;
      font-size: 0.76rem;
      color: #8a99a4;
    }
    .col-cards {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .col-vazia {
      border: 1px dashed #d7e0e6;
      border-radius: 12px;
      padding: 26px 14px;
      text-align: center;
      font-size: 0.8rem;
      color: #8fa3ab;
      background: rgba(255, 255, 255, 0.5);
    }

    /* ---------- ticket ---------- */
    .ticket {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ticket.atraso {
      border-color: #f3d3a7;
    }
    .t-ref {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #8a99a4;
    }
    .t-dest {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .t-dest mat-icon {
      color: #054054;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .t-dest strong {
      font-size: 1.05rem;
      font-weight: 700;
      color: #33424c;
    }
    .t-tempo {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.76rem;
      color: #7d97a1;
    }
    .t-tempo mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .t-alerta {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      background: #fdf3e2;
      border-radius: 8px;
      padding: 8px 11px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #92670b;
    }
    .t-alerta mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .t-pill {
      margin: 0;
      display: inline-flex;
      align-self: flex-start;
      font-size: 0.74rem;
      font-weight: 700;
      padding: 4px 11px;
      border-radius: 999px;
    }
    .t-pill.prep {
      background: #eef4f6;
      color: #054054;
    }
    .t-pill.pronto {
      background: #e3f3e6;
      color: #198754;
    }
    .t-itens {
      list-style: none;
      margin: 0;
      padding: 8px 0 0;
      border-top: 1px solid #f2f7f9;
      display: flex;
      flex-direction: column;
    }
    .t-itens li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 0;
    }
    .t-qtd {
      flex-shrink: 0;
      font-size: 0.8rem;
      font-weight: 800;
      color: #054054;
      background: #eef2f5;
      border-radius: 7px;
      padding: 5px 8px;
      min-width: 36px;
      text-align: center;
    }
    .t-item {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .t-item strong {
      font-size: 0.88rem;
      color: #33424c;
    }
    .t-item small {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .t-undo {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: #a5b6bf;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    li:hover .t-undo,
    .t-undo:focus-visible {
      opacity: 1;
    }
    .t-undo:hover {
      background: #fbeaea;
      color: #dc3545;
    }
    .t-undo mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .t-meta {
      display: flex;
      gap: 12px;
      margin: 0;
      font-size: 0.74rem;
      color: #7d97a1;
    }
    .t-meta span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .t-meta mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .t-nota {
      margin: 0;
      font-size: 0.74rem;
      color: #8a99a4;
      line-height: 1.45;
    }
    .t-acao {
      width: 100%;
      border-radius: 9px;
      padding: 13px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      touch-action: manipulation;
    }
    .t-acao.prim {
      border: 0;
      background: #054054;
      color: #fff;
    }
    .t-acao.prim:hover:not(:disabled) {
      background: #042f3d;
    }
    .t-acao.ghost {
      border: 1px solid #054054;
      background: #fff;
      color: #054054;
    }
    .t-acao.ghost:hover:not(:disabled) {
      background: #eef4f6;
    }
    .t-acao:disabled {
      opacity: 0.5;
      cursor: wait;
    }

    /* ---------- fila vazia ---------- */
    .quadro-vazio {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 14px;
      min-height: 380px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 40px 24px;
    }
    .quadro-vazio > mat-icon {
      font-size: 46px;
      width: 46px;
      height: 46px;
      color: #b9c4cb;
    }
    .quadro-vazio > p {
      margin: 0;
      color: #8a99a4;
      font-size: 0.92rem;
    }
    .qv-ico {
      width: 62px;
      height: 62px;
      border-radius: 50%;
      background: #eef4f6;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qv-ico mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
      color: #054054;
    }
    .qv-card {
      background: #eef4f6;
      border-radius: 10px;
      padding: 16px 20px;
      max-width: 480px;
    }
    .qv-card strong {
      font-size: 0.9rem;
      color: #054054;
    }
    .qv-card p {
      margin: 5px 0 0;
      font-size: 0.8rem;
      color: #5d6d7e;
      line-height: 1.5;
    }
    .qv-nota {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem !important;
    }
    .qv-nota mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .rodape-nota {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.76rem;
      color: #8fa3ab;
    }
    .rodape-nota mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `,
})
export class KdsComponent extends KdsStore {}
