// UI de reserva-fiscal — template, estilos e bindings. A lógica vive em reserva-fiscal.store.ts.
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ReservaFiscalStore } from './reserva-fiscal.store';

@Component({
  selector: 'app-reserva-fiscal',
  imports: [DatePipe, DecimalPipe, MatIconModule],
  template: `
    <div class="inner-card">
      <div class="inner-card-header spread">
        <h4>Notas fiscais (NFS-e)</h4>
        @if (podeEmitir()) {
          <button
            type="button"
            class="btn-dark-blue"
            (click)="preparar()"
            [disabled]="preparando()"
          >
            <mat-icon>receipt_long</mat-icon>
            {{ preparando() ? 'Preparando…' : 'Emitir NFS-e' }}
          </button>
        }
      </div>
      <div class="inner-card-body">
        @if (carregando()) {
          <p class="vazio">Carregando…</p>
        } @else if (docs().length === 0 && !previa()) {
          <p class="vazio">
            Nenhuma nota fiscal para esta reserva.
            @if (!integracaoOk()) {
              Configure a integração Spedy em Configurações → Integrações.
            }
          </p>
        }

        @if (previa(); as p) {
          <div class="previa">
            <div class="previa-h">
              <mat-icon>rate_review</mat-icon>
              <strong>Revisar antes de transmitir</strong>
            </div>
            <div class="previa-grid">
              <div>
                <span class="mini">Tomador</span>
                <strong>{{ tomadorNome(p) }}</strong>
                <span class="mini">{{ tomadorDoc(p) }}</span>
              </div>
              <div>
                <span class="mini">Valor total</span>
                <strong>R$ {{ p.valor_total | number: '1.2-2' }}</strong>
                <span class="mini">Competência {{ p.competencia | date: 'dd/MM/yyyy' }}</span>
              </div>
              <div class="span2">
                <span class="mini">Descrição</span>
                <span>{{ p.descricao }}</span>
              </div>
            </div>
            @if (p.aviso) {
              <p class="previa-aviso">{{ p.aviso }}</p>
            }
            @if (p.pendencias.length) {
              <ul class="pendencias">
                @for (pe of p.pendencias; track pe) {
                  <li>{{ pe }}</li>
                }
              </ul>
            }
            <div class="previa-acoes">
              <button
                type="button"
                class="btn-green"
                (click)="confirmar()"
                [disabled]="confirmando() || p.pendencias.length > 0"
                [title]="p.pendencias.length > 0 ? 'Resolva as pendências antes de transmitir' : ''"
              >
                {{ confirmando() ? 'Enfileirando…' : 'Confirmar e transmitir' }}
              </button>
              <button type="button" class="btn-gray" (click)="descartar()">
                Descartar rascunho
              </button>
            </div>
          </div>
        }

        @if (docs().length) {
          <table class="plain bordered sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Valor</th>
                <th>Nº nota</th>
                <th>Criada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of docs(); track d.id) {
                <tr>
                  <td>{{ d.id }}</td>
                  <td>
                    <span [class]="'my-badge ' + pillStatus(d.status)">
                      {{ rotuloStatus(d.status) }}
                    </span>
                    @if (d.ultimo_erro) {
                      <span class="mini erro doc-erro" [title]="d.ultimo_erro">
                        {{ d.ultimo_erro }}
                      </span>
                    }
                    @if (d.status_remoto && d.status === 'processando') {
                      <span class="mini">({{ d.status_remoto }})</span>
                    }
                  </td>
                  <td>R$ {{ d.valor_total | number: '1.2-2' }}</td>
                  <td>{{ d.numero_nota ?? '—' }}</td>
                  <td>{{ d.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                  <td class="doc-acoes">
                    @if (d.status === 'autorizada') {
                      <a
                        class="mini-btn"
                        [href]="arquivoUrl(d.id, 'pdf')"
                        target="_blank"
                        rel="noopener"
                        title="Baixar PDF"
                        ><mat-icon>picture_as_pdf</mat-icon></a
                      >
                      <a
                        class="mini-btn"
                        [href]="arquivoUrl(d.id, 'xml')"
                        target="_blank"
                        rel="noopener"
                        title="Baixar XML"
                        ><mat-icon>code</mat-icon></a
                      >
                      <button
                        type="button"
                        class="mini-btn perigo"
                        (click)="cancelar(d)"
                        [disabled]="ocupado()"
                        title="Solicitar cancelamento"
                      >
                        <mat-icon>cancel</mat-icon>
                      </button>
                    }
                    @if (
                      d.status === 'rejeitada' || d.status === 'falha' || d.status === 'rascunho'
                    ) {
                      <button
                        type="button"
                        class="mini-btn"
                        (click)="reprocessar(d)"
                        [disabled]="ocupado()"
                        title="Retransmitir após correção"
                      >
                        <mat-icon>refresh</mat-icon>
                      </button>
                    }
                    @if (d.status === 'enfileirada' || d.status === 'processando') {
                      <button
                        type="button"
                        class="mini-btn"
                        (click)="sincronizar(d)"
                        [disabled]="ocupado()"
                        title="Consultar status na Spedy"
                      >
                        <mat-icon>sync</mat-icon>
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
  styles: `
    .vazio {
      color: #8a989e;
      font-size: 0.85rem;
      text-align: center;
      padding: 14px;
    }
    .previa {
      border: 1px solid #cfe0e8;
      background: #f4f9fb;
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .previa-h {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #0c3c54;
    }
    .previa-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .previa-grid > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .span2 {
      grid-column: 1 / -1;
    }
    .mini {
      font-size: 0.72rem;
      color: #7a8a92;
    }
    .previa-aviso {
      margin: 0;
      font-size: 0.8rem;
      color: #5d4a08;
    }
    .pendencias {
      margin: 0;
      padding: 10px 12px 10px 28px;
      border-radius: 8px;
      background: #fdeceb;
      color: #7a1c15;
      font-size: 0.82rem;
    }
    .previa-acoes {
      display: flex;
      gap: 10px;
    }
    .doc-erro {
      display: block;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .doc-acoes {
      display: flex;
      gap: 6px;
    }
    .mini-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 6px;
      border: 1px solid #cfdce2;
      background: #eef4f6;
      color: #0c3c54;
      cursor: pointer;
      text-decoration: none;
    }
    .mini-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .mini-btn.perigo {
      color: #b3261e;
      border-color: #e6b8b4;
    }
    .mini-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .my-badge {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
    }
    .pill-ok {
      background: #e8f5e9;
      color: #1b5e20;
    }
    .pill-erro {
      background: #fdeceb;
      color: #7a1c15;
    }
    .pill-warn {
      background: #fef7e0;
      color: #5d4a08;
    }
    .pill-info {
      background: #e3f2fd;
      color: #0d47a1;
    }
    .pill-off {
      background: #eef1f3;
      color: #546b76;
    }
    @media (max-width: 720px) {
      .previa-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ReservaFiscalComponent extends ReservaFiscalStore {
  override readonly idreserva = input.required<number>();
}
