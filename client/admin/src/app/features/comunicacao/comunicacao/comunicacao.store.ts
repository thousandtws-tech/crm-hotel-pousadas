// Lógica e estado de comunicacao — separada da camada de UI (comunicacao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, computed, Directive } from '@angular/core';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import { environment } from '../../../../environments/environment';
import {
  Atendimento,
  Avaliacao,
  AvaliacoesDash,
  CanalEnvio,
  ItemFila,
  LgpdSolicitacao,
  RegraMatriz,
} from '@core/models/comunicacao.models';

type Aba = 'avaliacoes' | 'fila' | 'matriz' | 'lgpd' | 'atend';
const CANAIS: CanalEnvio[] = ['inbox', 'push', 'email', 'whatsapp'];
const PAPEIS = [1, 2, 3];
const PAPEL_ROTULO: Record<number, string> = { 1: 'Admin', 2: 'Gerente', 3: 'Todos' };

/** Central de comunicação — reputação, fila de envio e matriz de alertas. */
@Directive()
export abstract class ComunicacaoStore implements OnInit {
  private readonly comunicacaoApi = inject(ComunicacaoApi);
  private readonly notify = inject(Notify);
  private readonly auth = inject(AuthStore);

  protected readonly aba = signal<Aba>('avaliacoes');
  protected readonly abas: { id: Aba; rotulo: string }[] = [
    { id: 'avaliacoes', rotulo: 'Avaliações' },
    { id: 'fila', rotulo: 'Fila de envio' },
    { id: 'matriz', rotulo: 'Matriz de alertas' },
    { id: 'lgpd', rotulo: 'Privacidade (LGPD)' },
    { id: 'atend', rotulo: 'Atendimentos' },
  ];

  protected readonly dash = signal<AvaliacoesDash | null>(null);
  protected readonly avaliacoes = signal<Avaliacao[]>([]);
  protected readonly fila = signal<ItemFila[]>([]);
  protected readonly matriz = signal<RegraMatriz[]>([]);
  protected readonly lgpd = signal<LgpdSolicitacao[]>([]);
  protected readonly atends = signal<Atendimento[]>([]);
  protected readonly atendFiltro = signal<string>('aberto');
  protected readonly modalLgpd = signal<LgpdSolicitacao | null>(null);
  protected textoLgpd = '';
  protected readonly modalAv = signal<Avaliacao | null>(null);
  protected readonly pushAtivo = signal(false);
  protected textoResposta = '';

  protected readonly canais = CANAIS;
  protected readonly papeis = PAPEIS;
  protected readonly papelRotulo = PAPEL_ROTULO;

  protected readonly eventos = computed(() =>
    [...new Set(this.matriz().map((r) => r.evento))].sort(),
  );

  ngOnInit(): void {
    this.carregar();
    this.pushAtivo.set(localStorage.getItem('push_subscribed') === '1');
  }

  carregar(): void {
    this.comunicacaoApi
      .avaliacoesDashboard()
      .subscribe({ next: (d) => this.dash.set(d), error: () => undefined });
    this.comunicacaoApi
      .avaliacoes()
      .subscribe({ next: (a) => this.avaliacoes.set(a), error: () => undefined });
    this.comunicacaoApi
      .filaEnvio()
      .subscribe({ next: (f) => this.fila.set(f), error: () => undefined });
    this.comunicacaoApi
      .matrizNotificacao()
      .subscribe({ next: (m) => this.matriz.set(m), error: () => undefined });
    this.carregarLgpd();
    this.carregarAtend();
  }

  carregarAtend(): void {
    this.comunicacaoApi.atendimentos(this.atendFiltro()).subscribe({
      next: (a) => this.atends.set(a),
      error: () => undefined,
    });
  }

  aceitarAtend(a: Atendimento): void {
    this.comunicacaoApi.atendAceitar(a.id).subscribe({
      next: () => this.carregarAtend(),
      error: () => this.notify.erroMsg('Não foi possível assumir o protocolo.'),
    });
  }

  resolverAtend(a: Atendimento): void {
    this.comunicacaoApi.atendResolver(a.id).subscribe({
      next: () => {
        this.notify.ok(`Protocolo ${a.protocolo} resolvido.`);
        this.carregarAtend();
      },
      error: () => this.notify.erroMsg('Não foi possível resolver o protocolo.'),
    });
  }

  carregarLgpd(): void {
    this.comunicacaoApi
      .lgpdSolicitacoes()
      .subscribe({ next: (s) => this.lgpd.set(s), error: () => undefined });
  }

  tipoLgpd(t: string): string {
    const m: Record<string, string> = {
      acesso: 'Acesso aos dados',
      retificacao: 'Retificação',
      eliminacao: 'Eliminação',
      portabilidade: 'Portabilidade',
      revogacao: 'Revogar consentimento',
    };
    return m[t] ?? t;
  }

