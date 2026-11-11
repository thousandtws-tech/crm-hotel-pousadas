import { Component, inject, OnInit, effect } from '@angular/core';
import { HeroComponent } from './components/hero/hero.component';
import { BookingBarComponent } from '../../shared/components/booking-bar/booking-bar.component';
import { EssenceComponent } from './components/essence/essence.component';
import { FeaturedAccommodationsComponent } from './components/featured-accommodations/featured-accommodations.component';
import { FeaturedExperiencesComponent } from './components/featured-experiences/featured-experiences.component';
import { VisualBreakComponent } from './components/visual-break/visual-break.component';
import { GalleryPreviewComponent } from './components/gallery-preview/gallery-preview.component';
import { LocationPreviewComponent } from './components/location-preview/location-preview.component';
import { StatsStripComponent } from './components/stats-strip/stats-strip.component';
import { PhoneCtaComponent } from './components/phone-cta/phone-cta.component';
import { FaqComponent } from './components/faq/faq.component';
import { SeoService } from '../../core/services/seo.service';
import { SiteContentService } from '../../core/services/site-content.service';

const DEFAULT_SEO_TITLE = 'Pousada Espírito do Mar | Hospedagem no Peró, Cabo Frio';
const DEFAULT_SEO_DESC =
  'Conheça a Pousada Espírito do Mar, no Peró, em Cabo Frio. Explore as acomodações, conheça a estrutura e consulte a disponibilidade.';
const DEFAULT_SEO_KEYWORDS =
  'Pousada Espírito do Mar, pousada no Peró, pousada em Cabo Frio, hospedagem perto da Praia do Peró, Cabo Frio RJ';

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
    StatsStripComponent,
    PhoneCtaComponent,
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
    <app-stats-strip></app-stats-strip>
    <app-visual-break></app-visual-break>
    <app-gallery-preview></app-gallery-preview>
    <app-location-preview></app-location-preview>
    <app-phone-cta></app-phone-cta>
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
      this.seoService.updateSeo({
        title: seo?.titulo || DEFAULT_SEO_TITLE,
        exactTitle: Boolean(seo?.titulo),
        description: seo?.descricao || DEFAULT_SEO_DESC,
        keywords: seo?.keywords || DEFAULT_SEO_KEYWORDS,
        url: 'https://espiritodomar.com.br/',
      });
    });
  }

  public ngOnInit(): void {
    this.seoService.setHotelStructuredData();
    void this.site.carregar();
  }
}
