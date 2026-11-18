// UI de documentos-modal — template, estilos e bindings. A lógica vive em documentos-modal.store.ts.
import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Cliente } from '@core/models/clientes.models';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture.component';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import { DocumentosModalStore } from './documentos-modal.store';

@Component({
  selector: 'app-documentos-modal',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DateInputComponent,
    FotoCaptureComponent,
  ],
  templateUrl: './documentos-modal.component.html',
  styleUrl: './documentos-modal.component.css',
})
export class DocumentosModalComponent extends DocumentosModalStore {
  override readonly cliente = input.required<Cliente>();
  override readonly fechou = output<void>();
}
