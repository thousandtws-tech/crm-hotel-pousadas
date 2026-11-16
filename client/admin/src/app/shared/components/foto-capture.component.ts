// Captura pela webcam — mesmo fluxo dos PMS de hotel (OPERA/Cloudbeds):
// preview ao vivo → capturar → revisar → confirmar/refazer.
// Dois modos: 'rosto' (retrato quadrado 640px, espelhado) e 'documento'
// (recorte paisagem ~CR80 sem espelhar, para RG/CNH/passaporte).

import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

type EstadoCam = 'iniciando' | 'ativa' | 'capturada' | 'erro';
export type ModoCaptura = 'rosto' | 'documento';

const LADO_FOTO = 640;
const LARGURA_SCAN = 1600;
/** Proporção de cartão de identificação (CR80: 85,6 × 54 mm). */
const RATIO_DOC = 1.586;
const QUALIDADE_JPEG = 0.85;

@Component({
  selector: 'app-foto-capture',
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="overlay overlay-cam" (click.self)="cancelar()">
      <div class="modal-inn" role="dialog" aria-modal="true" aria-labelledby="titulo-cam">
        <div class="modal-head">
          <h5 id="titulo-cam">{{ titulo() }}</h5>
          <button type="button" class="close" aria-label="Fechar" (click)="cancelar()">&times;</button>
        </div>
        <div class="modal-body">
          @if (estado() === 'erro') {
            <div class="cam-erro">
              <mat-icon>videocam_off</mat-icon>
              <p>{{ erroMsg() }}</p>
              <button type="button" class="btn-dark-blue" (click)="iniciar()">
                <mat-icon>refresh</mat-icon> Tentar novamente
              </button>
            </div>
          } @else {
            <div class="frame" [class.escondido]="estado() === 'capturada'">
              <video #video autoplay playsinline muted [class.espelha]="modo() === 'rosto'"></video>
              @if (modo() === 'rosto') {
                <div class="mira" aria-hidden="true"></div>
              } @else {
                <div class="mira-doc" aria-hidden="true"></div>
              }
              @if (estado() === 'iniciando') {
                <div class="cam-loading"><mat-spinner diameter="36" /></div>
              }
            </div>
            @if (modo() === 'documento' && estado() === 'ativa') {
              <small class="muted">Posicione o documento dentro da moldura.</small>
            }
            @if (estado() === 'capturada' && preview()) {
              <div class="frame"><img [src]="preview()" alt="Prévia da captura" /></div>
            }
          }
        </div>
        <div class="modal-foot cam-foot">
          @if (estado() === 'ativa') {
            <button type="button" class="btn-green" (click)="capturar()">
              <mat-icon>photo_camera</mat-icon> Capturar
            </button>
          }
          @if (estado() === 'capturada') {
            <button type="button" class="btn-gray" (click)="refazer()">
              <mat-icon>refresh</mat-icon> Refazer
            </button>
            <button type="button" class="btn-green" (click)="usar()">
              <mat-icon>check</mat-icon> Usar {{ modo() === 'documento' ? 'scan' : 'foto' }}
            </button>
          }
          <button type="button" class="btn-gray" (click)="cancelar()">Cancelar</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .overlay-cam { z-index: 110; }
    .modal-inn { max-width: 560px; }
    .modal-body { align-items: center; }
    .frame {
      position: relative; width: 100%; aspect-ratio: 4 / 3;
      background: #000; border-radius: 0.3rem; overflow: hidden;
    }
    .frame video, .frame img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .frame video.espelha { transform: scaleX(-1); }
    .frame.escondido { display: none; }
    /* Guia de enquadramento do rosto (kiosks de check-in). */
    .mira {
      position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 34% 62% at 50% 46%, transparent 98%, rgba(0,0,0,.45) 100%);
    }
    /* Moldura de documento — proporção de cartão CR80 (85,6 × 54 mm). */
    .mira-doc {
      position: absolute; inset: 0; pointer-events: none;
      background:
        linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)) 0 0 / 100% 18% no-repeat,
        linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)) 0 100% / 100% 18% no-repeat,
        linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)) 0 0 / 7% 100% no-repeat,
        linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)) 100% 0 / 7% 100% no-repeat;
    }
    .mira-doc::after {
      content: ''; position: absolute; inset: 18% 7%;
      border: 2px dashed rgba(255,255,255,.7); border-radius: 8px;
    }
    .cam-loading {
      position: absolute; inset: 0; display: grid; place-items: center;
      background: rgba(0,0,0,.35);
    }
    .cam-erro {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 24px 8px; text-align: center;
    }
    .cam-erro mat-icon { font-size: 42px; width: 42px; height: 42px; color: #dc3545; }
    .cam-erro p { margin: 0; color: #555; }
    .cam-foot { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .cam-foot button { display: inline-flex; align-items: center; gap: 6px; }
    .muted { color: #7d97a1; }
  `,
})
export class FotoCaptureComponent implements OnInit, OnDestroy {
  /** 'rosto' (padrão — retrato do hóspede) ou 'documento' (scan de ID). */
  readonly modo = input<ModoCaptura>('rosto');
  /** Foto/scan confirmado — JPEG pronto para upload. */
  readonly confirmada = output<Blob>();
  readonly cancelada = output<void>();

  protected readonly estado = signal<EstadoCam>('iniciando');
  protected readonly erroMsg = signal('');
  protected readonly preview = signal<string | null>(null);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly titulo = computed(() =>
    this.modo() === 'documento' ? 'Digitalizar documento' : 'Foto do cliente',
  );

  private stream: MediaStream | null = null;
  private blob: Blob | null = null;

  ngOnInit(): void {
    void this.iniciar();
  }

  ngOnDestroy(): void {
    this.pararCamera();
  }

  async iniciar(): Promise<void> {
    this.estado.set('iniciando');
    this.erroMsg.set('');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const el = this.video()?.nativeElement;
      if (el) el.srcObject = this.stream;
      this.estado.set('ativa');
    } catch (e) {
      this.stream = null;
      this.erroMsg.set(this.mensagemErro(e));
      this.estado.set('erro');
    }
  }

  capturar(): void {
    const v = this.video()?.nativeElement;
    if (!v || !v.videoWidth || !v.videoHeight) return;
    const doc = this.modo() === 'documento';
    const ratio = doc ? RATIO_DOC : 1;
    // Maior recorte central com a proporção alvo do modo.
    let cw = v.videoWidth;
    let ch = v.videoHeight;
    if (cw / ch > ratio) cw = Math.round(ch * ratio);
    else ch = Math.round(cw / ratio);
    const sx = (v.videoWidth - cw) / 2;
    const sy = (v.videoHeight - ch) / 2;
    const outW = doc ? Math.min(cw, LARGURA_SCAN) : Math.min(LADO_FOTO, cw);
    const outH = Math.round(outW / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!doc) {
      // Espelha como o preview (selfie) para não confundir o operador.
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, outW, outH);
    canvas.toBlob(
      (b) => {
        if (!b) return;
        this.blob = b;
        this.liberarPreview();
        this.preview.set(URL.createObjectURL(b));
        this.estado.set('capturada');
      },
      'image/jpeg',
      QUALIDADE_JPEG,
    );
  }

  refazer(): void {
    this.blob = null;
    this.liberarPreview();
    this.estado.set('ativa');
  }

  usar(): void {
    const b = this.blob;
    if (b) this.confirmada.emit(b);
  }

  cancelar(): void {
    this.cancelada.emit();
  }

  private pararCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.liberarPreview();
  }

  private liberarPreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
  }

  private mensagemErro(e: unknown): string {
    const nome = e instanceof DOMException ? e.name : '';
    if (nome === 'NotAllowedError') {
      return 'Permissão de câmera negada. Libere o acesso no navegador e tente novamente.';
    }
    if (nome === 'NotFoundError') {
      return 'Nenhuma câmera encontrada neste computador.';
    }
    if (nome === 'NotReadableError') {
      return 'A câmera está em uso por outro aplicativo.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'Este navegador/contexto não suporta câmera (requer HTTPS ou localhost).';
    }
    return 'Não foi possível acessar a câmera.';
  }
}
