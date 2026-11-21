import { Component } from '@angular/core';
import { HOTEL_CONFIG } from '../../../core/config/hotel-config';
import { IconComponent } from '../icons/icon.component';

/** Botão flutuante de WhatsApp — abre conversa com a pousada em nova aba. */
@Component({
  selector: 'app-whatsapp-float',
  imports: [IconComponent],
  template: `
    @if (url) {
      <a
        class="fab"
        [href]="url"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar com a pousada no WhatsApp"
        title="Fale conosco no WhatsApp"
      >
        <app-icon name="whatsapp" [size]="30"></app-icon>
      </a>
    }
  `,
  styles: `
    .fab {
      position: fixed;
      right: 1.25rem;
      bottom: 1.25rem;
      z-index: 40;
      width: 3.5rem;
      height: 3.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: #25d366;
      color: #fff;
      box-shadow: 0 4px 14px rgba(3, 43, 56, 0.35);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(3, 43, 56, 0.45);
    }
    .fab:focus-visible {
      outline: 3px solid #054054;
      outline-offset: 3px;
    }
    @media (prefers-reduced-motion: reduce) {
      .fab { transition: none; }
    }
  `,
})
export class WhatsappFloatComponent {
  protected readonly url = HOTEL_CONFIG.whatsapp
    ? `https://wa.me/${HOTEL_CONFIG.whatsapp}?text=${encodeURIComponent(HOTEL_CONFIG.whatsappDefaultMessage)}`
    : null;
}
