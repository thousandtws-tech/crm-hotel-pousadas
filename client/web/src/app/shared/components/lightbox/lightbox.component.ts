import { Component, input, output } from '@angular/core';
import { GalleryItem } from '../../../core/models/gallery-item.model';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-lightbox',
  imports: [IconComponent],
  templateUrl: './lightbox.component.html',
  host: {
    '(window:keydown.escape)': 'close()',
    '(window:keydown.arrowleft)': 'prev()',
    '(window:keydown.arrowright)': 'next()'
  }
})
export class LightboxComponent {
  public readonly item = input.required<GalleryItem>();
  public readonly hasPrev = input<boolean>(true);
  public readonly hasNext = input<boolean>(true);

  public readonly onClose = output<void>();
  public readonly onPrev = output<void>();
  public readonly onNext = output<void>();

  public close(): void {
    this.onClose.emit();
  }

  public prev(): void {
    this.onPrev.emit();
  }

  public next(): void {
    this.onNext.emit();
  }
}
