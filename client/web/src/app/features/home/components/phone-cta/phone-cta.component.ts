import { Component } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../../../core/config/hotel-config';

@Component({
  selector: 'app-phone-cta',
  imports: [IconComponent],
  template: `
    <section class="bg-[#F7F5F0] border-y border-[#DCE6EA] py-10 sm:py-12" aria-label="Reservas por telefone">
      <div class="container-editorial flex flex-col sm:flex-row items-center justify-center gap-5 sm:gap-8 text-center sm:text-left">
        <span class="w-12 h-12 shrink-0 rounded-full bg-[#054054] text-white flex items-center justify-center">
          <app-icon name="phone" [size]="20"></app-icon>
        </span>
        <div class="flex-1 min-w-0">
          <span class="type-eyebrow text-[#8A5A1E] block mb-1">Prefere reservar por telefone?</span>
          <p class="font-serif text-2xl sm:text-3xl text-[#054054] leading-tight">
            Nossa recepção atende todos os dias
          </p>
        </div>
        <a [href]="'tel:' + hotelConfig.phoneHref" class="btn-primary shrink-0">
          <app-icon name="phone" [size]="14"></app-icon>
          <span>Ligar {{ hotelConfig.phone }}</span>
        </a>
      </div>
    </section>
  `,
})
export class PhoneCtaComponent {
  protected readonly hotelConfig = HOTEL_CONFIG;
}
