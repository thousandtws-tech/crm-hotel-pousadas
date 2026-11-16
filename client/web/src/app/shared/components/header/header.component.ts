import { Component, inject, PLATFORM_ID, signal, viewChild, ElementRef, effect } from '@angular/core';
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
    '(window:keydown.escape)': 'closeMobileMenu()',
    '(document:keydown.tab)': 'onTabKey($event)'
  }
})
export class HeaderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  public readonly hotelConfig = HOTEL_CONFIG;

  public readonly isScrolled = signal<boolean>(false);
  public readonly isMobileMenuOpen = signal<boolean>(false);

  private readonly menuTrigger = viewChild<ElementRef<HTMLButtonElement>>('menuTrigger');
  private readonly mobileDialog = viewChild<ElementRef<HTMLElement>>('mobileDialog');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    // Ao abrir o menu, move o foco para dentro do diálogo; ao fechar, devolve.
    effect(() => {
      const open = this.isMobileMenuOpen();
      if (!isPlatformBrowser(this.platformId)) return;
      if (open) {
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        setTimeout(() => this.mobileDialog()?.nativeElement.focus());
      } else {
        this.previouslyFocused?.focus?.();
        this.previouslyFocused = null;
      }
    });
  }

  public onWindowScroll(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.isScrolled.set(window.scrollY > 40);
    }
  }

  /** Mantém o foco dentro do diálogo enquanto o menu está aberto. */
  public onTabKey(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (!this.isMobileMenuOpen() || !isPlatformBrowser(this.platformId)) return;
    const dialog = this.mobileDialog()?.nativeElement;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
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
