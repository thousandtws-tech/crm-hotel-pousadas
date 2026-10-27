// MAR IA — cliente WebSocket do assistente de voz.
// Protocolo: binário = PCM16 24k mono (mic → serviço, voz ← serviço);
// texto JSON = controle/eventos. O serviço Python valida o JWT do sistema.

import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { environment } from '../../../environments/environment';

export type MariaEstado = 'offline' | 'idle' | 'listening' | 'thinking' | 'speaking';

export interface MariaMsg {
  papel: 'user' | 'assistant' | 'sys';
  texto: string;
  ts: number;
}

export interface AcaoPendente {
  idacao: string;
  acao: string;
  resumo: Record<string, unknown>;
}

/** AudioWorklet inline: recebe Float32 da taxa do contexto e repassa. */
const WORKLET_SRC = `
class MarCap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('mar-cap', MarCap);
`;

@Injectable({ providedIn: 'root' })
export class MariaService {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly estado = signal<MariaEstado>('offline');
  readonly conectado = signal(false);
  readonly vozDisponivel = signal(false);   // servidor informou TTS ok
  readonly micDisponivel = signal(false);   // servidor informou STT ok
  readonly serverVad = signal(true);
  readonly mensagens = signal<MariaMsg[]>([]);
  readonly transcricaoViva = signal('');
  readonly assistenteParcial = signal('');
  readonly pendente = signal<AcaoPendente | null>(null);
  readonly micLigado = signal(false);
  readonly nivelMic = signal(0);            // 0..1 — onda de áudio
  readonly vozLigada = signal(true);
  readonly erro = signal<string | null>(null);

  private ws: WebSocket | null = null;
  private parcial = '';
  private retry = 0;
  private querConectar = false;

  // ---- captura de microfone ----
  private micStream: MediaStream | null = null;
  private capCtx: AudioContext | null = null;
  private capNode: AudioWorkletNode | null = null;
  private capBuf: number[] = [];
  private micAnalyser: AnalyserNode | null = null;

  // ---- reprodução ----
  private playCtx: AudioContext | null = null;
  private playProx = 0;
  private fontes: AudioBufferSourceNode[] = [];
  private ttsAnalyser: AnalyserNode | null = null;
  private scratch = new Uint8Array(512);

  readonly estadoRotulo = computed(() =>
    ({ offline: 'offline', idle: 'pronta', listening: 'ouvindo', thinking: 'pensando', speaking: 'falando' })[this.estado()],
  );

  get url(): string {
    return (environment as { mariaUrl?: string }).mariaUrl ?? '';
  }

