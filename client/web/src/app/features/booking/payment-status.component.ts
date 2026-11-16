import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PaymentService, StatusReserva } from '../../core/services/payment.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';

type Estado = 'carregando' | 'confirmado' | 'processando' | 'nao_concluido' | 'erro';

@Component({
  selector: 'app-payment-status',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="min-h-[70vh] pt-32 pb-20 bg-[#F7F5F0] flex items-center justify-center">
      <div class="max-w-xl mx-auto bg-white p-8 sm:p-12 border border-[#DCE6EA] text-center shadow-sm">

        @switch (estado()) {
          @case ('carregando') {
            <span class="w-12 h-12 rounded-full bg-[#054054]/10 text-[#054054] flex items-center justify-center mx-auto mb-6 animate-pulse">
              <app-icon name="check" [size]="22"></app-icon>
            </span>
            <h1 class="font-serif text-3xl text-[#054054] mb-3">Consultando seu pagamento…</h1>
            <p class="type-body text-sm text-[#536B73]">Aguarde um instante enquanto confirmamos com o provedor.</p>
          }

          @case ('confirmado') {
            <span class="w-12 h-12 rounded-full bg-[#054054] text-[#F7F5F0] flex items-center justify-center mx-auto mb-6">
              <app-icon name="check" [size]="22"></app-icon>
            </span>
            <span class="type-eyebrow text-[#DDA554] block mb-2">Pagamento confirmado</span>
            <h1 class="font-serif text-3xl text-[#054054] mb-4">Reserva garantida!</h1>
            <p class="type-body text-sm max-w-md mx-auto mb-4">
              Seu pagamento foi recebido e a reserva está confirmada. A recepção já foi notificada em tempo real.
            </p>
            @for (p of pagamentosPagos(); track p.tipo) {
              <p class="text-xs text-[#536B73]">
                {{ p.tipo === 'sinal' ? 'Sinal' : p.tipo === 'saldo' ? 'Saldo' : 'Integral' }}:
                {{ paymentService.formatCentavos(p.valor_centavos) }} via {{ p.metodo === 'pix' ? 'Pix' : 'cartão' }}
              </p>
            }
          }

          @case ('processando') {
            <span class="w-12 h-12 rounded-full bg-[#DDA554] text-white flex items-center justify-center mx-auto mb-6">
              <app-icon name="check" [size]="22"></app-icon>
            </span>
            <span class="type-eyebrow text-[#DDA554] block mb-2">Pagamento em processamento</span>
            <h1 class="font-serif text-3xl text-[#054054] mb-4">Quase lá…</h1>
            <p class="type-body text-sm max-w-md mx-auto mb-8">
              Seu pagamento está sendo processado pelo provedor (Pix pode levar alguns minutos para compensar).
              Esta página atualiza sozinha — você também receberá a confirmação por e-mail/telefone.
            </p>
          }

          @case ('nao_concluido') {
            <span class="type-eyebrow text-[#DDA554] block mb-2">Pagamento não concluído</span>
            <h1 class="font-serif text-3xl text-[#054054] mb-4">Reserva aguardando pagamento</h1>
            <p class="type-body text-sm max-w-md mx-auto mb-8">
              O pagamento não foi finalizado. Sua reserva provisória expira em breve —
              tente novamente ou entre em contato com a recepção para garantir a data.
            </p>
            <a routerLink="/reservar" class="btn-primary">Tentar novamente</a>
          }

          @case ('erro') {
            <h1 class="font-serif text-3xl text-[#054054] mb-4">Não encontramos esta reserva</h1>
            <p class="type-body text-sm max-w-md mx-auto mb-8">
              O link pode estar expirado ou incorreto. Se você já pagou, fale com a recepção —
              a confirmação chega de qualquer forma.
            </p>
          }
        }

        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
          <a routerLink="/" class="btn-secondary">Voltar ao Início</a>
          <a [href]="'tel:' + hotelConfig.phoneHref" class="btn-secondary">
            Recepção: {{ hotelConfig.phone }}
          </a>
        </div>
      </div>
    </section>
  `
})
export class PaymentStatusComponent implements OnInit, OnDestroy {
  public readonly hotelConfig = HOTEL_CONFIG;
  public readonly paymentService = inject(PaymentService);
  private readonly route = inject(ActivatedRoute);
  private readonly seoService = inject(SeoService);

  public readonly estado = signal<Estado>('carregando');
  public readonly status = signal<StatusReserva | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tentativas = 0;

  public pagamentosPagos() {
    return this.status()?.pagamentos.filter((p) => p.status === 'pago') ?? [];
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Status do Pagamento | Pousada Espírito do Mar',
      description: 'Acompanhamento do pagamento da sua reserva.',
      url: `${HOTEL_CONFIG.siteUrl}/reserva/pagamento`
    });
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.estado.set('erro');
      return;
    }
    // A página de sucesso NÃO confirma a reserva — apenas reflete o estado
    // persistido pelo webhook. Poll curto para o webhook chegar.
    void this.consultar(token);
    this.timer = setInterval(() => void this.consultar(token), 4000);
  }

  public ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async consultar(token: string): Promise<void> {
    this.tentativas += 1;
    const st = await this.paymentService.status(token);
    if (!st) {
      if (this.tentativas > 8) this.parar('erro');
      return;
    }
    this.status.set(st);
    const pago = st.pagamentos.some((p) => p.status === 'pago');
    const processando = st.pagamentos.some((p) => p.status === 'pendente');
    if (pago || st.confirmada) return this.parar('confirmado');
    if (st.status_reserva === 'c') return this.parar('nao_concluido');
    if (processando && this.tentativas <= 15) {
      this.estado.set('processando');
      return;
    }
    // Sem pagamento em andamento após janela de polling → não concluído.
    if (!processando) return this.parar('nao_concluido');
    this.parar('processando');
  }

  private parar(e: Estado): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.estado.set(e);
  }
}