  stLgpd(s: string): string {
    return `st st-${s}`;
  }

  responderLgpd(s: LgpdSolicitacao): void {
    this.textoLgpd = '';
    this.modalLgpd.set(s);
  }

  enviarRespostaLgpd(): void {
    const s = this.modalLgpd();
    if (!s || !this.textoLgpd.trim()) return;
    this.comunicacaoApi.lgpdResponder(s.id, this.textoLgpd.trim()).subscribe({
      next: () => {
        this.notify.ok('Resposta registrada — solicitação respondida.');
        this.modalLgpd.set(null);
        this.carregarLgpd();
      },
      error: () => this.notify.erroMsg('Não foi possível registrar a resposta.'),
    });
  }

  nota(v: number | null): string {
    return v !== null ? v.toFixed(1) : '—';
  }

  stClass(s: string): string {
    return `st st-${s}`;
  }

  stFila(s: string): string {
    return `st st-${s}`;
  }

  regra(evento: string, canal: CanalEnvio, papel: number): RegraMatriz | undefined {
    return this.matriz().find((r) => r.evento === evento && r.canal === canal && r.papel === papel);
  }

  toggle(evento: string, canal: CanalEnvio, papel: number): void {
    const atual = this.regra(evento, canal, papel);
    const nova: RegraMatriz = { evento, canal, papel, ativo: !(atual?.ativo ?? false) };
    this.comunicacaoApi.gravarRegraMatriz(nova).subscribe({
      next: () => {
        this.matriz.update((m) => {
          const i = m.findIndex(
            (r) => r.evento === evento && r.canal === canal && r.papel === papel,
          );
          if (i < 0) return [...m, nova];
          const copia = [...m];
          copia[i] = nova;
          return copia;
        });
      },
      error: () => this.notify.erroMsg('Não foi possível salvar a regra.'),
    });
  }

  responder(av: Avaliacao): void {
    this.textoResposta = '';
    this.modalAv.set(av);
  }

  /** Pede à Inná (HTTP stateless no serviço Maria) uma resposta pública
   *  sugerida — o texto cai no textarea pra revisão humana antes de publicar. */
  protected readonly gerandoIa = signal(false);
  async sugerirIa(): Promise<void> {
    const av = this.modalAv();
    const token = this.auth.accessToken();
    if (!av || !token) return;
    this.gerandoIa.set(true);
    try {
      const base =
        (environment as { mariaUrl?: string }).mariaUrl
          ?.replace(/^wss:/, 'https:')
          .replace(/\/ws\/maria.*$/, '') ?? '';
      const res = await fetch(`${base}/ia/resposta-avaliacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          nota: av.nota_geral ?? 3,
          nps: av.nps,
          comentario: av.comentario ?? '',
          categorias: {
            limpeza: av.nota_limpeza ?? 0,
            atendimento: av.nota_atendimento ?? 0,
            custo_beneficio: av.nota_custo ?? 0,
            localizacao: av.nota_localizacao ?? 0,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'IA indisponível');
      this.textoResposta = String(data.resposta ?? '');
    } catch (e) {
      this.notify.erroMsg(`Inná não respondeu: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.gerandoIa.set(false);
    }
  }

  enviarResposta(): void {
    const av = this.modalAv();
    if (!av) return;
    this.comunicacaoApi.responderAvaliacao(av.id, this.textoResposta.trim()).subscribe({
      next: () => {
        this.modalAv.set(null);
        this.notify.ok('Resposta publicada.');
        this.carregar();
      },
      error: () => this.notify.erroMsg('Falha ao publicar a resposta.'),
    });
  }

  async ativarPush(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.register('/push-sw.js');
      const { publica } = (await this.comunicacaoApi.pushVapidKey().toPromise()) ?? {};
      if (!publica) {
        this.notify.erroMsg('Push não configurado no servidor (VAPID).');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        this.notify.erroMsg('Permissão de notificação negada pelo navegador.');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.b64paraBytes(publica),
      });
      const j = sub.toJSON();
      await this.comunicacaoApi
        .pushSubscribe({
          endpoint: j.endpoint ?? '',
          p256dh: j.keys?.['p256dh'] ?? '',
          auth: j.keys?.['auth'] ?? '',
          user_agent: navigator.userAgent,
        })
        .toPromise();
      localStorage.setItem('push_subscribed', '1');
      this.pushAtivo.set(true);
      this.notify.ok('Notificações ativadas neste navegador.');
    } catch {
      this.notify.erroMsg('Não foi possível ativar as notificações.');
    }
  }

  private b64paraBytes(b64: string): ArrayBuffer {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replaceAll('-', '+').replaceAll('_', '/'));
    const buf = new ArrayBuffer(raw.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
    return buf;
  }
}
