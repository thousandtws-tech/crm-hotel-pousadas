import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { GuestService, MensagemChat, PortalInfo } from '../../core/services/guest.service';
import { SeoService } from '../../core/services/seo.service';

type Estado = 'carregando' | 'ok' | 'erro';

/** Portal do hóspede — resumo da estadia + chat com a concierge Inná.
 *  Acesso pelo token opaco da reserva; o backend só expõe dados dela. */
@Component({
  selector: 'app-portal',
  imports: [RouterLink, DatePipe, FormsModule],
  template: `
    <header class="pt-32 pb-12 bg-[#032B38] text-white">
      <div class="max-w-2xl mx-auto px-6">
        <p class="text-sm uppercase tracking-[0.2em] text-[#8FBECB] mb-2">Portal do hóspede</p>
        <h1 class="text-3xl sm:text-4xl font-semibold">Sua hospedagem</h1>
        @if (info(); as i) {
          <p class="mt-3 text-white/80">
            {{ i.hospede }} · {{ i.acomodacao }} ·
            {{ i.entrada | date: 'dd/MM/yyyy' }} → {{ i.saida | date: 'dd/MM/yyyy' }}
          </p>
        }
      </div>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-10">
      @switch (estado()) {
        @case ('carregando') {
          <p class="text-center text-gray-500 py-16">Carregando sua reserva…</p>
        }
        @case ('erro') {
          <div class="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-red-800">Link inválido</h2>
            <p class="mt-2 text-red-700">Não encontramos esta reserva. Fale com a recepção.</p>
            <a routerLink="/" class="inline-block mt-6 text-[#032B38] underline">Voltar ao site</a>
          </div>
        }
        @default {
          <section aria-label="Conversa com a concierge" class="rounded-xl border border-gray-200 overflow-hidden">
            <div class="bg-[#032B38] px-5 py-3 flex items-center gap-3">
              <span class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#8FBECB] text-[#032B38] font-bold">I</span>
              <div>
                <p class="text-white font-medium">Inná</p>
                <p class="text-xs text-[#8FBECB]">Concierge da pousada — responde na hora</p>
              </div>
            </div>

            <div class="h-96 overflow-y-auto bg-gray-50 p-4 space-y-3" role="log" aria-live="polite" aria-label="Mensagens">
              @if (!mensagens().length) {
                <p class="text-center text-sm text-gray-400 mt-8">
                  Pergunte sobre check-in, café da manhã, Wi-Fi ou serviços.
                </p>
              }
              @for (m of mensagens(); track $index) {
                <div class="flex" [class.justify-end]="m.origem === 'hospede'">
                  <p class="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-line"
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
                <p class="text-sm text-gray-400 italic">Inná está digitando…</p>
              }
            </div>

            <form (ngSubmit)="enviar()" class="flex gap-2 border-t border-gray-200 bg-white p-3">
              <label for="msg" class="sr-only">Sua mensagem</label>
              <input id="msg" name="msg" [(ngModel)]="rascunho" maxlength="1000" required
                     placeholder="Escreva sua pergunta…" autocomplete="off"
                     class="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-[#032B38] focus:outline-none" />
              <button type="submit" [disabled]="enviando() || !rascunho.trim()"
                      class="rounded-full bg-[#032B38] px-5 py-2 text-sm font-medium text-white disabled:opacity-40">
                Enviar
              </button>
            </form>
          </section>

          <section aria-label="Seus dados e privacidade" class="mt-8 rounded-xl border border-gray-200 p-5">
            <h2 class="text-sm font-semibold text-[#032B38]">Seus dados — LGPD</h2>
            <p class="mt-1 text-xs text-gray-500">
              Você pode baixar todos os seus dados ou pedir acesso, correção,
              eliminação, portabilidade ou revogar consentimentos.
              Respondemos em até 15 dias.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" (click)="baixarDados()" [disabled]="baixando()"
                      class="rounded-full border border-[#032B38] px-4 py-1.5 text-xs font-medium text-[#032B38]">
                {{ baixando() ? 'Gerando…' : 'Baixar meus dados (JSON)' }}
              </button>
            </div>
            @if (protocolo(); as p) {
              <p class="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800">
                Solicitação registrada — protocolo <strong>#{{ p.protocolo }}</strong>.
                Nossa equipe responde em até {{ p.prazo_dias }} dias.
              </p>
            } @else {
              <form (ngSubmit)="solicitar()" class="mt-3 flex flex-col gap-2">
                <div class="flex flex-wrap gap-2">
                  <label for="tipo-lgpd" class="sr-only">Tipo de solicitação</label>
                  <select id="tipo-lgpd" name="tipo-lgpd" [(ngModel)]="tipoLgpd"
                          class="rounded-full border border-gray-300 px-3 py-1.5 text-xs">
                    <option value="acesso">Confirmar/acessar meus dados</option>
                    <option value="retificacao">Corrigir meus dados</option>
                    <option value="eliminacao">Eliminar meus dados pessoais</option>
                    <option value="portabilidade">Portar meus dados</option>
                    <option value="revogacao">Revogar consentimentos</option>
                  </select>
                  <button type="submit" [disabled]="solicitando()"
                          class="rounded-full bg-[#032B38] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                    {{ solicitando() ? 'Enviando…' : 'Solicitar' }}
                  </button>
                </div>
                <label for="detalhe-lgpd" class="sr-only">Detalhe (opcional)</label>
                <input id="detalhe-lgpd" name="detalhe-lgpd" [(ngModel)]="detalheLgpd" maxlength="500"
                       placeholder="Detalhe do pedido (opcional)"
                       class="rounded-full border border-gray-300 px-4 py-1.5 text-xs focus:border-[#032B38] focus:outline-none" />
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
  readonly baixando = signal(false);
  readonly solicitando = signal(false);
  readonly protocolo = signal<{ protocolo: number; prazo_dias: number } | null>(null);
  rascunho = '';
  tipoLgpd = 'acesso';
  detalheLgpd = '';
  private token = '';

  ngOnInit(): void {
    this.seo.updateSeo({ title: 'Portal do hóspede', description: 'Concierge digital da sua hospedagem' });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.guest.portal(this.token).subscribe({
      next: (i) => {
        this.info.set(i);
        this.mensagens.set(i.historico ?? []);
        this.estado.set('ok');
      },
      error: () => this.estado.set('erro'),
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

  /** LGPD art. 18 — baixa o JSON com todos os dados pessoais do titular. */
  baixarDados(): void {
    if (this.baixando()) return;
    this.baixando.set(true);
    this.guest.exportarDados(this.token).subscribe({
      next: (dados) => {
        const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'meus-dados.json';
        a.click();
        URL.revokeObjectURL(url);
        this.baixando.set(false);
      },
      error: () => this.baixando.set(false),
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
