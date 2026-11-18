// Lógica e estado de foto-capture — separada da camada de UI (foto-capture.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { ElementRef, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { InputSignal, OutputEmitterRef, Signal } from '@angular/core';
import { Directive } from '@angular/core';

type EstadoCam = 'iniciando' | 'ativa' | 'capturada' | 'erro';
export type ModoCaptura = 'rosto' | 'documento';

const LADO_FOTO = 640;
const LARGURA_SCAN = 1600;
/** Proporção de cartão de identificação (CR80: 85,6 × 54 mm). */
const RATIO_DOC = 1.586;
const QUALIDADE_JPEG = 0.85;

@Directive()
export abstract class FotoCaptureStore implements OnInit, OnDestroy {
  declare protected readonly modo: InputSignal<ModoCaptura>;
  declare protected readonly confirmada: OutputEmitterRef<Blob>;
  declare protected readonly cancelada: OutputEmitterRef<void>;
  declare protected readonly video: Signal<ElementRef<HTMLVideoElement> | undefined>;
  /** 'rosto' (padrão — retrato do hóspede) ou 'documento' (scan de ID). */

  /** Foto/scan confirmado — JPEG pronto para upload. */

  protected readonly estado = signal<EstadoCam>('iniciando');
  protected readonly erroMsg = signal('');
  protected readonly preview = signal<string | null>(null);

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
