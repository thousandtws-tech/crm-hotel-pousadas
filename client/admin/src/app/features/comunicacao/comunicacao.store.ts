// Lógica e estado de comunicacao — separada da camada de UI (comunicacao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, inject, signal, computed, effect, Directive } from '@angular/core';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { AuthStore } from '@core/services/auth.store';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { environment } from '../../../environments/environment';
import {
  Atendimento,
  AtendimentoNota,
  Avaliacao,
  AvaliacoesDash,
  CanalEnvio,
  ItemFila,
  LgpdSolicitacao,
  RegraMatriz,
  RespostaRapida,
} from '@core/models/comunicacao.models';

type Aba = 'avaliacoes' | 'fila' | 'matriz' | 'lgpd' | 'atend' | 'respostas';
const CANAIS: CanalEnvio[] = ['inbox', 'push', 'email', 'whatsapp'];
const PAPEIS = [1, 2, 3];
const PAPEL_ROTULO: Record<number, string> = { 1: 'Admin', 2: 'Gerente', 3: 'Todos' };

/** Central de comunicação — reputação, fila de envio e matriz de alertas. */
@Directive()
export abstract class ComunicacaoStore implements OnInit {
  private readonly comunicacaoApi = inject(ComunicacaoApi);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthStore);
  private readonly confirm = inject(ConfirmService);
  private readonly rt = inject(RealtimeService);

  protected readonly aba = signal<Aba>('avaliacoes');
  protected readonly abas: { id: Aba; rotulo: string }[] = [
    { id: 'avaliacoes', rotulo: 'Avaliações' },
    { id: 'fila', rotulo: 'Fila de envio' },
    { id: 'matriz', rotulo: 'Matriz de alertas' },
    { id: 'lgpd', rotulo: 'Privacidade (LGPD)' },
    { id: 'atend', rotulo: 'Atendimentos' },
    { id: 'respostas', rotulo: 'Respostas rápidas' },
  ];

  protected readonly dash = signal<AvaliacoesDash | null>(null);
  protected readonly avaliacoes = signal<Avaliacao[]>([]);
  protected readonly fila = signal<ItemFila[]>([]);
  protected readonly matriz = signal<RegraMatriz[]>([]);
  protected readonly lgpd = signal<LgpdSolicitacao[]>([]);
  protected readonly atends = signal<Atendimento[]>([]);
  protected readonly atendFiltro = signal<string>('aberto');

  // -- detalhe do protocolo: notas internas, transferência, tags, agendado ------
  protected readonly atendSel = signal<Atendimento | null>(null);
  protected readonly notas = signal<AtendimentoNota[]>([]);
  protected notaTexto = '';
  protected agendarTexto = '';
  /** `datetime-local` — convertido pra ISO no envio. */
  protected agendarQuando = '';
  protected readonly setores = ['recepcao', 'governanca', 'manutencao', 'gerencia'];
  protected readonly tagsSugeridas = ['reclamacao', 'elogio', 'upsell', 'urgente', 'vip', 'reembolso'];
  protected readonly modalLgpd = signal<LgpdSolicitacao | null>(null);
  protected textoLgpd = '';
  protected readonly modalAv = signal<Avaliacao | null>(null);
  protected readonly pushAtivo = signal(false);
  protected textoResposta = '';

  protected readonly canais = CANAIS;
  protected readonly papeis = PAPEIS;
  protected readonly papelRotulo = PAPEL_ROTULO;

  // -- respostas rápidas ('/atalho') ------------------------------------------
  protected readonly respostas = signal<RespostaRapida[]>([]);
  protected readonly modalRr = signal<RespostaRapida | null>(null);
  /** Form da resposta em edição/criação — `id` 0 = novo. */
  protected rrForm = { id: 0, atalho: '', titulo: '', texto: '', ordem: 0, ativo: true };
  /** Gerência edita o catálogo; atendentes só usam no autocomplete. */
  protected readonly gerencial = computed(() => (this.auth.user()?.nivel ?? 9) <= 2);

  protected readonly eventos = computed(() =>
    [...new Set(this.matriz().map((r) => r.evento))].sort(),
  );

  constructor() {
    // realtime — catálogo editado por outra sessão reflete sem F5
    effect(() => {
      this.rt.delta('comunicacao_resposta_rapida');
      this.carregarRespostas();
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarRespostas();
    this.pushAtivo.set(localStorage.getItem('push_subscribed') === '1');
  }

  carregarRespostas(): void {
    this.comunicacaoApi.respostasRapidas().subscribe({
      next: (r) => this.respostas.set(r),
      error: () => undefined,
    });
  }

  novaResposta(): void {
    this.rrForm = {
      id: 0,
      atalho: '',
      titulo: '',
      texto: '',
      ordem: this.respostas().length + 1,
      ativo: true,
    };
    this.modalRr.set({ ...this.rrForm });
  }

  editarResposta(r: RespostaRapida): void {
    this.rrForm = {
      id: r.id,
      atalho: r.atalho,
      titulo: r.titulo,
      texto: r.texto,
      ordem: r.ordem,
      ativo: r.ativo,
    };
    this.modalRr.set(r);
  }

  salvarResposta(): void {
    const f = this.rrForm;
    if (!f.atalho.trim() || !f.titulo.trim() || !f.texto.trim()) return;
    this.comunicacaoApi
      .gravarRespostaRapida({
        atalho: f.atalho.trim(),
        titulo: f.titulo.trim(),
        texto: f.texto,
        ordem: f.ordem,
        ativo: f.ativo,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Resposta rápida salva.');
          this.modalRr.set(null);
          this.carregarRespostas();
        },
        error: (e) =>
          this.notify.erroMsg(e?.error?.erro?.mensagem ?? 'Não foi possível salvar.'),
      });
  }

  async removerResposta(r: RespostaRapida): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a resposta "/${r.atalho}"? Atendentes perdem o atalho na hora.`,
      { confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.comunicacaoApi.removerRespostaRapida(r.id).subscribe({
      next: () => {
        this.notify.ok('Resposta excluída.');
        this.carregarRespostas();
      },
      error: () => this.notify.erroMsg('Não foi possível excluir.'),
    });
  }

  carregar(): void {
    // 1 request consolidada — campos gerenciais vêm null sem acesso,
    // mantendo o comportamento anterior (erros silenciosos → listas vazias).
    this.comunicacaoApi.painelComunicacao().subscribe({
      next: (p) => {
        this.dash.set(p.avaliacoes_dash);
        this.avaliacoes.set(p.avaliacoes ?? []);
        this.fila.set(p.fila ?? []);
        this.matriz.set(p.matriz ?? []);
        this.lgpd.set(p.lgpd);
        // O painel traz só 'aberto' — com outro filtro ativo, recarrega filtrado.
        if (this.atendFiltro() === 'aberto') this.atends.set(p.atendimentos);
        else this.carregarAtend();
      },
      error: () => undefined,
    });
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

  abrirAtend(a: Atendimento): void {
    this.atendSel.set(a);
    this.notaTexto = '';
    this.agendarTexto = '';
    this.agendarQuando = '';
    this.comunicacaoApi.atendNotas(a.id).subscribe({
      next: (n) => this.notas.set(n),
      error: () => this.notas.set([]),
    });
  }

  fecharAtend(): void {
    this.atendSel.set(null);
    this.notas.set([]);
  }

  private atualizarAtendSel(a: Atendimento): void {
    this.atendSel.set(a);
    this.atends.update((l) => l.map((x) => (x.id === a.id ? a : x)));
  }

  anotarAtend(): void {
    const a = this.atendSel();
    const texto = this.notaTexto.trim();
    if (!a || !texto) return;
    this.comunicacaoApi.atendAnotar(a.id, texto).subscribe({
      next: (n) => {
        this.notas.update((l) => [...l, n]);
        this.notaTexto = '';
      },
      error: () => this.notify.erroMsg('Não foi possível salvar a nota.'),
    });
  }

  transferirAtend(setor: string): void {
    const a = this.atendSel();
    if (!a || setor === a.setor) return;
    this.comunicacaoApi.atendTransferir(a.id, setor).subscribe({
      next: (novo) => {
        this.notify.ok(`Protocolo ${a.protocolo} → ${setor}.`);
        this.atualizarAtendSel(novo);
      },
      error: () => this.notify.erroMsg('Não foi possível transferir.'),
    });
  }

  toggleTag(tag: string): void {
    const a = this.atendSel();
    if (!a) return;
    const tags = a.tags.includes(tag)
      ? a.tags.filter((t) => t !== tag)
      : [...a.tags, tag];
    this.comunicacaoApi.atendTags(a.id, tags).subscribe({
      next: (novo) => this.atualizarAtendSel(novo),
      error: () => this.notify.erroMsg('Não foi possível salvar as etiquetas.'),
    });
  }

  agendarMsg(): void {
    const a = this.atendSel();
    const texto = this.agendarTexto.trim();
    if (!a || !texto || !this.agendarQuando) return;
    const quando = new Date(this.agendarQuando);
    if (Number.isNaN(quando.getTime()) || quando.getTime() <= Date.now()) {
      this.notify.erroMsg('Escolha um horário futuro.');
      return;
    }
    this.comunicacaoApi.atendAgendarMsg(a.id, texto, quando.toISOString()).subscribe({
      next: () => {
        this.notify.ok('Mensagem agendada — sai na fila de envio no horário.');
        this.agendarTexto = '';
        this.agendarQuando = '';
      },
      error: () => this.notify.erroMsg('Não foi possível agendar a mensagem.'),
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

  /** Pede à Maria (HTTP stateless no serviço Maria) uma resposta pública
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
      this.notify.erroMsg(`Maria não respondeu: ${e instanceof Error ? e.message : e}`);
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
