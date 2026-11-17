// MAR IA — cliente da conversa ElevenLabs Agents.
// O serviço Python emite a signed_url (a chave fica no backend) e serve
// as tools via POST /mcp com o JWT do funcionário — clientTools do SDK
// fazem a ponte, então toda escrita segue preparar_* → confirmar_acao
// com as permissões do usuário logado.

import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Conversation } from '@elevenlabs/client';
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

const CONFIRMAR_ACAO = 'confirmar_acao';
const ABRIR_PAGINA = 'abrir_pagina';

@Injectable({ providedIn: 'root' })
export class MariaService {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly estado = signal<MariaEstado>('offline');
  readonly conectado = signal(false);
  readonly mensagens = signal<MariaMsg[]>([]);
  readonly transcricaoViva = signal('');
  readonly assistenteParcial = signal('');
  readonly pendente = signal<AcaoPendente | null>(null);
  readonly micLigado = signal(false);
  readonly vozLigada = signal(true);
  readonly erro = signal<string | null>(null);

  private conv: Conversation | null = null;
  private retry = 0;
  private querConectar = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ferramentas = 0; // tools em execução — 'thinking' enquanto > 0

  readonly estadoRotulo = computed(() =>
    ({ offline: 'offline', idle: 'pronta', listening: 'ouvindo', thinking: 'pensando', speaking: 'falando' })[this.estado()],
  );

  /** Base HTTP do serviço (session + MCP) — antes era a URL ws. */
  get url(): string {
    return (environment as { mariaUrl?: string }).mariaUrl ?? '';
  }

  // ------------------------------------------------------------ sessão --

  conectar(): void {
    this.querConectar = true;
    if (this.conv || !this.url || !this.auth.accessToken()) return;
    void this.abrirSessao();
  }

