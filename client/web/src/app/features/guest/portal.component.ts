import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { GuestService, MensagemChat, OfertaUpsell, PortalInfo } from '../../core/services/guest.service';
import { SeoService } from '../../core/services/seo.service';

type Estado = 'carregando' | 'ok' | 'erro';
type CanalDados = 'email' | 'whatsapp';
type EstadoEnvio = 'ocioso' | 'enviando' | 'enviado' | 'erro';

/** Portal do hóspede — resumo da estadia + chat com a concierge Maria.
 *  Acesso pelo token opaco da reserva; o backend só expõe dados dela. */
@Component({
  selector: 'app-portal',
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <header class="pt-32 pb-10 bg-[#032B38] text-white">
      <div class="max-w-2xl mx-auto px-6">
        <p class="text-xs font-medium text-[#8FBECB]">Portal do hóspede</p>
        <h1 class="mt-2 text-3xl sm:text-4xl font-semibold">Sua hospedagem</h1>
        @if (info(); as i) {
          <p class="mt-3 text-white/80">
            {{ i.hospede }} · {{ i.acomodacao }} ·
            {{ i.entrada | date: 'dd/MM/yyyy' }} → {{ i.saida | date: 'dd/MM/yyyy' }}
          </p>
        }
      </div>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-10 space-y-8">
      @switch (estado()) {
        @case ('carregando') {
          <p class="py-16 text-center text-gray-600" role="status">Carregando sua reserva…</p>
        }
        @case ('erro') {
          <div class="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-red-800">Link inválido</h2>
            <p class="mt-2 text-sm text-red-700">Não encontramos esta reserva. Fale com a recepção.</p>
            <a routerLink="/"
               class="mt-6 inline-block rounded-lg bg-[#032B38] px-6 py-2.5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
              Voltar ao site
            </a>
          </div>
        }
        @default {
          <section aria-labelledby="chat-titulo" class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div class="flex items-center gap-3 border-b border-gray-100 bg-[#032B38] px-5 py-4">
              <span aria-hidden="true"
                    class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#8FBECB] text-lg font-semibold text-[#032B38]">
                M
              </span>
              <div>
                <h2 id="chat-titulo" class="font-medium text-white">Maria</h2>
                <p class="text-xs text-[#8FBECB]">Concierge da pousada — responde na hora</p>
              </div>
            </div>

            <div class="h-96 space-y-3 overflow-y-auto bg-gray-50 p-4" role="log" aria-live="polite" aria-label="Mensagens com a Maria">
              @if (!mensagens().length) {
                <p class="mt-8 text-center text-sm text-gray-600">
                  Pergunte sobre check-in, café da manhã, Wi-Fi ou serviços.
                </p>
              }
              @for (m of mensagens(); track $index) {
                <div class="flex" [class.justify-end]="m.origem === 'hospede'">
                  <p class="max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm"
                     [class.bg-white]="m.origem === 'inna'"
                     [class.text-gray-800]="m.origem === 'inna'"
                     [class.border]="m.origem === 'inna'"
                     [class.border-gray-200]="m.origem === 'inna'"
                     [class.rounded-bl-sm]="m.origem === 'inna'"
                     [class.bg-[#032B38]]="m.origem === 'hospede'"
                     [class.text-white]="m.origem === 'hospede'"
                     [class.rounded-br-sm]="m.origem === 'hospede'">
                    {{ m.texto }}
                  </p>
                </div>
              }
              @if (enviando()) {
                <p class="text-sm text-gray-600" role="status">Maria está digitando…</p>
              }
            </div>

            <form (ngSubmit)="enviar()" class="flex gap-2 border-t border-gray-200 bg-white p-3">
              <label for="msg" class="sr-only">Sua mensagem para a Maria</label>
              <input id="msg" name="msg" [(ngModel)]="rascunho" maxlength="1000" required
                     placeholder="Escreva sua pergunta…" autocomplete="off"
                     class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-[#032B38] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FBECB]" />
              <button type="submit" [disabled]="enviando() || !rascunho.trim()"
                      class="rounded-lg bg-[#032B38] px-5 py-2 text-sm font-medium text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                Enviar
              </button>
            </form>
          </section>

          @if (ofertas().length || ofertasErro()) {
            <section aria-labelledby="upsell-titulo" class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p class="text-xs font-medium text-[#032B38]/60">Extras</p>
              <h2 id="upsell-titulo" class="mt-1 text-lg font-semibold text-[#032B38]">Melhore sua estadia</h2>
              <p class="mt-1 text-sm text-gray-600">
                Garanta agora pelo cartão ou Pix — a confirmação cai na sua reserva em instantes.
              </p>

              @if (ofertasErro()) {
                <p class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  {{ ofertasErro() }}
                </p>
              }
              <div class="mt-4 space-y-3">
                @for (o of ofertas(); track o.oferta + (o.idacomodacao ?? 0)) {
                  <div class="flex items-center gap-4 rounded-xl border border-gray-200 p-4">
                    <div class="min-w-0 flex-1">
                      <h3 class="text-sm font-semibold text-[#032B38]">{{ o.titulo }}</h3>
                      <p class="mt-0.5 text-xs text-gray-600">{{ o.descricao }}</p>
                    </div>
                    <div class="shrink-0 text-right">
                      <p class="text-sm font-semibold text-[#032B38]">{{ moeda(o.valor_centavos) }}</p>
                      <button type="button" (click)="comprarExtra(o)"
                              [disabled]="pagando() !== ''"
                              [attr.aria-busy]="pagando() === chaveOferta(o)"
                              class="mt-1.5 rounded-lg bg-[#032B38] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                        {{ pagando() === chaveOferta(o) ? 'Abrindo…' : 'Comprar' }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            </section>
          }

          <section aria-labelledby="dados-titulo" class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p class="text-xs font-medium text-[#032B38]/60">Privacidade</p>
            <h2 id="dados-titulo" class="mt-1 text-lg font-semibold text-[#032B38]">Seus dados</h2>
            <p class="mt-1 text-sm text-gray-600">
              Baixe o documento com seus dados ou receba no seu e-mail e WhatsApp.
            </p>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <a [href]="urlDadosPdf" download
                 class="inline-flex items-center gap-2 rounded-lg bg-[#032B38] px-5 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L9 11.6V3a1 1 0 0 1 1-1Z"/>
                  <path d="M3 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/>
                </svg>
                Baixar meus dados
              </a>
              <button type="button" (click)="enviarDados('email')" [disabled]="envioDados() === 'enviando'"
                      [attr.aria-busy]="envioDados() === 'enviando'"
                      class="rounded-lg border border-[#032B38] px-4 py-2 text-sm font-medium text-[#032B38] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                Receber por e-mail
              </button>
              <button type="button" (click)="enviarDados('whatsapp')" [disabled]="envioDados() === 'enviando'"
                      [attr.aria-busy]="envioDados() === 'enviando'"
                      class="rounded-lg border border-[#032B38] px-4 py-2 text-sm font-medium text-[#032B38] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                Receber no WhatsApp
              </button>
            </div>

            <div role="status" aria-live="polite" class="mt-3 min-h-5">
              @if (envioDados() === 'enviando') {
                <p class="text-sm text-gray-600">Enviando para {{ ultimoCanal() === 'email' ? 'seu e-mail' : 'seu WhatsApp' }}…</p>
              }
              @if (envioDados() === 'enviado') {
                <p class="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  Enviado — confira {{ ultimoCanal() === 'email' ? 'sua caixa de entrada' : 'seu WhatsApp' }} em instantes.
                </p>
              }
              @if (envioDados() === 'erro') {
                <p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {{ erroEnvio() }}
                </p>
              }
            </div>

            <h3 class="mt-6 text-sm font-semibold text-[#032B38]">Outros pedidos</h3>
            <p class="mt-1 text-sm text-gray-600">
              Correção, eliminação, portabilidade ou revogação de consentimentos —
              respondemos em até 15 dias.
            </p>
            @if (protocolo(); as p) {
              <p class="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                Solicitação registrada — protocolo <strong>#{{ p.protocolo }}</strong>.
                Nossa equipe responde em até {{ p.prazo_dias }} dias.
              </p>
            } @else {
              <form (ngSubmit)="solicitar()" class="mt-3 flex flex-col gap-2">
                <div class="flex flex-wrap gap-2">
                  <label for="tipo-lgpd" class="sr-only">Tipo de solicitação</label>
                  <select id="tipo-lgpd" name="tipo-lgpd" [(ngModel)]="tipoLgpd"
                          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#032B38] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FBECB]">
                    <option value="acesso">Confirmar/acessar meus dados</option>
                    <option value="retificacao">Corrigir meus dados</option>
                    <option value="eliminacao">Eliminar meus dados pessoais</option>
                    <option value="portabilidade">Portar meus dados</option>
                    <option value="revogacao">Revogar consentimentos</option>
                  </select>
                  <button type="submit" [disabled]="solicitando()"
                          class="rounded-lg bg-[#032B38] px-4 py-2 text-sm font-medium text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#032B38] focus-visible:ring-offset-2">
                    {{ solicitando() ? 'Enviando…' : 'Solicitar' }}
                  </button>
                </div>
                <label for="detalhe-lgpd" class="sr-only">Detalhe do pedido (opcional)</label>
                <input id="detalhe-lgpd" name="detalhe-lgpd" [(ngModel)]="detalheLgpd" maxlength="500"
                       placeholder="Detalhe do pedido (opcional)"
                       class="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-[#032B38] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FBECB]" />
              </form>
            }
          </section>
        }
      }
    </main>
  `,
})
export class PortalComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly guest = inject(GuestService);
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);

  readonly estado = signal<Estado>('carregando');
  readonly info = signal<PortalInfo | null>(null);
  readonly mensagens = signal<MensagemChat[]>([]);
  readonly enviando = signal(false);
  readonly envioDados = signal<EstadoEnvio>('ocioso');
  readonly ultimoCanal = signal<CanalDados>('email');
  readonly erroEnvio = signal('');
  readonly solicitando = signal(false);
  readonly protocolo = signal<{ protocolo: number; prazo_dias: number } | null>(null);
  readonly ofertas = signal<OfertaUpsell[]>([]);
  readonly ofertasErro = signal('');
  /** Chave da oferta em checkout — trava os botões durante o redirect. */
  readonly pagando = signal('');
  urlDadosPdf = '';
  rascunho = '';
  tipoLgpd = 'acesso';
  detalheLgpd = '';
  private token = '';

  ngOnInit(): void {
    this.seo.updateSeo({ title: 'Portal do hóspede', description: 'Concierge digital da sua hospedagem' });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.urlDadosPdf = this.guest.dadosPdfUrl(this.token);
    this.guest.portal(this.token).subscribe({
      next: (i) => {
        this.info.set(i);
        this.mensagens.set(i.historico ?? []);
        this.estado.set('ok');
        this.carregarOfertas();
      },
      error: () => this.estado.set('erro'),
    });
  }

  /** Extras compráveis — preço e disponibilidade calculados no servidor. */
  private carregarOfertas(): void {
    this.guest.ofertas(this.token).subscribe({
      next: (o) => this.ofertas.set(o),
      error: () => this.ofertasErro.set(''),
    });
  }

  chaveOferta(o: OfertaUpsell): string {
    return `${o.oferta}:${o.idacomodacao ?? 0}`;
  }

  moeda(centavos: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      centavos / 100,
    );
  }

  /** Abre o checkout seguro do extra — o efeito na reserva só acontece
   *  após a confirmação do provedor (webhook), nunca pelo redirect. */
  comprarExtra(o: OfertaUpsell): void {
    if (this.pagando()) return;
    this.pagando.set(this.chaveOferta(o));
    this.ofertasErro.set('');
    this.guest.checkoutExtra(this.token, o.oferta, o.idacomodacao).subscribe({
      next: (r) => {
        globalThis.location.href = r.checkout_url;
      },
      error: (e) => {
        const msg =
          e?.error?.mensagem ?? e?.error?.erro ?? e?.error?.message ??
          'Não foi possível abrir o pagamento — tente de novo ou fale com a recepção.';
        this.ofertasErro.set(msg);
        this.pagando.set('');
      },
    });
  }

  enviar(): void {
    const texto = this.rascunho.trim();
    if (!texto || this.enviando()) return;
    this.rascunho = '';
    this.enviando.set(true);
    this.mensagens.update((m) => [...m, { origem: 'hospede', texto }]);
    this.guest.enviarMensagem(this.token, texto).subscribe({
      next: (r) => {
        this.mensagens.update((m) => [...m, { origem: 'inna', texto: r.resposta }]);
        this.enviando.set(false);
      },
      error: () => {
        this.mensagens.update((m) => [
          ...m,
          { origem: 'inna', texto: 'Tive uma instabilidade agora — tente de novo em instantes ou fale com a recepção.' },
        ]);
        this.enviando.set(false);
      },
    });
  }

  /** LGPD — envia o documento do titular pelo canal escolhido (fila do backend). */
  enviarDados(canal: CanalDados): void {
    if (this.envioDados() === 'enviando') return;
    this.ultimoCanal.set(canal);
    this.envioDados.set('enviando');
    this.erroEnvio.set('');
    this.guest.enviarDados(this.token, canal).subscribe({
      next: () => this.envioDados.set('enviado'),
      error: (e) => {
        const msg =
          e?.error?.mensagem ??
          e?.error?.erro ??
          e?.error?.message ??
          'Não foi possível enviar agora — fale com a recepção ou tente pelo e-mail.';
        this.erroEnvio.set(msg);
        this.envioDados.set('erro');
      },
    });
  }

  /** LGPD — abre solicitação com protocolo (resposta em até 15 dias). */
  solicitar(): void {
    if (this.solicitando()) return;
    this.solicitando.set(true);
    this.guest.solicitarLgpd(this.token, this.tipoLgpd, this.detalheLgpd.trim() || undefined).subscribe({
      next: (p) => {
        this.protocolo.set(p);
        this.solicitando.set(false);
      },
      error: () => this.solicitando.set(false),
    });
  }
}
