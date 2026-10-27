// Sino de notificações — estado do inbox no header.
//
// Padrão dos grandes sistemas (Courier/GitHub/Facebook):
//   badge = contagem persistida de não-lidas (server é a fonte da verdade),
//   incremento otimista quando um `aviso` chega pelo SSE,
//   painel com histórico + read receipts (uma e "todas").

import { Service, effect, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Notificacao } from '@core/models/api.models';
import { AuthStore } from './auth.store';
import { Realtime } from './realtime.service';

@Service()
export class Notificacoes {
[x: string]: any;
  private readonly api = inject(ApiService);
  private readonly rt = inject(Realtime);
  private readonly auth = inject(AuthStore);

  /** Badge do sino — não-lidas. */
  readonly naoLidas = signal(0);
  /** Painel aberto/fechado. */
  readonly aberto = signal(false);
  /** Inbox carregado sob demanda (ao abrir o painel). */
  readonly inbox = signal<Notificacao[]>([]);
  /** true por ~900ms quando chega aviso — balanço do sino. */
  readonly tocando = signal(false);
  readonly carregando = signal(false);

  private timerRing: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Qualquer aviso recebido pelo SSE → badge++ + animação do sino + atualiza inbox
    let ultimoSeq = 0;
    effect(() => {
      const seq = this.rt.avisoSeq();
      if (seq === 0 || seq === ultimoSeq) return;
      ultimoSeq = seq;
      this.naoLidas.update((n) => n + 1);
      this.tocando.set(true);
      if (this.timerRing) clearTimeout(this.timerRing);
      this.timerRing = setTimeout(() => this.tocando.set(false), 1200);
      if (this.aberto()) this.carregarInbox();
    });

    // deltas nas tabelas do inbox → contagem autoritativa do servidor.
    // É o que faz abas/dispositivos convergirem: ler numa aba emite
    // `notificacao_lida` insert → a outra aba refaz a contagem.
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('notificacao', 'notificacao_lida');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v === ultimo) return;
      ultimo = v;
      this.iniciar();
      if (this.aberto()) this.carregarInbox();
    });
  }

  /** Contagem inicial — chamado quando o shell sobe. */
  iniciar(): void {
    this.api.naoLidas().subscribe({
      next: (r) => this.naoLidas.set(r.total),
      error: () => undefined,
    });
  }

  alternarPainel(): void {
    const abrir = !this.aberto();
    this.aberto.set(abrir);
    if (abrir) this.carregarInbox();
  }

  fecharPainel(): void {
    this.aberto.set(false);
  }

  carregarInbox(): void {
    this.carregando.set(true);
    this.api.notificacoes(1, 30).subscribe({
      next: (p) => {
        this.inbox.set(p.items);
        this.carregando.set(false);
      },
      error: () => this.carregando.set(false),
    });
  }

  ler(n: Notificacao): void {
    if (n.lida) return;
    this.inbox.update((l) => l.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
    this.naoLidas.update((x) => Math.max(0, x - 1));
    this.api.lerNotificacao(n.id).subscribe({ error: () => undefined });
  }

  lerTodas(): void {
    if (this.naoLidas() === 0) return;
    this.naoLidas.set(0);
    this.inbox.update((l) => l.map((n) => ({ ...n, lida: true })));
    this.api.lerTodasNotificacoes().subscribe({ error: () => undefined });
  }

  /** Remove do histórico (só admin — a linha é compartilhada). */
  excluir(n: Notificacao): void {
    if (!n.lida) this.naoLidas.update((x) => Math.max(0, x - 1));
    this.inbox.update((l) => l.filter((x) => x.id !== n.id));
    this.api.excluirNotificacao(n.id).subscribe({ error: () => undefined });
  }

  /** "agora", "5min", "2h", "3d" ou data. */
  tempoAtras(iso: string): string {
    const seg = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return 'agora';
    if (seg < 3600) return `${Math.floor(seg / 60)}min`;
    if (seg < 86400) return `${Math.floor(seg / 3600)}h`;
    const d = Math.floor(seg / 86400);
    if (d < 30) return `${d}d`;
    return new Date(iso).toLocaleDateString('pt-BR');
  }
}
