import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GuestService, AvaliacaoInfo } from '../../core/services/guest.service';
import { Meta } from '@angular/platform-browser';
import { SeoService } from '../../core/services/seo.service';

type Estado = 'carregando' | 'form' | 'enviando' | 'enviado' | 'respondida' | 'erro';

interface Categoria {
  campo: 'nota_limpeza' | 'nota_atendimento' | 'nota_custo' | 'nota_localizacao';
  rotulo: string;
}

const CATEGORIAS: Categoria[] = [
  { campo: 'nota_limpeza', rotulo: 'Limpeza' },
  { campo: 'nota_atendimento', rotulo: 'Atendimento' },
  { campo: 'nota_custo', rotulo: 'Custo-benefício' },
  { campo: 'nota_localizacao', rotulo: 'Localização' },
];

const ESTRELAS = [1, 2, 3, 4, 5];
const NPS_FAIXA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Pesquisa pós-estadia — link único por avaliação, recebido pelo hóspede. */
@Component({
  selector: 'app-avaliacao-form',
  imports: [RouterLink],
  template: `
    <header class="pt-32 pb-12 bg-[#032B38] text-white">
      <div class="max-w-2xl mx-auto px-6">
        <p class="text-sm uppercase tracking-[0.2em] text-[#8FBECB] mb-2">Sua opinião importa</p>
        <h1 class="text-3xl sm:text-4xl font-semibold">Como foi sua estadia?</h1>
      </div>
    </header>

    <main class="max-w-2xl mx-auto px-6 py-10">
      @switch (estado()) {
        @case ('carregando') {
          <p class="text-center text-gray-500 py-16">Carregando…</p>
        }
        @case ('erro') {
          <div class="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-red-800">Pesquisa indisponível</h2>
            <p class="mt-2 text-red-700">Este link de avaliação expirou ou não existe mais.</p>
            <a routerLink="/" class="inline-block mt-6 text-[#032B38] underline">Voltar ao site</a>
          </div>
        }
        @case ('respondida') {
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-emerald-800">Obrigado pela sua avaliação!</h2>
            <p class="mt-2 text-emerald-700">
              Nota geral: {{ info()?.nota_geral }}/5
              @if (info()?.resposta; as r) {
                <span class="block mt-3 text-sm"><strong>Resposta da pousada:</strong> {{ r }}</span>
              }
            </p>
          </div>
        }
        @case ('enviado') {
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
            <h2 class="text-xl font-semibold text-emerald-800">Avaliação enviada — muito obrigado!</h2>
            <p class="mt-2 text-emerald-700">Seu retorno nos ajuda a melhorar a cada hospedagem.</p>
            <a routerLink="/" class="inline-block mt-6 text-[#032B38] underline">Voltar ao site</a>
          </div>
        }
        @default {
          <form (ngSubmit)="enviar(com.value)" class="space-y-8">
            <section class="rounded-xl border border-gray-200 p-6 text-center">
              <h2 class="text-lg font-semibold text-[#032B38]">Nota geral *</h2>
              <div class="flex justify-center gap-2 mt-4" role="radiogroup" aria-label="Nota geral de 1 a 5">
                @for (n of estrelas; track n) {
                  <button type="button" (click)="notaGeral.set(n)" role="radio"
                    [attr.aria-checked]="notaGeral() === n" [attr.aria-label]="n + ' estrelas'"
                    class="text-4xl transition-transform hover:scale-110"
                    [class.text-amber-400]="n <= notaGeral()" [class.text-gray-300]="n > notaGeral()">
                    ★
                  </button>
                }
              </div>
            </section>

            <section class="rounded-xl border border-gray-200 p-6">
              <h2 class="text-lg font-semibold text-[#032B38] mb-4">Por categoria <span class="text-sm font-normal text-gray-500">(opcional)</span></h2>
              @for (c of categorias; track c.campo) {
                <div class="flex items-center justify-between py-2">
                  <span class="text-sm font-medium">{{ c.rotulo }}</span>
                  <div class="flex gap-1" role="radiogroup" [attr.aria-label]="'Nota de ' + c.rotulo">
                    @for (n of estrelas; track n) {
                      <button type="button" (click)="setNota(c.campo, n)" role="radio"
                        [attr.aria-checked]="notas()[c.campo] === n" [attr.aria-label]="n + ' estrelas'"
                        class="text-2xl"
                        [class.text-amber-400]="n <= (notas()[c.campo] ?? 0)" [class.text-gray-300]="n > (notas()[c.campo] ?? 0)">
                        ★
                      </button>
                    }
                  </div>
                </div>
              }
            </section>

            <section class="rounded-xl border border-gray-200 p-6">
              <h2 class="text-lg font-semibold text-[#032B38]">
                De 0 a 10, qual a chance de nos recomendar? <span class="text-sm font-normal text-gray-500">(opcional)</span>
              </h2>
              <div class="grid grid-cols-11 gap-1 mt-4" role="radiogroup" aria-label="Nota de recomendação de 0 a 10">
                @for (n of npsFaixa; track n) {
                  <button type="button" (click)="nps.set(n)" role="radio"
                    [attr.aria-checked]="nps() === n" [attr.aria-label]="'Nota ' + n"
                    class="rounded-lg border py-2 text-sm font-semibold transition-colors"
                    [class.bg-[#032B38]]="nps() === n" [class.text-white]="nps() === n"
                    [class.border-gray-300]="nps() !== n">
                    {{ n }}
                  </button>
                }
              </div>
              <div class="flex justify-between text-xs text-gray-500 mt-1">
                <span>Nada provável</span><span>Muito provável</span>
              </div>
            </section>

            <section class="rounded-xl border border-gray-200 p-6">
              <label class="block">
                <span class="text-lg font-semibold text-[#032B38]">Conte como foi <span class="text-sm font-normal text-gray-500">(opcional)</span></span>
                <textarea #com rows="4" class="mt-3 w-full"
                  placeholder="O que mais gostou? O que podemos melhorar?"></textarea>
              </label>
            </section>

            @if (erroEnvio()) {
              <p class="text-red-700 text-sm" role="alert">{{ erroEnvio() }}</p>
            }
            <button type="submit" [disabled]="notaGeral() === 0 || estado() === 'enviando'"
              class="w-full rounded-lg bg-[#032B38] px-6 py-4 text-white font-semibold disabled:opacity-50">
              {{ estado() === 'enviando' ? 'Enviando…' : 'Enviar avaliação' }}
            </button>
          </form>
        }
      }
    </main>
  `,
})
export class AvaliacaoFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly guest = inject(GuestService);
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);

  readonly estado = signal<Estado>('carregando');
  readonly info = signal<AvaliacaoInfo | null>(null);
  readonly erroEnvio = signal<string | null>(null);

  readonly notaGeral = signal(0);
  readonly notas = signal<Partial<Record<Categoria['campo'], number>>>({});
  readonly nps = signal<number | null>(null);

  readonly estrelas = ESTRELAS;
  readonly npsFaixa = NPS_FAIXA;
  readonly categorias = CATEGORIAS;

  ngOnInit(): void {
    this.seo.updateSeo({ title: 'Avalie sua estadia', description: 'Pesquisa de satisfação pós-estadia' });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.guest.avaliacao(token).subscribe({
      next: (av) => {
        this.info.set(av);
        this.estado.set(av.respondida ? 'respondida' : 'form');
      },
      error: () => this.estado.set('erro'),
    });
  }

  setNota(campo: Categoria['campo'], nota: number): void {
    this.notas.update((m) => ({ ...m, [campo]: m[campo] === nota ? undefined : nota }));
  }

  enviar(comentarioRaw: string): void {
    const comentario = comentarioRaw.trim() || undefined;
    this.estado.set('enviando');
    this.erroEnvio.set(null);
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.guest
      .responderAvaliacao(token, {
        nota_geral: this.notaGeral(),
        ...this.notas(),
        nps: this.nps() ?? undefined,
        comentario,
      })
      .subscribe({
        next: () => this.estado.set('enviado'),
        error: () => {
          this.estado.set('form');
          this.erroEnvio.set('Não foi possível enviar. Tente novamente em instantes.');
        },
      });
  }
}
