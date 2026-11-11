import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../icons/icon.component';
import { HOTEL_CONFIG } from '../../../core/config/hotel-config';
import { NewsletterService } from '../../../core/services/newsletter.service';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, IconComponent, FormsModule],
  templateUrl: './footer.component.html'
})
export class FooterComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly newsletter = inject(NewsletterService);

  public readonly hotelConfig = HOTEL_CONFIG;
  public readonly safeMapEmbedUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl(this.hotelConfig.googleMapsEmbedUrl);

  // Newsletter do rodapé — captado por POST /publico/newsletter.
  public readonly newsletterEmail = signal('');
  public readonly newsletterEstado = signal<'idle' | 'enviando' | 'ok' | 'erro'>('idle');
  public readonly newsletterMsg = signal('');

  public async inscreverNewsletter(): Promise<void> {
    const email = this.newsletterEmail().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      this.newsletterEstado.set('erro');
      this.newsletterMsg.set('Informe um e-mail válido.');
      return;
    }
    this.newsletterEstado.set('enviando');
    this.newsletterMsg.set('');
    const ok = await this.newsletter.inscrever(email, 'rodape');
    if (ok) {
      this.newsletterEstado.set('ok');
      this.newsletterMsg.set('Inscrição confirmada — até breve!');
      this.newsletterEmail.set('');
    } else {
      this.newsletterEstado.set('erro');
      this.newsletterMsg.set('Não foi possível concluir. Tente novamente.');
    }
  }
}