  private async abrirSessao(): Promise<void> {
    const token = this.auth.accessToken();
    if (!token) return;
    try {
      this.erro.set(null);
      // 1) signed_url — credencial ElevenLabs nunca toca o navegador.
      const sessao = await this.post<{ signed_url: string }>(
        `${this.url}/api/maria/session`, token,
      );
      // 2) tools dinâmicas — o /mcp é a fonte de verdade dos nomes;
      //    se o agente chama como client tool, caí aqui com o JWT real.
      const nomes = await this.listarTools(token);
      const clientTools = Object.fromEntries(
        nomes.map((n) => [n, (p: unknown) => this.executarTool(n, p, token)]),
      );

      const conv = await Conversation.startSession({
        signedUrl: sessao.signed_url,
        clientTools,
        userId: this.auth.user()?.login,
        dynamicVariables: {
          funcionario: this.auth.user()?.nome ?? '',
        },
        onConnect: () => {
          this.conectado.set(true);
          this.micLigado.set(true);
          this.retry = 0;
          this.estado.set('idle');
        },
        onDisconnect: (det) => this.onQueda(det?.reason),
        onStatusChange: ({ status }) => {
          if (status === 'disconnecting') this.estado.set('offline');
        },
        onModeChange: ({ mode }) => {
          this.estado.set(mode === 'speaking' ? 'speaking' : 'listening');
        },
        onMessage: ({ message, source }) => {
          if (message) this.addMsg(source === 'user' ? 'user' : 'assistant', message);
        },
        onUnhandledClientToolCall: (call) => {
          this.addMsg('sys', `ferramenta desconhecida: ${call?.tool_name ?? '?'}`);
        },
        onError: (msg) => this.erro.set(String(msg)),
      });
      this.conv = conv;
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'falha ao abrir sessão');
      this.onQueda('erro');
    }
  }

  private onQueda(motivo?: string): void {
    this.conv = null;
    this.conectado.set(false);
    this.micLigado.set(false);
    this.estado.set('offline');
    if (motivo && motivo !== 'user') this.erro.set(`sessão encerrada (${motivo})`);
    if (this.querConectar) {
      const wait = Math.min(15000, 1000 * Math.pow(2, this.retry++));
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.abrirSessao(); // signed_url é descartável — emite outra
      }, wait);
    }
  }

  async desconectar(): Promise<void> {
    this.querConectar = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const conv = this.conv;
    this.conv = null;
    await conv?.endSession().catch(() => undefined);
    this.conectado.set(false);
    this.micLigado.set(false);
    this.estado.set('offline');
  }

  // ------------------------------------------------------- transporte --

  private async post<T>(url: string, token: string, body?: unknown): Promise<T> {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? '{}' : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`serviço maria: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  private async mcp<T>(metodo: string, params: unknown, token: string): Promise<T> {
    const r = await this.post<{ result?: T; error?: { message: string } }>(
      `${this.url}/mcp`, token,
      { jsonrpc: '2.0', id: Date.now(), method: metodo, params },
    );
    if (r.error) throw new Error(r.error.message);
    return r.result as T;
  }

  private async listarTools(token: string): Promise<string[]> {
    try {
      const res = await this.mcp<{ tools?: { name: string }[] }>('tools/list', {}, token);
      return (res.tools ?? []).map((t) => t.name);
    } catch {
      return []; // sem lista — clientTools vazio, voz continua funcionando
    }
  }

  // ----------------------------------------------------------- tools --

  private async executarTool(nome: string, params: unknown, token: string): Promise<string> {
    // Navegação é local — rotas Angular pré-autorizadas, nunca externas.
    if (nome === ABRIR_PAGINA) {
      const rota = String((params as Record<string, unknown>)?.['rota'] ?? '');
      if (rota.startsWith('/') && !rota.startsWith('//') && !rota.includes('://')) {
        this.addMsg('sys', `abrindo ${rota}…`);
        void this.router.navigateByUrl(rota);
        return `página aberta: ${rota}`;
      }
      return `rota rejeitada: ${rota || '(vazia)'}`;
    }

    this.ferramentas++;
    if (this.estado() !== 'speaking') this.estado.set('thinking');
    try {
      const res = await this.mcp<{ content?: { text: string }[]; isError?: boolean }>(
        'tools/call', { name: nome, arguments: params ?? {} }, token,
      );
      const texto = res.content?.[0]?.text ?? '{}';
      this.addMsg('sys', `${nome.replace(/^(get|preparar|set)_/, '').replace(/_/g, ' ')}…`);
      try {
        const resultado = JSON.parse(texto) as Record<string, unknown>;
        // preparar_* devolve idacao+resumo — o card aparece pro clique.
        if (nome.startsWith('preparar_') && resultado['idacao']) {
          this.pendente.set({
            idacao: String(resultado['idacao']),
            acao: nome,
            resumo: resultado,
          });
        }
        if (nome === CONFIRMAR_ACAO) this.pendente.set(null);
      } catch { /* resultado não-JSON segue como texto */ }
      return texto;
    } finally {
      if (--this.ferramentas === 0 && this.estado() === 'thinking') {
        this.estado.set('listening');
      }
    }
  }

  // --------------------------------------------------------- comandos --

  enviarTexto(t: string): void {
    if (!t.trim()) return;
    this.addMsg('user', t);
    this.conv?.sendUserMessage(t);
  }

  interromper(): void {
    this.conv?.sendUserActivity();
  }

  /** Clique no card — executa o confirmar_acao no /mcp e avisa o agente
   *  por contextual update (não vira fala do usuário). */
  async confirmar(idacao: string): Promise<void> {
    this.pendente.set(null);
    const token = this.auth.accessToken();
    if (!token) return;
    try {
      const res = await this.mcp<{ content?: { text: string }[] }>(
        'tools/call', { name: CONFIRMAR_ACAO, arguments: { idacao } }, token,
      );
      const texto = res.content?.[0]?.text ?? 'ação confirmada';
      this.addMsg('sys', texto);
      this.conv?.sendContextualUpdate(
        'O colaborador confirmou a ação pelo botão do CRM — já executada.',
      );
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'falha ao confirmar');
    }
  }

  recusar(): void {
    this.pendente.set(null);
    this.conv?.sendContextualUpdate(
      'O colaborador recusou a ação pelo botão do CRM — não execute.',
    );
    this.addMsg('sys', 'ação recusada');
  }

  alternarVoz(): void {
    const on = !this.vozLigada();
    this.vozLigada.set(on);
    this.conv?.setVolume({ volume: on ? 1 : 0 });
  }

  alternarMic(): void {
    const on = !this.micLigado();
    this.micLigado.set(on);
    this.conv?.setMicMuted(!on);
  }

  /** Volume 0..1 pro visualizador Aura — voz do agente falando, senão mic. */
  volumeAura(): number {
    if (!this.conv) return 0;
    return this.estado() === 'speaking'
      ? this.conv.getOutputVolume()
      : this.conv.getInputVolume();
  }

  private addMsg(papel: MariaMsg['papel'], texto: string): void {
    this.mensagens.update((m) => [...m.slice(-60), { papel, texto, ts: Date.now() }]);
  }
}
