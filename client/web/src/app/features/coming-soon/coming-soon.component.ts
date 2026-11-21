import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { SeoService } from '../../core/services/seo.service';
import { WhatsappFloatComponent } from '../../shared/components/whatsapp-float/whatsapp-float.component';

/** Página "Em breve" — teaser standalone (sem header/footer). */
@Component({
  selector: 'app-coming-soon',
  imports: [WhatsappFloatComponent],
  template: `
    <main class="palco">
      <img
        src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=90"
        alt=""
        aria-hidden="true"
        class="fundo"
      />
      <div class="overlay" aria-hidden="true"></div>

      <section class="conteudo">
        <img src="/logo.svg" alt="Pousada Espírito do Mar" class="marca" />

        <h1>Em breve, uma nova experiência à beira-mar.</h1>

        <p class="sub">
          Estamos preparando algo especial para os nossos hóspedes.<br>
          Fale conosco pelo WhatsApp.
        </p>

      </section>
      <app-whatsapp-float></app-whatsapp-float>
    </main>
  `,
  styles: `
    .palco {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      background: #032b38;
      padding: 3rem 1.5rem;
    }
    .fundo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      filter: brightness(0.78);
    }
    .overlay {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(rgba(3, 43, 56, 0.45), rgba(3, 43, 56, 0.45)),
        linear-gradient(to top, rgba(3, 43, 56, 0.95), rgba(3, 43, 56, 0.35) 55%, transparent);
      pointer-events: none;
    }
    .conteudo {
      position: relative;
      z-index: 1;
      width: min(34rem, 100%);
      text-align: center;
      animation: subir 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .marca {
      height: 9rem;
      width: auto;
      margin: 0 auto 2.25rem;
      filter: brightness(0) invert(1) drop-shadow(0 4px 18px rgba(0, 0, 0, 0.45));
    }
    h1 {
      font-family: var(--font-serif);
      font-weight: 400;
      font-size: clamp(2.1rem, 5.4vw, 3.4rem);
      line-height: 1.12;
      color: #f7f5f0;
      margin: 0 0 1.2rem;
      text-wrap: balance;
    }
    .sub {
      font-size: 1rem;
      line-height: 1.65;
      color: #a9c3cb;
      max-width: 34rem;
      margin: 0 auto;
    }
    @keyframes subir {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .conteudo { animation: none; }
    }
  `,
})
export class ComingSoonComponent {
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);

  constructor() {
    this.seo.updateSeo({
      title: 'Em breve',
      description: `Estamos preparando uma nova experiência em ${HOTEL_CONFIG.name}. Fale conosco pelo WhatsApp.`,
    });
    // Teaser não deve ser indexado enquanto estiver no ar.
    this.meta.addTag({ name: 'robots', content: 'noindex' });
  }
}
