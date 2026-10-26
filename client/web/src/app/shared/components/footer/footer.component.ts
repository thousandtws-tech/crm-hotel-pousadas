import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../icons/icon.component';
import { HOTEL_CONFIG } from '../../../core/config/hotel-config';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, IconComponent],
  templateUrl: './footer.component.html'
})
export class FooterComponent {
  private readonly sanitizer = inject(DomSanitizer);

  public readonly hotelConfig = HOTEL_CONFIG;
  public readonly safeMapEmbedUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl(this.hotelConfig.googleMapsEmbedUrl);
}
