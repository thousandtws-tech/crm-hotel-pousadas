// Motor realtime — cliente Phoenix Channels do hub Elixir.
//
// Duas lanes (mesmo contrato do SSE antigo):
//   delta — mudança de dados vinda dos triggers PG ({tabela,acao,id}).
//           Cada tabela tem um contador em `delta()`; páginas assinam via
//           effect() e recarregam (debounce de 300ms por tabela).
//   aviso — evento semântico dos services ({tipo,titulo,mensagem,…}).
//           Vira toast, exceto para o próprio autor (ele já tem feedback local).
//
// Transporte: WebSocket via `phoenix` no hub `environment.realtimeUrl`.
// O socket reconecta sozinho com backoff; o token é reavaliado a cada
// tentativa (params é função) — refresh de token entra no próximo retry.

import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Socket, Channel } from 'phoenix';
import { environment } from '../../../environments/environment';
import { AuthStore } from './auth.store';
import { Notify } from './notify.service';

export interface Delta {
  tabela: string;
  acao: 'insert' | 'update' | 'delete' | string;
  id: number | null;
}

export interface Aviso {
  tipo: 'info' | 'sucesso' | 'alerta';
  titulo: string;
  mensagem: string;
  autor_id?: number;
  autor_nome?: string;
}

@Service()
export class Realtime {
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(Notify);

  /** true enquanto o socket está aberto — indicador "ao vivo" no shell. */
  readonly online = signal(false);

  /** Último aviso recebido — o sino (`Notificacoes`) assina via effect(). */
  readonly ultimoAviso = signal<Aviso | null>(null);
  readonly avisoSeq = signal(0);

  /** tabela → contador de mudanças; páginas leem via `delta(tabela)`. */
  private readonly _deltas = signal<Record<string, number>>({});
  private readonly pendentes = new Map<string, ReturnType<typeof setTimeout>>();

  private socket: Socket | null = null;
  private canalDeltas: Channel | null = null;
  private canalAvisos: Channel | null = null;
  private rodando = false;
  /** AudioContext reutilizado — criar um por aviso vazava contextos. */
  private audioCtx: AudioContext | null = null;

  delta(tabela: string): number {
    return this._deltas()[tabela] ?? 0;
  }

  /**
   * Para uso dentro de `effect()`: soma os contadores das tabelas dadas —
   * o efeito só precisa reagir quando esse total muda.
   * ```ts
   * let ultimo = -1;
   * effect(() => {
   *   const v = this.rt.mudanca('reserva', 'consumo');
   *   if (ultimo < 0) { ultimo = v; return; }   // primeira leitura: ngOnInit já carrega
   *   if (v !== ultimo) { ultimo = v; this.carregar(); }
   * });
   * ```
   */
  mudanca(...tabelas: string[]): number {
    return tabelas.reduce((acc, t) => acc + (this._deltas()[t] ?? 0), 0);
  }

  iniciar(): void {
    if (this.rodando) return;
    if (!this.auth.accessToken()) return;
    this.rodando = true;
    void this.conectar();
  }

  parar(): void {
    this.rodando = false;
    this.canalDeltas?.leave();
    this.canalAvisos?.leave();
    this.canalDeltas = null;
    this.canalAvisos = null;
    this.socket?.disconnect();
    this.socket = null;
    this.online.set(false);
  }

  private async conectar(): Promise<void> {
    // phoenix é carregado sob demanda — fora do bundle inicial; a primeira
    // conexão (pós-login) baixa o chunk e as seguintes reutilizam o cache.
    const { Socket } = await import('phoenix');
    if (!this.rodando) return;
    const socket = new Socket(environment.realtimeUrl, {
      // função → reavaliada a cada (re)conexão; pega o token renovado
      params: () => ({ token: this.auth.accessToken() }),
      reconnectAfterMs: (tentativa) => Math.min(1000 * 2 ** tentativa, 15000),
      heartbeatIntervalMs: 15000,
    });
    this.socket = socket;

    socket.onOpen(() => this.online.set(true));
    socket.onClose(() => this.online.set(false));
    socket.onError(() => this.online.set(false));

    // Lane deltas — todas as tabelas (mesmo contrato do SSE antigo).
    this.canalDeltas = socket.channel('deltas');
    this.canalDeltas.on('delta', (d) => this.bump((d as Delta).tabela));
    this.canalDeltas.join().receive('error', () => void this.tentarRefreshEReconectar());

    // Lane avisos — o hub filtra por nivel; aqui só vira toast/badge.
    this.canalAvisos = socket.channel('avisos');
    this.canalAvisos.on('aviso', (a) => this.onAviso(a as Aviso));
    this.canalAvisos.join().receive('error', () => void this.tentarRefreshEReconectar());

    socket.connect();
  }

  /** Join recusado (token expirado/inválido) → refresh + reconexão limpa. */
  private async tentarRefreshEReconectar(): Promise<void> {
    if (!this.rodando) return;
    const ok = await firstValueFrom(this.auth.tentarRefresh());
    if (!ok || !this.rodando) {
      this.parar();
      return;
    }
    // o socket segue seu retry com o token novo (params é função);
    // os channels rejoinam sozinhos — o rejoin usa o socket vivo
    this.canalDeltas?.rejoin();
    this.canalAvisos?.rejoin();
  }

  private onAviso(a: Aviso): void {
    this.ultimoAviso.set(a);
    this.avisoSeq.update((s) => s + 1);
    this.tocarSino();
    if (a.tipo === 'alerta') this.notify.aviso(`🔔 ${a.titulo} — ${a.mensagem}`);
    else this.notify.ok(`🔔 ${a.titulo} — ${a.mensagem}`);
  }

  /** Alerta sonoro curto e suave (Web Audio API) ao receber reserva/evento realtime. */
  private tocarSino(): void {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx ??= new Ctx();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.11);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.38);
    } catch {
      // navegador bloqueou autoplay antes de interação
    }
  }

  /** Debounce por tabela: rajada de deltas vira um único bump. */
  private bump(tabela: string): void {
    const t = this.pendentes.get(tabela);
    if (t) clearTimeout(t);
    this.pendentes.set(
      tabela,
      setTimeout(() => {
        this.pendentes.delete(tabela);
        this._deltas.update((d) => ({ ...d, [tabela]: (d[tabela] ?? 0) + 1 }));
      }, 300),
    );
  }
}
