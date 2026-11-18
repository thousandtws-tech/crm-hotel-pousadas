// UI de documentos-modal — template, estilos e bindings. A lógica vive em documentos-modal.store.ts.
import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Cliente } from '@core/models/clientes.models';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture.component';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import { DocumentosModalStore } from './documentos-modal.store';

@Component({
  selector: 'app-documentos-modal',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DateInputComponent,
    FotoCaptureComponent,
  ],
  template: `
    <div class="overlay overlay-doc" (click.self)="fechou.emit()">
      <div class="modal-inn modal-doc" role="dialog" aria-modal="true" aria-labelledby="titulo-doc">
        <div class="modal-head">
          <h5 id="titulo-doc">Documentos — {{ cliente().nome }}</h5>
          <button type="button" class="close" aria-label="Fechar" (click)="fechou.emit()">
            &times;
          </button>
        </div>
        <div class="modal-body">
          @if (carregando()) {
            <div class="center"><mat-spinner diameter="36" /></div>
          } @else {
            <!-- ============ lista de documentos ============ -->
            @if (!docs().length) {
              <div class="vazio">
                <mat-icon>badge</mat-icon>
                <div>
                  <strong>Nenhum documento cadastrado</strong>
                  <span>Adicione o primeiro documento de identidade abaixo.</span>
                </div>
              </div>
            } @else {
              <table class="plain bordered sm">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Número</th>
                    <th>Emissor</th>
                    <th>Validade</th>
                    <th>Scan</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of docs(); track d.id) {
                    <tr>
                      <td>{{ rotulo(d.tipo) }}</td>
                      <td class="num">{{ formatarNumero(d) }}</td>
                      <td>{{ emissor(d) }}</td>
                      <td>
                        @if (d.validade) {
                          <span [class.vencido]="vencido(d)">{{
                            d.validade | date: 'dd/MM/yyyy'
                          }}</span>
                          @if (vencido(d)) {
                            <span class="tag-venc">vencido</span>
                          }
                        } @else {
                          <span class="muted">—</span>
                        }
                      </td>
                      <td>
                        @if (scans().get(d.id); as url) {
                          <button
                            type="button"
                            class="scan-thumb"
                            title="Ampliar scan"
                            (click)="ampliado.set(url)"
                          >
                            <img [src]="url" alt="Scan do documento" />
                          </button>
                        } @else if (d.tem_scan) {
                          <mat-icon class="scan-loading">hourglass_top</mat-icon>
                        } @else {
                          <span class="muted">—</span>
                        }
                      </td>
                      <td class="linha-acoes">
                        <button
                          type="button"
                          class="acao-btn"
                          title="Digitalizar pela câmera"
                          aria-label="Digitalizar pela câmera"
                          (click)="docScan.set(d)"
                        >
                          <mat-icon>photo_camera</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn"
                          title="Enviar arquivo de imagem"
                          aria-label="Enviar arquivo de imagem"
                          (click)="alvoArquivo.set(d); arq.click()"
                        >
                          <mat-icon>upload</mat-icon>
                        </button>
                        @if (d.tem_scan) {
                          <button
                            type="button"
                            class="acao-btn"
                            title="Remover scan"
                            aria-label="Remover scan"
                            (click)="removerScan(d)"
                          >
                            <mat-icon>hide_image</mat-icon>
                          </button>
                        }
                        <button
                          type="button"
                          class="acao-btn"
                          title="Editar dados"
                          aria-label="Editar dados"
                          (click)="editar(d)"
                        >
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button
                          type="button"
                          class="acao-btn perigo"
                          title="Excluir documento"
                          aria-label="Excluir documento"
                          (click)="excluir(d)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            <input #arq type="file" accept="image/*" hidden (change)="arquivoScan($event)" />

            <!-- ============ form novo/edição ============ -->
            <form [formGroup]="form" class="doc-form" (ngSubmit)="salvar()" autocomplete="off">
              <span class="sec">{{ editando() ? 'Editar documento' : 'Novo documento' }}</span>
              <div class="doc-grid">
                <label class="lbl2">
                  <span>Tipo <span class="req" aria-hidden="true">*</span></span>
                  <select class="input-inn" formControlName="tipo">
                    @for (t of tipos; track t[0]) {
                      <option [ngValue]="t[0]">{{ t[1] }}</option>
                    }
                  </select>
                </label>
                <label class="lbl2">
                  <span>{{ campos().numLabel }} <span class="req" aria-hidden="true">*</span></span>
                  <input
                    class="input-inn"
                    type="text"
                    required
                    formControlName="numero"
                    [placeholder]="campos().numPlaceholder"
                  />
                </label>
                @if (campos().orgao) {
                  <label class="lbl2">
                    Órgão emissor
                    <input
                      class="input-inn"
                      type="text"
                      formControlName="orgao_emissor"
                      [placeholder]="campos().orgaoPlaceholder"
                    />
                  </label>
                }
                @if (campos().uf) {
                  <label class="lbl2">
                    UF emissor
                    <input
                      class="input-inn uf"
                      type="text"
                      formControlName="uf_emissor"
                      maxlength="2"
                      placeholder="SP"
                      (input)="maiuscula($event)"
                    />
                  </label>
                }
                @if (campos().pais) {
                  <label class="lbl2">
                    País emissor
                    <input class="input-inn" type="text" formControlName="pais_emissor" />
                  </label>
                }
                @if (campos().validade) {
                  <label class="lbl2">
                    Validade
                    <app-date formControlName="validade" />
                  </label>
                }
              </div>
              @if (duplicado()) {
                <p class="aviso-dup" role="status">
                  <mat-icon>info</mat-icon> Já existe um
                  {{ rotulo(form.controls.tipo.value) }} cadastrado para este hóspede.
                </p>
              }
              <div class="doc-form-acoes">
                @if (editando()) {
                  <button type="button" class="btn-gray" (click)="cancelarEdicao()">
                    Cancelar
                  </button>
                }
                <button type="submit" class="btn-dark-blue" [disabled]="form.invalid">
                  <mat-icon>save</mat-icon> {{ editando() ? 'Salvar' : 'Adicionar' }}
                </button>
              </div>
            </form>

            <!-- ============ arquivo digital FNRH ============ -->
            @if (fichas().length) {
              <span class="sec bt">Fichas de registro emitidas (FNRH)</span>
              <table class="plain bordered sm">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Reserva</th>
                    <th>Emitida em</th>
                    <th>Motivo da viagem</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of fichas(); track f.id) {
                    <tr>
                      <td>{{ f.id }}</td>
                      <td>{{ f.idreserva }}</td>
                      <td>{{ f.emitida_em | date: 'dd/MM/yyyy HH:mm' }}</td>
                      <td>{{ f.motivo_viagem ?? '—' }}</td>
                      <td class="linha-acoes">
                        <button
                          type="button"
                          class="acao-btn"
                          title="Imprimir ficha"
                          aria-label="Imprimir ficha"
                          (click)="imprimirFnrh(f)"
                        >
                          <mat-icon>print</mat-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        </div>
      </div>
    </div>

    <!-- scan ampliado -->
    @if (ampliado(); as url) {
      <div
        class="overlay overlay-zoom"
        (click.self)="ampliado.set(null)"
        role="dialog"
        aria-modal="true"
        aria-label="Scan ampliado"
      >
        <div class="zoom-box">
          <button
            type="button"
            class="close zoom-close"
            aria-label="Fechar"
            (click)="ampliado.set(null)"
          >
            &times;
          </button>
          <img [src]="url" alt="Scan do documento ampliado" />
        </div>
      </div>
    }

    <!-- captura pela webcam (modo documento) -->
    @if (docScan(); as d) {
      <app-foto-capture
        modo="documento"
        (confirmada)="scanCapturado(d, $event)"
        (cancelada)="docScan.set(null)"
      />
    }
  `,
  styles: `
    .overlay-doc {
      z-index: 330;
    }
    .overlay-zoom {
      z-index: 340;
    }
    .modal-doc {
      max-width: 780px;
    }
    .modal-body {
      gap: 12px;
    }
    .center {
      display: grid;
      place-items: center;
      padding: 32px;
    }
    .sec {
      font-size: 0.9rem;
      font-weight: 600;
      display: block;
    }
    .sec.bt {
      border-top: 1px solid #d7e0e6;
      padding-top: 12px;
    }
    table.sm {
      font-size: 80%;
    }
    .muted {
      color: #7d97a1;
    }
    .tc {
      text-align: center;
    }
    .scan-thumb {
      border: 1px solid #c3d2d9;
      border-radius: 4px;
      padding: 0;
      width: 44px;
      height: 30px;
      overflow: hidden;
      cursor: zoom-in;
      background: #f7fafb;
    }
    .scan-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .scan-loading {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #adb5bd;
    }
    .linha-acoes {
      white-space: nowrap;
    }
    .vazio {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border: 1px dashed #c3d2d9;
      border-radius: 10px;
      background: #f7fafb;
      color: #5d6d7e;
    }
    .vazio mat-icon {
      color: #adb5bd;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    .vazio div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .vazio strong {
      color: #054054;
      font-size: 0.88rem;
    }
    .vazio span {
      font-size: 0.8rem;
    }
    .doc-form {
      border-top: 1px solid #e3eaef;
      padding-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .doc-grid {
      display: grid;
      grid-template-columns: 1fr 1.3fr 1fr 80px;
      gap: 12px 14px;
      align-items: start;
    }
    .doc-grid:has(app-date) {
      grid-template-columns: repeat(3, 1fr);
    }
    .num {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .vencido {
      color: #dc3545;
      font-weight: 600;
    }
    .tag-venc {
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #fdecec;
      color: #dc3545;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .aviso-dup {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: #8a5a10;
      background: #fdf7ec;
      border: 1px solid #f0dcb4;
      border-radius: 8px;
      padding: 6px 10px;
    }
    .aviso-dup mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .acao-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      margin: 0 2px;
      border: 1px solid #d7e0e6;
      border-radius: 7px;
      background: #fff;
      color: #5d6d7e;
      cursor: pointer;
      transition:
        border-color 0.15s,
        color 0.15s,
        background 0.15s;
    }
    .acao-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .acao-btn:hover {
      border-color: #054054;
      color: #054054;
    }
    .acao-btn.perigo:hover {
      border-color: #b3261e;
      color: #b3261e;
      background: #fdf3f2;
    }
    .doc-form-acoes {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .lbl2 {
      font-size: 0.78rem;
      font-weight: 600;
      color: #374151;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .req {
      color: #dc3545;
      margin-left: 2px;
    }
    .uf {
      text-transform: uppercase;
    }
    @media (max-width: 700px) {
      .doc-grid,
      .doc-grid:has(app-date) {
        grid-template-columns: 1fr 1fr;
      }
    }
    .btn-dark-blue:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .zoom-box {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
    }
    .zoom-box img {
      max-width: 90vw;
      max-height: 86vh;
      border-radius: 6px;
      display: block;
    }
    .zoom-close {
      position: absolute;
      top: -12px;
      right: -12px;
    }
  `,
})
export class DocumentosModalComponent extends DocumentosModalStore {
  override readonly cliente = input.required<Cliente>();
  override readonly fechou = output<void>();
}
