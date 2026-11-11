import { Component, inject, OnInit, effect } from '@angular/core';
import { HeroComponent } from './components/hero/hero.component';
import { BookingBarComponent } from '../../shared/components/booking-bar/booking-bar.component';
import { EssenceComponent } from './components/essence/essence.component';
import { FeaturedAccommodationsComponent } from './components/featured-accommodations/featured-accommodations.component';
import { FeaturedExperiencesComponent } from './components/featured-experiences/featured-experiences.component';
import { VisualBreakComponent } from './components/visual-break/visual-break.component';
import { GalleryPreviewComponent } from './components/gallery-preview/gallery-preview.component';
import { LocationPreviewComponent } from './components/location-preview/location-preview.component';
import { FaqComponent } from './components/faq/faq.component';
import { SeoService } from '../../core/services/seo.service';
import { SiteContentService } from '../../core/services/site-content.service';

@Component({
  selector: 'app-home',
  imports: [
    HeroComponent,
    BookingBarComponent,
    EssenceComponent,
    FeaturedAccommodationsComponent,
    FeaturedExperiencesComponent,
    VisualBreakComponent,
    GalleryPreviewComponent,
    LocationPreviewComponent,
    FaqComponent
  ],
  template: `
    <app-hero></app-hero>
    <section id="booking-section" class="relative z-30 -mt-8 sm:-mt-10 lg:-mt-12 mb-6 sm:mb-8 lg:mb-10">
      <app-booking-bar></app-booking-bar>
    </section>

    <app-essence></app-essence>
    <app-featured-accommodations></app-featured-accommodations>
    <app-featured-experiences></app-featured-experiences>
    <app-visual-break></app-visual-break>
    <app-gallery-preview></app-gallery-preview>
    <app-location-preview></app-location-preview>
    <app-faq></app-faq>
  `
})
export class HomeComponent implements OnInit {
  private readonly seoService = inject(SeoService);
  private readonly site = inject(SiteContentService);

  constructor() {
    // SEO editável pelo CMS sobrescreve os valores padrão quando publicado.
    effect(() => {
      const seo = this.site.seo();
      if (!seo) return;
      this.seoService.updateSeo({
        title: seo.titulo || 'Pousada Espírito do Mar | Hospedagem no Peró, Cabo Frio',
        description:
          seo.descricao
          || 'Conheça a Pousada Espírito do Mar, no Peró, em Cabo Frio. Explore as acomodações, conheça a estrutura e consulte a disponibilidade.',
        url: 'https://pousadaespiritodomar.com.br/',
      });
    });
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Pousada Espírito do Mar | Hospedagem no Peró, Cabo Frio',
      description: 'Conheça a Pousada Espírito do Mar, no Peró, em Cabo Frio. Explore as acomodações, conheça a estrutura e consulte a disponibilidade.',
      url: 'https://pousadaespiritodomar.com.br/'
    });
    this.seoService.setHotelStructuredData();
    this.site.carregar();
  }
}
