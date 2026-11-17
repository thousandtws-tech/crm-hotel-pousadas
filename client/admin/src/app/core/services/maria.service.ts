// MAR IA — ponte entre o widget oficial ElevenLabs (<elevenlabs-convai>)
// e o backend: a sessão autenticada vem de POST /api/maria/session
// (ELEVENLABS_API_KEY nunca toca o navegador) e as tools do agente
// executam via POST /mcp com o JWT do funcionário — RBAC real, mesma
// disciplina preparar_* → confirmar_acao de qualquer outro cliente.

import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { environment } from '../../../environments/environment';

export interface AcaoPendente {
  idacao: string;
  acao: string;
  resumo: Record<string, unknown>;
}

const CONFIRMAR_ACAO = 'confirmar_acao';
const ABRIR_PAGINA = 'abrir_pagina';

/** Enum `pagina` da tool → rota Angular. Lista fechada: a IA nunca
 *  navega para caminhos fora deste mapa nem para URLs externas. */
const ROTAS_PAGINA: Record<string, string> = {
  dashboard: '/dashboard',
  reservas: '/reservas',
  clientes: '/clientes',
  acomodacoes: '/acomodacoes',
  estoque: '/estoque',
  insumos: '/insumos',
  compras: '/compras',
  frigobares: '/frigobares',
  estacionamento: '/estacionamento',
  pagamentos: '/pagamentos',
  pdv: '/pdv',
  cozinha: '/cozinha',
  cafe: '/cafe',
  financeiro: '/financeiro',
  financeiro_contas: '/financeiro/contas',
  financeiro_fluxo: '/financeiro/fluxo-caixa',
  financeiro_dre: '/financeiro/dre',
  financeiro_conciliacao: '/financeiro/conciliacao',
  financeiro_split: '/financeiro/split',
  financeiro_caixa: '/financeiro/caixa',
  cms: '/cms',
  estabelecimento: '/estabelecimento',
  funcionarios: '/funcionarios',
  auditoria: '/auditoria',
};

type ClientTools = Record<string, (params: unknown) => Promise<string | object>>;

@Injectable({ providedIn: 'root' })
export class MariaService {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** Ação preparada aguardando confirmação — alimenta o card do CRM. */
  readonly pendente = signal<AcaoPendente | null>(null);
  readonly erro = signal<string | null>(null);

  /** signed_url da sessão corrente — consumida pelo atributo do widget e
   *  injetada na config do evento `call`. Descartável: renovada a cada
   *  preparar(). */
  readonly signedUrl = signal<string | null>(null);

  private tools: ClientTools | null = null;

  get url(): string {
    return (environment as { mariaUrl?: string }).mariaUrl ?? '';
  }

  get agentId(): string {
    return (environment as { mariaAgentId?: string }).mariaAgentId ?? '';
  }

  get funcionario(): string {
    return this.auth.user()?.nome ?? '';
  }

  /** Pré-busca sessão + nomes das tools — chamada no init do widget para
   *  que o evento `call` (síncrono) já encontre tudo pronto. */
  async preparar(): Promise<void> {
    const token = this.auth.accessToken();
    if (!token || !this.url) return;
    try {
      this.erro.set(null);
      const [sessao, nomes] = await Promise.all([
        this.post<{ signed_url: string }>(`${this.url}/api/maria/session`, token),
        this.listarTools(token),
      ]);
      this.signedUrl.set(sessao.signed_url);
      this.tools = this.montarClientTools(nomes, token);
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'falha ao preparar sessão');
    }
  }

  /** clientTools para o config do evento `elevenlabs-convai:call`.
   *  Se preparar() ainda não completou (ou falhou), registra ao menos
   *  as garantias locais — sem elas o agente recebe "client tool not
   *  defined" e desiste de navegar/confirmar. */
  clientTools(): ClientTools {
    if (this.tools) return this.tools;
    const token = this.auth.accessToken();
    return token ? this.montarClientTools([], token) : {};
  }

  /** Clique no card — executa confirmar_acao no /mcp com o JWT do
   *  funcionário (mesma validação de permissão/estado da via por voz). */
  async confirmar(idacao: string): Promise<void> {
    this.pendente.set(null);
    const token = this.auth.accessToken();
    if (!token) return;
    try {
      const res = await this.mcp<{ content?: { text: string }[] }>(
        'tools/call', { name: CONFIRMAR_ACAO, arguments: { idacao } }, token,
      );
      const texto = res.content?.[0]?.text ?? 'ação confirmada';
      if (texto) this.erro.set(null);
    } catch (e) {
      this.erro.set(e instanceof Error ? e.message : 'falha ao confirmar');
    }
  }

  recusar(): void {
    this.pendente.set(null);
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
      return []; // sem lista — voz continua; tools apenas não interceptam
    }
  }

  // ----------------------------------------------------------- tools --

  private montarClientTools(nomes: string[], token: string): ClientTools {
    const tools: ClientTools = Object.fromEntries(
      nomes.map((n) => [n, (p: unknown) => this.executarTool(n, p, token)]),
    );
    // Garantias mínimas mesmo se tools/list falhar:
    tools[ABRIR_PAGINA] ??= (p: unknown) => this.executarTool(ABRIR_PAGINA, p, token);
    tools[CONFIRMAR_ACAO] ??= (p: unknown) => this.executarTool(CONFIRMAR_ACAO, p, token);
    return tools;
  }

  private async executarTool(nome: string, params: unknown, token: string): Promise<string> {
    // Navegação é local — `pagina` é enum fechado mapeado pras rotas
    // Angular; `idreserva` abre o detalhe da reserva.
    if (nome === ABRIR_PAGINA) {
      const p = (params ?? {}) as Record<string, unknown>;
      const pagina = String(p['pagina'] ?? '');
      const idreserva = p['idreserva'];
      const rota = pagina === 'reservas' && typeof idreserva === 'number'
        ? `/reservas/${idreserva}`
        : ROTAS_PAGINA[pagina];
      if (rota) {
        void this.router.navigateByUrl(rota);
        return `página aberta: ${rota}`;
      }
      return `página desconhecida: ${pagina || '(vazio)'}`;
    }

    const res = await this.mcp<{ content?: { text: string }[] }>(
      'tools/call', { name: nome, arguments: params ?? {} }, token,
    );
    const texto = res.content?.[0]?.text ?? '{}';
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
  }
}
