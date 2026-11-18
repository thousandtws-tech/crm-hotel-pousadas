// UI de pagamentos-online — template, estilos e bindings. A lógica vive em pagamentos-online.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinPagamentosOnlineStore } from './pagamentos-online.store';

@Component({
  selector: 'app-fin-pagamentos-online',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <h2 class="pg-titulo">Pagamentos Online</h2>
          <p class="pg-sub">Recebimentos do site via Stripe — cartão e Pix</p>
        </div>
        <div class="filtros">
          <input type="date" [(ngModel)]="de" (change)="carregar()" aria-label="De" />
          <input type="date" [(ngModel)]="ate" (change)="carregar()" aria-label="Até" />
          <select [(ngModel)]="status" (change)="carregar()" aria-label="Status">
            <option value="">Todos os status</option>
            <option value="pago">Pagos</option>
            <option value="pendente">Pendentes</option>
            <option value="falhou">Recusados</option>
            <option value="expirado">Expirados</option>
            <option value="reembolsado">Reembolsados</option>
          </select>
        </div>
      </header>

      @if (resumo(); as r) {
        <div class="cards">
          <div class="card">
            <span>Recebido</span><strong>{{ brl(r.recebido_centavos) }}</strong>
            <small>{{ r.total_pagos }} pagamentos</small>
          </div>
          <div class="card">
            <span>Pendente</span><strong>{{ brl(r.pendente_centavos) }}</strong>
            <small>{{ r.total_pendentes }} aguardando</small>
          </div>
          <div class="card">
            <span>Reembolsado</span><strong>{{ brl(r.reembolsado_centavos) }}</strong>
          </div>
          <div class="card">
            <span>Recusados</span><strong>{{ r.total_recusados }}</strong>
          </div>
          <div class="card">
            <span>Cartão</span><strong>{{ brl(r.card_centavos) }}</strong>
          </div>
          <div class="card">
            <span>Pix</span><strong>{{ brl(r.pix_centavos) }}</strong>
          </div>
        </div>
      }

      @if (porAcomodacao().length) {
        <div class="bloco">
          <h3>Receita por acomodação</h3>
          <table>
            <thead>
              <tr>
                <th>Acomodação</th>
                <th>Pagamentos</th>
                <th>Recebido</th>
              </tr>
            </thead>
            <tbody>
              @for (a of porAcomodacao(); track a.idacomodacao) {
                <tr>
                  <td>{{ a.nome }}</td>
                  <td>{{ a.total_pagos }}</td>
                  <td>{{ brl(a.recebido_centavos) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="bloco">
        <h3>Transações</h3>
        @if (carregando()) {
          <p class="vazio">Carregando…</p>
        } @else if (!lista().length) {
          <p class="vazio">Nenhuma transação no período.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Reserva</th>
                <th>Hóspede</th>
                <th>Acomodação</th>
                <th>Tipo</th>
                <th>Método</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Data</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (p of lista(); track p.id) {
                <tr>
                  <td>#{{ p.idreserva }}</td>
                  <td>{{ p.cliente_nome }}</td>
                  <td>{{ p.acomodacao_nome }}</td>
                  <td>{{ rotTipo(p.tipo) }}</td>
                  <td>{{ p.metodo === 'pix' ? 'Pix' : p.metodo ? 'Cartão' : '—' }}</td>
                  <td>{{ brl(p.valor_centavos) }}</td>
                  <td>
                    <span class="st st-{{ p.status }}">{{ rotStatus(p.status) }}</span>
                  </td>
                  <td>{{ p.paid_em || p.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                  <td>
                    @if (podeReembolsar(p)) {
                      <button class="btn-mini" (click)="abrirReembolso(p)">Reembolsar</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      @if (modal(); as p) {
        <div class="overlay" (click)="modal.set(null)">
          <div class="modal" (click)="$event.stopPropagation()">
            <h3>Reembolsar pagamento #{{ p.id }}</h3>
            <p>
              Reserva #{{ p.idreserva }} · {{ p.cliente_nome }} ·
              {{ brl(p.valor_centavos - p.reembolsado_centavos) }} disponíveis
            </p>
            <label
              >Valor (deixe vazio para integral)
              <input
                type="number"
                step="0.01"
                min="0.01"
                [(ngModel)]="valorReembolso"
                placeholder="{{ brl(p.valor_centavos - p.reembolsado_centavos) }}"
              />
            </label>
            <label
              >Motivo
              <input type="text" [(ngModel)]="motivoReembolso" maxlength="200" />
            </label>
            <div class="acoes">
              <button class="btn" [disabled]="reembolsando()" (click)="confirmarReembolso(p)">
                {{ reembolsando() ? 'Processando…' : 'Confirmar reembolso' }}
              </button>
              <button class="btn-sec" (click)="modal.set(null)">Cancelar</button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .pg {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .pg-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .pg-titulo {
        font-size: 1.35rem;
        margin: 0;
      }
      .pg-sub {
        margin: 0.15rem 0 0;
        color: var(--mut, #667);
        font-size: 0.85rem;
      }
      .filtros {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .filtros input,
      .filtros select {
        padding: 0.45rem 0.6rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        font-size: 0.85rem;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 0.75rem;
      }
      .card {
        background: var(--card, #fff);
        border: 1px solid var(--borda, #e3e6ea);
        border-radius: 12px;
        padding: 0.9rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .card span {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--mut, #667);
      }
      .card strong {
        font-size: 1.15rem;
      }
      .card small {
        color: var(--mut, #667);
        font-size: 0.72rem;
      }
      .bloco {
        background: var(--card, #fff);
        border: 1px solid var(--borda, #e3e6ea);
        border-radius: 12px;
        padding: 1rem;
        overflow-x: auto;
      }
      .bloco h3 {
        margin: 0 0 0.75rem;
        font-size: 0.95rem;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.45rem 0.6rem;
        border-bottom: 1px solid var(--borda, #eee);
      }
      th {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--mut, #667);
      }
      .st {
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 600;
      }
      .st-pago {
        background: #e4f6e8;
        color: #146c2e;
      }
      .st-pendente {
        background: #fdf3d7;
        color: #8a6200;
      }
      .st-falhou,
      .st-expirado,
      .st-cancelado {
        background: #fde3e3;
        color: #a32;
      }
      .st-reembolsado,
      .st-reembolso_parcial {
        background: #e8ecfd;
        color: #345;
      }
      .btn-mini {
        font-size: 0.72rem;
        padding: 0.25rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--borda, #ccd);
        background: #fff;
        cursor: pointer;
      }
      .vazio {
        color: var(--mut, #667);
        font-size: 0.85rem;
        padding: 0.5rem 0;
      }
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 15, 20, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 60;
      }
      .modal {
        background: #fff;
        border-radius: 14px;
        padding: 1.5rem;
        width: min(430px, 92vw);
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
      }
      .modal h3 {
        margin: 0;
      }
      .modal p {
        margin: 0;
        font-size: 0.82rem;
        color: var(--mut, #667);
      }
      .modal label {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.78rem;
        font-weight: 600;
      }
      .modal input {
        padding: 0.55rem 0.65rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        font-size: 0.9rem;
      }
      .acoes {
        display: flex;
        gap: 0.6rem;
        margin-top: 0.4rem;
      }
      .btn {
        flex: 1;
        padding: 0.6rem;
        border: 0;
        border-radius: 8px;
        background: #b3261e;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.6;
      }
      .btn-sec {
        padding: 0.6rem 1rem;
        border: 1px solid var(--borda, #ccd);
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
      }
    `,
  ],
})
export class FinPagamentosOnlineComponent extends FinPagamentosOnlineStore {}
