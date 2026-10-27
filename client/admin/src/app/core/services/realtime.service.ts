// Motor realtime — cliente SSE do backend.
//
// Duas lanes (padrão Supabase/Linear):
//   delta — mudança de dados vinda dos triggers PG ({tabela,acao,id}).
//           Cada tabela tem um contador em `delta()`; páginas assinam via
//           effect() e recarregam (debounce de 300ms por tabela).
//   aviso — evento semântico dos services ({tipo,titulo,mensagem,…}).
//           Vira toast, exceto para o próprio autor (ele já tem feedback local).
//
// Transporte: fetch + ReadableStream (EventSource não envia Authorization).
// Reconexão com backoff exponencial 1s→15s; em 401 tenta refresh do token.

import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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

  /** true enquanto o stream está aberto — indicador "ao vivo" no shell. */
  readonly online = signal(false);

  /** Último aviso recebido — o sino (`Notificacoes`) assina via effect(). */
  readonly ultimoAviso = signal<Aviso | null>(null);
  readonly avisoSeq = signal(0);

  /** tabela → contador de mudanças; páginas leem via `delta(tabela)`. */
  private readonly _deltas = signal<Record<string, number>>({});
  private readonly pendentes = new Map<string, ReturnType<typeof setTimeout>>();

  private abort: AbortController | null = null;
  private rodando = false;

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
    this.rodando = true;
    void this.loop();
  }

  parar(): void {
    this.rodando = false;
    this.abort?.abort();
    this.online.set(false);
  }

  private async loop(): Promise<void> {
    let tentativas = 0;
    while (this.rodando) {
      const token = this.auth.accessToken();
      if (!token) break;
      this.abort = new AbortController();
      try {
        const resp = await fetch(`${environment.apiUrl}/notificacoes/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: this.abort.signal,
        });
        if (resp.status === 401) {
          // token expirou — tenta uma rotação antes de desistir
          const ok = await firstValueFrom(this.auth.tentarRefresh());
          if (!ok) break;
          continue;
        }
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        tentativas = 0;
        this.online.set(true);
        await this.ler(resp.body);
      } catch {
        // abortado (logout) ou rede caiu — o loop decide
      } finally {
        this.online.set(false);
      }
      if (!this.rodando || !this.auth.accessToken()) break;
      const espera = Math.min(1000 * 2 ** tentativas++, 15000);
      await new Promise((r) => setTimeout(r, espera));
    }
    this.rodando = false;
    this.online.set(false);
  }

  private async ler(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let evento = '';
    let dados = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const linha of frame.split('\n')) {
          if (linha.startsWith('event:')) evento = linha.slice(6).trim();
          else if (linha.startsWith('data:')) dados = dados ? `${dados}\n${linha.slice(5).trim()}` : linha.slice(5).trim();
        }
        this.despachar(evento, dados);
        evento = '';
        dados = '';
      }
    }
  }

  private despachar(evento: string, dados: string): void {
    if (!dados) return;
    try {
      if (evento === 'delta') {
        const d = JSON.parse(dados) as Delta;
        this.bump(d.tabela);
      } else if (evento === 'aviso') {
        const a = JSON.parse(dados) as Aviso;
        this.ultimoAviso.set(a);
        this.avisoSeq.update((s) => s + 1);
        this.tocarSino();
        if (a.tipo === 'alerta') this.notify.aviso(`🔔 ${a.titulo} — ${a.mensagem}`);
        else this.notify.ok(`🔔 ${a.titulo} — ${a.mensagem}`);
      }
    } catch {
      // payload malformado — ignora o frame, stream segue
    }
  }

  /** Alerta sonoro curto e suave (Web Audio API) ao receber reserva/evento realtime. */
  private tocarSino(): void {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
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
