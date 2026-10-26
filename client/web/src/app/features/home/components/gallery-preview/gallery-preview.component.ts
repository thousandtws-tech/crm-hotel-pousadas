import { Component, afterNextRender, ElementRef, inject, DestroyRef, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GalleryService } from '../../../../core/services/gallery.service';
import { GalleryItem } from '../../../../core/models/gallery-item.model';
import { LightboxComponent } from '../../../../shared/components/lightbox/lightbox.component';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-gallery-preview',
  imports: [RouterLink, LightboxComponent, IconComponent],
  template: `
    <section class="py-16 sm:py-20 lg:py-24 bg-[#F7F5F0]" aria-labelledby="gallery-preview-heading">
      <div class="container-editorial">
        
        <!-- Header -->
        <div class="gallery-prev-header flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-10 lg:mb-12 gap-6">
          <div class="max-w-xl">
            <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
              Ambientes & Região
            </span>
            <h2 id="gallery-preview-heading" class="type-title text-[#054054]">
              Conheça o clima da nossa hospedagem no Peró.
            </h2>
          </div>

          <a
            routerLink="/galeria"
            class="btn-text self-start md:self-end"
          >
            <span>Ver galeria completa</span>
            <app-icon name="arrow-right" [size]="13"></app-icon>
          </a>
        </div>

        <!-- Asymmetric Editorial Photo Composition -->
        <div class="gallery-prev-grid grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 lg:gap-8 items-start">
          
          <!-- Column A: Tall Vertical (Col 1-5) -->
          <div
            class="gallery-photo-item md:col-span-5 editorial-image-container aspect-[3/4] cursor-pointer shadow-sm group"
            (click)="openLightbox(1)"
          >
            <img
              [src]="items()[1].imageUrl"
              [alt]="items()[1].title"
              loading="lazy"
              class="w-full h-full object-cover"
            />
          </div>

          <!-- Column B: Top Horizontal + Bottom Duo (Col 6-12) -->
          <div class="md:col-span-7 flex flex-col gap-5 sm:gap-6 lg:gap-8">
            <!-- Large Landscape -->
            <div
              class="gallery-photo-item editorial-image-container aspect-[16/10] cursor-pointer shadow-sm group"
              (click)="openLightbox(0)"
            >
              <img
                [src]="items()[0].imageUrl"
                [alt]="items()[0].title"
                loading="lazy"
                class="w-full h-full object-cover"
              />
            </div>

            <!-- Duo Side-by-side -->
            <div class="grid grid-cols-2 gap-5 sm:gap-6 lg:gap-8">
              <div
                class="gallery-photo-item editorial-image-container aspect-[4/3] cursor-pointer shadow-sm group"
                (click)="openLightbox(2)"
              >
                <img
                  [src]="items()[2].imageUrl"
                  [alt]="items()[2].title"
                  loading="lazy"
                  class="w-full h-full object-cover"
                />
              </div>

              <div
                class="gallery-photo-item editorial-image-container aspect-[4/3] cursor-pointer shadow-sm group"
                (click)="openLightbox(4)"
              >
                <img
                  [src]="items()[4].imageUrl"
                  [alt]="items()[4].title"
                  loading="lazy"
                  class="w-full h-full object-cover"
                />
              </div>
            </div>

          </div>

        </div>

      </div>

      <!-- Lightbox Modal -->
      @if (activeItem()) {
        <app-lightbox
          [item]="activeItem()!"
          [hasPrev]="activeIndex() > 0"
          [hasNext]="activeIndex() < items().length - 1"
          (onClose)="closeLightbox()"
          (onPrev)="prevImage()"
          (onNext)="nextImage()"
        ></app-lightbox>
      }
    </section>
  `
})
export class GalleryPreviewComponent {
  public readonly galleryService = inject(GalleryService);
  public readonly items = this.galleryService.items;

  public readonly activeIndex = signal<number>(-1);
  public readonly activeItem = signal<GalleryItem | null>(null);

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
      const header = root.querySelector<HTMLElement>('.gallery-prev-header');
      const photos = root.querySelectorAll<HTMLElement>('.gallery-photo-item');
      const grid = root.querySelector<HTMLElement>('.gallery-prev-grid');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (photos.length > 0) {
        this.motion.animateScrollReveal(Array.from(photos), {
          y: 20,
          duration: 0.8,
          stagger: 0.08,
          trigger: grid || photos[0]
        });
      }
    }, this.destroyRef);
  }

  public openLightbox(index: number): void {
    if (this.items()[index]) {
      this.activeIndex.set(index);
      this.activeItem.set(this.items()[index]);
    }
  }

  public closeLightbox(): void {
    this.activeIndex.set(-1);
    this.activeItem.set(null);
  }

  public prevImage(): void {
    const prev = this.activeIndex() - 1;
    if (prev >= 0) {
      this.openLightbox(prev);
    }
  }

  public nextImage(): void {
    const next = this.activeIndex() + 1;
    if (next < this.items().length) {
      this.openLightbox(next);
    }
  }
}
