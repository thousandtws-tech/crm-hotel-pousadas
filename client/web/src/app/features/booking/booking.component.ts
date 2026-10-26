import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BookingService } from '../../core/services/booking.service';
import { AccommodationService } from '../../core/services/accommodation.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-booking',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="booking-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=2200&q=85"
          alt="Consultar disponibilidade na Pousada Espírito do Mar em Cabo Frio"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
          Pousada no Peró · Cabo Frio
        </span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Consultar Disponibilidade
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Informe as datas pretendidas e a categoria de acomodação desejada para consultar disponibilidade e tarifas na Pousada Espírito do Mar.
        </p>
      </div>
    </header>

    <!-- Booking Workflow -->
    <section class="py-12 sm:py-16 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        
        @if (!isSuccess()) {
          <div class="booking-workflow-grid grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            
            <!-- Left: Workflow Steps (Col 1-7) -->
            <div class="lg:col-span-7 flex flex-col gap-6 sm:gap-8">
              
              <!-- Step 1: Dates & Guests -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">01 · Período</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Datas da viagem</h2>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div>
                    <label for="booking-checkin" class="type-eyebrow block mb-1 text-[10px]">Check-in (a partir das 13h)</label>
                    <input
                      id="booking-checkin"
                      type="date"
                      [ngModel]="checkIn()"
                      (ngModelChange)="checkIn.set($event)"
                      name="checkIn"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="booking-checkout" class="type-eyebrow block mb-1 text-[10px]">Check-out (até as 11h)</label>
                    <input
                      id="booking-checkout"
                      type="date"
                      [ngModel]="checkOut()"
                      (ngModelChange)="checkOut.set($event)"
                      name="checkOut"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="booking-guests" class="type-eyebrow block mb-1 text-[10px]">Hóspedes</label>
                    <select
                      id="booking-guests"
                      [ngModel]="guests()"
                      (ngModelChange)="guests.set($event)"
                      name="guests"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    >
                      <option [value]="1">1 Hóspede</option>
                      <option [value]="2">2 Hóspedes</option>
                      <option [value]="3">3 Hóspedes</option>
                      <option [value]="4">4 Hóspedes</option>
                    </select>
                  </div>
                </div>

                <div class="mt-4 pt-4 border-t border-[#DCE6EA] text-xs text-[#536B73] flex items-center justify-between">
                  <span>Duração:</span>
                  <span class="font-medium text-[#054054]">{{ calculatedNights() }} {{ calculatedNights() === 1 ? 'diária' : 'diárias' }}</span>
                </div>
              </div>

              <!-- Step 2: Choose Accommodation -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">02 · Categoria</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Escolha a acomodação</h2>

                <div class="space-y-3">
                  @for (acc of accommodationService.accommodations(); track acc.id) {
                    <div
                      (click)="selectedSuiteSlug.set(acc.slug)"
                      class="p-3.5 sm:p-4 border transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer"
                      [class]="selectedSuiteSlug() === acc.slug
                        ? 'border-[#054054] bg-[#EEF3F5]'
                        : 'border-[#DCE6EA] hover:border-[#054054]/40'"
                    >
                      <div class="flex items-center gap-4">
                        <img [src]="acc.coverImage" [alt]="acc.name + ' (imagem ilustrativa)'" class="w-16 h-16 object-cover flex-shrink-0" />
                        <div>
                          <h3 class="font-serif text-base text-[#054054] font-medium">{{ acc.name }}</h3>
                          <span class="type-caption block text-[#536B73]">{{ acc.view }} · Até {{ acc.guests }} hóspedes</span>
                        </div>
                      </div>

                      <div class="text-right self-end sm:self-center flex-shrink-0">
                        <span class="font-serif text-sm text-[#054054]">
                          {{ acc.priceLabel }}
                        </span>
                      </div>
                    </div>
                  }
                </div>
              </div>

              <!-- Step 3: Guest Contact Information -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">03 · Seus Dados</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Dados para retorno</h2>

                <form (submit)="onSubmitBooking()" class="space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label for="book-name" class="type-eyebrow block mb-1 text-[10px]">Nome Completo</label>
                      <input
                        id="book-name"
                        type="text"
                        [ngModel]="guestName()"
                        (ngModelChange)="guestName.set($event)"
                        name="guestName"
                        required
                        class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                      />
                    </div>

                    <div>
                      <label for="book-email" class="type-eyebrow block mb-1 text-[10px]">E-mail</label>
                      <input
                        id="book-email"
                        type="email"
                        [ngModel]="guestEmail()"
                        (ngModelChange)="guestEmail.set($event)"
                        name="guestEmail"
                        required
                        class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                      />
                    </div>
                  </div>

                  <div>
                    <label for="book-phone" class="type-eyebrow block mb-1 text-[10px]">Telefone com DDD</label>
                    <input
                      id="book-phone"
                      type="tel"
                      [ngModel]="guestPhone()"
                      (ngModelChange)="guestPhone.set($event)"
                      name="guestPhone"
                      required
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="book-requests" class="type-eyebrow block mb-1 text-[10px]">Observações ou Preferências</label>
                    <textarea
                      id="book-requests"
                      rows="3"
                      [ngModel]="specialRequests()"
                      (ngModelChange)="specialRequests.set($event)"
                      name="specialRequests"
                      placeholder="Informe se deseja quarto com varanda, vaga no estacionamento ou outras dúvidas..."
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054] resize-none"
                    ></textarea>
                  </div>

                  <button
                    type="submit"
                    [disabled]="isLoading()"
                    class="btn-primary w-full mt-2 cursor-pointer"
                  >
                    @if (isLoading()) {
                      <span>Enviando consulta...</span>
                    } @else {
                      <span>Solicitar cotação e disponibilidade</span>
                    }
                  </button>
                </form>
              </div>

            </div>

            <!-- Right: Order Summary (Col 8-12) -->
            <aside class="lg:col-span-5 sticky top-24" aria-label="Resumo da Consulta">
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">Resumo da Consulta</span>
                <h3 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Pousada Espírito do Mar</h3>

                @if (selectedAccommodation(); as acc) {
                  <div class="mb-5 pb-5 border-b border-[#DCE6EA]">
                    <img [src]="acc.coverImage" [alt]="acc.name + ' (imagem ilustrativa)'" class="w-full aspect-[16/10] object-cover mb-3" />
                    <h4 class="font-serif text-xl text-[#054054]">{{ acc.name }}</h4>
                    <span class="type-caption block text-[#536B73]">{{ acc.view }} · {{ acc.beds }}</span>
                  </div>

                  <div class="space-y-2 text-xs text-[#536B73] mb-5 pb-5 border-b border-[#DCE6EA]">
                    <div class="flex justify-between">
                      <span>Período:</span>
                      <span class="text-[#054054] font-medium">{{ checkIn() }} a {{ checkOut() }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Diárias:</span>
                      <span class="text-[#054054] font-medium">{{ calculatedNights() }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Hóspedes:</span>
                      <span class="text-[#054054] font-medium">{{ guests() }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Tarifa:</span>
                      <span class="text-[#054054] font-medium">{{ acc.priceLabel }}</span>
                    </div>
                  </div>
                }

                <div class="pt-2 text-center space-y-2">
                  <a
                    [href]="'tel:' + hotelConfig.phoneHref"
                    class="btn-secondary w-full"
                  >
                    <span>Atendimento por Telefone: {{ hotelConfig.phone }}</span>
                  </a>
                  <span class="type-caption block text-[#536B73]">
                    Bairro Peró · Cabo Frio, RJ
                  </span>
                </div>

              </div>
            </aside>

          </div>
        } @else {
          <!-- Confirmation Screen -->
          <div class="max-w-xl mx-auto bg-white p-8 sm:p-12 border border-[#DCE6EA] text-center shadow-sm">
            <span class="w-12 h-12 rounded-full bg-[#054054] text-[#F7F5F0] flex items-center justify-center mx-auto mb-6">
              <app-icon name="check" [size]="22"></app-icon>
            </span>
            <span class="type-eyebrow text-[#DDA554] block mb-2">Consulta Registrada</span>
            <h2 class="font-serif text-3xl text-[#054054] mb-4">Agradecemos o seu contato</h2>
            <p class="type-body text-sm max-w-md mx-auto mb-8">
              Registramos seu interesse na categoria <strong>{{ selectedAccommodation()?.name }}</strong>. Para confirmar tarifas e disponibilidade com rapidez, você também pode falar diretamente pelo telefone <strong>{{ hotelConfig.phone }}</strong>.
            </p>

            <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                routerLink="/"
                class="btn-primary"
              >
                Voltar ao Início
              </a>
              <a
                [href]="'tel:' + hotelConfig.phoneHref"
                class="btn-secondary"
              >
                Ligar: {{ hotelConfig.phone }}
              </a>
            </div>
          </div>
        }

      </div>
    </section>
  `
})
export class BookingComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly route = inject(ActivatedRoute);
  public readonly bookingService = inject(BookingService);
  public readonly accommodationService = inject(AccommodationService);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  public readonly checkIn = signal<string>(this.bookingService.filter().checkIn);
  public readonly checkOut = signal<string>(this.bookingService.filter().checkOut);
  public readonly guests = signal<number>(this.bookingService.filter().guests);
  public readonly selectedSuiteSlug = signal<string>('quarto-duplo-standard');

  public readonly guestName = signal<string>('');
  public readonly guestEmail = signal<string>('');
  public readonly guestPhone = signal<string>('');
  public readonly specialRequests = signal<string>('');
  public readonly isLoading = signal<boolean>(false);
  public readonly isSuccess = signal<boolean>(false);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public readonly calculatedNights = computed(() => {
    const start = new Date(this.checkIn()).getTime();
    const end = new Date(this.checkOut()).getTime();
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  });

  public readonly selectedAccommodation = computed(() => {
    return this.accommodationService.getBySlug(this.selectedSuiteSlug()) || this.accommodationService.accommodations()[0];
  });

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Consultar Disponibilidade | Pousada Espírito do Mar, Cabo Frio',
      description: 'Consulte a disponibilidade de hospedagem na Pousada Espírito do Mar, localizada no bairro Peró, em Cabo Frio (RJ).',
      url: 'https://pousadaespiritodomar.com.br/reservar'
    });

    this.route.queryParamMap.subscribe((params) => {
      const suite = params.get('suite');
      const checkIn = params.get('checkIn');
      const checkOut = params.get('checkOut');
      const guests = params.get('guests');

      if (suite) this.selectedSuiteSlug.set(suite);
      if (checkIn) this.checkIn.set(checkIn);
      if (checkOut) this.checkOut.set(checkOut);
      if (guests) this.guests.set(Number(guests));
    });
  }

  public async onSubmitBooking(): Promise<void> {
    if (!this.guestName() || !this.guestEmail() || !this.guestPhone()) return;

    this.isLoading.set(true);
    const acc = this.selectedAccommodation();

    await this.bookingService.submitBookingRequest({
      checkIn: this.checkIn(),
      checkOut: this.checkOut(),
      guests: this.guests(),
      accommodationSlug: acc.slug,
      accommodationName: acc.name,
      guestName: this.guestName(),
      guestEmail: this.guestEmail(),
      guestPhone: this.guestPhone(),
      specialRequests: this.specialRequests(),
      totalNights: this.calculatedNights(),
      estimatedTotal: acc.price ? acc.price * this.calculatedNights() : undefined
    });

    this.isLoading.set(false);
    this.isSuccess.set(true);
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.booking-page-header');
      const workflow = root.querySelector<HTMLElement>('.booking-workflow-grid');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (workflow) {
        this.motion.animateScrollReveal(workflow, { y: 24, duration: 0.8, delay: 0.1, trigger: workflow });
      }
    }, this.destroyRef);
  }
}
