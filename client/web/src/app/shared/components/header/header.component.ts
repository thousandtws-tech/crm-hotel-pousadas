import { Component, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../icons/icon.component';
import { HOTEL_CONFIG } from '../../../core/config/hotel-config';

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './header.component.html',
  host: {
    '(window:scroll)': 'onWindowScroll()',
    '(window:keydown.escape)': 'closeMobileMenu()'
  }
})
export class HeaderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  public readonly hotelConfig = HOTEL_CONFIG;

  public readonly isScrolled = signal<boolean>(false);
  public readonly isMobileMenuOpen = signal<boolean>(false);

  public onWindowScroll(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.isScrolled.set(window.scrollY > 40);
    }
  }

  public toggleMobileMenu(): void {
    this.isMobileMenuOpen.update((open) => !open);
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = this.isMobileMenuOpen() ? 'hidden' : '';
    }
  }

  public closeMobileMenu(): void {
    this.isMobileMenuOpen.set(false);
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = '';
    }
  }
}