  conectar(): void {
    this.querConectar = true;
    if (this.ws || !this.url || !this.auth.accessToken()) return;
    try {
      this.ws = new WebSocket(`${this.url}?token=${encodeURIComponent(this.auth.accessToken() ?? '')}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.conectado.set(true);
        this.retry = 0;
        this.erro.set(null);
        this.estado.set('idle');
      };
      this.ws.onclose = () => {
        this.ws = null;
        this.conectado.set(false);
        this.estado.set('offline');
        this.pararMic();
        if (this.querConectar) {
          const wait = Math.min(15000, 1000 * Math.pow(2, this.retry++));
          setTimeout(() => this.conectar(), wait);
        }
      };
      this.ws.onerror = () => this.erro.set('serviço MAR IA fora do ar');
      this.ws.onmessage = (e) => this.onMsg(e);
    } catch {
      this.ws = null;
    }
  }

  desconectar(): void {
    this.querConectar = false;
    this.ws?.close();
    this.ws = null;
    this.conectado.set(false);
    this.estado.set('offline');
    this.pararMic();
    this.limparAudio();
  }

  private onMsg(e: MessageEvent): void {
    if (e.data instanceof ArrayBuffer) {
      this.tocar(new Int16Array(e.data));
      return;
    }
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(e.data as string);
    } catch {
      return;
    }
    switch (ev['type']) {
      case 'hello':
        this.vozDisponivel.set(!!ev['voz']);
        this.micDisponivel.set(!!ev['mic']);
        this.serverVad.set(ev['vad'] !== false);
        break;
      case 'state':
        this.estado.set(ev['state'] as MariaEstado);
        break;
      case 'transcript':
        if (ev['final']) {
          this.transcricaoViva.set('');
          if (ev['text']) this.addMsg('user', String(ev['text']));
        } else {
          this.transcricaoViva.set(String(ev['text']));
        }
        break;
      case 'assistant_delta':
        this.parcial += String(ev['text']);
        this.assistenteParcial.set(this.parcial);
        break;
      case 'assistant_done':
        this.parcial = '';
        this.assistenteParcial.set('');
        if (ev['text']) this.addMsg('assistant', String(ev['text']));
        break;
      case 'audio.clear':
        this.limparAudio();
        this.assistenteParcial.set('');
        this.parcial = '';
        break;
      case 'action_required':
        this.pendente.set({
          idacao: String(ev['idacao']),
          acao: String(ev['acao']),
          resumo: (ev['resumo'] as Record<string, unknown>) ?? {},
        });
        break;
      case 'action_done':
        this.pendente.set(null);
        this.addMsg('sys', String(ev['mensagem'] ?? 'ação concluída'));
        break;
      case 'tool':
        this.addMsg('sys', `consultando ${String(ev['name']).replace(/_/g, ' ')}…`);
        break;
      case 'nav': {
        const rota = String(ev['rota'] ?? '');
        if (rota.startsWith('/')) {
          this.addMsg('sys', `abrindo ${rota}…`);
          void this.router.navigateByUrl(rota);
        }
        break;
      }
      case 'error':
        this.erro.set(String(ev['message']));
        break;
    }
  }

  private addMsg(papel: MariaMsg['papel'], texto: string): void {
    this.mensagens.update((m) => [...m.slice(-60), { papel, texto, ts: Date.now() }]);
  }

  // ------------------------------------------------------------- mic --

  async ligarMic(): Promise<void> {
    if (this.micLigado()) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micStream = stream;
    this.capCtx = new AudioContext();
    const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
    await this.capCtx.audioWorklet.addModule(URL.createObjectURL(blob));
    const src = this.capCtx.createMediaStreamSource(stream);
    this.capNode = new AudioWorkletNode(this.capCtx, 'mar-cap');
    src.connect(this.capNode);
    // Tap de volume para o visualizador Aura (mesmo perfil do
    // useTrackVolume do LiveKit: fft 512, smoothing 0.55).
    this.micAnalyser = this.capCtx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.micAnalyser.smoothingTimeConstant = 0.55;
    src.connect(this.micAnalyser);
    const taxaCtx = this.capCtx.sampleRate;
    // ---- porta de ruído adaptativa ----
    // Piso = EMA lenta do RMS em trechos abaixo do limiar; só sai áudio
    // quando RMS > portao (com "hangover" para não cortar final de palavra).
    let piso = 0.012;           // chute inicial (sala silenciosa)
    let hold = 0;               // chunks ainda liberados após a fala cair
    const HOLD_MAX = 4;         // ~4 × 80 ms ≈ 320 ms de tolerância
    this.capNode.port.onmessage = (e) => {
      const f = e.data as Float32Array;
      let soma = 0;
      for (let i = 0; i < f.length; i++) soma += f[i] * f[i];
      const rms = Math.sqrt(soma / f.length);
      this.nivelMic.set(Math.min(1, rms * 5));

      // downsample → PCM16 24 kHz
      for (let i = 0; i < f.length; i++) this.capBuf.push(f[i]);
      const alvo = Math.floor((this.capBuf.length * 24000) / taxaCtx);
      if (alvo < 1920) return; // ~80 ms por envio

      const portao = Math.max(piso * 2.8, 0.009);
      const falando = rms > portao;
      if (!falando) {
        // ambiente: recalibra o piso devagar (conversa, ventilador, rua)
        piso = piso * 0.97 + rms * 0.03;
        if (hold > 0) {
          hold--; // ainda dentro do hangover — envia o restinho da palavra
        } else {
          // silêncio/ruído: descarta o chunk acumulado e não envia nada
          this.capBuf = this.capBuf.slice(Math.floor((alvo * taxaCtx) / 24000));
          return;
        }
      } else {
        hold = HOLD_MAX;
      }

      const out = new Int16Array(alvo);
      for (let i = 0; i < alvo; i++) {
        const idx = Math.floor((i * taxaCtx) / 24000);
        const v = Math.max(-1, Math.min(1, this.capBuf[idx]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.capBuf = this.capBuf.slice(Math.floor((alvo * taxaCtx) / 24000));
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(out.buffer);
    };
    this.micLigado.set(true);
    this.estado.set('listening');
  }

  pararMic(): void {
    this.capNode?.disconnect();
    this.capCtx?.close();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.capNode = null;
    this.capCtx = null;
    this.micStream = null;
    this.micAnalyser = null;
    this.capBuf = [];
    this.micLigado.set(false);
    this.nivelMic.set(0);
  }

  // ------------------------------------------------------ reprodução --
  private ctx(): AudioContext {
    this.playCtx ??= new AudioContext({ sampleRate: 24000 });
    if (this.playCtx.state === 'suspended') void this.playCtx.resume();
    if (!this.ttsAnalyser) {
      this.ttsAnalyser = this.playCtx.createAnalyser();
      this.ttsAnalyser.fftSize = 512;
      this.ttsAnalyser.smoothingTimeConstant = 0.55;
    }
    return this.playCtx;
  }

  private tocar(pcm: Int16Array): void {
    const ctx = this.ctx();
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    if (this.ttsAnalyser) src.connect(this.ttsAnalyser);
    const t = Math.max(ctx.currentTime + 0.02, this.playProx);
    src.start(t);
    this.playProx = t + buf.duration;
    this.fontes.push(src);
    src.onended = () => {
      this.fontes = this.fontes.filter((f) => f !== src);
    };
  }

  private limparAudio(): void {
    this.fontes.forEach((f) => {
      try {
        f.stop();
      } catch { /* já parada */ }
    });
    this.fontes = [];
    this.playProx = 0;
  }

  /**
   * Volume RMS 0..1 para o visualizador Aura — espelha o useTrackVolume
   * do LiveKit: quando falando, mede a voz da MAR IA (TTS); senão, o mic.
   */
  volumeAura(): number {
    const a = this.estado() === 'speaking' ? this.ttsAnalyser : this.micAnalyser;
    if (!a) return 0;
    if (this.scratch.length !== a.fftSize) this.scratch = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(this.scratch);
    let soma = 0;
    for (let i = 0; i < a.fftSize; i++) {
      const v = (this.scratch[i] - 128) / 128;
      soma += v * v;
    }
    return Math.min(1, Math.sqrt(soma / a.fftSize) * 2.4);
  }

  // ------------------------------------------------------ comandos --
  enviarTexto(t: string): void {
    if (!t.trim()) return;
    this.addMsg('user', t);
    this.ws?.send(
      JSON.stringify({ type: 'text', text: t, tela: window.location.pathname }),
    );
  }

  interromper(): void {
    this.ws?.send(JSON.stringify({ type: 'interrupt' }));
    this.limparAudio();
  }

  confirmar(idacao: string): void {
    this.ws?.send(JSON.stringify({ type: 'confirm', idacao }));
    this.pendente.set(null);
  }

  recusar(): void {
    this.pendente.set(null);
    this.enviarTexto('Não, cancele.');
  }

  commit(): void {
    this.ws?.send(JSON.stringify({ type: 'commit' }));
  }
}
