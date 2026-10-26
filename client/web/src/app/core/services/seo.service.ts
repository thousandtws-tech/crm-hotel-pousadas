import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { HOTEL_CONFIG } from '../config/hotel-config';

export interface SeoConfig {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article';
}

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly document = inject(DOCUMENT);

  public updateSeo(config: SeoConfig): void {
    const fullTitle = config.title.includes(HOTEL_CONFIG.name)
      ? config.title
      : `${config.title} | ${HOTEL_CONFIG.name}`;

    this.titleService.setTitle(fullTitle);

    this.metaService.updateTag({ name: 'description', content: config.description });
    this.metaService.updateTag({ property: 'og:title', content: fullTitle });
    this.metaService.updateTag({ property: 'og:description', content: config.description });
    this.metaService.updateTag({ property: 'twitter:title', content: fullTitle });
    this.metaService.updateTag({ property: 'twitter:description', content: config.description });

    if (config.image) {
      this.metaService.updateTag({ property: 'og:image', content: config.image });
      this.metaService.updateTag({ property: 'twitter:image', content: config.image });
    }

    if (config.url) {
      this.metaService.updateTag({ property: 'og:url', content: config.url });
      this.updateCanonicalUrl(config.url);
    }
  }

  public setHotelStructuredData(): void {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LodgingBusiness',
      name: HOTEL_CONFIG.businessName,
      description: HOTEL_CONFIG.description,
      url: 'https://pousadaespiritodomar.com.br/',
      telephone: HOTEL_CONFIG.phoneFormatted,
      checkinTime: '13:00',
      checkoutTime: '11:00',
      address: {
        '@type': 'PostalAddress',
        streetAddress: HOTEL_CONFIG.address.street,
        addressLocality: HOTEL_CONFIG.address.city,
        addressRegion: HOTEL_CONFIG.address.state,
        postalCode: HOTEL_CONFIG.address.zipCode,
        addressCountry: 'BR'
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: HOTEL_CONFIG.geo.latitude,
        longitude: HOTEL_CONFIG.geo.longitude
      },
      amenityFeature: [
        { '@type': 'LocationFeatureSpecification', name: 'Piscina externa', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'Café da manhã', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'Wi-Fi', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'Estacionamento', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'Ar-condicionado nos quartos', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'TV nos quartos', value: true },
        { '@type': 'LocationFeatureSpecification', name: 'Banheiro privativo', value: true }
      ]
    };

    let script = this.document.getElementById('hotel-schema-jsonld') as HTMLScriptElement | null;
    if (!script) {
      script = this.document.createElement('script');
      script.id = 'hotel-schema-jsonld';
      script.type = 'application/ld+json';
      this.document.head.appendChild(script);
    }
    script.text = JSON.stringify(schema);
  }

  private updateCanonicalUrl(url: string): void {
    let link: HTMLLinkElement | null = this.document.querySelector("link[rel='canonical']");
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}
