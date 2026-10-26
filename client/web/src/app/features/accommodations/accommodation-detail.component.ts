import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AccommodationService } from '../../core/services/accommodation.service';
import { Accommodation } from '../../core/models/accommodation.model';
import { BookingService } from '../../core/services/booking.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-accommodation-detail',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    @if (accommodation(); as acc) {
      <!-- Room Hero Section -->
      <section class="detail-hero relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
        <div class="absolute inset-0 z-0">
          <img
            [src]="activeHeroImage()"
            [alt]="acc.name + ' (imagem ilustrativa)'"
            class="detail-hero-img w-full h-full object-cover object-center filter brightness-[0.6] transition-all duration-700"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/45 to-transparent"></div>
        </div>

        <div class="detail-hero-content relative z-10 container-editorial flex flex-col items-start">
          <a
            routerLink="/acomodacoes"
            class="inline-flex items-center gap-2 text-xs uppercase tracking-luxury text-[#F7F5F0]/70 hover:text-white mb-4 transition-colors"
          >
            <app-icon name="chevron-left" [size]="14"></app-icon>
            <span>Todas as acomodações</span>
          </a>

          <span class="type-eyebrow text-[#DDA554] block mb-2">
            {{ acc.view }}
          </span>

          <h1 class="type-title text-4xl sm:text-5xl lg:text-6xl text-white font-normal mb-3">
            {{ acc.name }}
          </h1>

          <p class="font-serif italic text-lg sm:text-xl text-[#F7F5F0]/85 max-w-2xl">
            "{{ acc.subtitle }}"
          </p>
        </div>
      </section>

      <!-- Main Content and Booking Section -->
      <section class="py-12 sm:py-16 lg:py-20 bg-[#F7F5F0]">
        <div class="container-editorial">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            
            <!-- Left Column: Details & Gallery (Col 1-8) -->
            <div class="lg:col-span-8 flex flex-col">
              
              <!-- Quick Key Specs -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 py-4 sm:py-5 border-y border-[#DCE6EA] mb-8 sm:mb-10">
                <div>
                  <span class="type-caption block text-[#536B73] mb-1">Capacidade</span>
                  <span class="text-sm font-medium text-[#054054]">Até {{ acc.guests }} hóspedes</span>
                </div>
                <div>
                  <span class="type-caption block text-[#536B73] mb-1">Configuração</span>
                  <span class="text-sm font-medium text-[#054054]">{{ acc.beds }}</span>
                </div>
                <div>
                  <span class="type-caption block text-[#536B73] mb-1">Característica</span>
                  <span class="text-sm font-medium text-[#054054]">{{ acc.view }}</span>
                </div>
              </div>

              <!-- Interactive Photo Gallery -->
              <div class="mb-8 sm:mb-10">
                <span class="type-eyebrow text-[#DDA554] block mb-3">Imagens de Referência</span>
                
                <!-- Main Featured Photo -->
                <div class="editorial-image-container aspect-[16/10] mb-3 shadow-sm">
                  <img
                    [src]="activeHeroImage()"
                    [alt]="acc.name + ' (imagem ilustrativa)'"
                    class="w-full h-full object-cover"
                  />
                </div>

                <!-- Thumbnails -->
                <div class="grid grid-cols-4 gap-3">
                  @for (img of acc.images; track img; let idx = $index) {
                    <button
                      type="button"
                      (click)="activeHeroImage.set(img)"
                      class="relative aspect-[16/10] overflow-hidden border transition-all duration-200 focus:outline-none cursor-pointer"
                      [class]="activeHeroImage() === img ? 'border-[#054054] opacity-100 ring-1 ring-[#054054]' : 'border-[#DCE6EA] opacity-60 hover:opacity-100'"
                      [attr.aria-label]="'Ver foto ' + (idx + 1)"
                    >
                      <img [src]="img" [alt]="acc.name + ' miniatura ' + (idx + 1)" class="w-full h-full object-cover" />
                    </button>
                  }
                </div>
              </div>

              <!-- Editorial Narrative Description -->
              <div class="mb-8 sm:mb-10 pb-8 sm:pb-10 border-b border-[#DCE6EA]">
                <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Sobre a acomodação</h2>
                <div class="space-y-4 type-body text-base">
                  <p>{{ acc.description }}</p>
                </div>

                @if (acc.editorialQuote) {
                  <blockquote class="pl-6 border-l-2 border-[#DDA554] font-serif italic text-lg text-[#054054] my-6">
                    “{{ acc.editorialQuote }}”
                  </blockquote>
                }
              </div>

              <!-- Amenities List -->
              <div class="mb-8 sm:mb-10">
                <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Comodidades da Categoria</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-8 text-sm text-[#054054]">
                  @for (amenity of acc.amenities; track amenity.id) {
                    <div class="flex items-center gap-3 py-2 border-b border-[#DCE6EA]">
                      <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554]"></span>
                      <span class="font-normal">{{ amenity.name }}</span>
                    </div>
                  }
                </div>
              </div>

            </div>

            <!-- Right Column: Sticky Booking Widget (Col 9-12) -->
            <aside class="lg:col-span-4 sticky top-24 z-20" aria-label="Consulta de Disponibilidade da Acomodação">
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-[0_12px_32px_rgba(5,64,84,0.06)]">
                
                <div class="flex items-baseline justify-between mb-5 pb-5 border-b border-[#DCE6EA]">
                  <div>
                    <span class="type-caption block text-[#536B73]">Tarifas para o período</span>
                    <span class="font-serif text-2xl text-[#054054] font-medium">
                      {{ acc.priceLabel }}
                    </span>
                  </div>
                </div>

                <!-- Form Fields -->
                <form (submit)="onBookSuite()" class="space-y-3.5 mb-5">
                  
                  <div>
                    <label for="detail-checkin" class="type-eyebrow block mb-1 text-[10px]">Check-in (a partir das 13h)</label>
                    <input
                      id="detail-checkin"
                      type="date"
                      [ngModel]="checkIn()"
                      (ngModelChange)="checkIn.set($event)"
                      name="checkIn"
                      required
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="detail-checkout" class="type-eyebrow block mb-1 text-[10px]">Check-out (até as 11h)</label>
                    <input
                      id="detail-checkout"
                      type="date"
                      [ngModel]="checkOut()"
                      (ngModelChange)="checkOut.set($event)"
                      name="checkOut"
                      required
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="detail-guests" class="type-eyebrow block mb-1 text-[10px]">Hóspedes</label>
                    <select
                      id="detail-guests"
                      [ngModel]="guests()"
                      (ngModelChange)="guests.set($event)"
                      name="guests"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    >
                      <option [value]="1">1 Hóspede</option>
                      <option [value]="2">2 Hóspedes</option>
                      @if (acc.guests >= 3) {
                        <option [value]="3">3 Hóspedes</option>
                      }
                      @if (acc.guests >= 4) {
                        <option [value]="4">4 Hóspedes</option>
                      }
                    </select>
                  </div>

                  <!-- Summary Calc -->
                  <div class="py-3 border-y border-[#DCE6EA] flex justify-between items-center text-xs text-[#536B73]">
                    <span>Período selecionado</span>
                    <span class="font-serif text-base text-[#054054] font-medium">
                      {{ nights() }} {{ nights() === 1 ? 'diária' : 'diárias' }}
                    </span>
                  </div>

                  <button
                    type="submit"
                    class="w-full btn-primary cursor-pointer"
                  >
                    Consultar disponibilidade
                  </button>
                </form>

                <!-- Direct Phone Alternative -->
                <div class="text-center pt-2">
                  <a
                    [href]="'tel:' + hotelConfig.phoneHref"
                    class="btn-secondary w-full"
                  >
                    <span>Ligar: {{ hotelConfig.phone }}</span>
                  </a>
                </div>

              </div>
            </aside>

          </div>
        </div>
      </section>
    } @else {
      <!-- Fallback when accommodation is not found -->
      <section class="py-44 text-center bg-[#F7F5F0]">
        <div class="max-w-md mx-auto px-6">
          <h1 class="font-serif text-3xl text-[#054054] mb-4">Acomodação não encontrada</h1>
          <p class="type-body mb-8">A categoria solicitada não foi localizada. Consulte todas as opções de acomodações disponíveis na pousada.</p>
          <a routerLink="/acomodacoes" class="btn-primary">
            Conheça nossas acomodações
          </a>
        </div>
      </section>
    }
  `
})
export class AccommodationDetailComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accommodationService = inject(AccommodationService);
  private readonly bookingService = inject(BookingService);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const heroContent = root.querySelector<HTMLElement>('.detail-hero-content');
      const heroImg = root.querySelector<HTMLElement>('.detail-hero-img');

      if (heroImg) {
        this.motion.animateScrollReveal(heroImg, { y: 0, duration: 1.2 });
      }

      if (heroContent) {
        this.motion.animateScrollReveal(heroContent, { y: 28, duration: 0.85 });
      }
    }, this.destroyRef);
  }

  public readonly accommodation = signal<Accommodation | undefined>(undefined);
  public readonly activeHeroImage = signal<string>('');

  public readonly checkIn = signal<string>(this.bookingService.filter().checkIn);
  public readonly checkOut = signal<string>(this.bookingService.filter().checkOut);
  public readonly guests = signal<number>(this.bookingService.filter().guests);

  public readonly nights = computed(() => {
    const start = new Date(this.checkIn()).getTime();
    const end = new Date(this.checkOut()).getTime();
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  });

  public ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (slug) {
        const item = this.accommodationService.getBySlug(slug);
        this.accommodation.set(item);
        if (item) {
          this.activeHeroImage.set(item.coverImage);
          this.seoService.updateSeo({
            title: `${item.name} | Pousada Espírito do Mar, Cabo Frio`,
            description: `${item.shortDescription} Hospedagem no bairro Peró, em Cabo Frio. Consulte a disponibilidade.`,
            image: item.coverImage,
            url: `https://pousadaespiritodomar.com.br/acomodacoes/${item.slug}`
          });
        }
      }
    });
  }

  public onBookSuite(): void {
    const acc = this.accommodation();
    if (!acc) return;

    this.bookingService.updateFilter({
      checkIn: this.checkIn(),
      checkOut: this.checkOut(),
      guests: Number(this.guests()),
      accommodationSlug: acc.slug
    });

    this.router.navigate(['/reservar'], {
      queryParams: {
        suite: acc.slug,
        checkIn: this.checkIn(),
        checkOut: this.checkOut(),
        guests: this.guests()
      }
    });
  }
}

