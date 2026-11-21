import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Meta } from '@angular/platform-browser';
import { GuestService, PreFichaInfo } from '../../core/services/guest.service';
import { PaymentService, StatusReserva } from '../../core/services/payment.service';
import { SeoService } from '../../core/services/seo.service';

type Estado = 'carregando' | 'ok' | 'erro';

/** Página pública do lembrete de check-out — info da estadia + saldo pendente. */
@Component({
  selector: 'app-checkout-online',
  imports: [RouterLink, DatePipe],
  template: `
    <header class="pt-32 pb-12 bg-[#032B38] text-white">
      <div class="max-w-2xl mx-auto px-6">
        <p class="text-sm text-[#8FBECB] mb-2">Check-out</p>
        <h1 class="text-3xl sm:text-4xl font-semibold">Sua saída</h1>
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
          @if (info(); as i) {
            <div class="rounded-xl border border-gray-200 p-6 space-y-4">
              <h2 class="text-lg font-semibold text-[#032B38]">Resumo da estadia</h2>
              <dl class="grid sm:grid-cols-2 gap-3 text-sm">
                <div><dt class="text-gray-500">Hóspede</dt><dd class="font-medium">{{ i.cliente_nome }}</dd></div>
                <div><dt class="text-gray-500">Acomodação</dt><dd class="font-medium">{{ i.acomodacao }}</dd></div>
                <div><dt class="text-gray-500">Check-in</dt><dd class="font-medium">{{ i.entrada | date: 'dd/MM/yyyy' }}</dd></div>
                <div><dt class="text-gray-500">Check-out</dt><dd class="font-medium">{{ i.saida | date: 'dd/MM/yyyy' }}</dd></div>
              </dl>
            </div>
          }

          @if (saldoPendente() > 0) {
            <div class="rounded-xl border border-amber-200 bg-amber-50 p-6 mt-6">
              <h2 class="font-semibold text-amber-900">Saldo pendente</h2>
              <p class="text-sm text-amber-800 mt-1">
                Restam {{ reais(saldoPendente()) }} da sua estadia.
                Quite na recepção ou pelo link de pagamento que você recebeu.
              </p>
            </div>
          }

          <div class="rounded-xl border border-gray-200 p-6 mt-6 space-y-3">
            <h2 class="text-lg font-semibold text-[#032B38]">Antes de sair</h2>
            <ul class="list-disc list-inside text-sm text-gray-700 space-y-1">
              <li>Libere o quarto até o horário limite do check-out</li>
              <li>Deixe a chave na recepção ou no local combinado</li>
              <li>Confira consumos extras na sua conta antes de ir</li>
              <li>Precisa de late check-out? Consulte disponibilidade na recepção</li>
            </ul>
            <p class="text-sm text-gray-500 pt-2">
              Obrigado por se hospedar conosco. Esperamos você de volta!
            </p>
          </div>
        }
      }
    </main>
  `,
})
export class CheckoutOnlineComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly guest = inject(GuestService);
  private readonly payment = inject(PaymentService);
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);

  readonly estado = signal<Estado>('carregando');
  readonly info = signal<PreFichaInfo | null>(null);
  readonly status = signal<StatusReserva | null>(null);

  ngOnInit(): void {
    this.seo.updateSeo({ title: 'Check-out online', description: 'Informações de saída da sua hospedagem' });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    this.guest.preFicha(token).subscribe({
      next: (i) => {
        this.info.set(i);
        this.estado.set('ok');
      },
      error: () => this.estado.set('erro'),
    });
    this.payment.status(token).then((st) => this.status.set(st));
  }

  saldoPendente(): number {
    const st = this.status();
    if (!st) return 0;
    return st.pagamentos
      .filter((p) => p.status === 'pendente')
      .reduce((acc, p) => acc + p.valor_centavos, 0);
  }

  reais(centavos: number): string {
    return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
  }
}
