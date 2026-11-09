// Modal de identidade do hóspede — padrão dos PMS grandes:
// documentos de identidade (múltiplos, com órgão/país emissor e validade),
// scan digitalizado via webcam ou arquivo, e o arquivo digital da FNRH.

import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '@core/services/api.service';
import {
  Cliente,
  ClienteDocumento,
  DocumentoInput,
  Fnrh,
  TIPOS_DOCUMENTO,
  TipoDocumento,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Confirm } from '@core/services/confirm.service';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture.component';
import { imprimirFnrh } from '@shared/utils/fnrh-print';

/** Largura máxima da imagem de scan normalizada (upload de arquivo). */
const LARGURA_SCAN = 1600;

const TIPOS = Object.entries(TIPOS_DOCUMENTO) as [TipoDocumento, string][];

/** Campos pertinentes a cada tipo de documento — espelha o que os PMS pedem
 *  (CPF não tem emissor/validade; passaporte pede país, não UF; etc.). */
interface CamposDoc {
  orgao: boolean;
  uf: boolean;
  pais: boolean;
  validade: boolean;
  numLabel: string;
  numPlaceholder: string;
  orgaoPlaceholder: string;
}

const CAMPOS_DOC: Record<TipoDocumento, CamposDoc> = {
  rg: {
    orgao: true,
    uf: true,
    pais: false,
    validade: false,
    numLabel: 'Número do RG',
    numPlaceholder: '00.000.000-0',
    orgaoPlaceholder: 'SSP, IFP…',
  },
  cpf: {
    orgao: false,
    uf: false,
    pais: false,
    validade: false,
    numLabel: 'Número do CPF',
    numPlaceholder: '000.000.000-00',
    orgaoPlaceholder: '',
  },
  cnh: {
    orgao: true,
    uf: true,
    pais: false,
    validade: true,
    numLabel: 'Número da CNH',
    numPlaceholder: 'Registro de 11 dígitos',
    orgaoPlaceholder: 'DETRAN',
  },
  passaporte: {
    orgao: false,
    uf: false,
    pais: true,
    validade: true,
    numLabel: 'Número do passaporte',
    numPlaceholder: 'AA000000',
    orgaoPlaceholder: '',
  },
  rne: {
    orgao: true,
    uf: false,
    pais: true,
    validade: true,
    numLabel: 'Número do RNE/CRNM',
    numPlaceholder: 'V000000-0',
    orgaoPlaceholder: 'Polícia Federal',
  },
  outro: {
    orgao: true,
    uf: true,
    pais: true,
    validade: true,
    numLabel: 'Número do documento',
    numPlaceholder: '',
    orgaoPlaceholder: 'Órgão emissor',
  },
};

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
          <button type="button" class="close" aria-label="Fechar" (click)="fechou.emit()">&times;</button>
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
                        <span [class.vencido]="vencido(d)">{{ d.validade | date: 'dd/MM/yyyy' }}</span>
                        @if (vencido(d)) { <span class="tag-venc">vencido</span> }
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      @if (scans().get(d.id); as url) {
                        <button type="button" class="scan-thumb" title="Ampliar scan" (click)="ampliado.set(url)">
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
                        type="button" class="badge-acao bg-dark-blue" title="Digitalizar pela câmera"
                        aria-label="Digitalizar pela câmera" (click)="docScan.set(d)"
                      ><mat-icon>photo_camera</mat-icon></button>
                      <button
                        type="button" class="badge-acao bg-dark-blue" title="Enviar arquivo de imagem"
                        aria-label="Enviar arquivo de imagem" (click)="alvoArquivo.set(d); arq.click()"
                      ><mat-icon>upload</mat-icon></button>
                      @if (d.tem_scan) {
                        <button
                          type="button" class="badge-acao bg-yellow" title="Remover scan"
                          aria-label="Remover scan" (click)="removerScan(d)"
                        ><mat-icon>hide_image</mat-icon></button>
                      }
                      <button
                        type="button" class="badge-acao bg-yellow" title="Editar dados"
                        aria-label="Editar dados" (click)="editar(d)"
                      ><mat-icon>edit</mat-icon></button>
                      <button
                        type="button" class="badge-acao bg-danger" title="Excluir documento"
                        aria-label="Excluir documento" (click)="excluir(d)"
                      ><mat-icon>delete</mat-icon></button>
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
                  <mat-icon>info</mat-icon> Já existe um {{ rotulo(form.controls.tipo.value) }} cadastrado para este hóspede.
                </p>
              }
              <div class="doc-form-acoes">
                @if (editando()) {
                  <button type="button" class="btn-gray" (click)="cancelarEdicao()">Cancelar</button>
                }
                <button type="submit" class="btn-green" [disabled]="form.invalid">
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
                          type="button" class="badge-acao bg-dark-blue" title="Imprimir ficha"
                          (click)="imprimirFnrh(f)"
                        ><mat-icon>print</mat-icon></button>
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
      <div class="overlay overlay-zoom" (click.self)="ampliado.set(null)" role="dialog" aria-modal="true" aria-label="Scan ampliado">
        <div class="zoom-box">
          <button type="button" class="close zoom-close" aria-label="Fechar" (click)="ampliado.set(null)">&times;</button>
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
    .overlay-doc { z-index: 105; }
    .overlay-zoom { z-index: 115; }
    .modal-doc { max-width: 780px; }
    .modal-body { gap: 12px; }
    .center { display: grid; place-items: center; padding: 32px; }
    .sec { font-size: 0.9rem; font-weight: 600; display: block; }
    .sec.bt { border-top: 1px solid #d7e0e6; padding-top: 12px; }
    table.sm { font-size: 80%; }
    .muted { color: #7d97a1; }
    .tc { text-align: center; }
    .scan-thumb {
      border: 1px solid #c3d2d9; border-radius: 4px; padding: 0;
      width: 44px; height: 30px; overflow: hidden; cursor: zoom-in; background: #f7fafb;
    }
    .scan-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .scan-loading { font-size: 16px; width: 16px; height: 16px; color: #adb5bd; }
    .linha-acoes { white-space: nowrap; }
    .vazio {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; border: 1px dashed #c3d2d9; border-radius: 10px;
      background: #f7fafb; color: #5d6d7e;
    }
    .vazio mat-icon { color: #4b95ab; font-size: 28px; width: 28px; height: 28px; }
    .vazio div { display: flex; flex-direction: column; gap: 2px; }
    .vazio strong { color: #054054; font-size: 0.88rem; }
    .vazio span { font-size: 0.8rem; }
    .doc-form {
      border-top: 1px solid #e3eaef; padding-top: 14px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .doc-grid { display: grid; grid-template-columns: 1fr 1.3fr 1fr 80px; gap: 12px 14px; align-items: start; }
    .doc-grid:has(app-date) { grid-template-columns: repeat(3, 1fr); }
    .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .vencido { color: #dc3545; font-weight: 600; }
    .tag-venc {
      margin-left: 6px; padding: 1px 6px; border-radius: 999px;
      background: #fdecec; color: #dc3545; font-size: 0.7rem; font-weight: 700;
    }
    .aviso-dup {
      margin: 0; display: flex; align-items: center; gap: 6px;
      font-size: 0.78rem; color: #8a5a10; background: #fdf7ec;
      border: 1px solid #f0dcb4; border-radius: 8px; padding: 6px 10px;
    }
    .aviso-dup mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .bg-danger { background: #c0392b; color: #fff; }
    .doc-form-acoes { display: flex; justify-content: flex-end; gap: 8px; }
    .lbl2 { font-size: 0.78rem; font-weight: 600; color: #374151; display: flex; flex-direction: column; gap: 6px; }
    .req { color: #dc3545; margin-left: 2px; }
    .uf { text-transform: uppercase; }
    @media (max-width: 700px) { .doc-grid, .doc-grid:has(app-date) { grid-template-columns: 1fr 1fr; } }
    .btn-green:disabled { opacity: .5; cursor: not-allowed; }
    .zoom-box { position: relative; max-width: 90vw; max-height: 90vh; }
    .zoom-box img { max-width: 90vw; max-height: 86vh; border-radius: 6px; display: block; }
    .zoom-close { position: absolute; top: -12px; right: -12px; }

  `,
})
export class DocumentosModalComponent implements OnInit, OnDestroy {
  readonly cliente = input.required<Cliente>();
  readonly fechou = output<void>();

  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(Confirm);

  protected readonly tipos = TIPOS;
  protected readonly docs = signal<ClienteDocumento[]>([]);
  protected readonly fichas = signal<Fnrh[]>([]);
  protected readonly carregando = signal(true);
  /** Documento em edição no form. */
  protected readonly editando = signal<ClienteDocumento | null>(null);
  /** Documento recebendo scan pela webcam. */
  protected readonly docScan = signal<ClienteDocumento | null>(null);
  /** Documento recebendo scan por arquivo. */
  private readonly alvoArquivo = signal<ClienteDocumento | null>(null);
  /** Scan ampliado (objectURL). */
  protected readonly ampliado = signal<string | null>(null);
  /** Miniaturas dos scans: id do documento → objectURL. */
  protected readonly scans = signal<ReadonlyMap<number, string>>(new Map());

  protected readonly form = this.fb.nonNullable.group({
    tipo: ['rg' as TipoDocumento, Validators.required],
    numero: ['', Validators.required],
    orgao_emissor: [''],
    uf_emissor: [''],
    pais_emissor: [''],
    validade: [''],
  });

  /** Tipo selecionado no form — reage também ao `editar()`/`reset()`. */
  private readonly tipoSel = toSignal(this.form.controls.tipo.valueChanges, {
    initialValue: this.form.controls.tipo.value,
  });
  /** Campos pertinentes ao tipo escolhido (labels, placeholders, visibilidade). */
  protected readonly campos = computed(() => CAMPOS_DOC[this.tipoSel()]);
  /** Já há documento do mesmo tipo (fora o que está em edição)? */
  protected readonly duplicado = computed(() => {
    const ed = this.editando();
    return this.docs().some((d) => d.tipo === this.tipoSel() && d.id !== ed?.id);
  });

  ngOnInit(): void {
    this.api.listarDocumentos(this.cliente().id).subscribe({
      next: (docs) => {
        this.docs.set(docs);
        this.carregando.set(false);
        this.carregarScans(docs);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    this.api.fnrhCliente(this.cliente().id).subscribe({
      next: (f) => this.fichas.set(f),
      error: () => undefined,
    });
  }

  ngOnDestroy(): void {
    for (const url of this.scans().values()) URL.revokeObjectURL(url);
    const ampliado = this.ampliado();
    if (ampliado && !ampliado.startsWith('blob:shared')) URL.revokeObjectURL(ampliado);
  }

  maiuscula(e: Event): void {
    const el = e.target as HTMLInputElement;
    const v = el.value.replace(/[^a-z]/gi, '').toUpperCase();
    if (v !== el.value) this.form.controls.uf_emissor.setValue(v);
  }

  /** Exibição com máscara para CPF/RG; demais tipos como digitados. */
  formatarNumero(d: ClienteDocumento): string {
    const n = d.numero.replace(/\D/g, '');
    if (d.tipo === 'cpf' && n.length === 11)
      return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (d.tipo === 'rg' && n.length === 9 && /^\d+$/.test(d.numero))
      return n.replace(/(\d{2})(\d{3})(\d{3})(\d)/, '$1.$2.$3-$4');
    return d.numero;
  }

  vencido(d: ClienteDocumento): boolean {
    if (!d.validade) return false;
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    return d.validade.slice(0, 10) < iso;
  }

  rotulo(t: TipoDocumento): string {
    return TIPOS_DOCUMENTO[t] ?? t;
  }

  emissor(d: ClienteDocumento): string {
    return [d.orgao_emissor, d.uf_emissor, d.pais_emissor].filter(Boolean).join('/') || '—';
  }

  editar(d: ClienteDocumento): void {
    this.editando.set(d);
    this.form.reset({
      tipo: d.tipo,
      numero: d.numero,
      orgao_emissor: d.orgao_emissor ?? '',
      uf_emissor: d.uf_emissor ?? '',
      pais_emissor: d.pais_emissor ?? '',
      validade: d.validade ?? '',
    });
  }

  cancelarEdicao(): void {
    this.editando.set(null);
    this.form.reset({ tipo: 'rg', numero: '' });
  }

  salvar(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const c = this.campos();
    const input: DocumentoInput = {
      tipo: v.tipo,
      numero: v.numero.trim(),
      // Campos ocultos para o tipo vão sempre como null — não guarda lixo.
      orgao_emissor: c.orgao ? v.orgao_emissor || null : null,
      uf_emissor: c.uf ? v.uf_emissor || null : null,
      pais_emissor: c.pais ? v.pais_emissor || null : null,
      validade: c.validade ? v.validade || null : null,
      version: this.editando()?.version,
    };
    const ed = this.editando();
    const op = ed
      ? this.api.atualizarDocumento(ed.id, input)
      : this.api.criarDocumento(this.cliente().id, input);
    op.subscribe({
      next: (salvo) => {
        this.docs.update((xs) =>
          ed ? xs.map((x) => (x.id === salvo.id ? salvo : x)) : [...xs, salvo],
        );
        this.cancelarEdicao();
        this.notify.ok(ed ? 'Documento atualizado.' : 'Documento adicionado.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  async excluir(d: ClienteDocumento): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir o ${this.rotulo(d.tipo)} ${this.formatarNumero(d)}?`,
      { titulo: 'Excluir documento', confirmar: 'Excluir', detalhe: 'O scan vinculado também será apagado.' },
    );
    if (!ok) return;
    this.api.removerDocumento(d.id).subscribe({
      next: () => {
        this.liberarScan(d.id);
        this.docs.update((xs) => xs.filter((x) => x.id !== d.id));
        this.notify.ok('Documento excluído.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // -- scan -----------------------------------------------------------------

  scanCapturado(d: ClienteDocumento, blob: Blob): void {
    this.docScan.set(null);
    this.enviarScan(d, blob);
  }

  arquivoScan(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const doc = this.alvoArquivo();
    this.alvoArquivo.set(null);
    if (!file || !doc) return;
    // Normaliza para JPEG ≤1600px de largura, mantendo a proporção.
    createImageBitmap(file)
      .then((bmp) => {
        const escala = Math.min(1, LARGURA_SCAN / bmp.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * escala);
        canvas.height = Math.round(bmp.height * escala);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          bmp.close();
          return null;
        }
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
        return new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      })
      .then((blob) => {
        if (blob) this.enviarScan(doc, blob);
        else this.notify.aviso('Não foi possível processar a imagem escolhida.');
      })
      .catch(() => this.notify.aviso('Não foi possível ler a imagem escolhida.'));
  }

  async removerScan(d: ClienteDocumento): Promise<void> {
    const ok = await this.confirm.perguntar(`Remover o scan do ${this.rotulo(d.tipo)}?`, {
      titulo: 'Remover scan',
      confirmar: 'Remover',
    });
    if (!ok) return;
    this.api.removerScanDocumento(d.id).subscribe({
      next: () => {
        this.liberarScan(d.id);
        this.docs.update((xs) =>
          xs.map((x) => (x.id === d.id ? { ...x, tem_scan: false } : x)),
        );
        this.notify.ok('Scan removido.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  imprimirFnrh(f: Fnrh): void {
    imprimirFnrh(f);
  }

  // -- internos ---------------------------------------------------------------

  private enviarScan(d: ClienteDocumento, blob: Blob): void {
    this.api.uploadScanDocumento(d.id, blob).subscribe({
      next: () => {
        this.docs.update((xs) =>
          xs.map((x) => (x.id === d.id ? { ...x, tem_scan: true } : x)),
        );
        this.liberarScan(d.id);
        this.carregarScans([{ ...d, tem_scan: true }]);
        this.notify.ok('Scan salvo.');
      },
      error: (e) => this.notify.erro(e),
    });
  }

  private carregarScans(lista: ClienteDocumento[]): void {
    for (const d of lista) {
      if (d.tem_scan && !this.scans().has(d.id)) {
        this.api.scanDocumento(d.id).subscribe({
          next: (b) =>
            this.scans.update((m) => {
              const n = new Map(m);
              n.set(d.id, URL.createObjectURL(b));
              return n;
            }),
          error: () => undefined,
        });
      }
    }
  }

  private liberarScan(id: number): void {
    const url = this.scans().get(id);
    if (url) URL.revokeObjectURL(url);
    this.scans.update((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
  }
}
