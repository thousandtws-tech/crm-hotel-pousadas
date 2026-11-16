import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { HOTEL_CONFIG } from './core/config/hotel-config';
import { FALLBACK_ACCOMMODATIONS } from './core/services/accommodation.service';
import { TestimonialService } from './core/services/testimonial.service';
import { HeroComponent } from './features/home/components/hero/hero.component';

describe('App & Authentic Copy Verification', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, HeroComponent],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should contain a router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('should expose authentic Pousada Espírito do Mar configuration in Cabo Frio', () => {
    expect(HOTEL_CONFIG.businessName).toBe('Pousada Espírito do Mar');
    expect(HOTEL_CONFIG.location.neighborhood).toBe('Peró');
    expect(HOTEL_CONFIG.location.city).toBe('Cabo Frio');
    expect(HOTEL_CONFIG.phone).toBe('(22) 2644-3077');
    expect(HOTEL_CONFIG.whatsapp).toBeNull();
    expect(HOTEL_CONFIG.faqs.length).toBeGreaterThanOrEqual(6);
  });

  it('should not expose synthetic testimonials or fictitious luxury suite prices', () => {
    const testimonialService = TestBed.inject(TestimonialService);

    expect(testimonialService.testimonials().length).toBe(0);
    // Catálogo de contingência exibido quando a API está indisponível:
    // não pode conter tarifas inventadas nem nomes de suítes fictícias.
    for (const acc of FALLBACK_ACCOMMODATIONS) {
      expect(acc.price).toBeNull();
      expect(acc.priceLabel).toBe('Sob consulta');
      expect(acc.name).not.toMatch(/Ocean Front|Villa Presidencial|Bungalow/i);
    }
  });

  it('should render the authentic Hero headline and CTAs', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Pousada Espírito do Mar: sua estadia pertinho da Praia do Peró'
    );
    expect(compiled.textContent).toContain('Consultar disponibilidade');
    expect(compiled.textContent).toContain('Conheça nossas acomodações');
  });
});

