import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ComunicacaoApi } from '@core/api/comunicacao.api';
import { AuthStore } from '@core/services/auth.store';
import { Notify } from '@core/services/notify.service';
import { environment } from '../../../environments/environment';
import { Atendimento, Avaliacao, AvaliacoesDash, CanalEnvio, ItemFila, LgpdSolicitacao, RegraMatriz } from '@core/models/comunicacao.models';

type Aba = 'avaliacoes' | 'fila' | 'matriz' | 'lgpd' | 'atend';
const CANAIS: CanalEnvio[] = ['inbox', 'push', 'email', 'whatsapp'];
const PAPEIS = [1, 2, 3];
const PAPEL_ROTULO: Record<number, string> = { 1: 'Admin', 2: 'Gerente', 3: 'Todos' };

/** Central de comunicação — reputação, fila de envio e matriz de alertas. */
@Component({
  selector: 'app-comunicacao',
  imports: [FormsModule, DatePipe],
  template: `
    <section class="pg">
      <header class="pg-head">
        <div>
          <p class="eyebrow">Central</p>
          <h2 class="pg-titulo">Comunicação</h2>
          <p class="pg-sub">Avaliações, fila de envio e matriz de notificações</p>
        </div>
        <button class="btn-mini" (click)="ativarPush()" [disabled]="pushAtivo()">
          {{ pushAtivo() ? 'Notificações ativas' : 'Ativar notificações neste navegador' }}
        </button>
      </header>

      <nav class="abas" aria-label="Seções de comunicação">
        @for (a of abas; track a.id) {
          <button class="aba" [class.ativa]="aba() === a.id" (click)="aba.set(a.id)">{{ a.rotulo }}</button>
        }
      </nav>

      @if (aba() === 'avaliacoes') {
        @if (dash(); as d) {
          <div class="cards">
            <div class="card"><span>NPS</span><strong>{{ d.nps !== null ? d.nps.toFixed(0) : '—' }}</strong></div>
            <div class="card"><span>Média geral</span><strong>{{ nota(d.media_geral) }}</strong><small>de 5</small></div>
            <div class="card"><span>Limpeza</span><strong>{{ nota(d.media_limpeza) }}</strong></div>
            <div class="card"><span>Atendimento</span><strong>{{ nota(d.media_atendimento) }}</strong></div>
            <div class="card"><span>Custo-benefício</span><strong>{{ nota(d.media_custo) }}</strong></div>
            <div class="card"><span>Localização</span><strong>{{ nota(d.media_localizacao) }}</strong></div>
            <div class="card"><span>Taxa de resposta</span><strong>{{ (d.taxa_resposta * 100).toFixed(0) }}%</strong>
              <small>{{ d.respondidas }} de {{ d.total }}</small></div>
          </div>
        }
        <div class="bloco">
          <h3>Avaliações recebidas</h3>
          <table>
            <thead><tr>
              <th>Reserva</th><th>Canal</th><th>Nota</th><th>NPS</th><th>Comentário</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (av of avaliacoes(); track av.id) {
                <tr [class.critica]="(av.nota_geral ?? 5) <= 2">
                  <td>#{{ av.idreserva }}</td>
                  <td>{{ av.plataforma }}</td>
                  <td>{{ av.nota_geral ?? '—' }}/5</td>
                  <td>{{ av.nps ?? '—' }}</td>
                  <td class="coment">{{ av.comentario ?? '—' }}
                    @if (av.resposta) { <small class="resp">↳ {{ av.resposta }}</small> }
                  </td>
                  <td><span class="st" [class]="stClass(av.status)">{{ av.status }}</span></td>
                  <td>
                    @if (av.status === 'respondida' && !av.resposta) {
                      <button class="btn-mini" (click)="responder(av)">Responder</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="vazio">Nenhuma avaliação ainda — elas são enviadas 3 dias após o check-out.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba() === 'fila') {
        <div class="bloco">
          <h3>Fila de envio <button class="btn-mini" (click)="carregar()">Atualizar</button></h3>
          <table>
            <thead><tr>
              <th>Canal</th><th>Destino</th><th>Template</th><th>Reserva</th>
              <th>Tentativas</th><th>Status</th><th>Último erro</th><th>Enviado</th>
            </tr></thead>
            <tbody>
              @for (f of fila(); track f.id) {
                <tr>
                  <td>{{ f.canal }}</td>
                  <td class="coment">{{ f.destino }}</td>
                  <td>{{ f.template }}</td>
                  <td>{{ f.idreserva ? '#' + f.idreserva : '—' }}</td>
                  <td>{{ f.tentativas }}</td>
                  <td><span class="st" [class]="stFila(f.status)">{{ f.status }}</span></td>
                  <td class="coment">{{ f.ultimo_erro ?? '' }}</td>
                  <td>{{ f.enviado_em ? (f.enviado_em | date: 'dd/MM HH:mm') : '—' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="vazio">Fila vazia.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba() === 'matriz') {
        <div class="bloco">
          <h3>Quem recebe cada alerta — evento × canal × papel</h3>
          <table>
            <thead><tr>
              <th>Evento</th>
              @for (c of canais; track c) { <th>{{ c }}</th> }
            </tr></thead>
            <tbody>
              @for (ev of eventos(); track ev) {
                <tr>
                  <td><code>{{ ev }}</code></td>
                  @for (c of canais; track c) {
                    <td>
                      @for (p of papeis; track p) {
                        <label class="chk" [title]="papelRotulo[p]">
                          <input type="checkbox"
                            [checked]="regra(ev, c, p)?.ativo ?? false"
                            (change)="toggle(ev, c, p)" />
                          <small>{{ papelRotulo[p] }}</small>
                        </label>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba() === 'lgpd') {
        <div class="bloco">
          <h3>Solicitações do titular (LGPD art. 18) — responder em até 15 dias
            <button class="btn-mini" (click)="carregarLgpd()">Atualizar</button></h3>
          <table>
            <thead><tr>
              <th>Protocolo</th><th>Tipo</th><th>Cliente</th><th>Reserva</th>
              <th>Detalhe</th><th>Canal</th><th>Aberta em</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (s of lgpd(); track s.id) {
                <tr>
                  <td>#{{ s.id }}</td>
                  <td>{{ tipoLgpd(s.tipo) }}</td>
                  <td>{{ s.idcliente ? '#' + s.idcliente : '—' }}</td>
                  <td>{{ s.idreserva ? '#' + s.idreserva : '—' }}</td>
                  <td class="coment">{{ s.detalhe ?? '—' }}
                    @if (s.resposta) { <small class="resp">↳ {{ s.resposta }}</small> }
                  </td>
                  <td>{{ s.canal }}</td>
                  <td>{{ s.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                  <td><span class="st" [class]="stLgpd(s.status)">{{ s.status }}</span></td>
                  <td>
                    @if (s.status === 'aberta') {
                      <button class="btn-mini" (click)="responderLgpd(s)">Responder</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="vazio">Nenhuma solicitação — o hóspede abre pelo portal da reserva.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (aba() === 'atend') {
        <div class="bloco">
          <h3>Fila de atendimento — protocolos por setor
            <select class="sel" [ngModel]="atendFiltro()" (ngModelChange)="atendFiltro.set($event); carregarAtend()">
              <option value="aberto">Abertos</option>
              <option value="em_atendimento">Em atendimento</option>
              <option value="escalado">Escalados</option>
              <option value="resolvido">Resolvidos</option>
            </select>
            <button class="btn-mini" (click)="carregarAtend()">Atualizar</button></h3>
          <table>
            <thead><tr>
              <th>Protocolo</th><th>Setor</th><th>Prioridade</th><th>Origem</th>
              <th>Reserva</th><th>Assunto</th><th>Aberto em</th><th>SLA aceite</th><th></th>
            </tr></thead>
            <tbody>
              @for (a of atends(); track a.id) {
                <tr [class.linha-urgente]="a.prioridade === 'urgente'">
                  <td><b>{{ a.protocolo }}</b></td>
                  <td>{{ a.setor }}</td>
                  <td><span class="st" [class]="a.prioridade === 'urgente' ? 'st st-escalado' : 'st st-resolvido'">{{ a.prioridade }}</span></td>
                  <td>{{ a.origem }}</td>
                  <td>{{ a.idreserva ? '#' + a.idreserva : '—' }}</td>
                  <td class="coment">{{ a.ultima_msg ?? a.assunto }}</td>
                  <td>{{ a.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                  <td>{{ a.prazo_aceite | date: 'HH:mm' }}</td>
                  <td>
                    @if (a.status === 'aberto' || a.status === 'escalado') {
                      <button class="btn-mini" (click)="aceitarAtend(a)">Assumir</button>
                    }
                    @if (a.status !== 'resolvido') {
                      <button class="btn-mini" (click)="resolverAtend(a)">Resolver</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="9" class="vazio">Fila vazia — escaladas da Inná e urgências caem aqui.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (modalLgpd(); as sol) {
        <div class="overlay" (click)="modalLgpd.set(null)" (keydown.escape)="modalLgpd.set(null)">
          <div class="modal" role="dialog" aria-modal="true" aria-label="Responder solicitação LGPD"
            (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Solicitação #{{ sol.id }} — {{ tipoLgpd(sol.tipo) }}</h3>
            <p>{{ sol.detalhe ?? 'Sem detalhe informado pelo titular.' }}</p>
            <label>Resposta ao titular
              <textarea [(ngModel)]="textoLgpd" rows="4"
                placeholder="Descreva como a solicitação foi atendida…"></textarea>
            </label>
            <div class="acoes">
              <button class="btn-sec" (click)="modalLgpd.set(null)">Cancelar</button>
              <button class="btn" [disabled]="!textoLgpd.trim()" (click)="enviarRespostaLgpd()">Registrar resposta</button>
            </div>
          </div>
        </div>
      }

      @if (modalAv(); as av) {
        <div class="overlay" (click)="modalAv.set(null)" (keydown.escape)="modalAv.set(null)">
          <div class="modal" role="dialog" aria-modal="true" aria-label="Responder avaliação"
            (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <h3>Responder avaliação #{{ av.idreserva }}</h3>
            <p>"{{ av.comentario }}"</p>
            <label>Resposta pública
              <textarea [(ngModel)]="textoResposta" rows="4"></textarea>
            </label>
            <div class="acoes">
              <button class="btn-sec" (click)="sugerirIa()" [disabled]="gerandoIa()">
                {{ gerandoIa() ? 'Inná escrevendo…' : '✨ Sugerir com Inná' }}
              </button>
              <button class="btn-sec" (click)="modalAv.set(null)">Cancelar</button>
              <button class="btn" [disabled]="!textoResposta.trim()" (click)="enviarResposta()">Publicar</button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .pg{padding:1.25rem;display:flex;flex-direction:column;gap:1rem}
    .pg-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:1rem}
    .eyebrow{margin:0 0 4px;font-size:.68rem}
    .pg-titulo{font-size:1.35rem;margin:0;font-weight:700;color:#054054;letter-spacing:-.01em}
    .pg-sub{margin:.15rem 0 0;color:var(--mut,#667);font-size:.85rem}
    .abas{display:flex;gap:.4rem;border-bottom:1px solid var(--borda,#e3e6ea)}
    .aba{padding:.55rem 1rem;border:0;background:none;border-bottom:2px solid transparent;cursor:pointer;font-size:.88rem;color:#5d6d7e}
    .aba:hover{color:#054054}
    .aba.ativa{border-bottom-color:#054054;color:#054054;font-weight:700}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.75rem}
    .card{background:var(--card,#fff);border:1px solid var(--borda,#e3e6ea);border-radius:12px;padding:.9rem 1rem;display:flex;flex-direction:column;gap:.15rem}
    .card span{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut,#667)}
    .card strong{font-size:1.15rem}
    .card small{color:var(--mut,#667);font-size:.72rem}
    .bloco{background:var(--card,#fff);border:1px solid var(--borda,#e3e6ea);border-radius:12px;padding:1rem;overflow-x:auto}
    .bloco h3{margin:0 0 .75rem;font-size:.95rem;display:flex;align-items:center;gap:.6rem}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--borda,#eee);vertical-align:top}
    th{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut,#667)}
    .coment{max-width:260px;word-break:break-word}
    .resp{display:block;color:var(--mut,#667)}
    .critica td{background:#fff5f5}
    .st{padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:600}
    .st-respondida,.st-enviado,.st-executada,.st-resolvido,.st-normal{background:#e4f6e8;color:#146c2e}
    .st-pendente,.st-enviando,.st-aberta,.st-aberto,.st-em_atendimento{background:#fdf3d7;color:#8a6200}
    .st-falhou,.st-expirada,.st-cancelado,.st-escalado,.st-urgente{background:#fde3e3;color:#a32}
    .linha-urgente td{background:#fff5f5}
    .sel{margin:0 .5rem;padding:.3rem .5rem;border:1px solid #ddd;border-radius:6px;font-size:.82rem}
    .sel:focus-visible,.modal textarea:focus-visible{outline:2px solid #054054;outline-offset:0}
    .chk{display:flex;align-items:center;gap:.25rem;font-size:.7rem;margin:.1rem 0;cursor:pointer}
    .chk input{accent-color:#054054;width:.95rem;height:.95rem;cursor:pointer}
    .btn-mini{font-size:.72rem;padding:.3rem .7rem;border-radius:6px;border:1px solid var(--borda,#ccd);background:#fff;cursor:pointer}
    .vazio{color:var(--mut,#667);font-size:.85rem;padding:.5rem 0;text-align:center}
    .overlay{position:fixed;inset:0;background:rgba(10,15,20,.45);display:flex;align-items:center;justify-content:center;z-index:310}
    .modal{background:#fff;border-radius:14px;padding:1.5rem;width:min(460px,92vw);display:flex;flex-direction:column;gap:.8rem}
    .modal h3{margin:0}.modal p{margin:0;font-size:.82rem;color:var(--mut,#667)}
    .modal label{display:flex;flex-direction:column;gap:.3rem;font-size:.78rem;font-weight:600}
    .modal textarea{padding:.55rem .65rem;border:1px solid var(--borda,#ccd);border-radius:8px;font-size:.9rem}
    .acoes{display:flex;gap:.6rem;margin-top:.4rem}
    .btn{flex:1;padding:.6rem;border:0;border-radius:8px;background:#054054;color:#fff;font-weight:600;cursor:pointer}
    .btn:hover:not(:disabled){background:#042f3d}
    .btn:disabled{opacity:.6}.btn-sec{padding:.6rem 1rem;border:1px solid var(--borda,#ccd);border-radius:8px;background:#fff;cursor:pointer}
  `],
})
export class ComunicacaoComponent implements OnInit {
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
    [...new Set(this.matriz().map((r) => r.evento))].sort()
  );

  ngOnInit(): void {
    this.carregar();
    this.pushAtivo.set(localStorage.getItem('push_subscribed') === '1');
  }

  carregar(): void {
    this.comunicacaoApi.avaliacoesDashboard().subscribe({ next: (d) => this.dash.set(d), error: () => undefined });
    this.comunicacaoApi.avaliacoes().subscribe({ next: (a) => this.avaliacoes.set(a), error: () => undefined });
    this.comunicacaoApi.filaEnvio().subscribe({ next: (f) => this.fila.set(f), error: () => undefined });
    this.comunicacaoApi.matrizNotificacao().subscribe({ next: (m) => this.matriz.set(m), error: () => undefined });
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
    this.comunicacaoApi.lgpdSolicitacoes().subscribe({ next: (s) => this.lgpd.set(s), error: () => undefined });
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
          const i = m.findIndex((r) => r.evento === evento && r.canal === canal && r.papel === papel);
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
      const base = (environment as { mariaUrl?: string }).mariaUrl
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
      const { publica } = await this.comunicacaoApi.pushVapidKey().toPromise() ?? {};
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
      await this.comunicacaoApi.pushSubscribe({
        endpoint: j.endpoint ?? '',
        p256dh: j.keys?.['p256dh'] ?? '',
        auth: j.keys?.['auth'] ?? '',
        user_agent: navigator.userAgent,
      }).toPromise();
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
