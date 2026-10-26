import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit, signal } from '@angular/core';
import { GalleryService } from '../../core/services/gallery.service';
import { GalleryCategory, GalleryItem } from '../../core/models/gallery-item.model';
import { LightboxComponent } from '../../shared/components/lightbox/lightbox.component';
import { SeoService } from '../../core/services/seo.service';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-gallery',
  imports: [LightboxComponent],
  template: `
    <!-- Header Hero -->
    <header class="gallery-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=2200&q=85"
          alt="Arquivo Fotográfico da Pousada Espírito do Mar"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
          Pousada Espírito do Mar · Cabo Frio
        </span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Galeria de Ambientes
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Referências visuais de acomodações, lazer e entorno da Praia do Peró, em Cabo Frio.
        </p>
      </div>
    </header>

    <!-- Gallery Filter & Grid -->
    <section class="py-12 sm:py-16 lg:py-20 bg-[#F7F5F0]" aria-labelledby="gallery-grid-title">
      <div class="container-editorial">
        <h2 id="gallery-grid-title" class="sr-only">Galeria de Fotos</h2>

        <!-- Minimal Category Filter -->
        <div class="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mb-8 sm:mb-10" role="tablist">
          @for (cat of categories; track cat.id) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="galleryService.selectedCategory() === cat.id"
              (click)="galleryService.setCategory(cat.id)"
              class="px-4 py-2 text-xs uppercase tracking-[0.16em] transition-all duration-200 border-b-2 focus:outline-none cursor-pointer"
              [class]="galleryService.selectedCategory() === cat.id
                ? 'border-[#054054] text-[#054054] font-medium'
                : 'border-transparent text-[#536B73] hover:text-[#054054]'"
            >
              {{ cat.label }}
            </button>
          }
        </div>

        <!-- Asymmetric CSS Grid -->
        <div class="gallery-masonry-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-5 sm:gap-6 lg:gap-8">
          @for (item of galleryService.filteredItems(); track item.id; let idx = $index) {
            <div
              class="gallery-grid-item editorial-image-container cursor-pointer shadow-sm group"
              [class]="getGridSpanClass(item.aspectRatio, idx)"
              (click)="openLightbox(item)"
            >
              <img
                [src]="item.imageUrl"
                [alt]="item.title"
                loading="lazy"
                class="w-full h-full object-cover"
              />
            </div>
          }
        </div>

      </div>

      <!-- Lightbox Modal -->
      @if (activeItem()) {
        <app-lightbox
          [item]="activeItem()!"
          [hasPrev]="activeIndex() > 0"
          [hasNext]="activeIndex() < galleryService.filteredItems().length - 1"
          (onClose)="closeLightbox()"
          (onPrev)="prevImage()"
          (onNext)="nextImage()"
        ></app-lightbox>
      }
    </section>
  `
})
export class GalleryComponent implements OnInit {
  public readonly galleryService = inject(GalleryService);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  public readonly activeItem = signal<GalleryItem | null>(null);
  public readonly activeIndex = signal<number>(-1);

  public readonly categories: { id: GalleryCategory; label: string }[] = [
    { id: 'todas', label: 'Todas' },
    { id: 'suites', label: 'Acomodações' },
    { id: 'gastronomia', label: 'Café da Manhã' },
    { id: 'lazer-spa', label: 'Piscina & Lazer' },
    { id: 'natureza', label: 'Região do Peró' }
  ];

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Galeria | Pousada Espírito do Mar no Peró, Cabo Frio',
      description: 'Conheça os ambientes de referência da Pousada Espírito do Mar, localizada no bairro Peró, em Cabo Frio (RJ).',
      url: 'https://pousadaespiritodomar.com.br/galeria'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.gallery-page-header');
      const items = root.querySelectorAll<HTMLElement>('.gallery-grid-item');
      const grid = root.querySelector<HTMLElement>('.gallery-masonry-grid');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (items.length > 0) {
        this.motion.animateScrollReveal(Array.from(items), {
          y: 20,
          duration: 0.8,
          stagger: 0.06,
          trigger: grid || items[0]
        });
      }
    }, this.destroyRef);
  }

  public getGridSpanClass(aspectRatio: string, index: number): string {
    if (aspectRatio === 'panoramic') {
      return 'sm:col-span-2 lg:col-span-8 aspect-[16/10]';
    }
    if (aspectRatio === 'portrait') {
      return 'sm:col-span-1 lg:col-span-4 aspect-[3/4]';
    }
    if (index % 5 === 0) {
      return 'sm:col-span-2 lg:col-span-8 aspect-[16/10]';
    }
    return 'sm:col-span-1 lg:col-span-4 aspect-[4/3]';
  }

  public openLightbox(item: GalleryItem): void {
    const list = this.galleryService.filteredItems();
    const index = list.findIndex((i) => i.id === item.id);
    this.activeIndex.set(index);
    this.activeItem.set(item);
  }

  public closeLightbox(): void {
    this.activeItem.set(null);
    this.activeIndex.set(-1);
  }

  public prevImage(): void {
    const list = this.galleryService.filteredItems();
    const prev = this.activeIndex() - 1;
    if (prev >= 0) {
      this.activeIndex.set(prev);
      this.activeItem.set(list[prev]);
    }
  }

  public nextImage(): void {
    const list = this.galleryService.filteredItems();
    const next = this.activeIndex() + 1;
    if (next < list.length) {
      this.activeIndex.set(next);
      this.activeItem.set(list[next]);
    }
  }
}
