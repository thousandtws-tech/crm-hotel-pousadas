import { Component, input, output, inject, PLATFORM_ID, viewChild, ElementRef, afterNextRender } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GalleryItem } from '../../../core/models/gallery-item.model';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-lightbox',
  imports: [IconComponent],
  templateUrl: './lightbox.component.html',
  host: {
    '(window:keydown.escape)': 'close()',
    '(window:keydown.arrowleft)': 'prev()',
    '(window:keydown.arrowright)': 'next()',
    '(document:keydown.tab)': 'onTabKey($event)'
  }
})
export class LightboxComponent {
  public readonly item = input.required<GalleryItem>();
  public readonly hasPrev = input<boolean>(true);
  public readonly hasNext = input<boolean>(true);

  public readonly onClose = output<void>();
  public readonly onPrev = output<void>();
  public readonly onNext = output<void>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('lightboxDialog');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.previouslyFocused = document.activeElement as HTMLElement | null;
      this.dialog()?.nativeElement.focus();
    });
  }

  /** Mantém o foco dentro do diálogo (WCAG 2.4.3 / prática de modal). */
  public onTabKey(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || !isPlatformBrowser(this.platformId)) return;
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

  public close(): void {
    this.onClose.emit();
    this.previouslyFocused?.focus?.();
  }

  public prev(): void {
    this.onPrev.emit();
  }

  public next(): void {
    this.onNext.emit();
  }
}
