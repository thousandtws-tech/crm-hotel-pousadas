// UI de foto-capture — template, estilos e bindings. A lógica vive em foto-capture.store.ts.
import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FotoCaptureStore, type ModoCaptura } from './foto-capture.store';

@Component({
  selector: 'app-foto-capture',
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './foto-capture.component.html',
  styleUrl: './foto-capture.component.css',
})
export class FotoCaptureComponent extends FotoCaptureStore {
  override readonly modo = input<ModoCaptura>('rosto');
  override readonly confirmada = output<Blob>();
  override readonly cancelada = output<void>();
  protected override readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
}
